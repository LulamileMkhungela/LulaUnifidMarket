'use strict';

/**
 * Lula ProVeri — Bookings: award → escrow → proof of work → release → review.
 *
 * This module owns the money and the evidence, and it is deliberately paranoid:
 *
 *   - A booking cannot exist without an escrow record.
 *   - Escrow cannot release without geotagged proof of work AND acceptance
 *     (or a lapsed confirmation window, which is itself logged).
 *   - Evidence photos are checked against the job address; photos taken 40 km
 *     away hold the payout.
 *   - Scope changes after award need a customer-approved variation order.
 *   - 5% is held back for a 14-day workmanship warranty. Nobody in the South
 *     African market does this; it is the single strongest reason to book
 *     through ProVeri rather than pay cash.
 *   - Reviews can only be written on escrow-released jobs, so ratings cannot be
 *     bought. This is the direct answer to Snupit and Kandua's unverified
 *     review problem.
 */

const { idFor, nextId, nowIso, addMinutes, addDays, sha256, deepClone, fingerprint, clamp, distanceKm, percentageOf, median, splitAmount } = require('../kernel/util');
const { ESCROW_STATUS, MILESTONE_STATUS } = require('../kernel/escrow');
const { CHECK_STATUS, BADGE } = require('../kernel/verification');
const { POLICY_EFFECT } = require('../kernel/policy');
const { PAYOUT_RAILS, recommendPayoutRail } = require('../integrations/bankVerification');
const { FX } = require('../integrations/publicData');

const BOOKING_STATUS = Object.freeze({
  AWARDED: 'AWARDED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  SCHEDULED: 'SCHEDULED',
  EN_ROUTE: 'EN_ROUTE',
  ON_SITE: 'ON_SITE',
  IN_PROGRESS: 'IN_PROGRESS',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  COMPLETED: 'COMPLETED',
  IN_WARRANTY: 'IN_WARRANTY',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED',
  REFUNDED: 'REFUNDED',
});

const DISPUTE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  EVIDENCE_WINDOW: 'EVIDENCE_WINDOW',
  UNDER_REVIEW: 'UNDER_REVIEW',
  MEDIATION: 'MEDIATION',
  RESOLVED: 'RESOLVED',
  ESCALATED: 'ESCALATED',
  WITHDRAWN: 'WITHDRAWN',
});

const DISPUTE_OUTCOME = Object.freeze({
  RELEASE_TO_PRO: 'RELEASE_TO_PRO',
  REFUND_CUSTOMER: 'REFUND_CUSTOMER',
  PARTIAL: 'PARTIAL',
  REDO_WORK: 'REDO_WORK',
  SPLIT_COSTS: 'SPLIT_COSTS',
});

/** Evidence types and whether they must be geotagged at the job address. */
const EVIDENCE_TYPES = Object.freeze({
  BEFORE_PHOTO: { label: 'Before photo', geoSealed: true, requiredFor: ['plumbing', 'electrical', 'painting', 'handyman', 'roofing-gutters', 'paving-waterproofing'] },
  AFTER_PHOTO: { label: 'After photo', geoSealed: true, requiredFor: ['*'] },
  PROGRESS_PHOTO: { label: 'Progress photo', geoSealed: true, requiredFor: [] },
  COC_DOCUMENT: { label: 'Certificate of Compliance', geoSealed: false, requiredFor: ['electrical', 'plumbing', 'gas-installation', 'electric-fence-security'] },
  PRO_SIGNATURE: { label: 'Pro signature', geoSealed: true, requiredFor: ['*'] },
  CUSTOMER_CONFIRMATION: { label: 'Customer confirmation', geoSealed: false, requiredFor: ['*'] },
  MATERIALS_RECEIPT: { label: 'Materials till slip', geoSealed: false, requiredFor: [] },
  JOB_CARD: { label: 'Job card', geoSealed: false, requiredFor: ['auto-mechanical'] },
  INSPECTION_REPORT: { label: 'Inspection report', geoSealed: false, requiredFor: ['vehicle-inspection'] },
  VIN_PHOTO: { label: 'VIN plate photo', geoSealed: true, requiredFor: ['vehicle-inspection'] },
  ODOMETER_PHOTO: { label: 'Odometer photo', geoSealed: true, requiredFor: ['vehicle-inspection'] },
  COMMISSIONING_REPORT: { label: 'Commissioning report', geoSealed: false, requiredFor: ['solar-inverter', 'borehole-water'] },
  WATER_TEST_PHOTO: { label: 'Water/flood test photo', geoSealed: true, requiredFor: ['paving-waterproofing', 'roofing-gutters'] },
  PRESSURE_READING_PHOTO: { label: 'Gauge reading photo', geoSealed: true, requiredFor: ['airconditioning'] },
  CHECKLIST: { label: 'Completed checklist', geoSealed: false, requiredFor: ['cleaning-home'] },
  PROOF_OF_DELIVERY: { label: 'Proof of delivery', geoSealed: true, requiredFor: ['courier-logistics'] },
  DELIVERABLE: { label: 'Deliverable file or link', geoSealed: false, requiredFor: ['accounting-tax', 'legal-compliance', 'web-digital'] },
  PREVIEW_LINK: { label: 'Live preview link', geoSealed: false, requiredFor: ['web-digital'] },

  /* ---- Survey, quotation and planning evidence ---- */
  SITE_SURVEY: { label: 'Site survey record', geoSealed: true, requiredFor: ['painting', 'solar-inverter', 'building-construction', 'paving-waterproofing', 'fencing-gates', 'roofing-gutters', 'electric-fence-security', 'borehole-water'] },
  WRITTEN_QUOTE: { label: 'Signed written quote', geoSealed: false, requiredFor: ['building-construction'] },
  SCOPE_DOCUMENT: { label: 'Agreed scope document', geoSealed: false, requiredFor: ['web-digital'] },
  HANDOVER_CHECKLIST: { label: 'Handover checklist', geoSealed: false, requiredFor: ['web-digital'] },
  ENGAGEMENT_LETTER: { label: 'Engagement letter', geoSealed: false, requiredFor: ['accounting-tax', 'legal-compliance'] },
  MOCKUP_OR_PORTFOLIO: { label: 'Mockup or portfolio reference', geoSealed: false, requiredFor: ['events-decor'] },
  MENU_CONFIRMATION: { label: 'Confirmed menu and head count', geoSealed: false, requiredFor: ['catering'] },

  /* ---- Trade-specific technical evidence ---- */
  FAULT_DIAGNOSIS: { label: 'Fault diagnosis record', geoSealed: false, requiredFor: ['appliance-repair', 'it-support'] },
  TREATMENT_REPORT: { label: 'Treatment report', geoSealed: false, requiredFor: ['pest-control'] },
  LEAK_TEST_PHOTO: { label: 'Leak test photo', geoSealed: true, requiredFor: ['gas-installation'] },
  PUMP_TEST_REPORT: { label: 'Pump and yield test report', geoSealed: false, requiredFor: ['borehole-water'] },
  COMMISSIONING_REPORT: { label: 'Commissioning report', geoSealed: false, requiredFor: ['solar-inverter', 'borehole-water', 'electric-fence-security', 'airconditioning'] },
  DRONE_OR_ROOF_PHOTO: { label: 'Roof or drone photo', geoSealed: true, requiredFor: ['roofing-gutters'] },
  WARRANTY_DOCUMENT: { label: 'Written warranty', geoSealed: false, requiredFor: ['paving-waterproofing'] },
  NHBRC_ENROLMENT: { label: 'NHBRC enrolment certificate', geoSealed: false, requiredFor: ['building-construction'] },
  PARTS_RECEIPT: { label: 'Parts receipt', geoSealed: false, requiredFor: ['auto-mechanical'] },
  JOB_CARD: { label: 'Written job card', geoSealed: false, requiredFor: ['auto-mechanical'] },

  /* ---- Logistics and delivery ---- */
  PICKUP_PHOTO: { label: 'Pickup photo', geoSealed: true, requiredFor: ['courier-logistics'] },
  RECIPIENT_SIGNATURE: { label: 'Recipient signature', geoSealed: true, requiredFor: ['courier-logistics'] },
  INVENTORY: { label: 'Written inventory', geoSealed: false, requiredFor: ['moving-removals'] },
  CONDITION_REPORT: { label: 'Condition report', geoSealed: false, requiredFor: ['moving-removals', 'towing-transport'] },

  /* ---- Care and education ---- */
  LESSON_PLAN: { label: 'Lesson plan', geoSealed: false, requiredFor: ['tutoring-education'] },
  PROGRESS_REPORT: { label: 'Progress report', geoSealed: false, requiredFor: ['tutoring-education'] },
  CARE_PLAN: { label: 'Care plan', geoSealed: false, requiredFor: ['care-nursing'] },
  VISIT_LOG: { label: 'Visit log', geoSealed: false, requiredFor: ['care-nursing'] },
  CHECK_IN: { label: 'Child check-in record', geoSealed: false, requiredFor: ['childcare'] },
  CHECK_OUT: { label: 'Child check-out record', geoSealed: false, requiredFor: ['childcare'] },
  ACTIVITY_LOG: { label: 'Activity log', geoSealed: false, requiredFor: ['childcare'] },
  SERVICE_CONFIRMATION: { label: 'Service confirmation', geoSealed: false, requiredFor: ['beauty-mobile'] },

  /* ---- Vehicle vertical handover evidence ---- */
  VIN_PLATE_PHOTO: { label: 'VIN plate photo', geoSealed: true, requiredFor: ['vehicles'] },
  ODOMETER_PHOTO_VEHICLE: { label: 'Odometer photo', geoSealed: true, requiredFor: ['vehicles'] },
  REGISTRATION_CERTIFICATE: { label: 'Registration certificate (NaTIS RC1)', geoSealed: false, requiredFor: ['vehicles'] },
  SALE_AGREEMENT: { label: 'Signed sale agreement', geoSealed: false, requiredFor: ['vehicles'] },
  NCO_OR_RLV_TRANSFER: { label: 'NCO / RLV transfer document', geoSealed: false, requiredFor: ['vehicles'] },
  ROADWORTHY_CERTIFICATE: { label: 'Roadworthy certificate', geoSealed: false, requiredFor: ['vehicles'] },
  BUYER_HANDOVER_ACCEPTANCE: { label: 'Buyer handover acceptance', geoSealed: true, requiredFor: ['vehicles'] },
  SETTLEMENT_PAID_UP_LETTER: { label: 'Title-holder paid-up letter', geoSealed: false, requiredFor: ['vehicles'] },
  NATIS_TRANSFER_CONFIRMATION: { label: 'NaTIS ownership transfer confirmation', geoSealed: false, requiredFor: ['vehicles'] },
});

class BookingService {
  constructor({ store, kernel, catalog, people, jobs }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.people = people;
    this.jobs = jobs;
    this.portfolio = null;
  }

  /** The portfolio service feeds off released jobs; set by the facade. */
  attachPortfolio(portfolio) {
    this.portfolio = portfolio;
  }

  /* ================================================================== *
   * AWARD + ESCROW
   * ================================================================== */

  /**
   * Customer accepts a bid → booking created → escrow opened.
   * Money moves into the partner immediately; the pro is told payment is
   * guaranteed, which is the supply-side hook ServicePro leads with.
   */
  acceptBid({ jobId, bidId, customerId, scheduledAt, paymentProvider, fundingCurrency = 'ZAR', remitFrom = null }) {
    const job = this.store.get('jobs', jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    if (job.status === JOB_STATUS_AWARDED()) throw new Error('this job has already been awarded');
    if (!['OPEN', 'BIDDING'].includes(job.status)) throw new Error(`this job is ${job.status} and cannot be awarded`);

    const bid = this.store.get('bids', bidId);
    if (!bid) throw new Error(`bid ${bidId} not found`);
    if (bid.jobId !== jobId) throw new Error('bid does not belong to this job');
    if (bid.status !== 'SUBMITTED') throw new Error(`bid is ${bid.status} and cannot be accepted`);
    if (job.customerId !== customerId) throw new Error('only the customer who posted this job can award it');

    const pro = this.store.get('pros', bid.proId);
    const customer = this.store.get('customers', customerId);
    if (!pro || !customer) throw new Error('pro or customer not found');
    if (!pro.canBid) throw new Error(`${pro.displayName} is not currently cleared to take work (badge ${pro.badge})`);

    const category = this.catalog.get(job.categoryId);

    // Statutory trades cannot be awarded to an uncertified pro. No exceptions.
    this.kernel.policy.enforce('booking', { subjectId: jobId, category, pro, booking: null, bid });

    const bookingId = idFor('booking');
    const reference = this.store.reference('BKG', 'booking', 6);
    const provider = paymentProvider || (bid.totalCents >= 500_000 ? 'tradesafe' : 'paystack');

    const milestones = category.milestoneEscrow
      ? this.#defaultMilestones(category, bid)
      : [{ label: `${category.label} work complete and accepted`, weight: 100, requiredEvidence: this.#requiredEvidence(category) }];

    const escrow = this.kernel.escrow.open({
      bookingId,
      customerId,
      providerId: pro.proId,
      amountCents: bid.totalCents,
      currency: fundingCurrency === 'ZAR' ? 'ZAR' : 'ZAR',
      provider,
      milestones,
      warrantyDays: category.riskLevel === 'HIGH' ? 21 : 14,
      purpose: `${category.label} — ${job.title}`,
    });

    const gateCode = fingerprint(`${bookingId}:${pro.proId}:${Date.now()}`, 6).replace(/[^0-9]/g, '').padStart(6, '0').slice(0, 6);

    const booking = {
      bookingId,
      reference,
      vertical: 'services',
      jobId,
      jobReference: job.reference,
      bidId,
      customerId,
      customerName: customer.fullName,
      customerMobile: customer.mobile,
      proId: pro.proId,
      proName: pro.displayName,
      proBadge: pro.badge,
      proTrustScore: pro.trustScore,
      categoryId: job.categoryId,
      categoryLabel: category.label,
      statutoryTrade: category.statutoryTrade,
      title: job.title,
      status: BOOKING_STATUS.AWARDED,

      address: {
        suburb: job.location.suburb,
        metro: job.location.metro,
        province: job.location.province,
        addressText: job.location.addressText,
        lat: job.location.lat,
        lon: job.location.lon,
        locationType: job.location.locationType,
        accessNotes: job.location.accessNotes,
      },

      scope: {
        text: bid.scopeOfWork,
        scopeHash: bid.scopeHash,
        inclusions: bid.inclusions,
        exclusions: bid.exclusions,
        lineItems: bid.lineItems,
        includesCoc: bid.includesCoc,
        cocName: bid.cocName,
        warrantyDays: bid.warrantyDays,
        lockedAt: nowIso(),
      },

      price: {
        totalCents: bid.totalCents,
        labourCents: bid.labourCents,
        calloutFeeCents: bid.calloutFeeCents,
        materialsQuoteCents: bid.materialsQuoteCents,
        materialsCashCents: job.budget.materialsCashCents,
        currency: 'ZAR',
        priceAssessment: bid.priceAssessment,
      },

      schedule: {
        scheduledAt: scheduledAt || bid.scheduledAt || job.preferredDates[0] || null,
        durationHours: bid.durationHours,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
        confirmedAt: null,
        closedAt: null,
      },

      escrowId: escrow.escrowId,
      escrowStatus: escrow.status,
      escrowProvider: escrow.providerLabel,
      milestones: escrow.plan.milestones.map((m) => ({ ...m })),

      funding: remitFrom
        ? { kind: 'REMITTANCE', fromCurrency: remitFrom, quote: null }
        : { kind: 'DOMESTIC', fromCurrency: 'ZAR' },

      arrival: {
        gateCode,
        gateCodeSeal: sha256(gateCode),
        verified: false,
        attempts: [],
        enRouteAt: null,
        arrivedAt: null,
        departedAt: null,
        etaShared: false,
      },

      evidence: [],
      variationOrders: [],
      messages: [],
      checkIns: [],
      materialsSpent: [],

      warranty: {
        days: bid.warrantyDays,
        startsAt: null,
        endsAt: null,
        holdbackCents: escrow.fees.warrantyHoldbackCents,
        defectsReported: [],
        released: false,
      },

      disputeId: null,
      reviewId: null,
      cancellation: null,
      payoutId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('bookings', bookingId, booking);

    // Update upstream records.
    job.status = 'AWARDED';
    job.awardedBidId = bidId;
    job.bookingId = bookingId;
    job.updatedAt = nowIso();
    bid.status = 'ACCEPTED';
    bid.acceptedAt = nowIso();
    bid.bookingId = bookingId;
    for (const otherBidId of job.bids) {
      if (otherBidId === bidId) continue;
      const other = this.store.get('bids', otherBidId);
      if (other && other.status === 'SUBMITTED') {
        other.status = 'DECLINED';
        other.declineReason = 'The customer awarded the job to another verified pro';
        this.#notify(other.proId, 'BID_DECLINED', {
          title: 'Job awarded to another pro',
          body: `${job.customerName} awarded ${job.title} to another verified pro. Nothing wrong with your bid — you will be first in line for similar jobs in ${job.location.suburb || job.location.metro}.`,
          jobId,
          bidId: otherBidId,
        });
      }
    }
    pro.availability.bookedSlots = [...(pro.availability.bookedSlots || []), booking.schedule.scheduledAt || bookingId];

    this.kernel.ledger.append({
      action: 'BOOKING_AWARDED',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${customer.fullName} awarded ${job.title} to ${pro.displayName} for R${(bid.totalCents / 100).toFixed(2)}`,
        reference,
        jobId,
        bidId,
        proId: pro.proId,
        totalCents: bid.totalCents,
        escrowProvider: escrow.providerLabel,
        gateCodeIssued: Boolean(gateCode),
        warrantyDays: booking.warranty.days,
        holdbackCents: booking.warranty.holdbackCents,
      },
    });

    this.#notify(pro.proId, 'BOOKING_CONFIRMED', {
      title: 'You won the job — payment is guaranteed',
      body: `${job.title} · ${job.location.suburb || job.location.metro} · R${(bid.totalCents / 100).toFixed(2)}. The customer now pays into ${escrow.providerLabel} escrow. Once funded, your payment is guaranteed on completion.`,
      bookingId,
      reference,
      totalCents: bid.totalCents,
    });
    this.#notify(customerId, 'BOOKING_CREATED', {
      title: `${pro.displayName} is booked`,
      body: `Pay R${(bid.totalCents / 100).toFixed(2)} into escrow within ${Math.round(this.kernel.escrow.fees.paymentWindowMinutes / 60)} hours to confirm. Your arrival gate code is ${gateCode}.`,
      bookingId,
      reference,
      gateCode,
      paymentDueBy: addMinutes(nowIso(), this.kernel.escrow.fees.paymentWindowMinutes),
    });

    return deepClone(booking);
  }

  #defaultMilestones(category, bid) {
    const total = bid.totalCents;
    const labels = [
      { label: 'Site survey and written scope signed off', weight: 10, requiredEvidence: ['SITE_SURVEY', 'WRITTEN_QUOTE'] },
      { label: 'Materials purchased and work started', weight: 30, requiredEvidence: ['BEFORE_PHOTO', 'MATERIALS_RECEIPT'] },
      { label: 'Work 60% complete and inspected', weight: 30, requiredEvidence: ['PROGRESS_PHOTO'] },
      { label: `${category.label} complete, CoC issued and accepted`, weight: 30, requiredEvidence: this.#requiredEvidence(category) },
    ];
    const parts = splitAmount(total, labels.map((l) => l.weight));
    return labels.map((l, index) => ({ ...l, weight: l.weight, amountCents: parts[index] }));
  }

  #requiredEvidence(category) {
    return [...new Set(category.evidenceRequired || ['AFTER_PHOTO', 'PRO_SIGNATURE'])];
  }

  /**
   * Customer funds the escrow. Optionally funded from abroad (Remit-a-Job).
   */
  async fundBooking({ bookingId, customerId, paymentMethod = 'card', reference, remitFrom = null }) {
    const booking = this.#booking(bookingId);
    if (booking.customerId !== customerId) throw new Error('only the customer on this booking can pay for it');
    if (booking.escrowStatus !== ESCROW_STATUS.AWAITING_PAYMENT) {
      throw new Error(`escrow is already ${booking.escrowStatus}`);
    }

    if (remitFrom && remitFrom !== 'ZAR') {
      const rates = await FX.rates('ZAR');
      booking.funding = {
        kind: 'REMITTANCE',
        fromCurrency: remitFrom,
        quote: FX.quoteRemittance({ amountCentsZar: booking.price.totalCents, fromCurrency: remitFrom }, rates),
      };
      this.kernel.ledger.append({
        action: 'REMITTANCE_QUOTED',
        subject: bookingId,
        visibility: 'PUBLIC',
        payload: {
          summary: `Funded from abroad: ${booking.funding.quote.customerPaysDisplay} → R${(booking.price.totalCents / 100).toFixed(2)} into escrow`,
          fromCurrency: remitFrom,
          rate: booking.funding.quote.rate,
          rateAsOf: booking.funding.quote.rateAsOf,
        },
      });
    }

    const escrow = this.kernel.escrow.confirmFunded(booking.escrowId, {
      reference: reference || `PS_${fingerprint(bookingId, 10)}`,
      method: paymentMethod,
      amountCents: booking.price.totalCents,
    });

    booking.status = BOOKING_STATUS.SCHEDULED;
    booking.escrowStatus = escrow.status;
    booking.funding.paidAt = nowIso();
    booking.funding.reference = escrow.funded.reference;
    booking.funding.method = paymentMethod;
    booking.updatedAt = nowIso();

    const pro = this.store.get('pros', booking.proId);
    this.kernel.ledger.append({
      action: 'ESCROW_FUNDED_BY_CUSTOMER',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `Customer paid R${(booking.price.totalCents / 100).toFixed(2)} into ${booking.escrowProvider} escrow — ${pro.displayName} is now guaranteed payment`,
        reference: escrow.funded.reference,
        method: paymentMethod,
        funding: booking.funding.kind,
        guaranteedToProCents: escrow.fees.warrantyHoldbackCents ? booking.price.totalCents - percentageOf(booking.price.totalCents, 10) : booking.price.totalCents,
      },
    });

    this.#notify(booking.proId, 'ESCROW_FUNDED', {
      title: 'Payment secured — your money is guaranteed',
      body: `R${(booking.price.totalCents / 100).toFixed(2)} is now held in ${booking.escrowProvider} escrow for ${booking.title}. Complete the work, upload proof, and you are paid within minutes of acceptance.`,
      bookingId,
      reference: booking.reference,
      guaranteedCents: booking.price.totalCents - percentageOf(booking.price.totalCents, 10),
    });
    this.#notify(booking.customerId, 'PAYMENT_CONFIRMED', {
      title: 'Your money is safe in escrow',
      body: `${booking.proName} cannot be paid until you confirm the work is done. Your arrival gate code is ${booking.arrival.gateCode}.`,
      bookingId,
      gateCode: booking.arrival.gateCode,
    });

    return deepClone(booking);
  }

  /* ================================================================== *
   * ON-SITE SAFETY HANDSHAKE
   * ================================================================== */

  /** Pro shares live ETA before arriving. */
  shareEta({ bookingId, proId, etaMinutes, lat, lon }) {
    const booking = this.#booking(bookingId);
    if (booking.proId !== proId) throw new Error('only the assigned pro can share an ETA');
    booking.arrival.etaShared = true;
    booking.arrival.eta = { minutes: etaMinutes, lat, lon, sharedAt: nowIso() };
    booking.status = BOOKING_STATUS.EN_ROUTE;
    booking.arrival.enRouteAt = nowIso();
    booking.updatedAt = nowIso();
    this.#notify(booking.customerId, 'PRO_EN_ROUTE', {
      title: `${booking.proName} is on the way`,
      body: `Arriving in about ${etaMinutes} minutes. Have your arrival code ready — you will find it on the booking screen.`,
      bookingId,
      etaMinutes,
    });
    this.kernel.ledger.append({
      action: 'PRO_EN_ROUTE',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: { summary: `${booking.proName} en route, ETA ${etaMinutes} minutes`, etaMinutes },
    });
    return deepClone(booking);
  }

  /**
   * Gate-code handshake. The pro reads out a 6-digit code at the door; the
   * customer enters it and only then sees the pro's verified photo, ID name and
   * certificate. Wrong codes are rate-limited and logged.
   */
  verifyArrivalCode({ bookingId, customerId, code }) {
    const booking = this.#booking(bookingId);
    if (booking.customerId !== customerId) throw new Error('only the customer on this booking can verify the arrival code');
    const attempt = { code: String(code || '').trim(), at: nowIso(), matched: false };

    if (booking.arrival.attempts.length >= 5) {
      this.kernel.risk.record(booking.bookingId, {
        type: 'IDENTITY_DOCUMENT_MISMATCH',
        severity: 'MEDIUM',
        source: 'ProVeri arrival handshake',
        message: 'Arrival code entry rate-limited after 5 failed attempts',
      });
      throw new Error('Too many incorrect codes. Contact the Lula safety desk — we will verify the visit by phone.');
    }

    if (attempt.code === booking.arrival.gateCode) {
      attempt.matched = true;
      booking.arrival.verified = true;
      booking.arrival.arrivedAt = nowIso();
      booking.arrival.attempts.push(attempt);
      booking.status = BOOKING_STATUS.ON_SITE;
      booking.schedule.arrivedAt = nowIso();
      booking.updatedAt = nowIso();

      const pro = this.store.get('pros', booking.proId);
      this.kernel.ledger.append({
        action: 'ARRIVAL_CODE_VERIFIED',
        subject: bookingId,
        level: 'SAFETY',
        visibility: 'PUBLIC',
        payload: {
          summary: `Customer confirmed ${pro.fullName}'s arrival code at the door — identity handshake complete`,
          proId: pro.proId,
          verifiedAt: booking.arrival.arrivedAt,
        },
      });
      return {
        verified: true,
        bookingId,
        unlock: {
          proFullName: pro.fullName,
          badge: pro.badge,
          trustScore: pro.trustScore,
          certificationBody: pro.certification.body,
          certificateReference: pro.certification.certificateNumber ? String(pro.certification.certificateNumber).slice(-4).padStart(pro.certification.certificateNumber.length, '•') : null,
          insured: Boolean(pro.insurance.policyNumber),
          completedJobs: pro.stats.completedJobs,
          averageRating: pro.stats.averageRating,
          micrositeUrl: pro.micrositeUrl,
          photoSeal: sha256(pro.proId + 'photo').slice(0, 12),
        },
        message: 'Identity confirmed. You can let them in.',
      };
    }

    booking.arrival.attempts.push(attempt);
    booking.updatedAt = nowIso();
    this.kernel.ledger.append({
      action: 'ARRIVAL_CODE_FAILED',
      subject: bookingId,
      level: 'SAFETY',
      visibility: 'PUBLIC',
      payload: { summary: `Incorrect arrival code entered (${booking.arrival.attempts.length} attempt(s))`, attempts: booking.arrival.attempts.length },
    });
    return {
      verified: false,
      bookingId,
      attempts: booking.arrival.attempts.length,
      message: 'That code does not match. Do not let anyone in. Ask them to read the code from their ProVeri app.',
    };
  }

  checkIn({ bookingId, actorId, kind = 'ARRIVED', lat, lon }) {
    const booking = this.#booking(bookingId);
    const record = { checkInId: nextId('sig'), actorId, kind, lat: lat ?? null, lon: lon ?? null, at: nowIso() };
    booking.checkIns.push(record);
    if (kind === 'STARTED') { booking.schedule.startedAt = nowIso(); booking.status = BOOKING_STATUS.IN_PROGRESS; }
    if (kind === 'DEPARTED') { booking.arrival.departedAt = nowIso(); }
    booking.updatedAt = nowIso();
    this.kernel.ledger.append({
      action: `CHECK_IN_${kind}`,
      subject: bookingId,
      level: 'SAFETY',
      visibility: 'PUBLIC',
      payload: { summary: `${kind} check-in recorded${record.lat ? ` at ${record.lat.toFixed(4)}, ${record.lon.toFixed(4)}` : ''}`, kind, geo: record.lat ? { lat: record.lat, lon: record.lon } : null },
    });
    return deepClone(record);
  }

  /* ================================================================== *
   * PROOF OF WORK
   * ================================================================== */

  /**
   * Submit evidence for a milestone. Geotagged items are checked against the
   * job address — this is what makes "the pro never showed up" or "they did not
   * finish" a decidable question instead of a shouting match.
   */
  submitEvidence({ bookingId, proId, milestoneId, items, note, materialsReceipts = [] }) {
    const booking = this.#booking(bookingId);
    if (booking.proId !== proId) throw new Error('only the assigned pro can submit proof of work');
    if ([BOOKING_STATUS.CANCELLED, BOOKING_STATUS.DISPUTED, BOOKING_STATUS.CLOSED].includes(booking.status)) {
      throw new Error(`booking is ${booking.status}`);
    }
    if (!Array.isArray(items) || items.length === 0) throw new Error('at least one evidence item is required');

    const milestone = booking.milestones.find((m) => m.milestoneId === milestoneId) || booking.milestones.find((m) => m.status === MILESTONE_STATUS.PENDING);
    if (!milestone) throw new Error('no open milestone to submit evidence against');

    const sealed = [];
    for (const item of items) {
      const type = item.type;
      if (!EVIDENCE_TYPES[type]) throw new Error(`unknown evidence type: ${type}`);
      const definition = EVIDENCE_TYPES[type];
      const km = definition.geoSealed && item.geo?.lat != null && booking.address.lat != null
        ? Number(distanceKm({ lat: item.geo.lat, lon: item.geo.lon }, { lat: booking.address.lat, lon: booking.address.lon }).toFixed(2))
        : null;

      const record = {
        evidenceId: nextId('evd'),
        type,
        label: definition.label,
        hash: item.hash ? sha256(item.hash) : sha256({ type, capturedAt: item.capturedAt, note: item.note }),
        capturedAt: item.capturedAt || nowIso(),
        geo: item.geo ? { lat: item.geo.lat, lon: item.geo.lon, accuracyM: item.geo.accuracyM ?? null } : null,
        distanceFromJobKm: km,
        geoVerified: km == null ? null : km <= 2,
        note: item.note || null,
        uploadedBy: proId,
        uploadedAt: nowIso(),
        seal: sha256({ type, hash: item.hash || '', geo: item.geo || null, bookingId, capturedAt: item.capturedAt || '' }).slice(0, 16),
      };
      sealed.push(record);
      booking.evidence.push(record);

      if (record.geoVerified === false) {
        this.kernel.risk.record(booking.proId, {
          type: 'EVIDENCE_EXIF_MISMATCH',
          severity: 'HIGH',
          source: 'ProVeri evidence geoseal',
          message: `${definition.label} was captured ${km.toFixed(1)} km from the job address`,
          metadata: { bookingId, evidenceId: record.evidenceId, km },
        });
      }
    }

    // Duplicate-photo detection across the whole platform.
    for (const record of sealed) {
      const duplicates = this.store.find('bookings', (b) => b.bookingId !== bookingId)
        .flatMap((b) => b.evidence || [])
        .filter((e) => e.hash === record.hash);
      if (duplicates.length > 0) {
        this.kernel.risk.record(booking.proId, {
          type: 'DUPLICATE_PHOTO_HASH',
          severity: 'HIGH',
          source: 'ProVeri perceptual duplicate scan',
          message: `Evidence photo hash matches ${duplicates.length} photo(s) on other bookings`,
          metadata: { bookingId, evidenceId: record.evidenceId },
        });
      }
    }

    // Materials cash must be matched by receipts before that portion releases.
    for (const receipt of materialsReceipts) {
      const entry = {
        receiptId: nextId('evd'),
        amountCents: receipt.amountCents,
        supplier: receipt.supplier || null,
        hash: sha256(receipt.hash || receipt),
        capturedAt: receipt.capturedAt || nowIso(),
        matched: true,
      };
      booking.materialsSpent.push(entry);
      sealed.push({ ...entry, type: 'MATERIALS_RECEIPT', label: EVIDENCE_TYPES.MATERIALS_RECEIPT.label, geoVerified: null, seal: entry.hash.slice(0, 16) });
    }
    const materialsClaimed = booking.materialsSpent.reduce((sum, r) => sum + (r.amountCents || 0), 0);
    if (materialsClaimed > booking.price.materialsQuoteCents) {
      this.kernel.risk.record(booking.proId, {
        type: 'DEPOSIT_ESCALATION',
        severity: 'MEDIUM',
        source: 'ProVeri materials reconciliation',
        message: `Materials receipts (R${(materialsClaimed / 100).toFixed(2)}) exceed the quoted R${(booking.price.materialsQuoteCents / 100).toFixed(2)}`,
      });
    }

    const escrow = this.kernel.escrow.submitMilestoneEvidence(booking.escrowId, milestone.milestoneId, {
      evidence: sealed,
      note,
    });

    // Sync milestone state back onto the booking.
    booking.milestones = escrow.plan.milestones.map((m) => ({ ...m }));
    booking.escrowStatus = escrow.status;
    booking.status = BOOKING_STATUS.AWAITING_CONFIRMATION;
    booking.schedule.completedAt = booking.schedule.completedAt || nowIso();
    booking.autoReleaseAt = escrow.autoReleaseAt;
    booking.updatedAt = nowIso();

    const geoFailures = sealed.filter((s) => s.geoVerified === false);
    this.kernel.ledger.append({
      action: 'PROOF_OF_WORK_SUBMITTED',
      subject: bookingId,
      level: geoFailures.length ? 'CRITICAL' : 'TRUST',
      visibility: 'PUBLIC',
      payload: {
        summary: `${sealed.length} evidence item(s) submitted for "${milestone.label}"${geoFailures.length ? ` — ${geoFailures.length} failed the geoseal check` : ''}`,
        milestoneId: milestone.milestoneId,
        evidenceCount: sealed.length,
        geoVerifiedCount: sealed.filter((s) => s.geoVerified === true).length,
        geoFailedCount: geoFailures.length,
        missingEvidence: milestone.missingEvidence || [],
        autoReleaseAt: booking.autoReleaseAt,
        materialsReceipts: materialsReceipts.length,
      },
    });

    // POW-001: required evidence must be present before release is possible.
    const decision = this.kernel.policy.evaluate('evidence', {
      subjectId: bookingId,
      booking,
      evidence: sealed.map((s) => ({ ...s, geo: s.geo ? { ...s.geo, distanceKm: s.distanceFromJobKm } : null })),
    });

    this.#notify(booking.customerId, 'WORK_SUBMITTED_FOR_CONFIRMATION', {
      title: 'Work submitted — please confirm',
      body: `${booking.proName} uploaded ${sealed.length} proof-of-work item(s). Confirm to release payment, or open a dispute. If you do nothing, payment releases automatically on ${new Date(booking.autoReleaseAt).toLocaleString('en-ZA')}.`,
      bookingId,
      autoReleaseAt: booking.autoReleaseAt,
      evidenceCount: sealed.length,
      geoFailures: geoFailures.length,
    });

    return deepClone({ booking, milestone: escrow.plan.milestones.find((m) => m.milestoneId === milestone.milestoneId), sealed, decision });
  }

  /** Customer confirms the work — escrow releases. */
  confirmCompletion({ bookingId, customerId, milestoneId, comment, rating = null }) {
    const booking = this.#booking(bookingId);
    if (booking.customerId !== customerId) throw new Error('only the customer on this booking can confirm completion');

    const target = milestoneId
      ? booking.milestones.find((m) => m.milestoneId === milestoneId)
      : booking.milestones.find((m) => m.status === MILESTONE_STATUS.EVIDENCE_SUBMITTED);
    if (!target) throw new Error('no milestone is awaiting your confirmation');

    // POW-001 gate.
    this.kernel.policy.enforce('booking', { subjectId: bookingId, booking, patch: {}, pro: this.store.get('pros', booking.proId) });

    const escrow = this.kernel.escrow.acceptMilestone(booking.escrowId, target.milestoneId, { actorId: customerId, comment });
    booking.milestones = escrow.plan.milestones.map((m) => ({ ...m }));
    booking.escrowStatus = escrow.status;
    booking.updatedAt = nowIso();

    if (escrow.status === ESCROW_STATUS.READY_FOR_RELEASE) {
      return this.releasePayment({ bookingId, triggeredBy: 'CUSTOMER_CONFIRMATION', rating, comment });
    }

    this.kernel.ledger.append({
      action: 'MILESTONE_CONFIRMED_BY_CUSTOMER',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: { summary: `Customer accepted "${target.label}" — ${booking.milestones.filter((m) => m.status === MILESTONE_STATUS.ACCEPTED).length}/${booking.milestones.length} milestones accepted`, milestoneId: target.milestoneId },
    });
    return deepClone(booking);
  }

  /** Customer rejects the work — milestone goes back to the pro, escrow stays held. */
  rejectWork({ bookingId, customerId, milestoneId, reason }) {
    const booking = this.#booking(bookingId);
    if (booking.customerId !== customerId) throw new Error('only the customer on this booking can reject work');
    const escrow = this.kernel.escrow.rejectMilestone(booking.escrowId, milestoneId, { actorId: customerId, reason });
    booking.milestones = escrow.plan.milestones.map((m) => ({ ...m }));
    booking.status = BOOKING_STATUS.IN_PROGRESS;
    booking.escrowStatus = escrow.status;
    booking.updatedAt = nowIso();
    this.#notify(booking.proId, 'WORK_REJECTED', {
      title: 'Customer did not accept the work',
      body: `${booking.customerName}: ${reason}. Your money is still held safely in escrow — upload corrected proof of work or open a dispute.`,
      bookingId,
      reason,
    });
    return deepClone(booking);
  }

  /**
   * Release escrow → pro payout, platform fee, warranty holdback.
   */
  releasePayment({ bookingId, triggeredBy = 'CUSTOMER_CONFIRMATION', releaseReference, rating = null, comment = null }) {
    const booking = this.#booking(bookingId);
    const escrow = this.kernel.escrow.release(booking.escrowId, { releaseReference, triggeredBy });
    const split = escrow.releases.at(-1).split;

    booking.escrowStatus = escrow.status;
    booking.status = BOOKING_STATUS.IN_WARRANTY;
    booking.schedule.confirmedAt = nowIso();
    booking.warranty.startsAt = nowIso();
    booking.warranty.endsAt = escrow.holdbackReleaseAt;
    booking.updatedAt = nowIso();

    const pro = this.store.get('pros', booking.proId);
    const payout = this.#createPayout({ booking, pro, split, triggeredBy, releaseReference: escrow.releases.at(-1).reference });
    booking.payoutId = payout.payoutId;

    // The job is done once the money has moved — keep the two views consistent.
    const job = this.store.get('jobs', booking.jobId);
    if (job && !['COMPLETED', 'REMOVED'].includes(job.status)) {
      job.status = 'COMPLETED';
      job.completedAt = nowIso();
      job.updatedAt = nowIso();
    }

    // Update pro stats.
    pro.stats.completedJobs += 1;
    pro.stats.totalEarnedCents += split.immediateToProCents;
    pro.stats.onTimePercent = pro.stats.onTimePercent == null
      ? 100
      : Math.round((pro.stats.onTimePercent * (pro.stats.completedJobs - 1) + (booking.schedule.arrivedAt && booking.schedule.scheduledAt && new Date(booking.schedule.arrivedAt) <= new Date(booking.schedule.scheduledAt) ? 100 : 70)) / pro.stats.completedJobs);
    pro.updatedAt = nowIso();

    // Recalculate verification history now that there is a track record.
    pro.verification = this.kernel.recordCheck(pro.proId, pro.verification, { subjectId: pro.proId, primaryTrade: pro.trade }, {
      name: 'platform_history',
      status: CHECK_STATUS.PASS,
      source: 'Lula ProVeri completed-job ledger',
      reference: booking.reference,
      finding: `${pro.stats.completedJobs} escrow-released job(s), ${pro.stats.disputeCount} dispute(s)`,
      evidence: { completedJobs: pro.stats.completedJobs, disputeRate: pro.stats.completedJobs ? pro.stats.disputeCount / pro.stats.completedJobs : 0 },
    });
    pro.trustScore = pro.verification.score;
    pro.badge = this.kernel.trustBadgeFor(pro.proId, pro.verification);
    // Badge, status and bidding clearance must move together — a pro whose proof
    // of work failed the geoseal is suspended here, not left silently listed.
    this.people.refreshStanding(pro.proId);

    if (rating != null) this.writeReview({ bookingId, customerId: booking.customerId, rating, comment });

    this.kernel.ledger.append({
      action: 'PAYMENT_RELEASED',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `R${(split.immediateToProCents / 100).toFixed(2)} paid to ${pro.displayName} · R${(split.platformFeeCents / 100).toFixed(2)} platform fee · R${(split.warrantyHoldbackCents / 100).toFixed(2)} held for ${booking.warranty.days}-day workmanship warranty`,
        split,
        triggeredBy,
        payoutRail: payout.rail.label,
        warrantyEndsAt: booking.warranty.endsAt,
      },
    });

    // Proof of work that paid out becomes portfolio proof automatically — the
    // pro should not have to remember to upload what they already proved.
    if (this.portfolio) {
      try {
        this.portfolio.harvestFromBooking(booking);
      } catch (error) {
        // Harvesting is a bonus, never a reason to lose a payout record.
        this.kernel.ledger.append({
          action: 'PORTFOLIO_HARVEST_FAILED', subject: booking.bookingId, visibility: 'PRIVATE',
          payload: { summary: `Portfolio harvest failed: ${error.message}` },
        });
      }
    }

    this.#notify(booking.proId, 'PAYOUT_RELEASED', {
      title: `R${(split.immediateToProCents / 100).toFixed(2)} is on its way`,
      body: `${booking.customerName} confirmed the work. Paid by ${payout.rail.label} to your ${payout.bankName} account. R${(split.warrantyHoldbackCents / 100).toFixed(2)} is held for ${booking.warranty.days} days as a workmanship warranty and releases automatically if no defect is reported.`,
      bookingId,
      amountCents: split.immediateToProCents,
      rail: payout.rail.label,
      holdbackCents: split.warrantyHoldbackCents,
      holdbackReleasesAt: booking.warranty.endsAt,
    });
    this.#notify(booking.customerId, 'JOB_COMPLETED', {
      title: 'Payment released — you are covered for ' + booking.warranty.days + ' days',
      body: `${pro.displayName} has been paid. If anything is wrong with the work, report it before ${new Date(booking.warranty.endsAt).toLocaleDateString('en-ZA')} and the R${(split.warrantyHoldbackCents / 100).toFixed(2)} holdback is used to put it right. Please leave a verified review.`,
      bookingId,
      warrantyEndsAt: booking.warranty.endsAt,
      holdbackCents: split.warrantyHoldbackCents,
    });

    return deepClone({ booking, payout, split, escrow });
  }

  #createPayout({ booking, pro, split, triggeredBy, releaseReference }) {
    const rail = recommendPayoutRail(pro.payoutBank?.bankCode, { preferInstant: true });
    const banks = require('../integrations/bankVerification').BANKS;
    const payout = {
      payoutId: idFor('payout'),
      bookingId: booking.bookingId,
      proId: pro.proId,
      releaseReference,
      triggeredBy,
      amountCents: split.immediateToProCents,
      holdbackCents: split.warrantyHoldbackCents,
      platformFeeCents: split.platformFeeCents,
      grossCents: split.grossCents,
      currency: 'ZAR',
      rail: { id: rail.id, label: rail.label, settlement: rail.settlementHours, feeCents: rail.feeCents },
      bankCode: pro.payoutBank?.bankCode || null,
      bankName: banks[pro.payoutBank?.bankCode]?.name || null,
      accountNumberMasked: pro.payoutBank?.accountNumberMasked || '••••',
      status: 'INSTRUCTED',
      instructedAt: nowIso(),
      settledAt: null,
    };
    this.store.put('payouts', payout.payoutId, payout);
    const wallet = this.#wallet(pro.proId);
    wallet.receivedCents += payout.amountCents;
    wallet.pendingHoldbackCents += payout.holdbackCents;
    wallet.lifetimePlatformFeesPaidCents += payout.platformFeeCents;
    wallet.transactions.push({ at: nowIso(), kind: 'PAYOUT', amountCents: payout.amountCents, reference: releaseReference, bookingId: booking.bookingId });
    return payout;
  }

  #wallet(userId) {
    let wallet = this.store.get('wallets', userId);
    if (!wallet) {
      wallet = {
        walletId: userId,
        userId,
        currency: 'ZAR',
        balanceCents: 0,
        heldInEscrowCents: 0,
        pendingHoldbackCents: 0,
        receivedCents: 0,
        paidCents: 0,
        refundedCents: 0,
        lifetimePlatformFeesPaidCents: 0,
        earningsThisTaxYearCents: 0,
        transactions: [],
        createdAt: nowIso(),
      };
      this.store.put('wallets', userId, wallet);
    }
    return wallet;
  }

  /**
   * Warranty holdback release, or defect report during the warranty window.
   */
  reportWarrantyDefect({ bookingId, actorId, description, photos = [] }) {
    const booking = this.#booking(bookingId);
    if (booking.status !== BOOKING_STATUS.IN_WARRANTY) throw new Error(`booking is ${booking.status}; warranty defects are only accepted while the warranty is open`);
    if (new Date(booking.warranty.endsAt).getTime() < Date.now()) throw new Error('the workmanship warranty window has closed');

    const defect = {
      defectId: nextId('inc'),
      description,
      photos: photos.map((p) => ({ hash: sha256(p.hash || p), capturedAt: p.capturedAt || nowIso() })),
      reportedBy: actorId,
      reportedAt: nowIso(),
      holdbackAtRiskCents: booking.warranty.holdbackCents,
      status: 'OPEN',
    };
    booking.warranty.defectsReported.push(defect);
    booking.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'WARRANTY_DEFECT_REPORTED',
      subject: bookingId,
      level: 'SAFETY',
      visibility: 'PUBLIC',
      payload: {
        summary: `Workmanship defect reported inside the ${booking.warranty.days}-day warranty — R${(defect.holdbackAtRiskCents / 100).toFixed(2)} holdback frozen until resolved`,
        description,
        holdbackAtRiskCents: defect.holdbackAtRiskCents,
      },
    });
    this.#notify(booking.proId, 'WARRANTY_DEFECT', {
      title: 'Warranty defect reported',
      body: `${booking.customerName}: ${description}. Return and fix it within 7 days and the R${(defect.holdbackAtRiskCents / 100).toFixed(2)} holdback releases to you. Ignore it and the holdback is used to pay another verified pro to finish the job.`,
      bookingId,
      defectId: defect.defectId,
    });
    return deepClone({ booking, defect });
  }

  closeWarranty({ bookingId }) {
    const booking = this.#booking(bookingId);
    if (booking.status !== BOOKING_STATUS.IN_WARRANTY) throw new Error(`booking is ${booking.status}`);
    const openDefects = booking.warranty.defectsReported.filter((d) => d.status === 'OPEN');
    if (openDefects.length > 0) throw new Error(`${openDefects.length} warranty defect(s) still open`);
    if (new Date(booking.warranty.endsAt).getTime() > Date.now()) throw new Error(`warranty window runs until ${booking.warranty.endsAt}`);

    const escrow = this.kernel.escrow.releaseHoldback(booking.escrowId);
    booking.warranty.released = true;
    booking.warranty.holdbackReleasedAt = nowIso();
    booking.escrowStatus = escrow.status;
    booking.status = BOOKING_STATUS.CLOSED;
    booking.schedule.closedAt = nowIso();
    booking.updatedAt = nowIso();

    const wallet = this.#wallet(booking.proId);
    wallet.pendingHoldbackCents = Math.max(0, wallet.pendingHoldbackCents - (booking.warranty.holdbackCents || 0));
    wallet.receivedCents += booking.warranty.holdbackCents || 0;

    this.kernel.ledger.append({
      action: 'WARRANTY_CLOSED',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${booking.warranty.days}-day workmanship warranty closed with no defects — R${((booking.warranty.holdbackCents || 0) / 100).toFixed(2)} holdback released to ${booking.proName}`,
        holdbackCents: booking.warranty.holdbackCents,
      },
    });
    this.#notify(booking.proId, 'HOLDBACK_RELEASED', {
      title: `R${((booking.warranty.holdbackCents || 0) / 100).toFixed(2)} warranty holdback released`,
      body: `${booking.title} passed its ${booking.warranty.days}-day warranty with no defect reported. The holdback has been paid to you.`,
      bookingId,
      amountCents: booking.warranty.holdbackCents,
    });
    return deepClone(booking);
  }

  /* ================================================================== *
   * VARIATION ORDERS (scope changes after award)
   * ================================================================== */

  /**
   * BID-001: the accepted scope is locked. Any change goes through a variation
   * order the customer must explicitly approve, and the escrow amount is
   * adjusted so the extra work is funded *before* it is done.
   */
  proposeVariation({ bookingId, proId, description, additionalCents, evidence = [], reason }) {
    const booking = this.#booking(bookingId);
    if (booking.proId !== proId) throw new Error('only the assigned pro can propose a variation');
    if (![BOOKING_STATUS.SCHEDULED, BOOKING_STATUS.ON_SITE, BOOKING_STATUS.IN_PROGRESS].includes(booking.status)) {
      throw new Error(`variations cannot be proposed while the booking is ${booking.status}`);
    }
    const vo = {
      variationId: nextId('qot'),
      seq: booking.variationOrders.length + 1,
      description,
      additionalCents: clamp(Number(additionalCents) || 0, 0, 100_000_000),
      evidence: evidence.map((e) => ({ hash: sha256(e.hash || e), capturedAt: e.capturedAt || nowIso(), type: e.type || 'BEFORE_PHOTO' })),
      reason: reason || null,
      status: 'PENDING_CUSTOMER_APPROVAL',
      proposedBy: proId,
      proposedAt: nowIso(),
      decidedAt: null,
      seal: sha256({ bookingId, description, additionalCents, seq: booking.variationOrders.length + 1 }),
    };
    booking.variationOrders.push(vo);
    booking.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'VARIATION_PROPOSED',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${booking.proName} proposed a R${(vo.additionalCents / 100).toFixed(2)} variation: ${description}`,
        variationId: vo.variationId,
        additionalCents: vo.additionalCents,
        evidenceCount: vo.evidence.length,
      },
    });
    this.#notify(booking.customerId, 'VARIATION_REQUESTED', {
      title: `${booking.proName} needs approval for extra work`,
      body: `${description} — R${(vo.additionalCents / 100).toFixed(2)} more. Nothing proceeds and no extra money moves until you approve it in the app.`,
      bookingId,
      variationId: vo.variationId,
      additionalCents: vo.additionalCents,
    });
    return deepClone(vo);
  }

  decideVariation({ bookingId, customerId, variationId, approve, comment }) {
    const booking = this.#booking(bookingId);
    if (booking.customerId !== customerId) throw new Error('only the customer can decide a variation');
    const vo = booking.variationOrders.find((v) => v.variationId === variationId);
    if (!vo) throw new Error(`variation ${variationId} not found`);
    if (vo.status !== 'PENDING_CUSTOMER_APPROVAL') throw new Error(`variation is ${vo.status}`);

    vo.status = approve ? 'APPROVED' : 'REJECTED';
    vo.decidedAt = nowIso();
    vo.customerComment = comment || null;

    if (approve && vo.additionalCents > 0) {
      booking.price.totalCents += vo.additionalCents;
      booking.scope.text = `${booking.scope.text}\n\n[Variation ${vo.seq}, approved ${vo.decidedAt.slice(0, 10)}] ${vo.description}`;
      booking.scope.scopeHash = sha256(booking.scope.text);
      booking.scope.variationApprovedCents = (booking.scope.variationApprovedCents || 0) + vo.additionalCents;

      // Top up escrow so the extra work is funded before it is done.
      booking.escrowTopUpRequired = {
        amountCents: vo.additionalCents,
        reason: `Approved variation ${vo.seq}`,
        dueBy: addMinutes(nowIso(), this.kernel.escrow.fees.paymentWindowMinutes),
      };
      this.#notify(customerId, 'ESCROW_TOP_UP_REQUIRED', {
        title: `Add R${(vo.additionalCents / 100).toFixed(2)} to escrow`,
        body: `You approved the variation. Pay the extra into ${booking.escrowProvider} escrow so ${booking.proName} can proceed — the money is still only released on your confirmation.`,
        bookingId,
        amountCents: vo.additionalCents,
      });
    }

    booking.updatedAt = nowIso();
    this.kernel.ledger.append({
      action: `VARIATION_${vo.status}`,
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: {
        summary: `Customer ${approve ? 'approved' : 'rejected'} variation ${vo.seq}${approve ? ` (+R${(vo.additionalCents / 100).toFixed(2)})` : ''}`,
        variationId,
        additionalCents: approve ? vo.additionalCents : 0,
      },
    });
    if (!approve) {
      this.#notify(booking.proId, 'VARIATION_REJECTED', {
        title: 'Variation declined',
        body: `${booking.customerName} declined the extra R${(vo.additionalCents / 100).toFixed(2)}. Complete the original locked scope only — you are paid for that in full.`,
        bookingId,
        variationId,
      });
    }
    return deepClone({ booking, variation: vo });
  }

  /* ================================================================== *
   * CANCELLATION & REFUND
   * ================================================================== */

  cancel({ bookingId, actorId, role, reason }) {
    const booking = this.#booking(bookingId);
    const pro = this.store.get('pros', booking.proId);
    const escrowState = booking.escrowStatus;
    const workStarted = [BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.ON_SITE, BOOKING_STATUS.AWAITING_CONFIRMATION].includes(booking.status);

    // ECT Act s44 cooling-off: free before payment and before work starts.
    const freeToCancel = escrowState === ESCROW_STATUS.AWAITING_PAYMENT || (role === 'CUSTOMER' && !workStarted);

    const cancellation = {
      cancelledBy: role,
      actorId,
      reason,
      at: nowIso(),
      workStarted,
      freeToCancel,
      refundCents: 0,
      ectActSection44: freeToCancel
        ? 'Cancelled before the service began with the customer’s consent — no penalty.'
        : 'The service has begun with the customer’s consent, so the statutory 7-day cooling-off right no longer applies. Outcome assessed on evidence.',
    };

    if (escrowState === ESCROW_STATUS.FUNDED || escrowState === ESCROW_STATUS.FROZEN) {
      if (role === 'PRO') {
        cancellation.refundCents = booking.price.totalCents;
      } else if (!workStarted) {
        cancellation.refundCents = booking.price.totalCents;
      } else {
        // Partial: pay for work demonstrably done, refund the rest.
        const accepted = booking.milestones.filter((m) => m.status === MILESTONE_STATUS.ACCEPTED).reduce((s, m) => s + m.amountCents, 0);
        cancellation.refundCents = Math.max(0, booking.price.totalCents - accepted);
        cancellation.paidForCompletedMilestonesCents = accepted;
      }
      if (cancellation.refundCents > 0) {
        this.kernel.escrow.refund(booking.escrowId, { amountCents: cancellation.refundCents, reason, actorId });
      }
    }

    booking.status = cancellation.refundCents > 0 ? BOOKING_STATUS.REFUNDED : BOOKING_STATUS.CANCELLED;
    booking.escrowStatus = this.kernel.escrow.get(booking.escrowId).status;
    booking.cancellation = cancellation;
    booking.updatedAt = nowIso();

    const job = this.store.get('jobs', booking.jobId);
    if (job && role === 'PRO') {
      job.status = 'OPEN';
      job.awardedBidId = null;
      job.bookingId = null;
      pro.stats.cancellationCount += 1;
      this.kernel.risk.record(pro.proId, {
        type: 'NO_SHOW_PATTERN',
        severity: pro.stats.cancellationCount >= 3 ? 'HIGH' : 'MEDIUM',
        source: 'ProVeri booking history',
        message: `Cancelled an awarded booking (${pro.stats.cancellationCount} total)`,
        metadata: { bookingId },
      });
      // Reopen the job so the customer is not stranded — re-run matching.
      job.expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
      job.matchedProIds = [];
      this.#notify(job.customerId, 'JOB_REOPENED', {
        title: 'Your job has been reopened',
        body: `${booking.proName} cancelled. ${job.title} is live again and we have re-notified verified pros. You will be refunded in full — 5 to 10 business days.`,
        bookingId,
        jobId: job.jobId,
      });
    }

    this.kernel.ledger.append({
      action: 'BOOKING_CANCELLED',
      subject: bookingId,
      level: 'SAFETY',
      visibility: 'PUBLIC',
      payload: {
        summary: `Cancelled by ${role}: ${reason}. Refund R${(cancellation.refundCents / 100).toFixed(2)}.`,
        cancelledBy: role,
        workStarted,
        refundCents: cancellation.refundCents,
      },
    });

    const otherParty = role === 'CUSTOMER' ? booking.proId : booking.customerId;
    this.#notify(otherParty, 'BOOKING_CANCELLED', {
      title: 'Booking cancelled',
      body: `${reason}. ${cancellation.refundCents > 0 ? `R${(cancellation.refundCents / 100).toFixed(2)} refunded — 5 to 10 business days to settle.` : 'No refund was due.'}`,
      bookingId,
    });
    return deepClone(booking);
  }

  /* ================================================================== *
   * DISPUTES
   * ================================================================== */

  openDispute({ bookingId, openedBy, role, category, description, evidence = [], desiredOutcome }) {
    const booking = this.#booking(bookingId);
    const escrow = this.kernel.escrow.freeze(booking.escrowId, {
      reason: description,
      actorId: openedBy,
    });
    const disputeId = idFor('dispute');
    const reference = this.store.reference('DSP', 'dispute', 6);

    const dispute = {
      disputeId,
      reference,
      bookingId,
      bookingReference: booking.reference,
      openedBy,
      role,
      category: category || 'WORK_QUALITY',
      description,
      desiredOutcome: desiredOutcome || null,
      status: DISPUTE_STATUS.EVIDENCE_WINDOW,
      amountAtStakeCents: booking.price.totalCents,
      escrowFrozen: true,
      evidenceWindowClosesAt: addMinutes(nowIso(), 72 * 60),
      evidence: {
        [role === 'CUSTOMER' ? 'customer' : 'pro']: evidence.map((e) => ({ hash: sha256(e.hash || e), type: e.type || 'PHOTO', note: e.note || null, at: nowIso() })),
      },
      bookingEvidenceSeal: this.kernel.ledger.exportProof(bookingId).digest,
      timeline: [{ at: nowIso(), event: 'DISPUTE_OPENED', actor: role, note: description }],
      resolution: null,
      slaTargetHours: 48,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('disputes', disputeId, dispute);
    booking.disputeId = disputeId;
    booking.status = BOOKING_STATUS.DISPUTED;
    booking.escrowStatus = escrow.status;
    booking.updatedAt = nowIso();

    if (role === 'CUSTOMER') {
      const pro = this.store.get('pros', booking.proId);
      pro.stats.disputeCount += 1;
    }

    this.kernel.ledger.append({
      action: 'DISPUTE_OPENED',
      subject: bookingId,
      level: 'CRITICAL',
      visibility: 'PUBLIC',
      payload: {
        summary: `Dispute ${reference} opened by ${role}: ${category}. R${(booking.price.totalCents / 100).toFixed(2)} frozen. Both sides have 72 hours to submit evidence.`,
        disputeId,
        reference,
        category,
        amountAtStakeCents: booking.price.totalCents,
      },
    });
    this.kernel.ledger.append({ action: 'DISPUTE_OPENED', subject: disputeId, level: 'CRITICAL', visibility: 'PUBLIC', payload: { summary: `Dispute ${reference} opened`, bookingId } });

    const otherParty = role === 'CUSTOMER' ? booking.proId : booking.customerId;
    this.#notify(otherParty, 'DISPUTE_OPENED', {
      title: 'A dispute has been opened',
      body: `${description}. Your money is frozen and safe. You have 72 hours to submit your evidence — photos, messages and the proof-of-work record are already attached.`,
      bookingId,
      disputeId,
      evidenceWindowClosesAt: dispute.evidenceWindowClosesAt,
    });
    return deepClone(dispute);
  }

  submitDisputeEvidence({ disputeId, actorId, role, evidence, statement }) {
    const dispute = this.#dispute(disputeId);
    const key = role === 'CUSTOMER' ? 'customer' : 'pro';
    dispute.evidence[key] = [...(dispute.evidence[key] || []), ...evidence.map((e) => ({ hash: sha256(e.hash || e), type: e.type || 'PHOTO', note: e.note || null, at: nowIso() }))];
    dispute.statements = { ...(dispute.statements || {}), [key]: statement || dispute.statements?.[key] || null };
    dispute.timeline.push({ at: nowIso(), event: 'EVIDENCE_SUBMITTED', actor: role, note: `${evidence.length} item(s)` });
    if (dispute.evidence.customer && dispute.evidence.pro) dispute.status = DISPUTE_STATUS.UNDER_REVIEW;
    dispute.updatedAt = nowIso();
    this.kernel.ledger.append({
      action: 'DISPUTE_EVIDENCE_SUBMITTED',
      subject: disputeId,
      visibility: 'PUBLIC',
      payload: { summary: `${role} submitted ${evidence.length} evidence item(s)`, role, count: evidence.length },
    });
    return deepClone(dispute);
  }

  /**
   * Resolve a dispute. Evidence-weighted: the audit chain decides who has
   * geotagged proof, check-ins and an accepted scope. This is why keeping
   * everything in-app is not a nice-to-have — it is the evidence.
   */
  resolveDispute({ disputeId, resolvedBy, outcome, splitPercent = null, reasoning, refundCents = null }) {
    const dispute = this.#dispute(disputeId);
    const booking = this.#booking(dispute.bookingId);
    if (dispute.status === DISPUTE_STATUS.RESOLVED) throw new Error('dispute already resolved');

    const evidence = this.#weighDisputeEvidence(booking, dispute);
    let amountToPro = 0;
    let amountToCustomer = booking.price.totalCents;

    switch (outcome) {
      case DISPUTE_OUTCOME.RELEASE_TO_PRO:
        amountToPro = booking.price.totalCents; amountToCustomer = 0; break;
      case DISPUTE_OUTCOME.REFUND_CUSTOMER:
        amountToPro = 0; amountToCustomer = booking.price.totalCents; break;
      case DISPUTE_OUTCOME.PARTIAL:
      case DISPUTE_OUTCOME.SPLIT_COSTS: {
        const pct = clamp(Number(splitPercent) || 50, 0, 100);
        amountToPro = percentageOf(booking.price.totalCents, pct);
        amountToCustomer = booking.price.totalCents - amountToPro;
        break;
      }
      case DISPUTE_OUTCOME.REDO_WORK:
        amountToPro = 0;
        amountToCustomer = 0; // stays frozen until the redo is accepted
        break;
      default:
        throw new Error(`unknown dispute outcome: ${outcome}`);
    }

    const refundAmount = refundCents != null ? clamp(refundCents, 0, booking.price.totalCents) : amountToCustomer;

    dispute.resolution = {
      outcome,
      reasoning,
      resolvedBy,
      resolvedAt: nowIso(),
      amountToProCents: amountToPro,
      refundToCustomerCents: refundAmount,
      evidenceWeighting: evidence,
      redoDeadline: outcome === DISPUTE_OUTCOME.REDO_WORK ? addDays(nowIso(), 7) : null,
    };
    dispute.status = DISPUTE_STATUS.RESOLVED;
    dispute.timeline.push({ at: nowIso(), event: 'DISPUTE_RESOLVED', actor: resolvedBy, note: `${outcome}: ${reasoning}` });
    dispute.updatedAt = nowIso();

    this.kernel.escrow.unfreeze(booking.escrowId, { reason: 'Dispute resolved', disputeId });

    // The freeze marked open milestones DISPUTED so nothing could move. Now that
    // the desk has ruled, restore them so the ruling can actually be executed.
    const restored = this.kernel.escrow.restoreDisputedMilestones(booking.escrowId, { reason: `dispute ${dispute.reference} resolved` });
    booking.milestones = restored.plan.milestones.map((m) => ({ ...m }));

    if (refundAmount > 0) {
      this.kernel.escrow.refund(booking.escrowId, { amountCents: refundAmount, reason: `Dispute ${dispute.reference} — ${outcome}`, actorId: resolvedBy });
    }
    if (amountToPro > 0) {
      // Force-release the pro's share through the normal path.
      for (const milestone of booking.milestones) {
        if (milestone.status !== MILESTONE_STATUS.ACCEPTED && milestone.status !== MILESTONE_STATUS.RELEASED) {
          this.kernel.escrow.acceptMilestone(booking.escrowId, milestone.milestoneId, { actorId: resolvedBy, comment: `Accepted by dispute resolution ${dispute.reference}` });
        }
      }
      this.releasePayment({ bookingId: booking.bookingId, triggeredBy: `DISPUTE_${outcome}` });
    }

    booking.status = outcome === DISPUTE_OUTCOME.REDO_WORK
      ? BOOKING_STATUS.IN_PROGRESS
      : refundAmount >= booking.price.totalCents ? BOOKING_STATUS.REFUNDED : BOOKING_STATUS.COMPLETED;
    booking.escrowStatus = this.kernel.escrow.get(booking.escrowId).status;
    booking.updatedAt = nowIso();

    const pro = this.store.get('pros', booking.proId);
    if (outcome === DISPUTE_OUTCOME.REFUND_CUSTOMER) pro.stats.disputeLostCount += 1;

    this.kernel.ledger.append({
      action: 'DISPUTE_RESOLVED',
      subject: disputeId,
      level: 'CRITICAL',
      visibility: 'PUBLIC',
      payload: {
        summary: `Dispute ${dispute.reference} resolved: ${outcome}. R${(amountToPro / 100).toFixed(2)} to the pro, R${(refundAmount / 100).toFixed(2)} refunded. ${reasoning}`,
        outcome,
        amountToProCents: amountToPro,
        refundToCustomerCents: refundAmount,
        evidenceWeighting: evidence.summary,
      },
    });
    this.kernel.ledger.append({ action: 'DISPUTE_RESOLVED', subject: booking.bookingId, level: 'CRITICAL', visibility: 'PUBLIC', payload: { summary: `Dispute resolved: ${outcome}`, disputeId } });

    for (const party of [booking.customerId, booking.proId]) {
      this.#notify(party, 'DISPUTE_RESOLVED', {
        title: 'Dispute resolved',
        body: `${outcome.replace(/_/g, ' ').toLowerCase()}. ${reasoning} ${refundAmount > 0 ? `R${(refundAmount / 100).toFixed(2)} refunded — 5 to 10 business days.` : ''}`,
        bookingId: booking.bookingId,
        disputeId,
      });
    }
    return deepClone({ dispute, booking });
  }

  /**
   * Evidence weighting. Objective and explainable — both parties see it.
   */
  #weighDisputeEvidence(booking, dispute) {
    const evidence = booking.evidence || [];
    const geoVerified = evidence.filter((e) => e.geoVerified === true).length;
    const geoFailed = evidence.filter((e) => e.geoVerified === false).length;
    const checkIns = booking.checkIns.length;
    const acceptedMilestones = booking.milestones.filter((m) => m.status === MILESTONE_STATUS.ACCEPTED).length;
    const variationApprovals = booking.variationOrders.filter((v) => v.status === 'APPROVED').length;
    const unapprovedScopeChange = booking.variationOrders.filter((v) => v.status === 'REJECTED').length;

    const proPoints = geoVerified * 12 + checkIns * 6 + acceptedMilestones * 20 + variationApprovals * 5;
    const customerPoints = geoFailed * 25 + unapprovedScopeChange * 20
      + (checkIns === 0 ? 20 : 0)
      + (evidence.length === 0 ? 30 : 0)
      + (booking.arrival.verified === false && booking.schedule.arrivedAt ? 15 : 0);

    const total = proPoints + customerPoints || 1;
    return {
      proPoints,
      customerPoints,
      proSharePercent: Math.round((proPoints / total) * 100),
      factors: {
        geotaggedEvidenceItems: geoVerified,
        evidenceFailedGeoseal: geoFailed,
        checkInsRecorded: checkIns,
        milestonesAcceptedByCustomer: acceptedMilestones,
        variationsApproved: variationApprovals,
        variationsRejected: unapprovedScopeChange,
        arrivalCodeVerified: booking.arrival.verified,
        auditChainSeal: booking.bookingEvidenceSeal || this.kernel.ledger.exportProof(booking.bookingId).digest,
      },
      summary: `Pro evidence weight ${proPoints} vs customer evidence weight ${customerPoints} (${Math.round((proPoints / total) * 100)}% in the pro's favour).`,
      note: 'Weighting is published to both parties and every input is a hash-sealed ledger entry, so the outcome is auditable rather than arbitrary.',
    };
  }

  /* ================================================================== *
   * REVIEWS
   * ================================================================== */

  /**
   * REV-001: reviews only from escrow-released jobs. This is the whole point of
   * the verified-review claim — enforced in code, not in a terms-of-service PDF.
   */
  writeReview({ bookingId, customerId, rating, comment, photos = [], tags = [], visible = true, proResponse = null }) {
    const booking = this.#booking(bookingId);
    if (booking.customerId !== customerId) throw new Error('only the customer on this booking can review it');
    if (booking.reviewId) throw new Error('this booking has already been reviewed');

    // The policy gate — throws unless the escrow reached a terminal state.
    this.kernel.policy.enforce('review', {
      subjectId: bookingId,
      booking: { ...booking, escrowStatus: booking.escrowStatus },
    });

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new Error('rating must be between 1 and 5');

    const pro = this.store.get('pros', booking.proId);
    const reviewId = idFor('review');
    const review = {
      reviewId,
      bookingId,
      bookingReference: booking.reference,
      jobId: booking.jobId,
      customerId,
      customerFirstName: booking.customerName.split(' ')[0],
      proId: booking.proId,
      proName: booking.proName,
      categoryId: booking.categoryId,
      categoryLabel: booking.categoryLabel,
      suburb: booking.address.suburb,
      metro: booking.address.metro,
      rating: clamp(Math.round(rating * 2) / 2, 1, 5),
      comment: String(comment || '').trim().slice(0, 2000),
      tags: tags.slice(0, 8),
      photos: photos.map((p) => ({ hash: sha256(p.hash || p), capturedAt: p.capturedAt || nowIso() })),
      jobValueCents: booking.price.totalCents,
      verified: true,
      verificationBasis: 'Escrow-released booking — the reviewer paid for this work through ProVeri',
      evidenceSeal: this.kernel.ledger.exportProof(bookingId).digest.slice(0, 16),
      warrantyDefects: booking.warranty.defectsReported.length,
      variations: booking.variationOrders.length,
      disputeId: booking.disputeId,
      proResponse,
      visible,
      helpfulCount: 0,
      createdAt: nowIso(),
    };

    this.store.put('reviews', reviewId, review);
    booking.reviewId = reviewId;
    booking.updatedAt = nowIso();

    const all = this.store.find('reviews', (r) => r.proId === booking.proId && r.visible !== false);
    pro.stats.reviewCount = all.length;
    pro.stats.averageRating = Number((all.reduce((s, r) => s + r.rating, 0) / all.length).toFixed(2));
    pro.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'VERIFIED_REVIEW_PUBLISHED',
      subject: booking.proId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${review.rating}★ verified review on ${booking.reference} — ${pro.stats.averageRating}★ average from ${pro.stats.reviewCount} review(s)`,
        reviewId,
        rating: review.rating,
        verifiedBasis: review.verificationBasis,
      },
    });
    this.kernel.ledger.append({
      action: 'VERIFIED_REVIEW_PUBLISHED',
      subject: bookingId,
      visibility: 'PUBLIC',
      payload: { summary: `${review.rating}★ review published`, reviewId },
    });

    this.#notify(booking.proId, 'NEW_REVIEW', {
      title: `New ${review.rating}★ verified review`,
      body: `${review.customerFirstName}: "${review.comment.slice(0, 120)}${review.comment.length > 120 ? '…' : ''}" Your average is now ${pro.stats.averageRating}★ from ${pro.stats.reviewCount} review(s).`,
      reviewId,
      bookingId,
    });
    return deepClone(review);
  }

  respondToReview({ reviewId, proId, response }) {
    const review = this.store.get('reviews', reviewId);
    if (!review) throw new Error(`review ${reviewId} not found`);
    if (review.proId !== proId) throw new Error('only the reviewed pro can respond');
    review.proResponse = { text: String(response).slice(0, 1500), at: nowIso() };
    this.kernel.ledger.append({
      action: 'REVIEW_RESPONSE_PUBLISHED',
      subject: reviewId,
      visibility: 'PUBLIC',
      payload: { summary: `${review.proName} responded to a ${review.rating}★ review` },
    });
    return deepClone(review);
  }

  /**
   * Fake-review detection. Reviews are already gated on escrow release, but a
   * customer and pro can collude, so we look for the patterns anyway.
   */
  detectReviewManipulation(proId) {
    const reviews = this.store.find('reviews', (r) => r.proId === proId);
    const findings = [];
    const customers = reviews.map((r) => r.customerId);
    const uniqueCustomers = new Set(customers).size;

    if (reviews.length >= 5 && uniqueCustomers <= 2) {
      findings.push({ code: 'REPEATED_REVIEWER', severity: 'HIGH', detail: `${reviews.length} reviews from only ${uniqueCustomers} customer account(s)` });
    }
    const sameDay = reviews.filter((r) => r.createdAt.slice(0, 10) === nowIso().slice(0, 10));
    if (sameDay.length >= 4) {
      findings.push({ code: 'REVIEW_BURST', severity: 'MEDIUM', detail: `${sameDay.length} reviews published today` });
    }
    const tinyJobs = reviews.filter((r) => r.jobValueCents < 5000 && r.rating === 5);
    if (tinyJobs.length >= 3) {
      findings.push({ code: 'MICRO_JOB_FIVE_STARS', severity: 'MEDIUM', detail: `${tinyJobs.length} five-star reviews on jobs under R50 — a common self-booking pattern` });
    }
    for (const finding of findings) {
      this.kernel.risk.record(proId, {
        type: 'FAKE_REVIEW_CLUSTER',
        severity: finding.severity,
        source: 'ProVeri review-integrity scan',
        message: `${finding.code}: ${finding.detail}`,
        metadata: finding,
      });
    }
    return { proId, reviewsAnalysed: reviews.length, findings, clean: findings.length === 0 };
  }

  /* ================================================================== *
   * MESSAGING (with off-platform detection)
   * ================================================================== */

  sendMessage({ bookingId, fromUserId, body, attachments = [] }) {
    const booking = this.#booking(bookingId);
    const participants = [booking.customerId, booking.proId];
    if (!participants.includes(fromUserId)) throw new Error('you are not a participant on this booking');

    const decision = this.kernel.policy.evaluate('message', {
      subjectId: bookingId,
      message: { body, fromUserId },
      booking,
    });

    const message = {
      messageId: idFor('message'),
      bookingId,
      fromUserId,
      fromRole: fromUserId === booking.customerId ? 'CUSTOMER' : 'PRO',
      body: String(body).slice(0, 4000),
      attachments: attachments.map((a) => ({ hash: sha256(a.hash || a), type: a.type || 'PHOTO' })),
      flagged: decision.decision !== POLICY_EFFECT.ALLOW,
      flagRules: decision.firedRules.map((r) => ({ ruleId: r.ruleId, reason: r.reason })),
      quarantined: decision.decision === POLICY_EFFECT.FREEZE,
      createdAt: nowIso(),
    };
    this.store.put('messages', message.messageId, message);
    booking.messages.push(message.messageId);
    booking.updatedAt = nowIso();

    if (message.flagged) {
      this.kernel.risk.record(fromUserId, {
        type: 'OFF_PLATFORM_PAYMENT_REQUEST',
        severity: decision.decision === POLICY_EFFECT.FREEZE ? 'HIGH' : 'MEDIUM',
        source: 'ProVeri message policy OFP-001',
        message: decision.firedRules.map((r) => r.reason).join('; '),
        metadata: { bookingId, messageId: message.messageId },
      });
      this.#notify(fromUserId === booking.customerId ? booking.proId : booking.customerId, 'OFF_PLATFORM_WARNING', {
        title: 'Heads up — this message looks like it is moving off ProVeri',
        body: 'If someone asks you to pay cash, EFT into a personal account or continue on WhatsApp, you lose every ProVeri protection: escrow, the 14-day workmanship warranty and the dispute centre. Report it in one tap.',
        bookingId,
        messageId: message.messageId,
      });
    }
    this.#notify(fromUserId === booking.customerId ? booking.proId : booking.customerId, 'NEW_MESSAGE', {
      title: `New message on ${booking.reference}`,
      body: message.body.slice(0, 140),
      bookingId,
      messageId: message.messageId,
    });
    return deepClone(message);
  }

  listMessages(bookingId, { userId } = {}) {
    const booking = this.#booking(bookingId);
    if (userId && ![booking.customerId, booking.proId].includes(userId)) throw new Error('not a participant on this booking');
    return booking.messages
      .map((id) => this.store.get('messages', id))
      .filter(Boolean)
      .map((m) => deepClone(m));
  }

  /* ================================================================== *
   * QUERIES
   * ================================================================== */

  #booking(bookingId) {
    const booking = this.store.get('bookings', bookingId);
    if (!booking) throw new Error(`booking ${bookingId} not found`);
    return booking;
  }

  #dispute(disputeId) {
    const dispute = this.store.get('disputes', disputeId);
    if (!dispute) throw new Error(`dispute ${disputeId} not found`);
    return dispute;
  }

  getBooking(bookingId, { viewerId, includeEscrow = true } = {}) {
    const booking = this.#booking(bookingId);
    const pro = this.store.get('pros', booking.proId);
    const reviews = this.store.find('reviews', (r) => r.bookingId === bookingId);
    const escrow = includeEscrow ? this.kernel.escrow.get(booking.escrowId) : null;
    const payout = booking.payoutId ? this.store.get('payouts', booking.payoutId) : null;
    const dispute = booking.disputeId ? this.store.get('disputes', booking.disputeId) : null;

    return deepClone({
      ...booking,
      escrow: escrow ? {
        status: escrow.status,
        provider: escrow.providerLabel,
        amountCents: escrow.amountCents,
        funded: escrow.funded,
        autoReleaseAt: escrow.autoReleaseAt,
        holdbackReleaseAt: escrow.holdbackReleaseAt,
        fees: escrow.fees,
        milestones: escrow.plan.milestones,
        releases: escrow.releases,
        refunds: escrow.refunds,
        partnerEvents: escrow.partnerEvents,
        integritySeal: escrow.integrity?.slice(0, 16),
      } : null,
      pro: pro ? {
        proId: pro.proId,
        name: pro.displayName,
        badge: pro.badge,
        trustScore: pro.trustScore,
        certificationBody: pro.certification.body,
        insured: Boolean(pro.insurance.policyNumber),
        completedJobs: pro.stats.completedJobs,
        averageRating: pro.stats.averageRating,
        micrositeUrl: pro.micrositeUrl,
      } : null,
      payout,
      dispute,
      reviews,
      auditTrail: this.kernel.ledger.publicTimeline(bookingId),
      proofDigest: this.kernel.ledger.exportProof(bookingId).digest.slice(0, 16),
    });
  }

  listBookings({ customerId, proId, status, limit = 50 } = {}) {
    let rows = this.store.all('bookings');
    if (customerId) rows = rows.filter((b) => b.customerId === customerId);
    if (proId) rows = rows.filter((b) => b.proId === proId);
    if (status) rows = Array.isArray(status) ? rows.filter((b) => status.includes(b.status)) : rows.filter((b) => b.status === status);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows.slice(0, limit).map((b) => ({
      bookingId: b.bookingId,
      reference: b.reference,
      title: b.title,
      categoryLabel: b.categoryLabel,
      status: b.status,
      escrowStatus: b.escrowStatus,
      proName: b.proName,
      proBadge: b.proBadge,
      customerName: b.customerName,
      totalCents: b.price.totalCents,
      suburb: b.address.suburb,
      metro: b.address.metro,
      scheduledAt: b.schedule.scheduledAt,
      autoReleaseAt: b.autoReleaseAt,
      warrantyEndsAt: b.warranty.endsAt,
      gateCode: b.arrival.gateCode,
      evidenceCount: b.evidence.length,
      reviewId: b.reviewId,
      disputeId: b.disputeId,
      createdAt: b.createdAt,
    }));
  }

  listDisputes({ status, bookingId, proId, customerId } = {}) {
    let rows = this.store.all('disputes');
    if (status) rows = rows.filter((d) => d.status === status);
    if (bookingId) rows = rows.filter((d) => d.bookingId === bookingId);
    if (proId || customerId) {
      rows = rows.filter((d) => {
        const booking = this.store.get('bookings', d.bookingId);
        return booking && (booking.proId === proId || booking.customerId === customerId);
      });
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((d) => deepClone(d));
  }

  listReviews({ proId, categoryId, suburbId, minRating, limit = 50 } = {}) {
    let rows = this.store.all('reviews').filter((r) => r.visible !== false);
    if (proId) rows = rows.filter((r) => r.proId === proId);
    if (categoryId) rows = rows.filter((r) => r.categoryId === categoryId);
    if (suburbId) rows = rows.filter((r) => r.suburb === this.catalog.suburb(suburbId)?.name);
    if (minRating) rows = rows.filter((r) => r.rating >= minRating);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((r) => deepClone(r));
  }

  walletFor(userId) {
    const wallet = this.#wallet(userId);
    const escrows = this.kernel.escrow.list({ providerId: userId }).concat(this.kernel.escrow.list({ customerId: userId }));
    return deepClone({
      ...wallet,
      heldInEscrowCents: escrows.filter((e) => [ESCROW_STATUS.FUNDED, ESCROW_STATUS.FROZEN].includes(e.status)).reduce((s, e) => s + e.amountCents, 0),
      recentTransactions: wallet.transactions.slice(-20).reverse(),
      rails: Object.values(PAYOUT_RAILS),
    });
  }

  /**
   * SARS-ready income summary for a pro. Independent contractors on gig
   * platforms are routinely caught out at provisional tax; this removes the
   * surprise and is a genuine reason to stay on ProVeri.
   */
  taxSummary(proId, { taxYear } = {}) {
    const year = taxYear || (new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1);
    const start = `${year}-03-01`;
    const end = `${year + 1}-02-28`;
    const payouts = this.store.find('payouts', (p) => p.proId === proId && p.instructedAt >= start && p.instructedAt <= `${end}T23:59:59Z`);
    const gross = payouts.reduce((s, p) => s + p.grossCents, 0);
    const net = payouts.reduce((s, p) => s + p.amountCents, 0);
    const fees = payouts.reduce((s, p) => s + p.platformFeeCents, 0);
    const provisionalTaxDue = [`${year}-08-31`, `${year + 1}-02-28`];

    return {
      proId,
      taxYear: `${year}/${String(year + 1).slice(2)}`,
      period: { start, end },
      source: 'Lula ProVeri escrow ledger — every figure is a hash-sealed release event',
      grossJobValueCents: gross,
      platformFeesCents: fees,
      netReceivedCents: net,
      pendingHoldbackCents: this.#wallet(proId).pendingHoldbackCents,
      jobCount: payouts.length,
      breakdownByMonth: payouts.reduce((acc, p) => {
        const month = p.instructedAt.slice(0, 7);
        acc[month] = (acc[month] || 0) + p.amountCents;
        return acc;
      }, {}),
      sarsNotes: {
        status: 'Independent contractor — not an employee of Lula ProVeri.',
        obligations: [
          'Income must be declared on ITR12 (individual) or ITR14 (company).',
          'Provisional tax IRP6 is due twice a year.',
          'VAT registration is compulsory above R1,000,000 turnover in any 12-month period (voluntary above R50,000).',
          'Platform fees are a deductible business expense.',
        ],
        provisionalTaxDeadlines: provisionalTaxDue,
        vatThresholdCents: 100_000_000,
        vatVoluntaryThresholdCents: 5_000_000,
        vatStatus: gross >= 100_000_000 ? 'COMPULSORY_REGISTRATION_REQUIRED' : gross >= 5_000_000 ? 'VOLUNTARY_REGISTRATION_AVAILABLE' : 'BELOW_THRESHOLD',
      },
      exportFormats: ['CSV', 'PDF', 'JSON'],
      generatedAt: nowIso(),
      seal: sha256({ proId, year, gross, fees, net }),
    };
  }

  #notify(userId, type, payload) {
    const notification = {
      notificationId: idFor('notification'),
      userId,
      type,
      title: payload.title,
      body: payload.body,
      data: { ...payload, title: undefined, body: undefined },
      read: false,
      channels: ['IN_APP'].concat(['NEW_BID', 'BOOKING_CONFIRMED', 'ESCROW_FUNDED', 'PAYOUT_RELEASED', 'DISPUTE_OPENED', 'WORK_SUBMITTED_FOR_CONFIRMATION', 'NEW_JOB_MATCH'].includes(type) ? ['PUSH', 'SMS'] : []),
      createdAt: nowIso(),
    };
    this.store.put('notifications', notification.notificationId, notification);
    return notification;
  }

  /**
   * Scheduler sweep: auto-release lapsed confirmation windows, close matured
   * warranties, expire stale jobs. Run by the server timer and exposed as
   * POST /api/scheduler/run so the PWA can trigger it in a demo.
   */
  runScheduler() {
    const autoReleases = this.kernel.escrow.runAutoReleaseSweep();
    for (const released of autoReleases) {
      const booking = this.store.get('bookings', released.bookingId);
      if (!booking) continue;
      const escrow = this.kernel.escrow.get(booking.escrowId);
      const split = escrow.releases.at(-1)?.split;
      if (split) {
        booking.status = BOOKING_STATUS.IN_WARRANTY;
        booking.warranty.startsAt = nowIso();
        booking.warranty.endsAt = escrow.holdbackReleaseAt;
        const pro = this.store.get('pros', booking.proId);
        this.#createPayout({ booking, pro, split, triggeredBy: 'CONFIRMATION_WINDOW_LAPSED', releaseReference: escrow.releases.at(-1).reference });
        pro.stats.completedJobs += 1;
        pro.stats.totalEarnedCents += split.immediateToProCents;
        this.#notify(booking.customerId, 'AUTO_RELEASED', {
          title: 'Payment released automatically',
          body: `You did not confirm or dispute ${booking.title} within the ${escrow.confirmationWindowMinutes / 60}-hour window, so payment was released to ${booking.proName} as per the platform terms. You are still covered by the ${booking.warranty.days}-day workmanship warranty.`,
          bookingId: booking.bookingId,
        });
      }
      booking.escrowStatus = escrow.status;
      booking.autoReleaseAt = null;
      booking.updatedAt = nowIso();
      this.kernel.ledger.append({
        action: 'AUTO_RELEASE_APPLIED',
        subject: booking.bookingId,
        visibility: 'PUBLIC',
        payload: { summary: `Confirmation window lapsed — payment auto-released to ${booking.proName}`, triggeredBy: 'CONFIRMATION_WINDOW_LAPSED' },
      });
    }

    // Matured warranties with no open defect.
    const warrantyClosed = [];
    for (const booking of this.store.all('bookings')) {
      if (booking.status !== BOOKING_STATUS.IN_WARRANTY || !booking.warranty.endsAt) continue;
      if (new Date(booking.warranty.endsAt).getTime() > Date.now()) continue;
      if (booking.warranty.defectsReported.some((d) => d.status === 'OPEN')) continue;
      try {
        this.closeWarranty({ bookingId: booking.bookingId });
        warrantyClosed.push(booking.bookingId);
      } catch { /* holdback already released */ }
    }

    // Expire stale disputes past the evidence window.
    const disputesEscalated = [];
    for (const dispute of this.store.all('disputes')) {
      if (dispute.status !== DISPUTE_STATUS.EVIDENCE_WINDOW) continue;
      if (new Date(dispute.evidenceWindowClosesAt).getTime() > Date.now()) continue;
      dispute.status = DISPUTE_STATUS.UNDER_REVIEW;
      dispute.timeline.push({ at: nowIso(), event: 'EVIDENCE_WINDOW_CLOSED', actor: 'system', note: 'Escalated to the Lula dispute desk for review' });
      disputesEscalated.push(dispute.disputeId);
    }

    return { autoReleases, warrantyClosed, disputesEscalated, jobsExpired: this.jobs.expireStaleJobs() };
  }

  stats() {
    const bookings = this.store.all('bookings');
    const disputes = this.store.all('disputes');
    const reviews = this.store.all('reviews');
    const durations = bookings
      .filter((b) => b.schedule.arrivedAt && b.schedule.confirmedAt)
      .map((b) => (new Date(b.schedule.confirmedAt) - new Date(b.schedule.arrivedAt)) / 3600000);
    return {
      totalBookings: bookings.length,
      completed: bookings.filter((b) => [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.IN_WARRANTY, BOOKING_STATUS.CLOSED].includes(b.status)).length,
      active: bookings.filter((b) => ![BOOKING_STATUS.CANCELLED, BOOKING_STATUS.REFUNDED, BOOKING_STATUS.CLOSED].includes(b.status)).length,
      disputed: bookings.filter((b) => b.status === BOOKING_STATUS.DISPUTED).length,
      cancelled: bookings.filter((b) => b.status === BOOKING_STATUS.CANCELLED).length,
      refunded: bookings.filter((b) => b.status === BOOKING_STATUS.REFUNDED).length,
      disputeRate: bookings.length ? Number(((disputes.length / bookings.length) * 100).toFixed(1)) : 0,
      reviewCount: reviews.length,
      averageRating: reviews.length ? Number((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2)) : null,
      medianJobHours: durations.length ? Number(median(durations).toFixed(1)) : null,
      warrantyHoldbackReleasedCents: bookings.filter((b) => b.warranty.released).reduce((sum, b) => sum + (b.warranty.holdbackCents || 0), 0),
      warrantyHoldbackStillHeldCents: bookings.filter((b) => b.status === BOOKING_STATUS.IN_WARRANTY).reduce((sum, b) => sum + (b.warranty.holdbackCents || 0), 0),
      variationOrders: bookings.reduce((s, b) => s + b.variationOrders.length, 0),
      gateCodesVerified: bookings.filter((b) => b.arrival.verified).length,
      escrow: this.kernel.escrow.portfolioStats(),
    };
  }
}

function JOB_STATUS_AWARDED() {
  return 'AWARDED';
}

module.exports = { BookingService, BOOKING_STATUS, DISPUTE_STATUS, DISPUTE_OUTCOME, EVIDENCE_TYPES };
