'use strict';

/**
 * Business Site Studio: the MyServicePro demo-site pipeline rebuilt so the
 * buttons work. Covers scaffolding from an industry template, asset intake with
 * auto-classification, the permission/POPIA publish gate (WEB-002), update-credit
 * metering (WEB-001), AI-image labelling (WEB-003), live booking intake that
 * becomes a real escrow-ready job, subscriptions held in escrow, server-rendered
 * HTML and the self-contained export.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Marketplace } = require('../src/marketplace');
const { SITE_STATUS, BOOKING_STATUS, slugify, contrastRatio } = require('../src/marketplace/businessSites');
const { synthesiseSaId } = require('../src/integrations/saIdentity');

function market() {
  return new Marketplace();
}

async function makePro(mp, { category = 'plumbing', suburb = 'soweto', name = 'Studio Test Pro' } = {}) {
  const suburbRow = mp.catalog.suburb(suburb);
  // The pipeline needs the raw ID number to validate against the DHA format and
  // to match it to the bank account holder — registration seals it away.
  const idNumber = synthesiseSaId({ seed: name, age: 38 });
  const pro = mp.people.registerPro({
    fullName: name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.co.za`,
    mobile: '0761234500',
    idNumber,
    suburbId: suburbRow.id,
    primaryCategory: category,
    hourlyRateCents: 60000,
    calloutFeeCents: 50000,
    tradeCertification: { certificateNumber: 'PIRB-TEST-1', body: 'PIRB' },
    qualification: { saqaId: '61709' },
    insurance: { provider: 'Santam', policyNumber: 'PL-TEST', coverCents: 100_000_000, expiresAt: new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10) },
    bankDetails: { bankCode: 'capitec', accountNumber: '1020304050', holderName: name },
    criminalDeclaration: { declared: true, noConvictions: true },
  });
  pro.__idNumber = idNumber;
  pro.__mobileOtpRef = 'SMS_TEST';
  pro.__emailOtpRef = 'EMAIL_TEST';
  mp.store.put('pros', pro.proId, pro);
  await mp.people.runVerificationPipeline(pro.proId, {});
  return mp.store.get('pros', pro.proId);
}

function restaurant(mp, overrides = {}) {
  return mp.businessSites.scaffold({
    templateId: 'restaurant',
    businessName: 'Test Kitchen',
    suburbId: 'sea-point',
    contact: { phone: '0214349911', email: 'book@testkitchen.co.za' },
    planId: 'business-growth',
    ...overrides,
  });
}

/* ================= scaffolding ================= */

test('scaffolding from a template produces a complete site with no payment', async () => {
  const mp = market();
  const site = restaurant(mp);

  assert.equal(site.status, SITE_STATUS.DRAFT);
  assert.equal(site.slug, 'test-kitchen');
  assert.ok(site.catalogue.length >= 3, 'sample menu content is pre-loaded so the preview is worth showing');
  assert.ok(site.catalogue.reduce((n, c) => n + c.items.length, 0) >= 4);
  assert.ok(site.booking.fields.some((f) => f.name === 'guests'), 'the booking schema comes from the template');
  assert.equal(site.booking.intake, 'RESERVATION');
  assert.equal(site.plan.setupCents, 0, 'R0 to build');
  assert.match(site.seo.title, /Test Kitchen/);
  assert.ok(site.theme.primary.startsWith('#'));
  assert.equal(mp.store.count('webStudioOrders'), 0, 'scaffolding does not create a paid order');
});

test('slug collisions are resolved and slugs are URL safe', async () => {
  const mp = market();
  restaurant(mp);
  const second = restaurant(mp);
  assert.equal(second.slug, 'test-kitchen-2');
  assert.equal(slugify('Café & Grill / On Main'), 'cafe-and-grill-on-main');
});

test('every template scaffolds, renders and exports', async () => {
  const mp = market();
  const templates = mp.businessSites.templates();
  assert.ok(templates.length >= 10, 'ten industries covered');

  for (const template of templates) {
    const site = mp.businessSites.scaffold({
      templateId: template.id,
      businessName: `${template.label} Test Co`,
      suburbId: 'sandton',
      contact: { phone: '0114445555' },
    });
    assert.equal(site.templateId, template.id, template.id);
    assert.ok(site.booking.fields.length >= 3, `${template.id} must ask enough to act on`);

    const html = mp.businessSites.renderSiteHtml(site.siteId);
    assert.ok(html.includes('<form'), `${template.id} must render a booking form`);
    assert.ok(html.includes('application/ld+json'), `${template.id} must ship LocalBusiness structured data`);
    assert.ok(html.includes('--primary:'), `${template.id} must theme via CSS custom properties`);

    const exported = mp.businessSites.exportSite(site.siteId);
    assert.ok(exported.bytes > 5000, `${template.id} export must be a real page`);
    assert.equal(exported.sha256.length, 64);
  }
});

test('a trade template linked to a verified pro injects the trust block', async () => {
  const mp = market();
  const pro = await makePro(mp);
  const site = mp.businessSites.scaffold({ templateId: 'trade-services', businessName: 'Verified Trade Co', proId: pro.proId, suburbId: 'soweto' });

  assert.ok(site.sections.includes('TRUST_BLOCK'));
  const html = mp.businessSites.renderSiteHtml(site.siteId);
  assert.ok(html.includes('trust-score'), 'the live trust score is projected into the page');
  assert.ok(html.includes('escrow'), 'the escrow promise is on the page');
  assert.ok(html.includes('/trust'), 'links to the public ledger');
});

/* ================= assets, classification and permissions ================= */

test('an incoming asset is classified against the industry vocabulary and filed onto its item', async () => {
  const mp = market();
  const site = restaurant(mp);

  const asset = mp.businessSites.addAsset(site.siteId, {
    filename: 'IMG_4412.jpg',
    caption: 'Dry-aged beef fillet with herb butter, plated for the mains menu',
    bytes: 880_000,
    source: 'owner-supplied',
  });

  assert.equal(asset.classification.category, 'mains');
  assert.ok(asset.classification.confidence >= 55);
  assert.equal(asset.classification.placement, 'CATALOGUE');
  assert.ok(asset.attachedTo, 'it should be filed onto the matching menu item');
  assert.match(asset.attachedTo.item, /sirloin/i, 'matched on "herb butter" and "dry-aged"');

  const updated = mp.businessSites.get(site.siteId);
  const item = updated.catalogue.flatMap((c) => c.items).find((i) => i.image === asset.assetId);
  assert.ok(item, 'the image is attached to the catalogue item, not left in a folder');
});

test('an uncategorised asset is flagged for a human instead of being guessed', async () => {
  const mp = market();
  const site = restaurant(mp);
  const asset = mp.businessSites.addAsset(site.siteId, { filename: 'zzz.jpg', caption: 'qr code on the till', bytes: 40_000 });
  assert.equal(asset.classification.category, 'uncategorised');
  assert.equal(asset.classification.needsReview, true);
  assert.ok(asset.classification.note.includes('by hand'));
});

test('publishing is blocked while any asset lacks a permission record (WEB-002)', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.addAsset(site.siteId, { filename: 'dining-room.jpg', caption: 'Dining room interior at sunset', bytes: 700_000 });
  mp.businessSites.preview(site.siteId);

  assert.equal(mp.businessSites.get(site.siteId).permissions.gateOpen, false);
  assert.throws(() => mp.businessSites.publish(site.siteId), /WEB-002/);
  assert.equal(mp.businessSites.get(site.siteId).status, SITE_STATUS.BLOCKED);
});

test('a permission record seals the assets and opens the publish gate', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.addAsset(site.siteId, { filename: 'dining-room.jpg', caption: 'Dining room interior at sunset', bytes: 700_000 });

  const record = mp.businessSites.recordPermission(site.siteId, {
    grantedBy: 'Owner', role: 'owner', method: 'whatsapp', evidenceHash: 'screenshot-1',
  });

  assert.equal(record.seal.length, 64);
  assert.ok(record.checklist.some((c) => c.id === 'OWNER_PERMISSION' && c.satisfied));
  assert.equal(mp.businessSites.get(site.siteId).permissions.gateOpen, true);

  const published = mp.businessSites.publish(site.siteId);
  assert.equal(published.status, SITE_STATUS.LIVE);
  assert.equal(published.url, `/s/${site.slug}`);
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'SITE_ASSET_PERMISSION_RECORDED'));
});

test('identifiable people need POPIA consent, not just copyright clearance', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.addAsset(site.siteId, { filename: 'chef-plating.jpg', caption: 'Chef plating in the open kitchen', bytes: 600_000 });

  const withoutConsent = mp.businessSites.recordPermission(site.siteId, {
    grantedBy: 'Owner', identifiablePeople: true, popiaConsent: false,
  });
  assert.equal(withoutConsent.popiaSatisfied, false);
  assert.equal(mp.businessSites.get(site.siteId).permissions.gateOpen, false, 'the gate stays closed');
  assert.throws(() => mp.businessSites.publish(site.siteId), /POPIA/);

  mp.businessSites.recordPermission(site.siteId, {
    assetIds: mp.businessSites.assets(site.siteId).map((a) => a.assetId),
    grantedBy: 'The chef', role: 'employee', identifiablePeople: true, popiaConsent: true,
  });
  assert.equal(mp.businessSites.get(site.siteId).permissions.gateOpen, true);
});

test('an AI-generated image must be labelled where it is shown (WEB-003)', async () => {
  const mp = market();
  const site = restaurant(mp);
  const asset = mp.businessSites.addAsset(site.siteId, {
    filename: 'ai-signature-dish.jpg', caption: 'Signature steak dish', bytes: 300_000, aiGenerated: true, source: 'ai-generated',
  });
  assert.equal(asset.aiGenerated, true);

  mp.businessSites.recordPermission(site.siteId, { grantedBy: 'Owner' });
  const html = mp.businessSites.renderSiteHtml(site.siteId);
  assert.ok(html.includes('illustrative'), 'the public page labels the generated image');

  // Move it to the full-bleed hero and take it out of the gallery, where there
  // is nowhere to put a note.
  mp.businessSites.updateContent(site.siteId, { gallery: [], hero: { ...site.hero, image: asset.assetId } }, { consumeCredit: false });
  const state = mp.businessSites.permissionState(site.siteId);
  assert.equal(state.aiUnlabelled, 1, 'an AI hero with no note is flagged before publish');
});

test('the AI prompt generator ships the labelling rule with the prompt', async () => {
  const mp = market();
  const site = restaurant(mp);
  const prompt = mp.businessSites.aiImagePrompt(site.siteId, { itemText: 'Malva pudding with Amarula cream' });
  assert.match(prompt.prompt, /Malva pudding/);
  assert.equal(prompt.labelling.required, true);
  assert.ok(prompt.labelling.rule.includes('illustrative'));
  assert.ok(prompt.honesty.includes('never'));
  assert.ok(prompt.budgetStack.length >= 3);
});

/* ================= bookings: the part that actually works ================= */

test('a booking is validated against the template schema', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.subscribe(site.siteId, {});
  mp.businessSites.publish(site.siteId);

  await assert.rejects(
    () => mp.businessSites.submitBooking(site.slug, { name: 'Guest' }, { source: 'website' }),
    /Mobile is required/,
  );
  await assert.rejects(
    () => mp.businessSites.submitBooking(site.slug, { name: 'Guest', phone: 'abc', date: 'tomorrow', time: '19h30', guests: '2' }, { source: 'website' }),
    /phone number|date|time/,
  );
});

test('a reservation gets a reference, a quote and an owner notification', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.subscribe(site.siteId, {});
  mp.businessSites.publish(site.siteId);

  const booking = await mp.businessSites.submitBooking(site.slug, {
    name: 'Naledi Sithole', phone: '0821234501', date: '2026-12-24', time: '19:30', guests: '4',
    notes: 'Anniversary',
  }, { source: 'website' });

  assert.equal(booking.status, BOOKING_STATUS.NEW);
  assert.match(booking.reference, /^BKG-\d{6}$/);
  assert.equal(booking.intake, 'RESERVATION');
  assert.ok(booking.contact.whatsappLink.startsWith('https://wa.me/27'));
  assert.match(booking.customerMessage, /confirm/i);
  assert.equal(booking.ownerNotified, true);
  assert.ok(mp.store.count('notifications', (n) => n.type === 'SITE_BOOKING') >= 1);

  const confirmed = mp.businessSites.decideBooking(booking.bookingId, { decision: 'CONFIRMED', note: 'Table for four at 19:30' });
  assert.equal(confirmed.status, BOOKING_STATUS.CONFIRMED);
  assert.equal(confirmed.decisionNote, 'Table for four at 19:30');
});

test('a per-head price is multiplied by the party size', async () => {
  const mp = market();
  const site = mp.businessSites.scaffold({ templateId: 'tours-travel', businessName: 'Baobab Day Tours', suburbId: 'cpt-cbd', contact: { phone: '0215550000' } });
  mp.businessSites.subscribe(site.siteId, {});
  mp.businessSites.publish(site.siteId);

  const booking = await mp.businessSites.submitBooking(site.siteId, {
    name: 'Ruan Pretorius', phone: '0831234502', email: 'ruan@example.co.za',
    tour: 'Winelands tasting day', date: '2026-11-14', travellers: '4',
  }, { source: 'website' });

  assert.equal(booking.amountQuotedCents, 129000 * 4, 'R1 290 pp x 4 travellers');
});

test('a booking on a site linked to a verified pro becomes a real escrow-ready job', async () => {
  const mp = market();
  const pro = await makePro(mp);
  const site = mp.businessSites.scaffold({
    templateId: 'trade-services', businessName: 'Studio Trade Co', proId: pro.proId, suburbId: 'soweto',
    contact: { phone: pro.mobile }, planId: 'business-growth',
  });
  mp.businessSites.subscribe(site.siteId, { planId: 'business-growth' });
  mp.businessSites.publish(site.siteId);

  const booking = await mp.businessSites.submitBooking(site.siteId, {
    name: 'Kagiso Molefe', phone: '0791234504', email: 'kagiso.m@example.co.za',
    service: 'Geyser leaking from the pressure valve', suburb: 'Soweto',
    urgency: 'URGENT — today', budget: 6500, notes: 'Ceiling is already stained',
  }, { source: 'website' });

  assert.equal(booking.status, BOOKING_STATUS.CONVERTED_TO_JOB);
  assert.ok(booking.job, 'the response carries the job');
  assert.equal(booking.intake, 'JOB');

  const job = mp.store.get('jobs', booking.job.jobId);
  assert.equal(job.source, 'BUSINESS_SITE');
  assert.equal(job.status, 'OPEN');
  assert.equal(job.budget.statedCents, 650000);
  assert.equal(job.urgency, 'URGENT');
  assert.match(job.description, /Booked through Studio Trade Co's website/);
  assert.ok(job.description.includes(booking.reference), 'the job carries the booking reference');

  // The visitor became a real customer who can fund escrow.
  const customer = mp.store.get('customers', job.customerId);
  assert.equal(customer.email, 'kagiso.m@example.co.za');

  // And the pro was notified through the same inbox as a job match.
  assert.ok(mp.store.count('notifications', (n) => n.userId === pro.proId && n.type === 'SITE_BOOKING') === 1);

  // The job is bid-able like any other: the loop continues into escrow.
  const bid = mp.jobs.submitBid({
    jobId: job.jobId, proId: pro.proId, totalCents: 620000, calloutFeeCents: 50000,
    scopeOfWork: 'Replace the pressure control valve, test the thermostat, issue a Plumbing CoC.',
    scheduledAt: '2026-10-14', durationHours: 3, includesCoc: true,
  });
  assert.ok(bid.bidId, 'a website booking can be bid on and escrowed like any job');
});

test('a booking on an unpublished preview becomes a warm sales lead instead of vanishing', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.preview(site.siteId);

  const booking = await mp.businessSites.submitBooking(site.siteId, {
    name: 'Aisha Moosa', phone: '0761234503', date: '2026-11-01', time: '13:00', guests: '2',
  }, { source: 'studio-preview' });

  assert.ok(booking.leadId, 'the enquiry is captured');
  const lead = mp.store.get('salesLeads', booking.leadId);
  assert.equal(lead.source, 'WEBSITE_BOOKING');
  assert.equal(lead.priority, 5);
  assert.equal(lead.siteId, site.siteId);
});

test('bookings only open once the site is published', async () => {
  const mp = market();
  const site = restaurant(mp);
  await assert.rejects(
    () => mp.businessSites.submitBooking(site.siteId, { name: 'X', phone: '0821234501', date: '2026-11-01', time: '13:00', guests: '2' }, { source: 'website' }),
    /not published/,
  );
});

/* ================= plans, escrow and update credits ================= */

test('the first month is held in escrow and released when the site goes live', async () => {
  const mp = market();
  const site = restaurant(mp);
  const { subscription } = mp.businessSites.subscribe(site.siteId, { planId: 'business-growth', paymentProvider: 'paystack' });

  const held = mp.kernel.escrow.get(subscription.escrowId);
  assert.equal(held.amountCents, 179900);
  assert.ok(['FUNDED', 'READY_FOR_RELEASE', 'PARTIALLY_RELEASED'].includes(held.status), `escrow is holding the fee, got ${held.status}`);

  mp.businessSites.publish(site.siteId);
  const after = mp.kernel.escrow.get(subscription.escrowId);
  assert.ok(['READY_FOR_RELEASE', 'RELEASED', 'PARTIALLY_RELEASED'].includes(after.status), 'the fee is released only once the site is live');
  assert.equal(after.plan.milestones[0].status, 'RELEASED');
  assert.ok(after.fees.warrantyHoldbackCents > 0, 'the 5% workmanship holdback applies to the studio fee too');
  const split = after.releases[0].split;
  assert.ok(split.proPayoutCents > 0, 'the studio operator is paid');
  assert.ok(split.platformFeeCents > 0, 'and the 10% platform fee is taken');
  assert.equal(mp.businessSites.get(site.siteId).plan.status, 'ACTIVE');
});

test('update credits are metered and an extra update is billed, not silent (WEB-001)', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.subscribe(site.siteId, { planId: 'essential' });
  mp.businessSites.publish(site.siteId);

  mp.businessSites.updateContent(site.siteId, { tagline: 'Tweak one' });
  mp.businessSites.updateContent(site.siteId, { tagline: 'Tweak two' });
  assert.equal(mp.businessSites.get(site.siteId).plan.updateCreditsUsed, 2);

  assert.throws(() => mp.businessSites.updateContent(site.siteId, { tagline: 'One too many' }), /allowance/i);

  const extra = mp.businessSites.updateContent(site.siteId, { tagline: 'Billed extra' }, { approveExtra: true });
  assert.equal(extra.update.chargedCents, 15000, 'the published per-update rate');
  assert.equal(mp.businessSites.get(site.siteId).plan.updateCreditsUsed, 2, 'a billed update does not consume a credit');

  const renewed = mp.businessSites.renewSubscription(site.siteId);
  assert.equal(renewed.site.plan.updateCreditsUsed, 0, 'renewal resets the allowance');
  assert.equal(renewed.subscription.monthsBilled, 2);
});

test('an enterprise subscription has unlimited updates', async () => {
  const mp = market();
  const site = restaurant(mp, { planId: 'enterprise' });
  mp.businessSites.subscribe(site.siteId, { planId: 'enterprise' });
  mp.businessSites.publish(site.siteId);
  for (let i = 0; i < 8; i += 1) mp.businessSites.updateContent(site.siteId, { tagline: `Enterprise edit ${i}` });
  assert.equal(mp.businessSites.get(site.siteId).plan.updateCreditsUsed, 0);
});

test('cancelling leaves the client with an export they own', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.subscribe(site.siteId, {});
  mp.businessSites.publish(site.siteId);

  const cancelled = mp.businessSites.cancelSubscription(site.siteId, { reason: 'Closing the business' });
  assert.equal(cancelled.subscription.status, 'CANCELLED');
  assert.equal(cancelled.exportAvailableAt, `/api/sites/${site.siteId}/export`);
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'SITE_SUBSCRIPTION_CANCELLED' && /client's, not ours/.test(e.payload.summary)));
});

/* ================= rendering and export ================= */

test('the rendered page works without JavaScript and degrades to WhatsApp', async () => {
  const mp = market();
  const site = restaurant(mp);
  const html = mp.businessSites.renderSiteHtml(site.siteId);

  // A real form post, not a JS-only handler.
  assert.ok(html.includes('<form class="bform" method="post"'));
  assert.ok(html.includes('<noscript>'), 'there is a no-JavaScript path');
  assert.ok(html.includes('wa.me/27'), 'the fallback is WhatsApp');
  // CSS-only tabs: radio inputs drive the menu categories.
  assert.ok(html.includes('type="radio" name="cat"'), 'menu tabs work with CSS only');
  assert.ok(html.includes('class="lightbox"') === false || html.includes(':target'), 'gallery lightbox is CSS-driven');
  assert.ok(html.includes('lang="en-ZA"'));
  assert.ok(html.includes('"LocalBusiness"'), 'LocalBusiness structured data');
});

test('a preview page says it is a preview', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.preview(site.siteId);
  const html = mp.businessSites.renderSiteHtml(site.siteId);
  assert.ok(html.includes('demo-bar'));
  assert.ok(html.includes('Unlisted preview'));
});

test('the export bundle carries an index, sitemap and a Pages workflow', async () => {
  const mp = market();
  restaurant(mp);
  mp.businessSites.scaffold({ templateId: 'transport-transfers', businessName: 'Test Shuttles', suburbId: 'kempton-park' });

  const bundle = mp.businessSites.exportBundle();
  assert.equal(bundle.siteCount, 2);
  assert.ok(bundle.indexHtml.includes('Test Kitchen'));
  assert.ok(bundle.indexHtml.includes('Test Shuttles'));
  assert.ok(bundle.workflow.includes('actions/deploy-pages@v4'));
  assert.ok(bundle.sitemap.includes('<urlset'));
  assert.ok(bundle.readme.includes('permission'), 'the bundle ships the permission checklist');
  assert.ok(bundle.files.every((f) => f.path.endsWith('/index.html')));
});

test('a transport site can show the fleet from the vehicles vertical', async () => {
  const mp = market();
  const site = mp.businessSites.scaffold({ templateId: 'transport-transfers', businessName: 'Test Shuttles', suburbId: 'kempton-park' });
  assert.ok(site.sections.includes('FLEET'));

  // With no vehicles on the platform the section is simply omitted.
  assert.ok(!mp.businessSites.renderSiteHtml(site.siteId).includes('<section class="fleet"'));

  const seller = mp.people.registerCustomer({ fullName: 'Fleet Owner', email: 'fleet@example.co.za', mobile: '0824445555', suburbId: mp.catalog.suburb('menlyn').id });
  const created = mp.vehicles.createListing({
    sellerId: seller.customerId, vin: 'AHTZZZX0000000001', engineNumber: '2ZR1234567', registrationNumber: 'CA123456',
    make: 'Toyota', model: 'Quantum', year: 2022, odometerKm: 61000, priceCents: 48000000,
    description: '13-seater shuttle, operating licence current.', suburbId: mp.catalog.suburb('menlyn').id,
  });
  mp.vehicles.submitChecks(created.listingId, [
    { name: 'seller_identity_fica', status: 'PASS', source: 'KYC', reference: 'F1', evidence: { sellerIdRef: 'r' } },
    { name: 'vin_engine_registration_match', status: 'PASS', source: 'vehicle data', reference: 'V1', evidence: { vehicleReportRef: 'r' } },
    { name: 'ownership_natis', status: 'PASS', source: 'NaTIS', reference: 'N1', evidence: { natisRef: 'r' } },
    { name: 'police_stolen_status', status: 'PASS', source: 'SAPS', reference: 'S1', evidence: { stolenCheckRef: 'r' } },
    { name: 'finance_settlement', status: 'PASS', source: 'bank', reference: 'FN1', evidence: { settlementLetterHash: 'none' } },
    { name: 'independent_condition_report', status: 'PASS', source: 'DEKRA', reference: 'IR1', evidence: { inspectionReportHash: 'r' } },
  ]);

  const html = mp.businessSites.renderSiteHtml(site.siteId);
  assert.ok(html.includes('<section class="fleet"'), 'the verified vehicle now appears on the operator\'s site');
  assert.ok(html.includes('Quantum'));
});

/* ================= theme & accessibility ================= */

test('theme presets apply and a low-contrast custom palette is flagged', async () => {
  const mp = market();
  const site = restaurant(mp);
  const themed = mp.businessSites.updateTheme(site.siteId, { presetId: 'ocean-linen' });
  assert.equal(themed.theme.id, 'ocean-linen');
  assert.equal(themed.theme.contrastOk, true);

  assert.throws(() => mp.businessSites.updateTheme(site.siteId, { primary: 'blue' }), /hex colour/);

  const bad = mp.businessSites.updateTheme(site.siteId, { light: '#111111', dark: '#1a1a1a' });
  assert.ok(bad.theme.contrastRatio < 4.5);
  assert.equal(bad.theme.contrastOk, false, 'WCAG AA failure is recorded, not hidden');
  assert.ok(contrastRatio('#ffffff', '#000000') > 20);
});

/* ================= stats & ledger ================= */

test('studio stats and the audit ledger tell the truth', async () => {
  const mp = market();
  const site = restaurant(mp);
  mp.businessSites.addAsset(site.siteId, { filename: 'hero-dish.jpg', caption: 'Signature mains dish', bytes: 800_000 });
  mp.businessSites.recordPermission(site.siteId, { grantedBy: 'Owner' });
  mp.businessSites.subscribe(site.siteId, {});
  mp.businessSites.publish(site.siteId);
  await mp.businessSites.submitBooking(site.siteId, { name: 'Guest', phone: '0821234501', date: '2026-12-01', time: '19:00', guests: '2' }, { source: 'website' });

  const stats = mp.businessSites.stats();
  assert.equal(stats.sites, 1);
  assert.equal(stats.live, 1);
  assert.equal(stats.bookings, 1);
  assert.equal(stats.monthlyRecurringCents, 179900);
  assert.equal(stats.assetsPermissionCleared, 1);
  assert.equal(stats.permissionGatesBlocked, 0);

  assert.ok(mp.kernel.ledger.verifyChain().valid, 'the chain still verifies');
  const actions = mp.kernel.ledger.entries.map((e) => e.action);
  for (const expected of ['BUSINESS_SITE_SCAFFOLDED', 'SITE_ASSET_ADDED', 'SITE_ASSET_PERMISSION_RECORDED', 'SITE_SUBSCRIPTION_STARTED', 'BUSINESS_SITE_PUBLISHED', 'SITE_BOOKING_RECEIVED']) {
    assert.ok(actions.includes(expected), `${expected} must be in the ledger`);
  }
});
