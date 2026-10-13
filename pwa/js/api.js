/* ==========================================================================
   ProVeri PWA — API client
   Relative URLs only: the app is served from the same origin as the API, so it
   works on any host (localhost, the Arena preview host, a future domain) with
   no configuration and no CORS.
   ========================================================================== */

window.ProVeri = window.ProVeri || {};

(function () {
  'use strict';

  const state = {
    online: navigator.onLine,
    integrationMode: null,
    snapshot: null,
    bundle: null,
    cloud: null,
    session: readSession(),
    queuedMutations: 0,
  };

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem('proveri.session') || 'null');
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    state.session = session;
    if (session) localStorage.setItem('proveri.session', JSON.stringify(session));
    else localStorage.removeItem('proveri.session');
    // The header, tab badges and home screen all depend on who is signed in.
    try { window.dispatchEvent(new CustomEvent('proveri:session', { detail: { session } })); } catch { /* no window events */ }
  }

  class ApiError extends Error {
    constructor(status, payload) {
      super(payload?.message || `Request failed (${status})`);
      this.status = status;
      this.payload = payload;
      this.policyDecision = payload?.policyDecision || null;
      this.details = payload?.details || null;
      this.queued = Boolean(payload?.queued);
    }
  }

  async function request(path, { method = 'GET', body, signal } = {}) {
    const options = { method, headers: {}, signal };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    if (state.session?.userId) options.headers['X-ProVeri-User'] = state.session.userId;

    let response;
    try {
      response = await fetch(path, options);
    } catch (networkError) {
      if (method !== 'GET') {
        state.queuedMutations += 1;
        window.dispatchEvent(new CustomEvent('proveri:offline-queue', { detail: { count: state.queuedMutations } }));
      }
      throw new ApiError(0, { message: navigator.onLine ? 'Could not reach ProVeri — check your connection and try again.' : 'You are offline. Reconnect and try again.', offline: true });
    }

    if (response.status === 204) return null;
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

    if (!response.ok) throw new ApiError(response.status, payload);
    // The service worker answers 202 + queued when a write was saved for later.
    // That is not the created thing the screen asked for, so say so plainly.
    if (response.status === 202 && payload && payload.queued) {
      throw new ApiError(0, { message: 'You are offline — saved on this phone and it will send by itself when you reconnect.', offline: true, queued: true });
    }
    return payload;
  }

  const api = {
    state,
    ApiError,
    writeSession,
    readSession,
    get: (path, signal) => request(path, { signal }),
    post: (path, body) => request(path, { method: 'POST', body: body || {} }),
    patch: (path, body) => request(path, { method: 'PATCH', body: body || {} }),
    del: (path) => request(path, { method: 'DELETE' }),

    async boot() {
      const [snapshot, bundle, cloud] = await Promise.allSettled([
        request('/api/snapshot'),
        request('/api/offline-bundle'),
        request('/api/cloud-config'),
      ]);
      if (snapshot.status === 'fulfilled') state.snapshot = snapshot.value;
      if (bundle.status === 'fulfilled') state.bundle = bundle.value;
      if (cloud.status === 'fulfilled') state.cloud = cloud.value;
      state.integrationMode = bundle.status === 'fulfilled' ? bundle.value.integrations?.[0] : null;
      return state;
    },

    /** Firebase + Supabase client config, as served by /api/cloud-config. */
    cloud: () => state.cloud,

    /**
     * A phone photo → the project's Supabase "photos" bucket, straight from
     * the browser. Returns the public URL, or null when the cloud cannot be
     * reached — callers then keep the compressed data URL for this session.
     */
    async uploadPhoto(dataUrl, folder = 'uploads') {
      const cfg = state.cloud && state.cloud.supabase;
      if (!cfg || !cfg.url || state.cloud.online === false) return null;
      try {
        const comma = String(dataUrl).indexOf(',');
        const meta = String(dataUrl).slice(0, comma);
        const type = /:(.*?);/.exec(meta)?.[1] || 'image/jpeg';
        const bytes = Uint8Array.from(atob(String(dataUrl).slice(comma + 1)), (c) => c.charCodeAt(0));
        const who = state.session ? state.session.userId : 'anon';
        const path = `${folder}/${who}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const response = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
          method: 'POST',
          headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, 'Content-Type': type, 'x-upsert': 'true' },
          body: bytes,
        });
        if (!response.ok) return null;
        return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${path}`;
      } catch {
        return null;
      }
    },

    /** The offline bundle is the source of truth for the catalogue when offline. */
    bundleOrFresh() {
      return state.bundle;
    },

    session: () => state.session,
    setSession: writeSession,
    signOut: () => writeSession(null),
    isPro: () => state.session?.role === 'PRO',
    isCustomer: () => Boolean(state.session) && state.session.role !== 'PRO',
  };

  window.ProVeri.api = api;

  window.addEventListener('online', () => {
    state.online = true;
    window.dispatchEvent(new CustomEvent('proveri:connectivity', { detail: { online: true } }));
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'REPLAY_QUEUE' });
    }
  });
  window.addEventListener('offline', () => {
    state.online = false;
    window.dispatchEvent(new CustomEvent('proveri:connectivity', { detail: { online: false } }));
  });
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'QUEUE_REPLAYED') {
        state.queuedMutations = 0;
        window.dispatchEvent(new CustomEvent('proveri:queue-replayed', { detail: event.data.results }));
      }
    });
  }
})();
