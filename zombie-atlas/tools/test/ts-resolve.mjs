/**
 * A resolve hook so `node --test` can import the application's TypeScript
 * modules directly.
 *
 * Node strips types from `.ts` files natively, but its ESM resolver requires an
 * explicit file extension, while the app is written the way Vite expects
 * (`from './schema'`). The app is never executed by Node — it is always bundled
 * first — so the workaround belongs here in the test tooling rather than as
 * `.ts` extensions scattered through `src/`.
 *
 * Usage: node --import ./tools/test/ts-resolve.mjs --test tools/test/unit
 */

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Files by which an extensionless relative import may resolve. */
const SUFFIXES = ['.ts', '/index.ts'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of SUFFIXES) {
        const candidate = new URL(`${base.href}${suffix}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
