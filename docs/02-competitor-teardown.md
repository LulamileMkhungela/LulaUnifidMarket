# Competitor teardown — 14 platforms, their economics and their attack surfaces

Research snapshot: 2026-10-12, compiled from public sites, published coverage and
funding/acquisition records. Ratings quoted are third-party editorial scores
where cited; take-rate figures are from public pricing pages and trade press.

---

## A. South African services marketplaces

### 1. Snupit — the incumbent directory
- **Model:** free for homeowners; pros pay per lead. Large network, basic
  verification, self-reported credentials, unverified reviews.
- **Editorial score in circulation:** ~7/10; quote turnaround quoted at 4–24 h.
- **Attack surface:** leads are sold before trust exists. A homeowner gets five
  phone numbers and no protection; a pro pays for leads that may be
  price-shoppers. Reviews can be fabricated because nothing ties them to money
  that moved.
- **ProVeri answer:** bids arrive in minutes because matching runs on post;
  reviews are impossible to fabricate (`REV-001`); the pro never pays for a
  lead — only 10% of a released job.

### 2. Kandua — the funded one, now an insurer's asset
- **Model:** AI-driven single-pro matching, vetting, "85,000+ households".
  Raised ~US$13M; **acquired by Santam on 27 May 2024**.
- **Attack surface:** single-pro matching removes price discovery and the
  customer's leverage; the acquisition shows the durable asset was verification
  and risk data, not the marketplace.
- **ProVeri answer:** multiple competing verified bids with published market
  bands ("Beat this quote"), plus the same verification depth Kandua sold to an
  insurer — kept independent.

### 3. ServiceLink SA — the verification-led challenger
- **Model:** pay-per-successful-connection, 5-step contractor verification,
  verified reviews, insurance and licence checks with issuing bodies.
- **Attack surface:** verification without a money rail still leaves the
  transaction itself unprotected; the customer still pays the pro directly.
- **ProVeri answer:** identical verification posture *plus* escrow, geosealed
  evidence and the warranty holdback — the transaction, not just the
  introduction, is protected.

### 4. Bark — international lead credits
- **Model:** pros buy credits and spend them per lead, win or lose.
- **Attack surface:** pros pay for bad leads; no refunds; no protection on
  either side of the actual job.
- **ProVeri answer:** zero cost to lose a job; cost only when money is released.

### 5. SweepSouth and vertical specialists
- **Model:** managed verticals (cleaning) with platform-set pricing.
- **Attack surface:** depth in one category, no horizontal trust rail; supply
  is employed-adjacent rather than independent.
- **ProVeri answer:** one trust kernel across 32 categories and two verticals;
  independent contractors keep their own brand, rates and microsite.

## B. International benchmarks (the mechanics ProVeri borrows and beats)

### 6. TaskRabbit (IKEA)
- **Economics:** ~15% service fee + 5–15% "Trust & Support" fee → **15–30%
  effective take rate**; historically a $25 tasker registration fee.
- **Lesson borrowed:** publishing the split up front. **Beaten:** ProVeri takes
  10% total and publishes the warranty holdback as a customer benefit, not a
  fee.

### 7. Airtasker
- **Economics:** tiered tasker fee **12.5–20% + GST** by 30-day earnings, plus a
  poster-side connection fee R-equivalent of $9.95–$59.95.
- **Lesson borrowed:** tiers reward reliability. **Beaten:** ProVeri's trust
  score rewards reliability without raising the take rate — elite pros pay the
  same 10%.

### 8. Thumbtack / Angi
- **Economics:** pros pay **$8–$150 per lead**, shared with 4–5 competitors;
  Thumbtack Guarantee refunds up to $2,500 and covers property damage to
  $100,000.
- **Lesson borrowed:** a money-back guarantee changes demand. **Beaten:**
  ProVeri's guarantee is structural (escrow + holdback) rather than a claims
  process, and applies to every job by default.

### 9. Checkatrade / MyBuilder (UK)
- **Economics:** pro subscriptions; vetting and review moderation as the product.
- **Lesson borrowed:** vetting as the brand. **Beaten:** vetting evidence is
  published per pro (source, reference, seal, expiry) instead of asserted.

## C. South African money-rail and trust incumbents

### 10. TradeSafe — the escrow specialist
- **What exists:** PASA-authorised third-party payment provider, GraphQL API,
  split/milestone/lay-by/drawdown structures, EFT + Ozow + card + SnapScan +
  PayJustNow; fees from 1.5% (API flat 1.5%, R100 minimum off-API).
- **Attack surface:** protects money, says nothing about whether the work or
  the asset is real.
- **ProVeri answer:** TradeSafe is a *partner adapter*, not a competitor —
  ProVeri supplies the verification and evidence layer TradeSafe cannot.

### 11. Truzo / PaySafe SA / ooba Buyers Trust
- Escrow or deposit-protection niches (general goods; property deposits).
- **ProVeri answer:** same niches reachable as escrow providers per vertical,
  with the property rails documented and waitlisted rather than faked.

## D. Vehicle and property classifieds (the TrustShield heritage)

### 12. Cars.co.za / AutoTrader / WeBuyCars / Weelee
- **What exists:** demand aggregation, dealer networks, some seller
  verification, condition reports (Weelee), roadworthy/DEKRA references
  (WeBuyCars).
- **Attack surface:** the advert is still a claim. Nothing stops a verified
  listing being edited after trust is built, and nothing ties the inspection
  report to an accountable, paid transaction.
- **ProVeri answer:** the merged vehicles vertical — immutable listing
  versions, tamper-removal, negotiation locks, privacy-preserving funds
  confirmation, and inspection reports that arrive as escrow-released service
  jobs (`docs/07`).

### 13. Property24 / Private Property / PPRA
- Portals plus a practitioner register. **Attack surface:** portals stop at
  leads; title, municipal and trust-account verification happens late and
  offline.
- **ProVeri answer:** documented property vertical with the exact partner list
  and an honest "coming soon" state.

### 14. Facebook Marketplace / WhatsApp groups / Gumtree-style classifieds
- **What exists:** liquidity and zero friction. **Attack surface:** everything —
  proof-of-payment screenshots, swapped cars, cash deposits that vanish.
- **ProVeri answer:** meet them where they are (WhatsApp click-to-chat, Web
  Share Target, shareable microsites) and pull the transaction into escrow.

---

## The structural gap ProVeri occupies

Every incumbent answers **one** question:

| Question | Who answers it |
| --- | --- |
| "Is my money safe?" | TradeSafe, Truzo, ooba, conveyancer trust accounts |
| "Is this pro reachable?" | Snupit, Kandua, Bark, ServiceLink |
| "Is this pro credentialed?" | ServiceLink, Checkatrade, PPRA |
| "Does the advert match the asset?" | (partially) Weelee, DEKRA, TransUnion FirstCheck |
| "What should this cost?" | Nobody, credibly |
| "What happens after the money moves?" | Nobody |

ProVeri answers all six in one record, and publishes the record.

## Take-rate comparison (the number pros actually feel)

| Platform | Pro-side cost | Customer-side cost | Notes |
| --- | --- | --- | --- |
| Snupit | per-lead fees | free | pros pay to lose |
| Bark | credits per lead | free | no refunds on bad leads |
| Kandua | commission/matching | free | single-pro matching |
| Thumbtack | $8–$150 per lead | free | lead shared 4–5 ways |
| Airtasker | 12.5–20% + GST | connection fee | tiered by earnings |
| TaskRabbit | 5–15% trust fee | ~15% service fee | 15–30% combined |
| ServicePro | 10% | none published | escrow-protected |
| **Lula ProVeri** | **10%, released jobs only** | **none** | + 5% holdback returned after warranty |

## Why this wins in South Africa specifically

1. **Load shedding is a scheduling problem.** No competitor schedules around
   published outage windows; exterior and power-dependent work fails mid-job
   and becomes a dispute. ProVeri prevents the dispute.
2. **Weather is a dispute problem.** Open-Meteo is free; rain-flagged bookings
   auto-reschedule without penalty.
3. **Cash-for-materials is the classic leak.** Materials escrow with till-slip
   matching closes it.
4. **Safety is the demand blocker.** In-home work with strangers is the single
   biggest reason South Africans do not book; the arrival-code handshake and
   clearance-gated matching address it directly.
5. **Credentialing, not skill, is the supply blocker.** The RPL pathway turns
   demonstrated skill into a publishable badge at 47.4% youth unemployment.
