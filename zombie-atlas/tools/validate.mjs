/**
 * Independent cross-check of the extractor output.
 *
 * This deliberately does NOT reuse the extractor's parser: it re-reads the raw
 * source with independent (naive) regexes and compares the result with
 * `public/data/*.json`. Discrepancies are reported per file so parser
 * regressions are visible instead of silent.
 *
 * Usage: node tools/validate.mjs [--verbose]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs, resolveDataOut, resolveSourceDir } from './lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATLAS = path.resolve(HERE, '..');
const { src: cliSrc, out: cliOut } = parseCommonArgs();
const SRC = resolveSourceDir(cliSrc).dir;
const DATA = resolveDataOut(cliOut);
const VERBOSE = process.argv.includes('--verbose');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
if (!fs.existsSync(path.join(DATA, 'classes.json'))) {
  console.error(`No bundle in ${DATA}. Generate it first:  npm run data`);
  process.exit(1);
}
const classes = read(path.join(DATA, 'classes.json'));
const meta = read(path.join(DATA, 'meta.json'));
const COL = classes.columns;
const ix = (n) => COL.indexOf(n);
const rows = classes.rows;

const byId = new Map(rows.map((r) => [r[ix('id')], r]));
/** every simple type name declared anywhere in the tree */
const simpleNames = new Set(rows.map((r) => r[ix('name')]));
/** fully-qualified names of types that exist inside the tree */
const internalFqns = new Set(
  rows.map((r) => (r[ix('parentType')] ? `${r[ix('parentType')]}.${r[ix('name')]}` : `${r[ix('package')]}.${r[ix('name')]}`))
);
// member lists are sharded per package; load them all for name-level checks
const membersById = new Map();
const memberDir = path.join(DATA, 'members');
for (const f of fs.readdirSync(memberDir)) {
  const shard = read(path.join(memberDir, f));
  for (const [id, payload] of Object.entries(shard)) membersById.set(Number(id), payload);
}
const byPath = new Map();
for (const r of rows) {
  const p = r[ix('path')];
  if (!byPath.has(p)) byPath.set(p, []);
  byPath.get(p).push(r);
}

const problems = [];
const stats = {
  filesChecked: 0,
  typesParsed: 0,
  typesNaive: 0,
  methodsNaive: 0,
  methodsParsed: 0,
  heritageChecked: 0,
  heritageResolved: 0,
  heritageExternal: 0,
  nestedSkipped: 0,
};

// Naive counters: deliberately independent of the extractor's lexer. They are
// weaker than the real parser (they miss interface methods, generics and
// multi-line signatures), so the meaningful signal is the *false negative*
// direction: a declaration the naive scan sees but the parser did not record.
const NAIVE_TYPE =
  /^\s*(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:@interface|class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/gm;
const NAIVE_METHOD =
  /^\s{1,12}(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)+(?:<[^>{};]*>\s*)?[\w$.<>\[\],?\s]+?([A-Za-z_$][\w$]*)\s*\(/gm;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'do', 'else', 'try', 'synchronized', 'throw', 'assert']);
// The optional `<...>` after the type name is consumed explicitly: a bound like
// `<T extends Foo>` is NOT a heritage clause, and a lazy `.*?extends` would
// otherwise latch onto it.
const NAIVE_SUPER =
  /^[ \t]*(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:@[\w.]+(?:\([^)]*\))?\s*)*(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*([^{;]*)/gm;

for (const relPath of fs.readdirSync(SRC, { recursive: true })) {
  const rel = String(relPath);
  if (!rel.endsWith('.java')) continue;
  const abs = path.join(SRC, rel);
  const src = fs.readFileSync(abs, 'utf8');
  const dataPath = path.posix.join(meta.sourceRoot, rel);
  const recs = byPath.get(dataPath);
  if (!recs) {
    problems.push(`[missing] ${dataPath} has no parsed record`);
    continue;
  }
  stats.filesChecked++;

  // ---- type names ---------------------------------------------------------
  const parsedNames = new Set(recs.map((r) => r[ix('name')]));
  NAIVE_TYPE.lastIndex = 0;
  let tm;
  let tcount = 0;
  while ((tm = NAIVE_TYPE.exec(src))) {
    tcount++;
    stats.typesNaive++;
    if (!parsedNames.has(tm[1])) problems.push(`[type-miss] ${dataPath}: ${tm[1]}`);
  }
  stats.typesParsed += recs.length;

  // ---- method names (false negatives only) --------------------------------
  const parsedMembers = new Set();
  /** line spans of parsed member bodies (anonymous/local classes live there) */
  const bodySpans = [];
  for (const r of recs) {
    parsedMembers.add(r[ix('name')]); // the implicit default constructor
    const md = membersById.get(r[ix('id')]);
    if (!md) continue;
    for (const mem of md.members) {
      parsedMembers.add(mem[1]);
      const body = mem[8] ?? 0;
      if (body > 0) bodySpans.push([mem[6], mem[6] + body]);
    }
    // enum constant bodies are anonymous subclasses of the enum itself
    for (const c of md.enumConstants ?? []) {
      if (c && c.hasBody && c.endLine) bodySpans.push([c.line, c.endLine]);
    }
  }
  const memberNameList = [...parsedMembers];
  const lineOfOffset = (idx) => src.slice(0, idx).split('\n').length;
  const insideMemberBody = (line) => bodySpans.some(([a, b]) => line > a && line <= b);
  NAIVE_METHOD.lastIndex = 0;
  let mm;
  let mcount = 0;
  while ((mm = NAIVE_METHOD.exec(src))) {
    const name = mm[1];
    if (KEYWORDS.has(name)) continue;
    mcount++;
    stats.methodsNaive++;

    const argCount = (mm[0].match(/,/g) || []).length ? -1 : 0;
    // The naive regex's lazy name capture can clip leading characters, so a
    // substring hit on a real declaration counts as found. Only a name that
    // appears nowhere is a genuine parser miss.
    const known = memberNameList.some((n) => n.includes(name));
    if (!known) {
      // a declaration nested inside another member's body (anonymous or local
      // class) is deliberately not a top-level member of the parsed type
      if (insideMemberBody(lineOfOffset(mm.index))) stats.nestedSkipped++;
      else problems.push(`[method-miss] ${dataPath}: ${name}`);
    }
  }
  stats.methodsParsed += recs.reduce((a, r) => a + r[ix('methods')], 0);

  // Names imported from outside the decompiled tree (java.*, se.krka.*, ...)
  // shadow any internal type sharing the simple name.
  const externalSimple = new Set();
  for (const imp of src.matchAll(/^\s*import\s+(?:static\s+)?([\w.$]+)\s*;/gm)) {
    const name = imp[1];
    if (name.endsWith('.*')) continue;
    const simple = name.split('.').pop();
    // An import that does not name a type in the tree wins over any internal
    // namesake: `import java.util.Iterator;` shadows an internal `Iterator`.
    if (!internalFqns.has(name)) externalSimple.add(simple);
  }

  // ---- heritage resolution ------------------------------------------------
  NAIVE_SUPER.lastIndex = 0;
  let m;
  let guard = 0;
  while ((m = NAIVE_SUPER.exec(src)) && guard++ < 500) {
    const clauseRaw = m[3];
    const kw = /\b(?:extends|implements)\b/.exec(clauseRaw);
    if (!kw) continue;
    const clause = clauseRaw.slice(kw.index + kw[0].length);
    // split on *top-level* commas only: `HashMap<String, SubTexture>` is one type
    const parts = [];
    {
      let depth = 0;
      let cur = '';
      for (const ch of clause) {
        if (ch === '<' || ch === '(' || ch === '[') depth++;
        else if (ch === '>' || ch === ')' || ch === ']') depth--;
        if (ch === ',' && depth <= 0) {
          parts.push(cur);
          cur = '';
        } else cur += ch;
      }
      if (cur.trim()) parts.push(cur);
    }
    for (const rawName of parts) {
      const name = rawName
        .trim()
        .replace(/<.*/s, '')
        .replace(/[^\w$.].*$/s, '')
        .trim();
      if (!name || !/^[A-Za-z_$][\w$.]*$/.test(name)) continue;
      const simple = name.split('.').pop();
      stats.heritageChecked++;
      // Match the declaring record by line: simple names repeat across nested
      // types (e.g. two `CallbackStackItem`s in one file).
      const ownerLine = lineOfOffset(m.index);
      const owner =
        recs.find((r) => r[ix('declLine')] === ownerLine) ?? recs.find((r) => r[ix('name')] === m[2]);
      if (!owner) continue;
      const ids = [...(owner[ix('superIds')] || []), ...(owner[ix('ifaceIds')] || [])];
      const target = ids.map((id) => byId.get(id)).find((t) => t && t[ix('name')] === simple);
      if (target) {
        stats.heritageResolved++;
      } else if (simpleNames.has(simple) && !externalSimple.has(simple)) {
        // the type exists inside the tree, so failing to link it is a real bug
        problems.push(`[heritage-internal] ${dataPath}: ${m[2]} -> ${simple} not resolved`);
      } else {
        // JDK / Kahlua / libGDX base type: correctly outside the decompiled tree
        stats.heritageExternal++;
      }
    }
  }
}

const totalMembersFromFiles = rows.reduce((a, r) => a + r[ix('members')], 0);

const report = {
  filesChecked: stats.filesChecked,
  types: { parsed: stats.typesParsed, naive: stats.typesNaive },
  methods: { parsed: stats.methodsParsed, naive: stats.methodsNaive },
  heritage: {
    checked: stats.heritageChecked,
    resolved: stats.heritageResolved,
    external: stats.heritageExternal,
    internalCoverage: `${((stats.heritageResolved / Math.max(1, stats.heritageChecked - stats.heritageExternal)) * 100).toFixed(1)}%`,
  },
  membersTotal: totalMembersFromFiles,
  nestedDeclarationsSkipped: stats.nestedSkipped,
  metaCounts: meta.counts,
  problemCount: problems.length,
};

console.log(JSON.stringify(report, null, 2));
if (problems.length) {
  console.log(`\n--- first ${VERBOSE ? problems.length : 40} problems ---`);
  for (const p of problems.slice(0, VERBOSE ? problems.length : 40)) console.log(p);
}
process.exit(problems.length > stats.filesChecked * 0.05 ? 1 : 0);
