'use strict';

/**
 * Lula ProVeri — Policy engine.
 *
 * Declarative, auditable rules. Every rule states *what it protects*, *when it
 * fires* and *what it does*. Rules are evaluated in order and the strictest
 * outcome wins, so a single tamper attempt cannot slip through because another
 * rule was permissive.
 *
 * These are the TrustShield tamper rules generalised from asset listings to
 * service jobs, bids, bookings, payouts and profiles.
 */

const { sha256, nowIso, deepClone, flattenPatch, getPath } = require('./util');
const { AUDIT_LEVEL } = require('./audit');

const POLICY_EFFECT = Object.freeze({
  ALLOW: 'ALLOW',
  WARN: 'WARN',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  BLOCK: 'BLOCK',
  FREEZE: 'FREEZE',
  REMOVE: 'REMOVE',
});

const POLICY_RULES = Object.freeze([
  {
    id: 'POW-001',
    name: 'proof_of_work_required_before_release',
    protects: 'Customer',
    statement: 'Escrow may only release after geotagged, timestamped proof of work is attached to the milestone.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'CRITICAL',
    appliesTo: ['booking', 'escrow'],
    test: ({ booking }) => {
      if (!booking || booking.status !== 'AWAITING_CONFIRMATION') return { fired: false };
      const milestone = booking.milestones?.find((m) => m.status === 'EVIDENCE_SUBMITTED' || m.status === 'ACCEPTED');
      const missing = milestone?.missingEvidence?.length || 0;
      return { fired: missing > 0, reason: `${missing} required evidence item(s) missing`, detail: milestone?.missingEvidence };
    },
  },
  {
    id: 'POW-002',
    name: 'evidence_must_be_captured_on_site',
    protects: 'Customer',
    statement: 'Photo evidence whose geolocation is more than 2 km from the job address is rejected and the payout is held.',
    effect: POLICY_EFFECT.FREEZE,
    severity: 'HIGH',
    appliesTo: ['evidence'],
    test: ({ evidence, booking }) => {
      if (!evidence?.geo || !booking?.address?.geo) return { fired: false };
      const km = evidence.geo.distanceKm;
      if (km == null) return { fired: false };
      return { fired: km > 2, reason: `Photo captured ${km.toFixed(1)} km from the job address`, detail: { km, limitKm: 2 } };
    },
  },
  {
    id: 'BDS-001',
    name: 'bank_detail_substitution_freeze',
    protects: 'Both parties',
    statement: 'Changing payout bank details after a booking is confirmed freezes the payout pending two-channel call-back verification.',
    effect: POLICY_EFFECT.FREEZE,
    severity: 'CRITICAL',
    appliesTo: ['pro'],
    test: ({ patch, subject }) => {
      const changes = flattenPatch(patch).map(([p]) => p);
      const bankChanged = changes.some((p) => p.startsWith('payoutBank'));
      return { fired: bankChanged && subject?.status === 'ACTIVE', reason: 'Payout bank details changed on an active pro account', detail: { changes } };
    },
  },
  {
    id: 'OFP-001',
    name: 'off_platform_payment_solicitation',
    protects: 'Both parties',
    statement: 'Any message asking to pay or be paid outside ProVeri quarantines the conversation and flags the account.',
    effect: POLICY_EFFECT.FREEZE,
    severity: 'CRITICAL',
    appliesTo: ['message'],
    test: ({ message }) => {
      const text = String(message?.body || '').toLowerCase();
      const patterns = [
        /pay\s*(me\s*)?(cash|directly|into my (?:personal )?account)/,
        /e-?wallet\s*(me)?/,
        /send\s*(it\s*)?to\s*my\s*(?:capitec|fnb|absa|nedbank|standard bank|tymebank)/,
        /account\s*number\s*[:\s]?\d{6,}/,
        /branch\s*code\s*[:\s]?\d{6}/,
        /no\s*(?:need|platform)\s*(?:fee|commission)/,
        /avoid\s*(?:the|platform)\s*(?:fee|commission)/,
        /pay\s*(?:me\s*)?(?:before|upfront|deposit)\s*(?:cash)?/,
        /cash\s*(?:is|will be)\s*(?:cheaper|better)/,
        /skyp[e]?\s*(?:the|platform)/,
      ];
      const hit = patterns.find((p) => p.test(text));
      return { fired: Boolean(hit), reason: 'Message appears to solicit payment or contact outside ProVeri', detail: { pattern: hit?.source } };
    },
  },
  {
    id: 'BID-001',
    name: 'bid_scope_must_be_locked',
    protects: 'Customer',
    statement: 'Once a bid is accepted its scope, price and inclusions are locked; changes require a customer-approved variation order.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'HIGH',
    appliesTo: ['booking'],
    test: ({ patch, subject }) => {
      const locked = ['scopeOfWork', 'priceCents', 'inclusions', 'exclusions', 'materialsQuoteCents'];
      const changes = flattenPatch(patch).map(([p]) => p.split('.').pop());
      const touched = changes.filter((c) => locked.includes(c));
      const noVariation = !subject?.variationOrders?.some((v) => v.status === 'APPROVED');
      return { fired: touched.length > 0 && !subject?.lockedForVariation && noVariation, reason: 'Accepted bid terms were edited without an approved variation order', detail: { touched } };
    },
  },
  {
    id: 'REV-001',
    name: 'reviews_only_from_completed_escrowed_jobs',
    protects: 'Both parties',
    statement: 'A review can only be written by a party to a booking whose escrow reached RELEASED or REFUNDED.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'HIGH',
    appliesTo: ['review'],
    test: ({ booking }) => {
      const ok = booking && ['RELEASED', 'REFUNDED', 'PARTIALLY_RELEASED'].includes(booking.escrowStatus);
      return { fired: !ok, reason: 'Reviews are only allowed on completed, escrow-protected jobs — this is why ProVeri ratings cannot be bought', detail: { escrowStatus: booking?.escrowStatus } };
    },
  },
  {
    id: 'KYC-001',
    name: 'no_bidding_without_verified_identity',
    protects: 'Customer',
    statement: 'A pro may not bid until identity, mobile and bank verification have all passed.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'CRITICAL',
    appliesTo: ['bid'],
    test: ({ pro }) => {
      const passed = ['sa_id_document', 'mobile_and_email_otp', 'bank_account_verification']
        .every((name) => pro?.verification?.checks?.find((c) => c.name === name)?.status === 'PASS');
      return { fired: !passed, reason: 'Identity, phone/email and bank verification must all pass before bidding' };
    },
  },
  {
    id: 'TRD-001',
    name: 'statutory_trade_work_requires_certificate',
    protects: 'Customer',
    statement: 'A job whose category is a statutory trade may not be awarded to a pro without a recorded certificate for that trade.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'CRITICAL',
    appliesTo: ['booking', 'bid'],
    test: ({ category, pro }) => {
      if (!category?.statutoryTrade) return { fired: false };
      const cert = pro?.verification?.checks?.find((c) => c.name === 'trade_certification');
      // PASS = confirmed with the issuing body. WARN = a certificate number and
      // evidence hash are on file but the register could not be queried yet, so
      // the pro may bid while the public badge shows confirmation as pending.
      // FAIL, or no reference at all, blocks outright — refusing uncertified
      // electrical and gas work is the whole point of the rule.
      const ok = ['PASS', 'WARN'].includes(cert?.status) && Boolean(cert.reference || cert.evidenceHash);
      return {
        fired: !ok,
        reason: `${category.label} is a statutory trade — ${category.regulator?.body || 'the issuing body'} registration must be on file before this bid can be awarded`,
        detail: { trade: category.trade, certStatus: cert?.status || 'ABSENT', hasReference: Boolean(cert?.reference || cert?.evidenceHash) },
      };
    },
  },
  {
    id: 'ECC-001',
    name: 'electrical_work_requires_coc_promise',
    protects: 'Customer & insurer',
    statement: 'Any electrical bid must include a Certificate of Compliance commitment; without it the bid cannot be accepted.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'HIGH',
    appliesTo: ['bid'],
    test: ({ category, bid }) => {
      if (!category?.requiresCoc) return { fired: false };
      return { fired: !bid?.includesCoc, reason: `${category.cocName || 'Certificate of Compliance'} must be included in the bid` };
    },
  },
  {
    id: 'CAN-001',
    name: 'cooling_off_before_work_starts',
    protects: 'Customer',
    statement: 'ECT Act s44: free cancellation before payment and before the service begins with the customer’s consent.',
    effect: POLICY_EFFECT.ALLOW,
    severity: 'MEDIUM',
    appliesTo: ['booking'],
    test: ({ booking }) => {
      const started = ['IN_PROGRESS', 'COMPLETED', 'AWAITING_CONFIRMATION'].includes(booking?.status);
      return { fired: !started, reason: 'Free cancellation available — work has not started', detail: { started } };
    },
  },
  {
    id: 'PCE-001',
    name: 'price_anomaly_review',
    protects: 'Customer',
    statement: 'Bids outside the metro band for the category are annotated with a price-intelligence warning before acceptance.',
    effect: POLICY_EFFECT.WARN,
    severity: 'MEDIUM',
    appliesTo: ['bid'],
    test: ({ bid, band }) => {
      if (!band || bid?.totalCents == null) return { fired: false };
      const below = bid.totalCents < band.p10Cents;
      const above = bid.totalCents > band.p90Cents;
      return {
        fired: below || above,
        reason: below
          ? `This bid is below the ${band.metro} band for ${band.categoryLabel} (p10 R${(band.p10Cents / 100).toFixed(0)}). Very low bids often mean a mid-job price increase.`
          : `This bid is above the ${band.metro} band for ${band.categoryLabel} (p90 R${(band.p90Cents / 100).toFixed(0)}). Ask what is included.`,
        detail: { below, above, band },
      };
    },
  },
  {
    id: 'VCL-001',
    name: 'vehicle_identifier_tamper_removal',
    protects: 'Buyer',
    statement: 'Changing a verified VIN, engine number or registration certificate removes the vehicle listing outright.',
    effect: POLICY_EFFECT.REMOVE,
    severity: 'CRITICAL',
    appliesTo: ['vehicleListing'],
    test: ({ patch, subject }) => {
      const critical = ['asset.vin', 'asset.engineNumber', 'asset.registrationNumber', 'evidence.natisDocumentHash'];
      const changes = flattenPatch(patch).map(([p]) => p);
      const touched = changes.filter((c) => critical.includes(c) && getPath(subject, c) !== undefined);
      return { fired: touched.length > 0 && subject?.verification?.status === 'VERIFIED', reason: 'A verified critical vehicle identifier was changed after verification', detail: { touched } };
    },
  },
]);

class PolicyEngine {
  constructor({ ledger, rules = POLICY_RULES } = {}) {
    this.ledger = ledger;
    this.rules = rules;
    this.decisions = [];
  }

  /** Evaluate every rule that applies to a subject type. */
  evaluate(subjectType, context = {}) {
    const applicable = this.rules.filter((rule) => rule.appliesTo.includes(subjectType));
    const results = [];
    for (const rule of applicable) {
      let outcome;
      try {
        outcome = rule.test(context) || { fired: false };
      } catch (error) {
        outcome = { fired: false, error: error.message };
      }
      if (!outcome.fired) continue;
      results.push({
        ruleId: rule.id,
        name: rule.name,
        protects: rule.protects,
        statement: rule.statement,
        effect: rule.effect,
        severity: rule.severity,
        reason: outcome.reason,
        detail: outcome.detail || null,
        evaluatedAt: nowIso(),
      });
    }

    const order = [POLICY_EFFECT.REMOVE, POLICY_EFFECT.FREEZE, POLICY_EFFECT.BLOCK, POLICY_EFFECT.REQUIRE_APPROVAL, POLICY_EFFECT.WARN, POLICY_EFFECT.ALLOW];
    const decision = order.find((effect) => results.some((r) => r.effect === effect)) || POLICY_EFFECT.ALLOW;

    const record = {
      decisionId: sha256({ subjectType, results, at: nowIso() }).slice(0, 16),
      subjectType,
      decision,
      firedRules: results,
      evaluatedAt: nowIso(),
      subjectId: context.subjectId || context.booking?.bookingId || context.pro?.proId || null,
    };
    this.decisions.push(record);

    if (this.ledger && results.length > 0) {
      this.ledger.append({
        action: 'POLICY_DECISION',
        subject: record.subjectId || 'platform',
        level: decision === POLICY_EFFECT.REMOVE ? AUDIT_LEVEL.CRITICAL : AUDIT_LEVEL.SAFETY,
        visibility: 'PUBLIC',
        payload: {
          summary: `${decision}: ${results.map((r) => r.ruleId).join(', ')}`,
          decision,
          rules: results.map((r) => ({ ruleId: r.ruleId, effect: r.effect, reason: r.reason })),
        },
      });
    }
    return deepClone(record);
  }

  /** Convenience: throws when the decision is BLOCK or REMOVE. */
  enforce(subjectType, context) {
    const decision = this.evaluate(subjectType, context);
    if (decision.decision === POLICY_EFFECT.BLOCK || decision.decision === POLICY_EFFECT.REMOVE) {
      const error = new Error(decision.firedRules.map((r) => `[${r.ruleId}] ${r.reason}`).join(' · '));
      error.code = decision.decision;
      error.decision = decision;
      throw error;
    }
    return decision;
  }

  /** Human-readable rule book, exposed at GET /api/policies. */
  ruleBook() {
    return this.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      protects: rule.protects,
      statement: rule.statement,
      effect: rule.effect,
      severity: rule.severity,
      appliesTo: rule.appliesTo,
    }));
  }

  stats() {
    return {
      rules: this.rules.length,
      decisions: this.decisions.length,
      byEffect: this.decisions.reduce((acc, d) => { acc[d.decision] = (acc[d.decision] || 0) + 1; return acc; }, {}),
      byRule: this.decisions.reduce((acc, d) => {
        for (const r of d.firedRules) acc[r.ruleId] = (acc[r.ruleId] || 0) + 1;
        return acc;
      }, {}),
    };
  }
}

module.exports = { PolicyEngine, POLICY_RULES, POLICY_EFFECT };
