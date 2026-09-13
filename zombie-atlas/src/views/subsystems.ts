/**
 * Subsystems view — the "structured functionality" summary.
 *
 * Every top-level package becomes a card carrying its own measured profile
 * (size, type mix, complexity, coupling, Lua surface) plus the description
 * harvested from the package map, so the functional layout of the engine can be
 * read at a glance. Cards are clickable and drive the treemap filters.
 */

import { type Atlas, type DomainInfo } from '../data';
import { store, type AppState } from '../state';
import { fmtCompact, fmtInt, h, pct } from '../util';

let atlas: Atlas | null = null;
let sortBy: 'code' | 'types' | 'complexity' | 'fanIn' | 'lua' | 'name' = 'code';

export function initSubsystems(a: Atlas) {
  atlas = a;
}

export function renderSubsystems(state: AppState) {
  if (!atlas) return;
  if (store.state.view !== 'subsystems') return;
  const pane = getPane();
  pane.hidden = false;
  document.getElementById('canvas')!.style.visibility = 'hidden';
  pane.replaceChildren(overviewBar(), ...cards());
}

export function teardownSubsystems() {
  document.getElementById('subsystems-pane')?.remove();
  const cv = document.getElementById('canvas');
  if (cv) cv.style.visibility = 'visible';
}

function getPane(): HTMLElement {
  let el = document.getElementById('subsystems-pane');
  if (!el) {
    el = h('div', {
      id: 'subsystems-pane',
      class: 'domain-grid stage-pane',
      style: { gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' },
    });
    document.getElementById('canvas-wrap')!.append(el);
  }
  return el;
}

/** Proportional stacked bar of every domain, ordered by size. */
function overviewBar(): HTMLElement {
  const a = atlas!;
  const total = a.domains.reduce((s, d) => s + d.metrics.code, 0) || 1;
  const bar = h('div', { style: { display: 'flex', height: '26px', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' } });
  const legend = h('div', {
    style: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: '6px', fontSize: '11px', color: 'var(--fg-2)' },
  });
  for (const d of a.domains) {
    const share = d.metrics.code / total;
    bar.append(
      h('div', {
        style: { width: `${share * 100}%`, background: d.color, cursor: 'pointer' },
        title: `${d.key} — ${pct(share)} of code`,
        onclick: () => filterToDomain(d.key),
      })
    );
    legend.append(
      h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }, onclick: () => filterToDomain(d.key) },
        h('span', { style: { width: '8px', height: '8px', background: d.color, borderRadius: '2px' } }),
        d.key,
        h('span', { style: { color: 'var(--fg-3)' }, text: pct(share) })
      )
    );
  }
  return h(
    'div',
    { class: 'card', style: { gridColumn: '1 / -1' } },
    h('h3', { text: `Functional domains · ${a.domains.length} top-level packages · ${fmtInt(total)} code lines` }),
    bar,
    legend,
    h(
      'div',
      { class: 'graph-controls', style: { marginTop: '10px' } },
      h('span', { style: { color: 'var(--fg-3)' }, text: 'sort by' }),
      ...(['code', 'types', 'complexity', 'fanIn', 'lua', 'name'] as const).map((k) =>
        h('button', {
          class: sortBy === k ? 'on' : '',
          text: k,
          style: sortBy === k ? 'background:var(--accent);color:var(--bg-0)' : '',
          onclick: () => {
            sortBy = k;
            renderSubsystems(store.state);
          },
        })
      )
    )
  );
}

function filterToDomain(key: string) {
  store.update((s) => {
    s.settings.filters.domains = [key];
    s.selection.zoom = [];
    s.view = 'treemap';
  });
}

function cards(): HTMLElement[] {
  const a = atlas!;
  const list = [...a.domains];
  const key = (d: DomainInfo) =>
    sortBy === 'code' ? -d.metrics.code
    : sortBy === 'types' ? -d.metrics.types
    : sortBy === 'complexity' ? -d.metrics.complexity
    : sortBy === 'fanIn' ? -d.metrics.fanIn
    : sortBy === 'lua' ? -d.metrics.luaExposed
    : 0;
  list.sort((x, y) => (sortBy === 'name' ? x.key.localeCompare(y.key) : key(x) - key(y)));

  const totalCode = a.domains.reduce((s, d) => s + d.metrics.code, 0) || 1;
  const maxCode = Math.max(...a.domains.map((d) => d.metrics.code), 1);

  return list.map((d) => {
    const pkgCount = d.packages.length;
    const density = d.metrics.code ? d.metrics.complexity / d.metrics.code : 0;
    return h(
      'div',
      {
        class: 'domain-card',
        style: { borderLeftColor: d.color },
        onclick: () => filterToDomain(d.key),
        title: `Filter the atlas to ${d.key}`,
      },
      h('h3', { text: d.key, style: { color: d.color } }),
      h('div', { class: 'desc', text: d.label }),
      h(
        'div',
        { class: 'stats' },
        stat(fmtCompact(d.metrics.code), 'lines'),
        stat(fmtInt(d.metrics.types), 'types'),
        stat(fmtCompact(d.metrics.methods), 'methods'),
        stat(fmtInt(d.metrics.complexity), 'complexity'),
        stat(pct(d.metrics.code / totalCode), 'of codebase'),
        stat(String(d.metrics.luaExposed), 'lua types')
      ),
      h(
        'div',
        { style: { marginTop: '8px' } },
        barRow('size', d.metrics.code / maxCode, `${fmtCompact(d.metrics.code)} ln`),
        barRow('branch density', Math.min(1, density / 0.6), density.toFixed(3)),
        barRow(
          'cross-pkg coupling',
          Math.min(1, d.metrics.fanIn / Math.max(1, Math.max(...a.domains.map((x) => x.metrics.fanIn)))),
          `${fmtCompact(d.metrics.fanIn)} in / ${fmtCompact(d.metrics.fanOut)} out`
        ),
        barRow(
          'type mix',
          d.metrics.classes / Math.max(1, d.metrics.types),
          `${d.metrics.classes}C ${d.metrics.interfaces}I ${d.metrics.enums}E ${d.metrics.records}R`
        )
      ),
      h(
        'div',
        { style: { marginTop: '8px', fontSize: '11px', color: 'var(--fg-3)' } },
        `${pkgCount} package${pkgCount === 1 ? '' : 's'} · key hubs: `,
        ...d.hubs.slice(0, 3).map((hub, i) =>
          h('span', {
            text: `${i ? ', ' : ''}${hub.name}`,
            style: { color: 'var(--accent-2)', cursor: 'pointer' },
            title: `${hub.fqn} — referenced by ${hub.fanIn} types`,
            onclick: (e: Event) => {
              e.stopPropagation();
              store.update((s) => {
                s.selection.classId = hub.id;
                s.selection.packagePath = null;
              });
            },
          })
        )
      )
    );
  });
}

function stat(value: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('b', { text: value }), h('span', { text: label }));
}

function barRow(label: string, t: number, value: string): HTMLElement {
  return h(
    'div',
    { class: 'bar-row' },
    h('span', { class: 'lbl', text: label }),
    h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.max(1, Math.min(100, t * 100))}%` } })),
    h('span', { class: 'val', text: value })
  );
}
