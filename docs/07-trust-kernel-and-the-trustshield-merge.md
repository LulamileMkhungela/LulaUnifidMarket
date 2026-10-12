# The Trust Kernel and the TrustShield merge

The original repository was **TrustShield**: an escrow-and-verification engine
for vehicles and property, plus three research documents. This restructure did
not delete it. It asked a harder question — *what is actually general in that
engine?* — and the answer became the kernel that everything else runs on.

## What was general

| TrustShield concept | Kernel generalisation |
| --- | --- |
| Listing version hashing (`#addVersion`) | `AuditLedger`: every platform action, hash-chained, across all verticals |
| `REQUIRED_CHECKS[type]` per asset type | `PROFILES`: verification profiles with weights, evidence keys, TTLs and blocking flags |
| `CRITICAL_FIELDS[type]` → removal on tamper | Vertical `criticalFields` + policy `VCL-001`-style rules evaluated generically |
| Negotiation lock on description/price | Vertical `lockedFields` + variation orders / addenda |
| Escrow release after handover evidence | `EscrowEngine` milestones with required evidence, auto-release and holdback |
| Buyer proof-of-funds reservation | Privacy-preserving funds confirmation (same rule, now a kernel primitive) |
| Continuous monitoring signals | `RiskEngine` signal catalogue with weights, tiers and a cross-account graph |

## What was specific, and where it went

- **Vehicle checks** (VIN/engine match, NaTIS ownership, SAPS stolen, finance
  settlement, condition report) → the `vehicleListing` verification profile.
- **Vehicle release order** (settle the bank first) → the vertical's
  `releaseOrder`, materialised as escrow milestones when a title holder exists.
- **Property flows** → the `property` vertical, honestly `COMING_SOON`, with
  the partner list and the reasons published.
- **The old engine itself** → preserved verbatim at
  `src/kernel/legacy/trustEscrowEngine.js` with its original test suite
  (`test/legacy.trustEscrowEngine.test.js`, 7 tests, still green). The original
  docs live in `docs/archive/`.

## Why the merge is a product feature, not a refactor

Running both verticals on one kernel makes three things possible that neither
half could do alone:

### 1. Inspection-as-a-service writes into the listing
A customer books `vehicle-inspection` through the ordinary services flow. The
inspector is paid from escrow, uploads geotagged VIN/odometer photos and a
report. `bridgeEvidence()` then writes that report into the vehicle listing's
trust chain as its `independent_condition_report` check — so the check is backed
by a paid, accountable, auditable job rather than a seller-uploaded PDF.

```
services:  job → bid → escrow → geosealed evidence → release
                                              │
                                              ▼  bridgeEvidence()
vehicles:  listing.verification.independent_condition_report = PASS
           (source: "ProVeri services vertical — escrow-released inspection")
```

### 2. The Vehicle Service Passport
Every escrow-released mechanic, inspection or towing job on a registered VIN
appends a hash-sealed entry to that VIN's passport. When the owner later sells
the car on ProVeri, the advert inherits the history — a used-car record nobody
can edit, because every entry cost somebody real money.

### 3. One trust score, one ledger, one receipt
A pro's delivery history, a vehicle's passport and a booking's dispute all land
in the same hash chain. `GET /api/trust/proof/:subjectId` returns a verifiable
receipt for any of them, and `GET /api/trust/transparency` publishes the
platform-wide receipt. That is the mechanism behind the claim "verified,
provably".

## Tamper semantics, stated precisely

| Event | Kernel response |
| --- | --- |
| Verified critical identifier changed (VIN, engine, reg, document hash) | listing **REMOVED**, incident logged, escrow frozen |
| Locked field edited after negotiation/award | edit **BLOCKED**; requires buyer-approved addendum or customer-approved variation order |
| Non-critical edit on a verified listing | accepted, listing drops to `RECHECK_REQUIRED`, score capped at 74 |
| Evidence photo captured >2 km from the job | payout **held**, `EVIDENCE_EXIF_MISMATCH` raised |
| Payout bank details changed | all funded escrows for that pro **frozen** until two-channel call-back |
| Message soliciting off-platform payment | quarantined, counterparty warned, risk signal raised |
| Review attempted on a non-terminal escrow | **blocked** by `REV-001` |

## The fairness guard, in code

Locality and crime data are the most dangerous inputs a marketplace can hold.
ProVeri's rule: they may raise verification friction and nothing else.

```js
applyLocalitySignal(subjectId, locality, { forPurpose }) {
  if (forPurpose !== 'safety') {
    throw new Error('Locality/crime data may only be used to raise verification '
      + 'friction (forPurpose="safety"). Using it for ranking, pricing or '
      + 'eligibility is prohibited by the ProVeri fairness policy.');
  }
  ...
}
```

The test suite asserts both the allowed and the throwing path, so the guard is
a regression-tested contract rather than a paragraph in a values document.
