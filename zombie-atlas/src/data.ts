/**
 * Data layer — loads the JSON bundle emitted by `tools/extract.mjs` and turns
 * the compact columnar records into indexed objects the views can query.
 *
 * Nothing in here is hard-coded to Project Zomboid specifics beyond the bundle
 * schema; the whole atlas is a function of the extracted data.
 */

export type Kind = 0 | 1 | 2 | 3 | 4;

export const KIND_NAMES = ['class', 'interface', 'enum', 'record', 'annotation'] as const;
export const KIND_COLORS = {
  dark: ['#4e9de0', '#59b39a', '#c9a227', '#b07fd6', '#8d8d8d'],
  light: ['#2f6fdb', '#0f8f78', '#a97208', '#8b3f9c', '#6a7488'],
};

export interface Metrics {
  types: number;
  classes: number;
  interfaces: number;
  enums: number;
  records: number;
  annotations: number;
  loc: number;
  code: number;
  comment: number;
  blank: number;
  bytes: number;
  methods: number;
  fields: number;
  complexity: number;
  branch: number;
  luaExposed: number;
  fanIn: number;
  fanOut: number;
}

export interface ClassRec {
  id: number;
  name: string;
  pkg: string;
  kind: Kind;
  code: number;
  loc: number;
  comment: number;
  blank: number;
  bytes: number;
  methods: number;
  fields: number;
  complexity: number;
  members: number;
  superIds: number[];
  ifaceIds: number[];
  subIds: number[];
  modifiers: string;
  luaExposed: boolean;
  hiddenFromLua: boolean;
  stereotype: string;
  declLine: number;
  path: string;
  parentType: string | null;
  doc: string | null;
  fanIn: number;
  fanOut: number;
  enumConstants: number;
  annotations: string[];
  /** fully qualified name including nesting (Outer.Inner) */
  fqn: string;
  /** top-level package = functional domain key */
  domain: string;
  /** true when the type is not nested inside another type */
  isTopLevel: boolean;
}

export interface PkgNode {
  name: string;
  path: string;
  metrics: Metrics | null;
  domain: string;
  children: PkgNode[];
  parent: PkgNode | null;
  /** every class id in this package and below */
  ids: number[];
  /** classes declared directly in this package */
  ownIds: number[];
}

export interface MemberRec {
  kind: 'method' | 'ctor' | 'field';
  name: string;
  type: string;
  params: string[];
  modifiers: string;
  annotations: string[];
  line: number;
  complexity: number;
  bodyLines: number;
  doc: string | null;
  throws: string[];
  init: string | null;
}

export interface Meta {
  generated: string;
  /** how the source tree is displayed (relative to the repo when possible) */
  sourceRoot: string;
  /** path segment the source tree is served under: /src/<sourceMount>/** */
  sourceMount?: string;
  sourceRootAbs?: string;
  sourceDirOrigin?: string;
  decompiler: string | null;
  counts: Record<string, number>;
  domains: Record<string, string>;
  metrics: Record<string, string>;
}

export interface DepEdge {
  from: number;
  to: number;
  w: number;
}

/** ------------------------------------------------------------------ load -- */

const cache = new Map<string, Promise<unknown>>();

function fetchJSON<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
        return r.json();
      })
    );
  }
  return cache.get(url) as Promise<T>;
}

export interface Atlas {
  meta: Meta;
  classes: ClassRec[];
  byId: ClassRec[];
  byPkg: Map<string, ClassRec[]>;
  byName: Map<string, ClassRec[]>;
  byPath: Map<string, ClassRec[]>;
  pkgRoot: PkgNode;
  pkgByPath: Map<string, PkgNode>;
  /** package path -> functional domain key */
  pkgDomain: Map<string, string>;
  /** the package that contains everything (e.g. `zombie`) */
  packageRoot: string | null;
  domains: DomainInfo[];
  pkgEdges: { from: string; to: string; w: number }[];
  /** max value per metric, used for normalisation */
  max: Record<string, number>;
}

export interface DomainInfo {
  key: string;
  label: string;
  color: string;
  metrics: Metrics;
  ids: number[];
  packages: string[];
  hubs: ClassRec[];
}

/** Categorical palette — distinguishable in both themes. */
export const PALETTE = [
  '#4e9de0', '#59b39a', '#c9a227', '#d1785b', '#b07fd6',
  '#5fb3d4', '#8fbf5f', '#e08cb0', '#7f8ce0', '#c98b3f',
  '#4fbfa8', '#d16d9e', '#9aa7b8', '#6fbf73', '#c76b6b',
  '#8ab4f8', '#e0b357', '#63c6c6', '#b58cd6', '#a8b04a',
  '#e08f5f', '#5f9ed1', '#cf7fb0', '#7fc4a0', '#c0c060',
  '#9d7fd8', '#5cc0b0', '#d9a05b', '#86a8e0', '#b8b8b8',
];

export function domainColor(domain: string, domains: DomainInfo[]): string {
  const i = domains.findIndex((d) => d.key === domain);
  return i >= 0 ? domains[i].color : PALETTE[0];
}

export async function loadAtlas(base = 'data'): Promise<Atlas> {
  const [meta, pkgTree, classFile, pkgEdgesRaw] = await Promise.all([
    fetchJSON<Meta>(`${base}/meta.json`),
    fetchJSON<PkgNode>(`${base}/packages.json`),
    fetchJSON<{ columns: string[]; rows: unknown[][] }>(`${base}/classes.json`),
    fetchJSON<[string, string, number][]>(`${base}/deps-packages.json`),
  ]);

  // The functional domain is the first package component *below* the source
  // root (all PZ code lives under `zombie.`), so `zombie.iso.areas` → `iso`.
  const topLevelPkgs = pkgTree.children.map((n) => n.name);
  const singleRoot = topLevelPkgs.length === 1 ? topLevelPkgs[0] : null;
  const domainOf = (pkg: string): string => {
    const parts = pkg.split('.');
    if (singleRoot && parts[0] === singleRoot) return parts.length > 1 ? parts[1] : singleRoot;
    return parts[0];
  };

  const C = classFile.columns;
  const idx = (n: string) => C.indexOf(n);
  const iId = idx('id');
  const iName = idx('name');
  const iPkg = idx('package');
  const iKind = idx('kind');
  const iCode = idx('code');
  const iLoc = idx('loc');
  const iComment = idx('comment');
  const iBlank = idx('blank');
  const iBytes = idx('bytes');
  const iMethods = idx('methods');
  const iFields = idx('fields');
  const iCx = idx('complexity');
  const iMembers = idx('members');
  const iSuper = idx('superIds');
  const iIface = idx('ifaceIds');
  const iSub = idx('subIds');
  const iMods = idx('modifiers');
  const iLua = idx('luaExposed');
  const iHidden = idx('hiddenFromLua');
  const iStereo = idx('stereotype');
  const iLine = idx('declLine');
  const iPath = idx('path');
  const iParent = idx('parentType');
  const iDoc = idx('doc');
  const iFanIn = idx('fanIn');
  const iFanOut = idx('fanOut');
  const iEnumConst = idx('enumConstants');
  const iAnnot = idx('annotations');

  const classes: ClassRec[] = classFile.rows.map((r) => {
    const parentType = (r[iParent] as string) ?? null;
    const name = r[iName] as string;
    const pkg = r[iPkg] as string;
    return {
      id: r[iId] as number,
      name,
      pkg,
      kind: r[iKind] as Kind,
      code: r[iCode] as number,
      loc: r[iLoc] as number,
      comment: r[iComment] as number,
      blank: r[iBlank] as number,
      bytes: r[iBytes] as number,
      methods: r[iMethods] as number,
      fields: r[iFields] as number,
      complexity: r[iCx] as number,
      members: r[iMembers] as number,
      superIds: (r[iSuper] as number[]) ?? [],
      ifaceIds: (r[iIface] as number[]) ?? [],
      subIds: (r[iSub] as number[]) ?? [],
      modifiers: (r[iMods] as string) ?? '',
      luaExposed: r[iLua] === 1,
      hiddenFromLua: r[iHidden] === 1,
      stereotype: (r[iStereo] as string) ?? 'class',
      declLine: r[iLine] as number,
      path: r[iPath] as string,
      parentType,
      doc: (r[iDoc] as string) ?? null,
      fanIn: r[iFanIn] as number,
      fanOut: r[iFanOut] as number,
      enumConstants: r[iEnumConst] as number,
      annotations: (r[iAnnot] as string[]) ?? [],
      fqn: parentType ? `${parentType}.${name}` : pkg === '(default)' ? name : `${pkg}.${name}`,
      domain: domainOf(pkg),
      isTopLevel: !parentType,
    };
  });

  const byId: ClassRec[] = new Array(classes.length);
  const byPkg = new Map<string, ClassRec[]>();
  const byName = new Map<string, ClassRec[]>();
  const byPath = new Map<string, ClassRec[]>();
  for (const c of classes) {
    byId[c.id] = c;
    push(byPkg, c.pkg, c);
    push(byName, c.name, c);
    push(byPath, c.path, c);
  }

  // ---- package tree -------------------------------------------------------
  const pkgByPath = new Map<string, PkgNode>();
  const attach = (node: PkgNode, parent: PkgNode | null) => {
    node.parent = parent;
    node.ids = [];
    node.ownIds = [];
    pkgByPath.set(node.path, node);
    for (const ch of node.children) attach(ch, node);
  };
  attach(pkgTree, null);

  for (const c of classes) {
    // walk up the package chain adding the class to every ancestor
    let p = pkgByPath.get(c.pkg);
    if (!p) {
      // package not present in the tree (should not happen): synthesise a flat node
      p = { name: c.pkg, path: c.pkg, metrics: null, domain: c.domain, children: [], parent: null, ids: [], ownIds: [] };
      pkgByPath.set(c.pkg, p);
    }
    p.ownIds.push(c.id);
    let cur: PkgNode | null = p;
    while (cur) {
      cur.ids.push(c.id);
      cur = cur.parent;
    }
  }

  // ---- domains ------------------------------------------------------------
  const domainMap = new Map<string, DomainInfo>();
  const domainKeys = [...new Set(classes.map((c) => c.domain))].sort();
  domainKeys.forEach((key, i) => {
    domainMap.set(key, {
      key,
      label: meta.domains?.[key] ?? key,
      color: PALETTE[i % PALETTE.length],
      metrics: emptyMetrics(),
      ids: [],
      packages: [],
      hubs: [],
    });
  });
  for (const c of classes) {
    const d = domainMap.get(c.domain)!;
    d.ids.push(c.id);
    addMetrics(d.metrics, c);
  }
  // (per-domain metrics are accumulated from the classes themselves, so they
  // always match what the treemap is currently showing)
  for (const d of domainMap.values()) {
    d.hubs = d.ids
      .map((id) => byId[id])
      .sort((a, b) => b.fanIn - a.fanIn)
      .slice(0, 4);
  }

  // ---- metric maxima ------------------------------------------------------
  const max: Record<string, number> = {};
  for (const k of METRIC_KEYS) {
    let m = 0;
    for (const c of classes) m = Math.max(m, metricValue(c, k));
    max[k] = m || 1;
  }

  const pkgEdges = pkgEdgesRaw.map(([from, to, w]) => ({ from, to, w }));

  const pkgDomain = new Map<string, string>();
  for (const path of pkgByPath.keys()) if (path) pkgDomain.set(path, domainOf(path));

  return {
    meta,
    classes,
    byId,
    byPkg,
    byName,
    byPath,
    pkgRoot: pkgTree,
    pkgByPath,
    pkgDomain,
    packageRoot: singleRoot,
    domains: [...domainMap.values()].sort((a, b) => b.metrics.code - a.metrics.code),
    pkgEdges,
    max,
  };
}

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

export function emptyMetrics(): Metrics {
  return {
    types: 0, classes: 0, interfaces: 0, enums: 0, records: 0, annotations: 0,
    loc: 0, code: 0, comment: 0, blank: 0, bytes: 0, methods: 0, fields: 0,
    complexity: 0, branch: 0, luaExposed: 0, fanIn: 0, fanOut: 0,
  };
}

function addMetrics(m: Metrics, c: ClassRec) {
  m.types++;
  if (c.kind === 0) m.classes++;
  else if (c.kind === 1) m.interfaces++;
  else if (c.kind === 2) m.enums++;
  else if (c.kind === 3) m.records++;
  else m.annotations++;
  m.loc += c.loc;
  m.code += c.code;
  m.comment += c.comment;
  m.blank += c.blank;
  m.bytes += c.bytes;
  m.methods += c.methods;
  m.fields += c.fields;
  m.complexity += c.complexity;
  m.luaExposed += c.luaExposed ? 1 : 0;
  m.fanIn += c.fanIn;
  m.fanOut += c.fanOut;
}

/** --------------------------------------------------------------- metrics -- */

export const METRIC_KEYS = [
  'code', 'loc', 'bytes', 'methods', 'fields', 'complexity', 'members',
  'fanIn', 'fanOut', 'luaWeight', 'density',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export function metricValue(c: ClassRec, k: MetricKey | string): number {
  switch (k) {
    case 'code': return c.code;
    case 'loc': return c.loc;
    case 'bytes': return Math.round(c.bytes / 32); // scaled so it shares a range with lines
    case 'methods': return c.methods;
    case 'fields': return c.fields;
    case 'complexity': return c.complexity;
    case 'members': return c.members;
    case 'fanIn': return c.fanIn;
    case 'fanOut': return c.fanOut;
    case 'luaWeight': return (c.luaExposed ? 40 : 0) + c.annotations.length * 4;
    case 'density': return c.code > 0 ? Math.round((c.complexity / c.code) * 1000) : 0;
    default: return c.code;
  }
}

export function pkgMetricValue(m: Metrics | null, k: MetricKey | string): number {
  if (!m) return 0;
  switch (k) {
    case 'code': return m.code;
    case 'loc': return m.loc;
    case 'bytes': return Math.round(m.bytes / 32);
    case 'methods': return m.methods;
    case 'fields': return m.fields;
    case 'complexity': return m.complexity;
    case 'members': return m.methods + m.fields;
    case 'fanIn': return m.fanIn;
    case 'fanOut': return m.fanOut;
    case 'luaWeight': return m.luaExposed * 40;
    case 'density': return m.code > 0 ? Math.round((m.complexity / m.code) * 1000) : 0;
    default: return m.code;
  }
}

/** ------------------------------------------------------------- members ---- */

const memberCache = new Map<string, Promise<Record<string, { enumConstants: unknown[]; members: unknown[][] }>>>();

export function pkgSlug(pkg: string): string {
  return pkg === '(default)' ? '_default' : pkg.replace(/\./g, '__');
}

export async function loadMembers(base: string, pkg: string): Promise<Map<number, MemberRec[]>> {
  const slug = pkgSlug(pkg);
  let pr = memberCache.get(slug);
  if (!pr) {
    pr = fetchJSON(`${base}/members/${slug}.json`) as never;
    memberCache.set(slug, pr);
  }
  const raw = await pr;
  const out = new Map<number, MemberRec[]>();
  for (const [id, payload] of Object.entries(raw)) {
    out.set(
      Number(id),
      (payload.members as unknown[][]).map((m) => ({
        kind: m[0] as MemberRec['kind'],
        name: m[1] as string,
        type: (m[2] as string) || '',
        params: (m[3] as string[]) || [],
        modifiers: (m[4] as string) || '',
        annotations: (m[5] as string[]) || [],
        line: (m[6] as number) || 0,
        complexity: (m[7] as number) || 0,
        bodyLines: (m[8] as number) || 0,
        doc: (m[9] as string) ?? null,
        throws: (m[10] as string[]) || [],
        init: (m[11] as string) ?? null,
      }))
    );
  }
  return out;
}

export async function loadClassDeps(base: string): Promise<DepEdge[]> {
  const rows = await fetchJSON<[number, number, number][]>(`${base}/deps-classes.json`);
  return rows.map(([from, to, w]) => ({ from, to, w }));
}

/** ------------------------------------------------------------- helpers ---- */

/** Direct supertypes (class + interfaces) as records. */
export function supersOf(atlas: Atlas, c: ClassRec): ClassRec[] {
  return [...c.superIds, ...c.ifaceIds].map((id) => atlas.byId[id]).filter(Boolean);
}

/** Full ancestry chain, nearest first. */
export function ancestryOf(atlas: Atlas, c: ClassRec): ClassRec[] {
  const out: ClassRec[] = [];
  const seen = new Set<number>([c.id]);
  let cur = c;
  while (cur.superIds.length) {
    const p = atlas.byId[cur.superIds[0]];
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    out.push(p);
    cur = p;
  }
  return out;
}

/** All transitive subtypes, breadth first. */
export function descendantsOf(atlas: Atlas, c: ClassRec, limit = 4000): ClassRec[] {
  const out: ClassRec[] = [];
  const seen = new Set<number>([c.id]);
  const queue = [...c.subIds];
  while (queue.length && out.length < limit) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = atlas.byId[id];
    if (!t) continue;
    out.push(t);
    queue.push(...t.subIds);
  }
  return out;
}

export function ancestorsOfPkg(path: string): string[] {
  const parts = path.split('.');
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('.'));
  return out;
}
