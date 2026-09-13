/**
 * Source viewer — renders the actual decompiled file for a class.
 *
 * The raw `.java` tree is served by `tools/serve.mjs` at `/src/<package path>`,
 * so the atlas always shows the exact source the dataset was extracted from
 * instead of a copy that could drift.
 */

import type { ClassRec } from '../data';
import { esc, h } from '../util';

let modalRoot: HTMLElement | null = null;

const KEYWORDS =
  /\b(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|record|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|true|false|null)\b/g;

function highlight(line: string): string {
  let out = esc(line);
  // strings & comments first (crude but safe: escaped text, no HTML injection)
  out = out.replace(/(&quot;.*?&quot;|'.*?')/g, '<span style="color:var(--warn)">$1</span>');
  out = out.replace(/^(\s*)(\/\/.*|\*.*|\/\*.*)$/, '$1<span style="color:var(--fg-3)">$2</span>');
  out = out.replace(KEYWORDS, '<span style="color:var(--accent-2)">$1</span>');
  return out;
}

export async function openSource(c: ClassRec) {
  if (!modalRoot) modalRoot = document.getElementById('modal-root')!;
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal' });
  modal.append(
    h('h2', { text: `${c.name}  ·  ${c.path}` }),
    h('div', { class: 'insp-path', text: `declared at line ${c.declLine} · ${c.loc} lines · ${c.methods} methods · ${c.fields} fields` })
  );
  const body = h('div', { class: 'src-wrap' }, h('div', { class: 'empty', style: { padding: '12px' }, text: 'loading source…' }));
  modal.append(body);
  modal.append(
    h(
      'div',
      { class: 'close-row' },
      h('button', {
        text: 'Copy path',
        onclick: () => navigator.clipboard?.writeText(c.path),
      }),
      h('button', { class: 'primary', text: 'Close', onclick: () => backdrop.remove() })
    )
  );
  backdrop.append(modal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  modalRoot.replaceChildren(backdrop);

  try {
    const res = await fetch(`src/${c.path}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    const lines = text.split('\n');
    const rows: string[] = [];
    const from = Math.max(1, c.declLine - 40);
    const to = Math.min(lines.length, c.declLine + 260);
    for (let i = from; i <= to; i++) {
      const hl = Math.abs(i - c.declLine) < 1 ? ' class="hl"' : '';
      rows.push(`<tr${hl}><td class="ln">${i}</td><td>${highlight(lines[i - 1] ?? '')}</td></tr>`);
    }
    body.replaceChildren(
      h('table', {
        class: 'src-code',
        html: `<tbody>${rows.join('')}</tbody>`,
      })
    );
    const hlRow = body.querySelector('tr.hl');
    hlRow?.scrollIntoView({ block: 'center' });
  } catch (err) {
    body.replaceChildren(
      h('div', {
        class: 'empty',
        style: { padding: '12px' },
        text: `Could not load source (${(err as Error).message}). Run the atlas through "npm run serve" so /src is mapped to the decompiled tree.`,
      })
    );
  }
}
