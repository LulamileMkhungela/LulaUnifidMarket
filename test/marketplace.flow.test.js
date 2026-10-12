'use strict';

/**
 * End-to-end marketplace flows on a fresh (unseeded) marketplace.
 * These are the journeys a customer or pro actually takes.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Marketplace } = require('../src/marketplace');
const { synthesiseSaId } = require('../src/integrations/saIdentity');
const { BOOKING_STATUS } = require('../src/marketplace/bookings');

function newMarket() {
  return new Marketplace();
}

function makePro(mp, { category = 'plumbing', suburb = 'soweto', name = 'Test Pro', certificate = 'PIRB-TEST-1' } = {}) {
  const suburbRow = mp.catalog.suburb(suburb);
  const idNumber = synthesiseSaId({ seed: name, age: 38 });
  const pro = mp.people.registerPro({
    fullName: name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.co.za`,
    mobile: `07${String(10000000 + Math.floor(Math.random() * 89999999))}`,
    idNumber,
    suburbId: suburbRow.id,
    primaryCategory: category,
    hourlyRateCents: 60000,
    calloutFeeCents: 50000,
    tradeCertification: certificate ? { certificateNumber: certificate, body: 'PIRB' } : {},
    // A pro worth hiring carries insurance and a registered qualification; without
    // them the trust score honestly lands in RECHECK_REQUIRED and they cannot bid.
    qualification: { saqaId: category === 'plumbing' ? '61709' : category === 'electrical' ? '63769' : '61709' },
    insurance: { provider: 'Santam', policyNumber: `PL-${name.replace(/\s+/g, '')}`, coverCents: 100_000_000, expiresAt: new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10) },
    bankDetails: { bankCode: 'capitec', accountNumber: '1020304050', holderName: name },
    criminalDeclaration: { declared: true, noConvictions: true },
  });
  pro.__idNumber = idNumber;
  pro.__mobileOtpRef = 'SMS_TEST';
  pro.__emailOtpRef = 'EMAIL_TEST';
  mp.store.put('pros', pro.proId, pro);
  return mp.people.runVerificationPipeline(pro.proId, {}).then((r) => mp.store.get('pros', pro.proId));
}

function makeCustomer(mp, { name = 'Test Customer', suburb = 'soweto' } = {}) {
  const suburbRow = mp.catalog.suburb(suburb);
  const customer = mp.people.registerCustomer({
    fullName: name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.co.za`,
    mobile: `08${String(10000000 + Math.floor(Math.random() * 89999999))}`,
    suburbId: suburbRow.id,
  });
  mp.people.verifyCustomerChannel(customer.customerId, { channel: 'email', reference: 'E1' });
  mp.people.verifyCustomerChannel(customer.customerId, { channel: 'mobile', reference: 'M1' });
  return mp.store.get('customers', customer.customerId);
}

async function fullJourney(mp) {
  const pro = await makePro(mp);
  const customer = makeCustomer(mp);

  const job = await mp.jobs.postJob({
    customerId: customer.customerId,
    categoryId: 'plumbing',
    title: 'Burst pipe',
    description: 'Burst pipe under the kitchen sink, water on the floor.',
    suburbId: customer.suburbId,
    budgetCents: 250000,
    urgency: 'URGENT',
    locationType: 'IN_HOME',
  });

  const bid = mp.jobs.submitBid({
    jobId: job.jobId,
    proId: pro.proId,
    totalCents: 220000,
    calloutFeeCents: 50000,
    materialsQuoteCents: 60000,
    scopeOfWork: 'Isolate, drain, replace the burst section, pressure test, clean up.',
    inclusions: ['Labour', 'Materials', 'CoC'],
    exclusions: ['Structural damage'],
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    includesCoc: true,
    warrantyDays: 14,
  });

  const booking = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: customer.customerId });
  await mp.bookings.fundBooking({ bookingId: booking.bookingId, customerId: customer.customerId, paymentMethod: 'instant-eft' });

  const suburb = mp.catalog.suburb(customer.suburbId);
  const milestone = mp.store.get('bookings', booking.bookingId).milestones[0];
  mp.bookings.submitEvidence({
    bookingId: booking.bookingId,
    proId: pro.proId,
    milestoneId: milestone.milestoneId,
    items: [
      { type: 'BEFORE_PHOTO', geo: { lat: suburb.lat, lon: suburb.lon } },
      { type: 'AFTER_PHOTO', geo: { lat: suburb.lat, lon: suburb.lon } },
      { type: 'COC_DOCUMENT' },
      { type: 'PRO_SIGNATURE', geo: { lat: suburb.lat, lon: suburb.lon } },
    ],
  });
  mp.bookings.confirmCompletion({ bookingId: booking.bookingId, customerId: customer.customerId, milestoneId: milestone.milestoneId });
  return { pro, customer, job, bid, booking };
}

test('full journey: verify → bid → escrow → proof → release → review', async () => {
  const mp = newMarket();
  const { pro, customer, booking, job } = await fullJourney(mp);

  const final = mp.store.get('bookings', booking.bookingId);
  assert.equal(final.status, BOOKING_STATUS.IN_WARRANTY);
  assert.equal(final.escrowStatus, 'PARTIALLY_RELEASED');

  const escrow = mp.kernel.escrow.get(final.escrowId);
  const split = escrow.releases.at(-1).split;
  assert.equal(split.proPayoutCents, Math.round(220000 * 0.9));
  assert.equal(split.warrantyHoldbackCents, Math.round(220000 * 0.05));

  // The job tracks the booking to completion.
  assert.equal(mp.store.get('jobs', job.jobId).status, 'COMPLETED');

  // Verified review is allowed because escrow reached a terminal state.
  const review = mp.bookings.writeReview({
    bookingId: booking.bookingId, customerId: customer.customerId, rating: 5, comment: 'Excellent.',
  });
  assert.equal(review.verified, true);

  // The pro's stats and badge reflect real delivery history.
  const updatedPro = mp.store.get('pros', pro.proId);
  assert.equal(updatedPro.stats.completedJobs, 1);
  assert.ok(updatedPro.trustScore > 0);

  // Every step landed in the hash-chained ledger.
  const trail = mp.kernel.ledger.publicTimeline(booking.bookingId);
  assert.ok(trail.length >= 6, `expected a rich audit trail, got ${trail.length}`);
  assert.equal(mp.kernel.ledger.verifyChain().valid, true);
});

test('an unverified pro cannot bid (KYC-001)', async () => {
  const mp = newMarket();
  const suburb = mp.catalog.suburb('soweto');
  const idNumber = synthesiseSaId({ seed: 'no-kyc', age: 30 });
  const draft = mp.people.registerPro({
    fullName: 'No Kyc', email: 'nokyc@example.co.za', mobile: '0711111111',
    idNumber, suburbId: suburb.id, primaryCategory: 'handyman',
    criminalDeclaration: { declared: true },
  });
  const customer = makeCustomer(mp);
  const job = await mp.jobs.postJob({
    customerId: customer.customerId, categoryId: 'handyman', title: 'Shelf',
    description: 'Mount a shelf.', suburbId: suburb.id,
  });
  assert.throws(() => mp.jobs.submitBid({ jobId: job.jobId, proId: draft.proId, totalCents: 50000, scopeOfWork: 'x' }), /KYC-001|verified identity/i);
});

test('a statutory trade cannot be awarded without a certificate on file', async () => {
  const mp = newMarket();
  // Pro with NO certificate in a statutory trade.
  const pro = await makePro(mp, { category: 'electrical', name: 'No Cert Sparky', certificate: null });
  assert.equal(pro.canBid, false, 'an uncertified electrician must not be cleared to bid');
});

test('off-site proof-of-work photos hold the payout and raise a risk signal', async () => {
  const mp = newMarket();
  const { pro, customer, booking } = await (async () => {
    const p = await makePro(mp);
    const c = makeCustomer(mp);
    const job = await mp.jobs.postJob({
      customerId: c.customerId, categoryId: 'plumbing', title: 'Leak', description: 'Leak.', suburbId: c.suburbId,
    });
    const bid = mp.jobs.submitBid({ jobId: job.jobId, proId: p.proId, totalCents: 200000, scopeOfWork: 'fix', includesCoc: true });
    const b = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: c.customerId });
    await mp.bookings.fundBooking({ bookingId: b.bookingId, customerId: c.customerId });
    return { pro: p, customer: c, booking: b };
  })();

  const suburb = mp.catalog.suburb(customer.suburbId);
  const milestone = mp.store.get('bookings', booking.bookingId).milestones[0];
  mp.bookings.submitEvidence({
    bookingId: booking.bookingId, proId: pro.proId, milestoneId: milestone.milestoneId,
    items: [
      { type: 'BEFORE_PHOTO', geo: { lat: suburb.lat, lon: suburb.lon } },
      // Captured 12 km away.
      { type: 'AFTER_PHOTO', geo: { lat: suburb.lat + 0.11, lon: suburb.lon + 0.09 } },
      { type: 'PRO_SIGNATURE', geo: { lat: suburb.lat, lon: suburb.lon } },
    ],
  });

  const risk = mp.kernel.risk.assess(pro.proId);
  assert.ok(risk.openSignals.some((s) => s.type === 'EVIDENCE_EXIF_MISMATCH'), 'the geoseal failure must raise a risk signal');
  const evidence = mp.store.get('bookings', booking.bookingId).evidence;
  assert.equal(evidence.find((e) => e.type === 'AFTER_PHOTO').geoVerified, false);
});

test('a variation order cannot move the price until the customer approves it', async () => {
  const mp = newMarket();
  const { pro, customer, booking } = await (async () => {
    const p = await makePro(mp);
    const c = makeCustomer(mp);
    const job = await mp.jobs.postJob({ customerId: c.customerId, categoryId: 'plumbing', title: 'Leak', description: 'Leak.', suburbId: c.suburbId });
    const bid = mp.jobs.submitBid({ jobId: job.jobId, proId: p.proId, totalCents: 200000, scopeOfWork: 'fix', includesCoc: true });
    const b = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: c.customerId });
    await mp.bookings.fundBooking({ bookingId: b.bookingId, customerId: c.customerId });
    return { pro: p, customer: c, booking: b };
  })();

  const proposed = mp.bookings.proposeVariation({
    bookingId: booking.bookingId, proId: pro.proId,
    description: 'The geyser also needs replacing while we are open.', additionalCents: 450000,
  });
  assert.equal(proposed.status, 'PENDING_CUSTOMER_APPROVAL');
  assert.equal(mp.store.get('bookings', booking.bookingId).price.totalCents, 200000, 'the price must not move on proposal alone');

  const rejected = mp.bookings.decideVariation({
    bookingId: booking.bookingId, customerId: customer.customerId, variationId: proposed.variationId, approve: false,
  });
  assert.equal(mp.store.get('bookings', booking.bookingId).price.totalCents, 200000);

  const second = mp.bookings.proposeVariation({
    bookingId: booking.bookingId, proId: pro.proId, description: 'Geyser replacement', additionalCents: 450000,
  });
  mp.bookings.decideVariation({ bookingId: booking.bookingId, customerId: customer.customerId, variationId: second.variationId, approve: true });
  const after = mp.store.get('bookings', booking.bookingId);
  assert.equal(after.price.totalCents, 650000);
  assert.ok(after.escrowTopUpRequired, 'the extra work must be funded into escrow before it is done');
});

test('a dispute freezes escrow and the weighting is explainable', async () => {
  const mp = newMarket();
  const { pro, customer, booking } = await (async () => {
    const p = await makePro(mp);
    const c = makeCustomer(mp);
    const job = await mp.jobs.postJob({ customerId: c.customerId, categoryId: 'plumbing', title: 'Leak', description: 'Leak.', suburbId: c.suburbId });
    const bid = mp.jobs.submitBid({ jobId: job.jobId, proId: p.proId, totalCents: 200000, scopeOfWork: 'fix', includesCoc: true });
    const b = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: c.customerId });
    await mp.bookings.fundBooking({ bookingId: b.bookingId, customerId: c.customerId });
    return { pro: p, customer: c, booking: b };
  })();

  const suburb = mp.catalog.suburb(customer.suburbId);
  const milestone = mp.store.get('bookings', booking.bookingId).milestones[0];
  mp.bookings.submitEvidence({
    bookingId: booking.bookingId, proId: pro.proId, milestoneId: milestone.milestoneId,
    items: [
      { type: 'BEFORE_PHOTO', geo: { lat: suburb.lat, lon: suburb.lon } },
      { type: 'AFTER_PHOTO', geo: { lat: suburb.lat, lon: suburb.lon } },
      { type: 'PRO_SIGNATURE', geo: { lat: suburb.lat, lon: suburb.lon } },
    ],
  });

  const dispute = mp.bookings.openDispute({
    bookingId: booking.bookingId, openedBy: customer.customerId, role: 'CUSTOMER',
    category: 'WORK_INCOMPLETE', description: 'The leak is still there.',
  });
  assert.equal(mp.kernel.escrow.get(mp.store.get('bookings', booking.bookingId).escrowId).status, 'FROZEN');

  mp.bookings.submitDisputeEvidence({ disputeId: dispute.disputeId, actorId: pro.proId, role: 'PRO', evidence: [{ type: 'PHOTO' }], statement: 'Work completed as quoted.' });
  const resolved = mp.bookings.resolveDispute({
    disputeId: dispute.disputeId, outcome: 'PARTIAL', splitPercent: 60,
    reasoning: 'Work substantially done; a return visit is owed.',
  });
  assert.ok(resolved.dispute.resolution.amountToProCents > 0);
  assert.ok(resolved.dispute.resolution.evidenceWeighting);
});

test('cancellation before work starts refunds in full (ECT Act s44)', async () => {
  const mp = newMarket();
  const pro = await makePro(mp);
  const customer = makeCustomer(mp);
  const job = await mp.jobs.postJob({ customerId: customer.customerId, categoryId: 'plumbing', title: 'Leak', description: 'Leak.', suburbId: customer.suburbId });
  const bid = mp.jobs.submitBid({ jobId: job.jobId, proId: pro.proId, totalCents: 200000, scopeOfWork: 'fix', includesCoc: true });
  const booking = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: customer.customerId });
  await mp.bookings.fundBooking({ bookingId: booking.bookingId, customerId: customer.customerId });

  const cancelled = mp.bookings.cancel({ bookingId: booking.bookingId, actorId: customer.customerId, role: 'CUSTOMER', reason: 'Changed my mind before work started' });
  assert.equal(cancelled.cancellation.freeToCancel, true);
  assert.equal(cancelled.cancellation.refundCents, 200000);
  assert.equal(cancelled.status, BOOKING_STATUS.REFUNDED);
});

test('messages that solicit off-platform payment are quarantined and flagged', async () => {
  const mp = newMarket();
  const { pro, customer, booking } = await (async () => {
    const p = await makePro(mp);
    const c = makeCustomer(mp);
    const job = await mp.jobs.postJob({ customerId: c.customerId, categoryId: 'plumbing', title: 'Leak', description: 'Leak.', suburbId: c.suburbId });
    const bid = mp.jobs.submitBid({ jobId: job.jobId, proId: p.proId, totalCents: 200000, scopeOfWork: 'fix', includesCoc: true });
    const b = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: c.customerId });
    return { pro: p, customer: c, booking: b };
  })();

  const message = mp.bookings.sendMessage({
    bookingId: booking.bookingId, fromUserId: pro.proId,
    body: 'Rather pay me cash into my Capitec account, no need for the platform fee.',
  });
  assert.equal(message.flagged, true);
  assert.ok(message.flagRules.some((r) => r.ruleId === 'OFP-001'));

  const risk = mp.kernel.risk.assess(pro.proId);
  assert.ok(risk.openSignals.some((s) => s.type === 'OFF_PLATFORM_PAYMENT_REQUEST'));
});

test('changing payout bank details freezes payouts until call-back verification', async () => {
  const mp = newMarket();
  const { pro, customer, booking } = await (async () => {
    const p = await makePro(mp);
    const c = makeCustomer(mp);
    const job = await mp.jobs.postJob({ customerId: c.customerId, categoryId: 'plumbing', title: 'Leak', description: 'Leak.', suburbId: c.suburbId });
    const bid = mp.jobs.submitBid({ jobId: job.jobId, proId: p.proId, totalCents: 200000, scopeOfWork: 'fix', includesCoc: true });
    const b = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: c.customerId });
    await mp.bookings.fundBooking({ bookingId: b.bookingId, customerId: c.customerId });
    return { pro: p, customer: c, booking: b };
  })();

  const result = await mp.people.requestBankChange(pro.proId, {
    newBank: { bankCode: 'fnb', accountNumber: '9988776655', holderName: pro.fullName },
    callBackConfirmed: false,
  });
  assert.equal(result.callBackRequired, true);
  const escrow = mp.kernel.escrow.get(mp.store.get('bookings', booking.bookingId).escrowId);
  assert.equal(escrow.status, 'FROZEN');
});

test('matching explains itself and hides blocked pros', async () => {
  const mp = newMarket();
  const good = await makePro(mp, { name: 'Good Plumber' });
  const uncertified = await makePro(mp, { category: 'electrical', name: 'Uncertified Sparky', certificate: null });
  const customer = makeCustomer(mp);

  const job = await mp.jobs.postJob({
    customerId: customer.customerId, categoryId: 'plumbing', title: 'Leak', description: 'Kitchen leak.', suburbId: customer.suburbId,
  });
  const match = await mp.jobs.matchPros(job.jobId);
  assert.ok(match.candidates.some((c) => c.proId === good.proId));
  assert.ok(match.candidates.every((c) => c.eligible));
  assert.ok(match.fairness.statement.includes('never uses'));

  const electrical = await mp.jobs.postJob({
    customerId: customer.customerId, categoryId: 'electrical', title: 'DB', description: 'DB board fault.', suburbId: customer.suburbId,
  });
  const match2 = await mp.jobs.matchPros(electrical.jobId);
  assert.ok(!match2.candidates.some((c) => c.proId === uncertified.proId), 'an uncertified electrician must not be matched');
});

test('the scheduler closes matured warranties and releases holdbacks', async () => {
  const mp = newMarket();
  const { booking } = await fullJourney(mp);

  const current = mp.store.get('bookings', booking.bookingId);
  const aged = new Date(Date.now() - 1000).toISOString();
  current.warranty.endsAt = aged;
  mp.kernel.escrow.adjustHoldbackWindow(current.escrowId, { holdbackReleaseAt: aged, reason: 'test' });

  const sweep = mp.runSchedulerOnce();
  assert.ok(sweep.warrantyClosed.includes(booking.bookingId));
  const after = mp.store.get('bookings', booking.bookingId);
  assert.equal(after.status, BOOKING_STATUS.CLOSED);
  assert.equal(after.warranty.released, true);
});
