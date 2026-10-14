'use strict';

/**
 * Verticals: the merged vehicles engine, the cross-vertical bridge,
 * Web Studio and the property waitlist.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Marketplace } = require('../src/marketplace');
const { vinCheckDigit, validateSaPlate, LISTING_STATUS } = require('../src/marketplace/vehicles');
const { synthesiseSaId } = require('../src/integrations/saIdentity');
const { CHECK_STATUS } = require('../src/kernel');

function market() {
  return new Marketplace();
}

function seller(mp, name = 'Vehicle Seller') {
  const suburb = mp.catalog.suburb('menlyn');
  const idNumber = synthesiseSaId({ seed: name, age: 41 });
  const customer = mp.people.registerCustomer({ fullName: name, email: `${name.split(' ')[0].toLowerCase()}@example.co.za`, mobile: '0824445555', suburbId: suburb.id });
  mp.people.verifyCustomerChannel(customer.customerId, { channel: 'email', reference: 'E' });
  mp.people.verifyCustomerChannel(customer.customerId, { channel: 'mobile', reference: 'M' });
  return mp.store.get('customers', customer.customerId);
}

function listing(mp, sellerId, overrides = {}) {
  return mp.vehicles.createListing({
    sellerId,
    vin: 'AHTZZZX0000000001',
    engineNumber: '2ZR1234567',
    registrationNumber: 'CA123456',
    make: 'Toyota', model: 'Corolla', year: 2019, odometerKm: 84000,
    priceCents: 26500000,
    description: 'One owner, full service history.',
    suburbId: mp.catalog.suburb('menlyn').id,
    evidence: { natisDocumentHash: 'natis-hash' },
    ...overrides,
  });
}

function allChecksPass() {
  // Every check carries the evidence the profile demands, because ProVeri caps
  // a PASS that arrives without its evidence — that is the whole point.
  return [
    { name: 'seller_identity_fica', status: CHECK_STATUS.PASS, source: 'KYC', reference: 'F1', evidence: { sellerIdRef: 'ref-f' } },
    { name: 'vin_engine_registration_match', status: CHECK_STATUS.PASS, source: 'vehicle data', reference: 'V1', evidence: { vehicleReportRef: 'ref-v' } },
    { name: 'ownership_natis', status: CHECK_STATUS.PASS, source: 'NaTIS', reference: 'N1', evidence: { natisRef: 'ref-n' } },
    { name: 'police_stolen_status', status: CHECK_STATUS.PASS, source: 'SAPS', reference: 'S1', evidence: { stolenCheckRef: 'ref-s' } },
    { name: 'finance_settlement', status: CHECK_STATUS.PASS, source: 'bank', reference: 'FN1', evidence: { settlementLetterHash: 'ref-fn' } },
    { name: 'independent_condition_report', status: CHECK_STATUS.PASS, source: 'DEKRA', reference: 'IR1', evidence: { inspectionReportHash: 'ref-ir' } },
  ];
}

/* ================= VIN & plate validation ================= */

test('VIN structure validation rejects bad characters and lengths', () => {
  assert.equal(vinCheckDigit('AHTZZZX0000000001').valid, true);
  assert.equal(vinCheckDigit('AHTZZZX000000001').valid, false, '16 chars must fail');
  assert.equal(vinCheckDigit('AHTZZZX00000000O1').valid, false, 'the letter O is not a VIN character');
  assert.equal(vinCheckDigit('').valid, false);
});

test('VIN decoding exposes the sections a verifier needs', () => {
  const analysis = vinCheckDigit('AHTZZZX0000000001');
  assert.equal(analysis.worldManufacturerIdentifier, 'AHT');
  assert.equal(analysis.serialNumber, '000001');
  assert.equal(typeof analysis.northAmericanChecksumValid, 'boolean');
});

test('South African plate formats are recognised', () => {
  assert.equal(validateSaPlate('CA123456').valid, true);
  assert.equal(validateSaPlate('GP 123 456').valid, true);
  assert.equal(validateSaPlate('XYZ!!!').valid, false);
});

/* ================= listing lifecycle ================= */

test('a listing is not VERIFIED until every mandatory check passes', () => {
  const mp = market();
  const s = seller(mp);
  const created = listing(mp, s.customerId);
  assert.equal(created.status, LISTING_STATUS.DRAFT);

  const partial = mp.vehicles.submitChecks(created.listingId, allChecksPass().slice(0, 3));
  assert.equal(partial.verification.status, 'IN_PROGRESS');
  assert.notEqual(partial.status, LISTING_STATUS.VERIFIED);

  const full = mp.vehicles.submitChecks(created.listingId, allChecksPass());
  assert.equal(full.status, LISTING_STATUS.VERIFIED);
  assert.equal(full.locks.criticalAssetIdentifiers, true);
});

test('a stolen-flag check fails and removes the listing', () => {
  const mp = market();
  const s = seller(mp);
  const created = listing(mp, s.customerId);
  const checks = allChecksPass();
  checks[3] = { name: 'police_stolen_status', status: CHECK_STATUS.FAIL, source: 'SAPS', finding: 'Reported stolen 2024-03-01' };
  const result = mp.vehicles.submitChecks(created.listingId, checks);
  assert.equal(result.status, LISTING_STATUS.REMOVED);
  assert.equal(result.trustBadge, 'REMOVED_FOR_RISK');
});

test('changing a verified VIN removes the listing (VCL-001)', () => {
  const mp = market();
  const s = seller(mp);
  const created = mp.vehicles.submitChecks(listing(mp, s.customerId).listingId, allChecksPass());
  const updated = mp.vehicles.updateListing(created.listingId, { asset: { vin: 'AHTZZZX0000000002' } }, { actorId: s.customerId });
  assert.equal(updated.accepted, false);
  assert.equal(updated.action, 'REMOVED');
  assert.equal(updated.listing.status, LISTING_STATUS.REMOVED);
});

test('a harmless edit downgrades to RECHECK rather than removing', () => {
  const mp = market();
  const s = seller(mp);
  const created = mp.vehicles.submitChecks(listing(mp, s.customerId).listingId, allChecksPass());
  const updated = mp.vehicles.updateListing(created.listingId, { description: 'One owner, full service history, new tyres.' }, { actorId: s.customerId });
  assert.equal(updated.accepted, true);
  assert.equal(updated.action, 'RECHECK_REQUIRED');
});

test('negotiation locks terms and a mid-negotiation price edit is blocked', () => {
  const mp = market();
  const s = seller(mp);
  const buyer = seller(mp, 'Buyer One');
  const verified = mp.vehicles.submitChecks(listing(mp, s.customerId).listingId, allChecksPass());

  const locked = mp.vehicles.startNegotiation(verified.listingId, { buyerId: buyer.customerId, offerCents: 25500000, terms: { subjectTo: ['roadworthy'] } });
  assert.equal(locked.status, LISTING_STATUS.NEGOTIATION_LOCKED);
  assert.ok(locked.negotiation.lockedFields.includes('priceCents'));

  const edit = mp.vehicles.updateListing(verified.listingId, { priceCents: 20000000 }, { actorId: s.customerId });
  assert.equal(edit.accepted, false);
  assert.equal(edit.action, 'BLOCKED');
  assert.equal(edit.addendumRequired, true);

  // An approved addendum is the only way through.
  const addendum = mp.vehicles.proposeAddendum(verified.listingId, { sellerId: s.customerId, changes: { priceCents: 24000000 }, reason: 'New tyres fitted' });
  const decided = mp.vehicles.acceptAddendum(verified.listingId, { buyerId: buyer.customerId, addendumId: addendum.addendumId, approve: true });
  assert.equal(decided.priceCents, 24000000);
});

test('privacy-preserving funds confirmation never discloses the balance', () => {
  const mp = market();
  const s = seller(mp);
  const buyer = seller(mp, 'Buyer Two');
  const verified = mp.vehicles.submitChecks(listing(mp, s.customerId).listingId, allChecksPass());
  mp.vehicles.startNegotiation(verified.listingId, { buyerId: buyer.customerId, offerCents: 25500000 });

  const confirmation = mp.vehicles.confirmBuyerFunds(verified.listingId, {
    buyerId: buyer.customerId, amountCents: 25500000, providerRef: 'open-banking', availableCents: 40000000,
  });
  const message = confirmation.sellerNotification.message;
  assert.match(message, /sufficient reserved funds/);
  assert.ok(!message.includes('40000000'), 'the balance must never appear in the seller notification');
  assert.ok(!message.includes('40,000,000'));
  assert.deepEqual(confirmation.sellerNotification.notDisclosed.length >= 4, true);
});

test('escrow with outstanding finance settles the bank first', () => {
  const mp = market();
  const s = seller(mp);
  const buyer = seller(mp, 'Buyer Three');
  const verified = mp.vehicles.submitChecks(listing(mp, s.customerId, {
    titleHolder: { type: 'BANK', institution: 'WesBank', settlementCents: 9000000 },
  }).listingId, allChecksPass());
  mp.vehicles.startNegotiation(verified.listingId, { buyerId: buyer.customerId, offerCents: 25500000 });

  const { escrow } = mp.vehicles.openEscrow(verified.listingId, { buyerId: buyer.customerId, amountCents: 25500000 });
  const labels = escrow.plan.milestones.map((m) => m.label);
  assert.match(labels[0], /WesBank/);
  assert.equal(labels.length, 3);
});

/* ================= Service Passport & the cross-vertical bridge ================= */

test('a completed service job appends to the vehicle Service Passport', () => {
  const mp = market();
  const passport = mp.vehicles.appendServiceToPassport({
    vin: 'AHTZZZX0000000001',
    bookingId: 'bkg_service_1',
    categoryId: 'auto-mechanical',
    summary: 'Major service completed and escrow-released',
    proName: 'Pieter du Toit',
  });
  assert.equal(passport.serviceCount, 1);
  assert.equal(passport.entries[0].kind, 'SERVICE');
  assert.ok(passport.entries[0].escrowReleased);

  const fetched = mp.vehicles.getPassport('AHTZZZX0000000001');
  assert.equal(fetched.entries.length, 1);
  assert.match(fetched.proofDigest, /^[0-9a-f]{64}$/);
});

test('an inspection booking bridges its report into a live listing', async () => {
  const mp = market();
  const s = seller(mp);
  const verified = mp.vehicles.submitChecks(listing(mp, s.customerId).listingId, allChecksPass().filter((c) => c.name !== 'independent_condition_report'));
  assert.equal(verified.verification.status, 'IN_PROGRESS');

  const bridge = mp.vehicles.bridgeInspectionToListing({
    listingId: verified.listingId,
    bookingId: 'bkg_inspection_1',
    reportHash: 'report-hash',
    findings: '118-point inspection passed',
    inspectorProId: 'pro_inspector',
  });
  assert.equal(bridge.listing.passport.bridgedFromServices.length, 1);
  const check = bridge.listing.verification.checks.find((c) => c.name === 'independent_condition_report');
  assert.equal(check.status, CHECK_STATUS.PASS);
  assert.match(check.source, /services vertical/);
});

test('the bridge refuses to write into a coming-soon vertical', () => {
  const mp = market();
  assert.throws(() => mp.kernel.bridgeEvidence({
    fromVertical: 'services', fromEntityId: 'bkg_1',
    toVertical: 'property', toEntityId: 'lst_1',
    evidenceType: 'X', summary: 'x',
  }), /coming soon/i);
});

/* ================= property vertical ================= */

test('property is honestly marked coming soon and the waitlist works', () => {
  const mp = market();
  const verticals = mp.verticals();
  const property = verticals.find((v) => v.id === 'property');
  assert.equal(property.status, 'COMING_SOON');
  assert.equal(property.comingSoon, true);

  const joined = mp.joinPropertyWaitlist({ name: 'Hopeful Buyer', email: 'h@example.co.za' });
  assert.equal(joined.position, 1);
});

/* ================= Web Studio ================= */

test('microsites are generated only for verified pros and render live data', async () => {
  const mp = market();
  const suburb = mp.catalog.suburb('soweto');
  const idNumber = synthesiseSaId({ seed: 'web', age: 35 });
  const draft = mp.people.registerPro({
    fullName: 'Web Pro', email: 'web@example.co.za', mobile: '0719998888', idNumber,
    suburbId: suburb.id, primaryCategory: 'plumbing',
    tradeCertification: { certificateNumber: 'PIRB-9', body: 'PIRB' },
    qualification: { saqaId: '61709' },
    insurance: { provider: 'Santam', policyNumber: 'PL-9', coverCents: 1e8 },
    bankDetails: { bankCode: 'capitec', accountNumber: '1020304050', holderName: 'Web Pro' },
    criminalDeclaration: { declared: true },
  });

  const denied = mp.webStudio.generateProMicrosite(draft.proId);
  assert.equal(denied.generated, false, 'an unverified pro must not get a live microsite');

  draft.__idNumber = idNumber;
  mp.store.put('pros', draft.proId, draft);
  await mp.people.runVerificationPipeline(draft.proId, {});
  const pro = mp.store.get('pros', draft.proId);
  assert.equal(pro.canBid, true);

  const site = mp.webStudio.generateProMicrosite(pro.proId);
  assert.equal(site.status, 'LIVE');
  const html = mp.webStudio.renderMicrositeHtml(pro.proId);
  assert.match(html, /ProVeri/);
  assert.match(html, /What has been verified/);
  assert.ok(!html.includes('undefined'), 'rendered HTML must not leak undefined values');
});

test('the Web Studio order flow takes no payment before preview approval', () => {
  const mp = market();
  const order = mp.webStudio.createEnquiry({
    packageId: 'digital-storefront',
    contact: { firstName: 'Sipho', surname: 'Dlamini', email: 's@example.co.za', mobile: '0711112222', businessName: 'Dlamini Plumbing' },
    brief: { whatTheSiteMustDo: 'Get calls' },
  });
  assert.equal(order.status, 'ENQUIRY');
  assert.equal(order.escrowId, null);

  const preview = mp.webStudio.buildPreview(order.orderId);
  assert.equal(preview.status, 'PREVIEW_READY');
  assert.ok(preview.previewUrl);

  const approved = mp.webStudio.approvePreview(order.orderId, { approved: true, paymentProvider: 'payfast' });
  assert.equal(approved.status, 'AWAITING_PAYMENT');
  assert.ok(approved.escrowId, 'escrow opens only after preview approval');

  const paid = mp.webStudio.payOrder(order.orderId, { method: 'card' });
  assert.equal(paid.status, 'IN_BUILD');

  const plan = mp.kernel.escrow.get(paid.escrowId).plan.milestones;
  for (const milestone of plan) {
    mp.webStudio.completeMilestone(order.orderId, { milestoneSeq: milestone.seq, deliverable: milestone.label, actorId: 'studio' });
  }
  const done = mp.webStudio.listOrders().find((o) => o.orderId === order.orderId);
  assert.equal(done.status, 'DELIVERED');
});

test('the rescue diagnostic scores a live URL and seals the report', async () => {
  const mp = market();
  const diagnostic = await mp.webStudio.rescueDiagnostic({ url: 'https://example.com' });
  assert.ok(typeof diagnostic.healthScore === 'number');
  assert.ok(diagnostic.findings.length >= 8);
  assert.match(diagnostic.seal, /^[0-9a-f]{64}$/);
  assert.ok(diagnostic.verdict.length > 10);
});
