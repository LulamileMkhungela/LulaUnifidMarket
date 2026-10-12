# Money flow and unit economics

## The split, on one screen

For a R1,000 job:

| Line | Cents | Who | When |
| --- | --- | --- | --- |
| Customer pays into escrow | 100,000 | regulated partner | on bid acceptance |
| Pro payout (90%) | 90,000 | pro | on accepted proof of work |
| — of which workmanship holdback (5%) | 5,000 | partner, earmarked | released after 14 days without a defect |
| — immediate to pro | 85,000 | pro | minutes after confirmation |
| Platform fee (10%) | 10,000 | ProVeri | on release |
| Partner processing (est.) | ~1,500–3,500 | PSP/escrow | per transaction |

The holdback is **not** a fee: it returns to the pro. It is the reason a
customer can book a stranger, and the reason a pro's workmanship is worth
something on their profile.

## Escrow maths implemented in `kernel/escrow.js`

```
gross            = bid.totalCents (+ approved variations)
platformFee      = round(gross * 10%)
proPayout        = gross - platformFee
holdback         = round(gross * 5%)
immediateToPro   = proPayout - holdback
```

Milestone splits use integer-weight apportionment with the remainder on the
final milestone, so cents never leak:
`splitAmount(total, [30,30,40])` on R1,000,000 → `[300000, 300000, 400000]`.

Vehicle purchases with a title holder reorder the release:
settle bank → paid-up letter → NaTIS transfer → keys + final VIN check →
balance to seller. The bank's settlement is milestone 1 by weight.

## Refunds and disputes

| Outcome | Customer | Pro | Holdback |
| --- | --- | --- | --- |
| Cancel before payment | nothing paid | nothing | — |
| Cancel before work starts (ECT s44) | full refund | nothing | — |
| Pro cancels after funding | full refund, job reopens | reliability hit | — |
| Dispute → refund | full/partial | nothing/partial | frozen |
| Dispute → partial | remainder | agreed share | per ruling |
| Dispute → redo | nothing yet | nothing yet | frozen until redo accepted |
| Warranty defect ignored | holdback pays the fix | loses holdback | consumed |

Refund settlement is quoted honestly at 5–10 business days, matching the
provider reality ServicePro publishes.

## Unit economics (per released job)

Assume an average released job of R1,850 (the seeded median bid is R2,860;
services skew lower):

| Line | Value |
| --- | --- |
| Platform revenue | R185 |
| Partner cost (blended PSP) | ~R33 |
| Contribution | ~R152 |
| Dispute provisioning (9.1% of bookings at ~35% of value) | ~R59 |
| Contribution after dispute provisioning | ~R93 |

Dispute provisioning is the number most marketplaces hide. ProVeri's geoseal
evidence and locked scope exist to drive it down; the transparency report
publishes the dispute rate so the trend is visible.

## Where the second and third revenue lines come from

1. **Web Studio** — preview-first websites and growth services at ServicePro's
   published prices, delivered through milestone escrow. High margin, and it
   feeds the marketplace: every microsite is a landing page for verified
   bookings.
2. **Vehicles** — TradeSafe-class escrow at 1.5% on high-value transactions,
   plus paid inspection bridging.
3. **Trust-as-a-Service** — the kernel's verification, evidence and ledger as an
   API for other marketplaces (the old Phase 4, now an explicit roadmap item).
4. **Float-adjacent services, never float** — instant payout rails (PayShap /
   Capitec Pay) charged at cost-plus to pros who want money in seconds.

## Supply-side economics vs incumbents

| Cost to a pro | Snupit | Bark | Thumbtack | Airtasker | **ProVeri** |
| --- | --- | --- | --- | --- | --- |
| To lose a job | lead fee | credits | lead fee | nothing | **nothing** |
| To win a job | lead fee | credits | lead fee | 12.5–20% | **10%** |
| Subscription | – | – | – | – | **none** |
| Website | paid | paid | paid | paid | **free microsite** |
| Payment guarantee | none | none | guarantee fund claims | task-level | **escrow, pre-funded** |

## Metrics that decide whether this works

Published on the trust page and the admin console:

- verification completion rate and median time-to-verified
- matched-pros-per-job and median first-bid minutes (target < 30)
- escrow-funded conversion of awarded jobs
- dispute rate and median resolution hours (target < 48)
- geoseal failure rate (a proxy for honesty of evidence)
- warranty defect rate and holdback consumption
- repeat-customer rate and pro 90-day retention
- fraud loss per R1m GMV vs unprotected classifieds (the founding claim)
