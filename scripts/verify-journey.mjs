'use strict';

/**
 * ProVeri — the whole product, entry point to end point, over real HTTP.
 *
 * One script a human can read top to bottom: sign-up → post a job (with the
 * 3-photo minimum) → a verified pro quotes → the homeowner pays into escrow →
 * the arrival-code handshake at the door → geotagged proof of work → approval
 * → payout → settlement into the pro's bank → reviews that stick to BOTH
 * profiles → messaging → and the two ways out: cancelling an open job in one
 * tap, and the ECT Act s44 full refund before work starts.
 *
 * Usage:  npm start            (in one terminal)
 *         npm run journey      (in another — or: node scripts/verify-journey.mjs)
 *
 * Zero dependencies. Exits non-zero on the first broken promise.
 */

const BASE = process.env.BASE_URL || 'http://localhost:4173';

let stepCount = 0;
const log = (step, detail = '') => { stepCount += 1; console.log(`  ${String(stepCount).padStart(2, '0')} ✓ ${step}${detail ? ` — ${detail}` : ''}`); };
const section = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);

async function call(method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  if (!response.ok) {
    const message = (payload && (payload.error || payload.message)) || JSON.stringify(payload) || String(payload);
    throw new Error(`${method} ${path} → ${response.status}: ${String(message).slice(0, 200)}`);
  }
  return payload;
}
const get = (path) => call('GET', path);
const post = (path, body) => call('POST', path, body || {});

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const money = (cents) => `R${(Number(cents) / 100).toFixed(2)}`;

async function main() {
  console.log(`\x1b[1mProVeri journey check\x1b[0m · ${BASE} · ${new Date().toISOString()}`);

  /* ---------------- 0. the demo world exists ---------------- */
  section('The world');
  const roster = await get('/api/demo/roster');
  const pro = roster.pros.find((p) => p.canBid && /plumb/i.test(p.category));
  assert(pro, 'a verified plumber exists in the demo seed');
  const metros = await get('/api/metros');
  const suburbs = await get(`/api/metros/${metros.metros[0].id}/suburbs`);
  const suburb = suburbs.suburbs ? suburbs.suburbs[0] : suburbs[0];
  log('Demo world ready', `${roster.pros.length} pros · ${roster.customers.length} homeowners · ${suburb.name}`);

  /* ---------------- 1. entry point: passwordless sign-up ---------------- */
  section('Entry point — a new homeowner signs up with a phone number');
  const mobile = `083${String(Math.floor(1000000 + Math.random() * 8999999))}`;
  const challenge = await post('/api/auth/start', { identifier: mobile });
  assert(challenge.demoCode, 'the demo server shows the one-time PIN on screen');
  const verified = await post('/api/auth/verify', { challengeId: challenge.challengeId, code: challenge.demoCode });
  assert(verified.signupToken, 'an unknown number gets a sign-up token, not an error');
  const registered = await post('/api/auth/register', { signupToken: verified.signupToken, fullName: 'Journey Tester', suburbId: suburb.id, mobile });
  const customerId = (registered.session && registered.session.userId) || (registered.user && registered.user.userId) || registered.userId;
  assert(customerId, 'the account exists after registration');
  log('Signed up and signed in', `${mobile} → ${customerId}`);

  /* ---------------- 2. post a job with at least 3 photos ---------------- */
  section('Post a job — three photos, live trade detection, real price band');
  const resolve = await post('/api/catalogue/resolve', { text: 'Our geyser is leaking through the kitchen ceiling' });
  assert(resolve.resolution && resolve.resolution.matched, 'free text resolves to a trade');
  assert(resolve.resolution.categoryId === 'plumbing', `“leaking geyser” is plumbing (got ${resolve.resolution.categoryId})`);
  const band = await get(`/api/price-band?categoryId=plumbing&metroId=${suburb.metroId || metros.metros[0].id}`);
  const photo = (label) => ({ dataUrl: `data:image/jpeg;base64,/9j/${label}${Math.random().toString(36).slice(2)}`, caption: label });
  const job = await post('/api/jobs', {
    customerId,
    categoryId: 'plumbing',
    description: 'Two-year-old 200L geyser dripping from the pressure valve onto the kitchen ceiling. Ceiling stained. Please assess and replace the valve or the geyser.',
    suburbId: suburb.id,
    urgency: 'URGENT',
    budgetCents: band.p50Cents || 250000,
    photos: [photo('wide-shot'), photo('close-up'), photo('ceiling')],
  });
  assert(job.jobId && job.photos.length === 3, 'the job is live and carries all three photos');
  assert((job.matchedProIds || []).length > 0, 'verified pros nearby were matched');
  log('Job posted', `${job.reference} · ${job.photos.length} photos · sent to ${job.matchedProIds.length} pros · typical price ${band.format ? band.format.typical : money(band.p50Cents)}`);

  /* ---------------- 3. the pro sees the lead and quotes ---------------- */
  section('The pro side — lead, quote, and the wait');
  const leads = await get(`/api/jobs?proId=${pro.proId}`);
  const lead = leads.find((j) => j.jobId === job.jobId);
  assert(lead, 'the matched pro sees the job in their leads');
  assert(lead.myBid === null || lead.myBid === undefined, 'no quote sent yet');
  const bid = await post(`/api/jobs/${job.jobId}/bids`, {
    proId: pro.proId,
    totalCents: 235000,
    calloutFeeCents: 55000,
    materialsQuoteCents: 140000,
    scopeOfWork: 'Isolate and drain, replace the pressure control valve, pressure-test, make good the ceiling, issue a Plumbing CoC.',
    inclusions: ['Labour', 'Materials', 'CoC'],
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    includesCoc: true,
    warrantyDays: 14,
    message: 'I can be there tomorrow morning and the CoC comes with the job.',
  });
  assert(bid.bidId, 'the quote is in');
  const homeownerView = await get(`/api/jobs/${job.jobId}?viewerId=${customerId}`);
  assert(homeownerView.bids.length === 1 && !homeownerView.bids[0].masked, 'the homeowner sees the real quote');
  log('Quote sent and received', `${pro.name} · ${money(bid.totalCents)} all in · CoC included`);

  /* ---------------- 4. accept and pay — escrow opens ---------------- */
  section('Pay — the money goes to escrow, not to the pro');
  const booking = await post('/api/bookings', { jobId: job.jobId, bidId: bid.bidId, customerId });
  assert(booking.bookingId && booking.status === 'AWARDED', 'accepting a quote creates the booking');
  const funded = await post(`/api/bookings/${booking.bookingId}/fund`, { customerId, paymentMethod: 'instant-eft' });
  assert(funded.escrowStatus === 'FUNDED' || funded.status === 'SCHEDULED', 'the escrow is funded and the job is scheduled');
  const escrowed = await get(`/api/bookings/${booking.bookingId}?viewerId=${customerId}`);
  assert(escrowed.escrow && escrowed.escrow.status === 'FUNDED', `escrow holds ${money(escrowed.price.totalCents)}`);
  log('Escrow funded', `${money(escrowed.price.totalCents)} held · nobody is paid before approval`);

  /* ---------------- 5. the door handshake ---------------- */
  section('The day of the job — ETA, and the arrival code only the pro can read');
  const proView = await get(`/api/bookings/${booking.bookingId}?viewerId=${pro.proId}`);
  const gateCode = proView.arrival && proView.arrival.gateCode;
  assert(gateCode && /^\d{6}$/.test(gateCode), 'the pro can read their 6-digit arrival code');
  const customerView = await get(`/api/bookings/${booking.bookingId}?viewerId=${customerId}`);
  assert(customerView.arrival.gateCode === null && customerView.arrival.gateCodeHidden === true, 'the homeowner who must CHECK the code can never READ it');
  await post(`/api/bookings/${booking.bookingId}/eta`, { proId: pro.proId, etaMinutes: 20 });
  const wrong = await post(`/api/bookings/${booking.bookingId}/arrival-code`, { customerId, code: gateCode === '000000' ? '111111' : '000000' });
  assert(wrong.verified === false, 'a wrong code at the door is refused');
  const door = await post(`/api/bookings/${booking.bookingId}/arrival-code`, { customerId, code: gateCode });
  assert(door.verified === true && door.unlock && door.unlock.proFullName, 'the right code unlocks who is really at the door');
  await post(`/api/bookings/${booking.bookingId}/check-in`, { actorId: pro.proId, kind: 'STARTED' });
  const started = await get(`/api/bookings/${booking.bookingId}?viewerId=${pro.proId}`);
  assert(['ON_SITE', 'STARTED', 'IN_PROGRESS'].includes(started.status), `the job is under way (${started.status})`);
  log('Arrival handshake done', `wrong code refused · right code unlocked ${door.unlock.proFullName} · job started`);

  /* ---------------- 6. proof of work, approval, payout ---------------- */
  section('Proof of work → approval → payout');
  const geo = { lat: job.location.lat, lon: job.location.lon };
  const milestoneId = started.milestones[0].milestoneId;
  // Each item carries a unique content hash, exactly like the PWA's uploader:
  // the duplicate-photo fraud scan (correctly) quarantines a pro whose evidence
  // hash reappears on another booking, so nothing may be reused across runs.
  const runId = Math.random().toString(36).slice(2);
  await post(`/api/bookings/${booking.bookingId}/evidence`, {
    proId: pro.proId,
    milestoneId,
    items: [
      { type: 'BEFORE_PHOTO', geo, hash: `journey-${runId}-before`, imageUrl: '/img/work/burst-pipe-repair.jpg' },
      { type: 'AFTER_PHOTO', geo, hash: `journey-${runId}-after`, imageUrl: '/img/work/geyser-replacement.jpg' },
      { type: 'COC_DOCUMENT', hash: `journey-${runId}-coc`, note: 'Plumbing Certificate of Compliance PIRB-2019-44821' },
      { type: 'PRO_SIGNATURE', geo, hash: `journey-${runId}-signature` },
    ],
  });
  const awaiting = await get(`/api/bookings/${booking.bookingId}?viewerId=${customerId}`);
  assert(awaiting.status === 'AWAITING_CONFIRMATION', 'the homeowner is asked to approve');
  assert((awaiting.evidence || []).length >= 4, 'every required proof item is sealed on record');
  await post(`/api/bookings/${booking.bookingId}/confirm`, { customerId, milestoneId });
  const confirmed = await get(`/api/bookings/${booking.bookingId}?viewerId=${customerId}`);
  assert(confirmed.status === 'IN_WARRANTY', 'approval moves the job into warranty');
  assert(confirmed.payout && confirmed.payout.status === 'INSTRUCTED', `the payout of ${money(confirmed.payout.amountCents)} is instructed`);
  assert(confirmed.payout.holdbackCents > 0, `${money(confirmed.payout.holdbackCents)} stays held for the ${confirmed.warranty.days}-day warranty`);
  log('Approved and paid', `${money(confirmed.payout.amountCents)} to ${pro.name} by ${confirmed.payout.rail.label} · ${money(confirmed.payout.holdbackCents)} holdback`);

  /* ---------------- 7. the money finishes its journey ---------------- */
  section('The money lands — payout settlement');
  const walletBefore = await get(`/api/pros/${pro.proId}/wallet`);
  assert(walletBefore.receivedCents > 0, 'the wallet shows the earnings');
  const sweep = await post('/api/scheduler/run');
  const settled = (sweep.payoutsSettled || []).includes(confirmed.payout.payoutId);
  if (confirmed.payout.rail.instant) {
    assert(settled, 'an instant rail settles on the next sweep');
    const walletAfter = await get(`/api/pros/${pro.proId}/wallet`);
    assert(walletAfter.recentTransactions.some((t) => t.kind === 'SETTLEMENT'), 'settlement is on the wallet history');
    log('Payout settled', `${money(confirmed.payout.amountCents)} cleared into ${confirmed.payout.bankName || 'the pro’s bank account'} (${confirmed.payout.rail.label})`);
  } else {
    log('Payout instructed', `${confirmed.payout.rail.label} settles next business day — the sweep will clear it`);
  }
  const tax = await get(`/api/pros/${pro.proId}/tax-summary`);
  assert(tax.netReceivedCents > 0 && tax.seal, 'and the year’s earnings are SARS-ready from the sealed ledger');

  /* ---------------- 8. reviews that stay on both profiles ---------------- */
  section('Two-way reviews — trust that stays on the profile');
  await post(`/api/bookings/${booking.bookingId}/reviews`, { customerId, rating: 5, comment: 'Arrived on time, code matched at the door, ceiling left clean. Paid through escrow and it just worked.' });
  const proProfile = await get(`/api/pros/${pro.proId}`);
  const onProProfile = (proProfile.recentReviews || []).find((r) => /code matched at the door/.test(r.comment || ''));
  assert(onProProfile, 'the homeowner’s review is live on the pro’s public profile');
  assert(onProProfile.verified === true && onProProfile.customerId === customerId, 'marked verified, and it links to the reviewer’s member profile');
  log('Homeowner → pro', `5★ review lives on ${pro.name}’s profile (${proProfile.ratings.count} total, ${proProfile.ratings.average}★ average)`);

  await post(`/api/bookings/${booking.bookingId}/customer-reviews`, { proId: pro.proId, rating: 4.5, comment: 'Clear brief, photos matched the job, easy access and quick approval. Would work for them again.', tags: ['Clear brief', 'Easy access'] });
  const memberProfile = await get(`/api/customers/${customerId}/public-profile`);
  assert(memberProfile.reviews.length === 1 && /Would work for them again/.test(memberProfile.reviews[0].comment), 'the pro’s review is live on the homeowner’s public member profile');
  assert(memberProfile.ratings.count === 1 && memberProfile.ratings.average === 4.5, 'their average is computed from verified jobs only');
  assert(!JSON.stringify(memberProfile).includes(mobile), 'the public profile never leaks the mobile number');
  assert(memberProfile.displayName === 'Journey T.', `privacy: shown as “${memberProfile.displayName}”, not the full name`);
  const dupBlocked = await post(`/api/bookings/${booking.bookingId}/customer-reviews`, { proId: pro.proId, rating: 5 }).then(() => false).catch(() => true);
  assert(dupBlocked, 'one review per side per job — ratings cannot be stuffed');
  log('Pro → homeowner', `4.5★ review lives on ${memberProfile.displayName}’s member profile, public to every pro`);

  /* ---------------- 9. the conversation continues ---------------- */
  section('Messaging — the thread stays with the job');
  const inbox = await get(`/api/inbox/${customerId}`);
  const convo = (inbox.conversations || []).find((c) => c.conversationId === `booking.${booking.bookingId}`) || (inbox.conversations || [])[0];
  assert(convo, 'the booking opens a conversation in the inbox');
  await post(`/api/inbox/${customerId}/${encodeURIComponent(convo.conversationId)}`, { message: 'Thanks again — will definitely use you for the bathroom next.' });
  const proInbox = await get(`/api/inbox/${pro.proId}`);
  const proConvo = (proInbox.conversations || []).find((c) => c.conversationId === convo.conversationId);
  assert(proConvo && proConvo.unread >= 1, 'the pro sees it, unread, in their inbox');
  await post(`/api/inbox/${pro.proId}/${encodeURIComponent(convo.conversationId)}`, { message: 'My pleasure — the warranty covers the work for 14 days if anything weeps.' });
  const thread = await get(`/api/inbox/${customerId}/${encodeURIComponent(convo.conversationId)}`);
  assert((thread.messages || []).length >= 2, 'both sides of the thread are on record');
  log('Messages flow both ways', `${(thread.messages || []).length} messages · unread badges work`);

  /* ---------------- 10. easy out #1: cancel the job you posted ---------------- */
  section('Easy out — cancelling a job you posted is one tap');
  const job2 = await post('/api/jobs', {
    customerId, categoryId: 'plumbing',
    description: 'Second geyser at the rental flat — element keeps tripping the breaker.',
    suburbId: suburb.id, photos: [photo('a'), photo('b'), photo('c')],
  });
  await post(`/api/jobs/${job2.jobId}/bids`, { proId: pro.proId, totalCents: 180000, includesCoc: true, scheduledAt: new Date(Date.now() + 172800000).toISOString(), scopeOfWork: 'Test and replace element.' });
  const cancelled = await post(`/api/jobs/${job2.jobId}/cancel`, { customerId, reason: 'Tenant decided to move out' });
  assert(cancelled.status === 'CANCELLED', 'the job is cancelled');
  const closedBids = await get(`/api/bids?jobId=${job2.jobId}`);
  assert(closedBids.every((b) => b.status === 'EXPIRED'), 'every open quote was closed with it');
  const notes = await get(`/api/notifications/${pro.proId}`);
  assert(notes.some((n) => n.type === 'JOB_CANCELLED'), 'and the quoting pro was told, not left guessing');
  const stranger = await post(`/api/jobs/${job2.jobId}/cancel`, { customerId: roster.customers[0].customerId }).then(() => false).catch(() => true);
  assert(stranger, 'nobody else can cancel your job');
  log('Job cancelled', `${job2.reference} closed · quote expired · pro notified`);

  /* ---------------- 11. easy out #2: full refund before work starts ---------------- */
  section('Easy out — a booked job refunds in full before work starts (ECT Act s44)');
  const job3 = await post('/api/jobs', {
    customerId, categoryId: 'plumbing',
    description: 'Kitchen mixer tap dripping constantly — washer or cartridge replacement.',
    suburbId: suburb.id, photos: [photo('tap1'), photo('tap2'), photo('tap3')],
  });
  const bid3 = await post(`/api/jobs/${job3.jobId}/bids`, { proId: pro.proId, totalCents: 95000, includesCoc: true, scheduledAt: new Date(Date.now() + 259200000).toISOString(), scopeOfWork: 'Replace the cartridge, pressure-test, issue a Plumbing CoC.' });
  const booking3 = await post('/api/bookings', { jobId: job3.jobId, bidId: bid3.bidId, customerId });
  await post(`/api/bookings/${booking3.bookingId}/fund`, { customerId, paymentMethod: 'card' });
  const refund = await post(`/api/bookings/${booking3.bookingId}/cancel`, { actorId: customerId, role: 'CUSTOMER', reason: 'Fixed it myself with a new washer' });
  const refunded = refund.booking || refund;
  assert(['REFUNDED', 'CANCELLED'].includes(refunded.status), `the booking ends ${refunded.status}`);
  const escrowAfter = await get(`/api/bookings/${booking3.bookingId}?viewerId=${customerId}`);
  assert(escrowAfter.escrow.status === 'REFUNDED', 'the escrow itself shows the money went home');
  assert((escrowAfter.escrow.refunds || []).some((r) => r.amountCents === 95000), `${money(95000)} refunded in full — nothing kept`);
  log('Full refund', `${money(95000)} back to the homeowner · no penalty before work starts`);

  /* ---------------- 12. end point: the record is sealed ---------------- */
  section('End point — everything is on the sealed public record');
  const proofPage = await get(`/api/trust/proof/${booking.bookingId}`);
  assert(proofPage.proof && proofPage.proof.digest, 'the booking exports a verifiable proof digest');
  assert((proofPage.timeline || []).length >= 8, `the booking’s public timeline carries ${ (proofPage.timeline || []).length } sealed events`);
  const ledger = await get('/api/trust/ledger?limit=5');
  assert(ledger.chain && ledger.chain.valid === true, 'and the whole hash chain still verifies');
  log('Audit trail', `${proofPage.timeline.length} events · proof #${proofPage.proof.digest.slice(0, 12)}… · chain valid · receipt #${String(ledger.receipt && (ledger.receipt.digest || ledger.receipt.receipt) || '').slice(0, 12)}…`);

  console.log(`\n\x1b[1;32mJourney complete — ${stepCount} checks passed, entry point to end point.\x1b[0m\n`);
}

main().catch((error) => {
  console.error(`\n\x1b[1;31m✗ ${error.message}\x1b[0m\n`);
  process.exit(1);
});
