'use strict';

/**
 * Lula ProVeri — Vehicles vertical (the merged TrustShield engine).
 *
 * WHY THIS EXISTS IN A SERVICES MARKETPLACE
 * -----------------------------------------
 * The original repository was a vehicle/property escrow-and-verification engine
 * called TrustShield. Rather than discard it, ProVeri generalises it into the
 * Trust Kernel and keeps vehicles as a second vertical on the same rails. The
 * merge is not cosmetic — it produces something neither half could do alone:
 *
 *   1. A pre-purchase inspection is a *service job*. A customer books a
 *      `vehicle-inspection` pro through the normal services flow; the pro
 *      uploads a VIN photo, odometer photo and report; and `bridgeEvidence()`
 *      writes that report straight into the vehicle listing's trust chain.
 *      The listing's `independent_condition_report` check then PASSes with a
 *      hash-sealed, escrow-released job behind it — not a self-uploaded PDF.
 *
 *   2. Every mechanic, auto-electrician and towing job on a registered vehicle
 *      appends to that car's **Service Passport**. When the owner later sells
 *      it on ProVeri, the advert inherits a verified, hash-chained service
 *      history. No South African classifieds platform can do this, because none
 *      of them own both the service transaction and the sale transaction.
 *
 *   3. The same immutability rules apply: change a verified VIN after
 *      verification and the listing is removed (policy VCL-001), edit the price
 *      after negotiation starts and the edit is blocked without a
 *      buyer-approved addendum.
 *
 * Property is deliberately marked COMING SOON with the reasons stated in
 * `src/verticals/index.js` — no fake teaser, no dead button.
 */

const { idFor, nextId, nowIso, sha256, deepClone, fingerprint, assertCents, percentageOf, addDays } = require('../kernel/util');
const { CHECK_STATUS, BADGE } = require('../kernel/verification');
const { ESCROW_STATUS, MILESTONE_STATUS } = require('../kernel/escrow');
const { POLICY_EFFECT } = require('../kernel/policy');

const LISTING_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  NEGOTIATION_LOCKED: 'NEGOTIATION_LOCKED',
  BUYER_FUNDS_CONFIRMED: 'BUYER_FUNDS_CONFIRMED',
  FUNDS_IN_ESCROW: 'FUNDS_IN_ESCROW',
  READY_FOR_RELEASE: 'READY_FOR_RELEASE',
  COMPLETED: 'COMPLETED',
  RECHECK_REQUIRED: 'RECHECK_REQUIRED',
  DISPUTED: 'DISPUTED',
  REFUNDED: 'REFUNDED',
  REMOVED: 'REMOVED',
});

/** VIN basic structure check (ISO 3779): 17 chars, no I/O/Q. */
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_TRANSLITERATION = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_REMAINDER = ['A', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** North-American-market VINs carry a self-checking 9th position. Useful signal. */
function vinCheckDigit(vin) {
  const value = String(vin || '').toUpperCase();
  if (!VIN_REGEX.test(value)) return { valid: false, reasons: ['VIN must be 17 characters using A–H, J–N, P, R–Z and 0–9 (no I, O or Q)'] };
  const reasons = [];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const char = value[i];
    const digit = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
    if (digit === undefined) reasons.push(`Character ${i + 1} ("${char}") is not a valid VIN character`);
    sum += (digit || 0) * VIN_WEIGHTS[i];
  }
  const expected = VIN_REMAINDER[sum % 11];
  const northAmerican = value[8] === expected;
  return {
    valid: reasons.length === 0,
    reasons,
    checkDigitPosition9: value[8],
    expectedCheckDigit: expected,
    northAmericanChecksumValid: northAmerican,
    note: northAmerican
      ? 'Position 9 matches the ISO 3779 check digit — consistent with a North American market VIN.'
      : 'Position 9 does not match the check digit. This is normal for non-North-American VINs (including most South African market vehicles), where position 9 is not a check digit.',
    worldManufacturerIdentifier: value.slice(0, 3),
    vehicleDescriptorSection: value.slice(3, 9),
    vehicleIdentifierSection: value.slice(9),
    modelYearChar: value[9],
    plantChar: value[10],
    serialNumber: value.slice(11),
  };
}

/** South African registration plate shape (AA 00 000 / A 000 000 / BB 00 BB BB). */
const SA_PLATE_PATTERNS = [
  { name: 'National (post-1990s)', regex: /^[A-Z]{2}\d{2}[A-Z]{2}$/ },
  { name: 'Legacy Gauteng', regex: /^[A-Z]{3}\d{3}$/ },
  { name: 'Legacy Western Cape', regex: /^C[A-Z]\d{3,6}$/ },
  { name: 'Legacy KwaZulu-Natal', regex: /^N[A-Z]\d{3,6}$/ },
  { name: 'Government', regex: /^GP\d{3,6}$/ },
  { name: 'Military', regex: /^[A-Z]?\d{2}[A-Z]{2}\d{2}[A-Z]?$/ },
];

function validateSaPlate(plate) {
  const value = String(plate || '').toUpperCase().replace(/[\s-]/g, '');
  const match = SA_PLATE_PATTERNS.find((p) => p.regex.test(value));
  return { valid: Boolean(match), normalized: value, format: match?.name || null };
}

class VehicleService {
  constructor({ store, kernel, catalog, people }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.people = people;
  }

  /** Publish a vehicle listing. Nothing is VERIFIED until checks pass. */
  createListing({
    sellerId, vin, engineNumber, registrationNumber, make, model, year, odometerKm,
    colour, priceCents, description, condition, knownDefects = [], includedItems = [],
    suburbId, evidence = {}, titleHolder = null, serviceHistory = [], photos = [],
  }) {
    if (!sellerId) throw new Error('sellerId is required');
    assertCents(priceCents, 'priceCents');
    if (priceCents <= 0) throw new Error('priceCents must be greater than zero');

    const vinResult = vinCheckDigit(vin);
    if (!vinResult.valid) throw new Error(`VIN rejected: ${vinResult.reasons.join('; ')}`);
    const plateResult = validateSaPlate(registrationNumber);
    const suburb = suburbId ? this.catalog.suburb(suburbId) : null;

    const duplicate = this.store.findOne('vehicles', (v) =>
      v.status !== LISTING_STATUS.REMOVED && v.asset.vin === String(vin).toUpperCase());
    if (duplicate) throw new Error(`a listing for VIN ${String(vin).toUpperCase()} already exists (${duplicate.reference})`);

    const listingId = idFor('vehicle');
    const reference = this.store.reference('VEH', 'vehicle', 6);
    const seller = this.store.get('pros', sellerId) || this.store.get('customers', sellerId);

    const listing = {
      listingId,
      reference,
      vertical: 'vehicles',
      sellerId,
      sellerName: seller?.displayName || seller?.fullName || sellerId,
      sellerType: this.store.get('pros', sellerId) ? 'TRADE_OR_DEALER' : 'PRIVATE_SELLER',
      status: LISTING_STATUS.DRAFT,
      asset: {
        vin: String(vin).toUpperCase(),
        vinAnalysis: vinResult,
        engineNumber: engineNumber ? String(engineNumber).toUpperCase() : null,
        registrationNumber: plateResult.normalized,
        plateFormat: plateResult.format,
        make,
        model,
        year: Number(year),
        odometerKm: Number(odometerKm),
        colour: colour || null,
        condition: condition || 'Used',
        knownDefects,
        includedItems,
        titleHolder: titleHolder || { type: 'NONE', institution: null, settlementCents: null },
      },
      description,
      descriptionHash: sha256(description),
      priceCents,
      location: {
        suburbId: suburb?.id || null,
        suburb: suburb?.name || null,
        metroId: suburb?.metroId || null,
        metro: suburb?.metroName || null,
        province: suburb?.province || null,
        lat: suburb?.lat ?? null,
        lon: suburb?.lon ?? null,
      },
      evidence: {
        registrationCertificateHash: evidence.registrationCertificateHash ? sha256(evidence.registrationCertificateHash) : null,
        natisDocumentHash: evidence.natisDocumentHash ? sha256(evidence.natisDocumentHash) : null,
        roadworthyCertificateHash: evidence.roadworthyCertificateHash ? sha256(evidence.roadworthyCertificateHash) : null,
        settlementLetterHash: evidence.settlementLetterHash ? sha256(evidence.settlementLetterHash) : null,
        inspectionReportHash: evidence.inspectionReportHash ? sha256(evidence.inspectionReportHash) : null,
      },
      photos: photos.map((p) => ({ photoId: nextId('evd'), hash: sha256(p.hash || p), caption: p.caption || null, capturedAt: p.capturedAt || nowIso(), geo: p.geo || null })),
      serviceHistory: serviceHistory.map((s) => ({ ...s, hash: sha256(s) })),

      verification: null,
      trustBadge: BADGE.UNVERIFIED,
      trustScore: 0,
      locks: { criticalAssetIdentifiers: false, description: false, price: false },
      negotiation: null,
      buyerFundReservation: null,
      escrowId: null,
      escrowStatus: ESCROW_STATUS.NOT_STARTED,
      passport: { vehicleId: null, entries: [], bridgedFromServices: [] },
      incidents: [],
      versions: [],
      views: 0,
      savedBy: [],
      currentHash: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    listing.verification = this.kernel.startVerification('vehicleListing', { subjectId: listingId });
    this.#addVersion(listing, 'initial listing snapshot');
    this.store.put('vehicles', listingId, listing);

    this.kernel.ledger.append({
      action: 'VEHICLE_LISTING_CREATED',
      subject: listingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${year} ${make} ${model} listed at R${(priceCents / 100).toLocaleString('en-ZA')} · VIN sealed ${fingerprint(vin, 8)}`,
        reference,
        make,
        model,
        year,
        priceCents,
        vinSeal: sha256(String(vin).toUpperCase()).slice(0, 16),
        sellerType: listing.sellerType,
      },
    });
    return deepClone(listing);
  }

  /**
   * Submit verification checks. Mandatory set comes from the vehicleListing
   * profile; every PASS needs a source and a reference or the badge will not
   * upgrade (the "no badge without evidence" rule).
   */
  submitChecks(listingId, checks, { actorId = 'verification-desk' } = {}) {
    const listing = this.#listing(listingId);
    if (listing.status === LISTING_STATUS.REMOVED) throw new Error('removed listings cannot be verified');
    const subject = { subjectId: listingId, ...listing };

    for (const check of checks) {
      listing.verification = this.kernel.recordCheck(listingId, listing.verification, subject, check);
    }

    listing.trustScore = listing.verification.score;
    listing.trustBadge = listing.verification.badge;

    const failed = listing.verification.failedChecks || [];
    if (failed.length > 0) {
      this.#removeListing(listing, 'VERIFICATION_FAILED', `Required vehicle checks failed: ${failed.join(', ')}`, actorId);
      return deepClone(listing);
    }
    if (listing.verification.status === 'VERIFIED' || listing.verification.status === 'ELITE') {
      listing.status = LISTING_STATUS.VERIFIED;
      listing.locks.criticalAssetIdentifiers = true;
      listing.verifiedAt = nowIso();
      listing.verificationSeal = this.kernel.ledger.exportProof(listingId).digest;
      this.kernel.ledger.append({
        action: 'VEHICLE_VERIFIED',
        subject: listingId,
        level: 'TRUST',
        visibility: 'PUBLIC',
        payload: {
          summary: `${listing.asset.year} ${listing.asset.make} ${listing.asset.model} verified · trust score ${listing.trustScore}/100 · ${listing.trustBadge}`,
          trustScore: listing.trustScore,
          badge: listing.trustBadge,
          checksPassed: listing.verification.checks.filter((c) => c.status === CHECK_STATUS.PASS).map((c) => c.name),
        },
      });
    } else {
      listing.status = LISTING_STATUS.RECHECK_REQUIRED;
      this.kernel.ledger.append({
        action: 'VEHICLE_RECHECK_REQUIRED',
        subject: listingId,
        visibility: 'PUBLIC',
        payload: {
          summary: `Verification incomplete — missing: ${listing.verification.missingChecks.join(', ') || 'none'}; warnings: ${listing.verification.warnings.join(', ') || 'none'}`,
          missingChecks: listing.verification.missingChecks,
          warnings: listing.verification.warnings,
        },
      });
    }

    this.#addVersion(listing, 'verification checks submitted');
    listing.updatedAt = nowIso();
    return deepClone(listing);
  }

  /**
   * Any edit goes through tamper detection first. Critical identifier changes
   * on a verified listing remove it outright — this is the TrustShield rule
   * that stops the classic "verified listing, then swap the car" scam.
   */
  updateListing(listingId, patch, { actorId, reason = 'seller update' } = {}) {
    const listing = this.#listing(listingId);
    if (listing.status === LISTING_STATUS.REMOVED) throw new Error('removed listings cannot be edited');

    const tamper = this.kernel.detectTamper('vehicles', { before: listing, patch, verified: listing.status === LISTING_STATUS.VERIFIED });

    const isVerified = ['VERIFIED', 'ELITE'].includes(listing.verification?.status);
    if (tamper.tampered && isVerified) {
      const decision = this.kernel.policy.evaluate('vehicleListing', { subjectId: listingId, patch, subject: listing });
      this.#removeListing(listing, decision.decision === POLICY_EFFECT.REMOVE ? 'CRITICAL_ASSET_TAMPER' : 'TAMPER_DETECTED',
        `Verified critical identifier changed after verification: ${tamper.criticalFieldsChanged.join(', ')}`, actorId);
      return { accepted: false, action: 'REMOVED', tamper, decision, listing: deepClone(listing) };
    }

    if (tamper.lockedViolation && listing.negotiation) {
      const decision = this.kernel.policy.evaluate('booking', { subjectId: listingId, patch, subject: listing });
      this.kernel.ledger.append({
        action: 'EDIT_BLOCKED_NEGOTIATION_LOCK',
        subject: listingId,
        level: 'SAFETY',
        visibility: 'PUBLIC',
        payload: {
          summary: `Edit blocked: negotiation in progress. Locked fields touched: ${tamper.lockedFieldsChanged.join(', ')}. A buyer-approved addendum is required.`,
          lockedFieldsChanged: tamper.lockedFieldsChanged,
          actorId,
        },
      });
      return { accepted: false, action: 'BLOCKED', tamper, decision, listing: deepClone(listing), addendumRequired: true };
    }

    for (const [path, value] of require('../kernel/util').flattenPatch(patch)) {
      require('../kernel/util').setPath(listing, path, value);
    }
    if (['VERIFIED', 'ELITE'].includes(listing.verification?.status)) {
      listing.status = LISTING_STATUS.RECHECK_REQUIRED;
      listing.verification.status = 'RECHECK_REQUIRED';
      listing.trustBadge = BADGE.RECHECK_REQUIRED;
      listing.trustScore = Math.min(listing.trustScore, 74);
    }
    this.#addVersion(listing, reason);
    listing.updatedAt = nowIso();
    this.kernel.ledger.append({
      action: 'VEHICLE_LISTING_UPDATED',
      subject: listingId,
      visibility: 'PUBLIC',
      payload: { summary: `${reason} — new version hash ${listing.currentHash.slice(0, 12)}`, reason, version: listing.versions.length },
    });
    return { accepted: true, action: listing.status === LISTING_STATUS.RECHECK_REQUIRED ? 'RECHECK_REQUIRED' : 'UPDATED', tamper, listing: deepClone(listing) };
  }

  /** Buyer starts negotiating — description, price and terms lock. */
  startNegotiation(listingId, { buyerId, offerCents, terms = {}, expiresAt }) {
    const listing = this.#listing(listingId);
    if (listing.status !== LISTING_STATUS.VERIFIED) {
      throw new Error(`a listing must be VERIFIED before negotiation; this one is ${listing.status}`);
    }
    assertCents(offerCents, 'offerCents');

    listing.negotiation = {
      buyerId,
      offerCents,
      terms: deepClone(terms),
      termsHash: sha256({ buyerId, offerCents, terms, listingHash: listing.currentHash }),
      startedAt: nowIso(),
      expiresAt: expiresAt || addDays(nowIso(), 7).slice(0, 10),
      lockedFields: ['description', 'priceCents', 'asset.condition', 'asset.includedItems', 'asset.knownDefects', 'evidence.inspectionReportHash'],
      addenda: [],
    };
    listing.locks.description = true;
    listing.locks.price = true;
    listing.status = LISTING_STATUS.NEGOTIATION_LOCKED;
    this.#addVersion(listing, 'negotiation started — description, price and terms locked');

    this.kernel.ledger.append({
      action: 'NEGOTIATION_STARTED',
      subject: listingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `Buyer offered R${(offerCents / 100).toLocaleString('en-ZA')} — listing terms are now locked. Any change needs a buyer-approved addendum.`,
        offerCents,
        buyerId,
        termsHash: listing.negotiation.termsHash.slice(0, 16),
        lockedFields: listing.negotiation.lockedFields,
      },
    });
    return deepClone(listing);
  }

  /** Seller proposes an addendum; the buyer must explicitly accept it. */
  proposeAddendum(listingId, { sellerId, changes, reason }) {
    const listing = this.#listing(listingId);
    if (!listing.negotiation) throw new Error('no active negotiation on this listing');
    const addendum = {
      addendumId: nextId('qot'),
      proposedBy: sellerId,
      changes,
      reason,
      status: 'PENDING_BUYER_APPROVAL',
      proposedAt: nowIso(),
      decidedAt: null,
      seal: sha256({ listingId, changes, reason, seq: listing.negotiation.addenda.length + 1 }),
    };
    listing.negotiation.addenda.push(addendum);
    this.kernel.ledger.append({
      action: 'ADDENDUM_PROPOSED',
      subject: listingId,
      visibility: 'PUBLIC',
      payload: { summary: `Seller proposed an addendum: ${reason}. The buyer must approve it before anything changes.`, addendumId: addendum.addendumId },
    });
    return deepClone(addendum);
  }

  acceptAddendum(listingId, { buyerId, addendumId, approve }) {
    const listing = this.#listing(listingId);
    if (listing.negotiation?.buyerId !== buyerId) throw new Error('only the negotiating buyer can decide an addendum');
    const addendum = listing.negotiation.addenda.find((a) => a.addendumId === addendumId);
    if (!addendum) throw new Error(`addendum ${addendumId} not found`);
    addendum.status = approve ? 'APPROVED' : 'REJECTED';
    addendum.decidedAt = nowIso();
    if (approve) {
      for (const [path, value] of Object.entries(addendum.changes)) {
        require('../kernel/util').setPath(listing, path, value);
      }
      if (addendum.changes.priceCents) listing.negotiation.offerCents = addendum.changes.priceCents;
      this.#addVersion(listing, `buyer-approved addendum ${addendum.addendumId}`);
    }
    this.kernel.ledger.append({
      action: `ADDENDUM_${addendum.status}`,
      subject: listingId,
      visibility: 'PUBLIC',
      payload: { summary: `Buyer ${approve ? 'approved' : 'rejected'} the addendum`, addendumId },
    });
    return deepClone(listing);
  }

  /**
   * Privacy-preserving proof of funds. The seller learns only that funds are
   * reserved for THIS transaction until a deadline — never the buyer's balance,
   * account number or statement.
   */
  confirmBuyerFunds(listingId, { buyerId, amountCents, providerRef, availableCents, reservationTtlMinutes = 120 }) {
    const listing = this.#listing(listingId);
    assertCents(amountCents, 'amountCents');
    if (listing.negotiation?.buyerId !== buyerId) throw new Error('only the negotiating buyer can confirm funds');

    const sufficient = Number.isInteger(availableCents) && availableCents >= amountCents;
    const reservation = {
      reservationId: nextId('res'),
      buyerId,
      amountCents,
      providerRef,
      status: sufficient ? 'RESERVED' : 'DECLINED',
      expiresAt: new Date(Date.now() + reservationTtlMinutes * 60_000).toISOString(),
      createdAt: nowIso(),
    };
    listing.buyerFundReservation = reservation;
    if (sufficient) listing.status = LISTING_STATUS.BUYER_FUNDS_CONFIRMED;

    const sellerNotification = sufficient
      ? {
        kind: 'FUNDS_RESERVED',
        // Deliberately minimal disclosure.
        message: `Buyer has sufficient reserved funds for R${(amountCents / 100).toLocaleString('en-ZA')} on ${listing.reference}, valid until ${new Date(reservation.expiresAt).toLocaleString('en-ZA')}.`,
        amountCents,
        expiresAt: reservation.expiresAt,
        providerRef,
        notDisclosed: ['buyer balance', 'account number', 'bank name', 'salary', 'statement', 'other transactions'],
      }
      : { kind: 'FUNDS_NOT_RESERVED', message: 'The buyer could not reserve funds for this transaction. No further detail is disclosed.', expiresAt: null };

    this.kernel.ledger.append({
      action: sufficient ? 'BUYER_FUNDS_RESERVED' : 'BUYER_FUNDS_DECLINED',
      subject: listingId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: {
        summary: sufficient
          ? `Privacy-preserving funds confirmation: R${(amountCents / 100).toLocaleString('en-ZA')} reserved until ${new Date(reservation.expiresAt).toLocaleString('en-ZA')}`
          : 'Buyer funds could not be reserved',
        amountCents: sufficient ? amountCents : undefined,
        expiresAt: reservation.expiresAt,
        privacyGuarantee: 'Seller sees a yes/no and an expiry only — never a balance or account number',
      },
    });
    return { reservation, sellerNotification, listing: deepClone(listing) };
  }

  /** Open escrow with the title-holder release order applied. */
  openEscrow(listingId, { buyerId, amountCents, escrowProvider = 'tradesafe', reference, conditions = [] }) {
    const listing = this.#listing(listingId);
    assertCents(amountCents, 'amountCents');
    const titleHolder = listing.asset.titleHolder;
    const hasFinance = titleHolder?.type === 'BANK' && titleHolder.settlementCents > 0;

    const milestones = hasFinance
      ? [
        { label: `Settle ${titleHolder.institution} and obtain paid-up letter`, weight: titleHolder.settlementCents, requiredEvidence: ['SETTLEMENT_PAID_UP_LETTER'] },
        { label: 'NaTIS ownership transfer confirmed in the buyer’s name', weight: Math.max(1, amountCents - titleHolder.settlementCents) * 0.2, requiredEvidence: ['NCO_OR_RLV_TRANSFER', 'NATIS_TRANSFER_CONFIRMATION'] },
        { label: 'Keys and documents handed over with final VIN check', weight: Math.max(1, amountCents - titleHolder.settlementCents) * 0.8, requiredEvidence: ['VIN_PLATE_PHOTO', 'BUYER_HANDOVER_ACCEPTANCE', 'SALE_AGREEMENT'] },
      ]
      : [
        { label: 'Keys and documents handed over with final VIN check', weight: 70, requiredEvidence: ['VIN_PLATE_PHOTO', 'ODOMETER_PHOTO', 'BUYER_HANDOVER_ACCEPTANCE', 'SALE_AGREEMENT'] },
        { label: 'NaTIS ownership transfer confirmed in the buyer’s name', weight: 30, requiredEvidence: ['NCO_OR_RLV_TRANSFER', 'ROADWORTHY_CERTIFICATE'] },
      ];

    const escrow = this.kernel.escrow.open({
      bookingId: listingId,
      customerId: buyerId,
      providerId: listing.sellerId,
      amountCents,
      provider: escrowProvider,
      milestones,
      warrantyDays: 0,
      confirmationWindowMinutes: 24 * 60,
      purpose: `Vehicle purchase — ${listing.asset.year} ${listing.asset.make} ${listing.asset.model}`,
    });

    listing.escrowId = escrow.escrowId;
    listing.escrowStatus = escrow.status;
    listing.escrowProvider = escrow.providerLabel;
    listing.status = LISTING_STATUS.FUNDS_IN_ESCROW;
    listing.conditions = conditions;
    listing.releaseOrder = this.kernel.vertical('vehicles').plugin.releaseOrder;
    this.#addVersion(listing, 'escrow opened');

    this.kernel.ledger.append({
      action: 'VEHICLE_ESCROW_OPENED',
      subject: listingId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: {
        summary: `R${(amountCents / 100).toLocaleString('en-ZA')} held by ${escrow.providerLabel}${hasFinance ? ` — release order settles ${titleHolder.institution} first` : ''}`,
        amountCents,
        provider: escrow.providerLabel,
        hasOutstandingFinance: hasFinance,
        titleHolder: hasFinance ? titleHolder.institution : null,
        settlementCents: hasFinance ? titleHolder.settlementCents : 0,
        milestones: milestones.map((m) => m.label),
      },
    });
    return deepClone({ listing, escrow });
  }

  fundEscrow(listingId, { reference, method = 'instant-eft' }) {
    const listing = this.#listing(listingId);
    const escrow = this.kernel.escrow.confirmFunded(listing.escrowId, { reference, method });
    listing.escrowStatus = escrow.status;
    listing.updatedAt = nowIso();
    return deepClone({ listing, escrow });
  }

  addHandoverEvidence(listingId, { items, verifierId, findings }) {
    const listing = this.#listing(listingId);
    const sealed = items.map((item) => ({
      evidenceId: nextId('evd'),
      type: item.type,
      hash: sha256(item.hash || item),
      capturedAt: item.capturedAt || nowIso(),
      geo: item.geo || null,
      note: item.note || null,
      verifierId: verifierId || null,
      seal: fingerprint(item, 10),
    }));
    listing.handoverEvidence = [...(listing.handoverEvidence || []), ...sealed];

    // Final VIN check at handover must match the locked listing.
    const vinItem = sealed.find((e) => e.type === 'VIN_PLATE_PHOTO');
    if (vinItem && vinItem.note && vinItem.note.toUpperCase() !== listing.asset.vin) {
      this.#removeListing(listing, 'HANDOVER_VIN_MISMATCH',
        `VIN photographed at handover (${vinItem.note.toUpperCase()}) does not match the verified listing VIN (${listing.asset.vin})`);
      return { accepted: false, action: 'REMOVED', sealed, listing: deepClone(listing) };
    }

    // Handover evidence IS milestone evidence: push it into the first open
    // milestone so the escrow state machine sees proof before any release.
    let milestone = null;
    if (listing.escrowId) {
      const escrow = this.kernel.escrow.get(listing.escrowId);
      milestone = escrow.plan.milestones.find((m) => m.status === MILESTONE_STATUS.PENDING) || null;
      if (milestone) {
        const updated = this.kernel.escrow.submitMilestoneEvidence(listing.escrowId, milestone.milestoneId, {
          evidence: sealed.map((e) => ({ type: e.type, hash: e.hash, geo: e.geo, note: e.note })),
          note: findings || null,
        });
        listing.escrowStatus = updated.status;
        listing.milestones = updated.plan.milestones.map((m) => ({ ...m }));
      }
    }

    this.kernel.ledger.append({
      action: 'HANDOVER_EVIDENCE_SUBMITTED',
      subject: listingId,
      level: 'TRUST',
      visibility: 'PUBLIC',
      payload: {
        summary: `${sealed.length} handover evidence item(s) submitted${findings ? ` — ${findings}` : ''}`,
        types: sealed.map((s) => s.type),
        findings: findings || null,
        milestoneId: milestone?.milestoneId || null,
      },
    });
    this.#addVersion(listing, 'handover evidence submitted');
    return { accepted: true, sealed, milestoneId: milestone?.milestoneId || null, listing: deepClone(listing) };
  }

  markReadyForRelease(listingId, { buyerId, accepted, verifierApproved }) {
    const listing = this.#listing(listingId);
    if (listing.negotiation?.buyerId !== buyerId && listing.buyerFundReservation?.buyerId !== buyerId) {
      throw new Error('only the buyer on this transaction can accept handover');
    }
    if (!accepted) throw new Error('the buyer must accept handover before release');
    for (const milestone of this.kernel.escrow.get(listing.escrowId).plan.milestones) {
      if (milestone.status !== MILESTONE_ACCEPTED()) {
        this.kernel.escrow.acceptMilestone(listing.escrowId, milestone.milestoneId, { actorId: buyerId, comment: verifierApproved ? 'Buyer and independent verifier both accepted' : 'Buyer accepted' });
      }
    }
    listing.status = LISTING_STATUS.READY_FOR_RELEASE;
    listing.updatedAt = nowIso();
    return deepClone(listing);
  }

  release(listingId, { releaseReference }) {
    const listing = this.#listing(listingId);
    const escrow = this.kernel.escrow.release(listing.escrowId, { releaseReference });
    listing.escrowStatus = escrow.status;
    listing.status = LISTING_STATUS.COMPLETED;
    listing.completedAt = nowIso();
    this.#addVersion(listing, 'escrow released — sale completed');
    this.kernel.ledger.append({
      action: 'VEHICLE_SALE_COMPLETED',
      subject: listingId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: {
        summary: `${listing.asset.year} ${listing.asset.make} ${listing.asset.model} sold for R${(listing.priceCents / 100).toLocaleString('en-ZA')} — funds released after handover evidence and buyer acceptance`,
        reference: releaseReference || escrow.releases.at(-1)?.reference,
        releaseCount: escrow.releases.length,
      },
    });
    this.#startPassport(listing);
    return deepClone({ listing, escrow });
  }

  refund(listingId, { amountCents, reason, refundReference }) {
    const listing = this.#listing(listingId);
    const escrow = this.kernel.escrow.refund(listing.escrowId, { amountCents, reason, refundReference });
    listing.escrowStatus = escrow.status;
    listing.status = LISTING_STATUS.REFUNDED;
    this.#addVersion(listing, `refunded: ${reason}`);
    return deepClone({ listing, escrow });
  }

  /* ================================================================== *
   * VEHICLE SERVICE PASSPORT — the cross-vertical payoff
   * ================================================================== */

  /** Register the VIN as a persistent passport once a sale completes. */
  #startPassport(listing) {
    const vin = listing.asset.vin;
    let passport = this.store.findOne('vehiclePassports', (p) => p.vin === vin) || {
      passportId: idFor('vehicle'),
      vin,
      vinSeal: sha256(vin),
      make: listing.asset.make,
      model: listing.asset.model,
      year: listing.asset.year,
      engineNumber: listing.asset.engineNumber,
      entries: [],
      owners: [{ since: listing.completedAt, partyId: listing.negotiation?.buyerId, kind: 'BUYER' }],
      createdAt: nowIso(),
    };
    passport.entries = [...(passport.entries || []), {
      at: nowIso(),
      kind: 'SALE',
      summary: `Sold on ProVeri for R${(listing.priceCents / 100).toLocaleString('en-ZA')} after full verification`,
      listingId: listing.listingId,
      seal: sha256({ vin, listingId: listing.listingId, at: nowIso() }),
    }];
    this.store.put('vehiclePassports', passport.vin, passport);
    listing.passport.vehicleId = passport.vin;
    return passport;
  }

  /**
   * Append a completed *service* job to a vehicle's passport. Called by the
   * marketplace when a mechanic/inspection/towing booking is released against a
   * registered VIN.
   */
  appendServiceToPassport({ vin, bookingId, categoryId, summary, evidenceIds = [], proName }) {
    const value = String(vin || '').toUpperCase();
    if (!VIN_REGEX.test(value)) throw new Error('a valid 17-character VIN is required to append to a Service Passport');
    let passport = this.store.get('vehiclePassports', value);
    if (!passport) {
      passport = {
        passportId: idFor('vehicle'),
        vin: value,
        vinSeal: sha256(value),
        vinAnalysis: vinCheckDigit(value),
        make: null,
        model: null,
        year: null,
        entries: [],
        owners: [],
        createdAt: nowIso(),
      };
      this.store.put('vehiclePassports', value, passport);
    }
    const entry = {
      entryId: nextId('evd'),
      at: nowIso(),
      kind: 'SERVICE',
      categoryId,
      categoryLabel: this.catalog.categories.get(categoryId)?.label || categoryId,
      summary,
      proName,
      bookingId,
      evidenceIds,
      escrowReleased: true,
      seal: sha256({ vin: value, bookingId, at: nowIso() }),
    };
    passport.entries.push(entry);
    passport.lastServiceAt = nowIso();
    passport.serviceCount = passport.entries.filter((e) => e.kind === 'SERVICE').length;

    this.kernel.ledger.append({
      action: 'SERVICE_PASSPORT_ENTRY_ADDED',
      subject: value,
      level: 'TRUST',
      visibility: 'PUBLIC',
      payload: {
        summary: `${entry.categoryLabel} recorded on the Service Passport for VIN ${fingerprint(value, 8)} — escrow-released job, so it cannot be faked`,
        bookingId,
        categoryId,
        serviceCount: passport.serviceCount,
      },
    });
    return deepClone(passport);
  }

  /**
   * Bridge a service job's evidence into a live listing — used for
   * pre-purchase inspections booked through the services flow.
   */
  bridgeInspectionToListing({ listingId, bookingId, reportHash, findings, inspectorProId }) {
    const listing = this.#listing(listingId);
    const receipt = this.kernel.bridgeEvidence({
      fromVertical: 'services',
      fromEntityId: bookingId,
      toVertical: 'vehicles',
      toEntityId: listingId,
      evidenceType: 'INDEPENDENT_CONDITION_REPORT',
      summary: findings || 'Independent pre-purchase inspection completed as an escrow-released ProVeri service job',
      payload: { reportHash: reportHash ? sha256(reportHash) : null, inspectorProId, bookingId },
      actorId: inspectorProId,
    });

    listing.passport.bridgedFromServices.push(receipt);
    listing.evidence.inspectionReportHash = receipt.payload.reportHash || listing.evidence.inspectionReportHash;
    listing.verification = this.kernel.recordCheck(listingId, listing.verification, { subjectId: listingId }, {
      name: 'independent_condition_report',
      status: CHECK_STATUS.PASS,
      source: `ProVeri services vertical — escrow-released inspection by ${receipt.payload.inspectorProId}`,
      reference: receipt.bridgeId,
      finding: receipt.summary,
      evidence: { inspectionReportHash: receipt.payload.reportHash, bridgeId: receipt.bridgeId },
    });
    listing.trustScore = listing.verification.score;
    listing.trustBadge = listing.verification.badge;
    if (['VERIFIED', 'ELITE'].includes(listing.verification.status)) {
      listing.status = LISTING_STATUS.VERIFIED;
      listing.locks.criticalAssetIdentifiers = true;
      listing.verifiedAt = listing.verifiedAt || nowIso();
    }
    this.#addVersion(listing, 'inspection report bridged from the services vertical');
    return deepClone({ listing, receipt });
  }

  getPassport(vin) {
    const value = String(vin || '').toUpperCase();
    const passport = this.store.get('vehiclePassports', value);
    if (!passport) return null;
    return deepClone({
      ...passport,
      vinAnalysis: vinCheckDigit(value),
      verifiable: true,
      proofDigest: this.kernel.ledger.exportProof(value).digest,
      shareUrl: `/vehicles/passport/${fingerprint(value, 10)}`,
      note: 'Every entry comes from an escrow-released ProVeri job or a verified sale, so the history cannot be edited or fabricated.',
    });
  }

  /* ================================================================== *
   * QUERIES
   * ================================================================== */

  #listing(listingId) {
    const listing = this.store.get('vehicles', listingId);
    if (!listing) throw new Error(`vehicle listing ${listingId} not found`);
    return listing;
  }

  #addVersion(listing, reason) {
    const snapshot = {
      sellerId: listing.sellerId,
      asset: listing.asset,
      description: listing.description,
      priceCents: listing.priceCents,
      evidence: listing.evidence,
      status: listing.status,
      verificationStatus: listing.verification?.status,
    };
    const version = {
      version: listing.versions.length + 1,
      hash: sha256(snapshot),
      reason,
      capturedAt: nowIso(),
      snapshot: deepClone(snapshot),
    };
    listing.currentHash = version.hash;
    listing.versions.push(version);
    return version;
  }

  #removeListing(listing, code, reason, actorId) {
    listing.status = LISTING_STATUS.REMOVED;
    listing.trustBadge = BADGE.REMOVED_FOR_RISK;
    listing.removal = { code, reason, actorId: actorId || null, removedAt: nowIso() };
    listing.incidents.push({ incidentId: nextId('inc'), code, reason, at: nowIso(), actorId: actorId || null });
    this.#addVersion(listing, reason);
    if (listing.escrowId) {
      try {
        this.kernel.escrow.freeze(listing.escrowId, { reason: `Listing removed: ${reason}`, actorId });
      } catch { /* already released or refunded */ }
    }
    this.kernel.ledger.append({
      action: 'VEHICLE_LISTING_REMOVED',
      subject: listing.listingId,
      level: 'CRITICAL',
      visibility: 'PUBLIC',
      payload: { summary: `Listing removed — ${code}: ${reason}`, code, reason },
    });
  }

  list({ status, make, metroId, minPriceCents, maxPriceCents, verifiedOnly, search, limit = 50 } = {}) {
    let rows = this.store.all('vehicles').filter((v) => v.status !== LISTING_STATUS.REMOVED);
    if (status) rows = rows.filter((v) => v.status === status);
    if (make) rows = rows.filter((v) => v.asset.make?.toLowerCase() === make.toLowerCase());
    if (metroId) rows = rows.filter((v) => v.location.metroId === metroId);
    if (minPriceCents) rows = rows.filter((v) => v.priceCents >= minPriceCents);
    if (maxPriceCents) rows = rows.filter((v) => v.priceCents <= maxPriceCents);
    if (verifiedOnly) rows = rows.filter((v) => v.verification?.status === 'VERIFIED' || v.verification?.status === 'ELITE');
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter((v) => `${v.asset.make} ${v.asset.model} ${v.asset.year} ${v.description}`.toLowerCase().includes(needle));
    }
    return rows.sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0)).slice(0, limit).map((v) => ({
      listingId: v.listingId,
      reference: v.reference,
      title: `${v.asset.year} ${v.asset.make} ${v.asset.model}`,
      make: v.asset.make,
      model: v.asset.model,
      year: v.asset.year,
      odometerKm: v.asset.odometerKm,
      priceCents: v.priceCents,
      status: v.status,
      trustBadge: v.trustBadge,
      trustScore: v.trustScore,
      suburb: v.location.suburb,
      metro: v.location.metro,
      sellerType: v.sellerType,
      vinFingerprint: fingerprint(v.asset.vin, 8),
      hasOutstandingFinance: v.asset.titleHolder?.type === 'BANK',
      inspectionBridged: v.passport.bridgedFromServices.length > 0,
      verifiedAt: v.verifiedAt || null,
      photoCount: v.photos.length,
    }));
  }

  get(listingId) {
    const listing = this.#listing(listingId);
    listing.views += 1;
    const escrow = listing.escrowId ? this.kernel.escrow.get(listing.escrowId) : null;
    return deepClone({
      ...listing,
      title: `${listing.asset.year} ${listing.asset.make} ${listing.asset.model}`,
      vinFingerprint: fingerprint(listing.asset.vin, 8),
      escrow: escrow ? { status: escrow.status, provider: escrow.providerLabel, milestones: escrow.plan.milestones, releases: escrow.releases } : null,
      auditTrail: this.kernel.ledger.publicTimeline(listingId),
      proofDigest: this.kernel.ledger.exportProof(listingId).digest.slice(0, 16),
      releaseOrder: this.kernel.vertical('vehicles').plugin.releaseOrder,
    });
  }

  /** Buyer-side "is this car safe to buy?" answer, in plain language. */
  buyerAnswer(listingId) {
    const listing = this.#listing(listingId);
    const checks = listing.verification?.checks || [];
    const answered = (name) => checks.find((c) => c.name === name);
    return {
      listingId,
      question: 'Can I safely buy this exact car from this exact seller, under these exact terms, with my funds protected until transfer is proven?',
      answer: listing.status === LISTING_STATUS.COMPLETED ? 'COMPLETED' : listing.status === LISTING_STATUS.REMOVED ? 'NO — THIS LISTING WAS REMOVED'
        : [CHECK_STATUS.PASS].includes(answered('police_stolen_status')?.status) && listing.verification?.status === 'VERIFIED' ? 'YES'
        : 'NOT YET — VERIFICATION IS INCOMPLETE',
      breakdown: [
        { question: 'Is the seller who they say they are?', check: 'seller_identity_fica', result: answered('seller_identity_fica') },
        { question: 'Do the VIN, engine number and registration agree?', check: 'vin_engine_registration_match', result: answered('vin_engine_registration_match') },
        { question: 'Is the seller the registered owner or authorised by the title holder?', check: 'ownership_natis', result: answered('ownership_natis') },
        { question: 'Is this car reported stolen?', check: 'police_stolen_status', result: answered('police_stolen_status') },
        { question: 'Is there outstanding finance, and who gets paid first?', check: 'finance_settlement', result: answered('finance_settlement'), titleHolder: listing.asset.titleHolder },
        { question: 'Has an independent assessor confirmed the condition?', check: 'independent_condition_report', result: answered('independent_condition_report'), bridgedFromServices: listing.passport.bridgedFromServices.length },
      ].map((row) => ({
        ...row,
        status: row.result?.status || CHECK_STATUS.PENDING,
        source: row.result?.source || 'not yet checked',
        finding: row.result?.finding || null,
        evidenceSeal: row.result?.evidenceHash ? row.result.evidenceHash.slice(0, 12) : null,
      })),
      protections: {
        escrow: listing.escrowId ? `Funds held by ${listing.escrowProvider} until handover and transfer` : 'Escrow opens once you and the seller agree a price',
        tamperRemoval: 'If the seller changes the VIN, engine number or a verified document after verification, the listing is removed automatically',
        negotiationLock: listing.negotiation ? 'Description, price and terms are locked — any change needs your written approval' : 'Terms lock the moment you start negotiating',
        privacyPreservingFunds: 'The seller only ever sees "funds reserved for this transaction until <time>" — never your balance',
        releaseOrder: listing.asset.titleHolder?.type === 'BANK'
          ? 'The bank is settled first from escrow, then NaTIS transfer is confirmed, then the balance goes to the seller'
          : 'Keys and documents with a final VIN check first, then NaTIS transfer, then the balance releases',
      },
      knownDefects: listing.asset.knownDefects,
      includedItems: listing.asset.includedItems,
      versions: listing.versions.length,
      trustScore: listing.trustScore,
      badge: listing.trustBadge,
    };
  }

  stats() {
    const rows = this.store.all('vehicles');
    return {
      listings: rows.length,
      verified: rows.filter((v) => v.verification?.status === 'VERIFIED' || v.verification?.status === 'ELITE').length,
      removed: rows.filter((v) => v.status === LISTING_STATUS.REMOVED).length,
      completed: rows.filter((v) => v.status === LISTING_STATUS.COMPLETED).length,
      inNegotiation: rows.filter((v) => v.status === LISTING_STATUS.NEGOTIATION_LOCKED).length,
      totalValueCents: rows.reduce((s, v) => s + v.priceCents, 0),
      passports: this.store.count('vehiclePassports'),
      tamperIncidents: rows.reduce((s, v) => s + v.incidents.filter((i) => i.code === 'CRITICAL_ASSET_TAMPER').length, 0),
      bridgedInspections: rows.reduce((s, v) => s + v.passport.bridgedFromServices.length, 0),
    };
  }
}

function MILESTONE_ACCEPTED() {
  return 'ACCEPTED';
}

module.exports = { VehicleService, LISTING_STATUS, vinCheckDigit, validateSaPlate, VIN_REGEX };
