# Business Site Studio & the sales desk

Two products, one pipeline. The **studio** turns an industry template into a
live, server-rendered business website in under a minute, with a booking form
that does something. The **sales desk** is the field-research CRM that sells it:
research a business, diagnose its website for free, build the demo before the
meeting, walk in with a generated pitch kit, and record what happened.

Reference: the [MyServicePro_Demos](https://github.com/Albert-Machuene-Dev/MyServicePro_Demos)
repository, cloned and read on 2026-10-12 — seven hand-built React demo sites,
a restaurant template, a scaffolder script, and six markdown playbooks
(pricing, pitch script, lead list, permission checklist, AI image workflow,
GitHub setup). Everything in it that genuinely works end to end is implemented
here; everything that only *looked* like it worked has been made to work.

```
npm run demo:studio     # the whole journey, printed, with its ledger entries
```

## 1. What the reference repo does, and what we changed

| MyServicePro_Demos | Status here | Where |
| --- | --- | --- |
| `businesses/*/src/data/restaurant.json` — one JSON file drives menu, hours, gallery, testimonials, theme | **Kept, generalised**: `data/webstudio-templates.json` holds ten industry templates with sections, booking schemas, sample catalogues and theme presets | `businessSites.scaffold`, `GET /api/sites/templates` |
| `templates/restaurant-demo-template/BookingModal.jsx` — the "booking" shows a toast and disappears | **Made real**: three intake kinds, server-side validation against the template schema, a reference number, a quote, an owner notification, a ledger entry | `businessSites.submitBooking`, `POST /api/sites/:siteId/bookings` |
| Ordering / reservations / CRM / analytics / AI assistant listed as Enterprise features | Reservations and job intake are live on every plan from R1,799; CRM is the sales desk; analytics is `site.stats` + `/api/stats`; ordering and the assistant are **declared, not faked** (see §10) | `leads.js`, `businessSites.stats` |
| `docs/pricing-packages.md` — Essential R999 / Business Growth R1,799 / Enterprise R2,999+, zero upfront build cost, 2/5/unlimited updates per month | Same prices and allowances, but the allowance is **enforced by policy** and an extra update is billed at a published rate instead of silently absorbed | `data/webstudio-plans.json`, policy `WEB-001` |
| `docs/lead-list-template.md` — a spreadsheet of leads with a status vocabulary and priority 1–5 | A real CRM: 11 weighted stages, the same seven-value status vocabulary, priority-derived follow-up dates, next-best-actions | `leads.js`, `/api/leads*` |
| `docs/pitch-script.md` — a 60-second script, best window 14:30–16:30, show-don't-tell, risk reversal | `pitchKit()` returns the script with this lead's numbers substituted, plus objections, the plan to recommend, the cold email, the WhatsApp opener, the permission checklist and the AI-image budget | `leads.pitchKit` |
| `docs/permission-checklist.md` — a markdown checklist, "giving credit is not permission" | A **hash-chained permission record that gates publishing**, with POPIA consent as a separate condition when a face is identifiable | policy `WEB-002`, `businessSites.recordPermission` |
| `docs/ai-image-workflow.md` — FoodShot AI / FLUX Schnell / Upscayl, a reusable prompt template | Prompt generator per catalogue item, the same budget stack, and a labelling rule that is enforced on the page rather than recommended in a doc | policy `WEB-003`, `businessSites.aiImagePrompt` |
| `manual-staging/classification.json` — a human labels each downloaded image with dish, category, suggested use | Classification on intake against the industry vocabulary, with an explicit `placement` (CATALOGUE vs GALLERY), a confidence score, `needsReview` when it is a guess, and auto-filing onto the matching catalogue item | `businessSites.classify`, `#attachToCatalogue` |
| `scripts/create-restaurant.js`, `deploy-all`, `inline-images`, GitHub Pages Actions workflow | Scaffold, export single file (assets inlined), export bundle with index + sitemap + README + a working Actions workflow | `businessSites.exportSite`, `exportBundle` |
| Every demo hard-codes the same monochrome theme | Ten templates with their own palettes, per-template presets, and a WCAG AA contrast check on any custom palette | `businessSites.updateTheme`, `withContrast` |

## 2. Templates

Ten industries, each with its own sections, booking schema, catalogue wording
and sample content — enough that a preview exists before the first conversation.

| id | label | sections | intake | CTA | catalogue | sample | required fields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `restaurant` | Restaurant & eatery | 12 | RESERVATION | Book a table | Menu | 5 items | 5/6 |
| `cafe-bakery` | Café, bakery & deli | 11 | ENQUIRY | Pre-order | On the counter | 3 items | 5/5 |
| `accommodation` | Guesthouse, B&B & self-catering | 12 | RESERVATION | Check availability | Rooms & rates | 4 items | 5/8 |
| `wine-estate` | Wine estate, cellar & tasting room | 12 | RESERVATION | Book a tasting | Tastings & wines | 4 items | 5/7 |
| `fashion-retail` | Fashion, craft & lifestyle retail | 12 | ENQUIRY | Order / reserve | Collections | 4 items | 4/6 |
| `transport-transfers` | Transport, shuttles & transfers | 13 | JOB | Book a transfer | Services & rates | 5 items | 7/9 |
| `tours-travel` | Tours, safaris & travel | 12 | ENQUIRY | Request an itinerary | Tours & packages | 4 items | 5/7 |
| `trade-services` | Trade & home services (ProVeri native) | 13 | JOB | Book this pro | Services & prices | 3 items | 6/9 |
| `beauty-wellness` | Beauty, wellness & fitness | 12 | RESERVATION | Book an appointment | Treatments | 3 items | 5/7 |
| `professional-services` | Professional & business services | 11 | ENQUIRY | Book a consultation | Services | 3 items | 5/7 |

Section kinds: `SPLASH, HEADER_NAV, HERO, CATALOGUE, GALLERY, ABOUT,
TESTIMONIALS, HOURS_LOCATION, BOOKING, TRUST_BLOCK, FLEET, FAQ, CONTACT,
FLOATING_CTA, FOOTER`. `trade-services` is **pro native** (it renders the live
ProVeri trust block); `transport-transfers` carries the **fleet bridge** (§7).

## 3. Plans

| id | name | monthly | setup | updates/mo | extra update | pages | delivery |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `essential` | Essential Start | R999 | **R0** | 2 | R150 | 1 | 3 days |
| `business-growth` | Business Growth | R1,799 | **R0** | 5 | R150 | 3 | 5 days |
| `enterprise` | Enterprise Power | R2,999 | **R0** | unlimited | — | custom | 12 days |

Each plan publishes its own `honestBoundary` ("two updates a month means price
and photo changes, not a redesign") and its `proveriUpgrade` — the thing a
website platform cannot copy because it is not a marketplace. A 13-row
feature-by-feature comparison is served at `GET /api/sites/plans`.

Money is never taken on a promise: `subscribe()` opens an escrow record for
month one, and `publish()` releases that milestone. The release carries the
same 10% platform fee and 5% workmanship holdback as a plumbing job, because it
is the same engine.

## 4. The booking form that works

`submitBooking(slugOrId, values, { source, ip, userAgent })` validates against
the template's own schema (required fields, phone format, date not in the past,
time `HH:MM`, select values must be offered options), then:

| intake | what happens |
| --- | --- |
| `RESERVATION` | A booking record with `BKG-nnnnnn`, a quote where one can be derived honestly, `status: NEW`, an owner notification, and a customer-facing message that says who confirms and how |
| `JOB` (site linked to a verified pro) | All of the above **plus** a real marketplace job: the visitor becomes a customer account, the category is resolved from the request text, the budget and urgency are carried across, the pro is notified, and the job is bid-able into escrow like any other |
| `JOB` (no linked pro) | Booking only. We do not hand a business's customer to its competitors |
| any intake on an unpublished preview | A warm sales lead at priority 5, linked to the site — a demo that gets a booking is a lead that just raised its hand |

Quoting is deliberately conservative: a price is quoted only when the visitor
named an item that exists in the catalogue (exact name, then token overlap) or
stated a budget. Per-head prices ("R1,290 pp") multiply by the party size.
Otherwise `amountQuotedCents` is `0` and the message says *to be quoted* —
inventing a number from an unrelated menu item is how a website loses a
customer's trust before the business has even replied.

Every booking is a `SITE_BOOKING_RECEIVED` ledger entry, `MONEY`-level when it
opened a job.

## 5. Assets: classified, filed, permission-gated, labelled

`addAsset()` classifies on intake against the industry vocabulary and returns
`{ category, confidence, placement, needsReview, matchedTokens, note }`:

- `placement: 'CATALOGUE'` → the photo is filed onto the best-matching catalogue
  item (token overlap between caption/filename and item name/description, only
  onto items that have no image yet) so the menu is illustrated, not a folder of
  files;
- `placement: 'GALLERY'` → ambience, interiors, fleet, credentials, team;
- `category: 'uncategorised'` → `needsReview: true` with a note that says a human
  must decide. Guessing is recorded as guessing.

Publishing is gated by policy **WEB-002**: a site cannot go `LIVE` while any
asset lacks a permission record. `recordPermission()` writes a checklist-backed
record (`OWNER_PERMISSION`, `COPYRIGHT_CLEARED`, `POPIA_CONSENT`,
`AI_DISCLOSURE`, `MODEL_RELEASE`, `SOURCE_LOGGED`), seals it with a sha256 over
the asset list and the grant, and appends it to the ledger. Where an image
contains identifiable people, copyright clearance is not enough: POPIA consent
is a separate, required condition, and the gate stays closed without it.

Policy **WEB-003** covers generated images. An `aiGenerated` asset renders an
"Illustrative image" note wherever it appears, and an AI asset used as a
full-bleed hero — where there is nowhere to put a note — is counted as
`aiUnlabelled` and flagged before publish. `aiImagePrompt()` returns the prompt,
the budget stack, and the labelling rule in the same response, so the rule
travels with the prompt instead of living in a document nobody opens.

## 6. Updates are metered (WEB-001)

`updateContent()` on a live site consumes one credit. When the allowance is
gone, the edit is **refused** with the reason and the options:

```
Update allowance for Business Growth is used up (5/5 this month).
Renew, upgrade, or approve an extra update at R150.
```

`{ renew: true, upgrade: ['enterprise'], extraUpdateCents: 15000 }` comes back
with the decision, so a client can be told the truth and choose. Passing
`approveExtra: true` bills the published rate and does **not** consume a credit.
`renewSubscription()` bills the next month and resets the allowance;
`cancelSubscription()` leaves the export available, because the content is the
client's.

## 7. Rendering

`renderSiteHtml()` is zero-dependency string assembly — no template engine, no
build step, no runtime dependency:

- a real `<form method="post">` with a `<noscript>` path and a WhatsApp fallback,
  so the booking works with JavaScript disabled;
- CSS-only menu tabs (radio inputs) and a CSS-only gallery lightbox (`:target`);
- `LocalBusiness` JSON-LD (raw JSON — escaping it would silently break
  structured data), `lang="en-ZA"`, theme as CSS custom properties;
- a `demo-bar` on any preview, so a preview can never be mistaken for a launch;
- **fleet bridge**: a transport or tours template renders the operator's
  vehicles straight from the vehicles vertical, with their verification state
  and sealed passport references — one platform's evidence, two products;
- **trust block**: a pro-native site projects the live trust score, the checks
  that passed with their sources, escrow-backed reviews and a link to the public
  ledger.

Public URLs: `/sites` (gallery), `/s/<slug>` (live only), `/preview/<slug>`
(unlisted), `/export/<slug>` (the file), plus `robots.txt` and `sitemap.xml`.

## 8. Export and deployment

`exportSite()` returns one self-contained HTML file (CSS inlined, assets inlined
as data URLs) with `bytes` and `sha256` so a handover can be proven.
`exportBundle()` returns every published site as `<slug>/index.html`, an index
page, a sitemap, a README that carries the permission checklist, and a GitHub
Actions workflow that deploys to Pages on push. Three targets are documented in
`data/webstudio-plans.json`: ProVeri hosting, GitHub Pages, own domain.

## 9. The sales desk

Stages (`NEW → RESEARCHED → DIAGNOSED → DEMO_BUILT → CONTACTED →
MEETING_BOOKED → PREVIEW_SENT → NEGOTIATION → WON`, plus `LOST` and `NURTURE`)
each carry a forecast weight, so `weightedPipelineCents` means something. An
open lead with no plan chosen yet is priced at the plan we would pitch — a
pipeline that reads R0 until the deal closes is not a forecast.

The website-status vocabulary is the one the field team writes down, and each
value carries the priority it implies and the sentence we say out loud:

| status | severity | what we say |
| --- | --- | --- |
| No website | 5 | There is no website at all — a Facebook page is the whole channel. |
| Broken | 5 | It throws errors, dead links or an SSL warning before a customer gets to the menu. |
| Outdated | 4 | It looks like 2012 — the menu and the prices are years old. |
| Slow on mobile | 4 | It works on a desktop and is unusable on the phone most South Africans actually use. |
| Minimal | 3 | There is no booking button anywhere on it, so a customer has to phone. |
| Generic template | 3 | It is a stock template with placeholder text and stock photos still in it. |
| Healthy | 1 | It is fast, current and has a clear call to action — honestly, you may not need us. |

`diagnose()` runs the nine-check rescue diagnostic. **Offline it says so**:
`simulated: true`, `healthScore: null`, a note naming the environment variable,
and the field research is kept rather than overwritten by a fabricated "site is
down". A lead diagnosed offline lands in `RESEARCHED`, not `DIAGNOSED`.

`buildDemo()` scaffolds a preview at R0, sets it to `PREVIEW`, links it to the
lead and returns the pitch kit with it. `pitchKit()` returns the timing window
(14:30–16:30, never during a rush), the beat-by-beat script with this lead's
numbers substituted, the objection answers, the recommended plan with the
reason and the anchor strategy, the cold email and WhatsApp opener, the
permission checklist and the AI-image budget. The script has a
`lineWithoutDemo` variant, and the email and WhatsApp copy change tense, so
nothing claims a preview exists before `buildDemo` has run.

`convert()` builds or reuses the site, starts the subscription with month one in
escrow, and records a `MONEY`-level ledger entry naming the cycle length and the
number of touches it took.

Outreach is consent-checked, not consent-noted:

- **LEAD-001** (BLOCK): after a POPIA objection, every channel — phone,
  WhatsApp, email, SMS, walk-in, meeting — is refused with the objection date in
  the message. The objection is a `PUBLIC`, `TRUST`-level ledger entry. An
  objection from a paying customer sets `result: 'OPT_OUT'` and keeps `WON`:
  they are still a customer, only the marketing stops.
- **LEAD-002** (WARN): outreach outside 08:00–18:00 SAST or on a weekend is
  logged with the warning attached, because a warning a salesperson can see
  changes behaviour and a silent block just gets worked around.

`nextBestActions()` orders the desk by overdue, then priority, then next action
date, and surfaces the opt-out flag so nobody walks into a door that closed.

## 10. Declared, not faked

| Claim | Reality |
| --- | --- |
| Online ordering with Paystack/Stripe checkout | Enterprise plan item. The escrow and provider adapters exist (`kernel/escrow.js`); a cart and checkout UI do not. It is listed as included in the plan data with that boundary attached, and it is not demoed as working |
| AI booking assistant | Described in the plan data as a rules-and-retrieval assistant that is labelled as an assistant and escalates to a human. Not built; not claimed in any demo output |
| POS / accounting integration | Enterprise line item, not implemented |
| Google Business Profile setup, review flow | A documented service, not an API integration; the honest boundary ("we cannot promise rankings") is published verbatim from the reference playbook |
| Domain registration and DNS | Not offered. Export targets are ProVeri hosting, GitHub Pages, or the client's own domain pointed at the export |
| Website diagnostic scores | Real when `PROVERI_INTEGRATION_MODE=live`; explicitly simulated offline, with the note in the payload, the ledger and the UI |

## 11. API

47 routes, all in the OpenAPI document at `GET /api/openapi.json`:

| group | routes |
| --- | --- |
| catalogue & playbook | `GET /api/sites/templates`, `/api/sites/plans`, `/api/sites/playbook`, `/api/sites/stats`, `/api/sites/gallery`, `/api/sites/export-bundle` |
| build | `GET/POST /api/sites`, `GET /api/sites/:siteId`, `PATCH …/content`, `PATCH …/theme`, `GET/POST …/assets`, `POST …/assets/:assetId/classify`, `GET/POST …/permissions`, `GET …/ai-prompt`, `POST …/preview`, `POST …/publish`, `POST …/pause`, `POST …/archive` |
| render & export | `GET …/html`, `GET …/export`, `/s/:slug`, `/preview/:slug`, `/export/:slug`, `/sites` |
| money | `POST …/subscribe`, `POST …/renew`, `POST …/cancel-subscription`, `GET/POST …/updates` |
| bookings | `POST/GET …/bookings`, `GET /api/sites/bookings`, `GET /api/site-bookings/:bookingId`, `POST /api/site-bookings/:bookingId/decision` |
| sales desk | `GET /api/leads`, `POST /api/leads`, `GET/PATCH /api/leads/:leadId`, `POST …/diagnose`, `POST …/demo`, `GET …/pitch-kit`, `POST …/outreach`, `POST …/opt-out`, `POST …/convert`, `POST …/lose`, `GET /api/leads/stages`, `/api/leads/stats`, `/api/leads/actions` |

Error contract: a policy refusal is `409` with `policyDecision` and the fired
rules; a missing record is `404`; a validation failure is `400` with the field
list; anything else is `500` with a correlation id and never a stack trace.

## 12. PWA screens

`/business-studio` (templates, plans, comparison, the studio's own sites, the
three enforced policies), `/site/:siteId` (editor: plan and credits, theme with
contrast, catalogue, assets with classification and permission seals, bookings
with confirm/decline, publish controls, timeline), `/sites` (public gallery),
`/sales-desk` (pipeline stats, next best actions, all leads, the status
vocabulary, lead capture) — plus sheets for scaffolding, theme, content,
assets, permissions, updates, AI prompts, export, leads, pitch kits and capture.
All in `pwa/js/screens-studio.js`, precached by the service worker.

## 13. Data

Collections: `businessSites`, `siteAssets`, `sitePermissions`, `siteUpdates`,
`siteBookings`, `siteSubscriptions`, `salesLeads`, `leadTouches`. Ledger
actions: `BUSINESS_SITE_SCAFFOLDED`, `SITE_CONTENT_UPDATED`,
`SITE_ASSET_ADDED`, `SITE_ASSET_CLASSIFIED`, `SITE_ASSET_PERMISSION_RECORDED`,
`SITE_THEME_UPDATED`, `SITE_PREVIEW_READY`, `SITE_PUBLISH_BLOCKED`,
`BUSINESS_SITE_PUBLISHED`, `SITE_PAUSED`, `SITE_ARCHIVED`,
`SITE_SUBSCRIPTION_STARTED`, `SITE_SUBSCRIPTION_RENEWED`,
`SITE_SUBSCRIPTION_CANCELLED`, `SITE_BOOKING_RECEIVED`, `SITE_BOOKING_DECIDED`,
`SITE_UPDATE_CHARGED`, `SITE_EXPORTED`, `SALES_LEAD_CAPTURED`,
`SALES_LEAD_UPDATED`, `SALES_LEAD_DIAGNOSED`, `SALES_LEAD_DIAGNOSTIC_SIMULATED`,
`SALES_DEMO_BUILT`, `SALES_OUTREACH_LOGGED`, `POPIA_OPT_OUT_RECORDED`,
`SALES_LEAD_WON`, `SALES_LEAD_LOST`.

## 14. Verification

| Check | Command |
| --- | --- |
| 27 studio unit tests, 19 sales-desk tests, 18 PWA/HTTP integration tests (168 total) | `npm test` |
| The whole journey printed with its ledger entries | `npm run demo:studio` |
| The screens really render — a DOM shim loads `pwa/js/*` against a live server and asserts no `undefined`, `NaN` or `[object Object]` reaches the user | `node --test test/pwa-screens.test.js` |
| Live pages, no JavaScript | `curl localhost:4173/s/dlamini-plumbing` |
| A blocked publish, in one command | `curl -X POST localhost:4173/api/sites/<kloof-cellars>/publish` |
