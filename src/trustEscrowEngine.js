'use strict';

const crypto = require('node:crypto');

const LISTING_STATUS = Object.freeze({
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  RECHECK_REQUIRED: 'RECHECK_REQUIRED',
  NEGOTIATION_LOCKED: 'NEGOTIATION_LOCKED',
  BUYER_FUNDS_CONFIRMED: 'BUYER_FUNDS_CONFIRMED',
  FUNDS_IN_ESCROW: 'FUNDS_IN_ESCROW',
  READY_FOR_RELEASE: 'READY_FOR_RELEASE',
  COMPLETED: 'COMPLETED',
  REFUNDED: 'REFUNDED',
  REMOVED: 'REMOVED',
});

const CHECK_STATUS = Object.freeze({
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
});

const ESCROW_STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  RESERVED: 'RESERVED',
  FUNDED: 'FUNDED',
  RELEASED: 'RELEASED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
});

const REQUIRED_CHECKS = Object.freeze({
  vehicle: [
    'seller_identity_fica',
    'vin_engine_registration_match',
    'ownership_natis',
    'police_stolen_status',
    'finance_settlement',
    'independent_condition_report',
  ],
  property: [
    'seller_identity_fica',
    'deeds_office_title',
    'municipal_account_clearance',
    'bond_and_encumbrance_search',
    'agent_ppra_ffc',
    'conveyancer_trust_account',
  ],
});

const CRITICAL_FIELDS = Object.freeze({
  vehicle: [
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
  property: [
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
});

const NEGOTIATION_LOCKED_FIELDS = Object.freeze([
  'description',
  'priceCents',
  'asset.condition',
  'asset.includedItems',
  'asset.knownDefects',
  'evidence.inspectionReportHash',
]);

function nowIso() {
  return new Date().toISOString();
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined) {
          acc[key] = canonicalize(value[key]);
        }
        return acc;
      }, {});
  }
  return value;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPath(object, path) {
  return path.split('.').reduce((cursor, segment) => {
    if (cursor === undefined || cursor === null) {
      return undefined;
    }
    return cursor[segment];
  }, object);
}

function setPath(object, path, value) {
  const segments = path.split('.');
  let cursor = object;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
}

function flattenPatch(patch, prefix = '') {
  return Object.entries(patch).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenPatch(value, path);
    }
    return [[path, value]];
  });
}

function normalizeAmountCents(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
  return amountCents;
}

class TrustEscrowEngine {
  constructor(options = {}) {
    this.options = {
      requiredChecks: REQUIRED_CHECKS,
      criticalFields: CRITICAL_FIELDS,
      ...options,
    };
    this.listings = new Map();
    this.buyers = new Map();
    this.events = [];
    this.sequence = 0;
  }

  createBuyer({ buyerId, displayName, ficaStatus = 'PENDING', riskTier = 'STANDARD' }) {
    if (!buyerId) throw new Error('buyerId is required');
    const buyer = {
      buyerId,
      displayName,
      ficaStatus,
      riskTier,
      balanceReservations: [],
      createdAt: nowIso(),
    };
    this.buyers.set(buyerId, buyer);
    this.#emit('BUYER_CREATED', { buyerId, ficaStatus, riskTier });
    return deepClone(buyer);
  }

  createListing(input) {
    const listing = this.#buildListing(input);
    this.listings.set(listing.id, listing);
    this.#emit('LISTING_CREATED', { listingId: listing.id, type: listing.type, status: listing.status });
    return deepClone(listing);
  }

  submitVerificationChecks(listingId, checks) {
    const listing = this.#getActiveListing(listingId);
    if (!Array.isArray(checks) || checks.length === 0) {
      throw new Error('checks must be a non-empty array');
    }

    for (const check of checks) {
      this.#recordCheck(listing, check);
    }

    this.#recalculateTrustStatus(listing);
    this.#addVersion(listing, 'verification checks submitted');
    return deepClone(listing);
  }

  startNegotiation(listingId, { buyerId, offerCents, terms = {}, expiresAt }) {
    const listing = this.#getActiveListing(listingId);
    if (listing.status !== LISTING_STATUS.VERIFIED) {
      throw new Error(`listing must be VERIFIED before negotiation; current status is ${listing.status}`);
    }
    if (!buyerId) throw new Error('buyerId is required');
    normalizeAmountCents(offerCents);

    listing.negotiation = {
      buyerId,
      offerCents,
      terms: deepClone(terms),
      termsHash: stableHash({ buyerId, offerCents, terms, listingHash: listing.currentHash }),
      startedAt: nowIso(),
      expiresAt,
      lockedFields: [...NEGOTIATION_LOCKED_FIELDS, ...this.options.criticalFields[listing.type]],
    };
    listing.locks.description = true;
    listing.locks.price = true;
    listing.status = LISTING_STATUS.NEGOTIATION_LOCKED;
    this.#addVersion(listing, 'negotiation started; description and terms locked');
    this.#emit('NEGOTIATION_STARTED', { listingId, buyerId, offerCents, termsHash: listing.negotiation.termsHash });
    return deepClone(listing);
  }

  updateListing(listingId, patch, { actorId, reason = 'seller update' } = {}) {
    const listing = this.#getListing(listingId);
    if (listing.status === LISTING_STATUS.REMOVED) {
      throw new Error('removed listings cannot be edited');
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('patch must be an object');
    }

    const changes = flattenPatch(patch);
    const criticalChanged = changes.some(([path, nextValue]) =>
      this.options.criticalFields[listing.type].includes(path) && getPath(listing, path) !== nextValue,
    );
    const negotiationLockedChanged = Boolean(listing.negotiation) && changes.some(([path, nextValue]) =>
      listing.negotiation.lockedFields.includes(path) && getPath(listing, path) !== nextValue,
    );

    if (criticalChanged && listing.verification.status === 'VERIFIED') {
      const incident = this.#addIncident(listing, {
        code: 'CRITICAL_ASSET_TAMPER',
        severity: 'CRITICAL',
        actorId,
        message: 'A verified critical asset identifier/document was changed after verification.',
        evidence: { changes: changes.map(([path]) => path) },
      });
      this.#removeListing(listing, incident.code, 'Verified listing was tampered with');
      return {
        accepted: false,
        action: 'REMOVED',
        incident: deepClone(incident),
        listing: deepClone(listing),
      };
    }

    if (negotiationLockedChanged) {
      const incident = this.#addIncident(listing, {
        code: 'NEGOTIATION_LOCK_VIOLATION',
        severity: 'HIGH',
        actorId,
        message: 'Description/price/terms cannot be changed after buyer negotiation starts without a buyer-approved addendum.',
        evidence: { changes: changes.map(([path]) => path) },
      });
      this.#emit('EDIT_BLOCKED', { listingId, actorId, code: incident.code });
      return {
        accepted: false,
        action: 'BLOCKED',
        incident: deepClone(incident),
        listing: deepClone(listing),
      };
    }

    for (const [path, value] of changes) {
      setPath(listing, path, value);
    }

    if (listing.verification.status === 'VERIFIED') {
      listing.status = LISTING_STATUS.RECHECK_REQUIRED;
      listing.verification.status = 'RECHECK_REQUIRED';
      listing.verification.score = Math.min(listing.verification.score, 74);
    }

    this.#addVersion(listing, reason);
    this.#emit('LISTING_UPDATED', { listingId, actorId, status: listing.status, reason });
    return {
      accepted: true,
      action: listing.status === LISTING_STATUS.RECHECK_REQUIRED ? 'RECHECK_REQUIRED' : 'UPDATED',
      listing: deepClone(listing),
    };
  }

  confirmBuyerFunds(listingId, { buyerId, amountCents, providerRef, availableCents, reservationTtlMinutes = 60 }) {
    const listing = this.#getActiveListing(listingId);
    const amount = normalizeAmountCents(amountCents);
    if (!buyerId) throw new Error('buyerId is required');

    const sufficient = Number.isInteger(availableCents) && availableCents >= amount;
    const expiresAt = new Date(Date.now() + reservationTtlMinutes * 60 * 1000).toISOString();
    const reservation = {
      reservationId: this.#nextId('res'),
      listingId,
      buyerId,
      amountCents: amount,
      providerRef,
      status: sufficient ? ESCROW_STATUS.RESERVED : 'DECLINED',
      expiresAt,
      createdAt: nowIso(),
    };

    if (sufficient) {
      listing.buyerFundReservation = reservation;
      listing.status = LISTING_STATUS.BUYER_FUNDS_CONFIRMED;
      const buyer = this.buyers.get(buyerId);
      if (buyer) buyer.balanceReservations.push(reservation);
      this.#emit('BUYER_FUNDS_CONFIRMED', { listingId, buyerId, amountCents: amount, providerRef });
      return {
        sufficient: true,
        reservation: deepClone(reservation),
        sellerNotification: {
          listingId,
          buyerId,
          status: 'BUYER_HAS_SUFFICIENT_RESERVED_FUNDS',
          message: 'A verified payment provider confirms the buyer can fund this transaction. Exact account balance is not disclosed.',
          balanceDisclosed: false,
          amountCents: amount,
        },
        buyerNotification: {
          listingId,
          status: 'FUNDS_RESERVED_TEMPORARILY',
          message: `Funds availability confirmed until ${expiresAt}. Deposit into escrow before expiry to continue.`,
        },
      };
    }

    this.#emit('BUYER_FUNDS_DECLINED', { listingId, buyerId, amountCents: amount, providerRef });
    return {
      sufficient: false,
      reservation: deepClone(reservation),
      sellerNotification: null,
      buyerNotification: {
        listingId,
        status: 'INSUFFICIENT_FUNDS_OR_PROVIDER_DECLINED',
        message: 'The payment provider could not confirm sufficient funds. No balance details were shared with the seller.',
      },
    };
  }

  openEscrow(listingId, { buyerId, amountCents, escrowProvider, escrowReference, conditions = [] }) {
    const listing = this.#getActiveListing(listingId);
    const amount = normalizeAmountCents(amountCents);
    if (!listing.buyerFundReservation || listing.buyerFundReservation.buyerId !== buyerId) {
      throw new Error('buyer funds must be confirmed before opening escrow');
    }
    if (!escrowProvider || !escrowReference) {
      throw new Error('escrowProvider and escrowReference are required');
    }

    listing.escrow = {
      escrowId: this.#nextId('esc'),
      provider: escrowProvider,
      reference: escrowReference,
      buyerId,
      amountCents: amount,
      status: ESCROW_STATUS.FUNDED,
      fundedAt: nowIso(),
      releaseConditions: conditions,
      evidence: [],
    };
    listing.status = LISTING_STATUS.FUNDS_IN_ESCROW;
    this.#addVersion(listing, 'escrow funded');
    this.#emit('ESCROW_FUNDED', { listingId, buyerId, amountCents: amount, escrowProvider, escrowReference });
    return deepClone(listing);
  }

  addHandoverEvidence(listingId, evidence) {
    const listing = this.#getActiveListing(listingId);
    if (!listing.escrow || listing.escrow.status !== ESCROW_STATUS.FUNDED) {
      throw new Error('escrow must be funded before handover evidence can be added');
    }
    const record = {
      evidenceId: this.#nextId('evd'),
      ...deepClone(evidence),
      evidenceHash: stableHash(evidence),
      uploadedAt: nowIso(),
    };
    listing.escrow.evidence.push(record);
    this.#emit('HANDOVER_EVIDENCE_ADDED', { listingId, evidenceId: record.evidenceId, type: evidence.type });
    return deepClone(record);
  }

  markReadyForRelease(listingId, { buyerId, accepted = false, verifierApproved = false }) {
    const listing = this.#getActiveListing(listingId);
    if (!listing.escrow || listing.escrow.status !== ESCROW_STATUS.FUNDED) {
      throw new Error('escrow must be funded before release');
    }
    if (listing.escrow.buyerId !== buyerId) {
      throw new Error('only the escrow buyer can accept release');
    }
    if (!accepted || !verifierApproved) {
      listing.escrow.status = ESCROW_STATUS.DISPUTED;
      this.#emit('ESCROW_DISPUTED', { listingId, buyerId });
      return deepClone(listing);
    }
    listing.status = LISTING_STATUS.READY_FOR_RELEASE;
    this.#emit('ESCROW_READY_FOR_RELEASE', { listingId, buyerId });
    return deepClone(listing);
  }

  releaseEscrow(listingId, { releaseReference }) {
    const listing = this.#getActiveListing(listingId);
    if (listing.status !== LISTING_STATUS.READY_FOR_RELEASE) {
      throw new Error(`listing must be READY_FOR_RELEASE; current status is ${listing.status}`);
    }
    listing.escrow.status = ESCROW_STATUS.RELEASED;
    listing.escrow.releasedAt = nowIso();
    listing.escrow.releaseReference = releaseReference;
    listing.status = LISTING_STATUS.COMPLETED;
    this.#addVersion(listing, 'escrow released and transaction completed');
    this.#emit('ESCROW_RELEASED', { listingId, releaseReference });
    return deepClone(listing);
  }

  refundEscrow(listingId, { refundReference, reason }) {
    const listing = this.#getListing(listingId);
    if (!listing.escrow || listing.escrow.status !== ESCROW_STATUS.FUNDED && listing.escrow.status !== ESCROW_STATUS.DISPUTED) {
      throw new Error('only funded or disputed escrow can be refunded');
    }
    listing.escrow.status = ESCROW_STATUS.REFUNDED;
    listing.escrow.refundedAt = nowIso();
    listing.escrow.refundReference = refundReference;
    listing.status = LISTING_STATUS.REFUNDED;
    this.#addIncident(listing, {
      code: 'ESCROW_REFUNDED',
      severity: 'MEDIUM',
      message: reason || 'Escrow refunded to buyer.',
      evidence: { refundReference },
    });
    this.#emit('ESCROW_REFUNDED', { listingId, refundReference });
    return deepClone(listing);
  }

  runContinuousMonitoring(listingId, signals = []) {
    const listing = this.#getListing(listingId);
    if (listing.status === LISTING_STATUS.REMOVED || listing.status === LISTING_STATUS.COMPLETED) {
      return deepClone(listing);
    }
    if (!Array.isArray(signals)) throw new Error('signals must be an array');

    const criticalSignals = [];
    for (const signal of signals) {
      const record = {
        signalId: this.#nextId('sig'),
        severity: signal.severity || 'LOW',
        type: signal.type,
        source: signal.source,
        message: signal.message,
        observedAt: signal.observedAt || nowIso(),
        metadata: deepClone(signal.metadata || {}),
      };
      listing.monitoringSignals.push(record);
      this.#emit('MONITORING_SIGNAL_RECORDED', { listingId, signalId: record.signalId, severity: record.severity, type: record.type });
      if (['CRITICAL', 'HIGH'].includes(record.severity)) {
        criticalSignals.push(record);
      }
    }

    if (criticalSignals.length > 0) {
      const incident = this.#addIncident(listing, {
        code: 'CONTINUOUS_MONITORING_RED_FLAG',
        severity: 'CRITICAL',
        message: 'Continuous monitoring found a high-risk signal after listing verification.',
        evidence: { signals: criticalSignals },
      });
      this.#removeListing(listing, incident.code, 'Continuous monitoring removed a risky listing');
    } else if (signals.length > 0 && listing.verification.status === 'VERIFIED') {
      listing.status = LISTING_STATUS.RECHECK_REQUIRED;
      listing.verification.status = 'RECHECK_REQUIRED';
      this.#addVersion(listing, 'monitoring requires recheck');
    }

    return deepClone(listing);
  }

  getListing(listingId) {
    return deepClone(this.#getListing(listingId));
  }

  getAuditTrail(listingId) {
    const listing = this.#getListing(listingId);
    return deepClone({
      listingId,
      versions: listing.versions,
      checks: listing.verification.checks,
      incidents: listing.incidents,
      monitoringSignals: listing.monitoringSignals,
      events: this.events.filter((event) => event.payload.listingId === listingId),
    });
  }

  #buildListing(input) {
    if (!input || typeof input !== 'object') throw new Error('listing input is required');
    const { id = this.#nextId('lst'), type, sellerId, asset, description, priceCents, evidence = {} } = input;
    if (!['vehicle', 'property'].includes(type)) throw new Error('type must be vehicle or property');
    if (!sellerId) throw new Error('sellerId is required');
    if (!asset || typeof asset !== 'object') throw new Error('asset is required');
    if (!description) throw new Error('description is required');
    normalizeAmountCents(priceCents);

    const listing = {
      id,
      type,
      sellerId,
      asset: deepClone(asset),
      description,
      priceCents,
      evidence: deepClone(evidence),
      status: LISTING_STATUS.UNDER_REVIEW,
      verification: {
        status: 'PENDING',
        score: 0,
        checks: [],
        missingChecks: [...this.options.requiredChecks[type]],
      },
      trustBadge: 'UNVERIFIED',
      locks: {
        criticalAssetIdentifiers: false,
        description: false,
        price: false,
      },
      negotiation: null,
      buyerFundReservation: null,
      escrow: null,
      incidents: [],
      monitoringSignals: [],
      versions: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.#addVersion(listing, 'initial listing snapshot');
    return listing;
  }

  #recordCheck(listing, check) {
    if (!check.name) throw new Error('check.name is required');
    if (!Object.values(CHECK_STATUS).includes(check.status)) throw new Error(`invalid check.status ${check.status}`);
    const record = {
      checkId: this.#nextId('chk'),
      name: check.name,
      status: check.status,
      source: check.source,
      score: typeof check.score === 'number' ? check.score : (check.status === CHECK_STATUS.PASS ? 100 : check.status === CHECK_STATUS.WARN ? 50 : 0),
      finding: check.finding,
      evidenceHash: check.evidence ? stableHash(check.evidence) : undefined,
      checkedAt: check.checkedAt || nowIso(),
    };
    listing.verification.checks.push(record);
    this.#emit('VERIFICATION_CHECK_RECORDED', { listingId: listing.id, check: record.name, status: record.status });
  }

  #recalculateTrustStatus(listing) {
    const latestByName = new Map();
    for (const check of listing.verification.checks) {
      latestByName.set(check.name, check);
    }
    const required = this.options.requiredChecks[listing.type];
    const missingChecks = required.filter((name) => !latestByName.has(name));
    const failed = [...latestByName.values()].filter((check) => check.status === CHECK_STATUS.FAIL);
    const warned = [...latestByName.values()].filter((check) => check.status === CHECK_STATUS.WARN);
    const requiredScores = required
      .map((name) => latestByName.get(name))
      .filter(Boolean)
      .map((check) => check.score);
    const average = requiredScores.length === 0
      ? 0
      : Math.round(requiredScores.reduce((sum, score) => sum + score, 0) / required.length);

    listing.verification.missingChecks = missingChecks;
    listing.verification.score = average;
    listing.updatedAt = nowIso();

    if (failed.length > 0) {
      const incident = this.#addIncident(listing, {
        code: 'VERIFICATION_FAILED',
        severity: 'CRITICAL',
        message: 'One or more required checks failed.',
        evidence: { failedChecks: failed.map((check) => check.name) },
      });
      this.#removeListing(listing, incident.code, 'Required verification failed');
      return;
    }

    if (missingChecks.length === 0 && warned.length === 0 && average >= 90) {
      listing.status = LISTING_STATUS.VERIFIED;
      listing.verification.status = 'VERIFIED';
      listing.trustBadge = listing.type === 'vehicle' ? 'VIN_AND_ESCROW_READY' : 'TITLE_AND_ESCROW_READY';
      listing.locks.criticalAssetIdentifiers = true;
      this.#emit('LISTING_VERIFIED', { listingId: listing.id, type: listing.type, score: average });
      return;
    }

    listing.status = LISTING_STATUS.RECHECK_REQUIRED;
    listing.verification.status = 'RECHECK_REQUIRED';
    listing.trustBadge = 'RECHECK_REQUIRED';
    this.#emit('LISTING_RECHECK_REQUIRED', { listingId: listing.id, missingChecks, warned: warned.map((check) => check.name) });
  }

  #addVersion(listing, reason) {
    const snapshot = {
      type: listing.type,
      sellerId: listing.sellerId,
      asset: listing.asset,
      description: listing.description,
      priceCents: listing.priceCents,
      evidence: listing.evidence,
      status: listing.status,
      verificationStatus: listing.verification.status,
    };
    const version = {
      version: listing.versions.length + 1,
      hash: stableHash(snapshot),
      reason,
      capturedAt: nowIso(),
      snapshot: deepClone(snapshot),
    };
    listing.currentHash = version.hash;
    listing.versions.push(version);
    listing.updatedAt = version.capturedAt;
    return version;
  }

  #addIncident(listing, incident) {
    const record = {
      incidentId: this.#nextId('inc'),
      createdAt: nowIso(),
      ...incident,
    };
    listing.incidents.push(record);
    this.#emit('INCIDENT_CREATED', { listingId: listing.id, incidentId: record.incidentId, code: record.code, severity: record.severity });
    return record;
  }

  #removeListing(listing, code, reason) {
    listing.status = LISTING_STATUS.REMOVED;
    listing.trustBadge = 'REMOVED_FOR_RISK';
    listing.removal = { code, reason, removedAt: nowIso() };
    this.#addVersion(listing, reason);
    this.#emit('LISTING_REMOVED', { listingId: listing.id, code, reason });
  }

  #getActiveListing(listingId) {
    const listing = this.#getListing(listingId);
    if (listing.status === LISTING_STATUS.REMOVED) {
      throw new Error('listing has been removed');
    }
    return listing;
  }

  #getListing(listingId) {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`listing ${listingId} not found`);
    return listing;
  }

  #nextId(prefix) {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(6, '0')}`;
  }

  #emit(type, payload) {
    this.events.push({ eventId: this.#nextId('evt'), type, payload: deepClone(payload), createdAt: nowIso() });
  }
}

module.exports = {
  TrustEscrowEngine,
  LISTING_STATUS,
  CHECK_STATUS,
  ESCROW_STATUS,
  REQUIRED_CHECKS,
  CRITICAL_FIELDS,
  NEGOTIATION_LOCKED_FIELDS,
  stableHash,
};
