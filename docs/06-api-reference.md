# API reference

124 routes, generated below straight from the registered route table so this
document cannot drift from the code. The machine-readable OpenAPI 3.1 document
is served live at `GET /api/openapi.json` and can be regenerated with
`npm run openapi`.

Conventions:

- All amounts are **integer cents** in ZAR unless a field name says otherwise.
- All timestamps are ISO-8601 UTC.
- Errors are `{ error, message, details?, policyDecision?, correlationId }`
  with a meaningful HTTP status; policy violations include the rule ids that fired.
- Reads are cacheable by the service worker; writes are network-only and queued
  offline.


## platform

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness, integration posture and ledger integrity receipt |
| `GET /api/snapshot` | Public landing snapshot — live proof, not marketing adjectives |
| `GET /api/offline-bundle` | Everything the PWA needs to render and work offline on first paint |
| `GET /api/openapi.json` | OpenAPI 3.1 document generated from the registered routes |
| `GET /api/verticals` | Verticals: services (live), vehicles (beta), property (coming soon) |
| `POST /api/verticals/:verticalId/waitlist` | Join the property-vertical waitlist |
| `POST /api/scheduler/run` | Run the scheduler sweep: auto-release, warranty close, dispute escalation, job expiry |
| `GET /api/stats` | Platform telemetry |

## catalogue

| Route | Purpose |
| --- | --- |
| `GET /api/categories` | Service categories with statutory trade rules, price bands and evidence requirements |
| `GET /api/categories/:categoryId` | One category in full |
| `GET /api/metros` | Metros, provinces and suburb counts |
| `GET /api/metros/:metroId/suburbs` | Suburbs in a metro with coordinates and postal codes |
| `GET /api/price-band` | Fair-Price Intelligence band for a category in a metro |
| `POST /api/catalogue/resolve` | Resolve a free-text job description to a category |
| `GET /api/geography/search` | Geocode a South African address (live OSM Nominatim, bundled fallback) |
| `GET /api/geography/nearby` | Suburbs within a radius of a coordinate |

## people

| Route | Purpose |
| --- | --- |
| `POST /api/customers` | Register a customer |
| `POST /api/customers/:customerId/verify-channel` | Confirm an email or mobile one-time PIN |
| `GET /api/customers/:customerId` | One customer |
| `POST /api/pros` | Register a service professional (draft — cannot bid until verified) |
| `POST /api/pros/:proId/verify` | Run the full multi-source KYC / trade verification pipeline |
| `GET /api/pros` | Search verified pros by category, metro, radius, badge and instant-book |
| `GET /api/pros/:proId` | Public pro profile with verified reviews and audit timeline |
| `GET /api/pros/:proId/trust` | Full trust card: every check, its source, reference, seal and expiry |
| `GET /api/pros/:proId/tax-summary` | SARS-ready income summary built from the escrow ledger |
| `GET /api/pros/:proId/wallet` | Wallet: balance, escrow held, warranty holdbacks, payout rails |
| `POST /api/pros/:proId/bank-change` | Change payout bank details — policy BDS-001 freezes payouts until call-back verification |
| `GET /api/banks` | Supported South African banks, universal branch codes and payout rails |

## trust

| Route | Purpose |
| --- | --- |
| `GET /api/trade-registers` | Statutory trade registers: NHBRC, PSIRA, PIRB, SAQCC, DoEL, PPRA, LPC, SANC |
| `POST /api/verify/sa-id` | Validate a 13-digit South African ID (Luhn + date + citizenship decode), free and offline |
| `POST /api/verify/bank` | Verify payout bank details (shape locally, AVS-R name match via adapter) |
| `POST /api/verify/registration-number` | Validate a CIPC registration number format and decode the entity type |
| `POST /api/verify/company` | CIPC company status check (live with a key; honest WARN offline) |
| `GET /api/verify/qualifications/:trade` | SAQA / NQF qualifications for a trade |
| `POST /api/verify/rpl-pathway` | Recognition of Prior Learning pathway for skilled but uncertified pros |
| `GET /api/trust/ledger` | Hash-chained audit ledger and integrity receipt |
| `GET /api/trust/proof/:subjectId` | Verifiable proof for one subject — the receipt a customer or insurer can check |
| `GET /api/trust/transparency` | Public transparency report: what the platform did, provably |
| `GET /api/trust/policies` | The published rule book: what each policy protects, when it fires, what it does |
| `GET /api/trust/risk/:subjectId` | Risk position for one subject (safety signals withheld) |

## jobs

| Route | Purpose |
| --- | --- |
| `POST /api/jobs` | Post a job — matching, weather, load-shedding and holiday advice run immediately |
| `GET /api/jobs` | List jobs |
| `GET /api/jobs/:jobId` | One job with its bids, market band, weather, load-shedding and safety advice |
| `PATCH /api/jobs/:jobId` | Amend a job — existing bids are flagged for re-consent because the scope changed |
| `GET /api/jobs/:jobId/match` | Explainable pro matching with a published fairness statement |
| `POST /api/jobs/:jobId/bids` | Submit a bid — KYC-001, TRD-001 and ECC-001 are enforced before it is accepted |
| `GET /api/jobs/:jobId/instant-quote` | Fixed-price instant-book quote |
| `POST /api/jobs/:jobId/beat-the-quote` | Invite competing verified pros to beat a specific bid |

## bidding

| Route | Purpose |
| --- | --- |
| `POST /api/bids/:bidId/withdraw` | Withdraw a bid |
| `GET /api/bids` | List bids |

## bookings

| Route | Purpose |
| --- | --- |
| `POST /api/bookings` | Accept a bid — creates the booking, opens escrow and issues the arrival gate code |
| `GET /api/bookings` | List bookings |
| `GET /api/bookings/:bookingId` | One booking with escrow, evidence, payout, dispute and audit trail |
| `POST /api/bookings/:bookingId/fund` | Fund the escrow (domestic or Remit-a-Job from abroad) |
| `POST /api/bookings/:bookingId/eta` | Pro shares a live ETA |
| `POST /api/bookings/:bookingId/arrival-code` | Verify the pro’s one-time arrival code at the door |
| `POST /api/bookings/:bookingId/check-in` | Record an arrival, start or departure check-in |
| `GET /api/bookings/:bookingId/safety-plan` | Pre-visit safety plan — verification friction only, never ranking |
| `POST /api/bookings/:bookingId/evidence` | Submit geotagged, hash-sealed proof of work |
| `POST /api/bookings/:bookingId/confirm` | Confirm the work — releases escrow, pays the pro, starts the warranty |
| `POST /api/bookings/:bookingId/reject` | Reject submitted work — money stays in escrow |
| `POST /api/bookings/:bookingId/variations` | Propose a variation order — the locked scope cannot change without customer approval |
| `POST /api/bookings/:bookingId/variations/:variationId/decide` | Approve or decline a variation order |
| `POST /api/bookings/:bookingId/cancel` | Cancel a booking — ECT Act s44 cooling-off applies before work starts |
| `POST /api/bookings/:bookingId/warranty-defect` | Report a defect inside the workmanship warranty window |
| `POST /api/bookings/:bookingId/messages` | Send a message — policy OFP-001 detects off-platform payment solicitation |
| `GET /api/bookings/:bookingId/messages` | Booking conversation |

## disputes

| Route | Purpose |
| --- | --- |
| `POST /api/bookings/:bookingId/disputes` | Open a dispute — escrow freezes immediately |
| `GET /api/disputes` | List disputes |
| `POST /api/disputes/:disputeId/evidence` | Submit dispute evidence |
| `POST /api/disputes/:disputeId/resolve` | Resolve a dispute with published evidence weighting |

## reviews

| Route | Purpose |
| --- | --- |
| `POST /api/bookings/:bookingId/reviews` | Write a review — REV-001 allows only escrow-released bookings, so ratings cannot be bought |
| `GET /api/reviews` | Verified reviews only |
| `POST /api/reviews/:reviewId/respond` | Pro responds to a review |
| `GET /api/reviews/integrity/:proId` | Review-integrity scan: repeated reviewers, bursts and micro-job five-stars |

## vehicles

| Route | Purpose |
| --- | --- |
| `GET /api/vehicles` | Verified vehicle listings |
| `POST /api/vehicles` | Create a vehicle listing |
| `GET /api/vehicles/:listingId` | One vehicle listing with audit trail and release order |
| `GET /api/vehicles/:listingId/buyer-answer` | The full buyer question, answered check by check |
| `PATCH /api/vehicles/:listingId` | Edit a listing — VCL-001 removes it if a verified identifier changed |
| `POST /api/vehicles/:listingId/checks` | Submit vehicle verification checks |
| `POST /api/vehicles/:listingId/negotiations` | Start negotiating — locks description, price and terms |
| `POST /api/vehicles/:listingId/addenda` | Propose an addendum to locked terms |
| `POST /api/vehicles/:listingId/funds-confirmation` | Privacy-preserving buyer funds confirmation |
| `POST /api/vehicles/:listingId/escrow` | Open escrow with the title-holder release order |
| `POST /api/vehicles/:listingId/handover-evidence` | Submit handover evidence — a VIN mismatch removes the listing |
| `POST /api/vehicles/:listingId/release` | Release escrow after handover acceptance |
| `GET /api/vehicles/passport/:vin` | Vehicle Service Passport — every entry backed by an escrow-released job |
| `POST /api/vehicles/passport` | Append a service entry to a Vehicle Service Passport |
| `POST /api/vehicles/bridge` | Bridge a completed service job into the vehicles vertical — the cross-vertical merge |
| `POST /api/vehicles/vin-check` | ISO 3779 VIN structure and check-digit analysis |

## webstudio

| Route | Purpose |
| --- | --- |
| `GET /api/webstudio` | Web Studio catalogue, growth services and stats |
| `GET /api/webstudio/microsites` | Free auto-generated pro microsites |
| `POST /api/webstudio/microsites/:proId/generate` | Generate or regenerate a pro’s free microsite from the verified profile |
| `POST /api/webstudio/orders` | Start a Web Studio enquiry — preview before you pay |
| `GET /api/webstudio/orders` | List Web Studio orders |
| `POST /api/webstudio/orders/:orderId/preview` | Build the live preview (R0 taken so far) |
| `POST /api/webstudio/orders/:orderId/preview-decision` | Approve or request changes to the preview — escrow opens only on approval |
| `POST /api/webstudio/orders/:orderId/pay` | Pay into escrow after preview approval |
| `POST /api/webstudio/orders/:orderId/milestones/:seq/complete` | Complete a Web Studio milestone and release that portion |
| `POST /api/webstudio/diagnostic` | Free website rescue diagnostic — yours whether or not you buy anything |

## integrations

| Route | Purpose |
| --- | --- |
| `GET /api/integrations` | Every external dependency: endpoint, cost, licence, auth and live/offline posture |
| `POST /api/integrations/probe` | Probe the free public sources and report what actually answered |
| `GET /api/public/weather` | Open-Meteo forecast (free, no key) |
| `GET /api/public/holidays` | South African public holidays (Nager.Date, free) |
| `GET /api/public/fx` | ZAR exchange rates (ExchangeRate-API open tier) |
| `POST /api/public/fx/remit-quote` | Remit-a-Job quote: family abroad funds a job for a relative in South Africa |
| `GET /api/public/loadshedding` | Load-shedding status and area schedule |
| `POST /api/public/loadshedding/slots` | Load-shedding-clear job slots for power-dependent work |
| `POST /api/public/weather/job-advice` | Weather-aware job-day advice for exterior trades |
| `GET /api/public/postal-code/:code` | SA postal code lookup (Zippopotam.us, free) |
| `GET /api/public/market-context` | Stats SA labour market and CPI context |

## admin

| Route | Purpose |
| --- | --- |
| `GET /api/admin/console` | Trust-desk console: queues, ledger integrity, high-risk subjects, escrow position |
| `POST /api/admin/risks` | Record a risk signal |
| `POST /api/admin/risks/:subjectId/:signalId/resolve` | Resolve a risk signal |
| `POST /api/admin/pros/:proId/suspend` | Suspend a pro |
| `POST /api/admin/pros/:proId/refresh-standing` | Recompute a pro’s badge and bidding clearance |

## support

| Route | Purpose |
| --- | --- |
| `POST /api/tickets` | Open a help ticket with photo evidence |
| `GET /api/tickets` | List help tickets |
| `POST /api/tickets/:ticketId/reply` | Reply to or resolve a ticket |
| `GET /api/notifications/:userId` | Notification inbox |
| `POST /api/notifications/:notificationId/read` | Mark a notification read |

## demo

| Route | Purpose |
| --- | --- |
| `GET /api/demo/roster` | Demo roster of synthetic customers and pros |
| `GET /api/demo/synthesise-sa-id` | Generate a syntactically valid synthetic SA ID |
