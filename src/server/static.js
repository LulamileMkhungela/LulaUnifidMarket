'use strict';

/**
 * ProVeri — Static file server for the PWA.
 *
 * Serves `pwa/` from a single origin with the API, so the front end can use
 * relative URLs and be proxied anywhere (including the Arena live preview host)
 * without CORS or origin allowlist pain.
 *
 * Security defaults: no directory traversal, no dotfiles, explicit MIME map,
 * ETag revalidation, and the service worker served with `no-cache` so a new
 * deploy is never stranded behind an old one.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
});

class StaticServer {
  constructor({ root, index = 'index.html' }) {
    this.root = path.resolve(root);
    this.index = index;
  }

  #resolve(urlPath) {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const relative = decoded.replace(/^\/+/, '');
    const target = path.resolve(this.root, relative);
    // Traversal guard: the resolved path must stay inside the root.
    if (target !== this.root && !target.startsWith(this.root + path.sep)) return null;
    if (path.basename(target).startsWith('.')) return null;
    return target;
  }

  canServe(urlPath) {
    const target = this.#resolve(urlPath);
    if (!target) return false;
    return fs.existsSync(target) && fs.statSync(target).isFile();
  }

  /**
   * @returns {{status:number, headers:object, body?:Buffer}|null}
   */
  serve(urlPath, { ifNoneMatch, method = 'GET' } = {}) {
    let target = this.#resolve(urlPath);
    if (!target) return { status: 403, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Forbidden') };

    if (!fs.existsSync(target)) {
      // SPA/PWA fallback: unknown non-asset paths render the app shell so the
      // client-side router can handle deep links like /bookings/bkg_123.
      if (path.extname(target) === '') {
        target = path.join(this.root, this.index);
      }
      if (!fs.existsSync(target)) return null;
    }

    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      target = path.join(target, this.index);
      if (!fs.existsSync(target)) return null;
    }

    const body = fs.readFileSync(target);
    const etag = `"${crypto.createHash('sha1').update(body).digest('base64').slice(0, 22)}"`;
    const ext = path.extname(target).toLowerCase();
    const isServiceWorker = path.basename(target) === 'sw.js';
    const isManifest = ext === '.webmanifest';

    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(body.length),
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      // The service worker must never be cached, or a new release cannot ship.
      'Cache-Control': isServiceWorker || isManifest
        ? 'no-cache, must-revalidate'
        : ext === '.html'
          ? 'no-cache'
          : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
    };

    if (ifNoneMatch === etag) return { status: 304, headers: { ETag: etag, 'Cache-Control': headers['Cache-Control'] } };
    if (method === 'HEAD') return { status: 200, headers: { ...headers, 'Content-Length': '0' } };
    return { status: 200, headers, body };
  }
}

module.exports = { StaticServer, MIME };
