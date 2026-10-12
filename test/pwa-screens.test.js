'use strict';

/**
 * PWA + HTTP integration.
 *
 * The unit tests exercise the services. This file exercises the two things they
 * cannot: the 47 studio/sales routes as an actual HTTP API, and the progressive
 * web app screens rendered against that API through a minimal DOM shim. It is
 * the test that catches a screen reading `site.plan.updateCreditsTotal` when the
 * route returns `updateCredits` — the class of bug that otherwise only shows up
 * as a blank panel on someone's phone.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';
process.env.PORT = '0';                       // ephemeral: never fight a dev server
process.env.PROVERI_SCHEDULER_MS = '3600000'; // the scheduler must not fire mid-test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { boot } = require('../src/server');

const PWA_ROOT = path.join(__dirname, '..', 'pwa');

/* ==================================================================== *
 * Minimal DOM — enough for pwa/js/ui.js and the screen modules
 * ==================================================================== */

class Node {}

class TextNode extends Node {
  constructor(text) { super(); this.nodeType = 3; this.textContent = String(text); }
}

class Element extends Node {
  constructor(tagName) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.localName = String(tagName).toLowerCase();
    this.className = '';
    this.id = '';
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.parentNode = null;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.name = '';
    this.type = '';
    this.href = '';
    this._innerHTML = '';
  }

  get classList() {
    const self = this;
    const list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add: (...names) => { self.className = [...new Set([...list(), ...names])].join(' '); },
      remove: (...names) => { self.className = list().filter((n) => !names.includes(n)).join(' '); },
      contains: (name) => list().includes(name),
      toggle: (name) => (list().includes(name) ? this.remove(name) : this.add(name)),
    };
  }

  append(...nodes) {
    for (const node of nodes.flat(6)) {
      if (node === null || node === undefined || node === false) continue;
      const child = node instanceof Node ? node : new TextNode(node);
      child.parentNode = this;
      this.children.push(child);
    }
  }

  appendChild(node) { this.append(node); return node; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'id') this.id = String(value); if (key === 'name') this.name = String(value); if (key === 'type') this.type = String(value); if (key === 'href') this.href = String(value); }
  getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; }
  hasAttribute(key) { return key in this.attributes; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  focus() {}
  blur() {}
  scrollIntoView() {}
  select() {}
  click() { this.dispatch('click', { target: this }); }

  dispatch(type, event = {}) {
    const payload = { type, target: event.target || this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of this.listeners[type] || []) fn(payload);
    return payload;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child instanceof Element) {
          if (matchesSelector(child, selector)) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  closest(selector) {
    let node = this;
    while (node) {
      if (node instanceof Element && matchesSelector(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  set innerHTML(value) { this._innerHTML = String(value); this.children = []; }
  get innerHTML() { return this._innerHTML; }

  set textContent(value) { this.children = [new TextNode(value)]; }
  get textContent() { return this.children.map((c) => (c instanceof Element ? c.textContent : c.textContent)).join(''); }
}

/**
 * Enough CSS for the screens: `tag`, `#id`, `.class`, `[attr]`, `[attr=value]`,
 * `tag[attr=value]` and comma lists. Descendant combinators are not needed by
 * anything the PWA queries.
 */
function matchesSelector(element, selector) {
  return String(selector).split(',').map((s) => s.trim()).filter(Boolean).some((simple) => {
    const tagMatch = simple.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagMatch && element.localName !== tagMatch[1].toLowerCase()) return false;
    const idMatch = simple.match(/#([\w-]+)/);
    if (idMatch && element.id !== idMatch[1] && element.getAttribute('id') !== idMatch[1]) return false;
    for (const className of simple.matchAll(/\.([\w-]+)/g)) {
      if (!element.classList.contains(className[1])) return false;
    }
    for (const attr of simple.matchAll(/\[([\w-]+)(?:=[\"']?([^\]"']*)[\"']?)?\]/g)) {
      const [, name, value] = attr;
      if (!element.hasAttribute(name) && !(name in element)) return false;
      if (value !== undefined) {
        const actual = element.hasAttribute(name) ? element.getAttribute(name) : element[name];
        if (String(actual) !== value) return false;
      }
    }
    return true;
  });
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (node instanceof TextNode) return node.textContent;
  if (node instanceof Element) return node.children.map(textOf).join('');
  return String(node);
}

function installDom(origin) {
  const byId = new Map();
  const body = new Element('body');
  const documentListeners = {};

  const document = {
    body,
    documentElement: new Element('html'),
    head: new Element('head'),
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new TextNode(text),
    getElementById: (id) => {
      if (!byId.has(id)) { const el = new Element('div'); el.id = id; byId.set(id, el); }
      return byId.get(id);
    },
    querySelector: (sel) => (String(sel).startsWith('#') ? document.getElementById(sel.slice(1)) : body.querySelector(sel)),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener: (type, fn) => { (documentListeners[type] = documentListeners[type] || []).push(fn); },
    title: '',
  };

  const store = new Map();
  const makeStorage = () => {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear(),
    };
  };
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();

  const url = new URL(origin);
  const location = { origin, href: url.href, pathname: '/', search: '', hash: '', host: url.host, protocol: url.protocol, assign() {}, reload() {} };

  class SimpleEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  }

  const windowListeners = {};
  const window = {
    ProVeri: undefined,
    location,
    localStorage,
    sessionStorage,
    document,
    navigator: { onLine: true, userAgent: 'node-pwa-test', clipboard: { writeText: async () => {} }, share: null },
    history: {
      pushState: (_s, _t, p) => { const next = new URL(p, origin); location.pathname = next.pathname; location.search = next.search; location.hash = next.hash; location.href = next.href; },
      replaceState: (_s, _t, p) => window.history.pushState(_s, _t, p),
      back: () => {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (event) => { for (const fn of windowListeners[event.type] || []) fn(event); return true; },
    CustomEvent: SimpleEvent,
    PopStateEvent: SimpleEvent,
    Event: SimpleEvent,
    Node,
    setTimeout,
    clearTimeout,
    alert: () => {},
    confirm: () => true,
    scrollTo: () => {},
    innerWidth: 420,
    innerHeight: 900,
  };
  window.window = window;
  window.self = window;
  window.top = window;

  const realFetch = global.fetch;
  const shimFetch = (input, init) => realFetch(String(input).startsWith('http') ? input : origin + String(input), init);

  // Some of these (navigator, fetch) are accessor-only on the Node global, so
  // they have to be defined rather than assigned.
  const globals = {
    window, document, Node, Element, TextNode, localStorage, sessionStorage, location, history: window.history,
    navigator: window.navigator, CustomEvent: SimpleEvent, PopStateEvent: SimpleEvent,
    requestAnimationFrame: window.requestAnimationFrame, matchMedia: window.matchMedia,
    fetch: shimFetch,
    FileReader: class { readAsDataURL() { this.onerror && this.onerror(new Error('no files in the shim')); } },
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { value, writable: true, configurable: true });
  }

  return { window, document, byId, textOf };
}

function loadPwaScripts() {
  for (const file of ['js/api.js', 'js/ui.js', 'js/screens-market.js', 'js/screens-shop.js', 'js/screens-work.js', 'js/screens-verticals.js', 'js/screens-trust.js', 'js/screens-studio.js']) {
    const code = fs.readFileSync(path.join(PWA_ROOT, file), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function(code)();
  }
}

/* ==================================================================== *
 * Boot the real server once for the whole file
 * ==================================================================== */

let server;
let marketplace;
let origin;
let dom;

test('boot', async () => {
  const started = await boot();
  server = started.server;
  marketplace = started.marketplace;
  origin = `http://127.0.0.1:${server.address().port}`;
  dom = installDom(origin);
  loadPwaScripts();
  assert.ok(global.window.ProVeri.screens, 'the PWA screens registered themselves');
  assert.ok(global.window.ProVeri.api.get, 'the PWA api client loaded');
});

async function get(pathname) {
  const response = await fetch(origin + pathname);
  const type = response.headers.get('content-type') || '';
  return { status: response.status, type, body: type.includes('json') ? response.json() : response.text() };
}

/** Fill a booking form from the site's own schema — the way the public form does. */
function sampleBookingValues(fields) {
  const option = (field) => {
    const first = (field.options || [])[0];
    if (first === undefined) return 'Yes';
    return typeof first === 'string' ? first : (first.value ?? first.label);
  };
  const values = {};
  for (const field of fields) {
    if (!field.required && !['email', 'budget', 'notes'].includes(field.name)) continue;
    switch (field.type) {
      case 'tel': values[field.name] = '0830002222'; break;
      case 'email': values[field.name] = 'http.customer@example.co.za'; break;
      case 'date': values[field.name] = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10); break;
      case 'time': values[field.name] = '19:00'; break;
      case 'number': values[field.name] = 8500; break;
      case 'select': values[field.name] = option(field); break;
      case 'textarea': values[field.name] = 'Geyser is leaking through the ceiling — needs replacement today.'; break;
      default: values[field.name] = field.name === 'suburb' ? 'Midrand' : 'HTTP Test Customer';
    }
  }
  return values;
}

async function post(pathname, body) {
  const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

/* ==================================================================== *
 * 1. The screens render against the live API
 * ==================================================================== */

const RENDER_CANARIES = ['undefined', 'NaN', '[object Object]', 'null'];

function assertCleanRender(node, label) {
  const text = textOf(node);
  assert.ok(text.length > 200, `${label} rendered almost nothing (${text.length} chars)`);
  for (const canary of RENDER_CANARIES) {
    assert.ok(!text.includes(canary), `${label} rendered "${canary}" — a field the API does not return`);
  }
  return text;
}

test('the business studio screen renders the plans, templates and live sites', async () => {
  const node = await global.window.ProVeri.screens['/business-studio']({ params: {}, query: {} });
  const text = assertCleanRender(node, '/business-studio');
  assert.match(text, /R\s?999|R\s?1\s?799|R\s?2\s?999/, 'the plans are priced on screen');
  assert.match(text, /R0|zero upfront/i, 'the zero-build-cost promise is on screen');
  assert.match(text, /Dlamini Plumbing|Thando/, 'the seeded sites are listed');
  assert.match(text, /permission/i, 'the permission gate is surfaced');
});

test('the public sites gallery screen renders every published site', async () => {
  const node = await global.window.ProVeri.screens['/sites']({ params: {}, query: {} });
  const text = assertCleanRender(node, '/sites');
  assert.match(text, /Egoli Airport Shuttles/);
  assert.match(text, /Mzansi Threads/);
  assert.ok(node.querySelectorAll('a[href]').length >= 6, 'each site is a link a visitor can open');
});

test('the site editor screen renders content, assets, bookings and the permission gate', async () => {
  const sites = await marketplace.businessSites.list();
  const live = sites.find((s) => s.status === 'LIVE' && s.bookings > 0);
  const node = await global.window.ProVeri.screens['/site/:siteId']({ params: { siteId: live.siteId }, query: {} });
  const text = assertCleanRender(node, `/site/${live.siteId}`);
  assert.ok(text.includes(live.name), 'the site name is on screen');
  assert.match(text, /BKG-\d{6}/, 'the bookings taken through the site are listed with their references');
  assert.match(text, /permission|Permission/i);
  assert.match(text, /contrast \d+(\.\d+)?:1/, 'the theme panel reports a real contrast ratio');
  assert.match(text, new RegExp(live.slug), 'the public URL is on screen');

  const previewSite = sites.find((s) => s.status === 'PREVIEW');
  const previewNode = await global.window.ProVeri.screens['/site/:siteId']({ params: { siteId: previewSite.siteId }, query: {} });
  const previewText = assertCleanRender(previewNode, `/site/${previewSite.siteId}`);
  const hrefs = previewNode.querySelectorAll('a[href]').map((a) => a.getAttribute('href'));
  assert.ok(hrefs.some((href) => href.startsWith('/preview/')), `a preview site links its unlisted preview URL, got ${hrefs.join(' ')}`);
  assert.match(previewText, /Publish/i, 'and the button that would take it live');
  assert.match(previewText, /Treatments|Catalogue|Menu|Rooms/, 'the catalogue is headed in the industry\'s own words');
  assert.ok(!previewText.includes('Catalogue an appointment'), 'no mangled headings');
});

test('the site editor renders a blocked site honestly', async () => {
  const blocked = (await marketplace.businessSites.list()).find((s) => s.status === 'BLOCKED');
  assert.ok(blocked, 'the seed demonstrates a blocked publish');
  const node = await global.window.ProVeri.screens['/site/:siteId']({ params: { siteId: blocked.siteId }, query: {} });
  const text = assertCleanRender(node, `/site/${blocked.siteId}`);
  assert.match(text, /WEB-002|permission/i);
});

test('the sales desk screen renders the pipeline and the next best actions', async () => {
  const node = await global.window.ProVeri.screens['/sales-desk']({ params: {}, query: {} });
  const text = assertCleanRender(node, '/sales-desk');
  assert.match(text, /Nails on Main|Bergzicht/);
  assert.match(text, /priority/i);
  assert.match(text, /R\s?\d/, 'pipeline value is shown as money');
  assert.ok(node.querySelectorAll('button').length >= 5, 'the desk is actionable, not a report');
});

test('every registered studio screen has a title and a route', async () => {
  const routes = Object.keys(global.window.ProVeri.screens);
  for (const route of ['/business-studio', '/sites', '/site/:siteId', '/sales-desk']) {
    assert.ok(routes.includes(route), `${route} must be registered`);
    assert.equal(typeof global.window.ProVeri.screens[route], 'function');
  }
  const appSource = fs.readFileSync(path.join(PWA_ROOT, 'js/app.js'), 'utf8');
  for (const route of ['/business-studio', '/sites', '/sales-desk']) {
    assert.ok(appSource.includes(`'${route}'`), `${route} needs a document title in app.js`);
  }
  const indexHtml = fs.readFileSync(path.join(PWA_ROOT, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('/js/screens-studio.js'), 'the studio bundle is loaded by the shell');
  assert.ok(indexHtml.indexOf('<script src="/js/screens-studio.js"') < indexHtml.indexOf('<script src="/js/app.js"'), 'and loaded before app.js derives the routes');
  const sw = fs.readFileSync(path.join(PWA_ROOT, 'sw.js'), 'utf8');
  assert.ok(sw.includes('/js/screens-studio.js'), 'the service worker precaches the studio bundle for offline');
});

/* ==================================================================== *
 * 2. The studio HTTP API, end to end
 * ==================================================================== */

test('GET /api/sites/templates, /plans and /playbook serve the studio data', async () => {
  const templates = await get('/api/sites/templates');
  assert.equal(templates.status, 200);
  const body = await templates.body;
  assert.ok(body.templates.length >= 10);
  assert.ok(body.sectionKinds && body.bookingIntake);
  assert.ok(body.templates.every((t) => t.bookingFields.length >= 3));

  const plans = await get('/api/sites/plans');
  const planBody = await plans.body;
  assert.equal(planBody.plans.length, 3);
  assert.ok(planBody.positioning.oneLiner.length > 20);
  assert.ok(planBody.comparison.length >= 10);
  assert.ok(planBody.plans.some((p) => p.popular), 'one plan is marked as the recommendation');

  const playbook = await get('/api/sites/playbook');
  assert.equal(playbook.status, 200);
  const playbookBody = await playbook.body;
  assert.ok(playbookBody.pitch || playbookBody.priorityGuide, 'the playbook is served to the desk');
});

test('the whole build → permission → publish → booking → job loop works over HTTP', async () => {
  // 1. Scaffold from a template.
  const scaffolded = await post('/api/sites', {
    templateId: 'trade-services',
    businessName: 'API Integration Plumbing',
    suburbId: 'midrand',
    contact: { phone: '0820001111', email: 'book@apiplumbing.co.za' },
    planId: 'business-growth',
  });
  assert.equal(scaffolded.status, 200, JSON.stringify(scaffolded.payload));
  const siteId = scaffolded.payload.siteId || scaffolded.payload.site.siteId;
  assert.ok(siteId, 'the response names the new site');

  // 2. Edit content and theme.
  const content = await fetch(`${origin}/api/sites/${siteId}/content`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagline: 'Same-day geyser and leak repairs', hero: { headline: 'A burst pipe does not wait' } }),
  });
  assert.equal(content.status, 200);
  const templateBody = await (await get('/api/sites/templates')).body;
  const preset = templateBody.templates.find((t) => t.id === 'trade-services').themePresets[1];
  const theme = await fetch(`${origin}/api/sites/${siteId}/theme`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId: preset.id }),
  });
  const themeBody = await theme.json();
  assert.equal(theme.status, 200, JSON.stringify(themeBody));
  assert.equal(themeBody.theme.id, preset.id);
  assert.ok(themeBody.theme.contrastRatio > 0, 'the theme carries its contrast ratio');
  assert.equal(typeof themeBody.theme.contrastOk, 'boolean');

  const badTheme = await fetch(`${origin}/api/sites/${siteId}/theme`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primary: 'not-a-colour' }),
  });
  assert.equal(badTheme.status, 400, 'an invalid palette is a client error, and says why');
  assert.match(JSON.stringify(await badTheme.json()), /hex colour/);

  // 3. Add an asset and classify it.
  const assetResponse = await post(`/api/sites/${siteId}/assets`, {
    filename: 'geyser-install.jpg', caption: 'New geyser installation with a compliant overflow pipe', bytes: 640000,
  });
  assert.equal(assetResponse.status, 200, JSON.stringify(assetResponse.payload));
  const asset = assetResponse.payload.asset || assetResponse.payload;
  assert.ok(asset.assetId);
  assert.ok(asset.classification.category, 'the asset is classified on intake');

  const classified = await post(`/api/sites/${siteId}/assets/${asset.assetId}/classify`, { caption: 'Team photo of our plumbers at a job site' });
  assert.equal(classified.status, 200);

  // 4. Publishing is refused until permission is recorded (WEB-002).
  await post(`/api/sites/${siteId}/preview`, {});
  const refused = await post(`/api/sites/${siteId}/publish`, {});
  assert.equal(refused.status, 409, 'a blocked publish is a conflict, not a 500');
  assert.match(JSON.stringify(refused.payload), /WEB-002/);
  assert.ok(refused.payload.policyDecision || refused.payload.decision, 'the policy decision is returned to the client');

  // 5. Record permission, then publish.
  const permission = await post(`/api/sites/${siteId}/permissions`, {
    grantedBy: 'Owner', role: 'owner', method: 'whatsapp', identifiablePeople: true, popiaConsent: true,
    evidenceHash: 'api-test-evidence',
  });
  assert.equal(permission.status, 200, JSON.stringify(permission.payload));
  const published = await post(`/api/sites/${siteId}/publish`, {});
  assert.equal(published.status, 200, JSON.stringify(published.payload));

  // 6. Subscribe, then take a booking through the public site.
  const subscribed = await post(`/api/sites/${siteId}/subscribe`, { planId: 'business-growth' });
  assert.equal(subscribed.status, 200, JSON.stringify(subscribed.payload));
  assert.ok(subscribed.payload.subscription.escrowId, 'month one is held in escrow');

  const detail = await (await get(`/api/sites/${siteId}`)).body;
  assert.equal(detail.catalogueLabel, 'Services & prices', 'the site carries its own catalogue vocabulary');
  const booking = await post(`/api/sites/${siteId}/bookings`, {
    values: sampleBookingValues(detail.booking.fields),
    source: 'website',
  });
  assert.equal(booking.status, 200, JSON.stringify(booking.payload));
  const created = booking.payload.booking || booking.payload;
  assert.match(created.reference, /^BKG-\d{6}$/);
  assert.equal(created.status, 'NEW');
  assert.equal(created.ownerNotified, true, 'the business inbox is told');
  assert.equal(created.job, null, 'a site not linked to a verified pro does not hand its customer to competitors');
  assert.ok(created.nextStep.length > 20);

  // The same form on a site that IS linked to a verified pro opens a real job.
  const proSite = (await marketplace.businessSites.list()).find((s) => s.slug === 'dlamini-plumbing');
  const proDetail = await (await get(`/api/sites/${proSite.siteId}`)).body;
  const proBooking = await post(`/api/sites/${proSite.siteId}/bookings`, {
    values: sampleBookingValues(proDetail.booking.fields),
    source: 'website',
  });
  assert.equal(proBooking.status, 200, JSON.stringify(proBooking.payload));
  const proCreated = proBooking.payload.booking || proBooking.payload;
  assert.ok(proCreated.job && proCreated.job.jobId, 'the trade booking opened a real marketplace job');
  const jobResponse = await get(`/api/jobs/${proCreated.job.jobId}`);
  assert.equal(jobResponse.status, 200);
  const job = await jobResponse.body;
  assert.equal(job.source, 'BUSINESS_SITE');
  assert.match(job.description, /Dlamini Plumbing/);

  // 7. The listing, gallery and export endpoints all serve it.
  const list = await get('/api/sites');
  const listBody = await list.body;
  assert.ok(listBody.some((s) => s.siteId === siteId));

  const exported = await get(`/api/sites/${siteId}/export`);
  assert.equal(exported.status, 200);
  const exportedPayload = await exported.body;
  assert.ok(exportedPayload.sha256.length === 64, 'the export is hashed so the client can prove what they were given');
  assert.ok(exportedPayload.bytes > 5000);
  const html = exportedPayload.html;
  assert.ok(html.includes('API Integration Plumbing'));
  assert.ok(html.includes('<form'), 'the exported page keeps the working booking form');
  assert.ok(!/<script src=/.test(html), 'and it is genuinely self-contained');

  const slug = (await marketplace.businessSites.get(siteId)).slug;
  assert.equal((await get(`/s/${slug}`)).status, 200);
  const rawExport = await get(`/export/${slug}`);
  assert.equal(rawExport.status, 200, 'the file itself is downloadable from a plain URL');
  assert.match(await rawExport.body, /<form/);

  // 8. Update credits are metered through the API too.
  const updates = await get(`/api/sites/${siteId}/updates`);
  assert.equal(updates.status, 200);
  const logged = await post(`/api/sites/${siteId}/updates`, { summary: 'Changed the callout fee wording on site' });
  assert.equal(logged.status, 200, JSON.stringify(logged.payload));
  const loggedUpdate = logged.payload.update || logged.payload;
  assert.ok(loggedUpdate.updateId, 'the update is recorded against the allowance');
  assert.equal(loggedUpdate.creditConsumed, true, 'and it consumed a credit, not a silent invoice');

  // Content edits consume a credit, and running out is a 409 the studio can act on.
  const edits = [];
  for (let i = 0; i < 6; i += 1) {
    edits.push(await fetch(`${origin}/api/sites/${siteId}/content`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagline: `Metered edit ${i}` }),
    }));
  }
  const statuses = edits.map((r) => r.status);
  assert.ok(statuses.includes(409), `the allowance must run out, got ${statuses.join(',')}`);
  const refusedEdit = await edits[statuses.indexOf(409)].json();
  assert.match(refusedEdit.message, /allowance/i);
  assert.ok(refusedEdit.details || refusedEdit.policyDecision, 'and the client is told what it can do about it');

  const approved = await fetch(`${origin}/api/sites/${siteId}/content`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagline: 'Approved extra edit', approveExtra: true }),
  });
  assert.equal(approved.status, 200, 'an explicitly approved extra update goes through and is billed');
  const approvedBody = await approved.json();
  const approvedUpdate = approvedBody.update || approvedBody;
  assert.equal(approvedUpdate.chargedCents, 15000, 'at the published rate');
});

test('a booking posted to a public slug reaches the same pipeline', async () => {
  const site = (await marketplace.businessSites.list()).find((s) => s.slug === 'thando-s-table');
  const response = await post(`/api/sites/${site.siteId}/bookings`, {
    values: { name: 'Route Test Diner', phone: '0840003333', date: '2026-12-30', time: '19:00', guests: '6', notes: 'Window table if possible' },
    source: 'website',
  });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  const booking = response.payload.booking || response.payload;
  assert.equal(booking.intake, 'RESERVATION');
  assert.equal(booking.amountQuotedCents, 0, 'a table booking names no priced item, so no price is invented');
  assert.match(booking.customerMessage, /confirm/i);

  const all = await get('/api/sites/bookings');
  assert.equal(all.status, 200);
  const allBody = await all.body;
  assert.ok((Array.isArray(allBody) ? allBody : allBody.bookings).some((b) => b.reference === booking.reference));
});

test('a rejected booking value returns a 400 the form can show', async () => {
  const site = (await marketplace.businessSites.list()).find((s) => s.slug === 'thando-s-table');
  const response = await post(`/api/sites/${site.siteId}/bookings`, { values: { name: 'No Phone' }, source: 'website' });
  assert.equal(response.status, 400, 'validation failures are client errors');
  assert.match(JSON.stringify(response.payload), /Mobile is required|phone/i);
});

test('export bundle and sitemap are served', async () => {
  const bundle = await get('/api/sites/export-bundle');
  assert.equal(bundle.status, 200);
  const robots = await get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(await robots.body, /Sitemap/);
  const sitemap = await get('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.body, /<urlset/);
  assert.match(await sitemap.body, /thando-s-table/);
});

test('the server-rendered public pages work without JavaScript', async () => {
  const index = await get('/sites');
  assert.equal(index.status, 200);
  assert.match(await index.body, /Dlamini Plumbing|Thando/);

  const live = await get('/s/dlamini-plumbing');
  assert.equal(live.status, 200);
  const liveHtml = await live.body;
  assert.match(liveHtml, /<form class="bform" method="post"/, 'a real form post, no JavaScript required');
  assert.match(liveHtml, /LocalBusiness/);

  const preview = await get('/preview/nails-on-main');
  assert.equal(preview.status, 200);
  assert.match(await preview.body, /demo-bar|preview/i);

  const blocked = await get('/s/kloof-cellars');
  assert.equal(blocked.status, 404, 'a site that never cleared its permission gate is not public');
});

/* ==================================================================== *
 * 3. The sales desk HTTP API
 * ==================================================================== */

test('a lead can be captured, diagnosed, demoed and pitched over HTTP', async () => {
  const captured = await post('/api/leads', {
    businessName: 'HTTP Route Bakery', industry: 'bakery', url: 'https://routebakery.example.co.za',
    contactName: 'Zanele Khumalo', phone: '0850004444', email: 'zanele@routebakery.co.za',
    suburb: 'Parkhurst', websiteStatus: 'OUTDATED', source: 'FIELD_RESEARCH', notes: 'Prices from 2021',
  });
  assert.equal(captured.status, 200, JSON.stringify(captured.payload));
  const leadId = captured.payload.leadId || captured.payload.lead.leadId;
  assert.ok(leadId);

  const diagnosed = await post(`/api/leads/${leadId}/diagnose`, {});
  assert.equal(diagnosed.status, 200, JSON.stringify(diagnosed.payload));
  assert.equal(diagnosed.payload.diagnostic.simulated, true, 'offline scans stay honest over HTTP too');
  assert.ok(diagnosed.payload.diagnostic.recommendedPlanName);

  const demo = await post(`/api/leads/${leadId}/demo`, {});
  assert.equal(demo.status, 200, JSON.stringify(demo.payload));
  assert.match(demo.payload.previewUrl, /^\/preview\/http-route-bakery/);
  assert.equal(demo.payload.site.status, 'PREVIEW');

  const kit = await get(`/api/leads/${leadId}/pitch-kit`);
  assert.equal(kit.status, 200);
  const kitBody = await kit.body;
  assert.ok(kitBody.script.length >= 5);
  assert.ok(kitBody.recommendation.planName);
  assert.ok(kitBody.permissions.checklist.length >= 4);
  assert.ok(kitBody.aiImages.budgetStack.length >= 3);
  assert.match(kitBody.coldEmail.body, /HTTP Route Bakery/);
  assert.ok(!/\{[a-zA-Z]+\}/.test(kitBody.coldEmail.body), 'no unfilled placeholders reach the salesperson');

  const touched = await post(`/api/leads/${leadId}/outreach`, { channel: 'WHATSAPP', template: 'WHATSAPP', note: 'Sent the preview link' });
  assert.equal(touched.status, 200, JSON.stringify(touched.payload));
  assert.ok(touched.payload.touch.message.length > 60);

  const converted = await post(`/api/leads/${leadId}/convert`, { planId: 'business-growth' });
  assert.equal(converted.status, 200, JSON.stringify(converted.payload));
  assert.equal(converted.payload.lead.stage, 'WON');
  assert.ok(converted.payload.subscription.escrowId, 'the win puts money in escrow');

  const stats = await get('/api/leads/stats');
  const statsBody = await stats.body;
  assert.ok(statsBody.won >= 1);
  assert.ok(statsBody.monthlyRecurringCents >= 179900);

  const actions = await get('/api/leads/actions');
  const actionsBody = await actions.body;
  assert.ok(Array.isArray(actionsBody) && actionsBody.every((a) => a.action && a.businessName));
});

test('a POPIA opt-out over HTTP blocks every later outreach attempt', async () => {
  const captured = await post('/api/leads', {
    businessName: 'Do Not Call Deli', industry: 'deli', suburb: 'Melville', websiteStatus: 'NO_WEBSITE', phone: '0860005555',
  });
  const leadId = captured.payload.leadId || captured.payload.lead.leadId;

  const opted = await post(`/api/leads/${leadId}/opt-out`, { reason: 'Asked us to stop', requestedVia: 'phone' });
  assert.equal(opted.status, 200, JSON.stringify(opted.payload));
  assert.equal(opted.payload.consent ? opted.payload.consent.optOut : opted.payload.lead.consent.optOut, true);

  const blocked = await post(`/api/leads/${leadId}/outreach`, { channel: 'PHONE' });
  assert.ok([400, 409].includes(blocked.status), `expected a refusal, got ${blocked.status}`);
  assert.match(JSON.stringify(blocked.payload), /LEAD-001/);
  assert.match(JSON.stringify(blocked.payload), /POPIA/);
});

test('unknown ids and bad payloads are 404s and 400s, never 500s', async () => {
  assert.equal((await get('/api/sites/site_does-not-exist')).status, 404);
  assert.equal((await get('/api/leads/lead_does-not-exist')).status, 404);
  assert.equal((await get('/s/not-a-real-slug')).status, 404);
  const badScaffold = await post('/api/sites', { businessName: 'No Template' });
  assert.ok([400, 409].includes(badScaffold.status), `expected a client error, got ${badScaffold.status}`);
});

test('/api/stats now carries the studio and the sales desk', async () => {
  const stats = await get('/api/stats');
  assert.equal(stats.status, 200);
  const body = await stats.body;
  assert.ok(body.businessSites.sites >= 8);
  assert.ok(body.businessSites.templates === 10);
  assert.ok(body.salesDesk.leads >= 6);
  assert.ok(typeof body.salesDesk.weightedPipelineCents === 'number');
  assert.ok(body.policy.byRule, 'policy telemetry is still there');
});

/* ==================================================================== *
 * 4. The shop: portfolio feed, product page, orders, upload
 * ==================================================================== */

function screen(route) {
  const handler = global.window.ProVeri.screens[route];
  assert.equal(typeof handler, 'function', `${route} must be registered by the PWA`);
  return handler;
}

test('the storefront is the shell: four tabs, one action button, no information flood', () => {
  const indexHtml = fs.readFileSync(path.join(PWA_ROOT, 'index.html'), 'utf8');
  const tabs = [...indexHtml.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['/', '/browse', '/orders', '/me'], 'four tabs, in the order a shopper reads them');
  assert.ok(indexHtml.includes('id="fab"'), 'one floating action button for both sides of the market');
  assert.ok(indexHtml.includes('/js/screens-shop.js'), 'the shop bundle is loaded');
  assert.ok(indexHtml.indexOf('<script src="/js/screens-shop.js"') > indexHtml.indexOf('<script src="/js/screens-market.js"'),
    'and loaded after the marketplace screens so it owns the storefront routes');
  assert.ok(indexHtml.indexOf('<script src="/js/screens-shop.js"') < indexHtml.indexOf('<script src="/js/app.js"'),
    'and before app.js derives the routes');
  assert.match(indexHtml, /In South Africa, for South Africa/, 'the positioning is on the page itself');

  const appSource = fs.readFileSync(path.join(PWA_ROOT, 'js/app.js'), 'utf8');
  for (const route of ['/browse', '/orders', '/me', '/upload-work']) {
    assert.ok(appSource.includes(`'${route}'`), `${route} needs a document title`);
  }
  assert.match(appSource, /getElementById\('fab'\)/, 'the action button is wired');

  const sw = fs.readFileSync(path.join(PWA_ROOT, 'sw.js'), 'utf8');
  assert.ok(sw.includes('/js/screens-shop.js'), 'the service worker precaches the shop for offline');
  assert.match(sw, /VERSION = 'proveri-v3'/, 'and the cache version moved so phones pick it up');
});

test('the home screen is a search box, categories and work — nothing else', async () => {
  const node = await screen('/')({ params: {}, query: {} });
  await new Promise((resolve) => setTimeout(resolve, 350)); // the feed and chips load after paint
  const text = assertCleanRender(node, '/');

  assert.ok(node.querySelector('.search-bar'), 'the first thing on the page is how to find work');
  assert.ok(node.querySelectorAll('.chip').length >= 5, 'categories are one tap away');
  assert.ok(node.querySelectorAll('.work-card').length >= 3, 'real work is on the first screen');
  assert.match(text, /Work done near you/i);
  assert.match(text, /escrow-released|backed by/i, 'and one honest line about what the feed is made of');
  assert.match(text, /Did the work\? Put it here\./, 'the other side of the market gets one card, not a lecture');

  // The old flood is gone.
  assert.ok(!text.includes('How ProVeri protects both sides'), 'no four-step essay on the home screen');
  assert.ok(!text.includes('Why ProVeri, not a classifieds site'), 'no differentiator wall of copy');
  assert.equal(node.querySelectorAll('.stat-grid').length, 0, 'no six-stat grid above the fold');
  assert.equal(node.querySelectorAll('.pill-stat').length, 0);
});

test('the browse screen filters like a shop floor', async () => {
  const node = await screen('/browse')({ params: {}, query: {} });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const text = assertCleanRender(node, '/browse');

  assert.ok(node.querySelector('.search-bar'), 'search');
  assert.equal(node.querySelector('.filters').querySelectorAll('select').length, 3, 'category, suburb and sort');
  assert.ok(node.querySelectorAll('.work-card').length >= 3, 'the grid is full of work');
  assert.match(text, /proven on ProVeri/, 'and it says how much of it is proven');

  const provenChip = node.querySelectorAll('.chip')[1];
  assert.match(textOf(provenChip), /Proof of work/);
});

test('a piece of work renders as a product page with the truth about its badge', async () => {
  const feed = await marketplace.portfolio.list({ limit: 50 });
  const proven = feed.find((i) => i.verified);
  const declared = feed.find((i) => !i.verified);

  const provenNode = await screen('/work/:itemId')({ params: { itemId: proven.itemId }, query: {} });
  const provenText = assertCleanRender(provenNode, `/work/${proven.itemId}`);
  assert.ok(provenText.includes(proven.title), 'the job is the headline');
  assert.match(provenText, /Proof of work|Client confirmed/);
  assert.match(provenText, /escrow-released job/i, 'the badge explains itself');
  assert.ok(provenNode.querySelector('.photo-strip'), 'photos first');
  assert.ok(provenNode.querySelector('.pro-row'), 'the pro who did it is one tap away');
  assert.ok(provenNode.querySelector('.cta-bar'), 'and the two things a home owner can do are pinned');
  assert.match(provenText, /Message about this/, 'reach out');
  assert.match(provenText, /Hire for my job/, 'or post the job');
  assert.match(provenText, /Ledger seal [0-9a-f]{16}/, 'the seal is printed, not hidden');

  const declaredNode = await screen('/work/:itemId')({ params: { itemId: declared.itemId }, query: {} });
  const declaredText = assertCleanRender(declaredNode, `/work/${declared.itemId}`);
  assert.match(declaredText, /Uploaded by the pro/, 'a self-declared item says so on the page');
  assert.match(declaredText, /Nothing on ProVeri corroborates/i);
  assert.ok(!declaredText.includes('Proof of work'), 'and never borrows the badge it did not earn');
  assert.match(declaredText, /Illustrative photo/, 'demo imagery is labelled as such');
});

test('the pro profile leads with their published work', async () => {
  const feed = await marketplace.portfolio.list({ limit: 50 });
  const withWork = feed.find((i) => i.proName);
  const profile = await marketplace.people.publicProfile(withWork.proId);
  const node = await screen('/pro/:proId')({ params: { proId: profile.proId }, query: {} });
  const text = assertCleanRender(node, `/pro/${profile.proId}`);
  assert.match(text, /Work they have published/, 'the shelf comes before the CV');
  assert.ok(node.querySelectorAll('.work-card.mini').length >= 1, 'each item links to its own page');
  assert.match(text, /Proof of work|Uploaded by the pro/, 'with the tier it earned');
});

test('orders is the tracking view, and it asks you to sign in first', async () => {
  global.window.ProVeri.api.setSession(null);
  const anon = await screen('/orders')({ params: {}, query: {} });
  const anonText = assertCleanRender(anon, '/orders (signed out)');
  assert.match(anonText, /Sign in to see your orders/);

  const customer = marketplace.store.all('customers')[0];
  global.window.ProVeri.api.setSession({ userId: customer.customerId, role: 'CUSTOMER', name: customer.fullName });
  const node = await screen('/orders')({ params: {}, query: {} });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const text = assertCleanRender(node, '/orders');
  assert.ok(node.querySelector('.seg'), 'the two sides of the market are one tap apart');
  if (node.querySelector('.order-row')) {
    assert.ok(node.querySelectorAll('.track-step').length >= 5, 'each order shows where it is');
    assert.match(text, /Money in escrow|You confirmed|Pro paid/);
  } else {
    assert.match(text, /No orders yet|Browse work/);
  }

  const booking = marketplace.store.all('bookings').find((b) => b.customerId === customer.customerId) || marketplace.store.all('bookings')[0];
  const orderNode = await screen('/order/:bookingId')({ params: { bookingId: booking.bookingId }, query: {} });
  const orderText = assertCleanRender(orderNode, `/order/${booking.bookingId}`);
  assert.match(orderText, /Where your money is/, 'the money is explained in words');
  assert.match(orderText, /Nobody is paid before you confirm/);
  assert.ok(orderNode.querySelectorAll('.track-step').length >= 5);
  global.window.ProVeri.api.setSession(null);
});

test('post a job is a three-step checkout, not one long form', async () => {
  const customer = marketplace.store.all('customers')[0];
  global.window.ProVeri.api.setSession({ userId: customer.customerId, role: 'CUSTOMER', name: customer.fullName });
  const node = await screen('/post-job')({ params: {}, query: {} });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const text = assertCleanRender(node, '/post-job');

  assert.equal(node.querySelectorAll('.step-pill').length, 3, 'three steps');
  assert.match(text, /What/, );
  assert.match(text, /Where & when/);
  assert.match(text, /Budget & post/);
  assert.ok(node.querySelector('.step-pill.current'), 'and the shopper can see which one they are on');
  assert.ok(node.querySelector('textarea[name=description]'), 'step one asks one question');
  assert.ok(!node.querySelector('input[name=address]'), 'step two is not on screen yet — nothing is dumped on the user');
  assert.ok(!text.includes('Household & access'), 'the safety questions wait for step two');
  global.window.ProVeri.api.setSession(null);
});

test('uploading work is honest about what an upload can and cannot claim', async () => {
  global.window.ProVeri.api.setSession(null);
  const anon = await screen('/upload-work')({ params: {}, query: {} });
  assert.match(assertCleanRender(anon, '/upload-work (signed out)'), /Upload your past work/);

  const pro = marketplace.store.all('pros').find((p) => marketplace.portfolio.forPro(p.proId).length > 0);
  global.window.ProVeri.api.setSession({ userId: pro.proId, role: 'PRO', name: pro.displayName });
  const node = await screen('/upload-work')({ params: {}, query: {} });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const text = assertCleanRender(node, '/upload-work');
  assert.ok(node.querySelector('input[type=file][name=photos]'), 'photos come first');
  assert.match(text, /sealed with a hash/i, 'and the pro is told what happens to them');
  assert.match(text, /refused/i, 'including that a stolen photo is refused');
  assert.match(text, /a badge nobody can buy/i);
  assert.ok(node.querySelector('input[name=bookingId]'), 'linking a ProVeri job is how an upload becomes proof');
  assert.ok(node.querySelectorAll('.work-card').length >= 1, 'their published work is right below the form');
  global.window.ProVeri.api.setSession(null);
});

test('the "you" hub keeps the advanced surfaces out of the main navigation', async () => {
  global.window.ProVeri.api.setSession(null);
  const anon = await screen('/me')({ params: {}, query: {} });
  assert.match(assertCleanRender(anon, '/me (signed out)'), /Sign in to ProVeri/);

  const pro = marketplace.store.all('pros')[0];
  global.window.ProVeri.api.setSession({ userId: pro.proId, role: 'PRO', name: pro.displayName });
  const node = await screen('/me')({ params: {}, query: {} });
  const text = assertCleanRender(node, '/me');
  const hrefs = node.querySelectorAll('a.tile').map((a) => a.getAttribute('href'));
  for (const route of ['/orders', '/upload-work', '/notifications', '/wallet', '/trust', '/integrations', '/business-studio', '/sales-desk', '/vehicles', '/property', '/admin']) {
    assert.ok(hrefs.includes(route), `${route} lives under You, not in the tab bar`);
  }
  assert.match(text, /Install the app/);
  assert.equal(node.querySelectorAll('#app-nav button').length, 0, 'the hub does not re-render the tab bar');
  global.window.ProVeri.api.setSession(null);
});

test('the portfolio API serves the shelf over HTTP', async () => {
  const feed = await get('/api/portfolio?limit=50&sort=verified');
  assert.equal(feed.status, 200);
  const items = await feed.body;
  assert.ok(items.length >= 10, 'the seed publishes the harvested and uploaded work');
  assert.ok(items[0].verified, 'proven work comes first');
  assert.ok(items.every((i) => i.itemId && i.title && i.tierLabel && i.proName !== undefined));

  const stats = await (await get('/api/portfolio/stats')).body;
  assert.ok(stats.harvested >= 5, 'closed jobs harvested themselves');
  assert.ok(stats.uploads >= 5, 'and pros uploaded work of their own');
  assert.equal(stats.items, stats.harvested + stats.uploads);

  const tiers = await (await get('/api/portfolio/tiers')).body;
  assert.equal(tiers.tiers.length, 3);
  assert.equal(tiers.explainer.length, 3);
  assert.deepEqual(tiers.rules.map((r) => r.id).sort(), ['PRT-001', 'PRT-002', 'PRT-003'], 'the rules that police the shelf are published with it');

  const one = items.find((i) => i.photo && i.photo.url);
  const detail = await (await get(`/api/portfolio/${one.itemId}`)).body;
  assert.equal(detail.verification.tier, one.tier);
  assert.ok(detail.pro.micrositeUrl, 'the product page can link the pro’s microsite');

  const photo = await get(one.photo.url);
  assert.equal(photo.status, 200, 'the demo work photo the seed points at is actually served');

  const byPro = await (await get(`/api/pros/${one.proId}/portfolio`)).body;
  assert.ok(byPro.some((i) => i.itemId === one.itemId));
});

test('the reach-out loop works over HTTP, and privacy holds', async () => {
  const pro = marketplace.store.all('pros')[0];
  const customer = marketplace.store.all('customers')[0];
  const stranger = marketplace.store.all('pros').find((p) => p.proId !== pro.proId);

  const uploaded = await post('/api/portfolio', {
    proId: pro.proId,
    title: 'Bathroom re-tiled and sealed, HTTP test',
    priceCents: 585000,
    photos: [{ dataUrl: `data:image/jpeg;base64,${Buffer.from('http-integration-test-photo').toString('base64')}`, caption: 'Finished wall' }],
  });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.payload));
  const itemId = uploaded.payload.itemId;
  assert.equal(uploaded.payload.tier, 'SELF_DECLARED');

  const badgeClaim = await fetch(`${origin}/api/portfolio/${itemId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId: pro.proId, claimsProofOfWork: true }),
  });
  assert.equal(badgeClaim.status, 409, 'a claimed badge is a refusal, not a server error');
  assert.match(JSON.stringify(await badgeClaim.json()), /PRT-001/);

  const stolen = await post('/api/portfolio', {
    proId: stranger.proId,
    title: 'The same bathroom, different pro',
    photos: [{ dataUrl: `data:image/jpeg;base64,${Buffer.from('http-integration-test-photo').toString('base64')}`, caption: 'borrowed' }],
  });
  assert.equal(stolen.status, 409);
  assert.match(JSON.stringify(stolen.payload), /PRT-002/);

  const enquiry = await post(`/api/portfolio/${itemId}/enquire`, { customerId: customer.customerId, message: 'Can you do this in my bathroom next week?' });
  assert.equal(enquiry.status, 200, JSON.stringify(enquiry.payload));
  assert.equal(enquiry.payload.thread, `portfolio:${itemId}`);

  const reply = await post(`/api/portfolio/${itemId}/enquire`, { actorId: pro.proId, customerId: customer.customerId, message: 'Yes — I can come Thursday.' });
  assert.equal(reply.status, 200);

  const thread = await get(`/api/portfolio/${itemId}/messages?userId=${customer.customerId}`);
  assert.equal(thread.status, 200);
  assert.equal((await thread.body).length, 2);

  const nosy = await get(`/api/portfolio/${itemId}/messages?userId=${stranger.proId}`);
  assert.equal(nosy.status, 403, 'somebody else’s conversation is forbidden, not a 500');

  const flagged = await post(`/api/portfolio/${itemId}/flag`, { reason: 'Not their work', reporterId: customer.customerId });
  assert.equal(flagged.status, 200);
  assert.equal(flagged.payload.status, 'FLAGGED');
  const afterFlag = await (await get('/api/portfolio?limit=100')).body;
  assert.ok(!afterFlag.some((i) => i.itemId === itemId), 'a flagged item leaves the shelf');

  const removed = await fetch(`${origin}/api/portfolio/${itemId}?actorId=${pro.proId}&reason=test+cleanup`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).status, 'REMOVED');
  assert.ok(marketplace.store.get('portfolioItems', itemId), 'the record survives the removal');
});

test('an unknown work item and a bad upload are client errors', async () => {
  assert.equal((await get('/api/portfolio/prt_does-not-exist')).status, 404);
  const noPhotos = await post('/api/portfolio', { proId: marketplace.store.all('pros')[0].proId, title: 'No photos' });
  assert.equal(noPhotos.status, 400);
  assert.match(JSON.stringify(noPhotos.payload), /photo/i);
  const noPro = await post('/api/portfolio', { title: 'Nobody did this' });
  assert.equal(noPro.status, 400);
});

test('a job posted without a trade is matched from its own description', async () => {
  // The checkout promises "auto-detect from my description", so the server has
  // to do the detecting — a plain-language job must not bounce with a 400.
  const customer = marketplace.store.all('customers')[0];
  const posted = await post('/api/jobs', {
    customerId: customer.customerId,
    description: 'The geyser is leaking through the kitchen ceiling and needs replacing today',
    title: 'Geyser replacement',
    addressText: 'Midrand, Johannesburg',
    urgency: 'URGENT',
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.payload));
  assert.ok(posted.payload.jobId, 'the job exists');
  assert.equal(posted.payload.categoryAutoDetected.categoryId, 'plumbing');
  assert.equal(posted.payload.categoryAutoDetected.label, 'Plumber');
  assert.ok(posted.payload.categoryAutoDetected.confidence > 0);
  assert.ok(posted.payload.categoryAutoDetected.why.includes('geyser'), 'and it says why it matched');

  const vague = await post('/api/jobs', {
    customerId: customer.customerId, description: 'help', title: 'help', addressText: 'Midrand',
  });
  assert.equal(vague.status, 400, 'a description we cannot match asks for a trade');
  assert.match(JSON.stringify(vague.payload), /pick a trade|categoryId/);
});

test('shutdown', () => {
  marketplace.stopScheduler();
  server.close();
});
