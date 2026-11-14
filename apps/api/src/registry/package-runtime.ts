import { getQuickJS, type QuickJSWASMModule } from 'quickjs-emscripten';
import { manifestSchema, type GameExtension, type Json, type RandomSource } from '@boardgame/game-sdk';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { invalidPackagePublicResult, packagePublicResult } from './package-public-result.js';

const transition = z.object({ state: z.json(), events: z.array(z.json()).max(1000) }).strict();
const decisionContextSchema = z.object({
  decisionKey: z.string().min(1).max(256),
  legalActions: z.array(z.json()).min(1).max(1000),
}).strict().nullable();
const methods = ['validateOptions', 'parseAction', 'setup', 'getView', 'getActionSpec',
  'validateAction', 'applyAction', 'projectEvents', 'getOutcome', 'serialize', 'deserialize', 'getFallbackAction'];

/** No host objects/callbacks, imports, filesystem, clock, network or Node APIs enter this VM. */
export class PackageRuntime {
  private constructor(private readonly engine: QuickJSWASMModule) {}
  static async create() { return new PackageRuntime(await getQuickJS()); }

  private evaluate(source: string, expression: string, maxBytes = 256 * 1024): Json {
    const runtime = this.engine.newRuntime();
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);
    const deadline = Date.now() + 100;
    runtime.setInterruptHandler(() => Date.now() > deadline);
    const context = runtime.newContext();
    try {
      const result = context.evalCode(`
        globalThis.Date = undefined;
        Math.random = () => { throw new Error('Use injected RNG'); };
        ${source}\n;
        JSON.stringify(${expression})
      `);
      if (result.error) {
        result.error.dispose();
        throw new AppError('ACTION_NOT_ALLOWED', '游戏包规则执行失败或超过资源限制', 422);
      }
      let encoded: string;
      try { encoded = context.getString(result.value); }
      finally { result.value.dispose(); }
      if (Buffer.byteLength(encoded) > maxBytes) {
        if (maxBytes < 256 * 1024) throw invalidPackagePublicResult();
        throw new AppError('VALIDATION_ERROR', '游戏规则结果超过 256 KiB', 422);
      }
      return z.json().parse(JSON.parse(encoded));
    } finally {
      context.dispose();
      runtime.dispose();
    }
  }

  publicResult(source: string) {
    if (this.evaluate(source, "typeof game.getPublicResult === 'function'") !== true) {
      throw new AppError('VALIDATION_ERROR', '游戏包缺少公开结果方法', 400);
    }
    return (outcome: unknown, seats: string[]) => {
      // Do not use the generic call: undefined must never become an explicit null.
      // Validate JSON types before serialization can erase undefined/NaN or call toJSON.
      let output: Json;
      try {
        output = this.evaluate(
          source,
          `(() => {
        const value = game.getPublicResult(${JSON.stringify(outcome)});
        const plain = object => object !== null && typeof object === 'object' &&
          (Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null);
        if (value === null) return { valid: true, value: null };
        if (!plain(value) || Reflect.ownKeys(value).some(key => !['winners', 'scores'].includes(key)) ||
          !Array.isArray(value.winners) || value.winners.length < 1 || value.winners.length > 20 ||
          Array.from(value.winners).some(id => typeof id !== 'string') ||
          (Object.hasOwn(value, 'scores') && (!plain(value.scores) ||
            Object.values(value.scores).some(score => typeof score !== 'number' || !Number.isFinite(score))))) {
          return { valid: false };
        }
        return { valid: true, value };
        })()`,
          16 * 1024,
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw invalidPackagePublicResult();
      }
      const parsed = z
        .object({ valid: z.literal(true), value: z.json() })
        .strict()
        .safeParse(output);
      if (!parsed.success) throw invalidPackagePublicResult();
      return packagePublicResult(parsed.data.value, seats);
    };
  }

  extension(source: string) {
    const manifest = manifestSchema.parse(this.evaluate(source, 'game.manifest'));
    if (manifest.developmentOnly || !manifest.sdkRange.startsWith('^0.1.')) {
      throw new AppError('VALIDATION_ERROR', '游戏包必须是兼容 ^0.1 SDK 的正式游戏', 400);
    }
    if (this.evaluate(source, `${JSON.stringify(methods)}.every(key => typeof game[key] === 'function')`) !== true) {
      throw new AppError('VALIDATION_ERROR', '游戏包缺少必需规则方法', 400);
    }
    const call = (method: string, args: unknown[]) => this.evaluate(source,
      `(() => { const value = game[${JSON.stringify(method)}](...${JSON.stringify(args)}); return value === undefined ? null : value; })()`);
    const convert = (method: 'setup' | 'applyAction', args: unknown[], rng: RandomSource) => {
      const output = z.object({ value: transition, draws: z.number().int().min(0).max(10000) }).strict().parse(
        this.evaluate(source, `(() => {
          let seed = ${rng.snapshot().state}, draws = 0;
          const rng = { nextInt(min, max) {
            if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min || ++draws > 10000) throw new Error('Invalid RNG');
            seed = (seed + 0x6d2b79f5) >>> 0;
            let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return min + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min));
          }};
          const args = ${JSON.stringify(args)};
          ${method === 'setup' ? 'args[0].rng = rng;' : 'args.push(rng);'}
          return { value: game.${method}(...args), draws };
        })()`));
      // Advance only after a successful result. The caller owns the transactional RNG clone.
      for (let i = 0; i < output.draws; i++) rng.nextInt(0, 1);
      return output.value;
    };
    const extension: GameExtension<Json, Json, Json, Json, Json, Json> = {
      manifest,
      validateOptions: value => call('validateOptions', [value]),
      parseAction: value => call('parseAction', [value]),
      setup: ({ seats, options, rng }) => convert('setup', [{ seats, options }], rng),
      getView: (state, viewer) => call('getView', [state, viewer]),
      getActionSpec: (state, viewer) => call('getActionSpec', [state, viewer]),
      validateAction: (state, actor, action) => { call('validateAction', [state, actor, action]); },
      applyAction: (state, actor, action, rng) => convert('applyAction', [state, actor, action], rng),
      projectEvents: (events, viewer) => z.array(z.json()).max(1000).parse(call('projectEvents', [events, viewer])),
      getOutcome: state => call('getOutcome', [state]),
      serialize: state => call('serialize', [state]),
      deserialize: state => call('deserialize', [state]),
      getFallbackAction: (view, spec) => call('getFallbackAction', [view, spec]),
    };
    if (this.evaluate(source, "typeof game.getDecisionContext === 'function'") === true) {
      extension.getDecisionContext = (state, viewer) =>
        decisionContextSchema.parse(call('getDecisionContext', [state, viewer]));
    }
    return extension;
  }
}
