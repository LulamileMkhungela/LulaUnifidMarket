'use strict';

/**
 * Lula ProVeri — Live public-data adapters.
 *
 * Every source below is genuinely public and was reachable when this
 * integration was written. Each adapter has three properties that make it safe
 * to ship:
 *
 *   1. `endpoint`  — the exact public URL, documented for auditors and devs
 *   2. `auth`      — 'none' | 'key' | 'token' (so ops know what breaks)
 *   3. `fallback`  — a deterministic offline result so the marketplace still
 *                     works on a flaky SA mobile connection or in a sandbox
 *
 * Nothing here requires a paid key to demonstrate value.
 */

const path = require('node:path');
const fs = require('node:fs');
const { request } = require('./httpClient');
const { sha256, nowIso, distanceKm, clamp } = require('../kernel/util');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const readData = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));

/* ==================================================================== *
 * 1. GEOCODING — OpenStreetMap Nominatim + Zippopotam postal codes
 * ==================================================================== */

const GEOCODING = {
  id: 'geocoding',
  label: 'Address & suburb geocoding',
  providers: [
    {
      name: 'OpenStreetMap Nominatim',
      endpoint: 'https://nominatim.openstreetmap.org/search',
      auth: 'none (User-Agent required by OSM usage policy, max 1 req/s)',
      licence: 'ODbL 1.0 — © OpenStreetMap contributors',
      terms: 'https://operations.osmfoundation.org/policies/nominatim/',
    },
    {
      name: 'Zippopotam.us',
      endpoint: 'https://api.zippopotam.us/ZA/{postalCode}',
      auth: 'none',
      licence: 'Free public postal-code dataset',
    },
  ],
  async geocode(query, { limit = 3, countryCodes = 'za', forceLive = false } = {}) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}`
      + `&format=jsonv2&limit=${limit}&countrycodes=${countryCodes}&addressdetails=1`;
    const res = await request(url, { timeoutMs: 8000, cacheTtlMs: 24 * 3600 * 1000, forceLive });
    if (res.ok && Array.isArray(res.data)) {
      return {
        source: 'nominatim',
        live: true,
        fromCache: res.fromCache,
        results: res.data.map((row) => ({
          name: row.name || row.display_name.split(',')[0],
          displayName: row.display_name,
          lat: Number(row.lat),
          lon: Number(row.lon),
          type: row.addresstype,
          suburb: row.address?.suburb || row.address?.neighbourhood || null,
          city: row.address?.city || row.address?.town || row.address?.municipality || null,
          province: row.address?.state || null,
          postalCode: row.address?.postcode || null,
          country: row.address?.country || 'South Africa',
        })),
        lookedUpAt: nowIso(),
      };
    }
    return this.fallbackGeocode(query);
  },

  async lookupPostalCode(postalCode) {
    const res = await request(`https://api.zippopotam.us/ZA/${encodeURIComponent(postalCode)}`, {
      timeoutMs: 6000,
      cacheTtlMs: 7 * 24 * 3600 * 1000,
    });
    if (res.ok && res.data?.places?.length) {
      return {
        source: 'zippopotam',
        live: true,
        postalCode,
        country: res.data.country,
        places: res.data.places.map((place) => ({
          name: place['place name'],
          lat: Number(place.latitude),
          lon: Number(place.longitude),
          province: place.state || null,
        })),
        lookedUpAt: nowIso(),
      };
    }
    return this.fallbackPostalCode(postalCode);
  },

  fallbackGeocode(query) {
    const geo = readData('geography.json');
    const needle = String(query || '').toLowerCase();
    const matches = [];
    for (const metro of geo.metros) {
      for (const suburb of metro.suburbs) {
        if (needle && !needle.includes(suburb.name.toLowerCase()) && !suburb.name.toLowerCase().includes(needle.split(',')[0].trim())) continue;
        matches.push({
          name: suburb.name,
          displayName: `${suburb.name}, ${metro.name}, ${metro.province}, South Africa`,
          lat: suburb.lat,
          lon: suburb.lon,
          suburb: suburb.name,
          city: metro.name,
          province: metro.province,
          postalCode: suburb.postalCode,
          country: 'South Africa',
          metroId: metro.id,
          suburbId: suburb.id,
        });
      }
    }
    return {
      source: 'bundled-za-geography',
      live: false,
      reason: 'Nominatim unreachable — served from the bundled South African suburb dataset',
      results: matches.slice(0, 10),
      lookedUpAt: nowIso(),
    };
  },

  fallbackPostalCode(postalCode) {
    const geo = readData('geography.json');
    for (const metro of geo.metros) {
      for (const suburb of metro.suburbs) {
        if (suburb.postalCode === postalCode) {
          return {
            source: 'bundled-za-geography',
            live: false,
            postalCode,
            country: 'South Africa',
            places: [{ name: suburb.name, lat: suburb.lat, lon: suburb.lon, province: metro.province }],
            lookedUpAt: nowIso(),
          };
        }
      }
    }
    return { source: 'bundled-za-geography', live: false, postalCode, places: [], lookedUpAt: nowIso() };
  },
};

/* ==================================================================== *
 * 2. WEATHER — Open-Meteo (free, no API key, CC-BY 4.0)
 * ==================================================================== */

const WEATHER = {
  id: 'weather',
  label: 'Job-day weather risk',
  providers: [{
    name: 'Open-Meteo',
    endpoint: 'https://api.open-meteo.com/v1/forecast',
    auth: 'none — free for non-commercial use, no key required',
    licence: 'CC BY 4.0, data from national weather services (SAWS via model blends)',
    docs: 'https://open-meteo.com/en/docs',
  }],

  WMO_CODES: {
    0: { label: 'Clear sky', icon: '☀️', outdoorOk: true },
    1: { label: 'Mainly clear', icon: '🌤️', outdoorOk: true },
    2: { label: 'Partly cloudy', icon: '⛅', outdoorOk: true },
    3: { label: 'Overcast', icon: '☁️', outdoorOk: true },
    45: { label: 'Fog', icon: '🌫️', outdoorOk: false, risk: 'VISIBILITY' },
    48: { label: 'Depositing rime fog', icon: '🌫️', outdoorOk: false, risk: 'VISIBILITY' },
    51: { label: 'Light drizzle', icon: '🌦️', outdoorOk: false, risk: 'RAIN' },
    53: { label: 'Moderate drizzle', icon: '🌦️', outdoorOk: false, risk: 'RAIN' },
    55: { label: 'Dense drizzle', icon: '🌧️', outdoorOk: false, risk: 'RAIN' },
    61: { label: 'Slight rain', icon: '🌧️', outdoorOk: false, risk: 'RAIN' },
    63: { label: 'Moderate rain', icon: '🌧️', outdoorOk: false, risk: 'RAIN' },
    65: { label: 'Heavy rain', icon: '🌧️', outdoorOk: false, risk: 'RAIN' },
    71: { label: 'Slight snow', icon: '🌨️', outdoorOk: false, risk: 'SNOW' },
    80: { label: 'Rain showers', icon: '🌦️', outdoorOk: false, risk: 'RAIN' },
    81: { label: 'Moderate rain showers', icon: '🌧️', outdoorOk: false, risk: 'RAIN' },
    82: { label: 'Violent rain showers', icon: '⛈️', outdoorOk: false, risk: 'RAIN' },
    95: { label: 'Thunderstorm', icon: '⛈️', outdoorOk: false, risk: 'LIGHTNING' },
    96: { label: 'Thunderstorm with hail', icon: '⛈️', outdoorOk: false, risk: 'LIGHTNING' },
    99: { label: 'Thunderstorm with heavy hail', icon: '⛈️', outdoorOk: false, risk: 'LIGHTNING' },
  },

  async forecast({ lat, lon, days = 7 }) {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m'
      + '&daily=weather_code,precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,uv_index_max'
      + '&timezone=Africa%2FJohannesburg'
      + `&forecast_days=${clamp(days, 1, 16)}`;

    const res = await request(url, { timeoutMs: 7000, cacheTtlMs: 15 * 60 * 1000 });
    if (res.ok && res.data?.daily) {
      const d = res.data.daily;
      return {
        source: 'open-meteo',
        live: true,
        fromCache: res.fromCache,
        timezone: res.data.timezone,
        current: res.data.current
          ? {
            temperatureC: res.data.current.temperature_2m,
            precipitationMm: res.data.current.precipitation,
            windKmh: res.data.current.wind_speed_10m,
            humidityPercent: res.data.current.relative_humidity_2m,
            condition: this.describe(res.data.current.weather_code),
            observedAt: res.data.current.time,
          }
          : null,
        daily: d.time.map((date, index) => ({
          date,
          condition: this.describe(d.weather_code[index]),
          rainProbabilityPercent: d.precipitation_probability_max[index],
          rainMm: d.precipitation_sum[index],
          highC: d.temperature_2m_max[index],
          lowC: d.temperature_2m_min[index],
          windKmhMax: d.wind_speed_10m_max[index],
          uvIndexMax: d.uv_index_max[index],
        })),
        lookedUpAt: nowIso(),
      };
    }
    return this.fallbackForecast({ lat, lon, days });
  },

  describe(code) {
    const entry = this.WMO_CODES[code] || { label: 'Unknown', icon: '❔', outdoorOk: true };
    return { code, ...entry };
  },

  /**
   * Turn a forecast into a job-day recommendation for weather-sensitive work.
   * This is what actually cuts disputes: "the roofer couldn't come because of
   * rain" becomes a scheduled, evidence-backed reschedule instead of a fight.
   */
  jobDayAdvice(forecast, category, { blockers } = {}) {
    if (!category?.weatherSensitive) {
      return { sensitive: false, verdict: 'ANY_DAY', advice: 'This job is not weather dependent — book the earliest slot that suits you.' };
    }
    const activeBlockers = new Set(blockers || category.weatherBlockers || ['RAIN', 'LIGHTNING']);
    const rows = (forecast.daily || []).map((day) => {
      const risks = [];
      if (activeBlockers.has('RAIN') && (day.rainProbabilityPercent >= 60 || day.rainMm >= 2 || day.condition.risk === 'RAIN')) risks.push('RAIN');
      if (activeBlockers.has('LIGHTNING') && day.condition.risk === 'LIGHTNING') risks.push('LIGHTNING');
      if (activeBlockers.has('STRONG_WIND') && day.windKmhMax >= 40) risks.push('STRONG_WIND');
      if (activeBlockers.has('HIGH_HUMIDITY') && day.condition.label.toLowerCase().includes('fog')) risks.push('HIGH_HUMIDITY');
      return { ...day, blocked: risks.length > 0, risks };
    });
    const good = rows.filter((d) => !d.blocked);
    return {
      sensitive: true,
      verdict: good.length === 0 ? 'POSTPONE' : good.length < rows.length / 2 ? 'LIMITED_WINDOWS' : 'GOOD_TO_BOOK',
      bestDays: good.slice(0, 3).map((d) => d.date),
      blockedDays: rows.filter((d) => d.blocked).map((d) => ({ date: d.date, risks: d.risks })),
      advice: good.length === 0
        ? 'Every day in this forecast window has a weather blocker for this trade. ProVeri will auto-notify both parties and reschedule free of charge — no cancellation penalty, no dispute.'
        : `Best days for this work: ${good.slice(0, 3).map((d) => d.date).join(', ')}. Days flagged below carry a real risk of the job stopping halfway.`,
      live: forecast.live,
      rows,
    };
  },

  fallbackForecast({ lat, lon, days = 7 }) {
    // Deterministic pseudo-forecast derived from the coordinates so tests and
    // offline demos produce stable, believable Highveld/Coastal patterns.
    const seed = Number.parseInt(sha256(`${lat}:${lon}`).slice(0, 8), 16);
    const daily = [];
    for (let i = 0; i < days; i += 1) {
      const daySeed = (seed + i * 7919) % 100;
      const isHighveldRain = lat < -25 && daySeed > 62;
      const code = isHighveldRain ? (daySeed > 90 ? 95 : 80) : daySeed < 25 ? 2 : daySeed < 60 ? 1 : 0;
      daily.push({
        date: new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10),
        condition: this.describe(code),
        rainProbabilityPercent: isHighveldRain ? 55 + (daySeed % 40) : daySeed % 20,
        rainMm: isHighveldRain ? 2 + (daySeed % 12) : 0,
        highC: 18 + (daySeed % 12),
        lowC: 7 + (daySeed % 8),
        windKmhMax: 8 + (daySeed % 32),
        uvIndexMax: 4 + (daySeed % 7),
      });
    }
    return {
      source: 'deterministic-offline-forecast',
      live: false,
      reason: 'Open-Meteo unreachable — offline forecast generated for demonstration',
      timezone: 'Africa/Johannesburg',
      current: null,
      daily,
      lookedUpAt: nowIso(),
    };
  },
};

/* ==================================================================== *
 * 3. PUBLIC HOLIDAYS — Nager.Date (free, no key, MIT)
 * ==================================================================== */

const HOLIDAYS = {
  id: 'holidays',
  label: 'SA public holidays & availability calendar',
  providers: [{
    name: 'Nager.Date',
    endpoint: 'https://date.nager.at/api/v3/PublicHolidays/{year}/ZA',
    auth: 'none',
    licence: 'MIT — free for commercial and non-commercial use',
    docs: 'https://date.nager.at/site/opensourceapi',
  }],

  /** Holidays that materially affect trades (tariff / availability impact). */
  IMPACT: {
    highDemand: ['Heritage Day', 'Day of Reconciliation', 'Christmas Day', 'St. Stephen\'s Day', 'Day of Goodwill', 'New Year\'s Day'],
    braaiSeason: ['Heritage Day'],
    emergencyPricing: ['Christmas Day', 'Day of Goodwill', 'New Year\'s Day', 'Good Friday', 'Family Day'],
  },

  async forYear(year = new Date().getUTCFullYear()) {
    const res = await request(`https://date.nager.at/api/v3/PublicHolidays/${year}/ZA`, {
      timeoutMs: 6000,
      cacheTtlMs: 30 * 24 * 3600 * 1000,
    });
    if (res.ok && Array.isArray(res.data)) {
      return {
        source: 'nager-date',
        live: true,
        fromCache: res.fromCache,
        year,
        holidays: res.data.map((h) => ({
          date: h.date,
          name: h.localName || h.name,
          englishName: h.name,
          types: h.types,
          impact: this.classify(h.name),
        })),
        lookedUpAt: nowIso(),
      };
    }
    return this.fallback(year);
  },

  classify(name) {
    if (this.IMPACT.emergencyPricing.includes(name)) return 'EMERGENCY_TARIFF_ALLOWED';
    if (this.IMPACT.highDemand.includes(name)) return 'HIGH_DEMAND';
    return 'NORMAL_PUBLIC_HOLIDAY';
  },

  /** Availability & pricing guidance for a date range. */
  adviceForDate(isoDate, holidayData) {
    const holiday = (holidayData?.holidays || []).find((h) => h.date === isoDate);
    const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
    const isSunday = weekday === 0;
    const isSaturday = weekday === 6;

    if (holiday) {
      return {
        date: isoDate,
        kind: 'PUBLIC_HOLIDAY',
        name: holiday.englishName || holiday.name,
        impact: holiday.impact,
        advice: holiday.impact === 'EMERGENCY_TARIFF_ALLOWED'
          ? 'Emergency/after-hours tariff applies. ProVeri shows the customer the tariff before they book so there is no surprise on the invoice.'
          : 'Public holiday — most pros charge a premium and availability is limited. Book early or pick a weekday.',
      };
    }
    if (isSunday) return { date: isoDate, kind: 'SUNDAY', advice: 'Sunday work attracts a premium for most trades; availability is limited.' };
    if (isSaturday) return { date: isoDate, kind: 'SATURDAY', advice: 'Saturday is the busiest booking day in South Africa — expect a short premium and book 2–3 days ahead.' };
    return { date: isoDate, kind: 'WEEKDAY', advice: 'Best availability and standard rates.' };
  },

  /** Fridays around the 25th and month-end are SA payday peaks. */
  paydayContext(isoDate) {
    const day = Number(isoDate.slice(8, 10));
    if (day === 25 || day === 1 || day === 7 || day === 15) {
      return { peak: true, reason: 'South African salary payday window — demand spikes and good pros book out 2–4 days earlier.' };
    }
    return { peak: false, reason: 'Normal demand period.' };
  },

  fallback(year) {
    const fixed = [
      ['01-01', 'New Year\'s Day'], ['03-21', 'Human Rights Day'], ['04-27', 'Freedom Day'],
      ['05-01', 'Workers\' Day'], ['06-16', 'Youth Day'], ['08-09', 'National Women\'s Day'],
      ['09-24', 'Heritage Day'], ['12-16', 'Day of Reconciliation'], ['12-25', 'Christmas Day'], ['12-26', 'Day of Goodwill'],
    ];
    return {
      source: 'bundled-fallback',
      live: false,
      reason: 'Nager.Date unreachable — fixed SA holidays only (movable feasts need the live API)',
      year,
      holidays: fixed.map(([md, name]) => ({ date: `${year}-${md}`, name, englishName: name, types: ['Public'], impact: this.classify(name) })),
      lookedUpAt: nowIso(),
    };
  },
};

/* ==================================================================== *
 * 4. FX — open.er-api.com (free, no key) for diaspora-funded jobs
 * ==================================================================== */

const FX = {
  id: 'fx',
  label: 'Remit-a-Job currency conversion',
  providers: [{
    name: 'ExchangeRate-API (free tier)',
    endpoint: 'https://open.er-api.com/v6/latest/ZAR',
    auth: 'none on the open tier',
    licence: 'Free with attribution; 1,500 requests/month',
    docs: 'https://www.exchangerate-api.com/docs/free',
  }, {
    name: 'South African Reserve Bank',
    endpoint: 'https://www.resbank.co.za/research/statistics/online-statistical-query',
    auth: 'none (public statistical release)',
    licence: 'Public domain — official ZAR reference rates',
    note: 'Used as the authoritative reconciliation source for settlement, not for live quoting.',
  }],

  FALLBACK_RATES: { ZAR: 1, USD: 0.0606, GBP: 0.0448, EUR: 0.0541, BWP: 0.807, NAD: 1, ZWL: 1446, MZN: 3.856, LSL: 1, SZL: 1, CAD: 0.0775, AUD: 0.0867 },

  async rates(base = 'ZAR') {
    const res = await request(`https://open.er-api.com/v6/latest/${base}`, { timeoutMs: 6000, cacheTtlMs: 60 * 60 * 1000 });
    if (res.ok && res.data?.rates) {
      return {
        source: 'open.er-api.com',
        live: true,
        fromCache: res.fromCache,
        base,
        rates: res.data.rates,
        asOfUtc: res.data.time_last_update_utc,
        nextUpdateUtc: res.data.time_next_update_utc,
        lookedUpAt: nowIso(),
      };
    }
    return {
      source: 'bundled-fallback-rates',
      live: false,
      reason: 'Exchange-rate API unreachable — indicative bundled rates; settlement always reconciles against the SARB reference rate',
      base,
      rates: base === 'ZAR' ? this.FALLBACK_RATES : this._invert(base),
      lookedUpAt: nowIso(),
    };
  },

  _invert(base) {
    const zarRate = this.FALLBACK_RATES[base] || 1;
    return Object.fromEntries(Object.entries(this.FALLBACK_RATES).map(([code, rate]) => [code, rate / zarRate]));
  },

  /**
   * Remit-a-Job: family abroad funds a job for a relative in South Africa.
   * Returns the foreign amount to charge plus the ZAR that lands in escrow.
   */
  quoteRemittance({ amountCentsZar, fromCurrency, markupPercent = 1.5 }, rates) {
    const rate = rates?.rates?.[fromCurrency];
    if (!rate) throw new Error(`no rate available for ${fromCurrency}`);
    const foreignCents = Math.ceil(amountCentsZar * rate);
    const markupCents = Math.round((foreignCents * markupPercent) / 100);
    return {
      fromCurrency,
      toCurrency: 'ZAR',
      rate,
      zarAmountCents: amountCentsZar,
      foreignAmountCents: foreignCents,
      markupPercent,
      markupCents,
      customerPaysCents: foreignCents + markupCents,
      customerPaysDisplay: `${(foreignCents / 100 + markupCents / 100).toFixed(2)} ${fromCurrency}`,
      proReceivesZarCents: amountCentsZar,
      rateAsOf: rates?.asOfUtc || rates?.lookedUpAt,
      quotedAt: nowIso(),
      quoteSeal: sha256({ amountCentsZar, fromCurrency, rate }),
      validUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  },
};

module.exports = { GEOCODING, WEATHER, HOLIDAYS, FX };
