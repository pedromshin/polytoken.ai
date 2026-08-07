// scripts/lib/wave1-expectations.mjs — everything the Wave-1 verifier expects,
// derived FROM THE REPO, never hardcoded twice.
//
// Why derive instead of hardcode: the expected migration hashes, the expected
// enqueue_job allowlist, and the expected ECR repository name all already exist
// in tracked files (packages/db/migrations, infrastructure/aws/*.tf,
// .github/workflows/*). Re-typing them here would let the verifier pass while
// the repo drifts. Every export below reads the tracked file and parses it.
//
// Pure + read-only: no DB, no network, no env, no credentials.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ tag: string, when: number, hash: string }} JournalMigration
 * @typedef {{ region: string, tfProject: string, tfWorkerRepo: string,
 *             tfImageTags: Record<string, string>, workflows: WorkerWorkflow[] }} WorkerImageExpectations
 * @typedef {{ env: string, file: string, region: string, repository: string,
 *             tag: string, pushGated: boolean }} WorkerWorkflow
 */

/** Migration tags whose objects this kit spot-checks in the live schema. */
export const OBJECT_CHECKS = Object.freeze([
  Object.freeze({ migration: '0058_secret_mesmero', kind: 'table', schema: 'public', table: 'canvas_recipes' }),
  Object.freeze({ migration: '0059_moaning_wrecker', kind: 'column', schema: 'public', table: 'code_islands', column: 'provenance' }),
  Object.freeze({ migration: '0060_rapid_red_skull', kind: 'table', schema: 'public', table: 'correction_propagations' }),
]);

/** The migration that widens the enqueue_job allowlist (Batch A step 2). */
export const ALLOWLIST_MIGRATION_TAG = '0061_enqueue_allowlist_cascade_recipe';

/** Migrations Wave 1 requires on BOTH legs, in order. */
export const REQUIRED_MIGRATION_TAGS = Object.freeze([
  '0058_secret_mesmero',
  '0059_moaning_wrecker',
  '0060_rapid_red_skull',
  ALLOWLIST_MIGRATION_TAG,
]);

/**
 * Every source file the SELF read-only audit must scan: the CLI plus every
 * non-test module under scripts/lib.
 *
 * ENUMERATED from the directory rather than listed, so a new lib module cannot
 * be silently left out of the audit — which was the original blind spot ("SQL
 * moved into a lib module would not be seen"). wave1-expectations.test.mjs
 * asserts this set matches the directory.
 *
 * @param {string} repoRoot @returns {readonly string[]} absolute paths
 */
export const auditedSourceFiles = (repoRoot) => {
  const libDir = join(repoRoot, 'scripts/lib');
  const libs = readdirSync(libDir)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .sort()
    .map((f) => join(libDir, f));
  return Object.freeze([join(repoRoot, 'scripts/verify-wave1.mjs'), ...libs]);
};

/** Strips `-- line comments` so parsers never match text inside a comment. */
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '');

/**
 * Reads packages/db/migrations exactly the way drizzle's migrator does:
 * hash = sha256 hex of the raw file bytes, ordered by the journal.
 * (Same derivation as scripts/staging-repair.mjs — keep them identical.)
 * @param {string} repoRoot
 * @returns {JournalMigration[]}
 */
export const readJournalMigrations = (repoRoot) => {
  const dir = join(repoRoot, 'packages/db/migrations');
  const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'));
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
    hash: createHash('sha256').update(readFileSync(join(dir, `${entry.tag}.sql`))).digest('hex'),
  }));
};

/**
 * Extracts the identifier literals from an `IF p_identifier NOT IN (...)` guard.
 * Works on both the migration file and the live `pg_get_functiondef` output,
 * which is the point: the two are compared with the same parser.
 * @param {string} sql
 * @returns {string[]} identifiers in source order (empty when no guard found)
 */
export const parseEnqueueAllowlist = (sql) => {
  const block = /p_identifier\s+NOT\s+IN\s*\(([\s\S]*?)\)\s*THEN/i.exec(stripSqlComments(sql));
  if (!block) return [];
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

/**
 * The allowlist the repo's 0061 migration declares — the set the live function
 * must contain after Batch A step 2.
 * @param {string} repoRoot
 * @returns {string[]}
 */
export const readExpectedAllowlist = (repoRoot) =>
  parseEnqueueAllowlist(readFileSync(join(repoRoot, `packages/db/migrations/${ALLOWLIST_MIGRATION_TAG}.sql`), 'utf8'));

/** @param {string} tf @returns {string} terraform `var.project` default */
const parseProjectDefault = (tf) => {
  const m = /variable\s+"project"\s*\{[\s\S]*?default\s*=\s*"([^"]+)"/.exec(tf);
  return m ? m[1] : '';
};

/**
 * The BODY of one top-level terraform resource block, bounded by the closing
 * brace in column 0 that `terraform fmt` guarantees for a top-level block.
 *
 * Bounding is the point: an unbounded `[\s\S]*?` lets a block that has lost the
 * attribute you are looking for silently adopt a LATER resource's value, so a
 * restructured ecr.tf would yield a confident, wrong repository name.
 *
 * @param {string} tf @param {string} type @param {string} name @returns {string} '' when absent
 */
export const extractResourceBlock = (tf, type, name) => {
  const head = new RegExp(`^resource\\s+"${type}"\\s+"${name}"\\s*\\{[^\\S\\n]*$`, 'm').exec(tf);
  if (!head) return '';
  const rest = tf.slice(head.index + head[0].length);
  const end = /^\}/m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
};

/** @param {string} tf @returns {string} the raw `name =` of the email_worker ECR repo */
export const parseWorkerRepoExpr = (tf) => {
  const m = /^\s*name\s*=\s*"([^"]+)"/m.exec(extractResourceBlock(tf, 'aws_ecr_repository', 'email_worker'));
  return m ? m[1] : '';
};

/** @param {string} yaml @param {string} key @returns {string} */
const parseWorkflowEnv = (yaml, key) => {
  const m = new RegExp(`^\\s{2}${key}:\\s*(\\S+)`, 'm').exec(yaml);
  return m ? m[1] : '';
};

/**
 * The per-environment image tag terraform expects (locals.tf `environments`).
 * The worker image rides the SAME tag scheme as the listener (see
 * .github/actions/worker-image/action.yml), so this is what the workflows'
 * IMAGE_TAG must equal.
 * @param {string} tf @returns {Record<string, string>}
 */
const parseImageTags = (tf) =>
  Object.fromEntries(
    [...tf.matchAll(/(production|staging)\s*=\s*\{[\s\S]*?image_tag\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );

/**
 * Worker-image expectations, read from terraform + the deploy workflows.
 * NOTHING here calls AWS — verify-wave1.mjs prints the aws CLI command instead.
 * @param {string} repoRoot
 * @returns {WorkerImageExpectations}
 */
export const readWorkerImageExpectations = (repoRoot) => {
  const tfVars = readFileSync(join(repoRoot, 'infrastructure/aws/variables.tf'), 'utf8');
  const tfEcr = readFileSync(join(repoRoot, 'infrastructure/aws/ecr.tf'), 'utf8');
  const tfLocals = readFileSync(join(repoRoot, 'infrastructure/aws/locals.tf'), 'utf8');
  const tfProject = parseProjectDefault(tfVars);
  const tfWorkerRepo = parseWorkerRepoExpr(tfEcr).replace('${var.project}', tfProject);
  const tfImageTags = parseImageTags(tfLocals);

  /** @type {[string, string][]} */
  const files = [
    ['production', '.github/workflows/deploy-email-listener.yml'],
    ['staging', '.github/workflows/deploy-email-listener-staging.yml'],
  ];
  const workflows = files.map(([env, file]) => {
    const yaml = readFileSync(join(repoRoot, file), 'utf8');
    return {
      env,
      file,
      region: parseWorkflowEnv(yaml, 'AWS_REGION'),
      repository: parseWorkflowEnv(yaml, 'WORKER_ECR_REPOSITORY'),
      tag: parseWorkflowEnv(yaml, 'IMAGE_TAG'),
      pushGated: /push-when:\s*\$\{\{\s*vars\.WORKER_DEPLOY_ENABLED\s*==\s*'true'\s*\}\}/.test(yaml),
    };
  });

  return { region: workflows[0].region, tfProject, tfWorkerRepo, tfImageTags, workflows };
};

/**
 * The exact aws CLI lines a human runs to confirm the worker image exists.
 * Printed only — this kit never invokes aws.
 * @param {WorkerImageExpectations} expectations
 * @returns {string[]}
 */
export const workerImageCommands = (expectations) =>
  expectations.workflows.map(
    (w) =>
      `aws ecr describe-images --region ${w.region} --repository-name ${w.repository}` +
      ` --image-ids imageTag=${w.tag}` +
      ` --query 'imageDetails[0].{tag:imageTags[0],pushedAt:imagePushedAt,digest:imageDigest}' --output table` +
      `   # ${w.env}`,
  );
