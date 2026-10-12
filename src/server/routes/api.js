'use strict';

/**
 * Lula ProVeri — REST API surface.
 *
 * Every route is registered with metadata (tag + summary) so `GET /api/openapi.json`
 * is generated from what actually exists rather than from a hand-maintained spec
 * that drifts.
 */

const { Router, badRequest, notFound, HttpError } = require('../router');
const { nowIso, deepClone } = require('../../kernel/util');
const integrations = require('../../integrations');
const { synthesiseSaId } = require('../../integrations/saIdentity');

function buildApiRoutes({ marketplace }) {
  const router = new Router();
  const mp = marketplace;
  const require_ = (value, field) => {
    if (value === undefined || value === null || value === '') throw badRequest(`${field} is required`);
    return value;
  };
  const wrap = (fn) => async (ctx) => fn(ctx);

  /* ================= platform ================= */

  router.get('/api/health', () => ({
    status: 'ok',
    service: 'lula-proveri',
    version: require('../../../package.json').version,
    uptimeSeconds: Math.round(process.uptime()),
    integrationMode: integrations.MODE,
    configuredPartners: integrations.configuredPartners(),
    ledger: mp.kernel.ledger.integrityReceipt(),
    checkedAt: nowIso(),
  }), { tags: ['platform'], summary: 'Liveness, integration posture and ledger integrity receipt' });

  router.get('/api/snapshot', () => mp.publicSnapshot(), { tags: ['platform'], summary: 'Public landing snapshot — live proof, not marketing adjectives' });

  router.get('/api/offline-bundle', () => mp.offlineBundle(), { tags: ['platform'], summary: 'Everything the PWA needs to render and work offline on first paint' });

  router.get('/api/openapi.json', () => router.openapi({
    title: 'Lula ProVeri API',
    version: '1.0.0',
    description: 'South Africa’s verified on-demand services marketplace. Jobs, bidding, escrow, proof-of-work evidence, disputes, verified reviews, the vehicles vertical and Web Studio — all on one hash-chained trust ledger.',
  }), { tags: ['platform'], summary: 'OpenAPI 3.1 document generated from the registered routes' });

  router.get('/api/verticals', () => ({
    verticals: mp.verticals(),
    propertyWaitlist: mp.store.data.waitlist.length,
  }), { tags: ['platform'], summary: 'Verticals: services (live), vehicles (beta), property (coming soon)' });

  router.post('/api/verticals/:verticalId/waitlist', wrap(async ({ params, body }) => {
    return mp.kernel.joinWaitlist(params.verticalId, body);
  }), { tags: ['platform'], summary: 'Join the property-vertical waitlist' });

  router.post('/api/scheduler/run', () => mp.runSchedulerOnce(), { tags: ['platform'], summary: 'Run the scheduler sweep: auto-release, warranty close, dispute escalation, job expiry' });

  /* ================= catalogue & geography ================= */

  router.get('/api/categories', ({ query }) => mp.catalog.listCategories({ group: query.group, search: query.q }), { tags: ['catalogue'], summary: 'Service categories with statutory trade rules, price bands and evidence requirements' });

  router.get('/api/categories/:categoryId', ({ params }) => {
    const category = mp.catalog.get(params.categoryId);
    return {
      ...mp.catalog.summarize(category),
      commonJobs: category.commonJobs,
      keywords: category.keywords,
      evidenceRequired: category.evidenceRequired,
      requiredEvidenceLabels: category.evidenceRequired.map((t) => require('../../marketplace/bookings').EVIDENCE_TYPES[t]?.label || t),
      regulator: mp.catalog.regulatorFor(params.categoryId),
    };
  }, { tags: ['catalogue'], summary: 'One category in full' });

  router.get('/api/metros', () => ({ metros: mp.catalog.listMetros(), provinces: mp.catalog.provinces }), { tags: ['catalogue'], summary: 'Metros, provinces and suburb counts' });

  router.get('/api/metros/:metroId/suburbs', ({ params }) => mp.catalog.listSuburbs(params.metroId), { tags: ['catalogue'], summary: 'Suburbs in a metro with coordinates and postal codes' });

  router.get('/api/price-band', ({ query }) => {
    require_(query.categoryId, 'categoryId');
    return mp.catalog.priceGuidance(query.categoryId, query.metroId || null, { scopeText: query.scope || undefined });
  }, { tags: ['catalogue'], summary: 'Fair-Price Intelligence band for a category in a metro' });

  router.post('/api/catalogue/resolve', wrap(async ({ body }) => ({
    resolution: mp.catalog.resolveFromText(body.text),
    priceGuidance: null,
  })), { tags: ['catalogue'], summary: 'Resolve a free-text job description to a category' });

  router.get('/api/geography/search', wrap(async ({ query }) => {
    require_(query.q, 'q');
    return mp.catalog.geocodeAddress(query.q);
  }), { tags: ['catalogue'], summary: 'Geocode a South African address (live OSM Nominatim, bundled fallback)' });

  router.get('/api/geography/nearby', ({ query }) => {
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw badRequest('lat and lon are required');
    return mp.catalog.suburbsWithinKm({ lat, lon }, Number(query.radiusKm || 20));
  }, { tags: ['catalogue'], summary: 'Suburbs within a radius of a coordinate' });

  /* ================= people & verification ================= */

  router.post('/api/customers', wrap(async ({ body }) => mp.people.registerCustomer(body)), { tags: ['people'], summary: 'Register a customer' });

  router.post('/api/customers/:customerId/verify-channel', wrap(async ({ params, body }) => mp.people.verifyCustomerChannel(params.customerId, body)), { tags: ['people'], summary: 'Confirm an email or mobile one-time PIN' });

  router.get('/api/customers/:customerId', ({ params }) => mp.people.getCustomer(params.customerId), { tags: ['people'], summary: 'One customer' });

  router.post('/api/pros', wrap(async ({ body }) => mp.people.registerPro(body)), { tags: ['people'], summary: 'Register a service professional (draft — cannot bid until verified)' });

  router.post('/api/pros/:proId/verify', wrap(async ({ params, body }) => {
    const result = await mp.people.runVerificationPipeline(params.proId, { credentials: integrations.credentials() });
    delete result.pro.__idNumber;
    return result;
  }), { tags: ['people', 'trust'], summary: 'Run the full multi-source KYC / trade verification pipeline' });

  router.get('/api/pros', ({ query }) => mp.people.listPros({
    categoryId: query.categoryId,
    metroId: query.metroId,
    suburbId: query.suburbId,
    badge: query.badge,
    instantBook: query.instantBook === 'true',
    search: query.q,
    lat: query.lat != null ? Number(query.lat) : undefined,
    lon: query.lon != null ? Number(query.lon) : undefined,
    radiusKm: query.radiusKm ? Number(query.radiusKm) : undefined,
    limit: query.limit ? Number(query.limit) : 50,
  }), { tags: ['people'], summary: 'Search verified pros by category, metro, radius, badge and instant-book' });

  router.get('/api/pros/:proId', ({ params }) => mp.people.publicProfile(params.proId), { tags: ['people'], summary: 'Public pro profile with verified reviews and audit timeline' });

  router.get('/api/pros/:proId/trust', ({ params }) => mp.people.trustCard(params.proId), { tags: ['people', 'trust'], summary: 'Full trust card: every check, its source, reference, seal and expiry' });

  router.get('/api/pros/:proId/tax-summary', ({ params, query }) => mp.bookings.taxSummary(params.proId, { taxYear: query.taxYear ? Number(query.taxYear) : undefined }), { tags: ['people', 'money'], summary: 'SARS-ready income summary built from the escrow ledger' });

  router.get('/api/pros/:proId/wallet', ({ params }) => mp.bookings.walletFor(params.proId), { tags: ['people', 'money'], summary: 'Wallet: balance, escrow held, warranty holdbacks, payout rails' });

  router.post('/api/pros/:proId/bank-change', wrap(async ({ params, body }) => {
    require_(body.newBank, 'newBank');
    return mp.people.requestBankChange(params.proId, { newBank: body.newBank, actorId: body.actorId, callBackConfirmed: Boolean(body.callBackConfirmed) });
  }), { tags: ['people', 'trust'], summary: 'Change payout bank details — policy BDS-001 freezes payouts until call-back verification' });

  router.get('/api/banks', () => ({ banks: integrations.bankVerification.listBanks(), payoutRails: Object.values(integrations.bankVerification.PAYOUT_RAILS) }), { tags: ['people', 'money'], summary: 'Supported South African banks, universal branch codes and payout rails' });

  router.get('/api/trade-registers', () => ({ registers: integrations.TRADE_REGISTERS.publicRegisters(), regulators: require('../../kernel/verification').TRADE_REGULATORS }), { tags: ['trust'], summary: 'Statutory trade registers: NHBRC, PSIRA, PIRB, SAQCC, DoEL, PPRA, LPC, SANC' });

  router.post('/api/verify/sa-id', wrap(async ({ body }) => {
    require_(body.idNumber, 'idNumber');
    const result = integrations.saIdentity.validateSaId(body.idNumber);
    // Never echo the raw ID back; the seal is what gets stored.
    return { ...result, idNumber: undefined };
  }), { tags: ['trust'], summary: 'Validate a 13-digit South African ID (Luhn + date + citizenship decode), free and offline' });

  router.post('/api/verify/bank', wrap(async ({ body }) => {
    return integrations.bankVerification.verifyAccountHolder(body, { adapter: null });
  }), { tags: ['trust'], summary: 'Verify payout bank details (shape locally, AVS-R name match via adapter)' });

  router.post('/api/verify/registration-number', wrap(async ({ body }) => integrations.COMPANY_REGISTRY.validateRegistrationNumber(body.registrationNumber)), { tags: ['trust'], summary: 'Validate a CIPC registration number format and decode the entity type' });

  router.post('/api/verify/company', wrap(async ({ body }) => integrations.COMPANY_REGISTRY.verify({
    registrationNumber: body.registrationNumber,
    companyName: body.companyName,
    apiKey: integrations.credentials().cipcApiKey,
  })), { tags: ['trust'], summary: 'CIPC company status check (live with a key; honest WARN offline)' });

  router.get('/api/verify/qualifications/:trade', wrap(async ({ params, query }) => integrations.QUALIFICATIONS.forTrade(params.trade, { live: query.live === 'true' })), { tags: ['trust'], summary: 'SAQA / NQF qualifications for a trade' });

  router.post('/api/verify/rpl-pathway', wrap(async ({ body }) => integrations.QUALIFICATIONS.rplPathway(require_(body.trade, 'trade'))), { tags: ['trust'], summary: 'Recognition of Prior Learning pathway for skilled but uncertified pros' });

  /* ================= jobs & bidding ================= */

  router.post('/api/jobs', wrap(async ({ body }) => {
    require_(body.customerId, 'customerId');
    require_(body.categoryId, 'categoryId');
    require_(body.description, 'description');
    return mp.jobs.postJob(body);
  }), { tags: ['jobs'], summary: 'Post a job — matching, weather, load-shedding and holiday advice run immediately' });

  router.get('/api/jobs', ({ query }) => mp.jobs.listJobs({
    customerId: query.customerId,
    proId: query.proId,
    status: query.status,
    categoryId: query.categoryId,
    metroId: query.metroId,
    limit: query.limit ? Number(query.limit) : 50,
  }), { tags: ['jobs'], summary: 'List jobs' });

  router.get('/api/jobs/:jobId', ({ params, query }) => mp.jobs.getJob(params.jobId, { viewerId: query.viewerId }), { tags: ['jobs'], summary: 'One job with its bids, market band, weather, load-shedding and safety advice' });

  router.patch('/api/jobs/:jobId', wrap(async ({ params, body }) => mp.jobs.amendJob(params.jobId, { ...body })), { tags: ['jobs'], summary: 'Amend a job — existing bids are flagged for re-consent because the scope changed' });

  router.get('/api/jobs/:jobId/match', wrap(async ({ params }) => mp.jobs.matchPros(params.jobId)), { tags: ['jobs'], summary: 'Explainable pro matching with a published fairness statement' });

  router.post('/api/jobs/:jobId/bids', wrap(async ({ params, body }) => {
    require_(body.proId, 'proId');
    require_(body.totalCents, 'totalCents');
    return mp.jobs.submitBid({ jobId: params.jobId, ...body });
  }), { tags: ['jobs', 'bidding'], summary: 'Submit a bid — KYC-001, TRD-001 and ECC-001 are enforced before it is accepted' });

  router.get('/api/jobs/:jobId/instant-quote', ({ params, query }) => mp.jobs.instantQuote({ jobId: params.jobId, proId: require_(query.proId, 'proId') }), { tags: ['jobs', 'bidding'], summary: 'Fixed-price instant-book quote' });

  router.post('/api/jobs/:jobId/beat-the-quote', wrap(async ({ params, body }) => mp.jobs.beatTheQuote({ jobId: params.jobId, ...body })), { tags: ['jobs', 'bidding'], summary: 'Invite competing verified pros to beat a specific bid' });

  router.post('/api/bids/:bidId/withdraw', wrap(async ({ params, body }) => mp.jobs.withdrawBid(params.bidId, body)), { tags: ['bidding'], summary: 'Withdraw a bid' });

  router.get('/api/bids', ({ query }) => mp.jobs.listBids({ jobId: query.jobId, proId: query.proId, status: query.status }), { tags: ['bidding'], summary: 'List bids' });

  /* ================= bookings, escrow & evidence ================= */

  router.post('/api/bookings', wrap(async ({ params, body }) => {
    require_(body.jobId, 'jobId');
    require_(body.bidId, 'bidId');
    require_(body.customerId, 'customerId');
    return mp.bookings.acceptBid(body);
  }), { tags: ['bookings'], summary: 'Accept a bid — creates the booking, opens escrow and issues the arrival gate code' });

  router.get('/api/bookings', ({ query }) => mp.bookings.listBookings({
    customerId: query.customerId,
    proId: query.proId,
    status: query.status,
    limit: query.limit ? Number(query.limit) : 50,
  }), { tags: ['bookings'], summary: 'List bookings' });

  router.get('/api/bookings/:bookingId', ({ params, query }) => mp.bookings.getBooking(params.bookingId, { viewerId: query.viewerId }), { tags: ['bookings'], summary: 'One booking with escrow, evidence, payout, dispute and audit trail' });

  router.post('/api/bookings/:bookingId/fund', wrap(async ({ params, body }) => {
    require_(body.customerId, 'customerId');
    return mp.bookings.fundBooking({ bookingId: params.bookingId, ...body });
  }), { tags: ['bookings', 'money'], summary: 'Fund the escrow (domestic or Remit-a-Job from abroad)' });

  router.post('/api/bookings/:bookingId/eta', wrap(async ({ params, body }) => mp.bookings.shareEta({ bookingId: params.bookingId, ...body })), { tags: ['bookings', 'safety'], summary: 'Pro shares a live ETA' });

  router.post('/api/bookings/:bookingId/arrival-code', wrap(async ({ params, body }) => {
    require_(body.customerId, 'customerId');
    require_(body.code, 'code');
    return mp.bookings.verifyArrivalCode({ bookingId: params.bookingId, ...body });
  }), { tags: ['bookings', 'safety'], summary: 'Verify the pro’s one-time arrival code at the door' });

  router.post('/api/bookings/:bookingId/check-in', wrap(async ({ params, body }) => mp.bookings.checkIn({ bookingId: params.bookingId, ...body })), { tags: ['bookings', 'safety'], summary: 'Record an arrival, start or departure check-in' });

  router.get('/api/bookings/:bookingId/safety-plan', ({ params }) => {
    const booking = mp.store.get('bookings', params.bookingId);
    if (!booking) throw notFound('booking not found');
    const suburb = mp.catalog.suburb(booking.address.suburbId) || null;
    return mp.kernel.risk.safetyPlan(params.bookingId, {
      booking: { ...booking, locationType: booking.address.locationType },
      customer: mp.store.get('customers', booking.customerId),
      pro: mp.store.get('pros', booking.proId),
      locality: suburb ? { suburb: suburb.name } : null,
    });
  }, { tags: ['bookings', 'safety'], summary: 'Pre-visit safety plan — verification friction only, never ranking' });

  router.post('/api/bookings/:bookingId/evidence', wrap(async ({ params, body }) => {
    require_(body.proId, 'proId');
    require_(body.items, 'items');
    return mp.bookings.submitEvidence({ bookingId: params.bookingId, ...body });
  }), { tags: ['bookings', 'trust'], summary: 'Submit geotagged, hash-sealed proof of work' });

  router.post('/api/bookings/:bookingId/confirm', wrap(async ({ params, body }) => {
    require_(body.customerId, 'customerId');
    return mp.bookings.confirmCompletion({ bookingId: params.bookingId, ...body });
  }), { tags: ['bookings', 'money'], summary: 'Confirm the work — releases escrow, pays the pro, starts the warranty' });

  router.post('/api/bookings/:bookingId/reject', wrap(async ({ params, body }) => {
    require_(body.customerId, 'customerId');
    return mp.bookings.rejectWork({ bookingId: params.bookingId, ...body });
  }), { tags: ['bookings'], summary: 'Reject submitted work — money stays in escrow' });

  router.post('/api/bookings/:bookingId/variations', wrap(async ({ params, body }) => mp.bookings.proposeVariation({ bookingId: params.bookingId, ...body })), { tags: ['bookings'], summary: 'Propose a variation order — the locked scope cannot change without customer approval' });

  router.post('/api/bookings/:bookingId/variations/:variationId/decide', wrap(async ({ params, body }) => mp.bookings.decideVariation({
    bookingId: params.bookingId,
    variationId: params.variationId,
    customerId: require_(body.customerId, 'customerId'),
    approve: Boolean(body.approve),
    comment: body.comment,
  })), { tags: ['bookings'], summary: 'Approve or decline a variation order' });

  router.post('/api/bookings/:bookingId/cancel', wrap(async ({ params, body }) => mp.bookings.cancel({ bookingId: params.bookingId, ...body })), { tags: ['bookings', 'money'], summary: 'Cancel a booking — ECT Act s44 cooling-off applies before work starts' });

  router.post('/api/bookings/:bookingId/warranty-defect', wrap(async ({ params, body }) => mp.bookings.reportWarrantyDefect({ bookingId: params.bookingId, ...body })), { tags: ['bookings', 'trust'], summary: 'Report a defect inside the workmanship warranty window' });

  router.post('/api/bookings/:bookingId/messages', wrap(async ({ params, body }) => {
    require_(body.fromUserId, 'fromUserId');
    require_(body.body, 'body');
    return mp.bookings.sendMessage({ bookingId: params.bookingId, fromUserId: body.fromUserId, body: body.body, attachments: body.attachments });
  }), { tags: ['bookings', 'safety'], summary: 'Send a message — policy OFP-001 detects off-platform payment solicitation' });

  router.get('/api/bookings/:bookingId/messages', ({ params, query }) => mp.bookings.listMessages(params.bookingId, { userId: query.userId }), { tags: ['bookings'], summary: 'Booking conversation' });

  /* ================= disputes ================= */

  router.post('/api/bookings/:bookingId/disputes', wrap(async ({ params, body }) => {
    require_(body.openedBy, 'openedBy');
    require_(body.role, 'role');
    return mp.bookings.openDispute({ bookingId: params.bookingId, ...body });
  }), { tags: ['disputes'], summary: 'Open a dispute — escrow freezes immediately' });

  router.get('/api/disputes', ({ query }) => mp.bookings.listDisputes(query), { tags: ['disputes'], summary: 'List disputes' });

  router.post('/api/disputes/:disputeId/evidence', wrap(async ({ params, body }) => mp.bookings.submitDisputeEvidence({ disputeId: params.disputeId, ...body })), { tags: ['disputes'], summary: 'Submit dispute evidence' });

  router.post('/api/disputes/:disputeId/resolve', wrap(async ({ params, body }) => {
    require_(body.outcome, 'outcome');
    return mp.bookings.resolveDispute({ disputeId: params.disputeId, resolvedBy: body.resolvedBy || 'lula-dispute-desk', ...body });
  }), { tags: ['disputes'], summary: 'Resolve a dispute with published evidence weighting' });

  /* ================= reviews ================= */

  router.post('/api/bookings/:bookingId/reviews', wrap(async ({ params, body }) => {
    require_(body.customerId, 'customerId');
    require_(body.rating, 'rating');
    return mp.bookings.writeReview({ bookingId: params.bookingId, ...body });
  }), { tags: ['reviews'], summary: 'Write a review — REV-001 allows only escrow-released bookings, so ratings cannot be bought' });

  router.get('/api/reviews', ({ query }) => mp.bookings.listReviews({
    proId: query.proId,
    categoryId: query.categoryId,
    suburbId: query.suburbId,
    minRating: query.minRating ? Number(query.minRating) : undefined,
    limit: query.limit ? Number(query.limit) : 50,
  }), { tags: ['reviews'], summary: 'Verified reviews only' });

  router.post('/api/reviews/:reviewId/respond', wrap(async ({ params, body }) => mp.bookings.respondToReview({ reviewId: params.reviewId, proId: require_(body.proId, 'proId'), response: require_(body.response, 'response') })), { tags: ['reviews'], summary: 'Pro responds to a review' });

  router.get('/api/reviews/integrity/:proId', ({ params }) => mp.bookings.detectReviewManipulation(params.proId), { tags: ['reviews', 'trust'], summary: 'Review-integrity scan: repeated reviewers, bursts and micro-job five-stars' });

  /* ================= vehicles vertical ================= */

  router.get('/api/vehicles', ({ query }) => mp.vehicles.list({
    status: query.status,
    make: query.make,
    metroId: query.metroId,
    minPriceCents: query.minPriceCents ? Number(query.minPriceCents) : undefined,
    maxPriceCents: query.maxPriceCents ? Number(query.maxPriceCents) : undefined,
    verifiedOnly: query.verifiedOnly === 'true',
    search: query.q,
  }), { tags: ['vehicles'], summary: 'Verified vehicle listings' });

  router.post('/api/vehicles', wrap(async ({ body }) => {
    require_(body.sellerId, 'sellerId');
    require_(body.vin, 'vin');
    return mp.vehicles.createListing(body);
  }), { tags: ['vehicles'], summary: 'Create a vehicle listing' });

  router.get('/api/vehicles/:listingId', ({ params }) => mp.vehicles.get(params.listingId), { tags: ['vehicles'], summary: 'One vehicle listing with audit trail and release order' });

  router.get('/api/vehicles/:listingId/buyer-answer', ({ params }) => mp.vehicles.buyerAnswer(params.listingId), { tags: ['vehicles', 'trust'], summary: 'The full buyer question, answered check by check' });

  router.patch('/api/vehicles/:listingId', wrap(async ({ params, body }) => mp.vehicles.updateListing(params.listingId, body.patch || {}, { actorId: body.actorId, reason: body.reason })), { tags: ['vehicles', 'trust'], summary: 'Edit a listing — VCL-001 removes it if a verified identifier changed' });

  router.post('/api/vehicles/:listingId/checks', wrap(async ({ params, body }) => mp.vehicles.submitChecks(params.listingId, require_(body.checks, 'checks'), { actorId: body.actorId })), { tags: ['vehicles', 'trust'], summary: 'Submit vehicle verification checks' });

  router.post('/api/vehicles/:listingId/negotiations', wrap(async ({ params, body }) => mp.vehicles.startNegotiation(params.listingId, body)), { tags: ['vehicles'], summary: 'Start negotiating — locks description, price and terms' });

  router.post('/api/vehicles/:listingId/addenda', wrap(async ({ params, body }) => mp.vehicles.proposeAddendum(params.listingId, body)), { tags: ['vehicles'], summary: 'Propose an addendum to locked terms' });

  router.post('/api/vehicles/:listingId/funds-confirmation', wrap(async ({ params, body }) => mp.vehicles.confirmBuyerFunds(params.listingId, body)), { tags: ['vehicles', 'money'], summary: 'Privacy-preserving buyer funds confirmation' });

  router.post('/api/vehicles/:listingId/escrow', wrap(async ({ params, body }) => mp.vehicles.openEscrow(params.listingId, body)), { tags: ['vehicles', 'money'], summary: 'Open escrow with the title-holder release order' });

  router.post('/api/vehicles/:listingId/handover-evidence', wrap(async ({ params, body }) => mp.vehicles.addHandoverEvidence(params.listingId, body)), { tags: ['vehicles'], summary: 'Submit handover evidence — a VIN mismatch removes the listing' });

  router.post('/api/vehicles/:listingId/release', wrap(async ({ params, body }) => mp.vehicles.release(params.listingId, body)), { tags: ['vehicles', 'money'], summary: 'Release escrow after handover acceptance' });

  router.get('/api/vehicles/passport/:vin', ({ params }) => {
    const passport = mp.vehicles.getPassport(params.vin);
    if (!passport) throw notFound('no Service Passport for that VIN');
    return passport;
  }, { tags: ['vehicles', 'trust'], summary: 'Vehicle Service Passport — every entry backed by an escrow-released job' });

  router.post('/api/vehicles/passport', wrap(async ({ body }) => mp.vehicles.appendServiceToPassport(body)), { tags: ['vehicles', 'trust'], summary: 'Append a service entry to a Vehicle Service Passport' });

  router.post('/api/vehicles/bridge', wrap(async ({ body }) => mp.bridgeBookingToVehicle(body)), { tags: ['vehicles', 'trust'], summary: 'Bridge a completed service job into the vehicles vertical — the cross-vertical merge' });

  router.post('/api/vehicles/vin-check', wrap(async ({ body }) => require('../../marketplace/vehicles').vinCheckDigit(require_(body.vin, 'vin'))), { tags: ['vehicles'], summary: 'ISO 3779 VIN structure and check-digit analysis' });

  /* ================= Web Studio ================= */

  router.get('/api/webstudio', () => ({
    promise: mp.webStudio.promise(),
    packages: mp.webStudio.packages(),
    growthServices: mp.webStudio.growthServices(),
    freeMicrosite: require('../../../data/webstudio.json').freeProVeriMicrosite,
    contact: mp.webStudio.contact(),
    stats: mp.webStudio.stats(),
  }), { tags: ['webstudio'], summary: 'Web Studio catalogue, growth services and stats' });

  router.get('/api/webstudio/microsites', () => mp.webStudio.listMicrosites(), { tags: ['webstudio'], summary: 'Free auto-generated pro microsites' });

  router.post('/api/webstudio/microsites/:proId/generate', wrap(async ({ params, body }) => mp.webStudio.generateProMicrosite(params.proId, body)), { tags: ['webstudio'], summary: 'Generate or regenerate a pro’s free microsite from the verified profile' });

  router.post('/api/webstudio/orders', wrap(async ({ body }) => mp.webStudio.createEnquiry({ ...body, contact: require_(body.contact, 'contact') })), { tags: ['webstudio'], summary: 'Start a Web Studio enquiry — preview before you pay' });

  router.get('/api/webstudio/orders', ({ query }) => mp.webStudio.listOrders(query), { tags: ['webstudio'], summary: 'List Web Studio orders' });

  router.post('/api/webstudio/orders/:orderId/preview', wrap(async ({ params, body }) => mp.webStudio.buildPreview(params.orderId, body || {})), { tags: ['webstudio'], summary: 'Build the live preview (R0 taken so far)' });

  router.post('/api/webstudio/orders/:orderId/preview-decision', wrap(async ({ params, body }) => mp.webStudio.approvePreview(params.orderId, body)), { tags: ['webstudio'], summary: 'Approve or request changes to the preview — escrow opens only on approval' });

  router.post('/api/webstudio/orders/:orderId/pay', wrap(async ({ params, body }) => mp.webStudio.payOrder(params.orderId, body)), { tags: ['webstudio', 'money'], summary: 'Pay into escrow after preview approval' });

  router.post('/api/webstudio/orders/:orderId/milestones/:seq/complete', wrap(async ({ params, body }) => mp.webStudio.completeMilestone(params.orderId, { milestoneSeq: Number(params.seq), ...body })), { tags: ['webstudio', 'money'], summary: 'Complete a Web Studio milestone and release that portion' });

  router.post('/api/webstudio/diagnostic', wrap(async ({ body }) => mp.webStudio.rescueDiagnostic({ url: require_(body.url, 'url'), contact: body.contact })), { tags: ['webstudio'], summary: 'Free website rescue diagnostic — yours whether or not you buy anything' });

  /* ================= Business Site Studio ================= */

  router.get('/api/sites/templates', () => ({
    templates: mp.businessSites.templates(),
    sectionKinds: mp.businessSites.playbook().sectionKinds,
    bookingIntake: mp.businessSites.playbook().bookingIntake,
  }), { tags: ['sites'], summary: 'Industry site templates: sections, booking schemas, theme presets' });

  router.get('/api/sites/plans', () => ({
    promise: mp.businessSites.playbook().promise,
    positioning: mp.businessSites.playbook().positioning,
    plans: mp.businessSites.plans(),
    comparison: mp.businessSites.playbook().comparison,
  }), { tags: ['sites', 'money'], summary: 'Monthly website plans, update allowances and the honest boundaries' });

  router.get('/api/sites/playbook', () => mp.businessSites.playbook(), { tags: ['sites'], summary: 'The full studio playbook: pricing strategy, pitch, permission checklist, AI image workflow, deploy targets' });

  router.get('/api/sites/stats', () => mp.businessSites.stats(), { tags: ['sites'], summary: 'Business Site Studio telemetry: sites, bookings, MRR, permission gates' });

  router.get('/api/sites/gallery', ({ query }) => mp.businessSites.renderSitesIndexHtml(), { tags: ['sites'], summary: 'HTML gallery of every studio site (server-rendered, no JS)' });

  router.get('/api/sites/export-bundle', () => mp.businessSites.exportBundle(), { tags: ['sites'], summary: 'Deploy bundle: one self-contained HTML file per site plus index, sitemap and a GitHub Pages workflow' });

  router.get('/api/sites/bookings', ({ query }) => mp.businessSites.listBookings({ status: query.status || null, limit: query.limit ? Number(query.limit) : 100 }), { tags: ['sites'], summary: 'Every booking taken on a studio site' });

  router.get('/api/sites', ({ query }) => mp.businessSites.list({
    status: query.status || null,
    templateId: query.templateId || null,
    proId: query.proId || null,
    leadId: query.leadId || null,
    publicOnly: query.publicOnly === 'true',
    limit: query.limit ? Number(query.limit) : 100,
  }), { tags: ['sites'], summary: 'List business sites (publicOnly=true returns only published ones)' });

  router.post('/api/sites', wrap(async ({ body }) => mp.businessSites.scaffold({
    templateId: require_(body.templateId, 'templateId'),
    businessName: require_(body.businessName, 'businessName'),
    tagline: body.tagline, description: body.description, contact: body.contact || {},
    suburbId: body.suburbId || null, suburbName: body.suburb || null,
    themeId: body.themeId || null, planId: body.planId || 'essential',
    proId: body.proId || null, leadId: body.leadId || null,
    useSampleContent: body.useSampleContent !== false,
  })), { tags: ['sites'], summary: 'Scaffold a full business site from an industry template — R0 taken' });

  router.get('/api/sites/:siteId', ({ params, query }) => {
    const site = mp.businessSites.get(params.siteId);
    if (query.html === 'true') return { html: mp.businessSites.renderSiteHtml(site.siteId, { preview: site.status !== 'LIVE' }) };
    return { ...require('../../kernel/util').deepClone(site), assets: mp.businessSites.assets(site.siteId), permissionState: mp.businessSites.permissionState(site.siteId), updates: mp.businessSites.updateHistory(site.siteId), bookings: mp.businessSites.listBookings({ siteId: site.siteId, limit: 20 }) };
  }, { tags: ['sites'], summary: 'Full site record with assets, permission state, updates and bookings' });

  router.patch('/api/sites/:siteId/content', wrap(async ({ params, body, query }) => {
    // Control flags travel with the patch but are not content: separating them
    // here is what lets a client approve a billed extra update in one call.
    const { actorId, note, approveExtra, consumeCredit, ...patch } = body || {};
    return mp.businessSites.updateContent(params.siteId, patch, {
      actorId: actorId || 'studio',
      note: note || null,
      approveExtra: query.approveExtra === 'true' || approveExtra === true,
      consumeCredit: consumeCredit !== false,
    });
  }), { tags: ['sites'], summary: 'Edit site content — consumes an update credit on a live site (policy WEB-001). Send approveExtra:true to pay for one beyond the allowance.' });

  router.patch('/api/sites/:siteId/theme', wrap(async ({ params, body }) => mp.businessSites.updateTheme(params.siteId, body)), { tags: ['sites'], summary: 'Apply a theme preset or custom colours, with a WCAG contrast check' });

  router.get('/api/sites/:siteId/assets', ({ params }) => mp.businessSites.assets(params.siteId), { tags: ['sites'], summary: 'Asset library with auto-classification and permission state' });

  router.post('/api/sites/:siteId/assets', wrap(async ({ params, body }) => mp.businessSites.addAsset(params.siteId, {
    filename: require_(body.filename, 'filename'), caption: body.caption, source: body.source, contentType: body.contentType,
    bytes: body.bytes, aiGenerated: Boolean(body.aiGenerated), credit: body.credit, dataUrl: body.dataUrl,
  })), { tags: ['sites'], summary: 'Add an asset — it is classified against the industry vocabulary and flagged as needing permission' });

  router.post('/api/sites/:siteId/assets/:assetId/classify', wrap(async ({ params, body }) => mp.businessSites.classifyAsset(params.siteId, params.assetId, { caption: body.caption ?? null, override: body.override ?? null })), { tags: ['sites'], summary: 'Re-classify an asset, optionally with a manual override' });

  router.get('/api/sites/:siteId/permissions', ({ params }) => ({ state: mp.businessSites.permissionState(params.siteId), records: mp.store.find('sitePermissions', (r) => r.siteId === mp.businessSites.get(params.siteId).siteId).map((r) => require('../../kernel/util').deepClone(r)), checklist: mp.businessSites.playbook().permissions }), { tags: ['sites', 'compliance'], summary: 'Permission and POPIA consent state — the publish gate' });

  router.post('/api/sites/:siteId/permissions', wrap(async ({ params, body }) => mp.businessSites.recordPermission(params.siteId, {
    assetIds: body.assetIds || [], grantedBy: require_(body.grantedBy, 'grantedBy'), role: body.role, method: body.method,
    scope: body.scope, popiaConsent: Boolean(body.popiaConsent), identifiablePeople: Boolean(body.identifiablePeople),
    evidenceHash: body.evidenceHash, notes: body.notes, licence: body.licence, creditRequired: body.creditRequired,
  })), { tags: ['sites', 'compliance'], summary: 'Record copyright permission and POPIA consent — hash-chained, gates publishing (WEB-002)' });

  router.get('/api/sites/:siteId/ai-prompt', ({ params, query }) => mp.businessSites.aiImagePrompt(params.siteId, { itemId: query.itemId || null, itemText: query.itemText || null, style: query.style || null }), { tags: ['sites'], summary: 'AI image prompt for a catalogue item, with the mandatory labelling rule' });

  router.post('/api/sites/:siteId/preview', wrap(async ({ params }) => mp.businessSites.preview(params.siteId)), { tags: ['sites'], summary: 'Generate the unlisted preview URL — the pitch asset' });

  router.post('/api/sites/:siteId/publish', wrap(async ({ params, body }) => mp.businessSites.publish(params.siteId, { actorId: body?.actorId || 'studio', force: Boolean(body?.force) })), { tags: ['sites', 'compliance'], summary: 'Publish — refused while any asset lacks permission (policy WEB-002)' });

  router.post('/api/sites/:siteId/pause', wrap(async ({ params, body }) => mp.businessSites.pause(params.siteId, { reason: body?.reason, actorId: body?.actorId || 'studio' })), { tags: ['sites'], summary: 'Pause a published site' });

  router.post('/api/sites/:siteId/archive', wrap(async ({ params, body }) => mp.businessSites.archive(params.siteId, { reason: body?.reason })), { tags: ['sites'], summary: 'Archive a site' });

  router.get('/api/sites/:siteId/html', ({ params, query }) => ({ html: mp.businessSites.renderSiteHtml(params.siteId, { preview: query.preview === 'true', inlineAssets: query.inline === 'true' }), note: 'Also served as a real page at /s/<slug> (live) and /preview/<slug> (unlisted).' }), { tags: ['sites'], summary: 'Server-rendered site HTML — zero dependencies, works without JavaScript' });

  router.get('/api/sites/:siteId/export', ({ params, query }) => {
    const exported = mp.businessSites.exportSite(params.siteId, { inlineAssets: query.inline !== 'false' });
    return query.includeHtml === 'false' ? { ...exported, html: undefined } : exported;
  }, { tags: ['sites'], summary: 'Self-contained single-file export (CSS and assets inlined) — the client owns this file' });

  // The generated site posts its form fields flat; an API client may nest them
  // under `values`. Both are accepted, because the form must never 400.
  router.post('/api/sites/:siteId/bookings', wrap(async ({ params, body, req }) => mp.businessSites.submitBooking(params.siteId, body?.values || body || {}, {
    source: body?.source || 'website', ip: req.socket?.remoteAddress || null, userAgent: req.headers?.['user-agent'] || null,
  })), { tags: ['sites', 'public'], summary: 'Public booking intake from a generated site — creates a reservation, or a real escrow-ready job' });

  router.get('/api/sites/:siteId/bookings', ({ params, query }) => mp.businessSites.listBookings({ siteId: params.siteId, status: query.status || null }), { tags: ['sites'], summary: 'Bookings taken on this site' });

  router.post('/api/sites/:siteId/subscribe', wrap(async ({ params, body }) => mp.businessSites.subscribe(params.siteId, {
    planId: body?.planId || null, paymentProvider: body?.paymentProvider || 'paystack', reference: body?.reference || null,
    method: body?.method || 'card', customerId: body?.customerId || null,
  })), { tags: ['sites', 'money'], summary: 'Start the monthly subscription — first month held in escrow until the site is live' });

  router.post('/api/sites/:siteId/renew', wrap(async ({ params, body }) => mp.businessSites.renewSubscription(params.siteId, { reference: body?.reference || null, method: body?.method || 'card' })), { tags: ['sites', 'money'], summary: 'Bill the next month and reset the update allowance' });

  router.post('/api/sites/:siteId/cancel-subscription', wrap(async ({ params, body }) => mp.businessSites.cancelSubscription(params.siteId, { reason: body?.reason || null })), { tags: ['sites', 'money'], summary: 'Cancel — the site stays exportable, the content belongs to the client' });

  router.get('/api/sites/:siteId/updates', ({ params }) => mp.businessSites.updateHistory(params.siteId), { tags: ['sites'], summary: 'Update-credit history for this site' });

  router.post('/api/sites/:siteId/updates', wrap(async ({ params, body }) => mp.businessSites.logUpdate(params.siteId, { summary: require_(body.summary, 'summary'), actorId: body.actorId || 'studio', approveExtra: Boolean(body.approveExtra) })), { tags: ['sites', 'money'], summary: 'Log an update against the monthly allowance; extra updates are billed (policy WEB-001)' });

  router.get('/api/site-bookings/:bookingId', ({ params }) => mp.businessSites.getBooking(params.bookingId), { tags: ['sites'], summary: 'A single site booking by id or reference' });

  router.post('/api/site-bookings/:bookingId/decision', wrap(async ({ params, body }) => mp.businessSites.decideBooking(params.bookingId, { decision: require_(body.decision, 'decision'), actorId: body.actorId || 'owner', note: body.note || null })), { tags: ['sites'], summary: 'Confirm, decline, complete or cancel a booking' });

  /* ================= Sales desk (Web Studio CRM) ================= */

  router.get('/api/leads/stages', () => ({ stages: mp.salesDesk.stages(), websiteStatuses: mp.salesDesk.websiteStatuses(), priorityGuide: mp.businessSites.playbook().priorityGuide }), { tags: ['sales'], summary: 'Pipeline stages, the website-status vocabulary and the priority guide' });

  router.get('/api/leads/stats', () => mp.salesDesk.stats(), { tags: ['sales'], summary: 'Pipeline telemetry: conversion, weighted value, MRR, cycle time' });

  router.get('/api/leads/actions', ({ query }) => mp.salesDesk.nextBestActions({ limit: query.limit ? Number(query.limit) : 10 }), { tags: ['sales'], summary: 'What the sales desk should do next, in order' });

  router.get('/api/leads', ({ query }) => mp.salesDesk.list({
    stage: query.stage || null, priority: query.priority ? Number(query.priority) : null,
    source: query.source || null, templateId: query.templateId || null,
    dueOnly: query.dueOnly === 'true', limit: query.limit ? Number(query.limit) : 100,
  }), { tags: ['sales'], summary: 'List leads' });

  router.post('/api/leads', wrap(async ({ body }) => mp.salesDesk.capture({
    businessName: require_(body.businessName, 'businessName'), industry: body.industry, templateId: body.templateId,
    url: body.url, contactName: body.contactName, phone: body.phone, email: body.email, suburb: body.suburb, metro: body.metro,
    source: body.source, websiteStatus: body.websiteStatus, priority: body.priority, notes: body.notes, owner: body.owner, consent: body.consent || {},
  })), { tags: ['sales'], summary: 'Capture a lead — status, priority and next action are computed' });

  router.get('/api/leads/:leadId', ({ params }) => require('../../kernel/util').deepClone(mp.salesDesk.get(params.leadId)), { tags: ['sales'], summary: 'Full lead record with outreach history and diagnostic' });

  router.patch('/api/leads/:leadId', wrap(async ({ params, body }) => mp.salesDesk.update(params.leadId, body, { actorId: body.actorId || 'sales-desk' })), { tags: ['sales'], summary: 'Move a lead through the pipeline' });

  router.post('/api/leads/:leadId/diagnose', wrap(async ({ params, body }) => mp.salesDesk.diagnose(params.leadId, { url: body?.url || null })), { tags: ['sales', 'webstudio'], summary: 'Run the free diagnostic and let it pick the status, priority and plan to pitch' });

  router.post('/api/leads/:leadId/demo', wrap(async ({ params, body }) => mp.salesDesk.buildDemo(params.leadId, body || {})), { tags: ['sales', 'sites'], summary: 'Build the unlisted preview site before the meeting — the "show, don’t tell" beat' });

  router.get('/api/leads/:leadId/pitch-kit', ({ params, query }) => mp.salesDesk.pitchKit(params.leadId, { agentName: query.agentName || null }), { tags: ['sales'], summary: '60-second script, timing window, objections, recommended plan and preview link' });

  router.post('/api/leads/:leadId/outreach', wrap(async ({ params, body }) => mp.salesDesk.logOutreach(params.leadId, {
    channel: body?.channel || 'WHATSAPP', template: body?.template || null, note: body?.note || null,
    scheduledFor: body?.scheduledFor || null, actorId: body?.actorId || 'sales-desk',
  })), { tags: ['sales', 'compliance'], summary: 'Log an outreach touch — blocked after a POPIA opt-out (LEAD-001)' });

  router.post('/api/leads/:leadId/opt-out', wrap(async ({ params, body }) => mp.salesDesk.optOut(params.leadId, { reason: body?.reason || null, requestedVia: body?.requestedVia || 'phone' })), { tags: ['sales', 'compliance'], summary: 'Record a POPIA objection — every channel is then blocked for this lead' });

  router.post('/api/leads/:leadId/convert', wrap(async ({ params, body }) => mp.salesDesk.convert(params.leadId, body || {})), { tags: ['sales', 'money', 'sites'], summary: 'Win the lead: build the site and start the subscription with month one in escrow' });

  router.post('/api/leads/:leadId/lose', wrap(async ({ params, body }) => mp.salesDesk.lose(params.leadId, { reason: body?.reason || 'not interested' })), { tags: ['sales'], summary: 'Mark a lead lost with a reason' });

  /* ================= public data & integrations ================= */

  router.get('/api/integrations', () => ({
    mode: integrations.MODE,
    configured: integrations.configuredPartners(),
    catalogue: integrations.CATALOGUE,
    freeTier: integrations.FREE_TIER_IDS,
    http: integrations.httpClient.getStats(),
    payments: integrations.PAYMENTS.providers,
  }), { tags: ['integrations'], summary: 'Every external dependency: endpoint, cost, licence, auth and live/offline posture' });

  router.post('/api/integrations/probe', wrap(async () => integrations.probeLive()), { tags: ['integrations'], summary: 'Probe the free public sources and report what actually answered' });

  router.get('/api/public/weather', wrap(async ({ query }) => {
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw badRequest('lat and lon are required');
    return integrations.WEATHER.forecast({ lat, lon, days: Number(query.days || 7) });
  }), { tags: ['integrations', 'public-data'], summary: 'Open-Meteo forecast (free, no key)' });

  router.get('/api/public/holidays', wrap(async ({ query }) => integrations.HOLIDAYS.forYear(Number(query.year || new Date().getFullYear()))), { tags: ['integrations', 'public-data'], summary: 'South African public holidays (Nager.Date, free)' });

  router.get('/api/public/fx', wrap(async ({ query }) => integrations.FX.rates(query.base || 'ZAR')), { tags: ['integrations', 'public-data'], summary: 'ZAR exchange rates (ExchangeRate-API open tier)' });

  router.post('/api/public/fx/remit-quote', wrap(async ({ body }) => {
    require_(body.amountCentsZar, 'amountCentsZar');
    require_(body.fromCurrency, 'fromCurrency');
    const rates = await integrations.FX.rates('ZAR');
    return { rates: { source: rates.source, live: rates.live, asOf: rates.asOfUtc }, quote: integrations.FX.quoteRemittance(body, rates) };
  }), { tags: ['integrations', 'money'], summary: 'Remit-a-Job quote: family abroad funds a job for a relative in South Africa' });

  router.get('/api/public/loadshedding', wrap(async ({ query }) => ({
    status: await integrations.LOAD_SHEDDING.nationalStatus({ token: integrations.credentials().espToken }),
    schedule: query.suburb || query.metro
      ? await integrations.LOAD_SHEDDING.areaSchedule({ suburb: query.suburb, metro: query.metro, token: integrations.credentials().espToken })
      : null,
  })), { tags: ['integrations', 'public-data'], summary: 'Load-shedding status and area schedule' });

  router.post('/api/public/loadshedding/slots', wrap(async ({ body }) => {
    require_(body.categoryId, 'categoryId');
    const category = mp.catalog.get(body.categoryId);
    const status = await integrations.LOAD_SHEDDING.nationalStatus({ token: integrations.credentials().espToken });
    const schedule = await integrations.LOAD_SHEDDING.areaSchedule({ suburb: body.suburb, metro: body.metro, token: integrations.credentials().espToken });
    return integrations.LOAD_SHEDDING.recommendSlots({
      schedule,
      status,
      category,
      durationHours: Number(body.durationHours || category.typicalDurationHours || 2),
      fromIso: body.fromIso,
      toIso: body.toIso,
    });
  }), { tags: ['integrations', 'public-data'], summary: 'Load-shedding-clear job slots for power-dependent work' });

  router.post('/api/public/weather/job-advice', wrap(async ({ body }) => {
    require_(body.categoryId, 'categoryId');
    require_(body.lat, 'lat');
    require_(body.lon, 'lon');
    const category = mp.catalog.get(body.categoryId);
    const forecast = await integrations.WEATHER.forecast({ lat: Number(body.lat), lon: Number(body.lon), days: 7 });
    return { forecast, advice: integrations.WEATHER.jobDayAdvice(forecast, category, body.blockers ? { blockers: body.blockers } : undefined) };
  }), { tags: ['integrations', 'public-data'], summary: 'Weather-aware job-day advice for exterior trades' });

  router.get('/api/public/postal-code/:code', wrap(async ({ params }) => integrations.GEOCODING.lookupPostalCode(params.code)), { tags: ['integrations', 'public-data'], summary: 'SA postal code lookup (Zippopotam.us, free)' });

  router.get('/api/public/market-context', wrap(async () => ({
    labourMarket: integrations.MARKET.LABOUR_MARKET,
    cpi: integrations.MARKET.CPI_SERIES,
    cpiRelease: await integrations.MARKET.fetchCpiRelease(),
  })), { tags: ['integrations', 'public-data'], summary: 'Stats SA labour market and CPI context' });

  /* ================= trust, ledger & transparency ================= */

  router.get('/api/trust/ledger', ({ query }) => ({
    chain: mp.kernel.ledger.verifyChain(),
    receipt: mp.kernel.ledger.integrityReceipt(),
    entries: mp.kernel.ledger.query({
      subject: query.subject,
      action: query.action,
      level: query.level,
      limit: query.limit ? Number(query.limit) : 50,
    }).reverse(),
  }), { tags: ['trust'], summary: 'Hash-chained audit ledger and integrity receipt' });

  router.get('/api/trust/proof/:subjectId', ({ params }) => ({
    proof: mp.kernel.ledger.exportProof(params.subjectId),
    timeline: mp.kernel.ledger.publicTimeline(params.subjectId),
  }), { tags: ['trust'], summary: 'Verifiable proof for one subject — the receipt a customer or insurer can check' });

  router.get('/api/trust/transparency', ({ query }) => mp.kernel.transparencyReport({ since: query.since }), { tags: ['trust'], summary: 'Public transparency report: what the platform did, provably' });

  router.get('/api/trust/policies', () => ({
    policies: mp.kernel.policy.ruleBook(),
    stats: mp.kernel.policy.stats(),
    signals: require('../../kernel/risk').SIGNAL_CATALOGUE,
  }), { tags: ['trust'], summary: 'The published rule book: what each policy protects, when it fires, what it does' });

  router.get('/api/trust/risk/:subjectId', ({ params }) => {
    const assessment = mp.kernel.risk.assess(params.subjectId);
    return {
      ...assessment,
      // Safety signals are internal by design — never exposed to the other party.
      openSignals: assessment.openSignals.filter((s) => s.kind !== 'SAFETY'),
    };
  }, { tags: ['trust'], summary: 'Risk position for one subject (safety signals withheld)' });

  router.get('/api/admin/console', () => mp.adminConsole(), { tags: ['admin'], summary: 'Trust-desk console: queues, ledger integrity, high-risk subjects, escrow position' });

  router.post('/api/admin/risks', wrap(async ({ body }) => {
    require_(body.subjectId, 'subjectId');
    require_(body.type, 'type');
    return mp.kernel.risk.record(body.subjectId, body);
  }), { tags: ['admin', 'trust'], summary: 'Record a risk signal' });

  router.post('/api/admin/risks/:subjectId/:signalId/resolve', wrap(async ({ params, body }) => mp.kernel.risk.resolve(params.subjectId, params.signalId, body)), { tags: ['admin', 'trust'], summary: 'Resolve a risk signal' });

  router.post('/api/admin/pros/:proId/suspend', wrap(async ({ params, body }) => mp.people.suspend(params.proId, { reason: require_(body.reason, 'reason'), actorId: body.actorId })), { tags: ['admin'], summary: 'Suspend a pro' });

  router.post('/api/admin/pros/:proId/refresh-standing', wrap(async ({ params }) => mp.people.refreshStanding(params.proId)), { tags: ['admin', 'trust'], summary: 'Recompute a pro’s badge and bidding clearance' });

  /* ================= support ================= */

  router.post('/api/tickets', wrap(async ({ body }) => mp.openTicket(body)), { tags: ['support'], summary: 'Open a help ticket with photo evidence' });

  router.get('/api/tickets', ({ query }) => mp.listTickets(query), { tags: ['support'], summary: 'List help tickets' });

  router.post('/api/tickets/:ticketId/reply', wrap(async ({ params, body }) => mp.replyToTicket({ ticketId: params.ticketId, ...body })), { tags: ['support'], summary: 'Reply to or resolve a ticket' });

  router.get('/api/notifications/:userId', ({ params, query }) => mp.jobs.notificationsFor(params.userId, { unreadOnly: query.unreadOnly === 'true', limit: query.limit ? Number(query.limit) : 50 }), { tags: ['support'], summary: 'Notification inbox' });

  router.post('/api/notifications/:notificationId/read', wrap(async ({ params }) => mp.jobs.markNotificationRead(params.notificationId)), { tags: ['support'], summary: 'Mark a notification read' });

  /* ================= demo helpers ================= */

  router.get('/api/demo/roster', () => ({
    customers: mp.store.all('customers').map((c) => ({ customerId: c.customerId, name: c.fullName, suburb: c.suburb, metro: c.metro, status: c.status })),
    pros: mp.store.all('pros').map((p) => ({ proId: p.proId, name: p.displayName, category: p.primaryCategoryLabel, suburb: p.location.suburb, metro: p.location.metro, badge: p.badge, trustScore: p.trustScore, canBid: p.canBid })),
    note: 'Synthetic demo identities. SA ID numbers are generated with the real Luhn algorithm so validation exercises the production code path.',
  }), { tags: ['demo'], summary: 'Demo roster of synthetic customers and pros' });

  router.get('/api/demo/synthesise-sa-id', ({ query }) => ({
    idNumber: synthesiseSaId({ seed: query.seed || 'demo', gender: query.gender === 'FEMALE' ? 'FEMALE' : 'MALE', age: Number(query.age || 34) }),
    note: 'Syntactically valid synthetic SA ID for demos and tests only — not a real person.',
  }), { tags: ['demo'], summary: 'Generate a syntactically valid synthetic SA ID' });

  router.get('/api/stats', () => ({
    jobs: mp.jobs.stats(),
    bookings: mp.bookings.stats(),
    vehicles: mp.vehicles.stats(),
    webStudio: mp.webStudio.stats(),
    businessSites: mp.businessSites.stats(),
    salesDesk: mp.salesDesk.stats(),
    escrow: mp.kernel.escrow.portfolioStats(),
    policy: mp.kernel.policy.stats(),
    risk: mp.kernel.risk.stats(),
    store: mp.store.stats(),
  }), { tags: ['platform'], summary: 'Platform telemetry' });

  return router;
}

module.exports = { buildApiRoutes };
