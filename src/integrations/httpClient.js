'use strict';

/**
 * ProVeri — HTTP client for public data sources.
 *
 * Node 22 has global fetch, so this stays dependency-free. It adds what the
 * public APIs actually need in production:
 *   - hard timeouts (Nominatim and SAQA can hang)
 *   - bounded retries with jitter for idempotent GETs only
 *   - a shared in-memory TTL cache (free-tier APIs are rate limited)
 *   - a mandatory User-Agent where the provider requires one (OSM policy)
 *   - an "offline" latch so the demo, tests and sandboxed previews behave
 *     deterministically instead of throwing on the first network blip
 */

const { sha256 } = require('../kernel/util');

const DEFAULT_TIMEOUT_MS = 6000;
const USER_AGENT = 'LulaProVeri/1.0 (https://lulaproveri.co.za; integration@lulaproveri.co.za) Node/22';

/**
 * Network posture.
 *
 * 'live'    — call the real public APIs.
 * 'offline' — short-circuit straight to each adapter's deterministic fallback.
 *
 * Default is 'live' in production. Development, CI, tests and sandboxed previews
 * should set PROVERI_INTEGRATION_MODE=offline: it makes startup instant, results
 * reproducible, and stops free-tier rate limits being burned by a dev loop.
 * Adapters still report `live: false` and a `reason`, so the UI is always honest
 * about which numbers came from the network and which came from the bundle.
 */
function networkMode() {
  return process.env.PROVERI_INTEGRATION_MODE === 'offline' ? 'offline' : 'live';
}

function isOffline() {
  return networkMode() === 'offline';
}

const cache = new Map();
const stats = {
  requests: 0,
  cacheHits: 0,
  failures: 0,
  skippedOffline: 0,
  byHost: {},
};

class HttpError extends Error {
  constructor(message, { status, host, url, cause }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.host = host;
    this.url = url;
    this.cause = cause;
  }
}

function cacheKey(url, options) {
  return sha256(`${url}:${JSON.stringify(options?.headers || {})}:${options?.body || ''}`);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.cacheTtlMs]     0 disables caching
 * @param {number} [options.retries]        GET only
 * @param {object} [options.headers]
 * @param {*}      [options.json]           request body
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok:boolean, status:number, data:*, fromCache:boolean, durationMs:number}>}
 */
async function request(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheTtlMs = 5 * 60 * 1000,
    retries = 1,
    headers = {},
    json,
    signal,
  } = options;

  const host = hostOf(url);

  if (isOffline() && !options.forceLive) {
    stats.skippedOffline += 1;
    return {
      ok: false,
      status: 0,
      data: null,
      fromCache: false,
      durationMs: 0,
      host,
      offline: true,
      error: 'network disabled (PROVERI_INTEGRATION_MODE=offline) — adapter fallback used',
    };
  }

  stats.requests += 1;
  stats.byHost[host] = (stats.byHost[host] || 0) + 1;

  const key = cacheKey(url, options);
  if (cacheTtlMs > 0) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      stats.cacheHits += 1;
      return { ok: true, status: hit.status, data: hit.data, fromCache: true, durationMs: 0, host };
    }
  }

  const method = json ? 'POST' : 'GET';
  const started = Date.now();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
          ...(json ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: json ? JSON.stringify(json) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        lastError = new HttpError(`${host} responded ${response.status}`, { status: response.status, host, url });
        if (response.status >= 500 && attempt < retries && method === 'GET') {
          await sleep(250 * (attempt + 1) + Math.random() * 150);
          continue;
        }
        stats.failures += 1;
        return { ok: false, status: response.status, data, fromCache: false, durationMs: Date.now() - started, host, error: lastError.message };
      }

      if (cacheTtlMs > 0) {
        cache.set(key, { status: response.status, data, expiresAt: Date.now() + cacheTtlMs });
        if (cache.size > 500) {
          const oldest = cache.keys().next().value;
          cache.delete(oldest);
        }
      }
      return { ok: true, status: response.status, data, fromCache: false, durationMs: Date.now() - started, host };
    } catch (error) {
      lastError = error;
      if (attempt < retries && method === 'GET') {
        await sleep(200 * (attempt + 1) + Math.random() * 120);
        continue;
      }
      stats.failures += 1;
      return {
        ok: false,
        status: 0,
        data: null,
        fromCache: false,
        durationMs: Date.now() - started,
        host,
        error: error?.message || String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  stats.failures += 1;
  return { ok: false, status: 0, data: null, fromCache: false, durationMs: Date.now() - started, host, error: lastError?.message };
}

function clearCache() {
  cache.clear();
}

function getStats() {
  return {
    mode: networkMode(),
    ...stats,
    cacheSize: cache.size,
    cacheHitRate: stats.requests ? Math.round((stats.cacheHits / stats.requests) * 100) : 0,
  };
}

module.exports = { request, HttpError, clearCache, getStats, networkMode, isOffline, USER_AGENT };
