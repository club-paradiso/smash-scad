// Browser smoke test: node tests/e2e/smoke.mjs --url http://localhost:8765/ [--shots dir]
// Checks at 1280x800 and 390x844: map loads, all 6 weapons do damage, building list + search,
// rebuild button, and no console errors. Uses the page's ?perf hook (window.__smash) to read game state.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright') } catch { return createRequire(execSync('npm root -g').toString().trim() + '/')('playwright') }
}
const { chromium } = loadPlaywright();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const URL_ = arg('url', 'http://localhost:8765/'), SHOTS = arg('shots', '');
const sep = URL_.includes('?') ? '&' : '?';
// --cdn DIR: answer the old CDN script URLs (three@0.147.0 on jsDelivr) from local copies of the same files,
// for networks where jsDelivr is blocked. DIR holds three.min.js and OrbitControls.js.
const CDN = arg('cdn', '');
async function routeCdn(page) {
  if (!CDN) return;
  await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => {
    const f = r.request().url().endsWith('OrbitControls.js') ? 'OrbitControls.js' : 'three.min.js';
    r.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(`${CDN}/${f}`) });
  });
}
const WEAPONS = ['bomb', 'paint', 'pencil', 'meteor', 'quake', 'nuke'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
let failed = 0;
for (const [w, h, mobile] of [[1280, 800, false], [390, 844, true]]) {
  const tag = `${w}px`, errors = [];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
  page.on('pageerror', e => errors.push(String(e)));
  await routeCdn(page);
  const step = async (name, fn) => {
    try { await fn(); console.log(`ok   ${tag} ${name}`) } catch (e) { failed++; console.log(`FAIL ${tag} ${name}: ${e.message.split('\n')[0]}`) }
  };
  await step('loads map', async () => {
    // shadows off: with them, SwiftShader at 1280 px runs ~2 FPS, and Playwright sends mouse-up only after mouse-down
    // has been handled, so the press lasts a whole frame (>450 ms) and stops counting as a tap. Real taps carry
    // hardware timestamps and are not affected; the game also drops shadows by itself when frames are that slow.
    await page.goto(URL_ + sep + 'perf&shadows=0');
    await page.waitForFunction(() => window.__smash && __smash.PT.firstRender, null, { timeout: 180000, polling: 200 });
    assert.equal(await page.textContent('#go'), 'Start smashing');
    assert.match(await page.textContent('#load'), /4,497 buildings, 71 SCAD/);
    assert.match(await page.textContent('#credit'), /OpenStreetMap contributors \(ODbL\)/);
    assert.match(await page.textContent('#card .fine'), /Unofficial fan game, not affiliated/);
    await page.click('#go');
    await page.waitForTimeout(800);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-loaded.png` });
  });
  await step('aerial photo tiles load (ground + roofs)', async () => {
    await page.waitForFunction(() => __smash.aerial().loaded >= 10, null, { timeout: 90000, polling: 250 });
    const a = await page.evaluate(() => __smash.aerial());
    assert.equal(a.tiles, 56);
  });
  await step('real names on the map: SCAD buildings and Savannah squares', async () => {
    await page.waitForFunction(() => __smash.labels().length > 3, null, { timeout: 30000 });
    const names = await page.evaluate(() => __smash.labels());
    const scad = await page.$$eval('#labels .lb.scad', e => e.filter(x => x.style.display !== 'none').map(x => x.textContent));
    assert.ok(scad.length >= 3, `SCAD tags: ${scad}`);
    assert.ok(names.some(n => / Square$|Park$/.test(n)), `no square/park in ${names}`);
    const hud = await page.$eval('#top', e => e.getBoundingClientRect().bottom);
    const tops = await page.$$eval('#labels .lb', e => e.filter(x => x.style.display !== 'none').map(x => x.getBoundingClientRect().top));
    assert.ok(tops.every(t => t >= hud - 1), 'a label sits under the top HUD');
  });
  for (const id of WEAPONS) await step(`weapon ${id}`, async () => {
    await page.click(`.wp[data-w="${id}"]`);
    assert.ok(await page.$eval(`.wp[data-w="${id}"]`, b => b.classList.contains('on')));
    const d0 = await page.evaluate(() => __smash.dmg());
    // a real tap on the canvas (via the same pointer path the player uses), at the screen centre
    const box = await page.$eval('canvas#c', c => { const r = c.getBoundingClientRect(); return [r.width / 2, r.height / 2] });
    await page.mouse.move(box[0], box[1]); await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction(d => __smash.dmg() > d, d0, { timeout: 90000, polling: 100 });
    if (SHOTS && (id === 'paint' || id === 'nuke')) await page.screenshot({ path: `${SHOTS}/${tag}-${id}.png` });
  });
  await step('blasts knock down lidar tree crowns', async () => {
    const c = await page.evaluate(() => __smash.canopy());
    assert.ok(c.n > 10000, `crowns ${c.n}`); assert.ok(c.down > 0, 'no crown knocked down by the weapons');
  });
  await step('rank and score update', async () => {
    assert.notEqual(await page.textContent('#score'), '0');
    assert.match(await page.textContent('#lev'), /^\d+\/71$/);
  });
  await step('building list + search', async () => {
    await page.click('#lsb');
    await page.waitForSelector('#list.open');
    const n = await page.$$eval('#bl button', b => b.length);
    assert.ok(n > 30, `list has ${n}`);
    await page.fill('#q', 'Poetter');
    const names = await page.$$eval('#bl button span', s => s.map(x => x.textContent));
    assert.deepEqual(names, ['Poetter Hall']);
    await page.click('#bl button');
    if (!mobile) await page.click('#lsx');
    await page.waitForFunction(() => !document.querySelector('#list').classList.contains('open'));
  });
  await step('rebuild button restores campus', async () => {
    await page.waitForTimeout(500);
    await page.click('#rst');
    const s = await page.evaluate(() => ({ alive: __smash.alive(), n: __smash.nB(), dmg: __smash.dmg() }));
    assert.equal(s.alive, s.n); assert.equal(s.dmg, 0);
    assert.equal((await page.evaluate(() => __smash.canopy())).down, 0, 'crowns stand again after rebuild');
    assert.equal(await page.textContent('#score'), '0');
    assert.equal(await page.textContent('#lev'), '0/71');
  });
  await step('no console errors', async () => { assert.deepEqual(errors, []) });
  await page.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
