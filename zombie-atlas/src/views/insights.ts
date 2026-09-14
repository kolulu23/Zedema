import { msg, trLabel } from '../i18n';
/**
 * Insights view — rankings and distributions computed from the source at
 * extraction time (see `insights.json`): the biggest and most complex code, the
 * load-bearing hubs, the Lua API surface and the package coupling table.
 */

import { type Atlas } from '../domain';
import { store, type AppState } from '../state';
import { fmtCompact, fmtInt, h } from '../util';

interface TopMethod {
  classId: number;
  name: string;
  type: string;
  params: string[];
  complexity: number;
  branch: number;
  bodyLines: number;
  line: number;
  path: string;
  pkg: string;
  cls: string;
  annotations: string[];
}

interface InsightsData {
  topMethods: TopMethod[];
  top: Record<string, [number, number][]>;
  histograms: Record<string, [string | number, number][]>;
  packageCoupling: [string, string, number][];
}

let atlas: Atlas | null = null;
let data: InsightsData | null = null;
let memberSort: 'complexity' | 'lines' | 'branch' = 'complexity';

export async function initInsights(a: Atlas) {
  atlas = a;
  const res = await fetch('data/insights.json');
  data = (await res.json()) as InsightsData;
  renderInsights(store.state);
}

export function renderInsights(state: AppState) {
  if (!atlas || !data) return;
  // initInsights() is async: by the time the data arrives the user may already
  // have switched views, and painting the pane then would cover that view.
  if (store.state.view !== 'insights') return;
  const pane = getPane();
  pane.hidden = false;
  document.getElementById('canvas')!.style.visibility = 'hidden';
  pane.replaceChildren(...cardList());
}

export function teardownInsights() {
  document.getElementById('insights-pane')?.remove();
  const cv = document.getElementById('canvas');
  if (cv) cv.style.visibility = 'visible';
}

function getPane(): HTMLElement {
  let el = document.getElementById('insights-pane');
  if (!el) {
    el = h('div', {
      id: 'insights-pane',
      class: 'card-grid stage-pane',
      style: { gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' },
    });
    document.getElementById('canvas-wrap')!.append(el);
  }
  return el;
}

function cardList(): HTMLElement[] {
  const a = atlas!;
  const d = data!;
  const totalCode = a.classes.reduce((s, c) => s + c.code, 0);

  const cards: HTMLElement[] = [];

  cards.push(
    card(
      msg("Most complex methods"),
      msg("Sum of branch points + 1, methods with a real body only"),
      rankList(
        d.topMethods
          .slice()
          .sort((x, y) =>
            memberSort === 'complexity' ? y.complexity - x.complexity : memberSort === 'lines' ? y.bodyLines - x.bodyLines : y.branch - x.branch
          )
          .slice(0, 14),
        (m) => ({
          label: `${m.cls}.${m.name}`,
          sub: m.params.length ? `(${m.params.join(', ').slice(0, 40)})` : '()',
          value: memberSort === 'lines' ? msg("{0} ln", m.bodyLines) : msg("cx {0}", m.complexity),
          bar: m.complexity / d.topMethods[0].complexity,
          onClick: () => selectClass(m.classId),
        })
      ),
      h(
        'div',
        { class: 'graph-controls' },
        ...(['complexity', 'branch', 'lines'] as const).map((k) =>
          h('button', {
            text: trLabel(k),
            style: memberSort === k ? 'background:var(--accent);color:var(--bg-0)' : '',
            onclick: () => {
              memberSort = k;
              renderInsights(store.state);
            },
          })
        )
      )
    )
  );

  cards.push(
    card(
      msg("Largest types"),
      msg("Non-comment source lines per type"),
      rankList(d.top.code.slice(0, 14), (r) => rankEntry(r, (v) => msg("{0} ln", fmtCompact(v)), () => {}))
    )
  );
  cards.push(
    card(
      msg("Most depended-upon (fan-in)"),
      msg("Distinct types in the tree that reference this type"),
      rankList(d.top.fanIn.slice(0, 14), (r) => rankEntry(r, (v) => msg("{0} refs", fmtInt(v))))
    )
  );
  cards.push(
    card(
      msg("Biggest reusers (fan-out)"),
      msg("Distinct types this type reaches out to"),
      rankList(d.top.fanOut.slice(0, 14), (r) => rankEntry(r, (v) => msg("{0} deps", fmtInt(v))))
    )
  );
  cards.push(
    card(
      msg("Highest branch density"),
      msg("Complexity per code line — where the tricky logic lives"),
      rankList(d.top.density.slice(0, 14), (r) => rankEntry(r, (v) => v.toFixed(2), () => {}, v => Math.min(1, v / 0.6)))
    )
  );
  cards.push(
    card(
      msg("Most annotated methods"),
      msg("Largest @UsedFromLua surface per type"),
      rankList(d.top.luaMembers.slice(0, 14), (r) => rankEntry(r, (v) => msg("{0} members", v)))
    )
  );

  // package coupling table
  const rows = d.packageCoupling.slice(0, 24).map(([from, to, w]) =>
    h(
      'tr',
      {
        style: { cursor: 'pointer' },
        onclick: () =>
          store.update((s) => {
            s.view = 'dependencies';
            s.selection.packagePath = from;
          }),
      },
      h('td', { style: { fontFamily: 'var(--font-mono)', fontSize: '11px' }, text: from }),
      h('td', { style: { color: 'var(--fg-3)' }, text: '→' }),
      h('td', { style: { fontFamily: 'var(--font-mono)', fontSize: '11px' }, text: to }),
      h('td', { style: { textAlign: 'right', fontFamily: 'var(--font-mono)' }, text: String(w) })
    )
  );
  cards.push(
    card(
      msg("Strongest package coupling"),
      msg("Class-level references between packages"),
      h('table', {}, h('tbody', {}, ...rows))
    )
  );

  // histograms
  cards.push(
    card(
      msg("Type mix"),
      msg("Declared kinds across the tree"),
      histo(d.histograms.kinds, (k) => trLabel(['class', 'interface', 'enum', 'record', 'annotation'][Number(k)] ?? String(k)))
    )
  );
  cards.push(
    card(msg("Stereotypes"), msg("Inferred from the declaration itself"), histo(d.histograms.stereotypes, (k) => trLabel(String(k))))
  );
  cards.push(
    card(
      msg("Annotations"),
      msg("Most frequent annotations in the tree"),
      histo(
        d.histograms.annotations.slice(0, 14),
        (k) => String(k),
        (k) => k === 'UsedFromLua'
      )
    )
  );
  cards.push(
    card(
      msg("Largest packages"),
      msg("Types per package (top 16)"),
      histo(d.histograms.packages.slice(0, 16), (k) => String(k))
    )
  );

  cards.push(
    card(
      msg("Scale"),
      msg("Everything measured in this build"),
      h(
        'dl',
        { class: 'kv' },
        kv(msg("files parsed"), fmtInt(a.meta.counts.files)),
        kv(msg("types"), fmtInt(a.meta.counts.types)),
        kv(msg("packages"), fmtInt(a.meta.counts.packages)),
        kv(msg("code lines"), fmtInt(a.meta.counts.code)),
        kv(msg("methods"), fmtInt(a.meta.counts.methods)),
        kv(msg("fields"), fmtInt(a.meta.counts.fields)),
        kv(msg("lua-exposed types"), fmtInt(a.meta.counts.luaExposed)),
        kv(msg("mean type size"), msg("{0} ln", Math.round(totalCode / a.classes.length))),
        kv(msg("decompiler"), a.meta.decompiler ?? '—')
      )
    )
  );

  return cards;
}

function rankEntry(
  [id, value]: [number, number],
  fmt: (v: number) => string,
  _noop?: () => void,
  norm?: (v: number) => number
): { label: string; sub: string; value: string; bar: number; onClick: () => void } {
  const c = atlas!.byId[id];
  return {
    // nested types are shown as Outer.Inner so the name is unambiguous
    label: c ? (c.parentType ? `${c.parentType.split('.').pop()}.${c.name}` : c.name) : String(id),
    sub: c?.pkg ?? '',
    value: fmt(value),
    bar: norm ? norm(value) : 0,
    onClick: () => selectClass(id),
  };
}

function rankList<T>(
  items: T[],
  map: (t: T, i: number) => { label: string; sub: string; value: string; bar: number; onClick: () => void }
): HTMLElement {
  const max = Math.max(
    ...items.map((it) => {
      const m = map(it, 0);
      return m.bar || 1;
    }),
    1
  );
  const box = h('div');
  items.forEach((it, i) => {
    const e = map(it, i);
    box.append(
      h(
        'div',
        { class: 'rank-row', onclick: e.onClick, title: `${e.label} — ${e.sub}` },
        h('span', { class: 'rk', text: String(i + 1) }),
        h('span', { class: 'nm', text: e.label }),
        h('span', { class: 'vl', text: e.value }),
        h('span', { class: 'mini' }, h('i', { style: { width: `${Math.max(2, Math.min(100, ((e.bar || 1) / max) * 100))}%` } }))
      )
    );
  });
  return box;
}

function histo(
  rows: [string | number, number][],
  label: (k: string | number) => string,
  highlight?: (k: string | number) => boolean
): HTMLElement {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  const total = rows.reduce((s, r) => s + r[1], 0) || 1;
  const box = h('div');
  for (const [k, v] of rows) {
    box.append(
      h(
        'div',
        { class: 'rank-row', style: highlight?.(k) ? { color: 'var(--lua)' } : {} },
        h('span', { class: 'rk' }),
        h('span', { class: 'nm', text: label(k) }),
        h('span', { class: 'vl', text: `${fmtInt(v)} · ${((v / total) * 100).toFixed(v / total < 0.01 ? 2 : 1)}%` }),
        h('span', { class: 'mini' }, h('i', { style: { width: `${(v / max) * 100}%` } }))
      )
    );
  }
  return box;
}

function selectClass(id: number) {
  store.update((s) => {
    s.selection.classId = id;
    s.selection.packagePath = null;
  });
}

function card(title: string, sub: string, ...body: (HTMLElement | null)[]): HTMLElement {
  const el = h('div', { class: 'card' }, h('h3', { text: title }), h('div', { class: 'sub', text: sub }));
  for (const b of body) if (b) el.append(b);
  return el;
}

function kv(k: string, v: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(h('dt', { text: k }), h('dd', { text: v }));
  return f;
}

