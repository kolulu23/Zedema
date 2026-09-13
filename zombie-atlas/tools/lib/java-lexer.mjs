/**
 * Minimal, dependency-free Java lexer utilities.
 *
 * The only job here is to produce a "masked" copy of a source file in which the
 * *contents* of comments and string/char literals are replaced by spaces while
 * every byte offset and newline is preserved. Regex work can then run over the
 * masked text without ever being fooled by a brace or keyword inside a string
 * or a comment, and any offset found in the masked text can be sliced straight
 * out of the original source.
 */

const SP = 32; // ' '
const NL = 10; // '\n'
const CR = 13; // '\r'

/**
 * @param {string} src
 * @returns {{masked: string, comments: Array<{start:number,end:number,text:string,doc:boolean}>}}
 */
export function maskSource(src) {
  const out = new Array(src.length);
  const comments = [];
  let i = 0;
  const n = src.length;

  // Copy a run of characters verbatim.
  const copy = (from, to) => {
    for (let k = from; k < to; k++) out[k] = src[k];
  };
  // Blank a run, preserving newlines so line numbers stay valid.
  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      const c = src.charCodeAt(k);
      out[k] = c === NL || c === CR ? src[k] : ' ';
    }
  };

  while (i < n) {
    const c = src[i];

    // --- line comment -------------------------------------------------------
    if (c === '/' && src[i + 1] === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      comments.push({ start, end: i, text: src.slice(start, i), doc: false });
      blank(start, i);
      continue;
    }

    // --- block comment / javadoc -------------------------------------------
    if (c === '/' && src[i + 1] === '*') {
      const start = i;
      const doc = src[i + 2] === '*' && src[i + 3] !== '/';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      comments.push({ start, end: i, text: src.slice(start, i), doc });
      blank(start, i);
      continue;
    }

    // --- text block ---------------------------------------------------------
    if (c === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      const start = i;
      i += 3;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
          i += 3;
          break;
        }
        i++;
      }
      blank(start, i);
      continue;
    }

    // --- string literal -----------------------------------------------------
    if (c === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '"' || src[i] === '\n') {
          i++;
          break;
        }
        i++;
      }
      blank(start, i);
      continue;
    }

    // --- char literal -------------------------------------------------------
    if (c === "'") {
      const start = i;
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
      blank(start, i);
      continue;
    }

    copy(i, i + 1);
    i++;
  }

  return { masked: out.join(''), comments };
}

/**
 * Brace-depth profile: depth[i] is the number of currently-open `{` *before*
 * position i. Computed on masked text, so it is exact.
 * @param {string} masked
 * @returns {Int32Array}
 */
export function braceDepth(masked) {
  const depth = new Int32Array(masked.length + 1);
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    depth[i] = d;
    const c = masked.charCodeAt(i);
    if (c === 123 /* { */) d++;
    else if (c === 125 /* } */) d = Math.max(0, d - 1);
  }
  depth[masked.length] = d;
  return depth;
}

/** 1-based line numbers for every offset of a source string. */
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === NL) starts.push(i + 1);
  return starts;
}

/** Binary search: offset -> 1-based line number. */
export function lineOf(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Split a parameter list on top-level commas (generics-aware).
 * @param {string} s
 * @returns {string[]}
 */
export function splitTopLevel(s, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') depth--;
    if (c === sep && depth <= 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * Split a header into "annotations", "modifiers", "rest".
 * Annotations may carry parenthesised arguments (possibly nested).
 * @param {string} header
 */
export function splitAnnotations(header) {
  const annotations = [];
  let i = 0;
  const n = header.length;
  const skipWs = () => {
    while (i < n && /\s/.test(header[i])) i++;
  };
  for (;;) {
    skipWs();
    if (header[i] !== '@') break;
    const start = i;
    i++; // '@'
    while (i < n && /[\w$.]/.test(header[i])) i++;
    const nameEnd = i; // annotation text never carries trailing whitespace
    let j = i;
    while (j < n && /\s/.test(header[j])) j++;
    let end = nameEnd;
    if (header[j] === '(') {
      let depth = 0;
      let k = j;
      for (; k < n; k++) {
        if (header[k] === '(') depth++;
        else if (header[k] === ')') {
          depth--;
          if (depth === 0) {
            k++;
            break;
          }
        }
      }
      end = k;
    }
    annotations.push(header.slice(start, end));
    i = end;
  }
  return { annotations, rest: header.slice(i), consumed: i };
}

const MODIFIERS = new Set([
  'public',
  'protected',
  'private',
  'static',
  'final',
  'abstract',
  'native',
  'synchronized',
  'strictfp',
  'transient',
  'volatile',
  'default',
]);

/**
 * Pull leading modifiers off a declaration head.
 * @param {string} rest
 */
export function splitModifiers(rest) {
  const mods = [];
  let s = rest;
  for (;;) {
    const m = /^\s*([A-Za-z]+)\b/.exec(s);
    if (!m || !MODIFIERS.has(m[1])) break;
    // `default` is only a modifier in interface methods; treat it as such.
    mods.push(m[1]);
    s = s.slice(m[0].length);
  }
  return { modifiers: mods, rest: s };
}

/**
 * Strip a leading `<T extends Foo, U>` type-parameter block if present.
 * @param {string} s
 */
export function stripTypeParams(s) {
  const t = s.replace(/^\s+/, '');
  if (t[0] !== '<') return { typeParams: null, rest: s };
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '<') depth++;
    else if (t[i] === '>') {
      depth--;
      if (depth === 0) return { typeParams: t.slice(0, i + 1), rest: t.slice(i + 1) };
    }
  }
  return { typeParams: null, rest: s };
}

/**
 * Read a Java type expression from the start of `s` (generics/arrays aware).
 * Returns the type text plus the remainder.
 * @param {string} s
 */
export function readType(s) {
  let i = 0;
  const n = s.length;
  while (i < n && /\s/.test(s[i])) i++;
  const start = i;
  let angle = 0;
  while (i < n) {
    const c = s[i];
    if (c === '<') angle++;
    else if (c === '>') {
      if (angle === 0) break;
      angle--;
    } else if (angle === 0 && (c === '(' || c === ')' || c === ',' || c === '=' || c === ';' || c === '{')) {
      break;
    } else if (angle === 0 && /\s/.test(c)) {
      // whitespace only terminates the type when the next token starts a name
      let j = i;
      while (j < n && /\s/.test(s[j])) j++;
      if (j >= n || !/[\w$]/.test(s[j])) break;
      // `Map<String, Foo> name` -> keep going only if we are inside generics
      break;
    }
    i++;
  }
  return { type: s.slice(start, i).trim(), rest: s.slice(i), start, end: i };
}

/**
 * Extract `extends A, implements B, C` from a type declaration header.
 * @param {string} headerWithoutAnnotationsAndModifiers
 */
export function readSupertypes(header) {
  const res = { extends: [], implements: [], permits: [] };
  // Lazy captures with lookaheads keep `extends A implements B` from bleeding
  // the implements clause into the superclass list.
  const ex = /\bextends\b([^{]*?)(?=\bimplements\b|\bpermits\b|$)/.exec(header);
  if (ex) for (const p of splitTopLevel(ex[1])) if (p.trim()) res.extends.push(p.trim());
  const im = /\bimplements\b([^{]*?)(?=\bpermits\b|$)/.exec(header);
  if (im) for (const p of splitTopLevel(im[1])) if (p.trim()) res.implements.push(p.trim());
  const pe = /\bpermits\b([^{]*?)$/.exec(header);
  if (pe) for (const p of splitTopLevel(pe[1])) if (p.trim()) res.permits.push(p.trim());
  return res;
}

/**
 * Normalise a type reference to a bare source name: strips generics, array
 * brackets, wildcards and annotations, keeping the raw qualified name.
 * @param {string} t
 */
export function normalizeTypeRef(t) {
  return t
    .replace(/@[\w$.]+(\([^)]*\))?/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\s*\]/g, '')
    .replace(/\?(\s+extends\s+|\s+super\s+)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The simple (unqualified) name of a type reference.
 * @param {string} t
 */
export function simpleName(t) {
  const n = normalizeTypeRef(t);
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i + 1) : n;
}
