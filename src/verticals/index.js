'use strict';

/**
 * Lula ProVeri — Vertical plugins.
 *
 * A vertical tells the Trust Kernel what "trust" means in its world: which
 * verification profile applies, which fields are critical, which fields lock
 * once a deal starts, and what evidence must exist before money moves.
 *
 *   services — LIVE.        The ServicePro-parity core: post a job, verified
 *                           pros bid, escrow holds the money, proof of work
 *                           releases it.
 *   vehicles — LIVE (beta). The merged TrustShield vertical: verified VIN,
 *                           ownership, stolen and finance checks, immutable
 *                           listing versions, escrow to handover.
 *   property — COMING SOON. Deeds, municipal clearance, PPRA/FFC and
 *                           conveyancer trust-account verification.
 */

const { VERTICAL_STATUS } = require('../kernel/trustKernel');

const SERVICES = Object.freeze({
  id: 'services',
  label: 'Home & business services',
  description: 'Post a job, get bids from KYC-verified pros near you, pay into escrow, release on proof of work.',
  status: VERTICAL_STATUS.LIVE,
  verificationProfile: 'servicePro',
  defaultEscrowProvider: 'paystack',
  defaultFeePercent: 10,

  /** Changing these after a bid is accepted removes the booking. */
  criticalFields: [
    'pro.proId',
    'pro.payoutBank.bankCode',
    'pro.payoutBank.accountNumber',
    'pro.verification.badge',
    'job.categoryId',
    'job.address.suburb',
    'booking.escrowId',
    'booking.priceCents',
  ],

  /** These lock once a bid is accepted; changes need an approved variation order. */
  lockedFields: [
    'scopeOfWork',
    'priceCents',
    'inclusions',
    'exclusions',
    'materialsQuoteCents',
    'scheduledAt',
    'includesCoc',
    'warrantyDays',
  ],

  /** Evidence types the escrow engine requires before it will release. */
  requiredEvidence: ['BEFORE_PHOTO', 'AFTER_PHOTO', 'PRO_SIGNATURE', 'CUSTOMER_CONFIRMATION'],

  /** Evidence types whose geolocation must match the job address. */
  geoSealedEvidence: ['BEFORE_PHOTO', 'AFTER_PHOTO', 'PROGRESS_PHOTO', 'COC_DOCUMENT', 'MATERIALS_RECEIPT'],

  warrantyDays: 14,
  confirmationWindowMinutes: 48 * 60,
  paymentWindowMinutes: 120,

  cancellation: {
    beforePayment: 'Free, instant, no reason required.',
    afterPaymentBeforeStart: 'Full refund via the dispute centre — both sides are heard.',
    afterWorkStarts: 'ECT Act s44 cooling-off no longer applies once the service has begun with the customer’s consent. Partial outcome assessed on evidence.',
    byPro: 'Full refund to the customer; the job reopens to other verified pros; the pro’s reliability score is affected.',
  },
});

const VEHICLES = Object.freeze({
  id: 'vehicles',
  label: 'Verified vehicles',
  description: 'Private and dealer vehicle sales where the advert provably matches the car — VIN, ownership, stolen status, finance and condition verified, then escrowed to handover.',
  status: VERTICAL_STATUS.BETA,
  verificationProfile: 'vehicleListing',
  defaultEscrowProvider: 'tradesafe',
  defaultFeePercent: 1.5,

  criticalFields: [
    'asset.vin',
    'asset.engineNumber',
    'asset.registrationNumber',
    'asset.make',
    'asset.model',
    'asset.year',
    'asset.odometerKm',
    'sellerId',
    'evidence.registrationCertificateHash',
    'evidence.natisDocumentHash',
    'evidence.roadworthyCertificateHash',
  ],

  lockedFields: [
    'description',
    'priceCents',
    'asset.condition',
    'asset.includedItems',
    'asset.knownDefects',
    'evidence.inspectionReportHash',
  ],

  requiredEvidence: [
    'VIN_PLATE_PHOTO',
    'ODOMETER_PHOTO',
    'REGISTRATION_CERTIFICATE',
    'SALE_AGREEMENT',
    'NCO_OR_RLV_TRANSFER',
    'ROADWORTHY_CERTIFICATE',
    'BUYER_HANDOVER_ACCEPTANCE',
  ],

  geoSealedEvidence: ['VIN_PLATE_PHOTO', 'ODOMETER_PHOTO', 'BUYER_HANDOVER_ACCEPTANCE'],

  warrantyDays: 0,
  confirmationWindowMinutes: 24 * 60,

  /**
   * Release order when a bank is the title holder — the TrustShield rule that
   * stops a buyer paying off a car they never receive the papers for.
   */
  releaseOrder: [
    'Settle the bank / title holder from escrow',
    'Receive paid-up and settlement confirmation',
    'Confirm NaTIS ownership transfer to the buyer',
    'Hand over keys and documents with a final VIN check',
    'Release the remaining balance to the seller',
  ],

  /** Services that write evidence into a vehicle listing — the cross-vertical bridge. */
  bridgedServiceCategories: ['vehicle-inspection', 'auto-mechanical', 'towing-transport'],

  cancellation: {
    beforeEscrow: 'Free, instant.',
    afterEscrowBeforeHandover: 'Full refund unless the seller has incurred verifiable costs (title-holder settlement already paid).',
    afterHandover: 'Dispute centre with the evidence bundle; TradeSafe adjudicates.',
  },
});

const PROPERTY = Object.freeze({
  id: 'property',
  label: 'Property & conveyancing',
  description: 'Title, municipal clearance, PPRA/FFC agent verification and conveyancer trust-account protection for deposits and Offers to Purchase.',
  status: VERTICAL_STATUS.COMING_SOON,
  verificationProfile: 'propertyListing',
  defaultEscrowProvider: 'bankTrustAccount',
  defaultFeePercent: 0,

  criticalFields: [
    'asset.titleDeedNumber',
    'asset.erfNumber',
    'asset.sectionalTitleUnit',
    'asset.municipality',
    'asset.address',
    'sellerId',
    'evidence.titleDeedHash',
    'evidence.municipalAccountHash',
    'evidence.clearanceCertificateHash',
  ],
  lockedFields: ['description', 'priceCents', 'otpTerms', 'depositCents'],
  requiredEvidence: [
    'TITLE_DEED',
    'MUNICIPAL_CLEARANCE_CERTIFICATE',
    'OFFER_TO_PURCHASE',
    'AGENT_FFC',
    'CONVEYANCER_TRUST_ACCOUNT_CONFIRMATION',
    'DEEDS_OFFICE_REGISTRATION',
  ],
  geoSealedEvidence: [],

  /** Why it is not live yet — stated honestly, not hidden behind a teaser. */
  comingSoonReasons: [
    'Property deposits are already protected by conveyancer trust accounts under the Legal Practice Act, so the marginal consumer benefit is lower than in services or vehicles.',
    'Verification requires Deeds Office title searches and municipal clearance certificates, neither of which has a stable public API — partner agreements are in negotiation.',
    'PPRA agent and Fidelity Fund Certificate verification is published but has no documented bulk interface.',
    'The services vertical is the higher-volume wedge: it builds the verified-pro supply base that property maintenance contracts will later need.',
  ],

  plannedPartners: [
    'Deeds Office / DeedsWEB title search providers',
    'PPRA (Property Practitioners Regulatory Authority) status and FFC verification',
    'Conveyancing attorney panel with verified trust accounts',
    'ooba Buyers Trust-style deposit safekeeping accounts',
    'Municipal clearance certificate providers across the eight metros',
    'Lightstone / Windeed property data',
  ],

  plannedFeatures: [
    'Title and ownership match before a listing ever goes live',
    'Conveyancer trust-account allowlist with call-back verification (bank-detail substitution is the classic property fraud)',
    'Municipal rates, water and electricity clearance status monitoring',
    'Bond and encumbrance search surfaced to the buyer early',
    'Offer to Purchase templates with suspensive conditions tracked to a deadline',
    'Deeds Office registration milestone tracking with automatic escrow release',
    'Property-maintenance retainer contracts served by verified ProVeri trades — the bridge back to the services vertical',
  ],
});

const VERTICALS = Object.freeze({
  services: SERVICES,
  vehicles: VEHICLES,
  property: PROPERTY,
});

function all() {
  return Object.values(VERTICALS);
}

function get(id) {
  const vertical = VERTICALS[id];
  if (!vertical) throw new Error(`unknown vertical: ${id}`);
  return vertical;
}

function live() {
  return all().filter((v) => v.status !== VERTICAL_STATUS.COMING_SOON);
}

module.exports = { VERTICALS, SERVICES, VEHICLES, PROPERTY, all, get, live };
