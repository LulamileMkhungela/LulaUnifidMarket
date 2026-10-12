# Lula TrustShield: end-to-end escrow and verification solution

## Product promise

Lula TrustShield is a high-trust transaction layer for cars, houses, and other high-value goods:

> The buyer funds safely. The seller only gets paid when the exact verified asset is delivered/transferred. If the listing is tampered with, it is blocked or removed.

## What the solution must solve

1. Buyers do not trust “proof of payment” screenshots/PDFs.
2. Sellers need confidence that the buyer can pay before wasting time.
3. Buyers do not know if the listed car/house matches the advert.
4. Sellers can change VINs, documents, photos, descriptions, or prices after trust is built.
5. Marketplaces usually stop at leads; fraud risk moves to WhatsApp, EFT, and offline handover.
6. Existing escrow protects funds, but not necessarily the product information.

TrustShield combines payment confidence with product confidence.

## Core rules

| Rule | Behaviour |
| --- | --- |
| Verify before trust badge | Asset must pass mandatory checks before a “verified” badge appears. |
| Buyer funds confirmation is temporary | Seller receives only a yes/no confirmation for this transaction amount, not the buyer’s full balance. |
| No silent listing edits | Every listing version is hashed and audited. |
| Critical tamper = removal | Changing verified VIN, engine number, title deed, municipal account, registration certificate, or ownership evidence removes the listing. |
| Negotiation locks terms | Once buyer negotiation starts, description/price/terms cannot be edited without buyer-approved addendum. |
| Continuous investigation | Scheduled and event-driven checks continue until transfer/handover. |
| Escrow release needs evidence | Funds release only after buyer/verifier acceptance and required transfer evidence. |

## End-to-end vehicle flow

### 1. Seller onboarding

- Collect seller identity, address, selfie/liveness, FICA/AML screening, sanctions/PEP screening.
- Require seller declaration of ownership, outstanding finance, accident history, known defects, and permission to verify data.
- For dealers/high-value sellers, collect business registration, beneficial ownership, VAT/trading details, and FIC compliance status where applicable.

### 2. Vehicle listing intake

Required fields:

- VIN, engine number, registration number, make/model/year, mileage, colour.
- Registration certificate / NaTIS document hash.
- Roadworthy certificate if available.
- Service history evidence.
- Finance settlement letter if a bank is title holder.
- Inspection booking or existing condition report.
- Photos/video with timestamp and geolocation where possible.

### 3. Investigation before “verified” badge

Mandatory checks:

- seller FICA identity;
- VIN/engine/registration/manufacturer consistency;
- registered owner/title holder check;
- police stolen status check;
- outstanding finance/settlement check;
- independent condition/roadworthy inspection;
- duplicate listing/photo scan;
- price anomaly check against market value.

Possible results:

- **Verified:** all mandatory checks pass.
- **Recheck required:** missing documents, warnings, or expired evidence.
- **Removed:** stolen flag, ownership mismatch, tampered identifier, forged document, or severe undisclosed risk.

### 4. Buyer proof-of-funds

- Buyer connects a bank/open-banking/payment provider or pre-funds escrow.
- TrustShield confirms whether funds are sufficient for the negotiated amount.
- Seller notification says: “Buyer has sufficient reserved funds for this transaction until [time].”
- Seller never sees the buyer’s full balance, statements, or account number.

### 5. Negotiation lock

When buyer clicks **Start negotiation**:

- listing description, price, included items, known defects, VIN, engine number, documents, and inspection evidence are locked;
- seller can propose an addendum, but the buyer must explicitly accept;
- every change creates an immutable audit hash.

### 6. Escrow funding

- Buyer deposits funds into a regulated escrow/trust account partner.
- If vehicle has outstanding finance, escrow release order is:
  1. settle bank/title holder,
  2. receive paid-up/settlement confirmation,
  3. transfer remaining balance to seller after handover acceptance.

### 7. Handover and payout

Required handover evidence:

- final VIN/engine check at handover;
- roadworthy evidence if applicable;
- signed sale agreement;
- NCO/RLV or transfer documents;
- buyer acceptance;
- independent verifier approval for condition.

If evidence passes, escrow pays the seller. If evidence fails, escrow pauses and dispute/refund workflow starts.

## End-to-end property flow

### 1. Seller/agent onboarding

- Verify seller identity and ownership authority.
- Verify estate agent or agency PPRA/FFC status when an agent is involved.
- Verify conveyancer/trust-account details from a whitelisted source before any deposit instructions are shown.

### 2. Property listing intake

Required fields:

- title deed number, erf/sectional title details, municipality, physical address;
- seller authority document if seller is a company, trust, estate, or representative;
- municipal account and rates status;
- bond/encumbrance declarations;
- compliance certificates status where applicable;
- agent mandate and FFC evidence;
- photos/video and duplicate-listing scan.

### 3. Investigation before “verified” badge

Mandatory checks:

- seller FICA identity;
- Deeds Office title/owner match;
- municipal account/clearance status;
- bond and encumbrance search;
- PPRA/FFC check for agent;
- conveyancer trust account verification;
- duplicate/fake photo/listing scan.

### 4. Offer to Purchase and deposit protection

- Buyer submits OTP through TrustShield templates.
- Deposit goes to a regulated partner: conveyancer trust account, Buyers Trust-style account, bank escrow, or licensed escrow provider.
- TrustShield shows bank/trust-account details only from a verified registry, never manually typed WhatsApp banking details.
- Release follows the legal transfer process and Deeds Office registration milestones.

### 5. Property monitoring

Until transfer registration:

- monitor title/owner status changes;
- monitor conveyancer/trust-account changes;
- block bank-detail substitution;
- watch duplicate listings and suspicious price edits;
- alert buyer if municipal, bond, or agent status changes.

## State machine

```text
DRAFT
  -> UNDER_REVIEW
  -> VERIFIED
  -> NEGOTIATION_LOCKED
  -> BUYER_FUNDS_CONFIRMED
  -> FUNDS_IN_ESCROW
  -> READY_FOR_RELEASE
  -> COMPLETED
```

Exception states:

```text
RECHECK_REQUIRED
REMOVED
DISPUTED
REFUNDED
```

Removal triggers:

- verified VIN/engine/title deed/document changes;
- failed stolen/ownership/title check;
- forged or conflicting verification evidence;
- seller tries to route payment outside escrow after negotiation;
- trust-account/bank-detail mismatch;
- unresolved critical monitoring signal.

## Architecture

```text
Web / Mobile Apps
  |-- Listing Wizard
  |-- Buyer Funds Confirmation
  |-- Negotiation + Addenda
  |-- Evidence Locker

TrustShield API
  |-- Listing Service
  |-- Verification Orchestrator
  |-- Risk Scoring Engine
  |-- Escrow Orchestrator
  |-- Negotiation Lock Service
  |-- Monitoring Scheduler
  |-- Notification Service
  |-- Audit/Event Store

Partner Adapters
  |-- KYC/FICA provider
  |-- Bank/open-banking funds confirmation
  |-- Escrow/trust-account provider
  |-- Vehicle data provider: VIN/history/finance/stolen
  |-- Vehicle inspection provider
  |-- Deeds/property data provider
  |-- PPRA/agent verification
  |-- Conveyancer/trust-account verification
```

## Core API surface

```http
POST /listings
POST /listings/{id}/verification-checks
POST /listings/{id}/negotiations
PATCH /listings/{id}
POST /listings/{id}/buyer-funds-confirmations
POST /listings/{id}/escrow
POST /listings/{id}/handover-evidence
POST /listings/{id}/release
POST /listings/{id}/refund
POST /listings/{id}/monitoring-signals
GET  /listings/{id}/audit-trail
```

## Data model essentials

```json
{
  "listing": {
    "id": "lst_123",
    "type": "vehicle|property",
    "status": "VERIFIED|NEGOTIATION_LOCKED|REMOVED|...",
    "sellerId": "seller_123",
    "asset": {},
    "description": "locked text after negotiation",
    "evidence": {},
    "verification": {
      "status": "PENDING|VERIFIED|RECHECK_REQUIRED",
      "score": 0,
      "checks": []
    },
    "versions": [
      { "hash": "sha256", "snapshot": {}, "capturedAt": "timestamp" }
    ],
    "negotiation": { "termsHash": "sha256", "lockedFields": [] },
    "escrow": { "provider": "partner", "status": "FUNDED|RELEASED" },
    "incidents": [],
    "monitoringSignals": []
  }
}
```

## MVP roadmap

### Phase 1: Private vehicle TrustShield MVP

- Listing wizard with mandatory VIN/engine/reg fields.
- KYC/FICA seller onboarding.
- Manual/partner vehicle checks.
- Immutable listing versions and tamper removal.
- Buyer proof-of-funds via payment/escrow partner.
- Escrow orchestration through licensed provider; Lula does not hold funds directly.
- Handover checklist and payout release.

### Phase 2: Automated monitoring and addenda

- Scheduled vehicle rechecks.
- Duplicate photo/listing scan.
- Buyer-approved addenda workflow.
- Risk score and trust badge visible in listing card.
- Dispute evidence locker.

### Phase 3: Property deposit/OTP TrustShield

- PPRA/FFC checks.
- Title/deeds and municipal evidence capture.
- Conveyancer/trust-account verification.
- OTP templates and deposit escrow partner routing.
- Transfer milestone tracking.

### Phase 4: Marketplace network advantage

- Seller risk graph across cars/property listings.
- Cross-platform duplicate/fraud intelligence.
- API for other marketplaces to use Lula TrustShield as a trust/escrow rail.
- Insurance, finance, warranty, and inspection marketplace.

## Success metrics

- Percentage of high-value listings verified before going live.
- Number of tamper attempts blocked/removed.
- Escrow-funded transaction conversion rate.
- Dispute rate and dispute resolution time.
- Buyer confidence score after verification report review.
- Fraud-loss rate compared with unprotected classifieds transactions.
