import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { DeterministicRng } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';
import type { GameExtension } from '../../packages/game-sdk/src/index.js';

type Card = { id: string; color: string; value: string };
type State = { seats: string[]; hands: Card[][]; deck: Card[]; discard: Card[]; turn: number; direction: number;
  color: string; drawn: string | null; winners: string[]; stalled: number; turns: number; last: string };
type Action = { type: 'play'; cardId: string; color: string | null; uno: boolean } | { type: 'draw' | 'pass' };
type View = { you: string | null; hand: Card[]; players: { seatId: string; count: number }[]; top: Card;
  color: string; direction: number; currentSeat: string; deckCount: number; drawn: string | null;
  winners: string[]; last: string; actions: Action[] };
// The package boundary is JSON-only. This test adapter names the package's documented JSON shapes.
let game: GameExtension<State, Record<string, never>, Action, View, unknown, unknown>;
const actor = (seatId: string) => ({ kind: 'seat' as const, seatId, controllerEpoch: 0 });
const viewer = (seatId: string) => ({ kind: 'seat' as const, seatId });
const play = (cardId: string, color: string | null = null, uno = true): Action => ({ type: 'play', cardId, color, uno });
function initial(count = 2, seed = 123) {
  const rng = new DeterministicRng(seed);
  return { rng, state: game.setup({ seats: ['a', 'b', 'c', 'd'].slice(0, count), options: {}, rng }).state };
}
function arranged(hands: string[][], top = 'red.5.0') {
  const { state, rng } = initial(hands.length);
  const cards = [...state.deck, ...state.discard, ...state.hands.flat()];
  const lookup = new Map(cards.map(card => [card.id, card]));
  const used = new Set([top, ...hands.flat()]);
  state.hands = hands.map(ids => ids.map(id => lookup.get(id)!));
  state.discard = [lookup.get(top)!];
  state.deck = cards.filter(card => !used.has(card.id));
  state.color = state.discard[0]!.color;
  return { state: game.deserialize(state), rng };
}

describe('UNO upload package in the actual QuickJS runtime', () => {
  beforeAll(async () => {
    const base = new URL('../../game-packages/uno/', import.meta.url);
    const files = {
      'game.json': await readFile(new URL('game.json', base)),
      'server.js': await readFile(new URL('server.txt', base)),
      'client.html': await readFile(new URL('client.html', base)),
    };
    const parsed = readGamePackage(Buffer.from(zipSync(files)));
    const runtime = await PackageRuntime.create();
    game = runtime.extension(parsed.server) as unknown as typeof game;
  });
  it('passes installation lifecycle for min/max seats, deterministic deals and exact 108-card recovery', () => {
    for (const count of [2, 4]) {
      const { state, rng } = initial(count);
      expect(state).toEqual(initial(count).state);
      expect(state.hands.every(hand => hand.length === 7)).toBe(true);
      expect(state.deck.length).toBe(108 - 7 * count - 1);
      expect(state.discard[0]!.value).toMatch(/^\d$/);
      expect(game.deserialize(game.serialize(state))).toEqual(state);
      expect(game.getOutcome(state)).toEqual({ status: 'ongoing' });
      expect(rng.snapshot()).toEqual(initial(count).rng.snapshot());
      for (const seat of state.seats) {
        expect(game.getView(state, viewer(seat)).hand).toEqual(state.hands[state.seats.indexOf(seat)]);
        expect(game.getActionSpec(state, viewer(seat))).toHaveProperty('actions');
        expect(game.projectEvents([], viewer(seat))).toEqual([]);
      }
    }
    expect(() => game.validateOptions({ invalid: true })).toThrow();
    expect(() => game.parseAction({ type: 'draw', seatId: 'b' })).toThrow();
  });
  it('rejects wrong seats, invalid cards/colors/+4 and keeps original state/RNG unchanged', () => {
    const { state, rng } = arranged([['red.2.0', 'wild.wild4.0', 'blue.3.0'], ['yellow.4.0']]);
    const before = structuredClone(state), random = rng.snapshot();
    for (const [seat, action] of [['b', { type: 'draw' }], ['a', play('yellow.4.0')],
      ['a', play('blue.3.0')], ['a', play('red.2.0', 'red')], ['a', play('wild.wild4.0', 'blue')]] as [string, Action][]) {
      expect(() => game.applyAction(state, actor(seat), action, rng)).toThrow();
      expect(state).toEqual(before); expect(rng.snapshot()).toEqual(random);
    }
    expect(game.getView(state, viewer('a')).actions.some(action => action.type === 'play' && action.cardId === 'wild.wild4.0')).toBe(false);
  });
  it('implements skip, reverse including two-player repeat, and non-stacking draw penalties', () => {
    for (const [card, count, turn, direction, penalty] of [
      ['red.skip.0', 3, 2, 1, 0], ['red.reverse.0', 3, 2, -1, 0],
      ['red.reverse.0', 2, 0, -1, 0], ['red.draw2.0', 3, 2, 1, 2],
      ['wild.wild4.0', 3, 2, 1, 4],
    ] as [string, number, number, number, number][]) {
      const hands = [[card, 'blue.2.0'], ['yellow.3.0'], ['green.8.0']].slice(0, count);
      const { state, rng } = arranged(hands);
      const result = game.applyAction(state, actor('a'), play(card, card.startsWith('wild.') ? 'green' : null), rng).state;
      expect(result.turn).toBe(turn); expect(result.direction).toBe(direction);
      expect(result.hands[1]!.length).toBe(1 + penalty);
      expect(game.deserialize(game.serialize(result))).toEqual(result);
    }
  });
  it('requires wild color, resets chosen color on colored cards, and penalizes forgotten UNO', () => {
    const { state, rng } = arranged([['wild.wild.0', 'blue.2.0'], ['green.3.0']]);
    expect(() => game.applyAction(state, actor('a'), play('wild.wild.0'), rng)).toThrow();
    const missed = game.applyAction(state, actor('a'), play('wild.wild.0', 'blue', false), rng.clone()).state;
    expect(missed.hands[0]!.length).toBe(3); expect(missed.color).toBe('blue');
    const called = game.applyAction(state, actor('a'), play('wild.wild.0', 'green', true), rng).state;
    expect(called.hands[0]!.length).toBe(1); expect(called.last).toContain('UNO');
    const next = game.applyAction(called, actor('b'), play('green.3.0'), rng).state;
    expect(next.color).toBe('green'); expect(next.winners).toEqual(['b']);
  });
  it('lets players play only the newly drawn card or pass, and automatically skips unplayable draws', () => {
    const { state, rng } = arranged([['red.2.0', 'green.1.0'], ['blue.3.0']]);
    const drawn = state.deck.splice(state.deck.findIndex(card => card.id === 'red.9.0'), 1)[0]!;
    state.deck.push(drawn);
    const after = game.applyAction(state, actor('a'), { type: 'draw' }, rng).state;
    expect(after.drawn).toBe('red.9.0'); expect(after.turn).toBe(0);
    expect(() => game.applyAction(after, actor('a'), play('red.2.0'), rng)).toThrow();
    expect(() => game.applyAction(after, actor('a'), { type: 'draw' }, rng)).toThrow();
    expect(game.applyAction(after, actor('a'), { type: 'pass' }, rng).state.turn).toBe(1);
    expect(game.applyAction(after, actor('a'), play(drawn.id), rng).state.hands[0]!.length).toBe(2);
    const bad = state.deck.splice(state.deck.findIndex(card => card.id === 'blue.8.0'), 1)[0]!;
    state.deck.push(bad);
    const skipped = game.applyAction(state, actor('a'), { type: 'draw' }, rng).state;
    expect(skipped.turn).toBe(1); expect(skipped.drawn).toBeNull();
  });
  it('applies final-card penalties before declaring winner and refuses post-game commands', () => {
    const { state, rng } = arranged([['red.draw2.0'], ['blue.3.0']]);
    const result = game.applyAction(state, actor('a'), play('red.draw2.0'), rng).state;
    expect(result.hands[1]!.length).toBe(3); expect(result.winners).toEqual(['a']);
    expect(game.getOutcome(result)).toEqual({ status: 'finished', winners: ['a'] });
    expect(() => game.applyAction(result, actor('a'), { type: 'draw' }, rng)).toThrow();
    expect(game.getView(result, viewer('a')).actions).toEqual([]);
  });
  it('reshuffles without moving the top card, handles exhausted draws and resolves stalemate', () => {
    const { state, rng } = arranged([['red.2.0'], ['blue.3.0']]);
    state.hands[1]!.push(...state.deck.splice(0));
    const recycled = state.hands[1]!.splice(state.hands[1]!.findIndex(card => card.id === 'red.9.0'), 1)[0]!;
    state.discard.unshift(recycled);
    const result = game.applyAction(state, actor('a'), { type: 'draw' }, rng).state;
    expect(result.discard).toEqual([state.discard[1]]);
    expect(result.drawn).toBe('red.9.0');
    state.discard.shift(); state.hands[1]!.push(recycled);
    let blocked = game.applyAction(state, actor('a'), { type: 'draw' }, rng).state;
    blocked = game.applyAction(blocked, actor('b'), { type: 'draw' }, rng).state;
    expect(blocked.winners).toEqual(['a']);
  });
  it('never exposes opponents hands, deck order or private events, and accepts JSONB key order', () => {
    const { state } = initial();
    const mine = game.getView(state, viewer('a'));
    expect(mine).not.toHaveProperty('deck'); expect(mine).not.toHaveProperty('hands');
    expect(mine.players[1]).toEqual({ seatId: 'b', count: 7 });
    expect(game.getView(state, { kind: 'spectator' }).hand).toEqual([]);
    expect(game.getView(state, viewer('intruder')).actions).toEqual([]);
    expect(game.projectEvents([{ type: 'private', card: state.deck[0] }], viewer('a'))).toEqual([]);
    const reordered = JSON.parse(JSON.stringify(state, (_key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).reverse());
      return value;
    }));
    expect(game.deserialize(reordered)).toEqual(state);
    const corrupt = structuredClone(state); corrupt.deck[0] = corrupt.deck[1]!;
    expect(() => game.deserialize(corrupt)).toThrow();
    const invalid = structuredClone(state);
    invalid.deck[0] = { id: '__proto__', color: 'red', value: '1' };
    expect(() => game.deserialize(invalid)).toThrow();
  });
  it('completes real legal-action games for 2/3/4 seats with restored private views after every turn', () => {
    for (const count of [2, 3, 4]) {
      const { rng, state: start } = initial(count, 42 + count);
      let state = start;
      for (let turn = 0; turn < 500 && !state.winners.length; turn++) {
        const seat = state.seats[state.turn]!;
        const view = game.getView(state, viewer(seat));
        const action = game.getFallbackAction(view, game.getActionSpec(state, viewer(seat)))!;
        game.validateAction(state, actor(seat), action);
        const result = game.applyAction(state, actor(seat), action, rng);
        const publicEvents = game.projectEvents(result.events, viewer(state.seats[(state.turn + 1) % count]!));
        expect(JSON.stringify(publicEvents)).not.toContain('hands');
        state = game.deserialize(game.serialize(result.state));
      }
      expect(state.winners.length).toBeGreaterThan(0);
      expect(game.getOutcome(state)).toHaveProperty('status', 'finished');
    }
  }, 30000);
});
