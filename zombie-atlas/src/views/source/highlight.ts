/**
 * A small Java syntax highlighter for the source viewer.
 *
 * Pure and dependency-light so it can be unit tested: every line this returns is
 * injected as HTML, so the escaping order below is a correctness *and* a safety
 * property, not a cosmetic one. Input is escaped first, then the span markers
 * are added, which is why the patterns match on `&quot;` rather than `"`.
 *
 * It is deliberately crude — three passes over an escaped line, no tokeniser.
 * The source viewer shows one type at a time and only cares about
 * distinguishing comments, strings and keywords at a glance.
 */

import { esc } from '../../shared/text';

const KEYWORDS =
  /\b(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|record|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|true|false|null)\b/g;

/**
 * Apply `pattern` only to text that is not already inside a span.
 *
 * Everything the input contributes has already been escaped, so every `<` in the
 * intermediate string belongs to a span this module inserted. Two things depend
 * on skipping them:
 *
 *   - the literal `var` in `style="color:var(--warn)"` is a keyword, so without
 *     this the keyword pass rewrote its own tags and mangled the attribute,
 *     breaking every string and comment mark;
 *   - `class` inside a `// comment` would otherwise be highlighted as code.
 */
function outsideSpans(html: string, pattern: RegExp, replacement: string): string {
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const rest = html.slice(i);
      out += depth === 0 ? rest.replace(pattern, replacement) : rest;
      break;
    }
    const text = html.slice(i, lt);
    out += depth === 0 ? text.replace(pattern, replacement) : text;

    const gt = html.indexOf('>', lt);
    const tag = html.slice(lt, gt + 1);
    out += tag;
    if (tag.startsWith('</')) depth = Math.max(0, depth - 1);
    else if (!tag.endsWith('/>')) depth++;
    i = gt + 1;
  }
  return out;
}

/** Highlight one source line, returning HTML that is safe to inject. */
export function highlight(line: string): string {
  let out = esc(line);
  // strings & comments first (crude but safe: escaped text, no HTML injection)
  out = out.replace(/(&quot;.*?&quot;|'.*?')/g, '<span style="color:var(--warn)">$1</span>');
  out = out.replace(/^(\s*)(\/\/.*|\*.*|\/\*.*)$/, '$1<span style="color:var(--fg-3)">$2</span>');
  return outsideSpans(out, KEYWORDS, '<span style="color:var(--accent-2)">$1</span>');
}
