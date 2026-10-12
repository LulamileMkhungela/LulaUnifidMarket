'use strict';

/**
 * Lula ProVeri — Trust Kernel.
 *
 * One kernel, many verticals. A vertical is a small plugin that declares:
 *   - which verification profile applies
 *   - which fields are critical (tamper = removal)
 *   - which fields lock once a deal starts
 *   - which evidence types are required before money moves
 *   - which escrow partner to default to
 *
 * Everything else — the hash-chained ledger, the trust score, the risk graph,
 * the policy rules, the escrow state machine — is shared. That is the merge:
 * the TrustShield vehicle engine and the ServicePro-style services marketplace
 * run on exactly the same rails, so a pre-purchase vehicle inspection booked
 * as a *service* writes straight into the *vehicle* listing’s trust chain.
 */

const { AuditLedger, AUDIT_LEVEL } = require('./audit');
const { VerificationEngine, PROFILES, CHECK_STATUS, BADGE, TRADE_REGULATORS } = require('./verification');
const { EscrowEngine, ESCROW_STATUS, MILESTONE_STATUS, PROVIDERS } = require('./escrow');
const { RiskEngine, SIGNAL_CATALOGUE, RISK_TIER, RISK_ACTION } = require('./risk');
const { PolicyEngine, POLICY_RULES, POLICY_EFFECT } = require('./policy');
const { sha256, deepClone, nowIso, fingerprint, nextId } = require('./util');

const VERTICAL_STATUS = Object.freeze({
  LIVE: 'LIVE',
  BETA: 'BETA',
  COMING_SOON: 'COMING_SOON',
});

class TrustKernel {
  /**
   * @param {object} [options]
   * @param {object} [options.fees] platform fee configuration
   * @param {object} [options.verticals] map of verticalId -> vertical plugin
   */
  constructor({ fees, verticals = {} } = {}) {
    this.ledger = new AuditLedger({ scope: 'lula-proveri' });
    this.verification = new VerificationEngine({ ledger: this.ledger, profiles: PROFILES });
    this.escrow = new EscrowEngine({ ledger: this.ledger, fees });
    this.risk = new RiskEngine({ ledger: this.ledger });
    this.policy = new PolicyEngine({ ledger: this.ledger, rules: POLICY_RULES });

    this.verticals = new Map();
    for (const [id, plugin] of Object.entries(verticals)) this.registerVertical(id, plugin);

    this.ledger.append({
      action: 'KERNEL_INITIALISED',
      subject: 'platform',
      level: AUDIT_LEVEL.INFO,
      visibility: 'PUBLIC',
      payload: {
        summary: 'ProVeri Trust Kernel online',
        verticals: [...this.verticals.keys()],
        policies: POLICY_RULES.length,
        signals: Object.keys(SIGNAL_CATALOGUE).length,
        escrowPartners: Object.keys(PROVIDERS).length,
      },
    });
  }

  /* ---------------- verticals ---------------- */

  registerVertical(id, plugin) {
    const vertical = {
      id,
      label: plugin.label || id,
      description: plugin.description || '',
      status: plugin.status || VERTICAL_STATUS.LIVE,
      verificationProfile: plugin.verificationProfile,
      criticalFields: plugin.criticalFields || [],
      lockedFields: plugin.lockedFields || [],
      requiredEvidence: plugin.requiredEvidence || [],
      defaultEscrowProvider: plugin.defaultEscrowProvider || 'paystack',
      defaultFeePercent: plugin.defaultFeePercent ?? 10,
      comingSoon: plugin.status === VERTICAL_STATUS.COMING_SOON,
      waitlist: [],
      plugin,
    };
    this.verticals.set(id, vertical);
    this.ledger.append({
      action: 'VERTICAL_REGISTERED',
      subject: `vertical:${id}`,
      visibility: 'PUBLIC',
      payload: { summary: `${vertical.label} vertical registered (${vertical.status})`, status: vertical.status },
    });
    return deepClone({ ...vertical, plugin: undefined });
  }

  vertical(id) {
    const vertical = this.verticals.get(id);
    if (!vertical) throw new Error(`unknown vertical: ${id}`);
    return vertical;
  }

  listVerticals() {
    return [...this.verticals.values()].map((v) => ({
      id: v.id,
      label: v.label,
      description: v.description,
      status: v.status,
      comingSoon: v.comingSoon,
      waitlistCount: v.waitlist.length,
      defaultFeePercent: v.defaultFeePercent,
      defaultEscrowProvider: v.defaultEscrowProvider,
      requiredEvidence: v.requiredEvidence,
    }));
  }

  joinWaitlist(verticalId, { name, email, mobile, note } = {}) {
    const vertical = this.vertical(verticalId);
    if (!vertical.comingSoon) throw new Error(`${verticalId} is already live — no waitlist needed`);
    const entry = { entryId: nextId('usr'), name, email, mobile, note, joinedAt: nowIso() };
    vertical.waitlist.push(entry);
    this.ledger.append({
      action: 'WAITLIST_JOINED',
      subject: `vertical:${verticalId}`,
      visibility: 'PUBLIC',
      payload: { summary: `${name || 'Someone'} joined the ${vertical.label} waitlist`, count: vertical.waitlist.length },
    });
    return { joined: true, position: vertical.waitlist.length, verticalId };
  }

  /* ---------------- verification ---------------- */

  /** Create a verification state for a subject and record its first checks. */
  startVerification(profileName, subject) {
    const state = this.verification.initState(profileName, subject);
    this.ledger.append({
      action: 'VERIFICATION_STARTED',
      subject: subject.subjectId || subject.id,
      level: AUDIT_LEVEL.TRUST,
      visibility: 'PUBLIC',
      payload: {
        summary: `Verification started (${profileName}) — ${state.checks.filter((c) => c.required).length} required checks`,
        profile: profileName,
        requiredChecks: state.checks.filter((c) => c.required).map((c) => c.name),
      },
    });
    return state;
  }

  recordCheck(subjectId, state, subject, check) {
    const updated = this.verification.recordCheck(state, subject, check);
    this.ledger.append({
      action: 'VERIFICATION_CHECK_RECORDED',
      subject: subjectId,
      level: check.status === CHECK_STATUS.FAIL ? AUDIT_LEVEL.CRITICAL : AUDIT_LEVEL.TRUST,
      visibility: 'PUBLIC',
      payload: {
        summary: `${check.name}: ${check.status}${check.finding ? ` — ${check.finding}` : ''}`,
        check: check.name,
        status: check.status,
        source: check.source || null,
        reference: check.reference || null,
        evidenceSeal: check.evidence ? sha256(check.evidence).slice(0, 12) : null,
        score: updated.score,
        badge: updated.badge,
      },
    });
    return updated;
  }

  trustBadgeFor(subjectId, state) {
    const assessment = this.risk.assess(subjectId);
    if (assessment.tier === RISK_TIER.CRITICAL) return BADGE.SUSPENDED;
    return state.badge;
  }

  /* ---------------- tamper detection ---------------- */

  /**
   * Detect critical-field tampering on any vertical entity.
   * Mirrors the TrustShield rule: change a verified identifier → remove.
   */
  detectTamper(verticalId, { before, patch, verified = true }) {
    const vertical = this.vertical(verticalId);
    const { flattenPatch, getPath } = require('./util');
    const changes = flattenPatch(patch);
    const criticalTouched = changes
      .filter(([path, value]) => vertical.criticalFields.includes(path) && getPath(before, path) !== value)
      .map(([path]) => path);
    const lockedTouched = changes
      .filter(([path, value]) => vertical.lockedFields.includes(path) && getPath(before, path) !== value)
      .map(([path]) => path);

    return {
      tampered: criticalTouched.length > 0,
      lockedViolation: lockedTouched.length > 0,
      criticalFieldsChanged: criticalTouched,
      lockedFieldsChanged: lockedTouched,
      beforeHash: sha256(before),
      afterHash: sha256({ ...before, ...patch }),
      seal: fingerprint({ before, patch }, 10),
    };
  }

  /* ---------------- cross-vertical bridge ---------------- */

  /**
   * THE MERGE. A service job can produce evidence that another vertical
   * consumes. Booking a pre-purchase inspection (services) stamps the vehicle
   * listing (vehicles); servicing a bought car writes to its Service Passport.
   *
   * @returns {object} the receipt written into the target vertical's chain
   */
  bridgeEvidence({ fromVertical, fromEntityId, toVertical, toEntityId, evidenceType, summary, payload = {}, actorId }) {
    const source = this.vertical(fromVertical);
    const target = this.vertical(toVertical);
    if (target.comingSoon) {
      throw new Error(`${target.label} is coming soon — evidence cannot be bridged into it yet`);
    }
    const receipt = {
      bridgeId: nextId('evd'),
      fromVertical: source.id,
      fromEntityId,
      toVertical: target.id,
      toEntityId,
      evidenceType,
      summary,
      payload: deepClone(payload),
      actorId,
      seal: sha256({ fromVertical, fromEntityId, toVertical, toEntityId, evidenceType, payload }),
      bridgedAt: nowIso(),
    };
    this.ledger.append({
      action: 'CROSS_VERTICAL_EVIDENCE_BRIDGE',
      subject: toEntityId,
      level: AUDIT_LEVEL.TRUST,
      visibility: 'PUBLIC',
      payload: {
        summary: `${source.label} evidence written into ${target.label}: ${summary}`,
        bridgeId: receipt.bridgeId,
        fromEntityId,
        evidenceType,
        seal: receipt.seal.slice(0, 16),
      },
    });
    this.ledger.append({
      action: 'CROSS_VERTICAL_EVIDENCE_BRIDGE',
      subject: fromEntityId,
      level: AUDIT_LEVEL.TRUST,
      visibility: 'PUBLIC',
      payload: { summary: `Evidence exported to ${target.label} (${toEntityId})`, bridgeId: receipt.bridgeId },
    });
    return deepClone(receipt);
  }

  /* ---------------- platform telemetry ---------------- */

  integrityReceipt() {
    return {
      ledger: this.ledger.integrityReceipt(),
      policy: this.policy.stats(),
      risk: this.risk.stats(),
      escrow: this.escrow.portfolioStats(),
      verticals: this.listVerticals(),
      generatedAt: nowIso(),
    };
  }

  /** Public trust page: what the platform did, provably. */
  transparencyReport({ since } = {}) {
    const all = this.ledger.query({ limit: 100_000 });
    const rows = since ? all.filter((e) => e.createdAt >= since) : all;
    const count = (action) => rows.filter((e) => e.action === action).length;
    return {
      period: { since: since || 'inception', until: nowIso() },
      ledgerEntries: rows.length,
      chainValid: this.ledger.verifyChain().valid,
      verifications: {
        started: count('VERIFICATION_STARTED'),
        checksRecorded: count('VERIFICATION_CHECK_RECORDED'),
        passed: rows.filter((e) => e.action === 'VERIFICATION_CHECK_RECORDED' && e.payload.status === 'PASS').length,
        failed: rows.filter((e) => e.action === 'VERIFICATION_CHECK_RECORDED' && e.payload.status === 'FAIL').length,
      },
      escrow: this.escrow.portfolioStats(),
      policy: this.policy.stats(),
      riskSignals: this.risk.stats(),
      crossVerticalBridges: count('CROSS_VERTICAL_EVIDENCE_BRIDGE'),
      disputes: count('DISPUTE_OPENED'),
      publishedReceipt: this.ledger.integrityReceipt().receipt,
    };
  }

  toJSON() {
    return {
      ledger: this.ledger.toJSON(),
      escrow: this.escrow.toJSON(),
      risk: this.risk.toJSON(),
      verticals: [...this.verticals.entries()].map(([id, v]) => [id, { ...v, plugin: undefined }]),
    };
  }
}

module.exports = {
  TrustKernel,
  AuditLedger,
  VerificationEngine,
  EscrowEngine,
  RiskEngine,
  PolicyEngine,
  PROFILES,
  CHECK_STATUS,
  BADGE,
  TRADE_REGULATORS,
  ESCROW_STATUS,
  MILESTONE_STATUS,
  PROVIDERS,
  SIGNAL_CATALOGUE,
  RISK_TIER,
  RISK_ACTION,
  POLICY_RULES,
  POLICY_EFFECT,
  AUDIT_LEVEL,
  VERTICAL_STATUS,
};
