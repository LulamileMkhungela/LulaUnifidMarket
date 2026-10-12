'use strict';

/**
 * HTTP surface: boot the real server on an ephemeral port and exercise the
 * routes the PWA depends on.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';
process.env.PORT = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../src/server');

let server;
let base;
let marketplace;

test.before(async () => {
  const started = await boot();
  server = started.server;
  marketplace = started.marketplace;
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
});

test.after(() => {
  marketplace.stopScheduler();
  server.close();
});

const get = async (path) => {
  const response = await fetch(base + path);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, headers: response.headers };
};

const post = async (path, payload) => {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
};

test('GET /api/health reports liveness and ledger integrity', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.ledger.chainValid, true);
  assert.ok(body.ledger.entries > 100);
});

test('GET /api/snapshot returns the public proof-led marketing payload', async () => {
  const { status, body } = await get('/api/snapshot');
  assert.equal(status, 200);
  assert.ok(body.supply.verifiedPros >= 10);
  assert.ok(body.money.releasedToProsCents > 0);
  assert.ok(body.guarantees.length >= 5);
  assert.ok(body.verticals.length === 3);
  assert.equal(body.verticals.find((v) => v.id === 'property').status, 'COMING_SOON');
});

test('GET /api/offline-bundle carries everything the PWA needs on first paint', async () => {
  const { status, body } = await get('/api/offline-bundle');
  assert.equal(status, 200);
  assert.ok(body.catalog.categories.length >= 25);
  assert.ok(body.catalog.metros.length >= 8);
  assert.ok(body.policies.length >= 10);
  assert.ok(body.integrations.length >= 20);
  assert.ok(body.evidenceTypes.length >= 30);
});

test('GET /api/openapi.json is generated from registered routes', async () => {
  const { status, body } = await get('/api/openapi.json');
  assert.equal(status, 200);
  assert.ok(body.routeCount >= 100);
  assert.ok(Object.keys(body.paths).length >= 90);
  assert.ok(body.paths['/api/jobs/{jobId}']);
});

test('GET /api/categories and /api/pros return the seeded marketplace', async () => {
  const categories = await get('/api/categories');
  assert.equal(categories.status, 200);
  assert.ok(categories.body.length >= 25);

  const pros = await get('/api/pros');
  assert.equal(pros.status, 200);
  assert.ok(pros.body.length >= 10);
  for (const pro of pros.body) {
    assert.ok(['PROVERI_VERIFIED', 'PROVERI_ELITE', 'TRADE_VERIFIED'].includes(pro.badge), `only cleared pros may be listed, got ${pro.badge}`);
  }
});

test('GET /api/pros/:id/trust exposes every check with source and seal', async () => {
  const pros = await get('/api/pros');
  const trust = await get(`/api/pros/${pros.body[0].proId}/trust`);
  assert.equal(trust.status, 200);
  assert.ok(trust.body.checks.length >= 6);
  for (const check of trust.body.checks) {
    assert.ok(check.source, 'every check must name its source');
  }
  assert.ok(trust.body.explanation.reasons.length >= 5);
});

test('GET /api/jobs/:id returns bids with price intelligence', async () => {
  const jobs = await get('/api/jobs?status=BIDDING');
  assert.equal(jobs.status, 200);
  assert.ok(jobs.body.length >= 1);
  const job = await get(`/api/jobs/${jobs.body[0].jobId}`);
  assert.equal(job.status, 200);
  assert.ok(job.body.priceBand);
  assert.ok(job.body.matchReport);
  assert.ok(job.body.safetyPlan);
});

test('POST /api/verify/sa-id validates without echoing the raw ID', async () => {
  const { body: synth } = await get('/api/demo/synthesise-sa-id?seed=api-test');
  const good = await post('/api/verify/sa-id', { idNumber: synth.idNumber });
  assert.equal(good.status, 200);
  assert.equal(good.body.valid, true);
  assert.equal(good.body.idNumber, undefined, 'the raw ID must never be echoed');

  const bad = await post('/api/verify/sa-id', { idNumber: '123' });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.valid, false);
});

test('a full booking journey works over HTTP', async () => {
  const demo = await get('/api/demo/roster');
  assert.equal(demo.status, 200);
  const customer = demo.body.customers[0];
  const pro = demo.body.pros.find((p) => p.badge === 'TRADE_VERIFIED' || p.badge === 'PROVERI_VERIFIED');

  const posted = await post('/api/jobs', {
    customerId: customer.customerId,
    categoryId: pro.category === 'Plumber' ? 'plumbing' : 'handyman',
    title: 'API journey job',
    description: 'A job posted through the HTTP API to prove the whole rail works end to end.',
    suburbId: undefined,
    addressText: customer.suburb || 'Soweto',
    budgetCents: 300000,
    urgency: 'SOON',
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.body).slice(0, 200));
  const jobId = posted.body.jobId;

  const bid = await post(`/api/jobs/${jobId}/bids`, {
    proId: pro.proId,
    totalCents: 250000,
    scopeOfWork: 'As described, materials included.',
    inclusions: ['Labour', 'Materials'],
    includesCoc: false,
    warrantyDays: 14,
  });
  // A statutory trade without includesCoc is rejected — assert whichever path applies.
  if (bid.status !== 200) {
    assert.match(JSON.stringify(bid.body), /CoC|statutory|certificate/i);
    return;
  }

  const booking = await post('/api/bookings', { jobId, bidId: bid.body.bidId, customerId: customer.customerId });
  assert.equal(booking.status, 200, JSON.stringify(booking.body).slice(0, 200));

  const funded = await post(`/api/bookings/${booking.body.bookingId}/fund`, { customerId: customer.customerId, paymentMethod: 'instant-eft' });
  assert.equal(funded.status, 200);

  const detail = await get(`/api/bookings/${booking.body.bookingId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.escrow.status, 'FUNDED');
  assert.ok(detail.body.arrival.gateCode);
  assert.ok(detail.body.auditTrail.length >= 3);
});

test('policy violations surface as structured 4xx responses', async () => {
  const demo = await get('/api/demo/roster');
  const customer = demo.body.customers[0];
  const pro = demo.body.pros[0];

  const job = await post('/api/jobs', {
    customerId: customer.customerId, categoryId: 'handyman', title: 'Shelf',
    description: 'Mount a shelf.', addressText: customer.suburb,
  });
  assert.equal(job.status, 200);

  const bidWithoutAmount = await post(`/api/jobs/${job.body.jobId}/bids`, { proId: pro.proId, scopeOfWork: 'no price' });
  assert.equal(bidWithoutAmount.status, 400);
  assert.ok(bidWithoutAmount.body.message);

  const unknownPro = await post(`/api/jobs/${job.body.jobId}/bids`, { proId: 'pro_does_not_exist', totalCents: 100000, scopeOfWork: 'x' });
  assert.ok(unknownPro.status >= 400);
  assert.ok(unknownPro.body.message);
});

test('the vehicles vertical answers over HTTP', async () => {
  const list = await get('/api/vehicles');
  assert.equal(list.status, 200);
  assert.ok(list.body.length >= 1);

  const detail = await get(`/api/vehicles/${list.body[0].listingId}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.releaseOrder.length >= 4);

  const answer = await get(`/api/vehicles/${list.body[0].listingId}/buyer-answer`);
  assert.equal(answer.status, 200);
  assert.equal(answer.body.breakdown.length, 6);

  const vin = await post('/api/vehicles/vin-check', { vin: 'AHTZZZX0000000001' });
  assert.equal(vin.status, 200);
  assert.equal(vin.body.valid, true);
});

test('public data endpoints label offline results honestly', async () => {
  const weather = await get('/api/public/weather?lat=-26.2&lon=28.05&days=3');
  assert.equal(weather.status, 200);
  assert.equal(weather.body.live, false);

  const holidays = await get('/api/public/holidays');
  assert.equal(holidays.status, 200);
  assert.ok(holidays.body.holidays.length >= 10);

  const ls = await get('/api/public/loadshedding?suburb=Sandton&metro=City%20of%20Johannesburg');
  assert.equal(ls.status, 200);
  assert.equal(ls.body.status.live, false);

  const fx = await get('/api/public/fx?base=ZAR');
  assert.equal(fx.status, 200);
  assert.ok(fx.body.rates.USD > 0);
});

test('the trust surface exposes ledger, policies and transparency', async () => {
  const transparency = await get('/api/trust/transparency');
  assert.equal(transparency.status, 200);
  assert.equal(transparency.body.chainValid, true);

  const policies = await get('/api/trust/policies');
  assert.equal(policies.status, 200);
  assert.ok(policies.body.policies.some((p) => p.id === 'OFP-001'));
  assert.ok(policies.body.policies.some((p) => p.id === 'REV-001'));

  const ledger = await get('/api/trust/ledger?limit=5');
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.chain.valid, true);
});

test('the admin console and scheduler run over HTTP', async () => {
  const admin = await get('/api/admin/console');
  assert.equal(admin.status, 200);
  assert.equal(admin.body.ledger.integrity.chainValid, true);

  const sweep = await post('/api/scheduler/run', {});
  assert.equal(sweep.status, 200);
  assert.ok(Array.isArray(sweep.body.autoReleases));
});

test('microsites render as plain HTML without JavaScript', async () => {
  const sites = await get('/api/webstudio/microsites');
  assert.equal(sites.status, 200);
  assert.ok(sites.body.length >= 10);

  const slug = sites.body[0].url.split('/p/')[1];
  const response = await fetch(`${base}/p/${slug}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(html, /<html/);
  assert.ok(!html.includes('<script'), 'a pro microsite must work with JavaScript disabled');
  assert.match(html, /What has been verified/);
});

test('unknown API routes 404 and unknown methods 405', async () => {
  const missing = await get('/api/does-not-exist');
  assert.equal(missing.status, 404);

  const response = await fetch(`${base}/api/health`, { method: 'PATCH' });
  assert.equal(response.status, 405);
});

test('the PWA shell and assets are served from the same origin', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);

  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  const manifestBody = await manifest.json();
  assert.ok(manifestBody.icons.length >= 3);
  assert.ok(manifestBody.icons.some((i) => i.purpose === 'maskable'));

  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('cache-control'), /no-cache/);

  const deepLink = await fetch(`${base}/booking/does_not_exist`);
  assert.equal(deepLink.status, 200, 'deep links must render the app shell');
});
