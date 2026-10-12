'use strict';

/**
 * Lula ProVeri — Persistence.
 *
 * Zero-dependency store: an in-memory graph with an append-only JSON snapshot
 * on disk. Swapping this for Postgres/Neon is a one-file change — every module
 * reads and writes through `store`, never through `fs` or a global.
 *
 * Deliberately synchronous and in-process: the reference implementation is
 * meant to be readable and testable, not to be the production database.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', '.store.json');

class Store {
  constructor({ file = DEFAULT_FILE, persist = false } = {}) {
    this.file = file;
    this.persist = persist;
    this.data = {
      meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: null },
      users: new Map(),
      customers: new Map(),
      pros: new Map(),
      jobs: new Map(),
      bids: new Map(),
      bookings: new Map(),
      reviews: new Map(),
      disputes: new Map(),
      messages: new Map(),
      notifications: new Map(),
      tickets: new Map(),
      wallets: new Map(),
      payouts: new Map(),
      vehicles: new Map(),
      vehiclePassports: new Map(),
      websites: new Map(),
      webStudioOrders: new Map(),
      webStudioDiagnostics: new Map(),
      campaigns: new Map(),
      sessions: new Map(),
      variationOrders: new Map(),
      businessSites: new Map(),
      siteAssets: new Map(),
      sitePermissions: new Map(),
      siteUpdates: new Map(),
      siteBookings: new Map(),
      siteSubscriptions: new Map(),
      salesLeads: new Map(),
      portfolioItems: new Map(),
      leadTouches: new Map(),
      waitlist: [],
      priceBands: {},
      counters: {},
    };
  }

  /* -------- generic collection helpers -------- */

  collection(name) {
    if (!this.data[name]) throw new Error(`unknown collection: ${name}`);
    return this.data[name];
  }

  put(name, id, record) {
    this.collection(name).set(id, record);
    this.data.meta.updatedAt = new Date().toISOString();
    return record;
  }

  get(name, id) {
    return this.collection(name).get(id) || null;
  }

  has(name, id) {
    return this.collection(name).has(id);
  }

  remove(name, id) {
    return this.collection(name).delete(id);
  }

  all(name) {
    return [...this.collection(name).values()];
  }

  find(name, predicate) {
    return this.all(name).filter(predicate);
  }

  findOne(name, predicate) {
    return this.all(name).find(predicate) || null;
  }

  count(name, predicate) {
    return predicate ? this.find(name, predicate).length : this.collection(name).size;
  }

  /** Monotonic per-namespace counter, e.g. JOB-000001. */
  counter(namespace) {
    const current = (this.data.counters[namespace] || 0) + 1;
    this.data.counters[namespace] = current;
    return current;
  }

  reference(prefix, namespace, width = 6) {
    return `${prefix}-${String(this.counter(namespace)).padStart(width, '0')}`;
  }

  /* -------- snapshots -------- */

  save() {
    if (!this.persist) return { saved: false, reason: 'persistence disabled' };
    const serialized = {
      meta: this.data.meta,
      counters: this.data.counters,
      priceBands: this.data.priceBands,
      waitlist: this.data.waitlist,
      collections: Object.fromEntries(
        Object.entries(this.data)
          .filter(([, value]) => value instanceof Map)
          .map(([key, map]) => [key, [...map.entries()]]),
      ),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(serialized));
    return { saved: true, file: this.file, collections: Object.keys(serialized.collections) };
  }

  load() {
    if (!this.persist) return { loaded: false, reason: 'persistence disabled' };
    if (!fs.existsSync(this.file)) return { loaded: false, reason: 'no snapshot file' };
    const serialized = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.data.meta = serialized.meta || this.data.meta;
    this.data.counters = serialized.counters || {};
    this.data.priceBands = serialized.priceBands || {};
    this.data.waitlist = serialized.waitlist || [];
    for (const [name, entries] of Object.entries(serialized.collections || {})) {
      if (this.data[name] instanceof Map) this.data[name] = new Map(entries);
    }
    return { loaded: true, file: this.file };
  }

  reset() {
    for (const [key, value] of Object.entries(this.data)) {
      if (value instanceof Map) value.clear();
    }
    this.data.counters = {};
    this.data.waitlist = [];
    this.data.priceBands = {};
    if (this.persist && fs.existsSync(this.file)) fs.unlinkSync(this.file);
    return { reset: true };
  }

  stats() {
    const out = {};
    for (const [key, value] of Object.entries(this.data)) {
      if (value instanceof Map) out[key] = value.size;
    }
    return { ...out, meta: this.data.meta, counters: this.data.counters };
  }
}

module.exports = { Store, DEFAULT_FILE };
