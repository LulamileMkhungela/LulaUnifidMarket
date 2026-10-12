'use strict';

/**
 * Lula ProVeri — Business Site Studio & sales desk demo.
 *
 * Prints the journey the MyServicePro_Demos playbook describes in markdown,
 * running for real: research a business → diagnose it free → build a preview →
 * walk in with a pitch kit → win it → clear the permission gate → publish →
 * take a booking that becomes an escrow-protected job → meter the updates →
 * hand the client an export they own.
 *
 *   npm run demo:studio
 */

process.env.PROVERI_INTEGRATION_MODE = process.env.PROVERI_INTEGRATION_MODE || 'offline';

const { Marketplace } = require('./marketplace');
const { synthesiseSaId } = require('./integrations/saIdentity');
const { money } = require('./marketplace/format');

function heading(text) {
  process.stdout.write(`\n${'='.repeat(72)}\n${text}\n${'='.repeat(72)}\n`);
}
function line(label, value) {
  process.stdout.write(`${String(label).padEnd(36)} ${value}\n`);
}
function ledger(mp, action) {
  const entry = [...mp.kernel.ledger.entries].reverse().find((e) => e.action === action);
  if (entry) line(`  ↳ ledger ${entry.action}`, entry.payload.summary);
}
function caught(fn) {
  try { fn(); return null; } catch (error) { return error; }
}

(async () => {
  const mp = new Marketplace();
  heading('LULA PROVERI — BUSINESS SITE STUDIO, END TO END');
  line('integration mode', process.env.PROVERI_INTEGRATION_MODE);
  line('industry templates', `${mp.businessSites.templates().length} (restaurant → trade services)`);
  line('plans', mp.businessSites.plans().map((p) => `${p.name} ${money(p.priceCents)}/mo · ${p.setupDisplay}`).join(' | '));

  /* ---------------- 1. field research ---------------- */
  heading('1 · FIELD RESEARCH — a lead written down the way the playbook does it');
  const lead = mp.salesDesk.capture({
    businessName: 'The Harbour Grill',
    industry: 'restaurant',
    url: 'https://harbourgrill.example.co.za',
    contactName: 'Denise Adams',
    phone: '0214341234',
    email: 'bookings@harbourgrill.co.za',
    suburb: 'Sea Point',
    websiteStatus: 'OUTDATED',
    notes: 'Menu is a PDF from 2019. No booking button anywhere.',
  });
  line('lead', `${lead.reference} · ${lead.businessName} · ${lead.suburb}, ${lead.metro}`);
  line('website status', `${lead.websiteStatusLabel} (${lead.statusNote})`);
  line('priority', `${lead.priority}/5 — ${lead.priorityAction}`);
  line('template guessed', lead.templateId);
  ledger(mp, 'SALES_LEAD_CAPTURED');

  /* ---------------- 2. the free diagnostic ---------------- */
  heading('2 · FREE RESCUE DIAGNOSTIC — honest about what it could and could not measure');
  const diagnosed = await mp.salesDesk.diagnose(lead.leadId);
  line('simulated', `${diagnosed.diagnostic.simulated} (${diagnosed.diagnostic.integrationMode})`);
  line('checks it would run', diagnosed.diagnostic.checksRun);
  line('gap kept from the field', diagnosed.diagnostic.primaryGap);
  line('plan it recommends', `${diagnosed.diagnostic.recommendedPlanName} — ${money(mp.businessSites.plan(diagnosed.diagnostic.recommendedPlanId).priceCents)}/mo`);
  line('stage', `${lead.stage} → ${diagnosed.stage}`);
  process.stdout.write(`\n  ${diagnosed.diagnostic.simulationNote}\n`);
  ledger(mp, 'SALES_LEAD_DIAGNOSTIC_SIMULATED');

  /* ---------------- 3. build the demo before the meeting ---------------- */
  heading('3 · BUILD THE DEMO — R0, before anybody has said yes');
  const demo = mp.salesDesk.buildDemo(lead.leadId, { planId: 'business-growth' });
  line('preview url', demo.previewUrl);
  line('status', demo.site.status);
  line('sample menu loaded', `${demo.site.catalogueItems} items across the template's categories`);
  line('booking intake', `${demo.site.bookingIntake || 'RESERVATION'} — the form works in preview`);
  line('charged', money(0));
  ledger(mp, 'SALES_DEMO_BUILT');

  /* ---------------- 4. the pitch kit ---------------- */
  heading('4 · THE PITCH KIT — one call, everything for the door');
  const kit = mp.salesDesk.pitchKit(lead.leadId, { agentName: 'Lula' });
  line('walk in', `${kit.timing.bestWindow} · ${kit.timing.avoid}`);
  line('opening', `${kit.opening.websiteStatus} — ${kit.opening.specificGap}`);
  process.stdout.write('\n  The 60 seconds:\n');
  for (const beat of kit.script) {
    process.stdout.write(`   ${beat.beat.padEnd(14)} ${beat.stageDirection ? `(${beat.line})` : beat.line}\n`);
  }
  line('\nrecommend', `${kit.recommendation.planName} ${money(kit.recommendation.priceCents)}/mo · ${kit.recommendation.buildCostDisplay} · ${kit.recommendation.updatesIncluded}`);
  line('anchor', kit.recommendation.anchorStrategy);
  line('honest boundary', kit.recommendation.honestBoundary);
  line('objections answered', kit.objections.map((o) => `“${o.objection}”`).join(' '));
  line('cold email subject', kit.coldEmail.subject);
  line('permission checklist', `${kit.permissions.checklist.length} items — ${kit.permissions.principles[2]}`);
  line('if they have no photos', `${kit.aiImages.budgetStack.length - 1} steps, ${kit.aiImages.budgetStack.at(-1).cost}`);

  /* ---------------- 5. POPIA: an objection is enforced, not noted ---------------- */
  heading('5 · POPIA — a lead who objects is never contacted again (LEAD-001)');
  const objected = mp.salesDesk.capture({ businessName: 'Vermeulen Accountants', industry: 'accounting', suburb: 'Centurion', websiteStatus: 'GENERIC_TEMPLATE', phone: '0125551000' });
  mp.salesDesk.logOutreach(objected.leadId, { channel: 'EMAIL', template: 'COLD_EMAIL', note: 'First approach' });
  line('first touch', 'logged (email, cold template)');
  const optOut = mp.salesDesk.optOut(objected.leadId, { reason: 'Asked us to stop emailing', requestedVia: 'phone' });
  line('objection recorded', `${optOut.consent.optOutAt} via ${optOut.consent.optOutVia}`);
  for (const channel of ['PHONE', 'WHATSAPP', 'EMAIL', 'SMS', 'WALK_IN', 'MEETING']) {
    const blocked = caught(() => mp.salesDesk.logOutreach(objected.leadId, { channel }));
    line(`  ${channel}`, blocked ? `BLOCKED — ${blocked.message.split('—')[0].trim()}` : 'allowed (!)');
  }
  ledger(mp, 'POPIA_OPT_OUT_RECORDED');

  /* ---------------- 6. win it ---------------- */
  heading('6 · WIN — the subscription starts with month one in escrow');
  const won = mp.salesDesk.convert(lead.leadId, { planId: 'business-growth' });
  line('stage', won.lead.stage);
  line('site', `${won.site.name} (${won.site.slug}) — ${won.site.status}`);
  line('subscription', `${won.subscription.planName} ${money(won.subscription.monthlyCents)}/mo from ${won.subscription.startedAt?.slice(0, 10) || 'today'}`);
  const escrow = mp.kernel.escrow.get(won.subscription.escrowId);
  line('escrow', `${escrow.status} · ${money(escrow.amountCents)} held · platform fee ${money(escrow.fees.platformFeeCents)} · warranty holdback ${money(escrow.fees.warrantyHoldbackCents)}`);
  ledger(mp, 'SALES_LEAD_WON');

  const siteId = won.site.siteId;

  /* ---------------- 7. assets: classified, filed, permission-gated ---------------- */
  heading('7 · ASSETS — classified on intake, filed onto the item, permission-gated');
  const photo = mp.businessSites.addAsset(siteId, {
    filename: 'IMG_2231.jpg', caption: 'Grilled kingklip with lemon butter and samphire', bytes: 1_240_000, source: 'owner-supplied',
  });
  line('owner photo', `${photo.filename} → ${photo.classification.category} (${photo.classification.confidence}% confidence)`);
  line('placement', `${photo.classification.placement}${photo.attachedTo ? ` → filed onto “${photo.attachedTo.item}”` : ''}`);

  const generated = mp.businessSites.addAsset(siteId, {
    filename: 'ai-signature-dish.jpg', caption: 'Signature chocolate tart, dark moody styling', bytes: 310_000, aiGenerated: true, source: 'ai-generated',
  });
  line('AI image', `${generated.filename} → aiGenerated=${generated.aiGenerated}, labelled=${generated.aiLabelled}`);
  const prompt = mp.businessSites.aiImagePrompt(siteId, { itemText: 'Signature chocolate tart' });
  line('prompt written for them', prompt.prompt.slice(0, 96) + '…');
  line('labelling rule', prompt.labelling.rule);

  const gateBefore = mp.businessSites.permissionState(siteId);
  line('permission gate', `${gateBefore.assetsCleared}/${gateBefore.totalAssets} cleared · gateOpen=${gateBefore.gateOpen}`);
  mp.businessSites.preview(siteId);
  const refusedPublish = caught(() => mp.businessSites.publish(siteId));
  line('publish attempt', refusedPublish ? `REFUSED — ${refusedPublish.message}` : 'went live (!)');
  ledger(mp, 'SITE_PUBLISH_BLOCKED');

  const permission = mp.businessSites.recordPermission(siteId, {
    grantedBy: 'Denise Adams', role: 'owner', method: 'whatsapp',
    notes: 'Owner supplied the fish photo; the tart image is a generated stand-in until the real one is shot.',
    popiaConsent: true, identifiablePeople: false,
  });
  line('permission recorded', `seal ${permission.seal.slice(0, 16)}… · ${permission.checklist.filter((c) => c.satisfied).length}/${permission.checklist.length} checklist items satisfied`);
  const gateAfter = mp.businessSites.permissionState(siteId);
  line('permission gate', `${gateAfter.assetsCleared}/${gateAfter.totalAssets} cleared · gateOpen=${gateAfter.gateOpen}`);
  ledger(mp, 'SITE_ASSET_PERMISSION_RECORDED');

  /* ---------------- 8. publish ---------------- */
  heading('8 · PUBLISH — the page is server-rendered HTML with no dead buttons');
  const published = mp.businessSites.publish(siteId);
  line('status', `${published.status} at ${published.url}`);
  line('warnings', published.warnings.length ? published.warnings.map((w) => w.ruleId).join(', ') : 'none');
  const html = mp.businessSites.renderSiteHtml(siteId);
  line('page weight', `${(Buffer.byteLength(html) / 1024).toFixed(1)} KB of self-contained HTML`);
  line('works without js', `${/<form class="bform" method="post"/.test(html)} (real form post + WhatsApp fallback)`);
  line('localbusiness schema', `${html.includes('LocalBusiness')}`);
  line('ai image labelled on page', `${/illustrative/i.test(html)}`);
  ledger(mp, 'BUSINESS_SITE_PUBLISHED');

  /* ---------------- 9. a live booking ---------------- */
  heading('9 · A BOOKING FROM THE PUBLIC SITE — reference number, quote, owner inbox');
  const booking = await mp.businessSites.submitBooking(published.url.replace('/s/', ''), {
    name: 'Naledi Sithole', phone: '0821234501', email: 'naledi@example.co.za',
    date: '2026-12-24', time: '19:30', guests: '4', notes: 'Anniversary — window table if you have one',
  }, { source: 'website', ip: '196.15.20.4' });
  line('reference', booking.reference);
  line('status', `${booking.status} · intake ${booking.intake}`);
  line('quote', booking.amountQuotedCents ? money(booking.amountQuotedCents) : 'to be quoted — we do not invent a number from an unrelated menu item');
  line('told the customer', booking.customerMessage);
  line('owner notified', `${booking.ownerNotified}`);
  const confirmed = mp.businessSites.decideBooking(booking.bookingId, { decision: 'CONFIRMED', note: 'Table for four, 19:30' });
  line('decision', confirmed.status);
  ledger(mp, 'SITE_BOOKING_RECEIVED');

  /* ---------------- 10. the vertical bridge: booking → escrow job ---------------- */
  heading('10 · THE BRIDGE NO WEBSITE PLATFORM HAS — booking → job → escrow');
  const suburb = mp.catalog.suburb('soweto');
  const idNumber = synthesiseSaId({ seed: 'studio-demo-pro', age: 41 });
  const pro = mp.people.registerPro({
    fullName: 'Studio Demo Plumber', email: 'studio.demo.plumber@example.co.za', mobile: '0711234500', idNumber,
    suburbId: suburb.id, primaryCategory: 'plumbing', hourlyRateCents: 65000, calloutFeeCents: 55000,
    tradeCertification: { body: 'PIRB', certificateNumber: 'PIRB-2021-77120' }, qualification: { saqaId: '61709' },
    insurance: { provider: 'Santam', policyNumber: 'PL-DEMO-9', coverCents: 100_000_000 },
    bankDetails: { bankCode: 'capitec', accountNumber: '1020304050', holderName: 'Studio Demo Plumber' },
    criminalDeclaration: { declared: true, noConvictions: true },
  });
  pro.__idNumber = idNumber; pro.__mobileOtpRef = 'SMS_DEMO'; pro.__emailOtpRef = 'EMAIL_DEMO';
  mp.store.put('pros', pro.proId, pro);
  const verified = await mp.people.runVerificationPipeline(pro.proId, {});
  line('pro verified', `${verified.pro.fullName} · ${verified.pro.trustScore}/100 · ${verified.pro.verification?.badge || verified.badge}`);

  const tradeSite = mp.businessSites.scaffold({
    templateId: 'trade-services', businessName: 'Studio Demo Plumbing', proId: pro.proId, suburbId: suburb.id,
    contact: { phone: pro.mobile, email: pro.email }, planId: 'business-growth',
  });
  mp.businessSites.recordPermission(tradeSite.siteId, { grantedBy: 'Owner', method: 'in person' });
  mp.businessSites.subscribe(tradeSite.siteId, { planId: 'business-growth' });
  mp.businessSites.publish(tradeSite.siteId);
  line('trade site live', `/s/${tradeSite.slug} · linked to ${tradeSite.proName}`);

  const tradeBooking = await mp.businessSites.submitBooking(tradeSite.slug, {
    name: 'Kagiso Molefe', phone: '0791234504', email: 'kagiso.m@example.co.za',
    service: 'Geyser leaking through the ceiling', suburb: 'Soweto', urgency: 'URGENT — today',
    budget: 8500, notes: 'Ceiling is already stained and the power is off at the geyser.',
  }, { source: 'website' });
  line('booking', `${tradeBooking.reference} · intake ${tradeBooking.intake} · ${tradeBooking.status}`);
  line('job opened', `${tradeBooking.job.reference} (${tradeBooking.job.status}) at ${tradeBooking.job.url}`);
  const job = mp.store.get('jobs', tradeBooking.job.jobId);
  line('job budget', `${money(job.budget.statedCents)} stated`);
  line('market band', job.priceBand ? `${money(job.priceBand.p10Cents)} – ${money(job.priceBand.p90Cents)} (${job.priceBand.metro}, ${job.priceBand.sampleSize} samples)` : 'no guidance for this category');
  line('customer created', `${job.customerId} — a real account that can fund escrow`);
  line('pro notified', `${mp.store.count('notifications', (n) => n.userId === pro.proId && n.type === 'SITE_BOOKING')} inbox notification(s)`);

  const bid = mp.jobs.submitBid({
    jobId: job.jobId, proId: pro.proId, totalCents: 820000, calloutFeeCents: 55000,
    scopeOfWork: 'Replace the geyser, fit a compliant overflow, test the thermostat, issue a Plumbing CoC.',
    scheduledAt: '2026-10-14', durationHours: 4, includesCoc: true,
  });
  line('bid submitted', `${bid.reference} · ${money(bid.totalCents)} · ${bid.priceVerdict || 'in market band'}`);
  line('why this matters', 'The website is a demand channel into the same escrow engine as the marketplace.');

  /* ---------------- 11. metered updates ---------------- */
  heading('11 · UPDATES ARE METERED — nobody is silently billed (WEB-001)');
  let consumed = 0;
  let tooMany = null;
  for (let i = 0; i < 12; i += 1) {
    const attempt = caught(() => mp.businessSites.updateContent(siteId, { tagline: `Seasonal edit ${i + 1}` }));
    if (attempt) { tooMany = attempt; break; }
    consumed += 1;
  }
  const allowance = mp.businessSites.get(siteId).plan;
  line('edits inside the allowance', `${consumed} (${allowance.updateCreditsUsed}/${allowance.updateCreditsTotal} credits used on ${allowance.planName})`);
  line('the next edit', tooMany ? `REFUSED — ${tooMany.message}` : 'allowed (!)');
  line('options offered', tooMany?.decision?.options ? JSON.stringify(tooMany.decision.options) : '—');
  const extra = mp.businessSites.updateContent(siteId, { tagline: 'Approved and billed' }, { approveExtra: true });
  line('approved extra edit', `charged ${money(extra.update.chargedCents)} · credits still ${extra.site.plan.updateCreditsUsed}/${extra.site.plan.updateCreditsTotal}`);
  ledger(mp, 'SITE_UPDATE_CHARGED');

  /* ---------------- 12. the client owns the file ---------------- */
  heading('12 · EXPORT — the client can leave with everything');
  const exported = mp.businessSites.exportSite(siteId);
  line('single file', `${exported.filename} · ${(exported.bytes / 1024).toFixed(1)} KB · sha256 ${exported.sha256.slice(0, 12)}…`);
  line('self contained', `${exported.selfContained !== false} (css and assets inlined, no build step)`);
  const bundle = mp.businessSites.exportBundle();
  line('bundle', `${bundle.siteCount} site(s) + index page + sitemap + README`);
  line('deployment', `GitHub Actions workflow included: ${bundle.workflow.split('\n')[0].trim()}`);
  const cancelled = mp.businessSites.cancelSubscription(siteId, { reason: 'Demo of the cancellation path' });
  line('if they cancel', `${cancelled.subscription.status} · export still available at ${cancelled.exportAvailableAt}`);

  /* ---------------- 13. the desk, the studio and the ledger ---------------- */
  heading('13 · WHERE THAT LEAVES THE BUSINESS');
  const desk = mp.salesDesk.stats();
  line('sales desk', `${desk.leads} leads · ${desk.won} won · ${desk.conversionRate}% conversion · ${desk.optOuts} objection(s) honoured`);
  line('pipeline', `${money(desk.openPipelineCents)} open · ${money(desk.weightedPipelineCents)} stage-weighted · ${money(desk.monthlyRecurringCents)} MRR`);
  line('work done for free first', `${desk.diagnosticsRun} diagnostics · ${desk.demosBuilt} demos built at R0`);
  const studio = mp.businessSites.stats();
  line('studio', `${studio.sites} sites · ${studio.live} live · ${studio.bookings} bookings · ${studio.bookingsConvertedToJobs} became escrow jobs`);
  line('recurring', `${money(studio.monthlyRecurringCents)}/mo · ${money(studio.annualisedRecurringCents)} annualised`);
  line('permissions', `${studio.assetsPermissionCleared}/${studio.assets} assets cleared · ${studio.permissionGatesBlocked} publish gate(s) closed · ${studio.assetsAiGenerated} AI image(s) labelled`);
  line('policy fired', JSON.stringify(mp.kernel.policy.stats().byRule));

  const chain = mp.kernel.ledger.verifyChain();
  heading('AUDIT');
  line('ledger entries', mp.kernel.ledger.entries.length);
  const receipt = mp.kernel.ledger.integrityReceipt();
  line('chain valid', `${chain.valid} · ${receipt.entries} entries · head ${receipt.headHash.slice(0, 16)}…`);
  line('integrity receipt', receipt.receipt);
  line('studio actions logged', mp.kernel.ledger.entries.filter((e) => /^(BUSINESS_SITE|SITE_|SALES_|POPIA_)/.test(e.action)).length);
  process.stdout.write('\nEvery claim above is a record in the hash-chained ledger, not a screenshot.\n\n');
})().catch((error) => {
  process.stderr.write(`\ndemo failed: ${error.stack}\n`);
  process.exitCode = 1;
});
