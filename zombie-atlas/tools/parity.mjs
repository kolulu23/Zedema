/**
 * Parser drift gate.
 *
 * The extractor is now a single tree-sitter walk (`tools/lib/java-ast.mjs`), so
 * there is no second parser left to compare against. What still needs guarding
 * is *drift*: a grammar bump, an option change or an accidental edit must not
 * silently move the numbers on screen.
 *
 * This tool re-walks the whole tree and compares what it produces against a
 * recorded snapshot: totals, per-category counts, and one digest per record
 * group (types, members, enum constants, line accounting, inline references and
 * the class edges those references produce). A change anywhere in the extraction
 * shows up as a named group with a changed count or digest.
 *
 * The oracle this replaced — the original mask/brace-depth scanner and the
 * harness that diffed the two parsers category by category — is in the history:
 *
 *   git show 1c8f3b1:zombie-atlas/tools/lib/java-lexer.mjs
 *   git show 1c8f3b1:zombie-atlas/tools/parity.mjs
 *
 * Its findings are recorded in docs/parser-parity.md, including the measured
 * counts of every correction the swap made.
 *
 * Usage:
 *   node tools/parity.mjs                    # check against tools/parity-snapshot.json
 *   node tools/parity.mjs --update-snapshot  # re-record after an intended change
 *   node tools/parity.mjs --json out.json    # write the full report
 *   node tools/parity.mjs --limit 200        # quick run on the first N files
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseCommonArgs, resolveSourceDir } from './lib/config.mjs';
import { initJavaParser, parseJavaFileWith } from './lib/java-ast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_FILE = path.join(HERE, 'parity-snapshot.json');

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-snapshot');
const JSON_OUT = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;

const { src: cliSrc } = parseCommonArgs(argv);
const SOURCE = resolveSourceDir(cliSrc);
const MOUNT = SOURCE.mount;

const KINDS = ['class', 'interface', 'enum', 'record', 'annotation'];

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

/** A named digest: how many records a group saw, and a hash over their contents. */
function hasher() {
  const hash = crypto.createHash('sha256');
  let count = 0;
  return {
    add(text) {
      hash.update(text);
      hash.update('\n');
      count++;
    },
    result: () => ({ count, digest: hash.copy().digest('hex').slice(0, 16) }),
  };
}

async function main() {
  const { parser, versions } = await initJavaParser();
  const files = walk(SOURCE.dir);
  const selected = LIMIT ? files.slice(0, LIMIT) : files;

  const t0 = Date.now();
  const groups = {
    types: hasher(),
    members: hasher(),
    enumConstants: hasher(),
    lines: hasher(),
    refs: hasher(),
    edges: hasher(),
  };
  const kindCounts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const memberKindCounts = { method: 0, ctor: 0, field: 0 };
  const lineTotals = { loc: 0, code: 0, comment: 0, blank: 0 };
  const parseErrors = [];
  const fqns = new Set();
  const parsed = [];
  let typeCount = 0;
  let memberCount = 0;

  for (const abs of selected) {
    const rel = path.relative(SOURCE.dir, abs).split(path.sep).join('/');
    const dataPath = `${MOUNT}/${rel}`;
    const { types, refs, file } = parseJavaFileWith(parser, abs, dataPath, { excludeDefaultLabels: true });
    parsed.push({ dataPath, types, refs });
    for (const t of types) fqns.add(t.fqn);
    if (file.parseErrors) parseErrors.push(dataPath);
    lineTotals.loc += file.loc;
    lineTotals.code += file.code;
    lineTotals.comment += file.commentOnly;
    lineTotals.blank += file.blank;
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

  for (const { dataPath, types, refs } of parsed) {
    typeCount += types.length;
    for (const t of types) {
      kindCounts[t.kind] = (kindCounts[t.kind] ?? 0) + 1;
      groups.types.add(
        [
          dataPath,
          t.kind,
          t.parentType ?? '',
          t.name,
          t.declLine,
          t.endLine,
          t.doc ? 1 : 0,
          t.annotations.join(','),
          t.modifiers.join(','),
          t.extends.join(','),
          t.implements.join(','),
          t.loc,
          t.code,
          t.commentOnly,
          t.blank,
          t.bytes,
        ].join('|')
      );
      groups.lines.add([dataPath, t.name, t.loc, t.code, t.commentOnly, t.blank].join('|'));
      memberCount += t.members.length;
      for (const m of t.members) {
        memberKindCounts[m.k] = (memberKindCounts[m.k] ?? 0) + 1;
        groups.members.add(
          [
            dataPath,
            t.name,
            m.k,
            m.name,
            m.line,
            m.type ?? '',
            (m.params ?? []).map((p) => `${p.type} ${p.name}`).join(','),
            (m.throws ?? []).join(','),
            (m.modifiers ?? []).join(','),
            (m.annotations ?? []).join(','),
            m.complexity ?? 0,
            m.bodyLines ?? 0,
            m.init ?? '',
          ].join('|')
        );
      }
      for (const c of t.enumConstants) {
        groups.enumConstants.add([dataPath, t.name, c.name, c.argCount, c.hasBody ? 1 : 0, c.line, c.endLine].join('|'));
      }
    }
    for (const r of refs) groups.refs.add(`${dataPath}|${r.start}|${r.text}`);

    // The class edges those references produce: the graph the app renders.
    const edges = new Map();
    for (const r of refs) {
      const target = resolve(r.text);
      if (!target) continue;
      let owner = null;
      for (const t of types) {
        if (t.bodyStart >= 0 && r.start > t.bodyStart && r.start < t.bodyEnd) {
          if (!owner || t.bodyEnd - t.bodyStart < owner.bodyEnd - owner.bodyStart) owner = t;
        }
      }
      if (!owner || owner.fqn === target) continue;
      const key = `${owner.fqn}->${target}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    for (const [edge, weight] of edges) groups.edges.add(`${edge}|${weight}`);
  }

  const digests = Object.fromEntries(Object.entries(groups).map(([name, h]) => [name, h.result()]));
  const current = {
    versions,
    files: selected.length,
    totals: {
      types: typeCount,
      members: memberCount,
      enumConstants: digests.enumConstants.count,
      refs: digests.refs.count,
      edges: digests.edges.count,
    },
    kindCounts,
    memberKindCounts,
    lineTotals,
    parseErrors: { count: parseErrors.length, names: parseErrors.slice(0, 20) },
    digests,
  };

  printReport(current, Date.now() - t0);
  if (JSON_OUT) fs.writeFileSync(path.resolve(process.cwd(), JSON_OUT), JSON.stringify({ source: SOURCE.dir, current }, null, 2));

  if (UPDATE) {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(current, null, 2) + '\n');
    process.stdout.write(`\nsnapshot written to ${path.relative(process.cwd(), SNAPSHOT_FILE)}\n`);
    return 0;
  }
  return check(current);
}

function printReport(current, ms) {
  process.stdout.write(`\nparser drift check — ${current.files} files, ${SOURCE.dir}  (${ms} ms)\n`);
  process.stdout.write(`  ${current.versions.grammar} · ${current.versions.runtime}\n\n`);
  process.stdout.write(`  types        ${String(current.totals.types).padStart(7)}   ${Object.entries(current.kindCounts).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
  process.stdout.write(`  members      ${String(current.totals.members).padStart(7)}   ${Object.entries(current.memberKindCounts).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
  process.stdout.write(`  enum consts  ${String(current.totals.enumConstants).padStart(7)}\n`);
  process.stdout.write(`  references   ${String(current.totals.refs).padStart(7)}   ${current.totals.edges} resolved edges\n`);
  process.stdout.write(`  lines        ${String(current.lineTotals.loc).padStart(7)}   code ${current.lineTotals.code} · comment ${current.lineTotals.comment} · blank ${current.lineTotals.blank}\n`);
  process.stdout.write(`  unparsable   ${String(current.parseErrors.count).padStart(7)}${current.parseErrors.names.length ? `   ${current.parseErrors.names.slice(0, 3).join(', ')}` : ''}\n`);
  process.stdout.write('\n  digests\n');
  for (const [name, d] of Object.entries(current.digests)) {
    process.stdout.write(`    ${name.padEnd(14)} ${String(d.count).padStart(7)}  ${d.digest}\n`);
  }
}

function check(current) {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    process.stdout.write(`\nno snapshot at ${path.relative(process.cwd(), SNAPSHOT_FILE)} — record one with --update-snapshot\n`);
    return 1;
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  const drift = [];
  if (snapshot.versions.grammar !== current.versions.grammar || snapshot.versions.runtime !== current.versions.runtime) {
    drift.push(`parser versions: ${snapshot.versions.grammar} / ${snapshot.versions.runtime} → ${current.versions.grammar} / ${current.versions.runtime}`);
  }
  for (const [name, d] of Object.entries(current.digests)) {
    const before = snapshot.digests[name];
    if (!before) drift.push(`${name}: not in the snapshot`);
    else if (before.digest !== d.digest || before.count !== d.count) {
      drift.push(`${name}: ${before.count} records (${before.digest}) → ${d.count} records (${d.digest})`);
    }
  }
  if (snapshot.lineTotals.code !== current.lineTotals.code || snapshot.lineTotals.comment !== current.lineTotals.comment) {
    drift.push(`line totals: code ${snapshot.lineTotals.code} → ${current.lineTotals.code}, comment ${snapshot.lineTotals.comment} → ${current.lineTotals.comment}`);
  }
  if (snapshot.parseErrors.count !== current.parseErrors.count) {
    drift.push(`unparsable files: ${snapshot.parseErrors.count} → ${current.parseErrors.count}`);
  }
  if (drift.length) {
    process.stdout.write('\nDRIFT against tools/parity-snapshot.json:\n');
    for (const d of drift) process.stdout.write(`  ${d}\n`);
    process.stdout.write('\nIf the change is intended, re-record with --update-snapshot and say so in the commit message.\n');
    return 1;
  }
  process.stdout.write('\ndrift check OK — extraction matches the recorded snapshot\n');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[parity] ${err.stack}\n`);
    process.exit(2);
  });
