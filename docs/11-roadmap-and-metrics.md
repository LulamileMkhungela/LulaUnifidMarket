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
- PWA: installable, offline-first, mutation queue, share target, dark mode.
- 124-route API with generated OpenAPI; 104 tests; demo scripts; this doc suite.

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

## Known risks and the honest mitigations

| Risk | Mitigation |
| --- | --- |
| Two-sided marketplace liquidity | Metro-by-metro launch order (Gauteng first), seeded supply via the free microsite, instant-book categories for same-day demand |
| Pros resisting escrow | Payment guaranteed *before* work starts; instant payout rails; published 90/10 split; no cost to lose |
| Customers bypassing to cash | Off-platform detection, warranty holdback only inside escrow, arrival-code safety that cash cannot offer |
| Verification cost per pro | Free offline checks first (ID, bank shape, CIPC format); paid bureau calls only for the checks that need them |
| Partner concentration | Every money role has ≥2 adapters; escrow provider chosen per transaction value |
| Regulatory change (payments, property) | Shadow-escrow design keeps licensing with partners; property deferred until partner rails exist |

## What "done" looks like

A homeowner in Soweto posts a leaking geyser from a R1,500 Android phone with
one bar of signal; three verified plumbers bid inside twenty minutes with prices
the homeowner can sanity-check against the published band; the winning plumber
is let in by a six-digit code; the photos they upload are provably from that
kitchen; the money that was sitting in a regulated escrow account moves in
seconds; five percent of it waits two weeks to make sure the repair holds; and
every step of that story can be checked by anyone, forever, from a hash.
