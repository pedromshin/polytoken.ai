// scripts/lib/wave1-report.test.mjs — `node --test` (npm run test:scripts).
//
// The recorder decides what "verified" means. Its two load-bearing guards:
// only `ok === true` records a PASS, and only a FAIL row sets hasFailure() —
// so INFO and SKIP can never be mistaken for proof.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createReport } from './wave1-report.mjs';

/** A report that captures its own output instead of printing it. */
const silent = () => {
  /** @type {string[]} */
  const lines = [];
  return { report: createReport({ log: (l) => lines.push(l) }), lines };
};

describe('createReport', () => {
  it('records PASS only for a strict true', () => {
    const { report } = silent();
    report.assert('S', 'strict true', true);
    for (const truthy of [1, 'yes', {}, [], 'true']) report.assert('S', `truthy ${String(truthy)}`, truthy);
    assert.deepEqual(report.counts(), { pass: 1, fail: 5, skip: 0 });
    assert.equal(report.hasFailure(), true);
  });

  it('a false assertion forces hasFailure', () => {
    const { report } = silent();
    report.assert('S', 'no', false);
    assert.equal(report.hasFailure(), true);
  });

  // Absence of failure is not proof of success: INFO and SKIP must never read as
  // verified. verify-wave1 turns "no assertions at all" into exit 2 via outcomes.
  it('INFO and SKIP never set hasFailure and never count as PASS', () => {
    const { report } = silent();
    report.info('S', 'context only');
    report.skip('S', 'thing', 'no credentials');
    assert.equal(report.hasFailure(), false);
    assert.deepEqual(report.counts(), { pass: 0, fail: 0, skip: 1 });
  });

  it('renders assertions and omits INFO from the final table', () => {
    const { report } = silent();
    report.assert('S', 'kept', true, 'detail');
    report.info('S', 'dropped-from-table');
    const table = report.render();
    assert.match(table, /kept/);
    assert.doesNotMatch(table, /dropped-from-table/);
  });

  it('says so plainly when nothing was evaluated', () => {
    const { report } = silent();
    report.info('S', 'only context');
    assert.equal(report.render(), '(no assertions evaluated)');
  });

  it('rows are frozen and the accessor cannot be used to mutate the log', () => {
    const { report } = silent();
    report.assert('S', 'a', true);
    const rows = report.rows();
    assert.throws(() => rows.push({}), TypeError);
    assert.throws(() => {
      rows[0].kind = 'PASS';
    }, TypeError);
  });

  it('prints every row as it is recorded', () => {
    const { report, lines } = silent();
    report.assert('S', 'a', false, 'why');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^FAIL\s+\[S\] a — why$/);
  });
});
