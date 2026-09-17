/**
 * Source highlighting, from the grammar that parsed the atlas in the first place.
 *
 * The viewer used to colour lines with three regex passes; the same grammar that
 * extracted the bundle now parses the file being shown, so what the reader sees
 * is what the extractor saw — comments and literals cannot be mistaken for code,
 * and a construct the grammar does not know is visibly uncoloured rather than
 * silently wrong.
 *
 * Cost control:
 *   - the parser is a **lazy chunk**: `web-tree-sitter` and the grammar `.wasm`
 *     are fetched the first time a source viewer opens, never at startup;
 *   - one file is parsed per open (~1 ms for a 5,000-line file), so this runs on
 *     the main thread — a worker would cost more in plumbing than it saves;
 *   - any failure (offline, missing asset, unparsable input) degrades to plain
 *     escaped text, never to a broken viewer.
 */

import { esc } from '../../shared/text';

/** Node types that carry a colour, by category. */
const COMMENT = new Set(['line_comment', 'block_comment']);
const STRING = new Set(['string_literal', 'character_literal', 'multiline_string_fragment']);
const NUMBER = new Set([
  'decimal_integer_literal',
  'hex_integer_literal',
  'octal_integer_literal',
  'binary_integer_literal',
  'decimal_floating_point_literal',
  'hex_floating_point_literal',
]);

/** Keywords and primitive types, as the grammar spells their anonymous tokens. */
const KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'record', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
  'var', 'void', 'volatile', 'while', 'yield', 'true', 'false', 'null',
]);

/** The subset worth tinting differently from control flow. */
const LITERAL_KEYWORDS = new Set(['true', 'false', 'null']);

interface Segment {
  start: number;
  end: number;
  cls: string;
}

interface Engine {
  parse(text: string): { rootNode: GrammarNode } | null;
}

interface GrammarNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  children: GrammarNode[];
  childForFieldName(name: string): GrammarNode | null;
}

let enginePromise: Promise<Engine | null> | null = null;

/** Load the parser once; `null` when the grammar cannot be fetched. */
function engine(): Promise<Engine | null> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [{ Parser, Language }, grammar] = await Promise.all([
        import('web-tree-sitter'),
        // The runtime locates its own wasm next to the bundled module; only the
        // grammar needs fetching, and the plugin serves/emits it under /ts/.
        fetch(new URL('ts/tree-sitter-java.wasm', document.baseURI)),
      ]);
      if (!grammar.ok) return null;
      const grammarBytes = new Uint8Array(await grammar.arrayBuffer());
      await Parser.init();
      const language = await Language.load(grammarBytes);
      const parser = new Parser();
      parser.setLanguage(language);
      return {
        parse(text: string) {
          return parser.parse(text) as unknown as { rootNode: GrammarNode } | null;
        },
      };
    })().catch(() => null);
  }
  return enginePromise!;
}

/** Classify one leaf token; `null` leaves it uncoloured. */
function classOf(node: GrammarNode, parent: GrammarNode | null): string | null {
  const type = node.type;
  if (COMMENT.has(type)) return 'tk-com';
  if (STRING.has(type)) return 'tk-str';
  if (NUMBER.has(type)) return 'tk-num';
  if (type === 'type_identifier') return 'tk-typ';
  if (type === 'annotation' || type === 'marker_annotation') return 'tk-ann';
  if (type === 'identifier' && parent) {
    const name = parent.childForFieldName('name');
    if (name && name.startIndex === node.startIndex) {
      if (parent.type === 'method_invocation') return 'tk-fn';
      if (parent.type === 'method_declaration' || parent.type === 'constructor_declaration') return 'tk-fn';
      if (parent.type === 'class_declaration' || parent.type === 'interface_declaration' || parent.type === 'enum_declaration' || parent.type === 'record_declaration' || parent.type === 'annotation_type_declaration') return 'tk-typ';
    }
    return null;
  }
  if (KEYWORDS.has(type)) return LITERAL_KEYWORDS.has(type) ? 'tk-lit' : 'tk-kw';
  return null;
}

/** Collect coloured ranges for the whole file. */
function segments(root: GrammarNode): Segment[] {
  const out: Segment[] = [];
  const walk = (node: GrammarNode, parent: GrammarNode | null) => {
    for (const child of node.children) {
      if (child.childCount === 0) {
        const cls = classOf(child, node);
        if (cls && child.endIndex > child.startIndex) out.push({ start: child.startIndex, end: child.endIndex, cls });
      } else {
        walk(child, node);
      }
    }
  };
  walk(root, null);
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Highlight a whole file: one HTML string per line, already escaped, so the
 * caller can drop it straight into a table cell.
 */
export async function highlightSource(text: string): Promise<string[]> {
  const lines = text.split('\n');
  const plain = () => lines.map((l) => esc(l));
  const loaded = await engine();
  if (!loaded) return plain();

  try {
    const tree = loaded.parse(text);
    if (!tree) return plain();
    const root = tree.rootNode;
    const ranges = segments(root);

    // line offsets in the original text
    const starts = new Array<number>(lines.length);
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = offset;
      offset += lines[i].length + 1;
    }

    const html: string[] = [];
    let cursor = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineStart = starts[i];
      const lineEnd = lineStart + lines[i].length;
      let out = '';
      let at = lineStart;
      // centre the window on the segments that intersect this line
      while (cursor < ranges.length && ranges[cursor].end <= lineStart) cursor++;
      let probe = cursor;
      while (probe < ranges.length && ranges[probe].start < lineEnd) {
        const seg = ranges[probe];
        const from = Math.max(seg.start, lineStart);
        const to = Math.min(seg.end, lineEnd);
        if (to > from) {
          if (from > at) out += esc(text.slice(at, from));
          out += `<span class="${seg.cls}">${esc(text.slice(from, to))}</span>`;
          at = to;
        }
        probe++;
      }
      if (at < lineEnd) out += esc(text.slice(at, lineEnd));
      html.push(out);
    }
    return html;
  } catch {
    return plain();
  }
}
