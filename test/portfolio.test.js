'use strict';

/**
 * Portfolio — "upload your past work, and let home owners find you by it".
 *
 * The marketplace's front door is a shelf of real jobs. These tests cover the
 * part that makes it a trust market instead of a photo wall: the tier is
 * computed from evidence and cannot be claimed (PRT-001), a photo that belongs
 * to another pro is refused (PRT-002), thin uploads are told to fill themselves
 * in (PRT-003), and closed escrow-released jobs harvest themselves into the
 * portfolio of the pro who did them — once.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Marketplace } = require('../src/marketplace');
const { seed } = require('../src/marketplace/seed');
const { PORTFOLIO_TIER, TIER_LABEL } = require('../src/marketplace/portfolio');

/** A seeded marketplace: 16 verified pros, released bookings, harvested work. */
async function seeded() {
  const mp = new Marketplace();
  await seed(mp);
  return mp;
}

function upload(mp, pro, overrides = {}) {
  return mp.portfolio.addItem({
    proId: pro.proId,
    title: 'Geyser replacement, tray and overflow redone',
    description: 'Old geyser weeping at the inlet. New 150L, new tray piped outside, CoC issued.',
    priceCents: 695000,
    categoryId: pro.primaryCategory,
    suburbId: pro.location?.suburbId || null,
    photos: [{ hash: `demo-${pro.proId}-geyser`, caption: 'New geyser on the tray' }],
    ...overrides,
  });
}

/* ================= the upload itself ================= */

test('an upload is published as the pro’s own word, with sealed photos and no badge', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const item = upload(mp, pro);

  assert.match(item.reference, /^WORK-\d{5}$/);
  assert.equal(item.tier, PORTFOLIO_TIER.SELF_DECLARED);
  assert.equal(item.tier === PORTFOLIO_TIER.SELF_DECLARED, true);
  assert.equal(item.bookingId, null, 'nothing corroborates it, so nothing is linked');
  assert.equal(item.photos.length, 1);
  assert.equal(item.photos[0].hash.length, 64, 'the photo is hashed on the way in');
  assert.equal(item.photos[0].seal.length, 16, 'and sealed against the pro who uploaded it');
  assert.ok(item.ledgerSeal, 'the item itself carries a ledger seal');
  assert.equal(item.status, 'LIVE');
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'PORTFOLIO_ITEM_ADDED' && e.subject === item.itemId));

  const statement = mp.portfolio.verificationStatement(item);
  assert.equal(statement.label, TIER_LABEL.SELF_DECLARED);
  assert.match(statement.lines.join(' '), /uploaded these photos/i, 'a self-declared item says what it is');
});

test('a verification badge cannot be claimed — PRT-001 blocks it and records the attempt', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const item = upload(mp, pro);

  assert.throws(() => mp.portfolio.updateItem(item.itemId, { claimsProofOfWork: true }, { actorId: pro.proId }), (error) => {
    assert.equal(error.code, 'BLOCKED');
    assert.match(error.message, /PRT-001/);
    assert.equal(error.decision.decision, 'BLOCK');
    return true;
  });

  // Still the tier evidence earned, and the attempt is on the risk record.
  assert.equal(mp.portfolio.get(item.itemId).tier, PORTFOLIO_TIER.SELF_DECLARED);
  const risk = mp.kernel.risk.assess(pro.proId);
  assert.ok(JSON.stringify(risk).includes('VERIFICATION_CLAIM_WITHOUT_EVIDENCE'), 'claiming a badge is a fraud signal');

  // Editing what you may edit still works.
  const edited = mp.portfolio.updateItem(item.itemId, { title: 'Geyser replacement in Roodepoort', priceCents: 720000 }, { actorId: pro.proId });
  assert.equal(edited.title, 'Geyser replacement in Roodepoort');
  assert.equal(edited.priceCents, 720000);
  assert.equal(edited.tier, PORTFOLIO_TIER.SELF_DECLARED, 'an edit does not smuggle in a tier');
});

test('another pro’s photo is refused — PRT-002', async () => {
  const mp = await seeded();
  const [one, two] = mp.store.all('pros');
  upload(mp, one);

  assert.throws(() => upload(mp, two, {
    title: 'My own geyser job (same photo)',
    photos: [{ hash: `demo-${one.proId}-geyser`, caption: 'borrowed' }],
  }), (error) => {
    assert.equal(error.code, 'BLOCKED');
    assert.match(error.message, /PRT-002/);
    assert.match(error.message, /already published by another pro/i);
    return true;
  });

  const risk = mp.kernel.risk.assess(two.proId);
  assert.ok(JSON.stringify(risk).includes('DUPLICATE_PHOTO_HASH'), 'a reused photo lands on the risk record');
});

test('a thin upload is warned, not blocked — and told what to add', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const item = mp.portfolio.addItem({
    proId: pro.proId,
    title: 'Some plumbing work',
    photos: [{ hash: 'thin-upload-1', caption: 'a pipe' }],
  });
  assert.equal(item.tier, PORTFOLIO_TIER.SELF_DECLARED, 'it still publishes');
  assert.equal(item.suburbId, null);
  assert.equal(item.priceCents, null);

  const decision = mp.kernel.policy.evaluate('portfolio', { subjectId: item.itemId, item, action: 'ADD' });
  assert.ok(decision.firedRules.some((r) => r.ruleId === 'PRT-003' && r.effect === 'WARN'), 'PRT-003 fires as a warning');
  assert.match(decision.firedRules.find((r) => r.ruleId === 'PRT-003').reason, /suburb and a price/i);
});

test('the portfolio rules are published in the rule book', async () => {
  const mp = await seeded();
  const rules = mp.kernel.policy.ruleBook().filter((r) => r.appliesTo.includes('portfolio'));
  assert.deepEqual(rules.map((r) => r.id).sort(), ['PRT-001', 'PRT-002', 'PRT-003']);
  for (const rule of rules) {
    assert.ok(rule.statement.length > 20, `${rule.id} explains itself in plain language`);
    assert.ok(['BLOCK', 'WARN'].includes(rule.effect));
  }
});

/* ================= earning the tier ================= */

test('linking an escrow-released job turns an upload into proof of work', async () => {
  const mp = await seeded();
  const booking = mp.store.all('bookings').find((b) => ['CLOSED', 'IN_WARRANTY', 'COMPLETED'].includes(b.status) && (b.evidence || []).length);
  assert.ok(booking, 'the seed has released jobs with sealed evidence');

  const item = mp.portfolio.addItem({
    proId: booking.proId,
    title: 'The same job, published by hand',
    bookingId: booking.bookingId,
  });

  assert.ok([PORTFOLIO_TIER.EVIDENCE_LINKED, PORTFOLIO_TIER.CLIENT_CONFIRMED].includes(item.tier));
  assert.equal(item.bookingId, booking.bookingId);
  assert.equal(item.clientReference, booking.reference);
  assert.equal(item.jobId, booking.jobId);
  assert.equal(item.priceCents, booking.price.totalCents, 'the price comes from the job, not from a claim');
  assert.ok(item.photos.length >= 1, 'the job’s own sealed evidence becomes the photos');
  assert.equal(item.photos[0].source, 'proof-of-work');
  assert.ok(item.photos[0].seal, 'each photo keeps its evidence seal');
  assert.equal(item.geoVerified, true, 'the seed’s evidence was captured at the job address');

  const statement = mp.portfolio.verificationStatement(item);
  assert.match(statement.lines.join(' '), /escrow-released job/i);
});

test('linking somebody else’s job is refused outright', async () => {
  const mp = await seeded();
  const booking = mp.store.all('bookings').find((b) => ['CLOSED', 'IN_WARRANTY'].includes(b.status));
  const impostor = mp.store.all('pros').find((p) => p.proId !== booking.proId);

  assert.throws(() => mp.portfolio.addItem({
    proId: impostor.proId,
    title: 'A job I did not do',
    bookingId: booking.bookingId,
    photos: [{ hash: 'impostor-1', caption: 'not mine' }],
  }), /belongs to another pro/);
});

test('a job that has not been released yet proves nothing', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const open = mp.store.all('bookings').find((b) => b.proId === pro.proId && !['CLOSED', 'IN_WARRANTY', 'COMPLETED'].includes(b.status));
  if (!open) return; // the seed may release every booking for this pro
  const item = upload(mp, pro, { bookingId: open.bookingId, photos: [{ hash: 'pending-1', caption: 'unfinished' }] });
  assert.equal(item.tier, PORTFOLIO_TIER.SELF_DECLARED, 'unreleased work stays self-declared');
  assert.equal(item.bookingId, null);
});

/* ================= the harvest ================= */

test('released jobs harvest themselves into the portfolio — exactly once', async () => {
  const mp = await seeded();
  const harvested = mp.store.find('portfolioItems', (i) => i.source === 'HARVESTED');
  assert.ok(harvested.length >= 5, `the seed released bookings should have harvested, got ${harvested.length}`);

  const booking = mp.store.get('bookings', harvested[0].bookingId);
  const again = mp.portfolio.harvestFromBooking(booking);
  assert.equal(again.itemId, harvested[0].itemId, 're-harvesting the same job returns the same item');
  assert.equal(mp.store.count('portfolioItems', (i) => i.bookingId === booking.bookingId), 1, 'no duplicates');

  assert.equal(harvested[0].title, booking.title, 'the harvested item is the job, in the job’s own words');
  assert.equal(harvested[0].suburb, booking.address.suburb);
  assert.equal(harvested[0].priceNote, 'final amount, escrow-released');
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'PORTFOLIO_HARVESTED'));
});

test('a booking with no photo evidence harvests nothing', async () => {
  const mp = await seeded();
  const booking = mp.store.all('bookings').find((b) => ['CLOSED', 'IN_WARRANTY'].includes(b.status));
  booking.evidence = (booking.evidence || []).filter((e) => e.type === 'MATERIALS_RECEIPT');
  const before = mp.store.count('portfolioItems');
  const result = mp.portfolio.harvestFromBooking({ ...booking, bookingId: 'bkg_never-harvested' });
  assert.equal(result, null);
  assert.equal(mp.store.count('portfolioItems'), before);
});

test('the client on the job can confirm it — and only that client', async () => {
  const mp = await seeded();
  const item = mp.store.find('portfolioItems', (i) => i.tier === PORTFOLIO_TIER.EVIDENCE_LINKED)[0];
  assert.ok(item, 'the seed has evidence-linked work to confirm');
  const booking = mp.store.get('bookings', item.bookingId);
  const stranger = mp.store.all('customers').find((c) => c.customerId !== booking.customerId);

  assert.throws(
    () => mp.portfolio.confirmByClient({ itemId: item.itemId, customerId: stranger.customerId, comment: 'I saw it online' }),
    (error) => {
      assert.equal(error.code, 'FORBIDDEN');
      assert.match(error.message, /only the customer on the linked job/);
      return true;
    },
  );

  const confirmed = mp.portfolio.confirmByClient({ itemId: item.itemId, customerId: booking.customerId, comment: 'Yes, that was my kitchen.' });
  assert.equal(confirmed.tier, PORTFOLIO_TIER.CLIENT_CONFIRMED);
  assert.equal(confirmed.clientComment, 'Yes, that was my kitchen.');
  assert.ok(confirmed.clientConfirmedAt);
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'PORTFOLIO_CLIENT_CONFIRMED'));
});

/* ================= the reach-out loop ================= */

test('a home owner messages a pro about a specific piece of work, and they reply', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const customer = mp.store.all('customers')[0];
  const item = upload(mp, pro);

  const first = mp.portfolio.enquire({ itemId: item.itemId, customerId: customer.customerId, body: 'Can you do this in Soweto next week?' });
  assert.equal(first.thread, `portfolio:${item.itemId}`);
  assert.equal(first.fromUserId, customer.customerId);
  assert.equal(first.toUserId, pro.proId);
  assert.equal(mp.portfolio.get(item.itemId).stats.enquiries, 1);

  const reply = mp.portfolio.enquire({ itemId: item.itemId, customerId: customer.customerId, actorId: pro.proId, body: 'Yes — Thursday morning, I will send a quote.' });
  assert.equal(reply.fromUserId, pro.proId);

  const thread = mp.portfolio.listEnquiries({ itemId: item.itemId, userId: customer.customerId });
  assert.equal(thread.length, 2, 'both sides of the conversation are on one thread');
  assert.deepEqual(thread.map((m) => m.fromUserId), [customer.customerId, pro.proId]);

  const notification = mp.store.all('notifications').find((n) => n.type === 'PORTFOLIO_ENQUIRY');
  assert.ok(notification, 'the pro is told somebody reached out');
  assert.equal(notification.userId, pro.proId);
  assert.match(notification.body, /Soweto next week/);

  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'PORTFOLIO_ENQUIRY' && e.subject === item.itemId));
});

test('a stranger cannot read somebody else’s enquiry thread', async () => {
  const mp = await seeded();
  const [one, two] = mp.store.all('pros');
  const customer = mp.store.all('customers')[0];
  const item = upload(mp, one);
  mp.portfolio.enquire({ itemId: item.itemId, customerId: customer.customerId, body: 'Are you free?' });

  assert.throws(
    () => mp.portfolio.listEnquiries({ itemId: item.itemId, userId: two.proId }),
    (error) => {
      assert.equal(error.code, 'FORBIDDEN');
      assert.match(error.message, /not yours/);
      return true;
    },
  );
  assert.equal(mp.portfolio.listEnquiries({ itemId: item.itemId, userId: one.proId }).length, 1, 'the owner can');
});

test('an enquiry needs a message and a signed-in person', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const item = upload(mp, pro);
  assert.throws(() => mp.portfolio.enquire({ itemId: item.itemId, customerId: null, body: 'hello' }), /signed in/);
  assert.throws(
    () => mp.portfolio.enquire({ itemId: item.itemId, customerId: mp.store.all('customers')[0].customerId, body: '   ' }),
    /write a line/,
  );
});

/* ================= the shelf ================= */

test('the feed puts proven work first and filters like a shop', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  upload(mp, pro);

  const byVerified = mp.portfolio.list({ sort: 'verified', limit: 50 });
  const firstSelfDeclared = byVerified.findIndex((i) => i.tier === PORTFOLIO_TIER.SELF_DECLARED);
  const lastProven = byVerified.map((i) => i.tier).lastIndexOf(PORTFOLIO_TIER.EVIDENCE_LINKED);
  assert.ok(firstSelfDeclared === -1 || firstSelfDeclared > byVerified.map((i) => i.tier).lastIndexOf(PORTFOLIO_TIER.CLIENT_CONFIRMED),
    'client-confirmed work outranks a plain upload');
  assert.ok(lastProven < firstSelfDeclared || firstSelfDeclared === -1, 'proven work outranks self-declared work');

  const provenOnly = mp.portfolio.list({ verifiedOnly: true, limit: 50 });
  assert.ok(provenOnly.length > 0);
  assert.ok(provenOnly.every((i) => i.verified), 'verifiedOnly hides every unproven upload');

  const forPro = mp.portfolio.forPro(pro.proId);
  assert.ok(forPro.every((i) => i.proId === pro.proId));

  const plumbing = mp.portfolio.list({ categoryId: 'plumbing', limit: 50 });
  assert.ok(plumbing.every((i) => i.categoryId === 'plumbing'));

  const bySuburb = mp.portfolio.list({ suburbId: forPro[0].suburbId, limit: 50 });
  assert.ok(bySuburb.every((i) => i.suburbId === forPro[0].suburbId), 'home owners can narrow to their own suburb');

  const searched = mp.portfolio.list({ q: 'geyser', limit: 50 });
  assert.ok(searched.length >= 1, 'the seeded geyser upload is findable');
  assert.ok(searched.every((i) => `${i.title} ${i.description || ''}`.toLowerCase().includes('geyser')));

  const summary = forPro[0];
  assert.ok(summary.proName && summary.proBadge !== undefined, 'each card carries the pro who did it');
  assert.ok(summary.photo === null || typeof summary.photo === 'object', 'the card picture is projected, not the whole record');
});

test('detail counts a view and returns what the product page needs', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const item = upload(mp, pro);

  const detail = mp.portfolio.detail(item.itemId);
  assert.equal(detail.stats.views, 1);
  assert.equal(detail.tierLabel, TIER_LABEL.SELF_DECLARED);
  assert.equal(detail.pro.proId, pro.proId);
  assert.equal(detail.pro.name, pro.displayName);
  assert.ok(detail.pro.suburb, 'the pro’s suburb is on the card');
  assert.ok(detail.verification.lines.length >= 2, 'the page explains what the badge means');
  assert.equal(detail.enquiries, 0);

  mp.portfolio.detail(item.itemId);
  assert.equal(mp.portfolio.get(item.itemId).stats.views, 2);
});

test('flags and removals take an item off the shelf but keep it on the record', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros')[0];
  const customer = mp.store.all('customers')[0];
  const item = upload(mp, pro);

  const flagged = mp.portfolio.flag({ itemId: item.itemId, reason: 'This is not their work', reporterId: customer.customerId });
  assert.equal(flagged.status, 'FLAGGED');
  assert.equal(flagged.flags.length, 1);
  assert.ok(!mp.portfolio.list({ proId: pro.proId }).some((i) => i.itemId === item.itemId), 'a flagged item leaves the feed');
  assert.ok(mp.kernel.risk.assess(pro.proId), 'and the pro carries the report');

  // Ownership is enforced both ways.
  const other = mp.store.all('pros').find((p) => p.proId !== pro.proId);
  assert.throws(() => mp.portfolio.removeItem(item.itemId, { actorId: other.proId }), (error) => {
    assert.equal(error.code, 'FORBIDDEN');
    return true;
  });

  const removed = mp.portfolio.removeItem(item.itemId, { actorId: pro.proId, reason: 'duplicate upload' });
  assert.equal(removed.status, 'REMOVED');
  assert.ok(removed.removedAt);
  assert.ok(mp.store.get('portfolioItems', item.itemId), 'the record is kept — only the shelf listing goes');
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'PORTFOLIO_ITEM_REMOVED'));
});

test('stats and tiers describe the whole shelf honestly', async () => {
  const mp = await seeded();
  const stats = mp.portfolio.stats();
  assert.equal(stats.items, mp.store.count('portfolioItems'));
  assert.equal(stats.harvested + stats.uploads, stats.items);
  assert.equal(stats.verified, stats.byTier.EVIDENCE_LINKED + (stats.byTier.CLIENT_CONFIRMED || 0));
  assert.ok(stats.prosWithWork >= 10, 'the seeded feed has work from at least ten pros');
  assert.ok(stats.photos >= stats.items, 'every item has at least one photo');

  const tiers = mp.portfolio.tiers();
  assert.deepEqual(tiers.map((t) => t.id), ['SELF_DECLARED', 'EVIDENCE_LINKED', 'CLIENT_CONFIRMED']);
  assert.equal(tiers[0].label, 'Uploaded by the pro', 'the lowest tier is named for what it is');
});

test('the public profile shows the real portfolio, with the tier each item earned', async () => {
  const mp = await seeded();
  const pro = mp.store.all('pros').find((p) => mp.portfolio.forPro(p.proId).length >= 2);
  const profile = mp.people.publicProfile(pro.proId);
  assert.ok(profile.portfolio.length >= 2);
  for (const item of profile.portfolio) {
    assert.ok(item.itemId && item.reference, 'each entry points at a real item');
    assert.ok(TIER_LABEL[item.tier] === item.tierLabel);
    assert.ok(item.seal, 'the microsite gallery still gets a seal to print');
  }
});
