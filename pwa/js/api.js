/* ==========================================================================
   Lula ProVeri PWA — API client
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
  }

  class ApiError extends Error {
    constructor(status, payload) {
      super(payload?.message || `Request failed (${status})`);
      this.status = status;
      this.payload = payload;
      this.policyDecision = payload?.policyDecision || null;
      this.details = payload?.details || null;
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
      throw new ApiError(0, { message: navigator.onLine ? 'Network error' : 'You are offline — the change is saved on this device and will sync when you reconnect.', offline: true });
    }

    if (response.status === 204) return null;
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

    if (!response.ok) throw new ApiError(response.status, payload);
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
      const [snapshot, bundle] = await Promise.allSettled([
        request('/api/snapshot'),
        request('/api/offline-bundle'),
      ]);
      if (snapshot.status === 'fulfilled') state.snapshot = snapshot.value;
      if (bundle.status === 'fulfilled') state.bundle = bundle.value;
      state.integrationMode = bundle.status === 'fulfilled' ? bundle.value.integrations?.[0] : null;
      return state;
    },

    /** The offline bundle is the source of truth for the catalogue when offline. */
    bundleOrFresh() {
      return state.bundle;
    },

    session: () => state.session,
    setSession: writeSession,
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
