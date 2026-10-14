'use strict';

/**
 * Cloud-backed identity: Firebase email + Google sign-in, Supabase mirrors.
 *
 * The suite runs with PROVERI_INTEGRATION_MODE=offline, which is exactly the
 * honest-degradation path CI and air-gapped dev boxes take: registration and
 * sign-in fall back to a labelled local password hash, mirrors are skipped
 * with a ledger note (never silently dropped), and the seeded marketplace
 * posts stay on the feeds either way.
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
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  marketplace.stopScheduler();
  server.close();
});

const call = async (method, path, payload) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
};
const get = (path) => call('GET', path);
const post = (path, payload) => call('POST', path, payload || {});

const uniqueEmail = () => `cloud-auth+${Date.now()}${Math.floor(Math.random() * 999)}@proveri.test`;

const register = async (overrides = {}) => {
  const email = uniqueEmail();
  const { status, body } = await post('/api/auth/register', {
    email,
    password: 'geyser-leak-2026',
    fullName: 'Cloud Tester',
    ...(overrides || {}),
  });
  return { email, status, body };
};

test('GET /api/cloud-config serves the real Firebase + Supabase client config', async () => {
  const { status, body } = await get('/api/cloud-config');
  assert.equal(status, 200);
  assert.match(body.firebase.apiKey, /^AIzaSy/, 'the Firebase web key is served to the PWA');
  assert.equal(body.firebase.projectId, 'lulafinds-app');
  assert.match(body.supabase.url, /^https:\/\/.+\.supabase\.co$/);
  assert.ok(body.supabase.anonKey, 'the publishable Supabase key is served');
  assert.equal(body.supabase.bucket, 'photos');
  assert.equal(body.online, false, 'offline mode says so honestly — no fake cloud');
});

test('the demo-account OTP routes no longer exist', async () => {
  const start = await post('/api/auth/start', { identifier: '0831234567' });
  assert.equal(start.status, 404, 'no OTP challenge route');
  const verify = await post('/api/auth/verify', { challengeId: 'x', code: '123456' });
  assert.equal(verify.status, 404, 'no OTP verify route');
});

test('register with email + password creates a real, signed-in account', async () => {
  const { email, status, body } = await register();
  assert.ok(status === 200 || status === 201, `registration succeeds (got ${status})`);
  assert.equal(body.created, true);
  assert.equal(body.session.provider, 'local', 'offline fallback is labelled local, never disguised');
  assert.equal(body.session.email, email);
  assert.ok(body.session.sessionId, 'a session comes back with the registration');

  const customer = marketplace.store.get('customers', body.session.userId);
  assert.ok(customer, 'the customer exists in the store');
  assert.ok(customer.passwordHash, 'the password is stored as a hash, not in the clear');
  assert.ok(!customer.passwordHash.includes('geyser'), 'and the hash does not leak the password');
  assert.equal(customer.firebaseUid, undefined, 'no cloud uid while Firebase is unreachable');

  const dup = await post('/api/auth/register', { email, password: 'geyser-leak-2026', fullName: 'Copy Cat' });
  assert.equal(dup.status, 400, 'a second account on the same email is refused');
  assert.match(dup.body.message, /already exists/i);

  const short = await post('/api/auth/register', { email: uniqueEmail(), password: 'abc', fullName: 'Short Pass' });
  assert.equal(short.status, 400, 'weak passwords are refused');
});

test('sign-in checks the password against the stored hash', async () => {
  const { email } = await register();

  const good = await post('/api/auth/login', { email, password: 'geyser-leak-2026' });
  assert.equal(good.status, 200);
  assert.equal(good.body.session.email, email);

  const bad = await post('/api/auth/login', { email, password: 'wrong-password' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /invalid/i);

  const stranger = await post('/api/auth/login', { email: uniqueEmail(), password: 'whatever-123' });
  assert.equal(stranger.status, 400, 'an unknown email offline is an honest refusal, not a fake account');
});

test('Google token exchange needs Firebase, and says so when it is unreachable', async () => {
  const { status, body } = await post('/api/auth/session', { idToken: 'not-a-real-token' });
  assert.equal(status, 400);
  assert.match(body.message, /Firebase cannot be reached/i);
});

test('mirrorPost degrades honestly offline: skipped, ledgered, never thrown', async () => {
  const notes = [];
  const result = await marketplace.cloud.mirrorPost(
    { id: 'job_unit_test', kind: 'job', title: 'Mirror probe' },
    { ledger: { append: (entry) => notes.push(entry) }, subject: 'job_unit_test' },
  );
  assert.equal(result.mirrored, false);
  assert.ok(result.reason, 'the skip carries a reason');
  assert.equal(notes.length, 1, 'the skip lands in the audit ledger');
  assert.equal(notes[0].action, 'CLOUD_MIRROR_SKIPPED');
});

test('a newly registered customer can post a real job, and the feed keeps the seed', async () => {
  const { body } = await register();
  const customerId = body.session.userId;

  const metros = await get('/api/metros');
  const metroId = (metros.body.metros || metros.body)[0].id;
  const suburbs = await get(`/api/metros/${metroId}/suburbs`);
  const suburb = (suburbs.body.suburbs || suburbs.body)[0];
  const photo = (label) => ({
    dataUrl: `data:image/jpeg;base64,/9j/${label}${Math.random().toString(36).slice(2)}`,
    url: null,
    caption: label,
  });

  const job = await post('/api/jobs', {
    customerId,
    description: 'Our geyser is leaking through the kitchen ceiling again',
    suburbId: suburb.id,
    budgetCents: 350000,
    photos: [photo('a'), photo('b'), photo('c')],
  });
  assert.ok(job.status === 200 || job.status === 201, JSON.stringify(job.body && job.body.message));
  assert.ok(job.body.jobId, 'the post is real and has an id');

  const mine = await get(`/api/jobs?customerId=${customerId}`);
  assert.equal(mine.status, 200);
  const mineJobs = Array.isArray(mine.body) ? mine.body : mine.body.jobs;
  assert.ok(mineJobs.some((j) => j.jobId === job.body.jobId), 'the new post shows up on the feed');

  const all = await get('/api/jobs');
  const allJobs = Array.isArray(all.body) ? all.body : all.body.jobs;
  assert.ok(allJobs.length > 1, 'the seeded marketplace posts are still there beside it');

  const work = await get('/api/portfolio');
  assert.equal(work.status, 200);
  const items = Array.isArray(work.body) ? work.body : work.body.items;
  assert.ok(items.length > 0, 'seeded portfolio work still browses with the cloud reads skipped');
});
