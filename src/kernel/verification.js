'use strict';

/**
 * Lula ProVeri — Verification orchestrator.
 *
 * One engine, every vertical. A *profile* declares which checks apply to a
 * subject (a pro, a vehicle listing, a website order). Checks are resolved by
 * adapters in `src/integrations`, weighted into a 0-100 trust score, and turned
 * into a badge the marketplace is allowed to display.
 *
 * Design rule inherited from TrustShield and kept deliberately strict:
 * **no badge without evidence.** A check that has no recorded source, reference
 * or hash can never contribute to a VERIFIED outcome.
 */

const { sha256, nowIso, deepClone, clamp } = require('./util');
const { AUDIT_LEVEL } = require('./audit');

const CHECK_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
  EXPIRED: 'EXPIRED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

const BADGE = Object.freeze({
  UNVERIFIED: 'UNVERIFIED',
  IDENTITY_VERIFIED: 'IDENTITY_VERIFIED',
  TRADE_VERIFIED: 'TRADE_VERIFIED',
  PROVERI_VERIFIED: 'PROVERI_VERIFIED',
  PROVERI_ELITE: 'PROVERI_ELITE',
  RECHECK_REQUIRED: 'RECHECK_REQUIRED',
  SUSPENDED: 'SUSPENDED',
  REMOVED_FOR_RISK: 'REMOVED_FOR_RISK',
  VEHICLE_VERIFIED: 'VEHICLE_VERIFIED',
  VEHICLE_ESCROW_READY: 'VEHICLE_ESCROW_READY',
});

/**
 * Verification profiles.
 *
 * `blocking`  — a FAIL here suspends/removes the subject.
 * `required`  — must be present and non-FAIL for the VERIFIED badge.
 * `weight`    — share of the 100-point trust score.
 * `ttlDays`   — how long the evidence stays trustworthy before auto-expiry.
 */
const PROFILES = Object.freeze({
  servicePro: {
    subject: 'servicePro',
    label: 'Verified service professional',
    checks: [
      {
        name: 'sa_id_document',
        label: 'South African ID verification',
        weight: 20,
        required: true,
        blocking: true,
        ttlDays: null,
        source: 'DHA-format ID validation + document/selfie liveness',
        evidence: ['idNumber', 'idDocumentHash', 'livenessRef'],
      },
      {
        name: 'mobile_and_email_otp',
        label: 'Phone & email one-time PIN',
        weight: 6,
        required: true,
        blocking: true,
        ttlDays: 90,
        source: 'Clickatell SMS OTP + Brevo email OTP',
        evidence: ['mobileOtpRef', 'emailOtpRef'],
      },
      {
        name: 'bank_account_verification',
        label: 'Bank account verified in the pro’s own name',
        weight: 12,
        required: true,
        blocking: true,
        ttlDays: 180,
        source: 'AVS-R real-time bank verification (Datanamix/OmniCheck class)',
        evidence: ['bankCode', 'avsReference'],
      },
      {
        name: 'cipc_business_status',
        label: 'CIPC company / close-corporation status',
        weight: 8,
        required: false,
        blocking: false,
        ttlDays: 365,
        source: 'CIPC enterprise register (direct or authorised reseller API)',
        evidence: ['registrationNumber', 'cipcReference'],
        appliesWhen: (subject) => Boolean(subject.businessRegistrationNumber),
      },
      {
        name: 'sars_tax_compliance',
        label: 'SARS tax compliance status (TCS PIN)',
        weight: 6,
        required: false,
        blocking: false,
        ttlDays: 365,
        source: 'SARS Tax Compliance Status PIN verification',
        evidence: ['taxNumber', 'tcsPin'],
        appliesWhen: (subject) => Boolean(subject.businessRegistrationNumber),
      },
      {
        name: 'saqa_qualification',
        label: 'SAQA / NQF qualification match for the trade',
        weight: 14,
        required: false,
        blocking: false,
        ttlDays: null,
        source: 'SAQA National Qualifications Framework public register',
        evidence: ['saqaId', 'qualificationTitle', 'nqfLevel'],
      },
      {
        name: 'trade_certification',
        label: 'Trade-specific certification (PIRB, ECA, NHBRC, COIDA…)',
        weight: 16,
        required: true,
        blocking: true,
        ttlDays: 365,
        source: 'Issuing body register for the declared trade',
        evidence: ['certificationBody', 'certificateNumber', 'certificateHash'],
      },
      {
        name: 'public_liability_insurance',
        label: 'Public liability insurance',
        weight: 8,
        required: false,
        blocking: false,
        ttlDays: 365,
        source: 'Insurer certificate of currency',
        evidence: ['insurer', 'policyNumber', 'coverCents'],
      },
      {
        name: 'criminal_self_declaration',
        label: 'Criminal & conflict self-declaration',
        weight: 5,
        required: true,
        blocking: true,
        ttlDays: 365,
        source: 'Signed declaration + optional SAPS clearance certificate',
        evidence: ['declarationHash'],
      },
      {
        name: 'platform_history',
        label: 'On-platform delivery history',
        weight: 5,
        required: false,
        blocking: false,
        ttlDays: null,
        source: 'Lula ProVeri completed-job ledger',
        evidence: ['completedJobs', 'disputeRate'],
      },
    ],
    thresholds: { verified: 75, elite: 92 },
  },

  customer: {
    subject: 'customer',
    label: 'Verified customer',
    checks: [
      {
        name: 'email_verification',
        label: 'Email verification',
        weight: 40,
        required: true,
        blocking: true,
        ttlDays: null,
        source: 'Brevo transactional email',
        evidence: ['emailOtpRef'],
      },
      {
        name: 'mobile_verification',
        label: 'Mobile verification',
        weight: 35,
        required: true,
        blocking: true,
        ttlDays: null,
        source: 'Clickatell SMS OTP',
        evidence: ['mobileOtpRef'],
      },
      {
        name: 'payment_instrument',
        label: 'Payment instrument on file',
        weight: 25,
        required: false,
        blocking: false,
        ttlDays: null,
        source: 'Paystack / Stripe / Ozow / PayFast tokenised instrument',
        evidence: ['instrumentRef'],
      },
    ],
    thresholds: { verified: 75, elite: 100 },
  },

  vehicleListing: {
    subject: 'vehicleListing',
    label: 'Verified vehicle listing',
    checks: [
      { name: 'seller_identity_fica', label: 'Seller FICA identity', weight: 18, required: true, blocking: true, ttlDays: 365, source: 'KYC provider', evidence: ['sellerIdRef'] },
      { name: 'vin_engine_registration_match', label: 'VIN / engine / registration consistency', weight: 20, required: true, blocking: true, ttlDays: 90, source: 'TransUnion FirstCheck-class vehicle data', evidence: ['vehicleReportRef'] },
      { name: 'ownership_natis', label: 'NaTIS registered owner / title holder', weight: 18, required: true, blocking: true, ttlDays: 90, source: 'NaTIS-class ownership lookup', evidence: ['natisRef'] },
      { name: 'police_stolen_status', label: 'SAPS stolen-vehicle status', weight: 16, required: true, blocking: true, ttlDays: 30, source: 'SAPS stolen-vehicle indicator', evidence: ['stolenCheckRef'] },
      { name: 'finance_settlement', label: 'Outstanding finance / settlement letter', weight: 14, required: true, blocking: true, ttlDays: 30, source: 'Title-holder settlement letter', evidence: ['settlementLetterHash'] },
      { name: 'independent_condition_report', label: 'Independent condition & roadworthy report', weight: 14, required: true, blocking: true, ttlDays: 60, source: 'DEKRA-class inspection partner', evidence: ['inspectionReportHash'] },
    ],
    thresholds: { verified: 90, elite: 98 },
  },
});

/**
 * Trades whose certification check is *legally* meaningful in South Africa.
 * Used by the intake wizard and by the policy engine to refuse a VERIFIED
 * badge when a regulated trade has no certificate.
 */
const TRADE_REGULATORS = Object.freeze({
  electrician: {
    body: 'Department of Employment and Labour / ECA & PIRB registers',
    requirement: 'Wireman’s licence + Certificate of Compliance (SANS 10142-1) for every installation',
    severity: 'STATUTORY',
  },
  plumber: {
    body: 'PIRB (Plumbing Industry Registration Board) / WSB',
    requirement: 'PIRB-registered plumber; CoC for new or altered installations',
    severity: 'STATUTORY',
  },
  gasInstaller: {
    body: 'SAQCC Gas',
    requirement: 'SAQCC-registered installer; gas Certificate of Compliance',
    severity: 'STATUTORY',
  },
  builder: {
    body: 'NHBRC (National Home Builders Registration Council)',
    requirement: 'NHBRC enrolment for home building; 5-year structural warranty',
    severity: 'STATUTORY',
  },
  electricFenceInstaller: {
    body: 'Department of Employment and Labour',
    requirement: 'Electric fence installer registration + Electric Fence System CoC',
    severity: 'STATUTORY',
  },
  securityInstaller: {
    body: 'PSIRA (Private Security Industry Regulatory Authority)',
    requirement: 'PSIRA registration for security officers and companies',
    severity: 'STATUTORY',
  },
  debtCollector: {
    body: 'Council for Debt Collectors',
    requirement: 'Registered debt collector',
    severity: 'STATUTORY',
  },
  estateAgent: {
    body: 'PPRA (Property Practitioners Regulatory Authority)',
    requirement: 'PPRA status + valid Fidelity Fund Certificate',
    severity: 'STATUTORY',
  },
  driver: {
    body: 'Department of Transport',
    requirement: 'Valid driving licence + PDP for passenger/goods transport',
    severity: 'STATUTORY',
  },
  healthPractitioner: {
    body: 'HPCSA / SAHPRA',
    requirement: 'Professional registration in good standing',
    severity: 'STATUTORY',
  },
  accountant: {
    body: 'SAICA / SAIPA / CIMA',
    requirement: 'Professional body membership',
    severity: 'PROFESSIONAL',
  },
  chef: { body: 'None (self-regulated)', requirement: 'Food handler certificate recommended', severity: 'RECOMMENDED' },
  cleaner: { body: 'None (self-regulated)', requirement: 'Police clearance recommended for in-home work', severity: 'RECOMMENDED' },
  gardener: { body: 'None (self-regulated)', requirement: 'Reference checks recommended', severity: 'RECOMMENDED' },
  painter: { body: 'None (self-regulated)', requirement: 'Reference checks recommended', severity: 'RECOMMENDED' },
  handyman: { body: 'None below statutory thresholds', requirement: 'No electrical/plumbing CoC work without a registered trade', severity: 'RECOMMENDED' },
  mover: { body: 'None (self-regulated)', requirement: 'Goods-in-transit insurance recommended', severity: 'RECOMMENDED' },
});

class VerificationEngine {
  constructor({ ledger, profiles = PROFILES } = {}) {
    this.profiles = profiles;
    this.ledger = ledger;
  }

  profile(profileName) {
    const profile = this.profiles[profileName];
    if (!profile) throw new Error(`unknown verification profile: ${profileName}`);
    return profile;
  }

  /** Checks that apply to this subject, given its declared attributes. */
  applicableChecks(profileName, subject) {
    return this.profile(profileName).checks.filter((check) => {
      if (typeof check.appliesWhen !== 'function') return true;
      try {
        return check.appliesWhen(subject) !== false;
      } catch {
        return false;
      }
    });
  }

  /** Fresh state for a subject that has not been verified yet. */
  initState(profileName, subject) {
    const applicable = this.applicableChecks(profileName, subject);
    return {
      profile: profileName,
      status: 'PENDING',
      score: 0,
      badge: BADGE.UNVERIFIED,
      checks: applicable.map((check) => ({
        name: check.name,
        label: check.label,
        status: CHECK_STATUS.PENDING,
        weight: check.weight,
        required: check.required,
        blocking: check.blocking,
        source: check.source,
        ttlDays: check.ttlDays ?? null,
        evidenceKeys: check.evidence,
        missingEvidence: [...(check.evidence || [])],
        score: 0,
        finding: null,
        reference: null,
        evidenceHash: null,
        checkedAt: null,
        expiresAt: check.ttlDays ? null : null,
      })),
      missingChecks: applicable.filter((c) => c.required).map((c) => c.name),
      lastRecalculatedAt: null,
    };
  }

  /**
   * Record the outcome of a single check.
   * Returns the recalculated verification state plus any blocking incident.
   */
  recordCheck(state, subject, check) {
    if (!check || !check.name) throw new Error('check.name is required');
    const status = check.status || CHECK_STATUS.PASS;
    if (!Object.values(CHECK_STATUS).includes(status)) throw new Error(`invalid check status: ${status}`);

    const target = state.checks.find((c) => c.name === check.name);
    if (!target) {
      // Checks outside the profile are still recorded — they may be category-specific.
      state.checks.push({
        name: check.name,
        label: check.label || check.name,
        status,
        weight: typeof check.weight === 'number' ? check.weight : 0,
        required: Boolean(check.required),
        blocking: Boolean(check.blocking),
        source: check.source || 'unspecified',
        ttlDays: check.ttlDays ?? null,
        evidenceKeys: [],
        missingEvidence: [],
        score: 0,
        finding: check.finding || null,
        reference: check.reference || null,
        evidenceHash: check.evidence ? sha256(check.evidence) : null,
        checkedAt: check.checkedAt || nowIso(),
        expiresAt: check.ttlDays ? new Date(Date.now() + check.ttlDays * 86_400_000).toISOString() : null,
      });
    } else {
      target.status = status;
      target.source = check.source || target.source;
      target.finding = check.finding || null;
      target.reference = check.reference || null;
      target.evidenceHash = check.evidence ? sha256(check.evidence) : check.evidenceHash;
      target.checkedAt = check.checkedAt || nowIso();
      // A submitted check may refresh or shorten the validity window.
      if (check.ttlDays !== undefined) target.ttlDays = check.ttlDays;
      target.expiresAt = target.ttlDays == null
        ? null
        : new Date(Date.now() + Math.max(0, target.ttlDays) * 86_400_000).toISOString();
      // Evidence completeness MUST be resolved before scoring: the score cap for
      // "PASS without full evidence" reads this field, so computing it afterwards
      // penalises every first submission against a stale full-key list.
      const supplied = Object.keys(check.evidence || {});
      target.missingEvidence = (target.evidenceKeys || []).filter((key) => !supplied.includes(key));
      target.score = this.#scoreForCheck(target, status, subject);
    }

    return this.recalculate(state, subject);
  }

  #scoreForCheck(check, status, subject) {
    const base = status === CHECK_STATUS.PASS ? 100
      : status === CHECK_STATUS.WARN ? 55
      : status === CHECK_STATUS.NOT_APPLICABLE ? 100
      : status === CHECK_STATUS.UNAVAILABLE ? 40
      : status === CHECK_STATUS.EXPIRED ? 30
      : 0;

    // A required statutory certification with no certificate number cannot score full marks,
    // even if a human marked it PASS. This is the "no badge without evidence" rule.
    // `statutoryTrade` is decided per CATEGORY, not per generic trade: repairing a
    // roof is not NHBRC-enrolled home building, even though both map to "builder".
    const trade = subject?.primaryTrade || subject?.trade;
    const regulator = trade ? TRADE_REGULATORS[trade] : null;
    const isStatutory = subject?.statutoryTrade === true || (subject?.statutoryTrade !== false && regulator?.severity === 'STATUTORY');
    if (check.name === 'trade_certification' && isStatutory) {
      const hasCertificate = Boolean(check.reference) || Boolean(check.evidenceHash);
      if (!hasCertificate) return Math.min(base, 35);
    }
    if (check.missingEvidence?.length && status === CHECK_STATUS.PASS) {
      return Math.min(base, 80);
    }
    return base;
  }

  /** Recompute score, status, badge and missing-check list. */
  recalculate(state, subject = {}) {
    const byName = new Map(state.checks.map((c) => [c.name, c]));
    this.#expireStaleChecks(state);

    const requiredNames = state.checks.filter((c) => c.required).map((c) => c.name);
    const missing = requiredNames.filter((name) => {
      const check = byName.get(name);
      return !check || [CHECK_STATUS.PENDING, CHECK_STATUS.FAIL, CHECK_STATUS.EXPIRED].includes(check.status);
    });

    const scored = state.checks.filter((c) => c.status !== CHECK_STATUS.PENDING);
    const weightTotal = state.checks.reduce((sum, c) => sum + (c.weight || 0), 0) || 1;
    const weighted = state.checks.reduce((sum, c) => sum + (c.weight || 0) * (c.score || 0), 0);
    const score = Math.round(weighted / weightTotal);

    const failed = state.checks.filter((c) => c.status === CHECK_STATUS.FAIL);
    const blockingFailed = failed.filter((c) => c.blocking);
    const warned = state.checks.filter((c) => c.status === CHECK_STATUS.WARN);

    const profile = this.profiles[state.profile];
    const thresholds = profile?.thresholds || { verified: 75, elite: 92 };

    let status = 'IN_PROGRESS';
    let badge = BADGE.UNVERIFIED;

    if (blockingFailed.length > 0) {
      status = 'FAILED';
      badge = BADGE.REMOVED_FOR_RISK;
    } else if (failed.length > 0) {
      status = 'RECHECK_REQUIRED';
      badge = BADGE.RECHECK_REQUIRED;
    } else if (missing.length > 0) {
      status = 'IN_PROGRESS';
      badge = scored.length > 0 ? BADGE.IDENTITY_VERIFIED : BADGE.UNVERIFIED;
    } else if (score >= thresholds.elite && warned.length === 0) {
      status = 'ELITE';
      badge = state.profile === 'vehicleListing' ? BADGE.VEHICLE_ESCROW_READY : BADGE.PROVERI_ELITE;
    } else if (score >= thresholds.verified) {
      status = 'VERIFIED';
      badge = state.profile === 'vehicleListing'
        ? BADGE.VEHICLE_VERIFIED
        : (TRADE_REGULATORS[subject.primaryTrade]?.severity === 'STATUTORY' ? BADGE.TRADE_VERIFIED : BADGE.PROVERI_VERIFIED);
    } else {
      status = 'RECHECK_REQUIRED';
      badge = BADGE.RECHECK_REQUIRED;
    }

    state.score = clamp(score, 0, 100);
    state.status = status;
    state.badge = badge;
    state.missingChecks = missing;
    state.failedChecks = failed.map((c) => c.name);
    state.warnings = warned.map((c) => c.name);
    state.lastRecalculatedAt = nowIso();

    if (this.ledger) {
      this.ledger.append({
        action: 'VERIFICATION_RECALCULATED',
        subject: subject.subjectId || subject.id || 'unknown',
        level: AUDIT_LEVEL.TRUST,
        visibility: 'PUBLIC',
        payload: {
          summary: `Trust score ${state.score}/100 · ${status}`,
          profile: state.profile,
          score: state.score,
          status,
          badge,
          missingChecks: missing,
          failedChecks: state.failedChecks,
        },
      });
    }
    return deepClone(state);
  }

  #expireStaleChecks(state) {
    const now = Date.now();
    for (const check of state.checks) {
      if (check.expiresAt && new Date(check.expiresAt).getTime() <= now && check.status === CHECK_STATUS.PASS) {
        check.status = CHECK_STATUS.EXPIRED;
        check.finding = check.finding || 'Evidence passed its validity window and must be refreshed.';
        check.score = this.#scoreForCheck(check, CHECK_STATUS.EXPIRED, {});
      }
    }
  }

  /** Human-readable summary for the PWA trust card. */
  explain(state, subject = {}) {
    const reasons = [];
    for (const check of state.checks) {
      if (check.status === CHECK_STATUS.PENDING && check.required) {
        reasons.push({ icon: '⏳', text: `${check.label} — still outstanding`, tone: 'pending' });
      } else if (check.status === CHECK_STATUS.FAIL) {
        reasons.push({ icon: '⛔', text: `${check.label} — failed`, tone: 'fail' });
      } else if (check.status === CHECK_STATUS.WARN) {
        reasons.push({ icon: '⚠️', text: `${check.label} — ${check.finding || 'needs attention'}`, tone: 'warn' });
      } else if (check.status === CHECK_STATUS.EXPIRED) {
        reasons.push({ icon: '🕒', text: `${check.label} — expired, refresh required`, tone: 'warn' });
      } else if (check.status === CHECK_STATUS.PASS) {
        reasons.push({ icon: '✅', text: `${check.label} — verified via ${check.source}`, tone: 'pass' });
      }
    }
    const trade = TRADE_REGULATORS[subject.primaryTrade];
    return {
      badge: state.badge,
      score: state.score,
      status: state.status,
      reasons,
      statutoryNote: trade
        ? `${trade.body}: ${trade.requirement}`
        : 'No statutory trade certification applies to this category.',
    };
  }
}

module.exports = { VerificationEngine, PROFILES, CHECK_STATUS, BADGE, TRADE_REGULATORS };
