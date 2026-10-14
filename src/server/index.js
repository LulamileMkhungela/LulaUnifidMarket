'use strict';

/**
 * ProVeri — Server bootstrap.
 *
 * Zero runtime dependencies: node:http serves the REST API and the PWA from a
 * single origin, so the front end can use relative URLs and be proxied anywhere
 * (including the Arena live-preview host) without CORS or origin-allowlist pain.
 *
 *   HOST=0.0.0.0  PORT=4173  npm start
 *   PROVERI_INTEGRATION_MODE=live   → call the real public APIs
 *   PROVERI_INTEGRATION_MODE=offline→ deterministic fallbacks (default in CI)
 *   PROVERI_PERSIST=1               → snapshot the store to data/.store.json
 */

const http = require('node:http');
const path = require('node:path');
const { Marketplace } = require('../marketplace');
const { seed } = require('../marketplace/seed');
const { buildApiRoutes } = require('./routes/api');
const { StaticServer } = require('./static');
const { HttpError } = require('./router');
const { nowIso } = require('../kernel/util');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 4173);
const ROOT = path.join(__dirname, '..', '..');
const PWA_ROOT = path.join(ROOT, 'pwa');

const startedAt = nowIso();

function log(...args) {
  process.stdout.write(`[proveri] ${args.join(' ')}\n`);
}

async function boot() {
  const marketplace = new Marketplace({ persist: process.env.PROVERI_PERSIST === '1' });

  if (process.env.PROVERI_PERSIST === '1') {
    const loaded = marketplace.store.load();
    if (!loaded.loaded) {
      log('no snapshot found — seeding a fresh marketplace');
      await seed(marketplace);
    } else {
      log(`restored snapshot (${loaded.file})`);
    }
  } else {
    log('seeding the demo marketplace…');
    const result = await seed(marketplace);
    log(`seeded ${result.pros} verified pros · ${result.customers} customers · ${result.jobs} jobs · ${result.bids} bids · ${result.bookings} bookings · ${result.reviews} reviews`);
    log(`ledger: ${result.ledgerEntries} entries, chain valid=${result.chainValid}, receipt=${result.integrityReceipt.slice(0, 16)}…`);
  }

  const router = buildApiRoutes({ marketplace });
  const staticServer = new StaticServer({ root: PWA_ROOT });
  marketplace.startScheduler({ intervalMs: Number(process.env.PROVERI_SCHEDULER_MS || 60_000) });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const send = (status, body, headers = {}) => {
      const payload = body === undefined || body === null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, process.env.PROVERI_PRETTY_JSON ? 2 : 0));
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload ? String(payload.length) : '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-ProVeri-User',
        'X-Request-Id': correlationId,
        'X-Content-Type-Options': 'nosniff',
        ...headers,
      });
      res.end(payload || undefined);
    };

    try {
      if (req.method === 'OPTIONS') return send(204, null);

      /* ---------------- API ---------------- */
      if (pathname.startsWith('/api/')) {
        const match = router.match(req.method, pathname);
        if (!match) return send(404, { error: 'NOT_FOUND', message: `No API route for ${req.method} ${pathname}`, correlationId });

        const body = await require('./router').Router.readBody(req);
        const query = Object.fromEntries(url.searchParams.entries());
        const ctx = { req, res, params: match.params, query, body, headers: req.headers, marketplace, correlationId };

        const t0 = Date.now();
        const result = await match.route.handler(ctx);
        const durationMs = Date.now() - t0;
        log(`${req.method} ${pathname} → 200 (${durationMs}ms)`);
        return send(result === undefined ? 204 : 200, result);
      }

      /* ---------------- generated pro microsites ---------------- */
      const microsite = /^\/p\/([a-z0-9-]+)\/?$/.exec(pathname);
      if (microsite) {
        const pro = marketplace.store.findOne('pros', (p) => p.slug === microsite[1]);
        if (!pro) return send(404, { error: 'NOT_FOUND', message: `No ProVeri pro at /p/${microsite[1]}` });
        const html = marketplace.webStudio.renderMicrositeHtml(pro.proId);
        if (!html) return send(404, { error: 'NOT_FOUND', message: 'This pro has no published microsite yet — it unlocks when verification passes' });
        return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).end(html);
      }

      /* ---------------- generated business sites (studio) ---------------- */
      const sendHtml = (html, { download = null } = {}) => {
        const body = Buffer.from(html);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(body.length),
          'Cache-Control': 'no-cache',
          'X-Request-Id': correlationId,
          ...(download ? { 'Content-Disposition': `attachment; filename="${download}"` } : {}),
        });
        res.end(body);
      };

      if (pathname === '/sites' || pathname === '/sites/') {
        return sendHtml(marketplace.businessSites.renderSitesIndexHtml());
      }

      const liveSite = /^\/s\/([a-z0-9-]+)\/?$/.exec(pathname);
      if (liveSite) {
        const site = marketplace.store.findOne('businessSites', (s) => s.slug === liveSite[1]);
        if (!site) return send(404, { error: 'NOT_FOUND', message: `No business site at /s/${liveSite[1]}` });
        if (site.status !== 'LIVE') {
          return send(404, {
            error: 'NOT_PUBLISHED',
            message: `${site.name} is not published yet (status ${site.status}).`,
            previewUrl: `/preview/${site.slug}`,
            reason: site.status === 'BLOCKED' ? 'Publishing is blocked until every asset has a permission record — policy WEB-002.' : null,
          });
        }
        site.stats.views += 1;
        return sendHtml(marketplace.businessSites.renderSiteHtml(site.siteId));
      }

      const previewSite = /^\/preview\/([a-z0-9-]+)\/?$/.exec(pathname);
      if (previewSite) {
        const site = marketplace.store.findOne('businessSites', (s) => s.slug === previewSite[1]);
        if (!site) return send(404, { error: 'NOT_FOUND', message: `No business site at /preview/${previewSite[1]}` });
        return sendHtml(marketplace.businessSites.renderSiteHtml(site.siteId, { preview: true }));
      }

      const exportSite = /^\/export\/([a-z0-9-]+)\/?$/.exec(pathname);
      if (exportSite) {
        const site = marketplace.store.findOne('businessSites', (s) => s.slug === exportSite[1]);
        if (!site) return send(404, { error: 'NOT_FOUND', message: `No business site at /export/${exportSite[1]}` });
        const exported = marketplace.businessSites.exportSite(site.siteId);
        log(`export ${site.slug} → ${(exported.bytes / 1024).toFixed(1)} KB`);
        return sendHtml(exported.html, { download: exported.filename });
      }

      if (pathname === '/robots.txt') {
        return send(200, 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (pathname === '/sitemap.xml') {
        const pros = marketplace.store.all('pros').filter((p) => p.canBid);
        const body = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          '<url><loc>/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>',
          '<url><loc>/find-a-pro</loc><priority>0.9</priority></url>',
          '<url><loc>/vehicles</loc><priority>0.8</priority></url>',
          '<url><loc>/web-studio</loc><priority>0.8</priority></url>',
          '<url><loc>/business-studio</loc><priority>0.8</priority></url>',
          '<url><loc>/sites</loc><priority>0.7</priority></url>',
          ...marketplace.store.all('businessSites').filter((s) => s.status === 'LIVE').map((s) => `<url><loc>/s/${s.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
          '<url><loc>/trust</loc><priority>0.7</priority></url>',
          ...pros.map((p) => `<url><loc>/p/${p.slug}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>`),
          '</urlset>'].join('\n');
        return send(200, body, { 'Content-Type': 'application/xml; charset=utf-8' });
      }

      /* ---------------- PWA ---------------- */
      const served = staticServer.serve(pathname, { ifNoneMatch: req.headers['if-none-match'], method: req.method });
      if (!served) return send(404, { error: 'NOT_FOUND', message: `${pathname} was not found` });
      res.writeHead(served.status, served.headers);
      return res.end(served.body || undefined);
    } catch (error) {
      if (error instanceof HttpError) {
        log(`${req.method} ${pathname} → ${error.status} ${error.message}`);
        return send(error.status, {
          error: error.status === 409 ? 'POLICY_OR_STATE_CONFLICT' : 'REQUEST_FAILED',
          message: error.message,
          details: error.details || error.decision?.firedRules || null,
          policyDecision: error.decision?.decision || null,
          correlationId,
        });
      }
      // A policy refusal is a conflict the client can act on — never a 500, and
      // always carrying the decision so the UI can explain itself.
      if (error.decision || error.code === 'BLOCKED') {
        log(`${req.method} ${pathname} → 409 ${error.message}`);
        return send(409, {
          error: 'POLICY_OR_STATE_CONFLICT',
          message: error.message,
          details: error.decision?.firedRules || null,
          policyDecision: error.decision?.decision || null,
          code: error.code || null,
          correlationId,
        });
      }
      // Ownership failures are 403s: you are signed in, this just is not yours.
      if (error.code === 'FORBIDDEN') {
        log(`${req.method} ${pathname} → 403 ${error.message}`);
        return send(403, { error: 'FORBIDDEN', message: error.message, correlationId });
      }
      // "x not found" is a 404: the client asked for a thing that does not exist.
      if (/not found/i.test(error.message || '')) {
        log(`${req.method} ${pathname} → 404 ${error.message}`);
        return send(404, { error: 'NOT_FOUND', message: error.message, correlationId });
      }
      const isKnown = /is required|must be|cannot|invalid|unknown|already|exceeds|Too many/i.test(error.message || '');
      log(`${req.method} ${pathname} → ${isKnown ? 400 : 500} ${error.message}`);
      return send(isKnown ? 400 : 500, {
        error: isKnown ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
        message: error.message,
        correlationId,
        ...(isKnown ? {} : { note: 'Correlation id supplied for the support desk. Stack traces are never sent to clients.' }),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });

  {
    const address = server.address();
    log('');
    log('  ProVeri — verified services marketplace');
    log(`  API + PWA   http://${HOST}:${address.port}`);
    log(`  Preview     http://localhost:${address.port}`);
    log(`  OpenAPI     http://localhost:${address.port}/api/openapi.json`);
    log(`  Trust       http://localhost:${address.port}/trust`);
    log(`  Admin       http://localhost:${address.port}/admin`);
    log(`  Studio      http://localhost:${address.port}/business-studio`);
    log(`  Sites       http://localhost:${address.port}/sites`);
    log(`  Sales desk  http://localhost:${address.port}/sales-desk`);
    log('');
    log(`  integrations: ${require('../integrations').MODE} · configured partners: ${JSON.stringify(require('../integrations').configuredPartners())}`);
    log(`  verticals: ${marketplace.verticals().map((v) => `${v.id}=${v.status}`).join(' ')}`);
    log(`  started: ${startedAt}`);
    log('');
  }

  const shutdown = (signal) => {
    log(`${signal} received — shutting down`);
    marketplace.stopScheduler();
    if (process.env.PROVERI_PERSIST === '1') {
      const saved = marketplace.store.save();
      log(`store snapshot: ${JSON.stringify(saved)}`);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { server, marketplace };
}

if (require.main === module) {
  boot().catch((error) => {
    process.stderr.write(`[proveri] fatal: ${error.stack}\n`);
    process.exit(1);
  });
}

module.exports = { boot };
