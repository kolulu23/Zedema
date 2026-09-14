/** Catalog integrity and browser regression coverage for the localized UI. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function checkCatalogs() {
  const en = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/zh-cn.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'Locale keys must match');
  const placeholders = (text) => [...text.matchAll(/\{\d+\}/g)].map(([value]) => value).sort();
  for (const [key, text] of Object.entries(en)) {
    assert.equal(typeof zh[key], 'string', key);
    assert.ok(zh[key].trim(), `Empty translation: ${key}`);
    assert.deepEqual(placeholders(text), placeholders(zh[key]), `Placeholder mismatch: ${key}`);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    assert.ok(Object.hasOwn(en, key), `Missing shell translation: ${key}`);
  }
  console.log(`[i18n] ${Object.keys(en).length} messages: keys and placeholders match`);
}

export async function testLocalization(browser, url, check, shots) {
  checkCatalogs();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !!window.zombieAtlas);
  const cleanUrl = new URL(url);
  cleanUrl.search = '';
  cleanUrl.hash = '';
  const base = cleanUrl.href;
  try {
    await page.goto(base);
    await ready();
    check('i18n: browser language selects Chinese', await page.locator('html').getAttribute('lang') === 'zh-CN');
    check('i18n: localized shell and accessibility',
      await page.locator('#panel-controls h2').textContent() === '视图控制' &&
      await page.locator('#search').getAttribute('aria-label') === '搜索' &&
      (await page.title()).includes('源码地图'));
    for (const [view, label, selector, heading] of [
      ['hierarchy', '继承层次', '#hierarchy-pane', '继承树根节点'],
      ['dependencies', '依赖关系', '.graph-hint', '滚轮缩放'],
      ['subsystems', '子系统', '#subsystems-pane', '功能领域'],
      ['insights', '统计分析', '#insights-pane', '复杂度最高的方法'],
    ]) {
      await page.locator(`[data-view="${view}"]`).click();
      // Dependencies puts its interaction hint in a dynamically created overlay.
      if (view === 'dependencies') {
        await page.getByText('滚轮缩放', { exact: false }).waitFor();
        check(`i18n: ${view}`, await page.locator(`[data-view="${view}"]`).textContent() === label);
        await page.getByRole('button', { name: '矩阵', exact: true }).click();
        await page.getByText('包邻接矩阵', { exact: false }).waitFor();
        check('i18n: dependency matrix', true);
      } else {
        await page.locator(selector).getByText(heading, { exact: false }).first().waitFor();
        check(`i18n: ${view}`, await page.locator(`[data-view="${view}"]`).textContent() === label);
      }
    }
    await page.screenshot({ path: path.join(shots, '20-i18n-insights-zh.png') });
    await page.locator('#btn-help').click();
    check('i18n: help dialog', (await page.locator('#modal-root').textContent()).includes('鼠标与键盘'));
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('[data-view="treemap"]').click();
    await page.evaluate(() => {
      const { store, atlas } = window.zombieAtlas;
      store.update((s) => {
        s.settings.groupBy = 'stereotype+package';
        s.settings.filters.minCode = 10;
        s.selection.classId = atlas.classes.find((c) => c.name === 'IsoPlayer').id;
        s.selection.zoom = ['st:class'];
      });
    });
    await page.waitForFunction(() => document.querySelector('#inspector-body h1')?.textContent === 'IsoPlayer');
    check('i18n: canonical zoom IDs', await page.evaluate(() => window.zombieAtlas.treemap.zoomRoot?.data.id === 'st:class'));
    check('i18n: source names preserved', await page.locator('#inspector-body h1').textContent() === 'IsoPlayer');
    await page.getByRole('button', { name: '查看源码', exact: true }).click();
    await page.locator('.src-code').waitFor();
    check('i18n: source viewer', (await page.locator('#modal-root').textContent()).includes('声明于第'));
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('#member-filter').fill('get');
    await page.waitForFunction(() => document.activeElement?.id === 'member-filter' && document.querySelector('#member-filter').value === 'get');
    check('i18n: localized member filter retains focus', true);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const exported = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8'));
    check('i18n: exported type kinds stay language-neutral', exported.types.length > 0 && exported.types.every((c) => ['class', 'interface', 'enum', 'record', 'annotation'].includes(c.kind)));
    const before = await page.evaluate(() => {
      const s = window.zombieAtlas.store.state;
      return JSON.stringify([s.view, s.selection.classId, s.selection.zoom, s.settings]);
    });
    await page.locator('#language').selectOption('en');
    await page.waitForURL('**lang=en**');
    await ready();
    const after = await page.evaluate(() => {
      const s = window.zombieAtlas.store.state;
      return JSON.stringify([s.view, s.selection.classId, s.selection.zoom, s.settings]);
    });
    check('i18n: switching preserves view, filters, selection and zoom', before === after);
    check('i18n: switch to English', await page.locator('#panel-controls h2').textContent() === 'View controls');
    await page.goto(base);
    await ready();
    check('i18n: saved language overrides browser', await page.locator('html').getAttribute('lang') === 'en');
    await page.goto(base + '?lang=zh-CN');
    await ready();
    check('i18n: URL overrides saved language', await page.locator('html').getAttribute('lang') === 'zh-CN');
    await page.screenshot({ path: path.join(shots, '21-i18n-treemap-zh.png') });
    const overflow = await page.locator('.topbar').evaluate((el) => el.scrollWidth > el.clientWidth);
    check('i18n: header fits at 1440px', !overflow);
    await page.evaluate(() => window.zombieAtlas.store.update((s) => {
      s.selection.classId = null;
      s.selection.packagePath = 'zombie.iso';
      s.view = 'dependencies';
      s.depMode = 'matrix';
    }));
    await page.locator('#language').selectOption('en');
    await page.waitForURL('**lang=en**');
    await ready();
    check('i18n: package selection and dependency mode survive switching', await page.evaluate(() => {
      const s = window.zombieAtlas.store.state;
      return s.selection.packagePath === 'zombie.iso' && s.view === 'dependencies' && s.depMode === 'matrix';
    }));
    check('i18n: no runtime errors', errors.length === 0, errors.join(' | '));
  } finally { await context.close(); }

  // Language switching remains usable when storage or the dataset is unavailable.
  const isolated = await browser.newContext({ locale: 'fr-FR' });
  const offline = await isolated.newPage();
  try {
    await offline.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage denied'); } });
    });
    await offline.route('**/data/**', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await offline.goto(base + '?lang=invalid');
    await offline.locator('#stage-message').waitFor({ state: 'visible' });
    check('i18n: unsupported language falls back to English', await offline.locator('html').getAttribute('lang') === 'en');
    await offline.locator('#language').selectOption('zh-CN');
    await offline.waitForURL('**lang=zh-CN**');
    await offline.getByText('无法加载数据集', { exact: false }).waitFor();
    check('i18n: localized load errors and storage-free switching', await offline.locator('html').getAttribute('lang') === 'zh-CN');
  } finally { await isolated.close(); }
}

if (process.argv.includes('--catalog-only')) checkCatalogs();
