// Perf harness: node tools/perf/measure.mjs --url http://localhost:8765/ --label baseline [--runs 3] [--w 1280 --h 800]
// Needs the page's ?perf hook (window.__smash). Runs in headless Chromium; on a machine without a GPU
// that is SwiftShader (software), so FPS here is NOT real-device performance.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright') } catch { return createRequire(execSync('npm root -g').toString().trim() + '/')('playwright') }
}
const { chromium } = loadPlaywright();
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d };
const URL_ = arg('url', 'http://localhost:8765/'), LABEL = arg('label', 'run'), RUNS = +arg('runs', 3);
const W = +arg('w', 1280), H = +arg('h', 800), OUT = arg('out', 'docs/perf-data');
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

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN };
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
function frameStats(FR) {
  if (FR.length < 2) return { frames: FR.length };
  const span = FR[FR.length - 1][0] - FR[0][0];
  return { frames: FR.length, fps: r2((FR.length - 1) / span * 1000), js_med: r2(med(FR.map(f => f[1]))), js_p95: r2(pct(FR.map(f => f[1]), .95)),
    render_med: r2(med(FR.map(f => f[2]))), render_p95: r2(pct(FR.map(f => f[2]), .95)), render_max: r2(Math.max(...FR.map(f => f[2]))) };
}

const browser = await chromium.launch();
const env = { browser: 'Chromium ' + browser.version() + ' (Playwright, headless)', viewport: `${W}x${H} @1x` };
const errors = [];
async function open() {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
  page.on('pageerror', e => errors.push(String(e)));
  await routeCdn(page);
  await page.goto(URL_ + sep + 'perf', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__smash && window.__smash.PT.firstRender, null, { timeout: 180000, polling: 100 });
  if (!env.gl) env.gl = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL) });
  return page;
}
async function startGame(page) { await page.click('#go'); await page.waitForTimeout(1500) }
async function record(page, ms) { await page.evaluate(() => __smash.rec(true)); await page.waitForTimeout(ms); return page.evaluate(() => { __smash.rec(false); return __smash.FR.slice() }) }

const ONLY = arg('only', '');
const res = { load: [], idle: [], pick: [], nuke: [], quake: [], upload: [] };
for (let run = 0; run < RUNS; run++) {
  // upload micro-benchmark (synchronised frame time in a 128x80 canvas, so rasterisation is negligible)
  { const page = await open(); await startGame(page);
    const b = await page.evaluate(() => [0, 1, 200, 4497].map(n => __smash.bench(n)));
    res.upload.push({ clean_ms: r2(b[0]), dirty1_ms: r2(b[1]), dirty200_ms: r2(b[2]), dirty_all_ms: r2(b[3]) });
    await page.close(); }
  if (ONLY === 'upload') { process.stderr.write(`run ${run + 1}/${RUNS} done\n`); continue }
  // load + idle + pick
  let page = await open();
  const PT = await page.evaluate(() => __smash.PT);
  res.load.push({ fetch_ms: r1(PT.fetched - PT.fetchStart), ground_ms: r1(PT.ground - PT.fetched), city_ms: r1(PT.city - PT.ground), extra_init_ms: r1(PT.extraInit || 0),
    first_render_ms: r1(PT.firstRender - PT.city), first_render_call_ms: r1(PT.firstRenderCall), total_ms: r1(PT.firstRender) });
  await startGame(page);
  const info = await page.evaluate(() => __smash.info());
  res.idle.push({ ...frameStats(await record(page, 5000)), ...info });
  const picks = await page.evaluate(([w, h]) => { const out = []; for (let i = 0; i < 20; i++) for (let j = 0; j < 10; j++) out.push(__smash.pick((i + .5) / 20 * w, (j + .5) / 10 * h)); return out }, [W, H]);
  res.pick.push({ n: picks.length, hit_building: picks.filter(p => p.k >= 0).length, med_ms: r2(med(picks.map(p => p.ms))), p95_ms: r2(pct(picks.map(p => p.ms), .95)), max_ms: r2(Math.max(...picks.map(p => p.ms))) });
  await page.close();
  // nuke: record 4 s of wall time from the frame the blast lands
  page = await open(); await startGame(page);
  const a0 = await page.evaluate(() => __smash.alive());
  await page.evaluate(() => { const t = __smash.target(); __smash.fireAt('nuke', t.x, t.z) });
  await page.waitForFunction(a => __smash.alive() < a, a0, { timeout: 120000, polling: 16 });
  const FRn = await record(page, 4000);
  res.nuke.push({ ...frameStats(FRn), killed: a0 - await page.evaluate(() => __smash.alive()) });
  await page.close();
  // quake: record 4 s of wall time from the trigger
  page = await open(); await startGame(page);
  const a1 = await page.evaluate(() => __smash.alive());
  await page.evaluate(() => { const t = __smash.target(); __smash.fireAt('quake', t.x, t.z) });
  const FRq = await record(page, 4000);
  res.quake.push({ ...frameStats(FRq), killed: a1 - await page.evaluate(() => __smash.alive()) });
  await page.close();
  process.stderr.write(`run ${run + 1}/${RUNS} done\n`);
}
await browser.close();

const summary = {};
for (const [k, rows] of Object.entries(res)) {
  if (!rows.length) continue;
  summary[k] = {};
  for (const key of Object.keys(rows[0])) { const v = rows.map(r => r[key]).filter(x => typeof x === 'number'); if (v.length) summary[k][key] = med(v) }
}
const out = { label: LABEL, date: new Date().toISOString(), env, runs: RUNS, summary, raw: res, console_errors: errors };
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ label: LABEL, env, summary, console_errors: errors.length }, null, 1));
