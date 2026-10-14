'use strict';

/**
 * ProVeri cloud adapters — Firebase Auth + Supabase, with zero dependencies.
 *
 * The repo rule is one Node process, no node_modules and no build step, so the
 * two clouds are spoken to over their public REST surfaces with plain fetch:
 *
 *   Firebase Auth  — identitytoolkit.googleapis.com  (email sign-up/sign-in,
 *                    ID-token verification for the browser's Google popup)
 *   Supabase       — <project>.supabase.co/rest/v1    (PostgREST: posts)
 *                    <project>.supabase.co/storage/v1 (the "photos" bucket)
 *
 * Every call degrades honestly: when a cloud cannot be reached (air-gapped
 * dev machine, CI, the unit suite) `online` flips false and the marketplace
 * falls back to its sealed local store — the same honest-simulation rule every
 * other integration in this build follows. Nothing ever pretends to have
 * written to a cloud it could not reach; the ledger records the miss.
 *
 * Configuration: environment variables override the baked-in demo project.
 * Both the VITE_* names (the keys are public client keys, safe to ship) and
 * plain names are accepted.
 */

const env = process.env;

const CONFIG = {
  firebase: {
    apiKey: env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY || 'AIzaSyAn_rXPhvO0MZvpFhkycbIqM-qkv4rHPi8',
    authDomain: env.FIREBASE_AUTH_DOMAIN || env.VITE_FIREBASE_AUTH_DOMAIN || 'lulafinds-app.firebaseapp.com',
    projectId: env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || 'lulafinds-app',
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || env.VITE_FIREBASE_MESSAGING_SENDER_ID || '359295927708',
    appId: env.FIREBASE_APP_ID || env.VITE_FIREBASE_APP_ID || '',
  },
  supabase: {
    url: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'https://srwdtguxdjsjlkaydhet.supabase.co').replace(/\/$/, ''),
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3',
    bucket: env.SUPABASE_BUCKET || env.VITE_SUPABASE_BUCKET || 'photos',
  },
};

const IDENTITY = `https://identitytoolkit.googleapis.com/v1`;
const PROBE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 6_000;

const offlineByEnv = () => String(env.PROVERI_INTEGRATION_MODE || '').toLowerCase() === 'offline';

async function timed(fetchPromise, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchPromise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

class CloudService {
  constructor({ kernel } = {}) {
    this.kernel = kernel || null;
    this.state = { online: null, checkedAt: 0, detail: null };
  }

  get config() {
    return CONFIG;
  }

  /** What the browser needs: public client keys only. */
  clientConfig() {
    return {
      firebase: { ...CONFIG.firebase },
      supabase: { url: CONFIG.supabase.url, anonKey: CONFIG.supabase.anonKey, bucket: CONFIG.supabase.bucket },
      online: this.state.online === true,
    };
  }

  /* ---------------- reachability ---------------- */

  async health({ force = false } = {}) {
    if (offlineByEnv()) {
      this.state = { online: false, checkedAt: Date.now(), detail: 'PROVERI_INTEGRATION_MODE=offline' };
      return this.state;
    }
    if (!force && this.state.online !== null && Date.now() - this.state.checkedAt < PROBE_TTL_MS) return this.state;
    try {
      const response = await timed((signal) => fetch(
        `${IDENTITY}/projects?key=${encodeURIComponent(CONFIG.firebase.apiKey)}`,
        { signal },
      ), 4000);
      const ok = response.ok;
      this.state = { online: ok, checkedAt: Date.now(), detail: ok ? 'firebase reachable' : `firebase ${response.status}` };
      if (ok) {
        // Supabase is the second half; probe it too so mirrors know the truth.
        try {
          const sb = await timed((signal) => fetch(`${CONFIG.supabase.url}/rest/v1/`, {
            headers: { apikey: CONFIG.supabase.anonKey },
            signal,
          }), 4000);
          this.state.supabase = sb.ok || sb.status === 404; // 404 on root still means the host answered
        } catch {
          this.state.supabase = false;
        }
      }
    } catch (error) {
      this.state = { online: false, checkedAt: Date.now(), detail: String(error.message || error).slice(0, 120) };
    }
    return this.state;
  }

  /* ---------------- Firebase Auth (REST) ---------------- */

  async firebaseSignUp({ email, password }) {
    const response = await timed((signal) => fetch(`${IDENTITY}/accounts:signUp?key=${encodeURIComponent(CONFIG.firebase.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal,
    }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(firebaseMessage(body, 'Sign-up refused'));
    return { uid: body.localId, idToken: body.idToken, email: body.email };
  }

  async firebaseSignInWithEmail({ email, password }) {
    const response = await timed((signal) => fetch(`${IDENTITY}/accounts:signInWithPassword?key=${encodeURIComponent(CONFIG.firebase.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal,
    }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(firebaseMessage(body, 'Sign-in refused'));
    return { uid: body.localId, idToken: body.idToken, email: body.email };
  }

  /** Verify a browser-issued Firebase ID token (email session or Google popup). */
  async firebaseLookup(idToken) {
    const response = await timed((signal) => fetch(`${IDENTITY}/accounts:lookup?key=${encodeURIComponent(CONFIG.firebase.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal,
    }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.users || !body.users[0]) throw new Error(firebaseMessage(body, 'That sign-in token is not valid'));
    const user = body.users[0];
    return {
      uid: user.localId,
      email: user.email || null,
      name: user.displayName || (user.email ? user.email.split('@')[0] : null),
      photoUrl: user.photoUrl || null,
      provider: (user.providerUserInfo || [])[0]?.providerId || 'password',
      emailVerified: Boolean(user.emailVerified),
    };
  }

  /* ---------------- Supabase (PostgREST + Storage) ---------------- */

  supabaseHeaders({ auth } = {}) {
    return {
      apikey: CONFIG.supabase.anonKey,
      Authorization: `Bearer ${auth || CONFIG.supabase.anonKey}`,
    };
  }

  /** Insert one row; returns the row or throws. Never silent. */
  async supabaseInsert(table, row) {
    const response = await timed((signal) => fetch(`${CONFIG.supabase.url}/rest/v1/${table}?columns=${Object.keys(row).join(',')}`, {
      method: 'POST',
      headers: { ...this.supabaseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify([row]),
      signal,
    }));
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`supabase ${table}: ${response.status} ${JSON.stringify(body || {}).slice(0, 160)}`);
    return Array.isArray(body) ? body[0] : body;
  }

  async supabaseSelect(table, query = 'select=*&order=created_at.desc&limit=50') {
    const response = await timed((signal) => fetch(`${CONFIG.supabase.url}/rest/v1/${table}?${query}`, {
      headers: this.supabaseHeaders(),
      signal,
    }));
    if (!response.ok) throw new Error(`supabase ${table}: ${response.status}`);
    return response.json();
  }

  /**
   * Photo bytes → the public bucket. `path` must already be namespaced by the
   * caller (e.g. `jobs/<userId>/<id>.jpg`). Returns the public URL.
   */
  async supabaseUploadPhoto(path, buffer, contentType = 'image/jpeg') {
    const clean = String(path).replace(/^\/+/, '');
    const response = await timed((signal) => fetch(`${CONFIG.supabase.url}/storage/v1/object/${CONFIG.supabase.bucket}/${clean}`, {
      method: 'POST',
      headers: { ...this.supabaseHeaders(), 'Content-Type': contentType, 'x-upsert': 'true' },
      body: buffer,
      signal,
    }));
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(`supabase storage: ${response.status} ${JSON.stringify(body || {}).slice(0, 160)}`);
    }
    return `${CONFIG.supabase.url}/storage/v1/object/public/${CONFIG.supabase.bucket}/${clean}`;
  }

  supabasePublicUrl(path) {
    return `${CONFIG.supabase.url}/storage/v1/object/public/${CONFIG.supabase.bucket}/${String(path).replace(/^\/+/, '')}`;
  }

  /* ---------------- posting, for real ---------------- */

  /**
   * Mirror a marketplace post (job or published work) into Supabase so it
   * outlives this process. Fire-and-forget by contract: callers must not fail
   * a local post because a cloud hiccuped — the ledger keeps the receipt.
   */
  async mirrorPost(post, { ledger, subject } = {}) {
    const note = (action, ok, detail) => {
      if (!ledger) return;
      ledger.append({
        action,
        subject: subject || post.id,
        visibility: 'PRIVATE',
        payload: { summary: `${ok ? 'Mirrored to Supabase' : `Supabase mirror skipped: ${detail}`} — ${post.kind} ${post.id}`, detail: detail || null },
      });
    };
    const health = await this.health();
    if (!health.online || health.supabase === false) {
      note('CLOUD_MIRROR_SKIPPED', false, health.detail || 'supabase unreachable');
      return { mirrored: false, reason: health.detail || 'supabase unreachable' };
    }
    try {
      const row = await this.supabaseInsert('posts', {
        id: post.id,
        kind: post.kind,
        reference: post.reference || null,
        author_uid: post.authorUid || null,
        author_name: post.authorName || null,
        title: post.title || null,
        description: post.description || null,
        category_id: post.categoryId || null,
        category_label: post.categoryLabel || null,
        suburb: post.suburb || null,
        metro: post.metro || null,
        price_cents: post.priceCents ?? null,
        photos: post.photos || [],
        created_at: post.createdAt || new Date().toISOString(),
      });
      note('CLOUD_MIRROR_WRITTEN', true);
      return { mirrored: true, row };
    } catch (error) {
      note('CLOUD_MIRROR_FAILED', false, String(error.message).slice(0, 160));
      return { mirrored: false, reason: String(error.message).slice(0, 160) };
    }
  }

  /** Cloud-authored posts, merged into local feeds when the cloud is live. */
  async fetchPosts({ limit = 50 } = {}) {
    const health = await this.health();
    if (!health.online || health.supabase === false) return [];
    try {
      return await this.supabaseSelect('posts', `select=*&order=created_at.desc&limit=${limit}`);
    } catch {
      return [];
    }
  }
}

function firebaseMessage(body, fallback) {
  const reason = body && body.error && body.error.message;
  if (!reason) return fallback;
  const map = {
    EMAIL_EXISTS: 'An account with this email already exists — sign in instead.',
    EMAIL_NOT_FOUND: 'No account with that email yet — create one first.',
    INVALID_PASSWORD: 'That password does not match our records.',
    INVALID_LOGIN_CREDENTIALS: 'That email and password do not match.',
    WEAK_PASSWORD: 'Passwords need at least 6 characters.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts — wait a moment and try again.',
    OPERATION_NOT_ALLOWED: 'That sign-in method is switched off in the Firebase project.',
  };
  for (const [code, text] of Object.entries(map)) if (reason.includes(code)) return text;
  return `${fallback}: ${reason.slice(0, 120)}`;
}

module.exports = { CloudService, cloudConfig: CONFIG };
