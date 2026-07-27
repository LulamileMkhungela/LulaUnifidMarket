# Compliance and risk plan for Lula TrustShield

This document is a practical implementation guide and not legal advice. Lula should obtain South African legal, payments, AML, and data-protection advice before holding funds or launching regulated services.

## Golden compliance decision

For MVP, **do not hold client funds directly**. Partner with a regulated escrow provider, bank, Buyers Trust-style provider, or conveyancing attorney trust account. Lula should orchestrate workflow, verification, evidence, and notifications while the regulated partner controls funds.

## Key South African risk domains

| Domain | Why it matters | Product control |
| --- | --- | --- |
| FICA / AML | High-value vehicles and property can be used for money laundering. Buyers, sellers, dealers, agents, and companies may require identity/beneficial-owner checks. | KYC/FICA provider, sanctions/PEP screening, risk-tiering, record retention, suspicious activity escalation. |
| POPIA | VINs, IDs, addresses, bank confirmations, title deeds, and buyer balances are personal/sensitive data. | Consent, purpose limitation, minimum disclosure, encryption, retention limits, audit logs, data-subject request process. |
| Payments / escrow | Holding money can trigger licensing, trust-account, safeguarding, and AML obligations. | Use licensed escrow/trust partner first; show verified account details only; reconcile all partner events. |
| Property practitioners | Property agents must be legitimate and properly certificated. | PPRA/FFC verification and expiry monitoring. |
| Conveyancing / trust accounts | Property deposits and purchase funds must be routed to legitimate trust accounts and released by transfer milestones. | Whitelisted conveyancer accounts, callback verification, bank-account ownership checks, bank-detail change freezes. |
| Vehicle ownership and finance | A vehicle under finance or stolen/ownership mismatch can destroy the buyer. | NaTIS/ownership checks, settlement letters, title-holder release sequence, SAPS-style stolen status checks, final VIN check. |
| Consumer protection | Misrepresentations and hidden defects create legal and reputational risk. | Seller declarations, independent inspections, known-defect fields, buyer acknowledgement, evidence locker. |

## Privacy-preserving buyer funds confirmation

Do not send sellers bank statements or buyer balances. Use this pattern:

1. Buyer authorises a bank/open-banking/payment provider check for a specific listing and amount.
2. Provider returns sufficient/insufficient plus a reservation/reference.
3. Seller receives only: buyer identity, listing, amount covered, expiry time, provider reference.
4. Seller never receives account number, full balance, transaction history, salary, or unrelated affordability data.
5. Reservation expires automatically and must be refreshed before escrow funding.

## Bank-detail substitution protection

A common fraud vector is changing payment instructions outside the platform. TrustShield should:

- never allow seller-entered bank details for escrow payments;
- fetch escrow/trust details only from the verified partner;
- freeze bank-detail changes after OTP/negotiation;
- require two-channel verification for any partner account change;
- alert both parties on every payment-instruction event;
- maintain immutable event logs.

## Listing tamper rules

| Event | Action |
| --- | --- |
| VIN, engine number, registration number, title deed, erf number, municipal account, or verified document hash changes after verification | Remove listing and create critical incident. |
| Description/price/known defects change after negotiation starts | Block edit; require buyer-approved addendum. |
| Photos change after verification | Move to recheck unless buyer-approved addendum and verifier approval exist. |
| Seller tries to move conversation/payment outside escrow | Quarantine listing; notify buyer; require trust team review. |
| Monitoring returns stolen/ownership/title mismatch | Remove listing; freeze escrow; escalate dispute/refund. |

## Evidence retention

Minimum evidence set per transaction:

- every listing version hash and snapshot;
- seller and buyer KYC references;
- verification check results and provider references;
- proof-of-funds confirmation reference;
- escrow partner events;
- negotiation terms and addenda hashes;
- handover/transfer evidence;
- release/refund/dispute decision record.

## Partner strategy

### Vehicle MVP partners

- KYC/FICA provider.
- Vehicle history/VIN provider.
- Vehicle inspection/roadworthy provider.
- Escrow provider.
- Optional finance settlement partner or bank APIs.

### Property MVP partners

- PPRA/FFC verification data path.
- Deeds/property data provider.
- Conveyancing attorney panel.
- Buyers Trust/bank escrow/trust-account partner.
- Municipal clearance/status integration where feasible.

## Operational playbooks

### If a car VIN changes after verification

1. Auto-remove listing.
2. Notify buyer and seller.
3. Freeze negotiation and escrow events.
4. Ask seller for explanation and original documents.
5. Re-list only after full re-verification under a new listing ID.

### If buyer funds confirmation expires

1. Remove seller-facing funds-confirmed badge.
2. Notify buyer to refresh or fund escrow.
3. Prevent handover scheduling until escrow is funded.

### If property trust-account details change

1. Freeze payment instructions.
2. Call-back verification with conveyancer using independently sourced contact details.
3. Require dual approval from trust operations.
4. Notify buyer and agent.
5. Keep old and new bank-detail hashes in audit log.

### If a monitoring check finds a severe red flag after escrow funding

1. Pause release automatically.
2. Keep funds with escrow partner.
3. Open dispute case with evidence bundle.
4. If red flag is confirmed, refund buyer or follow legal/escrow adjudication path.
5. Report suspected fraud where legally required.
