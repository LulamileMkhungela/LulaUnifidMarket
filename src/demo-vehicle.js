'use strict';

/**
 * ProVeri — vehicles journey demo (the merged TrustShield rail).
 *
 * Prints one complete private vehicle sale on a fresh marketplace:
 * listing → verification (VIN, ownership, stolen, finance, condition) →
 * inspection booked as a SERVICE and bridged into the listing → negotiation
 * lock → privacy-preserving funds confirmation → TradeSafe escrow with the
 * title-holder release order → handover evidence with a final VIN check →
 * release → Service Passport.
 *
 *   npm run demo:vehicle
 */

process.env.PROVERI_INTEGRATION_MODE = process.env.PROVERI_INTEGRATION_MODE || 'offline';

const { Marketplace } = require('./marketplace');
const { synthesiseSaId } = require('./integrations/saIdentity');
const { money } = require('./marketplace/format');
const { CHECK_STATUS } = require('./kernel');

function heading(text) {
  process.stdout.write(`\n${'='.repeat(72)}\n${text}\n${'='.repeat(72)}\n`);
}
function line(label, value) {
  process.stdout.write(`${String(label).padEnd(36)} ${value}\n`);
}

const VIN = 'AHTZZZX0000000001';

(async () => {
  const mp = new Marketplace();
  heading('LULA PROVERI — one car, end to end (TrustShield rail)');

  const menlyn = mp.catalog.suburb('menlyn');
  const seller = mp.people.registerCustomer({
    fullName: 'Mariette Coetzee', email: 'mariette.demo@example.co.za', mobile: '0821110000', suburbId: menlyn.id,
  });
  mp.people.verifyCustomerChannel(seller.customerId, { channel: 'email', reference: 'E' });
  mp.people.verifyCustomerChannel(seller.customerId, { channel: 'mobile', reference: 'M' });
  const buyer = mp.people.registerCustomer({
    fullName: 'Naledi Sithole', email: 'naledi.demo@example.co.za', mobile: '0821234567', suburbId: menlyn.id,
  });
  mp.people.verifyCustomerChannel(buyer.customerId, { channel: 'email', reference: 'E' });
  mp.people.verifyCustomerChannel(buyer.customerId, { channel: 'mobile', reference: 'M' });

  /* 1. listing */
  heading('1 · LISTING INTAKE');
  const listing = mp.vehicles.createListing({
    sellerId: seller.customerId,
    vin: VIN,
    engineNumber: '2ZR1234567',
    registrationNumber: 'CA123456',
    make: 'Toyota', model: 'Corolla 1.8 XS', year: 2019, odometerKm: 84000,
    colour: 'Pearl White',
    priceCents: 26500000,
    description: 'One owner, full agent service history, accident-free per declaration. Two keys.',
    condition: 'Excellent',
    knownDefects: ['Minor rear-left bumper scuff, touched up'],
    includedItems: ['Two keys', 'Service book', 'Spare wheel and tools'],
    suburbId: menlyn.id,
    evidence: { natisDocumentHash: 'natis-demo', registrationCertificateHash: 'rc1-demo' },
    titleHolder: { type: 'NONE' },
    serviceHistory: [
      { at: '2024-03-14', odometerKm: 60100, agent: 'Toyota Menlyn', items: ['Major service'] },
      { at: '2025-05-02', odometerKm: 74800, agent: 'Toyota Menlyn', items: ['Major service', 'Front brake pads'] },
    ],
  });
  line('reference', listing.reference);
  line('VIN seal', listing.asset.vinAnalysis.worldManufacturerIdentifier + '…' + listing.asset.vinAnalysis.serialNumber);
  line('plate', `${listing.asset.registrationNumber} (${listing.asset.plateFormat})`);
  line('status', listing.status);

  /* 2. verification */
  heading('2 · VERIFICATION BEFORE ANY BADGE');
  const verified = mp.vehicles.submitChecks(listing.listingId, [
    { name: 'seller_identity_fica', status: CHECK_STATUS.PASS, source: 'KYC provider — DHA NPR real-time', reference: 'F1', evidence: { sellerIdRef: 'r' } },
    { name: 'vin_engine_registration_match', status: CHECK_STATUS.PASS, source: 'TransUnion FirstCheck-class', reference: 'V1', evidence: { vehicleReportRef: 'r' } },
    { name: 'ownership_natis', status: CHECK_STATUS.PASS, source: 'NaTIS-class ownership lookup', reference: 'N1', evidence: { natisRef: 'r' } },
    { name: 'police_stolen_status', status: CHECK_STATUS.PASS, source: 'SAPS stolen-vehicle indicator', reference: 'S1', evidence: { stolenCheckRef: 'r' } },
    { name: 'finance_settlement', status: CHECK_STATUS.PASS, source: 'NaTIS title-holder record', reference: 'FN1', evidence: { settlementLetterHash: 'none-required' } },
  ]);
  line('status after 5 of 6 checks', `${verified.status} (condition report still outstanding)`);

  /* 3. inspection as a service, bridged */
  heading('3 · PRE-PURCHASE INSPECTION AS A SERVICE → BRIDGED');
  const inspectorIdNumber = synthesiseSaId({ seed: 'inspector', age: 44 });
  const inspector = mp.people.registerPro({
    fullName: 'David Molefe',
    email: 'david.demo@example.co.za',
    mobile: '0713334444',
    idNumber: inspectorIdNumber,
    suburbId: mp.catalog.suburb('randburg').id,
    primaryCategory: 'vehicle-inspection',
    about: 'Independent assessor. No interest in any sale. The report goes to the buyer and to the listing.',
    qualification: { saqaId: '63469' },
    insurance: { provider: 'Santam', policyNumber: 'PL-ASSESSOR-1', coverCents: 50_000_000 },
    bankDetails: { bankCode: 'fnb', accountNumber: '6050403020', holderName: 'David Molefe' },
    criminalDeclaration: { declared: true, noConvictions: true },
  });
  inspector.__idNumber = inspectorIdNumber;
  inspector.__mobileOtpRef = 'SMS_INS';
  inspector.__emailOtpRef = 'EMAIL_INS';
  mp.store.put('pros', inspector.proId, inspector);
  await mp.people.runVerificationPipeline(inspector.proId, {});
  const inspectorId = inspector.proId;
  line('inspector', `${mp.store.get('pros', inspectorId).displayName} · ${mp.store.get('pros', inspectorId).badge} · ${mp.store.get('pros', inspectorId).trustScore}/100`);

  const inspectionJob = await mp.jobs.postJob({
    customerId: buyer.customerId, categoryId: 'vehicle-inspection',
    title: 'Pre-purchase inspection: 2019 Toyota Corolla',
    description: 'Private seller in Menlyn. Advert claims full service history and accident-free. Independent inspection before any money moves.',
    suburbId: menlyn.id, budgetCents: 165000, urgency: 'URGENT',
  });
  const inspectionBid = mp.jobs.submitBid({
    jobId: inspectionJob.jobId, proId: inspectorId, totalCents: 145000,
    scopeOfWork: '118-point inspection, compression test, paint-depth scan, OBD scan, VIN and odometer verification, road test.',
    inclusions: ['Full written report', 'Photos', 'Verbal debrief'], warrantyDays: 0,
  });
  const inspectionBooking = mp.bookings.acceptBid({ jobId: inspectionJob.jobId, bidId: inspectionBid.bidId, customerId: buyer.customerId });
  await mp.bookings.fundBooking({ bookingId: inspectionBooking.bookingId, customerId: buyer.customerId });
  const ms = mp.store.get('bookings', inspectionBooking.bookingId).milestones[0];
  mp.bookings.submitEvidence({
    bookingId: inspectionBooking.bookingId, proId: inspectorId, milestoneId: ms.milestoneId,
    items: [
      { type: 'BEFORE_PHOTO', note: 'Vehicle as presented by the seller', geo: { lat: menlyn.lat, lon: menlyn.lon } },
      { type: 'VIN_PHOTO', note: VIN, geo: { lat: menlyn.lat, lon: menlyn.lon } },
      { type: 'ODOMETER_PHOTO', note: '84,000 km — consistent with the agent service book', geo: { lat: menlyn.lat, lon: menlyn.lon } },
      { type: 'INSPECTION_REPORT', note: '118-point report: pass, no accident repair evidence' },
      { type: 'AFTER_PHOTO', note: 'Vehicle as inspected', geo: { lat: menlyn.lat, lon: menlyn.lon } },
      { type: 'PRO_SIGNATURE', note: 'Assessor sign-off', geo: { lat: menlyn.lat, lon: menlyn.lon } },
    ],
  });
  mp.bookings.confirmCompletion({ bookingId: inspectionBooking.bookingId, customerId: buyer.customerId, milestoneId: ms.milestoneId });
  const bridge = mp.vehicles.bridgeInspectionToListing({
    listingId: listing.listingId,
    bookingId: inspectionBooking.bookingId,
    reportHash: 'inspection-report-demo',
    findings: '118-point inspection passed; VIN verified on the vehicle; odometer consistent; no accident repair evidence.',
    inspectorProId: inspectorId,
  });
  line('bridge receipt', bridge.receipt.bridgeId);
  line('listing status now', `${bridge.listing.status} · ${bridge.listing.trustBadge} · ${bridge.listing.trustScore}/100`);
  line('condition check source', bridge.listing.verification.checks.find((c) => c.name === 'independent_condition_report').source);

  /* 4. tamper demonstration */
  heading('4 · TAMPER = REMOVED (the TrustShield rule)');
  const tamper = mp.vehicles.updateListing(listing.listingId, { asset: { odometerKm: 62000 } }, { actorId: seller.customerId, reason: 'seller “corrected” the odometer' });
  line('odometer edit accepted?', tamper.accepted ? 'yes' : 'NO');
  line('action', tamper.action);
  line('why', 'odometer is a critical field; a verified listing that changes one is removed, not warned');

  /* 5. a clean second listing goes the distance */
  heading('5 · NEGOTIATION LOCK → PRIVACY-PRESERVING FUNDS → ESCROW');
  const second = mp.vehicles.submitChecks(
    mp.vehicles.createListing({
      sellerId: seller.customerId, vin: 'AHTZZZX0000000002', engineNumber: '2ZR7654321',
      registrationNumber: 'CA654321', make: 'Toyota', model: 'Corolla 1.8 XS', year: 2020, odometerKm: 61000,
      priceCents: 28900000, description: 'One owner, full agent history.', suburbId: menlyn.id,
      evidence: { natisDocumentHash: 'natis-demo-2' }, titleHolder: { type: 'NONE' },
    }).listingId,
    [
      { name: 'seller_identity_fica', status: CHECK_STATUS.PASS, source: 'KYC', reference: 'F2', evidence: { sellerIdRef: 'r' } },
      { name: 'vin_engine_registration_match', status: CHECK_STATUS.PASS, source: 'vehicle data', reference: 'V2', evidence: { vehicleReportRef: 'r' } },
      { name: 'ownership_natis', status: CHECK_STATUS.PASS, source: 'NaTIS', reference: 'N2', evidence: { natisRef: 'r' } },
      { name: 'police_stolen_status', status: CHECK_STATUS.PASS, source: 'SAPS', reference: 'S2', evidence: { stolenCheckRef: 'r' } },
      { name: 'finance_settlement', status: CHECK_STATUS.PASS, source: 'title holder', reference: 'FN2', evidence: { settlementLetterHash: 'none' } },
      { name: 'independent_condition_report', status: CHECK_STATUS.PASS, source: 'DEKRA-class', reference: 'IR2', evidence: { inspectionReportHash: 'r' } },
    ],
  );
  line('status', `${second.status} · ${second.trustBadge}`);

  const locked = mp.vehicles.startNegotiation(second.listingId, {
    buyerId: buyer.customerId, offerCents: 27500000,
    terms: { subjectTo: ['fresh roadworthy certificate', 'same VIN at handover', 'NaTIS transfer before final release'] },
  });
  line('negotiation', `locked ${locked.negotiation.lockedFields.length} fields at ${money(locked.negotiation.offerCents)}`);
  const priceEdit = mp.vehicles.updateListing(second.listingId, { priceCents: 24000000 }, { actorId: seller.customerId });
  line('silent price cut', `${priceEdit.action} — addendum required`);

  const funds = mp.vehicles.confirmBuyerFunds(second.listingId, {
    buyerId: buyer.customerId, amountCents: 27500000, providerRef: 'open-banking-reservation', availableCents: 32000000,
  });
  line('seller is told', funds.sellerNotification.message);
  line('seller is NOT told', funds.sellerNotification.notDisclosed.join(', '));

  const opened = mp.vehicles.openEscrow(second.listingId, { buyerId: buyer.customerId, amountCents: 27500000, escrowProvider: 'tradesafe' });
  const escrow = opened.escrow;
  const escrowId = opened.listing.escrowId;
  line('escrow provider', escrow.providerLabel);
  line('release order', mp.kernel.vertical('vehicles').plugin.releaseOrder.map((s, i) => `${i + 1}. ${s}`).join(' | ').slice(0, 110) + '…');
  mp.vehicles.fundEscrow(second.listingId, { reference: 'TS-DEMO-1' });
  mp.vehicles.addHandoverEvidence(second.listingId, {
    items: [
      { type: 'VIN_PLATE_PHOTO', note: VIN.replace(/1$/, '2'), geo: { lat: menlyn.lat, lon: menlyn.lon } },
      { type: 'ODOMETER_PHOTO', note: '61,000 km at handover', geo: { lat: menlyn.lat, lon: menlyn.lon } },
      { type: 'SALE_AGREEMENT', note: 'Signed by both parties' },
      { type: 'BUYER_HANDOVER_ACCEPTANCE', note: 'Buyer accepts the vehicle as inspected', geo: { lat: menlyn.lat, lon: menlyn.lon } },
    ],
    verifierId: inspectorId,
    findings: 'Final VIN check matches the locked listing; documents complete.',
  });
  const escrowLive = mp.kernel.escrow.get(escrowId);
  mp.kernel.escrow.acceptMilestone(escrowId, escrowLive.plan.milestones[0].milestoneId, {
    actorId: buyer.customerId, comment: 'Keys, documents and final VIN check accepted at handover.',
  });
  const transfer = mp.kernel.escrow.get(escrowId).plan.milestones[1];
  mp.kernel.escrow.submitMilestoneEvidence(escrowId, transfer.milestoneId, {
    evidence: [
      { type: 'NCO_OR_RLV_TRANSFER', note: 'NCO lodged; NaTIS transfer confirmed in the buyer’s name' },
      { type: 'ROADWORTHY_CERTIFICATE', note: 'Fresh roadworthy certificate issued' },
    ],
  });
  mp.kernel.escrow.acceptMilestone(escrowId, transfer.milestoneId, {
    actorId: buyer.customerId, comment: 'NaTIS transfer confirmed.',
  });
  mp.vehicles.markReadyForRelease(second.listingId, { buyerId: buyer.customerId, accepted: true, verifierApproved: true });
  const sold = mp.vehicles.release(second.listingId, { releaseReference: 'TS-RELEASE-1' });
  line('sale', `${sold.listing.status} at ${money(sold.listing.priceCents)} — funds released after handover evidence`);

  /* 6. service passport */
  heading('6 · VEHICLE SERVICE PASSPORT');
  mp.vehicles.appendServiceToPassport({
    vin: 'AHTZZZX0000000002', bookingId: 'bkg_post_sale_service', categoryId: 'auto-mechanical',
    summary: 'First post-sale service: oils, filters, brake fluid — escrow-released on ProVeri', proName: 'Pieter du Toit',
  });
  const passport = mp.vehicles.getPassport('AHTZZZX0000000002');
  line('entries', passport.entries.map((e) => `${e.kind}:${e.categoryLabel || 'sale'}`).join(' → '));
  line('proof digest', passport.proofDigest.slice(0, 24) + '…');
  line('why it matters', 'every entry cost somebody real money, so the history cannot be faked');

  const receipt = mp.kernel.ledger.integrityReceipt();
  line('ledger entries', receipt.entries);
  line('chain valid', receipt.chainValid);

  heading('DONE');
  process.stdout.write('The services rail is `npm run demo`; the full marketplace is `npm start`.\n\n');
})().catch((error) => {
  process.stderr.write(`demo failed: ${error.stack}\n`);
  process.exit(1);
});
