import { mkdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { buildUnoPackage, unoEditions } from './uno-package.mjs';

const editions = process.argv.slice(2);
if (!editions.length) editions.push(...Object.keys(unoEditions));
for (const edition of editions) {
  if (!Object.hasOwn(unoEditions, edition)) throw new Error(`Unknown UNO edition: ${edition}`);
}
const output = new URL('../dist/game-packages/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const edition of editions) {
    const { filename, bytes } = await buildUnoPackage(edition, browser);
    await writeFile(new URL(filename, output), bytes);
    console.log(`UNO ${edition}: ${filename} (${bytes.length} bytes)`);
  }
} finally {
  await browser.close();
}
