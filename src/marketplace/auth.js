'use strict';

/**
 * ProVeri sign-in & registration — real identities, no demo accounts.
 *
 * Two ways in, both through Firebase Auth:
 *
 *   email + password   registerWithEmail / signInWithEmail talk to Firebase's
 *                      identitytoolkit REST endpoints server-side;
 *   Google             the browser runs the Google popup through the Firebase
 *                      web SDK and hands us the resulting ID token, which
 *                      signInWithFirebaseToken verifies server-side
 *                      (accounts:lookup) before a session is signed.
 *
 * A Firebase identity is mapped onto a local marketplace profile the first
 * time it signs in (first name + email, role CUSTOMER); pros still graduate
 * through /become-a-pro, which layers trade verification on top.
 *
 * Honest degradation: with no route to Firebase (air-gapped dev box, CI, the
 * unit suite) registration and sign-in fall back to a local password-hash
 * account so the product remains usable and testable — labelled `local` on
 * the session, never disguised as a cloud identity, and the moment Firebase
 * is reachable again the same endpoints use it.
 */

const { nextId, nowIso, sha256, normalizeEmail } = require('../kernel/util');

const MAX_SESSIONS = 5_000;

function localHash(email, password) {
  return sha256(`proveri-local:${normalizeEmail(email)}:${password}`);
}

class AuthService {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {import('./people').PeopleService} deps.people
   * @param {import('../integrations/cloud').CloudService} deps.cloud
   */
  constructor({ store, people, kernel, cloud }) {
    this.store = store;
    this.people = people;
    this.kernel = kernel;
    this.cloud = cloud;
    this.sessions = new Map();
  }

  /* ---------------- register & sign in with email ---------------- */

  async registerWithEmail({ email, password, fullName, suburbId, mobile }) {
    const clean = normalizeEmail(email);
    if (!clean) throw new Error('An email address is required.');
    if (!fullName || String(fullName).trim().length < 2) throw new Error('Your name is required.');
    if (!password || String(password).length < 6) throw new Error('Passwords must be at least 6 characters.');
    if (this.store.findOne('customers', (c) => c.email && c.email === clean)) {
      throw new Error('An account with this email already exists — sign in instead.');
    }

    const health = await this.cloud.health();
    let uid = null;
    let provider = 'local';
    if (health.online) {
      const signed = await this.cloud.firebaseSignUp({ email: clean, password });
      uid = signed.uid;
      provider = 'password';
    }

    const customer = this.people.registerCustomer({
      fullName: String(fullName).trim(),
      email: clean,
      suburbId: suburbId || null,
      ...(mobile ? { mobile } : {}),
      passwordHash: provider === 'local' ? localHash(clean, password) : null,
    });
    if (uid) this.#attachUid(customer, uid, provider);
    this.kernel.ledger.append({
      action: 'ACCOUNT_REGISTERED',
      subject: customer.customerId,
      visibility: 'PRIVATE',
      payload: { summary: `Account registered with ${provider === 'local' ? 'local credentials (Firebase unreachable)' : 'Firebase email auth'}`, provider },
    });
    return { created: true, session: this.#startSession(customer, provider) };
  }

  async signInWithEmail({ email, password }) {
    const clean = normalizeEmail(email);
    if (!clean || !password) throw new Error('Email and password are required.');

    const health = await this.cloud.health();
    if (health.online) {
      const signed = await this.cloud.firebaseSignInWithEmail({ email: clean, password });
      const customer = this.#findByUid(signed.uid) || this.#findByEmail(clean) || this.#createFromFirebase({ uid: signed.uid, email: signed.email, name: clean.split('@')[0] });
      if (!customer.firebaseUid) this.#attachUid(customer, signed.uid, 'password');
      return { session: this.#startSession(customer, 'password') };
    }

    // Firebase unreachable: local credential accounts only, and say so.
    const customer = this.#findByEmail(clean);
    if (!customer || !customer.passwordHash) {
      throw new Error('No local account for that email, and Firebase cannot be reached from this server right now.');
    }
    if (customer.passwordHash !== localHash(clean, password)) throw new Error('That password is invalid — check it and try again.');
    return { session: this.#startSession(customer, 'local') };
  }

  /* ---------------- Google / SDK-issued ID tokens ---------------- */

  async signInWithFirebaseToken({ idToken }) {
    if (!idToken) throw new Error('A sign-in token is required.');
    const health = await this.cloud.health();
    if (!health.online) throw new Error('Firebase cannot be reached from this server right now — Google sign-in needs it.');
    const identity = await this.cloud.firebaseLookup(idToken);
    if (!identity.email) throw new Error('That Google account has no shared email address — use email sign-in instead.');

    let customer = this.#findByUid(identity.uid) || this.#findByEmail(identity.email);
    if (!customer) {
      customer = this.#createFromFirebase(identity);
    } else if (!customer.firebaseUid) {
      this.#attachUid(customer, identity.uid, identity.provider === 'google.com' ? 'google' : 'password');
    }
    return { session: this.#startSession(customer, identity.provider === 'google.com' ? 'google' : 'password') };
  }

  /** A session for server-side actors (tests, the journey script). */
  issueLocalSession(userId) {
    const customer = this.store.get('customers', userId) || this.store.get('pros', userId);
    if (!customer) throw new Error(`no such user: ${userId}`);
    return this.#startSession(customer, customer.role === 'PRO' ? 'pro' : 'local');
  }

  /* ---------------- internals ---------------- */

  #attachUid(customer, uid, provider) {
    customer.firebaseUid = uid;
    customer.authProvider = provider;
    customer.updatedAt = nowIso();
    this.store.put('customers', customer.customerId, customer);
  }

  #findByUid(uid) {
    return uid ? this.store.findOne('customers', (c) => c.firebaseUid === uid) : null;
  }

  #findByEmail(email) {
    return this.store.findOne('customers', (c) => c.email && c.email === email);
  }

  #createFromFirebase(identity) {
    const name = identity.name || (identity.email ? identity.email.split('@')[0].replace(/[._]/g, ' ') : 'New member');
    const titled = name.split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
    const customer = this.people.registerCustomer({ fullName: titled, email: identity.email });
    this.#attachUid(customer, identity.uid, identity.provider === 'google.com' ? 'google' : 'password');
    return customer;
  }

  #startSession(customer, provider) {
    const sessionId = nextId('session');
    const session = {
      sessionId,
      userId: customer.customerId,
      role: customer.role || 'CUSTOMER',
      name: customer.fullName,
      email: customer.email || null,
      provider,
      createdAt: nowIso(),
    };
    this.store.put('sessions', sessionId, session);
    if (this.sessions.size > MAX_SESSIONS) this.sessions.clear();
    this.sessions.set(sessionId, true);
    return { userId: session.userId, role: session.role, name: session.name, email: session.email, provider, sessionId };
  }
}

module.exports = { AuthService };
