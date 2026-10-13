'use strict';

/**
 * ProVeri — Sales desk for the Business Site Studio.
 *
 * The reference implementation keeps its sales process in markdown: a lead list
 * template with a website-status vocabulary and a 1–5 priority guide, a cold
 * email, and a 60-second in-person pitch with a timing window. It works — it is
 * how those demo sites got built — but it lives in a doc, so nothing enforces
 * it and nothing measures it.
 *
 * Here the same playbook is executable:
 *
 *   • a lead carries the website-status vocabulary and priority from the doc,
 *   • the free diagnostic scores the lead's existing site and *chooses* the
 *     recommended plan and the specific gap to quote in the pitch,
 *   • the pitch kit renders the 60-second script with real numbers substituted,
 *     plus the best time to walk in and the objection answers,
 *   • `buildDemo` scaffolds a working preview site before the meeting, so the
 *     "show, don't tell" beat has something real to show — with a booking form
 *     that works, which the reference demos do not have,
 *   • outreach is logged against the lead and policy LEAD-001 blocks any touch
 *     after a POPIA opt-out, and warns outside business hours.
 */

const { idFor, nowIso, sha256, deepClone, addDays } = require('../kernel/util');
const { planData } = require('./businessSites');

const LEAD_STAGE = Object.freeze({
  NEW: 'NEW',
  RESEARCHED: 'RESEARCHED',
  DIAGNOSED: 'DIAGNOSED',
  DEMO_BUILT: 'DEMO_BUILT',
  CONTACTED: 'CONTACTED',
  MEETING_BOOKED: 'MEETING_BOOKED',
  PREVIEW_SENT: 'PREVIEW_SENT',
  NEGOTIATION: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
  NURTURE: 'NURTURE',
});

const STAGE_WEIGHT = Object.freeze({
  NEW: 0.05,
  RESEARCHED: 0.1,
  DIAGNOSED: 0.2,
  DEMO_BUILT: 0.35,
  CONTACTED: 0.45,
  MEETING_BOOKED: 0.6,
  PREVIEW_SENT: 0.7,
  NEGOTIATION: 0.85,
  WON: 1,
  LOST: 0,
  NURTURE: 0.15,
});

const OUTREACH_CHANNELS = Object.freeze(['WALK_IN', 'WHATSAPP', 'EMAIL', 'PHONE', 'SMS', 'MEETING']);

class SalesDeskService {
  constructor({ store, kernel, catalog, businessSites, webStudio, people }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.sites = businessSites;
    this.webStudio = webStudio;
    this.people = people;
  }

  stages() {
    return Object.entries(LEAD_STAGE).map(([id, stage]) => ({ id, stage, weight: STAGE_WEIGHT[stage] }));
  }

  websiteStatuses() {
    return planData.websiteStatus.options;
  }

  /* ================================================================== *
   * CAPTURE
   * ================================================================== */

  capture({
    businessName, industry = null, templateId = null, url = null, contactName = null, phone = null, email = null,
    suburb = null, metro = null, source = 'FIELD_RESEARCH', websiteStatus = 'NO_WEBSITE', priority = null,
    notes = null, owner = 'sales-desk', consent = {},
  }) {
    if (!businessName) throw new Error('businessName is required');
    const resolvedSuburb = suburb ? (this.catalog.findSuburbByName(suburb) || null) : null;
    const status = planData.websiteStatus.options.find((s) => s.id === websiteStatus) || planData.websiteStatus.options[0];
    const computedPriority = Number.isFinite(Number(priority)) && priority ? Number(priority) : priorityFromStatus(status.severity, { url, industry });

    const lead = {
      leadId: idFor('lead'),
      reference: this.store.reference('LEAD', 'lead', 5),
      stage: LEAD_STAGE.NEW,
      source,
      owner,
      businessName: String(businessName).trim(),
      industry: industry || (templateId ? this.#templateLabel(templateId) : null),
      templateId: templateId || guessTemplate(industry, businessName),
      contactName,
      phone,
      email,
      url,
      suburb: resolvedSuburb?.name || suburb || null,
      suburbId: resolvedSuburb?.id || null,
      metro: resolvedSuburb?.metroName || metro || null,
      websiteStatus: status.id,
      websiteStatusLabel: status.label,
      statusNote: status.note,
      priority: computedPriority,
      priorityAction: (planData.priorityGuide.find((p) => p.priority === computedPriority) || {}).action || 'Add to the nurture list',
      diagnostic: null,
      siteId: null,
      siteSlug: null,
      subscriptionPlanId: null,
      dealValueCents: null,
      interest: notes || null,
      notes: notes || null,
      outreach: [],
      nextActionAt: nextActionDate(computedPriority),
      consent: {
        marketingOptIn: Boolean(consent.marketingOptIn),
        popiaNoticeGiven: consent.popiaNoticeGiven !== false,
        optOut: false,
        optOutAt: null,
        source: consent.source || (url ? 'published business details' : 'provided by the lead'),
      },
      result: null,
      timeline: [{ at: nowIso(), event: 'CAPTURED', note: `${businessName} — ${status.label}, priority ${computedPriority}` }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('salesLeads', lead.leadId, lead);
    this.kernel.ledger.append({
      action: 'SALES_LEAD_CAPTURED',
      subject: lead.leadId,
      visibility: 'PRIVATE',
      payload: {
        summary: `${lead.businessName} (${lead.suburb || lead.metro || 'ZA'}) added to the sales desk — website status "${status.label}", priority ${lead.priority}: ${lead.priorityAction}`,
        priority: lead.priority,
        websiteStatus: status.id,
        consent: lead.consent.marketingOptIn ? 'marketing opt-in' : 'no marketing opt-in',
      },
    });
    return deepClone(lead);
  }

  #templateLabel(templateId) {
    try { return this.sites.template(templateId).label; } catch { return null; }
  }

  /* ================================================================== *
   * READ / UPDATE
   * ================================================================== */

  get(leadIdOrReference) {
    const lead = this.store.get('salesLeads', leadIdOrReference)
      || this.store.findOne('salesLeads', (l) => l.reference === leadIdOrReference);
    if (!lead) throw new Error(`lead ${leadIdOrReference} not found`);
    return lead;
  }

  list({ stage = null, priority = null, source = null, templateId = null, dueOnly = false, limit = 100 } = {}) {
    let rows = this.store.all('salesLeads');
    if (stage) rows = rows.filter((l) => l.stage === stage);
    if (priority) rows = rows.filter((l) => Number(l.priority) === Number(priority));
    if (source) rows = rows.filter((l) => l.source === source);
    if (templateId) rows = rows.filter((l) => l.templateId === templateId);
    if (dueOnly) rows = rows.filter((l) => l.nextActionAt && l.nextActionAt <= addDays(nowIso(), 1) && !['WON', 'LOST'].includes(l.stage));
    return rows
      .sort((a, b) => (b.priority - a.priority) || String(a.nextActionAt || '').localeCompare(String(b.nextActionAt || '')))
      .slice(0, limit)
      .map((l) => this.summary(l));
  }

  summary(lead) {
    return {
      leadId: lead.leadId,
      reference: lead.reference,
      businessName: lead.businessName,
      industry: lead.industry,
      stage: lead.stage,
      stageWeight: STAGE_WEIGHT[lead.stage],
      priority: lead.priority,
      priorityAction: lead.priorityAction,
      websiteStatus: lead.websiteStatusLabel,
      suburb: lead.suburb,
      metro: lead.metro,
      url: lead.url,
      healthScore: lead.diagnostic?.healthScore ?? null,
      recommendedPlanId: lead.diagnostic?.recommendedPlanId || lead.subscriptionPlanId || null,
      dealValueCents: lead.dealValueCents,
      siteSlug: lead.siteSlug,
      previewUrl: lead.siteSlug ? `/preview/${lead.siteSlug}` : null,
      touches: lead.outreach.length,
      lastTouchAt: lead.outreach.length ? lead.outreach[lead.outreach.length - 1].at : null,
      nextActionAt: lead.nextActionAt,
      optOut: lead.consent.optOut,
      updatedAt: lead.updatedAt,
    };
  }

  update(leadId, patch = {}, { actorId = 'sales-desk' } = {}) {
    const lead = this.get(leadId);
    const allowed = ['stage', 'priority', 'notes', 'interest', 'contactName', 'phone', 'email', 'url', 'websiteStatus', 'dealValueCents', 'subscriptionPlanId', 'result', 'owner', 'nextActionAt', 'industry', 'templateId'];
    const changes = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!changes.length) throw new Error('nothing to update — editable: ' + allowed.join(', '));

    for (const key of changes) lead[key] = patch[key];
    if (patch.stage) {
      lead.stage = patch.stage;
      if (patch.stage === LEAD_STAGE.WON) { lead.result = patch.result || 'WON'; lead.wonAt = nowIso(); }
      if (patch.stage === LEAD_STAGE.LOST) { lead.result = patch.result || 'LOST'; lead.lostAt = nowIso(); }
      lead.nextActionAt = ['WON', 'LOST'].includes(patch.stage) ? null : nextActionDate(lead.priority);
    }
    if (patch.priority) {
      lead.priority = Number(patch.priority);
      lead.priorityAction = (planData.priorityGuide.find((p) => p.priority === lead.priority) || {}).action || lead.priorityAction;
    }
    if (patch.websiteStatus) {
      const status = planData.websiteStatus.options.find((s) => s.id === patch.websiteStatus);
      if (!status) throw new Error(`unknown website status ${patch.websiteStatus}`);
      lead.websiteStatusLabel = status.label;
      lead.statusNote = status.note;
    }
    lead.updatedAt = nowIso();
    lead.timeline.push({ at: nowIso(), event: 'UPDATED', note: `${changes.join(', ')} changed by ${actorId}` });
    this.kernel.ledger.append({
      action: 'SALES_LEAD_UPDATED',
      subject: lead.leadId,
      visibility: 'PRIVATE',
      payload: { summary: `${lead.businessName}: ${changes.join(', ')} → ${JSON.stringify(changes.map((c) => lead[c]))}`, changes, actorId },
    });
    return deepClone(lead);
  }

  /* ================================================================== *
   * OUTREACH — logged, consent-checked
   * ================================================================== */

  logOutreach(leadId, { channel = 'WHATSAPP', template = null, note = null, scheduledFor = null, actorId = 'sales-desk' } = {}) {
    const lead = this.get(leadId);
    if (!OUTREACH_CHANNELS.includes(channel)) throw new Error(`channel must be one of ${OUTREACH_CHANNELS.join(', ')}`);

    const decision = this.kernel.policy.evaluate('lead', {
      subjectId: leadId,
      lead: { consent: lead.consent, stage: lead.stage, businessName: lead.businessName },
      outreach: { channel, at: scheduledFor || nowIso() },
    });
    const blocked = decision.firedRules.filter((r) => r.effect === 'BLOCK' || r.effect === 'REMOVE');
    if (blocked.length) {
      const error = new Error(blocked.map((r) => `[${r.ruleId}] ${r.reason}`).join(' · '));
      error.decision = decision;
      throw error;
    }
    const warnings = decision.firedRules.filter((r) => r.effect === 'WARN').map((r) => ({ ruleId: r.ruleId, reason: r.reason }));

    const rendered = template ? this.#renderTemplate(lead, template) : null;
    const touch = {
      outreachId: idFor('touch'),
      channel,
      template: template || null,
      message: rendered,
      note: note || null,
      at: scheduledFor || nowIso(),
      actorId,
      warnings,
      stageAfter: null,
    };
    lead.outreach.push(touch);
    if (!['WON', 'LOST'].includes(lead.stage) && lead.stage === LEAD_STAGE.NEW) lead.stage = LEAD_STAGE.CONTACTED;
    lead.lastTouchAt = touch.at;
    lead.nextActionAt = followUpDate(lead.priority, touch.at);
    lead.updatedAt = nowIso();
    lead.timeline.push({ at: touch.at, event: 'OUTREACH', note: `${channel}${template ? ` (${template})` : ''}${note ? ` — ${note}` : ''}` });

    this.store.put('leadTouches', touch.outreachId, { ...touch, leadId: lead.leadId, businessName: lead.businessName });
    this.kernel.ledger.append({
      action: 'SALES_OUTREACH_LOGGED',
      subject: lead.leadId,
      visibility: 'PRIVATE',
      payload: {
        summary: `${lead.businessName}: ${channel} outreach logged${warnings.length ? ` with warning ${warnings.map((w) => w.ruleId).join(', ')}` : ''}. Consent: ${lead.consent.marketingOptIn ? 'marketing opt-in' : 'transactional only'}.`,
        channel,
        warnings,
      },
    });
    return { touch: deepClone(touch), lead: this.summary(lead), warnings };
  }

  /** POPIA: a lead can stop being contacted, and it is enforced, not noted. */
  optOut(leadId, { reason = null, requestedVia = 'phone' } = {}) {
    const lead = this.get(leadId);
    lead.consent.optOut = true;
    lead.consent.optOutAt = nowIso();
    lead.consent.optOutReason = reason || null;
    lead.consent.optOutVia = requestedVia;
    if (lead.stage !== LEAD_STAGE.WON) {
      lead.stage = LEAD_STAGE.LOST;
      lead.result = 'OPT_OUT';
    }
    lead.nextActionAt = null;
    lead.updatedAt = nowIso();
    lead.timeline.push({ at: nowIso(), event: 'OPT_OUT', note: `POPIA objection recorded via ${requestedVia}${reason ? `: ${reason}` : ''}` });
    this.kernel.ledger.append({
      action: 'POPIA_OPT_OUT_RECORDED',
      subject: lead.leadId,
      level: 'TRUST',
      visibility: 'PUBLIC',
      payload: {
        summary: `${lead.businessName} objected to further contact. Recorded as a hash-chained POPIA entry; policy LEAD-001 now blocks every outreach channel for this lead.`,
        reason: reason || null,
        requestedVia,
      },
    });
    return deepClone(lead);
  }

  #renderTemplate(lead, template) {
    if (template === 'COLD_EMAIL') {
      const gap = gapPhrase(lead);
      let body = planData.pitch.coldEmail.body
        .replace('{contactName}', lead.contactName || 'there')
        .replace('{businessName}', lead.businessName)
        .replace('{suburb}', lead.suburb || lead.metro || 'South African')
        .replace('{specificGap}', gap)
        .replace('{agentName}', lead.owner || 'the ProVeri sales desk')
        .replace('{agentMobile}', '+27 72 140 3821');
      // Same honesty rule as the WhatsApp message: do not claim a mockup exists
      // before buildDemo has actually produced one.
      if (!lead.siteSlug) body = body.replace('I went ahead and built a free, working mockup', 'I can build a free, working mockup');
      return {
        subject: planData.pitch.coldEmail.subject.replace('{businessName}', lead.businessName),
        // Collapse doubled punctuation and stray spaces, but never the blank
        // lines that make the email readable.
        body: body.replace(/\.\s*\./g, '.').replace(/[ \t]{2,}/g, ' '),
      };
    }
    if (template === 'WHATSAPP') {
      let message = planData.pitch.whatsappMessage
        .replace('{contactName}', lead.contactName || 'there')
        .replace('{agentName}', lead.owner || 'ProVeri')
        .replace('{metro}', lead.metro || 'your area')
        .replace('{businessName}', lead.businessName);
      // Never claim a preview exists before buildDemo has run — the whole
      // pitch is that we show rather than tell, so the wording follows the fact.
      if (!lead.siteSlug) message = message.replace('I built a free working preview', 'I can build a free working preview');
      return message;
    }
    return null;
  }

  /* ================================================================== *
   * DIAGNOSE — the free scan, now driving the pitch
   * ================================================================== */

  /**
   * Run the free website rescue diagnostic against the lead's current site and
   * let the result pick the website status, the priority, and the plan worth
   * pitching. If the score is healthy we say so and stop selling — the honest
   * boundary the reference playbook is built on.
   */
  async diagnose(leadId, { url = null } = {}) {
    const lead = this.get(leadId);
    const target = url || lead.url;
    if (!target) {
      lead.websiteStatus = 'NO_WEBSITE';
      lead.websiteStatusLabel = 'No website';
      lead.priority = 5;
      lead.priorityAction = 'Walk in this week';
      lead.diagnostic = {
        healthScore: 0,
        grade: 'F',
        reachable: false,
        reason: 'No website found — the whole channel is missing, which makes this the highest-value lead there is.',
        recommendedPlanId: 'business-growth',
        primaryGap: 'has no website at all, so a customer searching tonight cannot find it',
      };
      lead.stage = LEAD_STAGE.DIAGNOSED;
      lead.updatedAt = nowIso();
      return this.#diagnosticPayload(lead);
    }

    const diagnostic = await this.webStudio.rescueDiagnostic({
      url: target,
      contact: { businessName: lead.businessName, email: lead.email, mobile: lead.phone, suburb: lead.suburb },
    });
    const failed = diagnostic.findings.filter((f) => !f.passed);

    // Honesty rule: if the scan could not actually reach the network we do not
    // overwrite what the salesperson observed in the field with a simulated
    // "site is down". We record the simulated scan and keep the research.
    if (diagnostic.simulated) {
      const plan = planFromStatus(lead.websiteStatus);
      lead.diagnostic = {
        diagnosticId: diagnostic.diagnosticId,
        reference: diagnostic.reference,
        simulated: true,
        integrationMode: diagnostic.integrationMode,
        simulationNote: diagnostic.simulationNote,
        healthScore: null,
        grade: null,
        reachable: null,
        checksRun: diagnostic.findings.length,
        failedChecks: [],
        primaryGap: `${lead.businessName}: ${lead.statusNote}`,
        recommendedPlanId: plan.planId,
        recommendedPlanName: plan.name,
        dealValueCents: plan.priceCents,
        ranAt: diagnostic.ranAt,
        honestBoundary: 'The scan is simulated because network integrations are off. We are not going to tell a business their site is down because our sandbox had no internet.',
      };
      lead.subscriptionPlanId = plan.planId;
      lead.dealValueCents = plan.priceCents;
      lead.stage = LEAD_STAGE.RESEARCHED;
      lead.updatedAt = nowIso();
      lead.timeline.push({ at: nowIso(), event: 'DIAGNOSTIC_SIMULATED', note: `Network integrations offline — kept the field research (${lead.websiteStatusLabel}) and recommend ${plan.name}` });
      this.kernel.ledger.append({
        action: 'SALES_LEAD_DIAGNOSTIC_SIMULATED',
        subject: lead.leadId,
        visibility: 'PRIVATE',
        payload: { summary: `${lead.businessName}: diagnostic skipped (integrations offline). Field research kept: ${lead.websiteStatusLabel}; recommended plan ${plan.name}.`, simulated: true },
      });
      return this.#diagnosticPayload(lead);
    }

    const status = statusFromFindings(diagnostic, failed);
    const plan = planFromScore(diagnostic.healthScore, status);

    lead.diagnostic = {
      diagnosticId: diagnostic.diagnosticId,
      reference: diagnostic.reference,
      healthScore: diagnostic.healthScore,
      grade: diagnostic.grade,
      reachable: diagnostic.reachable,
      responseMs: diagnostic.responseMs,
      sizeKb: diagnostic.sizeKb,
      failedChecks: failed.map((f) => ({ label: f.label, fix: f.fix, impact: f.impact })),
      passedChecks: diagnostic.findings.filter((f) => f.passed).map((f) => f.label),
      primaryGap: failed.length ? `${lead.businessName}'s site ${failed[0].label.toLowerCase()} — ${failed[0].fix.toLowerCase()}` : 'nothing material; do not sell a rebuild',
      verdict: diagnostic.verdict,
      recommendedPlanId: plan.planId,
      recommendedPlanName: plan.name,
      dealValueCents: plan.priceCents,
      seal: diagnostic.seal,
      ranAt: diagnostic.ranAt,
      honestBoundary: diagnostic.honestBoundary,
    };
    lead.websiteStatus = status.id;
    lead.websiteStatusLabel = status.label;
    lead.statusNote = status.note;
    lead.priority = status.priority;
    lead.priorityAction = (planData.priorityGuide.find((p) => p.priority === status.priority) || {}).action;
    lead.dealValueCents = plan.priceCents;
    lead.subscriptionPlanId = plan.planId;
    lead.stage = LEAD_STAGE.DIAGNOSED;
    lead.nextActionAt = nextActionDate(lead.priority);
    lead.updatedAt = nowIso();
    lead.timeline.push({ at: nowIso(), event: 'DIAGNOSED', note: `${diagnostic.healthScore}/100 (grade ${diagnostic.grade}) → ${status.label}, pitch ${plan.name}` });

    this.kernel.ledger.append({
      action: 'SALES_LEAD_DIAGNOSED',
      subject: lead.leadId,
      visibility: 'PRIVATE',
      payload: {
        summary: `${lead.businessName}: ${target} scored ${diagnostic.healthScore}/100 (grade ${diagnostic.grade}) — ${failed.length} failed check(s), recommended plan ${plan.name}`,
        healthScore: diagnostic.healthScore,
        grade: diagnostic.grade,
        seal: diagnostic.seal.slice(0, 16),
      },
    });
    return this.#diagnosticPayload(lead);
  }

  #diagnosticPayload(lead) {
    return deepClone({
      leadId: lead.leadId,
      businessName: lead.businessName,
      websiteStatus: lead.websiteStatusLabel,
      priority: lead.priority,
      priorityAction: lead.priorityAction,
      diagnostic: lead.diagnostic,
      stage: lead.stage,
      nextActionAt: lead.nextActionAt,
    });
  }

  /* ================================================================== *
   * BUILD THE DEMO BEFORE THE MEETING
   * ================================================================== */

  /**
   * The "show, don't tell" beat from the pitch script, as a function: scaffold
   * a real preview site for the lead so the salesperson walks in with the
   * business's own brand on screen — and unlike the reference demos, the
   * booking form on it works.
   */
  buildDemo(leadId, { templateId = null, businessName = null, contact = null, planId = null, useSampleContent = true } = {}) {
    const lead = this.get(leadId);
    const chosenPlan = planId || lead.subscriptionPlanId || lead.diagnostic?.recommendedPlanId || 'essential';
    const site = this.sites.scaffold({
      templateId: templateId || lead.templateId || guessTemplate(lead.industry, businessName || lead.businessName),
      businessName: businessName || lead.businessName,
      contact: contact || { phone: lead.phone, email: lead.email, suburb: lead.suburb },
      suburbName: lead.suburb,
      planId: chosenPlan,
      leadId: lead.leadId,
      useSampleContent,
    });
    this.sites.preview(site.siteId);
    const previewed = this.sites.get(site.siteId);

    lead.siteId = site.siteId;
    lead.siteSlug = site.slug;
    const buildableStages = [LEAD_STAGE.NEW, LEAD_STAGE.RESEARCHED, LEAD_STAGE.DIAGNOSED, LEAD_STAGE.CONTACTED];
    lead.stage = buildableStages.includes(lead.stage) ? LEAD_STAGE.DEMO_BUILT : lead.stage;
    lead.subscriptionPlanId = chosenPlan;
    lead.dealValueCents = lead.dealValueCents || this.sites.plan(chosenPlan).priceCents;
    lead.nextActionAt = nextActionDate(lead.priority);
    lead.updatedAt = nowIso();
    lead.timeline.push({ at: nowIso(), event: 'DEMO_BUILT', note: `Preview site ${site.urls.preview} built from the ${site.industry} template` });

    this.kernel.ledger.append({
      action: 'SALES_DEMO_BUILT',
      subject: lead.leadId,
      visibility: 'PRIVATE',
      payload: {
        summary: `${lead.businessName}: unlisted preview site built at ${site.urls.preview} for the pitch — R0 charged, booking form live in preview mode`,
        siteId: site.siteId,
        templateId: site.templateId,
      },
    });
    return {
      lead: this.summary(lead),
      site: this.sites.summary(previewed),
      siteId: site.siteId,
      slug: site.slug,
      previewUrl: previewed.urls.preview,
      publicUrl: previewed.urls.live,
      planId: chosenPlan,
      planName: this.sites.plan(chosenPlan).name,
      priceCents: this.sites.plan(chosenPlan).priceCents,
      pitchKit: this.pitchKit(lead.leadId),
    };
  }

  /* ================================================================== *
   * PITCH KIT
   * ================================================================== */

  /**
   * One call returns everything the salesperson needs at the door: the timing
   * window, the 60-second script with this lead's numbers substituted, the
   * objection answers, the recommended plan with the reason, and the preview
   * link to hand over the phone.
   */
  pitchKit(leadId, { agentName = null } = {}) {
    const lead = this.get(leadId);
    const plan = this.sites.plan(lead.subscriptionPlanId || (lead.diagnostic?.recommendedPlanId ?? 'business-growth'));
    const essential = this.sites.plan('essential');
    const growth = this.sites.plan('business-growth');
    const template = lead.templateId ? this.sites.template(lead.templateId) : null;
    const name = agentName || lead.owner || 'the ProVeri sales desk';

    // A beat that has a `lineWithoutDemo` variant is spoken differently until
    // buildDemo has actually produced a preview: we never claim to be holding a
    // finished site we have not built.
    const script = planData.pitch.script.map((beat) => {
      const raw = !lead.siteSlug && beat.lineWithoutDemo ? beat.lineWithoutDemo : beat.line;
      const line = raw
        .replace('{agentName}', name)
        .replace('{bookingLabel}', template ? template.booking.label : 'Book now')
        .replace('{essentialPrice}', String(essential.priceCents / 100))
        .replace('{growthPrice}', String(growth.priceCents / 100))
        .replace('{businessName}', lead.businessName);
      // Only the substituted line leaves the service — the unused variant stays
      // in the data file, never in a kit a salesperson reads aloud.
      return beat.stageDirection ? { beat: beat.beat, line, stageDirection: true } : { beat: beat.beat, line };
    });

    return {
      leadId: lead.leadId,
      reference: lead.reference,
      businessName: lead.businessName,
      industry: lead.industry,
      agentName: name,
      timing: {
        bestWindow: planData.pitch.bestWindowLabel,
        bestWindowHours: planData.pitch.bestWindowHours,
        avoid: planData.pitch.avoid,
        priorityAction: lead.priorityAction,
        nextActionAt: lead.nextActionAt,
      },
      opening: {
        websiteStatus: lead.websiteStatusLabel,
        statusNote: lead.statusNote,
        healthScore: lead.diagnostic?.healthScore ?? null,
        grade: lead.diagnostic?.grade ?? null,
        specificGap: subjectPhrase(lead),
        failedChecks: lead.diagnostic?.failedChecks?.slice(0, 3) || [],
      },
      script,
      objections: planData.pitch.objections,
      recommendation: {
        planId: plan.id,
        planName: plan.name,
        priceCents: plan.priceCents,
        priceDisplay: `R${(plan.priceCents / 100).toLocaleString('en-ZA')}/month`,
        buildCostCents: plan.setupCents,
        buildCostDisplay: plan.setupCents === 0 ? 'R0 to build' : `R${(plan.setupCents / 100).toLocaleString('en-ZA')} setup`,
        updatesIncluded: plan.updateCreditsPerMonth === -1 ? 'unlimited updates' : `${plan.updateCreditsPerMonth} updates a month`,
        why: lead.diagnostic
          ? `Their site scored ${lead.diagnostic.healthScore}/100. ${lead.diagnostic.verdict}`
          : `No website at all — ${plan.name} gets them booking online within ${plan.deliveryDays} days for R0 upfront.`,
        honestBoundary: plan.honestBoundary,
        proveriUpgrade: plan.proveriUpgrade,
        anchorStrategy: planData.positioning.strategy,
        oneLiner: planData.positioning.oneLiner,
      },
      showThem: {
        previewUrl: lead.siteSlug ? `/preview/${lead.siteSlug}` : null,
        note: lead.siteSlug
          ? 'Hand them the phone and let them scroll. Then tap the booking button — it creates a real booking with a reference number, which is the whole difference.'
          : 'No preview built yet. Call buildDemo first — the pitch is show, don’t tell.',
        bookingIsLive: Boolean(lead.siteSlug),
      },
      coldEmail: this.#renderTemplate(lead, 'COLD_EMAIL'),
      whatsapp: this.#renderTemplate(lead, 'WHATSAPP'),
      // The two things a salesperson must not forget at the door: whose
      // permission we need for every image, and how generated images get made
      // (and labelled) when the business has none worth using.
      permissions: planData.permissions,
      aiImages: planData.aiImages,
      consent: lead.consent,
      closingQuestion: script[script.length - 1].line,
      generatedAt: nowIso(),
      seal: sha256({ leadId: lead.leadId, planId: plan.id, stage: lead.stage, at: nowIso() }).slice(0, 16),
    };
  }

  /* ================================================================== *
   * CONVERT
   * ================================================================== */

  /**
   * Win the lead: build (or reuse) their site, start the subscription with the
   * first month in escrow, and record the win against the pipeline.
   */
  convert(leadId, { planId = null, templateId = null, paymentProvider = 'paystack', reference = null, customerId = null } = {}) {
    const lead = this.get(leadId);
    const chosenPlan = planId || lead.subscriptionPlanId || 'business-growth';

    let site = lead.siteId ? this.sites.get(lead.siteId) : null;
    if (!site) {
      site = this.sites.scaffold({
        templateId: templateId || lead.templateId || guessTemplate(lead.industry, lead.businessName),
        businessName: lead.businessName,
        contact: { phone: lead.phone, email: lead.email, suburb: lead.suburb },
        suburbName: lead.suburb,
        planId: chosenPlan,
        leadId: lead.leadId,
      });
      lead.siteId = site.siteId;
      lead.siteSlug = site.slug;
    }
    if (site.plan.planId !== chosenPlan) {
      site.plan.planId = chosenPlan;
      site.plan.planName = this.sites.plan(chosenPlan).name;
      site.plan.monthlyCents = this.sites.plan(chosenPlan).priceCents;
      site.plan.updateCreditsTotal = this.sites.plan(chosenPlan).updateCreditsPerMonth;
      site.plan.extraUpdateCents = this.sites.plan(chosenPlan).extraUpdateCents;
    }

    const { subscription } = this.sites.subscribe(site.siteId, { planId: chosenPlan, paymentProvider, reference, customerId });

    lead.stage = LEAD_STAGE.WON;
    lead.result = 'WON';
    lead.wonAt = nowIso();
    lead.subscriptionPlanId = chosenPlan;
    lead.dealValueCents = this.sites.plan(chosenPlan).priceCents;
    lead.nextActionAt = addDays(nowIso(), 30);
    lead.updatedAt = nowIso();
    lead.timeline.push({ at: nowIso(), event: 'WON', note: `${this.sites.plan(chosenPlan).name} subscription started, first month in escrow` });

    this.kernel.ledger.append({
      action: 'SALES_LEAD_WON',
      subject: lead.leadId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: {
        summary: `${lead.businessName} won: ${this.sites.plan(chosenPlan).name} at R${(this.sites.plan(chosenPlan).priceCents / 100).toLocaleString('en-ZA')}/month, R0 build cost, first month held in escrow until the site is live. ${lead.outreach.length} outreach touch(es) over ${daysBetween(lead.createdAt, nowIso())} day(s).`,
        planId: chosenPlan,
        touches: lead.outreach.length,
        cycleDays: daysBetween(lead.createdAt, nowIso()),
        siteId: site.siteId,
      },
    });
    return { lead: deepClone(lead), site: this.sites.summary(site), subscription: deepClone(subscription) };
  }

  lose(leadId, { reason = 'not interested', stage = LEAD_STAGE.LOST } = {}) {
    const lead = this.update(leadId, { stage, result: 'LOST' });
    lead.timeline.push({ at: nowIso(), event: 'LOST', note: reason });
    this.kernel.ledger.append({
      action: 'SALES_LEAD_LOST',
      subject: lead.leadId,
      visibility: 'PRIVATE',
      payload: { summary: `${lead.businessName} lost: ${reason}`, reason },
    });
    return deepClone(lead);
  }

  /* ================================================================== *
   * PIPELINE
   * ================================================================== */

  /** What the sales desk should do next, in order. */
  nextBestActions({ limit = 10 } = {}) {
    const now = nowIso();
    const open = this.store.all('salesLeads').filter((l) => !['WON', 'LOST'].includes(l.stage));
    return open
      .map((lead) => {
        const overdue = lead.nextActionAt && lead.nextActionAt <= now;
        const action = overdue
          ? (lead.diagnostic ? 'Follow up with the diagnostic result' : 'Make first contact')
          : lead.stage === LEAD_STAGE.NEW ? 'Research and diagnose'
          : [LEAD_STAGE.DIAGNOSED, LEAD_STAGE.RESEARCHED].includes(lead.stage) ? 'Build the preview demo'
          : lead.stage === LEAD_STAGE.DEMO_BUILT ? `Walk in during ${planData.pitch.bestWindowLabel}`
          : lead.stage === LEAD_STAGE.CONTACTED ? 'Send the preview link'
          : lead.stage === LEAD_STAGE.PREVIEW_SENT ? 'Ask for the decision'
          : 'Keep the conversation warm';
        return {
          leadId: lead.leadId,
          businessName: lead.businessName,
          suburb: lead.suburb,
          priority: lead.priority,
          stage: lead.stage,
          overdue: Boolean(overdue),
          nextActionAt: lead.nextActionAt,
          action,
          planToPitch: lead.subscriptionPlanId || (lead.diagnostic?.recommendedPlanId ?? 'business-growth'),
          valueCents: lead.dealValueCents || this.sites.plan(lead.subscriptionPlanId || 'business-growth').priceCents,
          optOut: lead.consent.optOut,
        };
      })
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.priority - a.priority || String(a.nextActionAt || '').localeCompare(String(b.nextActionAt || '')))
      .slice(0, limit);
  }

  /**
   * What a lead is worth before it is won. Until a plan is chosen we price the
   * pipeline at the plan the diagnostic recommends — otherwise a freshly
   * captured lead reads as R0 and the pipeline report is worthless.
   */
  #leadValueCents(lead) {
    if (lead.dealValueCents) return lead.dealValueCents;
    const planId = lead.subscriptionPlanId || lead.diagnostic?.recommendedPlanId || 'business-growth';
    return this.sites.plan(planId).priceCents;
  }

  stats() {
    const leads = this.store.all('salesLeads');
    const byStage = leads.reduce((acc, l) => { acc[l.stage] = (acc[l.stage] || 0) + 1; return acc; }, {});
    const won = leads.filter((l) => l.stage === LEAD_STAGE.WON);
    const lost = leads.filter((l) => l.stage === LEAD_STAGE.LOST);
    const open = leads.filter((l) => !['WON', 'LOST'].includes(l.stage));
    const touches = leads.reduce((n, l) => n + l.outreach.length, 0);
    const mrrCents = won.reduce((n, l) => n + (l.dealValueCents || 0), 0);
    const cycles = won.filter((l) => l.wonAt).map((l) => daysBetween(l.createdAt, l.wonAt));

    return {
      leads: leads.length,
      open: open.length,
      won: won.length,
      lost: lost.length,
      optOuts: leads.filter((l) => l.consent.optOut).length,
      byStage,
      byPriority: leads.reduce((acc, l) => { acc[l.priority] = (acc[l.priority] || 0) + 1; return acc; }, {}),
      byWebsiteStatus: leads.reduce((acc, l) => { acc[l.websiteStatusLabel] = (acc[l.websiteStatusLabel] || 0) + 1; return acc; }, {}),
      conversionRate: leads.length ? Number(((won.length / leads.length) * 100).toFixed(1)) : 0,
      weightedPipelineCents: Math.round(open.reduce((n, l) => n + this.#leadValueCents(l) * (STAGE_WEIGHT[l.stage] || 0), 0)),
      openPipelineCents: open.reduce((n, l) => n + this.#leadValueCents(l), 0),
      monthlyRecurringCents: mrrCents,
      annualisedRecurringCents: mrrCents * 12,
      averageCycleDays: cycles.length ? Number((cycles.reduce((a, b) => a + b, 0) / cycles.length).toFixed(1)) : null,
      outreachTouches: touches,
      touchesPerLead: leads.length ? Number((touches / leads.length).toFixed(1)) : 0,
      overdueFollowUps: open.filter((l) => l.nextActionAt && l.nextActionAt <= nowIso()).length,
      diagnosticsRun: leads.filter((l) => l.diagnostic).length,
      demosBuilt: leads.filter((l) => l.siteId).length,
      warmLeadsFromBookings: leads.filter((l) => l.source === 'WEBSITE_BOOKING').length,
    };
  }
}

/* ==================================================================== *
 * Pure helpers
 * ==================================================================== */

function priorityFromStatus(severity, { url, industry } = {}) {
  let priority = severity;
  if (!url) priority = Math.min(5, priority + 1);
  if (/restaurant|cafe|salon|guesthouse|tour|transport/i.test(String(industry || ''))) priority = Math.min(5, priority);
  return Math.max(1, Math.min(5, priority));
}

function statusFromFindings(diagnostic, failed) {
  if (!diagnostic.reachable) return { ...planData.websiteStatus.options.find((s) => s.id === 'BROKEN'), priority: 5 };
  const labels = failed.map((f) => f.label.toLowerCase());
  const mobileBroken = labels.some((l) => l.includes('viewport'));
  const slow = labels.some((l) => l.includes('3 seconds') || l.includes('page weight'));
  const noCta = labels.some((l) => l.includes('call to action'));
  const noSeo = labels.some((l) => l.includes('title and meta'));

  if (mobileBroken) return { ...planData.websiteStatus.options.find((s) => s.id === 'SLOW_ON_MOBILE'), priority: 5 };
  if (diagnostic.healthScore >= 70 && !failed.length) return { ...planData.websiteStatus.options.find((s) => s.id === 'HEALTHY'), priority: 1 };
  if (noCta && noSeo) return { ...planData.websiteStatus.options.find((s) => s.id === 'MINIMAL'), priority: 4 };
  if (slow) return { ...planData.websiteStatus.options.find((s) => s.id === 'SLOW_ON_MOBILE'), priority: 4 };
  if (diagnostic.healthScore < 45) return { ...planData.websiteStatus.options.find((s) => s.id === 'OUTDATED'), priority: 4 };
  return { ...planData.websiteStatus.options.find((s) => s.id === 'GENERIC_TEMPLATE'), priority: 3 };
}

function planFromStatus(statusId) {
  const heavy = ['NO_WEBSITE', 'BROKEN', 'SLOW_ON_MOBILE', 'OUTDATED'];
  const plan = planData.plans.find((p) => p.id === (heavy.includes(statusId) ? 'business-growth' : 'essential'));
  return { planId: plan.id, name: plan.name, priceCents: plan.priceCents };
}

function planFromScore(score, status) {
  const id = status.id === 'HEALTHY' ? 'essential' : score < 70 ? 'business-growth' : 'essential';
  const plan = planData.plans.find((p) => p.id === id);
  return { planId: plan.id, name: plan.name, priceCents: plan.priceCents };
}

/**
 * The phrase that slots into "I looked at {businessName} online and …".
 * A real scan gives us a measured gap and we quote it. Otherwise we use the
 * wording written for that website status — never a pasted status label,
 * because that is how a cold email ends up unreadable.
 */
function gapPhrase(lead) {
  const fallback = 'does not do your business justice';
  const option = planData.websiteStatus.options.find((o) => o.id === lead.websiteStatus) || null;
  if (lead.diagnostic && !lead.diagnostic.simulated && lead.diagnostic.primaryGap) return firstSentence(lead.diagnostic.primaryGap);
  if (option?.pitchPhrase) return option.pitchPhrase;
  return firstSentence(option?.note || lead.statusNote) || fallback;
}

/**
 * A standalone sentence about the lead's website, for the pitch kit opening.
 * Field notes and diagnostic gaps are written for a CRM row ("Nails on Main:
 * Looks like 2012"), which reads badly aloud, so the subject is rebuilt here.
 */
function subjectPhrase(lead) {
  const option = planData.websiteStatus.options.find((o) => o.id === lead.websiteStatus) || null;

  // A real scan measured something: quote it, minus the CRM's "Business:" prefix.
  if (lead.diagnostic && !lead.diagnostic.simulated && lead.diagnostic.primaryGap) {
    return sentence(stripLeadName(lead.diagnostic.primaryGap, lead.businessName));
  }
  // Otherwise use the wording written for this status — the same phrase the cold
  // email uses, capitalised, so one source of copy serves both.
  if (option?.pitchPhrase) return sentence(option.pitchPhrase);
  return sentence(stripLeadName(lead.statusNote || '', lead.businessName));
}

function stripLeadName(text, businessName) {
  let phrase = String(text || '').trim();
  if (businessName && phrase.toLowerCase().startsWith(businessName.toLowerCase())) {
    phrase = phrase.slice(businessName.length).replace(/^('s)?\s*[:—-]?\s*/, '');
  }
  return phrase;
}

/** Turn a status phrase into a standalone sentence with a subject. */
function sentence(raw) {
  const phrase = String(raw || '').trim();
  if (!phrase) return 'Their website does not do the business justice.';
  const lower = phrase.charAt(0).toLowerCase() + phrase.slice(1);
  let out = lower;
  if (/^(site|website|menu|page|pages|booking|bookings|photos?|prices?|price list|content|design|theme|gallery|hours?)\b/.test(lower)) out = `their ${lower}`;
  else if (/^(works|looks|seems|feels|has|have|is|are|was|were|loads|still|barely|uses|shows|says|does|ranks|scores|needs?)\b/.test(lower)) out = `it ${lower}`;
  else if (/^(only|just|mostly|currently)\b/.test(lower)) out = `they are ${lower}`;
  else if (/^(no|not|never|nothing)\b/.test(lower)) out = `there is ${lower}`;
  return out.charAt(0).toUpperCase() + out.slice(1).replace(/\.$/, '') + '.';
}

function firstSentence(text) {
  const first = String(text || '').trim().split(/\.(?=\s|$)/)[0].replace(/\.$/, '').trim();
  return first ? first.charAt(0).toLowerCase() + first.slice(1) : '';
}

function guessTemplate(industry, businessName) {
  const text = `${industry || ''} ${businessName || ''}`.toLowerCase();
  const rules = [
    [/plumb|electric|solar|paint|handy|clean|roof|security|garden|build|mechanic|tiler|welder|aircon|pest/, 'trade-services'],
    [/restaurant|eatery|bistro|steak|grill|kitchen|dining|food|pizza|sushi/, 'restaurant'],
    [/cafe|coffee|bakery|deli|cake|pastry|roastery/, 'cafe-bakery'],
    [/guesthouse|b&b|bnb|lodge|hotel|self-catering|accommodation|backpacker/, 'accommodation'],
    [/wine|cellar|estate|vineyard|tasting|brewery|distillery/, 'wine-estate'],
    [/fashion|boutique|clothing|apparel|design|craft|retail|store|shop|threads/, 'fashion-retail'],
    [/transport|transfer|shuttle|chauffeur|tour(?:ing)?\s*transport|logistics|coach|taxi/, 'transport-transfers'],
    [/tour|travel|safari|adventure|trip|guide/, 'tours-travel'],
    [/beauty|salon|spa|nail|hair|barber|massage|wellness|fitness|gym|yoga|train(?:er|ing)/, 'beauty-wellness'],
    [/account|attorney|law|legal|consult|it |software|tutor|coach|financial|architect|engineer/, 'professional-services'],
  ];
  for (const [pattern, templateId] of rules) if (pattern.test(text)) return templateId;
  return 'professional-services';
}

function nextActionDate(priority) {
  const days = { 5: 1, 4: 3, 3: 10, 2: 30, 1: 90 }[Number(priority)] ?? 7;
  return addDays(nowIso(), days);
}

function followUpDate(priority, from) {
  const days = { 5: 2, 4: 5, 3: 14, 2: 45, 1: 90 }[Number(priority)] ?? 7;
  return addDays(from, days);
}

function daysBetween(fromIso, toIso) {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

module.exports = { SalesDeskService, LEAD_STAGE, STAGE_WEIGHT, OUTREACH_CHANNELS, guessTemplate, statusFromFindings, planFromScore, planFromStatus };
