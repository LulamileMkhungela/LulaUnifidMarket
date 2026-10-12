'use strict';

/**
 * Lula ProVeri — Integration registry.
 *
 * One place that knows every external dependency, whether it is live, what it
 * costs, and what the product does when it is down. `GET /api/integrations`
 * exposes this so ops, auditors and partners can see the truth about what is
 * real and what is simulated — a marketplace that claims "verified" has to be
 * able to prove where the verification came from.
 */

const httpClient = require('./httpClient');
const { GEOCODING, WEATHER, HOLIDAYS, FX } = require('./publicData');
const { LOAD_SHEDDING, QUALIFICATIONS, COMPANY_REGISTRY, TRADE_REGISTERS } = require('./verificationSources');
const { MARKET, MUNICIPAL, SAFETY, PAYMENTS } = require('./context');
const saIdentity = require('./saIdentity');
const bankVerification = require('./bankVerification');
const { nowIso } = require('../kernel/util');

const MODE = process.env.PROVERI_INTEGRATION_MODE === 'offline' ? 'OFFLINE' : 'LIVE';

/**
 * The full catalogue of public data sources, endpoints and partners used by
 * ProVeri. `free` and `auth` are the two fields a product manager needs to
 * decide what can ship without a procurement cycle.
 */
const CATALOGUE = Object.freeze([
  /* ---- Free, no key, used in production today ---- */
  { id: 'open-meteo', name: 'Open-Meteo', purpose: 'Job-day weather risk for exterior trades', endpoint: 'https://api.open-meteo.com/v1/forecast', free: true, auth: 'none', licence: 'CC BY 4.0', rateLimit: '10,000 calls/day free', tier: 'LIVE' },
  { id: 'nominatim', name: 'OSM Nominatim', purpose: 'Address/suburb geocoding and radius search', endpoint: 'https://nominatim.openstreetmap.org/search', free: true, auth: 'User-Agent only', licence: 'ODbL 1.0', rateLimit: '1 request/second (heavy use needs a paid mirror)', tier: 'LIVE' },
  { id: 'zippopotam', name: 'Zippopotam.us', purpose: 'SA postal code → suburb/province/coordinates', endpoint: 'https://api.zippopotam.us/ZA/{postalCode}', free: true, auth: 'none', licence: 'Free public dataset', tier: 'LIVE' },
  { id: 'nager-date', name: 'Nager.Date', purpose: 'SA public holidays for availability and emergency tariffs', endpoint: 'https://date.nager.at/api/v3/PublicHolidays/{year}/ZA', free: true, auth: 'none', licence: 'MIT', tier: 'LIVE' },
  { id: 'er-api', name: 'ExchangeRate-API (open)', purpose: 'Remit-a-Job foreign currency quoting', endpoint: 'https://open.er-api.com/v6/latest/ZAR', free: true, auth: 'none', licence: 'Free with attribution, 1,500 req/month', tier: 'LIVE' },
  { id: 'stats-sa', name: 'Statistics South Africa', purpose: 'CPI indexing of price bands; QLFS labour-market context', endpoint: 'https://www.statssa.gov.za/publications/P0141/', free: true, auth: 'none', licence: 'Public domain with attribution', tier: 'LIVE' },
  { id: 'data-gov-za', name: 'data.gov.za CKAN', purpose: 'Dataset discovery for municipal and statistical data', endpoint: 'https://openapi.data.gov.za/api/3/action/package_search', free: true, auth: 'none', licence: 'Open data', tier: 'LIVE' },
  { id: 'cct-open-data', name: 'City of Cape Town Open Data Portal', purpose: 'Municipal boundaries, outage areas, water restrictions', endpoint: 'https://odp-cctegis.opendata.arcgis.com', free: true, auth: 'none', licence: 'City of Cape Town open licence', tier: 'LIVE' },
  { id: 'saps-crime-stats', name: 'SAPS Quarterly Crime Statistics', purpose: 'Aggregate safety context for verification friction only', endpoint: 'https://www.saps.gov.za/services/crimestats.php', free: true, auth: 'none', licence: 'Public domain', tier: 'LIVE', ethicsGuard: 'PROH-001: friction only, never ranking/pricing/eligibility' },
  { id: 'saqa-register', name: 'SAQA NQF public register', purpose: 'Trade qualification lookup for verification', endpoint: 'https://allqs.saqa.org.za/search.php?cat=qual', free: true, auth: 'none', licence: 'NQF qualifications are public property', tier: 'MIRRORED', note: 'No stable REST contract — mirrored nightly into a local index' },
  { id: 'eskom-community', name: 'EskomLoadShedding community API', purpose: 'Free national load-shedding stage fallback', endpoint: 'https://loadshedding.sts.io/v1/Stage', free: true, auth: 'none', licence: 'Open source (MIT)', tier: 'LIVE' },

  /* ---- Free tier exists, paid for the parts we need ---- */
  { id: 'eskomsepush', name: 'EskomSePush API', purpose: 'Area-level load-shedding schedules for slot recommendation', endpoint: 'https://developer.sepush.co.za/business/2.0/area', free: 'status + allowance only', auth: 'token', licence: 'Commercial', cost: 'Free tier 50 calls/day; area schedules from ~US$55/year', tier: 'KEY_REQUIRED' },
  { id: 'cipc-apiverse', name: 'CIPC APIVerse', purpose: 'Official company/beneficial-ownership registry checks', endpoint: 'https://cipc-apm-rs-dev.azure-api.net/enterprise/v1/', free: false, auth: 'Ocp-Apim-Subscription-Key + approval', cost: 'Undisclosed; eServices certified extracts R30–R100', tier: 'APPROVAL_REQUIRED' },
  { id: 'whatsapp-cloud', name: 'WhatsApp Business Cloud API', purpose: 'Job posting, notifications and arrival codes in WhatsApp', endpoint: 'https://graph.facebook.com/v21.0/{phone-id}/messages', free: 'free-entry-point conversations', auth: 'Bearer + Meta Business verification', tier: 'KEY_REQUIRED' },
  { id: 'brevo', name: 'Brevo', purpose: 'Transactional email', endpoint: 'https://api.brevo.com/v3/smtp/email', free: '300 emails/day', auth: 'api-key header', tier: 'KEY_REQUIRED' },
  { id: 'clickatell', name: 'Clickatell', purpose: 'SMS OTP and arrival codes', endpoint: 'https://platform.clickatell.com/v1/message', free: false, auth: 'Bearer API key', tier: 'KEY_REQUIRED' },

  /* ---- Paid partners, integration-ready ---- */
  { id: 'tradesafe', name: 'TradeSafe', purpose: 'Regulated escrow and paymaster (GraphQL API)', endpoint: 'https://api.tradesafe.co.za/graphql', free: 'playground', auth: 'merchant key', cost: 'From 1.5%; API flat 1.5%, R100 minimum non-API', tier: 'PARTNER', regulator: 'PASA third-party payment provider' },
  { id: 'paystack', name: 'Paystack', purpose: 'Primary PSP: charges, splits, transfers, refunds, disputes', endpoint: 'https://api.paystack.co', free: false, auth: 'Bearer secret key', cost: '1.5% + R5 local (capped R250); 3.9% international', tier: 'PARTNER' },
  { id: 'stripe', name: 'Stripe', purpose: 'Cross-border cards and Connect payouts', endpoint: 'https://api.stripe.com/v1', free: false, auth: 'Bearer secret key', cost: '3.4% + R5.00', tier: 'PARTNER' },
  { id: 'payfast', name: 'PayFast', purpose: 'Web Studio storefront checkout', endpoint: 'https://www.payfast.co.za/eng/process', free: false, auth: 'merchant ID + key', cost: '3.5% + R2.00', tier: 'PARTNER' },
  { id: 'ozow', name: 'Ozow', purpose: 'Instant EFT escrow funding + account verification', endpoint: 'https://api.ozow.com', free: false, auth: 'API key + RSA signature', cost: 'R3–R15 per transaction', tier: 'PARTNER' },
  { id: 'yoco', name: 'Yoco', purpose: 'On-site card payment at handover', endpoint: 'https://payments.yoco.com/api', free: false, auth: 'Bearer secret key', cost: '2.95% + R0.50', tier: 'PARTNER' },
  { id: 'omnicheck', name: 'VerifyID OmniCheck', purpose: 'DHA ID verification, AVS-R bank check, CIPC, AML/PEP, liveness', endpoint: 'https://www.omnicheck.co.za/webservice', free: false, auth: 'client credentials', tier: 'PARTNER', keyEndpoints: ['/said_verification', '/avs_r', '/cipc_company_match', '/cipc_company_search', '/cipc_director_search', '/aml_pep_screening', '/3d_facial_liveness'] },
  { id: 'datanamix', name: 'Datanamix / pbVerify', purpose: 'Realtime DHA ID, SARS VAT, CIPC director, credit and affordability', endpoint: 'https://www.datanamix.com/developer-hub/', free: false, auth: 'client credentials', tier: 'PARTNER' },
  { id: 'sentry', name: 'Sentry', purpose: 'Error monitoring', endpoint: 'https://sentry.io/api/', free: 'developer tier', auth: 'DSN', tier: 'OPS' },
  { id: 'posthog', name: 'PostHog', purpose: 'Product analytics (no message contents, POPIA-scoped)', endpoint: 'https://app.posthog.com', free: '1M events/month', auth: 'API key', tier: 'OPS' },
]);

/** Free sources the platform can run on with zero procurement. */
const FREE_TIER_IDS = CATALOGUE.filter((c) => c.free === true).map((c) => c.id);

const ADAPTERS = Object.freeze({
  geocoding: GEOCODING,
  weather: WEATHER,
  holidays: HOLIDAYS,
  fx: FX,
  loadShedding: LOAD_SHEDDING,
  qualifications: QUALIFICATIONS,
  companyRegistry: COMPANY_REGISTRY,
  tradeRegisters: TRADE_REGISTERS,
  market: MARKET,
  municipal: MUNICIPAL,
  safety: SAFETY,
  payments: PAYMENTS,
  saIdentity,
  bankVerification,
});

/** Environment-driven credentials. All optional — everything degrades safely. */
function credentials() {
  return {
    espToken: process.env.ESP_API_TOKEN || null,
    cipcApiKey: process.env.CIPC_API_KEY || null,
    cipcBaseUrl: process.env.CIPC_API_BASE || null,
    paystackSecret: process.env.PAYSTACK_SECRET_KEY || null,
    stripeSecret: process.env.STRIPE_SECRET_KEY || null,
    tradesafeKey: process.env.TRADESAFE_API_KEY || null,
    payfastMerchantId: process.env.PAYFAST_MERCHANT_ID || null,
    payfastMerchantKey: process.env.PAYFAST_MERCHANT_KEY || null,
    ozowApiKey: process.env.OZOW_API_KEY || null,
    yocoSecret: process.env.YOCO_SECRET_KEY || null,
    omniCheckKey: process.env.OMNICHECK_API_KEY || null,
    clickatellKey: process.env.CLICKATELL_API_KEY || null,
    brevoKey: process.env.BREVO_API_KEY || null,
    whatsappToken: process.env.WHATSAPP_CLOUD_TOKEN || null,
    whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  };
}

function configuredPartners() {
  const creds = credentials();
  return {
    loadShedding: Boolean(creds.espToken),
    companyRegistry: Boolean(creds.cipcApiKey),
    identityAndBank: Boolean(creds.omniCheckKey),
    payments: Boolean(creds.paystackSecret || creds.stripeSecret || creds.tradesafeKey),
    notifications: Boolean(creds.clickatellKey || creds.brevoKey || creds.whatsappToken),
  };
}

/** Probe every free live source and report what actually answered. */
async function probeLive({ timeoutMs = 8000 } = {}) {
  // The probe's whole job is to test the network, so it always forces it on.
  const started = nowIso();
  const results = [];
  const record = async (id, name, fn) => {
    const t0 = Date.now();
    try {
      const outcome = await fn();
      results.push({ id, name, reachable: Boolean(outcome?.live), latencyMs: Date.now() - t0, source: outcome?.source || null, detail: outcome?.reason || null });
    } catch (error) {
      results.push({ id, name, reachable: false, latencyMs: Date.now() - t0, source: null, detail: error.message });
    }
  };

  await Promise.all([
    record('open-meteo', 'Open-Meteo', () => WEATHER.forecast({ lat: -26.2041, lon: 28.0473, days: 3 })),
    record('nominatim', 'OSM Nominatim', () => GEOCODING.geocode('Sandton, Johannesburg')),
    record('zippopotam', 'Zippopotam.us', () => GEOCODING.lookupPostalCode('2196')),
    record('nager-date', 'Nager.Date', () => HOLIDAYS.forYear(new Date().getFullYear())),
    record('er-api', 'ExchangeRate-API', () => FX.rates('ZAR')),
    record('eskom-community', 'EskomLoadShedding', () => LOAD_SHEDDING.nationalStatus({ token: credentials().espToken })),
  ]);

  return {
    mode: MODE,
    probedAt: started,
    completedAt: nowIso(),
    timeoutMs,
    httpStats: httpClient.getStats(),
    configuredPartners: configuredPartners(),
    results,
    liveCount: results.filter((r) => r.reachable).length,
    totalCount: results.length,
    summary: results.map((r) => `${r.reachable ? '✓' : '✗'} ${r.name} (${r.latencyMs}ms)`).join('\n'),
  };
}

module.exports = {
  MODE,
  CATALOGUE,
  FREE_TIER_IDS,
  ADAPTERS,
  credentials,
  configuredPartners,
  probeLive,
  httpClient,
  ...ADAPTERS,
  // Uppercase aliases so call sites read like the documentation does.
  GEOCODING,
  WEATHER,
  HOLIDAYS,
  FX,
  LOAD_SHEDDING,
  QUALIFICATIONS,
  COMPANY_REGISTRY,
  TRADE_REGISTERS,
  MARKET,
  MUNICIPAL,
  SAFETY,
  PAYMENTS,
};
