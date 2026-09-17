/**
 * Fine-grained references: what the coarse extractor deliberately does not see.
 *
 * `java-ast.mjs` records declarations and the class-level graph. This module
 * adds the layer below: every call site, field read and field write, attributed
 * to the member that contains it and resolved to the member it touches, so the
 * atlas can answer "who calls this", "who writes that field" and "which chain
 * does this expression walk" instead of only "these two types are coupled".
 *
 * Two deliberate properties:
 *
 *   - **Symbolic first, resolved later.** Sites are collected during the same
 *     walk that builds the coarse records, while the file is in hand, but they
 *     are recorded as *names and declared type texts*, never as ids: a file
 *     change renumbers everything downstream, so ids may only be assigned after
 *     every file has been read. Resolution runs once, globally, afterwards.
 *   - **Honest about failure.** A receiver the analysis cannot type is counted
 *     as unresolved instead of being guessed at. The summary reports how many
 *     sites resolved, resolved only to a class, or did not resolve at all, and
 *     the UI shows that confidence rather than hiding it.
 *
 * What this is not: there is no interprocedural dataflow, no aliasing or pointer
 * analysis, no generics inference beyond declared type arguments, and no
 * reflection or Lua call sites. Those are documented as limitations, not
 * approximated silently.
 */

import { normalizeTypeRef } from './java-names.mjs';

/** Site categories, in the order the artifacts encode them. */
export const REF_KINDS = ['call', 'read', 'write', 'new'];

/** Receiver shapes, for the resolution report. */
export const RECV_SHAPES = ['none', 'this', 'super', 'local', 'field', 'type', 'chain', 'other'];

/**
 * A declared type as text: generics and annotations stripped, dots closed up
 * (`GameProfiler.@Nullable ProfileArea` is one qualified name).
 */
export function typeTextOf(node) {
  if (!node) return '';
  return normalizeTypeRef(node.text).replace(/\s*\.\s*/g, '.');
}

/** Local name -> declared type text, for the identifiers a site can use. */
function declaredLocals(node) {
  const out = [];
  const type = typeTextOf(node.childForFieldName('type'));
  for (const d of node.namedChildren) {
    if (d.type !== 'variable_declarator') continue;
    const name = d.childForFieldName('name')?.text;
    if (name) out.push([name, type]);
  }
  return out;
}

/** Parameters of a method/lambda, as name -> type text. */
function declaredParams(node) {
  const out = [];
  const params = node.childForFieldName('parameters');
  if (!params) return out;
  for (const p of params.namedChildren) {
    const name = p.type === 'receiver_parameter' ? 'this' : p.childForFieldName('name')?.text;
    if (!name) continue;
    const raw = p.childForFieldName('type')?.text ?? '';
    out.push([name.replace(/\[.*$/, ''), normalizeTypeRef(p.type === 'spread_parameter' ? `${raw}...` : raw)]);
  }
  return out;
}

/** How a receiver expression can be typed, before the global index exists. */
function receiverOf(expr, scope) {
  if (!expr) return { shape: 'none' };
  switch (expr.type) {
    case 'this':
      return { shape: 'this' };
    case 'super':
      return { shape: 'super' };
    case 'identifier': {
      const known = scope.get(expr.text);
      return known ? { shape: 'local', typeText: known, name: expr.text } : { shape: 'type', name: expr.text };
    }
    case 'field_access': {
      const inner = receiverOf(expr.childForFieldName('object'), scope);
      const field = expr.childForFieldName('field')?.text ?? '';
      if (inner.shape === 'this') return { shape: 'field', onThis: true, name: field };
      return { shape: 'field', onThis: false, name: field, inner };
    }
    case 'method_invocation': {
      // `a.b().c()` — keep the chain so resolution can walk return types
      const chain = [];
      let cur = expr;
      while (cur && cur.type === 'method_invocation') {
        chain.unshift({ name: cur.childForFieldName('name')?.text ?? '', recv: receiverOf(cur.childForFieldName('object'), scope) });
        cur = cur.childForFieldName('object');
      }
      return { shape: 'chain', chain };
    }
    case 'object_creation_expression':
      return { shape: 'type', name: typeTextOf(expr.childForFieldName('type')) };
    case 'cast_expression':
      return { shape: 'type', name: typeTextOf(expr.childForFieldName('type')) };
    case 'parenthesized_expression':
      return receiverOf(expr.namedChildren[0], scope);
    case 'array_access':
      return receiverOf(expr.childForFieldName('array'), scope);
    default:
      return { shape: 'other' };
  }
}

/** Argument shapes, kept only where they say something (`this` and lambdas). */
function argumentShape(node) {
  if (node.type === 'this') return 1;
  if (node.type === 'lambda_expression' || node.type === 'method_reference') return 2;
  if (node.type === 'identifier') return 3;
  return 0;
}

/**
 * Collect every site in a parsed file, symbolically.
 *
 * @param {import('web-tree-sitter').Node} root
 * @returns {Array<object>} sites, in source order
 */
export function collectSites(root) {
  const sites = [];

  const walk = (node, scope) => {
    for (const child of node.namedChildren) {
      const type = child.type;

      if (type === 'method_declaration' || type === 'constructor_declaration' || type === 'compact_constructor_declaration' || type === 'lambda_expression') {
        const inner = new Map(scope);
        for (const [name, text] of declaredParams(child)) inner.set(name, text);
        const body = child.childForFieldName('body');
        if (body) walk(body, inner);
        continue;
      }

      if (type === 'local_variable_declaration') {
        // the initialiser sees the outer scope, the name is visible after it
        walk(child, scope);
        for (const [name, text] of declaredLocals(child)) scope.set(name, text);
        continue;
      }

      if (type === 'enhanced_for_statement') {
        const element = typeTextOf(child.childForFieldName('type')).replace(/\[\s*\]$/, '');
        walk(child, scope);
        const name = child.childForFieldName('name')?.text;
        if (name) scope.set(name, element);
        continue;
      }

      if (type === 'method_invocation') {
        sites.push({
          k: 0,
          line: child.startPosition.row + 1,
          name: child.childForFieldName('name')?.text ?? '',
          recv: receiverOf(child.childForFieldName('object'), scope),
          args: (childForArguments(child) ?? []).map(argumentShape),
        });
      } else if (type === 'field_access') {
        const parent = child.parent;
        const isWrite =
          (parent?.type === 'assignment_expression' && parent.childForFieldName('left')?.id === child.id) ||
          parent?.type === 'update_expression';
        sites.push({
          k: isWrite ? 2 : 1,
          line: child.startPosition.row + 1,
          name: child.childForFieldName('field')?.text ?? '',
          recv: receiverOf(child.childForFieldName('object'), scope),
          args: [],
        });
      } else if (type === 'object_creation_expression') {
        sites.push({
          k: 3,
          line: child.startPosition.row + 1,
          name: typeTextOf(child.childForFieldName('type')),
          recv: { shape: 'type', name: typeTextOf(child.childForFieldName('type')) },
          args: [],
        });
      }

      if (type !== 'line_comment' && type !== 'block_comment' && type !== 'string_literal' && type !== 'character_literal') {
        walk(child, scope);
      }
    }
  };

  walk(root, new Map());
  return sites;
}

function childForArguments(node) {
  const args = node.childForFieldName('arguments');
  return args ? args.namedChildren : null;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/**
 * Turn symbolic sites into member-to-member rows.
 *
 * @param {object} ctx
 * @param {Array} ctx.allTypes            every type record, ids already assigned
 * @param {Map<string, Array>} ctx.sitesByPath  sites per file path
 * @param {(ref: string, pkg: string, imports: Array, ownerPath: string) => number|null} ctx.resolveRef
 * @param {Map<string, number>} ctx.importsByPath  file path -> import list (as `fileImports`)
 */
export function buildReferences({ allTypes, sitesByPath, resolveRef }) {
  // name -> members, per class; plus the ancestry walk that makes inherited
  // members resolvable (a subclass calling an inherited method is normal code).
  const membersOf = new Map();
  for (const t of allTypes) {
    const byName = new Map();
    for (const m of t.members) {
      if (!byName.has(m.name)) byName.set(m.name, []);
      byName.get(m.name).push(m);
    }
    membersOf.set(t.id, byName);
  }
  const ancestors = (id) => {
    const out = [];
    const seen = new Set();
    const stack = [...allTypes[id].superIds, ...allTypes[id].ifaceIds];
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      stack.push(...allTypes[next].superIds, ...allTypes[next].ifaceIds);
    }
    return out;
  };
  /** Find a member by name in a class or anything it inherits from. */
  const findMember = (classId, name) => {
    const direct = membersOf.get(classId)?.get(name);
    if (direct?.length) return { classId, member: direct[0] };
    for (const anc of ancestors(classId)) {
      const hit = membersOf.get(anc)?.get(name);
      if (hit?.length) return { classId: anc, member: hit[0] };
    }
    return null;
  };

  const counts = { sites: 0, call: 0, read: 0, write: 0, new: 0, resolved: 0, classOnly: 0, unresolved: 0 };
  const byShape = Object.fromEntries(RECV_SHAPES.map((s) => [s, 0]));
  /** classId -> Map(memberLine -> { out: Map, in: Map }) */
  const perClass = new Map();
  const memberUsers = new Map(); // "classId:line" -> { in: Map, out: Map }

  const bucket = (classId, line) => {
    let byLine = perClass.get(classId);
    if (!byLine) perClass.set(classId, (byLine = new Map()));
    let entry = byLine.get(line);
    if (!entry) byLine.set(line, (entry = { out: new Map(), in: new Map() }));
    return entry;
  };

  const addRow = (map, toClass, toLine, kind, line) => {
    const key = `${toClass}:${toLine}:${kind}`;
    let row = map.get(key);
    if (!row) map.set(key, (row = [toClass, toLine, kind, 0, []]));
    row[3]++;
    if (row[4].length < 4 && !row[4].includes(line)) row[4].push(line);
  };

  for (const t of allTypes) {
    const sites = sitesByPath.get(t.path);
    if (!sites) continue;
    // sites are file-ordered; member spans come from the coarse records
    for (const site of sites) {
      counts.sites++;
      counts[REF_KINDS[site.k]]++;
      byShape[site.recv.shape] = (byShape[site.recv.shape] ?? 0) + 1;

      // which member of this type contains the site?
      let ownerLine = -1;
      for (const m of t.members) {
        if (site.line >= m.line && site.line <= m.line + Math.max(m.bodyLines ?? 0, 0)) {
          if (ownerLine < 0 || m.line > ownerLine) ownerLine = m.line;
        }
      }

      const target = resolveSite(site, t, { allTypes, resolveRef, findMember, ancestors });
      if (!target) {
        counts.unresolved++;
        continue;
      }
      if (ownerLine >= 0) {
        const own = bucket(t.id, ownerLine);
        addRow(own.out, target.classId, target.memberLine, site.k, site.line);
        // the mirror row, so a member can list who touches it
        const other = bucket(target.classId, target.memberLine);
        addRow(other.in, t.id, ownerLine, site.k, site.line);
      }
      if (target.memberLine >= 0) counts.resolved++;
      else counts.classOnly++;
    }
  }

  return { counts, byShape, perClass };
}

/** Resolve one site to `{ classId, memberLine }`, or null when it cannot be typed. */
function resolveSite(site, owner, ctx) {
  const { allTypes, resolveRef, findMember, ancestors } = ctx;
  const recv = site.recv;

  const asClass = (text) => {
    if (!text) return null;
    const id = resolveRef(text, owner.package, owner.fileImports, owner.path);
    return id === null || id === undefined ? null : id;
  };

  let classId = null;
  switch (recv.shape) {
    case 'none':
    case 'this':
      classId = owner.id;
      break;
    case 'super':
      classId = owner.superIds[0] ?? null;
      break;
    case 'local':
      classId = asClass(recv.typeText);
      break;
    case 'field': {
      // `foo.bar` where `foo` is a field of this type or of an ancestor
      if (recv.onThis) break;
      const inner = recv.inner;
      if (inner?.shape === 'local') classId = asClass(inner.typeText);
      else if (inner?.shape === 'this') classId = owner.id;
      else if (inner?.shape === 'type') classId = asClass(inner.name);
      if (classId === null) break;
      const field = findMember(classId, recv.innerName ?? inner?.name ?? '');
      classId = field ? asClass(field.member.type || '') : null;
      break;
    }
    case 'type':
      classId = asClass(recv.name);
      break;
    case 'chain': {
      // walk the chain: each step's declared return type types the next receiver
      let current = null;
      for (const step of recv.chain) {
        const stepOwner = current ?? owner.id;
        const hit = findMember(stepOwner, step.name);
        if (!hit) return current === null ? null : { classId: current, memberLine: -1 };
        if (step === recv.chain[recv.chain.length - 1]) return { classId: hit.classId, memberLine: hit.member.line };
        current = asClass(hit.member.type || '') ?? hit.classId;
      }
      break;
    }
    default:
      return null;
  }

  // An implicit or `this` receiver may also be a static import on the file.
  if (classId === null && (recv.shape === 'none' || recv.shape === 'this')) {
    for (const imp of owner.fileImports) {
      if (!imp.static) continue;
      const ownerName = imp.name.slice(0, imp.name.lastIndexOf('.'));
      const id = resolveRef(ownerName, owner.package, owner.fileImports, owner.path);
      if (id !== null && id !== undefined) {
        classId = id;
        break;
      }
    }
  }
  if (classId === null) return null;

  // `new X()` targets the constructor; everything else looks for a member.
  if (site.k === 3) {
    const ctor = allTypes[classId].members.find((m) => m.k === 'ctor');
    return { classId, memberLine: ctor ? ctor.line : -1 };
  }
  const hit = findMember(classId, site.name);
  if (hit) return { classId: hit.classId, memberLine: hit.member.line };
  return { classId, memberLine: -1 };
}

/**
 * Per-class aggregates and the rankings the insights cards read. Kept small so
 * it can be loaded eagerly; the member rows stay in the per-package shards.
 */
export function summarise(allTypes, perClass) {
  const classRows = [];
  const memberTotal = new Map();
  const rankings = { topCalled: [], topCallers: [], topWritten: [], topRead: [] };
  const called = [];
  const written = [];
  const read = [];

  for (const t of allTypes) {
    let out = 0;
    let inc = 0;
    let outReads = 0;
    let inReads = 0;
    let outWrites = 0;
    let inWrites = 0;
    const byLine = perClass.get(t.id);
    if (byLine) {
      for (const [line, entry] of byLine) {
        const outCalls = [...entry.out.values()].filter((r) => r[2] === 0).reduce((a, r) => a + r[3], 0);
        const outR = [...entry.out.values()].filter((r) => r[2] === 1).reduce((a, r) => a + r[3], 0);
        const outW = [...entry.out.values()].filter((r) => r[2] === 2).reduce((a, r) => a + r[3], 0);
        const inCalls = [...entry.in.values()].filter((r) => r[2] === 0).reduce((a, r) => a + r[3], 0);
        const inR = [...entry.in.values()].filter((r) => r[2] === 1).reduce((a, r) => a + r[3], 0);
        const inW = [...entry.in.values()].filter((r) => r[2] === 2).reduce((a, r) => a + r[3], 0);
        out += outCalls;
        inc += inCalls;
        outReads += outR;
        inReads += inR;
        outWrites += outW;
        inWrites += inW;
        memberTotal.set(`${t.id}:${line}`, { classId: t.id, line, inCalls, outCalls, inWrites, inReads });
        if (inCalls) called.push([t.id, line, inCalls]);
        if (inWrites) written.push([t.id, line, inWrites]);
        if (inReads) read.push([t.id, line, inReads]);
      }
    }
    classRows.push([t.id, out, inc, outReads, inReads, outWrites, inWrites]);
  }

  const top = (rows, n = 40) => rows.sort((a, b) => b[2] - a[2]).slice(0, n);
  const byOutCalls = [...memberTotal.values()].filter((v) => v.outCalls).map((v) => [v.classId, v.line, v.outCalls]);
  rankings.topCalled = top(called);
  rankings.topCallers = top(byOutCalls);
  rankings.topWritten = top(written);
  rankings.topRead = top(read);

  return { classRows, rankings };
}
