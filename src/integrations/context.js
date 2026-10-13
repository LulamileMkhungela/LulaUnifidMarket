'use strict';

/**
 * ProVeri — Market, safety and municipal context adapters.
 *
 * Public statistics are used for two purposes only:
 *   1. MARKET INTELLIGENCE — honest price bands so customers can spot a bait
 *      bid and pros can see what the metro actually pays.
 *   2. SAFETY FRICTION — extra verification steps before a stranger enters a
 *      home.
 *
 * They are never used to rank, price-discriminate, or decide who may work where.
 * The fairness guard in `src/kernel/risk.js` throws if anyone tries.
 */

const { request } = require('./httpClient');
const { sha256, nowIso, median, percentile, clamp } = require('../kernel/util');

/* ==================================================================== *
 * 1. MARKET INTELLIGENCE — platform bids + Stats SA CPI
 * ==================================================================== */

const MARKET = {
  id: 'market',
  label: 'Fair-Price Intelligence',
  providers: [{
    name: 'ProVeri bid ledger (first-party)',
    endpoint: 'internal — src/marketplace/matching.js',
    auth: 'none',
    note: 'Every bid placed on the platform, in rand, per category per metro. This is the moat: nobody else in South Africa has escrow-confirmed, non-negotiated prices.',
  }, {
    name: 'Statistics South Africa — CPI (P0141)',
    endpoint: 'https://www.statssa.gov.za/publications/P0141/',
    auth: 'none (public statistical release, also on data.gov.za)',
    licence: 'Public domain with attribution — © Statistics South Africa',
    note: 'Used to index price bands forward so a 2024 band is not quoted as a 2026 price.',
  }, {
    name: 'data.gov.za CKAN API',
    endpoint: 'https://openapi.data.gov.za/api/3/action/package_search?q=consumer+price+index',
    auth: 'none (CKAN public API)',
    licence: 'Open data — Republic of South Africa',
  }, {
    name: 'Stats SA Quarterly Labour Force Survey (QLFS)',
    endpoint: 'https://www.statssa.gov.za/?page_id=737&id=6',
    auth: 'none',
    note: 'Supply-side context: unemployment by province and sector drives pro acquisition strategy.',
  }],

  /** Latest headline CPI figures published by Stats SA (annual % change). */
  CPI_SERIES: [
    { year: 2019, allItems: 4.1 }, { year: 2020, allItems: 3.2 }, { year: 2021, allItems: 4.5 },
    { year: 2022, allItems: 6.9 }, { year: 2023, allItems: 6.0 }, { year: 2024, allItems: 4.4 },
    { year: 2025, allItems: 3.3 }, { year: 2026, allItems: 3.0 },
  ],

  /** Labour market context used in the go-to-market model and pro recruitment. */
  LABOUR_MARKET: {
    source: 'Stats SA QLFS Q2 2026 (released 11 August 2026)',
    unemploymentRate: 33.6,
    unemployedPersons: 8_500_000,
    labourForce: 25_200_000,
    employedPersons: 16_700_000,
    expandedUnemploymentRate: 43.8,
    youthUnemploymentRate15to34: 47.4,
    youthUnemploymentRate15to24: 60.9,
    neetRate15to24: 37.6,
    averageMonthlyWageZar: 30_611,
    note: 'These figures are the commercial case for ProVeri: 8.5 million unemployed people, and households that cannot find a trustworthy plumber. The constraint is trust and credentialing, not skill.',
  },

  /** Index a historic price band forward to the current year using CPI. */
  indexToPresent(band, bandYear, toYear = new Date().getFullYear()) {
    const factors = this.CPI_SERIES.filter((row) => row.year >= bandYear && row.year < toYear);
    const factor = factors.reduce((acc, row) => acc * (1 + row.allItems / 100), 1);
    return {
      p10Cents: Math.round(band.p10Cents * factor),
      p50Cents: Math.round(band.p50Cents * factor),
      p90Cents: Math.round(band.p90Cents * factor),
      indexedFromYear: bandYear,
      indexedToYear: toYear,
      cumulativeFactor: Number(factor.toFixed(4)),
      cpiSource: 'Stats SA CPI P0141',
    };
  },

  /**
   * Compute a live band from actual bids. Falls back to the seeded band until
   * enough real bids exist (minimum 5) so a cold metro does not show nonsense.
   */
  bandFromBids(bids, seededBand, { metro, categoryLabel } = {}) {
    const amounts = bids.map((b) => b.totalCents).filter((v) => Number.isInteger(v) && v > 0);
    if (amounts.length < 5) {
      return {
        metro,
        categoryLabel,
        ...seededBand,
        source: 'seeded-metro-band',
        sampleSize: amounts.length,
        confidence: 'LOW',
        note: `Only ${amounts.length} live bid(s) in this metro/category — showing the seeded band. The band tightens automatically at 5+ bids.`,
      };
    }
    return {
      metro,
      categoryLabel,
      p10Cents: percentile(amounts, 10),
      p25Cents: percentile(amounts, 25),
      p50Cents: median(amounts),
      p75Cents: percentile(amounts, 75),
      p90Cents: percentile(amounts, 90),
      medianCents: median(amounts),
      source: 'live-proveri-bids',
      sampleSize: amounts.length,
      confidence: amounts.length >= 25 ? 'HIGH' : 'MEDIUM',
      computedAt: nowIso(),
    };
  },

  /**
   * The customer-facing verdict on a bid. This is the feature Snupit, Kandua
   * and Bark all lack: an opinion on price, backed by data.
   */
  assessBid(bidCents, band, { categoryLabel, metro } = {}) {
    if (!band || bidCents == null) return { verdict: 'UNKNOWN' };
    const ratio = bidCents / (band.p50Cents || band.medianCents || bidCents);
    const fmt = (cents) => `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;

    if (bidCents < band.p10Cents) {
      return {
        verdict: 'WELL_BELOW_MARKET',
        ratio: Number(ratio.toFixed(2)),
        headline: `${Math.round((1 - ratio) * 100)}% below the ${metro || 'metro'} median for ${categoryLabel || 'this work'}`,
        advice: `A bid this low (${fmt(bidCents)} vs a median of ${fmt(band.p50Cents)}) usually means one of three things: materials are excluded, the pro intends to raise the price mid-job, or they are not insured for this scope. ProVeri locks the bid scope — any increase needs your written approval — but ask what is included before you accept.`,
        riskFlag: 'PRICE_ANOMALY_LOW',
      };
    }
    if (bidCents > band.p90Cents) {
      return {
        verdict: 'WELL_ABOVE_MARKET',
        ratio: Number(ratio.toFixed(2)),
        headline: `${Math.round((ratio - 1) * 100)}% above the ${metro || 'metro'} median`,
        advice: `Above the top of the market band. It may be justified by materials, after-hours work or a specialist certification — ask for the itemised breakdown, or press "Beat this quote" to invite competing bids.`,
        riskFlag: 'PRICE_ANOMALY_HIGH',
      };
    }
    if (bidCents <= band.p50Cents) {
      return {
        verdict: 'BELOW_MEDIAN',
        ratio: Number(ratio.toFixed(2)),
        headline: `${Math.round((1 - ratio) * 100)}% below the ${metro || 'metro'} median`,
        advice: 'Good value, inside the normal market band. Check that materials and the certificate of compliance are included.',
      };
    }
    return {
      verdict: 'IN_MARKET_BAND',
      ratio: Number(ratio.toFixed(2)),
      headline: `${Math.round((ratio - 1) * 100)}% vs the ${metro || 'metro'} median`,
      advice: 'Priced inside the normal band for this metro. Compare on trust score, availability and what is included rather than on price alone.',
    };
  },

  async fetchCpiRelease() {
    const res = await request('https://openapi.data.gov.za/api/3/action/package_search?q=consumer%20price%20index&rows=3', {
      timeoutMs: 8000,
      cacheTtlMs: 24 * 3600 * 1000,
    });
    if (res.ok && res.data?.result?.results) {
      return {
        source: 'data.gov.za CKAN',
        live: true,
        datasets: res.data.result.results.map((d) => ({ title: d.title, url: d.url, organisation: d.organization?.title })),
        lookedUpAt: nowIso(),
      };
    }
    return {
      source: 'bundled-stats-sa-series',
      live: false,
      datasets: [{ title: 'Consumer Price Index (P0141)', url: 'https://www.statssa.gov.za/publications/P0141/', organisation: 'Statistics South Africa' }],
      series: this.CPI_SERIES,
      lookedUpAt: nowIso(),
    };
  },
};

/* ==================================================================== *
 * 2. MUNICIPAL OPEN DATA — outage & service-delivery context
 * ==================================================================== */

const MUNICIPAL = {
  id: 'municipal',
  label: 'Municipal open data',
  providers: [{
    name: 'City of Cape Town Open Data Portal (ArcGIS REST)',
    endpoint: 'https://odp-cctegis.opendata.arcgis.com (ArcGIS FeatureServer REST, JSON)',
    auth: 'none — open data portal',
    licence: 'Open licence, City of Cape Town',
    datasets: ['Electricity outage areas', 'Water restrictions', 'Suburb boundaries', 'Indigent register areas', 'Refuse collection schedules'],
  }, {
    name: 'City of Johannesburg — City Power outages',
    endpoint: 'https://www.citypower.co.za (published outage notices)',
    auth: 'none',
    licence: 'Published municipal notices',
  }, {
    name: 'Municipal Demarcation Board',
    endpoint: 'https://www.demarcation.org.za',
    auth: 'none',
    licence: 'Public ward and municipality boundaries',
    note: 'Authoritative source for which municipality (and therefore which by-law, tariff and water restriction regime) applies to an address.',
  }],

  /**
   * Resolve the municipality for a coordinate using the bundled geography.
   * In production this hits the Demarcation Board boundary service.
   */
  municipalityFor({ lat, lon }, geography) {
    let best = null;
    let bestDistance = Infinity;
    for (const metro of geography.metros) {
      for (const suburb of metro.suburbs) {
        const d = Math.hypot(suburb.lat - lat, suburb.lon - lon);
        if (d < bestDistance) {
          bestDistance = d;
          best = { metroId: metro.id, metroName: metro.name, province: metro.province, municipalityCode: metro.municipalityCode, suburb, approximateDistanceDeg: d };
        }
      }
    }
    if (!best || bestDistance > 0.8) return { resolved: false, reason: 'Coordinate is outside the bundled metro coverage — live Demarcation Board lookup required' };
    return {
      resolved: true,
      ...best,
      authority: {
        electricity: metroAuthorityFor(best.metroId),
        water: metroAuthorityFor(best.metroId, 'water'),
        byLaws: `${best.metroName} municipal by-laws apply`,
      },
      dataPortals: portalsFor(best.metroId),
    };

    function metroAuthorityFor(metroId, kind = 'electricity') {
      const map = {
        jhb: { electricity: 'City Power (Johannesburg)', water: 'Joburg Water' },
        pta: { electricity: 'City of Tshwane Electricity', water: 'Tshwane Water & Sanitation' },
        ekur: { electricity: 'Ekurhuleni Electricity', water: 'Ekurhuleni Water & Sanitation' },
        cpt: { electricity: 'City of Cape Town Electricity', water: 'City of Cape Town Water & Sanitation' },
        eth: { electricity: 'eThekwini Electricity', water: 'eThekwini Water & Sanitation' },
      };
      return (map[metroId] || { electricity: 'Eskom', water: 'Local water authority' })[kind];
    }
    function portalsFor(metroId) {
      if (metroId === 'cpt') return [{ name: 'City of Cape Town Open Data Portal', url: 'https://odp-cctegis.opendata.arcgis.com' }];
      return [{ name: 'data.gov.za', url: 'https://openapi.data.gov.za' }];
    }
  },

  /**
   * Water-restriction and outage context that legitimately affects a job.
   * Example: a paving contractor cannot wash down during Level 3 restrictions.
   */
  async restrictionsFor(metroId) {
    const presets = {
      cpt: { waterRestrictionLevel: 1, note: 'City of Cape Town permanent water-wise by-law: no hosepipe washing of hard surfaces, gardens before 09:00 or after 16:00.', source: 'City of Cape Town Water By-law' },
      jhb: { waterRestrictionLevel: 1, note: 'Joburg Water Level 1 restrictions apply during declared droughts; check before scheduling pressure washing.', source: 'Joburg Water' },
      eth: { waterRestrictionLevel: 1, note: 'eThekwini Level 1 permanent restrictions: no washing of paved surfaces with a hosepipe.', source: 'eThekwini Water & Sanitation' },
    };
    const preset = presets[metroId] || { waterRestrictionLevel: 0, note: 'No published restriction regime for this municipality.', source: 'Municipal Demarcation Board' };
    return { ...preset, metroId, live: false, lookedUpAt: nowIso() };
  },
};

/* ==================================================================== *
 * 3. SAFETY CONTEXT — published crime statistics, friction only
 * ==================================================================== */

const SAFETY = {
  id: 'safety',
  label: 'Visit safety context',
  providers: [{
    name: 'SAPS Quarterly Crime Statistics',
    endpoint: 'https://www.saps.gov.za/services/crimestats.php',
    auth: 'none (public release)',
    licence: 'Public domain — South African Police Service',
    note: 'Station-level and precinct-level counts for contact crimes, published quarterly.',
  }, {
    name: 'Crime Hub / Crime Grade SA (derived public datasets)',
    endpoint: 'https://crimehub.org.za',
    auth: 'none',
    note: 'Normalised per-capita crime indices derived from published SAPS data.',
  }],

  /**
   * FAIRNESS GUARDRAIL. This function returns *prompts*, never a score that can
   * be used for ranking or pricing. Every value carries an explicit `usedFor`.
   */
  promptsForVisit({ booking, locality }) {
    const prompts = [];
    const inHome = booking?.locationType === 'IN_HOME';
    const children = Boolean(booking?.householdNotes?.childrenOnPremises);
    const afterHours = Boolean(booking?.scheduledAt && this._isAfterHours(booking.scheduledAt));
    const materialsCash = (booking?.materialsCashCents || 0) > 0;
    const highValue = (booking?.priceCents || 0) >= 500_000;

    prompts.push({
      id: 'GATE_CODE',
      title: 'One-time arrival code',
      why: 'You should never have to open your door to a stranger on faith.',
      how: 'The pro shows a 6-digit code at your door. You type it into ProVeri and only then does their verified photo, ID name and trade certificate unlock on your screen.',
      required: inHome,
      usedFor: 'identity-confirmation',
    });
    prompts.push({
      id: 'CHECK_IN_OUT',
      title: 'Arrival and departure check-in',
      why: 'If something goes wrong, the timeline already exists.',
      how: 'Both of you tap "arrived" and "left". ProVeri records the time and GPS, and the safety desk is alerted if a check-in is missed by more than 2 hours.',
      required: true,
      usedFor: 'audit-trail',
    });
    prompts.push({
      id: 'KEEP_IT_IN_APP',
      title: 'Keep messages and money in the app',
      why: 'Every ProVeri protection — escrow, warranty holdback, dispute centre, insurance — depends on the record existing.',
      how: 'Anyone who asks you to move to WhatsApp, cash or a personal bank account is breaking the rules. One-tap report freezes the payout and alerts our fraud desk.',
      required: true,
      usedFor: 'fraud-prevention',
    });

    if (inHome) {
      prompts.push({
        id: 'BE_PRESENT',
        title: 'Someone you trust should be home',
        why: 'In-home work is the highest-anxiety booking in South Africa.',
        how: 'ProVeri lets you add a second contact who receives the same arrival alerts. You can also request a two-person visit at no extra callout cost.',
        required: false,
        usedFor: 'personal-safety',
      });
    }
    if (children) {
      prompts.push({
        id: 'CHILD_CLEARANCE',
        title: 'Child-presence clearance',
        why: 'Children on the premises changes what verification is required.',
        how: 'Only pros with a recorded police clearance and two verified references can be matched to this booking. ProVeri blocks the others before you ever see them.',
        required: true,
        usedFor: 'child-protection',
      });
    }
    if (afterHours) {
      prompts.push({
        id: 'AFTER_HOURS',
        title: 'After-hours visit controls',
        why: 'Arrivals outside 07:00–18:00 carry more risk for both of you.',
        how: 'Photo ID confirmation is mandatory, the arrival code is single-use and time-boxed, and the safety desk actively monitors the booking.',
        required: true,
        usedFor: 'personal-safety',
      });
    }
    if (materialsCash) {
      prompts.push({
        id: 'NO_CASH',
        title: 'Never hand over materials cash',
        why: 'Cash for materials is the most common way a customer loses money outside escrow.',
        how: 'Add the materials amount to the escrow instead. The pro buys, photographs the till slip, and ProVeri releases that portion against the receipt. You are protected; the pro still gets paid same-day.',
        required: true,
        usedFor: 'fraud-prevention',
      });
    }
    if (highValue) {
      prompts.push({
        id: 'HIGH_VALUE',
        title: 'High-value job controls',
        why: `This job is worth R${((booking.priceCents || 0) / 100).toLocaleString('en-ZA')} — worth milestone escrow rather than a single payment.`,
        how: 'Split the payment into milestones (deposit on arrival, progress, completion). Each release needs geotagged proof of work and your acceptance. TradeSafe handles jobs above R5,000.',
        required: false,
        usedFor: 'financial-protection',
      });
    }
    if (locality?.crimeIndex && locality.crimeIndex >= 40) {
      prompts.push({
        id: 'LOCALITY_FRICTION',
        title: 'Extra verification for this area',
        why: 'Published SAPS statistics for this precinct show elevated reported contact crime.',
        how: 'ProVeri raises the verification bar for visits here: photo ID confirmation, mandatory arrival code, and an offered two-person visit. This applies to everyone equally — it never changes who can work here or what they are paid.',
        required: true,
        usedFor: 'identity-confirmation',
        fairnessNote: 'Locality data is used ONLY to add verification friction. ProVeri policy PROH-001 prohibits using it for ranking, pricing or eligibility.',
      });
    }
    return { prompts, usedFor: 'verification-friction-only', neverUsedFor: ['ranking', 'pricing', 'eligibility'] };
  },

  _isAfterHours(iso) {
    const hour = new Date(iso).getHours();
    return hour < 7 || hour >= 18;
  },

  /**
   * Published national context used in reporting and investor decks — never
   * per-job, never per-suburb ranking.
   */
  nationalContext() {
    return {
      source: 'SAPS Quarterly Crime Statistics (published)',
      url: 'https://www.saps.gov.za/services/crimestats.php',
      whyWeTrackIt: 'Home-services fraud and in-home theft are the two reasons South Africans do not hire strangers. ProVeri exists to remove both.',
      usagePolicy: 'Aggregate, national, published figures only. No per-suburb scoring of pros or customers.',
      lookedUpAt: nowIso(),
    };
  },
};

/* ==================================================================== *
 * 4. PAYMENT & ESCROW PARTNER ENDPOINTS
 * ==================================================================== */

const PAYMENTS = {
  id: 'payments',
  label: 'Payment rails & escrow partners',
  providers: [{
    name: 'TradeSafe',
    kind: 'escrow-paymaster',
    endpoint: 'https://api.tradesafe.co.za/graphql',
    auth: 'merchant API key (playground available)',
    docs: 'https://www.tradesafe.co.za — API Docs, playground, service status, public roadmap',
    regulator: 'PASA-authorised third-party payment provider; backed by Standard Bank',
    capabilities: ['escrow', 'split payments', 'milestone payments', 'lay-by', 'seller drawdowns', 'wallets', 'white-label', 'shopping-cart plugins'],
    feeModel: 'From 1.5% of trade value; API flat 1.5% per transaction; R100 minimum on non-API',
    paymentMethods: ['EFT', 'Instant EFT (Callpay EFTSecure)', 'Ozow', 'Card', 'SnapScan', 'PayJustNow BNPL'],
    bestFor: 'Jobs above R5,000, milestone builds, vehicle purchases',
  }, {
    name: 'Paystack',
    kind: 'psp',
    endpoint: 'https://api.paystack.co',
    auth: 'Bearer secret key',
    docs: 'https://paystack.com/docs',
    keyEndpoints: [
      { method: 'POST', path: '/transaction/initialize', purpose: 'Start a ZAR card/EFT/USSD charge' },
      { method: 'POST', path: '/transaction/verify/{reference}', purpose: 'Confirm payment before releasing escrow' },
      { method: 'POST', path: '/transaction/split', purpose: 'Create the pro/platform split rule' },
      { method: 'POST', path: '/split', purpose: 'Named split configuration' },
      { method: 'POST', path: '/transferrecipient', purpose: 'Register a pro as a payout recipient' },
      { method: 'POST', path: '/transfer', purpose: 'Pay the pro out of the platform balance' },
      { method: 'POST', path: '/transfer/verify/{reference}', purpose: 'Confirm payout settlement' },
      { method: 'POST', path: '/charge', purpose: 'Bank transfer / OTP authorisation flow' },
      { method: 'POST', path: '/refund', purpose: 'Refund a transaction' },
      { method: 'POST', path: '/dispute', purpose: 'Respond to a customer dispute' },
      { method: 'GET', path: '/settlement', purpose: 'Reconcile settlements' },
      { method: 'POST', path: '/dedicated_account', purpose: 'Virtual account for instant EFT funding' },
    ],
    webhook: 'charge.success, charge.failed, transfer.success, transfer.failed, transfer.reversed, dispute.new',
    feeModel: '1.5% + R5 local cards (capped at R250); 3.9% international',
    bestFor: 'Standard jobs, instant payouts, international remittance funding',
  }, {
    name: 'Stripe',
    kind: 'psp',
    endpoint: 'https://api.stripe.com/v1',
    auth: 'Bearer secret key',
    docs: 'https://docs.stripe.com',
    keyEndpoints: [
      { method: 'POST', path: '/payment_intents', purpose: 'Capture-later intent — the closest thing to escrow on Stripe' },
      { method: 'POST', path: '/accounts', purpose: 'Stripe Connect custom account for a pro' },
      { method: 'POST', path: '/transfers', purpose: 'Move funds to the connected pro account' },
      { method: 'POST', path: '/payouts', purpose: 'Pay the pro to their bank' },
      { method: 'POST', path: '/refunds', purpose: 'Refund' },
      { method: 'POST', path: '/disputes/{id}', purpose: 'Submit dispute evidence' },
    ],
    webhook: 'payment_intent.succeeded, charge.dispute.created, transfer.created, payout.paid',
    feeModel: '3.4% + R5.00 per successful card charge',
    bestFor: 'Cross-border customers and diaspora-funded jobs',
  }, {
    name: 'PayFast',
    kind: 'psp',
    endpoint: 'https://www.payfast.co.za/eng/process',
    auth: 'Merchant ID + key, IPN signature',
    docs: 'https://developers.payfast.co.za/docs',
    keyEndpoints: [
      { method: 'POST', path: '/eng/process', purpose: 'Hosted checkout' },
      { method: 'POST', path: '/eng/query/validate', purpose: 'Validate the IPN signature' },
      { method: 'POST', path: '/eng/process/ping', purpose: 'Server-to-server ping' },
      { method: 'POST', path: '/eng/api/refund', purpose: 'Refund via API' },
    ],
    paymentMethods: ['Card', 'Instant EFT', 'Ozow', 'SnapScan', 'Zapper', 'Masterpass', 'Mobicred', 'PayJustNow', 'SCode', 'Samsung Pay'],
    feeModel: '3.5% + R2.00 per transaction',
    bestFor: 'Web Studio storefront checkouts',
  }, {
    name: 'Ozow',
    kind: 'instant-eft',
    endpoint: 'https://api.ozow.com',
    auth: 'API key + RSA signature',
    docs: 'https://developers.ozow.com',
    keyEndpoints: [
      { method: 'POST', path: '/transactionrequest', purpose: 'Create an instant EFT payment request' },
      { method: 'POST', path: '/transactionstatus', purpose: 'Poll settlement status' },
      { method: 'POST', path: '/payout', purpose: 'Pay out to a verified bank account' },
      { method: 'POST', path: '/accountverification', purpose: 'Confirm an account belongs to a person' },
    ],
    webhook: 'automated notification callback (POST back to merchant)',
    paymentMethods: ['Instant EFT from all major SA banks', 'Ozow Pay (cardless, no banking profile)'],
    feeModel: 'Typically R3–R15 per transaction depending on value band',
    bestFor: 'Low-friction ZAR instant EFT escrow funding; cardless customers',
  }, {
    name: 'Yoco',
    kind: 'psp-pos',
    endpoint: 'https://payments.yoco.com/api',
    auth: 'Bearer secret key',
    docs: 'https://developer.yoco.com',
    keyEndpoints: [
      { method: 'POST', path: '/checkouts', purpose: 'Online checkout' },
      { method: 'POST', path: '/charges', purpose: 'Direct card charge' },
      { method: 'POST', path: '/refunds', purpose: 'Refund' },
    ],
    paymentMethods: ['Card (tap/dip/swipe on device)', 'Yoco online checkout', 'SnapScan', 'Zapper'],
    feeModel: '2.95% + R0.50 (from 3.25% on entry pricing)',
    bestFor: 'On-site card payment at handover; Web Studio packages',
  }, {
    name: 'Clickatell',
    kind: 'sms-otp',
    endpoint: 'https://platform.clickatell.com/v1/message',
    auth: 'Bearer API key',
    docs: 'https://docs.clickatell.com',
    usedFor: 'SMS one-time PINs for identity, mobile verification and arrival codes',
    feeModel: 'Per-SMS credit pricing',
  }, {
    name: 'Brevo',
    kind: 'email',
    endpoint: 'https://api.brevo.com/v3/smtp/email',
    auth: 'api-key header',
    docs: 'https://developers.brevo.com',
    usedFor: 'Transactional email: verification, receipts, booking updates, POPIA notices',
    feeModel: 'Free tier 300 emails/day; paid from ~R170/month',
  }, {
    name: 'WhatsApp Business Platform (Meta Cloud API)',
    kind: 'chat',
    endpoint: 'https://graph.facebook.com/v21.0/{phone-number-id}/messages',
    auth: 'Bearer token + Meta Business verification',
    docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    usedFor: 'Job posting from a WhatsApp chat, bid notifications, arrival codes, review requests, Web Studio enquiry capture',
    feeModel: 'Utility/authentication templates priced per conversation; free-entry-point conversations are zero-rated',
    whyItMatters: 'WhatsApp is the de facto business channel in South Africa. Any marketplace that forces users out of WhatsApp loses them; ProVeri meets them there and pulls the transaction back into escrow.',
  }, {
    name: 'Twilio Verify (alternative OTP)',
    kind: 'sms-otp',
    endpoint: 'https://verify.twilio.com/v2/Services/{sid}/Verifications',
    auth: 'Account SID + auth token',
    usedFor: 'Fallback OTP channel and international numbers for diaspora customers',
  }],
};

module.exports = { MARKET, MUNICIPAL, SAFETY, PAYMENTS };
