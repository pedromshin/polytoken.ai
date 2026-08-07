// scripts/lib/wave1-expectations.test.mjs — `node --test` (npm run test:scripts).
//
// Two jobs: pin the PARSERS against fixtures (including the restructure cases
// that used to yield a confident, wrong answer), and prove the parsers still
// resolve against THIS repo's real tracked files — so a drift in
// packages/db/migrations, infrastructure/aws, or .github/workflows shows up as a
// RED test rather than a verifier that quietly stops checking anything.
//
// Read-only: readFileSync on tracked files. No DB, no network, no env.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ALLOWLIST_MIGRATION_TAG,
  OBJECT_CHECKS,
  REQUIRED_MIGRATION_TAGS,
  auditedSourceFiles,
  extractResourceBlock,
  parseEnqueueAllowlist,
  parseWorkerRepoExpr,
  readExpectedAllowlist,
  readJournalMigrations,
  readWorkerImageExpectations,
  workerImageCommands,
} from './wave1-expectations.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

describe('extractResourceBlock — bounded to ONE resource', () => {
  const tf = [
    'resource "aws_ecr_repository" "email_worker" {',
    '  image_tag_mutability = "MUTABLE"',
    '  tags = local.tags',
    '}',
    '',
    'resource "aws_ecr_repository" "something_else" {',
    '  name = "SOME-OTHER-REPO"',
    '}',
    '',
  ].join('\n');

  // NOTE #5 REGRESSION: the old unbounded `[\s\S]*?` walked past the closing
  // brace and adopted the NEXT resource's name.
  it('does not leak into the following resource when the attribute is missing', () => {
    assert.doesNotMatch(extractResourceBlock(tf, 'aws_ecr_repository', 'email_worker'), /SOME-OTHER-REPO/);
    assert.equal(parseWorkerRepoExpr(tf), '', 'a block with no `name =` must resolve to empty, not to a neighbour');
  });

  it('returns empty for a resource that is not there', () => {
    assert.equal(extractResourceBlock(tf, 'aws_ecr_repository', 'nope'), '');
  });

  it('reads the attribute when it IS in the block', () => {
    const ok = 'resource "aws_ecr_repository" "email_worker" {\n  name = "${var.project}-email-worker"\n}\n';
    assert.equal(parseWorkerRepoExpr(ok), '${var.project}-email-worker');
  });

  it('tolerates CRLF line endings', () => {
    const ok = 'resource "aws_ecr_repository" "email_worker" {\r\n  name = "x-email-worker"\r\n}\r\n';
    assert.equal(parseWorkerRepoExpr(ok), 'x-email-worker');
  });
});

describe('parseEnqueueAllowlist', () => {
  it('extracts the identifiers from an IF … NOT IN (…) THEN guard', () => {
    assert.deepEqual(parseEnqueueAllowlist("IF p_identifier NOT IN ('a', 'b', 'c') THEN"), ['a', 'b', 'c']);
  });

  it('ignores text inside -- line comments, including a stray closing paren', () => {
    const sql = "IF p_identifier NOT IN (\n  'a', -- Phase 75 (75-04)\n  'b'\n) THEN";
    assert.deepEqual(parseEnqueueAllowlist(sql), ['a', 'b']);
  });

  it('returns empty when no guard is present — compareAllowlist then fails closed', () => {
    assert.deepEqual(parseEnqueueAllowlist('CREATE FUNCTION f() RETURNS void AS $$ BEGIN END $$;'), []);
  });
});

describe('against this repo — the expectations are derived, not echoed', () => {
  it('the journal parses and every required tag is in it', () => {
    const journal = readJournalMigrations(REPO);
    assert.ok(journal.length > 0);
    for (const tag of REQUIRED_MIGRATION_TAGS) {
      assert.ok(
        journal.some((m) => m.tag === tag),
        `${tag} must be in packages/db/migrations/meta/_journal.json`,
      );
    }
  });

  it('journal hashes are the sha256 drizzle stores (spot-checked against the file bytes)', () => {
    const journal = readJournalMigrations(REPO);
    const top = journal[journal.length - 1];
    const expected = createHash('sha256').update(readFileSync(join(REPO, `packages/db/migrations/${top.tag}.sql`))).digest('hex');
    assert.equal(top.hash, expected);
    assert.match(top.hash, /^[0-9a-f]{64}$/);
  });

  it('the repo 0061 allowlist is non-empty and carries the identifiers the migration is FOR', () => {
    const expected = readExpectedAllowlist(REPO);
    assert.ok(expected.length > 0, `${ALLOWLIST_MIGRATION_TAG} must declare an allowlist`);
    for (const id of ['cascade_relabel', 'recompute_canvas_recipe', 'dispatch_recipe_recomputes']) {
      assert.ok(expected.includes(id), `0061 must declare ${id}`);
    }
  });

  it('the object spot-checks name migrations that exist and objects those migrations mention', () => {
    for (const c of OBJECT_CHECKS) {
      const sql = readFileSync(join(REPO, `packages/db/migrations/${c.migration}.sql`), 'utf8');
      assert.ok(sql.includes(c.table), `${c.migration}.sql must mention ${c.table}`);
      if (c.kind === 'column') assert.ok(sql.includes(c.column), `${c.migration}.sql must mention ${c.column}`);
    }
  });

  it('the worker ECR name and image tags resolve from terraform + the workflows', () => {
    const e = readWorkerImageExpectations(REPO);
    assert.notEqual(e.tfWorkerRepo, '', 'ecr.tf + variables.tf must yield a concrete repository name');
    assert.doesNotMatch(e.tfWorkerRepo, /\$\{/, 'the ${var.project} interpolation must be resolved');
    assert.deepEqual(
      e.workflows.map((w) => w.env),
      ['production', 'staging'],
    );
    for (const w of e.workflows) assert.notEqual(w.tag, '', `${w.env}: IMAGE_TAG must parse`);
  });

  it('the printed aws command is print-only and complete', () => {
    const cmds = workerImageCommands(readWorkerImageExpectations(REPO));
    assert.equal(cmds.length, 2);
    for (const c of cmds) {
      assert.match(c, /^aws ecr describe-images --region \S+ --repository-name \S+ --image-ids imageTag=\S+/);
      assert.doesNotMatch(c, /--force|delete|put-image/i);
    }
  });
});

describe('auditedSourceFiles — the read-only audit cannot be dodged by adding a module', () => {
  it('covers the CLI plus EVERY non-test module under scripts/lib', () => {
    const audited = auditedSourceFiles(REPO).map((p) => p.replace(/\\/g, '/'));
    const libs = readdirSync(join(REPO, 'scripts/lib')).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
    assert.ok(libs.length >= 4, 'expected the four wave1 lib modules at least');
    assert.ok(audited.some((p) => p.endsWith('scripts/verify-wave1.mjs')));
    for (const f of libs) {
      assert.ok(
        audited.some((p) => p.endsWith(`scripts/lib/${f}`)),
        `${f} must be scanned by the SELF audit`,
      );
    }
    assert.equal(audited.length, libs.length + 1);
  });

  it('excludes test files, whose fixtures deliberately contain write SQL', () => {
    assert.ok(!auditedSourceFiles(REPO).some((p) => p.endsWith('.test.mjs')));
  });
});
