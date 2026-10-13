# ProVeri 🇿

**Upload your past work. Let home owners find you by it.**

📍 In South Africa, for South Africa 🇿🇦 · Connecting local businesses with home
owners · Reshaping the future of employment.

ProVeri is a South African marketplace whose front door is a **shelf of real
work**: individuals and small businesses publish the jobs they have done, home
owners browse what has been done near them, tap it, and message the person who
did it. Underneath that shop sits the machinery from
[myservicepro.co.za](https://www.myservicepro.co.za)'s product shape — post a
job, KYC-verified pros bid, your money sits in escrow until you confirm the work
— extended well past it: when a job closes, its geotagged proof of work publishes
itself back onto the shelf as proven work.

It ships as an **installable, offline-first PWA** with an e-commerce-shaped
interface (four tabs and one action button) plus a **zero-dependency REST API**
(184 operations across 164 paths), runs on **one Node 22 process with no
`node_modules`**, and is enforced by **200 tests**.

The interface is built like a shop, not a brochure: a translucent header and a
five-slot tab bar with the action button sitting in a notch, an inline SVG icon
set (no emoji in the chrome), gold half-star ratings, photo-first work cards that
name their verification tier exactly once, and 480 px thumbnails so a grid of
twelve jobs costs ~250 KB instead of ~2 MB. Light and dark themes share one token
set. `docs/13` §5.1 records the whole design system.

It also ships a **Business Site Studio**: ten industry templates that produce a
live, server-rendered business website at R0 build cost, where the booking form
is not a dead button — it creates a reservation with a reference number, or a
real escrow-protected marketplace job when the business is a verified pro. The
sales desk around it is a CRM with a free diagnostic, a demo builder and a
generated pitch kit.

```bash
npm start        # seeds a full demo marketplace · API + PWA on http://localhost:4173
npm test         # 208 tests: kernel, flows, portfolio, verticals, integrations, studio, sales desk, HTTP, PWA screens
npm run journey  # the whole product over live HTTP: sign-up → post → quote → escrow → arrival code → proof → payout → settlement → two-way reviews → cancel → refund
npm run demo     # one services journey printed end to end
npm run demo:vehicle   # one vehicle journey (the merged TrustShield rail)
npm run demo:studio    # research → diagnose → demo → pitch → win → publish → booking → job → export
```

Open `http://localhost:4173` and install it to your home screen from the
browser menu — it is a PWA with a service worker, offline catalogue and a
mutation queue, so a pro can submit proof of work from a basement with no
signal and it syncs on reconnect.

---

## What it does, in one screen

| | |
| --- | --- |
| **The work feed** | Pros publish past jobs — photos, what was done, what it cost, which suburb. Home owners browse it like a shop: search, trade, suburb, and "proven only" |
| **Three honest tiers** | *Uploaded by the pro* → *Proof of work* (linked to an escrow-released job, geotagged and hash-sealed) → *Client confirmed*. The tier is computed; policy `PRT-001` blocks any attempt to claim one, `PRT-002` blocks a photo another pro already published |
| **Reach out** | One tap messages the pro about that specific piece of work. The thread is participant-only, scanned for off-platform payment, and counted publicly |
| **It republishes itself** | `releasePayment()` harvests the job's sealed evidence into the pro's portfolio — proven work nobody had to remember to upload |
| **Post a job** | Plain-language description → category auto-resolved → every eligible verified pro in radius is matched and notified immediately |
| **Bids you can sanity-check** | Each bid carries Fair-Price Intelligence (real percentile bands per metro), the pro's trust score, certificate status and warranty terms |
| **Money into escrow** | TradeSafe above R5,000; Paystack / PayFast / Ozow / Yoco / Stripe below. Lula never holds client funds |
| **Arrival handshake** | The pro shows a 6-digit code at your door; typing it unlocks their verified photo, ID name and certificate |
| **Proof of work** | Geotagged, hash-sealed before/after photos and certificates. A photo taken 2 km away holds the payout |
| **Release + warranty** | Confirm to release. 90% to the pro, 10% platform fee, and 5% held for a 14-day workmanship warranty |
| **Verified reviews** | Only customers whose escrow reached a terminal state can review — ratings cannot be bought |
| **Second vertical** | Verified vehicles: VIN/ownership/stolen/finance checks, tamper-removal, negotiation locks, and a Service Passport built from real escrow-released jobs |
| **Free microsite** | Every verified pro gets `/p/<slug>` — server-rendered HTML generated live from their trust ledger. No JavaScript required |
| **Business Site Studio** | Ten industry templates → a live website at R0 build cost, monthly hosting, metered updates. The booking form creates a reservation with a reference, or a real escrow-ready job |
| **Permission-gated publishing** | A site cannot go public while any asset lacks a hash-chained permission record; identifiable faces need POPIA consent on top of copyright (policy `WEB-002`) |
| **Sales desk** | Weighted pipeline CRM, free 9-check website diagnostic, one-click demo build, and a pitch kit with the script, objections, plan and cold email already filled in |

## The three promises, and where each is enforced

1. **No badge without evidence.** A verification check that arrives without its
   evidence keys is score-capped; a statutory trade without a certificate
   reference cannot reach `VERIFIED`; an offline adapter may return `WARN` or
   `UNAVAILABLE` but never `PASS`; and a portfolio item cannot claim a
   verification tier it did not earn.
   → `src/kernel/verification.js`, `src/marketplace/portfolio.js`,
   `src/integrations/*`, policies `PRT-001`/`PRT-002`
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
                   portfolio (the work shelf), vehicles vertical, Web Studio,
                   Business Site Studio (businessSites.js), sales desk (leads.js),
                   seeding, facade
  integrations/    every external dependency, offline-first and honestly labelled
  verticals/       services (LIVE) · vehicles (BETA) · property (COMING_SOON)
  server/          zero-dep router, static PWA serving, 184 API operations,
                   server-rendered public site pages (/sites, /s/:slug, /preview/:slug)
pwa/               installable app: shell, manifest, service worker, icons, screens
                   (shop, market, work, verticals, trust, studio) and the demo
                   work photography in pwa/img/work/
data/              categories (32), geography (11 metros, 9 provinces), Web Studio
                   catalogue, 10 site templates, 3 studio plans + the sales playbook
docs/              00 executive summary → 13 portfolio & storefront (+ archive/
                   with the original TrustShield docs)
scripts/           icon generator, integration probe, OpenAPI printer, healthcheck, store reset
test/              200 tests across 10 files
```

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/00-executive-summary.md`](docs/00-executive-summary.md) | what changed in the restructure, the proof table, how to run |
| [`docs/01-servicepro-parity-matrix.md`](docs/01-servicepro-parity-matrix.md) | 46-row parity matrix against myservicepro.co.za and its demo-site repository, plus declared gaps |
| [`docs/02-competitor-teardown.md`](docs/02-competitor-teardown.md) | 14 platforms with take-rate economics and attack surfaces |
| [`docs/03-innovative-features.md`](docs/03-innovative-features.md) | the 25 differentiators, each with mechanism, code and test |
| [`docs/04-public-data-and-integrations.md`](docs/04-public-data-and-integrations.md) | every endpoint, auth, cost, licence and fallback |
| [`docs/05-architecture.md`](docs/05-architecture.md) | layering rules, state machines, security posture |
| [`docs/06-api-reference.md`](docs/06-api-reference.md) | the generated route table (live at `/api/openapi.json`) |
| [`docs/07-trust-kernel-and-the-trustshield-merge.md`](docs/07-trust-kernel-and-the-trustshield-merge.md) | how the old engine became the kernel; the cross-vertical bridge |
| [`docs/08-compliance-and-risk.md`](docs/08-compliance-and-risk.md) | POPIA, FICA, ECT Act s44, statutory trades, data minimisation |
| [`docs/09-money-flow-and-unit-economics.md`](docs/09-money-flow-and-unit-economics.md) | escrow maths, refunds, take-rate comparison |
| [`docs/10-web-studio.md`](docs/10-web-studio.md) | preview-first websites delivered through milestone escrow |
| [`docs/11-roadmap-and-metrics.md`](docs/11-roadmap-and-metrics.md) | phases, targets, known risks |
| [`docs/12-business-site-studio.md`](docs/12-business-site-studio.md) | the studio and the sales desk: templates, plans, the working booking form, the permission gate, metered updates, export, and what is declared but not faked |
| [`docs/13-portfolio-and-the-storefront.md`](docs/13-portfolio-and-the-storefront.md) | the work shelf: tiers, the `PRT` rules, the harvest flywheel, the enquiry loop, the four-tab storefront, and exactly what is verified end to end versus simulated |
| [`docs/archive/`](docs/archive/) | the original TrustShield solution, compliance plan and competitor notes, preserved |

## Highlights you should click on first

- **`/`** — the storefront: one line of copy, a pill search bar, a trade rail of
  nine circles, a full-bleed **hero job** (photo, price, pro, gold stars) and six
  more pieces of real work beneath it, plus one line telling you how much of the
  feed is proven.
- **`/browse`** — the shop floor: filter by trade, suburb (grouped by metro) and
  tier. Proven work outranks uploads; uploads are labelled, never hidden.
- **`/work/<id>`** — a product page for one job: the photos (or the sealed
  evidence record when there is no image), what the badge means, the pro, and two
  buttons: *Message about this* and *Hire for my job*.
- **`/upload-work`** — the pro side: a tap-to-add photo dropzone with local
  previews, what you did, and an optional ProVeri job link that earns the item its
  tier.
- **`/orders`** and **`/order/<id>`** — order tracking with a six-step escrow
  progress bar and a receipt for your money: total, released, warranty holdback
  with its date, the 10% fee, who holds it, and when it auto-releases.
- **`/me`** — everything that is not browsing or ordering, so the tab bar stays
  four items wide: wallet, trust and proof, the studios, the verticals, admin.
- **`/trust`** — the transparency page: ledger receipt, verification outcomes,
  published rule book, risk catalogue, integration mode.
- **`/admin`** — the trust desk: queues, high-risk subjects, escrow position,
  critical ledger events, scheduler sweep.
- **`/vehicles`** — the merged TrustShield vertical, including a listing whose
  condition report was produced by an escrow-released *service* job.
- **`/p/sipho-dlamini-plumbing`** — a free pro microsite, rendered without JavaScript.
- **`/web-studio`** — paste any URL into the free rescue diagnostic; the sealed
  report is yours whether or not you buy anything.
- **`/business-studio`** — ten industry templates, three plans, and the studio's
  own sites. Scaffold one and publish it in a minute.
- **`/sites`** — every published site, each with a booking form that works. Try
  `/s/thando-s-table` (restaurant) or `/s/egoli-airport-shuttles` (a shuttle
  operator whose fleet is rendered live from the vehicles vertical).
- **`/sales-desk`** — the pipeline: research a lead, run the free diagnostic,
  build the demo at R0, open the pitch kit.
- **`/preview/kloof-cellars`** — a site that *cannot* be published: two photos
  with no permission record, and policy `WEB-002` saying so.
- **`/integrations`** — every public data source and partner, with what is live
  versus bundled right now, and `POST /api/integrations/probe` to re-check.

## Fairness guard (worth reading)

Locality and published crime statistics may only ever raise verification
friction — extra ID checks, arrival codes, two-person visits. They may never
change a pro's ranking, a customer's price or who may work where. The rule is
enforced in code (`RiskEngine.applyLocalitySignal` throws for any other
purpose) and regression-tested.

## Cloud identity & data (Firebase + Supabase)

Real accounts, real posts — no demo logins:

- **Sign-in** is Firebase Auth: email + password (server-side `identitytoolkit`
  REST) or Google (the PWA runs the Firebase web SDK popup and the server
  verifies the ID token). Every Firebase identity maps onto a local marketplace
  profile the first time it signs in.
- **Posts are mirrored** to Supabase (`posts` table) the moment a job or a
  published work item is created, and photos upload straight from the phone
  into the public `photos` bucket. Feeds merge local seed content with cloud
  rows, so the marketplace is browsable even before the first cloud post.
- **Setup (once):** enable *Email/Password* and *Google* providers in the
  Firebase console ( authorised domains must include your preview/host), then
  run [`docs/cloud/supabase-schema.sql`](docs/cloud/supabase-schema.sql) in the
  Supabase SQL editor — it creates the tables, RLS policies and the `photos`
  bucket.
- **Honest degradation:** when the server cannot reach Firebase or Supabase
  (air-gapped CI, sandboxed dev), registration falls back to a local password
  hash labelled `local` on the session, mirrors are skipped *with a ledger
  note*, and `GET /api/cloud-config` reports `online: false` — the UI says so
  too. Nothing is ever disguised as a cloud write that did not happen.

## Environment

| Variable | Effect |
| --- | --- |
| `PORT`, `HOST` | bind address (default `0.0.0.0:4173`) |
| `PROVERI_INTEGRATION_MODE` | `offline` (deterministic bundled data) or `live` (real free APIs) |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` | Firebase Auth project (also read with the `VITE_` prefix; defaults are baked in) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_BUCKET` | Supabase project + storage bucket (also read with the `VITE_` prefix; defaults are baked in) |
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
