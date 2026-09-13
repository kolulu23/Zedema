/**
 * Inspector — the right-hand detail panel.
 *
 * Shows whatever is selected: a class (metrics, doc, ancestry, subtypes,
 * members, coupling) or a package group (aggregates, contents, coupling).
 * Falls back to a project overview when nothing is selected.
 */

import {
  type Atlas,
  type ClassRec,
  type MemberRec,
  type PkgNode,
  loadMembers,
  loadClassDeps,
  ancestryOf,
  descendantsOf,
  KIND_NAMES,
} from '../data';
import { store, type AppState } from '../state';
import { $, fmtBytes, fmtCompact, fmtInt, h } from '../util';
import { openSource } from './source';

const KIND_BADGE = ['C', 'I', 'E', 'R', '@'];

let atlas: Atlas | null = null;
let deps: { out: Map<number, { id: number; w: number }[]>; in: Map<number, { id: number; w: number }[]> } | null = null;
let depsLoading = false;
let memberCache = new Map<number, MemberRec[]>();
let memberFilter = '';

export function initInspector(a: Atlas) {
  atlas = a;
  document.getElementById('inspector-body')!.addEventListener('click', onBodyClick);
}

export function setMemberCache(m: Map<number, MemberRec[]>) {
  memberCache = m;
}

function ensureDeps() {
  if (deps || depsLoading || !atlas) return;
  depsLoading = true;
  loadClassDeps('data').then((edges) => {
    const out = new Map<number, { id: number; w: number }[]>();
    const inc = new Map<number, { id: number; w: number }[]>();
    for (const e of edges) {
      push(out, e.from, { id: e.to, w: e.w });
      push(inc, e.to, { id: e.from, w: e.w });
    }
    for (const arr of out.values()) arr.sort((a, b) => b.w - a.w);
    for (const arr of inc.values()) arr.sort((a, b) => b.w - a.w);
    deps = { out, in: inc };
    render(store.state);
  });
}

function push<T>(m: Map<number, T[]>, k: number, v: T) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

let memberLoadInFlight: number | null = null;

async function ensureMembersFor(classId: number) {
  if (!atlas || memberLoadInFlight === classId) return;
  memberLoadInFlight = classId;
  try {
    const shard = await loadMembers('data', atlas.byId[classId].pkg);
    for (const [id, list] of shard) memberCache.set(id, list);
  } catch {
    /* shard missing: the panel simply shows no member list */
  } finally {
    memberLoadInFlight = null;
    render(store.state);
  }
}

function onBodyClick(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  const act = el.dataset.act!;
  const id = el.dataset.id ? Number(el.dataset.id) : null;
  const pkg = el.dataset.pkg ?? null;
  switch (act) {
    case 'class':
      store.update((s) => {
        s.selection.classId = id;
        s.selection.packagePath = null;
      });
      break;
    case 'pkg':
      store.update((s) => {
        s.selection.packagePath = pkg;
        s.selection.classId = null;
      });
      break;
    case 'zoom-pkg':
      store.update((s) => {
        s.view = 'treemap';
        s.selection.zoom = pkg ? pkg.split('.').map((_, i, arr) => `p:${arr.slice(0, i + 1).join('.')}`) : [];
        s.selection.packagePath = pkg;
      });
      break;
    case 'source':
      if (id != null && atlas) openSource(atlas.byId[id]);
      break;
    case 'focus':
      if (id != null) {
        store.update((s) => {
          s.view = 'hierarchy';
          s.selection.classId = id;
        });
      }
      break;
    case 'clear-filter':
      memberFilter = '';
      render(store.state);
      break;
  }
}

export function render(state: AppState) {
  const body = $('#inspector-body');
  if (!atlas) return;
  const { classId, packagePath } = state.selection;
  if (classId != null && atlas.byId[classId]) {
    // Members are sharded per package: fetch the shard for whatever is selected
    // (treemap click, search hit, hierarchy node, insight row — all of them).
    if (!memberCache.has(classId)) void ensureMembersFor(classId);
    body.replaceChildren(classPanel(atlas.byId[classId]));
    ensureDeps();
  } else if (packagePath && atlas.pkgByPath.get(packagePath)) {
    body.replaceChildren(pkgPanel(atlas.pkgByPath.get(packagePath)!));
  } else {
    memberFilter = '';
    body.replaceChildren(overviewPanel());
  }
}

/** ------------------------------------------------------------- class view -- */

function classPanel(c: ClassRec): HTMLElement {
  const wrap = h('div');
  const kids = (c.subIds ?? []).map((id) => atlas!.byId[id]).filter(Boolean);
  const chain = ancestryOf(atlas!, c).reverse();
  const allDesc = c.subIds.length ? descendantsOf(atlas!, c) : [];

  wrap.append(
    h(
      'div',
      { class: 'insp-title' },
      h('span', { class: 'kinddot', style: { background: 'var(--accent)' } }),
      h('h1', { text: c.name }),
      h('span', { class: 'badge', text: KIND_NAMES[c.kind] }),
      c.luaExposed ? h('span', { class: 'badge', style: { color: 'var(--lua)', borderColor: 'var(--lua)' }, text: 'Lua API' }) : null,
      c.hiddenFromLua ? h('span', { class: 'badge', text: '@HiddenFromLua' }) : null
    )
  );
  wrap.append(h('div', { class: 'insp-path', text: `${c.fqn}${c.parentType ? '  (nested)' : ''}` }));
  if (c.doc) wrap.append(h('div', { class: 'insp-doc', text: c.doc }));

  wrap.append(
    h(
      'div',
      { class: 'stage-actions', style: { marginBottom: '10px' } },
      h('button', { 'data-act': 'source', 'data-id': c.id, text: 'View source' }),
      h('button', { 'data-act': 'focus', 'data-id': c.id, text: 'Show in hierarchy' }),
      h('button', {
        text: 'Copy FQN',
        onclick: () => navigator.clipboard?.writeText(c.fqn),
      })
    )
  );

  // ---- metrics
  wrap.append(
    section(
      'Metrics',
      h(
        'dl',
        { class: 'kv' },
        kv('kind', `${KIND_NAMES[c.kind]} · ${c.stereotype}`),
        kv('source lines', fmtInt(c.loc)),
        kv('code lines', fmtInt(c.code)),
        kv('comment lines', fmtInt(c.comment)),
        kv('file size', fmtBytes(c.bytes)),
        kv('declared at', `${c.path}:${c.declLine}`),
        kv('methods', fmtInt(c.methods)),
        kv('fields', fmtInt(c.fields)),
        c.enumConstants ? kv('enum constants', String(c.enumConstants)) : null,
        kv('complexity', fmtInt(c.complexity)),
        kv('fan-in / fan-out', `${fmtInt(c.fanIn)} / ${fmtInt(c.fanOut)}`),
        kv('modifiers', c.modifiers || '—')
      )
    )
  );

  // ---- hierarchy
  const chainEl = h('div', { class: 'link-list' });
  if (!chain.length) chainEl.append(h('div', { class: 'empty', text: 'No internal superclass (root type)' }));
  for (const a of chain) {
    chainEl.append(linkRow(a, `${KIND_BADGE[a.kind]} ${a.fqn}`));
  }
  chainEl.append(linkRow(c, `→ ${c.fqn}`, true));

  const subEl = h('div', { class: 'link-list' });
  if (!kids.length) subEl.append(h('div', { class: 'empty', text: 'No direct subtypes' }));
  for (const k of kids.sort((a, b) => b.code - a.code)) {
    subEl.append(linkRow(k, `${KIND_BADGE[k.kind]} ${k.name}`, false, k.luaExposed ? 'lua' : `${fmtCompact(k.code)} ln`));
  }

  wrap.append(
    section(
      `Hierarchy${allDesc.length ? ` · ${allDesc.length} transitive subtypes` : ''}`,
      chainEl,
      kids.length ? h('h3', { style: { marginTop: '8px' }, text: 'Direct subtypes' }) : null,
      kids.length ? subEl : null
    )
  );

  // ---- members
  const members = memberCache.get(c.id);
  const memSection = h('div', { class: 'insp-section' });
  if (!members) {
    memSection.append(h('h3', { text: 'Members' }), h('div', { class: 'empty', text: 'loading…' }));
  } else {
    const f = memberFilter.toLowerCase();
    const shown = f
      ? members.filter((m) => `${m.name} ${m.type} ${m.params.join(' ')} ${m.annotations.join(' ')}`.toLowerCase().includes(f))
      : members;
    const methods = shown.filter((m) => m.kind !== 'field');
    const fields = shown.filter((m) => m.kind === 'field');
    memSection.append(
      h(
        'h3',
        {},
        'Members ',
        h('span', { class: 'count', text: `${shown.length}/${members.length}` }),
        h('input', {
          type: 'text',
          placeholder: 'filter…',
          value: memberFilter,
          style: { marginLeft: 'auto', width: '120px', padding: '1px 5px', fontSize: '11px' },
          oninput: (e: Event) => {
            memberFilter = (e.target as HTMLInputElement).value;
            render(store.state);
            const inp = document.querySelector<HTMLInputElement>('#inspector-body input[placeholder="filter…"]');
            inp?.focus();
          },
        })
      )
    );
    if (methods.length) {
      memSection.append(h('h3', { style: { marginTop: '8px' }, text: `Methods (${methods.length})` }));
      const list = h('div', { class: 'member-list' });
      for (const m of methods.slice(0, 400)) list.append(memberRow(m));
      memSection.append(list);
    }
    if (fields.length) {
      memSection.append(h('h3', { style: { marginTop: '8px' }, text: `Fields (${fields.length})` }));
      const list = h('div', { class: 'member-list' });
      for (const m of fields.slice(0, 300)) list.append(memberRow(m));
      memSection.append(list);
    }
    if (!shown.length) memSection.append(h('div', { class: 'empty', text: 'No members match the filter' }));
  }
  wrap.append(memSection);

  // ---- coupling
  if (deps) {
    const out = (deps.out.get(c.id) ?? []).slice(0, 14);
    const inc = (deps.in.get(c.id) ?? []).slice(0, 14);
    const outEl = h('div', { class: 'link-list' });
    for (const e of out) {
      const t = atlas!.byId[e.id];
      if (t) outEl.append(linkRow(t, t.fqn, false, `×${e.w}`));
    }
    const inEl = h('div', { class: 'link-list' });
    for (const e of inc) {
      const t = atlas!.byId[e.id];
      if (t) inEl.append(linkRow(t, t.fqn, false, `×${e.w}`));
    }
    wrap.append(
      section(
        'Coupling',
        h('h3', { text: `Depends on (${deps.out.get(c.id)?.length ?? 0})` }),
        out.length ? outEl : h('div', { class: 'empty', text: 'nothing' }),
        h('h3', { style: { marginTop: '8px' }, text: `Used by (${deps.in.get(c.id)?.length ?? 0})` }),
        inc.length ? inEl : h('div', { class: 'empty', text: 'nothing' })
      )
    );
  }
  return wrap;
}

function memberRow(m: MemberRec): HTMLElement {
  const lua = m.annotations.includes('UsedFromLua');
  const sig = h('span', { class: 'sig' });
  if (m.kind === 'field') {
    sig.append(h('span', { class: 'm-type', text: `${m.type} ` }), h('span', { class: 'm-name', text: m.name }));
    if (m.init) sig.append(h('span', { class: 'm-type', text: ` = ${m.init}` }));
  } else {
    sig.append(
      h('span', { class: 'm-type', text: m.type ? `${m.type} ` : '' }),
      h('span', { class: 'm-name', text: m.name }),
      h('span', { class: 'm-params', text: `(${m.params.join(', ')})` })
    );
  }
  const badges = h('span', { style: { display: 'flex', gap: '4px' } });
  if (m.complexity > 12) badges.append(h('span', { class: 'badge cx', text: `cx ${m.complexity}` }));
  if (lua) badges.append(h('span', { class: 'badge lua', text: 'lua' }));
  const row = h('div', { class: `member${lua ? ' lua' : ''}`, title: `${m.modifiers} · line ${m.line}${m.doc ? `\n\n${m.doc}` : ''}` }, sig, badges);
  return row;
}

function linkRow(c: ClassRec, label: string, current = false, right?: string): HTMLElement {
  return h(
    'div',
    { class: 'link', 'data-act': 'class', 'data-id': c.id, title: c.fqn },
    h('span', { class: 'kinddot', style: { background: `var(--accent${current ? '' : '-2'})`, opacity: current ? 1 : 0.75 } }),
    h('span', { class: 'nm', text: label }),
    right ? h('span', { class: 'sub', text: right }) : null
  );
}

/** ----------------------------------------------------------- package view -- */

function pkgPanel(p: PkgNode): HTMLElement {
  const wrap = h('div');
  const m = p.metrics;
  wrap.append(h('div', { class: 'insp-title' }, h('h1', { text: p.name })));
  wrap.append(h('div', { class: 'insp-path', text: p.path }));
  wrap.append(
    h(
      'div',
      { class: 'stage-actions', style: { marginBottom: '10px' } },
      h('button', { 'data-act': 'zoom-pkg', 'data-pkg': p.path, text: 'Zoom treemap here' }),
      h('button', { 'data-act': 'clear-filter', text: 'Clear' })
    )
  );
  if (m) {
    wrap.append(
      section(
        'Package metrics',
        h(
          'dl',
          { class: 'kv' },
          kv('types', fmtInt(m.types)),
          kv('classes / ifaces', `${m.classes} / ${m.interfaces}`),
          kv('enums / records', `${m.enums} / ${m.records}`),
          kv('code lines', fmtInt(m.code)),
          kv('methods', fmtInt(m.methods)),
          kv('fields', fmtInt(m.fields)),
          kv('complexity', fmtInt(m.complexity)),
          kv('lua-exposed', String(m.luaExposed)),
          kv('cross-pkg fan-in', fmtInt(m.fanIn)),
          kv('cross-pkg fan-out', fmtInt(m.fanOut))
        )
      )
    );
  }
  const kids = [...p.children].sort((a, b) => (b.metrics?.code ?? 0) - (a.metrics?.code ?? 0));
  if (kids.length) {
    const list = h('div', { class: 'link-list' });
    for (const k of kids) {
      list.append(
        h(
          'div',
          { class: 'link', 'data-act': 'pkg', 'data-pkg': k.path },
          h('span', { class: 'kinddot', style: { background: 'var(--accent)' } }),
          h('span', { class: 'nm', text: k.name }),
          h('span', { class: 'sub', text: `${k.ownIds.length} types · ${fmtCompact(k.metrics?.code ?? 0)} ln` })
        )
      );
    }
    wrap.append(section(`Sub-packages (${kids.length})`, list));
  }

  const own = p.ownIds.map((id) => atlas!.byId[id]).sort((a, b) => b.code - a.code);
  const list = h('div', { class: 'link-list' });
  for (const c of own.slice(0, 60)) list.append(linkRow(c, c.name, false, `${fmtCompact(c.code)} ln`));
  wrap.append(section(`Types here (${own.length})`, own.length ? list : h('div', { class: 'empty', text: 'none' })));
  return wrap;
}

/** ---------------------------------------------------------- overview view -- */

function overviewPanel(): HTMLElement {
  const a = atlas!;
  const wrap = h('div');
  const c = a.meta.counts;
  wrap.append(h('div', { class: 'insp-title' }, h('h1', { text: 'Project overview' })));
  wrap.append(h('div', { class: 'insp-path', text: `${a.meta.sourceRoot} · ${a.meta.decompiler ?? ''}` }));
  wrap.append(
    section(
      'Extracted from source',
      h(
        'dl',
        { class: 'kv' },
        kv('files', fmtInt(c.files)),
        kv('types', fmtInt(c.types)),
        kv('packages', fmtInt(c.packages)),
        kv('code lines', fmtInt(c.code)),
        kv('total lines', fmtInt(c.loc)),
        kv('methods', fmtInt(c.methods)),
        kv('fields', fmtInt(c.fields)),
        kv('lua-exposed types', fmtInt(c.luaExposed)),
        kv('lua-exposed members', fmtInt(c.luaMembers)),
        kv('class refs', fmtInt(c.classEdges)),
        kv('package refs', fmtInt(c.pkgEdges)),
        kv('source size', fmtBytes(c.bytes))
      )
    )
  );
  const top = [...a.classes].sort((x, y) => y.code - x.code).slice(0, 10);
  const list = h('div', { class: 'link-list' });
  for (const t of top) list.append(linkRow(t, t.fqn, false, `${fmtCompact(t.code)} ln`));
  wrap.append(section('Largest types', list));
  wrap.append(
    section(
      'Tips',
      h('div', { class: 'empty', text: 'Click any rectangle to inspect it. Double-click a package to zoom, right-click to zoom out. Press / to search, ? for help.' })
    )
  );
  return wrap;
}

function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  const el = h('div', { class: 'insp-section' }, h('h3', { text: title }));
  for (const c of children) if (c) el.append(c);
  return el;
}

function kv(k: string, v: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(h('dt', { text: k }), h('dd', { text: v }));
  return f;
}

