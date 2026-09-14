/**
 * Locale catalog integrity — pure file checks, no browser.
 *
 * Promoted from the catalog checker that used to live inside the browser i18n
 * spec, which ran the whole browser suite to check two JSON files. It needs
 * neither a browser nor the dataset, so it lives here and runs in milliseconds
 * under `node --test`.
 *
 * `MessageKey` already makes a *missing* key a compile error at the call site.
 * What the type system cannot see is parity between the two catalogs, empty
 * translations, and placeholder drift — that is what this covers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOCALES = path.join(ROOT, 'src', 'locales');

const read = (file) => JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8'));
const en = read('en.json');
const zh = read('zh-cn.json');

/** Placeholder tokens such as `{0}`, order-insensitive. */
const placeholders = (text) => [...text.matchAll(/\{\d+\}/g)].map(([token]) => token).sort();

test('both catalogs define the same keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});

test('every translation is a non-empty string', () => {
  for (const [key, text] of Object.entries(zh)) {
    assert.equal(typeof text, 'string', `${key} is not a string`);
    assert.ok(text.trim(), `${key} is empty`);
  }
});

test('placeholders match between catalogs', () => {
  const drifted = [];
  for (const [key, text] of Object.entries(en)) {
    if (JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(zh[key]))) {
      drifted.push(`${key}: ${JSON.stringify(placeholders(text))} vs ${JSON.stringify(placeholders(zh[key]))}`);
    }
  }
  assert.deepEqual(drifted, []);
});

test('the shell markup only references known messages', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const missing = [];
  for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    if (!Object.hasOwn(en, key)) missing.push(key);
  }
  assert.deepEqual(missing, []);
});
