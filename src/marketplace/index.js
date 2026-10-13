'use strict';

/**
 * ProVeri — Marketplace facade.
 *
 * One object that composes the Trust Kernel, the verticals and the service
 * modules, and is the only thing the HTTP layer talks to. Every mutation goes
 * through here, so every mutation lands in the hash-chained audit ledger.
 */

const { TrustKernel } = require('../kernel/trustKernel');
const { VERTICALS } = require('../verticals');
const { Store } = require('./store');
const { Catalog } = require('./catalog');
const { PeopleService } = require('./people');
const { JobService } = require('./jobs');
const { BookingService } = require('./bookings');
const { VehicleService } = require('./vehicles');
const { WebStudioService } = require('./webstudio');
const { BusinessSiteStudio } = require('./businessSites');
const { SalesDeskService } = require('./leads');
const { PortfolioService } = require('./portfolio');
const { AuthService } = require('./auth');
const integrations = require('../integrations');
const { nowIso, deepClone, sha256 } = require('../kernel/util');

class Marketplace {
  constructor({ fees, persist = false, storeFile } = {}) {
    this.kernel = new TrustKernel({
      fees: {
        platformFeePercent: 10,
        warrantyHoldbackPercent: 5,
        confirmationWindowMinutes: 48 * 60,
        warrantyDays: 14,
        paymentWindowMinutes: 120,
        ...fees,
      },
      verticals: VERTICALS,
    });
    this.store = new Store({ persist, file: storeFile });
    this.catalog = new Catalog({ store: this.store });
    this.people = new PeopleService({ store: this.store, kernel: this.kernel, catalog: this.catalog });
    this.jobs = new JobService({ store: this.store, kernel: this.kernel, catalog: this.catalog, people: this.people });
    this.portfolio = new PortfolioService({ store: this.store, kernel: this.kernel, catalog: this.catalog, people: this.people });
    this.bookings = new BookingService({ store: this.store, kernel: this.kernel, catalog: this.catalog, people: this.people, jobs: this.jobs });
    this.bookings.attachPortfolio(this.portfolio);
    this.people.attachPortfolio(this.portfolio);
    this.vehicles = new VehicleService({ store: this.store, kernel: this.kernel, catalog: this.catalog, people: this.people });
    this.webStudio = new WebStudioService({ store: this.store, kernel: this.kernel, catalog: this.catalog, people: this.people });
    this.businessSites = new BusinessSiteStudio({ store: this.store, kernel: this.kernel, catalog: this.catalog, people: this.people, jobs: this.jobs });
    this.salesDesk = new SalesDeskService({ store: this.store, kernel: this.kernel, catalog: this.catalog, businessSites: this.businessSites, webStudio: this.webStudio, people: this.people });
    this.integrations = integrations;
    this.auth = new AuthService({ store: this.store, people: this.people, kernel: this.kernel, configuredPartners: () => integrations.configuredPartners() });
    this.startedAt = nowIso();
    this.schedulerTimer = null;
  }

  /* ---------------- inbox ---------------- */

  /**
   * Every conversation a person is in, newest first: enquiries about published
   * work (homeowner ↔ pro, before any job exists) and the chat on each booking.
   * Read state is a per-user marker, so "unread" means the same thing on every
   * device.
   */
  inbox(userId) {
    if (!userId) throw new Error('userId is required');
    const reads = this.store.get('inboxReads', userId) || { userId, markers: {} };
    const work = this.portfolio.conversationsFor(userId);
    // A booking chat exists from the moment the job is booked — an active job
    // always shows its thread, even before the first message.
    const bookings = this.store.find('bookings', (b) => (b.customerId === userId || b.proId === userId)
      && ((b.messages || []).length || !['CANCELLED', 'REFUNDED', 'CLOSED'].includes(b.status)))
      .map((b) => this.#bookingConversation(b));
    const conversations = [...work, ...bookings].map((c) => {
      const last = c.messages[c.messages.length - 1];
      const lastAt = last ? (last.at || last.createdAt) : (c.createdAt || null);
      const marker = reads.markers[c.conversationId] || null;
      const unread = c.messages.filter((m) => m.fromUserId !== userId && (!marker || String(m.at || m.createdAt) > marker)).length;
      const counterpart = c.pro.userId === userId ? c.customer : c.pro;
      return {
        conversationId: c.conversationId,
        kind: c.kind,
        subject: c.subject,
        itemId: c.itemId || null,
        bookingId: c.bookingId || null,
        categoryId: c.categoryId || null,
        photoUrl: c.photoUrl || null,
        counterpart,
        myRole: c.pro.userId === userId ? 'PRO' : 'CUSTOMER',
        lastMessage: last ? { body: last.body, fromMe: last.fromUserId === userId, at: lastAt } : null,
        lastAt,
        messageCount: c.messages.length,
        unread,
      };
    }).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
    return { userId, conversations, unread: conversations.reduce((n, c) => n + c.unread, 0) };
  }

  /** One conversation with its messages; opening it marks it read for this user. */
  conversation(userId, conversationId, { markRead = true } = {}) {
    const found = this.#findConversation(userId, conversationId);
    if (markRead) {
      const reads = this.store.get('inboxReads', userId) || { userId, markers: {} };
      reads.markers[conversationId] = nowIso();
      this.store.put('inboxReads', userId, reads);
    }
    const counterpart = found.pro.userId === userId ? found.customer : found.pro;
    return {
      conversationId,
      kind: found.kind,
      subject: found.subject,
      itemId: found.itemId || null,
      bookingId: found.bookingId || null,
      categoryId: found.categoryId || null,
      photoUrl: found.photoUrl || null,
      counterpart,
      myRole: found.pro.userId === userId ? 'PRO' : 'CUSTOMER',
      messages: found.messages.map((m) => ({
        messageId: m.messageId,
        body: m.body,
        at: m.at || m.createdAt,
        fromMe: m.fromUserId === userId,
        fromRole: m.fromRole || (m.fromUserId === found.pro.userId ? 'PRO' : 'CUSTOMER'),
        flagged: Boolean(m.flagged),
      })),
    };
  }

  /** Reply inside a conversation — routed to the enquiry or the booking chat. */
  sendToConversation(userId, conversationId, body) {
    const found = this.#findConversation(userId, conversationId);
    if (found.kind === 'WORK_ENQUIRY') {
      this.portfolio.enquire({ itemId: found.itemId, customerId: found.customer.userId, actorId: userId, body });
    } else {
      if (!body || !String(body).trim()) throw new Error('a message is required');
      this.bookings.sendMessage({ bookingId: found.bookingId, fromUserId: userId, body: String(body).trim() });
    }
    return this.conversation(userId, conversationId);
  }

  #bookingConversation(booking) {
    const messages = (booking.messages || []).map((id) => this.store.get('messages', id)).filter(Boolean)
      .sort((a, b) => String(a.createdAt || a.at).localeCompare(String(b.createdAt || b.at)));
    return {
      conversationId: `booking.${booking.bookingId}`,
      kind: 'BOOKING',
      subject: booking.title,
      bookingId: booking.bookingId,
      categoryId: booking.categoryId,
      photoUrl: null,
      pro: { userId: booking.proId, name: booking.proName },
      customer: { userId: booking.customerId, name: booking.customerName },
      createdAt: booking.createdAt,
      messages,
    };
  }

  #findConversation(userId, conversationId) {
    if (!userId) throw new Error('userId is required');
    const [kind, first, second] = String(conversationId || '').split('.');
    let found = null;
    if (kind === 'work' && first && second) {
      found = this.portfolio.conversationsFor(userId).find((c) => c.conversationId === conversationId) || null;
      if (!found) {
        // A brand-new conversation the homeowner is about to start.
        const item = this.store.get('portfolioItems', first);
        if (item && second === userId && item.proId !== userId) {
          found = {
            conversationId, kind: 'WORK_ENQUIRY', subject: item.title, itemId: item.itemId, categoryId: item.categoryId,
            photoUrl: (item.photos || []).find((p) => p.url)?.url || null,
            pro: { userId: item.proId, name: this.store.get('pros', item.proId)?.displayName || 'Pro' },
            customer: { userId, name: this.store.get('customers', userId)?.fullName || 'Homeowner' },
            messages: [],
          };
        }
      }
    } else if (kind === 'booking' && first) {
      const booking = this.store.get('bookings', first);
      if (booking && (booking.customerId === userId || booking.proId === userId)) found = this.#bookingConversation(booking);
    }
    if (!found) {
      const error = new Error('conversation not found');
      throw error;
    }
    return found;
  }

  /* ---------------- verticals ---------------- */

  verticals() {
    return this.kernel.listVerticals();
  }

  /* ---------------- cross-vertical bridge ---------------- */

  /**
   * When a services booking that touches a vehicle completes, write it into
   * that vehicle's Service Passport and (if the VIN is on a live listing) into
   * the listing's trust chain. This is the payoff of running both verticals on
   * one kernel.
   */
  bridgeBookingToVehicle({ bookingId, vin, reportHash, findings }) {
    const booking = this.store.get('bookings', bookingId);
    if (!booking) throw new Error(`booking ${bookingId} not found`);
    const category = this.catalog.get(booking.categoryId);
    if (!category.vehicleVerticalBridge) {
      return { bridged: false, reason: `${category.label} does not write to a vehicle passport` };
    }

    const pro = this.store.get('pros', booking.proId);
    const passport = this.vehicles.appendServiceToPassport({
      vin,
      bookingId,
      categoryId: booking.categoryId,
      summary: `${booking.title} completed and escrow-released on ProVeri`,
      evidenceIds: booking.evidence.map((e) => e.evidenceId),
      proName: pro?.displayName,
    });

    let listingBridge = null;
    const listing = this.store.findOne('vehicles', (v) => v.asset.vin === String(vin).toUpperCase() && v.status !== 'REMOVED');
    if (listing && booking.categoryId === 'vehicle-inspection') {
      listingBridge = this.vehicles.bridgeInspectionToListing({
        listingId: listing.listingId,
        bookingId,
        reportHash: reportHash || sha256(booking.bookingId),
        findings: findings || 'Independent pre-purchase inspection completed as an escrow-released ProVeri service job',
        inspectorProId: booking.proId,
      });
    }

    return { bridged: true, passport, listingBridge, category: category.label };
  }

  /* ---------------- scheduler ---------------- */

  startScheduler({ intervalMs = 60_000 } = {}) {
    if (this.schedulerTimer) return { started: false, reason: 'already running' };
    this.schedulerTimer = setInterval(() => {
      try {
        this.bookings.runScheduler();
      } catch (error) {
        this.kernel.ledger.append({
          action: 'SCHEDULER_ERROR',
          subject: 'platform',
          level: 'CRITICAL',
          payload: { summary: `Scheduler failed: ${error.message}` },
        });
      }
    }, intervalMs);
    this.schedulerTimer.unref?.();
    return { started: true, intervalMs };
  }

  stopScheduler() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    return { stopped: true };
  }

  runSchedulerOnce() {
    return this.bookings.runScheduler();
  }

  /* ---------------- platform views ---------------- */

  /** Public landing-page data: proof, not marketing adjectives. */
  publicSnapshot() {
    const jobStats = this.jobs.stats();
    const bookingStats = this.bookings.stats();
    const proCount = this.store.count('pros', (p) => p.canBid);
    const reviews = this.store.all('reviews').filter((r) => r.visible !== false);
    const ratings = reviews.map((r) => r.rating);
    const transparency = this.kernel.transparencyReport();

    return {
      brand: {
        name: 'ProVeri',
        tagline: 'Verified pros. Escrow-protected money. Proof of work.',
        promise: 'Post a job and get bids from KYC-verified pros near you — your money stays safe in escrow until the work is done. Or flip it: turn your skills into income, with payment guaranteed before you start.',
        country: 'South Africa',
        flag: '🇿🇦',
      },
      verticals: this.verticals(),
      supply: {
        verifiedPros: proCount,
        totalPros: this.store.count('pros'),
        elitePros: this.store.count('pros', (p) => p.badge === 'PROVERI_ELITE'),
        statutoryCertified: this.store.count('pros', (p) => p.statutoryTrade && p.canBid),
        metrosCovered: jobStats.metrosActive,
        categoriesLive: this.catalog.categories.size,
      },
      demand: jobStats,
      transactions: bookingStats,
      trust: {
        verifiedReviews: ratings.length,
        averageRating: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)) : null,
        reviewIntegrityClaim: 'Every review is written by a customer who paid for that job through ProVeri escrow. Ratings cannot be bought, and the escrow release is hash-sealed in the audit ledger.',
        ledgerEntries: transparency.ledgerEntries,
        chainValid: transparency.chainValid,
        publishedReceipt: transparency.publishedReceipt,
        policyRules: transparency.policy.rules,
        riskSignalsCatalogued: Object.keys(require('../kernel/risk').SIGNAL_CATALOGUE).length,
        checksPassed: transparency.verifications.passed,
        checksFailed: transparency.verifications.failed,
      },
      money: {
        heldInEscrowCents: bookingStats.escrow.currentlyHeldCents,
        releasedToProsCents: bookingStats.escrow.releasedToProsCents,
        refundedToCustomersCents: bookingStats.escrow.refundedToCustomersCents,
        warrantyHoldbackReleasedCents: bookingStats.warrantyHoldbackReleasedCents,
        platformFeePercent: this.kernel.escrow.fees.platformFeePercent,
        proSharePercent: 100 - this.kernel.escrow.fees.platformFeePercent,
        escrowPartners: Object.keys(require('../kernel/escrow').PROVIDERS).length,
      },
      guarantees: [
        { icon: '🔐', title: 'Your money is never at risk', body: `Customers pay into escrow when a bid is accepted. The pro is only paid after you confirm the work is done — and ${this.kernel.escrow.fees.warrantyHoldbackPercent}% stays held for a ${this.kernel.escrow.fees.warrantyDays}-day workmanship warranty.` },
        { icon: '🪪', title: 'Every pro is verified', body: 'Identity, phone, email and bank account are confirmed before anyone can bid. Statutory trades — electricians, plumbers, gas installers, builders, security — also need a certificate from the issuing body on file.' },
        { icon: '📸', title: 'Proof of work, not promises', body: 'Before-and-after photos are geotagged and hash-sealed against the job address. A photo taken 40 km away holds the payout.' },
        { icon: '⚖️', title: 'Disputes are decided on evidence', body: 'The dispute centre weighs hash-sealed evidence from both sides and publishes the weighting, so the outcome is auditable rather than arbitrary.' },
        { icon: '👩🏾‍💼', title: 'Real humans, real support', body: 'In-app help tickets with photo evidence, a dispute desk with a 48-hour target, and a team based in South Africa.' },
        { icon: '🇿🇦', title: 'Built for how Mzansi actually works', body: 'Load-shedding-aware scheduling, weather-aware quoting for exterior work, WhatsApp-first job posting, instant EFT and eWallet payouts, and Remit-a-Job so family abroad can pay for a relative’s repairs.' },
      ],
      studio: {
        liveBusinessSites: this.store.count('businessSites', (s) => s.status === 'LIVE'),
        industryTemplates: this.businessSites.templates().length,
        subscriptionPlans: this.businessSites.plans().length,
        bookingsTakenOnSites: this.store.count('siteBookings'),
        promise: this.businessSites.playbook().promise,
        difference: 'A ProVeri business site has no dead buttons. A booking on it creates a reservation with a reference number, or — when the business is a verified pro — posts a real job whose payment is held in escrow.',
      },
      labourMarket: this.integrations.MARKET.LABOUR_MARKET,
      generatedAt: nowIso(),
    };
  }

  /** Everything the PWA needs to work offline on first paint. */
  offlineBundle() {
    return {
      version: nowIso(),
      catalog: this.catalog.offlineBundle(),
      snapshot: this.publicSnapshot(),
      packages: this.webStudio.packages(),
      growthServices: this.webStudio.growthServices(),
      webStudioPromise: this.webStudio.promise(),
      siteTemplates: this.businessSites.templates(),
      sitePlans: this.businessSites.plans(),
      sitePlaybook: this.businessSites.playbook().positioning,
      publishedSites: this.businessSites.list({ publicOnly: true, limit: 24 }),
      verticals: this.verticals(),
      banks: this.integrations.bankVerification.listBanks(),
      payoutRails: Object.values(this.integrations.bankVerification.PAYOUT_RAILS),
      evidenceTypes: Object.entries(require('./bookings').EVIDENCE_TYPES).map(([id, def]) => ({ id, ...def })),
      integrations: this.integrations.CATALOGUE,
      policies: this.kernel.policy.ruleBook(),
    };
  }

  /** Admin console: what the trust desk needs to work. */
  adminConsole() {
    return {
      ledger: {
        integrity: this.kernel.ledger.integrityReceipt(),
        recentCritical: this.kernel.ledger.query({ level: 'CRITICAL', limit: 30 }).reverse(),
        recentTrust: this.kernel.ledger.query({ level: 'TRUST', limit: 20 }).reverse(),
      },
      policy: this.kernel.policy.stats(),
      risk: {
        stats: this.kernel.risk.stats(),
        highRiskSubjects: this.store.all('pros')
          .map((p) => ({ proId: p.proId, name: p.displayName, ...this.kernel.risk.assess(p.proId) }))
          .filter((a) => ['HIGH', 'CRITICAL'].includes(a.tier)),
      },
      escrow: this.kernel.escrow.portfolioStats(),
      queues: {
        prosAwaitingVerification: this.store.count('pros', (p) => p.status === 'IN_VERIFICATION'),
        jobsAwaitingBids: this.store.count('jobs', (j) => ['OPEN', 'BIDDING'].includes(j.status) && j.bidCount === 0),
        bookingsAwaitingConfirmation: this.store.count('bookings', (b) => b.status === 'AWAITING_CONFIRMATION'),
        disputesOpen: this.store.count('disputes', (d) => ['OPEN', 'EVIDENCE_WINDOW', 'UNDER_REVIEW', 'MEDIATION'].includes(d.status)),
        warrantiesOpen: this.store.count('bookings', (b) => b.status === 'IN_WARRANTY'),
        webStudioPipeline: this.store.count('webStudioOrders', (o) => !['DELIVERED', 'CANCELLED'].includes(o.status)),
        sitesAwaitingPermission: this.store.count('businessSites', (s) => s.permissions && !s.permissions.gateOpen),
        siteBookingsUnactioned: this.store.count('siteBookings', (b) => b.status === 'NEW'),
        leadsDueFollowUp: this.store.count('salesLeads', (l) => !['WON', 'LOST'].includes(l.stage) && l.nextActionAt && l.nextActionAt <= nowIso()),
      },
      bookings: this.bookings.stats(),
      jobs: this.jobs.stats(),
      vehicles: this.vehicles.stats(),
      webStudio: this.webStudio.stats(),
      businessSites: this.businessSites.stats(),
      salesDesk: this.salesDesk.stats(),
      nextBestActions: this.salesDesk.nextBestActions({ limit: 5 }),
      store: this.store.stats(),
      integrations: { mode: this.integrations.MODE, configured: this.integrations.configuredPartners(), http: this.integrations.httpClient.getStats() },
      generatedAt: nowIso(),
    };
  }

  /** Help-desk ticket with photo evidence. */
  openTicket({ userId, role, subject, description, photos = [], bookingId = null, priority = 'NORMAL' }) {
    const ticket = {
      ticketId: this.store.reference('TCK', 'ticket', 6),
      userId,
      role,
      subject,
      description,
      photos: photos.map((p) => ({ hash: sha256(p.hash || p), type: p.type || 'PHOTO', at: nowIso() })),
      bookingId,
      priority,
      status: 'OPEN',
      slaTargetHours: priority === 'URGENT' ? 4 : priority === 'HIGH' ? 12 : 48,
      messages: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.put('tickets', ticket.ticketId, ticket);
    this.kernel.ledger.append({
      action: 'SUPPORT_TICKET_OPENED',
      subject: ticket.ticketId,
      visibility: 'PUBLIC',
      payload: { summary: `${role} ticket ${ticket.ticketId}: ${subject}`, priority, slaTargetHours: ticket.slaTargetHours },
    });
    return deepClone(ticket);
  }

  listTickets({ userId, status } = {}) {
    let rows = this.store.all('tickets');
    if (userId) rows = rows.filter((t) => t.userId === userId);
    if (status) rows = rows.filter((t) => t.status === status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => deepClone(t));
  }

  replyToTicket({ ticketId, actorId, body, resolve = false }) {
    const ticket = this.store.get('tickets', ticketId);
    if (!ticket) throw new Error(`ticket ${ticketId} not found`);
    ticket.messages.push({ at: nowIso(), actorId, body });
    if (resolve) ticket.status = 'RESOLVED';
    ticket.updatedAt = nowIso();
    return deepClone(ticket);
  }

  /** Property vertical waitlist (coming soon). */
  joinPropertyWaitlist(contact) {
    const result = this.kernel.joinWaitlist('property', contact);
    this.store.data.waitlist.push({ ...contact, ...result, at: nowIso() });
    return result;
  }

  toJSON() {
    return {
      startedAt: this.startedAt,
      kernel: this.kernel.toJSON(),
      store: this.store.stats(),
    };
  }
}

module.exports = { Marketplace };
