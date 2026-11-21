// Phone checks in Chromium device emulation: node tests/e2e/mobile.mjs --url http://localhost:8765/
// Real iOS Safari is NOT covered (only Chromium is installed here); these catch layout, touch and logic bugs.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright') } catch { return createRequire(execSync('npm root -g').toString().trim() + '/')('playwright') }
}
const { chromium, devices } = loadPlaywright();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const URL_ = arg('url', 'http://localhost:8765/'); const sep = URL_.includes('?') ? '&' : '?';
const POETTER = { latitude: 32.0786, longitude: -81.0925 };   // downtown Savannah, inside the map box
const SEOUL = { latitude: 37.5665, longitude: 126.978 };
const inView = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5 && r.width > 0 });

const browser = await chromium.launch();
let failed = 0;
async function run(name, ctxOpts, fn) {
  const ctx = await browser.newContext(ctxOpts); const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
  page.on('pageerror', e => errors.push(String(e)));
  const step = async (label, f) => { try { await f(); console.log(`ok   ${name} ${label}`) } catch (e) { failed++; console.log(`FAIL ${name} ${label}: ${e.message.split('\n')[0]}`) } };
  await step('loads', async () => {
    await page.goto(URL_ + sep + 'perf');
    await page.waitForFunction(() => window.__smash && __smash.PT.firstRender, null, { timeout: 180000, polling: 200 });
  });
  await fn(page, step, ctx);
  await step('no console errors', async () => assert.deepEqual(errors, []));
  await ctx.close();
}
const startAndCheck = async (page, step) => {
  await step('start button visible and tappable', async () => { assert.ok(await inView(page, '#go')); });
  await step('unofficial notice reachable by scrolling the intro', async () => {
    await page.$eval('#card .fine', el => el.scrollIntoView({ block: 'end' }));
    assert.ok(await inView(page, '#card .fine'));
    assert.match(await page.textContent('#card .fine'), /Unofficial fan game, not affiliated/);
  });
  await step('tap start', async () => { await page.tap('#go'); await page.waitForFunction(() => getComputedStyle(document.querySelector('#intro')).display === 'none') });
};

await run('iPhone13', { ...devices['iPhone 13'], permissions: ['geolocation'], geolocation: POETTER }, async (page, step) => {
  await startAndCheck(page, step);
  await step('shadows start off on a phone', async () => assert.equal(await page.evaluate(() => __smash.shadows()), false));
  await step('adaptive resolution: slow frames lower the pixel ratio (only asserted when frames really are slow)', async () => {
    const d0 = await page.evaluate(() => __smash.dpr()); assert.equal(d0, 2, 'starts at min(devicePixelRatio 3, 2)');
    await page.evaluate(() => __smash.rec(true)); await page.waitForTimeout(9000);
    const r = await page.evaluate(() => { __smash.rec(false); const F = __smash.FR; return { ms: (F[F.length - 1][0] - F[0][0]) / (F.length - 1), dpr: __smash.dpr() } });
    if (r.ms > 30) assert.ok(r.dpr < 2, JSON.stringify(r)); else assert.equal(r.dpr, 2, JSON.stringify(r));
    console.log('     frame', r.ms.toFixed(0), 'ms -> pixel ratio', r.dpr);
  });
  await step('all 6 weapon buttons fully on screen', async () => { for (const w of ['bomb', 'paint', 'pencil', 'meteor', 'quake', 'nuke']) assert.ok(await inView(page, `.wp[data-w="${w}"]`), w) });
  await step('HUD buttons at least 40x40', async () => {
    const s = await page.$$eval('.ib,.wp', b => b.map(x => { const r = x.getBoundingClientRect(); return [x.id || x.dataset.w, r.width, r.height] }));
    for (const [id, w, h] of s) if (w > 0) assert.ok(w >= 40 && h >= 40, `${id} ${w}x${h}`);
  });
  await step('score label not clipped', async () => assert.ok(await page.$eval('#meta', m => m.scrollWidth <= m.clientWidth + 1)));
  await step('OSM credit not covered by the hint', async () => {
    const [c, h] = await Promise.all(['#credit', '#hint'].map(s => page.$eval(s, el => { const r = el.getBoundingClientRect(); return [r.top, r.bottom, r.left, r.right] })));
    assert.ok(c[1] <= h[0] || c[0] >= h[1] || c[3] <= h[2] || c[2] >= h[3], `credit ${c} hint ${h}`);
  });
  await step('tap on the map fires the weapon', async () => {
    const d0 = await page.evaluate(() => __smash.dmg());
    const vp = page.viewportSize(); await page.touchscreen.tap(vp.width / 2, vp.height / 2);
    await page.waitForFunction(d => __smash.dmg() > d, d0, { timeout: 90000, polling: 100 });
  });
  await step('building list opens as a bottom sheet and search works', async () => {
    await page.tap('#lsb'); await page.waitForSelector('#list.open'); await page.waitForTimeout(400);
    const r = await page.$eval('#list', el => { const b = el.getBoundingClientRect(); return [b.left, b.bottom, b.width] });
    assert.ok(r[0] <= 1 && Math.abs(r[1] - page.viewportSize().height) <= 2 && r[2] >= page.viewportSize().width - 2, String(r));
    await page.fill('#q', 'Jen'); const names = await page.$$eval('#bl button span', s => s.map(x => x.textContent));
    assert.ok(names.includes('Jen Library'), names.join());
    await page.tap('#bl button'); await page.waitForFunction(() => !document.querySelector('#list').classList.contains('open'));
  });
  await step('GPS inside the map: marker at the right spot and camera flies there', async () => {
    await page.tap('#gps');
    await page.waitForFunction(() => __smash.me().visible, null, { timeout: 20000 });
    const m = await page.evaluate(() => __smash.me());
    const x = (POETTER.longitude + 81.0945) * Math.cos(32.0745 * Math.PI / 180) * 111320, z = -(POETTER.latitude - 32.0745) * 110574;
    assert.ok(Math.abs(m.x - x) < 1 && Math.abs(m.z - z) < 1, JSON.stringify(m));
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => __smash.target());
    assert.ok(Math.hypot(t.x - x, t.z - z) < 5, `camera target ${JSON.stringify(t)}`);
    assert.match(await page.textContent('#toast'), /You are here/);
    await page.tap('#gps'); assert.equal((await page.evaluate(() => __smash.me())).visible, false);
  });
  await step('WebGL context lost and restored: same picture, game keeps working', async () => {
    await page.waitForTimeout(2500);                       // let the camera settle after the GPS fly-to
    const before = await page.evaluate(() => __smash.probe());
    await page.evaluate(() => __smash.loseContext()); await page.waitForTimeout(600);
    await page.evaluate(() => __smash.restoreContext()); await page.waitForTimeout(1500);
    const after = await page.evaluate(() => __smash.probe());
    assert.ok(after.some(v => v > 0), 'blank after restore');
    const diff = Math.max(...after.map((v, i) => Math.abs(v - before[i])));
    assert.ok(diff <= 8, `pixels changed by ${diff}: ${before} vs ${after}`);
    const d0 = await page.evaluate(() => __smash.dmg());
    const vp = page.viewportSize(); await page.tap('.wp[data-w="bomb"]'); await page.touchscreen.tap(vp.width / 2, vp.height / 2 + 40);
    await page.waitForFunction(d => __smash.dmg() > d, d0, { timeout: 90000, polling: 100 });
  });
  await step('rebuild restores campus and trees', async () => {
    await page.tap('#rst'); const s = await page.evaluate(() => ({ a: __smash.alive(), n: __smash.nB(), d: __smash.dmg() }));
    assert.equal(s.a, s.n); assert.equal(s.d, 0);
  });
});

await run('iPhone13-landscape', { ...devices['iPhone 13 landscape'] }, async (page, step) => {
  await startAndCheck(page, step);
  await step('all 6 weapon buttons fully on screen', async () => { for (const w of ['bomb', 'paint', 'pencil', 'meteor', 'quake', 'nuke']) assert.ok(await inView(page, `.wp[data-w="${w}"]`), w) });
  await step('dock does not cover the HUD', async () => {
    const [d, t] = await Promise.all(['#dock', '#tools'].map(s => page.$eval(s, el => el.getBoundingClientRect().toJSON())));
    assert.ok(t.right <= d.left, `tools ${t.right} dock ${d.left}`);
  });
});

await run('Pixel7-outside-map', { ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: SEOUL }, async (page, step) => {
  await startAndCheck(page, step);
  await step('GPS far away: no marker, distance message', async () => {
    await page.tap('#gps'); await page.waitForFunction(() => document.querySelector('#toast').classList.contains('on'), null, { timeout: 20000 });
    assert.match(await page.textContent('#toast'), /km from the Savannah map/);
    assert.equal((await page.evaluate(() => __smash.me())).visible, false);
  });
});

await run('Pixel7-no-permission', { ...devices['Pixel 7'] }, async (page, step) => {
  await startAndCheck(page, step);
  await step('GPS permission denied: clear message, button off', async () => {
    await page.tap('#gps'); await page.waitForFunction(() => /declined|unavailable|in time/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
    assert.equal(await page.$eval('#gps', b => b.classList.contains('on')), false);
  });
});

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
