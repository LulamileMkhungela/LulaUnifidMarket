# Roadmap and metrics

## Phase 0 — shipped in this repository

- Trust Kernel: hash-chained ledger, verification profiles, escrow state
  machine, risk engine with fairness guard, declarative policy rules.
- Services vertical end to end: post → match → bid → award → escrow → geosealed
  evidence → confirm → release → warranty → verified review.
- Vehicles vertical (beta): listing verification, tamper removal, negotiation
  locks, privacy-preserving funds confirmation, title-holder release order,
  Service Passport, cross-vertical inspection bridge.
- Property vertical: honest `COMING_SOON` with published reasons and waitlist.
- Web Studio: free microsites, six packages through milestone escrow, four
  growth services, free sealed diagnostic.
- **Business Site Studio**: ten industry templates, three monthly plans with
  enforced update allowances, asset classification with a hash-chained
  permission/POPIA publish gate, AI-image labelling, subscriptions held in
  escrow, zero-dependency server-rendered sites, single-file and bundle export
  with a GitHub Pages workflow, and a booking form that creates reservations or
  real escrow-ready jobs.
- **Sales desk**: weighted-stage CRM, the field status vocabulary, an honest
  offline diagnostic, R0 demo building, a generated pitch kit, consent-checked
  outreach windows and next-best-actions.
- PWA: installable, offline-first, mutation queue, share target, dark mode,
  studio and sales-desk screens.
- 184-operation API with generated OpenAPI and generated API docs; 199 tests
  (including a DOM-shim test that renders every PWA screen against a live
  server); three demo scripts; this doc suite.

## Phase 1 — make it real money (next 90 days)

1. **Partner keys live:** Paystack splits + transfers, TradeSafe sandbox,
   Ozow account verification, Clickatell/Brevo/WhatsApp Cloud. Each adapter
   already matches the live contract; this is configuration and reconciliation
   hardening, not new code paths.
2. **OmniCheck/Datanamix for KYC:** DHA real-time ID, AVS-R, PEP/sanctions,
   3D liveness. Flip `WARN → PASS` on real references.
3. **Payments reconciliation job:** every partner webhook matched to a ledger
   entry; unmatched events page on the trust desk.
4. **Dispute desk tooling:** evidence side-by-side, SLA timers, outcome
   templates, published anonymised outcome statistics.
5. **Push notifications** (Web Push) for bids, arrival codes and releases.
6. **Studio billing live:** subscription renewals on a real payment schedule
   (Paystack subscriptions or a Stripe billing portal), dunning at `PAST_DUE`,
   and the extra-update charge billed through the same rail. The escrow record,
   the allowance meter and the refusal path already exist; what is missing is a
   recurring charge against a live merchant account.
7. **Domains and DNS:** register and point a client domain at `/s/<slug>`, with
   certificate issuance tracked per site. Until then the export bundle and
   GitHub Pages target are the honest answer, and the plan data says so.

## Phase 2 — deepen the moat (months 4–9)

6. **Price intelligence at scale:** category×metro×season bands from released
   jobs; publish the band methodology so pros can argue with it.
7. **EskomSePush paid tier** for area schedules; municipal outage feeds
   (City of Cape Town open data) as a second source.
8. **Insurance marketplace:** per-job public liability cover quoted at checkout
   (Santam owns Kandua — the distribution channel is the asset).
9. **RPL at scale:** assessor network, on-camera practical assessments, SETA
   referrals; publish badge outcomes.
10. **Vehicle vertical GA:** NaTIS/ownership and stolen-status partners,
    dealer accounts, TradeSafe-funded purchases.

## Phase 3 — platform (months 10–18)

11. **Trust-as-a-Service API:** verification, evidence sealing and ledger
    receipts for other marketplaces and insurers.
12. **Property vertical GA** once Deeds/municipal partner agreements land.
13. **B2B retainers:** body corporates and property managers buying verified
    maintenance programmes with SLA milestones.
14. **Cross-platform fraud intelligence:** shared duplicate-photo and
    device-graph signals, contributed and consumed under POPIA-consent terms.

## Metrics, targets and where each is computed

| Metric | Target | Computed in |
| --- | --- | --- |
| Median first-bid minutes | < 30 | `jobs.stats` |
| Matched verified pros per job | ≥ 3 | `jobs.matchPros` |
| Escrow-funded conversion of awards | ≥ 80% | `bookings.stats` |
| Dispute rate | < 5% of bookings | `bookings.stats` |
| Median dispute resolution | < 48 h | dispute timeline |
| Geoseal failure rate | < 2% of evidence | `bookings.submitEvidence` |
| Warranty defect rate | < 3% | `bookings.reportWarrantyDefect` |
| Verified-review coverage | 100% of released jobs offered | `reviews` |
| Pro 90-day retention | ≥ 60% | wallet/earnings |
| Repeat-customer rate | ≥ 35% | `pro.stats` |
| Ledger chain validity | always true | `GET /api/trust/ledger` |
| Fraud loss per R1m GMV | < classifieds baseline / 10 | trust desk |
| Sites published per week | ≥ 10 | `businessSites.stats` |
| Booking forms that produce a reference | 100% (no dead buttons) | `test/pwa-screens.test.js` |
| Bookings converted to escrow jobs | ≥ 25% of JOB-intake bookings | `businessSites.stats.bookingsConvertedToJobs` |
| Assets permission-cleared before publish | 100% (enforced, not measured) | policy `WEB-002` |
| AI images labelled on the public page | 100% | policy `WEB-003` |
| Lead → win conversion | ≥ 20% | `salesDesk.stats.conversionRate` |
| Median lead cycle, capture → won | ≤ 21 days | `salesDesk.stats.averageCycleDays` |
| Demos built before a pitch | ≥ 80% of walk-ins | `salesDesk.stats.demosBuilt` |
| Outreach after a POPIA objection | 0 (blocked in code) | policy `LEAD-001` |
| Monthly recurring revenue | reported, not projected | `salesDesk.stats.monthlyRecurringCents` |
| Churn with export offered | 100% of cancellations get their file | `businessSites.cancelSubscription` |

## Known risks and the honest mitigations

| Risk | Mitigation |
| --- | --- |
| Two-sided marketplace liquidity | Metro-by-metro launch order (Gauteng first), seeded supply via the free microsite, instant-book categories for same-day demand |
| Pros resisting escrow | Payment guaranteed *before* work starts; instant payout rails; published 90/10 split; no cost to lose |
| Customers bypassing to cash | Off-platform detection, warranty holdback only inside escrow, arrival-code safety that cash cannot offer |
| Verification cost per pro | Free offline checks first (ID, bank shape, CIPC format); paid bureau calls only for the checks that need them |
| Partner concentration | Every money role has ≥2 adapters; escrow provider chosen per transaction value |
| Regulatory change (payments, property) | Shadow-escrow design keeps licensing with partners; property deferred until partner rails exist |
| Studio becomes an agency treadmill (unlimited edits, R0 build) | The allowance is a policy rule, not a promise in a contract: the edit is refused with the price of the exception attached, so scope creep is a conversation with a number in it |
| A client site publishes someone else's photograph | Publishing is gated on a per-asset permission record with a seal in the ledger; previews are unlisted precisely so the pitch can happen before the paperwork |
| Generated imagery misleading a customer | `WEB-003` labels every generated image where it is shown and flags the cases where it cannot be labelled |
| Selling websites to businesses that do not need one | The diagnostic reports a healthy site as healthy and the pitch kit says "do not sell a rebuild" — a lead can be lost on purpose, with the reason recorded |

## What "done" looks like

A homeowner in Soweto posts a leaking geyser from a R1,500 Android phone with
one bar of signal; three verified plumbers bid inside twenty minutes with prices
the homeowner can sanity-check against the published band; the winning plumber
is let in by a six-digit code; the photos they upload are provably from that
kitchen; the money that was sitting in a regulated escrow account moves in
seconds; five percent of it waits two weeks to make sure the repair holds; and
every step of that story can be checked by anyone, forever, from a hash.
