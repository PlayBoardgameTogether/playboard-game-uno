import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Viewer = { kind: 'seat'; seatId: string } | { kind: 'spectator' };
export type Actor = { kind: 'seat'; seatId: string; controllerEpoch: number } | { kind: 'system'; purpose: string };
export type RngState = { algorithm: 'mulberry32-v1'; state: number };
export interface RandomSource { nextInt(minInclusive: number, maxExclusive: number): number; snapshot(): RngState; clone(): RandomSource }

export class DeterministicRng implements RandomSource {
  constructor(private state: number) { this.state >>>= 0; }
  nextInt(min: number, max: number) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) throw new Error('Invalid RNG range');
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return min + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min));
  }
  snapshot(): RngState { return { algorithm: 'mulberry32-v1', state: this.state }; }
  clone() { return new DeterministicRng(this.state); }
  static restore(value: unknown) { const s = z.object({ algorithm: z.literal('mulberry32-v1'), state: z.number().int().nonnegative().max(0xffffffff) }).strict().parse(value); return new DeterministicRng(s.state); }
}

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/).max(128), version: z.string().regex(/^\d+\.\d+\.\d+$/), sdkRange: z.string().min(1).max(32), contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1).max(80), description: z.string().min(1).max(500), players: z.object({ min: z.number().int().min(1).max(20), max: z.number().int().min(1).max(20) }).strict(),
  mode: z.literal('rules-driven'), capabilities: z.array(z.enum(['private-view', 'turn-based', 'simultaneous', 'spatial'])).max(16),
  defaultAssetPack: z.object({ id: z.string().min(1).max(128), version: z.string() }).strict(), developmentOnly: z.boolean(),
}).strict().superRefine((m, ctx) => { if (m.players.min > m.players.max) ctx.addIssue({ code: 'custom', message: 'players.min must be <= players.max' }); });
export type GameManifest = z.infer<typeof manifestSchema>;
export type ScopedEvent<T> = { scope: 'public' } | { scope: 'seat'; seatId: string; payload: T };

export interface GameExtension<State, Options, Action, View, InternalEvent, PublicEvent> {
  manifest: GameManifest;
  validateOptions(value: unknown): Options;
  parseAction(value: unknown): Action;
  setup(input: { seats: string[]; options: Options; rng: RandomSource }): { state: State; events: InternalEvent[] };
  getView(state: State, viewer: Viewer): View;
  getActionSpec(state: State, viewer: Viewer): Json;
  validateAction(state: State, actor: Actor, action: Action): void;
  applyAction(state: State, actor: Actor, action: Action, rng: RandomSource): { state: State; events: InternalEvent[] };
  projectEvents(events: InternalEvent[], viewer: Viewer): PublicEvent[];
  getOutcome(state: State): Json;
  serialize(state: State): Json;
  deserialize(value: unknown): State;
  getFallbackAction(view: View, actionSpec: Json): Action | null;
  /** Returns a complete, private-view-safe decision for the current snapshot, or null when this seat must wait. */
  getDecisionContext?(state: State, viewer: Viewer): { decisionKey: string; legalActions: Action[] } | null;
}

export const assetManifestSchema = z.object({
  id: z.string().min(1).max(128), version: z.string(), language: z.string().min(2).max(16),
  assets: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), id: z.string(), file: z.string(), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']), width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192), source: z.string().optional(), license: z.string().optional() }).strict(),
    z.object({ kind: z.literal('sound'), id: z.string(), file: z.string(), mediaType: z.enum(['audio/mpeg', 'audio/wav']), durationMs: z.number().int().positive().max(15000), source: z.string().optional(), license: z.string().optional() }).strict(),
  ])).max(1000),
}).strict().superRefine((v, ctx) => { for (const [i, a] of v.assets.entries()) if (/^(?:[a-z]+:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(a.file)) ctx.addIssue({ code: 'custom', path: ['assets', i, 'file'], message: 'asset path must be relative and cannot contain ..' }); });

export const soundMapSchema = z.record(z.string().min(1).max(128), z.object({ soundId: z.string(), channel: z.enum(['game', 'ui']), gain: z.number().min(0).max(1), cooldownMs: z.number().int().min(0).max(60000), priority: z.number().int().min(0).max(10), maxConcurrent: z.number().int().min(1).max(8) }).strict());
export function validateSoundReferences(manifest: z.infer<typeof assetManifestSchema>, mapping: z.infer<typeof soundMapSchema>) { const sounds = new Set(manifest.assets.filter(a => a.kind === 'sound').map(a => a.id)); for (const [event, value] of Object.entries(mapping)) if (!sounds.has(value.soundId)) throw new Error(`Sound mapping ${event} references missing sound ${value.soundId}`); }

export interface AudioPort { unlock(): Promise<void>; play(eventType: string, eventId: string): Promise<void>; setPreferences(value: { muted: boolean; master: number; game: number; ui: number }): void; stopAll(): void; dispose(): void }
export interface StorageAdapter { put(key: string, data: Uint8Array, metadata: { mediaType: string }): Promise<void>; get(key: string): Promise<{ data: Uint8Array; mediaType: string } | null>; delete(key: string): Promise<void> }
export type Controller = { type: 'human' | 'script' | 'model'; controllerEpoch: number };
export type DecisionInput<View = Json, Action = Json> = { matchId: string; seatId: string; revision: number; decisionId: string; controllerEpoch: number; view: View; legalActions: readonly Action[]; actionSpec: Json; publicRules: string };
export type DecisionResult<Action = Json> = { action: Action; explanation?: string; usage?: { inputTokens?: number; outputTokens?: number } };
export interface DecisionProvider<View = Json, Action = Json> { decide(input: DecisionInput<View>, signal: AbortSignal): Promise<DecisionResult<Action>> }
