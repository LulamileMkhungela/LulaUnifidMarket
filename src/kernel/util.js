'use strict';

/**
 * Lula ProVeri — Trust Kernel primitives.
 *
 * The kernel is the single source of truth for:
 *   - deterministic identity generation
 *   - tamper-evident hashing (SHA-256 over canonicalised JSON)
 *   - money handling (integer cents, ZAR-first, multi-currency aware)
 *   - safe immutable copies handed to callers
 *
 * It is deliberately dependency-free so the same code runs on the API server,
 * in the test suite, and (transpiled) in the PWA.
 */

const crypto = require('node:crypto');

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

const SA_TIMEZONE = 'Africa/Johannesburg';

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function addDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function isPast(iso) {
  return Boolean(iso) && new Date(iso).getTime() < Date.now();
}

/** South African date string (YYYY-MM-DD) in SAST. */
function saDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: SA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** South African local time string (HH:mm) in SAST. */
function saTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: SA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

const PREFIXES = Object.freeze({
  user: 'usr',
  pro: 'pro',
  customer: 'cus',
  job: 'job',
  bid: 'bid',
  booking: 'bkg',
  milestone: 'mst',
  evidence: 'evd',
  escrow: 'esc',
  payout: 'pay',
  dispute: 'dsp',
  review: 'rev',
  message: 'msg',
  notification: 'ntf',
  check: 'chk',
  incident: 'inc',
  signal: 'sig',
  audit: 'aud',
  listing: 'lst',
  vehicle: 'veh',
  ticket: 'tkt',
  website: 'web',
  quote: 'qot',
  campaign: 'cmp',
});

let sequence = 0;

function nextId(prefix = 'id') {
  sequence += 1;
  const rand = crypto.randomBytes(3).toString('hex');
  return `${prefix}_${Date.now().toString(36)}${sequence.toString(36).padStart(4, '0')}${rand}`;
}

function idFor(kind) {
  return nextId(PREFIXES[kind] || kind);
}

/* ------------------------------------------------------------------ *
 * Hashing
 * ------------------------------------------------------------------ */

/** Stable, key-ordered JSON so hashes survive object key reordering. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined) acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function sha256(input) {
  const data = typeof input === 'string' ? input : JSON.stringify(canonicalize(input));
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Short, human-quotable fingerprint — used for gate codes and evidence seals. */
function fingerprint(value, length = 8) {
  return sha256(value).slice(0, length).toUpperCase();
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/* ------------------------------------------------------------------ *
 * Object paths (used by the tamper/policy engine)
 * ------------------------------------------------------------------ */

function getPath(object, path) {
  return path.split('.').reduce((cursor, segment) => {
    if (cursor === undefined || cursor === null) return undefined;
    return cursor[segment];
  }, object);
}

function setPath(object, path, value) {
  const segments = path.split('.');
  let cursor = object;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
}

function flattenPatch(patch, prefix = '') {
  return Object.entries(patch || {}).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) return flattenPatch(value, path);
    return [[path, value]];
  });
}

/* ------------------------------------------------------------------ *
 * Money — integer cents only, never floats
 * ------------------------------------------------------------------ */

const CURRENCY = Object.freeze({
  ZAR: { code: 'ZAR', symbol: 'R', decimals: 2, minorUnit: 'cents' },
  USD: { code: 'USD', symbol: '$', decimals: 2, minorUnit: 'cents' },
  GBP: { code: 'GBP', symbol: '£', decimals: 2, minorUnit: 'pence' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, minorUnit: 'cents' },
  BWP: { code: 'BWP', symbol: 'P', decimals: 2, minorUnit: 'thebe' },
  NAD: { code: 'NAD', symbol: 'N$', decimals: 2, minorUnit: 'cents' },
  ZWL: { code: 'ZWL', symbol: 'Z$', decimals: 2, minorUnit: 'cents' },
  MZN: { code: 'MZN', symbol: 'MT', decimals: 2, minorUnit: 'centavos' },
  LSL: { code: 'LSL', symbol: 'M', decimals: 2, minorUnit: 'lisente' },
  SZL: { code: 'SZL', symbol: 'E', decimals: 2, minorUnit: 'cents' },
});

function assertCents(amountCents, field = 'amountCents') {
  if (!Number.isInteger(amountCents)) throw new Error(`${field} must be an integer (got ${amountCents})`);
  if (amountCents < 0) throw new Error(`${field} must not be negative (got ${amountCents})`);
  return amountCents;
}

function randToCents(rand) {
  return Math.round(Number(rand) * 100);
}

function centsToRand(cents) {
  return Number(cents) / 100;
}

function formatZar(cents, { withSymbol = true } = {}) {
  const value = Number(cents || 0) / 100;
  const formatted = value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `R${formatted}` : formatted;
}

function splitAmount(totalCents, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('weights must sum to more than zero');
  let allocated = 0;
  const parts = weights.map((weight, index) => {
    if (index === weights.length - 1) return totalCents - allocated;
    const part = Math.floor((totalCents * weight) / sum);
    allocated += part;
    return part;
  });
  return parts;
}

function percentageOf(totalCents, percent) {
  return Math.round((Number(totalCents) * Number(percent)) / 100);
}

/* ------------------------------------------------------------------ *
 * Validation helpers used across the marketplace
 * ------------------------------------------------------------------ */

const SA_MOBILE_REGEX = /^(?:\+27|0)(?:6|7|8)\d{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeMobile(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (!SA_MOBILE_REGEX.test(digits)) return null;
  const national = digits.startsWith('+27') ? `0${digits.slice(3)}` : digits;
  return national.length === 10 ? national : null;
}

function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_REGEX.test(email) ? email : null;
}

/** Haversine distance in kilometres. */
function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function weightedPick(items, weightFn, random = Math.random) {
  const total = items.reduce((sum, item) => sum + Math.max(0, weightFn(item)), 0);
  if (total <= 0) return null;
  let threshold = random() * total;
  for (const item of items) {
    threshold -= Math.max(0, weightFn(item));
    if (threshold <= 0) return item;
  }
  return items.at(-1);
}

function requireFields(object, fields, label = 'input') {
  for (const field of fields) {
    const value = getPath(object || {}, field);
    if (value === undefined || value === null || value === '') {
      throw new Error(`${label}.${field} is required`);
    }
  }
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((pct / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index];
}

module.exports = {
  SA_TIMEZONE,
  CURRENCY,
  PREFIXES,
  nowIso,
  nowMs,
  addMinutes,
  addDays,
  isPast,
  saDate,
  saTime,
  nextId,
  idFor,
  canonicalize,
  sha256,
  fingerprint,
  deepClone,
  getPath,
  setPath,
  flattenPatch,
  assertCents,
  randToCents,
  centsToRand,
  formatZar,
  splitAmount,
  percentageOf,
  normalizeMobile,
  normalizeEmail,
  distanceKm,
  clamp,
  weightedPick,
  requireFields,
  uniqueBy,
  median,
  percentile,
};
