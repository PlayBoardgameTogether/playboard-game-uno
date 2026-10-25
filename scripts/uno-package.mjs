import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const base = new URL('../game-packages/uno/', import.meta.url);
export const unoEditions = JSON.parse(await readFile(new URL('editions.json', base), 'utf8'));

// Editions own their rules and immutable identity; the platform sees ordinary ZIP games.
export async function unoPackageFiles(edition = 'casual') {
  if (!Object.hasOwn(unoEditions, edition)) throw new Error(`Unknown UNO edition: ${edition}`);
  const config = unoEditions[edition];
  const directory = new URL(`${config.directory}/`, base);
  return {
    'game.json': await readFile(new URL('game.json', directory)),
    'server.js': await readFile(new URL('server.txt', directory)),
    'client.html': await readFile(new URL(config.client, base)),
  };
}

export function unoArchive(files) {
  return zipSync(files, { mtime: new Date('2026-10-24T00:00:00Z'), level: 9 });
}

export async function buildUnoPackage(edition, browser) {
  const files = await unoPackageFiles(edition);
  const config = unoEditions[edition];
  const descriptor = JSON.parse(files['game.json'].toString());
  descriptor.presentation = {};
  for (const [kind, source, width, height] of [
    ['icon', 'icon.svg', 256, 256], ['cover', 'cover.svg', 1200, 675], ['background', 'cover.svg', 1200, 675],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    try {
      const svg = await readFile(new URL(`${config.directory}/${config.art}/${source}`, base), 'utf8');
      await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
      const png = await page.screenshot({ type: 'png' });
      if (png.length > 320 * 1024) throw new Error(`${edition} ${kind} exceeds artwork limit`);
      descriptor.presentation[kind] = `data:image/png;base64,${png.toString('base64')}`;
    } finally {
      await page.close();
    }
  }
  files['game.json'] = Buffer.from(JSON.stringify(descriptor));
  const version = files['server.js'].toString().match(/\bversion:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/)?.[1];
  if (!version) throw new Error(`Missing version in ${edition}`);
  return { filename: `${config.archive}-${version}.zip`, bytes: unoArchive(files) };
}
