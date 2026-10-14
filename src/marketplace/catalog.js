'use strict';

/**
 * ProVeri — Catalogue: categories, geography and price bands.
 */

const path = require('node:path');
const fs = require('node:fs');
const { distanceKm, nowIso, clamp } = require('../kernel/util');
const { MARKET, MUNICIPAL } = require('../integrations/context');
const { GEOCODING } = require('../integrations/publicData');
const { TRADE_REGULATORS } = require('../kernel/verification');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const categoriesData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'categories.json'), 'utf8'));
const geographyData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'geography.json'), 'utf8'));

/** Band year for the seeded rand ranges in categories.json. */
const SEED_BAND_YEAR = 2026;

class Catalog {
  constructor({ store } = {}) {
    this.store = store;
    this.groups = categoriesData.groups;
    this.categories = new Map(categoriesData.categories.map((c) => [c.id, c]));
    this.metros = new Map(geographyData.metros.map((m) => [m.id, m]));
    this.provinces = geographyData.provinces;
  }

  /* ---------------- categories ---------------- */

  listCategories({ group, search, liveOnly = true } = {}) {
    let rows = [...this.categories.values()];
    if (group) rows = rows.filter((c) => c.group === group);
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter((c) =>
        c.label.toLowerCase().includes(needle)
        || c.commonJobs.some((j) => j.toLowerCase().includes(needle))
        || c.keywords.some((k) => k.toLowerCase().includes(needle)));
    }
    return rows.map((c) => this.summarize(c));
  }

  get(categoryId) {
    const category = this.categories.get(categoryId);
    if (!category) throw new Error(`unknown category: ${categoryId}`);
    return category;
  }

  summarize(category) {
    return {
      id: category.id,
      label: category.label,
      group: category.group,
      groupLabel: this.groups.find((g) => g.id === category.group)?.label,
      icon: this.groups.find((g) => g.id === category.group)?.icon,
      statutoryTrade: category.statutoryTrade,
      regulator: category.regulator,
      requiresCoc: category.requiresCoc,
      cocName: category.cocName,
      instantBook: category.instantBook,
      remoteDelivery: Boolean(category.remoteDelivery),
      loadSheddingOpportunity: Boolean(category.loadSheddingOpportunity),
      powerDependency: category.powerDependency,
      weatherSensitive: category.weatherSensitive,
      weatherBlockers: category.weatherBlockers,
      typicalDurationHours: category.typicalDurationHours,
      commonJobs: category.commonJobs,
      milestoneEscrow: Boolean(category.milestoneEscrow),
      inHomeDefault: Boolean(category.inHomeDefault),
      childrenDefault: Boolean(category.childrenDefault),
      vulnerableDefault: Boolean(category.vulnerableDefault),
      evidenceRequired: category.evidenceRequired,
      vehicleVerticalBridge: Boolean(category.vehicleVerticalBridge),
    };
  }

  /** Natural-language category resolution for the "describe your job" box. */
  resolveFromText(text) {
    const needle = String(text || '').toLowerCase();
    const scored = [...this.categories.values()].map((category) => {
      let score = 0;
      const hits = [];
      if (needle.includes(category.label.toLowerCase())) { score += 50; hits.push(category.label); }
      for (const keyword of category.keywords) {
        if (needle.includes(keyword)) { score += keyword.length >= 5 ? 14 : 8; hits.push(keyword); continue; }
        // People write "paint my lounge" and "clean the flat", not "painting" or
        // "cleaning": a word-start match on the stem counts, for less than an exact hit.
        const stem = keyword.replace(/(ing|ers|er)$/, '');
        if (stem !== keyword && stem.length >= 4 && new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(needle)) {
          score += 6;
          hits.push(stem);
        }
      }
      for (const job of category.commonJobs) {
        const words = job.toLowerCase().split(/\s+/);
        const matched = words.filter((w) => w.length > 3 && needle.includes(w)).length;
        if (matched >= 2) { score += 6 * matched; hits.push(job); }
      }
      return { category, score, hits: [...new Set(hits)] };
    }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score);

    const primary = scored[0] || null;
    return {
      text,
      matched: Boolean(primary),
      categoryId: primary?.category.id || null,
      confidence: primary ? clamp(Math.round((primary.score / 60) * 100), 5, 99) : 0,
      why: primary?.hits.slice(0, 5) || [],
      alternatives: scored.slice(1, 4).map((row) => ({ categoryId: row.category.id, label: row.category.label, score: row.score })),
      resolvedAt: nowIso(),
    };
  }

  /* ---------------- geography ---------------- */

  listMetros() {
    return [...this.metros.values()].map((m) => ({
      id: m.id,
      name: m.name,
      province: m.province,
      center: m.center,
      loadSheddingAuthority: m.loadSheddingAuthority,
      suburbCount: m.suburbs.length,
    }));
  }

  listSuburbs(metroId) {
    const metro = this.metros.get(metroId);
    if (!metro) throw new Error(`unknown metro: ${metroId}`);
    return metro.suburbs.map((s) => ({ ...s, metroId: metro.id, metroName: metro.name, province: metro.province }));
  }

  suburb(suburbId) {
    for (const metro of this.metros.values()) {
      const found = metro.suburbs.find((s) => s.id === suburbId);
      if (found) return { ...found, metroId: metro.id, metroName: metro.name, province: metro.province, municipalityCode: metro.municipalityCode };
    }
    return null;
  }

  findSuburbByName(name) {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) return null;
    const suburbs = [...this.metros.values()].flatMap((metro) => metro.suburbs);

    const exact = (value) => suburbs.find((s) => s.name.toLowerCase() === value || s.name.toLowerCase().startsWith(value));

    // "Midrand", then "Midrand, Johannesburg", then a street address that
    // happens to contain the suburb — people type all three.
    let found = exact(needle);
    if (!found) {
      for (const part of needle.split(/[,;]/).map((p) => p.trim()).filter(Boolean)) {
        found = exact(part);
        if (found) break;
      }
    }
    if (!found) {
      const words = needle.split(/\s+/).filter((w) => w.length > 3);
      found = suburbs.find((s) => words.includes(s.name.toLowerCase()));
    }
    return found ? this.suburb(found.id) : null;
  }

  /** Geocode a free-text address, preferring the live OSM lookup. */
  async geocodeAddress(addressText) {
    const bundled = this.findSuburbByName(addressText);
    if (bundled) {
      return {
        source: 'bundled-za-geography',
        live: false,
        lat: bundled.lat,
        lon: bundled.lon,
        suburb: bundled.name,
        suburbId: bundled.id,
        metroId: bundled.metroId,
        metroName: bundled.metroName,
        province: bundled.province,
        postalCode: bundled.postalCode,
        municipality: MUNICIPAL.municipalityFor({ lat: bundled.lat, lon: bundled.lon }, geographyData),
      };
    }
    let live = null;
    try {
      live = await GEOCODING.geocode(addressText);
    } catch (error) {
      return { resolved: false, source: 'geocoding-unavailable', reason: error.message, addressText };
    }
    const best = live?.results?.[0];
    if (!best) return { resolved: false, source: 'none', addressText };
    return {
      source: live.source,
      live: live.live,
      lat: best.lat,
      lon: best.lon,
      suburb: best.suburb || best.name,
      city: best.city,
      province: best.province,
      postalCode: best.postalCode,
      displayName: best.displayName,
      municipality: MUNICIPAL.municipalityFor({ lat: best.lat, lon: best.lon }, geographyData),
    };
  }

  suburbsWithinKm({ lat, lon }, radiusKm) {
    const results = [];
    for (const metro of this.metros.values()) {
      for (const suburb of metro.suburbs) {
        const km = distanceKm({ lat, lon }, { lat: suburb.lat, lon: suburb.lon });
        if (km <= radiusKm) {
          results.push({ ...suburb, metroId: metro.id, metroName: metro.name, province: metro.province, distanceKm: Number(km.toFixed(1)) });
        }
      }
    }
    return results.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /* ---------------- price intelligence ---------------- */

  /**
   * Live price band for a category in a metro: real ProVeri bids if there are
   * enough of them, otherwise the seeded band indexed forward with Stats SA CPI.
   */
  priceBand(categoryId, metroId) {
    const category = this.get(categoryId);
    const metro = this.metros.get(metroId);
    const seeded = MARKET.indexToPresent(category.band, SEED_BAND_YEAR);
    const bids = this.store ? this.store.find('bids', (b) => b.categoryId === categoryId && b.metroId === metroId) : [];
    const band = MARKET.bandFromBids(bids, seeded, { metro: metro?.name, categoryLabel: category.label });
    return {
      categoryId,
      categoryLabel: category.label,
      metroId,
      metro: metro?.name || 'National',
      ...band,
      calloutFeeCents: category.calloutFeeCents,
      hourlyRateCents: category.hourlyRateCents,
      cpiIndexing: seeded.cumulativeFactor ? { factor: seeded.cumulativeFactor, fromYear: seeded.indexedFromYear, toYear: seeded.indexedToYear, source: seeded.cpiSource } : null,
      format: {
        low: `R${(band.p10Cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`,
        typical: `R${(band.p50Cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`,
        high: `R${(band.p90Cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`,
      },
    };
  }

  /** What a customer should expect to pay, in plain language. */
  priceGuidance(categoryId, metroId, { scopeText } = {}) {
    const band = this.priceBand(categoryId, metroId);
    const category = this.get(categoryId);
    return {
      ...band,
      scopeText: scopeText || null,
      guidance: band.sampleSize >= 5
        ? `Real ProVeri bids for ${category.label} in ${band.metro}: most jobs land between R${(band.p25Cents / 100).toFixed(0)} and R${(band.p75Cents / 100).toFixed(0)}, with a median of R${(band.p50Cents / 100).toFixed(0)} across ${band.sampleSize} bids.`
        : `Indicative range for ${category.label} in ${band.metro}: R${(band.p10Cents / 100).toFixed(0)}–R${(band.p90Cents / 100).toFixed(0)}, typically around R${(band.p50Cents / 100).toFixed(0)}. These are market bands indexed with Stats SA CPI; they tighten automatically once ${category.label} pros start bidding in your area.`,
      instantBookEstimate: category.instantBook
        ? `Callout R${(category.calloutFeeCents.min / 100).toFixed(0)}–R${(category.calloutFeeCents.max / 100).toFixed(0)}, then R${(category.hourlyRateCents.min / 100).toFixed(0)}–R${(category.hourlyRateCents.max / 100).toFixed(0)} per hour.`
        : 'This category is quoted rather than instant-booked, because the scope varies too much to price blind.',
      trustNote: 'ProVeri never shows you a "from R99" price. Every band here comes from bids placed on this platform or from Stats SA-indexed market data.',
    };
  }

  /* ---------------- trade regulation ---------------- */

  regulatorFor(categoryId) {
    const category = this.get(categoryId);
    return TRADE_REGULATORS[category.trade] || { body: 'None (self-regulated)', requirement: 'Reference and portfolio verification', severity: 'RECOMMENDED' };
  }

  /** Categories that create load-shedding demand spikes. */
  loadSheddingOpportunities() {
    return [...this.categories.values()]
      .filter((c) => c.loadSheddingOpportunity)
      .map((c) => this.summarize(c));
  }

  /** Categories whose work can be delivered remotely. */
  remoteCategories() {
    return [...this.categories.values()].filter((c) => c.remoteDelivery).map((c) => this.summarize(c));
  }

  /** Full catalogue dump for the PWA to cache offline. */
  offlineBundle() {
    return {
      version: categoriesData.version,
      generatedAt: nowIso(),
      groups: this.groups,
      categories: [...this.categories.values()],
      metros: geographyData.metros,
      provinces: this.provinces,
      labourMarket: MARKET.LABOUR_MARKET,
      cpi: MARKET.CPI_SERIES,
    };
  }
}

module.exports = { Catalog, categoriesData, geographyData };
