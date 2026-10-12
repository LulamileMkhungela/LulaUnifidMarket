'use strict';

/**
 * Lula ProVeri — services journey demo.
 *
 * Prints one complete customer journey on a fresh marketplace:
 * verify a pro → post a job → match → bid → award → fund escrow → arrival code
 * → geosealed proof of work → confirm → release with the warranty holdback →
 * verified review → SARS summary. Every step shows the ledger entry it produced.
 *
 *   npm run demo
 */

process.env.PROVERI_INTEGRATION_MODE = process.env.PROVERI_INTEGRATION_MODE || 'offline';

const { Marketplace } = require('./marketplace');
const { synthesiseSaId } = require('./integrations/saIdentity');
const { money } = require('./marketplace/format');

function heading(text) {
  process.stdout.write(`\n${'='.repeat(72)}\n${text}\n${'='.repeat(72)}\n`);
}
function line(label, value) {
  process.stdout.write(`${String(label).padEnd(34)} ${value}\n`);
}

(async () => {
  const mp = new Marketplace();
  heading('LULA PROVERI — one job, end to end');

  /* 1. the pro */
  const suburb = mp.catalog.suburb('soweto');
  const idNumber = synthesiseSaId({ seed: 'demo-pro', age: 39 });
  const pro = mp.people.registerPro({
    fullName: 'Sipho Dlamini',
    email: 'sipho.demo@example.co.za',
    mobile: '0711234567',
    idNumber,
    suburbId: suburb.id,
    primaryCategory: 'plumbing',
    hourlyRateCents: 65000,
    calloutFeeCents: 55000,
    about: 'PIRB-registered plumber. Geyser specialist. I do not leave without a CoC where one is due.',
    tradeCertification: { body: 'PIRB', certificateNumber: 'PIRB-2019-44821' },
    qualification: { saqaId: '61709' },
    insurance: { provider: 'Santam', policyNumber: 'PL-DEMO-1', coverCents: 100_000_000 },
    bankDetails: { bankCode: 'capitec', accountNumber: '1020304050', holderName: 'Sipho Dlamini' },
    criminalDeclaration: { declared: true, noConvictions: true },
  });
  pro.__idNumber = idNumber;
  pro.__mobileOtpRef = 'SMS_DEMO';
  pro.__emailOtpRef = 'EMAIL_DEMO';
  mp.store.put('pros', pro.proId, pro);

  heading('1 · PRO VERIFICATION (9 stages)');
  const verification = await mp.people.runVerificationPipeline(pro.proId, {});
  for (const check of verification.trail) {
    line(`  ${check.check.replace(/_/g, ' ')}`, `${check.status}  ${check.source || ''}`);
  }
  line('trust score', `${verification.pro.trustScore}/100`);
  line('badge', verification.pro.badge);
  line('cleared to bid', verification.pro.canBid ? 'yes' : 'no');

  /* 2. the customer and the job */
  const customer = mp.people.registerCustomer({
    fullName: 'Naledi Sithole', email: 'naledi.demo@example.co.za', mobile: '0821234567', suburbId: suburb.id,
  });
  mp.people.verifyCustomerChannel(customer.customerId, { channel: 'email', reference: 'E' });
  mp.people.verifyCustomerChannel(customer.customerId, { channel: 'mobile', reference: 'M' });

  heading('2 · JOB POSTED — matching runs immediately');
  const job = await mp.jobs.postJob({
    customerId: customer.customerId,
    categoryId: 'plumbing',
    title: 'Geyser leaking onto the kitchen ceiling',
    description: 'Two-year-old 200L geyser dripping from the pressure valve. Ceiling stained. Need it today if possible.',
    suburbId: suburb.id,
    budgetCents: 650000,
    urgency: 'URGENT',
    locationType: 'IN_HOME',
    householdNotes: { childrenOnPremises: true },
  });
  line('reference', job.reference);
  line('verified pros notified', job.matchReport.candidates.length);
  line('market band (typical)', money(job.priceBand.p50Cents));
  line('band guidance', job.priceBand.guidance.slice(0, 96) + '…');
  if (job.loadSheddingAdvice) line('load shedding', `stage ${job.loadSheddingAdvice.nationalStage} — ${job.loadSheddingAdvice.advice.slice(0, 72)}…`);
  line('safety plan steps', job.safetyPlan.steps.map((s) => s.title).join(' · '));

  /* 3. bid, award, fund */
  heading('3 · BID → AWARD → ESCROW');
  const bid = mp.jobs.submitBid({
    jobId: job.jobId,
    proId: pro.proId,
    totalCents: 585000,
    calloutFeeCents: 55000,
    materialsQuoteCents: 180000,
    scopeOfWork: 'Isolate and drain, replace the pressure control valve and expansion vessel, pressure-test, certify, clean up.',
    inclusions: ['Labour', 'Materials as specified', 'Plumbing CoC', 'Site clean-up'],
    exclusions: ['Ceiling repair', 'Concealed pipe damage'],
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    includesCoc: true,
    warrantyDays: 14,
  });
  line('bid', `${money(bid.totalCents)} — ${bid.priceAssessment.verdict}`);
  line('price intelligence', bid.priceAssessment.headline || 'in band');

  const booking = mp.bookings.acceptBid({ jobId: job.jobId, bidId: bid.bidId, customerId: customer.customerId });
  line('booking', booking.reference);
  line('arrival gate code', booking.arrival.gateCode);
  await mp.bookings.fundBooking({ bookingId: booking.bookingId, customerId: customer.customerId, paymentMethod: 'instant-eft' });
  const funded = mp.store.get('bookings', booking.bookingId);
  line('escrow', `${funded.escrowStatus} with ${funded.escrowProvider} — ${money(funded.price.totalCents)} held`);

  /* 4. on-site handshake and proof of work */
  heading('4 · ARRIVAL HANDSHAKE → PROOF OF WORK');
  mp.bookings.shareEta({ bookingId: booking.bookingId, proId: pro.proId, etaMinutes: 18 });
  const handshake = mp.bookings.verifyArrivalCode({ bookingId: booking.bookingId, customerId: customer.customerId, code: booking.arrival.gateCode });
  line('code verified', handshake.verified ? 'yes — identity unlocked on the customer’s screen' : 'NO');
  mp.bookings.checkIn({ bookingId: booking.bookingId, actorId: pro.proId, kind: 'STARTED', lat: suburb.lat, lon: suburb.lon });

  const milestone = mp.store.get('bookings', booking.bookingId).milestones[0];
  const evidence = mp.bookings.submitEvidence({
    bookingId: booking.bookingId,
    proId: pro.proId,
    milestoneId: milestone.milestoneId,
    items: [
      { type: 'BEFORE_PHOTO', note: 'Leaking valve and stained ceiling', geo: { lat: suburb.lat, lon: suburb.lon, accuracyM: 6 } },
      { type: 'AFTER_PHOTO', note: 'New valve fitted and pressure-tested', geo: { lat: suburb.lat + 0.0003, lon: suburb.lon, accuracyM: 5 } },
      { type: 'COC_DOCUMENT', note: 'Plumbing Certificate of Compliance' },
      { type: 'PRO_SIGNATURE', note: 'Signed on the customer’s device', geo: { lat: suburb.lat, lon: suburb.lon } },
    ],
    note: 'Valve and expansion vessel replaced, system pressure-tested at 400 kPa, CoC issued.',
    materialsReceipts: [{ amountCents: 172500, supplier: 'Builders Warehouse Soweto', hash: 'receipt-demo' }],
  });
  for (const item of evidence.sealed) {
    line(`  ${item.label}`, `seal ${item.seal} · ${item.geoVerified === true ? `geosealed at ${item.distanceFromJobKm} km` : item.geoVerified === false ? `⚠ ${item.distanceFromJobKm} km AWAY` : 'no geotag required'}`);
  }
  line('materials reconciled', `${money(172500)} of ${money(180000)} quoted`);

  /* 5. confirm, release, warranty */
  heading('5 · CONFIRM → RELEASE → WARRANTY HOLDBACK');
  mp.bookings.confirmCompletion({ bookingId: booking.bookingId, customerId: customer.customerId, milestoneId: milestone.milestoneId, comment: 'Exactly as quoted.' });
  const released = mp.store.get('bookings', booking.bookingId);
  const escrow = mp.kernel.escrow.get(released.escrowId);
  const split = escrow.releases.at(-1).split;
  line('released to pro now', money(split.immediateToProCents));
  line('platform fee (10%)', money(split.platformFeeCents));
  line('workmanship holdback (5%)', `${money(split.warrantyHoldbackCents)} until ${new Date(released.warranty.endsAt).toLocaleDateString('en-ZA')}`);

  /* 6. verified review + tax summary */
  heading('6 · VERIFIED REVIEW → PRO WALLET');
  const review = mp.bookings.writeReview({
    bookingId: booking.bookingId, customerId: customer.customerId, rating: 5,
    comment: 'Arrived on time, code at the door, photos before and after, CoC the same evening. Paid through escrow so I was never worried.',
    tags: ['on_time', 'fair_price', 'escrow_protected'],
  });
  line('review', `${review.rating}★ verified — ${review.verificationBasis}`);
  const tax = mp.bookings.taxSummary(pro.proId);
  line('SARS-ready gross', money(tax.grossJobValueCents));
  line('VAT status', tax.sarsNotes.vatStatus.replace(/_/g, ' '));

  /* 7. the ledger */
  heading('7 · THE AUDIT TRAIL FOR THIS BOOKING');
  for (const entry of mp.kernel.ledger.publicTimeline(booking.bookingId).slice(-10)) {
    line(`  ${entry.createdAt.slice(11, 16)} ${entry.level.padEnd(8)}`, `${entry.summary.slice(0, 74)}  [${entry.seal}]`);
  }
  const receipt = mp.kernel.ledger.integrityReceipt();
  line('ledger entries', receipt.entries);
  line('chain valid', receipt.chainValid);
  line('platform receipt', receipt.receipt);

  heading('DONE');
  process.stdout.write('Run `npm start` for the same journey as an installable PWA, or `npm test` for the 200 tests that enforce every rule above.\n\n');
})().catch((error) => {
  process.stderr.write(`demo failed: ${error.stack}\n`);
  process.exit(1);
});
