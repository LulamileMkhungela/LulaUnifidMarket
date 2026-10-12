'use strict';

/**
 * ProVeri Trust Kernel — the rules that make "verified" mean something.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TrustKernel, CHECK_STATUS, ESCROW_STATUS, MILESTONE_STATUS, POLICY_EFFECT, RISK_ACTION,
} = require('../src/kernel');
const { AuditLedger } = require('../src/kernel/audit');
const verticals = require('../src/verticals');

function kernel() {
  return new TrustKernel({ verticals: verticals.VERTICALS });
}

/* ================= audit ledger ================= */

test('the audit ledger is append-only and tamper-evident', () => {
  const ledger = new AuditLedger({ scope: 'unit' });
  ledger.append({ action: 'A', subject: 'x', payload: { n: 1 } });
  ledger.append({ action: 'B', subject: 'x', payload: { n: 2 } });
  ledger.append({ action: 'C', subject: 'y', payload: { n: 3 } });

  assert.equal(ledger.verifyChain().valid, true);
  assert.equal(ledger.entries.length, 3);

  // Mutate a historical entry — the chain must notice.
  ledger.entries[1].payload.n = 999;
  const broken = ledger.verifyChain();
  assert.equal(broken.valid, false);
  assert.equal(broken.brokenAt, 1);
  assert.equal(broken.reason, 'ENTRY_TAMPERED');

  // Reordering also breaks it, because each entry hashes the previous hash.
  const ledger2 = new AuditLedger({ scope: 'unit2' });
  ledger2.append({ action: 'A', subject: 'x' });
  ledger2.append({ action: 'B', subject: 'x' });
  [ledger2.entries[0], ledger2.entries[1]] = [ledger2.entries[1], ledger2.entries[0]];
  assert.equal(ledger2.verifyChain().valid, false);
});

test('every entry links to the previous hash, and receipts are stable', () => {
  const ledger = new AuditLedger({ scope: 'unit' });
  for (let i = 0; i < 5; i += 1) ledger.append({ action: `E${i}`, subject: 's' });
  for (let i = 1; i < ledger.entries.length; i += 1) {
    assert.equal(ledger.entries[i].prevHash, ledger.entries[i - 1].hash);
  }
  const receipt = ledger.integrityReceipt();
  assert.equal(receipt.chainValid, true);
  assert.equal(typeof receipt.receipt, 'string');
  assert.equal(receipt.receipt.length, 64);
});

test('exportProof lets a third party verify a subject without the whole ledger', () => {
  const ledger = new AuditLedger({ scope: 'unit' });
  ledger.append({ action: 'BOOKING_AWARDED', subject: 'bkg_1', visibility: 'PUBLIC', payload: { summary: 'awarded' } });
  ledger.append({ action: 'UNRELATED', subject: 'other', payload: {} });
  ledger.append({ action: 'PAYMENT_RELEASED', subject: 'bkg_1', visibility: 'PUBLIC', payload: { summary: 'released' } });

  const proof = ledger.exportProof('bkg_1');
  assert.equal(proof.entries, 2);
  assert.equal(proof.chain, true);
  assert.match(proof.digest, /^[0-9a-f]{64}$/);
});

/* ================= verification ================= */

test('a statutory trade cannot reach a high score without a certificate reference', () => {
  const k = kernel();
  const subject = { subjectId: 'pro_1', primaryTrade: 'electrician', statutoryTrade: true };
  let state = k.startVerification('servicePro', subject);

  // A human marks the check PASS but supplies no certificate reference.
  state = k.recordCheck('pro_1', state, subject, {
    name: 'trade_certification', status: CHECK_STATUS.PASS, source: 'someone said so',
  });
  const cert = state.checks.find((c) => c.name === 'trade_certification');
  assert.ok(cert.score <= 35, `expected the uncertified PASS to be capped, got ${cert.score}`);
});

test('PASS with full evidence scores full marks and can verify', () => {
  const k = kernel();
  const subject = { subjectId: 'pro_2', primaryTrade: 'cleaner', statutoryTrade: false };
  let state = k.startVerification('servicePro', subject);
  state = k.recordCheck('pro_2', state, subject, {
    name: 'sa_id_document', status: CHECK_STATUS.PASS, source: 'DHA', evidence: { idNumber: '8001015009087', idDocumentHash: 'h', livenessRef: 'l' },
  });
  const check = state.checks.find((c) => c.name === 'sa_id_document');
  assert.equal(check.score, 100);
});

test('a PASS missing evidence keys is capped, never silently trusted', () => {
  const k = kernel();
  const subject = { subjectId: 'pro_3', primaryTrade: 'cleaner', statutoryTrade: false };
  let state = k.startVerification('servicePro', subject);
  state = k.recordCheck('pro_3', state, subject, {
    name: 'bank_account_verification', status: CHECK_STATUS.PASS, source: 'AVS',
    // bankCode and avsReference are required evidence keys for this check.
  });
  const check = state.checks.find((c) => c.name === 'bank_account_verification');
  assert.deepEqual(check.missingEvidence, ['bankCode', 'avsReference']);
  assert.ok(check.score <= 80);
});

test('a blocking FAIL suspends rather than verifies', () => {
  const k = kernel();
  const subject = { subjectId: 'pro_4', primaryTrade: 'plumber', statutoryTrade: true };
  let state = k.startVerification('servicePro', subject);
  state = k.recordCheck('pro_4', state, subject, {
    name: 'sa_id_document', status: CHECK_STATUS.FAIL, source: 'DHA', finding: 'checksum mismatch',
  });
  assert.equal(state.status, 'FAILED');
  assert.equal(state.badge, 'REMOVED_FOR_RISK');
});

test('expired evidence downgrades the check automatically', () => {
  const k = kernel();
  const subject = { subjectId: 'pro_5', primaryTrade: 'cleaner', statutoryTrade: false };
  let state = k.startVerification('servicePro', subject);
  state = k.recordCheck('pro_5', state, subject, {
    name: 'mobile_and_email_otp', status: CHECK_STATUS.PASS, source: 'OTP', ttlDays: 0,
    evidence: { mobileOtpRef: 'a', emailOtpRef: 'b' },
  });
  // ttlDays: 0 means it expires immediately.
  state = k.verification.recalculate(state, subject);
  const check = state.checks.find((c) => c.name === 'mobile_and_email_otp');
  assert.equal(check.status, CHECK_STATUS.EXPIRED);
});

/* ================= escrow ================= */

function openFundedEscrow(k, { amount = 100_000, milestones = null } = {}) {
  const escrow = k.escrow.open({
    bookingId: 'bkg_1', customerId: 'cus_1', providerId: 'pro_1',
    amountCents: amount, provider: 'paystack', milestones,
  });
  return k.escrow.confirmFunded(escrow.escrowId, { reference: 'PS_TEST' });
}

test('escrow cannot release before every milestone is accepted', () => {
  const k = kernel();
  const escrow = openFundedEscrow(k);
  assert.equal(escrow.status, ESCROW_STATUS.FUNDED);
  assert.throws(() => k.escrow.release(escrow.escrowId, {}), /not accepted yet/);
});

test('release splits 90/10 and holds a 5% workmanship holdback', () => {
  const k = kernel();
  const escrow = openFundedEscrow(k, { amount: 100_000 });
  const milestone = escrow.plan.milestones[0];
  k.escrow.submitMilestoneEvidence(escrow.escrowId, milestone.milestoneId, {
    evidence: [{ type: 'AFTER_PHOTO', geo: { lat: -26.1, lon: 28.0 } }, { type: 'PRO_SIGNATURE' }],
  });
  k.escrow.acceptMilestone(escrow.escrowId, milestone.milestoneId, { actorId: 'cus_1' });
  const released = k.escrow.release(escrow.escrowId, {});
  const split = released.releases.at(-1).split;

  assert.equal(split.grossCents, 100_000);
  assert.equal(split.platformFeeCents, 10_000);
  assert.equal(split.proPayoutCents, 90_000);
  assert.equal(split.warrantyHoldbackCents, 5_000);
  assert.equal(split.immediateToProCents, 85_000);
  assert.equal(released.status, ESCROW_STATUS.PARTIALLY_RELEASED);
});

test('the holdback releases only after the warranty window closes', () => {
  const k = kernel();
  const escrow = openFundedEscrow(k);
  const milestone = escrow.plan.milestones[0];
  k.escrow.submitMilestoneEvidence(escrow.escrowId, milestone.milestoneId, { evidence: [{ type: 'AFTER_PHOTO' }] });
  k.escrow.acceptMilestone(escrow.escrowId, milestone.milestoneId, { actorId: 'cus_1' });
  k.escrow.release(escrow.escrowId, {});

  assert.throws(() => k.escrow.releaseHoldback(escrow.escrowId), /warranty window still open/);

  k.escrow.adjustHoldbackWindow(escrow.escrowId, {
    holdbackReleaseAt: new Date(Date.now() - 1000).toISOString(),
    reason: 'unit test ages the window',
  });
  const done = k.escrow.releaseHoldback(escrow.escrowId);
  assert.equal(done.status, ESCROW_STATUS.RELEASED);
});

test('a frozen escrow cannot release or refund until the dispute resolves', () => {
  const k = kernel();
  const escrow = openFundedEscrow(k);
  k.escrow.freeze(escrow.escrowId, { reason: 'dispute', actorId: 'cus_1' });
  assert.equal(k.escrow.get(escrow.escrowId).status, ESCROW_STATUS.FROZEN);
  assert.throws(() => k.escrow.release(escrow.escrowId, {}), /frozen/);
  k.escrow.unfreeze(escrow.escrowId, { reason: 'resolved' });
  assert.equal(k.escrow.get(escrow.escrowId).status, ESCROW_STATUS.FUNDED);
});

test('the confirmation window auto-releases and is logged', () => {
  const k = kernel();
  const escrow = k.escrow.open({
    bookingId: 'bkg_auto', customerId: 'cus_1', providerId: 'pro_1',
    amountCents: 50_000, provider: 'paystack', confirmationWindowMinutes: 0,
  });
  k.escrow.confirmFunded(escrow.escrowId, { reference: 'PS_AUTO' });
  const milestone = k.escrow.get(escrow.escrowId).plan.milestones[0];
  k.escrow.submitMilestoneEvidence(escrow.escrowId, milestone.milestoneId, { evidence: [{ type: 'AFTER_PHOTO' }] });

  const sweep = k.escrow.runAutoReleaseSweep();
  assert.equal(sweep.length, 1);
  assert.equal(sweep[0].action, 'AUTO_RELEASED');
  const after = k.escrow.get(escrow.escrowId);
  assert.equal(after.plan.milestones[0].acceptedBy, 'AUTO_RELEASE_POLICY');
  assert.ok(k.ledger.entries.some((e) => e.action === 'AUTO_RELEASE_APPLIED' || e.action === 'PAYMENT_RELEASED' || e.action === 'ESCROW_RELEASED'));
});

test('milestone escrow splits money across stages by weight', () => {
  const k = kernel();
  const escrow = k.escrow.open({
    bookingId: 'bkg_ms', customerId: 'cus_1', providerId: 'pro_1', amountCents: 1_000_000, provider: 'tradesafe',
    milestones: [
      { label: 'Deposit on arrival', weight: 30 },
      { label: 'Progress', weight: 30 },
      { label: 'Completion', weight: 40 },
    ],
  });
  const amounts = escrow.plan.milestones.map((m) => m.amountCents);
  assert.deepEqual(amounts, [300_000, 300_000, 400_000]);
  assert.equal(amounts.reduce((a, b) => a + b, 0), 1_000_000);
});

test('under-funding the escrow is rejected', () => {
  const k = kernel();
  const escrow = k.escrow.open({ bookingId: 'bkg_u', customerId: 'c', providerId: 'p', amountCents: 10_000, provider: 'paystack' });
  assert.throws(() => k.escrow.confirmFunded(escrow.escrowId, { amountCents: 5_000 }), /under-funded/);
});

/* ================= risk ================= */

test('diminishing returns: three weak signals never equal one strong one', () => {
  const k = kernel();
  k.risk.record('a', { type: 'OFF_PLATFORM_CONTACT_REQUEST', severity: 'LOW' });
  k.risk.record('a', { type: 'OFF_PLATFORM_CONTACT_REQUEST', severity: 'LOW' });
  k.risk.record('a', { type: 'PRICE_ANOMALY_HIGH', severity: 'LOW' });

  const k2 = kernel();
  k2.risk.record('b', { type: 'IDENTITY_DOCUMENT_MISMATCH', severity: 'CRITICAL' });

  const weak = k.risk.assess('a').fraudScore;
  const strong = k2.risk.assess('b').fraudScore;
  assert.ok(strong > weak, `one strong signal (${strong}) must outrank three weak ones (${weak})`);
});

test('locality data may only add verification friction — never ranking or pricing', () => {
  const k = kernel();
  const forSafety = k.risk.applyLocalitySignal('pro_9', { suburb: 'X', crimeIndex: 80 }, { forPurpose: 'safety' });
  assert.equal(forSafety.action, RISK_ACTION.STEP_UP_VERIFICATION);

  assert.throws(
    () => k.risk.applyLocalitySignal('pro_9', { suburb: 'X', crimeIndex: 80 }, { forPurpose: 'ranking' }),
    /PROH-001|prohibited/i,
  );
});

test('the cross-account graph links shared devices and phones', () => {
  const k = kernel();
  k.risk.link('pro_A', 'device', 'same-device-hash');
  k.risk.link('pro_B', 'device', 'same-device-hash');
  k.risk.link('pro_A', 'mobile', '0820000000');
  const related = k.risk.relatedSubjects('pro_A');
  assert.equal(related.length, 1);
  assert.equal(related[0].subjectId, 'pro_B');
  assert.deepEqual(related[0].sharedAttributes, ['device']);
});

/* ================= policy ================= */

test('OFP-001 catches cash and personal-account solicitation in messages', () => {
  const k = kernel();
  const flagged = k.policy.evaluate('message', { message: { body: 'Just pay me cash on the day, no need for the platform fee' } });
  assert.notEqual(flagged.decision, POLICY_EFFECT.ALLOW);

  const clean = k.policy.evaluate('message', { message: { body: 'I will arrive at 09:00 with the materials we agreed.' } });
  assert.equal(clean.decision, POLICY_EFFECT.ALLOW);
});

test('OFP-001 does not flag ordinary banking questions about the escrow', () => {
  const k = kernel();
  const ok = k.policy.evaluate('message', { message: { body: 'The escrow reference shows on your statement as TradeSafe; the account number is never shared.' } });
  assert.equal(ok.decision, POLICY_EFFECT.ALLOW);
});

test('REV-001 only allows reviews on escrow-released jobs', () => {
  const k = kernel();
  assert.throws(() => k.policy.enforce('review', { booking: { escrowStatus: ESCROW_STATUS.FUNDED } }), /POLICY|escrow/i);
  assert.doesNotThrow(() => k.policy.enforce('review', { booking: { escrowStatus: ESCROW_STATUS.RELEASED } }));
});

test('POW-001 throws through enforce() while required evidence is missing', () => {
  const k = kernel();
  const booking = {
    status: 'AWAITING_CONFIRMATION',
    milestones: [{ status: 'EVIDENCE_SUBMITTED', missingEvidence: ['AFTER_PHOTO', 'COC_DOCUMENT'] }],
  };
  assert.throws(() => k.policy.enforce('booking', { booking, patch: {}, pro: {} }), /POW-001/);

  const complete = {
    status: 'AWAITING_CONFIRMATION',
    milestones: [{ status: 'EVIDENCE_SUBMITTED', missingEvidence: [] }],
  };
  assert.doesNotThrow(() => k.policy.enforce('booking', { booking: complete, patch: {}, pro: {} }));
});

test('TRD-001 blocks uncertified statutory work but allows a recorded certificate', () => {
  const k = kernel();
  const category = { statutoryTrade: true, label: 'Electrician', trade: 'electrician', regulator: { body: 'DoEL' } };

  const noCert = { verification: { checks: [{ name: 'trade_certification', status: CHECK_STATUS.FAIL }] } };
  assert.throws(() => k.policy.enforce('booking', { category, pro: noCert }), /TRD-001/);

  const recorded = { verification: { checks: [{ name: 'trade_certification', status: CHECK_STATUS.WARN, reference: 'WL-2014-220188' }] } };
  assert.doesNotThrow(() => k.policy.enforce('booking', { category, pro: recorded }));

  const nonStatutory = { statutoryTrade: false, label: 'Painter' };
  assert.doesNotThrow(() => k.policy.enforce('booking', { category: nonStatutory, pro: { verification: { checks: [] } } }));
});

test('VCL-001 detects verified VIN changes on a vehicle listing', () => {
  const k = kernel();
  const listing = {
    asset: { vin: 'VINORIGINAL000001' },
    verification: { status: 'VERIFIED' },
  };
  const decision = k.policy.evaluate('vehicleListing', {
    subject: listing,
    patch: { asset: { vin: 'VINTAMPERED000002' } },
  });
  assert.equal(decision.decision, POLICY_EFFECT.REMOVE);
  assert.equal(decision.firedRules[0].ruleId, 'VCL-001');
});

test('BID-001 locks accepted scope until a variation order is approved', () => {
  const k = kernel();
  const booking = { lockedForVariation: false, variationOrders: [] };
  const decision = k.policy.evaluate('booking', {
    subject: booking,
    patch: { priceCents: 999_000 },
  });
  assert.equal(decision.decision, POLICY_EFFECT.BLOCK);

  const approved = { lockedForVariation: false, variationOrders: [{ status: 'APPROVED' }] };
  const ok = k.policy.evaluate('booking', { subject: approved, patch: { priceCents: 999_000 } });
  assert.equal(ok.decision, POLICY_EFFECT.ALLOW);
});

/* ================= tamper detection on verticals ================= */

test('detectTamper flags critical identifier changes and locked-field edits', () => {
  const k = kernel();
  const before = {
    asset: { vin: 'AHTZZZX0000000001' },
    description: 'One owner',
    priceCents: 26_500_000,
    verification: { status: 'VERIFIED' },
  };
  const critical = k.detectTamper('vehicles', {
    before,
    patch: { asset: { vin: 'AHTZZZX0000000002' } },
    verified: true,
  });
  assert.equal(critical.tampered, true);
  assert.deepEqual(critical.criticalFieldsChanged, ['asset.vin']);

  const locked = k.detectTamper('vehicles', {
    before: { ...before, negotiation: {} },
    patch: { priceCents: 20_000_000 },
    verified: true,
  });
  assert.equal(locked.lockedViolation, true);
});
