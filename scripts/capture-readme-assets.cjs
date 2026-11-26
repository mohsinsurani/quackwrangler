/*
 * Captures the README visuals from the real standalone React preview (never a mockup).
 *
 *   npm --prefix webview-ui run dev -- --host 127.0.0.1 --port 5199   (in another terminal)
 *   node scripts/capture-readme-assets.cjs
 *
 * Needs playwright-core's Chromium (`npx playwright-core install chromium-headless-shell`) and
 * ffmpeg on the PATH. Writes docs/assets/quackwrangler-overview.jpg and quackwrangler-demo.gif,
 * and leaves the individual frames in a temporary folder that is printed at the end.
 */
const { chromium } = require('playwright-core');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const URL = process.env.PREVIEW_URL || 'http://127.0.0.1:5199/';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/assets');
const FRAMES = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-frames-'));

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
  await page.goto(URL);
  await page.waitForSelector('.data-grid-footer', { timeout: 20000 });
  await page.locator('.profile-card').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);

  const shot = async (name) => {
    await page.waitForTimeout(500);
    const file = path.join(FRAMES, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };

  // 1. Default view: table switcher in the header, profiles with histograms, applied steps.
  await page.locator('.table-select').waitFor({ timeout: 10000 });
  const states = {};
  states.grid = await shot('1-grid');

  // 2. Nested-value inspector opened from a `metadata` STRUCT cell (the overview image).
  await page.locator('.metadata-badge').first().locator('..').click({ force: true });
  await page.locator('.nested-tree').waitFor({ timeout: 8000 });
  states.nested = await shot('2-nested');
  await page.keyboard.press('Escape');

  // 3. The Tools drawer on the multi-column Sort form.
  await page.locator('.workspace-actions button', { hasText: 'Transform' }).first().click();
  await page.locator('.operation-search').fill('Sort');
  await page.locator('.operation-btn', { hasText: 'Sort' }).first().click();
  await page.locator('.sort-key-row').first().waitFor({ timeout: 6000 });
  await page.locator('.sort-key-add').click();
  states.tools = await shot('3-tools');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // 4. The correlation heatmap in the Charts tab.
  await page.locator('.analysis-tabs button', { hasText: 'Charts' }).click();
  await page.locator('.chart-controls select').first().selectOption('correlation');
  await page.locator('.chart-controls button', { hasText: 'Create chart' }).click();
  await page.locator('.chart-canvas').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(1200);
  states.charts = await shot('4-charts');

  await browser.close();
  if (errors.length) throw new Error(`The preview raised errors: ${errors.join(' | ')}`);

  // Overview image: the nested inspector beside the grid.
  const ffmpeg = (args) => {
    const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
  };
  ffmpeg(['-i', states.nested, '-q:v', '3', path.join(OUT, 'quackwrangler-overview.jpg')]);

  // Demo GIF: 960x540, a palette built from the frames so colours stay clean, 2.2 s per state.
  const order = [states.grid, states.nested, states.tools, states.charts];
  const list = path.join(FRAMES, 'frames.txt');
  fs.writeFileSync(
    list,
    order.map((file) => `file '${file}'\nduration 2.2`).join('\n') + `\nfile '${order.at(-1)}'\n`,
  );
  ffmpeg([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    'scale=960:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop',
    '0',
    path.join(OUT, 'quackwrangler-demo.gif'),
  ]);

  const size = (file) => `${(fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0)} KB`;
  console.log(
    `Wrote quackwrangler-overview.jpg (${size('quackwrangler-overview.jpg')}) and quackwrangler-demo.gif (${size('quackwrangler-demo.gif')})`,
  );
  console.log(`Frames kept in ${FRAMES}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
