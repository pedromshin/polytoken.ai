// scripts/lib/wave1-cli.test.mjs — `node --test` (npm run test:scripts).
//
// The safety guards: the project-ref refusal, credential masking/redaction,
// argument rejection, and the exit-code contract. Remove any one of them and a
// test here goes RED. No database, no network, no env.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXIT, KNOWN_FLAGS, LEGS, PROD_REF, STAGING_REF, decideExit, guardUrl, makeRedactor, maskUrl, parseArgs } from './wave1-cli.mjs';

const url = (ref, password = 'sup3rs3cr3tpw', query = '') => `postgresql://svcuser:${password}@db.${ref}.supabase.co:5432/postgres${query}`;

describe('parseArgs', () => {
  it('defaults to the staging leg only', () => {
    const a = parseArgs([]);
    assert.deepEqual([a.runStaging, a.runProd, a.help, [...a.unknown]], [true, false, false, []]);
  });

  it('--prod alone runs prod only; --staging --prod runs both', () => {
    assert.deepEqual([parseArgs(['--prod']).runStaging, parseArgs(['--prod']).runProd], [false, true]);
    const both = parseArgs(['--staging', '--prod']);
    assert.deepEqual([both.runStaging, both.runProd], [true, true]);
  });

  // NOTE #6 REGRESSION: `--production` used to be ignored, silently verifying
  // STAGING and exiting 0 while the operator believed prod had been checked.
  it('RETURNS unrecognised tokens instead of ignoring them', () => {
    for (const typo of ['--production', '-prod', '--prod-only', 'prod', '--dry-run']) {
      assert.deepEqual([...parseArgs([typo]).unknown], [typo], `${typo} must be reported as unknown`);
    }
    assert.deepEqual([...parseArgs(['--staging', '--nope', '--prod']).unknown], ['--nope']);
  });

  it('accepts every documented flag with no unknowns', () => {
    assert.deepEqual([...parseArgs([...KNOWN_FLAGS]).unknown], []);
  });
});

describe('guardUrl — the project-ref refusal', () => {
  it('refuses a PROD ref on the staging leg', () => {
    assert.match(String(guardUrl(LEGS.staging, url(PROD_REF))), /contains the PROD project ref — refusing/);
  });

  it('refuses a STAGING ref on the prod leg', () => {
    assert.match(String(guardUrl(LEGS.prod, url(STAGING_REF))), /contains the STAGING project ref — refusing/);
  });

  it('refuses a URL carrying neither known ref', () => {
    assert.match(String(guardUrl(LEGS.prod, url('someotherproject'))), /does not contain the expected project ref/);
    assert.match(String(guardUrl(LEGS.staging, 'postgresql://u:p@localhost:5432/postgres')), /does not contain the expected project ref/);
  });

  it('allows each leg its own ref', () => {
    assert.equal(guardUrl(LEGS.staging, url(STAGING_REF)), null);
    assert.equal(guardUrl(LEGS.prod, url(PROD_REF)), null);
  });
});

describe('LEGS policy', () => {
  it('reads credentials from the documented per-leg sources', () => {
    assert.deepEqual([LEGS.staging.envVar, LEGS.staging.envFile], ['STAGING_POSTGRES_URL_NON_POOLING', '.env.staging']);
    assert.deepEqual([LEGS.prod.envVar, LEGS.prod.envFile], ['PROD_POSTGRES_URL_NON_POOLING', '.env.production']);
  });

  it('requires full journal coverage on staging only — and that flag governs nothing else', () => {
    assert.equal(LEGS.staging.requireFullJournal, true);
    assert.equal(LEGS.prod.requireFullJournal, false);
  });
});

describe('maskUrl', () => {
  it('hides user and password, keeps host and database', () => {
    const masked = maskUrl(url(PROD_REF));
    assert.equal(masked, `postgresql://***:***@db.${PROD_REF}.supabase.co:5432/postgres`);
    assert.doesNotMatch(masked, /sup3rs3cr3tpw|svcuser/);
  });

  it('keeps the query string so a missing sslmode is visible', () => {
    assert.match(maskUrl(url(PROD_REF, 'pw', '?sslmode=require&uselibpqcompat=true')), /\?sslmode=require&uselibpqcompat=true$/);
  });

  it('masks the VALUE of a sensitive query parameter', () => {
    const masked = maskUrl(url(PROD_REF, 'pw', '?password=inquery&sslmode=require'));
    assert.doesNotMatch(masked, /inquery/);
    assert.match(masked, /password=\*\*\*/);
  });

  it('never echoes an unparseable connection string', () => {
    assert.equal(maskUrl('not a url at all: sup3rs3cr3tpw'), '<unparseable connection string>');
  });
});

describe('makeRedactor', () => {
  it('strips the password out of driver error text', () => {
    const safe = makeRedactor(url(PROD_REF));
    const out = safe(new Error('connection failed for password "sup3rs3cr3tpw"'));
    assert.doesNotMatch(out, /sup3rs3cr3tpw/);
    assert.match(out, /\*\*\*/);
  });

  it('strips a full connection string, replacing it with the masked form', () => {
    const u = url(PROD_REF);
    const out = makeRedactor(u)(new Error(`could not connect to ${u}`));
    assert.doesNotMatch(out, /sup3rs3cr3tpw/);
    assert.match(out, /postgresql:\/\/\*\*\*:\*\*\*@db\./);
  });

  it('strips the DECODED form when the URL carries a percent-encoded password', () => {
    const out = makeRedactor(url(PROD_REF, 'p%25ssw0rd'))(new Error('auth failed for p%ssw0rd'));
    assert.doesNotMatch(out, /p%ssw0rd/);
  });

  // NOTE #4 REGRESSION: an INVALID percent escape makes decodeURIComponent throw.
  // A shared try/catch used to discard the successfully-parsed password with it,
  // leaving the secret in the printed error text.
  it('still strips a password whose percent escape is INVALID', () => {
    const out = makeRedactor(url(PROD_REF, 'p%ssw0rd'))(new Error('auth failed for p%ssw0rd'));
    assert.doesNotMatch(out, /p%ssw0rd/, 'the raw password must be redacted even when decodeURIComponent throws');
    assert.match(out, /\*\*\*/);
  });

  it('degrades safely on an unparseable URL instead of throwing', () => {
    assert.equal(makeRedactor('::::')(new Error('boom')), 'boom');
  });
});

describe('decideExit — the exit-code contract', () => {
  it('0 only when a leg was evaluated with no failure', () => {
    assert.equal(decideExit({ outcomes: ['evaluated'], hasFailure: false }), EXIT.OK);
  });

  it('1 when an assertion failed', () => {
    assert.equal(decideExit({ outcomes: ['evaluated'], hasFailure: true }), EXIT.FAILED);
  });

  it('2 when a requested leg could not be evaluated', () => {
    assert.equal(decideExit({ outcomes: ['unevaluated'], hasFailure: false }), EXIT.UNEVALUATED);
  });

  it('3 when a leg was refused and NOTHING was connected to', () => {
    assert.equal(decideExit({ outcomes: ['refused'], hasFailure: true }), EXIT.REFUSED);
    assert.equal(decideExit({ outcomes: ['refused', 'unevaluated'], hasFailure: true }), EXIT.REFUSED);
  });

  // NOTE #3 REGRESSION: a refusal used to win outright, so a run where one leg
  // genuinely FAILED and the other was refused reported 3 ("nothing was connected
  // to") and any driver keying on the code mis-triaged it.
  it('1, not 3, when one leg was refused and another leg ran and FAILED', () => {
    assert.equal(decideExit({ outcomes: ['evaluated', 'refused'], hasFailure: true }), EXIT.FAILED);
  });

  it('never returns 0 when a leg was refused', () => {
    assert.notEqual(decideExit({ outcomes: ['evaluated', 'refused'], hasFailure: false }), EXIT.OK);
  });

  // Stated honestly rather than claimed away: with NO leg outcomes the code is 0.
  // parseArgs guarantees at least one leg runs (runStaging defaults true), so the
  // CLI cannot reach this; a caller that could must not read 0 as "DB verified".
  it('0 when there are no leg outcomes at all — unreachable from the CLI', () => {
    assert.equal(decideExit({ outcomes: [], hasFailure: false }), EXIT.OK);
    const a = parseArgs([]);
    assert.ok(a.runStaging || a.runProd, 'parseArgs must always request at least one leg');
  });
});
