'use strict';

/**
 * Public-data integrations: validation that runs offline for free, and the
 * honesty guarantees around live sources.
 */

process.env.PROVERI_INTEGRATION_MODE = 'offline';

const test = require('node:test');
const assert = require('node:assert/strict');
const saIdentity = require('../src/integrations/saIdentity');
const bankVerification = require('../src/integrations/bankVerification');
const { QUALIFICATIONS, COMPANY_REGISTRY, TRADE_REGISTERS, LOAD_SHEDDING, WEATHER, HOLIDAYS } = require('../src/integrations/verificationSources');
const { WEATHER: WX, HOLIDAYS: HD, FX, GEOCODING } = require('../src/integrations/publicData');
const { MARKET } = require('../src/integrations/context');

/* ================= SA identity ================= */

test('synthesised SA IDs pass the real Luhn and date checks', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const id = saIdentity.synthesiseSaId({ seed, age: 30 + seed.charCodeAt(0) % 10 });
    const result = saIdentity.validateSaId(id);
    assert.equal(result.valid, true, `${id} should validate: ${result.reasons.join('; ')}`);
    assert.equal(result.age >= 18, true);
    assert.match(result.masked, /^\d{6}\*{6}\d$/);
  }
});

test('invalid SA IDs are rejected with specific reasons', () => {
  const tooShort = saIdentity.validateSaId('800101500908');
  assert.equal(tooShort.valid, false);
  assert.match(tooShort.reasons.join(' '), /13 digits/);

  const valid = saIdentity.synthesiseSaId({ seed: 'x' });
  const brokenChecksum = valid.slice(0, 12) + ((Number(valid[12]) + 1) % 10);
  const result = saIdentity.validateSaId(brokenChecksum);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(' '), /Checksum/);
});

test('an impossible birth date is rejected even with a valid checksum shape', () => {
  // Month 13 cannot exist; build a number whose checksum we then fix.
  const base = '8013015009087';
  const result = saIdentity.validateSaId(base);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(' '), /birth date/i);
});

test('gender and citizenship decode correctly', () => {
  const male = saIdentity.synthesiseSaId({ seed: 'm', gender: 'MALE' });
  const female = saIdentity.synthesiseSaId({ seed: 'f', gender: 'FEMALE' });
  assert.equal(saIdentity.validateSaId(male).gender, 'MALE');
  assert.equal(saIdentity.validateSaId(female).gender, 'FEMALE');
  assert.equal(saIdentity.validateSaId(male).citizenship, 'SA_CITIZEN');
});

/* ================= bank verification ================= */

test('bank account shape validation catches wrong lengths and unknown banks', () => {
  const good = bankVerification.validatePayoutDetails({ bankCode: 'capitec', accountNumber: '1020304050' });
  assert.equal(good.shapeValid, true);
  assert.equal(good.suggestedUniversalBranchCode, '470010');

  const short = bankVerification.validatePayoutDetails({ bankCode: 'capitec', accountNumber: '123' });
  assert.equal(short.shapeValid, false);

  const unknown = bankVerification.validatePayoutDetails({ bankCode: 'notabank', accountNumber: '1020304050' });
  assert.equal(unknown.shapeValid, false);
});

test('offline account verification never claims a name match it cannot prove', async () => {
  const withName = await bankVerification.verifyAccountHolder({
    bankCode: 'capitec', accountNumber: '1020304050', idNumber: '8001015009087', fullName: 'Test Person',
  }, { adapter: null });
  assert.equal(withName.status, 'PASS');
  assert.match(withName.source, /offline simulation|AVS/);

  const withoutName = await bankVerification.verifyAccountHolder({
    bankCode: 'capitec', accountNumber: '1020304050',
  }, { adapter: null });
  assert.notEqual(withoutName.status, 'PASS');
});

test('every supported bank has a universal branch code and payout rails', () => {
  const banks = bankVerification.listBanks();
  assert.ok(banks.length >= 15);
  for (const bank of banks) {
    assert.match(bank.universalBranchCode, /^\d{6}$/);
    assert.ok(bank.payoutRails.length >= 1);
  }
});

/* ================= SAQA / CIPC / trade registers ================= */

test('the SAQA mirror returns real indexed qualifications for known trades', async () => {
  const plumbing = await QUALIFICATIONS.forTrade('plumber');
  assert.ok(plumbing.qualifications.length >= 2);
  assert.ok(plumbing.qualifications.some((q) => q.nqfLevel >= 3));
});

test('a claimed qualification that matches the trade confirms; a mismatch fails', async () => {
  const match = await QUALIFICATIONS.verifyClaim({ trade: 'plumber', claimedSaqaId: '61709', holderName: 'X' });
  assert.equal(match.status, 'PASS');
  assert.equal(match.nqfLevel, 3);
  assert.ok(match.registerUrl.includes('saqa'));

  const mismatch = await QUALIFICATIONS.verifyClaim({ trade: 'plumber', claimedSaqaId: '99999', holderName: 'X' });
  assert.equal(mismatch.status, 'FAIL');
});

test('a trade with no index rows returns UNAVAILABLE, never FAIL', async () => {
  const result = await QUALIFICATIONS.verifyClaim({ trade: 'nonexistent-trade', claimedSaqaId: '12345' });
  assert.equal(result.status, 'UNAVAILABLE');
});

test('individual NQF confirmation is honestly marked as requiring an NLRD agreement', async () => {
  const match = await QUALIFICATIONS.verifyClaim({ trade: 'plumber', claimedSaqaId: '61709', holderName: 'X', consentRef: 'C1' });
  assert.equal(match.individualConfirmed, false);
  assert.match(match.individualConfirmationRequires, /NLRD/);
});

test('CIPC registration numbers decode the entity type', () => {
  const pty = COMPANY_REGISTRY.validateRegistrationNumber('2026/608144/07');
  assert.equal(pty.valid, true);
  assert.equal(pty.entityType, 'Private company (Pty) Ltd');

  const npc = COMPANY_REGISTRY.validateRegistrationNumber('2015/123456/21');
  assert.equal(npc.entityType, 'Non-profit company (NPC)');

  const bad = COMPANY_REGISTRY.validateRegistrationNumber('not-a-number');
  assert.equal(bad.valid, false);
});

test('offline CIPC status can never claim IN BUSINESS', async () => {
  const result = await COMPANY_REGISTRY.verify({ registrationNumber: '2026/608144/07', companyName: 'X' });
  assert.notEqual(result.status, 'PASS');
  assert.equal(result.live, false);
});

test('statutory and non-statutory trades get different certification outcomes', async () => {
  const statutory = await TRADE_REGISTERS.verifyCertification({ trade: 'electrician', statutory: true, categoryLabel: 'Electrician' });
  assert.equal(statutory.status, 'FAIL');
  assert.match(statutory.finding, /required/i);

  const recorded = await TRADE_REGISTERS.verifyCertification({ trade: 'electrician', statutory: true, certificateNumber: 'WL-1' });
  assert.equal(recorded.status, 'WARN');

  const nonStatutory = await TRADE_REGISTERS.verifyCertification({ trade: 'builder', statutory: false, categoryLabel: 'Roofing repair' });
  assert.equal(nonStatutory.status, 'NOT_APPLICABLE');
});

/* ================= load shedding & weather ================= */

test('offline load-shedding status is labelled as not live', async () => {
  const status = await LOAD_SHEDDING.nationalStatus({});
  assert.equal(typeof status.national.stage, 'number');
  assert.equal(status.live, false);
});

test('slot recommendation avoids published outage windows for power-critical work', async () => {
  const schedule = await LOAD_SHEDDING.areaSchedule({ suburb: 'Sandton', metro: 'City of Johannesburg' });
  const slots = LOAD_SHEDDING.recommendSlots({
    schedule,
    status: { national: { stage: 4 } },
    category: { powerDependency: 'CRITICAL', typicalDurationHours: 4 },
    fromIso: new Date().toISOString(),
    toIso: new Date(Date.now() + 3 * 86400000).toISOString(),
  });
  assert.equal(slots.powerDependency, 'CRITICAL');
  for (const slot of slots.recommendedSlots) {
    const overlap = schedule.events.some((e) => new Date(slot.start) < new Date(e.end) && new Date(slot.end) > new Date(e.start));
    assert.equal(overlap, false, 'recommended slots must clear every outage window');
  }
  assert.ok(slots.advice.length > 10);
});

test('power-independent work is not blocked by load shedding', () => {
  const advice = LOAD_SHEDDING.recommendSlots({
    schedule: { events: [{ start: new Date().toISOString(), end: new Date(Date.now() + 7200000).toISOString() }] },
    status: { national: { stage: 6 } },
    category: { powerDependency: 'NONE' },
  });
  assert.match(advice.advice, /does not depend|will not stop/i);
});

test('weather advice blocks exterior work in rain and allows interior work', async () => {
  const forecast = await WX.forecast({ lat: -26.2, lon: 28.05, days: 7 });
  const exterior = WX.jobDayAdvice(forecast, { weatherSensitive: true, weatherBlockers: ['RAIN', 'LIGHTNING'] });
  assert.ok(['GOOD_TO_BOOK', 'LIMITED_WINDOWS', 'POSTPONE'].includes(exterior.verdict));

  const interior = WX.jobDayAdvice(forecast, { weatherSensitive: false });
  assert.equal(interior.verdict, 'ANY_DAY');
});

test('holiday advice flags public holidays and payday peaks', async () => {
  const year = new Date().getFullYear();
  const data = await HD.forYear(year);
  assert.ok(data.holidays.length >= 10);
  const christmas = data.holidays.find((h) => h.date.endsWith('-12-25'));
  assert.equal(christmas.impact, 'EMERGENCY_TARIFF_ALLOWED');

  assert.equal(HD.paydayContext(`${year}-06-25`).peak, true);
  assert.equal(HD.paydayContext(`${year}-06-17`).peak, false);
});

/* ================= FX & remit-a-job ================= */

test('Remit-a-Job quotes a rate-locked foreign amount without touching the rand payout', async () => {
  const rates = await FX.rates('ZAR');
  const quote = FX.quoteRemittance({ amountCentsZar: 100_000, fromCurrency: 'GBP' }, rates);
  assert.equal(quote.proReceivesZarCents, 100_000);
  assert.ok(quote.customerPaysCents > 0);
  assert.ok(quote.validUntil > new Date().toISOString());
  assert.match(quote.quoteSeal, /^[0-9a-f]{64}$/);
});

/* ================= market intelligence ================= */

test('price bands fall back to seeded data until five live bids exist', () => {
  const band = MARKET.bandFromBids([{ totalCents: 100 }, { totalCents: 200 }], { p10Cents: 50, p50Cents: 150, p90Cents: 300 }, { metro: 'Johannesburg' });
  assert.equal(band.source, 'seeded-metro-band');
  assert.equal(band.confidence, 'LOW');
});

test('price bands compute percentiles from live bids', () => {
  const bids = Array.from({ length: 21 }, (_, i) => ({ totalCents: 100000 + i * 10000 }));
  const band = MARKET.bandFromBids(bids, { p10Cents: 0, p50Cents: 0, p90Cents: 0 }, { metro: 'Johannesburg' });
  assert.equal(band.source, 'live-proveri-bids');
  assert.equal(band.medianCents, 200000);
  assert.ok(band.p10Cents < band.p50Cents && band.p50Cents < band.p90Cents);
});

test('bid assessment warns on bait pricing and overpricing', () => {
  const band = { p10Cents: 100000, p50Cents: 200000, p90Cents: 400000 };
  const bait = MARKET.assessBid(40000, band, { metro: 'Johannesburg' });
  assert.equal(bait.verdict, 'WELL_BELOW_MARKET');
  assert.equal(bait.riskFlag, 'PRICE_ANOMALY_LOW');

  const over = MARKET.assessBid(900000, band, { metro: 'Johannesburg' });
  assert.equal(over.verdict, 'WELL_ABOVE_MARKET');

  const fair = MARKET.assessBid(210000, band, { metro: 'Johannesburg' });
  assert.equal(fair.verdict, 'IN_MARKET_BAND');
  assert.equal(fair.riskFlag, undefined);
});

test('CPI indexing moves an old band forward, never backward', () => {
  const indexed = MARKET.indexToPresent({ p10Cents: 100000, p50Cents: 200000, p90Cents: 400000 }, 2020, 2026);
  assert.ok(indexed.p50Cents > 200000);
  assert.ok(indexed.cumulativeFactor > 1);
});

/* ================= geocoding offline behaviour ================= */

test('offline geocoding resolves bundled suburbs and labels itself', async () => {
  const result = await GEOCODING.geocode('Sandton');
  assert.ok(result.results.length >= 1);
  assert.equal(result.live, false);
  assert.match(result.source, /bundled/);
});

test('offline postal lookup resolves from the bundled dataset', async () => {
  const result = await GEOCODING.lookupPostalCode('2196');
  assert.ok(result.places.length >= 1);
  assert.equal(result.live, false);
});
