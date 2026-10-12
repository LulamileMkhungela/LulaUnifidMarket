# Innovative features — 28 things no competitor does

Each entry states the customer or pro pain, the mechanism, the public data or
partner it rides on, and where it lives in the code. Nothing here is a slogan:
every one is implemented and (with two exceptions, noted) covered by a test.

---

## 1. Load-shedding-aware scheduling
**Pain:** a welder, painter or solar installer booked into a Stage 4 window
stops mid-job; the customer thinks they were scammed; the pro eats the revisit.
**Mechanism:** the national stage and area schedule (EskomSePush, free tier +
paid area plans; community mirror as fallback) are intersected with the job's
`powerDependency` and duration to rank outage-free slots; confidence decays with
stage. Power-independent jobs are told so, honestly.
**Bonus:** at Stage 3+ the quote screen offers a load-shedding readiness audit
from a verified solar installer — the outage becomes demand.
**Code:** `integrations/verificationSources.js LOAD_SHEDDING`, PWA job detail.
**Test:** `test/integrations.test.js` asserts recommended slots never overlap an
outage window.

## 2. Weather-aware quoting for exterior trades
**Pain:** "the roofer didn't come" is usually rain, not fraud.
**Mechanism:** Open-Meteo (free, no key) drives a per-day risk verdict against
the category's blockers (RAIN, LIGHTNING, STRONG_WIND, HIGH_HUMIDITY); blocked
bookings auto-reschedule free of charge and without touching the trust score.
**Code:** `integrations/publicData.js WEATHER.jobDayAdvice`.
**Test:** `test/integrations.test.js`.

## 3. Geosealed proof of work
**Pain:** "the pro never showed up" and "they sent me someone else's photos".
**Mechanism:** every evidence item carries GPS + timestamp + SHA-256 seal and is
checked against the job address; >2 km raises `EVIDENCE_EXIF_MISMATCH`, holds
the payout and shows on the trust desk. Cross-booking duplicate-photo hashes
raise `DUPLICATE_PHOTO_HASH`.
**Code:** `marketplace/bookings.js submitEvidence`.
**Test:** `test/marketplace.flow.test.js`.

## 4. Workmanship warranty holdback (5%, 14 days)
**Pain:** cash jobs leave the customer holding every defect.
**Mechanism:** 5% of every release is held for 14 days (21 for high-risk
trades). A reported defect freezes it; an ignored defect pays another verified
pro to finish. No competitor in SA holds a retention.
**Code:** `kernel/escrow.js` fee config + `bookings.reportWarrantyDefect/closeWarranty`.
**Test:** `test/kernel.test.js`, `test/marketplace.flow.test.js`.

## 5. Arrival-code identity handshake
**Pain:** opening your door to a stranger is the moment trust is tested.
**Mechanism:** the pro reads a 6-digit code at the door; the customer types it
in-app and only then sees the verified photo, ID name and certificate. Five
failed attempts escalates to the safety desk.
**Code:** `bookings.verifyArrivalCode`, PWA booking detail.
**Test:** exercised in the flow tests via the seed journey.

## 6. Fair-Price Intelligence
**Pain:** the R99 callout that becomes R6,800 on the day; and the honest pro
undercut by bait pricing.
**Mechanism:** live percentile bands from real ProVeri bids per category per
metro (seeded Stats-SA-CPI-indexed bands until five bids exist), annotated on
every bid: WELL_BELOW_MARKET triggers a scope question, WELL_ABOVE_MARKET a
breakdown request. Bait bids raise `PRICE_ANOMALY_LOW`.
**Code:** `integrations/context.js MARKET`, PWA bid cards.
**Test:** `test/integrations.test.js`.

## 7. Verified-only reviews, with an integrity scanner
**Pain:** bought ratings destroy the one signal customers trust.
**Mechanism:** `REV-001` blocks reviews unless escrow reached a terminal state;
a scanner flags repeated reviewers, same-day bursts and micro-job five-stars.
**Code:** policy + `bookings.detectReviewManipulation`.
**Test:** `test/kernel.test.js`.

## 8. The free, data-bound pro microsite
**Pain:** pros lose work to competitors who merely *appear* online.
**Mechanism:** every verified pro gets `/p/<slug>` — server-rendered HTML (no
JavaScript required), generated live from the profile and ledger: trust score,
check list with sources, verified reviews, proof-of-work gallery, availability,
WhatsApp link, audit seal. It cannot go stale and cannot overstate.
**Code:** `marketplace/webstudio.js`, `GET /p/:slug`.
**Test:** `test/verticals.test.js`, `test/api.test.js`.

## 9. Remit-a-Job
**Pain:** a daughter in London cannot safely pay for her mother's geyser in
Soweto.
**Mechanism:** fund a job in GBP/USD/EUR/BWP at a rate-locked quote
(ExchangeRate-API open tier); the pro still receives rand from escrow. The
quote, rate and seal are recorded.
**Code:** `integrations/publicData.js FX.quoteRemittance`, PWA funding sheet.
**Test:** `test/integrations.test.js`.

## 10. Vehicle Service Passport — the cross-vertical payoff
**Pain:** a used car's history is whatever the seller says it is.
**Mechanism:** every escrow-released mechanic, inspection or towing job on a
registered VIN appends a hash-sealed entry to that VIN's passport. Sell the car
on ProVeri later and the advert inherits the history. An inspection booked as a
*service* writes its report into the *listing's* trust chain via
`bridgeEvidence`.
**Code:** `marketplace/vehicles.js appendServiceToPassport / bridgeInspectionToListing`,
`marketplace/index.js bridgeBookingToVehicle`.
**Test:** `test/verticals.test.js`.

## 11. Recognition of Prior Learning pathway
**Pain:** millions of skilled South Africans have no certificate; customers
have no signal.
**Mechanism:** practical on-camera assessment against a trade checklist +
portfolio built from escrow-released jobs → interim "Assessed Practitioner"
badge → referral to a SETA/QCTO centre for formal RPL. SAQA/NQF mirror powers
the qualification check; absence of local data returns `UNAVAILABLE`, never
`FAIL`.
**Code:** `integrations/verificationSources.js QUALIFICATIONS.rplPathway`.

## 12. Materials escrow with till-slip matching
**Pain:** "cash for materials" is how customers lose money outside escrow.
**Mechanism:** materials are added to escrow; the pro uploads till slips; the
claimed total is reconciled against the quote and overruns raise
`DEPOSIT_ESCALATION`.
**Code:** `bookings.submitEvidence` materials branch.

## 13. Public-holiday and payday-aware availability
**Pain:** emergency tariffs on 25 December feel like a scam; payday weeks book
out invisibly.
**Mechanism:** Nager.Date (free, MIT) classifies each preferred date
(EMERGENCY_TARIFF_ALLOWED / HIGH_DEMAND / NORMAL) and flags SA payday windows so
customers book earlier.
**Code:** `integrations/publicData.js HOLIDAYS`.
**Test:** `test/integrations.test.js`.

## 14. SARS-ready income summary for pros
**Pain:** gig income catches independent contractors at provisional tax.
**Mechanism:** a tax-year statement generated from the escrow ledger — gross,
fees (deductible), net, VAT threshold status, IRP6 deadlines.
**Code:** `bookings.taxSummary`, PWA `/wallet`.

## 15. Published fairness guard on locality data
**Pain:** crime statistics can silently become redlining.
**Mechanism:** locality/crime context may only raise verification friction.
`RiskEngine.applyLocalitySignal` **throws** for any other purpose; the safety
plan states the guard in plain language.
**Code:** `kernel/risk.js`, `integrations/context.js SAFETY`.
**Test:** `test/kernel.test.js`.

## 16. Off-platform solicitation detection
**Pain:** the deal moves to WhatsApp and every protection evaporates.
**Mechanism:** a message classifier (policy `OFP-001`) flags cash/personal-account/
"skip the fee" language, quarantines it, warns the counterparty and raises a
risk signal — while not flagging ordinary escrow explanations.
**Test:** `test/kernel.test.js` (both directions).

## 17. Bank-detail substitution freeze
**Pain:** the classic payout fraud — swapped bank details after the job.
**Mechanism:** policy `BDS-001` freezes every funded escrow for that pro until a
two-channel call-back confirms the change; old and new seals stay in the ledger.
**Code:** `people.requestBankChange`.
**Test:** `test/marketplace.flow.test.js`.

## 18. An installable, offline-first PWA with a mutation queue
**Pain:** basements, roofs and townships have no signal exactly when proof of
work is captured.
**Mechanism:** service worker caches the shell and the offline bundle;
failed mutations are queued on-device and replayed on reconnect; the connectivity
pill and toasts tell the user exactly what is cached versus live.
**Code:** `pwa/sw.js`, `pwa/js/api.js`.
**Test:** `test/pwa-screens.test.js` loads the screen modules into a DOM shim
against a live server and fails if any screen renders `undefined`, `NaN` or
`[object Object]` — the class of bug that otherwise ships as a blank panel on
somebody's phone.

## 19. The booking-to-escrow bridge — a website that opens jobs
**Pain:** every small-business website in South Africa has the same dead end: a
"book now" button that opens a mail client, or a form that emails nobody. The
reference demos do exactly this — `BookingModal.jsx` shows a toast and closes.
**Mechanism:** the booking form on a generated site posts to the platform, is
validated against the template's own schema, and produces a `BKG-nnnnnn`
reference immediately. When the site is linked to a verified pro, the same
submit creates a **real marketplace job**: the visitor becomes a customer
account, the category is resolved from their own words, budget and urgency carry
across, the pro is notified, and the job is bid-able into escrow with the 5%
workmanship holdback and geosealed proof of work behind it. A booking on a site
that is not live becomes a priority-5 sales lead instead of disappearing.
**Why nobody else can copy it:** it requires a verified marketplace on the other
end of the form. A website builder has no pros; a marketplace has no websites.
**Code:** `businessSites.submitBooking`, `#convertToJob`, `#createLeadFromBooking`.
**Test:** `test/businessSites.test.js` (service), `test/pwa-screens.test.js` (over HTTP).

## 20. Permission-gated publishing (WEB-002)
**Pain:** agencies ship client sites with photos lifted from social media. The
reference playbook knows it — "giving credit is not a substitute for permission"
— and solves it with a markdown checklist, which is to say it does not solve it.
**Mechanism:** policy `WEB-002` refuses to publish a site while any asset lacks
a permission record. `recordPermission()` writes a checklist-backed record
(owner permission, copyright cleared, POPIA consent, AI disclosure, model
release, source logged), seals it with a sha256 over the asset list and the
grant, and appends it to the hash-chained ledger. Where an image contains
identifiable people, copyright clearance is not sufficient: POPIA s11(3) consent
is a separate condition and the gate stays closed without it. Previews stay
ungated on purpose, because the pitch depends on being able to build one in ten
minutes.
**Code:** `kernel/policy.js WEB-002`, `businessSites.recordPermission`,
`permissionState`.
**Test:** `test/businessSites.test.js` — a blocked publish, a sealed grant, and a
face without consent keeping the gate shut.

## 21. Metered update credits with a published extra rate (WEB-001)
**Pain:** "unlimited small updates" is how a website agency quietly goes out of
business, and "R450 per change" is how a client stops updating and the site
rots. Both sides lose, and neither can see the meter.
**Mechanism:** each plan carries `updateCreditsPerMonth`; an edit on a live site
consumes one and writes a `SITE_UPDATE_CHARGED` ledger entry. When the allowance
runs out the edit is refused with the reason and the options — renew, upgrade,
or approve a single extra update at the published R150 — returned in the policy
decision so the UI can offer them as buttons. Approving an extra bills it and
does not consume a credit. Nothing is ever silently absorbed and nothing is
ever silently invoiced.
**Code:** `kernel/policy.js WEB-001`, `businessSites.updateContent`, `logUpdate`.
**Test:** `test/businessSites.test.js`, and over HTTP in `test/pwa-screens.test.js`.

## 22. AI-image labelling that is enforced, not recommended (WEB-003)
**Pain:** generated food photography is now good enough to sell a dish that does
not exist. The reference workflow documents the tooling and says nothing about
the customer who orders it.
**Mechanism:** an `aiGenerated` asset renders an "Illustrative image" note
wherever it appears — catalogue item, gallery, hero. Where there is nowhere to
put a note (a full-bleed hero with the image nowhere else), the asset is counted
as `aiUnlabelled` and flagged before publish. `aiImagePrompt()` returns the
prompt, the budget stack and the labelling rule in one response, so the rule
travels with the prompt instead of living in a document nobody opens.
**Code:** `kernel/policy.js WEB-003`, `businessSites.addAsset`,
`#unlabelledPlacement`, `aiImagePrompt`.
**Test:** `test/businessSites.test.js` asserts both the rendered note and the
unlabelled-hero flag.

## 23. The honest diagnostic, and a pitch kit generated from it
**Pain:** a "free website audit" that invents a score is a lie with a landing
page, and a salesperson walking in with a generic deck is selling nothing.
**Mechanism:** `diagnose()` runs nine real checks against the URL. When the
network is off it returns `simulated: true`, `healthScore: null`, a note naming
the environment variable, and it **keeps the field research** instead of
overwriting it with a fabricated "site is down" — the lead lands in `RESEARCHED`
rather than `DIAGNOSED`. When it can measure, the score picks the website
status, the priority and the plan worth pitching; a healthy site is reported as
healthy with "do not sell a rebuild" attached. `pitchKit()` then returns the
timing window, the beat-by-beat script with this lead's numbers substituted (and
a different hook until a demo actually exists), the objection answers, the
recommended plan with its honest boundary, the cold email, the WhatsApp opener,
the permission checklist and the AI-image budget — one call, everything for the
door.
**Code:** `webstudio.rescueDiagnostic`, `leads.diagnose`, `leads.pitchKit`.
**Test:** `test/leads.test.js`.

## 24. The fleet bridge — one platform's evidence, two products
**Pain:** a shuttle operator's website lists vehicles with stock photos and no
proof, while the same operator's verified listings sit in a marketplace nobody
connects to the site.
**Mechanism:** a transport or tours template renders the operator's vehicles
straight from the vehicles vertical, with each listing's verification state,
sealed passport references and odometer — live data, not a photo of a bakkie.
Dead, disputed or removed listings are excluded automatically.
**Code:** `businessSites.#fleetFor`, `FLEET` section kind.
**Test:** `test/businessSites.test.js` — the section is omitted with no vehicles
and appears once one is verified.

## 25. Assets that file themselves, and admit when they cannot
**Pain:** a client sends 40 WhatsApp photos named `IMG_4412.jpg`. Somebody has
to decide which is the steak and which is the dining room, and that somebody is
usually nobody.
**Mechanism:** `addAsset()` classifies the caption and filename against the
industry vocabulary and returns a category, a confidence score and an explicit
`placement` — `CATALOGUE` files the photo onto the best-matching item that has
no image yet (so the menu gets illustrated), `GALLERY` keeps ambience, interiors,
fleet and credentials. When nothing matches, the category is `uncategorised`
with `needsReview: true` and a note that says a human must decide. Guessing is
recorded as guessing.
**Code:** `businessSites.classify`, `#attachToCatalogue`.
**Test:** `test/businessSites.test.js`.

---

## 26. The self-harvesting portfolio — proven work nobody had to upload
**Pain:** every marketplace that asks pros to build a portfolio gets an empty
one. The people best at tiling are not the people best at marketing tiling, and
the pros who do upload are the ones with the most to prove.
**Mechanism:** `releasePayment()` calls `portfolio.harvestFromBooking()`. When a
job's escrow releases, its geotagged, hash-sealed evidence — before/after photos,
certificates, the distance from the job address — becomes a portfolio item
automatically, tiered `EVIDENCE_LINKED`, or `CLIENT_CONFIRMED` when the client on
that job reviewed it 4★+. The call is idempotent (one item per booking), it needs
photo evidence to exist, and it never blocks a payout: a harvest failure is
written to the ledger, not thrown at the money.
**Code:** `marketplace/portfolio.js` (`harvestFromBooking`), `marketplace/bookings.js`
(`releasePayment` hook), `marketplace/index.js` (`attachPortfolio`).
**Test:** `test/portfolio.test.js`.

## 27. Three tiers, and a badge you cannot buy, claim or borrow
**Pain:** Snupit and Kandua reviews are worth roughly nothing, and every
classifieds site lets a pro write "verified" next to their own name. A trust
market needs a claim that a customer can distinguish from an adjective.
**Mechanism:** the tier is computed, never declared. `SELF_DECLARED` is an
upload and says so on screen ("Nothing on ProVeri corroborates them yet");
`EVIDENCE_LINKED` requires a released ProVeri booking belonging to that pro
(`#resolveEvidenceLink` throws if the job is somebody else's);
`CLIENT_CONFIRMED` requires the client on that job to confirm it. Policy
`PRT-001` blocks any patch that claims a tier, `PRT-002` blocks a photo hash
another pro has already published — matched across portfolios *and* booking
evidence, which is where stolen photos usually come from — and `PRT-003` warns a
thin upload to add a suburb and a price rather than refusing it. Attempts are
recorded as fraud signals (`VERIFICATION_CLAIM_WITHOUT_EVIDENCE`,
`DUPLICATE_PHOTO_HASH`), so the pattern is visible before the account is.
**Code:** `marketplace/portfolio.js`, `kernel/policy.js` (`PRT-001…003`),
`kernel/risk.js` (signal catalogue).
**Test:** `test/portfolio.test.js`.

## 28. A sealed-evidence tile instead of a stock photo
**Pain:** a "verified" badge next to a photograph the platform cannot account for
is worse than no badge — it launders the picture.
**Mechanism:** harvested items are evidence records, not image files: hash,
capture time, geo, distance from the address, seal. The card renders a
*sealed-evidence tile* — trade, suburb, date, seal prefix, tier — that is visibly
not a photograph and carries more information than one. Uploaded photos render as
photos, and any image that is not the pro's own client work (the five demo
photographs in `pwa/img/work/`) carries an **Demo photo** chip, the same
labelling discipline `WEB-003` enforces on generated site assets. The product page
prints the ledger seal, so a customer can quote a receipt back to the trust desk.
**Code:** `pwa/js/screens-shop.js` (`workThumb`), `pwa/js/screens-market.js`
(pro profile shelf), `marketplace/seed.js` (`illustrative: true`).
**Test:** `test/pwa-screens.test.js` (asserts the badge wording and the
illustrative chip on the rendered page).

---

## Deliberately *not* built (and why)

| Idea | Reason |
| --- | --- |
| Dynamic surge pricing by suburb | Conflicts with the fairness guard; trust markets die on perceived price discrimination |
| AI chatbot dispute adjudication | Disputes decide money; the weighting is published and a human signs it |
| Selling leads | The business model contradiction that keeps Snupit/Bark pros poor |
| A native app first | A PWA installs in one tap, updates without a store, and works on a R1,500 Android — the device most South Africans actually hold |
| Shopping cart and checkout on generated sites | Listed as an Enterprise inclusion with its boundary attached; the escrow and provider adapters exist, a cart UI does not, and nothing demos it as working |
| An AI booking assistant that confirms reservations | A bot that confirms a table or a transfer is making a commitment on the business's behalf. Until it can be labelled, bounded and escalated reliably, a booking lands with a human |
| Auto-publishing a site without a permission record | It would be faster and it would be the thing that gets a client sued. The gate stays |
| Stock photography on a "proof of work" item | The badge would be laundering a picture the platform cannot account for. Evidence-only items render their seal instead |
| Letting a pro choose their verification tier | The moment a tier is a form field it is a marketing claim. It is computed or it is nothing (`PRT-001`) |
