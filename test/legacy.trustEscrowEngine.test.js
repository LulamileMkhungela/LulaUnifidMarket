'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TrustEscrowEngine,
  CHECK_STATUS,
  LISTING_STATUS,
  ESCROW_STATUS,
} = require('../src/kernel/legacy/trustEscrowEngine');

function createVerifiedVehicle(engine = new TrustEscrowEngine()) {
  const listing = engine.createListing({
    id: 'vehicle_test_001',
    type: 'vehicle',
    sellerId: 'seller_001',
    priceCents: 200_000_00,
    description: 'Clean hatchback with verified identifiers.',
    asset: {
      vin: 'VIN12345678900001',
      engineNumber: 'ENG12345',
      registrationNumber: 'GP12345',
      make: 'Volkswagen',
      model: 'Polo',
      year: 2020,
      odometerKm: 62000,
      condition: 'Good',
      knownDefects: [],
    },
    evidence: {
      registrationCertificateHash: 'sha256:registration',
      natisDocumentHash: 'sha256:natis',
      roadworthyCertificateHash: 'sha256:roadworthy',
      inspectionReportHash: 'sha256:inspection',
    },
  });

  engine.submitVerificationChecks(listing.id, [
    { name: 'seller_identity_fica', status: CHECK_STATUS.PASS },
    { name: 'vin_engine_registration_match', status: CHECK_STATUS.PASS },
    { name: 'ownership_natis', status: CHECK_STATUS.PASS },
    { name: 'police_stolen_status', status: CHECK_STATUS.PASS },
    { name: 'finance_settlement', status: CHECK_STATUS.PASS },
    { name: 'independent_condition_report', status: CHECK_STATUS.PASS },
  ]);

  return { engine, listingId: listing.id };
}

test('a vehicle becomes verified only after all mandatory checks pass', () => {
  const { engine, listingId } = createVerifiedVehicle();
  const listing = engine.getListing(listingId);

  assert.equal(listing.status, LISTING_STATUS.VERIFIED);
  assert.equal(listing.verification.status, 'VERIFIED');
  assert.equal(listing.trustBadge, 'VIN_AND_ESCROW_READY');
  assert.equal(listing.locks.criticalAssetIdentifiers, true);
  assert.equal(listing.verification.missingChecks.length, 0);
});

test('changing a verified VIN removes the listing immediately', () => {
  const { engine, listingId } = createVerifiedVehicle();

  const result = engine.updateListing(listingId, { asset: { vin: 'DIFFERENTVIN0000002' } }, { actorId: 'seller_001' });

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'REMOVED');
  assert.equal(result.listing.status, LISTING_STATUS.REMOVED);
  assert.equal(result.incident.code, 'CRITICAL_ASSET_TAMPER');
});

test('description and price are blocked after negotiation starts', () => {
  const { engine, listingId } = createVerifiedVehicle();

  engine.startNegotiation(listingId, { buyerId: 'buyer_001', offerCents: 195_000_00 });
  const result = engine.updateListing(
    listingId,
    { description: 'Actually this is a different model now', priceCents: 215_000_00 },
    { actorId: 'seller_001' },
  );

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'BLOCKED');
  assert.equal(result.listing.description, 'Clean hatchback with verified identifiers.');
  assert.equal(result.listing.priceCents, 200_000_00);
  assert.equal(result.listing.status, LISTING_STATUS.NEGOTIATION_LOCKED);
});

test('buyer fund confirmation notifies seller without exposing exact account balance', () => {
  const { engine, listingId } = createVerifiedVehicle();
  engine.createBuyer({ buyerId: 'buyer_001', displayName: 'Buyer', ficaStatus: 'VERIFIED' });

  const confirmation = engine.confirmBuyerFunds(listingId, {
    buyerId: 'buyer_001',
    amountCents: 200_000_00,
    providerRef: 'bank-ref',
    availableCents: 500_000_00,
  });

  assert.equal(confirmation.sufficient, true);
  assert.equal(confirmation.sellerNotification.balanceDisclosed, false);
  assert.match(confirmation.sellerNotification.message, /Exact account balance is not disclosed/);
  assert.equal(engine.getListing(listingId).status, LISTING_STATUS.BUYER_FUNDS_CONFIRMED);
});

test('escrow can be funded, approved, and released after handover evidence', () => {
  const { engine, listingId } = createVerifiedVehicle();
  engine.createBuyer({ buyerId: 'buyer_001', displayName: 'Buyer', ficaStatus: 'VERIFIED' });
  engine.confirmBuyerFunds(listingId, {
    buyerId: 'buyer_001',
    amountCents: 200_000_00,
    providerRef: 'bank-ref',
    availableCents: 220_000_00,
  });
  engine.openEscrow(listingId, {
    buyerId: 'buyer_001',
    amountCents: 200_000_00,
    escrowProvider: 'TradeSafe/Truzo-style adapter',
    escrowReference: 'ESC123',
    conditions: ['buyer acceptance', 'verifier approval'],
  });
  engine.addHandoverEvidence(listingId, { type: 'final_vin_check', finding: 'Match' });
  engine.markReadyForRelease(listingId, { buyerId: 'buyer_001', accepted: true, verifierApproved: true });
  const completed = engine.releaseEscrow(listingId, { releaseReference: 'PAY123' });

  assert.equal(completed.status, LISTING_STATUS.COMPLETED);
  assert.equal(completed.escrow.status, ESCROW_STATUS.RELEASED);
});

test('continuous monitoring removes verified listing when a high-risk signal appears', () => {
  const { engine, listingId } = createVerifiedVehicle();

  const monitored = engine.runContinuousMonitoring(listingId, [
    {
      type: 'POLICE_STOLEN_FLAG_CHANGED',
      severity: 'CRITICAL',
      source: 'SAPS-style adapter',
      message: 'The vehicle was reported stolen after initial verification.',
    },
  ]);

  assert.equal(monitored.status, LISTING_STATUS.REMOVED);
  assert.equal(monitored.removal.code, 'CONTINUOUS_MONITORING_RED_FLAG');
});

test('a verified property title deed change removes the listing', () => {
  const engine = new TrustEscrowEngine();
  const listing = engine.createListing({
    id: 'property_test_001',
    type: 'property',
    sellerId: 'seller_property_001',
    priceCents: 1_850_000_00,
    description: 'Three-bedroom townhouse with verified ownership evidence.',
    asset: {
      titleDeedNumber: 'T12345/2020',
      erfNumber: 'ERF-7788',
      sectionalTitleUnit: 'Unit 12',
      municipality: 'City of Johannesburg',
      address: '12 Secure Estate, Johannesburg',
      condition: 'Owner occupied',
    },
    evidence: {
      titleDeedHash: 'sha256:title-deed',
      municipalAccountHash: 'sha256:municipal',
      clearanceCertificateHash: 'sha256:clearance',
    },
  });

  engine.submitVerificationChecks(listing.id, [
    { name: 'seller_identity_fica', status: CHECK_STATUS.PASS },
    { name: 'deeds_office_title', status: CHECK_STATUS.PASS },
    { name: 'municipal_account_clearance', status: CHECK_STATUS.PASS },
    { name: 'bond_and_encumbrance_search', status: CHECK_STATUS.PASS },
    { name: 'agent_ppra_ffc', status: CHECK_STATUS.PASS },
    { name: 'conveyancer_trust_account', status: CHECK_STATUS.PASS },
  ]);

  const result = engine.updateListing(
    listing.id,
    { asset: { titleDeedNumber: 'T99999/2026' } },
    { actorId: 'seller_property_001' },
  );

  assert.equal(result.accepted, false);
  assert.equal(result.action, 'REMOVED');
  assert.equal(result.listing.status, LISTING_STATUS.REMOVED);
  assert.equal(result.incident.code, 'CRITICAL_ASSET_TAMPER');
});
