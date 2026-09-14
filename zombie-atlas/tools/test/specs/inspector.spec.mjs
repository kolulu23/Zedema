/**
 * Inspector: what the right-hand panel shows for a selection.
 *
 * `boot.spec` covers the empty panel (the project overview); this spec covers
 * what a selection replaces it with — a type's metrics, ancestry and members, a
 * package's aggregates and actions — and the transitions between them.
 *
 * The member-filter test is a regression guard: re-rendering the list detaches
 * the input the user is typing into, so the renderer has to put focus back
 * (the original i18n spec asserted the same thing while the UI is in Chinese).
 */

import {
  inspectorAction,
  inspectorBadges,
  inspectorBody,
  inspectorTitle,
  memberFilter,
  memberRows,
  metricKeys,
  pane,
} from '../locators.mjs';
import { seam } from '../seam.mjs';
import { ISO_PLAYER, ZOOM_ISO } from '../fixtures.mjs';

/** Metric keys the class panel always renders. */
const CLASS_METRICS = ['source lines', 'code lines', 'methods', 'fields', 'complexity'];

/**
 * The one package `IsoPlayer` lives in. Not `ISO_DOMAIN`: that fixture is the
 * *domain* key (`iso`), which is not a package path and has no panel.
 */
const ISO_PACKAGE = 'zombie.iso';

export default {
  name: 'Inspector',

  async run(t) {
    const { page } = t;
    const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

    /** Select a type the way a click on the treemap/hierarchy would. */
    const select = async (name) => {
      await seam.store.apply(page, { classIdByName: name });
      await inspectorTitle(page).filter({ hasText: name }).waitFor({ timeout: 10000 });
    };

    await t.test('selecting a type replaces the project overview', async () => {
      const overview = await inspectorBody(page).innerText();
      t.assert.match(overview, /Project overview/, 'the panel did not open on the project overview');

      await select(ISO_PLAYER);
      const panel = await inspectorBody(page).innerText();
      t.assert.equal(oneLine(await inspectorTitle(page).innerText()), ISO_PLAYER, 'the panel titled the wrong type');
      t.assert.ok(!/Project overview/.test(panel), 'the overview is still rendered behind the selection');
      return 'overview → IsoPlayer';
    });

    await t.test('the type panel shows name, kind, metrics, hierarchy and members', async () => {
      await select(ISO_PLAYER);
      // Members arrive from a per-package shard; the filter input only exists
      // once that shard has been fetched and rendered.
      await memberFilter(page).waitFor({ timeout: 15000 });

      const badge = oneLine(await inspectorBadges(page).first().innerText());
      t.assert.equal(badge, 'class', `the kind badge reads ${JSON.stringify(badge)}`);

      const keys = await metricKeys(page).allInnerTexts();
      const missing = CLASS_METRICS.filter((k) => !keys.includes(k));
      t.assert.deepEqual(missing, [], `metrics missing from the panel: ${missing.join(', ')}`);

      // Section headings are uppercased by CSS, so match rendered text loosely.
      const panel = await inspectorBody(page).innerText();
      t.assert.match(panel, /hierarchy/i, 'no hierarchy section');
      t.assert.match(panel, /methods/i, 'no members section');

      const members = await memberRows(page).count();
      t.assert.ok(members > 50, `only ${members} member rows`);
      return `${ISO_PLAYER} · ${badge} · ${keys.length} metrics · ${members} member rows`;
    });

    await t.test('the member filter narrows the list and keeps focus while re-rendering', async () => {
      await select(ISO_PLAYER);
      await memberFilter(page).waitFor({ timeout: 15000 });
      await memberFilter(page).fill('');
      await t.settle(250);

      const before = await memberRows(page).count();
      t.assert.ok(before > 50, `only ${before} member rows before filtering`);

      await memberFilter(page).fill('get');
      await t.settle(350);
      const after = await memberRows(page).count();
      t.assert.ok(after > 0, `filtering to "get" left ${after} member rows`);
      t.assert.ok(after < before, `the filter did not narrow the list: ${before} → ${after} rows`);

      // Regression guard: the re-render replaces the input, so focus and the
      // query both have to be restored by the renderer.
      const focused = await memberFilter(page).evaluate((el) => el === document.activeElement);
      t.assert.ok(focused, 'the filter lost keyboard focus when the list re-rendered');
      t.assert.equal(await memberFilter(page).inputValue(), 'get', 'the query was lost when the list re-rendered');

      await memberFilter(page).fill('');
      await t.settle(250);
      return `${before} → ${after} rows · focus kept`;
    });

    await t.test('selecting a package shows its panel and zoom action', async () => {
      await seam.store.apply(page, { packagePath: ISO_PACKAGE });
      const zoom = inspectorAction(page, 'Zoom treemap here');
      await zoom.waitFor({ timeout: 10000 });

      t.assert.equal(oneLine(await inspectorTitle(page).innerText()), 'iso', 'the panel titled the wrong package');
      const panel = await inspectorBody(page).innerText();
      t.assert.match(panel, /zombie\.iso/, 'the panel does not name the package path');
      t.assert.match(panel, /package metrics/i, 'the package panel has no metrics');

      await zoom.click();
      await t.settle(700);
      t.assert.equal(await seam.store.view(page), 'treemap', 'zooming did not switch to the treemap');
      t.assert.deepEqual(await seam.store.zoomPath(page), ZOOM_ISO, `zoom path was ${(await seam.store.zoomPath(page)).join(' > ')}`);
      return `${ISO_PACKAGE} → ${ZOOM_ISO.join(' > ')}`;
    });

    await t.test('"Show in hierarchy" switches to the hierarchy view', async () => {
      await select(ISO_PLAYER);
      const focus = inspectorAction(page, 'Show in hierarchy');
      await focus.waitFor({ timeout: 10000 });
      await focus.click();
      await t.settle(700);

      t.assert.equal(await seam.store.view(page), 'hierarchy', 'the view did not switch');
      const expected = await seam.atlas.classId(page, ISO_PLAYER);
      t.assert.equal((await seam.store.selection(page)).classId, expected, 'the wrong type is selected');
      t.assert.ok(await pane(page, 'hierarchy').isVisible(), 'the hierarchy pane is not shown');
      return `view=hierarchy · ${ISO_PLAYER}`;
    });

    await t.test('no console errors', async () => {
      t.assert.deepEqual(t.errors, [], t.errors.slice(0, 3).join(' | '));
      return 'clean';
    });
  },
};
