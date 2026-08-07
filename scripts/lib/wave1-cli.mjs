// scripts/lib/wave1-cli.mjs — the decisions scripts/verify-wave1.mjs makes ABOUT
// a run, extracted so every one of them is unit-testable without a database:
// argument parsing, per-leg credential targets + the project-ref guard,
// connection-string masking/redaction, and the exit code.
//
// Pure by construction: no fs, no process.env, no network, no DB. The CLI reads
// the strings and hands them here. Each guard below has a test in
// wave1-cli.test.mjs that goes RED when the guard is removed — that is the point
// of the extraction. A guard no test protects is not a guard.

/** Public Supabase project refs — the same two literals scripts/staging-repair.mjs uses. */
export const STAGING_REF = 'fyfwkjvbcrmjqjysdyqw';
export const PROD_REF = 'dazyccjijdahxyciptkp';

/** The exit-code contract (docs/WAVE1-VERIFICATION.md). */
export const EXIT = Object.freeze({ OK: 0, FAILED: 1, UNEVALUATED: 2, REFUSED: 3 });

/**
 * Per-leg credential resolution, project-ref guard, and journal policy.
 *
 * `requireFullJournal` covers ONE thing: whether every journal entry must be
 * recorded. It deliberately does NOT gate the high-water assertion. Prod is not
 * expected to carry every journal entry the way staging is after the 2026-08-06
 * repair — but a recorded stamp AHEAD of the journal is environment-independent
 * and never benign, so it is asserted on both legs (see migrationChecks()).
 *
 * @typedef {{ key: string, scope: string, envFile: string, envVar: string,
 *             requiredRef: string, forbiddenRef: string, requireFullJournal: boolean }} Leg
 * @type {Readonly<Record<'staging'|'prod', Readonly<Leg>>>}
 */
export const LEGS = Object.freeze({
  staging: Object.freeze({
    key: 'staging',
    scope: 'STAGING',
    envFile: '.env.staging',
    envVar: 'STAGING_POSTGRES_URL_NON_POOLING',
    requiredRef: STAGING_REF,
    forbiddenRef: PROD_REF,
    requireFullJournal: true,
  }),
  prod: Object.freeze({
    key: 'prod',
    scope: 'PROD',
    envFile: '.env.production',
    envVar: 'PROD_POSTGRES_URL_NON_POOLING',
    requiredRef: PROD_REF,
    forbiddenRef: STAGING_REF,
    requireFullJournal: false,
  }),
});

/** Every argv token the CLI understands. Anything else is a usage error. */
export const KNOWN_FLAGS = Object.freeze(['--staging', '--prod', '--help', '-h']);

/**
 * @typedef {{ help: boolean, runStaging: boolean, runProd: boolean, unknown: readonly string[] }} Args
 *
 * Unrecognised tokens are RETURNED, never ignored: `--production` used to fall
 * through to the staging default and could exit 0 while the operator believed
 * prod had been checked. The CLI refuses to run when `unknown` is non-empty.
 *
 * @param {readonly string[]} argv @returns {Readonly<Args>}
 */
export const parseArgs = (argv) => {
  const runProd = argv.includes('--prod');
  return Object.freeze({
    help: argv.includes('--help') || argv.includes('-h'),
    runProd,
    runStaging: argv.includes('--staging') || !runProd,
    unknown: Object.freeze(argv.filter((token) => !KNOWN_FLAGS.includes(token))),
  });
};

/**
 * @param {Pick<Leg, 'requiredRef' | 'forbiddenRef'>} leg @param {string} url
 * @returns {string | null} refusal reason, or null when the URL is safe for this leg
 */
export const guardUrl = (leg, url) => {
  if (url.includes(leg.forbiddenRef)) {
    return `connection string contains the ${leg.forbiddenRef === PROD_REF ? 'PROD' : 'STAGING'} project ref — refusing`;
  }
  if (!url.includes(leg.requiredRef)) {
    return `connection string does not contain the expected project ref (${leg.requiredRef}) — refusing`;
  }
  return null;
};

/** Query-string keys whose VALUE is masked; everything else stays readable. */
const SENSITIVE_PARAM = /pass|secret|token|key|credential/i;

/**
 * Hides user + password; keeps the host (so the project ref stays visible) and
 * the query string (so a missing `?sslmode=require&uselibpqcompat=true` on a
 * pooler URL is visible), with sensitive parameter values masked.
 * @param {string} url @returns {string}
 */
export const maskUrl = (url) => {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()].map(([k, v]) => `${k}=${SENSITIVE_PARAM.test(k) ? '***' : v}`);
    return `${u.protocol}//***:***@${u.host}${u.pathname}${params.length ? `?${params.join('&')}` : ''}`;
  } catch {
    return '<unparseable connection string>';
  }
};

/**
 * Builds an error-to-text function that strips this leg's password and full
 * connection string out of whatever the driver put in the message.
 *
 * The parse and the decode are attempted SEPARATELY on purpose: a password with
 * an invalid percent escape (`p%ssw0rd`) parses fine but makes
 * decodeURIComponent throw, and a shared try/catch used to discard the
 * successfully-parsed password along with it — leaving the secret unredacted.
 *
 * @param {string} url @returns {(e: unknown) => string}
 */
export const makeRedactor = (url) => {
  const raw = (() => {
    try {
      return new URL(url).password;
    } catch {
      return '';
    }
  })();
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return '';
    }
  })();
  // Both forms: the driver may report the percent-encoded or the decoded password.
  const secrets = [...new Set([raw, decoded])].filter((s) => s.length > 0);
  const masked = maskUrl(url);
  return (e) => {
    const text = String((e && /** @type {Error} */ (e).message) || e);
    return [url, ...secrets].reduce((acc, secret) => acc.split(secret).join(secret === url ? masked : '***'), text);
  };
};

/**
 * @typedef {'evaluated'|'unevaluated'|'refused'} LegOutcome
 *
 * The exit-code contract, in precedence order:
 *   3 REFUSED     only when NOTHING was connected to — that is what the doc
 *                 promises the operator ("Nothing was connected to"). A refusal
 *                 alongside a leg that DID run and DID fail must not mask the
 *                 failure as a config problem.
 *   1 FAILED      a real assertion failed (a refusal also records a FAIL row, so
 *                 refused + evaluated lands here — never on 0).
 *   3 REFUSED     defensive: a refusal never exits 0, whatever the rows say.
 *   2 UNEVALUATED a requested leg could not be evaluated.
 *   0 OK
 *
 * @param {{ outcomes: readonly LegOutcome[], hasFailure: boolean }} input @returns {number}
 */
export const decideExit = ({ outcomes, hasFailure }) => {
  const refused = outcomes.includes('refused');
  if (refused && !outcomes.includes('evaluated')) return EXIT.REFUSED;
  if (hasFailure) return EXIT.FAILED;
  if (refused) return EXIT.REFUSED;
  if (outcomes.includes('unevaluated')) return EXIT.UNEVALUATED;
  return EXIT.OK;
};
