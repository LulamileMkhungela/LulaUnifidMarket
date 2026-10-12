# Innovative features — 18 things no competitor does

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

---

## Deliberately *not* built (and why)

| Idea | Reason |
| --- | --- |
| Dynamic surge pricing by suburb | Conflicts with the fairness guard; trust markets die on perceived price discrimination |
| AI chatbot dispute adjudication | Disputes decide money; the weighting is published and a human signs it |
| Selling leads | The business model contradiction that keeps Snupit/Bark pros poor |
| A native app first | A PWA installs in one tap, updates without a store, and works on a R1,500 Android — the device most South Africans actually hold |
