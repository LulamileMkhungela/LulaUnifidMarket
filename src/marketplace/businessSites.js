'use strict';

/**
 * ProVeri — Business Site Studio.
 *
 * This is the MyServicePro "get a website" business, rebuilt so that it is not
 * a mock-up. The reference implementation it is benchmarked against
 * (github.com/Albert-Machuene-Dev/MyServicePro_Demos) generates React demo
 * sites per business from one JSON content model — a real, working pipeline
 * with a scaffolder, a theme layer, industry content, and a deploy script that
 * publishes every site to GitHub Pages.
 *
 * ProVeri keeps that whole pipeline and changes the two things that make a demo
 * a demo:
 *
 *   1. **The buttons work.** A booking on a MyServicePro demo shows the toast
 *      "This is a demo — booking not active yet". On a ProVeri site the same
 *      tap creates a reservation with a reference number, or — when the site is
 *      linked to a verified pro — posts a real job into the marketplace, so the
 *      visitor's money can be held in escrow and the pro is paid on proof of
 *      work. Website → lead → job → escrow → review is one loop.
 *
 *   2. **The compliance is enforced, not documented.** The reference keeps a
 *      PERMISSION.md checklist per restaurant. ProVeri stores the same
 *      permission and POPIA consent as hash-chained ledger records, and policy
 *      WEB-002 refuses to publish a site whose assets have no permission
 *      record. Update allowances from the monthly plans are metered by policy
 *      WEB-001 rather than by memory.
 *
 * Everything here is zero-dependency and server-rendered: CSS-only tabs and
 * lightboxes, so a generated site is readable on a R900 Android on 3G with
 * JavaScript switched off — and the booking form degrades to WhatsApp.
 */

const path = require('node:path');
const fs = require('node:fs');
const { idFor, nowIso, sha256, deepClone, addDays } = require('../kernel/util');

const templateData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'webstudio-templates.json'), 'utf8'));
const planData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'webstudio-plans.json'), 'utf8'));

const SITE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PREVIEW: 'PREVIEW',
  BLOCKED: 'BLOCKED',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
});

const BOOKING_STATUS = Object.freeze({
  NEW: 'NEW',
  CONFIRMED: 'CONFIRMED',
  DECLINED: 'DECLINED',
  COMPLETED: 'COMPLETED',
  CONVERTED_TO_JOB: 'CONVERTED_TO_JOB',
  CANCELLED: 'CANCELLED',
});

const SUBSCRIPTION_STATUS = Object.freeze({
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
});

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function slugify(name) {
  return String(name || '')
    // Accents fold down rather than vanish: a Cape Town "Café" must not become
    // a URL with a hole in it, and Afrikaans/Xhosa place names keep their shape.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'site';
}

function titleCase(str) {
  return String(str || '').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

class BusinessSiteStudio {
  constructor({ store, kernel, catalog, people, jobs }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.people = people;
    this.jobs = jobs;
  }

  /* ================================================================== *
   * CATALOGUE — templates and plans
   * ================================================================== */

  templates() {
    return templateData.templates.map((t) => ({
      id: t.id,
      label: t.label,
      icon: t.icon,
      audience: t.audience,
      blurb: t.blurb,
      catalogueLabel: t.catalogueLabel,
      itemNoun: t.itemNoun,
      sections: t.sections,
      bookingLabel: t.booking.label,
      bookingIntake: t.booking.intake,
      bookingFields: t.booking.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, required: f.required })),
      themePresets: t.themePresets,
      proNative: Boolean(t.proNative),
      vehicleBridge: Boolean(t.vehicleBridge),
      sampleCategories: t.sample.catalogue.map((c) => c.name),
      growthHooks: t.growthHooks,
    }));
  }

  template(templateId) {
    const found = templateData.templates.find((t) => t.id === templateId);
    if (!found) throw new Error(`unknown site template: ${templateId}. Available: ${templateData.templates.map((t) => t.id).join(', ')}`);
    return found;
  }

  plans() {
    return planData.plans.map((p) => ({
      ...p,
      priceDisplay: `R${(p.priceCents / 100).toLocaleString('en-ZA')}/month`,
      setupDisplay: p.setupCents === 0 ? 'R0 to build' : `R${(p.setupCents / 100).toLocaleString('en-ZA')} setup`,
      updatesDisplay: p.updateCreditsPerMonth === -1 ? 'unlimited updates' : `${p.updateCreditsPerMonth} updates/month`,
    }));
  }

  plan(planId) {
    const found = planData.plans.find((p) => p.id === planId);
    if (!found) throw new Error(`unknown plan: ${planId}. Available: ${planData.plans.map((p) => p.id).join(', ')}`);
    return found;
  }

  playbook() {
    return {
      promise: planData.promise,
      positioning: planData.positioning,
      comparison: planData.planIncludesComparison,
      websiteStatus: planData.websiteStatus.options,
      priorityGuide: planData.priorityGuide,
      pitch: planData.pitch,
      permissions: planData.permissions,
      aiImages: planData.aiImages,
      deployment: planData.deployment,
      sectionKinds: templateData.sectionKinds,
      bookingIntake: templateData.bookingIntake,
    };
  }

  /* ================================================================== *
   * SCAFFOLD — the equivalent of scripts/create-restaurant.js
   * ================================================================== */

  /**
   * Create a full site from a template in one call. Sample content is copied in
   * so the preview is immediately worth showing — the same reason the reference
   * implementation ships every demo with a populated restaurant.json.
   */
  scaffold({
    templateId, businessName, tagline = null, description = null, contact = {}, suburbId = null, suburbName = null,
    themeId = null, planId = 'essential', proId = null, leadId = null, useSampleContent = true, heroImage = null,
  }) {
    const template = this.template(templateId);
    const plan = this.plan(planId);
    if (!businessName) throw new Error('businessName is required');

    const suburb = suburbId
      ? this.catalog.suburb(suburbId)
      : (suburbName
        ? (this.catalog.findSuburbByName(suburbName) || this.catalog.findSuburbByName(String(suburbName).replace(/-/g, ' ')) || null)
        : null);
    if (suburbName && !suburb) throw new Error(`unknown suburb "${suburbName}" — pass a suburbId, or a name from GET /api/geography/suburbs`);
    const name = String(businessName).trim();
    const slug = this.#uniqueSlug(slugify(name));
    const theme = themeId ? (template.themePresets.find((t) => t.id === themeId) || template.themePresets[0]) : template.themePresets[0];

    let pro = null;
    if (proId) {
      pro = this.store.get('pros', proId);
      if (!pro) throw new Error(`pro ${proId} not found`);
    }

    const sample = useSampleContent ? template.sample : null;
    const siteId = idFor('site');
    const site = {
      siteId,
      reference: this.store.reference('SITE', 'site', 5),
      slug,
      kind: 'BUSINESS_SITE',
      templateId: template.id,
      industry: template.label,
      status: SITE_STATUS.DRAFT,
      name,
      tagline: tagline || sample?.tagline || `Your ${template.itemNoun}s, online`,
      description: description || sample?.description || `${name} — ${template.audience}.`,
      proId: pro?.proId || null,
      proName: pro?.displayName || null,
      leadId: leadId || null,
      contact: {
        phone: contact.phone || pro?.mobile || null,
        email: contact.email || pro?.email || null,
        whatsapp: contact.whatsapp || null,
        address: contact.address || null,
        suburb: suburb?.name || contact.suburb || pro?.location?.suburb || null,
        suburbId: suburb?.id || null,
        metro: suburb?.metroName || contact.metro || pro?.location?.metro || null,
        metroId: suburb?.metroId || pro?.location?.metroId || null,
        mapsUrl: contact.mapsUrl || null,
      },
      social: { instagram: contact.instagram || null, facebook: contact.facebook || null, tiktok: contact.tiktok || null },
      theme: withContrast(theme),
      // The template's own words for the catalogue, so the editor and the
      // public page say "Treatments" or "Rooms & rates", never "Catalogue".
      catalogueLabel: template.catalogueLabel,
      itemNoun: template.itemNoun,
      hours: sample?.hours || [],
      catalogue: sample ? deepClone(sample.catalogue) : [{ name: template.catalogueLabel, items: [] }],
      gallery: [],
      testimonials: sample ? deepClone(sample.testimonials || []) : [],
      faq: sample ? deepClone(sample.faq || []) : [],
      hero: {
        image: heroImage || null,
        video: null,
        headline: name,
        eyebrow: 'Welcome to',
        primaryCta: template.booking.label,
        secondaryCta: `See the ${template.catalogueLabel.toLowerCase()}`,
      },
      about: {
        image: null,
        story: description || sample?.description || null,
        stats: sample?.aboutStats || [],
      },
      booking: {
        enabled: true,
        label: template.booking.label,
        submitLabel: template.booking.submitLabel,
        intake: template.booking.intake,
        confirmation: template.booking.confirmation,
        fields: deepClone(template.booking.fields),
        submissions: 0,
      },
      sections: deepClone(template.sections),
      plan: {
        planId: plan.id,
        planName: plan.name,
        monthlyCents: plan.priceCents,
        setupCents: plan.setupCents,
        updateCreditsTotal: plan.updateCreditsPerMonth,
        updateCreditsUsed: 0,
        periodStartedAt: nowIso(),
        renewsAt: addDays(nowIso(), 30),
        extraUpdateCents: plan.extraUpdateCents,
        status: SUBSCRIPTION_STATUS.TRIAL,
        subscriptionId: null,
        escrowId: null,
        hosting: 'proveri-hosted',
        ssl: true,
      },
      permissions: { records: [], assetsCleared: 0, assetsUncleared: 0, popiaConsent: false, gateOpen: true },
      seo: {
        title: this.#seoTitle(template, { name, suburb: suburb?.name, industry: template.label }),
        description: this.#seoDescription(template, { name, suburb: suburb?.name, tagline: site0Tagline(sample, name) }),
        keywords: (template.seo.keywords || []).map((k) => k.replace('{suburb}', suburb?.name || '').replace('{metro}', suburb?.metroName || '').replace('{industry}', template.label)),
        canonical: `/s/${slug}`,
        structuredData: true,
      },
      urls: {
        draft: `/business-studio/${siteId}`,
        preview: `/preview/${slug}`,
        live: `/s/${slug}`,
        export: `/api/sites/${siteId}/export`,
      },
      aiPromptTemplate: template.aiPrompt,
      assetKeywords: template.assetKeywords,
      stats: { views: 0, bookings: 0, enquiries: 0, updatesUsed: 0, exportedAt: null },
      contentHash: sha256({ siteId, name, templateId: template.id, catalogue: site0Catalogue(sample) }),
      timeline: [{ at: nowIso(), event: 'SCAFFOLDED', note: `Created from the ${template.label} template${pro ? ` for verified pro ${pro.displayName}` : ''}` }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('businessSites', siteId, site);
    this.kernel.ledger.append({
      action: 'BUSINESS_SITE_SCAFFOLDED',
      subject: siteId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${name}: ${template.label} site scaffolded from template "${template.id}" on the ${plan.name} plan — R0 taken`,
        slug,
        templateId: template.id,
        planId: plan.id,
      },
    });
    return deepClone(site);
  }

  #uniqueSlug(base) {
    let slug = base;
    let n = 2;
    while (this.store.findOne('businessSites', (s) => s.slug === slug)) slug = `${base}-${n++}`;
    return slug;
  }

  #seoTitle(template, { name, suburb, industry }) {
    return template.seo.titlePattern
      .replace('{name}', name)
      .replace('{suburb}', suburb || 'South Africa')
      .replace('{metro}', suburb || 'South Africa')
      .replace('{industry}', industry);
  }

  #seoDescription(template, { name, suburb, tagline }) {
    return template.seo.descriptionPattern
      .replace('{name}', name)
      .replace('{suburb}', suburb || 'South Africa')
      .replace('{tagline}', tagline || '');
  }

  /* ================================================================== *
   * READ
   * ================================================================== */

  get(siteIdOrSlug) {
    const site = this.store.get('businessSites', siteIdOrSlug)
      || this.store.findOne('businessSites', (s) => s.slug === siteIdOrSlug || s.reference === siteIdOrSlug);
    if (!site) throw new Error(`business site ${siteIdOrSlug} not found`);
    return site;
  }

  getOrNull(siteIdOrSlug) {
    try { return deepClone(this.get(siteIdOrSlug)); } catch { return null; }
  }

  list({ status = null, templateId = null, proId = null, leadId = null, publicOnly = false, limit = 100 } = {}) {
    let rows = this.store.all('businessSites');
    if (publicOnly) rows = rows.filter((s) => s.status === SITE_STATUS.LIVE);
    if (status) rows = rows.filter((s) => s.status === status);
    if (templateId) rows = rows.filter((s) => s.templateId === templateId);
    if (proId) rows = rows.filter((s) => s.proId === proId);
    if (leadId) rows = rows.filter((s) => s.leadId === leadId);
    return rows
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((s) => this.summary(s));
  }

  summary(site) {
    return {
      siteId: site.siteId,
      reference: site.reference,
      slug: site.slug,
      name: site.name,
      tagline: site.tagline,
      industry: site.industry,
      templateId: site.templateId,
      status: site.status,
      proId: site.proId,
      proName: site.proName,
      leadId: site.leadId,
      suburb: site.contact.suburb,
      metro: site.contact.metro,
      url: site.status === SITE_STATUS.LIVE ? site.urls.live : site.urls.preview,
      planName: site.plan.planName,
      monthlyCents: site.plan.monthlyCents,
      updateCredits: site.plan.updateCreditsTotal === -1 ? 'unlimited' : `${site.plan.updateCreditsUsed}/${site.plan.updateCreditsTotal}`,
      catalogueItems: site.catalogue.reduce((n, c) => n + c.items.length, 0),
      galleryCount: site.gallery.length,
      bookings: site.stats.bookings,
      permissionGate: site.permissions.gateOpen ? 'clear' : 'blocked',
      contentHash: site.contentHash.slice(0, 12),
      updatedAt: site.updatedAt,
    };
  }

  /* ================================================================== *
   * CONTENT & THEME
   * ================================================================== */

  /**
   * Update the content model. Edits to a LIVE site consume an update credit —
   * that is what the monthly plan actually pays for, and policy WEB-001 decides
   * what happens when the allowance runs out.
   */
  updateContent(siteId, patch = {}, { actorId = 'studio', consumeCredit = true, note = null, approveExtra = false } = {}) {
    const site = this.get(siteId);
    const allowed = ['tagline', 'description', 'hours', 'catalogue', 'gallery', 'testimonials', 'faq', 'hero', 'about', 'contact', 'social', 'booking', 'sections', 'seo', 'name'];
    const changes = Object.keys(patch).filter((k) => allowed.includes(k));
    const rejected = Object.keys(patch).filter((k) => !allowed.includes(k));
    if (!changes.length) throw new Error('nothing to update — editable fields are: ' + allowed.join(', '));
    if (rejected.length) throw new Error(`cannot edit protected field(s) here: ${rejected.join(', ')}`);

    let updateRecord = null;
    if (site.status === SITE_STATUS.LIVE && consumeCredit) {
      updateRecord = this.logUpdate(siteId, { summary: note || `Content edit: ${changes.join(', ')}`, actorId, approveExtra });
    }

    for (const key of changes) {
      if (key === 'catalogue') site.catalogue = this.#normalizeCatalogue(patch.catalogue, site);
      else if (key === 'contact') site.contact = { ...site.contact, ...patch.contact };
      else if (key === 'booking') site.booking = { ...site.booking, ...patch.booking };
      else if (key === 'hero') site.hero = { ...site.hero, ...patch.hero };
      else if (key === 'about') site.about = { ...site.about, ...patch.about };
      else if (key === 'social') site.social = { ...site.social, ...patch.social };
      else if (key === 'seo') site.seo = { ...site.seo, ...patch.seo };
      else site[key] = patch[key];
    }

    if (patch.name) site.seo.title = this.#seoTitle(this.template(site.templateId), { name: site.name, suburb: site.contact.suburb, industry: site.industry });
    site.contentHash = sha256({ siteId: site.siteId, name: site.name, catalogue: site.catalogue, updatedAt: nowIso() });
    site.updatedAt = nowIso();
    site.timeline.push({ at: nowIso(), event: 'CONTENT_UPDATED', note: note || `Edited ${changes.join(', ')}` });

    this.kernel.ledger.append({
      action: 'BUSINESS_SITE_CONTENT_UPDATED',
      subject: siteId,
      visibility: 'PRIVATE',
      payload: { summary: `${site.name}: content updated (${changes.join(', ')})`, changes, updateCreditConsumed: Boolean(updateRecord) },
    });
    return { site: deepClone(site), update: updateRecord, rejected };
  }

  #normalizeCatalogue(catalogue, site) {
    if (!Array.isArray(catalogue)) throw new Error('catalogue must be an array of { name, items: [] }');
    return catalogue.map((category) => ({
      name: String(category.name || site.booking.label || 'Items'),
      items: (category.items || []).map((item) => ({
        name: String(item.name || 'Untitled'),
        description: item.description || '',
        price: item.price || (item.priceCents ? `R${(item.priceCents / 100).toLocaleString('en-ZA')}` : 'on request'),
        priceCents: Number.isFinite(item.priceCents) ? item.priceCents : parsePrice(item.price),
        image: item.image || null,
        tags: item.tags || [],
        popular: Boolean(item.popular || (item.tags || []).includes('bestseller')),
        aiGenerated: Boolean(item.aiGenerated),
      })),
    }));
  }

  updateTheme(siteId, theme = {}, { actorId = 'studio' } = {}) {
    const site = this.get(siteId);
    const template = this.template(site.templateId);
    if (theme.presetId) {
      const preset = template.themePresets.find((t) => t.id === theme.presetId);
      if (!preset) throw new Error(`unknown theme preset ${theme.presetId} for ${template.id}`);
      site.theme = withContrast(preset);
    }
    for (const key of ['primary', 'secondary', 'accent', 'dark', 'light', 'fontDisplay']) {
      if (theme[key]) {
        if (key !== 'fontDisplay' && !/^#[0-9a-fA-F]{3,8}$/.test(theme[key])) throw new Error(`${key} must be a hex colour like #0E7C5A`);
        site.theme[key] = theme[key];
      }
    }
    const contrast = contrastRatio(site.theme.light, site.theme.dark);
    site.theme.contrastRatio = contrast;
    site.theme.contrastOk = contrast >= 4.5;
    site.updatedAt = nowIso();
    site.contentHash = sha256({ siteId, theme: site.theme, at: nowIso() });
    site.timeline.push({ at: nowIso(), event: 'THEME_UPDATED', note: `Theme ${site.theme.name || site.theme.id || 'custom'} applied` });
    this.kernel.ledger.append({
      action: 'BUSINESS_SITE_THEME_UPDATED',
      subject: siteId,
      visibility: 'PRIVATE',
      payload: { summary: `${site.name}: theme applied (contrast ${contrast}:1 ${site.theme.contrastOk ? 'passes' : 'FAILS'} WCAG AA)`, contrast, contrastOk: site.theme.contrastOk, actorId },
    });
    return deepClone(site);
  }

  /* ================================================================== *
   * ASSETS — intake, auto-classification, permission & POPIA
   * ================================================================== */

  /**
   * Add an asset and classify it in one step. Classification mirrors the
   * reference pipeline (download_social_images.py + classification.json):
   * keyword-match the caption against the industry's vocabulary and return a
   * category, a suggested use and a quality read.
   */
  addAsset(siteId, { filename, caption = '', source = 'uploaded', contentType = 'image/jpeg', bytes = 0, aiGenerated = false, credit = null, dataUrl = null, width = null, height = null }) {
    const site = this.get(siteId);
    if (!filename) throw new Error('filename is required');
    const assetId = idFor('asset');
    const classification = this.classify(site, { caption, filename, contentType, bytes });

    const asset = {
      assetId,
      siteId,
      filename,
      caption: caption || classification.suggestedCaption,
      source,
      contentType,
      bytes,
      width,
      height,
      aiGenerated,
      credit,
      dataUrl: dataUrl || null,
      url: dataUrl ? null : `/api/sites/${siteId}/assets/${assetId}/file`,
      classification,
      permission: null,
      aiLabelled: !aiGenerated || aiGenerated, // the renderer prints an "illustrative" note wherever an AI asset appears
      usedIn: [classification.placement === 'GALLERY' ? 'gallery' : 'catalogue'],
      createdAt: nowIso(),
    };
    this.store.put('siteAssets', assetId, asset);
    if (classification.placement === 'GALLERY') {
      if (site.gallery.length < 12) site.gallery.push(assetId);
    } else {
      asset.attachedTo = this.#attachToCatalogue(site, asset);
      if (!asset.attachedTo && site.gallery.length < 12) site.gallery.push(assetId);
    }
    site.permissions = this.#permissionState(site);
    site.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'SITE_ASSET_ADDED',
      subject: assetId,
      visibility: 'PRIVATE',
      payload: {
        summary: `${site.name}: asset ${filename} classified as ${classification.category} (confidence ${classification.confidence}%) — permission ${asset.permission ? 'on file' : 'REQUIRED before publish'}`,
        category: classification.category,
        aiGenerated,
        permissionRequired: !asset.permission,
      },
    });
    return deepClone(asset);
  }

  /**
   * Keyword classification of an incoming asset against the industry
   * vocabulary — the same trick the reference pipeline uses to sort 94
   * Instagram downloads into menu categories, generalised to every template.
   */
  classify(site, { caption = '', filename = '', contentType = 'image/jpeg', bytes = 0 } = {}) {
    const keywords = site.assetKeywords || {};
    const haystack = `${caption} ${filename}`.toLowerCase();
    let best = { category: 'uncategorised', hits: 0, matched: [] };
    for (const [category, words] of Object.entries(keywords)) {
      const matched = words.filter((w) => haystack.includes(String(w).toLowerCase()));
      if (matched.length > best.hits) best = { category, hits: matched.length, matched };
    }
    const isVideo = /video|mp4|mov/.test(contentType) || /\.(mp4|mov|webm)$/i.test(filename);
    const confidence = best.hits === 0 ? 20 : Math.min(98, 55 + best.hits * 18);
    const ambience = best.category === 'uncategorised'
      || /(ambiance|exterior|studio|workspace|interior|counter|landscape|people|team|clients|corporate|estate|common|bathroom|detail|lookbook|activity|wildlife|service|fleet|credentials)/.test(best.category);
    const catalogueLabel = site.catalogue?.[0]?.name || 'Catalogue item';
    return {
      category: best.category,
      matchedKeywords: best.matched,
      confidence,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
      placement: ambience ? 'GALLERY' : 'CATALOGUE',
      needsReview: best.category === 'uncategorised',
      suggestedUse: best.category === 'uncategorised' ? 'Gallery — check by hand' : (ambience ? 'Gallery' : `${catalogueLabel} item`),
      suggestedCaption: caption || titleCase(best.matched.join(' ') || filename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')),
      quality: bytesHint(bytes || bytesOf(filename)),
      note: confidence < 50 ? 'No keyword match — check this one by hand before publishing.' : null,
    };
  }

  /**
   * File an asset onto the catalogue item it belongs to. This is the step the
   * reference pipeline does by hand after classifying 94 downloaded photos:
   * match the caption against the item names and attach it. Here it happens on
   * intake, and only onto an item that has no image yet, so nothing is
   * overwritten.
   */
  #attachToCatalogue(site, asset) {
    const tokens = `${asset.caption} ${asset.filename}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    if (!tokens.length) return null;
    let best = { item: null, category: null, hits: 0 };
    for (const category of site.catalogue) {
      for (const item of category.items) {
        const haystack = `${item.name} ${item.description}`.toLowerCase();
        const hits = tokens.filter((t) => haystack.includes(t)).length;
        if (hits > best.hits && !item.image) best = { item, category, hits };
      }
    }
    if (!best.item) return null;
    best.item.image = asset.assetId;
    if (asset.aiGenerated) best.item.aiGenerated = true;
    asset.usedIn = [`catalogue:${best.category.name}`];
    return { category: best.category.name, item: best.item.name, matchedTokens: best.hits };
  }

  classifyAsset(siteId, assetId, { caption = null, override = null } = {}) {
    const site = this.get(siteId);
    const asset = this.store.get('siteAssets', assetId);
    if (!asset || asset.siteId !== siteId) throw new Error(`asset ${assetId} not found on this site`);
    if (caption !== null) asset.caption = caption;
    asset.classification = override
      ? { ...asset.classification, category: override, confidence: 100, manualOverride: true, suggestedUse: override }
      : this.classify(site, { caption: asset.caption, filename: asset.filename, contentType: asset.contentType, bytes: asset.bytes });
    this.kernel.ledger.append({
      action: 'SITE_ASSET_CLASSIFIED',
      subject: assetId,
      visibility: 'PRIVATE',
      payload: { summary: `${asset.filename} → ${asset.classification.category} (${asset.classification.confidence}%${asset.classification.manualOverride ? ', manual' : ''})` },
    });
    return deepClone(asset);
  }

  assets(siteId) {
    return this.store.find('siteAssets', (a) => a.siteId === siteId).map((a) => deepClone(a));
  }

  /**
   * Record permission + POPIA consent for a set of assets. This is the
   * reference implementation's PERMISSION.md checklist, turned into a
   * hash-chained record that gates publishing.
   */
  recordPermission(siteId, {
    assetIds = [], grantedBy, role = 'owner', method = 'whatsapp', scope = ['photos', 'menu text'],
    popiaConsent = false, identifiablePeople = false, evidenceHash = null, notes = null, licence = 'owner-cleared', creditRequired = null,
  }) {
    const site = this.get(siteId);
    if (!grantedBy) throw new Error('grantedBy is required — who gave permission?');
    const targets = assetIds.length ? assetIds : this.store.find('siteAssets', (a) => a.siteId === siteId && !a.permission).map((a) => a.assetId);
    if (!targets.length) return { recorded: false, reason: 'no assets need permission — everything is already cleared' };

    const record = {
      permissionId: idFor('perm'),
      siteId,
      assetIds: targets,
      grantedBy,
      role,
      method,
      scope,
      licence,
      popiaConsent: Boolean(popiaConsent),
      identifiablePeople: Boolean(identifiablePeople),
      popiaRequired: Boolean(identifiablePeople),
      popiaSatisfied: Boolean(identifiablePeople) ? Boolean(popiaConsent) : true,
      creditRequired,
      evidenceHash: evidenceHash ? sha256(evidenceHash) : sha256({ grantedBy, method, at: nowIso() }),
      notes,
      checklist: planData.permissions.checklist.map((c) => ({
        id: c.id,
        label: c.label,
        satisfied: checklistSatisfied(c.id, { popiaConsent, identifiablePeople, licence, creditRequired, targets }),
      })),
      recordedAt: nowIso(),
      seal: null,
    };
    record.seal = sha256({ permissionId: record.permissionId, assetIds: targets, grantedBy, evidenceHash: record.evidenceHash, at: record.recordedAt });

    for (const assetId of targets) {
      const asset = this.store.get('siteAssets', assetId);
      if (asset && asset.siteId === siteId) {
        asset.permission = {
          permissionId: record.permissionId,
          grantedBy,
          role,
          method,
          licence,
          popiaRequired: record.popiaRequired,
          popiaConsent: record.popiaConsent,
          seal: record.seal.slice(0, 16),
          recordedAt: record.recordedAt,
        };
        if (asset.aiGenerated) asset.labellingRequired = true;
      }
    }
    this.store.put('sitePermissions', record.permissionId, record);
    site.permissions.records.push(record.permissionId);
    site.permissions = this.#permissionState(site);
    site.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'SITE_ASSET_PERMISSION_RECORDED',
      subject: siteId,
      level: 'TRUST',
      visibility: 'PUBLIC',
      payload: {
        summary: `${site.name}: permission for ${targets.length} asset(s) recorded from ${grantedBy} (${role}, via ${method})${record.identifiablePeople ? ` — POPIA consent ${record.popiaConsent ? 'on file' : 'MISSING'}` : ''}. Publish gate ${site.permissions.gateOpen ? 'open' : 'still blocked'}.`,
        seal: record.seal.slice(0, 16),
        popiaConsent: record.popiaConsent,
        assets: targets.length,
      },
    });
    return deepClone(record);
  }

  #permissionState(site) {
    const assets = this.store.find('siteAssets', (a) => a.siteId === site.siteId);
    const cleared = assets.filter((a) => a.permission || a.source === 'proveri-generated' || a.source === 'licensed-stock');
    const uncleared = assets.filter((a) => !a.permission && !['proveri-generated', 'licensed-stock'].includes(a.source));
    const popiaOutstanding = assets.filter((a) => a.permission?.popiaRequired && !a.permission?.popiaConsent);
    const aiUnlabelled = assets.filter((a) => a.aiGenerated && (a.aiLabelled === false || this.#unlabelledPlacement(site, a)));
    return {
      records: site.permissions?.records || [],
      totalAssets: assets.length,
      assetsCleared: cleared.length,
      assetsUncleared: uncleared.length,
      unclearedFiles: uncleared.map((a) => a.filename),
      popiaOutstanding: popiaOutstanding.length,
      aiUnlabelled: aiUnlabelled.length,
      gateOpen: uncleared.length === 0 && popiaOutstanding.length === 0,
      principle: 'Credit is not permission. Nothing publishes until the owner has cleared it and, where faces appear, POPIA consent is on file.',
    };
  }

  /**
   * The renderer prints an "illustrative image" note on catalogue items and
   * gallery tiles. A hero or about image is full-bleed with nowhere to put the
   * note, so an AI asset used there is unlabelled until it is moved or replaced.
   */
  #unlabelledPlacement(site, asset) {
    const inCatalogue = site.catalogue.some((c) => c.items.some((i) => i.image === asset.assetId));
    const inGallery = site.gallery.includes(asset.assetId);
    const inHero = site.hero?.image === asset.assetId;
    const inAbout = site.about?.image === asset.assetId;
    return (inHero || inAbout) && !inGallery && !inCatalogue;
  }

  permissionState(siteId) {
    return this.#permissionState(this.get(siteId));
  }

  /**
   * AI image prompt for an item, using the industry prompt template. Honest
   * labelling is returned as part of the payload, not left to the operator.
   */
  aiImagePrompt(siteId, { itemId = null, itemText = null, style = null } = {}) {
    const site = this.get(siteId);
    const template = this.template(site.templateId);
    let item = itemText;
    let matched = null;
    if (itemId) {
      for (const category of site.catalogue) {
        matched = category.items.find((i) => i.name === itemId || sha256(i.name).slice(0, 8) === itemId);
        if (matched) { item = `${matched.name}${matched.description ? ` — ${matched.description}` : ''}`; break; }
      }
      if (!matched) throw new Error(`catalogue item ${itemId} not found`);
    }
    if (!item) throw new Error('provide itemId or itemText');

    const prompt = (style || template.aiPrompt)
      .replace('{item}', item)
      .replace('{business}', site.name)
      .replace('{style}', template.label.toLowerCase());
    return {
      siteId,
      item,
      prompt,
      negativePrompt: 'text, watermark, logo, hands deformed, plastic look, oversaturated, stock-photo staging',
      budgetStack: planData.aiImages.budgetStack,
      labelling: {
        required: true,
        rule: planData.aiImages.labellingPolicy,
        howToApply: 'Add the image with aiGenerated=true; the public page renders an "illustrative image" note next to it.',
      },
      honesty: 'A generated photo must never stand in for the actual product without saying so. If the business can send a phone photo, use that and enhance it instead.',
    };
  }

  /* ================================================================== *
   * PUBLISH — gated by policy, not by memory
   * ================================================================== */

  preview(siteId) {
    const site = this.get(siteId);
    if (site.status === SITE_STATUS.LIVE) return { siteId, status: site.status, url: site.urls.live, note: 'already live' };
    site.status = SITE_STATUS.PREVIEW;
    site.urls.preview = `/preview/${site.slug}`;
    site.updatedAt = nowIso();
    site.timeline.push({ at: nowIso(), event: 'PREVIEW_READY', note: 'Unlisted preview URL generated — R0 taken' });
    this.kernel.ledger.append({
      action: 'BUSINESS_SITE_PREVIEW_READY',
      subject: siteId,
      visibility: 'PUBLIC',
      payload: { summary: `${site.name}: unlisted preview ready at ${site.urls.preview}. Nothing charged.`, previewUrl: site.urls.preview },
    });
    return { siteId, status: site.status, url: site.urls.preview, previewToken: sha256(site.slug).slice(0, 10) };
  }

  /**
   * Publish. The permission gate runs through the policy engine so the refusal
   * is auditable and identical everywhere.
   */
  publish(siteId, { actorId = 'studio', force = false } = {}) {
    const site = this.get(siteId);
    site.permissions = this.#permissionState(site);

    const decision = this.kernel.policy.evaluate('website', {
      subjectId: siteId,
      site: { status: site.status, permissions: site.permissions, plan: site.plan, assets: this.assets(siteId) },
      action: 'PUBLISH',
    });
    const blocked = decision.firedRules.filter((r) => r.effect === 'BLOCK' || r.effect === 'REMOVE');
    if (blocked.length && !force) {
      site.status = SITE_STATUS.BLOCKED;
      site.updatedAt = nowIso();
      site.timeline.push({ at: nowIso(), event: 'PUBLISH_BLOCKED', note: blocked.map((r) => `[${r.ruleId}] ${r.reason}`).join(' · ') });
      const error = new Error(blocked.map((r) => `[${r.ruleId}] ${r.reason}`).join(' · '));
      error.decision = decision;
      error.code = 'BLOCKED';
      throw error;
    }

    const warnings = decision.firedRules.filter((r) => r.effect === 'WARN' || r.effect === 'REQUIRE_APPROVAL');
    site.status = SITE_STATUS.LIVE;
    site.publishedAt = site.publishedAt || nowIso();
    site.updatedAt = nowIso();

    // The subscription's first month was held in escrow against "site live".
    // Publishing is that milestone, so it releases now.
    if (site.plan.subscriptionId) {
      const subscription = this.store.get('siteSubscriptions', site.plan.subscriptionId);
      if (subscription) this.#releaseSubscriptionMilestone(site, subscription);
    }
    site.timeline.push({ at: nowIso(), event: 'PUBLISHED', note: `Live at ${site.urls.live}${warnings.length ? ` with warnings: ${warnings.map((w) => w.ruleId).join(', ')}` : ''}` });

    this.kernel.ledger.append({
      action: 'BUSINESS_SITE_PUBLISHED',
      subject: siteId,
      level: 'TRUST',
      visibility: 'PUBLIC',
      payload: {
        summary: `${site.name} published at ${site.urls.live} — ${site.permissions.assetsCleared} asset(s) permission-cleared, plan ${site.plan.planName}`,
        assetsCleared: site.permissions.assetsCleared,
        warnings: warnings.map((w) => ({ ruleId: w.ruleId, reason: w.reason })),
      },
    });
    return { siteId, status: site.status, url: site.urls.live, warnings: warnings.map((w) => ({ ruleId: w.ruleId, reason: w.reason })), forced: force && blocked.length > 0 };
  }

  pause(siteId, { reason = null, actorId = 'studio' } = {}) {
    const site = this.get(siteId);
    site.status = SITE_STATUS.PAUSED;
    site.updatedAt = nowIso();
    site.timeline.push({ at: nowIso(), event: 'PAUSED', note: reason || 'Paused' });
    this.kernel.ledger.append({ action: 'BUSINESS_SITE_PAUSED', subject: siteId, visibility: 'PRIVATE', payload: { summary: `${site.name} paused${reason ? `: ${reason}` : ''}`, actorId } });
    return deepClone(site);
  }

  archive(siteId, { reason = null } = {}) {
    const site = this.get(siteId);
    site.status = SITE_STATUS.ARCHIVED;
    site.updatedAt = nowIso();
    site.timeline.push({ at: nowIso(), event: 'ARCHIVED', note: reason || 'Archived' });
    return deepClone(site);
  }

  /* ================================================================== *
   * SUBSCRIPTIONS — the monthly plan, metered
   * ================================================================== */

  /**
   * Start the subscription. The first month goes into escrow and is only
   * released when the site is actually live — the reference model is "zero
   * upfront, we host and maintain", and this makes that promise auditable
   * instead of verbal.
   */
  subscribe(siteId, { planId = null, paymentProvider = 'paystack', reference = null, method = 'card', customerId = null } = {}) {
    const site = this.get(siteId);
    const plan = this.plan(planId || site.plan.planId);

    const subscription = {
      subscriptionId: idFor('sub'),
      siteId,
      planId: plan.id,
      planName: plan.name,
      monthlyCents: plan.priceCents,
      setupCents: plan.setupCents,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      updateCreditsTotal: plan.updateCreditsPerMonth,
      updateCreditsUsed: 0,
      startedAt: nowIso(),
      renewsAt: addDays(nowIso(), 30),
      monthsBilled: 0,
      escrowId: null,
      invoices: [],
      customerId,
    };

    const escrow = this.kernel.escrow.open({
      bookingId: subscription.subscriptionId,
      customerId: customerId || site.contact.email || site.contact.phone || siteId,
      providerId: 'lula-webstudio',
      amountCents: plan.priceCents,
      provider: paymentProvider,
      milestones: [{ label: 'Site live and handed over', weight: 100 }],
      warrantyDays: 0,
      purpose: `Website subscription — ${plan.name} for ${site.name}`,
    });
    subscription.escrowId = escrow.escrowId;
    this.kernel.escrow.confirmFunded(escrow.escrowId, {
      reference: reference || `SUB_${subscription.subscriptionId.slice(-8).toUpperCase()}`,
      method,
      amountCents: plan.priceCents,
    });
    subscription.monthsBilled = 1;
    subscription.invoices.push({ period: 1, amountCents: plan.priceCents, paidAt: nowIso(), reference: subscription.subscriptionId, escrowId: escrow.escrowId });
    this.store.put('siteSubscriptions', subscription.subscriptionId, subscription);

    site.plan = {
      ...site.plan,
      planId: plan.id,
      planName: plan.name,
      monthlyCents: plan.priceCents,
      updateCreditsTotal: plan.updateCreditsPerMonth,
      updateCreditsUsed: 0,
      extraUpdateCents: plan.extraUpdateCents,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      subscriptionId: subscription.subscriptionId,
      escrowId: escrow.escrowId,
      periodStartedAt: nowIso(),
      renewsAt: subscription.renewsAt,
    };
    site.updatedAt = nowIso();
    site.timeline.push({ at: nowIso(), event: 'SUBSCRIBED', note: `${plan.name} at R${(plan.priceCents / 100).toLocaleString('en-ZA')}/month — first month held in escrow until the site is live` });

    this.kernel.ledger.append({
      action: 'SITE_SUBSCRIPTION_STARTED',
      subject: siteId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: {
        summary: `${site.name} subscribed to ${plan.name} — R${(plan.priceCents / 100).toLocaleString('en-ZA')}/month held in ${escrow.providerLabel} escrow, released only when the site is live. R0 build fee.`,
        planId: plan.id,
        monthlyCents: plan.priceCents,
        updateCredits: plan.updateCreditsPerMonth,
      },
    });

    // If the site is already live, release the first month immediately.
    if (site.status === SITE_STATUS.LIVE) this.#releaseSubscriptionMilestone(site, subscription);
    return { subscription: deepClone(subscription), site: deepClone(site) };
  }

  #releaseSubscriptionMilestone(site, subscription) {
    const escrow = this.kernel.escrow.get(subscription.escrowId);
    if (!escrow || escrow.status === 'RELEASED') return null;
    const milestone = escrow.plan.milestones[0];
    this.kernel.escrow.submitMilestoneEvidence(subscription.escrowId, milestone.milestoneId, {
      evidence: [{ type: 'DELIVERABLE', hash: site.contentHash, note: `Site live at ${site.urls.live}` }],
    });
    this.kernel.escrow.acceptMilestone(subscription.escrowId, milestone.milestoneId, { actorId: 'lula-webstudio', comment: 'Site published' });
    const after = this.kernel.escrow.get(subscription.escrowId);
    if (after.status === 'READY_FOR_RELEASE') this.kernel.escrow.release(subscription.escrowId, { triggeredBy: 'SITE_PUBLISHED' });
    return this.kernel.escrow.get(subscription.escrowId);
  }

  renewSubscription(siteId, { reference = null, method = 'card' } = {}) {
    const site = this.get(siteId);
    const subscription = site.plan.subscriptionId ? this.store.get('siteSubscriptions', site.plan.subscriptionId) : null;
    if (!subscription) throw new Error('this site has no active subscription — call subscribe first');
    if (subscription.status === SUBSCRIPTION_STATUS.CANCELLED) throw new Error('subscription was cancelled');

    subscription.monthsBilled += 1;
    subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
    subscription.updateCreditsUsed = 0;
    subscription.renewsAt = addDays(nowIso(), 30);
    subscription.invoices.push({ period: subscription.monthsBilled, amountCents: subscription.monthlyCents, paidAt: nowIso(), reference: reference || `SUB-R${subscription.monthsBilled}`, escrowId: null });
    site.plan.updateCreditsUsed = 0;
    site.plan.periodStartedAt = nowIso();
    site.plan.renewsAt = subscription.renewsAt;
    site.plan.status = SUBSCRIPTION_STATUS.ACTIVE;
    site.updatedAt = nowIso();
    site.timeline.push({ at: nowIso(), event: 'SUBSCRIPTION_RENEWED', note: `Month ${subscription.monthsBilled} billed, update allowance reset to ${subscription.updateCreditsTotal === -1 ? 'unlimited' : subscription.updateCreditsTotal}` });

    this.kernel.ledger.append({
      action: 'SITE_SUBSCRIPTION_RENEWED',
      subject: siteId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: { summary: `${site.name}: month ${subscription.monthsBilled} of ${subscription.planName} billed (R${(subscription.monthlyCents / 100).toLocaleString('en-ZA')}), update allowance reset`, period: subscription.monthsBilled },
    });
    return { subscription: deepClone(subscription), site: deepClone(site) };
  }

  cancelSubscription(siteId, { reason = null } = {}) {
    const site = this.get(siteId);
    const subscription = site.plan.subscriptionId ? this.store.get('siteSubscriptions', site.plan.subscriptionId) : null;
    if (!subscription) throw new Error('no subscription to cancel');
    subscription.status = SUBSCRIPTION_STATUS.CANCELLED;
    subscription.cancelledAt = nowIso();
    subscription.cancellationReason = reason || null;
    site.plan.status = SUBSCRIPTION_STATUS.CANCELLED;
    site.updatedAt = nowIso();
    site.timeline.push({ at: nowIso(), event: 'SUBSCRIPTION_CANCELLED', note: reason || 'Cancelled' });
    this.kernel.ledger.append({
      action: 'SITE_SUBSCRIPTION_CANCELLED',
      subject: siteId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${site.name} cancelled ${subscription.planName}. The site stays downloadable as a self-contained HTML file — the content is the client's, not ours.`,
        reason: reason || null,
        monthsBilled: subscription.monthsBilled,
      },
    });
    return { subscription: deepClone(subscription), exportAvailableAt: site.urls.export };
  }

  /**
   * Log a content update against the monthly allowance. Policy WEB-001 decides
   * what happens when the allowance is exhausted: with `approveExtra` the extra
   * update is billed at the plan's per-update rate, otherwise it is refused.
   */
  logUpdate(siteId, { summary, actorId = 'studio', force = false, approveExtra = false } = {}) {
    const site = this.get(siteId);
    const plan = this.plan(site.plan.planId);
    const unlimited = site.plan.updateCreditsTotal === -1;

    const decision = this.kernel.policy.evaluate('website', {
      subjectId: siteId,
      site: { plan: site.plan, status: site.status },
      update: { summary, unlimited },
      action: 'UPDATE',
    });
    const needsApproval = decision.firedRules.some((r) => r.ruleId === 'WEB-001');
    if (needsApproval && !unlimited && !approveExtra && !force) {
      const error = new Error(`Update allowance for ${plan.name} is used up (${site.plan.updateCreditsUsed}/${site.plan.updateCreditsTotal} this month). Renew, upgrade, or approve an extra update at R${(plan.extraUpdateCents / 100).toLocaleString('en-ZA')}.`);
      error.code = 'REQUIRE_APPROVAL';
      error.decision = decision;
      error.options = { renew: `/api/sites/${siteId}/renew`, upgrade: planData.plans.map((p) => p.id), extraUpdateCents: plan.extraUpdateCents };
      throw error;
    }

    const charged = needsApproval && approveExtra && !unlimited ? plan.extraUpdateCents : 0;
    const record = {
      updateId: idFor('upd'),
      siteId,
      summary: summary || 'Content update',
      actorId,
      creditConsumed: !unlimited && !charged,
      chargedCents: charged,
      at: nowIso(),
      creditsAfter: unlimited ? null : site.plan.updateCreditsUsed + (charged ? 0 : 1),
      creditsTotal: site.plan.updateCreditsTotal,
    };
    this.store.put('siteUpdates', record.updateId, record);
    if (!unlimited && !charged) {
      site.plan.updateCreditsUsed += 1;
      const subscription = site.plan.subscriptionId ? this.store.get('siteSubscriptions', site.plan.subscriptionId) : null;
      if (subscription) subscription.updateCreditsUsed = site.plan.updateCreditsUsed;
    }
    site.stats.updatesUsed = (site.stats.updatesUsed || 0) + 1;
    site.updatedAt = nowIso();
    this.kernel.ledger.append({
      action: 'SITE_UPDATE_LOGGED',
      subject: siteId,
      visibility: 'PRIVATE',
      payload: {
        summary: `${site.name}: ${record.summary}${charged ? ` — extra update billed at R${(charged / 100).toLocaleString('en-ZA')}` : ` (credit ${record.creditsAfter}/${record.creditsTotal})`}`,
        chargedCents: charged,
      },
    });
    return deepClone(record);
  }

  updateHistory(siteId) {
    return this.store.find('siteUpdates', (u) => u.siteId === siteId).sort((a, b) => b.at.localeCompare(a.at)).map((u) => deepClone(u));
  }

  /* ================================================================== *
   * BOOKINGS — the part the reference implementation leaves as a toast
   * ================================================================== */

  /**
   * Take a booking from the public site. Validates against the template's
   * booking schema, writes a record with a reference the business can quote
   * back, notifies the owner, and — for JOB intake with a linked verified pro —
   * posts a real marketplace job so the customer can pay into escrow.
   */
  async submitBooking(siteIdOrSlug, payload = {}, { source = 'website', ip = null, userAgent = null } = {}) {
    const site = this.get(siteIdOrSlug);
    if (!site.booking.enabled) throw new Error('booking is disabled on this site');
    if (site.status !== SITE_STATUS.LIVE && source === 'website') throw new Error('this site is not published yet — bookings open when it goes live');

    const template = this.template(site.templateId);
    const { values, errors, missing } = this.#validateBooking(site, payload);
    if (errors.length) {
      const error = new Error(`Booking incomplete: ${errors.join('; ')}`);
      error.details = { errors, missing };
      throw error;
    }

    const bookingId = idFor('sbook');
    const reference = this.store.reference('BKG', 'site-booking', 6);
    const booking = {
      bookingId,
      reference,
      siteId: site.siteId,
      siteName: site.name,
      siteSlug: site.slug,
      templateId: site.templateId,
      intake: site.booking.intake,
      status: BOOKING_STATUS.NEW,
      values,
      contact: {
        name: values.name || null,
        phone: values.phone || null,
        email: values.email || null,
        whatsappLink: values.phone ? `https://wa.me/27${String(values.phone).replace(/[^0-9]/g, '').replace(/^0/, '').replace(/^27/, '')}` : null,
      },
      summary: summariseBooking(template, values),
      amountQuotedCents: quoteFromBooking(site, values),
      source,
      ip: ip ? sha256(ip).slice(0, 12) : null,
      userAgent: userAgent ? sha256(userAgent).slice(0, 12) : null,
      jobId: null,
      leadId: null,
      customerMessage: site.booking.confirmation,
      ownerNotified: false,
      timeline: [{ at: nowIso(), event: 'RECEIVED', note: `${site.booking.intake} booking from ${values.name || 'a visitor'}` }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('siteBookings', bookingId, booking);
    site.stats.bookings += 1;
    site.booking.submissions += 1;
    site.updatedAt = nowIso();

    /* ---- route it somewhere real ---- */
    let job = null;
    let lead = null;

    if (site.booking.intake === 'JOB' && site.proId) {
      job = await this.#convertToJob(site, booking, values);
    } else if (site.status !== SITE_STATUS.LIVE) {
      // A demo site that is not live still produces a sales lead — that is how
      // the reference pitch works, except here the lead is tracked.
      lead = this.#createLeadFromBooking(site, booking, values);
    }

    this.#notifyOwner(site, booking, job);

    this.kernel.ledger.append({
      action: 'SITE_BOOKING_RECEIVED',
      subject: bookingId,
      level: job ? 'MONEY' : 'STANDARD',
      visibility: 'PUBLIC',
      payload: {
        summary: `${site.name}: ${booking.summary} (ref ${reference})${job ? ` — posted as ProVeri job ${job.reference} so the customer can pay into escrow` : site.status === SITE_STATUS.LIVE ? ' — sent to the business inbox' : ' — captured as a sales lead while the site is still a preview'}`,
        intake: site.booking.intake,
        amountQuotedCents: booking.amountQuotedCents,
        jobId: job?.jobId || null,
      },
    });

    return {
      ...deepClone(booking),
      job: job ? { jobId: job.jobId, reference: job.reference, status: job.status, url: `/job/${job.jobId}`, escrowNote: 'Money is only held once you accept a bid.' } : null,
      leadId: lead?.leadId || null,
      nextStep: job
        ? 'The pro will bid on your job. Accept a bid and your payment is held in escrow until you confirm the work.'
        : site.booking.confirmation,
    };
  }

  #validateBooking(site, payload) {
    const values = {};
    const errors = [];
    const missing = [];
    for (const field of site.booking.fields) {
      const raw = payload[field.name] ?? payload[field.label?.toLowerCase()] ?? '';
      const value = String(raw).trim();
      if (field.required && !value) { missing.push(field.label || field.name); errors.push(`${field.label || field.name} is required`); continue; }
      if (!value) continue;
      if (field.type === 'tel' && !/^[+0-9 ()-]{7,20}$/.test(value)) { errors.push(`${field.label} does not look like a phone number`); continue; }
      if (field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value)) { errors.push(`${field.label} does not look like an email address`); continue; }
      if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { errors.push(`${field.label} must be a date (YYYY-MM-DD)`); continue; }
      if (field.type === 'time' && !/^\d{2}:\d{2}$/.test(value)) { errors.push(`${field.label} must be a time (HH:MM)`); continue; }
      if (field.type === 'number' && Number.isNaN(Number(value))) { errors.push(`${field.label} must be a number`); continue; }
      values[field.name] = field.type === 'number' ? Number(value) : value;
    }
    // Keep any extra fields the visitor's client sent (e.g. item chosen from a card).
    for (const [key, value] of Object.entries(payload)) {
      if (values[key] === undefined && value != null && value !== '') values[key] = String(value).trim();
    }
    return { values, errors, missing };
  }

  async #convertToJob(site, booking, values) {
    const pro = this.store.get('pros', site.proId);
    if (!pro) return null;

    const suburb = this.catalog.findSuburbByName(values.suburb || site.contact.suburb || '') || (site.contact.suburbId ? this.catalog.suburb(site.contact.suburbId) : null);
    const category = pickCategory(this.catalog, { pro, values, site });
    if (!category) return null;

    // Find or create the customer so the job has a real owner who can fund escrow.
    let customer = this.store.findOne('customers', (c) =>
      (values.email && c.email === String(values.email).toLowerCase()) ||
      (values.phone && c.mobile === String(values.phone).replace(/[^0-9]/g, '')));
    if (!customer) {
      try {
        customer = this.people.registerCustomer({
          fullName: values.name || 'Website visitor',
          email: values.email || null,
          mobile: values.phone || null,
          suburbId: suburb?.id || null,
        });
      } catch (error) {
        this.kernel.ledger.append({
          action: 'SITE_BOOKING_JOB_SKIPPED',
          subject: booking.bookingId,
          level: 'CRITICAL',
          payload: { summary: `${site.name}: booking ${booking.reference} could not open a job — ${error.message}` },
        });
        return null;
      }
    }

    const budgetCents = values.budget ? Math.round(Number(values.budget) * 100) : (booking.amountQuotedCents || category.medianPriceCents || 150000);
    const job = await this.jobs.postJob({
      customerId: customer.customerId,
      categoryId: category.id,
      title: values.service || values.item || values.tour || booking.summary.slice(0, 70),
      description: describeBooking(site, booking, values),
      suburbId: suburb?.id || null,
      addressText: values.suburb || site.contact.suburb || null,
      locationType: category.inHomeDefault ? 'IN_HOME' : 'ON_SITE',
      budgetCents,
      urgency: mapUrgency(values.urgency),
      preferredDates: values.date ? [values.date] : [],
      instantBook: Boolean(pro.pricing?.instantBook),
      source: 'BUSINESS_SITE',
      referralCode: null,
    });

    booking.jobId = job.jobId;
    booking.status = BOOKING_STATUS.CONVERTED_TO_JOB;
    booking.timeline.push({ at: nowIso(), event: 'CONVERTED_TO_JOB', note: `Posted as ${job.reference} in ${category.label}` });
    booking.updatedAt = nowIso();
    return job;
  }

  #createLeadFromBooking(site, booking, values) {
    const lead = {
      leadId: idFor('lead'),
      reference: this.store.reference('LEAD', 'lead', 5),
      stage: 'NEW',
      source: 'WEBSITE_BOOKING',
      owner: site.proId || 'sales-desk',
      businessName: site.name,
      contactName: values.name || null,
      phone: values.phone || null,
      email: values.email || null,
      industry: site.industry,
      templateId: site.templateId,
      suburb: site.contact.suburb,
      suburbId: site.contact.suburbId || null,
      metro: site.contact.metro,
      url: null,
      websiteStatus: 'PREVIEW_DEMO',
      websiteStatusLabel: 'Preview demo — not published',
      statusNote: 'The site is an unlisted preview, and a real visitor has already used its booking form. This is the warmest lead the studio produces.',
      priority: 5,
      priorityAction: 'Walk in this week',
      diagnostic: null,
      siteId: site.siteId,
      siteSlug: site.slug,
      subscriptionPlanId: site.plan.planId,
      dealValueCents: site.plan.monthlyCents,
      interest: booking.summary,
      notes: `Booking made on the unlisted preview of ${site.name} — the visitor already used the product.`,
      outreach: [],
      nextActionAt: addDays(nowIso(), 1),
      consent: { marketingOptIn: false, popiaNoticeGiven: true, optOut: false, source: 'captured on the preview booking form' },
      result: null,
      timeline: [{ at: nowIso(), event: 'CAPTURED', note: `Warm lead from a preview booking: ${booking.summary}` }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.put('salesLeads', lead.leadId, lead);
    booking.leadId = lead.leadId;
    return lead;
  }

  /**
   * The business owner gets a real notification record — the same inbox a pro
   * uses for job matches — with the reference number and a WhatsApp deep link
   * back to the visitor.
   */
  #notifyOwner(site, booking, job) {
    const recipient = site.proId || `owner:${site.siteId}`;
    const notification = {
      notificationId: idFor('notification'),
      userId: recipient,
      type: 'SITE_BOOKING',
      title: `New ${booking.intake.toLowerCase()} on ${site.name}`,
      body: `${booking.summary} · ref ${booking.reference}${job ? ` · posted as job ${job.reference}` : ''}`,
      data: { bookingId: booking.bookingId, siteId: site.siteId, reference: booking.reference, replyWhatsApp: booking.contact.whatsappLink, jobId: job?.jobId || null },
      read: false,
      channels: ['IN_APP', 'PUSH', booking.contact.phone ? 'SMS' : null].filter(Boolean),
      createdAt: nowIso(),
    };
    this.store.put('notifications', notification.notificationId, notification);
    booking.ownerNotified = true;
    booking.notificationId = notification.notificationId;
    return notification;
  }

  listBookings({ siteId = null, status = null, limit = 100 } = {}) {
    let rows = this.store.all('siteBookings');
    if (siteId) { const site = this.get(siteId); rows = rows.filter((b) => b.siteId === site.siteId); }
    if (status) rows = rows.filter((b) => b.status === status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((b) => deepClone(b));
  }

  getBooking(bookingIdOrReference) {
    const booking = this.store.get('siteBookings', bookingIdOrReference)
      || this.store.findOne('siteBookings', (b) => b.reference === bookingIdOrReference);
    if (!booking) throw new Error(`booking ${bookingIdOrReference} not found`);
    return deepClone(booking);
  }

  decideBooking(bookingId, { decision, actorId = 'owner', note = null, confirmToCustomer = true } = {}) {
    const booking = this.store.get('siteBookings', bookingId);
    if (!booking) throw new Error(`booking ${bookingId} not found`);
    if (!['CONFIRMED', 'DECLINED', 'COMPLETED', 'CANCELLED'].includes(String(decision).toUpperCase())) {
      throw new Error('decision must be CONFIRMED, DECLINED, COMPLETED or CANCELLED');
    }
    booking.status = String(decision).toUpperCase();
    booking.decidedAt = nowIso();
    booking.decidedBy = actorId;
    booking.decisionNote = note || null;
    booking.updatedAt = nowIso();
    booking.timeline.push({ at: nowIso(), event: booking.status, note: note || `${booking.status} by ${actorId}` });
    this.kernel.ledger.append({
      action: 'SITE_BOOKING_DECIDED',
      subject: bookingId,
      visibility: 'PRIVATE',
      payload: { summary: `${booking.siteName}: booking ${booking.reference} ${booking.status}${note ? ` — ${note}` : ''}`, confirmToCustomer },
    });
    return deepClone(booking);
  }

  /* ================================================================== *
   * RENDER — server-side HTML, zero dependencies, works without JS
   * ================================================================== */

  renderSiteHtml(siteIdOrSlug, { preview = false, inlineAssets = false } = {}) {
    const site = this.get(siteIdOrSlug);
    const template = this.template(site.templateId);
    const assets = this.assets(site.siteId);
    const assetById = new Map(assets.map((a) => [a.assetId, a]));
    const proProfile = site.proId ? this.people.publicProfile(site.proId) : null;
    const fleet = template.vehicleBridge ? this.#fleetFor(site) : [];
    const isDemo = site.status !== SITE_STATUS.LIVE;

    const img = (idOrUrl, fallbackLabel) => {
      if (!idOrUrl) return null;
      const asset = assetById.get(idOrUrl);
      const src = asset ? (inlineAssets && asset.dataUrl ? asset.dataUrl : (asset.url || asset.dataUrl)) : idOrUrl;
      return { src, alt: asset?.caption || fallbackLabel || '', aiGenerated: asset?.aiGenerated || false };
    };

    const sections = site.sections.map((kind) => this.#renderSection(kind, { site, template, img, proProfile, fleet, isDemo })).join('\n');

    return `<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site.seo.title)}</title>
<meta name="description" content="${esc(site.seo.description)}">
<meta name="keywords" content="${esc((site.seo.keywords || []).join(', '))}">
<meta property="og:title" content="${esc(site.name)}">
<meta property="og:description" content="${esc(site.tagline)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="${esc(site.theme.primary)}">
<link rel="canonical" href="${esc(site.seo.canonical || site.urls.live)}">
<script type="application/ld+json">${safeJsonForScript(localBusinessLd(site))}</script>
<style>${siteCss(site)}</style>
</head>
<body class="${isDemo ? 'is-preview' : ''}">
${isDemo ? `<div class="demo-bar">Unlisted preview of ${esc(site.name)} — nothing on this page is published yet. <a href="/business-studio">Open the studio</a></div>` : ''}
${sections}
<script>${siteJs(site)}</script>
</body>
</html>`;
  }

  #renderSection(kind, ctx) {
    const { site, template, img, proProfile, fleet, isDemo } = ctx;
    switch (kind) {
      case 'HEADER_NAV': {
        const links = site.sections.filter((s) => ['CATALOGUE', 'GALLERY', 'ABOUT', 'TESTIMONIALS', 'HOURS_LOCATION', 'BOOKING', 'FAQ', 'CONTACT'].includes(s));
        return `<header class="hdr">
  <a class="hdr-brand" href="#top">${esc(site.name)}</a>
  <a class="hdr-cta" href="#book">${esc(site.booking.label)}</a>
  <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-hidden="true">
  <label for="nav-toggle" class="nav-burger" aria-label="Open menu">☰</label>
  <nav class="nav-panel">
    <label for="nav-toggle" class="nav-close" aria-label="Close menu">✕</label>
    ${links.map((l) => `<a href="#${anchorFor(l)}">${esc(labelFor(l, template))}</a>`).join('\n    ')}
    <div class="nav-info">
      ${site.contact.phone ? `<a href="tel:${esc(site.contact.phone)}">📞 ${esc(site.contact.phone)}</a>` : ''}
      ${site.contact.whatsapp || site.contact.phone ? `<a href="${esc(whatsappFor(site))}">💬 WhatsApp us</a>` : ''}
      ${site.hours.length ? `<p>${esc(site.hours[0].day)}: ${esc(site.hours[0].time)}</p>` : ''}
    </div>
  </nav>
</header>`;
      }
      case 'HERO': {
        const hero = img(site.hero.image, `${site.name} hero`);
        return `<section class="hero" id="top"${hero ? ` style="background-image:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.7)),url('${esc(hero.src)}')"` : ''}>${hero?.aiGenerated ? '<p class="ai-hero-note">Illustrative image</p>' : ''}
  <p class="eyebrow">${esc(site.hero.eyebrow || 'Welcome to')}</p>
  <h1>${esc(site.hero.headline || site.name)}</h1>
  <p class="tagline">${esc(site.tagline)}</p>
  <div class="hero-cta">
    <a class="btn primary" href="#book">${esc(site.hero.primaryCta || site.booking.label)}</a>
    <a class="btn ghost" href="#catalogue">${esc(site.hero.secondaryCta || `See the ${template.catalogueLabel.toLowerCase()}`)}</a>
  </div>
  ${site.contact.suburb ? `<p class="hero-where">📍 ${esc(site.contact.suburb)}${site.contact.metro ? `, ${esc(site.contact.metro)}` : ''}</p>` : ''}
</section>`;
      }
      case 'CATALOGUE':
        return renderCatalogue(site, template, img);
      case 'GALLERY':
        return renderGallery(site, img);
      case 'ABOUT':
        return `<section class="about" id="about">
  <div class="about-grid">
    <div>${site.about.image ? `<img src="${esc(img(site.about.image, site.name).src)}" alt="${esc(site.name)}" loading="lazy">` : '<div class="about-placeholder"></div>'}</div>
    <div>
      <h2>Our story</h2>
      <p>${esc(site.about.story || site.description)}</p>
      <div class="stats">${(site.about.stats || []).map((s) => `<div class="stat"><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('')}</div>
    </div>
  </div>
</section>`;
      case 'TESTIMONIALS':
        return site.testimonials.length ? `<section class="quotes" id="testimonials">
  <h2>What people say</h2>
  <div class="quote-grid">${site.testimonials.map((t) => `<blockquote><p>“${esc(t.text)}”</p><footer>${esc(t.author)}${t.source ? ` · <span class="src">${esc(t.source)}</span>` : ''}${t.verified ? ' · <span class="verified">✓ escrow-verified</span>' : ''}</footer></blockquote>`).join('')}</div>
</section>` : '';
      case 'HOURS_LOCATION':
        return `<section class="hours" id="hours">
  <h2>Hours &amp; location</h2>
  <div class="hours-grid">
    <table>${site.hours.map((h) => `<tr><th>${esc(h.day)}</th><td>${esc(h.time)}</td></tr>`).join('')}</table>
    <div class="where">
      ${site.contact.address ? `<p>📍 ${esc(site.contact.address)}${site.contact.suburb ? `, ${esc(site.contact.suburb)}` : ''}</p>` : (site.contact.suburb ? `<p>📍 ${esc(site.contact.suburb)}${site.contact.metro ? `, ${esc(site.contact.metro)}` : ''}</p>` : '')}
      ${site.contact.phone ? `<p><a href="tel:${esc(site.contact.phone)}">📞 ${esc(site.contact.phone)}</a></p>` : ''}
      ${site.contact.email ? `<p><a href="mailto:${esc(site.contact.email)}">✉️ ${esc(site.contact.email)}</a></p>` : ''}
      ${site.contact.mapsUrl ? `<p><a href="${esc(site.contact.mapsUrl)}" rel="noopener">🗺️ Open in Maps</a></p>` : ''}
    </div>
  </div>
</section>`;
      case 'BOOKING':
        return renderBookingForm(site, template, isDemo);
      case 'TRUST_BLOCK':
        return proProfile ? renderTrustBlock(site, proProfile) : '';
      case 'FLEET':
        return fleet.length ? `<section class="fleet" id="fleet">
  <h2>The fleet</h2>
  <p class="note">Every vehicle below carries its ProVeri verification state and Service Passport — the same record a buyer would check before paying.</p>
  <div class="fleet-grid">${fleet.map((v) => `<div class="fleet-card"><strong>${esc(v.title)}</strong><span class="pill ${esc(v.tone)}">${esc(v.badge)}</span><p class="tiny">${esc(v.detail)}</p></div>`).join('')}</div>
</section>` : '';
      case 'FAQ':
        return site.faq.length ? `<section class="faq" id="faq"><h2>Before you ask</h2>${site.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>` : '';
      case 'CONTACT':
        return `<section class="contact" id="contact">
  <h2>Get hold of us</h2>
  <div class="contact-row">
    ${site.contact.phone ? `<a class="btn ghost" href="tel:${esc(site.contact.phone)}">📞 Call</a>` : ''}
    <a class="btn primary" href="${esc(whatsappFor(site))}" rel="noopener">💬 WhatsApp</a>
    ${Object.entries(site.social).filter(([, v]) => v).map(([k, v]) => `<a class="btn ghost" href="${esc(socialUrl(k, v))}" rel="noopener">${esc(k)}</a>`).join('')}
  </div>
</section>`;
      case 'FLOATING_CTA':
        return `<a class="float-cta" href="#book">${esc(site.booking.label)}</a>`;
      case 'FOOTER':
        return `<footer class="ftr">
  <div><strong>${esc(site.name)}</strong>${site.contact.suburb ? `<p>${esc(site.contact.suburb)}${site.contact.metro ? `, ${esc(site.contact.metro)}` : ''}</p>` : ''}</div>
  <div class="ftr-right">
    <p class="tiny">Site by <a href="/">ProVeri</a> · ${esc(site.plan.planName)} · ${esc(site.plan.updateCreditsTotal === -1 ? 'unlimited updates' : site.plan.updateCreditsTotal + ' updates/month included')}</p>
    ${site.proId ? `<p class="tiny"><a href="/p/${esc(site.slug)}">Verified pro profile →</a></p>` : ''}
    <p class="tiny muted">© ${new Date().getFullYear()} ${esc(site.name)}${isDemo ? ' · preview, not the published site' : ''}</p>
  </div>
</footer>`;
      case 'SPLASH':
        return '';
      default:
        return `<!-- unknown section ${esc(kind)} -->`;
    }
  }

  /**
   * The cross-vertical payoff: a transport or tour operator's site can show its
   * fleet with the *verification state* from the vehicles vertical, because both
   * run on the same kernel. No website builder can do that.
   */
  #fleetFor(site) {
    const dead = ['REMOVED', 'DISPUTED', 'REFUNDED', 'DRAFT', 'UNDER_REVIEW'];
    const listings = this.store.all('vehicles').filter((v) => !dead.includes(v.status));
    return listings.slice(0, 6).map((v) => ({
      title: v.title || [v.asset?.make, v.asset?.model, v.asset?.year].filter(Boolean).join(' ') || 'Fleet vehicle',
      badge: String(v.trustBadge || v.status).replace(/_/g, ' ').toLowerCase(),
      tone: ['VEHICLE_ESCROW_READY', 'VERIFIED', 'ELITE'].includes(v.trustBadge || v.status) ? 'verified' : 'warn',
      detail: [
        v.suburb || v.metro || site.contact.suburb,
        v.asset?.vin ? `VIN sealed ${String(v.asset.vin).slice(-4)}` : null,
        v.passport?.entries?.length ? `${v.passport.entries.length} passport entries` : null,
        v.odometerKm ? `${Number(v.odometerKm).toLocaleString('en-ZA')} km` : null,
      ].filter(Boolean).join(' · '),
      listingId: v.listingId,
    }));
  }

  /* ================================================================== *
   * EXPORT & DEPLOY — the equivalent of scripts/deploy-all.js
   * ================================================================== */

  /**
   * A self-contained single-file export. CSS is inlined and assets become data
   * URIs, which is the fix the reference implementation needed
   * (scripts/inline-images.js) to stop images breaking in sub-folder deploys.
   */
  exportSite(siteId, { inlineAssets = true } = {}) {
    const site = this.get(siteId);
    const html = this.renderSiteHtml(site.siteId, { inlineAssets });
    const bytes = Buffer.byteLength(html);
    site.stats.exportedAt = nowIso();
    site.updatedAt = nowIso();
    const record = {
      siteId: site.siteId,
      slug: site.slug,
      filename: `${site.slug}.html`,
      bytes,
      sha256: sha256(html),
      inlineAssets,
      exportedAt: site.stats.exportedAt,
      html,
      note: 'One file, no build step, no dependencies. Upload it anywhere or push it to GitHub Pages.',
    };
    this.kernel.ledger.append({
      action: 'BUSINESS_SITE_EXPORTED',
      subject: siteId,
      visibility: 'PRIVATE',
      payload: { summary: `${site.name}: exported ${record.filename} (${(bytes / 1024).toFixed(1)} KB, sha256 ${record.sha256.slice(0, 12)}). The client owns this file.`, bytes },
    });
    return record;
  }

  /**
   * The whole account as a deploy folder: one file per site, a gallery index,
   * a sitemap, and a ready-to-use GitHub Actions workflow — mirroring
   * deploy-all.js plus the reference repo's Pages pipeline.
   */
  exportBundle({ status = null } = {}) {
    const sites = this.store.all('businessSites').filter((s) => (status ? s.status === status : s.status !== SITE_STATUS.ARCHIVED));
    const files = sites.map((s) => {
      const exported = this.exportSite(s.siteId);
      return { path: `${s.slug}/index.html`, bytes: exported.bytes, sha256: exported.sha256 };
    });
    return {
      generatedAt: nowIso(),
      siteCount: sites.length,
      files,
      indexHtml: this.renderSitesIndexHtml(sites.map((s) => deepClone(s))),
      sitemap: renderSitemap(sites),
      robots: 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n',
      workflow: GITHUB_ACTIONS_WORKFLOW,
      readme: renderBundleReadme(sites),
      totalBytes: files.reduce((n, f) => n + f.bytes, 0),
      targets: planData.deployment.targets,
    };
  }

  renderSitesIndexHtml(sites = null) {
    const rows = sites || this.store.all('businessSites').filter((s) => s.status !== SITE_STATUS.ARCHIVED);
    return `<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live business sites · ProVeri</title>
<style>${indexCss()}</style></head>
<body><div class="wrap">
<header><h1>ProVeri</h1><p class="sub">Business sites built on the studio — every booking form below is live</p></header>
<main class="grid">${rows.map((s) => `<a class="card" href="${esc(s.status === SITE_STATUS.LIVE ? `/s/${s.slug}` : `/preview/${s.slug}`)}">
  <span class="ico">${esc(this.template(s.templateId).icon)}</span>
  <h2>${esc(s.name)}</h2>
  <p>${esc(s.tagline)}</p>
  <div class="meta"><span class="pill ${esc(s.status === SITE_STATUS.LIVE ? 'verified' : 'warn')}">${esc(s.status.toLowerCase())}</span><span class="tiny">${esc(s.plan.planName)}</span></div>
</a>`).join('\n')}</main>
<footer><p>${rows.length} site(s) · generated ${esc(nowIso().slice(0, 10))} · ProVeri 🇿🇦</p></footer>
</div></body></html>`;
  }

  /* ================================================================== *
   * STATS
   * ================================================================== */

  stats() {
    const sites = this.store.all('businessSites');
    const bookings = this.store.all('siteBookings');
    const subscriptions = this.store.all('siteSubscriptions');
    const assets = this.store.all('siteAssets');
    return {
      sites: sites.length,
      live: sites.filter((s) => s.status === SITE_STATUS.LIVE).length,
      preview: sites.filter((s) => s.status === SITE_STATUS.PREVIEW).length,
      blocked: sites.filter((s) => s.status === SITE_STATUS.BLOCKED).length,
      byTemplate: sites.reduce((acc, s) => { acc[s.templateId] = (acc[s.templateId] || 0) + 1; return acc; }, {}),
      bookings: bookings.length,
      bookingsConvertedToJobs: bookings.filter((b) => b.status === BOOKING_STATUS.CONVERTED_TO_JOB).length,
      bookingValueQuotedCents: bookings.reduce((n, b) => n + (b.amountQuotedCents || 0), 0),
      subscriptionsActive: subscriptions.filter((s) => s.status === SUBSCRIPTION_STATUS.ACTIVE).length,
      monthlyRecurringCents: subscriptions.filter((s) => s.status === SUBSCRIPTION_STATUS.ACTIVE).reduce((n, s) => n + s.monthlyCents, 0),
      annualisedRecurringCents: subscriptions.filter((s) => s.status === SUBSCRIPTION_STATUS.ACTIVE).reduce((n, s) => n + s.monthlyCents * 12, 0),
      assets: assets.length,
      assetsPermissionCleared: assets.filter((a) => a.permission || ['proveri-generated', 'licensed-stock'].includes(a.source)).length,
      assetsAiGenerated: assets.filter((a) => a.aiGenerated).length,
      permissionGatesBlocked: sites.filter((s) => s.permissions && !s.permissions.gateOpen).length,
      updatesLogged: this.store.count('siteUpdates'),
      templates: templateData.templates.length,
      plans: planData.plans.length,
    };
  }
}

/* ==================================================================== *
 * Render helpers (module-level, pure)
 * ==================================================================== */

function anchorFor(kind) {
  return { CATALOGUE: 'catalogue', GALLERY: 'gallery', ABOUT: 'about', TESTIMONIALS: 'testimonials', HOURS_LOCATION: 'hours', BOOKING: 'book', FAQ: 'faq', CONTACT: 'contact', FLEET: 'fleet', TRUST_BLOCK: 'trust' }[kind] || kind.toLowerCase();
}

function labelFor(kind, template) {
  return { CATALOGUE: template.catalogueLabel, GALLERY: 'Gallery', ABOUT: 'About', TESTIMONIALS: 'Reviews', HOURS_LOCATION: 'Hours', BOOKING: template.booking.label, FAQ: 'FAQ', CONTACT: 'Contact', FLEET: 'Fleet', TRUST_BLOCK: 'Why trust us' }[kind] || kind;
}

function whatsappFor(site) {
  const raw = site.contact.whatsapp || site.contact.phone;
  if (!raw) return '#contact';
  return `https://wa.me/27${String(raw).replace(/[^0-9]/g, '').replace(/^0/, '').replace(/^27/, '')}`;
}

function socialUrl(kind, handle) {
  const value = String(handle).trim();
  if (/^https?:\/\//.test(value)) return value;
  const clean = value.replace(/^@/, '');
  return { instagram: `https://instagram.com/${clean}`, facebook: `https://facebook.com/${clean}`, tiktok: `https://tiktok.com/@${clean}` }[kind] || `https://${kind}.com/${clean}`;
}

function renderCatalogue(site, template, img) {
  const categories = site.catalogue.filter((c) => c.items.length);
  if (!categories.length) return '';
  const tabs = categories.map((c, i) => `<input type="radio" name="cat" id="cat-${i}" class="cat-radio"${i === 0 ? ' checked' : ''}><label for="cat-${i}" class="cat-tab">${esc(c.name)}</label>`).join('');
  const panels = categories.map((c, i) => `<div class="cat-panel" data-cat="${i}">
    <div class="items">${c.items.map((item) => {
      const image = img(item.image, item.name);
      return `<article class="item">
      ${image ? `<div class="item-img"><img src="${esc(image.src)}" alt="${esc(item.name)}" loading="lazy">${image.aiGenerated ? '<span class="ai-note">illustrative image</span>' : ''}</div>` : ''}
      <div class="item-body">
        <h3>${esc(item.name)}${item.popular ? ' <span class="pill gold">popular</span>' : ''}</h3>
        <p>${esc(item.description)}</p>
        <div class="item-foot">
          <span class="price">${esc(item.price)}</span>
          <a class="btn sm" href="#book" data-item="${esc(item.name)}" data-price="${esc(item.price)}">${esc(template.booking.label)}</a>
        </div>
      </div>
    </article>`;
    }).join('')}</div>
  </div>`).join('');
  return `<section class="catalogue" id="catalogue">
  <h2>${esc(template.catalogueLabel)}</h2>
  <div class="cat-tabs">${tabs}</div>
  ${panels}
</section>`;
}

function renderGallery(site, img) {
  const images = site.gallery.map((id) => img(id, `${site.name} photo`)).filter(Boolean);
  if (!images.length) return '';
  return `<section class="gallery" id="gallery">
  <h2>A look inside</h2>
  <div class="gal-grid">${images.map((image, i) => `<a class="gal" href="#gal-${i}"><img src="${esc(image.src)}" alt="${esc(image.alt)}" loading="lazy">${image.aiGenerated ? '<span class="ai-note">illustrative</span>' : ''}</a>
  <div class="lightbox" id="gal-${i}"><a class="lb-close" href="#gallery">✕</a><img src="${esc(image.src)}" alt="${esc(image.alt)}"><p>${esc(image.alt)}</p></div>`).join('')}</div>
</section>`;
}

function renderBookingForm(site, template, isDemo) {
  const fields = site.booking.fields.map((f) => renderField(f, site)).join('');
  const fallback = whatsappFor(site);
  return `<section class="booking" id="book">
  <h2>${esc(site.booking.label)}</h2>
  <p class="note">${esc(isDemo ? 'This preview is not published yet — submissions are captured as sales leads.' : site.booking.confirmation)}</p>
  <form class="bform" method="post" action="/api/sites/${esc(site.slug)}/bookings" data-site="${esc(site.siteId)}">
    ${fields}
    <button class="btn primary block" type="submit">${esc(site.booking.submitLabel)}</button>
    <p class="result" role="status" aria-live="polite"></p>
  </form>
  <noscript><p class="note">JavaScript is off — <a href="${esc(fallback)}">send this on WhatsApp instead</a>, or call ${esc(site.contact.phone || 'us')}.</p></noscript>
</section>`;
}

function renderField(field, site) {
  const required = field.required ? ' required' : '';
  const placeholder = field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : '';
  const label = `<label for="f-${esc(field.name)}">${esc(field.label)}${field.required ? ' <span class="req">*</span>' : ''}</label>`;
  switch (field.type) {
    case 'textarea':
      return `<div class="field span2">${label}<textarea id="f-${esc(field.name)}" name="${esc(field.name)}" rows="3"${required}${placeholder}></textarea></div>`;
    case 'select': {
      const options = optionsFor(field, site);
      return `<div class="field">${label}<select id="f-${esc(field.name)}" name="${esc(field.name)}"${required}>
        ${field.required ? '' : '<option value="">—</option>'}
        ${options.map((o) => `<option value="${esc(o)}"${String(field.default) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}
      </select></div>`;
    }
    case 'date': {
      const today = nowIso().slice(0, 10);
      return `<div class="field">${label}<input id="f-${esc(field.name)}" type="date" name="${esc(field.name)}" min="${esc(today)}"${required}></div>`;
    }
    default:
      return `<div class="field">${label}<input id="f-${esc(field.name)}" type="${esc(field.type === 'tel' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text')}" name="${esc(field.name)}" inputmode="${esc(field.type === 'tel' ? 'tel' : field.type === 'number' ? 'decimal' : 'text')}"${required}${placeholder}></div>`;
  }
}

function optionsFor(field, site) {
  if (field.options?.length) return field.options;
  if (field.name === 'service' || field.name === 'treatment' || field.name === 'tour' || field.name === 'item' || field.name === 'room' || field.name === 'tasting') {
    const names = site.catalogue.flatMap((c) => c.items.map((i) => i.name));
    return names.length ? names : ['Recommend for me'];
  }
  return [];
}

function renderTrustBlock(site, profile) {
  return `<section class="trust" id="trust">
  <h2>Why you can check us instead of trusting us</h2>
  <div class="trust-grid">
    <div class="trust-score"><strong>${esc(profile.trustScore)}</strong><span>ProVeri trust score out of 100</span><em>${esc(String(profile.badge).replace(/_/g, ' '))}</em></div>
    <ul class="checks">${(profile.explanation?.reasons || []).slice(0, 6).map((c) => `<li>${esc(c.icon || '✓')} ${esc(c.text)}</li>`).join('')}</ul>
    <div class="escrow-note">
      <p><strong>Money in escrow, not in advance.</strong> When you book through ProVeri, your payment is held by a licensed provider and only released after you confirm the work — with 5% held back for a 14-day workmanship warranty.</p>
      <p class="tiny">Reviews below are from customers whose escrow released on this pro. Ratings cannot be bought.</p>
      ${profile.ratings?.count ? `<p class="rating">${esc(profile.ratings.average)}★ from ${esc(profile.ratings.count)} escrow-backed review(s)</p>` : '<p class="rating">New on ProVeri — no escrow-backed reviews yet, and we will not invent any.</p>'}
      <p class="tiny mono">audit seal ${esc(String(profile.proofDigest || '').slice(0, 16))}</p>
      <p><a class="btn ghost sm" href="/trust">See the public trust ledger</a></p>
    </div>
  </div>
</section>`;
}

/**
 * JSON-LD is parsed by search engines as JSON, not as HTML text — escaping the
 * quotes would silently break structured data. The only thing that has to be
 * neutralised inside a <script> element is a closing tag.
 */
function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function localBusinessLd(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: site.name,
    description: site.description,
    url: site.seo.canonical,
    telephone: site.contact.phone || undefined,
    email: site.contact.email || undefined,
    address: {
      '@type': 'PostalAddress',
      addressLocality: site.contact.suburb || undefined,
      addressRegion: site.contact.metro || undefined,
      addressCountry: 'ZA',
      streetAddress: site.contact.address || undefined,
    },
    openingHours: site.hours.map((h) => `${h.day}: ${h.time}`),
    priceRange: site.catalogue.flatMap((c) => c.items.map((i) => i.price)).filter(Boolean).slice(0, 3).join(', ') || undefined,
    sameAs: Object.entries(site.social).filter(([, v]) => v).map(([k, v]) => socialUrl(k, v)),
  };
}

/* ---- CSS: written once, themed with custom properties ---- */

function siteCss(site) {
  const t = site.theme;
  return `:root{--primary:${t.primary};--secondary:${t.secondary};--accent:${t.accent};--dark:${t.dark};--light:${t.light};--display:"${t.fontDisplay}",Georgia,serif;--r:14px}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--dark);color:var(--light);line-height:1.55;-webkit-text-size-adjust:100%}
img{max-width:100%;display:block}
a{color:inherit}
h1,h2,h3{font-family:var(--display);line-height:1.15}
h2{font-size:clamp(1.6rem,4vw,2.4rem);margin-bottom:.6rem}
section{padding:clamp(2.5rem,7vw,5rem) clamp(1rem,4vw,2rem);max-width:1100px;margin:0 auto}
section:nth-of-type(even){background:rgba(255,255,255,.03);max-width:none}
section:nth-of-type(even)>*{max-width:1100px;margin-left:auto;margin-right:auto}
.note{color:var(--secondary);margin-bottom:1.4rem;max-width:60ch}
.tiny{font-size:.78rem}.muted{opacity:.7}.mono{font-family:ui-monospace,Menlo,monospace}
.btn{display:inline-block;padding:.85rem 1.5rem;border-radius:999px;font-weight:600;text-decoration:none;border:2px solid transparent;cursor:pointer;font-size:1rem;transition:transform .15s ease}
.btn.primary{background:var(--primary);color:var(--light)}
.btn.primary:hover{transform:scale(1.03)}
.btn.ghost{border-color:rgba(255,255,255,.3);color:var(--light)}
.btn.ghost:hover{border-color:var(--accent)}
.btn.sm{padding:.45rem .9rem;font-size:.85rem}
.btn.block{width:100%;margin-top:.4rem}
.pill{display:inline-block;padding:.15rem .6rem;border-radius:999px;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;background:rgba(255,255,255,.12)}
.pill.gold{background:var(--accent);color:#111}
.pill.verified{background:#0e7c5a;color:#fff}
.pill.elite{background:#b8860b;color:#fff}
.pill.warn{background:#c9861a;color:#111}
.ai-hero-note{position:absolute;top:4.2rem;right:1rem;background:rgba(0,0,0,.7);color:#fff;font-size:.7rem;padding:.25rem .6rem;border-radius:999px;letter-spacing:.04em}
.demo-bar{position:sticky;top:0;z-index:80;background:#c9861a;color:#111;text-align:center;padding:.5rem;font-size:.85rem;font-weight:600}
.demo-bar a{color:#111;text-decoration:underline}
.hdr{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:.75rem;padding:.7rem clamp(1rem,4vw,2rem);background:rgba(0,0,0,.72);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.08)}
.is-preview .hdr{top:2rem}
.hdr-brand{font-family:var(--display);font-weight:700;font-size:1.15rem;text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hdr-cta{padding:.45rem .95rem;border-radius:999px;background:var(--primary);color:var(--light);font-size:.85rem;font-weight:600;text-decoration:none}
.nav-toggle{position:absolute;opacity:0;pointer-events:none}
.nav-burger{width:40px;height:40px;border-radius:50%;background:#fff;color:#000;display:grid;place-items:center;font-size:1.1rem;cursor:pointer}
.nav-close{position:absolute;top:1rem;right:1.2rem;font-size:1.4rem;cursor:pointer;color:#fff}
.nav-panel{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.96);display:flex;flex-direction:column;justify-content:center;gap:1.1rem;padding:2rem;transform:translateY(-100%);transition:transform .3s ease}
.nav-panel a{font-family:var(--display);font-size:1.6rem;text-decoration:none}
.nav-toggle:checked~.nav-panel{transform:translateY(0)}
.nav-info{margin-top:1.5rem;display:flex;flex-direction:column;gap:.4rem;font-size:.95rem;color:var(--secondary)}
.hero{min-height:82vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background-size:cover;background-position:center;position:relative}
.hero:not([style]){background:radial-gradient(circle at 50% 30%,color-mix(in srgb,var(--primary) 55%,#000),var(--dark))}
.eyebrow{letter-spacing:.3em;text-transform:uppercase;color:var(--accent);font-size:.8rem;margin-bottom:.8rem}
.hero h1{font-size:clamp(2.4rem,9vw,5rem);margin-bottom:.6rem;text-shadow:0 2px 24px rgba(0,0,0,.5)}
.tagline{font-size:clamp(1.05rem,3vw,1.5rem);color:rgba(255,255,255,.88);max-width:34ch;margin-bottom:1.6rem}
.hero-cta{display:flex;gap:.8rem;flex-wrap:wrap;justify-content:center}
.hero-where{margin-top:1.4rem;font-size:.9rem;color:rgba(255,255,255,.75)}
.cat-tabs{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0 1.6rem}
.cat-radio{position:absolute;opacity:0;pointer-events:none}
.cat-tab{padding:.55rem 1.1rem;border-radius:999px;background:rgba(255,255,255,.07);cursor:pointer;font-weight:600;font-size:.9rem}
.cat-radio:checked+.cat-tab{background:var(--primary);color:var(--light)}
.cat-panel{display:none}
.items{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.item{background:rgba(255,255,255,.05);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column}
.item-img{aspect-ratio:4/3;overflow:hidden;background:rgba(255,255,255,.05)}
.item-img img{width:100%;height:100%;object-fit:cover}
.item-body{padding:1rem;display:flex;flex-direction:column;gap:.4rem;flex:1}
.item-body h3{font-size:1.1rem}
.item-body p{color:var(--secondary);font-size:.9rem;flex:1}
.item-foot{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-top:.4rem}
.price{font-weight:700;color:var(--accent)}
.ai-note{position:absolute;bottom:.4rem;left:.4rem;background:rgba(0,0,0,.75);color:#fff;font-size:.65rem;padding:.15rem .45rem;border-radius:6px}
.item-img,.gal{position:relative}
.gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem}
.gal img{aspect-ratio:1;object-fit:cover;width:100%;border-radius:10px}
.lightbox{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.94);display:none;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem;gap:.8rem}
.lightbox:target{display:flex}
.lightbox img{max-height:76vh;width:auto;border-radius:10px}
.lb-close{position:absolute;top:1rem;right:1.4rem;font-size:1.8rem;color:#fff;text-decoration:none}
.about-grid{display:grid;gap:2rem;grid-template-columns:1fr}
.about-grid img,.about-placeholder{border-radius:var(--r);aspect-ratio:4/5;object-fit:cover;width:100%}
.about-placeholder{background:linear-gradient(160deg,var(--primary),transparent)}
.stats{display:flex;gap:1.4rem;flex-wrap:wrap;margin-top:1.4rem}
.stat strong{display:block;font-family:var(--display);font-size:1.8rem;color:var(--accent)}
.stat span{font-size:.82rem;color:var(--secondary)}
.quote-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
blockquote{background:rgba(255,255,255,.05);padding:1.2rem;border-radius:var(--r);border-left:3px solid var(--accent)}
blockquote p{font-family:var(--display);font-size:1.02rem}
blockquote footer{margin-top:.7rem;font-size:.8rem;color:var(--secondary)}
blockquote .verified{color:#4ade80}
.hours-grid{display:grid;gap:1.6rem;grid-template-columns:1fr}
.hours table{width:100%;border-collapse:collapse}
.hours th,.hours td{text-align:left;padding:.5rem .3rem;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:.92rem}
.hours th{color:var(--secondary);width:45%}
.where a{text-decoration:none;border-bottom:1px solid rgba(255,255,255,.25)}
.bform{display:grid;gap:.9rem;grid-template-columns:1fr 1fr;background:rgba(255,255,255,.05);padding:1.3rem;border-radius:var(--r)}
.field{display:flex;flex-direction:column;gap:.3rem}
.field.span2{grid-column:1/-1}
.field label{font-size:.82rem;color:var(--secondary)}
.req{color:var(--accent)}
.field input,.field select,.field textarea{padding:.75rem .9rem;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.35);color:var(--light);font-size:1rem;font-family:inherit}
.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
.bform .btn.block{grid-column:1/-1}
.result{grid-column:1/-1;font-size:.9rem;min-height:1.2em}
.result.ok{color:#4ade80}.result.err{color:#f87171}
.trust{background:linear-gradient(160deg,rgba(14,124,90,.22),transparent);border-radius:var(--r)}
.trust-grid{display:grid;gap:1.4rem;grid-template-columns:1fr}
.trust-score{background:rgba(0,0,0,.35);border-radius:var(--r);padding:1.3rem;text-align:center}
.trust-score strong{font-family:var(--display);font-size:3.4rem;color:#4ade80;display:block;line-height:1}
.trust-score span{font-size:.85rem;color:var(--secondary)}
.trust-score em{display:inline-block;margin-top:.5rem;font-style:normal;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;background:#0e7c5a;padding:.2rem .6rem;border-radius:999px}
.checks{list-style:none;display:grid;gap:.45rem}
.checks li{font-size:.92rem;background:rgba(255,255,255,.05);padding:.55rem .8rem;border-radius:10px}
.escrow-note p{margin-bottom:.5rem;font-size:.93rem}
.rating{font-weight:700;color:var(--accent)}
.fleet-grid{display:grid;gap:.8rem;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.fleet-card{background:rgba(255,255,255,.05);padding:1rem;border-radius:var(--r)}
.fleet-card strong{display:block;margin-bottom:.3rem}
.faq details{background:rgba(255,255,255,.05);border-radius:10px;padding:.9rem 1.1rem;margin-bottom:.6rem}
.faq summary{cursor:pointer;font-weight:600}
.faq p{margin-top:.5rem;color:var(--secondary);font-size:.92rem}
.contact-row{display:flex;gap:.7rem;flex-wrap:wrap}
.float-cta{position:fixed;bottom:1.1rem;right:1.1rem;z-index:55;background:var(--primary);color:var(--light);padding:.9rem 1.4rem;border-radius:999px;font-weight:700;text-decoration:none;box-shadow:0 8px 28px rgba(0,0,0,.45)}
.ftr{display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;padding:2.4rem clamp(1rem,4vw,2rem);border-top:1px solid rgba(255,255,255,.08);max-width:none;background:#000}
.ftr a{color:var(--accent)}
.ftr-right{text-align:right}
@media(min-width:760px){.about-grid,.hours-grid,.trust-grid{grid-template-columns:1fr 1fr}.trust-score{grid-column:1}.trust-grid{grid-template-columns:220px 1fr 1fr}}
@media(max-width:520px){.bform{grid-template-columns:1fr}.hdr-cta{display:none}}`;
}

function indexCss() {
  return `*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:linear-gradient(140deg,#0b1a15,#101c2c);color:#fff;min-height:100vh;padding:3rem 1.2rem}
.wrap{max-width:1000px;margin:0 auto}header{text-align:center;margin-bottom:2.6rem}
h1{font-size:2.4rem}.sub{color:#7fd6b4;margin-top:.4rem}
.grid{display:grid;gap:1.1rem;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:1.5rem;text-decoration:none;transition:transform .2s ease,border-color .2s}
.card:hover{transform:translateY(-4px);border-color:#0e7c5a}
.ico{font-size:1.8rem}.card h2{font-size:1.25rem;margin:.5rem 0 .3rem}
.card p{color:rgba(255,255,255,.65);font-size:.9rem;margin-bottom:1rem}
.meta{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.pill{padding:.15rem .6rem;border-radius:999px;font-size:.7rem;text-transform:uppercase}
.pill.verified{background:#0e7c5a}.pill.warn{background:#c9861a;color:#111}
.tiny{font-size:.78rem;color:rgba(255,255,255,.5)}
footer{text-align:center;margin-top:3rem;color:rgba(255,255,255,.4);font-size:.85rem}`;
}

/** Progressive enhancement only: the form works via POST without it. */
function siteJs(site) {
  return `(function(){
  var f=document.querySelector('.bform');if(!f)return;
  var out=f.querySelector('.result');
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var data={};new FormData(f).forEach(function(v,k){data[k]=v;});
    out.className='result';out.textContent='Sending…';
    fetch(f.getAttribute('action'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){
        if(!res.ok){out.className='result err';out.textContent=res.j.message||'Something went wrong — please call us instead.';return;}
        var b=res.j;out.className='result ok';
        out.textContent='✓ '+(b.reference||'Received')+' — '+(b.nextStep||b.customerMessage||'We will be in touch.');
        f.reset();
        if(b.job&&b.job.url){var a=document.createElement('a');a.href=b.job.url;a.textContent='Track your job '+b.job.reference;a.className='btn ghost sm';a.style.marginTop='.6rem';out.appendChild(document.createElement('br'));out.appendChild(a);}
      })
      .catch(function(){out.className='result err';out.textContent='Could not reach the server. WhatsApp us instead — the link is in the contact section.';});
  });
  document.querySelectorAll('.item .btn[data-item]').forEach(function(b){
    b.addEventListener('click',function(){
      var sel=document.querySelector('#f-service')||document.querySelector('#f-item')||document.querySelector('#f-treatment')||document.querySelector('#f-tour')||document.querySelector('#f-room');
      if(sel){sel.value=b.getAttribute('data-item');}
      var n=document.querySelector('#f-notes');if(n&&!n.value){n.value=b.getAttribute('data-item')+' ('+b.getAttribute('data-price')+')';}
    });
  });
})();`;
}

const GITHUB_ACTIONS_WORKFLOW = `name: Deploy business sites

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Export sites from ProVeri
        run: |
          mkdir -p deploy
          curl -sf "\$PROVERI_URL/api/sites/export-bundle?format=files" -o bundle.json
          node scripts/write-bundle.js bundle.json deploy
        env:
          PROVERI_URL: \${{ secrets.PROVERI_URL }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./deploy
      - id: deployment
        uses: actions/deploy-pages@v4
`;

function renderSitemap(sites) {
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '<url><loc>/</loc><priority>1.0</priority></url>',
    ...sites.filter((s) => s.status === SITE_STATUS.LIVE).map((s) => `<url><loc>/s/${s.slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
    '</urlset>'].join('\n');
}

function renderBundleReadme(sites) {
  return `# ProVeri — exported business sites

Generated ${nowIso().slice(0, 10)}. ${sites.length} site(s), each a single self-contained HTML file.

## Publish

- **ProVeri hosting** — already live at /s/<slug>, SSL and backups included.
- **GitHub Pages** — push this folder to a public repo, set Pages → Source: GitHub Actions, and drop in \`.github/workflows/deploy.yml\` from this bundle.
- **Anywhere else** — upload each \`<slug>/index.html\`. No build step, no dependencies, no broken relative paths: assets are inlined as data URIs.

## Sites

${sites.map((s) => `- \`${s.slug}/index.html\` — ${s.name} (${s.industry}, ${s.status.toLowerCase()}, ${s.plan.planName})`).join('\n')}

## Before you publish anything new

${planData.permissions.checklist.map((c) => `- [ ] ${c.label}`).join('\n')}

Credit is not permission. Where a face is identifiable, POPIA consent is required in addition to copyright clearance — ProVeri refuses to publish a site whose assets have no permission record (policy WEB-002).
`;
}

/* ---- small pure helpers ---- */

function parsePrice(price) {
  const match = /R?\s?([\d,]+(?:\.\d{1,2})?)/.exec(String(price || ''));
  if (!match) return 0;
  return Math.round(parseFloat(match[1].replace(/,/g, '')) * 100);
}

function bytesOf(filename) {
  const match = /(\d+)(kb|mb)/i.exec(String(filename || ''));
  if (!match) return 0;
  return Number(match[1]) * (match[2].toLowerCase() === 'mb' ? 1024 * 1024 : 1024);
}

function bytesHint(bytes) {
  if (!bytes) return 'unknown';
  if (bytes > 4 * 1024 * 1024) return 'too heavy — compress before publishing';
  if (bytes < 60 * 1024) return 'low resolution — fine for a thumbnail, soft on a hero';
  return 'good';
}

/**
 * Every theme carries its own contrast numbers: the studio shows them next to
 * the palette, and WCAG AA is checked before a custom palette is accepted.
 */
function withContrast(theme) {
  const ratio = contrastRatio(theme.light, theme.dark);
  return { ...theme, contrastRatio: ratio, contrastOk: ratio >= 4.5 };
}

function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const rgb = String(hex).replace('#', '');
    const full = rgb.length === 3 ? rgb.split('').map((c) => c + c).join('') : rgb;
    const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = lum(hexA);
  const b = lum(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

function checklistSatisfied(id, { popiaConsent, identifiablePeople, licence, creditRequired, targets }) {
  switch (id) {
    case 'OWNER_PERMISSION': return targets.length > 0;
    case 'COPYRIGHT_CLEARED': return ['owner-cleared', 'licensed-stock', 'creator-licensed'].includes(licence);
    case 'POPIA_CONSENT': return identifiablePeople ? Boolean(popiaConsent) : true;
    case 'PERMISSION_STORED': return true;
    case 'AI_LABELLED': return true;
    case 'CREDIT_RECORDED': return creditRequired ? Boolean(creditRequired) : true;
    default: return false;
  }
}

function summariseBooking(template, values) {
  const parts = [];
  if (values.guests) parts.push(`${values.guests} guest(s)`);
  if (values.passengers) parts.push(`${values.passengers} passenger(s)`);
  if (values.travellers) parts.push(`${values.travellers} traveller(s)`);
  if (values.date) parts.push(values.date);
  if (values.time) parts.push(values.time);
  if (values.checkIn) parts.push(`${values.checkIn} → ${values.checkOut || '?'}`);
  if (values.pickup) parts.push(`${values.pickup} → ${values.dropoff || '?'}`);
  const item = values.service || values.treatment || values.tour || values.item || values.room || values.tasting || values.orderType;
  if (item) parts.unshift(item);
  return `${template.booking.label}: ${parts.join(' · ') || 'enquiry'}`;
}

function quoteFromBooking(site, values) {
  const wanted = values.service || values.treatment || values.tour || values.item || values.room || values.tasting || values.vehicle || null;
  const heads = Math.max(1, Number(values.guests || values.passengers || values.travellers || 1) || 1);
  const all = site.catalogue.flatMap((c) => c.items);

  const priceOf = (item) => {
    if (!item?.priceCents) return 0;
    return /(pp|p\/p|per person|per night|p\/night)/i.test(String(item.price)) ? item.priceCents * heads : item.priceCents;
  };

  if (wanted) {
    const needle = String(wanted).toLowerCase();
    const exact = all.find((i) => i.name.toLowerCase() === needle);
    if (exact) return priceOf(exact);
    // Token overlap: "9-seater" should find "Private transfer — 9-seater".
    const tokens = needle.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const scored = all
      .map((i) => {
        const name = i.name.toLowerCase();
        const hits = tokens.filter((t) => name.includes(t)).length;
        return { item: i, hits };
      })
      .filter((r) => r.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    if (scored.length) return priceOf(scored[0].item);
  }
  if (values.budget) return Math.round(Number(values.budget) * 100);
  // Nothing was matched and no budget was stated. Quoting the first priced thing
  // on the menu would put a made-up number in front of a customer, so we quote
  // nothing and let the business respond — "to be quoted" is the honest answer.
  return 0;
}

function describeBooking(site, booking, values) {
  const lines = [
    `Booked through ${site.name}'s website (${site.urls.live}).`,
    '',
    `Request: ${booking.summary}`,
    `Quoted amount: ${booking.amountQuotedCents ? `R${(booking.amountQuotedCents / 100).toLocaleString('en-ZA')}` : 'to be quoted'}`,
    `Reference: ${booking.reference}`,
  ];
  for (const [key, value] of Object.entries(values)) lines.push(`${key}: ${value}`);
  lines.push('', 'This job was created by a booking on the business\'s own ProVeri site, so the customer already chose this business.');
  return lines.join('\n');
}

function mapUrgency(value) {
  const v = String(value || '').toUpperCase();
  if (v.startsWith('URGENT')) return 'URGENT';
  if (v.startsWith('SCHEDULED')) return 'SCHEDULED';
  if (v.startsWith('FLEXIBLE')) return 'FLEXIBLE';
  return 'SOON';
}

function pickCategory(catalog, { pro, values, site }) {
  const wanted = `${values.service || ''} ${values.notes || ''} ${values.item || ''}`.toLowerCase();
  const fromPro = pro?.primaryCategory ? catalog.get(pro.primaryCategory) : null;
  if (wanted.trim()) {
    const resolved = catalog.resolveFromText(wanted);
    if (resolved?.categoryId) {
      try { return catalog.get(resolved.categoryId); } catch { /* fall through */ }
    }
  }
  if (fromPro) return fromPro;
  const all = catalog.listCategories({ search: site.templateId === 'trade-services' ? 'handyman' : site.industry });
  return all[0] ? catalog.get(all[0].id) : null;
}

function site0Tagline(sample, name) {
  return sample?.tagline || `${name} — online`;
}

function site0Catalogue(sample) {
  return sample ? sample.catalogue : [];
}

module.exports = {
  BusinessSiteStudio,
  SITE_STATUS,
  BOOKING_STATUS,
  SUBSCRIPTION_STATUS,
  templateData,
  planData,
  slugify,
  titleCase,
  contrastRatio,
  parsePrice,
};
