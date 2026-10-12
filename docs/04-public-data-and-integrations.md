# Public data, services and endpoints

Everything ProVeri touches outside its own process, with the exact endpoint,
auth model, cost, licence, what it powers, and what happens when it is down.
Verified reachable on 2026-10-12 where marked ✓ (probed through the free
public tier from the build environment).

**Design rule:** free-and-keyless sources ship today. Paid partners are
first-class adapters that stay in *honest simulation* until a key is configured
— they return `WARN`/`UNAVAILABLE` with a reason, **never a fabricated PASS** —
and every number in the product carries the source that produced it.

---

## 1. Free, keyless, live in production

| Source | Endpoint | Powers | Licence / limit | Fallback |
| --- | --- | --- | --- | --- |
| Open-Meteo ✓ | `GET https://api.open-meteo.com/v1/forecast` | weather risk, exterior-trade rescheduling, job-day advice | CC BY 4.0, 10k calls/day | deterministic offline forecast labelled `live:false` |
| OSM Nominatim ✓ | `GET https://nominatim.openstreetmap.org/search` | address/suburb geocoding, radius search | ODbL 1.0, 1 req/s, User-Agent required | bundled suburb dataset (9 provinces, 11 metros) |
| Zippopotam ✓ | `GET https://api.zippopotam.us/ZA/{postcode}` | postcode → suburb/province/coordinates | free public dataset | bundled dataset |
| Nager.Date ✓ | `GET https://date.nager.at/api/v3/PublicHolidays/{year}/ZA` | public-holiday tariffs, availability advice | MIT | fixed-date list (movable feasts need the live API) |
| ExchangeRate-API open ✓ | `GET https://open.er-api.com/v6/latest/ZAR` | Remit-a-Job quotes | free w/ attribution, 1,500 req/mo | bundled indicative rates; settlement reconciles to SARB |
| Stats SA | `https://www.statssa.gov.za/publications/P0141/` + QLFS | CPI indexing of price bands; labour-market context | public domain w/ attribution | bundled CPI series |
| data.gov.za CKAN | `GET https://openapi.data.gov.za/api/3/action/package_search` | dataset discovery for municipal/statistical data | open data | cached list |
| City of Cape Town Open Data | `https://odp-cctegis.opendata.arcgis.com` (ArcGIS REST) | boundaries, outage areas, water restrictions | City open licence | municipality preset table |
| SAPS crime statistics | `https://www.saps.gov.za/services/crimestats.php` | aggregate safety context **only** (friction, never ranking) | public domain | none needed — national aggregates only |
| SAQA NQF register | `https://allqs.saqa.org.za/search.php?cat=qual` | trade qualification verification | NQF qualifications are public property | bundled mirror; live lookup flagged as required for a production PASS |
| EskomLoadShedding (community) ✓ | `GET https://loadshedding.sts.io/v1/Stage` | national load-shedding stage, free | MIT (open source) | labelled indicative stage |

## 2. Free tier exists, paid for the parts we need

| Source | Endpoint | Auth | Cost | Powers |
| --- | --- | --- | --- | --- |
| EskomSePush | `https://developer.sepush.co.za/business/2.0/{status,area,areas/nearby,api_allowance}` | `token` header | free: status+allowance; area schedules from ~US$55/yr | area outage schedules for slot ranking |
| CIPC APIVerse | `https://cipc-apm-rs-dev.azure-api.net/enterprise/v1/*` | `Ocp-Apim-Subscription-Key` | undisclosed; eServices extracts R30–R100 | official company/beneficial-ownership data |
| WhatsApp Business Cloud | `POST https://graph.facebook.com/v21.0/{phone-id}/messages` | Bearer + Meta verification | per-conversation; free-entry-point conversations free | job posting from chat, arrival codes, review requests |
| Brevo | `POST https://api.brevo.com/v3/smtp/email` | `api-key` header | 300 emails/day free | transactional email |

## 3. Paid partners (adapter contracts already the live ones)

| Partner | Endpoint | Role in ProVeri |
| --- | --- | --- |
| TradeSafe | `https://api.tradesafe.co.za/graphql` | regulated escrow/paymaster: splits, milestones, lay-by, drawdowns; PASA-authorised |
| Paystack | `https://api.paystack.co` (`/transaction/initialize`, `/transaction/split`, `/transfer`, `/refund`, `/dispute`, webhooks) | primary PSP: charges, split rules, pro payouts |
| Stripe | `https://api.stripe.com/v1` (`/payment_intents` capture-later, `/accounts`, `/transfers`) | cross-border cards, Connect payouts |
| PayFast | `https://www.payfast.co.za/eng/process` + ITN | Web Studio storefront checkout |
| Ozow | `https://api.ozow.com` (`/transactionrequest`, `/payout`, `/accountverification`) | instant-EFT escrow funding, cardless customers, account verification |
| Yoco | `https://payments.yoco.com/api` | on-site card payment at handover |
| Clickatell | `https://platform.clickatell.com/v1/message` | SMS OTPs and arrival codes |
| OmniCheck / Datanamix | `https://www.omnicheck.co.za/webservice` (`/said_verification`, `/avs_r`, `/cipc_company_match`, `/cipc_director_search`, `/aml_pep_screening`, `/3d_facial_liveness`) | DHA identity, AVS-R bank name match, CIPC, PEP/sanctions, liveness |
| Sentry / PostHog | SaaS | error monitoring; product analytics (no message contents, POPIA-scoped) |

## 4. Statutory registers referenced by the verification pipeline

These are the bodies whose registration makes a trade legal in South Africa.
The pipeline records the certificate and, where an API or register lookup
exists, confirms it; where none exists it publishes `WARN — register
confirmation pending` rather than asserting.

| Trade | Body | Legal basis | Lookup |
| --- | --- | --- | --- |
| Electrician | DoEL wireman's licence; ECA/SAIEE | OHS Act 85 of 1993, SANS 10142-1 | member directories |
| Plumber | PIRB / WSB | Water Services Act, SANS 10252/10254 | pirb.org.za registered-plumber search |
| Gas installer | SAQCC Gas | Pressure Equipment Regulations | saqccgas.org.za practitioner search |
| Builder | NHBRC | Housing Consumers Protection Measures Act 95 of 1998 | nhbrc.org.za enrolment search |
| Security / electric fence | PSIRA | Private Security Industry Regulation Act 56 of 2001 | psira.org.za verification |
| Estate agent | PPRA + FFC | Property Practitioners Act 22 of 2019 | theppra.org.za status check |
| Attorney / conveyancer | LPC | Legal Practice Act 28 of 2014 | lpc.org.za |
| Nurse / therapist | SANC / HPCSA | Nursing Act 33 of 2005; Health Professions Act 56 of 1974 | sanc.co.za register |
| Accountant / tax | SAICA/SAIPA/SAIT + SARS practitioner | Tax Administration Act | member directories |
| Driver (passenger/goods) | DoT PDP; RTMS | National Road Traffic Act 93 of 1996 | licensing departments |
| Pest control | DALRRD business permit | Agricultural Pest Act 36 of 1983 | dalrrd.gov.za |
| Childcare | DSD ECD registration | Children's Act 38 of 2005 | dsd.gov.za |

## 5. South-Africa-specific validation that runs entirely offline (free forever)

| Check | Implementation | Why it matters |
| --- | --- | --- |
| SA ID checksum + decode | `integrations/saIdentity.js` (Luhn, date, gender, citizenship) | catches typos and fabricated IDs before any paid bureau call |
| Bank + universal branch code shape | `integrations/bankVerification.js` (19 banks) | catches impossible payout details instantly |
| CIPC registration-number decode | `integrations/verificationSources.js COMPANY_REGISTRY` | decodes entity type from the `YYYY/NNNNNN/TT` suffix |
| VIN ISO 3779 structure + check digit | `marketplace/vehicles.js vinCheckDigit` | rejects 16-char and I/O/Q-containing VINs before any data purchase |
| SA plate format recognition | `marketplace/vehicles.js validateSaPlate` | national + legacy provincial formats |
| Haversine radius matching | `kernel/util.js distanceKm` | suburb-level matching without a paid geo API |

## 6. Honesty contract

1. Every adapter result carries `live: true|false` and, when false, a `reason`.
2. Offline fallbacks are **deterministic** so demos, tests and CI reproduce.
3. `GET /api/integrations` publishes the full catalogue, mode and HTTP stats;
   `POST /api/integrations/probe` re-probes the free sources on demand.
4. No adapter may return `PASS` while offline for a check whose whole purpose
   is external confirmation (identity bureau, AVS-R, CIPC status, statutory
   register). The code enforces this per adapter.

Run the probe:

```bash
npm run integrations:probe
```
