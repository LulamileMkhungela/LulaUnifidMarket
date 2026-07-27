# Lula Unified Market — TrustShield Escrow

A reference solution for **high-value South African marketplace transactions** where buyers and sellers are afraid of scams: vehicles, houses, and other assets where the advert must match reality.

## Explore

South Africa already has parts of this problem solved, but they are fragmented:

- escrow providers secure money;
- car platforms list vehicles and sometimes verify sellers or dealers;
- vehicle-check providers verify VIN/engine/finance/stolen indicators;
- property portals list homes, while conveyancers and trust accounts secure deposits.

The gap is an end-to-end marketplace trust layer that combines **asset verification + buyer proof-of-funds + escrow + immutable listing locks + continuous investigation until transfer**. This repo implements that product direction as **Lula TrustShield**.

## What is included

| File | Purpose |
| --- | --- |
| [`docs/south-africa-competitor-analysis.md`](docs/south-africa-competitor-analysis.md) | Competitor and adjacent-market research for South African escrow, vehicle, and property markets. |
| [`docs/end-to-end-trust-escrow-solution.md`](docs/end-to-end-trust-escrow-solution.md) | Full product blueprint: car flow, house flow, state machine, architecture, APIs, and MVP roadmap. |
| [`docs/compliance-and-risk-plan.md`](docs/compliance-and-risk-plan.md) | Practical compliance, risk, and partner strategy for FICA/AML, POPIA, escrow, vehicles, and property. |
| [`src/trustEscrowEngine.js`](src/trustEscrowEngine.js) | Working reference domain engine for verification checks, escrow states, tamper detection, negotiation locks, and monitoring. |
| [`test/trustEscrowEngine.test.js`](test/trustEscrowEngine.test.js) | Node test suite proving the core anti-scam rules. |
| [`prototype/index.html`](prototype/index.html) | Static clickable-style product prototype showing the TrustShield flow. |

## Core TrustShield rules implemented

1. **No fake proof of payment:** the seller only receives a temporary “buyer has sufficient reserved funds” notice from a verified provider; the buyer’s full balance is never exposed.
2. **Verify before confidence:** a listing only earns a trust badge after all mandatory checks pass.
3. **Continuous investigation:** new risk signals can push the listing back to recheck or remove it.
4. **Tamper removal:** changing a verified VIN, title deed, registration certificate, or other critical asset identifier removes the listing.
5. **Negotiation lock:** once a buyer starts negotiation, description/price/terms cannot be silently edited. Changes need a buyer-approved addendum.
6. **Escrow release only after evidence:** funds are released only after handover evidence and buyer/verifier acceptance.

## Run the reference engine

```bash
npm test
npm run demo
```

The demo prints a full successful vehicle transaction: verified listing, temporary buyer funds confirmation, escrow funding, handover evidence, and payout.

## Product positioning

> **Escrow stops payment scams. TrustShield stops product-information scams.**

Lula Unified Market should not compete only as another classifieds site. It should position itself as the safest transaction rail for high-value private sales in South Africa: **verified ad, locked terms, escrowed funds, monitored until transfer**.
