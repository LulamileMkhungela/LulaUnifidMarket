'use strict';

/**
 * ProVeri — Jobs, matching and bidding.
 *
 * This is where ProVeri beats the incumbents on the two things South Africans
 * actually complain about:
 *
 *   1. QUOTE SPEED. Snupit and Kandua take 4–24 hours. ProVeri runs matching
 *      the instant a job is posted and pushes to every eligible verified pro in
 *      radius, so the median first bid lands in minutes, not hours.
 *   2. QUOTE HONESTY. Every bid is annotated with Fair-Price Intelligence from
 *      real ProVeri bids in that metro, plus the pro's trust score, statutory
 *      certification status and whether a CoC is included. No more "R450 callout"
 *      that becomes R6,800 on the day.
 *
 * Matching is deliberately explainable: every candidate gets a score with a
 * breakdown, and the breakdown is shown to the customer. Locality and crime
 * data are excluded from the score by design (see the fairness guard in the
 * risk engine).
 */

const { idFor, nextId, nowIso, sha256, deepClone, clamp, distanceKm, median, percentageOf, normalizeMobile, normalizeEmail } = require('../kernel/util');
const { CHECK_STATUS, BADGE } = require('../kernel/verification');
const { WEATHER, HOLIDAYS } = require('../integrations/publicData');
const { LOAD_SHEDDING } = require('../integrations/verificationSources');
const { MARKET } = require('../integrations/context');

const MAX_JOB_PHOTO_DATAURL = 1_200_000;   // ~900 KB of image; the PWA compresses well under this

const JOB_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  BIDDING: 'BIDDING',
  AWARDED: 'AWARDED',
  PAID: 'PAID',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  REMOVED: 'REMOVED',
});

const BID_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  SHORTLISTED: 'SHORTLISTED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  WITHDRAWN: 'WITHDRAWN',
  BEATEN: 'BEATEN',
  EXPIRED: 'EXPIRED',
});

const URGENCY = Object.freeze({
  EMERGENCY: { id: 'EMERGENCY', label: 'Emergency — today', multiplier: 1.5, windowHours: 4 },
  URGENT: { id: 'URGENT', label: 'Urgent — within 48 hours', multiplier: 1.25, windowHours: 48 },
  SOON: { id: 'SOON', label: 'This week', multiplier: 1.0, windowHours: 168 },
  FLEXIBLE: { id: 'FLEXIBLE', label: 'Flexible dates', multiplier: 0.9, windowHours: 720 },
  SCHEDULED: { id: 'SCHEDULED', label: 'Scheduled maintenance', multiplier: 1.0, windowHours: 336 },
});

class JobService {
  constructor({ store, kernel, catalog, people }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.people = people;
  }

  /* ================================================================== *
   * POSTING
   * ================================================================== */

  /**
   * Post a job. Returns the job plus everything the customer needs to
   * understand what happens next: matched pros, price guidance, weather and
   * load-shedding advice, and the safety plan.
   */
  async postJob({
    customerId, categoryId, title, description, suburbId, addressText, locationType,
    budgetCents, urgency = 'SOON', preferredDates = [], photos = [], accessNotes,
    householdNotes = {}, materialsCashCents = 0, instantBook = false,
    remoteDelivery = false, maxBids = 8, bidWindowHours = 48, referralCode, source = 'PWA',
  }) {
    const customer = this.store.get('customers', customerId);
    if (!customer) throw new Error(`customer ${customerId} not found`);
    const category = this.catalog.get(categoryId);
    const suburb = this.catalog.suburb(suburbId) || (addressText ? await this.#resolveSuburb(addressText) : null);

    // Policy: statutory trades need a certified pro. We do not block the *post*
    // (customers may describe anything) but we do constrain who can win it.
    const policyDecision = this.kernel.policy.evaluate('job', {
      subjectId: null,
      category: { statutoryTrade: category.statutoryTrade, requiresCoc: category.requiresCoc, label: category.label, trade: category.trade, regulator: category.regulator },
      job: { description, budgetCents, instantBook },
    });

    const inHome = locationType === 'IN_HOME' || category.inHomeDefault;
    const jobId = idFor('job');
    const reference = this.store.reference('JOB', 'job', 6);

    const job = {
      jobId,
      reference,
      vertical: 'services',
      customerId,
      customerName: customer.fullName,
      categoryId,
      categoryLabel: category.label,
      trade: category.trade,
      statutoryTrade: category.statutoryTrade,
      requiresCoc: category.requiresCoc,
      cocName: category.cocName,
      title: title || category.commonJobs[0],
      description: String(description || '').trim(),
      descriptionHash: sha256(description || ''),

      location: {
        suburbId: suburb?.id || null,
        suburb: suburb?.name || null,
        metroId: suburb?.metroId || null,
        metro: suburb?.metroName || null,
        province: suburb?.province || null,
        addressText: addressText || suburb?.name || null,
        lat: suburb?.lat ?? null,
        lon: suburb?.lon ?? null,
        locationType: locationType || (category.remoteDelivery ? 'REMOTE' : inHome ? 'IN_HOME' : 'ON_SITE'),
        accessNotes: accessNotes || null,
      },

      budget: {
        statedCents: budgetCents ?? null,
        materialsCashCents: materialsCashCents || 0,
        currency: 'ZAR',
        flexible: budgetCents == null,
      },

      urgency: URGENCY[urgency] ? URGENCY[urgency].id : 'SOON',
      urgencyLabel: (URGENCY[urgency] || URGENCY.SOON).label,
      preferredDates,
      photos: (photos || []).slice(0, 6).map((p) => {
        const dataUrl = typeof p === 'object' && p && typeof p.dataUrl === 'string' && p.dataUrl.length <= MAX_JOB_PHOTO_DATAURL ? p.dataUrl : null;
        const url = typeof p === 'object' && p && typeof p.url === 'string' ? p.url : null;
        return {
          photoId: nextId('evd'),
          hash: typeof p === 'string' ? sha256(p) : sha256(dataUrl || url || p.hash || p),
          dataUrl,
          url,
          caption: (typeof p === 'object' && p && p.caption) || null,
          capturedAt: (typeof p === 'object' && p && p.capturedAt) || nowIso(),
          geo: (typeof p === 'object' && p && p.geo) || null,
        };
      }),
      householdNotes: {
        childrenOnPremises: Boolean(householdNotes.childrenOnPremises ?? category.childrenDefault),
        petsOnPremises: Boolean(householdNotes.petsOnPremises),
        vulnerableOccupants: Boolean(householdNotes.vulnerableOccupants ?? category.vulnerableDefault ?? customer.vulnerableHousehold),
        parkingAvailable: householdNotes.parkingAvailable !== false,
        electricitySupply: householdNotes.electricitySupply || 'GRID',
        note: householdNotes.note || null,
      },

      instantBook: Boolean(instantBook && category.instantBook),
      remoteDelivery: Boolean(remoteDelivery && category.remoteDelivery),
      maxBids: clamp(Number(maxBids) || 8, 1, 20),
      status: JOB_STATUS.OPEN,
      bidWindowHours: clamp(Number(bidWindowHours) || 48, 1, 336),
      bids: [],
      bidCount: 0,
      shortlist: [],
      awardedBidId: null,
      bookingId: null,
      matchedProIds: [],
      matchReport: null,
      priceBand: null,
      weatherAdvice: null,
      loadSheddingAdvice: null,
      holidayAdvice: null,
      safetyPlan: null,
      views: 0,
      shares: 0,
      policyDecision,
      source,
      referralCode: referralCode || null,
      postedAt: nowIso(),
      expiresAt: new Date(Date.now() + (URGENCY[urgency]?.windowHours || 48) * 3600 * 1000).toISOString(),
      updatedAt: nowIso(),
    };

    // Context enrichment: the differentiating layer.
    job.priceBand = this.catalog.priceGuidance(categoryId, suburb?.metroId, { scopeText: job.description });
    job.weatherAdvice = await this.#weatherAdvice(job, category);
    job.loadSheddingAdvice = await this.#loadSheddingAdvice(job, category);
    job.holidayAdvice = await this.#holidayAdvice(job);
    job.safetyPlan = this.kernel.risk.safetyPlan(jobId, {
      booking: { locationType: job.location.locationType, householdNotes: job.householdNotes, scheduledAt: job.preferredDates[0] },
      customer,
      locality: suburb ? { suburb: suburb.name, crimeIndex: 0 } : null,
    });

    // Persist first so matching and notifications can read the job back.
    this.store.put('jobs', jobId, job);

    // Match immediately — this is what makes quotes arrive in minutes.
    const match = await this.matchPros(jobId);
    job.matchedProIds = match.candidates.map((c) => c.proId);
    job.matchReport = match;
    this.kernel.ledger.append({
      action: 'JOB_POSTED',
      subject: jobId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${job.title} posted in ${job.location.suburb || job.location.metro || 'South Africa'} · ${match.candidates.length} verified pro(s) notified`,
        reference,
        category: category.label,
        metro: job.location.metro,
        matchedPros: match.candidates.length,
        budgetCents: job.budget.statedCents,
        instantBook: job.instantBook,
        statutoryTrade: category.statutoryTrade,
      },
    });

    // Notify matched pros.
    for (const candidate of match.candidates) {
      this.#notify(candidate.proId, 'NEW_JOB_MATCH', {
        title: `New ${category.label} job near you`,
        body: `${job.title} · ${job.location.suburb || job.location.metro} · ${job.urgencyLabel}`,
        jobId,
        reference,
        matchScore: candidate.score,
      });
    }
    this.#notify(customerId, 'JOB_POSTED', {
      title: 'Your job is live',
      body: `${match.candidates.length} verified ${category.label} pro(s) have been notified. Bids usually arrive within ${match.expectedFirstBidMinutes} minutes.`,
      jobId,
      reference,
    });

    return deepClone(job);
  }

  async #resolveSuburb(addressText) {
    const geo = await this.catalog.geocodeAddress(addressText);
    if (!geo || (!geo.suburbId && geo.lat == null)) return null;
    if (geo.suburbId) return this.catalog.suburb(geo.suburbId);
    const nearby = this.catalog.suburbsWithinKm({ lat: geo.lat, lon: geo.lon }, 8);
    return nearby[0] ? this.catalog.suburb(nearby[0].id) : null;
  }

  async #weatherAdvice(job, category) {
    if (!category.weatherSensitive || job.location.lat == null) return null;
    const forecast = await WEATHER.forecast({ lat: job.location.lat, lon: job.location.lon, days: 7 });
    return WEATHER.jobDayAdvice(forecast, category);
  }

  async #loadSheddingAdvice(job, category) {
    const status = await LOAD_SHEDDING.nationalStatus({ token: process.env.ESP_API_TOKEN });
    if (category.powerDependency === 'NONE' || category.powerDependency === 'LOW') {
      return {
        powerDependency: category.powerDependency,
        nationalStage: status.national?.stage ?? 0,
        recommendedSlots: [],
        advice: status.national?.active
          ? `Stage ${status.national.stage} load shedding is active nationally, but this job does not depend on grid power.`
          : 'No load-shedding risk for this job.',
        live: status.live,
      };
    }
    const schedule = await LOAD_SHEDDING.areaSchedule({
      suburb: job.location.suburb,
      metro: job.location.metro,
      token: process.env.ESP_API_TOKEN,
    });
    return LOAD_SHEDDING.recommendSlots({
      schedule,
      category,
      status,
      durationHours: category.typicalDurationHours || 2,
      fromIso: job.preferredDates[0] || nowIso(),
      toIso: job.expiresAt,
    });
  }

  async #holidayAdvice(job) {
    const year = new Date().getFullYear();
    const data = await HOLIDAYS.forYear(year);
    const dates = job.preferredDates.length ? job.preferredDates : [new Date().toISOString().slice(0, 10)];
    return {
      live: data.live,
      source: data.source,
      days: dates.map((date) => ({ ...HOLIDAYS.adviceForDate(date, data), payday: HOLIDAYS.paydayContext(date) })),
      upcomingPublicHolidays: data.holidays
        .filter((h) => new Date(h.date).getTime() > Date.now())
        .slice(0, 4)
        .map((h) => ({ date: h.date, name: h.englishName, impact: h.impact })),
    };
  }

  /* ================================================================== *
   * MATCHING
   * ================================================================== */

  /**
   * Score every active pro against a job. Weights are explicit and shown to
   * the customer — "why was this pro recommended?" is answerable.
   */
  async matchPros(jobId, { limit = 12 } = {}) {
    const job = this.store.get('jobs', jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    const category = this.catalog.get(job.categoryId);
    const now = Date.now();

    const pool = this.store.all('pros').filter((pro) => {
      if (pro.status !== 'ACTIVE' || !pro.canBid) return false;
      if (pro.primaryCategory !== job.categoryId && !pro.additionalCategories.includes(job.categoryId)) return false;
      if (job.remoteDelivery) return true;
      if (job.location.lat == null || pro.location.lat == null) return pro.location.metroId === job.location.metroId;
      const km = distanceKm({ lat: job.location.lat, lon: job.location.lon }, { lat: pro.location.lat, lon: pro.location.lon });
      return km <= Math.max(pro.location.serviceRadiusKm, 10);
    });

    const candidates = pool.map((pro) => {
      const km = job.location.lat != null && pro.location.lat != null
        ? Number(distanceKm({ lat: job.location.lat, lon: job.location.lon }, { lat: pro.location.lat, lon: pro.location.lon }).toFixed(1))
        : null;

      const breakdown = {
        // Trust is the largest single factor — this is a trust marketplace.
        trustScore: Math.round((pro.trustScore || 0) * 0.30),
        // Distance decay: 0 km = 100, falls to ~20 at the edge of the radius.
        proximity: km == null ? 12 : Math.round(clamp(100 - km * 3.2, 10, 100) * 0.20),
        // Delivery history, capped so a new pro is not invisible forever.
        experience: Math.round(clamp((pro.stats.completedJobs || 0) * 6, 0, 100) * 0.15),
        // Rating, with a low-sample correction (3 reviews at 5.0 ≠ 200 reviews at 4.8).
        rating: this.#ratingScore(pro) * 0.15,
        // Can they actually take this slot?
        availability: this.#availabilityScore(pro, job) * 0.10,
        // Statutory readiness: certified trades jump ahead where the law requires it.
        certification: category.statutoryTrade ? (this.#hasCertificate(pro) ? 100 : 0) * 0.10 : 60 * 0.10,
      };
      const score = Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0));

      const flags = [];
      if (category.statutoryTrade && !this.#hasCertificate(pro)) flags.push({ kind: 'BLOCKING', code: 'NO_STATUTORY_CERTIFICATE', message: `${category.regulator?.body || 'The issuing body'} registration is not on file — cannot be awarded this job` });
      if (category.requiresCoc && !this.#hasCertificate(pro)) flags.push({ kind: 'BLOCKING', code: 'COC_REQUIRED', message: `${category.cocName} is required for this scope` });
      if (pro.stats.completedJobs < 3) flags.push({ kind: 'INFO', code: 'NEWLY_VERIFIED', message: 'Newly verified — full KYC passed but fewer than 3 completed jobs on ProVeri' });
      if (!pro.insurance.policyNumber && category.riskLevel === 'HIGH') flags.push({ kind: 'WARN', code: 'NO_INSURANCE', message: 'No public liability insurance on file for a high-risk trade' });
      if (pro.riskAssessment && ['HIGH', 'CRITICAL'].includes(pro.riskAssessment.tier)) flags.push({ kind: 'BLOCKING', code: 'RISK_TIER', message: 'Flagged by the ProVeri risk engine — hidden from matching until reviewed' });
      if (km != null && km <= 3) flags.push({ kind: 'GOOD', code: 'VERY_CLOSE', message: `Only ${km} km away` });
      if (pro.pricing.instantBook) flags.push({ kind: 'GOOD', code: 'INSTANT_BOOK', message: 'Instant book available — fixed callout and hourly rate' });
      if (pro.badge === BADGE.PROVERI_ELITE) flags.push({ kind: 'GOOD', code: 'ELITE', message: 'ProVeri Elite — top 8% trust score with no warnings' });

      const eligible = !flags.some((f) => f.kind === 'BLOCKING');

      return {
        proId: pro.proId,
        name: pro.displayName,
        slug: pro.slug,
        badge: pro.badge,
        trustScore: pro.trustScore,
        distanceKm: km,
        score: eligible ? score : 0,
        eligible,
        breakdown,
        flags,
        averageRating: pro.stats.averageRating,
        reviewCount: pro.stats.reviewCount,
        completedJobs: pro.stats.completedJobs,
        responseMedianMinutes: pro.stats.responseMedianMinutes,
        insured: Boolean(pro.insurance.policyNumber),
        certificationBody: pro.certification.body,
        instantBook: pro.pricing.instantBook,
        hourlyRateCents: pro.pricing.hourlyRateCents,
        calloutFeeCents: pro.pricing.calloutFeeCents,
        suburb: pro.location.suburb,
        whyRecommended: this.#explainRecommendation(pro, breakdown, km, category),
      };
    });

    const ranked = candidates
      .filter((c) => c.eligible)
      .sort((a, b) => b.score - a.score || (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
      .slice(0, limit);

    const blocked = candidates.filter((c) => !c.eligible);
    const responseTimes = ranked.map((c) => c.responseMedianMinutes).filter(Boolean);

    return {
      jobId,
      categoryId: job.categoryId,
      poolSize: pool.length,
      eligible: ranked.length,
      blocked: blocked.length,
      blockedReasons: blocked.reduce((acc, b) => {
        for (const flag of b.flags.filter((f) => f.kind === 'BLOCKING')) acc[flag.code] = (acc[flag.code] || 0) + 1;
        return acc;
      }, {}),
      candidates: ranked,
      expectedFirstBidMinutes: ranked.length === 0
        ? null
        : responseTimes.length ? Math.round(median(responseTimes)) : Math.max(5, Math.round(60 / Math.max(ranked.length, 1))),
      fairness: {
        statement: 'Ranking uses trust score, distance, delivery history, verified rating, availability and statutory certification. It never uses the customer’s suburb, income band, race, gender or published crime statistics.',
        excludedInputs: ['suburb income band', 'crime index', 'customer demographics', 'bid history with other platforms'],
      },
      computedAt: nowIso(),
      durationMs: Date.now() - now,
    };
  }

  #ratingScore(pro) {
    const count = pro.stats.reviewCount || 0;
    const average = pro.stats.averageRating || 0;
    if (count === 0) return 45; // neutral-ish so new pros are not invisible
    // Wilson-style shrinkage toward 3.8 for small samples.
    const prior = 3.8;
    const shrunk = (average * count + prior * 3) / (count + 3);
    return clamp(Math.round(((shrunk - 1) / 4) * 100), 0, 100);
  }

  #availabilityScore(pro, job) {
    const target = job.preferredDates?.[0];
    if (!target) return 85;
    const date = new Date(`${String(target).slice(0, 10)}T09:00:00`);
    const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()];
    const worksThatDay = pro.availability.workingDays.includes(day);
    const load = pro.availability.bookedSlots?.filter((s) => String(s).startsWith(String(target).slice(0, 10))).length || 0;
    return clamp((worksThatDay ? 80 : 15) - load * 18 + (pro.availability.afterHoursEmergency && job.urgency === 'EMERGENCY' ? 20 : 0), 0, 100);
  }

  #hasCertificate(pro) {
    const check = pro.verification?.checks?.find((c) => c.name === 'trade_certification');
    return Boolean(check && [CHECK_STATUS.PASS, CHECK_STATUS.WARN].includes(check.status) && (check.reference || check.evidenceHash));
  }

  #explainRecommendation(pro, breakdown, km, category) {
    const parts = [];
    if (pro.badge === BADGE.PROVERI_ELITE) parts.push('ProVeri Elite trust rating');
    else if (pro.trustScore >= 85) parts.push(`trust score ${pro.trustScore}/100`);
    if (km != null) parts.push(`${km} km away`);
    if (pro.stats.completedJobs >= 5) parts.push(`${pro.stats.completedJobs} escrow-released jobs`);
    if (pro.stats.averageRating && pro.stats.reviewCount >= 3) parts.push(`${pro.stats.averageRating}★ from ${pro.stats.reviewCount} verified reviews`);
    if (category.statutoryTrade && this.#hasCertificate(pro)) parts.push(`${pro.certification.body || category.regulator?.body} registered`);
    if (pro.insurance.policyNumber) parts.push('public liability insured');
    if (pro.pricing.instantBook) parts.push('instant book available');
    return parts.length ? parts.join(' · ') : 'Verified and available in your area';
  }

  /* ================================================================== *
   * BIDDING
   * ================================================================== */

  /**
   * Submit a bid. Policy KYC-001 refuses bids from unverified pros; PCE-001
   * annotates price anomalies; ECC-001 requires a CoC commitment for trades
   * that need one.
   */
  submitBid({ jobId, proId, totalCents, calloutFeeCents = 0, materialsQuoteCents = 0, scopeOfWork, inclusions = [], exclusions = [], scheduledAt, durationHours, includesCoc = false, message, warrantyDays = 14, lineItems = [] }) {
    const job = this.store.get('jobs', jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    if (![JOB_STATUS.OPEN, JOB_STATUS.BIDDING].includes(job.status)) {
      throw new Error(`this job is ${job.status} and is no longer accepting bids`);
    }
    const pro = this.store.get('pros', proId);
    if (!pro) throw new Error(`pro ${proId} not found`);
    if (job.bidCount >= job.maxBids) throw new Error(`this job already has the maximum ${job.maxBids} bids`);
    if (this.store.findOne('bids', (b) => b.jobId === jobId && b.proId === proId && b.status !== BID_STATUS.WITHDRAWN)) {
      throw new Error('you have already bid on this job — update your existing bid instead');
    }

    const category = this.catalog.get(job.categoryId);

    // KYC-001: no bidding without verified identity.
    this.kernel.policy.enforce('bid', { subjectId: proId, pro, category, job, bid: { totalCents, includesCoc } });
    // ECC-001: statutory trades must commit to the certificate.
    if (category.requiresCoc && !includesCoc) {
      throw new Error(`${category.cocName} must be included in your bid for this scope`);
    }
    // TRD-001: statutory trade work needs a certificate on file.
    this.kernel.policy.enforce('booking', { subjectId: jobId, category, pro, booking: null, bid: { totalCents, includesCoc } });

    if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error('totalCents must be a positive integer');

    const band = job.priceBand || this.catalog.priceBand(job.categoryId, job.location.metroId);
    const priceAssessment = MARKET.assessBid(totalCents, band, { categoryLabel: category.label, metro: job.location.metro });
    if (priceAssessment.riskFlag) {
      this.kernel.risk.record(proId, {
        type: priceAssessment.riskFlag,
        severity: priceAssessment.riskFlag === 'PRICE_ANOMALY_LOW' ? 'MEDIUM' : 'LOW',
        source: 'ProVeri Fair-Price Intelligence',
        message: priceAssessment.headline,
        metadata: { jobId, totalCents, bandMedianCents: band.p50Cents },
      });
    }

    const bidId = idFor('bid');
    const reference = this.store.reference('BID', 'bid', 6);
    const bid = {
      bidId,
      reference,
      jobId,
      proId,
      proName: pro.displayName,
      proBadge: pro.badge,
      proTrustScore: pro.trustScore,
      categoryId: job.categoryId,
      metroId: job.location.metroId,
      status: BID_STATUS.SUBMITTED,
      totalCents,
      labourCents: totalCents - materialsQuoteCents - calloutFeeCents,
      calloutFeeCents,
      materialsQuoteCents,
      currency: 'ZAR',
      scopeOfWork: String(scopeOfWork || '').trim(),
      scopeHash: sha256({ scopeOfWork, inclusions, exclusions, totalCents }),
      inclusions,
      exclusions,
      lineItems: lineItems.map((item, index) => ({ seq: index + 1, label: item.label, cents: item.cents, optional: Boolean(item.optional) })),
      scheduledAt: scheduledAt || null,
      durationHours: durationHours || category.typicalDurationHours,
      includesCoc,
      cocName: category.cocName,
      warrantyDays,
      message: message || null,
      priceAssessment,
      responseMinutes: pro.stats.responseMedianMinutes ? Math.round(pro.stats.responseMedianMinutes) : null,
      validUntil: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      customerViewed: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('bids', bidId, bid);
    job.bids.push(bidId);
    job.bidCount += 1;
    if (job.status === JOB_STATUS.OPEN) job.status = JOB_STATUS.BIDDING;
    job.updatedAt = nowIso();

    if (!pro.stats.firstResponseMinutes) {
      pro.stats.firstResponseMinutes = [];
    }
    pro.stats.firstResponseMinutes.push(Math.round((Date.now() - new Date(job.postedAt).getTime()) / 60000));
    pro.stats.firstResponseMedianMinutes = median(pro.stats.firstResponseMinutes);
    pro.stats.responseMedianMinutes = median(pro.stats.firstResponseMinutes);

    this.kernel.ledger.append({
      action: 'BID_SUBMITTED',
      subject: jobId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${pro.displayName} bid R${(totalCents / 100).toFixed(2)} · ${priceAssessment.headline || 'in market band'}`,
        bidId,
        reference,
        proId,
        totalCents,
        priceVerdict: priceAssessment.verdict,
        includesCoc,
        bidCount: job.bidCount,
      },
    });
    this.kernel.ledger.append({
      action: 'BID_SUBMITTED',
      subject: proId,
      visibility: 'INTERNAL',
      payload: { summary: `Bid ${reference} on ${job.reference}`, jobId, totalCents },
    });

    this.#notify(job.customerId, 'NEW_BID', {
      title: `New bid on ${job.title}`,
      body: `${pro.displayName} (${pro.badge.replace(/_/g, ' ').toLowerCase()}, ${pro.trustScore}/100) bid R${(totalCents / 100).toFixed(2)}. ${priceAssessment.headline || ''}`,
      jobId,
      bidId,
      reference: job.reference,
    });

    return deepClone(bid);
  }

  /** Customer updates their job description — every existing bid must be re-consented. */
  amendJob(jobId, { description, title, budgetCents, preferredDates, photos, actorId }) {
    const job = this.store.get('jobs', jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    if (job.status === JOB_STATUS.AWARDED || job.status === JOB_STATUS.PAID) {
      throw new Error('This job is already awarded — use a variation order on the booking instead.');
    }
    const changes = [];
    if (description && description !== job.description) {
      changes.push({ field: 'description', before: job.description, after: description });
      job.description = description;
      job.descriptionHash = sha256(description);
    }
    if (title && title !== job.title) { changes.push({ field: 'title', before: job.title, after: title }); job.title = title; }
    if (budgetCents != null && budgetCents !== job.budget.statedCents) {
      changes.push({ field: 'budgetCents', before: job.budget.statedCents, after: budgetCents });
      job.budget.statedCents = budgetCents;
      job.budget.flexible = false;
    }
    if (preferredDates) { changes.push({ field: 'preferredDates', before: job.preferredDates, after: preferredDates }); job.preferredDates = preferredDates; }
    if (changes.length === 0) return { amended: false, job: deepClone(job) };

    job.amendments = [...(job.amendments || []), { at: nowIso(), actorId, changes, seal: sha256({ changes, at: nowIso() }) }];
    job.amended = true;
    job.updatedAt = nowIso();

    // Fairness: pros who already bid were quoting a different scope.
    const affected = [];
    for (const bidId of job.bids) {
      const bid = this.store.get('bids', bidId);
      if (!bid || [BID_STATUS.WITHDRAWN, BID_STATUS.DECLINED].includes(bid.status)) continue;
      bid.requiresReconsent = true;
      bid.reconsentReason = 'The customer amended the job after this bid was placed';
      affected.push(bidId);
      this.#notify(bid.proId, 'BID_RECONSENT_REQUIRED', {
        title: 'Job amended — please confirm your bid still stands',
        body: `${job.customerName} changed ${changes.map((c) => c.field).join(', ')} on ${job.reference}. Your bid stays visible but is marked as quoted against the earlier description.`,
        jobId,
        bidId,
      });
    }

    this.kernel.ledger.append({
      action: 'JOB_AMENDED',
      subject: jobId,
      visibility: 'PUBLIC',
      payload: {
        summary: `Job amended (${changes.map((c) => c.field).join(', ')}) — ${affected.length} existing bid(s) flagged for re-consent`,
        changes: changes.map((c) => ({ field: c.field })),
        affectedBids: affected.length,
      },
    });
    return { amended: true, changes, affectedBids: affected, job: deepClone(job) };
  }

  /**
   * "Beat this quote" — the customer invites competing bids on a specific bid.
   * Creates a bounded re-bid window; the original bid stays live until beaten.
   */
  beatTheQuote({ jobId, targetBidId, customerNote, windowHours = 24, notifyCount = 6 }) {
    const job = this.store.get('jobs', jobId);
    const target = this.store.get('bids', targetBidId);
    if (!job || !target) throw new Error('job or bid not found');
    if (![JOB_STATUS.OPEN, JOB_STATUS.BIDDING].includes(job.status)) throw new Error('this job is no longer open for bidding');

    const pool = this.store.all('pros').filter((pro) =>
      pro.status === 'ACTIVE' && pro.canBid
      && (pro.primaryCategory === job.categoryId || pro.additionalCategories.includes(job.categoryId))
      && pro.proId !== target.proId
      && !job.bids.some((bidId) => this.store.get('bids', bidId)?.proId === pro.proId));

    const band = job.priceBand || this.catalog.priceBand(job.categoryId, job.location.metroId);
    const targetToBeatCents = Math.min(target.totalCents, band.p50Cents);

    const invited = pool
      .map((pro) => ({ pro, km: job.location.lat != null && pro.location.lat != null ? distanceKm({ lat: job.location.lat, lon: job.location.lon }, { lat: pro.location.lat, lon: pro.location.lon }) : 999 }))
      .sort((a, b) => (b.pro.trustScore - a.pro.trustScore) || (a.km - b.km))
      .slice(0, notifyCount);

    for (const { pro } of invited) {
      this.#notify(pro.proId, 'BEAT_THE_QUOTE_INVITE', {
        title: `Beat this quote: ${job.title}`,
        body: `A customer in ${job.location.suburb || job.location.metro} has a ${job.categoryLabel} bid at R${(target.totalCents / 100).toFixed(2)}. Undercut it with your verified trust score and you can win the job outright. Window closes in ${windowHours}h.`,
        jobId,
        targetBidId,
        targetToBeatCents,
        marketMedianCents: band.p50Cents,
      });
    }

    job.beatTheQuote = {
      openedAt: nowIso(),
      closesAt: new Date(Date.now() + windowHours * 3600 * 1000).toISOString(),
      targetBidId,
      targetToBeatCents,
      invitedProIds: invited.map((i) => i.proId),
      customerNote: customerNote || null,
    };
    job.maxBids = Math.max(job.maxBids, job.bidCount + invited.length);
    job.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'BEAT_THE_QUOTE_OPENED',
      subject: jobId,
      visibility: 'PUBLIC',
      payload: {
        summary: `Customer invited ${invited.length} pro(s) to beat a R${(target.totalCents / 100).toFixed(2)} bid`,
        targetBidId,
        invited: invited.length,
        closesAt: job.beatTheQuote.closesAt,
      },
    });
    return deepClone(job.beatTheQuote);
  }

  /** Instant book: skip bidding entirely at a published fixed price. */
  instantQuote({ jobId, proId }) {
    const job = this.store.get('jobs', jobId);
    const pro = this.store.get('pros', proId);
    if (!job || !pro) throw new Error('job or pro not found');
    if (!pro.pricing.instantBook || !pro.pricing.hourlyRateCents) throw new Error('this pro does not offer instant booking');
    const category = this.catalog.get(job.categoryId);
    const callout = pro.pricing.calloutFeeCents ?? category.calloutFeeCents.min;
    const firstHour = pro.pricing.hourlyRateCents;
    const totalCents = callout + firstHour;
    return {
      jobId,
      proId,
      kind: 'INSTANT_BOOK',
      calloutFeeCents: callout,
      firstHourCents: firstHour,
      totalCents,
      display: `R${(callout / 100).toFixed(0)} callout + R${(firstHour / 100).toFixed(0)}/hour`,
      terms: 'The callout and first hour are fixed. Any additional time is quoted in-app and needs your approval before the pro continues — the escrow amount is adjusted and you re-confirm.',
      warrantyDays: 14,
      includesCoc: category.requiresCoc ? this.#hasCertificate(pro) : false,
      quotedAt: nowIso(),
    };
  }

  /* ================================================================== *
   * QUERIES
   * ================================================================== */

  getJob(jobId, { viewerId } = {}) {
    const job = this.store.get('jobs', jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    job.views += 1;
    const bids = job.bids.map((bidId) => this.store.get('bids', bidId)).filter(Boolean);
    const isCustomer = viewerId === job.customerId;
    const isBidder = bids.some((b) => b.proId === viewerId);

    return deepClone({
      ...job,
      bids: bids.map((bid) => this.#viewBid(bid, job, { isCustomer, isBidder, viewerId })).sort((a, b) => b.totalCents - a.totalCents && a.createdAt.localeCompare(b.createdAt)),
      bidSummary: {
        count: bids.length,
        lowestCents: bids.length ? Math.min(...bids.map((b) => b.totalCents)) : null,
        highestCents: bids.length ? Math.max(...bids.map((b) => b.totalCents)) : null,
        medianCents: bids.length ? median(bids.map((b) => b.totalCents)) : null,
        verifiedPros: bids.filter((b) => b.proTrustScore >= 75).length,
        withCoc: bids.filter((b) => b.includesCoc).length,
      },
    });
  }

  /**
   * Bid visibility rules: a customer sees everything; a competing pro sees only
   * that a bid exists and the market band — never a rival's price or scope.
   */
  #viewBid(bid, job, { isCustomer, isBidder, viewerId }) {
    const isOwn = bid.proId === viewerId;
    if (isCustomer || isOwn) return bid;
    if (isBidder) {
      return {
        bidId: bid.bidId,
        status: bid.status,
        proName: 'Another verified pro',
        masked: true,
        note: 'Competing bid prices are hidden until the job is awarded — this stops pros anchoring on each other instead of quoting honestly.',
      };
    }
    return { bidId: bid.bidId, status: bid.status, masked: true };
  }

  getBid(bidId) {
    const bid = this.store.get('bids', bidId);
    if (!bid) throw new Error(`bid ${bidId} not found`);
    return deepClone(bid);
  }

  listJobs({ customerId, proId, status, categoryId, metroId, limit = 50 } = {}) {
    let rows = this.store.all('jobs');
    if (customerId) rows = rows.filter((j) => j.customerId === customerId);
    if (proId) rows = rows.filter((j) => j.matchedProIds.includes(proId) || j.bids.some((bidId) => this.store.get('bids', bidId)?.proId === proId));
    if (status) rows = rows.filter((j) => j.status === status);
    if (categoryId) rows = rows.filter((j) => j.categoryId === categoryId);
    if (metroId) rows = rows.filter((j) => j.location.metroId === metroId);
    rows.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return rows.slice(0, limit).map((j) => ({
      jobId: j.jobId,
      reference: j.reference,
      title: j.title,
      categoryId: j.categoryId,
      categoryLabel: j.categoryLabel,
      excerpt: j.description ? (j.description.length > 160 ? `${j.description.slice(0, 157).trimEnd()}…` : j.description) : null,
      urgencyId: j.urgency,
      status: j.status,
      suburb: j.location.suburb,
      metro: j.location.metro,
      urgency: j.urgencyLabel,
      bidCount: j.bidCount,
      budgetCents: j.budget.statedCents,
      priceBandFormat: j.priceBand?.format,
      instantBook: j.instantBook,
      statutoryTrade: j.statutoryTrade,
      postedAt: j.postedAt,
      expiresAt: j.expiresAt,
      awardedBidId: j.awardedBidId,
      bookingId: j.bookingId,
      // For a pro's lead list: their own quote on this job, if any.
      ...(proId ? { myBid: this.#myBid(j, proId) } : {}),
    }));
  }

  #myBid(job, proId) {
    const bid = job.bids.map((id) => this.store.get('bids', id)).find((b) => b && b.proId === proId && b.status !== BID_STATUS.WITHDRAWN);
    return bid ? { bidId: bid.bidId, status: bid.status, totalCents: bid.totalCents, createdAt: bid.createdAt } : null;
  }

  listBids({ jobId, proId, status } = {}) {
    let rows = this.store.all('bids');
    if (jobId) rows = rows.filter((b) => b.jobId === jobId);
    if (proId) rows = rows.filter((b) => b.proId === proId);
    if (status) rows = rows.filter((b) => b.status === status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => deepClone(b));
  }

  withdrawBid(bidId, { reason }) {
    const bid = this.store.get('bids', bidId);
    if (!bid) throw new Error(`bid ${bidId} not found`);
    if (bid.status === BID_STATUS.ACCEPTED) throw new Error('An accepted bid cannot be withdrawn — cancel the booking instead, which refunds the customer in full.');
    bid.status = BID_STATUS.WITHDRAWN;
    bid.withdrawReason = reason || null;
    bid.updatedAt = nowIso();
    const job = this.store.get('jobs', bid.jobId);
    if (job) job.bidCount = Math.max(0, job.bidCount - 1);
    this.kernel.ledger.append({
      action: 'BID_WITHDRAWN',
      subject: bid.jobId,
      visibility: 'PUBLIC',
      payload: { summary: `${bid.proName} withdrew their bid${reason ? `: ${reason}` : ''}`, bidId },
    });
    return deepClone(bid);
  }

  /**
   * The homeowner changed their mind — one tap, no phone calls, no fee.
   * Allowed while the job is still open for quotes; once a bid is accepted
   * there is a booking, and the booking cancellation (with the ECT Act s44
   * cooling-off refund) is the right door.
   */
  cancelJob({ jobId, customerId, reason }) {
    const job = this.store.get('jobs', jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    if (job.customerId !== customerId) {
      const error = new Error('only the homeowner who posted this job can cancel it');
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (![JOB_STATUS.OPEN, JOB_STATUS.BIDDING, JOB_STATUS.EXPIRED].includes(job.status)) {
      if (job.bookingId) throw new Error('This job is booked — cancel from the job tracker instead; you get a full refund before work starts.');
      throw new Error(`a ${job.status} job cannot be cancelled`);
    }

    job.status = JOB_STATUS.CANCELLED;
    job.cancelledAt = nowIso();
    job.cancellationReason = String(reason || '').trim().slice(0, 500) || null;
    job.updatedAt = nowIso();

    // Close out live quotes so no pro keeps working on a dead lead.
    const notifiedPros = [];
    for (const bidId of job.bids) {
      const bid = this.store.get('bids', bidId);
      if (!bid || [BID_STATUS.WITHDRAWN, BID_STATUS.EXPIRED, BID_STATUS.DECLINED].includes(bid.status)) continue;
      bid.status = BID_STATUS.EXPIRED;
      bid.withdrawReason = 'Job cancelled by the homeowner';
      bid.updatedAt = nowIso();
      this.#notify(bid.proId, 'JOB_CANCELLED', {
        title: `${job.reference} was cancelled`,
        body: `${job.customerName.split(' ')[0]} cancelled “${job.title}”, so your quote is closed. Nothing to do — we will send you new matches in your area.`,
        jobId,
      });
      notifiedPros.push(bid.proId);
    }

    this.kernel.ledger.append({
      action: 'JOB_CANCELLED',
      subject: jobId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${job.reference} cancelled by the homeowner${job.cancellationReason ? `: ${job.cancellationReason}` : ''} — ${notifiedPros.length} quote(s) closed`,
        bidCount: job.bidCount,
        quotesClosed: notifiedPros.length,
      },
    });
    return deepClone(job);
  }

  expireStaleJobs() {
    const now = Date.now();
    const expired = [];
    for (const job of this.store.all('jobs')) {
      if (job.status !== JOB_STATUS.OPEN && job.status !== JOB_STATUS.BIDDING) continue;
      if (new Date(job.expiresAt).getTime() > now) continue;
      job.status = JOB_STATUS.EXPIRED;
      job.updatedAt = nowIso();
      for (const bidId of job.bids) {
        const bid = this.store.get('bids', bidId);
        if (bid && bid.status === BID_STATUS.SUBMITTED) bid.status = BID_STATUS.EXPIRED;
      }
      expired.push(job.jobId);
      this.kernel.ledger.append({
        action: 'JOB_EXPIRED',
        subject: job.jobId,
        visibility: 'PUBLIC',
        payload: { summary: `${job.reference} expired with ${job.bidCount} bid(s) and no award`, bidCount: job.bidCount },
      });
    }
    return { expiredCount: expired.length, jobIds: expired };
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
      channels: this.#channelsFor(type),
      createdAt: nowIso(),
    };
    this.store.put('notifications', notification.notificationId, notification);
    return notification;
  }

  #channelsFor(type) {
    const inApp = ['IN_APP'];
    if (['NEW_JOB_MATCH', 'NEW_BID', 'ESCROW_FUNDED', 'BOOKING_CONFIRMED', 'DISPUTE_OPENED', 'BEAT_THE_QUOTE_INVITE', 'PAYOUT_RELEASED'].includes(type)) {
      return [...inApp, 'PUSH', 'SMS'];
    }
    return inApp;
  }

  notificationsFor(userId, { unreadOnly = false, limit = 50 } = {}) {
    let rows = this.store.find('notifications', (n) => n.userId === userId);
    if (unreadOnly) rows = rows.filter((n) => !n.read);
    const when = (n) => String(n.createdAt || n.at || '');
    return rows.sort((a, b) => when(b).localeCompare(when(a))).slice(0, limit).map((n) => deepClone(n));
  }

  markNotificationRead(notificationId) {
    const notification = this.store.get('notifications', notificationId);
    if (!notification) throw new Error(`notification ${notificationId} not found`);
    notification.read = true;
    return deepClone(notification);
  }

  /** Marketplace telemetry for the public transparency page and investors. */
  stats() {
    const jobs = this.store.all('jobs');
    const bids = this.store.all('bids');
    const firstResponse = bids.map((b) => b.responseMinutes).filter(Boolean);
    return {
      jobsPosted: jobs.length,
      jobsOpen: jobs.filter((j) => [JOB_STATUS.OPEN, JOB_STATUS.BIDDING].includes(j.status)).length,
      jobsAwarded: jobs.filter((j) => [JOB_STATUS.AWARDED, JOB_STATUS.PAID, JOB_STATUS.IN_PROGRESS, JOB_STATUS.COMPLETED].includes(j.status)).length,
      jobsCompleted: jobs.filter((j) => j.status === JOB_STATUS.COMPLETED).length,
      bidsSubmitted: bids.length,
      medianFirstBidMinutes: firstResponse.length ? median(firstResponse) : null,
      medianBidCents: bids.length ? median(bids.map((b) => b.totalCents)) : null,
      totalBidValueCents: bids.reduce((sum, b) => sum + b.totalCents, 0),
      categoriesActive: new Set(jobs.map((j) => j.categoryId)).size,
      metrosActive: new Set(jobs.map((j) => j.location.metroId).filter(Boolean)).size,
      statutoryTradeShare: jobs.length ? Math.round((jobs.filter((j) => j.statutoryTrade).length / jobs.length) * 100) : 0,
      instantBookShare: jobs.length ? Math.round((jobs.filter((j) => j.instantBook).length / jobs.length) * 100) : 0,
    };
  }
}

module.exports = { JobService, JOB_STATUS, BID_STATUS, URGENCY };
