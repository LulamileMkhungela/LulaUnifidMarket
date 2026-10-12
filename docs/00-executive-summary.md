# Lula ProVeri — executive summary

**What this repository is.** A working, installable reference implementation of
**Lula ProVeri**, a South African on-demand services marketplace built to the
same product shape as [myservicepro.co.za](https://www.myservicepro.co.za) — post
a job, KYC-verified pros bid, money sits in escrow until the customer confirms —
and then extended well past it: a **portfolio storefront** where pros publish the
work they have already done and home owners reach out to them about it, a shared
**Trust Kernel** that also runs a verified-vehicles vertical, load-shedding- and weather-aware scheduling,
geosealed proof of work, a 14-day workmanship warranty holdback, verified-only
reviews, a free data-bound microsite for every verified pro, a Remit-a-Job rail
that lets family abroad fund a relative's repairs, and a **Business Site Studio**
that turns ten industry templates into live, server-rendered business websites
whose booking forms open real escrow-protected jobs — sold through a sales desk
CRM with a free diagnostic, an R0 demo builder and a generated pitch kit.

Research snapshot: 2026-10-12. Product research and engineering reference, not
legal advice.

---

## The one-paragraph pitch

South Africans do not hire strangers because they do not trust strangers, and
skilled South Africans stay invisible because nobody can prove they are good.
Every incumbent solves one half of one side: escrow providers protect money,
classifieds sites protect nobody, lead marketplaces sell phone numbers and call
it a service. ProVeri protects **the whole transaction** — identity, money,
scope, evidence and aftermath — and makes every protection *verifiable* by
anyone, from a hash-chained audit ledger.

## What changed in this restructure

The repository previously held **TrustShield**, a vehicle/property escrow and
verification engine (`src/trustEscrowEngine.js`, three research docs). Rather
than discard it, this restructure generalised it into the **ProVeri Trust
Kernel** and kept vehicles as a live vertical on the same rails:

| Before | After |
| --- | --- |
| `src/trustEscrowEngine.js` — one engine for vehicles/property | `src/kernel/` — audit ledger, verification, escrow, risk, policy; vertical-agnostic |
| Vehicle + property flows only | **Services** (live), **vehicles** (beta), **property** (honestly "coming soon") |
| Static HTML prototype | Installable **PWA** + zero-dependency REST API (184 operations) + server-rendered pro microsites **and** client business sites |
| Competitor notes (3 vendors) | Competitor teardown across **14** SA and international platforms with take-rate economics |
| No runnable surface | `npm start` seeds a full marketplace; `npm test` runs **199 tests**; live preview |
| Website demos with dead buttons (the reference repository's `BookingModal` shows a toast) | A booking form that validates against its template schema and produces a reference, a quote, an owner notification — and a real marketplace job into escrow when the business is a verified pro |
| Original TrustShield docs | Preserved verbatim under `docs/archive/` |

## The proof, not the promise

| Claim | Where it is enforced | Where it is proved |
| --- | --- | --- |
| No badge without evidence | `kernel/verification.js` caps a PASS that arrives without its evidence | `test/kernel.test.js` |
| Ratings cannot be bought | policy `REV-001` allows reviews only on escrow-released jobs | `test/kernel.test.js`, `test/marketplace.flow.test.js` |
| Money moves only on proof of work | policy `POW-001`; escrow release requires accepted milestones | `test/kernel.test.js` |
| Photos taken far from the job hold the payout | geoseal in `marketplace/bookings.js` + risk signal `EVIDENCE_EXIF_MISMATCH` | `test/marketplace.flow.test.js` |
| A verified VIN change removes the listing | policy `VCL-001` + `vehicles.updateListing` | `test/verticals.test.js` |
| Locality data never ranks, prices or excludes | `kernel/risk.js` **throws** if the locality signal is used for anything but safety | `test/kernel.test.js` |
| Off-platform payment asks are caught | policy `OFP-001` message classifier | `test/kernel.test.js`, `test/marketplace.flow.test.js` |
| Bank-detail substitution freezes payouts | policy `BDS-001` | `test/marketplace.flow.test.js` |
| The audit trail cannot be quietly edited | SHA-256 hash chain over every ledger entry | `test/kernel.test.js`, `GET /api/trust/ledger` |
| A website cannot publish an uncleared photo | policy `WEB-002`; identifiable faces need POPIA consent on top of copyright | `test/businessSites.test.js` |
| Update allowances are metered, never silently billed | policy `WEB-001` refuses the edit and returns renew / upgrade / pay-R150 | `test/businessSites.test.js` |
| A generated image is labelled where it is shown | policy `WEB-003`; an AI hero with nowhere for a note is flagged before publish | `test/businessSites.test.js` |
| A lead who objects is never contacted again | policy `LEAD-001` blocks all six channels; the objection is a public ledger entry | `test/leads.test.js`, `test/pwa-screens.test.js` |
| A simulated scan never poses as a measured one | `diagnose()` returns `simulated: true` with the reason and keeps the field research | `test/leads.test.js` |
| A portfolio badge cannot be claimed | policy `PRT-001`; the tier is computed from evidence and `updateItem` refuses the claim | `test/portfolio.test.js` |
| A photo another pro published cannot be reused | policy `PRT-002`; photo hashes are matched across portfolios **and** booking evidence | `test/portfolio.test.js` |
| Closed jobs republish themselves as proven work | `bookings.releasePayment` → `portfolio.harvestFromBooking`, idempotent | `test/portfolio.test.js` |
| An enquiry thread is private to its participants | `portfolio.listEnquiries` raises `FORBIDDEN`, which the server maps to 403 | `test/portfolio.test.js`, `test/pwa-screens.test.js` |
| The PWA screens actually render | a DOM shim loads `pwa/js/*` against a live server and fails on any `undefined`/`NaN` | `test/pwa-screens.test.js` |

## Numbers that frame the opportunity

- **33.6%** official unemployment (Stats SA QLFS Q2 2026), **8.5 million**
  unemployed, youth (15–24) at **60.9%**. The constraint on informal skilled
  work is trust and credentialing, not skill.
- Incumbent take rates run **12.5–30%** (Airtasker tiers, TaskRabbit dual fees,
  Thumbtack per-lead credits). ProVeri takes **10%**, only from released jobs,
  with no subscription and no per-lead charge.
- Kandua — the best-funded SA entrant — was **acquired by Santam in May 2024**,
  which tells you where the value pools are: verification data and risk, not
  classifieds listings.

## How to run it

```bash
npm start                 # seeds the demo marketplace and serves API + PWA on :4173
npm test                  # 199 tests: kernel, flows, portfolio, verticals, integrations, studio, sales desk, HTTP, PWA screens
npm run demo              # end-to-end services journey printed to stdout
npm run demo:vehicle      # end-to-end vehicle journey (the merged TrustShield rail)
npm run demo:studio       # research → diagnose → demo → pitch → win → publish → booking → job → export
npm run openapi           # generated OpenAPI 3.1 document
npm run integrations:probe# which free public sources answered, right now
npm run healthcheck       # container-style health + ledger-chain check
```

Environment switches:

| Variable | Effect |
| --- | --- |
| `PROVERI_INTEGRATION_MODE=offline` | deterministic bundled data (default in CI/tests) |
| `PROVERI_INTEGRATION_MODE=live` | call the real free public APIs |
| `PROVERI_PERSIST=1` | snapshot the store to `data/.store.json` |
| `ESP_API_TOKEN`, `CIPC_API_KEY`, `PAYSTACK_SECRET_KEY`, … | switch a partner adapter from honest-simulation to live |

## Reading order

1. [`01-servicepro-parity-matrix.md`](01-servicepro-parity-matrix.md) — feature-by-feature against myservicepro.co.za
2. [`02-competitor-teardown.md`](02-competitor-teardown.md) — 14 platforms, economics and attack surfaces
3. [`03-innovative-features.md`](03-innovative-features.md) — the 28 things nobody else does
4. [`04-public-data-and-integrations.md`](04-public-data-and-integrations.md) — every endpoint, cost, licence and fallback
5. [`05-architecture.md`](05-architecture.md) — modules, state machines, data flow
6. [`06-api-reference.md`](06-api-reference.md) — the REST surface
7. [`07-trust-kernel-and-the-trustshield-merge.md`](07-trust-kernel-and-the-trustshield-merge.md) — how the old engine became the kernel
8. [`08-compliance-and-risk.md`](08-compliance-and-risk.md) — POPIA, FICA, ECT Act, statutory trades
9. [`09-money-flow-and-unit-economics.md`](09-money-flow-and-unit-economics.md) — escrow maths and the business model
10. [`10-web-studio.md`](10-web-studio.md) — the preview-before-you-pay web business
11. [`11-roadmap-and-metrics.md`](11-roadmap-and-metrics.md) — phases, metrics, risks
12. [`12-business-site-studio.md`](12-business-site-studio.md) — the website product and the sales desk that sells it
13. [`13-portfolio-and-the-storefront.md`](13-portfolio-and-the-storefront.md) — the work shelf, the tiers, and the four-tab shop

Original TrustShield research is preserved under [`archive/`](archive/).
