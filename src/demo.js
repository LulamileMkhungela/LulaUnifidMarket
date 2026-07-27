'use strict';

const { TrustEscrowEngine, CHECK_STATUS } = require('./trustEscrowEngine');

const engine = new TrustEscrowEngine();

engine.createBuyer({ buyerId: 'buyer_001', displayName: 'Verified Buyer', ficaStatus: 'VERIFIED' });

const vehicle = engine.createListing({
  id: 'vehicle_demo_001',
  type: 'vehicle',
  sellerId: 'seller_001',
  priceCents: 265_000_00,
  description: '2019 Toyota Corolla 1.8 XS, full service history, accident-free per seller declaration.',
  asset: {
    vin: 'AHTZZZ12345678901',
    engineNumber: '2ZR1234567',
    registrationNumber: 'CA123456',
    make: 'Toyota',
    model: 'Corolla 1.8 XS',
    year: 2019,
    odometerKm: 84000,
    condition: 'Used - verified after inspection',
    knownDefects: ['minor bumper scratch'],
  },
  evidence: {
    registrationCertificateHash: 'sha256:reg-cert-demo',
    natisDocumentHash: 'sha256:natis-demo',
    roadworthyCertificateHash: 'sha256:roadworthy-demo',
    inspectionReportHash: 'sha256:inspection-demo',
  },
});

engine.submitVerificationChecks(vehicle.id, [
  { name: 'seller_identity_fica', status: CHECK_STATUS.PASS, source: 'KYC provider', finding: 'Seller ID and address verified' },
  { name: 'vin_engine_registration_match', status: CHECK_STATUS.PASS, source: 'TransUnion/FirstCheck-style adapter', finding: 'VIN, engine, colour and model match' },
  { name: 'ownership_natis', status: CHECK_STATUS.PASS, source: 'NaTIS-style adapter', finding: 'Seller is registered owner/title holder' },
  { name: 'police_stolen_status', status: CHECK_STATUS.PASS, source: 'SAPS-style adapter', finding: 'No stolen flag returned' },
  { name: 'finance_settlement', status: CHECK_STATUS.PASS, source: 'Bank settlement letter', finding: 'No outstanding finance' },
  { name: 'independent_condition_report', status: CHECK_STATUS.PASS, source: 'Independent inspection partner', finding: 'Roadworthy and condition evidence captured' },
]);

engine.startNegotiation(vehicle.id, {
  buyerId: 'buyer_001',
  offerCents: 255_000_00,
  terms: {
    subjectTo: ['fresh roadworthy certificate', 'same VIN at handover'],
    handoverLocation: 'Johannesburg verification centre',
  },
});

const fundConfirmation = engine.confirmBuyerFunds(vehicle.id, {
  buyerId: 'buyer_001',
  amountCents: 255_000_00,
  providerRef: 'bank-open-api-ref-123',
  availableCents: 300_000_00,
  reservationTtlMinutes: 120,
});

engine.openEscrow(vehicle.id, {
  buyerId: 'buyer_001',
  amountCents: 255_000_00,
  escrowProvider: 'Licensed escrow/trust-account partner',
  escrowReference: 'ESCROW-2026-0001',
  conditions: [
    'Buyer confirms VIN and engine number at handover',
    'Independent verifier uploads final condition report',
    'Vehicle transfer documents are signed',
  ],
});

engine.addHandoverEvidence(vehicle.id, {
  type: 'handover_verification',
  verifier: 'Lula verifier 7',
  finding: 'VIN, engine number and roadworthy certificate match locked listing.',
});
engine.markReadyForRelease(vehicle.id, { buyerId: 'buyer_001', accepted: true, verifierApproved: true });
const completed = engine.releaseEscrow(vehicle.id, { releaseReference: 'PAYOUT-2026-0001' });

console.log(JSON.stringify({
  sellerNotification: fundConfirmation.sellerNotification,
  finalStatus: completed.status,
  escrowStatus: completed.escrow.status,
  trustBadge: completed.trustBadge,
  auditEvents: engine.getAuditTrail(vehicle.id).events.map((event) => event.type),
}, null, 2));
