# 13 · The portfolio and the storefront

> **"Upload your past work, and let home owners find you by it."**
>
> 📍 In South Africa, for South Africa 🇿🇦 · Connecting local businesses with home
> owners · Reshaping the future of employment.

This is the front door of ProVeri. Everything else in the platform — the
trust kernel, escrow, proof of work, the studios — exists to make this one loop
trustworthy:

```
a pro publishes work they have done  →  a home owner sees it near them
                                    →  they message the pro about that job
                                    →  a job is posted, bid, booked
                                    →  money goes into escrow
                                    →  proof of work is sealed
                                    →  the home owner confirms, the pro is paid
                                    →  the closed job publishes itself as new work
```

That last arrow is the flywheel, and it is not a metaphor: `releasePayment()`
calls `portfolio.harvestFromBooking()`, so the work a pro already proved never
has to be uploaded twice.

---

## 1. Three tiers, only one of which you can ask for

A portfolio item's tier is **computed**, never declared. There is no field a pro
can post that makes an item verified.

| Tier | Label on screen | How it is earned | Ranking weight |
| --- | --- | --- | --- |
| `SELF_DECLARED` | *Uploaded by the pro* | The pro uploaded it. Nothing on ProVeri corroborates it — and the item says so in those words. | 0 |
| `EVIDENCE_LINKED` | *Proof of work* | Linked to an escrow-released ProVeri job (`COMPLETED` / `IN_WARRANTY` / `CLOSED`) belonging to that pro. Photos come from the job's geotagged, hash-sealed evidence trail. | 1 |
| `CLIENT_CONFIRMED` | *Client confirmed* | As above **and** the home owner on that job confirmed it (`confirmByClient`) or rated it 4★+. | 2 |

`verificationStatement(item)` returns the exact sentences each tier is allowed to
say, and the product page prints them. A self-declared item renders:

> *The pro uploaded these photos. Nothing on ProVeri corroborates them yet.*
> *No verification badge is shown, and this item ranks below proven work.*

This is the whole design in one place: **uploads are welcome, pretending is
not.** Individuals and one-truck small businesses can publish work from day one
without a ProVeri job history; they simply carry an honest label until they have
one.

## 2. The rules that police the shelf

Three policy rules (`appliesTo: ['portfolio']`) join the published rule book —
`GET /api/trust/policies` and `GET /api/portfolio/tiers` both serve them:

| Rule | Effect | What it stops |
| --- | --- | --- |
| **PRT-001** `no_verification_badge_without_evidence` | BLOCK | Claiming `claimsProofOfWork`, `tier` or `verified` on an item with no evidence. Refused with a 409 carrying the decision. |
| **PRT-002** `no_reused_photos_across_pros` | BLOCK | Uploading a photo hash that another pro has already published — in their portfolio **or** in the evidence trail of one of their bookings. The oldest trick in the trade, caught by hash before it is ever stored. |
| **PRT-003** `incomplete_work_items_rank_lower` | WARN | A self-declared item with neither a suburb nor a price. It still publishes (a thin upload beats no upload), and the pro is told what to add. |

Two risk signals accompany them, on the existing fraud-scale weights:

- `DUPLICATE_PHOTO_HASH` (48, QUARANTINE) — recorded against the pro who tried to reuse a photo.
- `VERIFICATION_CLAIM_WITHOUT_EVIDENCE` (32, STEP_UP_VERIFICATION) — recorded when a badge was claimed without evidence.
- `PORTFOLIO_MISREPRESENTATION` (26, MONITOR) — recorded when a home owner reports an item.

Every upload is also sealed twice: each photo gets
`sha256(dataUrl | url | hash)` plus a per-pro seal, and the item gets a
`ledgerSeal`. The seal is printed on the product page — a receipt a customer can
quote back to the trust desk.

## 3. Photos: what a card shows when there is no photo

Harvested items are made of **evidence records**, not image files: hash, capture
time, geolocation, distance from the job address, seal. There is no picture to
serve, and putting a stock photo next to a "Proof of work" badge would be exactly
the deception the tiers exist to prevent.

So the card renders a *sealed-evidence tile* instead: a dark, gold-accented
receipt showing the trade, the suburb, the date, the seal prefix and the tier. It
is visibly different from a photograph, and it is more informative than one.
Uploaded photos render as photographs, and any image that is not the pro's own
client work (including the fifteen demo images in `pwa/img/work/`) carries a
**Demo photo** chip — the same labelling discipline as WEB-003 for generated site
assets. One seeded upload (Anwar Patel's DB board) deliberately has no image at
all, so the sealed tile is never dead code, and `pwa-screens.test.js` asserts both
halves of that: a self-declared item with imagery says **Demo photo**, and one
without imagery shows `.photo.sealed` and never borrows a demo picture.

**Serving them.** Each hosted photo has a 480 px `.thumb.jpg` sibling (ImageMagick,
q70, metadata stripped): 380 KB for all fifteen, against 1.9 MB of full frames.
`ui.thumb(url)` swaps `/img/work/x.jpg` for `/img/work/x.thumb.jpg`, and
`ui.photoImg()` renders a lazy `<img>` carrying `data-full` plus an `onerror`
handler that restores the full frame if the thumbnail is missing — so a grid of
twelve jobs costs roughly 250 KB on a phone instead of 2 MB, and a forgotten
thumbnail degrades to a slower image rather than a broken one. Hero cards and
product pages use the full frame; the service worker cache-firsts both, so the
shelf still renders offline after one visit.

## 4. The reach-out loop

`enquire({ itemId, customerId, body })` opens a thread keyed
`portfolio:<itemId>` on the shared `messages` collection, bumps the item's
enquiry counter, notifies the pro, and writes a `PORTFOLIO_ENQUIRY` ledger entry.
The pro replies through the same call with `actorId`. `listEnquiries` is
participant-only: anybody else gets `error.code = 'FORBIDDEN'`, which the server
maps to **403** (not a 500, and not a leak).

Messages pass the same off-platform-payment policy scan as booking messages, so
"pay me cash and we will skip the fee" is flagged on the record. That matters
here more than anywhere: the enquiry is the moment a lead is most likely to be
stolen from the platform.

Enquiry counts are public ("3 home owners have reached out") because social proof
that cannot be bought is the point.

## 5. The storefront: four tabs and one button

The brief was explicit — *do not flood the user*. The previous home screen had a
hero, a six-stat grid, a load-shedding/weather/labour-market strip, a category
grid, a four-step essay, a guarantees list and a four-card promo scroller. That
is a brochure. This is a shop:

| Tab | Route | What is on it |
| --- | --- | --- |
| **Home** | `/` | One line of copy, a pill search bar, a trade rail of nine circles (ordered by what home owners actually search for), one full-bleed **hero job** with its photo, price, pro and gold star rating, then six cards (proven first, newest next), one honest line about how much of the feed is proven, and one card for the pro side. |
| **Browse** | `/browse` | The full shelf: search, tier chips (All / Proof of work / Client confirmed / Browse pros), category, suburb and sort filters — suburbs grouped by metro in `<optgroup>`s, because 110 flat options is a scroll marathon — and a result count that names how many items are proven. |
| **Orders** | `/orders` | Jobs I posted, bookings, and (for pros) work I uploaded — each with a six-step escrow tracker (Posted · Booked · In escrow · Work done · Confirmed · Paid out). `/order/:bookingId` is the order-tracking page: a receipt for the money, the proof of work, the next action. |
| **You** | `/me` | Profile, role switch, wallet, notifications, trust and proof, integrations, become-a-pro, Web Studio, Business Site Studio, sales desk, vehicles, property waitlist, trust desk, install, sign out. |
| **＋** | FAB | Two choices, one for each side of the market: *post a job* or *upload work I have done*. It sits in a notch cut into the tab bar and hides itself on screens that already carry their own action bar (`FOCUS_ROUTES` in `js/app.js`), so it never floats over a sticky button. |

### 5.1 The design system behind it

The first cut of this storefront was rejected as unusable, so the chrome was
rebuilt rather than repainted:

- **No emoji in the chrome.** `ui.icon(name, size)` renders inline 24-grid stroke
  SVGs (`ICON_PATHS`: home, search, receipt, user, plus, star, shield, camera,
  pin, chat, chevron, bell, close, check, arrow, wallet, upload, sparkle, filter,
  tool, car, globe, store, briefcase, link, scale, install). The header, tab bar,
  FAB, tiles, chips, banners, kickers and action bar all use it. Emoji survive
  only where they *are* the content: the trade rail glyphs (`ui.catIcon()`, one
  distinct glyph per trade — the catalogue's own icons repeat, four trades share a
  sponge) and the friendly illustration in an empty state.
- **One badge per fact.** The tier is named once, on the photo; the card body
  carries who did it, their gold half-star rating (`ui.starRow()`), where, and the
  price. The first cut said "Proof of work" twice on every card.
- **Glass chrome, solid content.** Sticky header and fixed tab bar are translucent
  with `backdrop-filter`; cards are opaque with a two-layer shadow. Light and dark
  palettes come from the same tokens (`--brand-*` veld green, `--gold-*` accent),
  and `theme-color` follows the scheme so Android's URL bar matches the header.
- **Money reads as a receipt.** `/order/:bookingId` takes the total from
  `booking.price.totalCents`, the release from `booking.payout`, the holdback from
  `booking.warranty`, the fee from `escrow.fees`, and prints only the lines that
  apply — plus the market-band verdict and the auto-release date. The list rows
  are flattened (`totalCents`, `suburb`) while the detail record is nested
  (`price.totalCents`, `address.suburb`); reading the wrong shape rendered "—"
  where money belongs, and the test suite now asserts the formatted total appears
  on the page.
- **Cache version `proveri-v4`**, so phones pick the redesign up instead of
  serving the rejected shell from cache.

Product pages:

- **`/work/:itemId`** — photos (or sealed-evidence figures) in a snap-scrolling
  strip, tier pill, price, four facts (trade / where / when / job ref), the
  verification lines, the pro card, their other work, and a pinned action bar:
  **Message about this** · **Hire for my job**. A muted *Report this work* link
  sits below, because a shelf needs a way to be policed by the people using it.
- **`/pro/:proId`** — now leads with *Work they have published* before the
  verification card, the stats and the reviews. The shelf comes before the CV.
- **`/post-job`** — a three-step checkout (What → Where & when → Budget & post)
  with a progress indicator, live category resolution on step one, safety
  questions folded into step two, and a review card plus the escrow promise on
  step three. *Hire for my job* pre-fills it from the work item and tells the pro
  they were the reason the job was posted.
- **`/upload-work`** — photo picker with local previews, title, what was done,
  trade, suburb, price, and an optional ProVeri job reference that turns the
  upload into proof of work. Below the form: everything the pro has published,
  with view/remove, and a banner naming how many uploads have no proof yet.

Everything the old home screen carried was moved, not deleted: the load-shedding
and weather advice appear on the **job detail** screen, where they change a
decision; the guarantee list and the ledger live on **/trust**; the verticals and
studios live under **/me**. Old addresses still resolve — `/bookings`,
`/find-a-pro`, `/profile` and the studio routes are untouched.

## 6. API

Thirteen routes (of 184 operations), all in `docs/06-api-reference.md`:

```
GET    /api/portfolio                      the feed (q, categoryId, suburbId, metro, tier, verified, proId, sort, limit)
GET    /api/portfolio/stats                counts by tier, harvested vs uploaded, enquiries, flags
GET    /api/portfolio/tiers                what each tier may claim + the PRT rules
POST   /api/portfolio                      upload work
GET    /api/portfolio/:itemId              product page (counts a view)
PATCH  /api/portfolio/:itemId              edit (tier and badges are not editable)
DELETE /api/portfolio/:itemId              remove (owner or trust desk)
POST   /api/portfolio/:itemId/confirm      the client on the linked job confirms
POST   /api/portfolio/:itemId/flag         report it
POST   /api/portfolio/:itemId/enquire      reach out (the lead)
GET    /api/portfolio/:itemId/messages     the thread (participants only, else 403)
GET    /api/pros/:proId/portfolio          a pro's shelf
POST   /api/pros/:proId/portfolio          upload for that pro
```

`people.publicProfile()` now serves the real portfolio (with each item's tier and
seal) instead of the declared `portfolio[]` hashes it used to project, so the
generated microsites' "Proof of work" gallery shows items that exist — and its
note says which of them are proven and which are uploads.

## 7. Data

One new collection, `portfolioItems`, keyed by `itemId` (`prt_…`) with a
human-facing `reference` (`WORK-00001`). An item carries: identity (`proId`,
`categoryId/Label`, `suburbId/suburb/metro`), the work (`title`, `description`,
`completedAt`, `priceCents`, `priceNote`), the proof (`photos[]` with
`hash`/`seal`/`geo`/`geoVerified`/`distanceFromJobKm`/`illustrative`,
`evidenceSeals[]`, `bookingId`, `jobId`, `clientReference`, `rating`), the tier
(`tier`, `source`, `clientConfirmedAt`, `clientComment`), moderation (`status`,
`flags[]`), counters (`stats.views/saves/enquiries`) and `ledgerSeal`.

Removal is soft (`status: REMOVED`) so the ledger, the reports and the trust desk
keep their record. Flagging takes an item off the shelf immediately
(`status: FLAGGED`) without deleting it.

## 8. Seed

`seed()` now produces **15 portfolio items**: ten harvested from the escrow-
released bookings (evidence-linked or client-confirmed, with real seals and geo
distances) and five uploads — geyser replacement, DB board upgrade, interior
repaint, garden landscaping, bathroom re-tiling — each with one of the demo
photographs in `pwa/img/work/`, each labelled illustrative, each priced and
placed in a real Gauteng/SA suburb. Ledger: 997 entries, chain valid.

## 9. What is genuinely verified end to end

Honesty about verification state is part of the acceptance criteria, so:

**Runs for real, exercised by tests**

- Upload → seal → publish → feed → product page → enquiry → reply → flag → remove.
- Tier computation from evidence, and refusal of every attempt to claim a tier
  (PRT-001, 409 + risk signal).
- Cross-pro photo-hash duplicate detection across portfolios **and** booking
  evidence (PRT-002, 409 + risk signal).
- Harvest on `releasePayment`, idempotent, with no photos → no item.
- Client confirmation restricted to the customer on the linked job (403 otherwise).
- Thread privacy (403), ownership on edit/remove (403), validation (400),
  unknown ids (404).
- Every shop screen rendered against the live API through the DOM shim, with
  canary assertions that catch `undefined`/`NaN`/`[object Object]` reaching a
  phone.
- Posting a job in plain language: the trade is auto-detected from the
  description (`categoryAutoDetected` with its confidence and its reasons), and
  "Bryanston, Johannesburg" resolves to a real suburb. Both were broken — the
  route demanded a `categoryId` the UI promised to infer, and `catalog.js`
  imported `GEOCODING` from the wrong module, so any address that was not an
  exact suburb name threw a TypeError. Fixed and regression-tested.

**Simulated, and labelled as such in the product**

- Payments, identity/bank verification, CIPC, notifications: adapter-shaped,
  offline by default (`PROVERI_INTEGRATION_MODE=offline|live`), and the UI says
  which mode it is in. Load shedding, weather, exchange rates, holidays and
  geocoding are live public endpoints when the sandbox has egress.
- The five demo work photographs are generated imagery, labelled *Illustrative
  photo* everywhere they appear.

**Declared, not built**

- Image similarity beyond exact-hash matching (a re-encoded stolen photo is not
  caught yet — the roadmap item is perceptual hashing).
- Save/bookmark counters exist on the item (`stats.saves`) with no UI yet.
- Property vertical remains `COMING_SOON` with published reasons and a waitlist.

## 10. Tests

`test/portfolio.test.js` — 19 service-level tests (upload, tiers, the three PRT
rules, evidence linking, impostor linking, harvest and its idempotency, client
confirmation, the enquiry loop and its privacy, feed filters and ranking, detail
views, flag/remove, stats, public-profile projection).

`test/pwa-screens.test.js` — 31 tests, now including the storefront: the shell
asserts four tabs, one FAB, load order, service-worker precache and the `v3`
cache version; the render tests assert the home screen has a search box, chips
and work cards **and no longer contains the old essay sections**; the product
page asserts a proven item says *escrow-released* while a self-declared one says
*Uploaded by the pro* and never borrows the badge; plus the portfolio HTTP API,
the 409/403/400/404 mapping, and the demo photographs actually being served.

Full suite: **200 tests**.
