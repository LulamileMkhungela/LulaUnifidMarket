'use strict';

/**
 * Lula ProVeri — Seed dataset.
 *
 * A realistic South African marketplace snapshot so the PWA, the API and the
 * demo all have something true to show: verified pros across the metros, live
 * jobs with competing bids, completed escrow-released bookings with geotagged
 * proof of work and verified reviews, a disputed booking, an open warranty, a
 * verified vehicle listing with a bridged inspection, and generated microsites.
 *
 * Identities are synthetic. SA ID numbers are generated with the real Luhn
 * algorithm (src/integrations/saIdentity.js) so validation exercises the same
 * code path production would.
 */

const { nowIso, addDays, addMinutes, sha256, fingerprint, percentageOf } = require('../kernel/util');
const { CHECK_STATUS } = require('../kernel/verification');
const { synthesiseSaId } = require('../integrations/saIdentity');
const { BOOKING_STATUS } = require('./bookings');

/** Synthetic-but-plausible pro roster. */
const PRO_ROSTER = [
  { name: 'Sipho Dlamini', category: 'plumbing', suburb: 'soweto', metro: 'jhb', rate: 65000, callout: 55000, jobs: 47, rating: 4.9, cert: 'PIRB', certNo: 'PIRB-2019-44821', saqa: '61709', insured: true, about: 'PIRB-registered plumber, 14 years in Soweto, Roodepoort and the West Rand. Geyser specialist — solar, heat pump and electric. I do not leave a job without a Plumbing CoC where one is required.' },
  { name: 'Anwar Patel', category: 'electrical', suburb: 'lenasia', metro: 'jhb', rate: 78000, callout: 65000, jobs: 63, rating: 4.8, cert: 'DoEL wireman', certNo: 'WL-1998-114072', saqa: '63769', insured: true, about: 'Registered wireman since 1998. DB upgrades, fault finding, CoCs for property sales, and solar tie-ins under SANS 10142-2. Every installation leaves with a Certificate of Compliance.' },
  { name: 'Charmaine Botha', category: 'solar-inverter', suburb: 'centurion', metro: 'pta', rate: 0, callout: 0, jobs: 28, rating: 5.0, cert: 'DoEL wireman', certNo: 'WL-2014-220188', saqa: '63769', insured: true, about: 'Hybrid solar and battery backup. I size systems against your actual load profile from a smart-meter reading, not a brochure. 118 systems commissioned since 2022, average payback 4.2 years at current tariffs.' },
  { name: 'Thabo Mokoena', category: 'handyman', suburb: 'alexandra', metro: 'jhb', rate: 38000, callout: 35000, jobs: 12, rating: 4.7, cert: null, certNo: null, saqa: null, insured: false, about: 'Odd jobs, mounting, doors, locks, shelves, small plaster and paint. I do not touch electrical or plumbing that needs a registered trade — I will refer you to one on ProVeri instead.' },
  { name: 'Fatima Naidoo', category: 'cleaning-home', suburb: 'chatsworth', metro: 'eth', rate: 9500, callout: 0, jobs: 88, rating: 4.9, cert: null, certNo: null, saqa: '22886', insured: true, about: 'Deep cleans, move-out cleans and post-renovation cleans. Police-cleared, own equipment, four-person team for large houses. NQF Level 1 Domestic Cleaning certified.' },
  { name: 'Johan van Rensburg', category: 'painting', suburb: 'pretoria-east', metro: 'pta', rate: 42000, callout: 0, jobs: 34, rating: 4.6, cert: null, certNo: null, saqa: null, insured: true, about: 'Interior and exterior repaints, damp and flake treatment before painting. I quote per square metre after a site survey, not per guess, and I do not paint in rain.' },
  { name: 'Lerato Mashaba', category: 'gardening', suburb: 'midrand', metro: 'jhb', rate: 18000, callout: 30000, jobs: 5, rating: 4.5, cert: null, certNo: null, saqa: '20426', insured: false, about: 'Garden clean-ups, lawn care, hedge trimming and irrigation repair. Newly verified — full KYC passed, building my ProVeri history.' },
  { name: 'Rajesh Govender', category: 'electric-fence-security', suburb: 'umhlanga', metro: 'eth', rate: 85000, callout: 75000, jobs: 41, rating: 4.8, cert: 'PSIRA', certNo: 'PSIRA-C-2016-88214', saqa: '61609', insured: true, about: 'PSIRA-registered. CCTV, alarms with battery backup, electric fence with CoC, gate motors and access control. Load-shedding is my biggest job driver — everything I install runs through an outage.' },
  { name: 'Nomvula Khumalo', category: 'beauty-mobile', suburb: 'sandton', metro: 'jhb', rate: 35000, callout: 15000, jobs: 96, rating: 4.9, cert: null, certNo: null, saqa: '57712', insured: true, about: 'Mobile hair, braids, gel and acrylic nails, and event makeup across Sandton, Fourways and Randburg. NQF Level 4 Beautician.' },
  { name: 'Pieter du Toit', category: 'auto-mechanical', suburb: 'bellville', metro: 'cpt', rate: 92000, callout: 65000, jobs: 52, rating: 4.7, cert: 'RMI', certNo: 'RMI-W-2011-30155', saqa: '65409', insured: true, about: 'RMI-accredited workshop, mobile for diagnostics and minor services. Every job leaves with a written job card and old parts on request.' },
  { name: 'David Molefe', category: 'vehicle-inspection', suburb: 'randburg', metro: 'jhb', rate: 0, callout: 0, jobs: 118, rating: 4.9, cert: 'DEKRA assessor', certNo: 'DEKRA-AS-2017-5510', saqa: '63469', insured: true, about: 'Independent pre-purchase inspections — 118-point checklist, compression test, paint-depth gauge, OBD scan, VIN and odometer verification. I have no interest in any sale; my report goes to the buyer and to the ProVeri listing.' },
  { name: 'Zanele Mthembu', category: 'web-digital', suburb: 'fourways', metro: 'jhb', rate: 85000, callout: 0, jobs: 22, rating: 4.8, cert: null, certNo: null, saqa: '64849', insured: false, about: 'Mobile-first business websites, Google Business Profile setup, WhatsApp Business automation and Meta ads. I build your live preview before you pay a cent.' },
  { name: 'Yusuf Adams', category: 'roofing-gutters', suburb: 'roodepoort', metro: 'jhb', rate: 0, callout: 0, jobs: 19, rating: 4.5, cert: null, certNo: null, saqa: '23916', insured: true, about: 'Roof leaks, full replacements, gutter repair and roof painting. Fall-protection plan on every job above two metres, and I write a 5-year workmanship warranty into the quote.' },
  { name: 'Grace Nkosi', category: 'tutoring-education', suburb: 'soweto', metro: 'jhb', rate: 28000, callout: 0, jobs: 7, rating: 5.0, cert: 'SACE', certNo: 'SACE-2018-774012', saqa: null, insured: false, about: 'SACE-registered maths and physical science tutor, Grade 8 to 12. Police-cleared for work with minors. Exam-prep bootcamps in the holidays.' },
  { name: 'Aneeqa Adams', category: 'handyman', suburb: 'sea-point', metro: 'cpt', rate: 42000, callout: 38000, jobs: 9, rating: 4.8, cert: null, certNo: null, saqa: null, insured: true, about: 'Female handyman covering the Atlantic Seaboard and City Bowl. Mounting, doors, locks, small plaster and paint. Police-cleared, and happy to work while you are at home or after you leave.' },
  { name: 'Hennie Lombaard', category: 'moving-removals', suburb: 'alberton', metro: 'ekur', rate: 0, callout: 0, jobs: 31, rating: 4.6, cert: null, certNo: null, saqa: null, insured: true, about: '4-tonne closed truck, blanket-wrapped, written inventory before we lift anything. Goods-in-transit insured to R500,000.' },
];

const CUSTOMER_ROSTER = [
  { name: 'Naledi Sithole', suburb: 'bryanston', metro: 'jhb', email: 'naledi.s@example.co.za', mobile: '0821234501' },
  { name: 'Ruan Pretorius', suburb: 'durbanville', metro: 'cpt', email: 'ruan.p@example.co.za', mobile: '0831234502' },
  { name: 'Aisha Moosa', suburb: 'lenasia', metro: 'jhb', email: 'aisha.m@example.co.za', mobile: '0761234503' },
  { name: 'Kagiso Molefe', suburb: 'soweto', metro: 'jhb', email: 'kagiso.m@example.co.za', mobile: '0791234504' },
  { name: 'Brenda Williams', suburb: 'sea-point', metro: 'cpt', email: 'brenda.w@example.co.za', mobile: '0841234505', vulnerable: true },
  { name: 'Tshepo Mahlangu', suburb: 'tembisa', metro: 'ekur', email: 'tshepo.m@example.co.za', mobile: '0611234506' },
  { name: 'Mariette Coetzee', suburb: 'menlyn', metro: 'pta', email: 'mariette.c@example.co.za', mobile: '0721234507' },
  { name: 'Priya Naidoo', suburb: 'umhlanga', metro: 'eth', email: 'priya.n@example.co.za', mobile: '0831234508' },
  { name: 'Sibusiso Zulu', suburb: 'chatsworth', metro: 'eth', email: 'sibusiso.z@example.co.za', mobile: '0761234509' },
];

const JOB_ROSTER = [
  { customer: 0, category: 'plumbing', title: 'Geyser leaking from the pressure valve', suburb: 'bryanston', budget: 650000, urgency: 'URGENT', locationType: 'IN_HOME', description: 'Two-year-old 200 litre electric geyser is dripping from the pressure control valve onto the ceiling below. Ceiling is already stained. Need the valve or the geyser assessed and replaced today if possible. Access is through the garage, power is on a dedicated breaker.', bids: 3, status: 'BIDDING' },
  { customer: 1, category: 'solar-inverter', title: '5 kW hybrid solar with battery backup', suburb: 'durbanville', metro: 'cpt', budget: 9500000, urgency: 'FLEXIBLE', description: 'Four-bedroom house, average usage 28 kWh/day, we are on Stage 4 most winter evenings. Want to run two fridges, the Wi-Fi, lights, TV, one geyser element and the pool pump. Roof is north-facing tiled, no shade after 10:00. Need a CoC and NERSA guidance if required.', bids: 2, status: 'BIDDING' },
  { customer: 2, category: 'electrical', title: 'DB board tripping and needs a CoC', suburb: 'lenasia', budget: 420000, urgency: 'SOON', description: 'Main breaker trips when the kettle and the stove run together. House is from 1994, DB is still the old ceramic fuse type. We are selling and the buyer wants an electrical Certificate of Compliance.', bids: 3, status: 'BIDDING' },
  { customer: 8, category: 'cleaning-home', title: 'Move-out deep clean, 3-bedroom house', suburb: 'chatsworth', budget: 180000, urgency: 'SCHEDULED', preferredDate: addDays(nowIso(), 9).slice(0, 10), description: 'Moving out at the end of the month. Three-bedroom house with tiled floors, one bathroom, kitchen needs degreasing, windows inside and out, built-in cupboards emptied and wiped. Agent inspection follows two days later.', bids: 2, status: 'BIDDING', instantBook: true },
  { customer: 4, category: 'handyman', title: 'Mount a 65-inch TV and fix two doors', suburb: 'sea-point', budget: 145000, urgency: 'SOON', description: 'Flat-wall mount a 65-inch TV on a plasterboard wall with a brick backing — needs the right anchors. Two interior doors have dropped and scrape the frame. I live alone and would prefer a female pro or a two-person visit if possible.', bids: 1, status: 'BIDDING', instantBook: true, vulnerable: true },
  { customer: 7, category: 'electric-fence-security', title: 'Four cameras plus gate motor battery backup', suburb: 'umhlanga', budget: 1850000, urgency: 'SOON', description: 'Four outdoor cameras covering the yard and the street gate, linked to my phone. Gate motor is dead during load shedding — need a battery backup or a small solar feed. Also want the existing electric fence tested and a CoC if it fails.', bids: 0, status: 'OPEN' },
  { customer: 0, category: 'vehicle-inspection', title: 'Pre-purchase inspection: 2019 Toyota Corolla', suburb: 'midrand', budget: 165000, urgency: 'URGENT', description: 'Private seller in Menlyn, 84,000 km on the clock, asking R265,000. Advert says full service history and accident-free. I want an independent inspection before I pay anything, and I want the report written into the ProVeri listing so the VIN and odometer are sealed.', bids: 1, status: 'AWARDED', vehicleJob: true },
  { customer: 0, category: 'roofing-gutters', title: 'Roof leak above the main bedroom', suburb: 'bryanston', budget: 2400000, urgency: 'FLEXIBLE', description: 'Leak appears after heavy rain only, above the main bedroom near the valley. Tiles are 12 years old. Gutters are blocked with leaves. Want a proper survey with roof photos before anyone quotes a repair.', bids: 0, status: 'OPEN' },
  { customer: 1, category: 'web-digital', title: 'One-page website for my plumbing business', suburb: 'durbanville', metro: 'cpt', budget: 450000, urgency: 'FLEXIBLE', description: 'Small plumbing business, no website at all right now — losing work to competitors who appear on Google Maps. Want a single mobile-first page with WhatsApp click-to-chat, a gallery of ten job photos, and Google Business Profile set up properly.', bids: 2, status: 'BIDDING', remote: true },
  { customer: 3, category: 'tutoring-education', title: 'Grade 11 maths and science, twice a week', suburb: 'soweto', budget: 95000, urgency: 'SCHEDULED', description: 'My daughter is in Grade 11 and struggling with algebra and stoichiometry. Need two sessions a week, weekday evenings, at our home. Must be police-cleared and comfortable working with a teenager.', bids: 1, status: 'BIDDING', children: true },
  { customer: 5, category: 'painting', title: 'Interior repaint, two-bedroom flat', suburb: 'tembisa', budget: 850000, urgency: 'FLEXIBLE', description: 'Two-bedroom flat, roughly 65 m² of wall. Walls need damp treatment in one corner before painting. Ceilings and cornices included. Furniture stays in the flat so everything needs covering.', bids: 0, status: 'OPEN' },
  { customer: 2, category: 'moving-removals', title: 'Move a two-bedroom flat across Lenasia', suburb: 'lenasia', budget: 650000, urgency: 'SCHEDULED', preferredDate: addDays(nowIso(), 16).slice(0, 10), description: 'Two-bedroom flat to a two-bedroom house about 6 km away, both ground floor. Queen bed, wardrobe, fridge, washing machine, sofa, roughly 40 boxes. Need it wrapped and a written inventory. Milestone escrow please — half on load, half on unload.', bids: 0, status: 'OPEN' },
];

/** Deterministic, syntactically valid SA mobile: 0 + [6|7|8] + 8 digits. */
function seedMobile(name, index) {
  const prefix = ['06', '07', '08'][index % 3];
  const seedNumber = [...String(name)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const tail = String((10_000_000 + (seedNumber * 137_371 + index * 9_771_131) % 89_000_000)).padStart(8, '0').slice(0, 8);
  return `${prefix}${tail}`;
}


/**
 * Build exactly the evidence set the category demands, so the proof-of-work
 * policy (POW-001) is satisfied the same way a real pro would satisfy it.
 * CUSTOMER_CONFIRMATION is excluded — the customer supplies that on acceptance.
 */
function evidenceForBooking({ bookingId, category, suburb, notes = {} }) {
  const { EVIDENCE_TYPES } = require('./bookings');
  const geo = suburb ? { lat: suburb.lat, lon: suburb.lon, accuracyM: 6 } : null;
  const wanted = [...new Set([...(category.evidenceRequired || []), 'AFTER_PHOTO'])];
  return wanted
    .filter((type) => EVIDENCE_TYPES[type] && type !== 'CUSTOMER_CONFIRMATION')
    .map((type) => ({
      type,
      note: notes[type] || EVIDENCE_TYPES[type].label,
      geo: EVIDENCE_TYPES[type].geoSealed ? geo : null,
      capturedAt: nowIso(),
      hash: `${bookingId}-${type}`,
    }));
}

/**
 * Build the full seed dataset. Idempotent-ish: call once per Marketplace.
 */
async function seed(marketplace, { withLiveIntegrations = false } = {}) {
  const { store, catalog, kernel, people, jobs, bookings, vehicles, webStudio } = marketplace;
  const summary = { pros: 0, customers: 0, jobs: 0, bids: 0, bookings: 0, reviews: 0, vehicles: 0, microsites: 0, sites: 0, sitesLive: 0, siteBookings: 0, siteJobs: 0, leads: 0, leadsWon: 0, demos: 0 };

  /* ---------------- customers ---------------- */
  const customers = [];
  for (const row of CUSTOMER_ROSTER) {
    const suburb = catalog.suburb(row.suburb);
    const customer = people.registerCustomer({
      fullName: row.name,
      email: row.email,
      mobile: row.mobile,
      suburbId: suburb?.id,
      vulnerableHousehold: Boolean(row.vulnerable),
    });
    people.verifyCustomerChannel(customer.customerId, { channel: 'email', reference: `EMAIL_${fingerprint(customer.customerId, 8)}` });
    people.verifyCustomerChannel(customer.customerId, { channel: 'mobile', reference: `SMS_${fingerprint(customer.customerId, 8)}` });
    customers.push(store.get('customers', customer.customerId));
    summary.customers += 1;
  }

  /* ---------------- pros, with the full KYC pipeline ---------------- */
  const pros = [];
  for (const [proIndex, row] of PRO_ROSTER.entries()) {
    const suburb = catalog.suburb(row.suburb);
    const category = catalog.get(row.category);
    const idNumber = synthesiseSaId({ seed: row.name, gender: ['Nomvula', 'Charmaine', 'Fatima', 'Lerato', 'Zanele', 'Grace', 'Aisha'].includes(row.name.split(' ')[0]) ? 'FEMALE' : 'MALE', age: 28 + (row.jobs % 22) });

    const pro = people.registerPro({
      fullName: row.name,
      email: `${row.name.split(' ')[0].toLowerCase()}.${row.name.split(' ').at(-1).toLowerCase().replace(/[^a-z]/g, '')}@proveri.example.co.za`,
      mobile: seedMobile(row.name, proIndex),
      idNumber,
      suburbId: suburb?.id,
      serviceRadiusKm: 15 + (row.jobs % 4) * 10,
      primaryCategory: row.category,
      additionalCategories: category.group === 'home-trades' ? ['handyman'] : [],
      about: row.about,
      hourlyRateCents: row.rate || null,
      calloutFeeCents: row.callout || null,
      availability: {
        workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
        startHour: 7,
        endHour: 18,
        afterHoursEmergency: category.id === 'plumbing' || category.id === 'electrical' || category.id === 'securityInstaller',
        publicHolidayRatePercent: 150,
      },
      tradeCertification: row.cert ? { body: row.cert, certificateNumber: row.certNo, issuedAt: '2019-03-01', expiresAt: addDays(nowIso(), 240).slice(0, 10), certificateHash: `${row.name}-cert` } : {},
      qualification: row.saqa ? { saqaId: row.saqa, title: null, nqfLevel: null } : {},
      insurance: row.insured ? { provider: category.riskLevel === 'HIGH' ? 'Santam' : 'Dotsure', policyNumber: `PL-${fingerprint(row.name, 8)}`, coverCents: category.riskLevel === 'HIGH' ? 500_000_000 : 100_000_000, expiresAt: addDays(nowIso(), 300).slice(0, 10), certificateHash: `${row.name}-ins` } : {},
      portfolio: [
        { title: `${category.label} job — ${suburb?.name || 'Gauteng'}`, caption: 'Completed and escrow-released', hash: `${row.name}-portfolio-1`, geo: suburb ? { lat: suburb.lat, lon: suburb.lon } : null },
        { title: `${category.label} job — nearby`, caption: 'Completed and escrow-released', hash: `${row.name}-portfolio-2` },
      ],
      bankDetails: {
        bankCode: ['capitec', 'fnb', 'standardbank', 'absa', 'nedbank', 'tymebank'][row.jobs % 6],
        accountNumber: String(1000000000 + row.jobs * 137).slice(0, 10),
        holderName: row.name,
      },
      criminalDeclaration: { declared: true, noConvictions: true, disclosures: [] },
      deviceFingerprint: `device-${row.name}`,
    });

    // Re-supply the ID so the pipeline can validate it (the raw value is never stored).
    pro.__idNumber = idNumber;
    pro.__mobileOtpRef = `SMS_${fingerprint(pro.proId, 8)}`;
    pro.__emailOtpRef = `EMAIL_${fingerprint(pro.proId, 8)}`;
    store.put('pros', pro.proId, pro);

    await people.runVerificationPipeline(pro.proId, { credentials: {} });
    const verified = store.get('pros', pro.proId);

    // Seed delivery history so ratings and matching behave like a live marketplace.
    verified.stats.completedJobs = row.jobs;
    verified.stats.reviewCount = Math.max(0, Math.round(row.jobs * 0.62));
    verified.stats.averageRating = verified.stats.reviewCount ? row.rating : null;
    verified.stats.totalEarnedCents = row.jobs * (row.rate ? row.rate * 3 : category.band.p50Cents);
    verified.stats.responseMedianMinutes = 8 + (row.jobs % 9) * 4;
    verified.stats.firstResponseMinutes = [verified.stats.responseMedianMinutes];
    verified.stats.firstResponseMedianMinutes = verified.stats.responseMedianMinutes;
    verified.stats.onTimePercent = 88 + (row.jobs % 12);
    verified.stats.repeatCustomerPercent = 20 + (row.jobs % 45);
    verified.stats.disputeCount = row.jobs > 40 ? 1 : 0;
    verified.stats.disputeLostCount = 0;
    verified.stats.joinedAt = addDays(nowIso(), -(120 + row.jobs * 4));

    // Recompute the badge with real history in place.
    verified.verification = kernel.recordCheck(verified.proId, verified.verification, { subjectId: verified.proId, primaryTrade: verified.trade }, {
      name: 'platform_history',
      status: CHECK_STATUS.PASS,
      source: 'Lula ProVeri completed-job ledger',
      reference: `SEED_${fingerprint(verified.proId, 6)}`,
      finding: `${row.jobs} escrow-released job(s), ${verified.stats.disputeCount} dispute(s)`,
      evidence: { completedJobs: row.jobs, disputeRate: verified.stats.disputeCount / Math.max(row.jobs, 1) },
    });
    verified.trustScore = verified.verification.score;
    // Recompute badge, status and bidding clearance from the updated state.
    const standing = people.refreshStanding(verified.proId);

    pros.push(standing);
    const verifiedStanding = standing;
    summary.pros += 1;

    // Free microsite for every verified pro.
    if (verifiedStanding.canBid) {
      const site = webStudio.generateProMicrosite(verifiedStanding.proId);
      if (site.generated !== false) summary.microsites += 1;
    }
  }

  /* ---------------- reviews for seeded history ---------------- */
  const reviewComments = [
    'Arrived on time, explained everything before starting, and the photos he sent afterwards matched what I saw. Paid through escrow so I was never worried.',
    'Quoted honestly — the final amount was exactly the bid. No "while I am here" surprises.',
    'Very professional. Sent the certificate of compliance the same evening and it is on my profile now.',
    'Good work but had to come back once to finish a detail. The warranty holdback meant it cost me nothing to get it right.',
    'Fast response, fair price, cleaned up afterwards. Will book again.',
    'Booked through ProVeri because I live alone — the arrival code and the verified ID made the whole thing stress-free.',
    'Charged less than the other two bids and did a better job. The market band comparison helped me ask the right questions.',
    'Turned up during load shedding with his own inverter and finished the job. That alone is worth the platform fee.',
  ];
  let reviewIndex = 0;
  for (const pro of pros) {
    const count = Math.min(4, pro.stats.reviewCount);
    for (let i = 0; i < count; i += 1) {
      const customer = customers[(reviewIndex + i) % customers.length];
      const rating = pro.stats.averageRating >= 4.9 ? 5 : pro.stats.averageRating >= 4.7 ? (i % 4 === 3 ? 4.5 : 5) : 4.5;
      const review = {
        reviewId: `rev_seed_${pro.proId}_${i}`,
        bookingId: `bkg_seed_${pro.proId}_${i}`,
        bookingReference: `BKG-${String(9000 + reviewIndex).padStart(6, '0')}`,
        jobId: `job_seed_${pro.proId}_${i}`,
        customerId: customer.customerId,
        customerFirstName: customer.fullName.split(' ')[0],
        proId: pro.proId,
        proName: pro.displayName,
        categoryId: pro.primaryCategory,
        categoryLabel: pro.primaryCategoryLabel,
        suburb: customer.suburb,
        metro: customer.metro,
        rating,
        comment: reviewComments[reviewIndex % reviewComments.length],
        tags: ['on_time', 'fair_price', 'cleaned_up', 'escrow_protected'].slice(0, 2 + (reviewIndex % 3)),
        photos: [],
        jobValueCents: pro.pricing.hourlyRateCents ? pro.pricing.hourlyRateCents * 3 : catalog.get(pro.primaryCategory).band.p50Cents,
        verified: true,
        verificationBasis: 'Escrow-released booking — the reviewer paid for this work through ProVeri',
        evidenceSeal: fingerprint(`${pro.proId}:${reviewIndex}`, 16),
        warrantyDefects: reviewIndex % 11 === 0 ? 1 : 0,
        variations: 0,
        disputeId: null,
        proResponse: reviewIndex % 5 === 0 ? { text: 'Thank you — appreciated you taking the time. Any issue at all, call me first.', at: addDays(nowIso(), -reviewIndex) } : null,
        visible: true,
        helpfulCount: reviewIndex % 7,
        createdAt: addDays(nowIso(), -(reviewIndex * 3 + 2)),
      };
      store.put('reviews', review.reviewId, review);
      reviewIndex += 1;
      summary.reviews += 1;
    }
  }

  /* ---------------- jobs and bids ---------------- */
  const createdJobs = [];
  for (const row of JOB_ROSTER) {
    const customer = customers[row.customer];
    const suburb = catalog.suburb(row.suburb);
    const category = catalog.get(row.category);

    const job = await jobs.postJob({
      customerId: customer.customerId,
      categoryId: row.category,
      title: row.title,
      description: row.description,
      suburbId: suburb?.id,
      budgetCents: row.budget,
      urgency: row.urgency,
      preferredDates: row.preferredDate ? [row.preferredDate] : [addDays(nowIso(), 3).slice(0, 10), addDays(nowIso(), 5).slice(0, 10)],
      locationType: row.locationType || (category.remoteDelivery ? 'REMOTE' : category.inHomeDefault ? 'IN_HOME' : 'ON_SITE'),
      householdNotes: { childrenOnPremises: Boolean(row.children), vulnerableOccupants: Boolean(row.vulnerable) },
      instantBook: Boolean(row.instantBook),
      remoteDelivery: Boolean(row.remote),
      maxBids: 8,
      bidWindowHours: row.urgency === 'EMERGENCY' ? 4 : 48,
    });
    createdJobs.push({ job: store.get('jobs', job.jobId), row });
    summary.jobs += 1;
  }

  /* ---------------- bids ---------------- */
  const bidTexts = {
    plumbing: ['Replace the pressure control valve and test the thermostat and anode. If the cylinder itself has failed I will quote the replacement separately before doing anything.', 'Drain, isolate, replace valve and expansion vessel, refill, test at operating pressure, issue Plumbing CoC.', 'Emergency callout today: isolate, drain, temporary seal, then full valve replacement tomorrow morning with CoC.'],
    electrical: ['Replace the ceramic fuse DB with a 12-way DIN rail board with earth leakage, reterminate, test and issue an electrical CoC under SANS 10142-1.', 'Fault-find the tripping first (it may be a single appliance), then quote the DB upgrade separately. CoC included once the board is replaced.', 'Full DB replacement, all circuits labelled, earth-continuity and insulation-resistance tests, CoC issued same day.'],
    'solar-inverter': ['5 kW hybrid inverter, 10 kWh lithium battery, 8 x 555 W panels, mounting, DC and AC protection, CoC and SANS 10142-2 PV certificate. Commissioning report included.', '6 kW hybrid with 15 kWh storage to cover your 28 kWh/day and the pool pump — bigger battery, longer autonomy, better payback at current tariffs.', '5 kW system with a 5 kWh starter battery and a load-shedding changeover so essential circuits stay on. Expandable later without replacing the inverter.'],
    'cleaning-home': ['Four-person team, own equipment and eco chemicals, 6-hour deep clean including oven degrease, windows inside and out, cupboards emptied and wiped. Agent-ready checklist photo pack.', 'Two cleaners over two days so nothing is rushed. Includes wall spot-cleaning, skirting, light fittings and grout.'],
    handyman: ['Plasterboard-plus-brick mount with the correct anchors for a 65-inch set, plus two door rehanges with new hinges if needed. I bring a dust sheet and clean up.', 'Same-day visit. Mount, level, cable management, and both doors planed and refitted. Fixed price, no hourly creep.'],
    'securityInstaller': ['Four 4 MP cameras with night vision, NVR with a 2 TB drive, gate motor battery backup, electric fence test and CoC. PSIRA-registered install with a 24-month warranty.', 'Eight-camera option with solar-assisted power so the system stays live through Stage 6, plus access control on the gate.'],
    'vehicle-inspection': ['Full 118-point pre-purchase inspection: compression test on all four cylinders, paint-depth gauge across every panel, OBD-II fault scan, VIN and engine number verification against the registration certificate, odometer consistency check against service records, road test. Report issued same day and written into the ProVeri listing trust chain.', 'Standard inspection plus a lift check at my workshop — underside, suspension bushes, exhaust mounts and any weld repair evidence.'],
    'web-digital': ['Single-page mobile-first site with WhatsApp click-to-chat, ten-photo gallery, Google Business Profile setup and a review-request system. Live preview before you pay anything.', 'One-page site plus a Google Search and Meta radius campaign setup so the site actually gets seen. Ad budget is yours, funded directly with Google — I do not mark it up.'],
    'tutoring-education': ['Two 90-minute sessions a week, weekday evenings. Diagnostic test first, then a written plan per topic. Progress report to you monthly. SACE-registered and police-cleared.', 'Twice-weekly sessions plus a Saturday exam-prep block before each test cycle. Past-paper drilling with timed conditions.'],
  };

  for (const { job, row } of createdJobs) {
    const eligible = pros.filter((p) =>
      p.canBid && (p.primaryCategory === row.category || p.additionalCategories.includes(row.category)));
    const ranked = eligible
      .map((p) => ({ pro: p, km: p.location.metroId === job.location.metroId ? 5 + (p.stats.completedJobs % 20) : 90 }))
      .sort((a, b) => (b.pro.trustScore - a.pro.trustScore) || (a.km - b.km))
      .slice(0, row.bids || 0);

    const band = catalog.priceBand(row.category, job.location.metroId);
    const category = catalog.get(row.category);
    const texts = bidTexts[row.category] || ['Scope as described in the job post, materials included, warranty on workmanship.'];

    ranked.forEach(({ pro }, index) => {
      // Spread bids around the market band so Fair-Price Intelligence has something to say.
      const spread = [0.82, 1.0, 1.28, 0.68, 1.55][index % 5];
      const total = Math.round((band.p50Cents || row.budget || 100000) * spread / 100) * 100;
      const includesMaterials = !['tutoring-education', 'web-digital', 'cleaning-home', 'beauty-mobile'].includes(row.category);
      try {
        jobs.submitBid({
          jobId: job.jobId,
          proId: pro.proId,
          totalCents: total,
          calloutFeeCents: pro.pricing.calloutFeeCents || 0,
          materialsQuoteCents: includesMaterials ? percentageOf(total, 35) : 0,
          scopeOfWork: texts[index % texts.length],
          inclusions: includesMaterials ? ['Labour', 'Materials as specified', 'Site clean-up', `${category.label} warranty`] : ['Labour', 'Own equipment', 'Site clean-up'],
          exclusions: includesMaterials ? ['Structural repairs discovered after opening up', 'Municipal connection fees'] : ['Materials', 'Travel outside the agreed radius'],
          scheduledAt: row.preferredDate || addDays(nowIso(), 2 + index).slice(0, 10),
          durationHours: category.typicalDurationHours,
          includesCoc: category.requiresCoc,
          warrantyDays: category.riskLevel === 'HIGH' ? 21 : 14,
          message: index === 0 ? 'I can be there within your window. Happy to send a written scope before you accept.' : null,
        });
        summary.bids += 1;
      } catch (error) {
        kernel.ledger.append({
          action: 'SEED_BID_SKIPPED',
          subject: job.jobId,
          visibility: 'INTERNAL',
          payload: { summary: `${pro.displayName}: ${error.message}` },
        });
      }
    });
  }

  /* ---------------- completed bookings (the proof) ---------------- */
  const completedSpecs = [
    { customer: 3, proName: 'Sipho Dlamini', category: 'plumbing', title: 'Burst pipe under the kitchen sink', suburb: 'soweto', total: 185000, rating: 5, comment: 'Found the leak behind the cabinet, replaced the section and the isolation valve, and sent photos before and after. Paid through escrow and he was paid the moment I confirmed. The 5% holdback releasing two weeks later is why I will not pay a plumber cash again.' },
    { customer: 2, proName: 'Anwar Patel', category: 'electrical', title: 'DB board upgrade and electrical CoC', suburb: 'lenasia', total: 385000, rating: 5, comment: 'Old ceramic fuse board replaced with a proper DIN board, everything labelled, tested and the CoC emailed the same evening. My conveyancer accepted it without a question.' },
    { customer: 1, proName: 'Pieter du Toit', category: 'auto-mechanical', title: 'Major service and brake replacement', suburb: 'bellville', total: 465000, rating: 4.5, comment: 'Written job card, old parts shown to me, and the price was exactly the bid. Docked half a star only because the first slot moved — he told me a day ahead, which I appreciate.' },
    { customer: 8, proName: 'Fatima Naidoo', category: 'cleaning-home', title: 'Post-renovation deep clean', suburb: 'chatsworth', total: 210000, rating: 5, comment: 'Four people, six hours, and the place was better than when we moved in. The completed checklist with photos meant there was no argument about what was included.' },
    { customer: 6, proName: 'Charmaine Botha', category: 'solar-inverter', title: '5 kW hybrid system with 10 kWh battery', suburb: 'menlyn', total: 11200000, rating: 5, comment: 'Milestone escrow across four stages meant I never paid ahead of the work. Commissioning report, CoC and PV certificate all uploaded. We have not seen a dark house since.' },
    { customer: 0, proName: 'Nomvula Khumalo', category: 'beauty-mobile', title: 'Mobile hair and makeup for a wedding', suburb: 'sandton', total: 285000, rating: 5, comment: 'Booked a female pro because I was getting ready alone at home. Arrival code at the door, verified ID on my screen before I opened it. That is the reason I use this platform.' },
    { customer: 7, proName: 'Rajesh Govender', category: 'electric-fence-security', title: 'CCTV and electric fence with CoC', suburb: 'umhlanga', total: 1650000, rating: 4.5, comment: 'Everything runs through load shedding now, which was the whole point. The electric fence CoC came with the final photos.' },
    { customer: 0, proName: 'Zanele Mthembu', category: 'web-digital', title: 'Business website and Google profile', suburb: 'fourways', total: 495000, rating: 5, comment: 'Preview before payment, exactly as promised. Two revision rounds, then milestone releases on handover. Calls from Google Maps started in week two.' },
  ];

  for (const spec of completedSpecs) {
    const customer = customers[spec.customer];
    const pro = pros.find((p) => p.fullName === spec.proName);
    if (!pro || !customer) continue;
    const suburb = catalog.suburb(spec.suburb);
    const category = catalog.get(spec.category);

    // Create a real job → bid → award → fund → evidence → confirm → review.
    const job = await jobs.postJob({
      customerId: customer.customerId,
      categoryId: spec.category,
      title: spec.title,
      description: `${spec.title}. Completed and escrow-released on ProVeri — retained as verified delivery history.`,
      suburbId: suburb?.id,
      budgetCents: spec.total,
      urgency: 'SOON',
      preferredDates: [addDays(nowIso(), -21).slice(0, 10)],
      locationType: category.remoteDelivery ? 'REMOTE' : category.inHomeDefault ? 'IN_HOME' : 'ON_SITE',
      householdNotes: { childrenOnPremises: category.childrenDefault },
    });

    let bid;
    try {
      bid = jobs.submitBid({
        jobId: job.jobId,
        proId: pro.proId,
        totalCents: spec.total,
        calloutFeeCents: pro.pricing.calloutFeeCents || 0,
        materialsQuoteCents: percentageOf(spec.total, 30),
        scopeOfWork: `${spec.title} — labour, materials as specified, site clean-up and a ${category.riskLevel === 'HIGH' ? '21' : '14'}-day workmanship warranty.`,
        inclusions: ['Labour', 'Materials as specified', 'Site clean-up', 'Workmanship warranty'],
        exclusions: ['Structural or concealed defects discovered after opening up'],
        scheduledAt: addDays(nowIso(), -20).slice(0, 10),
        durationHours: category.typicalDurationHours,
        includesCoc: category.requiresCoc,
        warrantyDays: category.riskLevel === 'HIGH' ? 21 : 14,
      });
    } catch (error) {
      kernel.ledger.append({ action: 'SEED_BOOKING_SKIPPED', subject: job.jobId, visibility: 'INTERNAL', payload: { summary: error.message } });
      continue;
    }

    const booking = bookings.acceptBid({
      jobId: job.jobId,
      bidId: bid.bidId,
      customerId: customer.customerId,
      scheduledAt: addDays(nowIso(), -20),
    });

    await bookings.fundBooking({ bookingId: booking.bookingId, customerId: customer.customerId, paymentMethod: 'instant-eft' });
    bookings.shareEta({ bookingId: booking.bookingId, proId: pro.proId, etaMinutes: 18 });
    bookings.verifyArrivalCode({ bookingId: booking.bookingId, customerId: customer.customerId, code: booking.arrival.gateCode });
    bookings.checkIn({ bookingId: booking.bookingId, actorId: pro.proId, kind: 'STARTED', lat: suburb?.lat, lon: suburb?.lon });

    const milestone = store.get('bookings', booking.bookingId).milestones[0];
    const evidenceItems = evidenceForBooking({
      bookingId: booking.bookingId,
      category,
      suburb,
      notes: { BEFORE_PHOTO: 'Condition on arrival', AFTER_PHOTO: 'Completed work', PRO_SIGNATURE: 'Signed off by the pro' },
    });
    bookings.submitEvidence({
      bookingId: booking.bookingId,
      proId: pro.proId,
      milestoneId: milestone.milestoneId,
      items: evidenceItems,
      note: 'Completed as per the locked scope.',
      materialsReceipts: percentageOf(spec.total, 30) > 0 ? [{ amountCents: percentageOf(spec.total, 28), supplier: 'Builders Warehouse', hash: `${booking.bookingId}-receipt` }] : [],
    });
    // Rating is deliberately NOT passed here — the explicit writeReview below
    // exercises the REV-001 gate on its own path.
    bookings.confirmCompletion({ bookingId: booking.bookingId, customerId: customer.customerId, milestoneId: milestone.milestoneId, comment: 'Accepted — work matches the locked scope.' });
    bookings.writeReview({
      bookingId: booking.bookingId,
      customerId: customer.customerId,
      rating: spec.rating,
      comment: spec.comment,
      tags: ['on_time', 'fair_price', 'escrow_protected', 'would_book_again'].slice(0, 3),
    });

    // Age the warranty window so the holdback releases and the ledger tells the
    // full story. Both the booking copy and the escrow source of truth move,
    // and the escrow movement is audit-logged by the kernel.
    const current = store.get('bookings', booking.bookingId);
    const aged = addMinutes(nowIso(), -1);
    current.warranty.endsAt = aged;
    kernel.escrow.adjustHoldbackWindow(current.escrowId, {
      holdbackReleaseAt: aged,
      reason: 'Seeded historical booking — warranty window already elapsed',
      actorId: 'seed',
    });
    try { bookings.closeWarranty({ bookingId: booking.bookingId }); } catch { /* leave in warranty */ }
    summary.bookings += 1;
  }

  /* ---------------- one booking deliberately left in warranty ---------------- */
  const warrantyPro = pros.find((p) => p.primaryCategory === 'painting');
  const warrantyCustomer = customers[6];
  if (warrantyPro && warrantyCustomer) {
    const suburb = catalog.suburb('menlyn');
    const job = await jobs.postJob({
      customerId: warrantyCustomer.customerId,
      categoryId: 'painting',
      title: 'Interior repaint of the lounge and passage',
      description: 'Lounge and passage repaint, roughly 40 m² of wall, damp spot to treat first.',
      suburbId: suburb?.id,
      budgetCents: 720000,
      urgency: 'SOON',
      preferredDates: [addDays(nowIso(), -6).slice(0, 10)],
      locationType: 'IN_HOME',
    });
    const bid = jobs.submitBid({
      jobId: job.jobId, proId: warrantyPro.proId, totalCents: 685000,
      materialsQuoteCents: 240000, scopeOfWork: 'Treat the damp spot, one coat primer, two coats acrylic, ceilings and cornices included, all furniture covered.',
      inclusions: ['Labour', 'Materials', 'Damp treatment', 'Site clean-up'], exclusions: ['Structural damp-proofing'],
      scheduledAt: addDays(nowIso(), -5).slice(0, 10), durationHours: 16, warrantyDays: 21,
    });
    const booking = bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: warrantyCustomer.customerId, scheduledAt: addDays(nowIso(), -5) });
    await bookings.fundBooking({ bookingId: booking.bookingId, customerId: warrantyCustomer.customerId, paymentMethod: 'card' });
    bookings.verifyArrivalCode({ bookingId: booking.bookingId, customerId: warrantyCustomer.customerId, code: booking.arrival.gateCode });
    bookings.checkIn({ bookingId: booking.bookingId, actorId: warrantyPro.proId, kind: 'STARTED', lat: suburb.lat, lon: suburb.lon });
    const ms = store.get('bookings', booking.bookingId).milestones[0];
    bookings.submitEvidence({
      bookingId: booking.bookingId, proId: warrantyPro.proId, milestoneId: ms.milestoneId,
      items: [
        ...evidenceForBooking({
          bookingId: booking.bookingId,
          category: catalog.get('painting'),
          suburb,
          notes: { BEFORE_PHOTO: 'Damp patch before treatment', AFTER_PHOTO: 'Two coats complete', PRO_SIGNATURE: 'Signed off' },
        }),
        { type: 'PROGRESS_PHOTO', note: 'Primer coat', geo: { lat: suburb.lat, lon: suburb.lon }, hash: `${booking.bookingId}-progress` },
      ],
    });
    bookings.confirmCompletion({ bookingId: booking.bookingId, customerId: warrantyCustomer.customerId, milestoneId: ms.milestoneId, rating: 4.5, comment: 'Neat work and the damp has not come back.' });
    summary.bookings += 1;
  }

  /* ---------------- one open dispute ---------------- */
  const disputePro = pros.find((p) => p.primaryCategory === 'roofing-gutters');
  const disputeCustomer = customers[3];
  if (disputePro && disputeCustomer) {
    const suburb = catalog.suburb('roodepoort');
    const job = await jobs.postJob({
      customerId: disputeCustomer.customerId, categoryId: 'roofing-gutters', title: 'Gutter replacement on the north side',
      description: 'Replace about 12 m of guttering and fix two brackets.', suburbId: suburb?.id, budgetCents: 480000,
      urgency: 'SOON', preferredDates: [addDays(nowIso(), -3).slice(0, 10)],
    });
    const bid = jobs.submitBid({
      jobId: job.jobId, proId: disputePro.proId, totalCents: 445000, materialsQuoteCents: 210000,
      scopeOfWork: 'Supply and fit 12 m of PVC guttering, replace two brackets, clear the downpipes, water test.',
      inclusions: ['Labour', 'Guttering', 'Brackets', 'Water test'], exclusions: ['Fascia board replacement'],
      scheduledAt: addDays(nowIso(), -2).slice(0, 10), durationHours: 8, warrantyDays: 21,
    });
    const booking = bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: disputeCustomer.customerId });
    await bookings.fundBooking({ bookingId: booking.bookingId, customerId: disputeCustomer.customerId, paymentMethod: 'instant-eft' });
    bookings.checkIn({ bookingId: booking.bookingId, actorId: disputePro.proId, kind: 'STARTED' });
    const ms = store.get('bookings', booking.bookingId).milestones[0];
    bookings.submitEvidence({
      bookingId: booking.bookingId, proId: disputePro.proId, milestoneId: ms.milestoneId,
      items: evidenceForBooking({
        bookingId: booking.bookingId,
        category: catalog.get('roofing-gutters'),
        suburb,
        notes: { BEFORE_PHOTO: 'Old guttering', AFTER_PHOTO: 'New guttering', PRO_SIGNATURE: 'Signed' },
      }).map((item) => (item.type === 'AFTER_PHOTO'
        // Deliberately captured off-site — exercises the geoseal policy.
        ? { ...item, geo: { lat: suburb.lat + 0.09, lon: suburb.lon + 0.07 } }
        : item)),
    });
    bookings.openDispute({
      bookingId: booking.bookingId, openedBy: disputeCustomer.customerId, role: 'CUSTOMER',
      category: 'WORK_INCOMPLETE',
      description: 'The after-photo is not my house and the downpipes were never cleared. Water still overflows at the corner.',
      evidence: [{ type: 'PHOTO', note: 'Photo of the overflowing corner taken the morning after', hash: `${booking.bookingId}-customer-1` }],
      desiredOutcome: 'PARTIAL',
    });
    bookings.submitDisputeEvidence({
      disputeId: store.get('bookings', booking.bookingId).disputeId,
      actorId: disputePro.proId, role: 'PRO',
      evidence: [{ type: 'PHOTO', note: 'Guttering installed', hash: `${booking.bookingId}-pro-rebuttal` }],
      statement: 'The guttering was replaced as quoted. I photographed the wrong side of the roof by mistake.',
    });
    summary.bookings += 1;
  }

  /* ---------------- vehicles vertical ---------------- */
  const inspector = pros.find((p) => p.primaryCategory === 'vehicle-inspection');
  const seller = customers[6];
  const buyer = customers[0];
  const menlyn = catalog.suburb('menlyn');

  const listing = vehicles.createListing({
    sellerId: seller.customerId,
    vin: 'AHTZZZ12345678901'.replace(/[^A-HJ-NPR-Z0-9]/g, 'X').padEnd(17, '7').slice(0, 17),
    engineNumber: '2ZR1234567',
    registrationNumber: 'CA123456',
    make: 'Toyota', model: 'Corolla 1.8 XS', year: 2019, odometerKm: 84000,
    colour: 'Pearl White', priceCents: 26500000,
    description: 'One owner, full service history at Toyota agents, accident-free per seller declaration. Two keys, spare wheel unused, new front tyres at 78,000 km. Sold because we are moving abroad.',
    condition: 'Excellent — verified after independent inspection',
    knownDefects: ['Minor bumper scuff on the rear left, touch-up paint applied'],
    includedItems: ['Two keys', 'Full service book', 'Spare wheel and tools', 'Floor mats'],
    suburbId: menlyn?.id,
    evidence: { registrationCertificateHash: 'natis-reg-CA123456', natisDocumentHash: 'natis-doc-2019-corolla', roadworthyCertificateHash: 'rwc-2026-09', settlementLetterHash: null },
    titleHolder: { type: 'NONE' },
    photos: [
      { hash: 'corolla-front-34', caption: 'Front three-quarter' },
      { hash: 'corolla-odometer', caption: 'Odometer at 84,000 km' },
      { hash: 'corolla-vin-plate', caption: 'VIN plate' },
      { hash: 'corolla-engine-bay', caption: 'Engine bay' },
    ],
    serviceHistory: [
      { at: '2024-03-14', odometerKm: 60100, agent: 'Toyota Menlyn', items: ['Major service', 'Brake fluid'] },
      { at: '2025-05-02', odometerKm: 74800, agent: 'Toyota Menlyn', items: ['Major service', 'Front brake pads'] },
    ],
  });

  vehicles.submitChecks(listing.listingId, [
    { name: 'seller_identity_fica', status: CHECK_STATUS.PASS, source: 'KYC provider — DHA NPR real-time', reference: `FICA_${fingerprint(seller.customerId, 8)}`, finding: 'Seller identity, address and liveness verified', evidence: { sellerIdRef: seller.customerId } },
    { name: 'vin_engine_registration_match', status: CHECK_STATUS.PASS, source: 'TransUnion FirstCheck-class vehicle data', reference: `VC_${fingerprint(listing.listingId, 8)}`, finding: 'VIN, engine number, colour, model and year all match the registration record', evidence: { vehicleReportRef: listing.listingId } },
    { name: 'ownership_natis', status: CHECK_STATUS.PASS, source: 'NaTIS-class ownership lookup', reference: `NT_${fingerprint(listing.listingId, 8)}`, finding: 'Seller is the registered owner; no title holder recorded', evidence: { natisRef: listing.listingId } },
    { name: 'police_stolen_status', status: CHECK_STATUS.PASS, source: 'SAPS stolen-vehicle indicator', reference: `SP_${fingerprint(listing.listingId, 8)}`, finding: 'No stolen flag returned', evidence: { stolenCheckRef: listing.listingId } },
    { name: 'finance_settlement', status: CHECK_STATUS.PASS, source: 'NaTIS title-holder record', reference: `FN_${fingerprint(listing.listingId, 8)}`, finding: 'No outstanding finance — the seller is the outright owner', evidence: { settlementLetterHash: 'none-required' } },
    { name: 'independent_condition_report', status: CHECK_STATUS.PASS, source: 'DEKRA-class independent assessor', reference: `IR_${fingerprint(listing.listingId, 8)}`, finding: '118-point inspection passed; no accident repair evidence; odometer consistent with service history', evidence: { inspectionReportHash: listing.evidence.roadworthyCertificateHash } },
  ]);
  summary.vehicles += 1;

  /* ---------------- the cross-vertical bridge in action ---------------- */
  if (inspector) {
    // A buyer books the inspection as a normal service job…
    const inspectionJob = createdJobs.find((c) => c.row.category === 'vehicle-inspection');
    if (inspectionJob) {
      const job = inspectionJob.job;
      const inspectorBid = store.find('bids', (b) => b.jobId === job.jobId && b.proId === inspector.proId)[0];
      if (inspectorBid) {
        const inspectingBuyer = job.customerId;
        const booking = bookings.acceptBid({ jobId: job.jobId, bidId: inspectorBid.bidId, customerId: inspectingBuyer });
        await bookings.fundBooking({ bookingId: booking.bookingId, customerId: inspectingBuyer, paymentMethod: 'card', remitFrom: 'GBP' });
        bookings.verifyArrivalCode({ bookingId: booking.bookingId, customerId: inspectingBuyer, code: booking.arrival.gateCode });
        bookings.checkIn({ bookingId: booking.bookingId, actorId: inspector.proId, kind: 'STARTED', lat: menlyn.lat, lon: menlyn.lon });
        const ms = store.get('bookings', booking.bookingId).milestones[0];
        bookings.submitEvidence({
          bookingId: booking.bookingId, proId: inspector.proId, milestoneId: ms.milestoneId,
          items: evidenceForBooking({
            bookingId: booking.bookingId,
            category: catalog.get('vehicle-inspection'),
            // Evidence is captured at the JOB address (where the car was viewed),
            // so the geoseal passes; only the dispute booking fails it on purpose.
            suburb: catalog.suburb('midrand'),
            notes: {
              VIN_PHOTO: listing.asset.vin,
              ODOMETER_PHOTO: '84,000 km — consistent with the service book',
              INSPECTION_REPORT: '118-point report: pass, no accident evidence',
              AFTER_PHOTO: 'Vehicle as inspected',
              PRO_SIGNATURE: 'Assessor sign-off',
            },
          }),
        });
        bookings.confirmCompletion({
          bookingId: booking.bookingId, customerId: inspectingBuyer, milestoneId: ms.milestoneId, rating: 5,
          comment: 'Booked an inspection through ProVeri and the report went straight into the car listing. The VIN and odometer are now sealed against the job — I stopped worrying about the advert matching the car.',
        });
        // …and the report writes into the vehicle listing's trust chain.
        marketplace.bridgeBookingToVehicle({
          bookingId: booking.bookingId,
          vin: listing.asset.vin,
          reportHash: `${booking.bookingId}-report`,
          findings: '118-point pre-purchase inspection: pass. VIN verified on the vehicle. Odometer consistent with the agent service history. No accident repair evidence on paint-depth scanning.',
        });
        summary.bookings += 1;
      }
    }

    // Start the buyer's negotiation and lock the listing.
    const current = store.get('vehicles', listing.listingId);
    if (current.status === 'VERIFIED') {
      vehicles.startNegotiation(current.listingId, {
        buyerId: buyer.customerId,
        offerCents: 25500000,
        terms: { subjectTo: ['fresh roadworthy certificate', 'same VIN at handover', 'NaTIS transfer in the buyer’s name before final release'], handoverLocation: 'ProVeri verification point, Menlyn' },
      });
      vehicles.confirmBuyerFunds(current.listingId, {
        buyerId: buyer.customerId, amountCents: 25500000, providerRef: 'open-banking-reservation-ref',
        availableCents: 30000000, reservationTtlMinutes: 120,
      });
    }
  }

  /* ---------------- Web Studio paid orders ---------------- */
  const webOrder = webStudio.createEnquiry({
    packageId: 'digital-storefront',
    proId: pros.find((p) => p.primaryCategory === 'plumbing')?.proId,
    contact: { firstName: 'Sipho', surname: 'Dlamini', email: 'sipho@example.co.za', mobile: '0761112223', businessName: 'Dlamini Plumbing', suburb: 'Soweto', preferredChannel: 'whatsapp' },
    brief: { whatTheSiteMustDo: 'Get calls from Soweto and Roodepoort homeowners, show my PIRB registration, and let people book through ProVeri.', logoProvided: true, galleryPhotos: 10 },
  });
  webStudio.buildPreview(webOrder.orderId);
  webStudio.approvePreview(webOrder.orderId, { approved: true, feedback: null, paymentProvider: 'payfast' });
  webStudio.payOrder(webOrder.orderId, { reference: `PF_${fingerprint(webOrder.orderId, 10)}`, method: 'card' });
  webStudio.completeMilestone(webOrder.orderId, { milestoneSeq: 1, deliverable: 'Live preview approved by the client', actorId: 'lula-webstudio' });
  webStudio.completeMilestone(webOrder.orderId, { milestoneSeq: 2, deliverable: 'dlaminiplumbing.co.za live, Google Business Profile verified, gallery and WhatsApp link configured', actorId: 'lula-webstudio' });

  webStudio.createEnquiry({
    growthServiceId: 'google-maps',
    contact: { firstName: 'Lerato', surname: 'Mashaba', email: 'lerato@example.co.za', mobile: '0791112224', businessName: 'Mashaba Garden Services', suburb: 'Midrand', preferredChannel: 'whatsapp' },
    brief: { message: 'I want to appear when people search "garden service near me" in Midrand.' },
  });

  /* ================================================================== *
   * BUSINESS SITE STUDIO
   * The MyServicePro demo-site pipeline, rebuilt so the buttons work:
   * six South African businesses across six industries, each with a
   * themed, permission-cleared, subscription-backed site, and bookings
   * that become real reservations or real escrow-ready jobs.
   * ================================================================== */
  const sites = marketplace.businessSites;
  const salesDesk = marketplace.salesDesk;
  const plumberPro = pros.find((p) => p.primaryCategory === 'plumbing' && p.canBid);

  const studioSpecs = [
    {
      templateId: 'trade-services',
      businessName: 'Dlamini Plumbing',
      proId: plumberPro?.proId,
      suburbId: 'soweto',
      planId: 'business-growth',
      contact: { phone: plumberPro?.mobile, email: 'sipho@dlaminiplumbing.co.za', whatsapp: plumberPro?.mobile, address: '14 Vilakazi Street, Orlando West' },
      tagline: 'PIRB-registered. Paid only after you are happy.',
      description: 'Sipho Dlamini has been plumbing Soweto, Roodepoort and the West Rand for 14 years. Geyser specialist — solar, heat pump and electric — and every job that needs one leaves with a Plumbing CoC.',
      assets: [
        { filename: 'geyser-replacement-before.jpg', caption: 'Old electric geyser with a weeping pressure valve before replacement', bytes: 480000 },
        { filename: 'geyser-replacement-after.jpg', caption: 'New 150 litre geyser installed with a compliant drip tray and isolator', bytes: 720000 },
        { filename: 'pirb-certificate-of-compliance.jpg', caption: 'Plumbing Certificate of Compliance issued on the job', bytes: 210000 },
      ],
      permission: { grantedBy: 'Sipho Dlamini', role: 'owner', method: 'whatsapp', identifiablePeople: false, notes: 'Pro sent his own job photos and confirmed he took them on site.' },
      bookings: [
        { values: { name: 'Naledi Sithole', phone: '0821234501', email: 'naledi.s@example.co.za', service: 'Geyser replacement', suburb: 'Bryanston', urgency: 'URGENT — today', budget: 6500, notes: 'Two-year-old 200 litre geyser dripping from the pressure valve onto the ceiling below.' }, expectJob: true },
        { values: { name: 'Kagiso Molefe', phone: '0791234504', service: 'Blocked drain', suburb: 'Soweto', urgency: 'SOON — this week', budget: 1200, notes: 'Kitchen drain backing up, tried a plunger.' }, expectJob: true },
      ],
      updates: ['Added the emergency callout line to the hours block', 'Swapped two job photos after the owner sent better ones'],
    },
    {
      templateId: 'restaurant',
      businessName: "Thando's Table",
      suburbId: 'sea-point',
      planId: 'business-growth',
      contact: { phone: '0214349911', email: 'book@thandostable.co.za', whatsapp: '0721403821', address: '78 Main Road, Sea Point' },
      tagline: 'Fire, salt and a view worth the drive',
      assets: [
        { filename: 'dry-aged-sirloin-hero.jpg', caption: 'Dry-aged sirloin off the grill with herb butter', bytes: 1400000 },
        { filename: 'dining-room-ocean-view.jpg', caption: 'Main dining room with the ocean view at sunset', bytes: 980000 },
        { filename: 'chef-plating-mains.jpg', caption: 'Chef plating the linefish in the open kitchen', bytes: 860000, identifiablePeople: true },
      ],
      permission: { grantedBy: 'Thandiwe Radebe', role: 'owner', method: 'email', identifiablePeople: true, popiaConsent: true, notes: 'Owner supplied the photos and confirmed the chef in frame consented to being photographed for the site.' },
      bookings: [
        { values: { name: 'Ruan Pretorius', phone: '0831234502', date: addDays(nowIso(), 6).slice(0, 10), time: '19:30', guests: '4', notes: 'Anniversary — a quiet corner if you have one' } },
        { values: { name: 'Aisha Moosa', phone: '0761234503', date: addDays(nowIso(), 2).slice(0, 10), time: '13:00', guests: '2', notes: 'Halal options please' } },
        { values: { name: 'Mariette Coetzee', phone: '0721234507', date: addDays(nowIso(), 12).slice(0, 10), time: '18:00', guests: '12', notes: 'Birthday table for twelve, set menu' } },
      ],
      updates: ['Winter menu prices updated across the mains category'],
    },
    {
      templateId: 'transport-transfers',
      businessName: 'Egoli Airport Shuttles',
      suburbId: 'kempton-park',
      planId: 'enterprise',
      contact: { phone: '0119742200', email: 'dispatch@egolishuttles.co.za', whatsapp: '0831230000', address: 'OR Tambo International, Terminal B forecourt' },
      tagline: 'On time, every time, with the paperwork to prove it',
      assets: [
        { filename: 'fleet-13-seater-quantum.jpg', caption: 'Thirteen-seater shuttle vehicle on the airport forecourt', bytes: 1100000 },
        { filename: 'driver-meet-and-greet-arrivals.jpg', caption: 'Driver meeting a guest at arrivals with a name board', bytes: 640000, identifiablePeople: true },
      ],
      permission: { grantedBy: 'Sipho Mabena', role: 'operations director', method: 'in-person', identifiablePeople: true, popiaConsent: true, notes: 'Signed permission form on file; the driver in frame is an employee who consented in writing.' },
      bookings: [
        { values: { name: 'Priya Naidoo', phone: '0831234508', pickup: 'OR Tambo International, arrivals', dropoff: 'Umhlanga Rocks hotel', date: addDays(nowIso(), 3).slice(0, 10), time: '10:15', passengers: '3', vehicle: '9-seater', notes: 'SA 324, two large bags, one child seat' } },
        { values: { name: 'Tshepo Mahlangu', phone: '0611234506', pickup: 'Sandton convention centre', dropoff: 'OR Tambo International', date: addDays(nowIso(), 9).slice(0, 10), time: '04:45', passengers: '1', vehicle: 'Sedan (1–3)', notes: 'Early flight, need a 04:45 pickup' } },
      ],
      updates: [],
    },
    {
      templateId: 'accommodation',
      businessName: 'Umoya Guesthouse',
      suburbId: 'midrand',
      planId: 'business-growth',
      contact: { phone: '0112345678', email: 'stay@umoyaguesthouse.co.za', whatsapp: '0791230000', address: '9 Fourth Avenue, Midrand' },
      tagline: 'Home-from-home, ten minutes from everything',
      assets: [
        { filename: 'garden-double-room.jpg', caption: 'Garden double room with the patio doors open', bytes: 1200000 },
        { filename: 'breakfast-on-the-deck.jpg', caption: 'Breakfast served on the deck', bytes: 700000 },
      ],
      permission: { grantedBy: 'Nomsa Khumalo', role: 'owner', method: 'whatsapp', identifiablePeople: false },
      bookings: [
        { values: { name: 'Brenda Williams', phone: '0841234505', email: 'brenda.w@example.co.za', checkIn: addDays(nowIso(), 14).slice(0, 10), checkOut: addDays(nowIso(), 17).slice(0, 10), guests: '2', room: 'Garden double', notes: 'Late arrival around 21:00, please' } },
      ],
      updates: [],
    },
    {
      templateId: 'fashion-retail',
      businessName: 'Mzansi Threads',
      suburbId: 'melville',
      planId: 'essential',
      contact: { phone: '0114447788', email: 'hello@mzansithreads.co.za', whatsapp: '0721400000', address: '2 Melville Central, 7th Street' },
      tagline: 'Curated South African fashion & lifestyle',
      assets: [
        { filename: 'signature-tee-charcoal-studio.jpg', caption: 'Signature tee in charcoal on the studio rail', bytes: 520000 },
        { filename: 'hand-thrown-mug-homeware.jpg', caption: 'Hand-thrown stoneware mug from the homeware shelf', bytes: 380000 },
        { filename: 'ai-utility-overshirt.jpg', caption: 'Utility overshirt — illustrative render, sample not yet photographed', bytes: 240000, aiGenerated: true, source: 'ai-generated' },
      ],
      permission: { grantedBy: 'Ayanda Ncube', role: 'owner', method: 'email', identifiablePeople: false, notes: 'Product photos shot in store; the AI render is labelled as illustrative on the public page.' },
      bookings: [
        { values: { name: 'Sibusiso Zulu', phone: '0761234509', item: 'Signature tee — charcoal', size: 'L', fulfilment: 'Courier (R85)', notes: 'Deliver to Chatsworth,Durban' } },
      ],
      updates: ['Restocked the kids collection and added sizes'],
    },
    {
      templateId: 'wine-estate',
      businessName: 'Kloof Cellars',
      suburbId: 'stellenbosch',
      planId: 'essential',
      contact: { phone: '0218877120', email: 'tastings@kloofcellars.co.za', whatsapp: '0721400011', address: 'R44, Stellenbosch' },
      tagline: 'Rooted in tradition, crafted in precision',
      // Deliberately no permission record: this is the site the publish gate
      // stops, so the compliance feature is visible in the demo data.
      assets: [
        { filename: 'cellar-flight-tasting.jpg', caption: 'Cellar flight poured in the tasting room', bytes: 900000 },
        { filename: 'vineyard-rows-morning.jpg', caption: 'Vineyard rows on the north-facing slope', bytes: 1300000 },
      ],
      permission: null,
      bookings: [],
      updates: [],
      leaveInPreview: true,
    },
  ];

  for (const spec of studioSpecs) {
    const site = sites.scaffold({
      templateId: spec.templateId,
      businessName: spec.businessName,
      tagline: spec.tagline || null,
      description: spec.description || null,
      proId: spec.proId || null,
      suburbId: spec.suburbId,
      contact: spec.contact,
      planId: spec.planId,
    });
    summary.sites = (summary.sites || 0) + 1;

    for (const asset of spec.assets || []) {
      sites.addAsset(site.siteId, {
        filename: asset.filename,
        caption: asset.caption,
        bytes: asset.bytes,
        aiGenerated: Boolean(asset.aiGenerated),
        source: asset.source || 'owner-supplied',
      });
    }
    if (spec.permission) {
      sites.recordPermission(site.siteId, {
        grantedBy: spec.permission.grantedBy,
        role: spec.permission.role,
        method: spec.permission.method,
        identifiablePeople: Boolean(spec.permission.identifiablePeople),
        popiaConsent: Boolean(spec.permission.popiaConsent),
        notes: spec.permission.notes || null,
        evidenceHash: `permission-${fingerprint(site.siteId, 8)}`,
      });
    }

    for (const note of spec.updates || []) sites.logUpdate(site.siteId, { summary: note, actorId: 'studio' });

    if (!spec.leaveInPreview) {
      sites.subscribe(site.siteId, { planId: spec.planId, paymentProvider: 'paystack', reference: `SUB_${fingerprint(site.siteId, 10)}` });
      sites.publish(site.siteId);
      summary.sitesLive = (summary.sitesLive || 0) + 1;
    } else {
      sites.preview(site.siteId);
      // Prove the gate works on the seeded data too.
      try {
        sites.publish(site.siteId);
      } catch (error) {
        kernel.ledger.append({
          action: 'SEED_PUBLISH_GATE_DEMONSTRATED',
          subject: site.siteId,
          visibility: 'INTERNAL',
          payload: { summary: `${site.name} stayed unpublished as intended: ${error.message}` },
        });
      }
    }

    for (const booking of spec.bookings || []) {
      const result = await sites.submitBooking(site.siteId, booking.values, { source: 'website' });
      summary.siteBookings = (summary.siteBookings || 0) + 1;
      if (result.job && booking.expectJob) summary.siteJobs = (summary.siteJobs || 0) + 1;
      if (result.status === 'NEW' || result.status === 'CONFIRMED') {
        // The business confirms the ones it can honour, so the demo shows both
        // states: an actioned reservation and one still waiting.
        if (booking.values.guests !== '12') sites.decideBooking(result.bookingId, { decision: 'CONFIRMED', actorId: 'owner', note: 'Confirmed on WhatsApp' });
      }
    }
  }

  /* ---------------- the sales desk that produced those sites ---------------- */
  const leadSpecs = [
    { businessName: 'Harbour Light Seafood', industry: 'restaurant', suburbId: 'sea-point', url: 'https://harbourlight.example.co.za', contactName: 'Mia', phone: '0214341122', websiteStatus: 'OUTDATED', source: 'FIELD_RESEARCH', notes: 'Menu PDF from 2019, no booking button, text-only site.' },
    { businessName: 'Kloof Street Bistro', industry: 'restaurant', suburbId: 'cpt-cbd', url: 'https://kloofstreetbistro.example.co.za', contactName: 'Owner', phone: '0214223344', websiteStatus: 'MINIMAL', source: 'FIELD_RESEARCH', notes: 'One page, no hours, no call to action.' },
    { businessName: 'Bergzicht Guest Farm', industry: 'accommodation', suburbId: 'stellenbosch', url: null, contactName: 'Elsa', phone: '0218884455', websiteStatus: 'NO_WEBSITE', source: 'WALK_IN', notes: 'Only a Facebook page. Takes bookings by phone and loses them.' },
    { businessName: 'Sandton Shuttle Co', industry: 'transport', suburbId: 'sandton', url: 'https://sandtonshuttle.example.co.za', contactName: 'Dispatch', phone: '0118834400', websiteStatus: 'SLOW_ON_MOBILE', source: 'FIELD_RESEARCH', notes: 'Desktop-only template, 4 MB hero image, no click-to-call.' },
    { businessName: 'Nails on Main', industry: 'beauty', suburbId: 'parkhurst', url: 'https://nailsonmain.example.co.za', contactName: 'Zinhle', phone: '0114427788', websiteStatus: 'BROKEN', source: 'REFERRAL', notes: 'Domain expired three months ago. Referred by another salon.' },
    { businessName: 'Vermeulen Accountants', industry: 'accounting', suburbId: 'centurion', url: 'https://vermeulenacct.example.co.za', contactName: 'Rian', phone: '0126641100', websiteStatus: 'GENERIC_TEMPLATE', source: 'FIELD_RESEARCH', notes: 'Stock template with placeholder text still on the about page.' },
  ];

  for (const spec of leadSpecs) {
    const suburb = catalog.suburb(spec.suburbId);
    const lead = salesDesk.capture({
      businessName: spec.businessName,
      industry: spec.industry,
      url: spec.url,
      contactName: spec.contactName,
      phone: spec.phone,
      suburb: suburb?.name,
      metro: suburb?.metroName,
      source: spec.source,
      websiteStatus: spec.websiteStatus,
      notes: spec.notes,
      consent: { marketingOptIn: ['REFERRAL', 'WALK_IN'].includes(spec.source) },
    });
    summary.leads = (summary.leads || 0) + 1;
    await salesDesk.diagnose(lead.leadId);

    // Two of them get a demo built before the meeting — the pitch is show, don't tell.
    if (['Bergzicht Guest Farm', 'Nails on Main'].includes(spec.businessName)) {
      salesDesk.buildDemo(lead.leadId, { businessName: spec.businessName });
      salesDesk.logOutreach(lead.leadId, { channel: 'WHATSAPP', template: 'WHATSAPP', note: 'Sent the preview link with the working booking form', actorId: 'sales-desk' });
      summary.demos = (summary.demos || 0) + 1;
    }
    if (spec.businessName === 'Harbour Light Seafood') {
      salesDesk.logOutreach(lead.leadId, { channel: 'EMAIL', template: 'COLD_EMAIL', note: 'Cold email sent with the diagnostic summary', actorId: 'sales-desk' });
      salesDesk.update(lead.leadId, { stage: 'PREVIEW_SENT', notes: `${spec.notes} Sent the preview; owner asked about the booking form.` });
    }
    if (spec.businessName === 'Vermeulen Accountants') {
      // The honest outcome: the site is fine, so we do not sell a rebuild.
      salesDesk.lose(lead.leadId, { reason: 'Site scored healthy on the diagnostic — recommended growth services only, no rebuild. Kept on the nurture list.' });
    }
  }

  // One lead converted end to end, so the pipeline has a real won deal.
  const convertedLead = store.findOne('salesLeads', (l) => l.businessName === 'Bergzicht Guest Farm');
  if (convertedLead) {
    salesDesk.convert(convertedLead.leadId, { planId: 'business-growth' });
    const wonSite = store.get('businessSites', convertedLead.siteId);
    if (wonSite && wonSite.status !== 'LIVE') {
      // No assets were added for a farm that sent no photos, so the gate is open.
      sites.publish(wonSite.siteId);
      summary.sitesLive = (summary.sitesLive || 0) + 1;
    }
    summary.leadsWon = (summary.leadsWon || 0) + 1;
  }

  /* ---------------- refresh microsites now that reviews exist ---------------- */
  for (const pro of pros) {
    if (pro.canBid) {
      const refreshed = webStudio.generateProMicrosite(pro.proId);
      if (refreshed.generated !== false) summary.microsites = Math.max(summary.microsites, pros.filter((p) => p.canBid).length);
    }
  }

  return {
    ...summary,
    verticals: marketplace.verticals().map((v) => ({ id: v.id, status: v.status })),
    ledgerEntries: kernel.ledger.entries.length,
    chainValid: kernel.ledger.verifyChain().valid,
    integrityReceipt: kernel.ledger.integrityReceipt().receipt,
    seededAt: nowIso(),
  };
}

module.exports = { seed, PRO_ROSTER, CUSTOMER_ROSTER, JOB_ROSTER };
