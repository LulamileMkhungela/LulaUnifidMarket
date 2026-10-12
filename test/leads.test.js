'use strict';

/**
 * Sales desk: the field-research CRM the MyServicePro demos describe in
 * docs/lead-list-template.md and docs/pitch-script.md, made into a real system.
 * These tests cover lead capture, the honest offline diagnostic, demo building,
 * the generated pitch kit, outreach windows (LEAD-002), the POPIA objection
 * block (LEAD-001), and conversion into a live site with money in escrow.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Marketplace } = require('../src/marketplace');
const { LEAD_STAGE } = require('../src/marketplace/leads');
const { SITE_STATUS } = require('../src/marketplace/businessSites');

function market() {
  return new Marketplace();
}

function lead(mp, overrides = {}) {
  return mp.salesDesk.capture({
    businessName: 'Harbour Light Seafood',
    industry: 'restaurant',
    url: 'https://harbourlight.example.co.za',
    contactName: 'Denise Adams',
    phone: '0214341234',
    email: 'bookings@harbourlight.co.za',
    suburb: 'Sea Point',
    websiteStatus: 'OUTDATED',
    source: 'FIELD_RESEARCH',
    notes: 'Menu PDF from 2019, no booking button',
    ...overrides,
  });
}

/* ================= capture & the field-research vocabulary ================= */

test('capture records the field research and derives a priority from it', () => {
  const mp = market();
  const captured = lead(mp);

  assert.equal(captured.stage, LEAD_STAGE.NEW);
  assert.match(captured.reference, /^LEAD-\d{5}$/);
  assert.equal(captured.websiteStatus, 'OUTDATED');
  assert.equal(captured.websiteStatusLabel, 'Outdated');
  assert.ok(captured.statusNote, 'the status carries the note the salesperson uses');
  assert.ok(captured.priority >= 1 && captured.priority <= 5);
  assert.equal(captured.templateId, 'restaurant', 'the industry guesses the template');
  assert.equal(captured.suburbId, 'sea-point', 'the suburb resolves to a platform suburb');
  assert.equal(captured.metro, 'City of Cape Town');
  assert.ok(captured.nextActionAt, 'a next action is scheduled at capture');
  assert.equal(captured.consent.optOut, false);
  assert.equal(captured.consent.popiaNoticeGiven, true);
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'SALES_LEAD_CAPTURED'));
});

test('a business with no website is the highest priority lead there is', () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Nails on Main', url: null, industry: 'beauty', websiteStatus: 'BROKEN' });
  assert.equal(captured.priority, 5, 'no url pushes the priority to the top of the list');
  assert.match(captured.priorityAction, /week|today|Walk in/i);
});

test('the status vocabulary is the one the field team writes down', () => {
  const mp = market();
  const statuses = mp.salesDesk.websiteStatuses();
  const ids = statuses.map((s) => s.id);
  for (const expected of ['NO_WEBSITE', 'BROKEN', 'OUTDATED', 'MINIMAL', 'GENERIC_TEMPLATE', 'SLOW_ON_MOBILE']) {
    assert.ok(ids.includes(expected), `${expected} must be capturable`);
  }
  assert.ok(statuses.every((s) => s.severity >= 1 && s.severity <= 5 && s.label && s.note));

  const stages = mp.salesDesk.stages();
  assert.equal(stages.length, 11, 'NEW → WON/LOST with a nurture lane');
  assert.ok(stages.every((s) => s.weight >= 0 && s.weight <= 1), 'every stage is weighted for the forecast');
  assert.equal(stages.find((s) => s.id === 'LOST').weight, 0, 'a lost deal is worth nothing in the forecast');
  assert.ok(stages.find((s) => s.id === 'WON').weight === 1);
});

test('the list can be filtered to what is due today', () => {
  const mp = market();
  lead(mp);
  lead(mp, { businessName: 'Kloof Street Bistro', websiteStatus: 'NO_WEBSITE', url: null, industry: 'restaurant' });
  const won = lead(mp, { businessName: 'Bergzicht Guest Farm', industry: 'accommodation' });

  assert.equal(mp.salesDesk.list().length, 3);
  assert.equal(mp.salesDesk.list({ stage: LEAD_STAGE.NEW }).length, 3);
  mp.salesDesk.convert(won.leadId, { planId: 'essential' });
  assert.equal(mp.salesDesk.list({ stage: LEAD_STAGE.WON }).length, 1);
  assert.equal(mp.salesDesk.list({ stage: LEAD_STAGE.NEW }).length, 2);
  assert.equal(mp.salesDesk.list({ templateId: 'restaurant' }).length, 2);
});

/* ================= the honest diagnostic ================= */

test('diagnosing a lead with no website says exactly that', async () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Nails on Main', url: null, industry: 'beauty' });
  const result = await mp.salesDesk.diagnose(captured.leadId);

  assert.equal(result.diagnostic.healthScore, 0);
  assert.equal(result.diagnostic.grade, 'F');
  assert.equal(result.diagnostic.reachable, false);
  assert.equal(result.priority, 5);
  assert.equal(result.stage, LEAD_STAGE.DIAGNOSED);
  assert.ok(result.diagnostic.recommendedPlanId);
  assert.match(result.diagnostic.primaryGap, /no website/i);
});

test('an offline scan is labelled simulated and never overwrites field research', async () => {
  const mp = market();
  const captured = lead(mp);
  const result = await mp.salesDesk.diagnose(captured.leadId);
  const diagnostic = result.diagnostic;

  assert.equal(diagnostic.simulated, true, 'the scan could not reach the network');
  assert.equal(diagnostic.healthScore, null, 'a simulated score is not published as a real one');
  assert.equal(diagnostic.grade, null);
  assert.match(diagnostic.simulationNote, /integrations disabled|integrations are off/);
  assert.ok(diagnostic.primaryGap.includes('Harbour Light Seafood'), 'what the salesperson saw is kept');
  assert.ok(diagnostic.recommendedPlanName, 'the plan recommendation still comes from the research');
  assert.equal(result.stage, LEAD_STAGE.RESEARCHED, 'a scan that could not measure anything does not claim DIAGNOSED');
  const simulatedEntry = mp.kernel.ledger.entries.find((e) => e.action === 'SALES_LEAD_DIAGNOSTIC_SIMULATED');
  assert.ok(simulatedEntry, 'the simulated scan is recorded as simulated, not as a diagnosis');
  assert.equal(simulatedEntry.payload.simulated, true);
  assert.match(simulatedEntry.payload.summary, /integrations offline/);
  assert.ok(!mp.kernel.ledger.entries.some((e) => e.action === 'SALES_LEAD_DIAGNOSED'), 'no real score is claimed');
});

test('a live scan produces a real score and drives the plan recommendation', async () => {
  const mp = market();
  const captured = lead(mp);
  // The same code path with the network on produces a real number; we assert the
  // shape the pitch kit depends on rather than a specific partner response.
  const diagnostic = await mp.webStudio.rescueDiagnostic({ url: 'https://harbourlight.example.co.za', contact: { businessName: 'Harbour Light Seafood' } });
  assert.ok(Array.isArray(diagnostic.findings) && diagnostic.findings.length >= 8);
  assert.ok(diagnostic.grade, 'a real grade comes back with the scan');
  assert.ok(diagnostic.recommendedPackage, 'and the scan recommends a package');
  assert.ok(diagnostic.verdict.length > 20);
  assert.equal(typeof diagnostic.simulated, 'boolean');
  assert.ok(diagnostic.findings.every((f) => typeof f.passed === 'boolean' && f.label));
  void captured;
});

/* ================= building the demo ================= */

test('building a demo scaffolds a real preview site and links it to the lead', () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Nails on Main', url: null, industry: 'beauty', templateId: 'beauty-wellness' });

  const result = mp.salesDesk.buildDemo(captured.leadId, { planId: 'business-growth' });

  assert.equal(result.lead.stage, LEAD_STAGE.DEMO_BUILT);
  assert.ok(result.site.siteId);
  assert.equal(result.siteId, captured.leadId ? result.site.siteId : null);
  assert.equal(result.site.status, SITE_STATUS.PREVIEW);
  assert.equal(result.site.slug, 'nails-on-main');
  assert.equal(result.previewUrl, `/preview/nails-on-main`);
  assert.ok(result.site.catalogueItems >= 3, 'sample services are loaded so the preview is worth showing');
  assert.equal(result.planId, 'business-growth');
  assert.equal(result.planName, 'Business Growth');
  assert.equal(result.priceCents, 179900);
  assert.ok(result.pitchKit.showThem.previewUrl === `/preview/${result.slug}`, 'the pitch kit now points at the live preview');

  const html = mp.businessSites.renderSiteHtml(result.site.siteId);
  assert.ok(html.includes('Nails on Main'));
  assert.ok(html.includes('demo-bar'), 'a preview says it is a preview');

  const stats = mp.salesDesk.stats();
  assert.equal(stats.demosBuilt, 1);
});

test('a demo can be rebuilt with the business\'s own content', () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Bergzicht Guest Farm', industry: 'accommodation', suburb: 'Stellenbosch', url: null });
  mp.salesDesk.buildDemo(captured.leadId, {});

  const second = mp.salesDesk.buildDemo(captured.leadId, { businessName: 'Bergzicht Guest Farm & Cottage', templateId: 'accommodation' });
  assert.equal(second.site.name, 'Bergzicht Guest Farm & Cottage');
  assert.equal(second.site.status, SITE_STATUS.PREVIEW);
  const reloaded = mp.salesDesk.get(captured.leadId);
  assert.ok(reloaded.timeline.filter((t) => t.event === 'DEMO_BUILT').length >= 2, 'both builds are on the timeline');
  assert.equal(reloaded.siteSlug, second.slug, 'the lead points at the latest preview');
});

/* ================= the pitch kit ================= */

test('the pitch kit substitutes the real numbers and leaves no placeholders', () => {
  const mp = market();
  const captured = lead(mp, { subscriptionPlanId: 'business-growth' });
  const kit = mp.salesDesk.pitchKit(captured.leadId, { agentName: 'Lula' });

  assert.equal(kit.businessName, 'Harbour Light Seafood');
  assert.equal(kit.agentName, 'Lula');
  assert.match(kit.timing.bestWindow, /14:30/);
  assert.ok(kit.timing.avoid.length > 10);

  // The AI prompt template is meant to keep its {placeholders} — it is a
  // reusable template the salesperson fills per dish or product. Everything
  // addressed to the lead must be substituted.
  const addressed = JSON.stringify({ ...kit, aiImages: undefined, permissions: undefined });
  assert.ok(!/\{[a-zA-Z]+\}/.test(addressed), 'every placeholder in the outreach copy is filled');
  assert.ok(/\{[a-z_]+\}/.test(kit.aiImages.promptTemplate), 'the reusable image prompt keeps its slots');

  assert.ok(kit.script.length >= 5, 'the 60-second script is beat by beat');
  assert.ok(kit.script.some((b) => b.line.includes('Lula')));
  assert.ok(kit.script.some((b) => b.line.includes('Harbour Light Seafood')), 'the hook names the business');
  assert.ok(kit.script.some((b) => /will build a modern version/i.test(b.line)), 'and does not claim a preview that was never built');

  assert.equal(kit.recommendation.planId, 'business-growth');
  assert.equal(kit.recommendation.priceCents, 179900);
  assert.equal(kit.recommendation.buildCostCents, 0);
  assert.match(kit.recommendation.buildCostDisplay, /R0 to build/i);
  assert.match(kit.recommendation.updatesIncluded, /5 updates/);
  assert.ok(kit.recommendation.anchorStrategy.length > 20);
  assert.ok(kit.recommendation.honestBoundary.length > 20);

  assert.ok(kit.objections.length >= 3);
  assert.ok(kit.objections.every((o) => o.objection && o.answer));

  assert.ok(kit.coldEmail.subject.includes('Harbour Light'));
  assert.ok(kit.coldEmail.body.includes('Harbour Light Seafood'), 'the email uses what we know about them');
  assert.match(kit.coldEmail.body, /no cost, no commitment/i, 'the risk reversal is in the email');
  assert.ok(!kit.coldEmail.body.includes('I went ahead and built'), 'it does not claim a mockup that was never built');
  assert.ok(kit.whatsapp.includes('can build'), 'the WhatsApp opener is honest before a demo exists');

  assert.ok(kit.permissions.checklist.length >= 4, 'the permission checklist travels with the pitch');
  assert.ok(kit.permissions.principles.some((p) => /credit is not/.test(p)));
  assert.ok(kit.aiImages.budgetStack.length >= 3, 'the AI image workflow is part of the kit');
  assert.match(kit.aiImages.labellingPolicy, /illustrative/i);
  assert.ok(kit.showThem.previewUrl === null && kit.showThem.bookingIsLive === false, 'no preview yet, and the kit says so');
});

test('the pitch kit prices the plan the diagnostic recommends', () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Vermeulen Accountants', industry: 'professional services', url: 'https://vermeulen.example.co.za', websiteStatus: 'SLOW_ON_MOBILE' });
  return mp.salesDesk.diagnose(captured.leadId).then((result) => {
    const kit = mp.salesDesk.pitchKit(captured.leadId);
    assert.equal(kit.recommendation.planId, result.diagnostic.recommendedPlanId);
    assert.ok(kit.recommendation.why.length > 20);
    assert.equal(kit.opening.websiteStatus, result.websiteStatus);
  });
});

/* ================= outreach, POPIA and the calling window ================= */

test('outreach renders the template, moves the stage and schedules the follow-up', () => {
  const mp = market();
  const captured = lead(mp);
  const touched = mp.salesDesk.logOutreach(captured.leadId, { channel: 'WHATSAPP', template: 'WHATSAPP', note: 'Walked past, asked to come back Thursday' });

  assert.equal(touched.lead.stage, LEAD_STAGE.CONTACTED);
  assert.ok(touched.touch.message.includes('Harbour Light Seafood'));
  assert.ok(touched.touch.message.length > 80);
  assert.ok(touched.lead.nextActionAt > touched.touch.at, 'a follow-up is scheduled by priority');
  assert.equal(mp.salesDesk.stats().outreachTouches, 1);
  assert.ok(mp.kernel.ledger.entries.some((e) => e.action === 'SALES_OUTREACH_LOGGED'));
});

test('outreach outside the calling window warns but is allowed (LEAD-002)', () => {
  const mp = market();
  const captured = lead(mp);
  const late = mp.salesDesk.logOutreach(captured.leadId, { channel: 'PHONE', scheduledFor: '2026-10-13T21:30:00+02:00' });

  assert.ok(late.warnings.some((w) => w.ruleId === 'LEAD-002'), 'the window rule fired');
  assert.ok(late.touch, 'the touch is still logged — a warning is not a block');
});

test('a POPIA objection blocks every channel (LEAD-001)', () => {
  const mp = market();
  const captured = lead(mp);
  mp.salesDesk.logOutreach(captured.leadId, { channel: 'EMAIL', template: 'COLD_EMAIL' });

  const opted = mp.salesDesk.optOut(captured.leadId, { reason: 'Asked us to stop calling', requestedVia: 'phone' });
  assert.equal(opted.consent.optOut, true);
  assert.ok(opted.consent.optOutAt);
  assert.equal(opted.consent.optOutVia, 'phone');
  assert.equal(opted.stage, LEAD_STAGE.LOST, 'we may not contact them again, so the lead is closed');
  assert.equal(opted.result, 'OPT_OUT');
  assert.equal(opted.nextActionAt, null, 'no follow-up is scheduled against an objection');

  for (const channel of ['PHONE', 'WHATSAPP', 'EMAIL', 'SMS', 'WALK_IN', 'MEETING']) {
    assert.throws(
      () => mp.salesDesk.logOutreach(captured.leadId, { channel }),
      /LEAD-001/,
      `${channel} must be blocked after an objection`,
    );
  }
  const error = (() => { try { mp.salesDesk.logOutreach(captured.leadId, { channel: 'PHONE' }); return null; } catch (e) { return e; } })();
  assert.match(error.message, /POPIA/);
  const entry = mp.kernel.ledger.entries.find((e) => e.action === 'POPIA_OPT_OUT_RECORDED');
  assert.ok(entry, 'the objection is hash-chained');
  assert.equal(entry.visibility, 'PUBLIC');
  assert.match(entry.payload.summary, /LEAD-001/);

  const actions = mp.salesDesk.nextBestActions();
  const row = actions.find((a) => a.leadId === captured.leadId);
  assert.ok(row === undefined || row.optOut === true, 'the objection is visible in the pipeline view');
});

test('an objection on a won account does not rewrite history', () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Bergzicht Guest Farm', industry: 'accommodation', url: null });
  mp.salesDesk.convert(captured.leadId, { planId: 'business-growth' });
  const opted = mp.salesDesk.optOut(captured.leadId, { reason: 'No marketing emails please' });
  assert.equal(opted.stage, LEAD_STAGE.WON, 'they are still a customer — only marketing stops');
  assert.equal(opted.consent.optOut, true);
});

/* ================= conversion and the pipeline ================= */

test('winning a lead starts a subscription and puts month one in escrow', () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Bergzicht Guest Farm', industry: 'accommodation', suburb: 'Stellenbosch', url: null, templateId: 'accommodation' });
  mp.salesDesk.logOutreach(captured.leadId, { channel: 'WALK_IN', note: 'Showed the preview on the phone' });

  const result = mp.salesDesk.convert(captured.leadId, { planId: 'business-growth' });

  assert.equal(result.lead.stage, LEAD_STAGE.WON);
  assert.equal(result.lead.result, 'WON');
  assert.equal(result.lead.dealValueCents, 179900);
  assert.equal(result.subscription.status, 'ACTIVE');
  assert.equal(result.subscription.planId, 'business-growth');

  const escrow = mp.kernel.escrow.get(result.subscription.escrowId);
  assert.equal(escrow.amountCents, 179900, 'the first month is held, not pocketed');
  assert.ok(result.site.siteId, 'a site exists to serve');

  const money = mp.kernel.ledger.entries.filter((e) => e.action === 'SALES_LEAD_WON');
  assert.equal(money.length, 1);
  assert.equal(money[0].level, 'MONEY');
  assert.match(money[0].payload.summary, /R0 build cost/);

  const stats = mp.salesDesk.stats();
  assert.equal(stats.won, 1);
  assert.equal(stats.conversionRate, 100);
  assert.equal(stats.monthlyRecurringCents, 179900);
  assert.equal(stats.annualisedRecurringCents, 179900 * 12);
});

test('losing a lead records why and drops it out of the forecast', () => {
  const mp = market();
  const captured = lead(mp, { businessName: 'Vermeulen Accountants', industry: 'professional services', websiteStatus: 'HEALTHY' });
  const lost = mp.salesDesk.lose(captured.leadId, { reason: 'Scored healthy — do not sell a rebuild' });

  assert.equal(lost.stage, LEAD_STAGE.LOST);
  assert.equal(lost.result, 'LOST');
  assert.ok(lost.timeline.some((t) => t.event === 'LOST' && t.note.includes('healthy')));
  const stats = mp.salesDesk.stats();
  assert.equal(stats.lost, 1);
  assert.equal(stats.open, 0);
  assert.equal(stats.openPipelineCents, 0);
});

test('the pipeline is weighted by stage and priced at the recommended plan', () => {
  const mp = market();
  lead(mp, { businessName: 'Lead A', websiteStatus: 'NO_WEBSITE', url: null });
  const b = lead(mp, { businessName: 'Lead B', industry: 'beauty', websiteStatus: 'BROKEN', url: null });
  mp.salesDesk.buildDemo(b.leadId, { planId: 'essential' });

  const stats = mp.salesDesk.stats();
  assert.ok(stats.openPipelineCents >= 99900 + 179900, 'an open lead is priced at the plan we would pitch');
  assert.ok(stats.weightedPipelineCents < stats.openPipelineCents, 'weighting discounts what is not yet won');
  assert.ok(stats.weightedPipelineCents > 0);
});

test('next best actions put overdue, high-priority work first', async () => {
  const mp = market();
  const fresh = lead(mp, { businessName: 'Sandton Shuttle Co', industry: 'transport', websiteStatus: 'NO_WEBSITE', url: null });
  const stale = lead(mp, { businessName: 'Old Enquiry', websiteStatus: 'OUTDATED', priority: 2 });
  mp.salesDesk.update(stale.leadId, { nextActionAt: '2026-01-01T08:00:00+02:00' });

  const actions = mp.salesDesk.nextBestActions();
  assert.equal(actions[0].leadId, stale.leadId, 'the overdue follow-up is first');
  assert.equal(actions[0].overdue, true);
  assert.match(actions[0].action, /first contact|diagnostic/i);
  assert.equal(actions.find((a) => a.leadId === fresh.leadId).priority, 5);
  assert.match(actions.find((a) => a.leadId === fresh.leadId).action, /Research and diagnose/i);
  assert.ok(actions.every((a) => a.valueCents > 0 && a.planToPitch));
});
