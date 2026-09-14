/**
 * Browser smoke test for Zombie Atlas.
 *
 * Loads the built SPA in headless Chromium, exercises every view and the main
 * interactions, fails on console errors or missing DOM, and writes screenshots
 * to .pw-shots/ for eyeballing.
 *
 * Usage: node tools/smoke.mjs [--url http://127.0.0.1:5184/]
 */

import { testLocalization } from './test-i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const SHOTS = path.join(APP, '.pw-shots');
fs.mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------
// Browser plumbing.
//
// Chromium and its shared libraries may live inside the project (they do in
// sandboxes without a system browser): point Playwright at them before it is
// imported, so `npm test` works without wrapping the command.
// ---------------------------------------------------------------------------
const LOCAL_BROWSERS = path.join(APP, '.pw-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(LOCAL_BROWSERS)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS;
}
const LOCAL_LIBS = path.join(APP, '.pw-libs', 'root', 'usr', 'lib', 'x86_64-linux-gnu');
if (fs.existsSync(LOCAL_LIBS) && !(process.env.LD_LIBRARY_PATH ?? '').includes(LOCAL_LIBS)) {
  process.env.LD_LIBRARY_PATH = `${LOCAL_LIBS}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`;
}

const { chromium } = await import('playwright');

const argv = process.argv.slice(2);
const urlArg = argv.indexOf('--url');
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 5184;
const URL_ = urlArg >= 0 ? argv[urlArg + 1] : `http://127.0.0.1:${PORT}/`;

/**
 * Unless an explicit --url is given, the test serves `dist/` itself so it does
 * not depend on a long-lived server process.
 */
let server = null;

async function probe() {
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  if (urlArg >= 0) return;
  // Reuse a server that is already serving this port instead of fighting it for
  // the address; only spawn one when nobody is listening.
  if (await probe()) {
    process.stdout.write(`[smoke] using the server already listening on ${URL_}\n`);
    return;
  }
  server = spawn(process.execPath, [path.join(HERE, 'serve.mjs'), '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 15000;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`server did not start on ${URL_}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

function stopServer() {
  if (server && !server.killed) server.kill('SIGTERM');
  server = null;
}

process.on('exit', stopServer);
process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

await startServer();

const problems = [];
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) problems.push(`${name}${detail ? `: ${detail}` : ''}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1, locale: 'en-US' });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => consoleErrors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

// ---------------------------------------------------------------- boot ------
const brand = await page.textContent('#brand-sub');
check('dataset loaded', /types/.test(brand ?? ''), brand ?? '');
check('tabs rendered', (await page.locator('#tabs button').count()) === 5);
check('controls rendered', (await page.locator('#controls .field').count()) > 5);
check('legend rendered', (await page.locator('#legend .legend-item').count()) > 3);
check('inspector overview', /Project overview/.test((await page.textContent('#inspector-body')) ?? ''));
check('statusbar counts', /types shown/.test((await page.textContent('#statusbar')) ?? ''));

// treemap actually painted: sample the canvas for non-background pixels
const painted = await page.evaluate(() => {
  const cv = document.querySelector('#canvas');
  const ctx = cv.getContext('2d');
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4000) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return seen.size;
});
check('treemap painted (distinct colours)', painted > 25, `${painted} distinct samples`);
await page.screenshot({ path: path.join(SHOTS, '01-treemap.png') });

// ---------------------------------------------------------------- hover -----
await page.mouse.move(700, 500);
await page.waitForTimeout(350);
const tipVisible = await page.locator('#tooltip').isVisible();
const tipText = tipVisible ? await page.textContent('#tooltip') : '';
check('hover tooltip', tipVisible && (tipText ?? '').length > 20, (tipText ?? '').slice(0, 60).replace(/\n/g, ' '));

// --------------------------------------------------------------- zoom -------
await page.mouse.dblclick(700, 500);
await page.waitForTimeout(400);
const crumbsAfterZoom = await page.locator('#breadcrumbs .crumb').count();
check('double-click zooms', crumbsAfterZoom >= 2, `${crumbsAfterZoom} crumbs`);
await page.screenshot({ path: path.join(SHOTS, '02-treemap-zoomed.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// Regression guard: a double-click inside an already-zoomed view used to emit a
// path relative to the *current* subtree. `selection.zoom` is absolute and is
// re-resolved from the full tree on every layout, so that path matched no child
// of the root, the walk stopped at its first id, and the map snapped back to
// the root instead of zooming in.
const zoomPath = () => page.evaluate(() => window.zombieAtlas.store.state.selection.zoom);
const zoomRootId = () => page.evaluate(() => window.zombieAtlas.treemap.root?.data?.id ?? null);

await page.evaluate(() => {
  window.zombieAtlas.store.update((s) => {
    s.selection.zoom = ['p:zombie', 'p:zombie.iso'];
  });
});
await page.waitForTimeout(500);

const deeper = await page.evaluate(() => {
  const t = window.zombieAtlas.treemap;
  const cv = document.querySelector('#canvas');
  const r = cv.getBoundingClientRect();
  for (let y = 30; y < cv.clientHeight - 30; y += 7) {
    for (let x = 30; x < cv.clientWidth - 30; x += 7) {
      const n = t.nodeAt(x, y);
      // the deepest node at this pixel: a group of its own, not a child of it
      if (n && n.parent && n.children?.length) return { x: r.left + x, y: r.top + y, id: n.data.id };
    }
  }
  return null;
});
check('a zoomed view still offers a package to zoom into', deeper !== null, deeper ? deeper.id : 'none');

const zoomBefore = await zoomPath();
if (deeper) {
  await page.mouse.dblclick(deeper.x, deeper.y);
  await page.waitForTimeout(500);
}
const zoomAfter = await zoomPath();
check(
  'double-clicking inside a zoomed view zooms deeper (no snap back to the root)',
  zoomAfter.length === zoomBefore.length + 1 &&
    zoomAfter[zoomAfter.length - 1] === deeper?.id &&
    zoomAfter.slice(0, zoomBefore.length).join('|') === zoomBefore.join('|'),
  `${zoomBefore.join(' > ')} -> ${zoomAfter.join(' > ')}`
);
check(
  'the layout follows the zoom path to its last id',
  (await zoomRootId()) === zoomAfter[zoomAfter.length - 1],
  `${await zoomRootId()} vs ${zoomAfter[zoomAfter.length - 1]}`
);

// A path that names a node which is not on the way down (an old permalink, a
// stale bookmark) must degrade to the part that does resolve.
await page.evaluate(() => {
  window.zombieAtlas.store.update((s) => {
    s.selection.zoom = ['p:zombie', 'p:does.not.exist', 'p:zombie.iso'];
  });
});
await page.waitForTimeout(500);
check('an unroutable zoom id degrades to the prefix that resolves', (await zoomRootId()) === 'p:zombie', String(await zoomRootId()));

await page.evaluate(() => {
  window.zombieAtlas.store.update((s) => {
    s.selection.zoom = [];
  });
});
await page.waitForTimeout(400);

// ------------------------------------------------------- layout switching ---
// Regression guard: the tiling algorithm was missing from the rebuild key, so
// switching it did nothing until some unrelated setting changed.
const canvasShot = async () => (await page.locator('#canvas').screenshot()).toString('base64');
const tileShot = async (label) => {
  await page.locator('#stage-actions button', { hasText: label }).first().click();
  await page.waitForTimeout(550);
  return canvasShot();
};
const beforeLayout = await canvasShot();
const tiles = new Set([await tileShot('Binary')]);
check('layout switch applies immediately', (await canvasShot()) !== beforeLayout);
tiles.add(await tileShot('Slice'));
tiles.add(await tileShot('Squarified'));
await page.selectOption('#controls select >> nth=3', 'strip');
await page.waitForTimeout(550);
tiles.add(await canvasShot());
check('every tiling algorithm renders differently', tiles.size === 4, `${tiles.size}/4 distinct`);
await page.selectOption('#controls select >> nth=3', 'squarify');
await page.waitForTimeout(450);

// ------------------------------------------------------------- selection ----
await page.keyboard.press('/');
await page.fill('#search', 'IsoPlayer');
await page.waitForTimeout(400);
const hits = await page.locator('.sr-item').count();
check('search returns hits', hits > 0, `${hits} hits`);
await page.locator('.sr-item').first().click();
await page.waitForTimeout(600);
const insp = (await page.textContent('#inspector-body')) ?? '';
check('inspector shows class', /IsoPlayer/.test(insp), insp.slice(0, 60).replace(/\n/g, ' '));
check('inspector shows hierarchy', /Hierarchy/.test(insp));
check('inspector shows members', /Methods/.test(insp));
await page.screenshot({ path: path.join(SHOTS, '03-selection.png') });

// ------------------------------------------------------------- source -------
const srcBtn = page.locator('#inspector-body button', { hasText: 'View source' });
if (await srcBtn.count()) {
  await srcBtn.first().click();
  await page.waitForTimeout(900);
  const srcRows = await page.locator('.src-code tr').count();
  check('source viewer loads file', srcRows > 50, `${srcRows} rows`);
  await page.screenshot({ path: path.join(SHOTS, '04-source.png') });
  await page.locator('.modal button.primary').click();
  await page.waitForTimeout(200);
} else {
  check('source viewer loads file', false, 'no View source button');
}

// ------------------------------------------------------------ hierarchy -----
await page.locator('#tabs button', { hasText: 'Hierarchy' }).click();
await page.waitForTimeout(600);
const treeRows = await page.locator('#hierarchy-pane .member-list > div').count();
check('hierarchy tree renders', treeRows > 5, `${treeRows} rows`);
check('hierarchy roots list', (await page.locator('#hierarchy-pane .link').count()) > 10);
await page.screenshot({ path: path.join(SHOTS, '05-hierarchy.png') });

// --------------------------------------------------------- dependencies -----
await page.locator('#tabs button', { hasText: 'Dependencies' }).click();
await page.waitForTimeout(2200);
const graphPainted = await page.evaluate(() => {
  const cv = document.querySelector('#canvas');
  const ctx = cv.getContext('2d');
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  let lit = 0;
  for (let i = 0; i < data.length; i += 400) if (data[i] > 40 || data[i + 1] > 40) lit++;
  return lit;
});
check('dependency graph painted', graphPainted > 100, `${graphPainted} lit samples`);
await page.screenshot({ path: path.join(SHOTS, '06-dependencies.png') });

const matrixBtn = page.locator('#stage-actions button', { hasText: 'matrix' });
if (await matrixBtn.count()) {
  await matrixBtn.first().click();
  await page.waitForTimeout(700);
  const cells = await page.locator('#deps-pane svg rect').count();
  check('matrix renders', cells > 100, `${cells} cells`);
  await page.locator('#deps-pane svg rect').nth(30).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '07-matrix.png') });
}

// ------------------------------------------------------------ subsystems ----
await page.locator('#tabs button', { hasText: 'Subsystems' }).click();
await page.waitForTimeout(600);
const domainCards = await page.locator('.domain-card').count();
check('domain cards render', domainCards > 20, `${domainCards} cards`);
await page.screenshot({ path: path.join(SHOTS, '08-subsystems.png') });
const firstDomain = (await page.locator('.domain-card h3').first().textContent()) ?? '';
await page.locator('.domain-card').first().click();
await page.waitForTimeout(800);
const chipOn = await page.locator('#controls .chip.on').count();
const shownNow = await page.textContent('#statusbar');
check('domain card filters treemap', chipOn === 1 && /1\/|\d+ \/ /.test(shownNow ?? ''), `domain=${firstDomain} chips=${chipOn}`);

// -------------------------------------------------------------- insights ----
await page.locator('#tabs button', { hasText: 'Insights' }).click();
await page.waitForTimeout(900);
const cards = await page.locator('#insights-pane .card').count();
check('insight cards render', cards >= 8, `${cards} cards`);
check('insight rankings populated', (await page.locator('#insights-pane .rank-row').count()) > 30);
await page.screenshot({ path: path.join(SHOTS, '09-insights.png'), fullPage: false });

// ------------------------------------------------------------ theming -------
await page.keyboard.press('t');
await page.waitForTimeout(500);
check('light theme applied', (await page.getAttribute('html', 'data-theme')) === 'light');
await page.locator('#tabs button', { hasText: 'Treemap' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(SHOTS, '10-treemap-light.png') });
await page.keyboard.press('t');
await page.waitForTimeout(400);

// ---------------------------------------------------- customisation ---------
await page.selectOption('#controls select >> nth=0', 'complexity');
await page.waitForTimeout(600);
await page.selectOption('#controls select >> nth=1', 'complexity');
await page.waitForTimeout(500);
check('metric switch ok', /complexity/.test((await page.textContent('#statusbar')) ?? ''));
await page.selectOption('#controls select >> nth=2', 'stereotype');
await page.waitForTimeout(600);
check('group-by switch ok', /stereotype/.test((await page.textContent('#statusbar')) ?? ''));
await page.screenshot({ path: path.join(SHOTS, '11-groupby-stereotype.png') });
await page.selectOption('#controls select >> nth=0', 'code');
await page.selectOption('#controls select >> nth=2', 'package');
await page.waitForTimeout(500);

// member leaves: the leaf count must grow when the member level is enabled.
// Reset filters and zoom into one package first, otherwise the filtered tree
// may legitimately be empty.
await page.evaluate(() => {
  const s = window.zombieAtlas.store;
  s.update((x) => {
    x.settings.filters = { query: '', kinds: [], stereotypes: [], domains: [], luaOnly: false, minCode: 0 };
    x.selection.zoom = ['p:zombie', 'p:zombie.iso'];
    x.view = 'treemap';
  });
});
await page.waitForTimeout(900);
const leavesBefore = await page.evaluate(() => window.zombieAtlas.treemap.leaves.length);
await page.keyboard.press('m');
await page.waitForTimeout(2200);
const leavesAfter = await page.evaluate(() => window.zombieAtlas.treemap.leaves.length);
check('member-level leaves', leavesAfter > leavesBefore, `${leavesBefore} -> ${leavesAfter} leaves`);
await page.screenshot({ path: path.join(SHOTS, '12-members.png') });
await page.keyboard.press('m');
await page.waitForTimeout(500);

// ---------------------------------------------------------------- help ------
await page.keyboard.press('?');
await page.waitForTimeout(400);
check('help modal opens', (await page.locator('#modal-root .modal h2').count()) === 1);
await page.screenshot({ path: path.join(SHOTS, '13-help.png') });
await page.locator('#modal-root button.primary').click();
await page.waitForTimeout(250);
check('help modal closes', (await page.locator('#modal-root .modal').count()) === 0);

// ------------------------------------------------------------ exports -------
const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.locator('#stage-actions button', { hasText: 'JSON' }).click();
const download = await dl;
check('JSON export downloads', !!download, download ? await download.suggestedFilename() : 'no download event');
if (download) await download.saveAs(path.join(SHOTS, 'export.json'));

// the viewer must survive a permalink reload with the same state
const hashBefore = await page.evaluate(() => location.hash);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const hashAfter = await page.evaluate(() => location.hash);
check('permalink restores state', hashBefore === hashAfter, `${hashBefore} vs ${hashAfter}`);
await page.screenshot({ path: path.join(SHOTS, '14-permalink-reload.png') });

// --------------------------------------------------------------- permalink --
const hash = await page.evaluate(() => location.hash);
check('url state written', hash.length > 1, hash);

// ------------------------------------------------------------ scrolling -----
// Regression guard: a `1fr` grid row plus body{overflow:hidden} used to make
// every tall panel unreachable instead of scrollable.
const canScroll = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = el.scrollHeight; // the browser clamps to the maximum
    const reached = Math.round(el.scrollTop);
    el.scrollTop = 0;
    return { overflow: max, reached, bottom: Math.abs(reached - max) <= 1 };
  }, sel);

// The invariant is "every pixel of overflow is reachable", not a fixed amount:
// the regression this guards against had overflow with moved === 0.
const reachable = (r) => r && (r.overflow <= 0 || r.bottom);
const sidebarScroll = await canScroll('#sidebar');
check('sidebar scrolls', reachable(sidebarScroll), JSON.stringify(sidebarScroll));

await page.evaluate(() => window.zombieAtlas.store.update((s) => { s.selection.classId = window.zombieAtlas.atlas.byName.get('IsoPlayer')[0].id; }));
await page.waitForTimeout(1500);
const inspScroll = await canScroll('#inspector');
check('inspector scrolls', reachable(inspScroll) && (inspScroll?.overflow ?? 0) > 100, JSON.stringify(inspScroll));

await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(400);
const smallSidebar = await canScroll('#sidebar');
check('sidebar scrolls at 720p', reachable(smallSidebar) && (smallSidebar?.overflow ?? 0) > 100, JSON.stringify(smallSidebar));
await page.setViewportSize({ width: 1680, height: 1000 });
await page.waitForTimeout(400);

const shellFits = await page.evaluate(() => document.querySelector('#app').scrollHeight <= window.innerHeight + 1);
check('shell fits viewport (no clipped overflow)', shellFits);

for (const [tab, sel] of [['Hierarchy', '#hierarchy-pane'], ['Subsystems', '#subsystems-pane'], ['Insights', '#insights-pane']]) {
  await page.locator('#tabs button', { hasText: tab }).click();
  await page.waitForTimeout(600);
  const r = await canScroll(sel);
  check(`${tab} pane scrolls`, reachable(r) && (r?.overflow ?? 0) > 100, JSON.stringify(r));
}

// ------------------------------------------------------- dependency view ----
// Regression guard for four reported defects: the mode buttons did not switch
// (the toolbar never re-rendered), panning was undone on the next store update,
// the drag lost the zoom, and a plain click started a node drag.
const dep = () => page.evaluate(() => window.zombieAtlas.deps());
const canvasBox = () =>
  page.evaluate(() => {
    const r = document.querySelector('#canvas').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
const emptyPoint = () =>
  page.evaluate(() => {
    const d = window.zombieAtlas.deps();
    const cv = document.querySelector('#canvas');
    for (let y = 40; y < cv.clientHeight - 40; y += 25) {
      for (let x = 40; x < cv.clientWidth - 40; x += 25) if (!d.hitTest(x, y)) return { x, y };
    }
    return null;
  });

await page.locator('#tabs button', { hasText: 'Dependencies' }).click();
await page.waitForTimeout(2600);

for (const [label, paneExpected] of [
  ['matrix', true],
  ['classes', true],
  ['graph', false],
]) {
  await page.locator('#stage-actions button', { hasText: label }).first().click();
  await page.waitForTimeout(500);
  const d = await dep();
  const active = await page.evaluate(() =>
    [...document.querySelectorAll('#stage-actions button')].filter((b) => b.className === 'on').map((b) => b.textContent)
  );
  const paneVisible = await page.evaluate(() => !(document.querySelector('#deps-pane')?.hidden ?? true));
  check(
    `dependency "${label}" mode activates`,
    d.mode === label && active.includes(label) && paneVisible === paneExpected,
    `mode=${d.mode} active=${JSON.stringify(active)} pane=${paneVisible}`
  );
}
await page.waitForTimeout(700);

const box = await canvasBox();
const d0 = await dep();
await page.mouse.move(box.left + 720, box.top + 420);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(350);
const d1 = await dep();
check('dependency wheel zooms', d1.zoom > d0.zoom * 1.2, `${d0.zoom.toFixed(2)} -> ${d1.zoom.toFixed(2)}`);

const spot = await emptyPoint();
await page.mouse.move(box.left + spot.x, box.top + spot.y);
await page.mouse.down();
// deliberately travels up out of the canvas: the gesture must keep tracking
await page.mouse.move(box.left + spot.x + 150, box.top + spot.y - 120, { steps: 12 });
// the treemap's handlers share this canvas and tooltip: while dragging the
// graph nothing may pop up under the cursor
const tipDuringDrag = await page.evaluate(() => ({
  hidden: document.querySelector('#tooltip').hidden,
  text: document.querySelector('#tooltip').textContent || '',
}));
await page.mouse.up();
await page.waitForTimeout(350);
check('no tooltip pops up while dragging the graph', tipDuringDrag.hidden, tipDuringDrag.text.slice(0, 46));
const d2 = await dep();
const dx = Math.round(d2.panX - d1.panX);
const dy = Math.round(d2.panY - d1.panY);
check('dependency pan follows the pointer 1:1, even outside the canvas', Math.abs(dx - 150) < 4 && Math.abs(dy + 120) < 4, `delta ${dx},${dy} (expected 150,-120)`);
check('panning keeps the zoom', Math.abs(d2.zoom - d1.zoom) < 1e-9, `${d1.zoom.toFixed(3)} -> ${d2.zoom.toFixed(3)}`);

const nodePoint = await page.evaluate(() => {
  const d = window.zombieAtlas.deps();
  const cv = document.querySelector('#canvas');
  for (let y = 60; y < cv.clientHeight - 60; y += 13) {
    for (let x = 60; x < cv.clientWidth - 60; x += 13) {
      const hit = d.hitTest(x, y);
      if (hit) return { x, y, path: hit };
    }
  }
  return null;
});
await page.mouse.move(box.left + nodePoint.x, box.top + nodePoint.y);
await page.waitForTimeout(400);
const tipHover = await page.evaluate(() => ({
  hidden: document.querySelector('#tooltip').hidden,
  text: document.querySelector('#tooltip').textContent || '',
}));
check(
  'graph hover reads out the package, not a stale treemap node',
  !tipHover.hidden && tipHover.text.includes(nodePoint.path),
  tipHover.text.slice(0, 52)
);

await page.mouse.click(box.left + nodePoint.x, box.top + nodePoint.y);
await page.waitForTimeout(400);
const d3 = await dep();
check(
  'clicking a node neither drags it nor refits the view',
  d3.draggingNode === null && Math.abs(d3.zoom - d2.zoom) < 1e-9 && Math.abs(d3.panX - d2.panX) < 1e-9,
  `zoom ${d3.zoom.toFixed(3)} pan ${d3.panX.toFixed(0)} dragging=${d3.draggingNode}`
);
check('clicking a node selects its package', (await page.textContent('#inspector-body')).includes(nodePoint.path), nodePoint.path);

await page.locator('#stage-actions button', { hasText: 'Fit' }).first().click();
await page.waitForTimeout(500);
const d4 = await dep();
check('Fit reframes the graph', Math.abs(d4.panX - d3.panX) > 1 || Math.abs(d4.zoom - d3.zoom) > 1e-6);
await page.screenshot({ path: path.join(SHOTS, '16-dependencies-zoom.png') });

// ------------------------------------------------- source tree plumbing -----
// The raw tree is served from a configurable location (ZOMBIE_SRC); the app
// must be able to read the file a class came from, and an unknown mount must
// fail loudly instead of returning the SPA's HTML.
const mount = await page.evaluate(() => window.zombieAtlas.atlas.meta.sourceMount ?? 'zombie');
const firstPath = await page.evaluate(() => window.zombieAtlas.atlas.classes[0].path);
const srcRes = await page.request.get(`${URL_.replace(/\/$/, '')}/src/${firstPath}`);
const srcBody = srcRes.ok() ? await srcRes.text() : '';
check(
  'raw source served at the configured mount',
  srcRes.ok() && /^\s*(\/\/|package)/.test(srcBody) && !/<html/i.test(srcBody),
  `${srcRes.status()} ${srcRes.headers()['content-type']} mount=${mount}`
);
const badMount = await page.request.get(`${URL_.replace(/\/$/, '')}/src/definitely-not-the-mount/x.java`);
check('unknown source mount -> 404 (not SPA html)', badMount.status() === 404, String(badMount.status()));

// ------------------------------------------------------- persisted state ----
// The store must survive a wiped, corrupted or hand-edited localStorage:
// every field falls back to its documented default and is written back.
const KEY = 'zombie-atlas.settings.v1';

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
const afterWipe = await page.evaluate((k) => {
  const raw = localStorage.getItem(k);
  return { exists: !!raw, parsed: raw ? JSON.parse(raw) : null, keys: Object.keys(localStorage).length };
}, KEY);
const wipeNote = await page.textContent('#controls .field:last-child .hint').catch(() => '');
check(
  'defaults are rewritten after a storage wipe',
  afterWipe.exists &&
    afterWipe.keys === 1 &&
    afterWipe.parsed.theme === 'dark' &&
    afterWipe.parsed.sizeMetric === 'code' &&
    afterWipe.parsed.version === 1 &&
    Array.isArray(afterWipe.parsed.filters.domains),
  `keys=${afterWipe.keys} theme=${afterWipe.parsed?.theme} version=${afterWipe.parsed?.version}`
);
check('wipe is reported in the sidebar', /no saved settings/i.test(wipeNote), wipeNote.trim());

// a payload with wrong types for every important field
await page.evaluate((k) => {
  localStorage.setItem(
    k,
    JSON.stringify({
      version: 99,
      theme: 42,
      sizeMetric: 'not-a-metric',
      colorMode: { nope: true },
      groupBy: 'nonsense',
      layout: 7,
      depthLimit: 'deep',
      padding: 'lots',
      minShare: -3,
      sort: 'sideways',
      sidebar: 'yes',
      weights: { code: 'a', complexity: null },
      filters: { query: 123, kinds: 'all', stereotypes: 'x', domains: 'iso', luaOnly: 'yes', minCode: -5 },
    })
  );
}, KEY);
const pageErrors2 = [];
page.on('pageerror', (e) => pageErrors2.push(e.message));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const repaired = await page.evaluate((k) => {
  const v = JSON.parse(localStorage.getItem(k));
  const t = window.zombieAtlas.treemap;
  return {
    theme: v.theme,
    sizeMetric: v.sizeMetric,
    colorMode: v.colorMode,
    groupBy: v.groupBy,
    depthLimit: v.depthLimit,
    padding: v.padding,
    minShare: v.minShare,
    sidebar: v.sidebar,
    query: v.filters.query,
    kindsIsArray: Array.isArray(v.filters.kinds),
    stereotypesIsArray: Array.isArray(v.filters.stereotypes),
    domainsIsArray: Array.isArray(v.filters.domains),
    luaOnlyIsBool: typeof v.filters.luaOnly === 'boolean',
    minCodeIsNumber: typeof v.filters.minCode === 'number',
    nodes: t.nodes.length,
  };
}, KEY);
check(
  'malformed settings are repaired field by field',
  repaired.theme === 'dark' &&
    repaired.sizeMetric === 'code' &&
    repaired.colorMode === 'domain' &&
    repaired.groupBy === 'package' &&
    repaired.depthLimit === 0 &&
    repaired.padding === 2 &&
    repaired.minShare === 0 &&
    repaired.sidebar === true &&
    repaired.query === '' &&
    repaired.kindsIsArray && repaired.stereotypesIsArray && repaired.domainsIsArray &&
    repaired.luaOnlyIsBool && repaired.minCodeIsNumber,
  JSON.stringify(repaired)
);
check('app still renders after a malformed payload', repaired.nodes > 1000, `${repaired.nodes} nodes`);
const repairNote = await page.textContent('#controls .field:last-child .hint').catch(() => '');
check('repair is reported in the sidebar', /repaired on load/i.test(repairNote), repairNote.trim());

// the repaired payload must be usable: clicking a domain chip used to throw
// when `filters.domains` had been a string
await page.locator('#controls .chip', { hasText: /^iso$/ }).first().click();
await page.waitForTimeout(800);
const afterChip = await page.evaluate(() => ({
  domains: window.zombieAtlas.store.state.settings.filters.domains,
  nodes: window.zombieAtlas.treemap.nodes.length,
}));
check('filters stay interactive after repair', afterChip.domains.length === 1 && afterChip.nodes > 0, JSON.stringify(afterChip));
check('no page errors during repair', pageErrors2.length === 0, pageErrors2.slice(0, 2).join(' | '));

// Restore defaults button
await page.locator('#controls button', { hasText: 'Restore defaults' }).click();
await page.waitForTimeout(900);
const afterReset = await page.evaluate((k) => {
  const v = JSON.parse(localStorage.getItem(k));
  return { domains: v.filters.domains.length, theme: v.theme, sizeMetric: v.sizeMetric, nodes: window.zombieAtlas.treemap.nodes.length };
}, KEY);
check(
  'Restore defaults resets settings and storage',
  afterReset.domains === 0 && afterReset.theme === 'dark' && afterReset.sizeMetric === 'code' && afterReset.nodes > 4000,
  JSON.stringify(afterReset)
);
await page.screenshot({ path: path.join(SHOTS, '19-restore-defaults.png') });

await testLocalization(browser, URL_, check, SHOTS);

// ------------------------------------------------------------- conclusion ---
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));

await browser.close();
stopServer();

console.log('\n=== Zombie Atlas smoke test ===');
for (const c of checks) console.log(`${c.ok ? ' PASS' : ' FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log(' - ' + p);
  stopServer();
  process.exit(1);
}
stopServer();
