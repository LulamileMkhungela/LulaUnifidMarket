'use strict';

/**
 * ProVeri — Escrow orchestrator.
 *
 * Lula never holds client money. Every escrow instance is a *shadow* of a real
 * account at a regulated partner (TradeSafe — PASA-authorised third-party
 * payment provider, backed by Standard Bank; or Paystack/Stripe marketplace
 * splits). This module owns the state machine, milestone maths, the workmanship
 * holdback, auto-release timers and refund/dispute freezing, and reconciles
 * partner callbacks against it.
 *
 * Money flow (matches the ServicePro promise, then improves on it):
 *   customer pays 100% up front on bid acceptance
 *   -> funds held by partner
 *   -> pro completes milestone, uploads geotagged proof
 *   -> customer confirms (or the confirmation window lapses)
 *   -> partner releases: pro payout, platform fee, warranty holdback
 *   -> holdback releases after the warranty window with no open dispute
 */

const { sha256, nextId, nowIso, addMinutes, addDays, deepClone, assertCents, splitAmount, percentageOf, clamp } = require('./util');
const { AUDIT_LEVEL } = require('./audit');

const ESCROW_STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  FUNDED: 'FUNDED',
  PARTIALLY_RELEASED: 'PARTIALLY_RELEASED',
  FROZEN: 'FROZEN',
  READY_FOR_RELEASE: 'READY_FOR_RELEASE',
  RELEASED: 'RELEASED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  CANCELLED: 'CANCELLED',
});

const MILESTONE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  EVIDENCE_SUBMITTED: 'EVIDENCE_SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  RELEASED: 'RELEASED',
  DISPUTED: 'DISPUTED',
});

/** Supported escrow partners and the public integration each uses. */
const PROVIDERS = Object.freeze({
  tradesafe: {
    id: 'tradesafe',
    name: 'TradeSafe',
    kind: 'ESCROW_PAYMASTER',
    regulator: 'PASA-authorised third-party payment provider',
    api: 'GraphQL API (https://www.tradesafe.co.za) — playground + API docs available to merchants',
    paymentMethods: ['EFT', 'Instant EFT (Callpay EFTSecure)', 'Ozow', 'Card', 'SnapScan', 'PayJustNow BNPL'],
    structures: ['split payments', 'milestone payments', 'lay-by', 'seller drawdown'],
    feeModel: 'From 1.5% of trade value; API flat 1.5% per transaction; R100 minimum on non-API',
    recommendedFor: 'Jobs above R5,000, vehicle purchases, milestone builds',
  },
  paystack: {
    id: 'paystack',
    name: 'Paystack',
    kind: 'PSP_WITH_SPLIT',
    regulator: 'FSP-licensed payment provider (Nigerian/SA operations)',
    api: 'REST — /transaction/initialize, /transaction/split, /transfer, /transferrecipient, webhooks',
    paymentMethods: ['Card', 'Instant EFT', 'Ozow', 'Bank transfer', 'USSD', 'Mobile money'],
    structures: ['split payments at checkout', 'transfers to recipients'],
    feeModel: '1.5% + R5 local cards (capped R250); 3.9% international',
    recommendedFor: 'Standard jobs, instant payouts, international remittance funding',
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    kind: 'PSP_WITH_CONNECT',
    regulator: 'FSP-registered; Connect payout platform',
    api: 'REST — PaymentIntents, Connect accounts & transfers, webhooks',
    paymentMethods: ['Card', 'Apple Pay', 'Google Pay', 'EFT (ZA)', 'Link'],
    structures: ['Connect destination charges', 'manual capture (escrow-like hold)'],
    feeModel: '3.4% + R5.00 per successful card charge',
    recommendedFor: 'Cross-border customers and diaspora-funded jobs',
  },
  payfast: {
    id: 'payfast',
    name: 'PayFast',
    kind: 'PSP',
    regulator: 'PASA / FSP registered',
    api: 'REST + ITN (Instant Transaction Notification) callbacks',
    paymentMethods: ['Card', 'Instant EFT', 'Ozow', 'SnapScan', 'Zapper', 'Masterpass', 'Mobicred', 'PayJustNow', 'SCode'],
    structures: ['single payment', 'subscriptions'],
    feeModel: '3.5% + R2.00 per transaction',
    recommendedFor: 'Web Studio storefront checkouts',
  },
  ozow: {
    id: 'ozow',
    name: 'Ozow',
    kind: 'INSTANT_EFT',
    regulator: 'PASA member, National Payments System participant',
    api: 'REST — /transactionrequest, automated notification callback',
    paymentMethods: ['Instant EFT from all major SA banks', 'Ozow Pay (cardless)'],
    structures: ['single payment', 'split-capable via partner'],
    feeModel: 'Typically R3–R15 per transaction depending on value band',
    recommendedFor: 'Low-friction ZAR instant EFT funding of escrow',
  },
  yoco: {
    id: 'yoco',
    name: 'Yoco',
    kind: 'PSP_POS',
    regulator: 'PASA member',
    api: 'REST + SDK; online checkout and in-person card devices',
    paymentMethods: ['Card (tap/dip/swipe)', 'Yoco online checkout', 'SnapScan', 'Zapper'],
    structures: ['single payment', 'tips'],
    feeModel: '2.95% + R0.50 (from 3.25% on entry pricing)',
    recommendedFor: 'On-site card payments at handover, Web Studio packages',
  },
  bankTrustAccount: {
    id: 'bankTrustAccount',
    name: 'Attorney / conveyancer trust account',
    kind: 'TRUST_ACCOUNT',
    regulator: 'Legal Practice Council trust account',
    api: 'Manual + bank statement reconciliation',
    paymentMethods: ['EFT into trust account'],
    structures: ['deposit held pending transfer'],
    feeModel: 'Attorney tariff',
    recommendedFor: 'Property deposits (vertical: coming soon)',
  },
});

class EscrowEngine {
  /**
   * @param {object} options
   * @param {import('./audit').AuditLedger} options.ledger
   * @param {object} options.fees  { platformFeePercent, warrantyHoldbackPercent, confirmationWindowMinutes, warrantyDays }
   */
  constructor({ ledger, fees = {} } = {}) {
    this.ledger = ledger;
    this.fees = {
      platformFeePercent: fees.platformFeePercent ?? 10,
      warrantyHoldbackPercent: fees.warrantyHoldbackPercent ?? 5,
      confirmationWindowMinutes: fees.confirmationWindowMinutes ?? 48 * 60,
      warrantyDays: fees.warrantyDays ?? 14,
      paymentWindowMinutes: fees.paymentWindowMinutes ?? 120,
      ...fees,
    };
    this.instances = new Map();
  }

  /**
   * Open an escrow shadow record for a booking.
   * Milestones default to a single completion milestone; callers can split.
   */
  open({
    bookingId,
    customerId,
    providerId,
    amountCents,
    currency = 'ZAR',
    provider = 'paystack',
    milestones = null,
    warrantyDays,
    confirmationWindowMinutes,
    purpose = 'service job',
  }) {
    if (!bookingId) throw new Error('bookingId is required');
    assertCents(amountCents, 'amountCents');
    if (amountCents <= 0) throw new Error('amountCents must be greater than zero');
    const partner = PROVIDERS[provider];
    if (!partner) throw new Error(`unknown escrow provider: ${provider}`);

    const windowMinutes = confirmationWindowMinutes ?? this.fees.confirmationWindowMinutes;
    const warranty = warrantyDays ?? this.fees.warrantyDays;

    const plan = this.#planMilestones(amountCents, milestones);
    const escrow = {
      escrowId: nextId('esc'),
      bookingId,
      customerId,
      providerId,
      purpose,
      provider,
      providerLabel: partner.name,
      providerKind: partner.kind,
      currency,
      amountCents,
      status: ESCROW_STATUS.AWAITING_PAYMENT,
      plan,
      fees: {
        platformFeePercent: this.fees.platformFeePercent,
        platformFeeCents: percentageOf(amountCents, this.fees.platformFeePercent),
        warrantyHoldbackPercent: this.fees.warrantyHoldbackPercent,
        warrantyHoldbackCents: percentageOf(amountCents, this.fees.warrantyHoldbackPercent),
        partnerFeeEstimateCents: this.#estimatePartnerFee(provider, amountCents),
      },
      funded: {
        amountCents: 0,
        reference: null,
        method: null,
        fundedAt: null,
        expiresAt: null,
      },
      releases: [],
      refunds: [],
      freezes: [],
      confirmationWindowMinutes: windowMinutes,
      warrantyDays: warranty,
      autoReleaseAt: null,
      holdbackReleaseAt: null,
      partnerEvents: [],
      integrity: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    escrow.integrity = sha256(escrow);
    this.instances.set(escrow.escrowId, escrow);

    this.#log(escrow, 'ESCROW_OPENED', {
      summary: `Escrow opened with ${partner.name} for R${(amountCents / 100).toFixed(2)}`,
      amountCents,
      provider,
      milestones: plan.milestones.length,
      paymentDueBy: addMinutes(nowIso(), this.fees.paymentWindowMinutes),
    }, AUDIT_LEVEL.MONEY);

    return deepClone(escrow);
  }

  #planMilestones(amountCents, milestones) {
    const specs = Array.isArray(milestones) && milestones.length > 0
      ? milestones
      : [{ label: 'Job complete & accepted', weight: 100 }];

    const weights = specs.map((s) => s.weight ?? 1);
    const parts = splitAmount(amountCents, weights);
    return {
      strategy: specs.length > 1 ? 'MILESTONE' : 'SINGLE_RELEASE',
      milestones: specs.map((spec, index) => ({
        milestoneId: nextId('mst'),
        seq: index + 1,
        label: spec.label || `Milestone ${index + 1}`,
        weight: weights[index],
        amountCents: parts[index],
        status: MILESTONE_STATUS.PENDING,
        requiredEvidence: spec.requiredEvidence || ['AFTER_PHOTO', 'PRO_SIGNATURE'],
        evidence: [],
        submittedAt: null,
        acceptedAt: null,
        releasedAt: null,
        releaseReference: null,
      })),
    };
  }

  #estimatePartnerFee(provider, amountCents) {
    switch (provider) {
      case 'tradesafe': return Math.max(10_000, percentageOf(amountCents, 1.5));
      case 'paystack': return Math.min(25_000, percentageOf(amountCents, 1.5) + 500);
      case 'stripe': return percentageOf(amountCents, 3.4) + 500;
      case 'payfast': return percentageOf(amountCents, 3.5) + 200;
      case 'ozow': return clamp(Math.round(amountCents * 0.0015), 300, 1_500);
      case 'yoco': return percentageOf(amountCents, 2.95) + 50;
      default: return 0;
    }
  }

  #log(escrow, action, payload, level = AUDIT_LEVEL.MONEY) {
    escrow.updatedAt = nowIso();
    escrow.integrity = sha256({ ...escrow, integrity: null });
    if (this.ledger) {
      this.ledger.append({ action, subject: escrow.escrowId, level, visibility: 'PUBLIC', payload });
      this.ledger.append({ action, subject: escrow.bookingId, level, visibility: 'PUBLIC', payload });
    }
  }

  #get(escrowId) {
    const escrow = this.instances.get(escrowId);
    if (!escrow) throw new Error(`escrow ${escrowId} not found`);
    return escrow;
  }

  /** Customer has paid the partner; funds are now held. */
  confirmFunded(escrowId, { reference, method = 'card', amountCents, paidAt }) {
    const escrow = this.#get(escrowId);
    if (escrow.status !== ESCROW_STATUS.AWAITING_PAYMENT) {
      throw new Error(`escrow is ${escrow.status}, cannot be funded`);
    }
    const paid = amountCents ?? escrow.amountCents;
    if (paid < escrow.amountCents) {
      throw new Error(`under-funded: received R${(paid / 100).toFixed(2)} of R${(escrow.amountCents / 100).toFixed(2)}`);
    }
    escrow.status = ESCROW_STATUS.FUNDED;
    escrow.funded = {
      amountCents: paid,
      reference: reference || `PS_${sha256(escrowId).slice(0, 12).toUpperCase()}`,
      method,
      fundedAt: paidAt || nowIso(),
      expiresAt: null,
    };
    escrow.autoReleaseAt = null;
    this.#log(escrow, 'ESCROW_FUNDED', {
      summary: `Customer paid R${(paid / 100).toFixed(2)} — funds held safely by ${escrow.providerLabel}`,
      reference: escrow.funded.reference,
      method,
      proGuarantee: 'Pro is now guaranteed payment on acceptance.',
    });
    return deepClone(escrow);
  }

  /** Pro submits proof-of-work for a milestone. Starts the confirmation clock. */
  submitMilestoneEvidence(escrowId, milestoneId, { evidence, note }) {
    const escrow = this.#get(escrowId);
    const milestone = escrow.plan.milestones.find((m) => m.milestoneId === milestoneId);
    if (!milestone) throw new Error(`milestone ${milestoneId} not found on escrow ${escrowId}`);
    if (![MILESTONE_STATUS.PENDING, MILESTONE_STATUS.REJECTED].includes(milestone.status)) {
      throw new Error(`milestone is ${milestone.status}; evidence already submitted`);
    }
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new Error('at least one evidence item is required to request release');
    }

    const required = milestone.requiredEvidence || [];
    const supplied = new Set(evidence.map((e) => e.type));
    const missing = required.filter((type) => !supplied.has(type));

    milestone.evidence = evidence.map((item) => ({
      evidenceId: item.evidenceId || nextId('evd'),
      type: item.type,
      hash: item.hash || sha256(item),
      capturedAt: item.capturedAt || nowIso(),
      geo: item.geo || null,
      note: item.note || null,
    }));
    milestone.status = missing.length > 0 ? MILESTONE_STATUS.EVIDENCE_SUBMITTED : MILESTONE_STATUS.EVIDENCE_SUBMITTED;
    milestone.submittedAt = nowIso();
    milestone.missingEvidence = missing;

    escrow.autoReleaseAt = addMinutes(milestone.submittedAt, escrow.confirmationWindowMinutes);
    escrow.warrantyDays = escrow.warrantyDays ?? this.fees.warrantyDays;

    this.#log(escrow, 'MILESTONE_EVIDENCE_SUBMITTED', {
      summary: `Proof of work submitted for "${milestone.label}" — customer has until ${escrow.autoReleaseAt} to confirm`,
      milestoneId,
      evidenceCount: milestone.evidence.length,
      missingEvidence: missing,
      autoReleaseAt: escrow.autoReleaseAt,
      geoVerified: milestone.evidence.every((e) => !e.geo || (e.geo.lat && e.geo.lon)),
      note: note || null,
    }, AUDIT_LEVEL.TRUST);

    return deepClone(escrow);
  }

  /** Customer accepts a milestone. */
  acceptMilestone(escrowId, milestoneId, { actorId, comment }) {
    const escrow = this.#get(escrowId);
    const milestone = escrow.plan.milestones.find((m) => m.milestoneId === milestoneId);
    if (!milestone) throw new Error(`milestone ${milestoneId} not found`);
    if (milestone.status !== MILESTONE_STATUS.EVIDENCE_SUBMITTED) {
      throw new Error(`milestone must have evidence submitted first (currently ${milestone.status})`);
    }
    milestone.status = MILESTONE_STATUS.ACCEPTED;
    milestone.acceptedAt = nowIso();
    milestone.acceptedBy = actorId || escrow.customerId;
    milestone.customerComment = comment || null;

    const allAccepted = escrow.plan.milestones.every((m) => m.status === MILESTONE_STATUS.ACCEPTED);
    if (allAccepted) {
      escrow.status = ESCROW_STATUS.READY_FOR_RELEASE;
      escrow.holdbackReleaseAt = addDays(nowIso(), escrow.warrantyDays);
    }
    this.#log(escrow, 'MILESTONE_ACCEPTED', {
      summary: `Customer accepted "${milestone.label}"`,
      milestoneId,
      readyForRelease: allAccepted,
      holdbackReleaseAt: escrow.holdbackReleaseAt,
    }, AUDIT_LEVEL.MONEY);
    return deepClone(escrow);
  }

  rejectMilestone(escrowId, milestoneId, { actorId, reason }) {
    const escrow = this.#get(escrowId);
    const milestone = escrow.plan.milestones.find((m) => m.milestoneId === milestoneId);
    if (!milestone) throw new Error(`milestone ${milestoneId} not found`);
    milestone.status = MILESTONE_STATUS.REJECTED;
    milestone.rejectedAt = nowIso();
    milestone.rejectionReason = reason || 'Not accepted by customer';
    escrow.autoReleaseAt = null;
    this.#log(escrow, 'MILESTONE_REJECTED', {
      summary: `Customer rejected "${milestone.label}": ${reason || 'no reason given'}`,
      milestoneId,
      actorId,
    }, AUDIT_LEVEL.SAFETY);
    return deepClone(escrow);
  }

  /**
   * Release funds through the partner. Lula instructs; the partner moves money.
   * Always splits into: pro payout, platform fee, warranty holdback.
   */
  release(escrowId, { releaseReference, triggeredBy = 'CUSTOMER_CONFIRMATION', overrideSplit = null }) {
    const escrow = this.#get(escrowId);
    if (escrow.status === ESCROW_STATUS.FROZEN) {
      throw new Error('escrow is frozen by an open dispute — resolve the dispute before release');
    }
    if (![ESCROW_STATUS.READY_FOR_RELEASE, ESCROW_STATUS.FUNDED].includes(escrow.status)) {
      throw new Error(`escrow is ${escrow.status}; every milestone must be accepted first`);
    }
    const notAccepted = escrow.plan.milestones.filter((m) => m.status !== MILESTONE_STATUS.ACCEPTED);
    if (notAccepted.length > 0) {
      throw new Error(`${notAccepted.length} milestone(s) not accepted yet`);
    }

    const split = overrideSplit || this.#computeSplit(escrow);
    const reference = releaseReference || `REL_${sha256(escrow.escrowId + nowIso()).slice(0, 12).toUpperCase()}`;

    for (const milestone of escrow.plan.milestones) {
      milestone.status = MILESTONE_STATUS.RELEASED;
      milestone.releasedAt = nowIso();
      milestone.releaseReference = reference;
    }

    escrow.releases.push({
      releaseId: nextId('pay'),
      reference,
      triggeredBy,
      at: nowIso(),
      split,
    });
    escrow.status = escrow.fees.warrantyHoldbackCents > 0 ? ESCROW_STATUS.PARTIALLY_RELEASED : ESCROW_STATUS.RELEASED;
    escrow.holdbackReleaseAt = escrow.fees.warrantyHoldbackCents > 0
      ? addDays(nowIso(), escrow.warrantyDays)
      : null;

    this.#log(escrow, 'ESCROW_RELEASED', {
      summary: `Released R${(split.proPayoutCents / 100).toFixed(2)} to the pro · R${(split.platformFeeCents / 100).toFixed(2)} platform fee · R${(split.warrantyHoldbackCents / 100).toFixed(2)} held for ${escrow.warrantyDays}-day workmanship warranty`,
      reference,
      split,
      triggeredBy,
    });
    return deepClone(escrow);
  }

  #computeSplit(escrow) {
    const platformFeeCents = percentageOf(escrow.amountCents, this.fees.platformFeePercent);
    const warrantyHoldbackCents = percentageOf(escrow.amountCents, this.fees.warrantyHoldbackPercent);
    const proPayoutCents = escrow.amountCents - platformFeeCents;
    return {
      grossCents: escrow.amountCents,
      platformFeeCents,
      platformFeePercent: this.fees.platformFeePercent,
      proPayoutCents,
      proPayoutPercent: 100 - this.fees.platformFeePercent,
      warrantyHoldbackCents,
      warrantyHoldbackPercent: this.fees.warrantyHoldbackPercent,
      immediateToProCents: proPayoutCents - warrantyHoldbackCents,
      partnerFeeEstimateCents: escrow.fees.partnerFeeEstimateCents,
    };
  }

  /** Workmanship warranty window elapsed with no open dispute — release holdback. */
  releaseHoldback(escrowId, { releaseReference } = {}) {
    const escrow = this.#get(escrowId);
    if (escrow.status !== ESCROW_STATUS.PARTIALLY_RELEASED) {
      throw new Error(`no holdback to release (status ${escrow.status})`);
    }
    if (escrow.status === ESCROW_STATUS.FROZEN) throw new Error('escrow frozen');
    if (escrow.holdbackReleaseAt && new Date(escrow.holdbackReleaseAt).getTime() > Date.now()) {
      throw new Error(`warranty window still open until ${escrow.holdbackReleaseAt}`);
    }
    const holdback = escrow.fees.warrantyHoldbackCents;
    escrow.releases.push({
      releaseId: nextId('pay'),
      reference: releaseReference || `HOLD_${sha256(escrow.escrowId + 'holdback').slice(0, 10).toUpperCase()}`,
      triggeredBy: 'WARRANTY_WINDOW_ELAPSED',
      at: nowIso(),
      split: { warrantyHoldbackCents: holdback },
    });
    escrow.fees.warrantyHoldbackCents = 0;
    escrow.status = ESCROW_STATUS.RELEASED;
    escrow.holdbackReleaseAt = null;
    this.#log(escrow, 'WARRANTY_HOLDBACK_RELEASED', {
      summary: `R${(holdback / 100).toFixed(2)} workmanship holdback released to the pro — no defect reported in the warranty window`,
      holdbackCents: holdback,
    });
    return deepClone(escrow);
  }

  /** Dispute opened — money stops moving. */
  freeze(escrowId, { reason, disputeId, actorId }) {
    const escrow = this.#get(escrowId);
    if ([ESCROW_STATUS.RELEASED, ESCROW_STATUS.REFUNDED, ESCROW_STATUS.CANCELLED].includes(escrow.status)) {
      throw new Error(`cannot freeze a ${escrow.status} escrow`);
    }
    escrow.freezes.push({ at: nowIso(), reason, disputeId, actorId, previousStatus: escrow.status });
    escrow.status = ESCROW_STATUS.FROZEN;
    escrow.autoReleaseAt = null;
    for (const milestone of escrow.plan.milestones) {
      if (milestone.status === MILESTONE_STATUS.EVIDENCE_SUBMITTED) milestone.status = MILESTONE_STATUS.DISPUTED;
    }
    this.#log(escrow, 'ESCROW_FROZEN', {
      summary: `Escrow frozen — ${reason || 'dispute opened'}. No money moves until the dispute centre resolves it.`,
      disputeId,
      actorId,
    }, AUDIT_LEVEL.SAFETY);
    return deepClone(escrow);
  }

  unfreeze(escrowId, { reason, disputeId }) {
    const escrow = this.#get(escrowId);
    if (escrow.status !== ESCROW_STATUS.FROZEN) throw new Error('escrow is not frozen');
    const last = escrow.freezes.at(-1);
    escrow.status = last?.previousStatus || ESCROW_STATUS.FUNDED;
    this.#log(escrow, 'ESCROW_UNFROZEN', { summary: `Escrow unfrozen — ${reason || 'dispute resolved'}`, disputeId });
    return deepClone(escrow);
  }

  /** Full or partial refund to the customer. */
  refund(escrowId, { amountCents, reason, refundReference, actorId }) {
    const escrow = this.#get(escrowId);
    if (![ESCROW_STATUS.FUNDED, ESCROW_STATUS.FROZEN, ESCROW_STATUS.AWAITING_PAYMENT, ESCROW_STATUS.PARTIALLY_RELEASED]
      .includes(escrow.status)) {
      throw new Error(`cannot refund a ${escrow.status} escrow`);
    }
    const alreadyRefunded = escrow.refunds.reduce((sum, r) => sum + r.amountCents, 0);
    const available = escrow.amountCents - alreadyRefunded;
    const amount = amountCents ?? available;
    assertCents(amount, 'amountCents');
    if (amount > available) throw new Error(`refund exceeds available balance of R${(available / 100).toFixed(2)}`);

    escrow.refunds.push({
      refundId: nextId('pay'),
      amountCents: amount,
      reason: reason || 'Refund',
      reference: refundReference || `REF_${sha256(escrow.escrowId + nowIso()).slice(0, 10).toUpperCase()}`,
      actorId: actorId || 'system',
      at: nowIso(),
      expectedSettlementBusinessDays: '5–10',
    });
    const totalRefunded = alreadyRefunded + amount;
    escrow.status = totalRefunded >= escrow.amountCents ? ESCROW_STATUS.REFUNDED : ESCROW_STATUS.PARTIALLY_REFUNDED;
    escrow.autoReleaseAt = null;
    this.#log(escrow, 'ESCROW_REFUNDED', {
      summary: `R${(amount / 100).toFixed(2)} refunded to the customer — ${reason || 'no reason given'}. 5–10 business days to settle.`,
      amountCents: amount,
      totalRefundedCents: totalRefunded,
    });
    return deepClone(escrow);
  }

  /**
   * Move the workmanship-warranty release date. Legitimate operational uses:
   * a defect was reported and the window was extended by agreement, or a data
   * migration/backfill needs to age an escrow. Always audit-logged, because an
   * unaudited change to a release date is exactly how money disappears.
   */
  adjustHoldbackWindow(escrowId, { holdbackReleaseAt, reason, actorId = 'operations' }) {
    const escrow = this.#get(escrowId);
    const previous = escrow.holdbackReleaseAt;
    escrow.holdbackReleaseAt = holdbackReleaseAt;
    this.#log(escrow, 'HOLDBACK_WINDOW_ADJUSTED', {
      summary: `Workmanship holdback release moved from ${previous || 'unset'} to ${holdbackReleaseAt} — ${reason}`,
      previous,
      holdbackReleaseAt,
      reason,
      actorId,
    }, AUDIT_LEVEL.MONEY);
    return deepClone(escrow);
  }

  /**
   * A freeze marks open milestones DISPUTED so nothing can move. When a dispute
   * is resolved, restore them to EVIDENCE_SUBMITTED so the ruling can be executed.
   */
  restoreDisputedMilestones(escrowId, { reason } = {}) {
    const escrow = this.#get(escrowId);
    let restored = 0;
    for (const milestone of escrow.plan.milestones) {
      if (milestone.status === MILESTONE_STATUS.DISPUTED) {
        milestone.status = MILESTONE_STATUS.EVIDENCE_SUBMITTED;
        restored += 1;
      }
    }
    if (restored) {
      this.#log(escrow, 'MILESTONES_RESTORED_AFTER_DISPUTE', {
        summary: `${restored} milestone(s) returned to evidence-submitted after the dispute ruling`,
        reason: reason || null,
      });
    }
    return deepClone(escrow);
  }

  /** Customer never responded — automatic release, as per the platform terms. */
  autoReleaseDue(escrowId) {
    const escrow = this.#get(escrowId);
    if (escrow.status !== ESCROW_STATUS.FUNDED || !escrow.autoReleaseAt) return false;
    return new Date(escrow.autoReleaseAt).getTime() <= Date.now();
  }

  /**
   * Sweeper run by the scheduler. Accepts overdue milestones and releases.
   * Returns the actions taken so the API can notify both parties.
   */
  runAutoReleaseSweep() {
    const actions = [];
    for (const escrow of this.instances.values()) {
      if (escrow.status !== ESCROW_STATUS.FUNDED || !escrow.autoReleaseAt) continue;
      if (new Date(escrow.autoReleaseAt).getTime() > Date.now()) continue;
      for (const milestone of escrow.plan.milestones) {
        if (milestone.status === MILESTONE_STATUS.EVIDENCE_SUBMITTED) {
          milestone.status = MILESTONE_STATUS.ACCEPTED;
          milestone.acceptedAt = nowIso();
          milestone.acceptedBy = 'AUTO_RELEASE_POLICY';
          milestone.customerComment = `Automatically accepted: the ${escrow.confirmationWindowMinutes / 60}-hour confirmation window lapsed without a dispute.`;
        }
      }
      if (escrow.plan.milestones.every((m) => m.status === MILESTONE_STATUS.ACCEPTED)) {
        escrow.status = ESCROW_STATUS.READY_FOR_RELEASE;
        this.release(escrow.escrowId, { triggeredBy: 'CONFIRMATION_WINDOW_LAPSED' });
        actions.push({ escrowId: escrow.escrowId, bookingId: escrow.bookingId, action: 'AUTO_RELEASED' });
      }
    }
    return actions;
  }

  /**
   * Reconcile a partner webhook/IPN against the local shadow record.
   * Anything the partner reports that we did not expect becomes an incident.
   */
  reconcilePartnerEvent(escrowId, event) {
    const escrow = this.#get(escrowId);
    const record = {
      eventId: nextId('sig'),
      provider: event.provider || escrow.provider,
      type: event.type,
      reference: event.reference || null,
      amountCents: event.amountCents ?? null,
      receivedAt: nowIso(),
      signatureValid: event.signatureValid !== false,
      matched: false,
    };

    switch (event.type) {
      case 'charge.success':
      case 'transfer.success':
        record.matched = escrow.funded.reference === event.reference
          || escrow.releases.some((r) => r.reference === event.reference);
        break;
      case 'charge.failed':
      case 'transfer.failed':
        record.matched = false;
        break;
      default:
        record.matched = true;
    }

    escrow.partnerEvents.push(record);
    this.#log(escrow, 'ESCROW_PARTNER_EVENT', {
      summary: `${record.provider} reported ${event.type}${record.matched ? '' : ' — UNMATCHED, needs manual reconciliation'}`,
      type: event.type,
      reference: record.reference,
      matched: record.matched,
    }, record.matched ? AUDIT_LEVEL.INFO : AUDIT_LEVEL.CRITICAL);
    return deepClone(record);
  }

  /** Money the pro can see but not yet touch — powers "guaranteed earnings". */
  proPosition(escrowId) {
    const escrow = this.#get(escrowId);
    const split = this.#computeSplit(escrow);
    return {
      escrowId: escrow.escrowId,
      status: escrow.status,
      guaranteedCents: [ESCROW_STATUS.FUNDED, ESCROW_STATUS.PARTIALLY_RELEASED, ESCROW_STATUS.READY_FOR_RELEASE].includes(escrow.status)
        ? split.proPayoutCents
        : 0,
      releasedCents: escrow.releases.reduce((s, r) => s + (r.split.proPayoutCents || r.split.immediateToProCents || r.split.warrantyHoldbackCents || 0), 0),
      pendingHoldbackCents: escrow.fees.warrantyHoldbackCents,
      holdbackReleaseAt: escrow.holdbackReleaseAt,
      split,
    };
  }

  get(escrowId) {
    return deepClone(this.#get(escrowId));
  }

  getByBooking(bookingId) {
    const found = [...this.instances.values()].find((e) => e.bookingId === bookingId);
    return found ? deepClone(found) : null;
  }

  list({ status, providerId, customerId } = {}) {
    let rows = [...this.instances.values()];
    if (status) rows = rows.filter((e) => e.status === status);
    if (providerId) rows = rows.filter((e) => e.providerId === providerId);
    if (customerId) rows = rows.filter((e) => e.customerId === customerId);
    return deepClone(rows);
  }

  portfolioStats() {
    const rows = [...this.instances.values()];
    const heldCents = rows
      .filter((e) => [ESCROW_STATUS.FUNDED, ESCROW_STATUS.FROZEN, ESCROW_STATUS.PARTIALLY_RELEASED].includes(e.status))
      .reduce((sum, e) => sum + e.amountCents, 0);
    const releasedCents = rows
      .filter((e) => [ESCROW_STATUS.RELEASED, ESCROW_STATUS.PARTIALLY_RELEASED].includes(e.status))
      .reduce((sum, e) => sum + e.releases.reduce((s, r) => s + (r.split.proPayoutCents || 0), 0), 0);
    const refundedCents = rows.reduce((sum, e) => sum + e.refunds.reduce((s, r) => s + r.amountCents, 0), 0);
    return {
      totalEscrows: rows.length,
      totalValueCents: rows.reduce((sum, e) => sum + e.amountCents, 0),
      currentlyHeldCents: heldCents,
      releasedToProsCents: releasedCents,
      refundedToCustomersCents: refundedCents,
      frozenCount: rows.filter((e) => e.status === ESCROW_STATUS.FROZEN).length,
    };
  }

  toJSON() {
    return { fees: this.fees, instances: [...this.instances.entries()] };
  }

  static fromJSON(json, { ledger } = {}) {
    const engine = new EscrowEngine({ ledger, fees: json.fees });
    engine.instances = new Map(json.instances || []);
    return engine;
  }
}

module.exports = { EscrowEngine, ESCROW_STATUS, MILESTONE_STATUS, PROVIDERS };
