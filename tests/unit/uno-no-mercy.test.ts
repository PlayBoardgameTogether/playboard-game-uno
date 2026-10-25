import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import type { GameExtension } from '../../packages/game-sdk/src/index.js';
import { DeterministicRng } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';

type Card = { id: string; color: string; value: string };
type Action = { type: 'play'; cardId: string; color: string | null; uno: boolean }
  | { type: 'draw' | 'callUno' } | { type: 'swap' | 'catchUno'; target: string }
  | { type: 'roulette'; color: string };
type State = {
  seats: string[]; hands: Card[][]; deck: Card[]; discard: Card[]; retired: Card[];
  turn: number; direction: number; color: string; drawn: string | null; winners: string[];
  eliminated: string[]; phase: string; pendingDraw: number; lastDraw: number;
  unoSeat: string | null; seq: number; stalled: number; turns: number; last: string;
};
type View = {
  you: string | null; hand: Card[]; players: { seatId: string; count: number; eliminated: boolean }[];
  actions: Action[]; currentSeat: string; pendingDraw: number; phase: string;
};
let game: GameExtension<State, Record<string, never>, Action, View, unknown, unknown>;
const actor = (seatId: string) => ({ kind: 'seat' as const, seatId, controllerEpoch: 0 });
const viewer = (seatId: string) => ({ kind: 'seat' as const, seatId });
const play = (cardId: string, color: string | null = null, uno = true): Action => ({ type: 'play', cardId, color, uno });
function initial(count = 3, seed = 123) {
  const rng = new DeterministicRng(seed);
  return { rng, state: game.setup({ seats: ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, count), options: {}, rng }).state };
}
function arrange(hands: string[][], top = 'red.5.0') {
  const { state, rng } = initial(hands.length);
  const cards = [...state.deck, ...state.discard, ...state.hands.flat()];
  const lookup = new Map(cards.map(card => [card.id, card]));
  const used = [top, ...hands.flat()];
  expect(new Set(used).size).toBe(used.length);
  state.hands = hands.map(ids => ids.map(id => lookup.get(id)!));
  state.discard = [lookup.get(top)!];
  state.deck = cards.filter(card => !used.includes(card.id));
  state.color = state.discard[0]!.color;
  return { state: game.deserialize(state), rng };
}
function topDraws(state: State, ids: string[]) {
  const cards = ids.map(id => state.deck.splice(state.deck.findIndex(card => card.id === id), 1)[0]!);
  state.deck.push(...cards.reverse());
}
function apply(state: State, rng: DeterministicRng, action: Action, seat = state.seats[state.turn]!) {
  const original = structuredClone(state);
  const result = game.applyAction(state, actor(seat), action, rng);
  expect(state).toEqual(original);
  return game.deserialize(game.serialize(result.state));
}
beforeAll(async () => {
  const base = new URL('../../game-packages/uno/', import.meta.url);
  const parsed = readGamePackage(Buffer.from(zipSync({
    'game.json': await readFile(new URL('no-mercy/game.json', base)),
    'server.js': await readFile(new URL('no-mercy/server.txt', base)),
    'client.html': await readFile(new URL('client.html', base)),
  })));
  game = (await PackageRuntime.create()).extension(parsed.server) as unknown as typeof game;
});
describe('UNO No Mercy edition in isolated QuickJS', () => {
  it('installs for 2–6 seats, deals deterministically and conserves the exact 168-card distribution', () => {
    for (const count of [2, 6]) {
      const { state, rng } = initial(count);
      expect(state).toEqual(initial(count).state);
      expect(rng.snapshot()).toEqual(initial(count).rng.snapshot());
      expect(state.hands.map(hand => hand.length)).toEqual(Array(count).fill(7));
      const cards = [...state.deck, ...state.discard, ...state.hands.flat()];
      expect(cards).toHaveLength(168);
      expect(new Set(cards.map(card => card.id)).size).toBe(168);
      expect(cards.filter(card => card.value === 'reverse4')).toHaveLength(8);
      expect(cards.filter(card => card.value === 'roulette')).toHaveLength(8);
      expect(cards.filter(card => card.value === 'draw10')).toHaveLength(4);
      expect(cards.filter(card => card.value === 'discardAll')).toHaveLength(12);
      expect(state.discard.at(-1)!.value).toMatch(/^\d$/);
      expect(game.deserialize(game.serialize(state))).toEqual(state);
      for (const seat of state.seats) {
        const view = game.getView(state, viewer(seat));
        expect(view.hand).toEqual(state.hands[state.seats.indexOf(seat)]);
        expect(view).not.toHaveProperty('deck');
        expect(view).not.toHaveProperty('retired');
        expect(view).not.toHaveProperty('hands');
      }
    }
    expect(() => initial(1)).toThrow();
    expect(() => game.validateOptions({ stacking: false })).toThrow();
    expect(() => game.parseAction({ type: 'draw', seatId: 'a' })).toThrow();
  });
  it('rejects illegal identities/actions without consuming RNG or mutating input', () => {
    const { state, rng } = arrange([['blue.2.0', 'red.2.0'], ['green.3.0'], ['yellow.4.0']]);
    const saved = structuredClone(state), random = rng.snapshot();
    for (const [seat, action] of [
      ['b', { type: 'draw' }], ['a', play('blue.2.0')], ['a', play('red.2.0', 'blue')],
      ['a', { type: 'draw' }], ['a', { type: 'swap', target: 'b' }],
      ['a', { type: 'catchUno', target: 'b' }], ['intruder', play('red.2.0')],
    ] as [string, Action][]) {
      expect(() => game.applyAction(state, actor(seat), action, rng)).toThrow();
      expect(state).toEqual(saved);
      expect(rng.snapshot()).toEqual(random);
    }
    expect(game.getView(state, viewer('intruder')).actions).toEqual([]);
    expect(game.getView(state, { kind: 'spectator' }).hand).toEqual([]);
    expect(game.projectEvents([{ type: 'secret', hands: state.hands }], viewer('b'))).toEqual([]);
  });
  it('stacks equal-or-higher penalties regardless of color and skips a player who accepts the entire debt', () => {
    const { state, rng } = arrange([
      ['red.draw2.0', 'blue.1.0'], ['green.draw4.0', 'yellow.draw2.0', 'blue.3.0'], ['wild.draw6.0', 'green.8.0'],
    ]);
    const two = apply(state, rng, play('red.draw2.0'));
    const six = apply(two, rng, play('green.draw4.0'));
    expect(six.pendingDraw).toBe(6);
    expect(six.lastDraw).toBe(4);
    const twelve = apply(six, rng, play('wild.draw6.0', 'yellow'));
    expect(twelve.pendingDraw).toBe(12);
    const paid = apply(twelve, rng, { type: 'draw' });
    expect(paid.hands[0]).toHaveLength(13);
    expect(paid.pendingDraw).toBe(0);
    expect(paid.turn).toBe(1);
    const lower = structuredClone(six);
    lower.turn = 1;
    expect(() => apply(lower, rng, play('yellow.draw2.0'))).toThrow();
  });
  it('reverses +4 toward the new direction and back to self with two active players', () => {
    for (const count of [2, 3]) {
      const { state, rng } = arrange([
        ['wild.reverse4.0', 'wild.draw6.0', 'blue.1.0'], ['green.2.0'], ['yellow.3.0'],
      ].slice(0, count));
      const result = apply(state, rng, play('wild.reverse4.0', 'blue'));
      expect(result.direction).toBe(-1);
      expect(result.pendingDraw).toBe(4);
      expect(result.turn).toBe(count === 2 ? 0 : 2);
      if (count === 2) {
        const stacked = apply(result, rng, play('wild.draw6.0', 'green'));
        expect(stacked.pendingDraw).toBe(10);
        expect(stacked.turn).toBe(1);
      }
    }
  });
  it('draws until playable, requires that new card and never exposes the private draw sequence', () => {
    const { state, rng } = arrange([['blue.1.0', 'green.2.0'], ['yellow.3.0'], ['green.4.0']]);
    topDraws(state, ['blue.8.0', 'green.6.0', 'red.9.0']);
    const result = game.applyAction(state, actor('a'), { type: 'draw' }, rng);
    const drawn = game.deserialize(result.state);
    expect(drawn.hands[0]).toHaveLength(5);
    expect(drawn.drawn).toBe('red.9.0');
    expect(game.getView(drawn, viewer('a')).actions).toEqual([play('red.9.0')]);
    expect(game.getView(drawn, viewer('b'))).not.toHaveProperty('drawn', 'red.9.0');
    const projected = JSON.stringify(game.projectEvents(result.events, viewer('b')));
    expect(projected).not.toContain('blue.8.0');
    expect(projected).not.toContain('red.9.0');
    expect(apply(drawn, rng, play('red.9.0')).turn).toBe(1);
  });
  it('persists mandatory 7 swap, keeps target hands private, and rotates 0 in both directions', () => {
    const { state, rng } = arrange([['red.7.0', 'blue.1.0'], ['green.2.0', 'blue.3.0'], ['yellow.4.0']]);
    const choosing = apply(state, rng, play('red.7.0'));
    expect(choosing.phase).toBe('swap');
    expect(choosing.turn).toBe(0);
    expect(game.getView(choosing, viewer('a')).actions).toEqual([{ type: 'swap', target: 'b' }, { type: 'swap', target: 'c' }]);
    expect(() => apply(choosing, rng, { type: 'swap', target: 'a' })).toThrow();
    const swapped = apply(choosing, rng, { type: 'swap', target: 'b' });
    expect(swapped.hands[0]).toEqual(state.hands[1]);
    expect(swapped.hands[1]!.map(card => card.id)).toEqual(['blue.1.0']);
    expect(swapped.turn).toBe(1);
    for (const direction of [1, -1]) {
      const { state: zero, rng: random } = arrange([['red.0.0', 'blue.1.0'], ['green.2.0'], ['yellow.4.0']]);
      zero.direction = direction;
      const rotated = apply(zero, random, play('red.0.0'));
      expect(rotated.hands[direction === 1 ? 1 : 2]!.map(card => card.id)).toEqual(['blue.1.0']);
      expect(rotated.hands[0]).toEqual(zero.hands[direction === 1 ? 2 : 1]);
    }
  });
  it('discards all matching color underneath the action card and supports skip everyone', () => {
    const { state, rng } = arrange([['red.discardAll.0', 'red.3.0', 'red.8.0', 'blue.1.0'], ['green.2.0'], ['yellow.4.0']]);
    const result = apply(state, rng, play('red.discardAll.0'));
    expect(result.hands[0]!.map(card => card.id)).toEqual(['blue.1.0']);
    expect(result.discard.at(-1)!.id).toBe('red.discardAll.0');
    expect(result.discard).toHaveLength(4);
    const { state: skip, rng: random } = arrange([['red.skipAll.0', 'blue.1.0'], ['green.2.0'], ['yellow.4.0']]);
    expect(apply(skip, random, play('red.skipAll.0')).turn).toBe(0);
  });
  it('lets roulette recipient choose and reveals precisely the cards drawn up to the selected color', () => {
    const { state, rng } = arrange([['wild.roulette.0', 'red.1.0'], ['blue.2.0'], ['green.3.0']]);
    const choosing = apply(state, rng, play('wild.roulette.0'));
    expect(choosing.phase).toBe('roulette');
    expect(choosing.turn).toBe(1);
    topDraws(choosing, ['wild.draw10.0', 'blue.8.0', 'green.4.0']);
    const result = game.applyAction(choosing, actor('b'), { type: 'roulette', color: 'green' }, rng);
    const done = game.deserialize(game.serialize(result.state));
    expect(done.turn).toBe(2);
    expect(done.color).toBe('green');
    expect(done.hands[1]).toHaveLength(4);
    expect(game.projectEvents(result.events, viewer('c'))).toContainEqual({
      type: 'roulette', seatId: 'b', cards: [
        { id: 'wild.draw10.0', color: 'wild', value: 'draw10' },
        { id: 'blue.8.0', color: 'blue', value: '8' },
        { id: 'green.4.0', color: 'green', value: '4' },
      ], color: 'green',
    });
  });
  it('supports race-safe UNO calling/catching before the next ordinary action', () => {
    const { state, rng } = arrange([['red.2.0', 'blue.1.0'], ['red.4.0'], ['green.3.0']]);
    const missed = apply(state, rng, play('red.2.0', null, false));
    expect(missed.unoSeat).toBe('a');
    const caught = apply(missed, rng, { type: 'catchUno', target: 'a' }, 'c');
    expect(caught.hands[0]).toHaveLength(3);
    expect(caught.turn).toBe(1);
    expect(() => apply(caught, rng, { type: 'catchUno', target: 'a' }, 'b')).toThrow();
    const declared = apply(missed, rng, { type: 'callUno' }, 'a');
    expect(declared.unoSeat).toBeNull();
    expect(() => apply(declared, rng, { type: 'catchUno', target: 'a' }, 'b')).toThrow();
    const advanced = apply(missed, rng, play('red.4.0'));
    expect(advanced.unoSeat).toBeNull();
    expect(game.getDecisionContext!(missed, viewer('c'))).toBeNull();
  });
  it('eliminates at exactly 25, skips eliminated seats, retires their cards, and wins by survival', () => {
    const { state, rng } = arrange([['red.draw2.0', 'blue.1.0'], ['green.2.0'], ['yellow.3.0']]);
    state.hands[1]!.push(...state.deck.splice(0, 23));
    const pending = apply(game.deserialize(state), rng, play('red.draw2.0'));
    const eliminated = apply(pending, rng, { type: 'draw' });
    expect(eliminated.eliminated).toEqual(['b']);
    expect(eliminated.hands[1]).toEqual([]);
    expect(eliminated.retired).toHaveLength(25);
    expect(eliminated.turn).toBe(2);
    expect(game.getView(eliminated, viewer('b')).actions).toEqual([]);
    const { state: duel, rng: random } = arrange([['red.draw2.0', 'blue.1.0'], ['green.2.0']]);
    duel.hands[1]!.push(...duel.deck.splice(0, 23));
    const end = apply(apply(duel, random, play('red.draw2.0')), random, { type: 'draw' });
    expect(game.getOutcome(end)).toEqual({ status: 'finished', winners: ['a'] });
  });
  it('recycles retired cards only on exhaustion and never moves the top discard', () => {
    const { state, rng } = arrange([['blue.1.0'], ['green.2.0'], ['yellow.3.0']]);
    state.eliminated = ['c'];
    state.retired = [...state.deck.splice(0), ...state.hands[2]!.splice(0)];
    const top = structuredClone(state.discard.at(-1));
    const drawn = apply(game.deserialize(state), rng, { type: 'draw' });
    expect(drawn.retired).toEqual([]);
    expect(drawn.discard).toEqual([top]);
    expect(drawn.deck.length).toBeGreaterThan(0);
  });
  it('ends immediately on final 0/7/penalty/full-discard and refuses post-game actions', () => {
    for (const card of ['red.0.0', 'red.7.0', 'red.draw4.0', 'red.discardAll.0']) {
      const { state, rng } = arrange([[card], ['green.2.0'], ['yellow.3.0']]);
      const won = apply(state, rng, play(card));
      expect(game.getOutcome(won)).toEqual({ status: 'finished', winners: ['a'] });
      expect(won.phase).toBe('play');
      expect(won.pendingDraw).toBe(0);
      expect(() => apply(won, rng, { type: 'draw' })).toThrow();
    }
  });
  it('rejects corrupt cards/phases/outcomes and accepts JSONB key reordering', () => {
    const { state } = initial();
    for (const change of [
      (saved: State) => { saved.deck[0] = saved.deck[1]!; },
      (saved: State) => { saved.phase = 'swap'; },
      (saved: State) => { saved.pendingDraw = 10; },
      (saved: State) => { saved.unoSeat = 'a'; },
      (saved: State) => { saved.winners = ['b']; },
    ]) {
      const saved = structuredClone(state);
      change(saved);
      expect(() => game.deserialize(saved)).toThrow();
    }
    const reordered = JSON.parse(JSON.stringify(state, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value));
    expect(game.deserialize(reordered)).toEqual(state);
  });
  it('finishes 2/4/6-player games with legal AI actions and exact recovery after every action', () => {
    for (const count of [2, 4, 6]) {
      const { state: start, rng } = initial(count, 42 + count);
      let state = start;
      for (let step = 0; step < 800 && !state.winners.length; step++) {
        const seat = state.seats[state.turn]!;
        const view = game.getView(state, viewer(seat));
        const decision = game.getDecisionContext!(state, viewer(seat))!;
        const fallback = game.getFallbackAction(view, game.getActionSpec(state, viewer(seat)))!;
        expect(decision.legalActions[0]).toEqual(fallback);
        state = apply(state, rng, fallback);
      }
      expect(state.winners.length).toBeGreaterThan(0);
    }
  }, 30000);
});
