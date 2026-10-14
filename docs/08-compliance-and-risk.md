# Compliance and risk

Engineering reference, not legal advice. South African counsel should review
before any regulated activity goes live. The original TrustShield compliance
plan is preserved at [`archive/trustshield-compliance-and-risk-plan.md`](archive/trustshield-compliance-and-risk-plan.md);
this document updates it for the services-first shape.

## The golden decision, unchanged

**ProVeri never holds client money.** Every escrow record in this codebase
is a *shadow* of an account at a regulated partner (TradeSafe — PASA-authorised
third-party payment provider; or Paystack/Stripe/PayFast/Ozow/Yoco as PSPs; or a
conveyancer trust account for property). The kernel decides *when* money may
move; the partner moves it. This keeps ProVeri out of third-party payment
provider licensing for MVP while still owning the trust logic.

## Risk domains and the control that answers each

| Domain | Exposure | Control in code |
| --- | --- | --- |
| **FICA / AML** | Identity, source of funds, PEP/sanctions on high-value trades | 9-stage KYC pipeline; OmniCheck/Datanamix adapter for DHA, AVS-R, PEP/sanctions; risk-tiering; record retention in the ledger |
| **POPIA** | IDs, bank details, photos with GPS, messages | Seals instead of raw values; masked echoes; purpose-scoped consent records; `Permissions-Policy`; retention rules documented; data-subject route ready |
| **Payments / escrow** | Holding money triggers licensing and safeguarding duties | Shadow-escrow design; partner-only movement; reconciliation via `reconcilePartnerEvent` with unmatched-event incidents |
| **Statutory trades** | Unlicensed electrical/gas/building/security work is criminal and uninsurable | `TRD-001` blocks bids and awards without a recorded certificate; register list published; RPL pathway for uncertified skill |
| **Consumer protection (CPA)** | Hidden defects, misrepresentation | Known-defect fields locked into the scope; independent inspection bridges; 14-day workmanship holdback; dispute outcomes on evidence |
| **ECT Act s44** | Seven-day cooling-off on electronic transactions | `CAN-001`: free cancel before payment/work start; consent-to-commence recorded when a booking is scheduled |
| **Property practitioners** | Unregistered agents, fake FFCs | PPRA/FFC checks in the property vertical profile (coming soon) |
| **Conveyancing / trust accounts** | Bank-detail substitution on deposits | Trust-account allowlist, call-back verification, change freezes (the property equivalent of `BDS-001`) |
| **Children and vulnerable occupants** | In-home work with minors | `childrenOnPremises` raises clearance-gated matching; police clearance and two references required before a bid can be accepted |

## Privacy-preserving funds confirmation (the rule that survives verbatim)

The seller learns only: *buyer has sufficient reserved funds for R<amount> on
<reference> until <time>* — plus a provider reference. Never a balance, account
number, bank name, salary or statement. Implemented in
`vehicles.confirmBuyerFunds` and asserted in `test/verticals.test.js`
(the balance must not appear in the seller notification string).

## Data minimisation, concretely

| Value | Stored as | Echoed as |
| --- | --- | --- |
| SA ID number | SHA-256 seal only | `800101******7` mask |
| Bank account number | SHA-256 seal only | `•••••0405` |
| Evidence photo | SHA-256 hash + GPS + timestamp | seal prefix + geoseal verdict |
| Certificate number | plaintext (it is a public-register key) + hash | full, with register link |
| Message body | plaintext (needed for disputes) | to participants only; flagged bodies annotated |
| Location of a job | suburb + coordinates | to matched pros after award; public listings show suburb only |

## Record retention

Financial and trust records: 5 years (tax and FICA alignment), held as ledger
entries with seals. Photos: hash + metadata retained; binaries held by the
storage partner under the same retention. On account deletion: personal fields
de-identified except where an active escrow, dispute or statutory duty survives.

## Operational playbooks (carried over and extended)

1. **VIN/identifier changed after verification** → auto-remove, notify both
   parties, freeze escrow, re-list only under a new id after full re-verification.
2. **Funds confirmation expires** → badge removed, buyer prompted, handover
   scheduling blocked until escrow is funded.
3. **Trust/bank details change** → freeze, call-back on independently sourced
   contacts, dual approval, both seals retained in the ledger.
4. **Critical monitoring signal after funding** → pause release, keep funds at
   the partner, open a dispute with the evidence bundle, report fraud where
   legally required.
5. **Missed arrival check-in** → safety-desk alert; two-person visit offered;
   booking reviewable before further scheduling.
6. **Off-platform solicitation detected** → quarantine message, warn the other
   party, raise risk; repeat offences suspend.

## What we will not do

- Sell or share personal information (declared in-product and in code comments).
- Use locality or crime data for ranking, pricing or eligibility (throws).
- Assert a verification we cannot source (`PASS` requires a reference).
- Advertise a guarantee the escrow mechanics do not actually provide.
