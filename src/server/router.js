'use strict';

/**
 * ProVeri — Zero-dependency HTTP router.
 *
 * Path templates (`/api/jobs/:jobId/bids`), method matching, JSON body parsing
 * with a size cap, per-route error handling that never leaks a stack trace to a
 * client, and a simple OpenAPI-flavoured route registry so `GET /api/openapi.json`
 * can be generated from the routes that actually exist.
 */

const { nextId, nowIso } = require('../kernel/util');

// Room for a handful of phone photos (the PWA shrinks each to ~450 KB before upload).
const MAX_BODY_BYTES = 8 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = (message = 'Authentication required') => new HttpError(401, message);
const forbidden = (message = 'Not permitted') => new HttpError(403, message);
const notFound = (message = 'Not found') => new HttpError(404, message);
const conflict = (message, details) => new HttpError(409, message, details);

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, meta = {}) {
    const keys = [];
    const regexSource = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        if (segment.startsWith('*')) {
          keys.push(segment.slice(1) || 'wildcard');
          return '(.*)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');

    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      regex: new RegExp(`^${regexSource}/?$`),
      keys,
      handler,
      meta: { tags: [], summary: null, auth: false, ...meta },
    });
    return this;
  }

  get(pattern, handler, meta) { return this.add('GET', pattern, handler, meta); }
  post(pattern, handler, meta) { return this.add('POST', pattern, handler, meta); }
  patch(pattern, handler, meta) { return this.add('PATCH', pattern, handler, meta); }
  put(pattern, handler, meta) { return this.add('PUT', pattern, handler, meta); }
  delete(pattern, handler, meta) { return this.add('DELETE', pattern, handler, meta); }

  match(method, pathname) {
    let pathExists = false;
    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      pathExists = true;
      if (route.method !== method.toUpperCase()) continue;
      const params = {};
      route.keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1] || ''); });
      return { route, params };
    }
    if (pathExists) throw new HttpError(405, `${method} is not allowed on ${pathname}`);
    return null;
  }

  /** Read and JSON-parse a request body with a hard size cap. */
  static async readBody(req) {
    if (['GET', 'HEAD', 'DELETE'].includes(req.method)) return {};
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    const raw = Buffer.concat(chunks).toString('utf8');
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(raw));
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw badRequest('Request body is not valid JSON');
    }
  }

  /** OpenAPI 3.1 document generated from the registered routes. */
  openapi({ title, version, description }) {
    const paths = {};
    for (const route of this.routes) {
      const openApiPath = route.pattern.replace(/:(\w+)/g, '{$1}');
      paths[openApiPath] = paths[openApiPath] || {};
      const parameters = route.keys.map((key) => ({
        name: key,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      paths[openApiPath][route.method.toLowerCase()] = {
        tags: route.meta.tags,
        summary: route.meta.summary || `${route.method} ${route.pattern}`,
        operationId: `${route.method.toLowerCase()}${route.pattern.replace(/[/:*]/g, '_')}`,
        parameters,
        ...(route.method === 'GET' || route.method === 'DELETE' ? {} : {
          requestBody: {
            required: false,
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
        }),
        responses: {
          200: { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } },
          400: { description: 'Bad request' },
          404: { description: 'Not found' },
          409: { description: 'Policy or state conflict' },
        },
        security: route.meta.auth ? [{ bearerAuth: [] }] : [],
      };
    }
    return {
      openapi: '3.1.0',
      info: {
        title,
        version,
        description,
        contact: { name: 'ProVeri', url: 'https://lulaproveri.co.za' },
        license: { name: 'Proprietary' },
      },
      servers: [{ url: '/', description: 'This deployment' }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      tags: [...new Set(this.routes.flatMap((r) => r.meta.tags))].map((name) => ({ name })),
      paths,
      generatedAt: nowIso(),
      routeCount: this.routes.length,
    };
  }
}

module.exports = { Router, HttpError, badRequest, unauthorized, forbidden, notFound, conflict, MAX_BODY_BYTES, requestId: () => nextId('req') };
