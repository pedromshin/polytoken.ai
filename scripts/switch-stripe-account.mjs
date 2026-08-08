/**
 * switch-stripe-account.mjs — point polytoken at the Stripe account that can ACTUALLY charge.
 *
 * WHY THIS EXISTS
 * polytoken's Vercel env holds a key for `acct_1PpHzm010o9nrmKi`, which Stripe refuses with
 * `testmode_charges_only` — that account was never activated for live charges, so no customer
 * could ever have paid. The working account is `acct_1T7Bv6Ckssq4baOH` ("Magnitude Tecnologia",
 * charges_enabled + payouts_enabled, card_payments active) — the same legal entity polytoken's
 * own /legal pages name. rachaai-turborepo has been using it for 156 days.
 *
 * Price ids are per-account, so switching the key alone is NOT enough: the existing
 * STRIPE_PRICE_PRO / STRIPE_PRICE_POWER belong to the dead account and would 404. This script
 * creates the products, prices and webhook on the working account and writes all four Vercel
 * env vars together, so the app never sees a half-switched state.
 *
 * SAFE TO RE-RUN: it looks for products tagged metadata[app]=polytoken and reuses them rather
 * than creating duplicates. It never prints the secret key or the webhook signing secret.
 *
 * ⚠️ BLAST RADIUS — read before running. The working account also carries RachaAI and
 * gridscore revenue. A full `sk_live_` key in polytoken's env gives that deployment full API
 * access to all of it. Prefer minting a RESTRICTED key in the Stripe dashboard first
 * (Developers → API keys → Create restricted key) with WRITE on: Customers, Checkout Sessions,
 * Billing Portal Sessions, Subscriptions; READ on: Prices, Products. Then run:
 *
 *   STRIPE_KEY=rk_live_xxx node scripts/switch-stripe-account.mjs --apply
 *
 * With no STRIPE_KEY set it falls back to the key already working in rachaai-turborepo.
 *
 * USAGE (from repo root):
 *   node scripts/switch-stripe-account.mjs            # dry run — shows what it WOULD do
 *   node scripts/switch-stripe-account.mjs --apply    # create + write Vercel env
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const WORKING_ACCOUNT = 'acct_1T7Bv6Ckssq4baOH';
const DEAD_ACCOUNT = 'acct_1PpHzm010o9nrmKi';
const WEBHOOK_URL = 'https://polytoken.ai/api/stripe/webhook';
// Exactly what packages/billing/src/webhook.ts handles — nothing more.
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];
const TIERS = [
  {
    tier: 'pro',
    name: 'Polytoken Pro',
    amount: 2900,
    env: 'STRIPE_PRICE_PRO',
    description:
      'Your inbox becomes a knowledge graph — email parsed and extracted, the canvas, grounded chat, and bespoke tools built over your own data.',
  },
  {
    tier: 'power',
    name: 'Polytoken Power',
    amount: 4900,
    env: 'STRIPE_PRICE_POWER',
    description: 'Everything in Pro, with higher ingest and processing limits and a larger workspace.',
  },
];

function resolveKey() {
  if (process.env.STRIPE_KEY) return { key: process.env.STRIPE_KEY, src: 'STRIPE_KEY env' };
  for (const p of ['.env.rachaai', '.env.stripe']) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^STRIPE_SECRET_KEY=["']?([^"'\r\n]+)/m);
    if (m) return { key: m[1], src: p };
  }
  console.log('No key found. Either set STRIPE_KEY=rk_live_... (preferred — see the header), or');
  console.log('pull the working one into this directory:');
  console.log('  npx vercel link --yes --project rachaai-turborepo');
  console.log('  npx vercel env pull .env.rachaai --environment production');
  console.log('  npx vercel link --yes --project nauta-web      # relink before --apply!');
  process.exit(1);
}
const { key, src } = resolveKey();

const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' };
const api = async (path, body, method = body ? 'POST' : 'GET') => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: H,
    ...(body ? { body: new URLSearchParams(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${json.error?.message ?? res.status}`);
  return json;
};

console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}   key from: ${src}\n`);

// --- 1. verify the account can actually take money -------------------------
const acct = await api('account');
console.log(`account          : ${acct.id}  (${acct.business_profile?.name ?? '?'})`);
console.log(`charges_enabled  : ${acct.charges_enabled}`);
console.log(`card_payments    : ${acct.capabilities?.card_payments}`);
if (acct.id === DEAD_ACCOUNT) {
  console.log(`\nABORT: this is the DEAD account (${DEAD_ACCOUNT}) that cannot make live charges.`);
  process.exit(1);
}
if (acct.id !== WORKING_ACCOUNT) {
  console.log(`\nNOTE: expected ${WORKING_ACCOUNT}, got ${acct.id}. Continuing only if it can charge.`);
}
if (!acct.charges_enabled) {
  console.log('\nABORT: charges_enabled is false — this account cannot take money either.');
  process.exit(1);
}
if (acct.capabilities?.card_payments !== 'active') {
  console.log('\nABORT: card_payments is not active; checkout pins payment_method_types:["card"].');
  process.exit(1);
}

// --- 2. products + prices --------------------------------------------------
const priceIds = {};
const existingProducts = (await api('products?limit=100&active=true')).data;
for (const t of TIERS) {
  let product = existingProducts.find(
    (p) => p.metadata?.app === 'polytoken' && p.metadata?.tier === t.tier,
  );
  if (product) {
    console.log(`\n${t.tier}: reusing product ${product.id}`);
  } else if (!APPLY) {
    console.log(`\n${t.tier}: WOULD create product "${t.name}"`);
  } else {
    product = await api('products', {
      name: t.name,
      description: t.description,
      'metadata[app]': 'polytoken',
      'metadata[tier]': t.tier,
    });
    console.log(`\n${t.tier}: created product ${product.id}`);
  }

  if (!product) continue;
  const prices = (await api(`prices?product=${product.id}&active=true&limit=100`)).data;
  let price = prices.find(
    (p) => p.currency === 'usd' && p.unit_amount === t.amount && p.recurring?.interval === 'month',
  );
  if (price) {
    console.log(`      reusing price ${price.id}  ($${t.amount / 100}/mo)`);
  } else if (!APPLY) {
    console.log(`      WOULD create price $${t.amount / 100}/mo USD recurring`);
  } else {
    price = await api('prices', {
      product: product.id,
      currency: 'usd',
      unit_amount: String(t.amount),
      'recurring[interval]': 'month',
      'metadata[app]': 'polytoken',
      'metadata[tier]': t.tier,
    });
    console.log(`      created price ${price.id}  ($${t.amount / 100}/mo)`);
  }
  if (price) priceIds[t.env] = price.id;
}

// --- 3. webhook ------------------------------------------------------------
let webhookSecret = null;
const hooks = (await api('webhook_endpoints?limit=100')).data;
const existingHook = hooks.find((w) => w.url === WEBHOOK_URL);
if (existingHook) {
  console.log(`\nwebhook: already exists ${existingHook.id} (${existingHook.status})`);
  console.log('         Stripe reveals the signing secret ONLY at create time, so this run');
  console.log('         cannot re-read it. If STRIPE_WEBHOOK_SECRET is wrong, delete the');
  console.log('         endpoint in the dashboard and re-run to get a fresh secret.');
} else if (!APPLY) {
  console.log(`\nwebhook: WOULD create ${WEBHOOK_URL} for ${EVENTS.length} events`);
} else {
  const body = new URLSearchParams({ url: WEBHOOK_URL, description: 'polytoken.ai billing' });
  for (const e of EVENTS) body.append('enabled_events[]', e);
  const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
    method: 'POST',
    headers: H,
    body,
  });
  const hook = await res.json();
  if (!res.ok) throw new Error(`webhook: ${hook.error?.message}`);
  webhookSecret = hook.secret;
  console.log(`\nwebhook: created ${hook.id} -> ${WEBHOOK_URL}`);
}

// --- 4. Vercel env ---------------------------------------------------------
if (!APPLY) {
  console.log('\nDRY RUN — nothing created, nothing written. Re-run with --apply.');
  process.exit(0);
}

const setEnv = (name, value) => {
  // Value goes via a temp file, never argv — argv is visible in the process list.
  const tmp = `.env.tmp.${name}`;
  writeFileSync(tmp, value, { encoding: 'utf8' });
  try {
    execSync(`npx vercel env rm ${name} production --yes`, { stdio: 'ignore' });
  } catch {
    /* absent is fine */
  }
  // execSync always runs through a shell; passing shell:true here would be read as a
  // shell PATH and break the call. The `<` redirect is handled by cmd.exe / sh natively.
  execSync(`npx vercel env add ${name} production < ${tmp}`, { stdio: 'inherit' });
  unlinkSync(tmp);
  console.log(`  set ${name}`);
};

console.log('\nwriting Vercel env — THE REPO MUST BE LINKED TO nauta-web:');
console.log('  (if you pulled .env.rachaai above, run `npx vercel link --yes --project nauta-web` first)');
for (const [name, value] of Object.entries(priceIds)) setEnv(name, value);
setEnv('STRIPE_SECRET_KEY', key);
if (webhookSecret) setEnv('STRIPE_WEBHOOK_SECRET', webhookSecret);
else console.log('  STRIPE_WEBHOOK_SECRET left unchanged (endpoint already existed — see note above)');

console.log('\nDONE. Next:');
console.log('  1. npx vercel --prod          # env changes only take effect on a fresh build');
console.log('  2. Click Subscribe on /billing — it should reach Stripe checkout.');
console.log('  3. rm .env.rachaai            # it holds a live secret key');
