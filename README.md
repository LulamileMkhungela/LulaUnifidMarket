# Lula ProVeri 🇿

**Verified pros. Escrow-protected money. Proof of work.**

Lula ProVeri is a South African on-demand services marketplace built to the same
product shape as [myservicepro.co.za](https://www.myservicepro.co.za) — post a
job, KYC-verified pros bid, your money sits in escrow until you confirm the work
— and then extended well past it. It ships as an **installable, offline-first
PWA** plus a **zero-dependency REST API** (124 routes), runs on **one Node 22
process with no `node_modules`**, and is enforced by **104 tests**.

```bash
npm start        # seeds a full demo marketplace · API + PWA on http://localhost:4173
npm test         # 104 tests: kernel, flows, verticals, integrations, HTTP
npm run demo     # one services journey printed end to end
npm run demo:vehicle   # one vehicle journey (the merged TrustShield rail)
```

Open `http://localhost:4173` and install it to your home screen from the
browser menu — it is a PWA with a service worker, offline catalogue and a
mutation queue, so a pro can submit proof of work from a basement with no
signal and it syncs on reconnect.

---

## What it does, in one screen

| | |
| --- | --- |
| **Post a job** | Plain-language description → category auto-resolved → every eligible verified pro in radius is matched and notified immediately |
| **Bids you can sanity-check** | Each bid carries Fair-Price Intelligence (real percentile bands per metro), the pro's trust score, certificate status and warranty terms |
| **Money into escrow** | TradeSafe above R5,000; Paystack / PayFast / Ozow / Yoco / Stripe below. Lula never holds client funds |
| **Arrival handshake** | The pro shows a 6-digit code at your door; typing it unlocks their verified photo, ID name and certificate |
| **Proof of work** | Geotagged, hash-sealed before/after photos and certificates. A photo taken 2 km away holds the payout |
| **Release + warranty** | Confirm to release. 90% to the pro, 10% platform fee, and 5% held for a 14-day workmanship warranty |
| **Verified reviews** | Only customers whose escrow reached a terminal state can review — ratings cannot be bought |
| **Second vertical** | Verified vehicles: VIN/ownership/stolen/finance checks, tamper-removal, negotiation locks, and a Service Passport built from real escrow-released jobs |
| **Free microsite** | Every verified pro gets `/p/<slug>` — server-rendered HTML generated live from their trust ledger. No JavaScript required |

## The three promises, and where each is enforced

1. **No badge without evidence.** A verification check that arrives without its
   evidence keys is score-capped; a statutory trade without a certificate
   reference cannot reach `VERIFIED`; an offline adapter may return `WARN` or
   `UNAVAILABLE` but never `PASS`.
   → `src/kernel/verification.js`, `src/integrations/*`
2. **Money moves only on proof.** Escrow release requires accepted milestones;
   accepted milestones require evidence; evidence is geosealed against the job
   address.
   → `src/kernel/escrow.js`, policy `POW-001`
3. **The record cannot be quietly edited.** Every platform action appends to a
   SHA-256 hash-chained ledger; any mutation breaks the published integrity
   receipt.
   → `src/kernel/audit.js`, `GET /api/trust/ledger`

## Repository map

```
src/
  kernel/          Trust Kernel: audit ledger · verification · escrow · risk · policy
                   (vertical-agnostic; the old TrustShield engine lives in kernel/legacy/)
  marketplace/     services vertical: catalogue, people+KYC, jobs, bookings,
                   vehicles vertical, Web Studio, seeding, facade
  integrations/    every external dependency, offline-first and honestly labelled
  verticals/       services (LIVE) · vehicles (BETA) · property (COMING_SOON)
  server/          zero-dep router, static PWA serving, 124 API routes
pwa/               installable app: shell, manifest, service worker, icons, screens
data/              categories (32), geography (11 metros, 9 provinces), Web Studio catalogue
docs/              00 executive summary → 11 roadmap (+ archive/ with the original TrustShield docs)
scripts/           icon generator, integration probe, OpenAPI printer, healthcheck, store reset
test/              104 tests across 6 files
```

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/00-executive-summary.md`](docs/00-executive-summary.md) | what changed in the restructure, the proof table, how to run |
| [`docs/01-servicepro-parity-matrix.md`](docs/01-servicepro-parity-matrix.md) | 32-row parity matrix against myservicepro.co.za, plus declared gaps |
| [`docs/02-competitor-teardown.md`](docs/02-competitor-teardown.md) | 14 platforms with take-rate economics and attack surfaces |
| [`docs/03-innovative-features.md`](docs/03-innovative-features.md) | the 18 differentiators, each with mechanism, code and test |
| [`docs/04-public-data-and-integrations.md`](docs/04-public-data-and-integrations.md) | every endpoint, auth, cost, licence and fallback |
| [`docs/05-architecture.md`](docs/05-architecture.md) | layering rules, state machines, security posture |
| [`docs/06-api-reference.md`](docs/06-api-reference.md) | the generated route table (live at `/api/openapi.json`) |
| [`docs/07-trust-kernel-and-the-trustshield-merge.md`](docs/07-trust-kernel-and-the-trustshield-merge.md) | how the old engine became the kernel; the cross-vertical bridge |
| [`docs/08-compliance-and-risk.md`](docs/08-compliance-and-risk.md) | POPIA, FICA, ECT Act s44, statutory trades, data minimisation |
| [`docs/09-money-flow-and-unit-economics.md`](docs/09-money-flow-and-unit-economics.md) | escrow maths, refunds, take-rate comparison |
| [`docs/10-web-studio.md`](docs/10-web-studio.md) | preview-first websites delivered through milestone escrow |
| [`docs/11-roadmap-and-metrics.md`](docs/11-roadmap-and-metrics.md) | phases, targets, known risks |
| [`docs/archive/`](docs/archive/) | the original TrustShield solution, compliance plan and competitor notes, preserved |

## Highlights you should click on first

- **`/trust`** — the transparency page: ledger receipt, verification outcomes,
  published rule book, risk catalogue, integration mode.
- **`/admin`** — the trust desk: queues, high-risk subjects, escrow position,
  critical ledger events, scheduler sweep.
- **`/vehicles`** — the merged TrustShield vertical, including a listing whose
  condition report was produced by an escrow-released *service* job.
- **`/p/sipho-dlamini-plumbing`** — a free pro microsite, rendered without JavaScript.
- **`/web-studio`** — paste any URL into the free rescue diagnostic; the sealed
  report is yours whether or not you buy anything.
- **`/integrations`** — every public data source and partner, with what is live
  versus bundled right now, and `POST /api/integrations/probe` to re-check.

## Fairness guard (worth reading)

Locality and published crime statistics may only ever raise verification
friction — extra ID checks, arrival codes, two-person visits. They may never
change a pro's ranking, a customer's price or who may work where. The rule is
enforced in code (`RiskEngine.applyLocalitySignal` throws for any other
purpose) and regression-tested.

## Environment

| Variable | Effect |
| --- | --- |
| `PORT`, `HOST` | bind address (default `0.0.0.0:4173`) |
| `PROVERI_INTEGRATION_MODE` | `offline` (deterministic bundled data) or `live` (real free APIs) |
| `PROVERI_PERSIST` | `1` snapshots the store to `data/.store.json` |
| `ESP_API_TOKEN` | EskomSePush area schedules |
| `CIPC_API_KEY` | CIPC company status via a reseller |
| `PAYSTACK_SECRET_KEY` / `STRIPE_SECRET_KEY` / `TRADESAFE_API_KEY` | live payment rails |
| `CLICKATELL_API_KEY` / `BREVO_API_KEY` / `WHATSAPP_CLOUD_TOKEN` | live messaging |

Without any key the platform runs fully in honest simulation: every simulated
result is labelled `live: false` with a reason, and no check whose purpose is
external confirmation can return `PASS`.

## Licence and provenance

Proprietary reference implementation. Public data sources retain their own
licences (ODbL for OpenStreetMap, CC BY 4.0 for Open-Meteo, MIT for Nager.Date,
public-property status for SAQA NQF qualifications, public domain for Stats SA
and SAPS statistics). Competitor facts are drawn from public sites and published
coverage as at 2026-10-12.
