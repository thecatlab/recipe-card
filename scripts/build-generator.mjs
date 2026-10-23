// Regenerates recipe-generator.html (the standalone blank generator) from the current source:
// starts the Vite dev server, opens a blank recipe in a fresh headless browser and clicks Save HTML,
// which is the same export the README describes doing by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function launch(chromium) {
  try { return await chromium.launch(); } catch (error) {
    // Cloud sandboxes ship a Chromium that may not match the installed Playwright version.
    if (fs.existsSync('/opt/pw-browsers/chromium')) return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    throw error;
  }
}

export async function buildGenerator(output = path.join(root, 'recipe-generator.html')) {
  const { chromium } = await import('playwright');
  const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
  await server.listen();
  const browser = await launch(chromium);
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.recipeGeneratorSource && document.querySelector('#entry-table table'));
    if (errors.length) throw new Error('The app failed to start: ' + errors.join('; '));
    const download = page.waitForEvent('download');
    await page.click('#export-html');
    await (await download).saveAs(output);
  } finally {
    await browser.close();
    await server.close();
  }
  return output;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Wrote ' + path.relative(process.cwd(), await buildGenerator()));
}
