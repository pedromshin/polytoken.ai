// scripts/lib/close-kit-db.mjs — the shared SAFETY CONTRACT for the Wave-4 close kit's
// two database readers (`collect-wedge-evidence.mjs`, `fill-wedge-baseline.mjs`).
//
// It lives in one place on purpose: a safety contract duplicated across scripts is a safety
// contract that drifts. What it actually ENFORCES (each claim points at the code below):
//
//   1. READ-ONLY IS SERVER-ENFORCED, not a convention. `openReadOnly` sets
//      `default_transaction_read_only=on` as a connection parameter AND `readOnlyTx` issues
//      `set transaction read only` as the first statement of every transaction. Postgres then
//      rejects any INSERT/UPDATE/DELETE/DDL with SQLSTATE 25006 — a stray write in a caller
//      raises instead of landing. (This is enforcement; the callers' own "read-only" comments
//      would be worthless without it.)
//   2. PROD IS REFUSED BY DEFAULT. A URL carrying the prod project ref aborts with exit 2
//      unless the caller passed `--allow-prod`. Reading prod is legitimate for WEDG evidence
//      (the cascade runs on real mail) — doing it *accidentally* is not.
//   3. NO SECRET IS EVER PRINTED. The connection URL (which carries the DB password) is passed
//      to the driver and nowhere else; `describeTarget` rebuilds a description from discrete
//      URL parts — host, database, project ref — and never returns the password or the URL.
//      The refs are already committed in `.env.example`, so they are not secrets.
//   4. A MALFORMED FLAG IS A REFUSAL, NEVER A DEGRADED RUN. `readArgs` is given the caller's
//      exact flag vocabulary and throws `ConfigError` for an unknown flag, for a value-taking
//      flag with no value, and for a boolean flag handed one. The failure mode this closes is
//      real: `--fixture --apply` (path typed away) used to become a LIVE database run, and
//      `--env` with no path used to fall back silently to the ambient environment.
//   5. PATH COMPARISONS MATCH THIS FILESYSTEM. `samePath`/`isInside` case-fold on win32 and
//      darwin, because NTFS and APFS-default resolve `A.md` and `a.MD` to the SAME FILE. A
//      case-sensitive `===` on those platforms is a guard that does not guard (see
//      fill-wedge-baseline's fixture write-path refusal, which was defeated exactly that way).
//
// Every one of the five is covered by `scripts/__tests__/close-kit-db.test.mjs`; each test is
// written so that deleting the guard turns it RED. A guard no test protects is not a guard.
//
// EXIT-CODE CONTRACT shared by both callers (documented again in each script's header):
//   0 = every assertion held / the requested work completed
//   1 = an assertion FAILED (the thing being verified is not true)
//   2 = configuration or usage refusal — nothing was verified (missing URL, prod without
//       --allow-prod, bad arguments)
//   3 = INELIGIBLE — the precondition for producing a value does not exist yet (see
//       fill-wedge-baseline.mjs's zero-corrections guard)
//   4 = unexpected runtime error (driver missing, connection failed)

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Supabase project refs (already committed in `.env.example` — identifiers, not secrets). */
export const PROD_REF = 'dazyccjijdahxyciptkp';
export const STAGING_REF = 'fyfwkjvbcrmjqjysdyqw';

/** Exit codes — the kit's contract. */
export const EXIT = Object.freeze({
  OK: 0,
  ASSERTION_FAILED: 1,
  REFUSED: 2,
  INELIGIBLE: 3,
  ERROR: 4,
});

/** Raised for every configuration/usage refusal — mapped to EXIT.REFUSED by the callers. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Minimal dotenv reader (same shape staging-repair.mjs uses) — KEY=value, optional quotes.
 * An unreadable file is a CONFIGURATION refusal (exit 2 — nothing was verified), not a runtime
 * error (exit 4 — something broke mid-run). The exit-code contract above depends on the
 * distinction: exit 4 reads as "the tool is broken", exit 2 as "you pointed it at nothing".
 */
export function parseEnvFile(path) {
  const out = {};
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`cannot read the env file ${path}: ${String(error.message || error)}\n  Nothing was read; nothing was written.`);
  }
  for (const line of contents.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return Object.freeze(out);
}

/**
 * Resolve the session-mode Postgres URL for a read.
 *
 * Order: `--env <file>` (POSTGRES_URL_NON_POOLING, then POSTGRES_URL) → the ambient process
 * environment → refusal. Session-mode (non-pooling) is preferred because it is what every
 * other tool in this repo reads; a pooled URL still works for plain SELECTs.
 *
 * Never returns the URL to anything but the driver caller; see `describeTarget` for output.
 */
export function resolveDatabaseUrl({ envFile, allowProd, env = process.env }) {
  const fromFile = envFile ? parseEnvFile(envFile) : null;
  const source = fromFile ?? env;
  const url = source.POSTGRES_URL_NON_POOLING || source.POSTGRES_URL;

  if (!url) {
    throw new ConfigError(
      `no database URL available${envFile ? ` in ${envFile}` : ''}.\n` +
        '  Provide one of:\n' +
        '    --env <path>   a dotenv file holding POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL\n' +
        '    POSTGRES_URL_NON_POOLING=... in the environment\n' +
        '  Nothing was read; nothing was written.',
    );
  }
  if (url.includes(PROD_REF) && !allowProd) {
    throw new ConfigError(
      `URL targets the PRODUCTION project (ref ${PROD_REF}) and --allow-prod was not passed.\n` +
        '  Reads against prod are legitimate for live evidence — pass --allow-prod to say so\n' +
        '  deliberately. (Reads stay read-only either way; see openReadOnly.)',
    );
  }
  return { url, from: envFile ?? 'process environment' };
}

/** Which Supabase project a URL points at, by ref — 'prod' | 'staging' | 'other/local'. */
export function classifyTarget(url) {
  if (url.includes(PROD_REF)) return { env: 'prod', ref: PROD_REF };
  if (url.includes(STAGING_REF)) return { env: 'staging', ref: STAGING_REF };
  return { env: 'other/local', ref: null };
}

/**
 * A printable, password-free description of the target. Built from discrete `URL` parts —
 * the raw connection string is never interpolated into it, so a password cannot leak into
 * logs, evidence blocks, or the baseline document.
 */
export function describeTarget(url) {
  const { env, ref } = classifyTarget(url);
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(default)';
    return `${env} · host=${parsed.hostname}:${parsed.port || '5432'} db=${database}${ref ? ` ref=${ref}` : ''}`;
  } catch {
    // Unparseable URL: say so without echoing any part of it.
    return `${env} · (connection string not URL-parseable — details withheld)`;
  }
}

/**
 * Open a connection whose transactions Postgres itself refuses to let write.
 *
 * `default_transaction_read_only=on` is sent as a connection parameter, so even a caller that
 * forgets `readOnlyTx` runs read-only; `readOnlyTx` re-asserts it per transaction. The driver
 * is required lazily and by absolute path so that a run with no credentials (or no installed
 * node_modules) fails on configuration FIRST, with a useful message, rather than on `require`.
 */
export async function openReadOnly(repoRoot, url) {
  const require = createRequire(join(repoRoot, 'package.json'));
  let postgres;
  try {
    postgres = require('postgres');
  } catch (error) {
    throw new Error(
      `the 'postgres' driver is not resolvable from ${repoRoot} (run npm install at the repo root): ${String(error.message || error)}`,
    );
  }
  return postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 20,
    idle_timeout: 5,
    connection: { default_transaction_read_only: 'on' },
  });
}

/**
 * Run `fn` inside a transaction that Postgres has been told is read-only. Any write attempted
 * by `fn` raises SQLSTATE 25006 (`cannot execute ... in a read-only transaction`) — the reason
 * these scripts can be described as read-only without hand-waving.
 */
export async function readOnlyTx(sql, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe('set transaction read only');
    return fn(tx);
  });
}

/** Close the pool without ever throwing on a already-broken connection. */
export async function closeQuietly(sql) {
  if (!sql) return;
  await sql.end({ timeout: 3 }).catch(() => {});
}

/** Canonical uuid check — used to reject malformed jsonb id-set members before any `::uuid` cast. */
export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Path comparison — must match the FILESYSTEM, not the string
// ---------------------------------------------------------------------------

/**
 * Does this platform's filesystem treat `A.md` and `a.MD` as the same file?
 *
 * win32 (NTFS) and darwin (APFS/HFS+ in their default case-insensitive mode): YES. Linux ext4:
 * no. This is a platform statement, not a per-volume probe — a case-SENSITIVE NTFS directory or
 * a case-sensitive APFS volume exists but is rare, and erring toward "case-insensitive" only
 * ever makes the guards below REFUSE MORE, never less. That is the safe direction for a guard.
 */
export const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

/** Absolute, separator-normalised, and case-folded where the filesystem folds case. */
function normalizeForCompare(path) {
  const absolute = resolve(path).replace(/[\\/]+$/, '');
  return CASE_INSENSITIVE_FS ? absolute.toLowerCase() : absolute;
}

/**
 * Do these two paths name the same file ON THIS PLATFORM? Use this instead of `===` in any
 * refusal that protects a specific file: on win32 a plain `===` lets
 * `.planning/Milestones/wedge-baseline.MD` slip past a guard on
 * `.planning/milestones/WEDGE-BASELINE.md` and write the very file being protected.
 */
export function samePath(a, b) {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/** Is `child` the directory `parent` itself, or anything beneath it? Same folding rules. */
export function isInside(parent, child) {
  const p = normalizeForCompare(parent);
  const c = normalizeForCompare(child);
  return c === p || c.startsWith(p + sep);
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * Strict argv reader over the caller's EXACT flag vocabulary.
 *
 *   `--bool`            → true          (only for a name in `boolFlags`)
 *   `--key value`       → 'value'       (only for a name in `valueFlags`)
 *   `--key=value`       → 'value'       (same)
 *
 * Everything else is a `ConfigError`: an unknown flag, a value flag with no value, a boolean
 * flag given one, a bare `--`, or a positional argument. The permissive predecessor mapped a
 * valueless flag to `true` and both callers then tested `typeof x === 'string'`, so a typo
 * silently DEGRADED the run — `--fixture --apply` became a live database run with no FIXTURE
 * banner. Refusing is the only behaviour that cannot be mistaken for success.
 */
export function readArgs(argv, { valueFlags = [], boolFlags = [] } = {}) {
  const values = new Set(valueFlags);
  const bools = new Set(boolFlags);
  const known = [...values, ...bools].map((f) => `--${f}`).join(' ');
  const out = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new ConfigError(`unexpected argument "${token}" — this script takes flags only.\n  Known flags: ${known}`);
    }
    const body = token.slice(2);
    if (body === '') throw new ConfigError(`bare "--" is not a flag.\n  Known flags: ${known}`);

    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const inlineValue = eq === -1 ? null : body.slice(eq + 1);

    if (!values.has(key) && !bools.has(key)) {
      throw new ConfigError(`unknown flag "--${key}".\n  Known flags: ${known}\n  Nothing was read; nothing was written.`);
    }
    if (bools.has(key)) {
      if (inlineValue !== null) throw new ConfigError(`--${key} is a switch and takes no value (got "${inlineValue}").`);
      out[key] = true;
      continue;
    }
    if (inlineValue !== null) {
      if (inlineValue === '') throw new ConfigError(`--${key} needs a value (got an empty one).`);
      out[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new ConfigError(
        `--${key} needs a value and none was given${next === undefined ? '' : ` (next token is "${next}")`}.\n` +
          '  Refusing rather than falling back — a flag that silently vanishes turns a drill into a live run.',
      );
    }
    out[key] = next;
    i += 1;
  }
  return Object.freeze(out);
}
