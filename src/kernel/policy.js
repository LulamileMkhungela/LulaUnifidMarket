'use strict';

/**
 * ProVeri — Policy engine.
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
    id: 'WEB-001',
    name: 'website_update_allowance_is_metered',
    protects: 'Both parties',
    statement: 'Content updates to a live business site are metered against the plan\'s monthly allowance. Once the allowance is used the update needs approval — an upgrade, a renewal, or a paid extra update at the published per-update rate. Nobody gets silently billed and nobody gets free unlimited work.',
    effect: POLICY_EFFECT.REQUIRE_APPROVAL,
    severity: 'MEDIUM',
    appliesTo: ['website'],
    test: ({ site, update, action }) => {
      if (action && action !== 'UPDATE') return { fired: false };
      const plan = site?.plan;
      if (!plan || plan.updateCreditsTotal === -1) return { fired: false };
      const used = Number(plan.updateCreditsUsed || 0);
      const total = Number(plan.updateCreditsTotal || 0);
      return {
        fired: used >= total,
        reason: `${plan.planName} allows ${total} update(s) a month and ${used} have been used this period`,
        detail: { used, total, extraUpdateCents: plan.extraUpdateCents, update: update?.summary || null },
      };
    },
  },
  {
    id: 'WEB-002',
    name: 'assets_must_have_permission_before_publish',
    protects: 'Business and third parties',
    statement: 'A business site may not be published while any asset it uses lacks a recorded permission from the rights holder. Credit is not permission, and where an identifiable person appears, POPIA consent is required in addition to copyright clearance.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'HIGH',
    appliesTo: ['website'],
    test: ({ site, action }) => {
      if (action && action !== 'PUBLISH') return { fired: false };
      const permissions = site?.permissions;
      if (!permissions) return { fired: false };
      const uncleared = Number(permissions.assetsUncleared || 0);
      const popia = Number(permissions.popiaOutstanding || 0);
      return {
        fired: uncleared > 0 || popia > 0,
        reason: uncleared > 0
          ? `${uncleared} asset(s) have no permission record: ${(permissions.unclearedFiles || []).slice(0, 4).join(', ')}`
          : `${popia} asset(s) show identifiable people without recorded POPIA consent`,
        detail: { uncleared, popiaOutstanding: popia, files: permissions.unclearedFiles || [] },
      };
    },
  },
  {
    id: 'WEB-003',
    name: 'ai_images_must_be_labelled',
    protects: 'Consumer',
    statement: 'An AI-generated image on a published business site must be labelled as illustrative. A generated steak must never stand in for a real one without saying so.',
    effect: POLICY_EFFECT.WARN,
    severity: 'MEDIUM',
    appliesTo: ['website'],
    test: ({ site }) => {
      const unlabelled = Number(site?.permissions?.aiUnlabelled || 0);
      return { fired: unlabelled > 0, reason: `${unlabelled} AI-generated asset(s) are not labelled as illustrative`, detail: { unlabelled } };
    },
  },
  {
    id: 'LEAD-001',
    name: 'popia_objection_blocks_all_outreach',
    protects: 'Lead',
    statement: 'Once a lead objects to being contacted, every outreach channel is blocked. The objection is recorded in the audit ledger and survives a change of salesperson.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'CRITICAL',
    appliesTo: ['lead'],
    test: ({ lead }) => ({
      fired: Boolean(lead?.consent?.optOut),
      reason: `${lead?.businessName || 'This lead'} objected to further contact${lead?.consent?.optOutAt ? ` on ${String(lead.consent.optOutAt).slice(0, 10)}` : ''} — POPIA s11(3) objection recorded`,
      detail: { optOutAt: lead?.consent?.optOutAt || null, reason: lead?.consent?.optOutReason || null },
    }),
  },
  {
    id: 'LEAD-002',
    name: 'outreach_respects_business_hours',
    protects: 'Lead',
    statement: 'Cold outreach outside 08:00–18:00 South African time is flagged. A cold WhatsApp at 21:00 is how a brand gets blocked, and a blocked number is a lost lead.',
    effect: POLICY_EFFECT.WARN,
    severity: 'LOW',
    appliesTo: ['lead'],
    test: ({ outreach }) => {
      if (!outreach?.at) return { fired: false };
      if (outreach.channel === 'MEETING' || outreach.channel === 'WALK_IN') return { fired: false };
      const hour = new Date(outreach.at).getUTCHours() + 2; // SAST is UTC+2, no DST
      const localHour = ((hour % 24) + 24) % 24;
      const weekend = [0, 6].includes(new Date(outreach.at).getUTCDay());
      return {
        fired: localHour < 8 || localHour >= 18 || weekend,
        reason: `${localHour}:00 SAST${weekend ? ' on a weekend' : ''} is outside business hours for cold outreach`,
        detail: { localHour, weekend, channel: outreach.channel },
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

  /* ---------------------------------------------------------------- *
   * PORTFOLIO — the past work that opens the door
   * ---------------------------------------------------------------- */
  {
    id: 'PRT-001',
    name: 'no_verification_badge_without_evidence',
    protects: 'Customer',
    statement: 'A portfolio item may only wear a verification badge when ProVeri evidence earned it. Self-declared work says so.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'CRITICAL',
    appliesTo: ['portfolio'],
    test: ({ item, action }) => {
      if (!item || !['ADD', 'UPDATE'].includes(action)) return { fired: false };
      const claiming = item.claimsProofOfWork === true && (item.tier === 'SELF_DECLARED' || !item.tier);
      return {
        fired: claiming,
        reason: 'A verification badge was claimed for work with no ProVeri evidence behind it. Uploads are welcome; pretending is not.',
      };
    },
  },
  {
    id: 'PRT-002',
    name: 'no_reused_photos_across_pros',
    protects: 'Customer',
    statement: 'A photo another pro has already published cannot be uploaded as your own work.',
    effect: POLICY_EFFECT.BLOCK,
    severity: 'CRITICAL',
    appliesTo: ['portfolio'],
    test: ({ duplicateOf }) => ({
      fired: Boolean(duplicateOf),
      reason: duplicateOf ? `This photo is already published by another pro (${duplicateOf.source}). Reused portfolio photos are the oldest trick in the trade.` : '',
    }),
  },
  {
    id: 'PRT-003',
    name: 'incomplete_work_items_rank_lower',
    protects: 'Customer',
    statement: 'A self-declared item with no suburb and no price ranks below proven work.',
    effect: POLICY_EFFECT.WARN,
    severity: 'LOW',
    appliesTo: ['portfolio'],
    test: ({ item, action }) => {
      if (!item || action !== 'ADD' || item.tier !== 'SELF_DECLARED') return { fired: false };
      return {
        fired: !item.suburbId && item.priceCents == null,
        reason: 'Add a suburb and a price so homeowners can judge it; thin uploads rank below proven work.',
      };
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
