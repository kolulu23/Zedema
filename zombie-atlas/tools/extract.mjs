/**
 * zombie-atlas extractor
 * ----------------------
 * Parses the decompiled Project Zomboid source tree (`zombie/`) into a compact
 * JSON bundle consumed by the SPA in `src/`.
 *
 * Everything the atlas shows is derived from the source itself: package
 * structure, type hierarchy, members, javadoc, annotations and the import /
 * fully-qualified-name reference graph.
 *
 * Usage:  node tools/extract.mjs [--src <dir>] [--out <dir>] [--pretty]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs, resolveDataOut, resolveSourceDir } from './lib/config.mjs';
import {
  maskSource,
  braceDepth,
  lineIndex,
  lineOf,
  splitTopLevel,
  splitAnnotations,
  splitModifiers,
  stripTypeParams,
  readType,
  readSupertypes,
  normalizeTypeRef,
  simpleName,
} from './lib/java-lexer.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// args / configuration
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
let PRETTY = argv.includes("--pretty");
let QUIET = argv.includes('--quiet');
const { src: cliSrc, out: cliOut } = parseCommonArgs(argv);

/** Resolved lazily so the module can be imported without touching the disk. */
let SRC = null;
function source() {
  if (!SRC) SRC = resolveSourceDir(cliSrc);
  return SRC;
}
const SRC_DIR = () => source().dir;
const MOUNT = () => source().mount;
let OUT_DIR = resolveDataOut(cliOut);

let t0 = Date.now();

// ---------------------------------------------------------------------------
// file discovery
// ---------------------------------------------------------------------------
/** @returns {string[]} absolute paths of every .java file, sorted */
function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.endsWith('.java')) out.push(p);
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// per-file parsing
// ---------------------------------------------------------------------------

const TYPE_KEYWORD = /(?:^|[^\w$.])(?:@interface|class|interface|enum|record)\s+[A-Za-z_$][\w$]*/g;
const DECL_RE = /(@interface|class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/;

const BRANCH_RE = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?(?![?.])/g;

/**
 * Parse one Java source file into zero or more type records.
 * @param {string} absPath
 * @returns {{types: any[], file: any}}
 */
export function parseFile(absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const rel = `${MOUNT()}/${path.relative(SRC_DIR(), absPath).split(path.sep).join('/')}`;
  const { masked, comments } = maskSource(src);
  const depth = braceDepth(masked);
  const lineStarts = lineIndex(src);

  const pkgMatch = /(?:^|\n)\s*package\s+([\w.]+)\s*;/.exec(masked);
  const pkg = pkgMatch ? pkgMatch[1] : '(default)';

  // ---- imports ------------------------------------------------------------
  const imports = [];
  const importRe = /(?:^|\n)\s*import\s+(static\s+)?([\w.$*]+)\s*;/g;
  let im;
  while ((im = importRe.exec(masked))) {
    imports.push({ static: !!im[1], name: im[2] });
  }

  // ---- file level line accounting ----------------------------------------
  // Prefix sums let every (possibly nested) type be charged exactly its own
  // line span, so package totals never double count a nested class.
  const lines = src.split('\n');
  const maskedLines = masked.split('\n');
  const nLines = lines.length;
  const cumBlank = new Int32Array(nLines + 1);
  const cumComment = new Int32Array(nLines + 1);
  for (let i = 0; i < nLines; i++) {
    const isBlank = !lines[i].trim();
    const isComment = !isBlank && !maskedLines[i].trim();
    cumBlank[i + 1] = cumBlank[i] + (isBlank ? 1 : 0);
    cumComment[i + 1] = cumComment[i] + (isComment ? 1 : 0);
  }
  /** Line stats for an inclusive 1-based line range. */
  const rangeStats = (from, to) => {
    const lo = Math.max(1, Math.min(from, nLines));
    const hi = Math.max(lo, Math.min(to, nLines));
    const total = hi - lo + 1;
    const bl = cumBlank[hi] - cumBlank[lo - 1];
    const cm = cumComment[hi] - cumComment[lo - 1];
    return { loc: total, blank: bl, commentOnly: cm, code: total - bl - cm };
  };
  const bytesOfRange = (from, to) => {
    const lo = Math.max(1, Math.min(from, nLines));
    const hi = Math.max(lo, Math.min(to, nLines));
    return Buffer.byteLength(lines.slice(lo - 1, hi).join('\n'), 'utf8');
  };
  const blank = cumBlank[nLines];
  const commentOnly = cumComment[nLines];
  const loc = nLines;
  const code = loc - blank - commentOnly;

  // ---- types --------------------------------------------------------------
  const types = [];
  const stack = []; // enclosing types by body range
  TYPE_KEYWORD.lastIndex = 0;
  let m;
  while ((m = TYPE_KEYWORD.exec(masked))) {
    const decl = DECL_RE.exec(masked.slice(m.index));
    const kwStart = m.index + m[0].indexOf(decl[1]);
    const nameStart = kwStart + decl[1].length + 1;
    const nameEnd = nameStart + decl[2].length;

    // Declaration start: back up over annotations and modifiers.
    let declStart = m.index;
    {
      let j = declStart;
      while (j > 0 && !';{}'.includes(masked[j - 1])) j--;
      // keep the javadoc/annotation run attached to this declaration
      const prevEnd = j;
      while (prevEnd < declStart && /\s/.test(masked[prevEnd])) {
        // only whitespace between the previous statement and the declaration
        break;
      }
      declStart = j;
    }

    // Body braces (annotations precede the type name, so scanning forward from
    // the name is safe).
    let bodyStart = -1;
    for (let i = nameEnd; i < masked.length; i++) {
      const c = masked[i];
      if (c === '{') {
        bodyStart = i;
        break;
      }
      if (c === ';') break; // malformed / annotation-array false positive
    }
    if (bodyStart < 0) continue;
    // `depth[i]` counts braces opened *before* i, so the brace that closes this
    // body is the first `}` seen while sitting one level inside it.
    const outerDepth = depth[bodyStart];
    const bodyDepth = outerDepth + 1;
    let bodyEnd = bodyStart + 1;
    for (let i = bodyStart + 1; i < masked.length; i++) {
      if (masked[i] === '}' && depth[i] === bodyDepth) {
        bodyEnd = i;
        break;
      }
    }

    // Pop finished enclosing types.
    while (stack.length && stack[stack.length - 1].bodyEnd < bodyStart) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;

    const header = masked.slice(declStart, bodyStart);
    const { annotations, rest } = splitAnnotations(header);
    const { modifiers, rest: afterMods } = splitModifiers(rest);
    // Drop the `class Name<T>` head so only the heritage clause is inspected.
    const declHead = afterMods.replace(
      /^\s*(?:@interface|class|interface|enum|record)\s+[A-Za-z_$][\w$]*/,
      ''
    );
    const supertypes = readSupertypes(stripTypeParams(declHead).rest);

    const firstToken = (() => {
      const m2 = /[@\w$]/.exec(masked.slice(declStart, bodyStart));
      return m2 ? declStart + m2.index : declStart;
    })();

    const rec = {
      kind: decl[1] === '@interface' ? 'annotation' : decl[1],
      name: decl[2],
      fqn: parent ? `${parent.fqn}.${decl[2]}` : pkg === '(default)' ? decl[2] : `${pkg}.${decl[2]}`,
      package: pkg,
      parentType: parent ? parent.fqn : null,
      path: rel,
      declLine: lineOf(lineStarts, declStart),
      bodyStart,
      bodyEnd,
      modifiers,
      annotations: annotations.map((a) => a.replace(/^@/, '').split('(')[0]),
      rawAnnotations: annotations,
      extends: supertypes.extends,
      implements: supertypes.implements,
      permits: supertypes.permits,
      members: [],
      enumConstants: [],
      doc: findDoc(comments, src, firstToken),
      loc,
      code,
      commentOnly,
      blank,
      bytes: Buffer.byteLength(src, 'utf8'),
      fileImports: imports,
    };

    parseMembers(rec, { src, masked, depth, lineStarts });
    // Nested types are charged only their own span; the outermost type owns the
    // whole file (imports, license header, trailing comments included).
    rec.endLine = lineOf(lineStarts, bodyEnd);
    if (parent) {
      const st = rangeStats(rec.declLine, rec.endLine);
      rec.loc = st.loc;
      rec.blank = st.blank;
      rec.commentOnly = st.commentOnly;
      rec.code = st.code;
      rec.bytes = bytesOfRange(rec.declLine, rec.endLine);
    }
    stack.push(rec);
    types.push(rec);
    // Resume just inside the body: nested types must still be discovered.
    TYPE_KEYWORD.lastIndex = bodyStart + 1;
  }

  return {
    types,
    file: { path: rel, pkg, loc, code, commentOnly, blank, bytes: Buffer.byteLength(src, 'utf8'), imports, typeCount: types.length },
  };
}

/** Nearest preceding javadoc block comment, with only whitespace in between. */
function findDoc(comments, src, declStart) {
  let best = null;
  for (const c of comments) {
    // Only whitespace and annotation lines may sit between doc and declaration.
    if (c.end <= declStart && /^[\s@\w$.,()\[\]"'\-]*$/.test(src.slice(c.end, declStart))) best = c;
    if (c.start > declStart) break;
  }
  if (!best || !best.doc) return null;
  return cleanDoc(best.text);
}

function cleanDoc(text) {
  return text
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

/**
 * Walk a type body at member depth and extract fields, constructors, methods,
 * nested-type placeholders and enum constants.
 */
function parseMembers(rec, ctx) {
  const { src, masked, depth, lineStarts } = ctx;
  const bodyDepth = depth[rec.bodyStart] + 1;
  let i = rec.bodyStart + 1;
  const end = rec.bodyEnd;

  // --- enum constants ------------------------------------------------------
  if (rec.kind === 'enum') {
    let j = i;
    for (;;) {
      while (j < end && /[\s,]/.test(masked[j])) j++;
      if (masked[j] === ';' || masked[j] === '}' || j >= end) break;
      const constStart = j;
      // leading annotations on constants
      while (masked[j] === '@') {
        j++; // '@'
        while (j < end && /[\w$.]/.test(masked[j])) j++;
        if (masked[j] === '(') j = skipBalanced(masked, j, '(', ')');
        while (j < end && /\s/.test(masked[j])) j++;
      }
      while (j < end && /\s/.test(masked[j])) j++;
      const nm = /^[A-Za-z_$][\w$]*/.exec(masked.slice(j, j + 200));
      if (!nm) break;
      const constName = nm[0];
      j += constName.length;
      while (j < end && /\s/.test(masked[j])) j++;
      let argCount = 0;
      if (masked[j] === '(') {
        const close = skipBalanced(masked, j, '(', ')');
        argCount = splitTopLevel(masked.slice(j + 1, close - 1)).length;
        j = close;
      }
      while (j < end && /\s/.test(masked[j])) j++;
      let hasBody = false;
      if (masked[j] === '{') {
        hasBody = true;
        j = skipBalanced(masked, j, '{', '}');
      }
      rec.enumConstants.push({
        name: constName,
        argCount,
        hasBody,
        line: lineOf(lineStarts, constStart),
        endLine: lineOf(lineStarts, Math.max(constStart, j - 1)),
        doc: null,
      });
      while (j < end && /\s/.test(masked[j])) j++;
      if (masked[j] === ',') {
        j++;
        continue;
      }
      break;
    }
    i = j;
    if (masked[i] === ';') i++;
  }

  // --- members -------------------------------------------------------------
  let guard = 0;
  while (i < end && guard++ < 20000) {
    // skip whitespace and stray separators
    while (i < end && /[\s;]/.test(masked[i])) i++;
    if (i >= end) break;

    const start = i;
    let j = i;
    let nested = 0; // (), [], <> nesting for the header
    let angle = 0;
    let terminator = -1;
    let termKind = null;
    while (j < end) {
      const c = masked[j];
      if (c === '(' || c === '[') nested++;
      else if (c === ')' || c === ']') nested = Math.max(0, nested - 1);
      else if (c === '<') angle++;
      else if (c === '>') angle = Math.max(0, angle - 1);
      else if (nested === 0 && angle === 0 && depth[j] === bodyDepth) {
        if (c === ';') {
          terminator = j;
          termKind = 'semi';
          break;
        }
        if (c === '{') {
          terminator = j;
          termKind = 'brace';
          break;
        }
        if (c === '}') {
          terminator = j;
          termKind = 'end';
          break;
        }
      }
      j++;
    }
    if (termKind === null || termKind === 'end') break;

    const headerRaw = masked.slice(start, terminator);
    let memberEnd = terminator;
    if (termKind === 'brace') {
      memberEnd = skipBalanced(masked, terminator, '{', '}');
    }

    // A nested type body: already captured by the type walker, record a stub
    // only if this is not one (the walker emits nested types separately).
    const headerTrim = headerRaw.trim();
    if (headerTrim && !/^static\s*\{$/.test(headerTrim)) {
      const member = describeMember(headerTrim, rec, src, masked, lineStarts, start, terminator, memberEnd, bodyDepth, depth);
      if (member) rec.members.push(member);
    }

    i = memberEnd + (termKind === 'brace' ? 1 : 1);
  }
}

/** Skip a balanced pair starting at `open`, returning index just past the close. */
function skipBalanced(s, openIdx, open, close) {
  let d = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === open) d++;
    else if (s[i] === close) {
      d--;
      if (d === 0) return i + 1;
    }
  }
  return s.length;
}

function describeMember(headerTrim, rec, src, masked, lineStarts, start, terminator, memberEnd, bodyDepth, depth) {
  const { annotations, rest } = splitAnnotations(headerTrim);
  const { modifiers, rest: afterMods } = splitModifiers(rest);
  const line = lineOf(lineStarts, start);
  const doc = null; // filled in later pass for members (kept light on purpose)

  const isNestedType = /(?:^|\s)(?:class|interface|enum|record|@interface)\s/.test(
    ' ' + afterMods.replace(/^[\w$.<>,\[\]\s]*\s/, '')
  ) || /^(?:class|interface|enum|record|@interface)\s/.test(afterMods.trim()) ||
    /(?:^|\s)(?:class|interface|enum|record)\s+[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*(?:extends|implements|$|\{)/.test(afterMods);

  if (isNestedType) return null; // represented by its own type record

  // A member whose initialiser contains a call is still a field:
  //   `private final Comparator<X> c = new Comparator<X>() { ... };`
  // Decide by position — a `=` before the first `(` means field, not method.
  const parenIdx = afterMods.indexOf('(');
  const eqIdx = indexOfTopLevel(afterMods, '=');
  const isField = eqIdx >= 0 && (parenIdx < 0 || eqIdx < parenIdx) && !/^\s*(?:class|interface|enum|record)\b/.test(afterMods);
  const isCallable = !isField && parenIdx >= 0 && terminator > start;

  if (!isCallable) {
    // ---- field(s) ---------------------------------------------------------
    const body = afterMods.trim().replace(/;$/, '');
    const eq = indexOfTopLevel(body, '=');
    const declPart = (eq >= 0 ? body.slice(0, eq) : body).trim();
    const initPart = eq >= 0 ? body.slice(eq + 1).trim() : null;
    const { type, rest: namesPart } = readType(declPart);
    if (!type) return null;
    const names = splitTopLevel(namesPart)
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.replace(/^.*\s/, '').replace(/[[\]]/g, ''));
    const fieldLines = masked.slice(start, memberEnd).split('\n').length - 1;
    return {
      k: 'field',
      name: names[0] || '?',
      bodyLines: fieldLines,
      extraNames: names.slice(1),
      type: normalizeTypeRef(type),
      rawType: type,
      modifiers,
      annotations: annotations.map((a) => a.split('(')[0].replace('@', '')),
      line,
      init: initPart ? initPart.slice(0, 160) : null,
      enumConst: false,
    };
  }

  // ---- method / constructor ----------------------------------------------
  // A constructor has no return type: `readType` would otherwise swallow the
  // constructor name as if it were a type and the whole member would be lost.
  const { rest: afterTypeParams } = stripTypeParams(afterMods);
  const isCtor = new RegExp(`^\\s*${rec.name.replace(/[$]/g, '\\$')}\\s*\\(`).test(afterTypeParams);

  let name;
  let returnType;
  let afterReturn;
  let openParen;
  if (isCtor) {
    name = rec.name;
    returnType = '';
    afterReturn = afterTypeParams;
    openParen = afterTypeParams.indexOf('(');
  } else if (!afterTypeParams.includes('(')) {
    // record compact constructor: `public Foo { ... }`
    if (afterTypeParams.trim() !== rec.name) return null;
    name = rec.name;
    returnType = '';
    afterReturn = `${rec.name}()`;
    openParen = afterReturn.indexOf('(');
  } else {
    const read = readType(afterTypeParams);
    returnType = read.type;
    afterReturn = read.rest;
    const nameMatch = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(afterReturn);
    if (!nameMatch) return null;
    name = nameMatch[1];
    openParen = afterReturn.indexOf('(', nameMatch.index);
  }

  const closeParen = skipBalanced(afterReturn, openParen, '(', ')') - 1;
  if (closeParen < openParen) return null;
  const paramsRaw = afterReturn.slice(openParen + 1, closeParen);
  const tail = afterReturn.slice(closeParen + 1);
  const throwsMatch = /\bthrows\b([^{]*)/.exec(tail);

  const isConstructor = isCtor || (name === rec.name && !returnType);
  const params = splitTopLevel(paramsRaw).map((p) => {
    const t = p.trim();
    const nm = /([A-Za-z_$][\w$]*)\s*$/.exec(t);
    const { type } = readType(t.replace(/^\s*(?:final\s+)?/, ''));
    return { name: nm ? nm[1] : '', type: normalizeTypeRef(type || t) };
  });

  const bodySlice = masked.slice(terminator + 1, memberEnd - 1);
  BRANCH_RE.lastIndex = 0;
  let branch = 0;
  while (BRANCH_RE.exec(bodySlice)) branch++;
  const bodyLines = bodySlice ? bodySlice.split('\n').length - 1 : 0;

  return {
    k: isConstructor ? 'ctor' : 'method',
    name,
    type: isConstructor ? null : normalizeTypeRef(returnType),
    rawType: isConstructor ? null : returnType,
    params,
    paramCount: params.length,
    throws: throwsMatch ? splitTopLevel(throwsMatch[1]).map((s) => normalizeTypeRef(s)) : [],
    modifiers,
    annotations: annotations.map((a) => a.split('(')[0].replace('@', '')),
    line,
    branch,
    complexity: 1 + branch,
    bodyLines,
    abstract: modifiers.includes('abstract') || terminator > 0 && masked[terminator] === ';',
    enumConst: false,
  };
}

function indexOfTopLevel(s, ch) {
  let angle = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<') angle++;
    else if (c === '>') angle--;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ch && angle <= 0 && depth <= 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// classification helpers (all source-derived)
// ---------------------------------------------------------------------------

/** Stereotype inferred from the declaration itself. */
function stereotype(t) {
  const n = t.name;
  if (t.annotations.includes('UsedFromLua')) return 'lua-api';
  if (t.kind === 'interface') return 'interface';
  if (t.kind === 'enum') return 'enum';
  if (t.kind === 'record') return 'record';
  if (t.kind === 'annotation') return 'annotation';
  if (/(?:Exception|Error)$/.test(n)) return 'exception';
  if (/^(?:I|Abstract)/.test(n) && t.modifiers.includes('abstract')) return 'abstraction';
  if (/Manager$/.test(n)) return 'manager';
  if (/Packet$/.test(n)) return 'packet';
  if (/(?:UI|Panel|Window|Dialog|Widget|Element|Screen)$/.test(n)) return 'ui';
  if (/(?:Factory|Builder|Builder$|Provider)$/.test(n)) return 'factory';
  if (/(?:Util|Utils|Helper|Tools)$/.test(n)) return 'utility';
  if (/(?:Event|Listener|Callback|Handler)$/.test(n)) return 'event';
  if (/(?:Test|Debug)$/.test(n)) return 'debug';
  if (t.modifiers.includes('abstract')) return 'abstract';
  if (/(?:Info|Data|State|Type|Config|Options|Settings|Descriptor|Definition)$/.test(n)) return 'data';
  return 'class';
}

/** Coarse functional domain, taken from the owning top-level package. */
const DOMAINS = {
  zombie: 'Root / engine singletons',
  ai: 'AI & NPC behaviour',
  asset: 'Asset loading',
  audio: 'Audio & sound',
  basements: 'Basement generation',
  buildingRooms: 'Building room definitions',
  characterTextures: 'Character texture assembly',
  characters: 'Characters, players, zombies, moods, skills',
  chat: 'Chat & messaging',
  combat: 'Combat resolution',
  commands: 'Player/admin commands',
  config: 'Configuration & key bindings',
  core: 'Engine core: maths, rendering, threads, files, logging',
  creative: 'Creative mode tools',
  debug: 'Debug tooling & inspectors',
  entity: 'Entity component system',
  erosion: 'World erosion over time',
  fileSystem: 'File system access',
  fireFighting: 'Fire simulation & firefighting',
  gameStates: 'Game state machine (menus, loading, in-game)',
  gizmo: 'Gizmo / editor manipulators',
  globalObjects: 'Global object registry',
  input: 'Input handling',
  interfaces: 'Shared interfaces / callbacks',
  inventory: 'Items, containers, inventory',
  iso: 'Isometric world: cells, squares, objects, rendering',
  Lua: 'Lua <-> Java bridge (Kahlua)',
  meta: 'Meta world: map events, story, zones',
  modding: 'Mod loading',
  network: 'Multiplayer networking, packets, sync',
  pathfind: 'Pathfinding',
  popman: 'Population manager, zombie spawning',
  pot: 'Procedural object toolkit (POTUS)',
  profanity: 'Profanity filter',
  radio: 'Radio & TV media',
  randomizedWorld: 'Randomised world generation',
  sandbox: 'Sandbox option definitions',
  savefile: 'Save/load serialisation',
  scripting: 'Script (zedscript) parsing & object model',
  seams: 'Seam / boundary handling',
  seating: 'Seat & vehicle position logic',
  spnetwork: 'Singleplayer network emulation',
  spriteModel: 'Sprite model / attachments',
  statistics: 'Statistics & telemetry',
  text: 'Text & translation',
  tileDepth: 'Tile depth sorting',
  ui: 'UI widgets & HUD',
  util: 'Generic utilities',
  vehicleNetworkSound: 'Vehicle network sound sync',
  vehicleSound: 'Vehicle sound engine',
  vehicles: 'Vehicles & parts',
  viewCone: 'Vision cones',
  vispoly: 'Visibility polygons',
  world: 'World generation & map data',
  worldMap: 'In-game world map',
  '(default)': 'Default package',
};

function domainOf(pkg) {
  // PZ code all lives under the `zombie` root package, so the functional domain
  // is the first component *below* it (`zombie.iso.areas` -> `iso`).
  const parts = pkg.split('.');
  if (parts[0] === 'zombie') return parts.length > 1 ? parts[1] : 'zombie';
  return parts[0];
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

/**
 * Parse the whole tree and write the JSON bundle.
 *
 * @param {{src?: string, out?: string, pretty?: boolean}} [opts]
 * @returns {Promise<{files:number, types:number, out:string, src:string, mount:string}>}
 */
export async function runExtraction(opts = {}) {
  if (opts.out) OUT_DIR = path.resolve(process.cwd(), opts.out);
  if (opts.pretty !== undefined) PRETTY = opts.pretty;
  if (opts.quiet !== undefined) QUIET = opts.quiet;
  if (opts.src) SRC = resolveSourceDir(opts.src);
  t0 = Date.now();
  const srcDir = SRC_DIR();
  const mount = MOUNT();
  if (process.env.ATLAS_PARSE_ONLY) {
    const { types } = parseFile(path.resolve(process.env.ATLAS_PARSE_ONLY));
    console.log(JSON.stringify(types.map((t) => ({ ...t, members: t.members.slice(0, 6), memberCount: t.members.length })), null, 1));
    process.exit(0);
  }

  const files = walk(srcDir);
  if (!QUIET) process.stderr.write(`[extract] ${files.length} java files under ${srcDir} (mount: ${mount})\n`);

  const allTypes = [];
  const fileRecords = [];
  for (const f of files) {
    try {
      const { types, file } = parseFile(f);
      fileRecords.push(file);
      for (const t of types) allTypes.push(t);
    } catch (err) {
      process.stderr.write(`[extract] FAILED ${f}: ${err.stack}\n`);
    }
  }
  if (!QUIET) process.stderr.write(`[extract] parsed ${allTypes.length} types in ${Date.now() - t0}ms\n`);

  // ---- index classes ---------------------------------------------------------
  const classByFqn = new Map();
  allTypes.forEach((t, i) => {
    t.id = i;
    classByFqn.set(t.fqn, t);
  });
  // package-name -> class ids
  const byPackage = new Map();
  for (const t of allTypes) {
    if (!byPackage.has(t.package)) byPackage.set(t.package, []);
    byPackage.get(t.package).push(t.id);
  }

  // global simple-name index (name -> class ids)
  const bySimple = new Map();
  for (const t of allTypes) {
    if (!bySimple.has(t.name)) bySimple.set(t.name, []);
    bySimple.get(t.name).push(t.id);
  }

  /**
   * Resolve a type reference to an internal class id, or null when the reference
   * points outside the decompiled tree or is genuinely ambiguous.
   * @param {string} ref
   * @param {string} [pkg] owning package, used to break ties
   */
  function resolveRef(ref, pkg, imports, ownerPath) {
    const bare = normalizeTypeRef(ref);
    if (!bare) return null;
    if (classByFqn.has(bare)) return classByFqn.get(bare).id;
    if (classByFqn.has('zombie.' + bare)) return classByFqn.get('zombie.' + bare).id;
    // A plain name is most reliably resolved through the file's own imports.
    if (!bare.includes('.') && imports) {
      for (const raw of imports) {
        const imp = typeof raw === 'string' ? raw : raw.name;
        if (imp.endsWith('.' + bare)) {
          const c = classByFqn.get(imp);
          if (c) return c.id;
        }
        if (imp.endsWith('.*')) {
          const c = classByFqn.get(imp.slice(0, -1) + bare);
          if (c) return c.id;
        }
      }
    }
    if (bare.includes('.')) {
      // `Outer.Inner` written from inside the same package: qualify it directly.
      const samePkg = classByFqn.get(`${pkg}.${bare}`);
      if (samePkg) return samePkg.id;
      // ...or relative to an imported outer type (`IsoGridSquare.GetSquare`).
      if (imports) {
        for (const raw of imports) {
          const imp = typeof raw === 'string' ? raw : raw.name;
          const outer = imp.split('.').pop();
          if (outer && bare.startsWith(outer + '.')) {
            const c = classByFqn.get(imp + bare.slice(outer.length));
            if (c) return c.id;
          }
        }
      }
      // `zombie.foo.Bar` style reference emitted without an import
      const cands = bySimple.get(simpleName(bare));
      if (cands && cands.length === 1) return cands[0];
      if (cands && pkg) {
        const same = cands.filter((id) => allTypes[id].package === pkg);
        if (same.length === 1) return same[0];
      }
      return null;
    }
    const cands = bySimple.get(bare);
    if (!cands) return null;
    if (cands.length === 1) return cands[0];
    if (ownerPath) {
      // a sibling nested type in the same compilation unit is the best candidate
      const sameFile = cands.filter((id) => allTypes[id].path === ownerPath);
      if (sameFile.length === 1) return sameFile[0];
    }
    if (pkg) {
      const same = cands.filter((id) => allTypes[id].package === pkg);
      if (same.length === 1) return same[0];
    }
    const root = cands.filter((id) => allTypes[id].package === 'zombie');
    if (root.length === 1) return root[0];
    const nested = cands.filter((id) => allTypes[id].parentType === null);
    if (nested.length === 1) return nested[0];
    return null;
  }

  /** Resolve a simple name using imports + same package, for member type refs. */
  function resolveSimple(name, pkg, imports, samePkgIndex) {
    if (!name) return null;
    const direct = classByFqn.get(name);
    if (direct) return direct.id;
    const same = samePkgIndex.get(name);
    if (same !== undefined) return same;
    for (const raw of imports) {
      const imp = typeof raw === 'string' ? raw : raw.name;
      if (imp.endsWith('.' + name)) {
        const c = classByFqn.get(imp);
        if (c) return c.id;
      }
      if (imp.endsWith('.*')) {
        const c = classByFqn.get(imp.slice(0, -1) + name);
        if (c) return c.id;
      }
    }
    return null;
  }

  // simple-name index per package (classes that are the only bearer of that name
  // in their package win; ambiguous names are dropped as unreliable).
  const pkgSimpleIndex = new Map();
  for (const [pkg, ids] of byPackage) {
    const m = new Map();
    const counts = new Map();
    for (const id of ids) {
      const s = allTypes[id].name;
      counts.set(s, (counts.get(s) || 0) + 1);
      m.set(s, id);
    }
    for (const [s, c] of counts) if (c > 1) m.delete(s);
    pkgSimpleIndex.set(pkg, m);
  }

  // ---- dependency graph ------------------------------------------------------
  const classEdges = new Map(); // "from>to" -> weight
  const addEdge = (from, to) => {
    if (from === to) return;
    const k = from * 100000 + to;
    classEdges.set(k, (classEdges.get(k) || 0) + 1);
  };

  for (const t of allTypes) {
    // Imports belong to the *file*: attributing the whole import list to every
    // nested type would give each inner class the fan-out of its outer class.
    // Nested types still get edges from the type references in their own members.
    if (t.parentType) continue;
    const imports = t.fileImports;
    for (const imp of imports) {
      if (imp.static) continue;
      if (imp.name.endsWith('.*')) {
        const ids = byPackage.get(imp.name.slice(0, -2));
        if (ids) for (const id of ids) addEdge(t.id, id);
        continue;
      }
      const c = classByFqn.get(imp.name);
      if (c) addEdge(t.id, c.id);
    }
  }

  // ---- fully-qualified references -------------------------------------------
  // The decompiler writes `zombie.foo.Bar` inline whenever a plain name would be
  // ambiguous, so those references are real coupling the import graph never sees.
  // Each hit is attributed to the innermost type whose body contains it.
  {
    const typesByPath = new Map();
    for (const t of allTypes) {
      if (!typesByPath.has(t.path)) typesByPath.set(t.path, []);
      typesByPath.get(t.path).push(t);
    }
    const FQN_RE = /\bzombie(?:\.[A-Za-z_$][\w$]*)+/g;
    let fqnEdges = 0;
    for (const abs of files) {
      const rel = `${MOUNT()}/${path.relative(SRC_DIR(), abs).split(path.sep).join('/')}`;
      const owners = typesByPath.get(rel);
      if (!owners || !owners.length) continue;
      const { masked } = maskSource(fs.readFileSync(abs, 'utf8'));
      FQN_RE.lastIndex = 0;
      let m;
      while ((m = FQN_RE.exec(masked))) {
        // resolve to the longest prefix that names a known type
        let name = m[0];
        let target = classByFqn.get(name);
        while (!target && name.includes('.')) {
          name = name.slice(0, name.lastIndexOf('.'));
          target = classByFqn.get(name);
        }
        if (!target) continue;
        let owner = null;
        for (const t of owners) {
          if (m.index > t.bodyStart && m.index < t.bodyEnd) {
            if (!owner || t.bodyEnd - t.bodyStart < owner.bodyEnd - owner.bodyStart) owner = t;
          }
        }
        if (!owner || owner.id === target.id) continue;
        addEdge(owner.id, target.id);
        fqnEdges++;
      }
    }
    if (!QUIET) process.stderr.write(`[extract] ${fqnEdges} fully-qualified references resolved\n`);
  }

  const incoming = new Map();
  const outgoing = new Map();
  for (const k of classEdges.keys()) {
    const from = Math.floor(k / 100000);
    const to = k % 100000;
    if (!outgoing.has(from)) outgoing.set(from, new Set());
    outgoing.get(from).add(to);
    if (!incoming.has(to)) incoming.set(to, new Set());
    incoming.get(to).add(from);
  }

  // ---- supertypes ------------------------------------------------------------
  for (const t of allTypes) {
    t.superIds = t.extends.map((r) => resolveRef(r, t.package, t.fileImports, t.path)).filter((x) => x !== null && x !== undefined);
    t.ifaceIds = t.implements.map((r) => resolveRef(r, t.package, t.fileImports, t.path)).filter((x) => x !== null && x !== undefined);
    t.subIds = [];
  }
  for (const t of allTypes) {
    for (const s of [...t.superIds, ...t.ifaceIds]) allTypes[s].subIds.push(t.id);
  }

  // ---- member refinements ----------------------------------------------------
  const LUA_ANNOT = 'UsedFromLua';
  const HIDDEN_ANNOT = 'HiddenFromLua';

  for (const t of allTypes) {
    t.methods = t.members.filter((m) => m.k === 'method' || m.k === 'ctor');
    t.fields = t.members.filter((m) => m.k === 'field');
    t.branch = t.methods.reduce((a, m) => a + (m.branch || 0), 0);
    t.complexity = t.methods.reduce((a, m) => a + (m.complexity || 0), 0);
    t.luaMethods = t.methods.filter((m) => m.annotations.includes(LUA_ANNOT)).length;
    t.luaFields = t.fields.filter((m) => m.annotations.includes(LUA_ANNOT)).length;
    t.luaExposed = t.annotations.includes(LUA_ANNOT) || t.luaMethods > 0 || t.luaFields > 0;
    t.hiddenFromLua = t.annotations.includes(HIDDEN_ANNOT);
    t.doc = t.doc || null;
    t.docSummary = t.doc ? t.doc.split('\n').find((l) => l.trim()) || null : null;
    t.stereotype = stereotype(t);
    // resolve member type references for the "uses types" panel
    const idx = pkgSimpleIndex.get(t.package) || new Map();
    const refs = new Set();
    for (const m of t.members) {
      const cand = [m.type, ...(m.params || []).map((p) => p.type)];
      for (const c of cand) {
        const id = resolveSimple(simpleName(normalizeTypeRef(c || '')), t.package, t.fileImports, idx);
        if (id !== null && id !== undefined && id !== t.id) refs.add(id);
      }
    }
    t.typeRefIds = [...refs];
    for (const id of t.typeRefIds) addEdge(t.id, id);
    t.fanOut = outgoing.get(t.id) ? outgoing.get(t.id).size : 0;
    t.fanIn = incoming.get(t.id) ? incoming.get(t.id).size : 0;
    t.memberCount = t.members.length;
    t.weight = codeWeight(t);
  }

  function codeWeight(t) {
    return t.code;
  }

  // ---- package tree ----------------------------------------------------------
  const pkgMetrics = new Map(); // pkg -> aggregate
  function blankAgg(name) {
    return {
      name,
      classes: 0,
      interfaces: 0,
      enums: 0,
      records: 0,
      annotations: 0,
      loc: 0,
      code: 0,
      comment: 0,
      blank: 0,
      bytes: 0,
      methods: 0,
      fields: 0,
      complexity: 0,
      branch: 0,
      luaExposed: 0,
      fanIn: 0,
      fanOut: 0,
      ids: [],
    };
  }
  for (const t of allTypes) {
    const parts = t.package === '(default)' ? ['(default)'] : t.package.split('.');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('.');
      if (!pkgMetrics.has(p)) pkgMetrics.set(p, blankAgg(p));
      const a = pkgMetrics.get(p);
      a.ids.push(t.id);
      a.loc += t.loc;
      a.code += t.code;
      a.comment += t.commentOnly;
      a.blank += t.blank;
      a.bytes += t.bytes;
      a.methods += t.methods.length;
      a.fields += t.fields.length;
      a.complexity += t.complexity;
      a.branch += t.branch;
      if (t.luaExposed) a.luaExposed++;
      if (t.kind === 'class') a.classes++;
      else if (t.kind === 'interface') a.interfaces++;
      else if (t.kind === 'enum') a.enums++;
      else if (t.kind === 'record') a.records++;
      else a.annotations++;
    }
    // fan in/out are per class; package aggregates sum them (documented as such)
  }

  // package-level dependency edges
  const pkgEdge = new Map();
  for (const k of classEdges.keys()) {
    const from = Math.floor(k / 100000);
    const to = k % 100000;
    const fp = allTypes[from].package;
    const tp = allTypes[to].package;
    if (fp === tp) continue;
    const kk = fp + '\u0000' + tp;
    pkgEdge.set(kk, (pkgEdge.get(kk) || 0) + 1);
  }

  // roll fanIn/fanOut to packages
  const pkgFanIn = new Map();
  const pkgFanOut = new Map();
  for (const [kk, w] of pkgEdge) {
    const [fp, tp] = kk.split('\u0000');
    for (const anc of ancestorsOf(fp)) pkgFanOut.set(anc, (pkgFanOut.get(anc) || 0) + w);
    for (const anc of ancestorsOf(tp)) pkgFanIn.set(anc, (pkgFanIn.get(anc) || 0) + w);
  }
  function ancestorsOf(p) {
    const parts = p.split('.');
    const out = [];
    for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('.'));
    return out;
  }
  for (const [p, a] of pkgMetrics) {
    a.fanOut = pkgFanOut.get(p) || 0;
    a.fanIn = pkgFanIn.get(p) || 0;
  }

  // build nested tree
  const pkgTree = { name: '__root__', path: '', children: [] };
  const pkgNodeByPath = new Map([['', pkgTree]]);
  for (const p of [...pkgMetrics.keys()].sort()) {
    const parts = p.split('.');
    let parentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const cur = parts.slice(0, i + 1).join('.');
      if (!pkgNodeByPath.has(cur)) {
        const node = { name: parts[i], path: cur, children: [] };
        pkgNodeByPath.set(cur, node);
        pkgNodeByPath.get(parentPath).children.push(node);
      }
      parentPath = cur;
    }
  }
  // attach aggregates (without ids) to nodes
  function attach(node) {
    const agg = pkgMetrics.get(node.path);
    node.metrics = agg
      ? {
          classes: agg.classes,
          interfaces: agg.interfaces,
          enums: agg.enums,
          records: agg.records,
          annotations: agg.annotations,
          loc: agg.loc,
          code: agg.code,
          comment: agg.comment,
          blank: agg.blank,
          bytes: agg.bytes,
          methods: agg.methods,
          fields: agg.fields,
          complexity: agg.complexity,
          branch: agg.branch,
          luaExposed: agg.luaExposed,
          fanIn: agg.fanIn,
          fanOut: agg.fanOut,
          types: agg.ids.length,
        }
      : null;
    node.domain = node.path ? domainOf(node.path) : 'root';
    for (const c of node.children) attach(c);
  }
  attach(pkgTree);
  for (const n of pkgNodeByPath.values()) if (n !== pkgTree) n.children.sort((a, b) => a.name.localeCompare(b.name));

  // ---- emit ------------------------------------------------------------------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'members'), { recursive: true });

  const write = (rel, obj) => {
    const p = path.join(OUT_DIR, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, PRETTY ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
    const sz = fs.statSync(p).size;
    if (!QUIET) process.stderr.write(`[extract] wrote ${rel} (${(sz / 1024).toFixed(1)} KB)\n`);
    return sz;
  };

  // classes.json : compact columnar records
  const classRows = allTypes.map((t) => [
    t.id,
    t.name,
    t.package,
    { class: 0, interface: 1, enum: 2, record: 3, annotation: 4 }[t.kind] ?? 0,
    t.code,
    t.loc,
    t.commentOnly,
    t.blank,
    t.bytes,
    t.methods.length,
    t.fields.length,
    t.complexity,
    t.memberCount,
    t.superIds,
    t.ifaceIds,
    t.subIds,
    t.modifiers.join(' '),
    t.luaExposed ? 1 : 0,
    t.hiddenFromLua ? 1 : 0,
    t.stereotype,
    t.declLine,
    t.path,
    t.parentType,
    t.docSummary,
    t.fanIn,
    t.fanOut,
    t.enumConstants.length,
    t.annotations,
  ]);
  const CLASS_COLS = [
    'id',
    'name',
    'package',
    'kind',
    'code',
    'loc',
    'comment',
    'blank',
    'bytes',
    'methods',
    'fields',
    'complexity',
    'members',
    'superIds',
    'ifaceIds',
    'subIds',
    'modifiers',
    'luaExposed',
    'hiddenFromLua',
    'stereotype',
    'declLine',
    'path',
    'parentType',
    'doc',
    'fanIn',
    'fanOut',
    'enumConstants',
    'annotations',
  ];

  // members/<slug>.json : { <classId>: [members...] }
  const slugOf = (p) => (p === '(default)' ? '_default' : p.replace(/\./g, '__'));
  const membersByPkg = new Map();
  for (const t of allTypes) {
    const slug = slugOf(t.package);
    if (!membersByPkg.has(slug)) membersByPkg.set(slug, {});
    membersByPkg.get(slug)[t.id] = {
      enumConstants: t.enumConstants,
      members: t.members.map((m) => [
        m.k,
        m.name,
        m.type || '',
        (m.params || []).map((p) => `${p.type} ${p.name}`.trim()),
        m.modifiers.join(' '),
        m.annotations,
        m.line,
        m.complexity || 0,
        m.bodyLines || 0,
        m.doc || null,
        m.throws || [],
        m.init || null,
      ]),
    };
  }
  const MEMBER_COLS = ['kind', 'name', 'type', 'params', 'modifiers', 'annotations', 'line', 'complexity', 'bodyLines', 'doc', 'throws', 'init'];
  for (const [slug, payload] of membersByPkg) write(`members/${slug}.json`, payload);

  const meta = {
    generated: new Date().toISOString(),
    sourceRoot: source().display,
  sourceMount: MOUNT(),
    sourceRootAbs: SRC_DIR(),
  sourceDirOrigin: source().origin,
    decompiler: (() => {
      const f = files[0];
      if (!f) return null;
      const line = fs.readFileSync(f, 'utf8').split('\n', 1)[0];
      return line.replace(/^\/\/\s*/, '');
    })(),
    counts: {
      files: fileRecords.length,
      types: allTypes.length,
      packages: pkgMetrics.size,
      classEdges: classEdges.size,
      pkgEdges: pkgEdge.size,
      loc: allTypes.reduce((a, t) => a + t.loc, 0),
      code: allTypes.reduce((a, t) => a + t.code, 0),
      bytes: allTypes.reduce((a, t) => a + t.bytes, 0),
      methods: allTypes.reduce((a, t) => a + t.methods.length, 0),
      fields: allTypes.reduce((a, t) => a + t.fields.length, 0),
      luaExposed: allTypes.filter((t) => t.luaExposed).length,
      luaMembers: allTypes.reduce((a, t) => a + t.luaMethods + t.luaFields, 0),
    },
    domains: DOMAINS,
    classColumns: CLASS_COLS,
    memberColumns: MEMBER_COLS,
    metrics: {
      code: 'Non-blank, non-comment source lines',
      loc: 'Total source lines',
      bytes: 'File size in bytes',
      methods: 'Declared methods + constructors',
      fields: 'Declared fields',
      complexity: 'Sum of 1 + branch points (if/for/while/case/catch/&&/||/?:)',
      members: 'Methods + fields + enum constants',
      fanIn: 'Distinct classes in the tree that reference this class',
      fanOut: 'Distinct classes in the tree this class references',
      luaExposed: 'Types carrying @UsedFromLua',
    },
  };

  write('meta.json', meta);
  write('packages.json', pkgTree);
  write('classes.json', { columns: CLASS_COLS, rows: classRows });
  write('hierarchy.json', {
    roots: allTypes.filter((t) => t.superIds.length === 0 && t.ifaceIds.length === 0).map((t) => t.id),
  });
  write(
    'deps-packages.json',
    [...pkgEdge.entries()]
      .map(([k, w]) => {
        const [from, to] = k.split('\u0000');
        return [from, to, w];
      })
      .sort((a, b) => b[2] - a[2])
  );
  write('deps-classes.json', [...classEdges.entries()].map(([k, w]) => [Math.floor(k / 100000), k % 100000, w]));

  // ---- insights.json: precomputed rankings the UI would otherwise have to scan
  // the whole member space for.
  const allMethods = [];
  for (const t of allTypes) {
    for (const m of t.methods) {
      if (m.kind === 'ctor') continue;
      allMethods.push({
        classId: t.id,
        name: m.name,
        type: m.type,
        params: (m.params || []).map((p) => p.type),
        complexity: m.complexity,
        branch: m.branch,
        bodyLines: m.bodyLines,
        line: m.line,
        path: t.path,
        pkg: t.package,
        cls: t.name,
        annotations: m.annotations,
      });
    }
  }
  const topMethods = allMethods
    .filter((m) => m.bodyLines >= 12)
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 120);

  const histogram = (values) => {
    const m = new Map();
    for (const v of values) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const rank = (fn, n = 40) =>
    [...allTypes].sort((a, b) => fn(b) - fn(a)).slice(0, n).map((t) => [t.id, Math.round(fn(t) * 100) / 100]);

  const pkgPairs = [...pkgEdge.entries()]
    .map(([k, w]) => {
      const [from, to] = k.split('\u0000');
      return [from, to, w];
    })
    .sort((a, b) => b[2] - a[2])
    .slice(0, 120);

  write('insights.json', {
    topMethods,
    top: {
      code: rank((t) => t.code),
      complexity: rank((t) => t.complexity),
      fanIn: rank((t) => t.fanIn, 30),
      fanOut: rank((t) => t.fanOut, 30),
      methods: rank((t) => t.methods.length, 30),
      fields: rank((t) => t.fields.length, 30),
      density: rank((t) => (t.code > 40 ? t.complexity / t.code : 0), 30),
      luaMembers: rank((t) => t.luaMethods + t.luaFields, 30),
    },
    histograms: {
      annotations: histogram(allTypes.flatMap((t) => t.annotations)).slice(0, 30),
      stereotypes: histogram(allTypes.map((t) => t.stereotype)),
      kinds: histogram(allTypes.map((t) => t.kind)),
      domains: histogram(allTypes.map((t) => t.package.split('.')[0])),
      packages: histogram(allTypes.map((t) => t.package)).slice(0, 40),
    },
    packageCoupling: pkgPairs,
  });

  if (!QUIET) {
    process.stderr.write(
      `[extract] ${files.length} files -> ${allTypes.length} types, ${allMethods.length} methods, ` +
        `${classEdges.size} class refs into ${path.relative(process.cwd(), OUT_DIR) || '.'} in ${Date.now() - t0}ms\n`
    );
  }

  return { files: files.length, types: allTypes.length, out: OUT_DIR, src: srcDir, mount };
}

// Run when invoked directly (`node tools/extract.mjs`), stay quiet when imported.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runExtraction().catch((err) => {
    process.stderr.write(`[extract] ${err.message}\n`);
    process.exit(1);
  });
}
