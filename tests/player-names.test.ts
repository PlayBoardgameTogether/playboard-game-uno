import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { it } from 'vitest';
import { readGamePackage } from '../apps/api/src/catalog/game-package.js';
import { PackageRuntime } from '../apps/api/src/registry/package-runtime.js';
import { DeterministicRng } from '../packages/game-sdk/src/index.js';

it('renders public player names safely, updates metadata, and keeps anonymous fallback', async () => {
  const browser = await chromium.launch();
  try {
    const runtime = await PackageRuntime.create();
    const files = (await readdir('dist/game-packages')).filter(file => file.endsWith('.zip'));
    await mkdir('test-results/player-names', { recursive: true });
    for (const file of files) {
      const parsed = readGamePackage(await readFile('dist/game-packages/' + file));
      const game = runtime.extension(parsed.server);
      const seats = Array.from({ length: game.manifest.players.min }, (_, i) => 'name-seat-' + i);
      const state = game.setup({ seats, options: game.validateOptions({}), rng: new DeterministicRng(42) }).state;
      const view = game.getView(state, { kind: 'seat', seatId: seats[0]! });
      for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://names.test/**', route => route.fulfill({
          contentType: 'text/html', body: route.request().url().endsWith('/desktop')
            ? parsed.client : '<iframe sandbox="allow-scripts" src="/desktop" style="border:0;width:100%;height:850px"></iframe>',
        }));
        await page.goto('http://names.test/');
        const frame = page.frameLocator('iframe');
        const own = '小明';
        const other = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
        const names = Object.fromEntries(seats.map((seat, i) => [seat, i === 0 ? own : i === 1 ? other : '电脑 ' + i]));
        const publish = async (playerNames?: Record<string, string>) => {
          await page.evaluate(data => {
            document.querySelector('iframe')!.contentWindow!.postMessage(data, '*');
          }, { type: 'boardgame:view', view, busy: false, events: [], playerNames });
        };
        await publish(names);
        await expect(frame.locator('body')).toContainText('小明（你）');
        await expect(frame.locator('body')).toContainText(other);
        await page.screenshot({ path: 'test-results/player-names/' + file + '-' + width + '.png', fullPage: true });
        const hostile = '<img src=x onerror=alert(1)>';
        await publish({ ...names, [seats[1]!]: hostile });
        await expect(frame.locator('body')).toContainText(hostile);
        assert.equal(await frame.locator('img[onerror]').count(), 0);
        await expect(frame.locator('body')).not.toContainText(other);
        // Metadata-only changes and historical replay frames use the same name mapping.
        await page.evaluate(data => {
          document.querySelector('iframe')!.contentWindow!.postMessage(data, '*');
        }, { type: 'boardgame:view', view, busy: true, events: [], playerNames: names, replay: { id: 1, animate: false } });
        await expect(frame.locator('body')).toContainText(other);
        await publish();
        await expect(frame.locator('body')).not.toContainText(own);
        await expect(frame.locator('body')).not.toContainText(other);
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 120_000);
