'use strict';

/**
 * ProVeri — Risk engine.
 *
 * Turns raw signals into a weighted 0–100 risk score, a tier, and a recommended
 * action. Two independent scores are maintained:
 *
 *   - `fraudRisk`  — how likely this actor/job is to be a scam attempt
 *   - `safetyRisk` — how much physical-safety support a job visit needs
 *
 * SAFETY ETHICS GUARDRAIL (non-negotiable, enforced in code):
 * crime and locality data may only ever *raise verification friction* — extra
 * ID checks, gate codes, check-in prompts, insurance nudges. It must never
 * change a pro's ranking, a customer's price, or whether a job can be posted.
 * `applyLocalitySignal()` throws if a caller tries to use it for ranking.
 */

const { clamp, deepClone, nextId, nowIso, sha256 } = require('./util');
const { AUDIT_LEVEL } = require('./audit');

const RISK_TIER = Object.freeze({
  MINIMAL: 'MINIMAL',
  LOW: 'LOW',
  ELEVATED: 'ELEVATED',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

const RISK_ACTION = Object.freeze({
  ALLOW: 'ALLOW',
  MONITOR: 'MONITOR',
  STEP_UP_VERIFICATION: 'STEP_UP_VERIFICATION',
  HOLD_PAYOUT: 'HOLD_PAYOUT',
  FREEZE_ESCROW: 'FREEZE_ESCROW',
  QUARANTINE: 'QUARANTINE',
  REMOVE: 'REMOVE',
  REPORT: 'REPORT',
});

/**
 * Signal catalogue. Weights are tuned so a single strong fraud indicator alone
 * cannot silently pass, and so three weak indicators add up to real friction.
 */
const SIGNAL_CATALOGUE = Object.freeze({
  /* ---- Fraud / scam indicators ---- */
  OFF_PLATFORM_PAYMENT_REQUEST: { weight: 45, kind: 'FRAUD', label: 'Asked to pay or be paid outside the platform', action: RISK_ACTION.FREEZE_ESCROW },
  OFF_PLATFORM_CONTACT_REQUEST: { weight: 18, kind: 'FRAUD', label: 'Pushed the conversation to WhatsApp/calls to avoid the record', action: RISK_ACTION.MONITOR },
  BANK_DETAIL_CHANGE_AFTER_BOOKING: { weight: 40, kind: 'FRAUD', label: 'Payout bank details changed after a booking was confirmed', action: RISK_ACTION.HOLD_PAYOUT },
  BANK_NAME_MISMATCH: { weight: 55, kind: 'FRAUD', label: 'Bank account name does not match the verified identity', action: RISK_ACTION.REMOVE },
  IDENTITY_DOCUMENT_MISMATCH: { weight: 60, kind: 'FRAUD', label: 'Identity document does not match the declared person', action: RISK_ACTION.REMOVE },
  DUPLICATE_PROFILE_DEVICE: { weight: 30, kind: 'FRAUD', label: 'Another account shares this device or phone number', action: RISK_ACTION.QUARANTINE },
  FAKE_REVIEW_CLUSTER: { weight: 35, kind: 'FRAUD', label: 'Cluster of reviews from related or brand-new accounts', action: RISK_ACTION.QUARANTINE },
  PRICE_ANOMALY_LOW: { weight: 22, kind: 'FRAUD', label: 'Bid far below the market band — classic bait-and-switch setup', action: RISK_ACTION.STEP_UP_VERIFICATION },
  PRICE_ANOMALY_HIGH: { weight: 12, kind: 'FRAUD', label: 'Bid far above the market band for the scope described', action: RISK_ACTION.MONITOR },
  DEPOSIT_ESCALATION: { weight: 38, kind: 'FRAUD', label: 'Requested a larger upfront deposit than the job warrants', action: RISK_ACTION.FREEZE_ESCROW },
  SANCTIONED_OR_PEP: { weight: 50, kind: 'FRAUD', label: 'Sanctions / PEP screening hit', action: RISK_ACTION.REPORT },
  CERTIFICATE_NOT_FOUND: { weight: 42, kind: 'FRAUD', label: 'Trade certificate could not be confirmed with the issuing body', action: RISK_ACTION.STEP_UP_VERIFICATION },
  EVIDENCE_EXIF_MISMATCH: { weight: 34, kind: 'FRAUD', label: 'Proof-of-work photos were not taken at the job address', action: RISK_ACTION.HOLD_PAYOUT },
  DUPLICATE_PHOTO_HASH: { weight: 48, kind: 'FRAUD', label: 'Portfolio or evidence photo matches another account’s image', action: RISK_ACTION.QUARANTINE },
  VERIFICATION_CLAIM_WITHOUT_EVIDENCE: { weight: 32, kind: 'FRAUD', label: 'Claimed a verification badge with no evidence behind it', action: RISK_ACTION.STEP_UP_VERIFICATION },
  PORTFOLIO_MISREPRESENTATION: { weight: 26, kind: 'FRAUD', label: 'Reported work that is not their own or not as described', action: RISK_ACTION.MONITOR },
  NO_SHOW_PATTERN: { weight: 16, kind: 'RELIABILITY', label: 'Repeated no-shows or late arrivals', action: RISK_ACTION.MONITOR },
  DISPUTE_HISTORY: { weight: 24, kind: 'RELIABILITY', label: 'Prior disputes resolved against this actor', action: RISK_ACTION.MONITOR },
  CHARGEBACK_HISTORY: { weight: 28, kind: 'FRAUD', label: 'Prior chargebacks or refunded-for-fraud payments', action: RISK_ACTION.HOLD_PAYOUT },

  /* ---- Physical safety indicators (verification friction only) ---- */
  IN_HOME_VISIT: { weight: 10, kind: 'SAFETY', label: 'Work happens inside the customer’s home', action: RISK_ACTION.STEP_UP_VERIFICATION },
  VULNERABLE_HOUSEHOLD: { weight: 14, kind: 'SAFETY', label: 'Household flagged as elderly, disabled or single-parent', action: RISK_ACTION.STEP_UP_VERIFICATION },
  AFTER_HOURS_VISIT: { weight: 16, kind: 'SAFETY', label: 'Visit scheduled outside 07:00–18:00', action: RISK_ACTION.STEP_UP_VERIFICATION },
  CASH_ON_SITE: { weight: 20, kind: 'SAFETY', label: 'Materials cash will be handled on site', action: RISK_ACTION.STEP_UP_VERIFICATION },
  HIGH_VALUE_ASSET_ACCESS: { weight: 12, kind: 'SAFETY', label: 'Pro will have access to high-value property', action: RISK_ACTION.MONITOR },
  SOLO_VISIT_REMOTE_AREA: { weight: 12, kind: 'SAFETY', label: 'Solo visit to a low-density or remote area', action: RISK_ACTION.MONITOR },
  LOCALITY_SAFETY_CONTEXT: { weight: 8, kind: 'SAFETY', label: 'Locality safety context suggests extra verification steps', action: RISK_ACTION.STEP_UP_VERIFICATION },
  CHILDREN_ON_PREMISES: { weight: 14, kind: 'SAFETY', label: 'Children will be on the premises during the visit', action: RISK_ACTION.STEP_UP_VERIFICATION },
});

const LOCALITY_SAFE_ACTIONS = Object.freeze([
  RISK_ACTION.STEP_UP_VERIFICATION,
  RISK_ACTION.MONITOR,
  RISK_ACTION.ALLOW,
]);

class RiskEngine {
  constructor({ ledger } = {}) {
    this.ledger = ledger;
    this.signals = new Map();   // subjectId -> [signals]
    this.graph = new Map();     // linkKey -> Set(subjectId)
  }

  /**
   * Register an attribute used by the cross-account risk graph
   * (device, phone, bank account, photo perceptual hash, IP).
   */
  link(subjectId, linkType, linkValue) {
    if (!subjectId || !linkType || !linkValue) return;
    const key = `${linkType}:${sha256(String(linkValue)).slice(0, 24)}`;
    const set = this.graph.get(key) || new Set();
    set.add(subjectId);
    this.graph.set(key, set);
  }

  /** Subjects sharing a device / phone / bank account with this one. */
  relatedSubjects(subjectId) {
    const related = new Map();
    for (const [key, subjects] of this.graph.entries()) {
      if (!subjects.has(subjectId)) continue;
      for (const other of subjects) {
        if (other === subjectId) continue;
        const entry = related.get(other) || { subjectId: other, sharedAttributes: [] };
        entry.sharedAttributes.push(key.split(':')[0]);
        related.set(other, entry);
      }
    }
    return [...related.values()].map((r) => ({ ...r, sharedAttributes: [...new Set(r.sharedAttributes)] }));
  }

  /**
   * Locality signals may only ever produce safety-friction actions.
   * This guard makes redlining structurally impossible rather than a policy.
   */
  applyLocalitySignal(subjectId, { suburb, precinct, crimeIndex }, { forPurpose = 'safety' } = {}) {
    if (forPurpose !== 'safety') {
      throw new Error(
        'Locality/crime data may only be used to raise verification friction (forPurpose="safety"). '
        + 'Using it for ranking, pricing or job eligibility is prohibited by the ProVeri fairness policy.',
      );
    }
    if (!crimeIndex || crimeIndex <= 0) return null;
    return this.record(subjectId, {
      type: 'LOCALITY_SAFETY_CONTEXT',
      severity: crimeIndex >= 70 ? 'HIGH' : crimeIndex >= 40 ? 'MEDIUM' : 'LOW',
      source: 'SAPS quarterly station-level crime statistics (published)',
      message: `Extra ID verification and gate-code handshake recommended for visits in ${suburb || 'this area'} (precinct ${precinct || 'n/a'}).`,
      metadata: { suburb, precinct, crimeIndex, usedFor: 'verification-friction-only' },
    });
  }

  record(subjectId, { type, severity = 'MEDIUM', source, message, metadata = {}, observedAt = nowIso() }) {
    const definition = SIGNAL_CATALOGUE[type];
    if (!definition) throw new Error(`unknown risk signal: ${type}`);

    const severityMultiplier = { LOW: 0.5, MEDIUM: 1, HIGH: 1.35, CRITICAL: 1.7 }[severity] ?? 1;
    const record = {
      signalId: nextId('sig'),
      subjectId,
      type,
      kind: definition.kind,
      severity,
      weight: Math.round(definition.weight * severityMultiplier),
      action: definition.action,
      label: definition.label,
      source: source || 'ProVeri detection',
      message: message || definition.label,
      metadata: deepClone(metadata),
      observedAt,
      resolved: false,
    };
    const list = this.signals.get(subjectId) || [];
    list.push(record);
    this.signals.set(subjectId, list);

    if (this.ledger) {
      this.ledger.append({
        action: 'RISK_SIGNAL_RECORDED',
        subject: subjectId,
        level: record.weight >= 40 ? AUDIT_LEVEL.CRITICAL : AUDIT_LEVEL.SAFETY,
        visibility: record.kind === 'SAFETY' ? 'INTERNAL' : 'PUBLIC',
        payload: {
          summary: record.message,
          type,
          kind: record.kind,
          severity,
          weight: record.weight,
          recommendedAction: record.action,
        },
      });
    }
    return deepClone(record);
  }

  resolve(subjectId, signalId, { resolution }) {
    const list = this.signals.get(subjectId) || [];
    const signal = list.find((s) => s.signalId === signalId);
    if (!signal) throw new Error(`signal ${signalId} not found for ${subjectId}`);
    signal.resolved = true;
    signal.resolvedAt = nowIso();
    signal.resolution = resolution || 'Reviewed and closed';
    return deepClone(signal);
  }

  /**
   * Diminishing-returns aggregation: three weak signals matter, but a single
   * 60-weight signal should already be decisive on its own.
   */
  score(subjectId, { kind } = {}) {
    const list = (this.signals.get(subjectId) || []).filter((s) => !s.resolved && (!kind || s.kind === kind));
    const sorted = [...list].sort((a, b) => b.weight - a.weight);
    let total = 0;
    let decay = 1;
    for (const signal of sorted) {
      total += signal.weight * decay;
      decay *= 0.62;
    }
    return clamp(Math.round(total), 0, 100);
  }

  tier(score) {
    if (score >= 80) return RISK_TIER.CRITICAL;
    if (score >= 55) return RISK_TIER.HIGH;
    if (score >= 35) return RISK_TIER.ELEVATED;
    if (score >= 15) return RISK_TIER.LOW;
    return RISK_TIER.MINIMAL;
  }

  /** Full risk position for a subject: scores, tier, actions, open signals. */
  assess(subjectId) {
    const fraudScore = this.score(subjectId, { kind: 'FRAUD' });
    const reliabilityScore = this.score(subjectId, { kind: 'RELIABILITY' });
    const safetyScore = this.score(subjectId, { kind: 'SAFETY' });
    const overall = clamp(Math.max(fraudScore, Math.round((fraudScore + reliabilityScore) / 2) + Math.round(safetyScore * 0.25)), 0, 100);

    const open = (this.signals.get(subjectId) || []).filter((s) => !s.resolved);
    const actions = [...new Set(open.map((s) => s.action))];
    const hardest = actions.includes(RISK_ACTION.REMOVE) ? RISK_ACTION.REMOVE
      : actions.includes(RISK_ACTION.REPORT) ? RISK_ACTION.REPORT
      : actions.includes(RISK_ACTION.FREEZE_ESCROW) ? RISK_ACTION.FREEZE_ESCROW
      : actions.includes(RISK_ACTION.QUARANTINE) ? RISK_ACTION.QUARANTINE
      : actions.includes(RISK_ACTION.HOLD_PAYOUT) ? RISK_ACTION.HOLD_PAYOUT
      : actions.includes(RISK_ACTION.STEP_UP_VERIFICATION) ? RISK_ACTION.STEP_UP_VERIFICATION
      : actions.includes(RISK_ACTION.MONITOR) ? RISK_ACTION.MONITOR
      : RISK_ACTION.ALLOW;

    return {
      subjectId,
      overall,
      fraudScore,
      reliabilityScore,
      safetyScore,
      tier: this.tier(overall),
      recommendedAction: hardest,
      allActions: actions,
      openSignals: deepClone(open),
      resolvedSignals: (this.signals.get(subjectId) || []).filter((s) => s.resolved).length,
      relatedSubjects: this.relatedSubjects(subjectId),
      assessedAt: nowIso(),
    };
  }

  /**
   * Pre-visit safety plan shown to both parties. Concretely reduces the risk of
   * a stranger entering a home — the single biggest blocker to hiring in SA.
   */
  safetyPlan(subjectId, { booking, customer, pro, locality }) {
    const assessment = this.assess(subjectId);
    const steps = [];
    const visit = {
      inHome: booking?.locationType === 'IN_HOME',
      afterHours: Boolean(booking?.scheduledAt && this.#isAfterHours(booking.scheduledAt)),
      children: Boolean(booking?.householdNotes?.childrenOnPremises),
      vulnerable: Boolean(customer?.vulnerableHousehold),
      cashOnSite: (booking?.materialsCashCents || 0) > 0,
    };

    if (visit.inHome || visit.afterHours || visit.children || visit.vulnerable) {
      steps.push({ id: 'GATE_CODE', title: 'One-time gate code', detail: 'The pro shows a 6-digit code at the door. The customer confirms it in-app before letting them in. The code is valid for this visit only.', required: true });
    }
    if (visit.inHome) {
      steps.push({ id: 'ID_SNAPSHOT', title: 'ID snapshot visible to the customer', detail: 'Name, verification badge, photo and trade certificate are shown on the arrival screen.', required: true });
    }
    steps.push({ id: 'CHECK_IN', title: 'Arrival & departure check-in', detail: 'Both parties tap "arrived" and "left". A missed check-in alerts the Lula safety desk.', required: true });
    steps.push({ id: 'IN_APP_ONLY', title: 'Keep it in-app', detail: 'Messages and payments stay inside ProVeri. Anyone asking to move to WhatsApp or cash is breaking the rules — report it in one tap.', required: true });
    if (visit.cashOnSite) {
      steps.push({ id: 'MATERIALS_RECEIPT', title: 'Materials receipt upload', detail: 'Every rand of materials cash must be matched by a till slip photo before escrow releases.', required: true });
    }
    if (locality?.crimeIndex >= 40) {
      steps.push({ id: 'BUDDY_VISIT', title: 'Two-person visit offered', detail: 'Because this area shows elevated reported crime, the customer can request a second verified pro attend at no extra callout cost.', required: false });
    }
    if (assessment.tier === RISK_TIER.HIGH || assessment.tier === RISK_TIER.CRITICAL) {
      steps.push({ id: 'MANUAL_REVIEW', title: 'Lula safety desk review', detail: 'This booking is being reviewed by a human before the visit is confirmed.', required: true });
    }
    return {
      bookingId: booking?.bookingId,
      tier: assessment.tier,
      safetyScore: assessment.safetyScore,
      steps,
      localityUsedFor: 'verification-friction-only',
      pro: pro ? { name: pro.displayName, badge: pro.badge, trustScore: pro.trustScore } : null,
    };
  }

  #isAfterHours(iso) {
    const hour = new Date(iso).getHours();
    return hour < 7 || hour >= 18;
  }

  stats() {
    const all = [...this.signals.values()].flat();
    return {
      totalSignals: all.length,
      openSignals: all.filter((s) => !s.resolved).length,
      byKind: all.reduce((acc, s) => { acc[s.kind] = (acc[s.kind] || 0) + 1; return acc; }, {}),
      byType: all.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {}),
      subjectsTracked: this.signals.size,
      graphLinks: this.graph.size,
    };
  }

  toJSON() {
    return { signals: [...this.signals.entries()], graph: [...this.graph.entries()].map(([k, v]) => [k, [...v]]) };
  }

  static fromJSON(json, { ledger } = {}) {
    const engine = new RiskEngine({ ledger });
    engine.signals = new Map(json.signals || []);
    engine.graph = new Map((json.graph || []).map(([k, v]) => [k, new Set(v)]));
    return engine;
  }
}

module.exports = { RiskEngine, SIGNAL_CATALOGUE, RISK_TIER, RISK_ACTION, LOCALITY_SAFE_ACTIONS };
