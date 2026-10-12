'use strict';

/**
 * Lula ProVeri — Append-only, hash-chained audit ledger.
 *
 * This is the TrustShield immutability idea generalised: every meaningful
 * platform action (verification result, bid, escrow movement, evidence upload,
 * payout, dispute ruling) is appended as a ledger entry that includes the
 * SHA-256 of the previous entry. Any edit or deletion breaks the chain and is
 * detected by `verifyChain()`.
 *
 * Why it matters commercially: a South African consumer cannot tell a real
 * review from a bought one, and a pro cannot prove they did the work. A
 * verifiable chain settles both arguments before a dispute ever reaches a human.
 */

const { sha256, nextId, nowIso, deepClone, canonicalize } = require('./util');

const GENESIS_HASH = '0'.repeat(64);

const AUDIT_LEVEL = Object.freeze({
  INFO: 'INFO',
  TRUST: 'TRUST',
  MONEY: 'MONEY',
  SAFETY: 'SAFETY',
  CRITICAL: 'CRITICAL',
});

class AuditLedger {
  constructor({ scope = 'platform' } = {}) {
    this.scope = scope;
    this.entries = [];
    this.indexBySubject = new Map();
    this.prevHash = GENESIS_HASH;
  }

  /**
   * Append an entry.
   * @param {object} input
   * @param {string} input.action   stable machine action name, e.g. 'ESCROW_FUNDED'
   * @param {string} input.subject  entity the entry belongs to, e.g. 'bkg_123'
   * @param {string} [input.actor]  who caused it
   * @param {string} [input.level]  AUDIT_LEVEL
   * @param {object} [input.payload] structured detail (hashed into the chain)
   */
  append({ action, subject, actor = 'system', level = AUDIT_LEVEL.INFO, payload = {}, visibility = 'INTERNAL' }) {
    if (!action) throw new Error('audit action is required');
    const index = this.entries.length;
    const body = {
      seq: index,
      scope: this.scope,
      action,
      subject: subject || this.scope,
      actor,
      level,
      visibility,
      payload: deepClone(payload),
      createdAt: nowIso(),
    };
    const entry = {
      ...body,
      auditId: nextId('aud'),
      prevHash: this.prevHash,
      hash: sha256({ ...body, prevHash: this.prevHash }),
    };
    this.prevHash = entry.hash;
    this.entries.push(entry);

    const list = this.indexBySubject.get(entry.subject) || [];
    list.push(entry);
    this.indexBySubject.set(entry.subject, list);
    return deepClone(entry);
  }

  forSubject(subject) {
    return deepClone(this.indexBySubject.get(subject) || []);
  }

  query({ subject, action, level, since, limit = 200 } = {}) {
    let rows = this.entries;
    if (subject) rows = rows.filter((e) => e.subject === subject);
    if (action) rows = rows.filter((e) => e.action === action);
    if (level) rows = rows.filter((e) => e.level === level);
    if (since) rows = rows.filter((e) => e.createdAt >= since);
    return deepClone(rows.slice(-limit));
  }

  /** Public-facing timeline (never leaks INTERNAL payloads). */
  publicTimeline(subject) {
    return this.forSubject(subject)
      .filter((entry) => entry.visibility !== 'INTERNAL')
      .map((entry) => ({
        action: entry.action,
        level: entry.level,
        summary: entry.payload.summary || entry.action.replace(/_/g, ' ').toLowerCase(),
        createdAt: entry.createdAt,
        seal: entry.hash.slice(0, 12),
      }));
  }

  /** Recomputes every hash; returns { valid, brokenAt, expected, actual }. */
  verifyChain(entries = this.entries) {
    let prev = GENESIS_HASH;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.prevHash !== prev) {
        return { valid: false, brokenAt: i, reason: 'PREV_HASH_MISMATCH', expected: prev, actual: entry.prevHash };
      }
      const { hash, auditId, ...body } = entry;
      const recomputed = sha256({ ...body, prevHash: entry.prevHash });
      if (recomputed !== hash) {
        return { valid: false, brokenAt: i, reason: 'ENTRY_TAMPERED', expected: hash, actual: recomputed };
      }
      prev = hash;
    }
    return { valid: true, entries: entries.length, head: prev };
  }

  /** Merkle root over the chain — publishable as a compact integrity receipt. */
  integrityReceipt() {
    const { valid, head, entries } = this.verifyChain();
    return {
      scope: this.scope,
      entries,
      headHash: head,
      chainValid: valid,
      receipt: sha256(`${this.scope}:${entries}:${head}`),
      generatedAt: nowIso(),
    };
  }

  /**
   * Verify the hash integrity of an arbitrary set of entries without requiring
   * them to be contiguous. Used for subject-scoped proofs, where the entries
   * for one booking are interleaved with entries for everything else.
   */
  verifyEntries(entries) {
    for (let i = 0; i < entries.length; i += 1) {
      const { hash, auditId, ...body } = entries[i];
      if (sha256({ ...body, prevHash: entries[i].prevHash }) !== hash) {
        return { valid: false, brokenAt: i, reason: 'ENTRY_TAMPERED' };
      }
    }
    return { valid: true, entries: entries.length };
  }

  /**
   * Third parties (customer, pro, regulator, insurer) can verify a subset of
   * the chain without seeing the whole ledger.
   */
  exportProof(subject) {
    const rows = this.forSubject(subject);
    return {
      subject,
      entries: rows.length,
      chain: this.verifyEntries(rows).valid,
      seals: rows.map((r) => ({ seq: r.seq, action: r.action, hash: r.hash, createdAt: r.createdAt })),
      digest: sha256(canonicalize(rows.map((r) => r.hash))),
    };
  }

  toJSON() {
    return { scope: this.scope, prevHash: this.prevHash, entries: this.entries };
  }

  static fromJSON(json) {
    const ledger = new AuditLedger({ scope: json.scope });
    ledger.entries = json.entries || [];
    ledger.prevHash = json.prevHash || GENESIS_HASH;
    for (const entry of ledger.entries) {
      const list = ledger.indexBySubject.get(entry.subject) || [];
      list.push(entry);
      ledger.indexBySubject.set(entry.subject, list);
    }
    return ledger;
  }
}

module.exports = { AuditLedger, AUDIT_LEVEL, GENESIS_HASH };
