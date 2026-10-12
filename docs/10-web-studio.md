# Web Studio — preview first, pay after, escrow always

ServicePro's Web Studio is a real business: six website packages and four
growth services, sold on a "we build your live interactive preview before you
pay a cent" promise, with WhatsApp as the sales channel. ProVeri keeps the
promise and the prices, and changes three things.

## 1. The free tier is a data-bound microsite

Every pro who passes verification gets `/p/<slug>` automatically:

- server-rendered HTML with **no JavaScript required** — it loads on any phone
  on any network, which is the actual South African constraint;
- generated live from the profile and the audit ledger at request time, so it
  can never go stale and can never overstate: trust score, the full check list
  with sources and seals, verified reviews, the proof-of-work gallery,
  availability, service radius, WhatsApp link and the audit receipt;
- installable as the pro's own landing page, with a QR code for the bakkie
  door, toolbox lid or till slip.

This is the acquisition wedge: a pro signs up for jobs and leaves with a
website. The paid packages then sell customisation, not existence.

## 2. Paid packages are delivered through the same escrow as a plumbing job

| Package | Price | Milestones (escrow weights) |
| --- | --- | --- |
| Digital Storefront | R3,500 once-off | preview approved 40% → domain + handover 60% |
| Website-as-a-Service | R1,500 + R450/mo | site live 100% |
| Business Growth Storefront | R7,500 once-off | design 30% → build + payments 40% → launch 30% |
| Premium E-Commerce | R15,000 once-off | design 25% → catalogue + checkout 45% → launch 30% |
| "Page 3" Website Rescue | from R2,500 | diagnostic 30% → rescued site live 70% |
| Student & Individual | R450–R1,000 | portfolio live 100% |

Order state machine: `ENQUIRY → PREVIEW_BUILDING → PREVIEW_READY →
PREVIEW_APPROVED → AWAITING_PAYMENT → PAID → IN_BUILD → READY_FOR_HANDOVER →
DELIVERED`, with `CANCELLED`/`DISPUTED` branches. **Escrow opens only at
`PREVIEW_APPROVED`** — the promise is enforced by the state machine, not by
marketing copy.

Each package carries a `proveriUpgrade` that ServicePro cannot match:

- Storefront → generated from the verified profile, so reviews and trust badge
  are live data, not screenshots.
- WaaS → monthly report showing trust score, review velocity and jobs won.
- Growth → embeddable ProVeri booking widget; the client's site takes
  escrow-protected bookings under their own brand.
- E-Commerce → optional TradeSafe escrow on high-value orders.
- Rescue → the diagnostic report is machine-generated, hash-sealed and **kept by
  the customer whether or not they buy**.

## 3. Growth services keep ServicePro's honest boundaries, verbatim

The published boundaries are preserved because they are the reason the offer is
believable:

- *Get Recommended on Google (R650)* — "Google local ranking depends on
  relevance, distance and authentic customer reviews." ProVeri addition: review
  requests fire only after escrow-released jobs, so every Google review earned
  is backed by a real paid booking.
- *Automate Your WhatsApp (R550)* — configured with official WhatsApp Business
  tools, no monthly software bill; advanced bots quoted separately. ProVeri
  addition: a quick-reply that routes enquiries back into escrow.
- *Get Customer Leads (R1,200)* — ad budget funded directly with Google/Meta;
  no recycled phone lists. ProVeri addition: creative auto-features the live
  trust badge and rating.
- *Posters & Brand Kit (R499)* — banking details on the price card replaced by
  a ProVeri payment link.

## The free diagnostic

`POST /api/webstudio/diagnostic` scores any URL against nine checks that
actually cost a business customers: reachability, viewport meta, page weight,
response time, HTTPS, click-to-action presence, title/description, mixed
content, and LocalBusiness schema. The report is sealed and returned whether or
not the customer buys anything — which is the fastest trust signal a web
agency can emit, and almost none of them will.

## Why this is a marketplace feature, not a side business

Every microsite and every delivered storefront is a landing page whose primary
call to action posts a job into ProVeri escrow. Web Studio revenue is real, but
its strategic job is to put verified booking entry points all over the South
African small-business web — built by the same trust kernel that protects the
job on the other end.
