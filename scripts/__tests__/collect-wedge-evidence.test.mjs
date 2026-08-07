// scripts/__tests__/collect-wedge-evidence.test.mjs — E3's verdict and the idempotency
// fingerprint, the two pure pieces of the CPF-live evidence collector.

import assert from 'node:assert/strict';
import test from 'node:test';

import { CASCADE_MECHANISM, affectedEmailsVerdict, fingerprintOf } from '../collect-wedge-evidence.mjs';

const edge = (id, tier, isActive, mechanism) => ({ id, tier, is_active: isActive, mechanism });
const ledgerRow = (overrides = {}) => ({
  job_key: 'cascade:ent-a:ent-b',
  importer_id: 'imp-1',
  promoted_edge_ids: ['edge-2', 'edge-1'],
  affected_email_ids: ['e2', 'e1'],
  ...overrides,
});

test('E3 fails an empty fan-out and passes a real one', () => {
  assert.equal(affectedEmailsVerdict({ affected_email_ids: [] }).ok, false);
  assert.match(affectedEmailsVerdict({ affected_email_ids: [] }).detail, /proves nothing about the re-label leg/);
  const full = affectedEmailsVerdict({ affected_email_ids: ['e1', 'e2'] });
  assert.equal(full.ok, true);
  assert.deepEqual(full.ids, ['e1', 'e2']);
});

test('E3 treats a non-array jsonb payload as empty, never as truthy', () => {
  assert.equal(affectedEmailsVerdict({ affected_email_ids: null }).ok, false);
  assert.equal(affectedEmailsVerdict({ affected_email_ids: 'e1' }).ok, false);
  assert.equal(affectedEmailsVerdict({}).ok, false);
});

test('the fingerprint ignores row order — a re-run that reordered nothing else must match', () => {
  const a = fingerprintOf(ledgerRow(), [edge('edge-1', 'EXTRACTED', true, CASCADE_MECHANISM), edge('edge-2', 'EXTRACTED', true, CASCADE_MECHANISM)]);
  const b = fingerprintOf(
    ledgerRow({ promoted_edge_ids: ['edge-1', 'edge-2'], affected_email_ids: ['e1', 'e2'] }),
    [edge('edge-2', 'EXTRACTED', true, CASCADE_MECHANISM), edge('edge-1', 'EXTRACTED', true, CASCADE_MECHANISM)],
  );
  assert.equal(a, b);
});

test('the fingerprint MOVES when the cascade footprint actually changes', () => {
  const base = fingerprintOf(ledgerRow(), [edge('edge-1', 'EXTRACTED', true, CASCADE_MECHANISM)]);
  assert.notEqual(base, fingerprintOf(ledgerRow({ affected_email_ids: ['e1', 'e2', 'e3'] }), [edge('edge-1', 'EXTRACTED', true, CASCADE_MECHANISM)]));
  assert.notEqual(base, fingerprintOf(ledgerRow(), [edge('edge-1', 'INFERRED', true, CASCADE_MECHANISM)]), 'a demoted tier must change the digest');
  assert.notEqual(base, fingerprintOf(ledgerRow(), [edge('edge-1', 'EXTRACTED', false, CASCADE_MECHANISM)]), 'a deactivated edge must change the digest');
  assert.notEqual(base, fingerprintOf(ledgerRow(), [edge('edge-1', 'EXTRACTED', true, 'manual')]), 'a changed mechanism must change the digest');
});

test('the fingerprint tolerates absent id sets', () => {
  const digest = fingerprintOf({ job_key: 'cascade:a:b', importer_id: 'imp-1' }, []);
  assert.match(digest, /^[0-9a-f]{16}$/);
});
