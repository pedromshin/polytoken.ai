// scripts/__tests__/_suite-floor.mjs — the gate on the gate.
//
// WHY THIS FILE EXISTS. `npm run test:close-kit` is the only thing standing between the close
// kit's 22 guards and a silent regression, and until now it could not tell "everything passed"
// from "nothing ran". Executed, on this machine, before the fix:
//
//   node --test "scripts/__tests__/*.NOMATCH.mjs"   → tests 0 · pass 0 · fail 0 · EXIT 0
//   node --test <explicit path that does not exist> → the missing file is SKIPPED, EXIT 0
//
// So deleting `scripts/__tests__/`, renaming it, renaming the files to `*.spec.mjs`, or dropping
// one file from the list all turned the whole suite into a green tick for any exit-code consumer
// (CI, a driver script, a reviewer reading `npm run` output). The runner reports success for work
// it never did. That is the "no evidence ≠ proven good" failure, one level up from the guards.
//
// A second, quieter version of the same hole: glob arguments to `node --test` are a Node 21+
// feature, and root `package.json` declares `engines.node >= 20.12.0`. On the DECLARED floor the
// quoted glob is a literal path that matches nothing — so the suite the script claimed to run did
// not run there at all. The npm script now names its four files explicitly, which every supported
// Node understands, and this file asserts the list stays complete.
//
// WHAT IT ENFORCES (all four fail closed, exit 1):
//   1. the npm script names NO glob — a glob can silently match nothing
//   2. it names at least MINIMUM_SUITE_FILES test files
//   3. every file it names EXISTS (node --test would skip a missing one without complaint)
//   4. every `*.test.mjs` sitting in this directory IS named (a new test file that nobody wired
//      up is a test file that never runs)
//
// It is deliberately placed INSIDE `scripts/__tests__/` and chained BEFORE the runner with `&&`,
// so that deleting the directory — the loudest version of the failure — makes node fail to
// resolve this module and the chain exits non-zero. It does not match `*.test.mjs`, so the runner
// never collects it as a test. Its pure half is covered by `close-kit-db.test.mjs`.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { samePath } from '../lib/close-kit-db.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));
const SCRIPT_NAME = 'test:close-kit';

/** The floor. Lowering it is a deliberate act that shows up in review; drifting past it is not. */
export const MINIMUM_SUITE_FILES = 4;

/** Test-file paths the npm script names outright, in the order it names them. */
export function declaredTestPaths(npmScript) {
  return npmScript.match(/scripts[/\\]__tests__[/\\][\w.-]+\.test\.mjs/g) ?? [];
}

/** Does the npm script hand `node --test` a pattern instead of a path? */
export function usesGlob(npmScript) {
  return /scripts[/\\]__tests__[/\\][^"'\s]*\*/.test(npmScript);
}

/**
 * Everything wrong with this suite's wiring, as human-readable lines. Pure: `present` is the list
 * of `*.test.mjs` basenames actually on disk, so the caller owns all I/O and the tests can drive
 * every branch without touching the filesystem.
 */
export function suiteFloorProblems({ npmScript, present, minimum = MINIMUM_SUITE_FILES }) {
  const problems = [];
  if (npmScript === undefined || npmScript === null || npmScript === '') {
    return [`package.json has no "${SCRIPT_NAME}" script — the close kit has no gate at all`];
  }
  if (usesGlob(npmScript)) {
    problems.push(
      `"${SCRIPT_NAME}" hands node --test a GLOB. A glob that matches nothing exits 0 with ` +
        '"tests 0", which is indistinguishable from a pass — name the files explicitly.',
    );
  }
  const declared = declaredTestPaths(npmScript);
  const declaredNames = declared.map((p) => p.split(/[/\\]/).pop());
  if (declared.length < minimum) {
    problems.push(
      `"${SCRIPT_NAME}" names ${declared.length} test file(s); the floor is ${minimum}. ` +
        'Either tests were deleted or the script stopped naming them.',
    );
  }
  for (const name of declaredNames) {
    if (!present.includes(name)) {
      problems.push(`${name} is named by "${SCRIPT_NAME}" but is NOT on disk — node --test skips it silently.`);
    }
  }
  for (const name of present) {
    if (!declaredNames.includes(name)) {
      problems.push(`${name} exists but "${SCRIPT_NAME}" never names it — it would never run.`);
    }
  }
  return problems;
}

/** The `*.test.mjs` files sitting next to this one. */
export function presentTestFiles(dir = HERE) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
}

function main() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  const problems = suiteFloorProblems({
    npmScript: pkg.scripts?.[SCRIPT_NAME],
    present: presentTestFiles(),
  });
  if (problems.length === 0) {
    console.log(`suite floor OK — "${SCRIPT_NAME}" names all ${presentTestFiles().length} test file(s), each present.`);
    return 0;
  }
  console.error('REFUSED: the close-kit test gate cannot prove it ran anything.');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nA green exit code from a suite that executed zero tests is a false pass. Fix the wiring first.');
  return 1;
}

// Entry-point only (samePath, not ===, for the same filesystem reason as the rest of the kit).
if (process.argv[1] !== undefined && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exit(main());
}
