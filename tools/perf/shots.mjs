// Screenshots for before/after comparisons: node tools/perf/shots.mjs --url URL --out DIR [--cdn DIR]
// static: the opening view; damaged: fixed damage + paint on 400 buildings (deterministic);
// particles: a paint bomb mid-explosion (random, compare by eye).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright') } catch { return createRequire(execSync('npm root -g').toString().trim() + '/')('playwright') }
}
const { chromium } = loadPlaywright();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const URL_ = arg('url', 'http://localhost:8765/'), OUT = arg('out', 'shots'), CDN = arg('cdn', '');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (CDN) await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'application/javascript',
    body: readFileSync(`${CDN}/${r.request().url().endsWith('OrbitControls.js') ? 'OrbitControls.js' : 'three.min.js'}`) }));
  await page.goto(URL_ + (URL_.includes('?') ? '&' : '?') + 'perf');
  await page.waitForFunction(() => window.__smash && __smash.PT.firstRender, null, { timeout: 180000, polling: 200 });
  await page.click('#go'); await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${w}-static.png` });
  await page.evaluate(() => { const P = [0xff4b3e, 0x3fa9ff, 0x2bd47d, 0xff7ad9]; for (let k = 0; k < 400; k++) __smash.hitK(k * 11 % __smash.nB(), 30, k % 3 ? 0 : P[k % 4]) });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${w}-damaged.png` });
  const d0 = await page.evaluate(() => __smash.dmg());
  await page.evaluate(() => { const t = __smash.target(); __smash.fireAt('paint', t.x, t.z) });
  await page.waitForFunction(d => __smash.dmg() > d, d0, { timeout: 90000, polling: 50 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${w}-particles.png` });
  await page.close();
}
await browser.close();
console.log('saved to', OUT);
