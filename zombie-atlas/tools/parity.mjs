/**
 * Parser parity harness.
 *
 * Runs *both* extractors over the same tree — the shipped hand-made lexer
 * (`parseFile` in `extract.mjs`) and the tree-sitter AST walker
 * (`tools/lib/java-ast.mjs`) — and classifies every disagreement.
 *
 * Why this exists: replacing the parser is only safe if the disagreements are
 * *enumerated* rather than discovered on screen later. Each category is either
 *
 *   `zero`   — must match exactly; a hit is a bug in the new extractor, or a
 *              correction of the old one (see docs/parser-parity.md)
 *   `accept` — an intentional correction or definition change, with the measured
 *              count recorded in `tools/parity-baseline.json` so drift shows up
 *              as a failure instead of silently changing figures
 *
 * Two comparison rules that matter:
 *   - Line statistics are compared only where both parsers measured the *same*
 *     span. The AST reports the true declaration line while the old scanner
 *     reports the previous statement's terminator line, so spans differ for most
 *     nested types; `type-span` counts that instead of hiding it.
 *   - References are compared *after* attribution and resolution — the class
 *     edge each run produces — because that is what reaches the bundle. The old
 *     masked scan also matched calls on a variable named `zombie`
 *     (`zombie.isDead()`), which resolves to no type and produces no edge.
 *
 * Usage:
 *   node tools/parity.mjs                    # check against the recorded baseline
 *   node tools/parity.mjs --update-baseline  # re-record after an intended change
 *   node tools/parity.mjs --json out.json    # write the full report
 *   node tools/parity.mjs --limit 200        # quick run on the first N files
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs, resolveSourceDir } from './lib/config.mjs';
import { parseFile } from './extract.mjs';
import { initJavaParser, parseJavaFileWith } from './lib/java-ast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = path.join(HERE, 'parity-baseline.json');

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-baseline');
const JSON_OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;

const { src: cliSrc } = parseCommonArgs(argv);
const SOURCE = resolveSourceDir(cliSrc);
const MOUNT = SOURCE.mount;

/** Categories and what a correct result looks like. */
const CATEGORIES = {
  'type-missing': { expect: 'zero', note: 'type the old scanner found, the AST walker did not' },
  'type-extra': { expect: 'zero', note: 'type the AST walker found, the old scanner did not' },
  'type-kind': { expect: 'zero' },
  'type-parent': { expect: 'zero' },
  'type-doc': { expect: 'zero' },
  'type-extends': { expect: 'zero' },
  'type-implements': { expect: 'zero' },
  'type-blank': { expect: 'zero', note: 'same span, different blank-line count' },
  'type-span': { expect: 'accept', note: 'declLine/endLine differs: the old value is the previous terminator line' },
  'type-declLine': { expect: 'accept', note: 'old value is the previous statement terminator line; the AST reports the declaration line' },
  'type-code': { expect: 'accept', note: 'string-literal-only lines: the old masked scan counted them as comments' },
  'type-comment': { expect: 'accept', note: 'same cause as type-code' },
  'type-annotations': { expect: 'accept', note: 'annotation runs the old header back-up truncated after `}`' },
  'type-modifiers': { expect: 'accept', note: 'same cause as type-annotations' },
  'count-methods': { expect: 'accept' },
  'count-fields': { expect: 'accept' },
  'count-enumConstants': { expect: 'accept', note: 'old enum walker stopped early' },
  'enum-constant-shape': { expect: 'accept', note: 'masked string arguments made the old walker count zero arguments' },
  'member-missing': { expect: 'zero' },
  'member-reclassified': { expect: 'accept', note: 'the old scanner recorded a compact record constructor as a field named `?`' },
  'member-extra': { expect: 'accept', note: 'members the old text reader dropped, e.g. a type-use annotation inside the return type' },
  'file-loc': { expect: 'zero' },
  'file-blank': { expect: 'zero' },
  'file-code': { expect: 'accept', note: 'file-level code lines, the same string-literal correction as type-code' },
  'file-comment': { expect: 'accept', note: 'file-level comment lines, same cause as file-code' },
  'member-type': { expect: 'zero' },
  'member-field-type': { expect: 'accept', note: 'a type-use annotation was read as the field type' },
  'member-params': { expect: 'accept', note: 'annotated parameters the old text reader mis-split' },
  'member-modifiers': { expect: 'zero' },
  'member-annotations': { expect: 'zero' },
  'member-throws': { expect: 'zero' },
  'member-complexity': { expect: 'accept', note: 'canonical branch-node set vs the old text scan' },
  'member-bodyLines': { expect: 'zero' },
  'member-init': { expect: 'zero' },
  'file-imports': { expect: 'zero' },
  'fqn-edge': { expect: 'zero', note: 'class-level edge from inline `zombie.*` references' },
  'parse-errors': { expect: 'accept', note: 'files with ERROR nodes; the old parser never noticed them' },
};

const SAMPLES = 4;
const counts = new Map();
const samples = new Map();
const note = (category, sample) => {
  counts.set(category, (counts.get(category) || 0) + 1);
  if (sample) {
    const arr = samples.get(category) ?? [];
    if (arr.length < SAMPLES) {
      arr.push(sample);
      samples.set(category, arr);
    }
  }
};

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

const nz = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
/** Type text compare: whitespace collapsed and spaces around a dot closed up. */
const nzType = (s) => nz(s).replace(/\s*\.\s*/g, '.');
const typeKey = (t) => `${t.parentType ?? ''}|${t.name}|${t.kind}`;
const memberKey = (m) => `${m.k}|${m.name}|${m.line}`;

/** `zombie.*` runs, longest per offset — the old regex was greedy in the same way. */
function referenceMap(refs) {
  const out = new Map();
  for (const r of refs) if (!out.has(r.start) || out.get(r.start).length < r.text.length) out.set(r.start, r.text);
  return out;
}

/** The old scanner's runs, reproduced for comparison only (masked text + regex). */
function oldReferenceMap(src) {
  const out = new Map();
  const masked = maskLikeOld(src);
  const re = /\bzombie(?:\.[A-Za-z_$][\w$]*)+/g;
  let m;
  while ((m = re.exec(masked))) {
    if (!out.has(m.index) || out.get(m.index).length < m[0].length) out.set(m.index, m[0]);
  }
  return out;
}

/** The class-level edges one side produces, exactly as the extractor computes them. */
function edgeMap(types, refs, resolve) {
  const out = new Map();
  for (const [start, text] of refs) {
    const target = resolve(text);
    if (!target) continue;
    let owner = null;
    for (const t of types) {
      if (t.bodyStart >= 0 && start > t.bodyStart && start < t.bodyEnd) {
        if (!owner || t.bodyEnd - t.bodyStart < owner.bodyEnd - owner.bodyStart) owner = t;
      }
    }
    if (!owner || owner.fqn === target) continue;
    const key = `${owner.fqn}->${target}`;
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

async function main() {
  const { parser, versions } = await initJavaParser();
  const files = walk(SOURCE.dir);
  const selected = LIMIT ? files.slice(0, LIMIT) : files;

  const t0 = Date.now();
  let oldMs = 0;
  let newMs = 0;
  const parsed = [];
  const fqns = new Set();
  const parseErrors = [];
  const totals = { files: 0, types: 0, astTypes: 0, members: 0, astMembers: 0 };

  // ---- pass 1: parse with both extractors, collect the global type index ----
  for (const abs of selected) {
    const rel = path.relative(SOURCE.dir, abs).split(path.sep).join('/');
    const dataPath = `${MOUNT}/${rel}`;
    const src = fs.readFileSync(abs, 'utf8');

    const s0 = Date.now();
    const old = parseFile(abs);
    oldMs += Date.now() - s0;
    const s1 = Date.now();
    const ast = parseJavaFileWith(parser, abs, dataPath, { excludeDefaultLabels: true });
    newMs += Date.now() - s1;

    totals.files++;
    totals.types += old.types.length;
    totals.astTypes += ast.types.length;
    totals.members += old.types.reduce((a, t) => a + t.members.length, 0);
    totals.astMembers += ast.types.reduce((a, t) => a + t.members.length, 0);
    for (const t of ast.types) fqns.add(t.fqn);
    if (ast.file.parseErrors) parseErrors.push(`${dataPath}: ${ast.file.parseErrors} node(s)`);
    parsed.push({ dataPath, src, old, ast });
  }

  const resolve = (text) => {
    let name = text;
    for (;;) {
      if (fqns.has(name)) return name;
      const dot = name.lastIndexOf('.');
      if (dot < 0) return null;
      name = name.slice(0, dot);
    }
  };

  // ---- pass 2: compare -----------------------------------------------------
  for (const { dataPath, src, old, ast } of parsed) {
    const oldTypes = old.types;
    const astTypes = ast.types;

    if (JSON.stringify(old.file.imports) !== JSON.stringify(ast.file.imports)) {
      note('file-imports', `${dataPath}: ${JSON.stringify(old.file.imports)} vs ${JSON.stringify(ast.file.imports)}`);
    }
    // File-level line accounting is span-independent, so it is compared exactly
    // here; the per-type comparison below can only run when both parsers
    // measured the same span.
    if (old.file.loc !== ast.file.loc) note('file-loc', `${dataPath}: cur=${old.file.loc} ast=${ast.file.loc}`);
    if (old.file.blank !== ast.file.blank) note('file-blank', `${dataPath}: cur=${old.file.blank} ast=${ast.file.blank}`);
    if (old.file.code !== ast.file.code) note('file-code', `${dataPath}: ${dataPath} cur=${old.file.code} ast=${ast.file.code}`);
    if (old.file.commentOnly !== ast.file.commentOnly) {
      note('file-comment', `${dataPath}: cur=${old.file.commentOnly} ast=${ast.file.commentOnly}`);
    }

    const oldByKey = new Map(oldTypes.map((t) => [typeKey(t), t]));
    const astByKey = new Map(astTypes.map((t) => [typeKey(t), t]));
    for (const [k] of oldByKey) if (!astByKey.has(k)) note('type-missing', `${dataPath}: ${k}`);
    for (const [k, t] of astByKey) if (!oldByKey.has(k)) note('type-extra', `${dataPath}: ${k} @${t.declLine}`);

    for (const [k, oldT] of oldByKey) {
      const astT = astByKey.get(k);
      if (!astT) continue;
      if (oldT.kind !== astT.kind) note('type-kind', `${dataPath}: ${k} ${oldT.kind} vs ${astT.kind}`);
      if ((oldT.parentType ?? null) !== (astT.parentType ?? null)) note('type-parent', `${dataPath}: ${k}`);
      if ((oldT.doc ?? '') !== (astT.doc ?? '')) {
        note('type-doc', `${dataPath}: ${k} cur="${(oldT.doc ?? '').slice(0, 30).replace(/\n/g, '\\n')}" ast="${(astT.doc ?? '').slice(0, 30).replace(/\n/g, '\\n')}"`);
      }
      if (JSON.stringify(oldT.annotations) !== JSON.stringify(astT.annotations)) {
        note('type-annotations', `${dataPath}: ${k} cur=${JSON.stringify(oldT.annotations)} ast=${JSON.stringify(astT.annotations)}`);
      }
      if (JSON.stringify(oldT.modifiers) !== JSON.stringify(astT.modifiers)) {
        note('type-modifiers', `${dataPath}: ${k} cur=${JSON.stringify(oldT.modifiers)} ast=${JSON.stringify(astT.modifiers)}`);
      }
      if (nz(oldT.extends.join(',')) !== nz(astT.extends.join(','))) note('type-extends', `${dataPath}: ${k} cur=${oldT.extends} ast=${astT.extends}`);
      if (nz(oldT.implements.join(',')) !== nz(astT.implements.join(','))) note('type-implements', `${dataPath}: ${k} cur=${oldT.implements} ast=${astT.implements}`);
      if (oldT.declLine !== astT.declLine) note('type-declLine', `${dataPath}: ${k} cur=${oldT.declLine} ast=${astT.declLine}`);
      if (oldT.declLine !== astT.declLine || oldT.endLine !== astT.endLine) {
        note('type-span');
      } else {
        if (oldT.blank !== astT.blank) note('type-blank', `${dataPath}: ${k} cur=${oldT.blank} ast=${astT.blank}`);
        if (oldT.code !== astT.code) note('type-code', `${dataPath}: ${k} cur=${oldT.code} ast=${astT.code}`);
        if (oldT.commentOnly !== astT.commentOnly) note('type-comment', `${dataPath}: ${k} cur=${oldT.commentOnly} ast=${astT.commentOnly}`);
      }

      const oldMethods = oldT.members.filter((m) => m.k !== 'field');
      const astMethods = astT.members.filter((m) => m.k !== 'field');
      const oldFields = oldT.members.filter((m) => m.k === 'field');
      const astFields = astT.members.filter((m) => m.k === 'field');
      if (oldMethods.length !== astMethods.length) {
        note('count-methods', `${dataPath}: ${k} cur=${oldMethods.length} ast=${astMethods.length} [${oldMethods.map((m) => m.name)} | ${astMethods.map((m) => m.name)}]`);
      }
      if (oldFields.length !== astFields.length) {
        note('count-fields', `${dataPath}: ${k} cur=${oldFields.length} ast=${astFields.length} [${oldFields.map((m) => m.name)} | ${astFields.map((m) => m.name)}]`);
      }
      if (oldT.enumConstants.length !== astT.enumConstants.length) {
        note('count-enumConstants', `${dataPath}: ${k} cur=${oldT.enumConstants.length} ast=${astT.enumConstants.length}`);
      } else {
        for (let i = 0; i < oldT.enumConstants.length; i++) {
          const a = oldT.enumConstants[i];
          const b = astT.enumConstants[i];
          if (a.name !== b.name || a.argCount !== b.argCount || !!a.hasBody !== !!b.hasBody || a.line !== b.line || a.endLine !== b.endLine) {
            note('enum-constant-shape', `${dataPath}: ${k}#${i} cur=${JSON.stringify([a.name, a.argCount, a.hasBody, a.line, a.endLine])} ast=${JSON.stringify([b.name, b.argCount, b.hasBody, b.line, b.endLine])}`);
          }
        }
      }

      const oldM = new Map(oldT.members.map((m) => [memberKey(m), m]));
      const astM = new Map(astT.members.map((m) => [memberKey(m), m]));
      for (const [mk, cm] of oldM) {
        const am = astM.get(mk);
        if (!am) {
          // Same declaration, different record? A compact record constructor is
          // a method-shaped node the old scanner stored as a field named `?`.
          const sameLine = [...astT.members].find((m) => m.line === cm.line);
          if (sameLine) {
            note('member-reclassified', `${dataPath}: ${k} line ${cm.line} cur=${cm.k}:${cm.name} ast=${sameLine.k}:${sameLine.name}`);
          } else {
            note('member-missing', `${dataPath}: ${k}.${mk}`);
          }
          continue;
        }
        if (cm.k !== 'field' && nzType(cm.type ?? '') !== nzType(am.type ?? '')) note('member-type', `${dataPath}: ${k}.${mk} cur="${cm.type}" ast="${am.type}"`);
        const cp = (cm.params ?? []).map((p) => `${p.type} ${p.name}`.trim());
        const ap = (am.params ?? []).map((p) => `${p.type} ${p.name}`.trim());
        if (JSON.stringify(cp) !== JSON.stringify(ap)) note('member-params', `${dataPath}: ${k}.${mk} cur=${JSON.stringify(cp)} ast=${JSON.stringify(ap)}`);
        if (JSON.stringify(cm.modifiers ?? []) !== JSON.stringify(am.modifiers ?? [])) {
          note('member-modifiers', `${dataPath}: ${k}.${mk} cur=${JSON.stringify(cm.modifiers)} ast=${JSON.stringify(am.modifiers)}`);
        }
        if (JSON.stringify(cm.annotations ?? []) !== JSON.stringify(am.annotations ?? [])) {
          note('member-annotations', `${dataPath}: ${k}.${mk} cur=${JSON.stringify(cm.annotations)} ast=${JSON.stringify(am.annotations)}`);
        }
        if (JSON.stringify(cm.throws ?? []) !== JSON.stringify(am.throws ?? [])) {
          note('member-throws', `${dataPath}: ${k}.${mk} cur=${JSON.stringify(cm.throws)} ast=${JSON.stringify(am.throws)}`);
        }
        if ((cm.complexity ?? 0) !== (am.complexity ?? 0)) {
          note('member-complexity', `${dataPath}: ${k}.${mk} cur=${cm.complexity} ast=${am.complexity}`);
        }
        if ((cm.bodyLines ?? 0) !== (am.bodyLines ?? 0)) note('member-bodyLines', `${dataPath}: ${k}.${mk} cur=${cm.bodyLines} ast=${am.bodyLines}`);
        if ((cm.init ?? null) !== (am.init ?? null)) {
          note('member-init', `${dataPath}: ${k}.${mk} cur=${JSON.stringify((cm.init ?? '').slice(0, 40))} ast=${JSON.stringify((am.init ?? '').slice(0, 40))}`);
        }
        if (cm.k === 'field' && nzType(cm.type ?? '') !== nzType(am.type ?? '')) {
          note('member-field-type', `${dataPath}: ${k}.${mk} cur="${cm.type}" ast="${am.type}"`);
        }
      }
      for (const [mk] of astM) if (!oldM.has(mk)) note('member-extra', `${dataPath}: ${k}.${mk}`);
    }

    // Inline `zombie.*` references, compared as the class edges they produce.
    const oldEdges = edgeMap(oldTypes, oldReferenceMap(src), resolve);
    const astEdges = edgeMap(astTypes, referenceMap(ast.refs), resolve);
    for (const [edge, w] of oldEdges) {
      const aw = astEdges.get(edge);
      if (aw === undefined) note('fqn-edge', `${dataPath}: missing ${edge} (×${w})`);
      else if (aw !== w) note('fqn-edge', `${dataPath}: weight ${edge} cur=${w} ast=${aw}`);
    }
    for (const [edge] of astEdges) if (!oldEdges.has(edge)) note('fqn-edge', `${dataPath}: extra ${edge}`);
  }

  for (const err of parseErrors) note('parse-errors', err);

  const report = {
    source: SOURCE.dir,
    files: totals.files,
    versions,
    timing: { oldMs, newMs, totalMs: Date.now() - t0 },
    totals,
    categories: Object.keys(CATEGORIES).map((name) => ({
      category: name,
      count: counts.get(name) ?? 0,
      expect: CATEGORIES[name].expect,
      note: CATEGORIES[name].note,
      samples: samples.get(name) ?? [],
    })),
  };
  report.categories.sort((a, b) => (a.expect === b.expect ? b.count - a.count : a.expect === 'zero' ? -1 : 1));

  printReport(report);
  if (JSON_OUT) fs.writeFileSync(path.resolve(process.cwd(), JSON_OUT), JSON.stringify(report, null, 2));

  const accepted = Object.fromEntries(report.categories.filter((c) => c.expect === 'accept').map((c) => [c.category, c.count]));
  if (UPDATE) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ recorded: new Date().toISOString(), accepted }, null, 2) + '\n');
    process.stdout.write(`\nbaseline written to ${path.relative(process.cwd(), BASELINE_FILE)}\n`);
  }
  return check(report, accepted);
}

/** Minimal copy of the old masking, used only to reproduce its reference scan. */
function maskLikeOld(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const s = i;
      while (i < n && src[i] !== '\n') i++;
      blank(s, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const s = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      blank(s, i);
      continue;
    }
    if (c === '"') {
      const s = i;
      const triple = src[i + 1] === '"' && src[i + 2] === '"';
      i += triple ? 3 : 1;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (triple ? src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"' : src[i] === '"' || src[i] === '\n') {
          i += triple ? 3 : 1;
          break;
        }
        i++;
      }
      blank(s, i);
      continue;
    }
    if (c === "'") {
      const s = i;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === "'" || src[i] === '\n') {
          i++;
          break;
        }
        i++;
      }
      blank(s, i);
      continue;
    }
    i++;
  }
  return out.join('');
}

function printReport(report) {
  process.stdout.write(`\nparser parity — ${report.files} files, ${report.source}\n`);
  process.stdout.write(`  old scanner ${report.timing.oldMs} ms · tree-sitter ${report.timing.newMs} ms\n`);
  process.stdout.write(`  ${report.totals.types} types / ${report.totals.members} members\n\n`);
  const width = Math.max(...report.categories.map((c) => c.category.length));
  for (const c of report.categories) {
    const flag = c.expect === 'zero' ? (c.count ? 'FAIL' : ' ok ') : c.count ? 'acc ' : ' ok ';
    process.stdout.write(`  ${flag} ${c.category.padEnd(width)} ${String(c.count).padStart(8)}\n`);
  }
  for (const c of report.categories) {
    if (!c.samples.length) continue;
    process.stdout.write(`\n  ${c.category}${c.note ? ` — ${c.note}` : ''}\n`);
    for (const s of c.samples) process.stdout.write(`    ${s}\n`);
  }
}

function check(report, accepted) {
  const failures = report.categories.filter((c) => c.expect === 'zero' && c.count > 0);
  const drift = [];
  if (!UPDATE && fs.existsSync(BASELINE_FILE)) {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).accepted ?? {};
    for (const [category, count] of Object.entries(accepted)) {
      if (baseline[category] === undefined) drift.push(`${category}: not in the baseline (now ${count})`);
      else if (baseline[category] !== count) drift.push(`${category}: baseline ${baseline[category]} → now ${count}`);
    }
  }
  if (failures.length) {
    process.stdout.write(`\nFAILED: ${failures.length} categor${failures.length === 1 ? 'y' : 'ies'} must be zero:\n`);
    for (const f of failures) process.stdout.write(`  ${f.category} = ${f.count}\n`);
  }
  if (drift.length) {
    process.stdout.write(`\naccepted-count drift (re-record with --update-baseline if intended):\n`);
    for (const d of drift) process.stdout.write(`  ${d}\n`);
  }
  const ok = !failures.length && !drift.length;
  process.stdout.write(`\n${ok ? 'parity OK' : 'parity FAILED'}\n`);
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[parity] ${err.stack}\n`);
    process.exit(2);
  });
