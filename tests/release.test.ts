import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { it } from 'vitest';
import { readGamePackage } from '../apps/api/src/catalog/game-package.js';
import { PackageRuntime } from '../apps/api/src/registry/package-runtime.js';
import { DeterministicRng } from '../packages/game-sdk/src/index.js';

it('validates built ZIPs in the platform runtime and prepares exact-version release assets', async () => {
  const root = new URL('../', import.meta.url);
  const config = JSON.parse(await readFile(new URL('release.config.json', root), 'utf8'));
  const origin = JSON.parse(await readFile(new URL('SOURCE.json', root), 'utf8'));
  const output = new URL('dist/release/', root);
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
  const runtime = await PackageRuntime.create();
  const releases = [];
  const seen = new Set();
  const archives = (await readdir(new URL('dist/game-packages/', root)))
    .filter((name) => name.endsWith('.zip'))
    .sort();
  assert.equal(
    archives.length,
    config.assets.length,
    'build must contain exactly the configured packages',
  );
  for (const filename of archives) {
    const bytes = await readFile(new URL(`dist/game-packages/${filename}`, root));
    const parsed = readGamePackage(bytes);
    const game = runtime.extension(parsed.server);
    const asset = config.assets.find((item: { id: string }) => item.id === game.manifest.id);
    assert.ok(asset, `unregistered game: ${game.manifest.id}`);
    assert.ok(!seen.has(asset.id), 'duplicate game');
    seen.add(asset.id);
    assert.equal(filename, `${asset.archive}-${game.manifest.version}.zip`);
    for (const count of new Set([game.manifest.players.min, game.manifest.players.max])) {
      const seats = Array.from({ length: count }, (_, index) => `seat-${index + 1}`);
      const options = game.validateOptions({});
      const { state, events } = game.setup({ seats, options, rng: new DeterministicRng(42) });
      assert.deepEqual(game.deserialize(game.serialize(state)), state);
      game.getOutcome(state);
      for (const seatId of seats) {
        const viewer = { kind: 'seat' as const, seatId };
        const view = game.getView(state, viewer);
        const spec = game.getActionSpec(state, viewer);
        game.projectEvents(events, viewer);
        const decision = game.getDecisionContext?.(state, viewer);
        const action = game.getDecisionContext
          ? decision?.legalActions[0]
          : game.getFallbackAction(view, spec);
        if (action != null) {
          const actor = { kind: 'seat' as const, seatId, controllerEpoch: 0 };
          game.validateAction(state, actor, game.parseAction(action));
          const result = game.applyAction(state, actor, action, new DeterministicRng(42));
          assert.deepEqual(game.deserialize(game.serialize(result.state)), result.state);
        }
      }
    }
    const expectedTag = `${asset.archive}-v${game.manifest.version}`;
    if (tag && tag !== expectedTag) continue;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    releases.push({
      bytes,
      gameId: game.manifest.id,
      version: game.manifest.version,
      filename,
      sha256,
      tag: expectedTag,
    });
  }
  assert.ok(releases.length, `tag does not match any built game version: ${tag}`);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const asset of releases) await writeFile(new URL(asset.filename, output), asset.bytes);
  await writeFile(
    new URL('release.json', output),
    JSON.stringify(
      {
        repository: config.repository,
        commit: process.env.GITHUB_SHA ?? null,
        compatibilitySource: origin.commit,
        packages: releases.map((asset) => ({
          gameId: asset.gameId,
          version: asset.version,
          filename: asset.filename,
          sha256: asset.sha256,
          tag: asset.tag,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    new URL('SHA256SUMS', output),
    releases.map((asset) => `${asset.sha256}  ${asset.filename}\n`).join(''),
  );
}, 30000);
