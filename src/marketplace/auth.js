'use strict';

/**
 * ProVeri — passwordless sign-in.
 *
 * One flow for everybody, the way South Africans already sign in to their
 * banking and taxi apps:
 *
 *   1. start    — "your mobile number or email" → a six-digit one-time PIN
 *   2. verify   — the PIN proves the number; a known account is signed in, an
 *                 unknown one gets a short-lived sign-up token instead
 *   3. register — name (and suburb) turns that token into a homeowner account,
 *                 with the confirmed channel already recorded as verified
 *
 * Nothing in step 1 says whether an account exists, so the endpoint cannot be
 * used to probe who is a customer. Codes are stored as hashes, expire after
 * ten minutes and allow five attempts.
 *
 * With no SMS or email partner configured the PIN cannot be delivered, so the
 * response says exactly that and returns the code for the screen to show —
 * the same honest-simulation rule every other integration in this build
 * follows. With CLICKATELL_API_KEY / BREVO_API_KEY set the code is never
 * returned to the client.
 */

const { nextId, nowIso, sha256, normalizeMobile, normalizeEmail, fingerprint } = require('../kernel/util');

const CODE_TTL_MS = 10 * 60 * 1000;
const SIGNUP_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_LIVE_CHALLENGES = 2000;

function maskMobile(mobile) {
  return `${mobile.slice(0, 3)} *** ${mobile.slice(-4)}`;
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

class AuthService {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {import('./people').PeopleService} deps.people
   * @param {() => { notifications: boolean }} deps.configuredPartners
   */
  constructor({ store, people, kernel, configuredPartners }) {
    this.store = store;
    this.people = people;
    this.kernel = kernel;
    this.configuredPartners = configuredPartners || (() => ({ notifications: false }));
    this.challenges = new Map();
    this.signups = new Map();
  }

  /** Parse "082 123 4567", "+27821234567" or "naledi@example.co.za". */
  static parseIdentifier(identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) throw new Error('a mobile number or email is required');
    if (raw.includes('@')) {
      const email = normalizeEmail(raw);
      if (!email) throw new Error('that email address looks invalid — check it and try again');
      return { kind: 'email', value: email };
    }
    const mobile = normalizeMobile(raw);
    if (!mobile) throw new Error('that mobile number looks invalid — use a South African number like 082 123 4567');
    return { kind: 'mobile', value: mobile };
  }

  /** Every account that answers to this identifier, homeowner first. */
  accountsFor({ kind, value }) {
    const matches = (row) => row[kind] && row[kind] === value;
    const customers = this.store.find('customers', matches).map((c) => ({ userId: c.customerId, role: 'CUSTOMER', name: c.fullName }));
    const pros = this.store.find('pros', matches).map((p) => ({ userId: p.proId, role: 'PRO', name: p.displayName || p.fullName }));
    return [...customers, ...pros];
  }

  start({ identifier, role } = {}) {
    const parsed = AuthService.parseIdentifier(identifier);
    this.#sweep();
    const code = String(100000 + (parseInt(sha256(`${nextId('otp')}:${Math.random()}`).slice(0, 8), 16) % 900000));
    const challengeId = nextId('otp');
    const live = Boolean(this.configuredPartners().notifications);
    const challenge = {
      challengeId,
      identifier: parsed,
      roleHint: role === 'PRO' || role === 'CUSTOMER' ? role : null,
      codeHash: sha256(`${challengeId}:${code}`),
      attempts: 0,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    };
    this.challenges.set(challengeId, challenge);
    return {
      challengeId,
      channel: parsed.kind === 'email' ? 'email' : 'sms',
      destination: parsed.kind === 'email' ? maskEmail(parsed.value) : maskMobile(parsed.value),
      expiresInSeconds: CODE_TTL_MS / 1000,
      delivery: live
        ? { simulated: false, provider: parsed.kind === 'email' ? 'Brevo' : 'Clickatell' }
        : {
          simulated: true,
          provider: parsed.kind === 'email' ? 'Brevo (not configured)' : 'Clickatell (not configured)',
          note: 'No SMS or email partner is configured on this server, so the code is shown on screen instead of being sent.',
        },
      ...(live ? {} : { demoCode: code }),
    };
  }

  verify({ challengeId, code } = {}) {
    if (!challengeId) throw new Error('challengeId is required');
    const challenge = this.challenges.get(challengeId);
    if (!challenge || Date.parse(challenge.expiresAt) < Date.now()) {
      this.challenges.delete(challengeId);
      throw new Error('that code is invalid or has expired — request a new one');
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      this.challenges.delete(challengeId);
      throw new Error('Too many incorrect codes — request a new one');
    }
    challenge.attempts += 1;
    if (sha256(`${challengeId}:${String(code || '').trim()}`) !== challenge.codeHash) {
      const left = MAX_ATTEMPTS - challenge.attempts;
      throw new Error(`that code is invalid — ${left} attempt${left === 1 ? '' : 's'} left`);
    }
    this.challenges.delete(challengeId);

    const accounts = this.accountsFor(challenge.identifier);
    if (!accounts.length) {
      const signupToken = nextId('signup');
      this.signups.set(signupToken, {
        identifier: challenge.identifier,
        verifiedAt: nowIso(),
        expiresAt: new Date(Date.now() + SIGNUP_TTL_MS).toISOString(),
      });
      return { verified: true, newUser: true, signupToken, identifier: challenge.identifier };
    }

    const preferred = accounts.find((a) => a.role === challenge.roleHint) || accounts[0];
    this.kernel?.ledger?.append({
      action: 'SIGNED_IN',
      subject: preferred.userId,
      visibility: 'PRIVATE',
      payload: { summary: `${preferred.role === 'PRO' ? 'Pro' : 'Homeowner'} signed in with a one-time PIN (${challenge.identifier.kind})` },
    });
    return {
      verified: true,
      newUser: false,
      session: { userId: preferred.userId, role: preferred.role, name: preferred.name },
      accounts,
    };
  }

  /** Turn a verified sign-up token into a homeowner account and a session. */
  register({ signupToken, fullName, suburbId, email, mobile } = {}) {
    if (!signupToken) throw new Error('signupToken is required');
    const signup = this.signups.get(signupToken);
    if (!signup || Date.parse(signup.expiresAt) < Date.now()) {
      this.signups.delete(signupToken);
      throw new Error('this sign-up link is invalid or has expired — start again with your number');
    }
    if (!fullName || !String(fullName).trim()) throw new Error('fullName is required');
    const { kind, value } = signup.identifier;
    const customer = this.people.registerCustomer({
      fullName: String(fullName).trim(),
      email: kind === 'email' ? value : email,
      mobile: kind === 'mobile' ? value : mobile,
      suburbId: suburbId || undefined,
    });
    this.people.verifyCustomerChannel(customer.customerId, {
      channel: kind === 'email' ? 'email' : 'mobile',
      reference: `OTP_${fingerprint(signupToken, 8)}`,
    });
    this.signups.delete(signupToken);
    return {
      created: true,
      session: { userId: customer.customerId, role: 'CUSTOMER', name: customer.fullName },
    };
  }

  #sweep() {
    const now = Date.now();
    for (const [id, c] of this.challenges) if (Date.parse(c.expiresAt) < now) this.challenges.delete(id);
    for (const [id, s] of this.signups) if (Date.parse(s.expiresAt) < now) this.signups.delete(id);
    // A hard ceiling so a flood of start() calls cannot grow memory without bound.
    while (this.challenges.size > MAX_LIVE_CHALLENGES) this.challenges.delete(this.challenges.keys().next().value);
  }
}

module.exports = { AuthService, maskMobile, maskEmail };
