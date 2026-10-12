'use strict';

/**
 * Lula ProVeri — Web Studio.
 *
 * ServicePro's Web Studio sells websites on a "preview first, pay after"
 * promise. ProVeri keeps the promise and changes the economics:
 *
 *   1. Every verified pro already gets a **free, auto-generated microsite**
 *      that is data-bound to their live profile — trust badge, verified reviews,
 *      availability, instant-book button, portfolio from proof-of-work evidence.
 *      It never goes stale because it is generated from the ledger, not
 *      hand-maintained. That is the acquisition wedge: a pro signs up for jobs
 *      and leaves with a website.
 *
 *   2. Paid packages mirror ServicePro's published catalogue and pricing so the
 *      comparison is honest, but each one is delivered through the *same* escrow
 *      and milestone machinery as a plumbing job — preview approved = milestone 1
 *      released, site live = milestone 2. Nobody has to trust a web agency.
 *
 *   3. Growth services (Google Business Profile, WhatsApp Business automation,
 *      local ad campaigns, brand kits) are sold the same way, with the honest
 *      boundaries ServicePro publishes preserved verbatim — we do not promise
 *      rankings we cannot control.
 */

const path = require('node:path');
const fs = require('node:fs');
const { idFor, nextId, nowIso, sha256, deepClone, fingerprint, addDays } = require('../kernel/util');

const webStudioData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'webstudio.json'), 'utf8'));

const ORDER_STATUS = Object.freeze({
  ENQUIRY: 'ENQUIRY',
  QUOTED: 'QUOTED',
  PREVIEW_BUILDING: 'PREVIEW_BUILDING',
  PREVIEW_READY: 'PREVIEW_READY',
  PREVIEW_APPROVED: 'PREVIEW_APPROVED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAID: 'PAID',
  IN_BUILD: 'IN_BUILD',
  READY_FOR_HANDOVER: 'READY_FOR_HANDOVER',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED',
});

const SITE_KIND = Object.freeze({
  PRO_MICROSITE: 'PRO_MICROSITE',
  DIGITAL_STOREFRONT: 'DIGITAL_STOREFRONT',
  WEBSITE_AS_A_SERVICE: 'WEBSITE_AS_A_SERVICE',
  BUSINESS_GROWTH: 'BUSINESS_GROWTH',
  ECOMMERCE: 'ECOMMERCE',
  RESCUE: 'RESCUE',
  PORTFOLIO: 'PORTFOLIO',
});

class WebStudioService {
  constructor({ store, kernel, catalog, people }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.people = people;
  }

  packages() {
    return webStudioData.packages.map((pkg) => ({
      ...pkg,
      priceDisplay: `R${(pkg.priceCents / 100).toLocaleString('en-ZA')}${pkg.recurringCents ? ` + R${(pkg.recurringCents / 100).toLocaleString('en-ZA')}/month` : ' once-off'}`,
      escrowProtected: pkg.escrow,
      deliveryDays: pkg.deliveryDays,
    }));
  }

  growthServices() {
    return webStudioData.growthServices;
  }

  promise() {
    return webStudioData.promise;
  }

  contact() {
    return webStudioData.contact;
  }

  /* ================================================================== *
   * FREE PRO MICROSITE — auto-generated from the verified profile
   * ================================================================== */

  /**
   * Generate (or regenerate) the free microsite for a verified pro. The site is
   * a projection of ledger-backed facts, so it cannot overstate anything the
   * pro has not actually earned.
   */
  generateProMicrosite(proId, { theme = 'proveri-green' } = {}) {
    const pro = this.store.get('pros', proId);
    if (!pro) throw new Error(`pro ${proId} not found`);
    if (!pro.canBid) {
      return {
        generated: false,
        reason: 'Your microsite unlocks the moment verification passes. Complete the remaining checks to publish it.',
        missingChecks: pro.verification?.missingChecks || [],
        badge: pro.badge,
      };
    }
    const profile = this.people.publicProfile(proId);
    const existing = this.store.findOne('websites', (w) => w.proId === proId && w.kind === SITE_KIND.PRO_MICROSITE);
    const siteId = existing?.siteId || idFor('website');
    const sections = this.buildMicrositeSections(profile);

    const site = {
      siteId,
      kind: SITE_KIND.PRO_MICROSITE,
      proId,
      slug: pro.slug,
      url: `/p/${pro.slug}`,
      publicUrl: `https://lulaproveri.co.za/p/${pro.slug}`,
      title: `${pro.displayName} · ${pro.primaryCategoryLabel} in ${pro.location.suburb || pro.location.metro || 'South Africa'}`,
      theme,
      status: 'LIVE',
      priceCents: 0,
      recurringCents: 0,
      generatedFrom: 'verified profile + hash-chained ledger',
      seo: {
        title: `${pro.primaryCategoryLabel} in ${pro.location.suburb || pro.location.metro} | ${pro.displayName} | Lula ProVeri`,
        description: `${pro.displayName} — ${pro.badge.replace(/_/g, ' ').toLowerCase()}, ${pro.trustScore}/100 trust score, ${profile.stats.completedJobs} escrow-protected jobs, ${profile.ratings.average || 'new'}★ from ${profile.ratings.count} verified review(s). Serving ${pro.location.suburb || pro.location.metro} and ${pro.location.serviceRadiusKm} km around it.`,
        keywords: [pro.primaryCategoryLabel, pro.location.suburb, pro.location.metro, 'verified', 'escrow', ...(pro.certification.body ? [pro.certification.body] : [])].filter(Boolean),
        ogImage: `/api/pros/${proId}/card.png`,
        canonical: `https://lulaproveri.co.za/p/${pro.slug}`,
      },
      sections,
      qrCode: { payload: `https://lulaproveri.co.za/p/${pro.slug}`, note: 'Print this for your bakkie door, toolbox lid or till slip. It resolves to this page.' },
      contentHash: sha256({ profile: { badge: profile.badge, trustScore: profile.trustScore, reviews: profile.ratings, completedJobs: profile.stats.completedJobs }, theme }),
      lastRegeneratedAt: nowIso(),
      createdAt: existing?.createdAt || nowIso(),
    };

    this.store.put('websites', siteId, site);
    if (!existing) {
      this.kernel.ledger.append({
        action: 'MICROSITE_GENERATED',
        subject: proId,
        visibility: 'PUBLIC',
        payload: { summary: `Free ProVeri microsite published at ${site.publicUrl} — generated from the verified profile and audit ledger`, siteId, url: site.url },
      });
    } else {
      site.regenerations = (existing.regenerations || 0) + 1;
    }
    return deepClone(site);
  }

  /**
   * Sections are always projected from the LIVE profile and audit ledger —
   * that is what makes a ProVeri microsite different from a hand-built one:
   * it cannot go stale, and it cannot overstate anything the pro has not earned.
   */
  whatsappLink(proId) {
    const pro = this.store.get('pros', proId);
    if (!pro?.mobile) return null;
    return `https://wa.me/27${pro.mobile.replace(/^0/, '')}`;
  }

  buildMicrositeSections(profile) {
    const esc = (value) => value;
    return [
      { id: 'hero', kind: 'TRUST_HERO', data: { name: profile.name, badge: profile.badge, trustScore: profile.trustScore, tagline: `${profile.primaryCategoryLabel} · ${profile.location.suburb || profile.location.metro}`, cta: profile.pricing.instantBook ? 'Book instantly' : 'Request a quote' } },
      { id: 'verification', kind: 'VERIFICATION_CARD', data: { checks: profile.explanation?.reasons || [], statutoryNote: profile.explanation?.statutoryNote, regulator: profile.regulator, auditSeal: profile.proofDigest } },
      { id: 'reviews', kind: 'VERIFIED_REVIEWS', data: { average: profile.ratings.average, count: profile.ratings.count, distribution: profile.ratings.distribution, items: profile.recentReviews, claim: 'Every review below is from a customer who paid for the work through ProVeri escrow. Ratings cannot be bought.' } },
      { id: 'portfolio', kind: 'PROOF_OF_WORK_GALLERY', data: { items: profile.portfolio, note: 'Items marked “Proof of work” come from geotagged, hash-sealed evidence on escrow-released jobs. Anything else is an upload by the business and says so.' } },
      { id: 'services', kind: 'SERVICES_AND_PRICING', data: { categories: [profile.primaryCategoryLabel, ...profile.additionalCategories], pricing: profile.pricing, honestPricingNote: 'No "from R99" bait. Callout and hourly rates are published and locked into your quote.' } },
      { id: 'availability', kind: 'AVAILABILITY', data: profile.availability },
      { id: 'coverage', kind: 'SERVICE_AREA', data: { suburb: profile.location.suburb, metro: profile.location.metro, radiusKm: profile.location.serviceRadiusKm } },
      { id: 'contact', kind: 'CONTACT_AND_BOOKING', data: { whatsapp: this.whatsappLink(profile.proId), bookingUrl: `/post-job?categoryId=${profile.primaryCategory || ''}&proId=${profile.proId}`, callout: 'Booking through this page pays into ProVeri escrow — your money is protected and the work is warranted for 14 days.' } },
      { id: 'proof', kind: 'AUDIT_RECEIPT', data: { proofDigest: profile.proofDigest, timeline: profile.auditTrail, claim: 'This page is generated from a hash-chained audit ledger. Nothing on it can be edited without breaking the chain.' } },
    ];
  }

  /** Render the microsite as HTML (server-side, zero dependencies). */
  renderMicrositeHtml(proId) {
    const site = this.store.findOne('websites', (w) => w.proId === proId && w.kind === SITE_KIND.PRO_MICROSITE);
    if (!site) return null;
    // Render from the LIVE profile, not the stored snapshot: the page must
    // reflect today's trust score, reviews and ledger, by design.
    const profile = this.people.publicProfile(proId);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sections = this.buildMicrositeSections(profile).map((section) => {
      const data = section.data || {};
      switch (section.kind) {
        case 'TRUST_HERO':
          return `<section class="hero"><h1>${esc(data.name)}</h1><p class="tag">${esc(data.tagline)}</p>
            <div class="badges"><span class="badge">${esc(String(data.badge).replace(/_/g, ' '))}</span><span class="score">Trust ${esc(data.trustScore)}/100</span></div>
            <a class="cta" href="${esc(site.url)}#book">${esc(data.cta)}</a></section>`;
        case 'VERIFICATION_CARD':
          return `<section class="verification"><h2>What has been verified</h2><ul>${(data.checks || []).map((c) => `<li><span class="icon">${esc(c.icon)}</span> ${esc(c.text)}</li>`).join('')}</ul>
            <p class="note">${esc(data.statutoryNote)}</p><p class="seal">Audit seal ${esc(data.auditSeal)}</p></section>`;
        case 'VERIFIED_REVIEWS':
          return `<section class="reviews"><h2>${esc(data.average || 'New')}★ from ${esc(data.count)} verified review(s)</h2><p class="claim">${esc(data.claim)}</p>
            <ul>${(data.items || []).map((r) => `<li><strong>${esc(r.rating)}★</strong> ${esc(r.comment)} <em>— ${esc(r.suburb || '')}</em></li>`).join('')}</ul></section>`;
        case 'PROOF_OF_WORK_GALLERY':
          return `<section class="portfolio"><h2>Proof of work</h2><p class="note">${esc(data.note)}</p>
            <ul>${(data.items || []).map((p) => `<li>${esc(p.title)} <code>${esc(p.seal)}</code></li>`).join('')}</ul></section>`;
        case 'CONTACT_AND_BOOKING':
          return `<section class="block"><h2>Book ${esc(data.name || '')}</h2><p class="note">${esc(data.callout || '')}</p>
            <p><a class="cta" href="${esc(data.bookingUrl || '/post-job')}">Post this job on ProVeri</a></p>
            ${data.whatsapp ? `<p><a href="${esc(data.whatsapp)}">Message on WhatsApp</a></p>` : ''}</section>`;
        case 'AUDIT_RECEIPT':
          return `<section class="proof"><h2>Audit receipt</h2><p>${esc(data.claim)}</p><code>${esc(data.proofDigest)}</code>
            <ol>${(data.timeline || []).slice(-6).map((t) => `<li>${esc(t.createdAt.slice(0, 10))} — ${esc(t.summary)}</li>`).join('')}</ol></section>`;
        default:
          return `<section class="block"><h2>${esc(section.kind.replace(/_/g, ' '))}</h2><pre>${esc(JSON.stringify(data, null, 2))}</pre></section>`;
      }
    }).join('\n');

    return `<!doctype html>
<html lang="en-ZA"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site.seo.title)}</title>
<meta name="description" content="${esc(site.seo.description)}">
<meta property="og:title" content="${esc(site.seo.title)}">
<meta property="og:description" content="${esc(site.seo.description)}">
<link rel="canonical" href="${esc(site.seo.canonical)}">
<link rel="stylesheet" href="/styles/microsite.css">
</head><body>
<header class="proveri"><a href="/">← Lula ProVeri</a><span class="pill">Free verified microsite</span></header>
<main>${sections}</main>
<footer><p>Generated ${esc(site.lastRegeneratedAt.slice(0, 10))} · content hash ${esc(site.contentHash.slice(0, 16))}</p>
<p>Lula ProVeri — verified pros, escrow-protected money, proof of work. Proudly South African 🇿🇦</p></footer>
</body></html>`;
  }

  /* ================================================================== *
   * PAID ORDERS — same escrow machinery as a plumbing job
   * ================================================================== */

  createEnquiry({ packageId, growthServiceId = null, contact, brief = {}, proId = null }) {
    const pkg = packageId ? webStudioData.packages.find((p) => p.id === packageId) : null;
    const growth = growthServiceId ? webStudioData.growthServices.find((g) => g.id === growthServiceId) : null;
    if (!pkg && !growth) throw new Error('a packageId or growthServiceId is required');
    const priceCents = pkg ? pkg.priceCents : growth.priceCents;

    const orderId = idFor('website');
    const reference = this.store.reference('WEB', 'webstudio', 5);
    const order = {
      orderId,
      reference,
      kind: pkg ? pkg.id.toUpperCase().replace(/-/g, '_') : `GROWTH_${growth.id.toUpperCase().replace(/-/g, '_')}`,
      siteKind: pkg ? SITE_KIND.DIGITAL_STOREFRONT : SITE_KIND.PRO_MICROSITE,
      packageId: packageId || null,
      growthServiceId: growthServiceId || null,
      title: pkg?.name || growth?.name,
      proId,
      contact: {
        firstName: contact.firstName || null,
        surname: contact.surname || null,
        email: contact.email || null,
        mobile: contact.mobile || null,
        businessName: contact.businessName || null,
        suburb: contact.suburb || null,
        preferredChannel: contact.preferredChannel || 'whatsapp',
      },
      brief: {
        whatTheSiteMustDo: brief.whatTheSiteMustDo || null,
        brandColours: brief.brandColours || [],
        logoProvided: Boolean(brief.logoProvided),
        existingUrl: brief.existingUrl || null,
        sections: brief.sections || null,
        galleryPhotos: brief.galleryPhotos || 0,
        paymentProviders: brief.paymentProviders || [],
        message: brief.message || null,
      },
      status: ORDER_STATUS.ENQUIRY,
      priceCents,
      recurringCents: pkg?.recurringCents || 0,
      includes: pkg?.includes || growth?.how || [],
      honestBoundary: growth?.honestBoundary || null,
      proveriUpgrade: pkg?.proveriUpgrade || growth?.proveriUpgrade || null,
      deliveryDays: pkg?.deliveryDays || 5,
      milestones: pkg?.milestones || [{ label: 'Deliverable accepted', weight: 100 }],
      escrowId: null,
      previewUrl: null,
      liveUrl: null,
      timeline: [{ at: nowIso(), event: 'ENQUIRY_RECEIVED', note: `${pkg?.name || growth?.name} enquiry from ${contact.businessName || contact.firstName || 'a business'}` }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('webStudioOrders', orderId, order);
    this.kernel.ledger.append({
      action: 'WEBSTUDIO_ENQUIRY',
      subject: orderId,
      visibility: 'PUBLIC',
      payload: {
        summary: `Web Studio enquiry: ${order.title} (R${(priceCents / 100).toLocaleString('en-ZA')}) — preview will be built before any payment`,
        reference,
        priceCents,
        channel: order.contact.preferredChannel,
      },
    });
    return deepClone(order);
  }

  /**
   * Build the preview. This is the "preview first, pay after" promise made
   * concrete: the customer sees a live, clickable preview and only then does an
   * escrow open.
   */
  buildPreview(orderId, { previewNotes = {} } = {}) {
    const order = this.#order(orderId);
    if (![ORDER_STATUS.ENQUIRY, ORDER_STATUS.QUOTED].includes(order.status)) {
      throw new Error(`order is ${order.status}; a preview has already been built`);
    }
    order.status = ORDER_STATUS.PREVIEW_BUILDING;
    order.previewUrl = `/webstudio/preview/${order.reference.toLowerCase()}`;
    order.preview = {
      builtAt: nowIso(),
      readyAt: addDays(nowIso(), Math.min(2, order.deliveryDays)),
      pages: order.milestones.length > 1 ? 3 : 1,
      devicePreviews: ['mobile', 'tablet', 'desktop'],
      interactive: true,
      lighthouseTargets: { performance: 95, accessibility: 100, seo: 100 },
      notes: previewNotes,
      contentHash: sha256({ orderId, brief: order.brief, at: nowIso() }),
    };
    order.timeline.push({ at: nowIso(), event: 'PREVIEW_BUILDING', note: 'Preview generated — no payment taken yet' });
    order.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'WEBSTUDIO_PREVIEW_READY',
      subject: orderId,
      visibility: 'PUBLIC',
      payload: {
        summary: `Preview ready at ${order.previewUrl}. R0 taken so far — payment into escrow only happens after the preview is approved.`,
        previewUrl: order.previewUrl,
        contentHash: order.preview.contentHash.slice(0, 16),
      },
    });
    order.status = ORDER_STATUS.PREVIEW_READY;
    return deepClone(order);
  }

  approvePreview(orderId, { approved, feedback, paymentProvider = 'payfast' }) {
    const order = this.#order(orderId);
    if (order.status !== ORDER_STATUS.PREVIEW_READY) throw new Error(`order is ${order.status}`);
    if (!approved) {
      order.status = ORDER_STATUS.PREVIEW_BUILDING;
      order.timeline.push({ at: nowIso(), event: 'PREVIEW_REVISION_REQUESTED', note: feedback || 'Revision requested' });
      order.revisions = (order.revisions || 0) + 1;
      order.updatedAt = nowIso();
      return deepClone(order);
    }

    order.status = ORDER_STATUS.PREVIEW_APPROVED;
    order.timeline.push({ at: nowIso(), event: 'PREVIEW_APPROVED', note: 'Preview approved — escrow opened' });

    const escrow = this.kernel.escrow.open({
      bookingId: orderId,
      customerId: order.contact.email || order.contact.mobile || orderId,
      providerId: 'lula-webstudio',
      amountCents: order.priceCents,
      provider: paymentProvider,
      milestones: order.milestones,
      warrantyDays: 0,
      purpose: `Web Studio — ${order.title}`,
    });
    order.escrowId = escrow.escrowId;
    order.escrowProvider = escrow.providerLabel;
    order.status = ORDER_STATUS.AWAITING_PAYMENT;
    order.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'WEBSTUDIO_ESCROW_OPENED',
      subject: orderId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: {
        summary: `R${(order.priceCents / 100).toLocaleString('en-ZA')} into ${escrow.providerLabel} escrow after preview approval — released per milestone`,
        milestones: order.milestones.map((m) => `${m.label} (${m.weight}%)`),
      },
    });
    return deepClone(order);
  }

  payOrder(orderId, { reference, method = 'card' }) {
    const order = this.#order(orderId);
    if (order.status !== ORDER_STATUS.AWAITING_PAYMENT) throw new Error(`order is ${order.status}`);
    const escrow = this.kernel.escrow.confirmFunded(order.escrowId, { reference, method, amountCents: order.priceCents });
    order.status = ORDER_STATUS.IN_BUILD;
    order.paidAt = nowIso();
    order.payment = { reference: escrow.funded.reference, method, amountCents: order.priceCents };
    order.timeline.push({ at: nowIso(), event: 'PAID_INTO_ESCROW', note: `R${(order.priceCents / 100).toLocaleString('en-ZA')} held by ${escrow.providerLabel}` });
    order.updatedAt = nowIso();
    return deepClone(order);
  }

  completeMilestone(orderId, { milestoneSeq, deliverable, actorId }) {
    const order = this.#order(orderId);
    const escrow = this.kernel.escrow.get(order.escrowId);
    const milestone = escrow.plan.milestones.find((m) => m.seq === milestoneSeq);
    if (!milestone) throw new Error(`milestone ${milestoneSeq} not found`);

    this.kernel.escrow.submitMilestoneEvidence(order.escrowId, milestone.milestoneId, {
      evidence: [{ type: 'DELIVERABLE', hash: sha256(deliverable || milestone.label), note: deliverable || milestone.label }],
    });
    this.kernel.escrow.acceptMilestone(order.escrowId, milestone.milestoneId, { actorId, comment: `Milestone ${milestoneSeq}: ${milestone.label}` });

    const after = this.kernel.escrow.get(order.escrowId);
    order.timeline.push({ at: nowIso(), event: `MILESTONE_${milestoneSeq}_COMPLETE`, note: milestone.label });
    if (after.status === 'READY_FOR_RELEASE') {
      this.kernel.escrow.release(order.escrowId, { triggeredBy: 'WEBSTUDIO_HANDOVER' });
      order.status = ORDER_STATUS.DELIVERED;
      order.liveUrl = order.liveUrl || `/webstudio/sites/${order.reference.toLowerCase()}`;
      order.deliveredAt = nowIso();
      order.timeline.push({ at: nowIso(), event: 'DELIVERED', note: 'Site handed over and escrow released' });
    } else {
      order.status = ORDER_STATUS.IN_BUILD;
    }
    order.updatedAt = nowIso();
    this.kernel.ledger.append({
      action: 'WEBSTUDIO_MILESTONE_COMPLETE',
      subject: orderId,
      level: 'MONEY',
      visibility: 'PUBLIC',
      payload: { summary: `${milestone.label} — released R${(milestone.amountCents / 100).toLocaleString('en-ZA')}`, milestoneSeq },
    });
    return deepClone(order);
  }

  /**
   * Website rescue diagnostic — free, machine-generated and hash-sealed, so the
   * customer owns the audit even if they never buy the rescue.
   */
  async rescueDiagnostic({ url, contact }) {
    const { request } = require('../integrations/httpClient');
    if (!/^https?:\/\//.test(url)) throw new Error('provide a full http(s) URL');
    const started = Date.now();
    // Goes through the shared HTTP client so offline mode short-circuits
    // instantly and the result is honestly labelled as simulated.
    const res = await request(url, { timeoutMs: 12000, cacheTtlMs: 0, retries: 0 });
    const reachable = res.ok;
    const status = res.ok ? res.status : (res.error || res.status);
    const html = typeof res.data === 'string' ? res.data : null;
    const responseMs = Date.now() - started;
    const sizeKb = html ? Math.round(Buffer.byteLength(html) / 1024) : 0;

    const findings = [];
    const score = (label, ok, weight, fix) => findings.push({ label, passed: ok, weight, fix, impact: ok ? 0 : weight });
    score('Site responds to requests', reachable, 20, 'Hosting or DNS is failing — the site is effectively offline.');
    score('Mobile viewport meta tag present', /name=["']viewport["']/.test(html || ''), 15, 'Without a viewport tag the site renders as a tiny desktop page on a phone, which is most South African traffic.');
    score('Page weight under 1.5 MB', sizeKb < 1500, 12, `Page is ${sizeKb} KB. Large unoptimised images are the usual cause — most SA users are on mobile data.`);
    score('Responds in under 3 seconds', responseMs < 3000, 13, `Took ${responseMs} ms. Every extra second costs roughly 7% of conversions.`);
    score('HTTPS enabled', url.startsWith('https://') && reachable, 12, 'No HTTPS means browsers show "Not secure" and Google demotes the site.');
    score('Has a clear call to action', /(whatsapp|wa\.me|tel:|book|quote|call)/i.test(html || ''), 10, 'No click-to-call, WhatsApp or booking button — visitors cannot act.');
    score('Title and meta description present', /<title>[^<]+<\/title>/i.test(html || '') && /name=["']description["']/i.test(html || ''), 8, 'Missing title/description means Google cannot summarise the business in search results.');
    score('No obvious mixed-content or broken asset warnings', !/http:\/\/[^"']*\.(?:png|jpg|css|js)/i.test(html || ''), 5, 'Mixed HTTP assets on an HTTPS page are blocked by browsers.');
    score('Structured business data present', /application\/ld\+json/i.test(html || ''), 5, 'No LocalBusiness schema — Google Maps and the local pack will not pick the business up reliably.');

    const total = findings.reduce((sum, f) => sum + f.weight, 0);
    const passed = findings.filter((f) => f.passed).reduce((sum, f) => sum + f.weight, 0);
    const healthScore = Math.round((passed / total) * 100);
    const diagnosticId = idFor('website');

    const diagnostic = {
      diagnosticId,
      url,
      reference: this.store.reference('DIAG', 'webstudio-diag', 5),
      ranAt: nowIso(),
      reachable,
      simulated: Boolean(res.offline),
      integrationMode: require('../integrations').MODE,
      simulationNote: res.offline
        ? 'This scan ran with network integrations disabled (PROVERI_INTEGRATION_MODE=offline), so reachability and timing are simulated rather than measured. Run with PROVERI_INTEGRATION_MODE=live to scan for real.'
        : null,
      reachabilityCheck: res.offline ? 'SIMULATED' : (reachable ? 'PASS' : 'FAIL'),
      httpStatus: status,
      responseMs,
      sizeKb,
      healthScore,
      grade: healthScore >= 85 ? 'A' : healthScore >= 70 ? 'B' : healthScore >= 50 ? 'C' : healthScore >= 30 ? 'D' : 'F',
      findings,
      verdict: healthScore >= 70
        ? 'The site is fundamentally sound. The rescue package would be overkill — fix the flagged items yourself using the list above.'
        : healthScore >= 40
        ? `The site is salvageable. A "Page 3" Website Rescue (from R2,500) fixes the ${findings.filter((f) => !f.passed).length} failed items and moves it to fast, zero-monthly-fee hosting.`
        : 'This site is costing the business customers. A rebuild is cheaper than a rescue — the Digital Storefront package at R3,500 is the better buy.',
      recommendedPackage: healthScore >= 70 ? null : healthScore >= 40 ? 'website-rescue' : 'digital-storefront',
      honestBoundary: 'We are not going to sell you a rescue if you do not need one. This report is yours whether or not you buy anything.',
      seal: sha256({ url, healthScore, findings: findings.map((f) => [f.label, f.passed]), ranAt: diagnosticId }),
      contact: contact || null,
    };

    this.store.put('webStudioDiagnostics', diagnosticId, diagnostic);
    this.kernel.ledger.append({
      action: 'WEBSTUDIO_DIAGNOSTIC_RUN',
      subject: diagnosticId,
      visibility: 'PUBLIC',
      payload: { summary: `Website diagnostic for ${url}: ${healthScore}/100 (grade ${diagnostic.grade})`, healthScore, grade: diagnostic.grade },
    });
    return deepClone(diagnostic);
  }

  listOrders({ proId, status } = {}) {
    let rows = this.store.all('webStudioOrders');
    if (proId) rows = rows.filter((o) => o.proId === proId);
    if (status) rows = rows.filter((o) => o.status === status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => deepClone(o));
  }

  listMicrosites() {
    return this.store.find('websites', (w) => w.kind === SITE_KIND.PRO_MICROSITE)
      .map((w) => ({ siteId: w.siteId, url: w.publicUrl, proId: w.proId, title: w.title, status: w.status, lastRegeneratedAt: w.lastRegeneratedAt }));
  }

  #order(orderId) {
    const order = this.store.get('webStudioOrders', orderId);
    if (!order) throw new Error(`Web Studio order ${orderId} not found`);
    return order;
  }

  stats() {
    const orders = this.store.all('webStudioOrders');
    const sites = this.store.find('websites', (w) => w.kind === SITE_KIND.PRO_MICROSITE);
    return {
      micrositesLive: sites.filter((s) => s.status === 'LIVE').length,
      orders: orders.length,
      ordersDelivered: orders.filter((o) => o.status === ORDER_STATUS.DELIVERED).length,
      pipelineValueCents: orders.filter((o) => ![ORDER_STATUS.CANCELLED, ORDER_STATUS.DELIVERED].includes(o.status)).reduce((s, o) => s + o.priceCents, 0),
      deliveredValueCents: orders.filter((o) => o.status === ORDER_STATUS.DELIVERED).reduce((s, o) => s + o.priceCents, 0),
      diagnosticsRun: this.store.count('webStudioDiagnostics'),
      packages: webStudioData.packages.length,
      growthServices: webStudioData.growthServices.length,
    };
  }
}

module.exports = { WebStudioService, ORDER_STATUS, SITE_KIND, webStudioData };
