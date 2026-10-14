'use strict';

/**
 * Portfolio — "upload your past work, and let homeowners find you by it".
 *
 * This is the marketplace's demand-side front door: a homeowner scrolls real
 * jobs done near them, taps one, and either hires that pro (a job pinned to
 * them, money into escrow) or messages them about it.
 *
 * The part that makes it a trust market rather than Instagram:
 *
 *   SELF_DECLARED    the pro uploaded it. Nothing corroborates it. It says so.
 *   EVIDENCE_LINKED  it is tied to proof of work on an escrow-released job —
 *                    geotagged, hash-sealed, in the ledger. The badge is earned.
 *   CLIENT_CONFIRMED the homeowner on that job confirmed or reviewed it.
 *
 * A pro cannot buy their way up a tier: the service computes it from evidence,
 * policy PRT-001 blocks any attempt to claim one, and PRT-002 blocks a photo
 * that another pro has already published (the oldest trick in the trade).
 *
 * Items are also harvested automatically when a job closes: the pro does not
 * have to remember to upload the work they already proved.
 */

const { idFor, nowIso, sha256, deepClone } = require('../kernel/util');

const PORTFOLIO_TIER = Object.freeze({
  SELF_DECLARED: 'SELF_DECLARED',
  EVIDENCE_LINKED: 'EVIDENCE_LINKED',
  CLIENT_CONFIRMED: 'CLIENT_CONFIRMED',
});

const TIER_LABEL = Object.freeze({
  SELF_DECLARED: 'Uploaded by the pro',
  EVIDENCE_LINKED: 'Proof of work',
  CLIENT_CONFIRMED: 'Client confirmed',
});

const TIER_WEIGHT = Object.freeze({
  SELF_DECLARED: 0,
  EVIDENCE_LINKED: 1,
  CLIENT_CONFIRMED: 2,
});

const RELEASED_STATUSES = ['COMPLETED', 'IN_WARRANTY', 'CLOSED'];
const PHOTO_EVIDENCE_TYPES = ['BEFORE_PHOTO', 'AFTER_PHOTO', 'COMPLETION_PHOTO', 'COMPLETION_VIDEO'];
const MAX_PHOTOS = 8;
const MAX_DATAURL_CHARS = 1_200_000;   // ~900 KB of image; enough for a phone photo

class PortfolioService {
  constructor({ store, kernel, catalog, people, cloud = null }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.people = people;
    this.cloud = cloud;
  }

  /** A Supabase posts row rendered as a feed item. */
  #cloudWorkItem(row) {
    const photos = Array.isArray(row.photos) ? row.photos.filter((ph) => ph && (ph.url || ph.dataUrl)) : [];
    return {
      itemId: row.id,
      reference: row.reference || null,
      title: row.title || 'Untitled work',
      description: row.description || null,
      categoryId: row.category_id || null,
      categoryLabel: row.category_label || null,
      suburb: row.suburb || null,
      metro: row.metro || null,
      priceCents: row.price_cents ?? null,
      photos,
      photo: photos[0] || null,
      tier: PORTFOLIO_TIER.SELF_DECLARED,
      tierLabel: TIER_LABEL[PORTFOLIO_TIER.SELF_DECLARED],
      verified: false,
      cloud: true,
      proId: null,
      proName: row.author_name || 'ProVeri member',
      completedAt: row.created_at,
      createdAt: row.created_at,
      stats: { views: 0, saves: 0, enquiries: 0 },
    };
  }

  /** The public feed: local shelf first, then cloud-mirrored work. */
  async listWithCloud(opts = {}) {
    const local = this.list(opts);
    if (!this.cloud || opts.proId) return local;
    const known = new Set(local.map((i) => i.itemId));
    const rows = (await this.cloud.fetchPosts({ limit: opts.limit || 60 }))
      .filter((r) => r.kind === 'work' && !known.has(r.id));
    const merged = [...local, ...rows.map((r) => this.#cloudWorkItem(r))];
    return merged.sort((a, b) => String(b.completedAt || b.createdAt || '').localeCompare(String(a.completedAt || a.createdAt || '')));
  }

  /** One item, falling back to the cloud copy after a restart. */
  async detailWithCloud(itemId) {
    const local = this.store.get('portfolioItems', itemId);
    if (local) return this.detail(itemId);
    if (!this.cloud) throw new Error(`portfolio item ${itemId} not found`);
    const health = await this.cloud.health();
    if (!health.online || health.supabase === false) throw new Error(`portfolio item ${itemId} not found`);
    try {
      const rows = await this.cloud.supabaseSelect('posts', `select=*&id=eq.${encodeURIComponent(itemId)}`);
      if (!rows || !rows[0]) throw new Error(`portfolio item ${itemId} not found`);
      return this.#cloudWorkItem(rows[0]);
    } catch (error) {
      throw new Error(`portfolio item ${itemId} not found`);
    }
  }

  tiers() {
    return Object.values(PORTFOLIO_TIER).map((id) => ({ id, label: TIER_LABEL[id] }));
  }

  /* ================================================================== *
   * UPLOAD
   * ================================================================== */

  addItem({
    proId, title, description = null, categoryId = null, suburbId = null,
    completedAt = null, priceCents = null, priceNote = null, photos = [],
    bookingId = null, jobId = null, clientReference = null, actorId = 'pro',
  }) {
    const pro = this.store.get('pros', proId);
    if (!pro) throw new Error(`pro ${proId} not found`);
    if (!title || !String(title).trim()) throw new Error('title is required — say what the job was');

    const category = this.#category(categoryId);
    const suburb = suburbId ? this.catalog.suburb(suburbId) : null;
    const link = this.#resolveEvidenceLink({ proId, bookingId, jobId });

    // No photos supplied but a proven job linked? Use that job's sealed proof of work.
    const supplied = Array.isArray(photos) ? photos : [];
    const sealedPhotos = supplied.length
      ? supplied.map((photo, index) => this.#sealPhoto(photo, proId, index))
      : (link?.booking ? this.#photosFromEvidence(link.booking) : []);
    if (!sealedPhotos.length) throw new Error('at least one photo is required — home owners decide with their eyes');
    if (sealedPhotos.length > MAX_PHOTOS) throw new Error(`too many photos — up to ${MAX_PHOTOS} per item`);

    // A photo another pro has already published is not your work.
    const stolen = this.#findElsewhere(sealedPhotos, proId);
    if (stolen) {
      const decision = this.kernel.policy.evaluate('portfolio', {
        subjectId: proId,
        item: { proId, photos: sealedPhotos, tier: PORTFOLIO_TIER.SELF_DECLARED },
        action: 'ADD',
        duplicateOf: { ownerProId: stolen.ownerProId, source: stolen.source, hash: stolen.hash.slice(0, 12) },
      });
      const blocked = decision.firedRules.filter((r) => r.effect === 'BLOCK');
      if (blocked.length) {
        this.kernel.risk.record(proId, {
          type: 'DUPLICATE_PHOTO_HASH',
          severity: 'CRITICAL',
          source: 'ProVeri portfolio photo-hash index',
          message: `Uploaded photo matches one already published by another pro (${stolen.source})`,
          metadata: { hash: stolen.hash, ownerProId: stolen.ownerProId },
        });
        const error = new Error(blocked.map((r) => `[${r.ruleId}] ${r.reason}`).join(' · '));
        error.decision = decision;
        error.code = 'BLOCKED';
        throw error;
      }
    }

    const item = {
      itemId: idFor('prt'),
      reference: this.store.reference('WORK', 'portfolioItem', 5),
      proId,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      categoryId: category ? category.id : (pro.primaryCategory || null),
      categoryLabel: category ? category.label : (this.#categoryLabel(pro.primaryCategory) || 'Trade work'),
      suburbId: suburb ? suburb.id : (link?.booking ? this.#suburbIdFor(link.booking.address?.suburb) : null),
      suburb: suburb ? suburb.name : (link?.booking?.address?.suburb || null),
      metro: suburb ? suburb.metroName : (link?.booking?.address?.metro || null),
      completedAt: completedAt || link?.completedAt || nowIso(),
      priceCents: priceCents == null || priceCents === '' ? (link?.priceCents ?? null) : Number(priceCents),
      priceNote: priceNote || null,
      photos: sealedPhotos,
      tier: link ? (link.clientConfirmed ? PORTFOLIO_TIER.CLIENT_CONFIRMED : PORTFOLIO_TIER.EVIDENCE_LINKED) : PORTFOLIO_TIER.SELF_DECLARED,
      source: link ? 'HARVESTED_LINK' : 'UPLOAD',
      bookingId: link?.bookingId || null,
      jobId: link?.jobId || jobId || null,
      clientReference: clientReference || link?.clientReference || null,
      rating: link?.rating ?? null,
      geoVerified: link ? link.geoVerified : null,
      evidenceSeals: link ? link.evidenceSeals : [],
      status: 'LIVE',
      flags: [],
      stats: { views: 0, saves: 0, enquiries: 0 },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    // PRT-001: the tier is computed, never claimed.
    const decision = this.kernel.policy.evaluate('portfolio', {
      subjectId: item.itemId,
      item,
      action: 'ADD',
    });
    const blocked = decision.firedRules.filter((r) => r.effect === 'BLOCK');
    if (blocked.length) {
      const error = new Error(blocked.map((r) => `[${r.ruleId}] ${r.reason}`).join(' · '));
      error.decision = decision;
      error.code = 'BLOCKED';
      throw error;
    }

    item.ledgerSeal = sha256({ itemId: item.itemId, proId, photos: item.photos.map((p) => p.hash), at: item.createdAt }).slice(0, 16);
    this.store.put('portfolioItems', item.itemId, item);

    // The upload is real: mirror it to Supabase so it outlives this process.
    if (this.cloud) {
      this.cloud.mirrorPost({
        id: item.itemId,
        kind: 'work',
        reference: item.reference || null,
        authorUid: pro.firebaseUid || null,
        authorName: pro.displayName,
        title: item.title,
        description: item.description || null,
        categoryId: item.categoryId,
        categoryLabel: item.categoryLabel,
        suburb: item.suburb,
        metro: item.metro,
        priceCents: item.priceCents,
        photos: item.photos.map((ph) => ({ url: ph.url || null, caption: ph.caption || null, hash: ph.hash })),
        createdAt: item.createdAt,
      }, { ledger: this.kernel.ledger, subject: item.itemId }).catch(() => {});
    }

    this.kernel.ledger.append({
      action: 'PORTFOLIO_ITEM_ADDED',
      subject: item.itemId,
      level: item.tier === PORTFOLIO_TIER.SELF_DECLARED ? 'INFO' : 'TRUST',
      visibility: item.tier === PORTFOLIO_TIER.SELF_DECLARED ? 'PRIVATE' : 'PUBLIC',
      payload: {
        summary: `${pro.displayName} added "${item.title}" (${item.categoryLabel}, ${item.suburb || item.metro || 'ZA'}) — tier ${TIER_LABEL[item.tier]}${item.bookingId ? `, linked to booking ${item.clientReference}` : ''}`,
        tier: item.tier,
        proId,
        photos: item.photos.length,
        bookingId: item.bookingId,
      },
    });
    return deepClone(item);
  }

  /* ================================================================== *
   * HARVEST — closed jobs become portfolio items without anybody remembering
   * ================================================================== */

  harvestFromBooking(booking) {
    if (!booking || !RELEASED_STATUSES.includes(booking.status)) return null;
    const existing = this.store.find('portfolioItems', (i) => i.bookingId === booking.bookingId && i.proId === booking.proId);
    if (existing.length) return deepClone(existing[0]);

    const pro = this.store.get('pros', booking.proId);
    if (!pro) return null;

    const photos = this.#photosFromEvidence(booking);
    if (!photos.length) return null;

    const review = this.store.find('reviews', (r) => r.bookingId === booking.bookingId)[0] || null;
    const geoVerified = photos.every((p) => p.geoVerified !== false);

    const item = {
      itemId: idFor('prt'),
      reference: this.store.reference('WORK', 'portfolioItem', 5),
      proId: booking.proId,
      title: booking.title || `${booking.categoryLabel || 'Trade'} job`,
      description: booking.scope?.text ? String(booking.scope.text).slice(0, 400) : null,
      categoryId: booking.categoryId,
      categoryLabel: booking.categoryLabel,
      suburbId: this.#suburbIdFor(booking.address?.suburb),
      suburb: booking.address?.suburb || null,
      metro: booking.address?.metro || null,
      completedAt: booking.completedAt || booking.warranty?.startsAt || booking.updatedAt || nowIso(),
      priceCents: booking.price?.totalCents ?? null,
      priceNote: 'final amount, escrow-released',
      photos,
      tier: review && review.rating >= 4 ? PORTFOLIO_TIER.CLIENT_CONFIRMED : PORTFOLIO_TIER.EVIDENCE_LINKED,
      source: 'HARVESTED',
      bookingId: booking.bookingId,
      jobId: booking.jobId,
      clientReference: booking.reference,
      rating: review?.rating ?? null,
      geoVerified,
      evidenceSeals: photos.map((p) => p.seal),
      status: 'LIVE',
      flags: [],
      stats: { views: 0, saves: 0, enquiries: 0 },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    item.ledgerSeal = sha256({ itemId: item.itemId, bookingId: booking.bookingId, at: item.createdAt }).slice(0, 16);
    this.store.put('portfolioItems', item.itemId, item);

    this.kernel.ledger.append({
      action: 'PORTFOLIO_HARVESTED',
      subject: item.itemId,
      level: 'TRUST',
      visibility: 'PUBLIC',
      payload: {
        summary: `${pro.displayName}'s escrow-released job ${booking.reference} joined their portfolio automatically — ${photos.length} geosealed photo(s), tier ${TIER_LABEL[item.tier]}`,
        bookingId: booking.bookingId,
        tier: item.tier,
        photos: photos.length,
      },
    });
    return deepClone(item);
  }

  /** The homeowner on the linked job confirms it was their house and their job. */
  confirmByClient({ itemId, customerId, comment = null }) {
    const item = this.get(itemId);
    if (!item.bookingId) throw new Error('this item is not linked to a ProVeri job, so no client can confirm it');
    const booking = this.store.get('bookings', item.bookingId);
    if (!booking || booking.customerId !== customerId) throw this.#forbidden('only the customer on the linked job can confirm this work');
    item.tier = PORTFOLIO_TIER.CLIENT_CONFIRMED;
    item.clientConfirmedAt = nowIso();
    const review = this.store.find('reviews', (r) => r.bookingId === booking.bookingId)[0] || null;
    if (review && item.rating == null) item.rating = review.rating;
    item.clientComment = comment || null;
    item.updatedAt = nowIso();
    this.store.put('portfolioItems', item.itemId, item);
    this.kernel.ledger.append({
      action: 'PORTFOLIO_CLIENT_CONFIRMED',
      subject: item.itemId,
      level: 'TRUST',
      visibility: 'PUBLIC',
      payload: { summary: `The homeowner on ${item.clientReference} confirmed "${item.title}" was their job`, bookingId: item.bookingId },
    });
    return deepClone(item);
  }

  /* ================================================================== *
   * EDIT / REMOVE / FLAG
   * ================================================================== */

  updateItem(itemId, patch = {}, { actorId = 'pro' } = {}) {
    const item = this.get(itemId);
    if (actorId !== 'studio' && item.proId !== actorId) throw this.#forbidden('only the pro who owns this work can edit it');

    // Tier is evidence's business, not the editor's — gate before touching anything.
    if (patch.tier || patch.verified || patch.claimsProofOfWork) {
      const decision = this.kernel.policy.evaluate('portfolio', {
        subjectId: itemId,
        item: { ...item, claimsProofOfWork: true, tier: PORTFOLIO_TIER.SELF_DECLARED },
        action: 'UPDATE',
      });
      const blocked = decision.firedRules.filter((r) => r.effect === 'BLOCK');
      if (blocked.length) {
        this.kernel.risk.record(item.proId, {
          type: 'VERIFICATION_CLAIM_WITHOUT_EVIDENCE',
          severity: 'HIGH',
          source: 'ProVeri portfolio tier gate',
          message: `Tried to put a verification badge on "${item.title}" with no evidence behind it`,
          metadata: { itemId, tier: item.tier },
        });
        const error = new Error(blocked.map((r) => `[${r.ruleId}] ${r.reason}`).join(' · '));
        error.decision = decision;
        error.code = 'BLOCKED';
        throw error;
      }
    }

    const allowed = ['title', 'description', 'categoryId', 'suburbId', 'completedAt', 'priceCents', 'priceNote'];
    const changes = [];
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      item[key] = patch[key];
      changes.push(key);
    }
    if (patch.categoryId) {
      const category = this.#category(patch.categoryId);
      if (!category) throw new Error(`unknown category: ${patch.categoryId}`);
      item.categoryId = category.id;
      item.categoryLabel = category.label;
    }
    if (patch.suburbId) {
      const suburb = this.catalog.suburb(patch.suburbId);
      if (!suburb) throw new Error(`unknown suburb: ${patch.suburbId}`);
      item.suburbId = suburb.id;
      item.suburb = suburb.name;
      item.metro = suburb.metroName;
    }
    if (!changes.length) throw new Error(`invalid update: nothing to change. Editable fields: ${allowed.join(', ')}`);
    item.updatedAt = nowIso();
    this.store.put('portfolioItems', item.itemId, item);
    this.kernel.ledger.append({
      action: 'PORTFOLIO_ITEM_UPDATED', subject: itemId, visibility: 'PRIVATE',
      payload: { summary: `${item.title}: ${changes.join(', ')} changed`, changes, actorId },
    });
    return deepClone(item);
  }

  removeItem(itemId, { actorId = 'pro', reason = null } = {}) {
    const item = this.get(itemId);
    if (actorId !== 'studio' && item.proId !== actorId) throw this.#forbidden('only the owner or the trust desk can remove this');
    item.status = 'REMOVED';
    item.removedAt = nowIso();
    item.removedReason = reason || null;
    this.store.put('portfolioItems', item.itemId, item);
    this.kernel.ledger.append({
      action: 'PORTFOLIO_ITEM_REMOVED', subject: itemId, visibility: 'PRIVATE',
      payload: { summary: `"${item.title}" removed${reason ? `: ${reason}` : ''}`, actorId },
    });
    return deepClone(item);
  }

  flag({ itemId, reason, reporterId = null }) {
    const item = this.get(itemId);
    item.status = 'FLAGGED';
    item.flags.push({ at: nowIso(), reason, reporterId });
    this.store.put('portfolioItems', item.itemId, item);
    this.kernel.risk.record(item.proId, {
      type: 'PORTFOLIO_MISREPRESENTATION',
      severity: 'MEDIUM',
      source: 'Community report',
      message: `Portfolio item "${item.title}" reported: ${reason}`,
      metadata: { itemId },
    });
    this.kernel.ledger.append({
      action: 'PORTFOLIO_ITEM_FLAGGED', subject: itemId, level: 'SAFETY', visibility: 'PRIVATE',
      payload: { summary: `"${item.title}" flagged for review: ${reason}`, reporterId },
    });
    return deepClone(item);
  }

  /* ================================================================== *
   * READ — the feed a homeowner scrolls
   * ================================================================== */

  get(itemId) {
    const item = this.store.get('portfolioItems', itemId);
    if (!item) throw new Error(`portfolio item ${itemId} not found`);
    return item;
  }

  list({ categoryId = null, suburbId = null, metro = null, q = null, tier = null, verifiedOnly = false, proId = null, limit = 60, sort = 'recent' } = {}) {
    let items = this.store.all('portfolioItems').filter((i) => i.status === 'LIVE');
    if (proId) items = items.filter((i) => i.proId === proId);
    if (categoryId) items = items.filter((i) => i.categoryId === categoryId);
    if (suburbId) items = items.filter((i) => i.suburbId === suburbId);
    if (metro) items = items.filter((i) => i.metro === metro);
    if (tier) items = items.filter((i) => i.tier === tier);
    if (verifiedOnly) items = items.filter((i) => i.tier !== PORTFOLIO_TIER.SELF_DECLARED);
    if (q) {
      const needle = String(q).toLowerCase();
      items = items.filter((i) => `${i.title} ${i.description || ''} ${i.categoryLabel} ${i.suburb || ''} ${i.metro || ''}`.toLowerCase().includes(needle));
    }
    const proRating = (proId) => (this.store.get('pros', proId)?.stats?.averageRating) || 0;
    items.sort((a, b) => {
      if (sort === 'rating') return proRating(b.proId) - proRating(a.proId) || String(b.createdAt).localeCompare(String(a.createdAt));
      if (sort === 'verified') return TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier] || String(b.createdAt).localeCompare(String(a.createdAt));
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    return items.slice(0, limit).map((i) => this.summary(i));
  }

  forPro(proId, { limit = 30 } = {}) {
    return this.list({ proId, limit, sort: 'verified' });
  }

  detail(itemId) {
    const item = this.get(itemId);
    item.stats.views += 1;
    this.store.put('portfolioItems', item.itemId, item);
    const pro = this.store.get('pros', item.proId);
    return deepClone({
      ...item,
      tierLabel: TIER_LABEL[item.tier],
      pro: pro ? {
        proId: pro.proId,
        name: pro.displayName,
        rating: pro.stats.averageRating || null,
        completedJobs: pro.stats.completedJobs,
        badge: pro.badge,
        trustScore: pro.trustScore ?? null,
        suburb: pro.location?.suburb || null,
        metro: pro.location?.metro || null,
        instantBook: Boolean(pro.pricing?.instantBook),
        micrositeUrl: pro.micrositeUrl || null,
      } : null,
      verification: this.verificationStatement(item),
      enquiries: item.stats.enquiries,
    });
  }

  /** What a tier is allowed to say, written once and used everywhere. */
  verificationStatement(item) {
    if (item.tier === PORTFOLIO_TIER.CLIENT_CONFIRMED) {
      return {
        tier: item.tier,
        label: TIER_LABEL[item.tier],
        lines: [
          'The photos are proof of work from an escrow-released job on ProVeri.',
          `The homeowner on that job confirmed it${item.rating ? ` and rated it ${item.rating}/5` : ''}.`,
          item.geoVerified === false ? 'Note: a photo was captured away from the job address — flagged on the record.' : 'Photos were captured at the job address.',
        ],
      };
    }
    if (item.tier === PORTFOLIO_TIER.EVIDENCE_LINKED) {
      return {
        tier: item.tier,
        label: TIER_LABEL[item.tier],
        lines: [
          'The photos are proof of work from an escrow-released job on ProVeri.',
          'The customer confirmed the work to release payment; their review is separate.',
          item.geoVerified === false ? 'Note: a photo was captured away from the job address — flagged on the record.' : 'Photos were captured at the job address.',
        ],
      };
    }
    return {
      tier: item.tier,
      label: TIER_LABEL[item.tier],
      lines: [
        'The pro uploaded these photos. Nothing on ProVeri corroborates them yet.',
        'No verification badge is shown, and this item ranks below proven work.',
      ],
    };
  }

  summary(item) {
    const pro = this.store.get('pros', item.proId);
    return {
      itemId: item.itemId,
      reference: item.reference,
      title: item.title,
      description: item.description,
      categoryId: item.categoryId,
      categoryLabel: item.categoryLabel,
      suburb: item.suburb,
      metro: item.metro,
      suburbId: item.suburbId,
      completedAt: item.completedAt,
      priceCents: item.priceCents,
      priceNote: item.priceNote,
      photo: (() => {
        const best = item.photos.find((p) => p.url || p.dataUrl) || item.photos[0];
        return best ? { url: best.url, dataUrl: best.dataUrl, caption: best.caption, illustrative: best.illustrative, hash: best.hash } : null;
      })(),
      photoCount: item.photos.length,
      tier: item.tier,
      tierLabel: TIER_LABEL[item.tier],
      verified: item.tier !== PORTFOLIO_TIER.SELF_DECLARED,
      rating: item.rating,
      proId: item.proId,
      proName: pro ? pro.displayName : null,
      proRating: pro?.stats?.averageRating || null,
      proBadge: pro?.badge || null,
      proSuburb: pro?.location?.suburb || item.suburb || null,
      proMetro: pro?.location?.metro || item.metro || null,
      enquiries: item.stats.enquiries,
      illustrative: item.photos.some((p) => p.illustrative),
      seal: item.ledgerSeal || null,
      createdAt: item.createdAt,
    };
  }

  stats() {
    const items = this.store.all('portfolioItems');
    const byTier = items.reduce((acc, i) => { acc[i.tier] = (acc[i.tier] || 0) + 1; return acc; }, {});
    return {
      items: items.length,
      live: items.filter((i) => i.status === 'LIVE').length,
      byTier,
      verified: items.filter((i) => i.tier !== PORTFOLIO_TIER.SELF_DECLARED).length,
      harvested: items.filter((i) => i.source === 'HARVESTED').length,
      uploads: items.filter((i) => i.source !== 'HARVESTED').length,
      photos: items.reduce((n, i) => n + i.photos.length, 0),
      enquiries: items.reduce((n, i) => n + i.stats.enquiries, 0),
      flagged: items.filter((i) => i.status === 'FLAGGED').length,
      prosWithWork: new Set(items.map((i) => i.proId)).size,
    };
  }

  /* ================================================================== *
   * THE REACH-OUT LOOP
   * ================================================================== */

  /**
   * One conversation per (work item, homeowner). Every message is stamped with
   * the homeowner it belongs to, so two people asking about the same bathroom
   * never read each other's messages, and a pro's reply is addressed to the
   * homeowner — not back to the pro.
   */
  enquire({ itemId, customerId, body, actorId = null }) {
    const item = this.get(itemId);
    const from = actorId || customerId;
    if (!from) throw new Error('you must be signed in to message a pro');
    if (!body || !String(body).trim()) throw new Error('a message is required — write a line about the job you need');
    const fromPro = from === item.proId;
    let homeownerId = fromPro ? customerId : from;
    if (fromPro && !homeownerId) {
      // A pro replying without naming the homeowner: only unambiguous when one person has asked.
      const askers = [...new Set(this.store.find('messages', (m) => m.thread === `portfolio:${item.itemId}`)
        .map((m) => m.customerId || (m.fromUserId !== item.proId ? m.fromUserId : null))
        .filter(Boolean))];
      if (askers.length !== 1) throw new Error('customerId is required — say which homeowner you are replying to');
      homeownerId = askers[0];
    }
    if (fromPro && homeownerId === item.proId) throw new Error('you cannot message yourself about your own work');
    const message = {
      messageId: idFor('msg'),
      thread: `portfolio:${item.itemId}`,
      conversationId: `work.${item.itemId}.${homeownerId}`,
      itemId: item.itemId,
      customerId: homeownerId,
      fromUserId: from,
      fromRole: fromPro ? 'PRO' : 'CUSTOMER',
      toUserId: fromPro ? homeownerId : item.proId,
      body: String(body).trim().slice(0, 4000),
      at: nowIso(),
    };
    this.store.put('messages', message.messageId, message);
    if (!fromPro) item.stats.enquiries += 1;
    item.updatedAt = nowIso();
    this.store.put('portfolioItems', item.itemId, item);

    const sender = fromPro
      ? (this.store.get('pros', from)?.displayName || item.proName || 'The pro')
      : (this.store.get('customers', from)?.fullName || 'A homeowner');
    const notificationId = idFor('ntf');
    this.store.put('notifications', notificationId, {
      notificationId,
      userId: message.toUserId,
      type: fromPro ? 'PORTFOLIO_REPLY' : 'PORTFOLIO_ENQUIRY',
      title: fromPro ? `${sender} replied about "${item.title}"` : `New enquiry on "${item.title}"`,
      body: `${sender}: ${message.body}`.slice(0, 240),
      itemId: item.itemId,
      conversationId: message.conversationId,
      data: { itemId: item.itemId, conversationId: message.conversationId },
      createdAt: nowIso(),
      at: nowIso(),
      read: false,
    });
    this.kernel.ledger.append({
      action: fromPro ? 'PORTFOLIO_ENQUIRY_REPLY' : 'PORTFOLIO_ENQUIRY',
      subject: item.itemId,
      visibility: 'PRIVATE',
      payload: {
        summary: fromPro ? `Pro replied to an enquiry on "${item.title}"` : `Homeowner enquired on "${item.title}" (${item.categoryLabel})`,
        proId: item.proId,
      },
    });
    return deepClone(message);
  }

  /** The homeowner a stored message belongs to (older messages predate the stamp). */
  #homeownerOf(message, item) {
    if (message.customerId) return message.customerId;
    return message.fromUserId !== item.proId ? message.fromUserId : null;
  }

  listEnquiries({ itemId, userId, customerId = null }) {
    const item = this.get(itemId);
    const all = this.store.find('messages', (m) => m.thread === `portfolio:${itemId}`);
    let rows;
    if (userId === item.proId) {
      rows = customerId ? all.filter((m) => this.#homeownerOf(m, item) === customerId) : all;
    } else {
      rows = all.filter((m) => this.#homeownerOf(m, item) === userId);
      if (!rows.length) throw this.#forbidden('this conversation is not yours');
    }
    return rows
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((m) => deepClone(m));
  }

  /** Every enquiry conversation a user is part of — the work half of the inbox. */
  conversationsFor(userId) {
    const byConversation = new Map();
    for (const message of this.store.find('messages', (m) => typeof m.thread === 'string' && m.thread.startsWith('portfolio:'))) {
      const item = this.store.get('portfolioItems', message.itemId);
      if (!item) continue;
      const homeownerId = this.#homeownerOf(message, item);
      if (!homeownerId) continue;
      if (userId !== item.proId && userId !== homeownerId) continue;
      const conversationId = `work.${item.itemId}.${homeownerId}`;
      const entry = byConversation.get(conversationId) || { item, homeownerId, messages: [] };
      entry.messages.push(message);
      byConversation.set(conversationId, entry);
    }
    return [...byConversation.entries()].map(([conversationId, { item, homeownerId, messages }]) => {
      messages.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const customer = this.store.get('customers', homeownerId);
      const photo = (item.photos || []).find((p) => p.url || p.dataUrl);
      return {
        conversationId,
        kind: 'WORK_ENQUIRY',
        subject: item.title,
        itemId: item.itemId,
        categoryId: item.categoryId || null,
        photoUrl: photo ? (photo.url || null) : null,
        pro: { userId: item.proId, name: item.proName || this.store.get('pros', item.proId)?.displayName || 'Pro' },
        customer: { userId: homeownerId, name: customer?.fullName || 'Homeowner' },
        messages: messages.map((m) => deepClone(m)),
      };
    });
  }

  /* ================================================================== *
   * internals
   * ================================================================== */

  #sealPhoto(photo, proId, index) {
    if (!photo || typeof photo !== 'object') throw new Error(`invalid photo ${index + 1}: expected an object with a url, dataUrl or hash`);
    const dataUrl = photo.dataUrl || null;
    if (dataUrl && dataUrl.length > MAX_DATAURL_CHARS) {
      throw new Error(`photo ${index + 1} exceeds the upload limit — use a phone-sized image (under ~900 KB)`);
    }
    const capturedAt = photo.capturedAt || nowIso();
    const hash = sha256(dataUrl || photo.url || photo.hash || { index, caption: photo.caption });
    return {
      photoId: idFor('pht'),
      dataUrl,
      url: photo.url || null,
      source: dataUrl ? 'upload' : (photo.url ? 'hosted' : 'seal-only'),
      caption: photo.caption || null,
      capturedAt,
      geo: photo.geo ? { lat: photo.geo.lat, lon: photo.geo.lon, accuracyM: photo.geo.accuracyM ?? null } : null,
      hash,
      seal: sha256({ hash, proId, capturedAt }).slice(0, 16),
      illustrative: Boolean(photo.illustrative),
      distanceFromJobKm: null,
      geoVerified: null,
      order: index,
    };
  }

  /** Has another pro published this exact photo, anywhere? */
  #findElsewhere(photos, proId) {
    const hashes = photos.map((p) => p.hash);
    for (const other of this.store.all('portfolioItems')) {
      if (other.proId === proId) continue;
      const hit = other.photos.find((p) => hashes.includes(p.hash));
      if (hit) return { ownerProId: other.proId, source: `portfolio item ${other.reference}`, hash: hit.hash };
    }
    for (const booking of this.store.all('bookings')) {
      if (booking.proId === proId) continue;
      const hit = (booking.evidence || []).find((e) => hashes.includes(e.hash));
      if (hit) return { ownerProId: booking.proId, source: `proof of work on booking ${booking.reference}`, hash: hit.hash };
    }
    return null;
  }

  /**
   * A link to proof of work is only real if the booking is this pro's, and the
   * money actually moved. Anything else is a claim, and claims do not earn tiers.
   */
  #resolveEvidenceLink({ proId, bookingId, jobId }) {
    let booking = bookingId ? this.store.get('bookings', bookingId) : null;
    if (!booking && jobId) booking = this.store.find('bookings', (b) => b.jobId === jobId && b.proId === proId)[0] || null;
    if (!booking) return null;
    if (booking.proId !== proId) throw new Error('that job belongs to another pro — work you did not do cannot be linked to you');
    if (!RELEASED_STATUSES.includes(booking.status)) return null;

    const review = this.store.find('reviews', (r) => r.bookingId === booking.bookingId)[0] || null;
    const evidence = (booking.evidence || []).filter((e) => e.geoVerified !== false);
    return {
      booking,
      bookingId: booking.bookingId,
      jobId: booking.jobId,
      clientReference: booking.reference,
      completedAt: booking.completedAt || booking.warranty?.startsAt || booking.updatedAt,
      priceCents: booking.price?.totalCents ?? null,
      rating: review?.rating ?? null,
      clientConfirmed: Boolean(review && review.rating >= 4),
      geoVerified: evidence.length > 0 ? evidence.length === (booking.evidence || []).length : null,
      evidenceSeals: (booking.evidence || []).map((e) => e.seal),
    };
  }

  /** An authorisation failure is a 403, not a 500 — the server maps error.code. */
  #forbidden(message) {
    const error = new Error(message);
    error.code = 'FORBIDDEN';
    return error;
  }

  /** Sealed proof-of-work photos lifted straight off a booking's evidence trail. */
  #photosFromEvidence(booking) {
    const photoEvidence = (booking?.evidence || []).filter((e) => PHOTO_EVIDENCE_TYPES.includes(e.type));
    return photoEvidence.slice(0, MAX_PHOTOS).map((evidence, index) => ({
      photoId: idFor('pht'),
      dataUrl: null,
      // In production the evidence record carries the uploaded bytes; the seed
      // ships representative photographs and labels them illustrative.
      url: evidence.imageUrl || null,
      source: 'proof-of-work',
      caption: evidence.note || evidence.label,
      evidenceType: evidence.type,
      capturedAt: evidence.capturedAt,
      geo: evidence.geo,
      hash: evidence.hash,
      seal: evidence.seal,
      distanceFromJobKm: evidence.distanceFromJobKm,
      geoVerified: evidence.geoVerified,
      illustrative: Boolean(evidence.illustrative),
      order: index,
    }));
  }

  /** Bookings store the suburb by name; portfolio filters run on ids. */
  #suburbIdFor(suburbName) {
    if (!suburbName) return null;
    try { return this.catalog.findSuburbByName(suburbName)?.id || null; } catch { return null; }
  }

  /** catalog.get throws on unknown ids; a bad filter should not take the API down. */
  #category(categoryId) {
    if (!categoryId) return null;
    try { return this.catalog.get(categoryId); } catch { return null; }
  }

  #categoryLabel(categoryId) {
    return this.#category(categoryId)?.label || null;
  }
}

module.exports = { PortfolioService, PORTFOLIO_TIER, TIER_LABEL, TIER_WEIGHT };
