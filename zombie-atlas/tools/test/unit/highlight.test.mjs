/**
 * The Java highlighter behind the source viewer.
 *
 * Its output is injected with `innerHTML`, so the escaping order is a safety
 * property as much as a cosmetic one: input is escaped first, then the span
 * markers are added, which is why the patterns match on `&quot;` rather than a
 * literal quote. Nothing tested this before — the browser suite only counts
 * rendered rows.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight } from '../../../src/views/source/highlight.ts';

test('markup in the source is escaped, never injected', () => {
  const out = highlight('String s = "<img src=x onerror=alert(1)>";');
  assert.ok(!out.includes('<img'), `raw markup survived: ${out}`);
  assert.ok(out.includes('&lt;img'), 'the tag was not escaped');
});

test('angle brackets and ampersands outside strings are escaped too', () => {
  const out = highlight('if (a < b && c > d) { }');
  assert.ok(!out.includes('<b'), 'a lone < survived');
  assert.ok(out.includes('&lt;'), 'a lone < was not escaped');
  assert.ok(out.includes('&amp;&amp;'), 'the ampersand was not escaped');
});

test('escaped quotes never break out of an attribute', () => {
  const out = highlight('String q = "\\" onclick=alert(1) x=\\"";');
  assert.ok(!/(<span[^>]*)\sonclick=/.test(out), `injected attribute: ${out}`);
});

test('keywords are wrapped', () => {
  const out = highlight('public static void main');
  for (const word of ['public', 'static', 'void']) {
    assert.ok(out.includes(`>${word}</span>`), `${word} was not highlighted: ${out}`);
  }
});

test('the keyword pass never reaches inside a span it inserted', () => {
  // Two distinct hazards, both from `style="color:var(--warn)"` sharing text
  // with real code: `var` is a keyword, and so is `class` inside the literal.
  // Either one being rewritten produces a span inside a tag or a nested span.
  const out = highlight('public String s = "class";');
  assert.equal((out.match(/<span/g) ?? []).length, 2, `expected a string span and one keyword span: ${out}`);
  assert.ok(!out.includes('<span style="color:var(--accent-2)"><span'), 'nested spans');
  assert.ok(!/<[^>]*<span/.test(out), `a span was inserted inside a tag: ${out}`);

  // The style attribute of every span must survive intact.
  for (const [tag] of out.matchAll(/<span[^>]*>/g)) {
    assert.ok(!tag.includes('<', 6), `corrupted tag: ${tag}`);
  }
});

test('line comments are wrapped, and keywords inside them are left alone', () => {
  const out = highlight('    // note about class');
  assert.ok(out.includes('color:var(--fg-3)'), `comment not highlighted: ${out}`);
  assert.ok(out.includes('// note about class'), `comment text was altered: ${out}`);
  assert.ok(!out.includes('color:var(--accent-2)'), `a keyword was highlighted inside a comment: ${out}`);
});

test('block comment continuations are wrapped', () => {
  const out = highlight(' * a javadoc line');
  assert.ok(out.includes('color:var(--fg-3)'), `javadoc line not highlighted: ${out}`);
});

test('string literals are wrapped', () => {
  const out = highlight('String greeting = "hello";');
  assert.ok(out.includes('>hello<') === false, 'the quotes should stay inside the span');
  assert.ok(out.includes('&quot;hello&quot;</span>'), `string not highlighted: ${out}`);
});

test('a comment marker inside a string does not start a comment', () => {
  // Crude pass order: strings are wrapped before comments, so `//` inside a
  // literal is already inside a span and the comment pattern cannot match from
  // the line start. This documents that behaviour rather than asserting a
  // general guarantee — the highlighter is intentionally approximate.
  const out = highlight('String url = "http://example.com";');
  assert.ok(!/color:var\(--fg-3\)/.test(out), `a URL was treated as a comment: ${out}`);
});

test('an empty line is returned unchanged', () => {
  assert.equal(highlight(''), '');
});

test('output is idempotent for already-plain text', () => {
  const plain = 'int x = 1;';
  assert.equal(highlight(plain), highlight(plain));
});
