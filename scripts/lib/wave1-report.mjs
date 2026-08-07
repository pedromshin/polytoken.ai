// scripts/lib/wave1-report.mjs — assertion recorder + PASS/FAIL table for the
// Wave-1 verification kit (scripts/verify-wave1.mjs).
//
// Deliberately dumb: it records outcomes and renders them. It never connects to
// anything, never reads env, and never decides what to check.
//
// Row kinds:
//   PASS — the assertion held.
//   FAIL — the assertion did not hold. A human must look. Forces exit 1.
//   SKIP — the assertion was not evaluated (no credentials, leg not requested).
//          SKIP does NOT force a non-zero exit on its own; the caller decides
//          (verify-wave1.mjs exits 2 when a requested leg could not be evaluated).
//   INFO — context, never an assertion. Never affects the exit code.

/**
 * @typedef {'PASS'|'FAIL'|'SKIP'|'INFO'} RowKind
 * @typedef {{ kind: RowKind, scope: string, name: string, detail: string }} Row
 */

const KIND_WIDTH = 4;

/** @param {string} value @param {number} width @returns {string} */
const pad = (value, width) => (value.length >= width ? value : value + ' '.repeat(width - value.length));

/**
 * Creates a report sink. Rows are printed as they are recorded (so a slow query
 * is visible in real time) and re-rendered as a table at the end.
 * @param {{ log?: (line: string) => void }} [options]
 */
export const createReport = ({ log = console.log } = {}) => {
  /** @type {Row[]} */
  const rows = [];

  /** @param {RowKind} kind @param {string} scope @param {string} name @param {string} detail */
  const record = (kind, scope, name, detail) => {
    const row = Object.freeze({ kind, scope, name, detail });
    rows.push(row);
    log(`${pad(kind, KIND_WIDTH)}  [${scope}] ${[name, detail].filter(Boolean).join(' — ')}`);
    return row;
  };

  return Object.freeze({
    /**
     * Records an assertion. `ok === true` is the ONLY thing that passes.
     * @param {string} scope @param {string} name @param {boolean} ok @param {string} [detail]
     */
    assert: (scope, name, ok, detail = '') => record(ok === true ? 'PASS' : 'FAIL', scope, name, detail),
    /** @param {string} scope @param {string} name @param {string} reason */
    skip: (scope, name, reason) => record('SKIP', scope, name, reason),
    /** @param {string} scope @param {string} message */
    info: (scope, message) => record('INFO', scope, '', message),
    /** @returns {readonly Row[]} */
    rows: () => Object.freeze([...rows]),
    /** @returns {{ pass: number, fail: number, skip: number }} */
    counts: () => ({
      pass: rows.filter((r) => r.kind === 'PASS').length,
      fail: rows.filter((r) => r.kind === 'FAIL').length,
      skip: rows.filter((r) => r.kind === 'SKIP').length,
    }),
    /** @returns {boolean} true when at least one assertion FAILed. */
    hasFailure: () => rows.some((r) => r.kind === 'FAIL'),
    /** @returns {string} the final scannable table (assertions only; INFO omitted). */
    render: () => {
      const assertions = rows.filter((r) => r.kind !== 'INFO');
      if (assertions.length === 0) return '(no assertions evaluated)';
      const scopeWidth = Math.max(...assertions.map((r) => r.scope.length));
      const nameWidth = Math.max(...assertions.map((r) => r.name.length));
      const line = (r) => `${pad(r.kind, KIND_WIDTH)}  ${pad(r.scope, scopeWidth)}  ${pad(r.name, nameWidth)}  ${r.detail}`.trimEnd();
      const header = `${pad('CODE', KIND_WIDTH)}  ${pad('SCOPE', scopeWidth)}  ${pad('ASSERTION', nameWidth)}  DETAIL`;
      return [header, '-'.repeat(header.length), ...assertions.map(line)].join('\n');
    },
  });
};
