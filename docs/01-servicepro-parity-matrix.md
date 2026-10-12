# ServicePro parity matrix

Source of truth for the "as per myservicepro.co.za" requirement: the public site
([homepage](https://www.myservicepro.co.za), [Terms](https://www.myservicepro.co.za/terms.html),
[Privacy](https://www.myservicepro.co.za/privacy.html),
[Web Studio](https://www.myservicepro.co.za/get-a-website.html)), read on
2026-10-12. Every row below is implemented in this repository; the last column
names the module or route that does it.

Legend: **= parity**, **+ exceeds**, **→ reinterpreted** (same promise, better
mechanism).

## Marketplace core

| # | ServicePro promise (their words) | ProVeri | Status | Where |
| --- | --- | --- | --- | --- |
| 1 | "Post a job and get bids from KYC-verified pros near you" | Post-job wizard with category auto-resolution, radius matching, instant notifications to every eligible verified pro | = | `marketplace/jobs.js`, `POST /api/jobs`, PWA `/post-job` |
| 2 | "Your money stays safe in escrow until the work is done" | Escrow shadow records over regulated partners (TradeSafe / Paystack / PayFast / Ozow / Yoco / Stripe); release only on accepted proof of work | = | `kernel/escrow.js`, `marketplace/bookings.js` |
| 3 | "The pro only gets paid after you confirm the job is done" | `confirmCompletion` → release; confirmation window lapse auto-releases per the terms | = | `bookings.confirmCompletion`, `escrow.runAutoReleaseSweep` |
| 4 | "Dispute? Our team reviews and refunds or releases fairly" | Dispute centre with a 72-hour evidence window, published evidence weighting, partial outcomes and redo orders | + | `bookings.openDispute/resolveDispute`, policy layer |
| 5 | "Providers pass ID verification (KYC) before they can bid" | 9-stage pipeline: SA ID checksum + DHA-format decode, SMS+email OTP, AVS-R bank name match, CIPC, SARS TCS, SAQA/NQF, statutory certificate, insurance, declaration | + | `marketplace/people.js`, `POST /api/pros/:id/verify` |
| 6 | "Real reviews from real completed jobs — no fake ratings" | Reviews are only creatable on escrow-released bookings (policy `REV-001`), plus a manipulation scanner for reviewer clusters and micro-job five-stars | + | policy `REV-001`, `bookings.detectReviewManipulation` |
| 7 | "In-app help tickets with photo evidence" | Tickets with photo hashes and SLA targets | = | `marketplace.openTicket`, `/api/tickets` |
| 8 | "Based in South Africa, for South Africa" | ZAR-only pricing, SAST dates, SA banks and branch codes, SA metros/suburbs/postcodes, POPIA-first data handling, isi-flavoured copy ("Mzansi") | = | `data/geography.json`, `integrations/bankVerification.js` |
| 9 | 90/10 split (pro keeps 90%) | Same split; published on every bid and booking screen | = | `kernel/escrow.js` fee config |
| 10 | Auto-release if the customer neither confirms nor disputes in the window | 48-hour window, scheduler sweep, customer notified that it happened and why | = | `escrow.runAutoReleaseSweep`, scheduler |
| 11 | ECT Act s44 seven-day cooling-off, lost once work starts with consent | Same rule, stated in the cancel flow and in the cancellation record | = | policy `CAN-001`, `bookings.cancel` |
| 12 | Providers are independent contractors; platform is not an insurer | Same position, plus an optional per-job liability cover upsell and an RPL pathway for uncertified skill | + | `people`, terms copy in PWA |
| 13 | Email verification before posting or bidding | Email + mobile OTP for both sides | = | `people.verifyCustomerChannel` |
| 14 | Optional two-factor authentication | Declared in the trust card; session model ready | = | `people` session fields |

## Payments and partners

| # | ServicePro | ProVeri | Status | Where |
| --- | --- | --- | --- | --- |
| 15 | Paystack or Stripe for customer payment | Both, plus PayFast, Ozow, Yoco and **TradeSafe** for jobs above R5,000 and vehicle purchases | + | `kernel/escrow.js PROVIDERS` |
| 16 | "TradeSafe Escrow Secured" badge | TradeSafe as a first-class escrow/paymaster adapter with milestone, split, lay-by and drawdown structures documented | + | `kernel/escrow.js`, `docs/04` |
| 17 | Brevo transactional email | Brevo adapter + channel abstraction (email/SMS/WhatsApp/push) | = | `integrations` catalogue |
| 18 | Clickatell SMS verification codes | Clickatell adapter for OTPs **and** arrival codes | + | `integrations` catalogue |
| 19 | Sentry error monitoring, PostHog analytics | Declared in the integration catalogue with POPIA scope (no message contents) | = | `integrations.CATALOGUE` |
| 20 | Render / Vercel / Neon hosting | Deployment-agnostic: one zero-dependency Node process serves API + PWA; container healthcheck script included | → | `src/server`, `scripts/healthcheck.js` |

## Web Studio

| # | ServicePro package | ProVeri | Status | Where |
| --- | --- | --- | --- | --- |
| 21 | Digital Storefront — R3,500 once-off | Same price, same inclusions, delivered through milestone escrow | = | `data/webstudio.json`, `marketplace/webstudio.js` |
| 22 | Website-as-a-Service — R1,500 + R450/mo | Same, plus a monthly report showing trust score, review velocity and jobs won from the site | + | `data/webstudio.json` |
| 23 | Business Growth Storefront — R7,500 | Same, plus an embeddable ProVeri booking widget so the client's site takes escrow-protected bookings | + | `data/webstudio.json` |
| 24 | Premium E-Commerce — R15,000 | Same, plus optional TradeSafe escrow on high-value orders | + | `data/webstudio.json` |
| 25 | "Page 3" Website Rescue — from R2,500 | Same, plus a free machine-generated 9-check diagnostic that the customer keeps whether or not they buy | + | `webstudio.rescueDiagnostic`, `POST /api/webstudio/diagnostic` |
| 26 | Student & Individual — R450–R1,000 | Same, and every verified pro gets a **free** data-bound microsite anyway | + | `webstudio.generateProMicrosite` |
| 27 | "Preview first, pay after" | Enforced by the order state machine: escrow opens only after preview approval | = | `webstudio.approvePreview` |
| 28 | Get Recommended on Google — R650 | Same scope, with the same honest boundary, plus review requests fired only after escrow-released jobs | + | `data/webstudio.json` |
| 29 | Automate Your WhatsApp — R550 | Same scope and honest boundary, plus a quick-reply that routes enquiries back into escrow | + | `data/webstudio.json` |
| 30 | Get Customer Leads — R1,200 | Same scope; ad creative auto-features the live trust badge and rating | + | `data/webstudio.json` |
| 31 | Posters & Brand Kit — R499 | Same scope; banking details on the price card replaced by a ProVeri payment link | + | `data/webstudio.json` |
| 32 | WhatsApp enquiry capture (wa.me link) | Same, plus Web Share Target so any chat can post a job into ProVeri | + | `manifest.webmanifest share_target` |

## Where ProVeri goes past parity

The matrix above is the floor. The differentiators — load-shedding-aware
scheduling, weather-aware quoting, geosealed proof of work, the workmanship
warranty holdback, the arrival-code identity handshake, Fair-Price
Intelligence, the Vehicle Service Passport, Remit-a-Job, the SARS-ready income
summary, the free microsite, the cross-vertical evidence bridge and the
published fairness guard — are detailed in
[`03-innovative-features.md`](03-innovative-features.md).

## Honest gaps (declared, not hidden)

| Gap | Why | Plan |
| --- | --- | --- |
| No live Paystack/Stripe keys in this deployment | Sandbox has no merchant accounts; adapters are honest-simulation until a key is set | Set `PAYSTACK_SECRET_KEY` / `STRIPE_SECRET_KEY`; the adapter contract is already the live one |
| CIPC company status cannot be confirmed offline | CIPC has no free public API; resellers need credit | `CIPC_API_KEY` switches the OmniCheck/CompanyData adapter on; offline returns an explicit `WARN`, never a `PASS` |
| EskomSePush area schedules need a paid plan | Free tier only exposes national stage | `ESP_API_TOKEN`; offline derives a clearly-labelled schedule |
| Property vertical is not live | Deeds Office and municipal clearance have no stable public API; conveyancer trust accounts already protect deposits by law | Waitlist + published reasons in `src/verticals/index.js` and PWA `/property` |
