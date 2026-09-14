import { msg, locale } from './i18n';
/**
 * Application state: a tiny observable store with three persistence channels.
 *
 *  - `settings`   → localStorage (how the atlas is configured), validated
 *                   field-by-field on read so a stale or hand-edited payload
 *                   degrades to defaults instead of breaking the UI
 *  - `selection`  → transient (what is highlighted / inspected)
 *  - URL hash     → a compact, shareable permalink of view + zoom + metric
 *
 * Views subscribe to slice changes so a redraw only happens when the data they
 * actually depend on moved.
 */

import type { Atlas, MetricKey } from './data';
import { METRIC_KEYS } from './data';
import { RAMPS } from './util';

export type ViewId = 'treemap' | 'hierarchy' | 'dependencies' | 'subsystems' | 'insights';

export type ColorMode =
  | 'domain'
  | 'package'
  | 'kind'
  | 'stereotype'
  | 'fanIn'
  | 'fanOut'
  | 'complexity'
  | 'density'
  | 'lua'
  | 'depth';

export type GroupBy = 'package' | 'domain' | 'stereotype' | 'kind' | 'stereotype+package';

export type LayoutKind = 'squarify' | 'sliceDice' | 'binary' | 'strip';

export interface Settings {
  theme: 'dark' | 'light';
  sizeMetric: MetricKey | 'composite';
  weights: Record<string, number>;
  colorMode: ColorMode;
  palette: string;
  groupBy: GroupBy;
  layout: LayoutKind;
  depthLimit: number; // package nesting depth to expand (0 = unlimited)
  showMembers: boolean; // include a class's members as leaves
  labelMode: 'auto' | 'always' | 'never';
  padding: number;
  minShare: number; // cull nodes smaller than this share of the whole
  sort: 'size' | 'name' | 'fanIn' | 'complexity';
  filters: {
    query: string;
    kinds: number[];
    stereotypes: string[];
    domains: string[];
    luaOnly: boolean;
    minCode: number;
  };
  sidebar: boolean;
  inspector: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  sizeMetric: 'code',
  weights: { code: 1, complexity: 0, methods: 0, fanIn: 0, luaWeight: 0, bytes: 0 },
  colorMode: 'domain',
  palette: 'viridis',
  groupBy: 'package',
  layout: 'squarify',
  depthLimit: 0,
  showMembers: false,
  labelMode: 'auto',
  padding: 2,
  minShare: 0,
  sort: 'size',
  filters: {
    query: '',
    kinds: [],
    stereotypes: [],
    domains: [],
    luaOnly: false,
    minCode: 0,
  },
  sidebar: true,
  inspector: true,
};

export interface Selection {
  classId: number | null;
  packagePath: string | null;
  hoverId: number | null;
  /** zoom path for the treemap: package paths or synthetic group ids */
  zoom: string[];
}

export type DepMode = 'graph' | 'matrix' | 'classes';

export interface AppState {
  view: ViewId;
  /** sub-mode of the Dependencies view (graph / adjacency matrix / edge list) */
  depMode: DepMode;
  settings: Settings;
  selection: Selection;
  /** non-null when a search/highlight set is active */
  highlightIds: Set<number> | null;
  ready: boolean;
  atlas: Atlas | null;
  status: string;
}

type Listener = (s: AppState) => void;

const SETTINGS_KEY = 'zombie-atlas.settings.v1';
const SETTINGS_VERSION = 1;

const THEMES = ['dark', 'light'] as const;
const COLOR_MODES = [
  'domain', 'package', 'kind', 'stereotype', 'fanIn', 'fanOut', 'complexity', 'density', 'lua', 'depth',
] as const;
const GROUP_BY = ['package', 'domain', 'stereotype', 'kind', 'stereotype+package'] as const;
const LAYOUTS = ['squarify', 'sliceDice', 'binary', 'strip'] as const;
const LABEL_MODES = ['auto', 'always', 'never'] as const;
const SORTS = ['size', 'name', 'fanIn', 'complexity'] as const;
const WEIGHT_KEYS = ['code', 'complexity', 'methods', 'fanIn', 'luaWeight', 'bytes'] as const;

export interface StorageReport {
  /** `ok` = read and valid · `missing` = nothing stored · `repaired` = fixed on load · `unavailable` = no localStorage */
  status: 'ok' | 'missing' | 'repaired' | 'unavailable';
  /** human-readable list of fields that fell back to their default */
  repairs: string[];
  version: number;
}

let loadReport: StorageReport = { status: 'ok', repairs: [], version: SETTINGS_VERSION };

/** ---------------------------------------------------------- validation -- */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Build a validated Settings from arbitrary stored data, one field at a time. */
function coerceSettings(input: unknown, report: StorageReport): Settings {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!isObj(input)) {
    if (input !== undefined) report.repairs.push('root: not an object, using defaults');
    return out;
  }

  const pick = <T extends string>(key: string, allowed: readonly T[], dflt: T): T => {
    const v = input[key];
    if (v === undefined) return dflt;
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    report.repairs.push(`${key}: expected one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
    return dflt;
  };
  const bool = (key: string, dflt: boolean): boolean => {
    const v = input[key];
    if (v === undefined) return dflt;
    if (typeof v === 'boolean') return v;
    report.repairs.push(`${key}: expected boolean, got ${JSON.stringify(v)}`);
    return dflt;
  };
  const numField = (key: string, dflt: number, min: number, max: number, integer = false): number => {
    const v = input[key];
    if (v === undefined) return dflt;
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) {
      return integer ? Math.round(v) : v;
    }
    report.repairs.push(`${key}: expected a number in [${min}, ${max}], got ${JSON.stringify(v)}`);
    return dflt;
  };
  out.theme = pick('theme', THEMES, out.theme);
  const metric = input.sizeMetric;
  if (metric === undefined) {
    /* keep default */
  } else if (metric === 'composite' || (typeof metric === 'string' && (METRIC_KEYS as readonly string[]).includes(metric))) {
    out.sizeMetric = metric as Settings['sizeMetric'];
  } else {
    report.repairs.push(`sizeMetric: unknown metric ${JSON.stringify(metric)}`);
  }

  if (input.weights !== undefined) {
    if (!isObj(input.weights)) {
      report.repairs.push('weights: expected an object');
    } else {
      for (const k of WEIGHT_KEYS) {
        const v = input.weights[k];
        if (v === undefined) continue;
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) out.weights[k] = v;
        else report.repairs.push(`weights.${k}: expected a number in [0, 1], got ${JSON.stringify(v)}`);
      }
    }
  }

  out.colorMode = pick('colorMode', COLOR_MODES, out.colorMode);
  out.palette = pick('palette', Object.keys(RAMPS), out.palette);
  out.groupBy = pick('groupBy', GROUP_BY, out.groupBy);
  out.layout = pick('layout', LAYOUTS, out.layout);
  out.labelMode = pick('labelMode', LABEL_MODES, out.labelMode);
  out.sort = pick('sort', SORTS, out.sort);

  out.depthLimit = numField('depthLimit', out.depthLimit, 0, 6, true);
  out.padding = numField('padding', out.padding, 0, 8, true);
  out.minShare = numField('minShare', out.minShare, 0, 1);
  out.showMembers = bool('showMembers', out.showMembers);
  out.sidebar = bool('sidebar', out.sidebar);
  out.inspector = bool('inspector', out.inspector);

  const f = input.filters;
  if (f !== undefined && !isObj(f)) {
    report.repairs.push('filters: expected an object');
  } else if (isObj(f)) {
    const q = f.query;
    if (q === undefined) {
      /* keep default */
    } else if (typeof q === 'string') {
      out.filters.query = q.slice(0, 200);
    } else {
      report.repairs.push(`filters.query: expected a string, got ${typeof q}`);
    }

    const kinds = f.kinds;
    if (kinds !== undefined) {
      if (!Array.isArray(kinds)) {
        report.repairs.push(`filters.kinds: expected an array, got ${typeof kinds}`);
      } else {
        const valid = [...new Set(kinds.filter((k): k is number => Number.isInteger(k) && k >= 0 && k <= 4))];
        if (valid.length !== kinds.length) report.repairs.push('filters.kinds: dropped invalid entries');
        out.filters.kinds = valid;
      }
    }

    /** Read a `string[]` out of the filters object, dropping anything else. */
    const stringList = (key: string, max: number): string[] => {
      const v = f[key];
      if (v === undefined) return [];
      if (!Array.isArray(v)) {
        report.repairs.push(`filters.${key}: expected an array, got ${typeof v}`);
        return [];
      }
      const cleaned = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))];
      if (cleaned.length !== v.length) {
        report.repairs.push(`filters.${key}: dropped ${v.length - cleaned.length} invalid entr(ies)`);
      }
      return cleaned.slice(0, max);
    };
    out.filters.stereotypes = stringList('stereotypes', 100);
    out.filters.domains = stringList('domains', 200);

    const luaOnly = f.luaOnly;
    if (luaOnly === undefined) {
      /* keep default */
    } else if (typeof luaOnly === 'boolean') {
      out.filters.luaOnly = luaOnly;
    } else {
      report.repairs.push(`filters.luaOnly: expected boolean, got ${typeof luaOnly}`);
    }

    const minCode = f.minCode;
    if (minCode !== undefined) {
      if (typeof minCode === 'number' && Number.isFinite(minCode) && minCode >= 0) out.filters.minCode = Math.round(minCode);
      else report.repairs.push(`filters.minCode: expected a non-negative number, got ${JSON.stringify(minCode)}`);
    }
  }

  return out;
}

/**
 * Read persisted settings.
 *
 * Anything unreadable, missing or invalid falls back to the documented default
 * for that field — a hand-edited or truncated payload can never wedge the UI.
 * The caller normally writes the result straight back (see `Store.saveSettings`),
 * so storage is repaired on the next pass.
 */
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      loadReport = { status: 'missing', repairs: [], version: SETTINGS_VERSION };
      return structuredClone(DEFAULT_SETTINGS);
    }
    const parsed: unknown = JSON.parse(raw);
    const report: StorageReport = {
      status: 'ok',
      repairs: [],
      version: isObj(parsed) && typeof parsed.version === 'number' ? parsed.version : SETTINGS_VERSION,
    };
    const settings = coerceSettings(parsed, report);
    if (report.version !== SETTINGS_VERSION) {
      report.repairs.push(`payload version ${report.version} != ${SETTINGS_VERSION}: validated field by field`);
    }
    report.status = report.repairs.length ? 'repaired' : 'ok';
    loadReport = report;
    return settings;
  } catch {
    loadReport = { status: 'unavailable', repairs: ['localStorage is not readable'], version: SETTINGS_VERSION };
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export class Store {
  state: AppState = {
    view: 'treemap',
    depMode: 'graph',
    settings: loadSettings(),
    selection: { classId: null, packagePath: null, hoverId: null, zoom: [] },
    highlightIds: null,
    ready: false,
    atlas: null,
    status: '',
  };

  private listeners = new Set<Listener>();
  private pending = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Batch multiple mutations into one notification. */
  update(fn: (s: AppState) => void, opts: { silent?: boolean; url?: boolean } = {}) {
    fn(this.state);
    if (opts.url !== false) this.syncUrl();
    if (!opts.silent) this.emit();
  }

  private emit() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      for (const l of this.listeners) l(this.state);
    });
  }

  /** What happened the last time persisted settings were read. */
  get storage(): StorageReport {
    return loadReport;
  }

  saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...this.state.settings, version: SETTINGS_VERSION })
      );
      // A successful write means storage now holds a valid, current payload.
      if (loadReport.status !== 'unavailable') {
        loadReport = { ...loadReport, status: 'ok', repairs: [], version: SETTINGS_VERSION };
      }
    } catch {
      loadReport = { status: 'unavailable', repairs: ['localStorage is not writable'], version: SETTINGS_VERSION };
    }
  }

  /**
   * Discard stored settings and write the documented defaults back.
   * Reachable from the sidebar ("Restore defaults") and from the console via
   * `zombieAtlas.store.resetSettings()`.
   */
  resetSettings() {
    this.state.settings = structuredClone(DEFAULT_SETTINGS);
    this.saveSettings();
    this.syncUrl();
    this.emit();
  }

  /** ------------------------------------------------------------- URL ---- */

  syncUrl() {
    const { view, settings: s, selection } = this.state;
    const p = new URLSearchParams();
    p.set('v', view);
    if (s.sizeMetric !== DEFAULT_SETTINGS.sizeMetric) p.set('m', s.sizeMetric);
    if (s.colorMode !== DEFAULT_SETTINGS.colorMode) p.set('c', s.colorMode);
    if (s.groupBy !== DEFAULT_SETTINGS.groupBy) p.set('g', s.groupBy);
    if (s.layout !== DEFAULT_SETTINGS.layout) p.set('l', s.layout);
    if (s.theme !== DEFAULT_SETTINGS.theme) p.set('t', s.theme);
    if (s.depthLimit) p.set('d', String(s.depthLimit));
    if (s.showMembers) p.set('mm', '1');
    if (this.state.depMode !== 'graph') p.set('dm', this.state.depMode);
    if (s.filters.query) p.set('q', s.filters.query);
    if (s.filters.luaOnly) p.set('lua', '1');
    if (s.filters.domains.length) p.set('dom', s.filters.domains.join(','));
    if (s.filters.kinds.length) p.set('k', s.filters.kinds.join(','));
    if (s.filters.stereotypes.length) p.set('st', s.filters.stereotypes.join(','));
    if (selection.zoom.length) p.set('z', selection.zoom.join('|'));
    if (selection.classId != null) p.set('sel', String(selection.classId));
    if (selection.packagePath) p.set('pkg', selection.packagePath);
    if (s.filters.minCode) p.set('min', String(s.filters.minCode));
    const hash = p.toString();
    const url = `${location.pathname}${location.search}${hash ? '#' + hash : ''}`;
    history.replaceState(null, '', url);
  }

  /** Apply a permalink (called once on boot and on hashchange). */
  applyUrl(atlas: Atlas) {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (![...p.keys()].length) return;
    const s = this.state.settings;
    const num = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
    const view = p.get('v') as ViewId | null;
    if (view && ['treemap', 'hierarchy', 'dependencies', 'subsystems', 'insights'].includes(view)) {
      this.state.view = view;
    }
    const dm = p.get('dm');
    if (dm === 'graph' || dm === 'matrix' || dm === 'classes') this.state.depMode = dm;
    const m = p.get('m');
    if (m && (m === 'composite' || (METRIC_KEYS as readonly string[]).includes(m))) s.sizeMetric = m as MetricKey;
    const c = p.get('c');
    if (c) s.colorMode = c as Settings['colorMode'];
    const g = p.get('g');
    if (g) s.groupBy = g as Settings['groupBy'];
    const l = p.get('l');
    if (l) s.layout = l as Settings['layout'];
    const t = p.get('t');
    if (t === 'dark' || t === 'light') {
      s.theme = t;
      document.documentElement.dataset.theme = t;
    }
    const d = num('d');
    if (d != null) s.depthLimit = d;
    if (p.get('mm') === '1') s.showMembers = true;
    if (p.get('q')) s.filters.query = p.get('q')!;
    if (p.get('lua') === '1') s.filters.luaOnly = true;
    if (p.get('dom')) s.filters.domains = p.get('dom')!.split(',').filter(Boolean);
    if (p.get('k')) s.filters.kinds = p.get('k')!.split(',').map(Number).filter((n) => !isNaN(n));
    if (p.get('st')) s.filters.stereotypes = p.get('st')!.split(',').filter(Boolean);
    if (p.get('z')) this.state.selection.zoom = p.get('z')!.split('|').filter(Boolean);
    const minCode = num('min');
    if (minCode != null && Number.isFinite(minCode) && minCode >= 0) s.filters.minCode = minCode;
    const pkg = p.get('pkg');
    if (pkg && atlas.pkgByPath.has(pkg)) this.state.selection.packagePath = pkg;
    const sel = num('sel');
    if (sel != null && atlas.byId[sel]) this.state.selection.classId = sel;
  }
}

export const store = new Store();

/** ------------------------------------------------------------- filtering -- */

export interface FilterResult {
  /** ids passing every filter */
  ids: Set<number>;
  /** ids matching the text query only (used for highlighting) */
  matched: Set<number> | null;
  total: number;
}

/**
 * Apply the active filters to the class list.
 * The text query is matched against class name, package, member names (when
 * loaded) and stereotypes.
 */
export function applyFilters(
  atlas: Atlas,
  s: Settings,
  memberNames?: Map<number, string[]>
): FilterResult {
  const f = s.filters;
  const q = f.query.trim().toLowerCase();
  const ids = new Set<number>();
  let matched: Set<number> | null = null;
  if (q) matched = new Set();

  const domainSet = f.domains.length ? new Set(f.domains) : null;
  const kindSet = f.kinds.length ? new Set(f.kinds) : null;
  const stereoSet = f.stereotypes.length ? new Set(f.stereotypes) : null;

  for (const c of atlas.classes) {
    if (f.luaOnly && !c.luaExposed) continue;
    if (domainSet && !domainSet.has(c.domain)) continue;
    if (kindSet && !kindSet.has(c.kind)) continue;
    if (stereoSet && !stereoSet.has(c.stereotype)) continue;
    if (f.minCode && c.code < f.minCode) continue;

    if (q) {
      const hay = `${c.name} ${c.fqn} ${c.pkg} ${c.stereotype} ${c.annotations.join(' ')}`.toLowerCase();
      let hit = hay.includes(q);
      if (!hit && memberNames) {
        const names = memberNames.get(c.id);
        if (names) hit = names.some((n) => n.includes(q));
      }
      if (matched) {
        if (hit) matched.add(c.id);
      }
      if (!hit) continue;
    }
    ids.add(c.id);
  }
  return { ids, matched, total: atlas.classes.length };
}

/** Text used by the search box: classes + packages + member index. */
export interface SearchHit {
  type: 'class' | 'package' | 'member';
  id?: number;
  name: string;
  sub: string;
  meta: string;
  score: number;
}

export function searchAtlas(atlas: Atlas, q: string, limit = 40): SearchHit[] {
  const query = q.trim().toLowerCase();
  if (query.length < 1) return [];
  const hits: SearchHit[] = [];

  for (const c of atlas.classes) {
    const name = c.name.toLowerCase();
    const fqn = c.fqn.toLowerCase();
    let score = 0;
    if (name === query) score = 100;
    else if (name.startsWith(query)) score = 80 - name.length * 0.01;
    else if (name.includes(query)) score = 60;
    else if (fqn.includes(query)) score = 40;
    if (score > 0) {
      hits.push({
        type: 'class',
        id: c.id,
        name: c.name,
        sub: c.fqn,
        meta: msg("{0} ln", c.code.toLocaleString(locale)),
        score: score + Math.min(10, c.fanIn / 100),
      });
    }
  }

  for (const [path, node] of atlas.pkgByPath) {
    if (!path) continue;
    const name = node.name.toLowerCase();
    if (name === query || path.toLowerCase().includes(query)) {
      hits.push({
        type: 'package',
        name: node.name,
        sub: path,
        meta: msg("{0} types", node.ownIds.length),
        score: name === query ? 95 : 35,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
