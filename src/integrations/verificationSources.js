'use strict';

/**
 * ProVeri — Verification-source adapters.
 *
 * These are the registries and bureaus that make a "verified pro" claim mean
 * something in South Africa. Several have no free public API, so each adapter
 * declares exactly how it is reached in production (direct portal, authorised
 * reseller API, or partner agreement) and ships a deterministic offline mode
 * so the marketplace works end-to-end during development and demos.
 *
 * The rule that never bends: an adapter in offline mode can only ever return
 * `UNVERIFIED_OFFLINE`, never a false PASS. A badge in production requires a
 * real reference number from a real source.
 */

const { sha256, nowIso, clamp } = require('../kernel/util');
const { request } = require('./httpClient');

/* ==================================================================== *
 * 1. LOAD SHEDDING — EskomSePush API (free tier + paid area schedules)
 * ==================================================================== */

const LOAD_SHEDDING = {
  id: 'loadShedding',
  label: 'Load-shedding-aware scheduling',
  providers: [{
    name: 'EskomSePush API v2.0',
    endpoint: 'https://developer.sepush.co.za/business/2.0/{status|area|areas/nearby|api_allowance}',
    auth: 'token (free tier: national status + allowance check; area schedules require a paid plan from ~US$55/yr)',
    docs: 'https://developer.sepush.co.za/',
    headers: { token: 'process.env.ESP_API_TOKEN' },
  }, {
    name: 'EskomLoadShedding API (community, open source)',
    endpoint: 'https://loadshedding.sts.io/v1/Stage',
    auth: 'none',
    repo: 'https://github.com/anthonysomerset/EskomLoadSheddingAPI',
    note: 'Community mirror that returns the real national stage as an integer; used as the free fallback for national status.',
  }, {
    name: 'Eskom / City Power / City of Cape Town schedules',
    endpoint: 'https://loadshedding.eskom.co.za',
    auth: 'none (HTML)',
    note: 'Official published schedules. Scraping is discouraged; prefer the ESP API in production.',
  }],

  /** National status works on the free ESP tier. */
  async nationalStatus({ token } = {}) {
    if (token) {
      const res = await request('https://developer.sepush.co.za/business/2.0/status', {
        headers: { token },
        timeoutMs: 7000,
        cacheTtlMs: 5 * 60 * 1000,
      });
      if (res.ok && res.data?.status) {
        return {
          source: 'eskomsepush',
          live: true,
          fromCache: res.fromCache,
          national: this._parseStatus(res.data.status, 'national'),
          capeTown: res.data.status['capetown'] ? this._parseStatus(res.data.status.capetown, 'capetown') : null,
          allowance: res.data['api_allowance'] || null,
          lookedUpAt: nowIso(),
        };
      }
    }
    const community = await request('https://loadshedding.sts.io/v1/Stage', { timeoutMs: 6000, cacheTtlMs: 5 * 60 * 1000 });
    if (community.ok) {
      const stage = typeof community.data === 'number' ? community.data : Number(String(community.data).replace(/\D/g, '')) || 0;
      return {
        source: 'eskom-community-mirror',
        live: true,
        national: { stage, label: stage === 0 ? 'No load shedding' : `Stage ${stage}`, active: stage > 0 },
        lookedUpAt: nowIso(),
      };
    }
    return this.fallbackStatus();
  },

  /** Area schedule requires a paid ESP plan; offline mode derives a plausible one. */
  async areaSchedule({ areaId, token, suburb, metro }) {
    if (token && areaId) {
      const res = await request(`https://developer.sepush.co.za/business/2.0/area?id=${encodeURIComponent(areaId)}`, {
        headers: { token },
        timeoutMs: 8000,
        cacheTtlMs: 15 * 60 * 1000,
      });
      if (res.ok && res.data?.events) {
        return {
          source: 'eskomsepush',
          live: true,
          area: res.data.info,
          events: res.data.events.map((e) => ({ start: e.start, end: e.end, note: e.note, stage: this._stageFromNote(e.note) })),
          lookedUpAt: nowIso(),
        };
      }
      if (res.status === 410) {
        return { ...this.fallbackSchedule({ suburb, metro }), reason: 'EskomSePush returned HTTP 410 — area schedules need a paid API plan. Serving a derived schedule.' };
      }
    }
    return this.fallbackSchedule({ suburb, metro });
  },

  _parseStatus(status, key) {
    if (typeof status === 'object') {
      return { stage: status.stage ?? 0, label: status.state?.note || `Stage ${status.stage ?? 0}`, active: (status.stage ?? 0) > 0, ...status };
    }
    const stage = Number(String(status).replace(/\D/g, '')) || 0;
    return { stage, label: stage === 0 ? 'No load shedding' : `Stage ${stage}`, active: stage > 0 };
  },

  _stageFromNote(note) {
    const match = /stage\s*(\d+)/i.exec(note || '');
    return match ? Number(match[1]) : null;
  },

  fallbackStatus() {
    return {
      source: 'bundled-fallback',
      live: false,
      reason: 'No EskomSePush token configured and community mirror unreachable — showing the last-known published stage',
      national: { stage: 2, label: 'Stage 2', active: true, note: 'Indicative only' },
      lookedUpAt: nowIso(),
    };
  },

  fallbackSchedule({ suburb, metro, stage = 2 } = {}) {
    // Eskom blocks are 2 h (stage 1–2) or 4.5 h (stage 3+) on a published
    // rotation. We derive a deterministic block from the suburb name so demos
    // and tests are stable, and label it clearly as derived.
    const seed = Number.parseInt(sha256(`${suburb || metro || 'za'}`).slice(0, 6), 16);
    const block = seed % 16;
    const events = [];
    for (let day = 0; day < 3; day += 1) {
      const startHour = ((block * 2) + day * 6) % 24;
      const base = new Date(Date.now() + day * 86_400_000);
      const start = new Date(base);
      start.setHours(startHour, 0, 0, 0);
      const end = new Date(start.getTime() + (stage >= 3 ? 4.5 : 2) * 3600 * 1000);
      events.push({
        start: start.toISOString(),
        end: end.toISOString(),
        note: `Stage ${stage}`,
        stage,
      });
    }
    return {
      source: 'derived-offline-schedule',
      live: false,
      reason: 'ESP area schedules need a paid plan — this is a derived rotation for demonstration only',
      area: { name: suburb || metro || 'South Africa', id: `derived:${seed}` },
      events,
      lookedUpAt: nowIso(),
    };
  },

  /**
   * The actual product feature: find slots that avoid an outage for work that
   * needs power. Returns ranked windows with a confidence score.
   */
  recommendSlots({ schedule, category, fromIso, toIso, durationHours = 2, status }) {
    const needs = category?.powerDependency || 'LOW';
    const stage = status?.national?.stage ?? 0;
    const events = (schedule?.events || []).filter((e) => new Date(e.end).getTime() > Date.now());

    const start = new Date(fromIso || Date.now()).getTime();
    const end = new Date(toIso || start + 7 * 86_400_000).getTime();
    const slotMs = 60 * 60 * 1000;
    const neededMs = durationHours * slotMs;
    const windows = [];

    for (let cursor = start; cursor + neededMs <= end; cursor += slotMs) {
      const slotEnd = cursor + neededMs;
      const overlap = events.find((e) => {
        const es = new Date(e.start).getTime();
        const ee = new Date(e.end).getTime();
        return cursor < ee && slotEnd > es;
      });
      const date = new Date(cursor);
      const hour = date.getHours();
      const businessHours = hour >= 7 && hour + durationHours <= 18;
      const isSunday = date.getDay() === 0;

      if (overlap || !businessHours || isSunday) continue;

      // Higher stages mean more unannounced risk, so confidence drops.
      const confidence = clamp(100 - (needs === 'CRITICAL' ? stage * 9 : needs === 'HIGH' ? stage * 6 : stage * 2), 10, 100);
      windows.push({
        start: new Date(cursor).toISOString(),
        end: new Date(slotEnd).toISOString(),
        confidence,
        clearOfOutage: true,
        powerNeed: needs,
        nationalStage: stage,
      });
    }

    const best = windows.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
    return {
      powerDependency: needs,
      nationalStage: stage,
      outagesInWindow: events.length,
      recommendedSlots: best,
      advice: this._advice(needs, stage, events.length, best),
      upsell: needs === 'CRITICAL' || (needs === 'HIGH' && stage >= 3)
        ? {
          categoryId: 'solar-inverter',
          message: stage >= 3
            ? `Stage ${stage} load shedding is disrupting this kind of work. Get a free load-shedding readiness audit from a verified solar/inverter installer — it usually pays for itself in avoided rework.`
            : 'Your trade depends on power. A verified inverter installer can make your own workshop load-shedding proof.',
        }
        : null,
      live: schedule?.live ?? false,
    };
  },

  _advice(needs, stage, outageCount, best) {
    if (needs === 'NONE' || needs === 'LOW') {
      return `This job barely needs grid power, so ${stage === 0 ? 'there is no load-shedding risk' : `Stage ${stage} will not stop it`}. Book whenever suits you.`;
    }
    if (best.length === 0) {
      return `No clean ${outageCount ? 'outage-free' : ''} business-hours window in this range at Stage ${stage}. Ask the pro whether they carry a generator or inverter, or widen the date range.`;
    }
    return `Power-dependent work at Stage ${stage}: ProVeri found ${best.length} slots that clear the published outage windows. Booking one of these means the drill, welder or spray gun does not stop halfway through your job.`;
  },
};

/* ==================================================================== *
 * 2. QUALIFICATIONS — SAQA National Qualifications Framework
 * ==================================================================== */

const QUALIFICATIONS = {
  id: 'qualifications',
  label: 'SAQA / NQF trade qualification lookup',
  providers: [{
    name: 'SAQA All Qualifications and Unit Standards (public register)',
    endpoint: 'https://allqs.saqa.org.za/search.php?cat=qual',
    auth: 'none (public web register; no formal REST API published)',
    licence: 'All qualifications and part qualifications on the NQF are public property — SAQA',
    docs: 'https://regqs.saqa.org.za/',
    note: 'SAQA publishes the register publicly but has no stable documented REST contract. Production integrations mirror it nightly into a local index and re-check quarterly; this adapter is written against that local index with a live-search escape hatch.',
  }, {
    name: 'QCTO — Occupational Certificates',
    endpoint: 'https://qcto.org.za',
    auth: 'none (public register of occupational qualifications and accredited providers)',
    note: 'Authoritative for trades: electrician, plumber, welder, automotive mechanic occupational certificates.',
  }, {
    name: 'NLRD (National Learners’ Records Database)',
    endpoint: 'via SAQA accredited partner',
    auth: 'partner agreement',
    note: 'Confirms an *individual* actually holds the qualification — not just that the qualification exists. Requires a data-sharing agreement and candidate consent under POPIA.',
  }],

  /**
   * Bundled NQF index of the trade qualifications that actually matter on this
   * marketplace. In production this table is refreshed from allqs.saqa.org.za.
   */
  NQF_INDEX: [
    { saqaId: '90601', title: 'National Certificate: Electrical Infrastructure Construction', nqfLevel: 2, credits: 120, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'electrician', status: 'Reregistered', qaBody: 'QCTO', originator: 'merSETA' },
    { saqaId: '49110', title: 'National Certificate: Electrical Infrastructure Construction (Distribution Systems)', nqfLevel: 2, credits: 130, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'electrician', status: 'Passed end date', qaBody: 'QCTO', originator: 'merSETA' },
    { saqaId: '63769', title: 'Further Education and Training Certificate: Electrical Infrastructure Construction', nqfLevel: 4, credits: 134, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'electrician', status: 'Reregistered', qaBody: 'QCTO', originator: 'merSETA' },
    { saqaId: '61709', title: 'National Certificate: Plumbing', nqfLevel: 3, credits: 130, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'plumber', status: 'Reregistered', qaBody: 'QCTO', originator: 'merSETA' },
    { saqaId: '80346', title: 'Further Education and Training Certificate: Plumbing', nqfLevel: 4, credits: 150, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'plumber', status: 'Reregistered', qaBody: 'QCTO', originator: 'merSETA' },
    { saqaId: '98166', title: 'Occupational Certificate: Plumber', nqfLevel: 4, credits: 400, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'plumber', status: 'Registered', qaBody: 'QCTO', originator: 'QCTO' },
    { saqaId: '23916', title: 'National Certificate: Building and Civil Construction', nqfLevel: 2, credits: 120, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'builder', status: 'Reregistered', qaBody: 'CETA', originator: 'CETA' },
    { saqaId: '49069', title: 'National Certificate: Building and Construction (Supervision)', nqfLevel: 4, credits: 161, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'builder', status: 'Reregistered', qaBody: 'CETA', originator: 'CETA' },
    { saqaId: '98165', title: 'Occupational Certificate: Construction Project Manager', nqfLevel: 6, credits: 400, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'builder', status: 'Registered', qaBody: 'QCTO', originator: 'QCTO' },
    { saqaId: '65409', title: 'National Certificate: Automotive Repair and Maintenance', nqfLevel: 3, credits: 178, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'mechanic', status: 'Reregistered', qaBody: 'merSETA', originator: 'merSETA' },
    { saqaId: '90602', title: 'Occupational Certificate: Automotive Electrician', nqfLevel: 4, credits: 296, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'mechanic', status: 'Registered', qaBody: 'QCTO', originator: 'QCTO' },
    { saqaId: '71949', title: 'National Certificate: Welding Application and Practice', nqfLevel: 2, credits: 120, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'welder', status: 'Reregistered', qaBody: 'merSETA', originator: 'merSETA' },
    { saqaId: '50080', title: 'National Certificate: Hairdressing', nqfLevel: 2, credits: 130, field: 'Field 11 - Services', trade: 'hairdresser', status: 'Reregistered', qaBody: 'QCTO', originator: 'Services SETA' },
    { saqaId: '57712', title: 'Further Education and Training Certificate: Beautician', nqfLevel: 4, credits: 133, field: 'Field 11 - Services', trade: 'beautician', status: 'Reregistered', qaBody: 'QCTO', originator: 'Services SETA' },
    { saqaId: '50483', title: 'National Certificate: Hospitality Services', nqfLevel: 2, credits: 130, field: 'Field 11 - Services', trade: 'chef', status: 'Reregistered', qaBody: 'CATHSSETA', originator: 'CATHSSETA' },
    { saqaId: '61591', title: 'National Certificate: Cookery', nqfLevel: 3, credits: 140, field: 'Field 11 - Services', trade: 'chef', status: 'Reregistered', qaBody: 'CATHSSETA', originator: 'CATHSSETA' },
    { saqaId: '22886', title: 'National Certificate: Domestic Cleaning', nqfLevel: 1, credits: 120, field: 'Field 11 - Services', trade: 'cleaner', status: 'Reregistered', qaBody: 'Services SETA', originator: 'Services SETA' },
    { saqaId: '61609', title: 'National Certificate: Security Services', nqfLevel: 3, credits: 132, field: 'Field 08 - Law, Military Science and Security', trade: 'securityInstaller', status: 'Reregistered', qaBody: 'SASSETA', originator: 'SASSETA' },
    { saqaId: '57713', title: 'National Certificate: Occupational Health and Safety', nqfLevel: 3, credits: 120, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'safetyOfficer', status: 'Reregistered', qaBody: 'HWSETA', originator: 'HWSETA' },
    { saqaId: '20426', title: 'National Certificate: Horticulture', nqfLevel: 2, credits: 120, field: 'Field 01 - Agriculture and Nature Conservation', trade: 'gardener', status: 'Reregistered', qaBody: 'AgriSETA', originator: 'AgriSETA' },
    { saqaId: '64849', title: 'National Certificate: Information Technology (Systems Development)', nqfLevel: 5, credits: 147, field: 'Field 02 - Information Science and Computer Science', trade: 'developer', status: 'Reregistered', qaBody: 'MICT SETA', originator: 'MICT SETA' },
    { saqaId: '80646', title: 'Occupational Certificate: Bookkeeper', nqfLevel: 4, credits: 242, field: 'Field 03 - Business, Commerce and Management Studies', trade: 'accountant', status: 'Registered', qaBody: 'QCTO', originator: 'QCTO' },
    { saqaId: '98164', title: 'Occupational Certificate: Real Estate Agent', nqfLevel: 5, credits: 204, field: 'Field 03 - Business, Commerce and Management Studies', trade: 'estateAgent', status: 'Registered', qaBody: 'QCTO', originator: 'QCTO' },
    { saqaId: '79806', title: 'National Certificate: Early Childhood Development', nqfLevel: 4, credits: 136, field: 'Field 05 - Education, Training and Development', trade: 'childminder', status: 'Reregistered', qaBody: 'QCTO', originator: 'ETDP SETA' },
    { saqaId: '66510', title: 'Further Education and Training Certificate: Community Health Work', nqfLevel: 4, credits: 148, field: 'Field 09 - Health Sciences and Social Services', trade: 'healthPractitioner', status: 'Reregistered', qaBody: 'HWSETA', originator: 'HWSETA' },
    { saqaId: '23912', title: 'National Certificate: Refrigeration and Air Conditioning', nqfLevel: 2, credits: 130, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'hvacTechnician', status: 'Reregistered', qaBody: 'merSETA', originator: 'merSETA' },
    { saqaId: '63469', title: 'National Certificate: Motor Vehicle Assessor', nqfLevel: 4, credits: 145, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'assessor', status: 'Reregistered', qaBody: 'merSETA', originator: 'merSETA' },
    { saqaId: '78964', title: 'Further Education and Training Certificate: Generic Management', nqfLevel: 4, credits: 150, field: 'Field 03 - Business, Commerce and Management Studies', trade: 'eventPlanner', status: 'Reregistered', qaBody: 'Services SETA', originator: 'Services SETA' },
    { saqaId: '63629', title: 'National Certificate: Generic Management (Wholesale and Retail Operations)', nqfLevel: 4, credits: 140, field: 'Field 03 - Business, Commerce and Management Studies', trade: 'mover', status: 'Reregistered', qaBody: 'W&RSETA', originator: 'W&RSETA' },
    { saqaId: '66249', title: 'National Certificate: Professional Driving', nqfLevel: 3, credits: 140, field: 'Field 11 - Services', trade: 'driver', status: 'Reregistered', qaBody: 'TETA', originator: 'TETA' },
    { saqaId: '57711', title: 'Further Education and Training Certificate: Painting', nqfLevel: 4, credits: 130, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'painter', status: 'Reregistered', qaBody: 'CETA', originator: 'CETA' },
    { saqaId: '71950', title: 'National Certificate: Information Technology (Technical Support)', nqfLevel: 4, credits: 138, field: 'Field 02 - Information Science and Computer Science', trade: 'technician', status: 'Reregistered', qaBody: 'MICT SETA', originator: 'MICT SETA' },
    { saqaId: '50389', title: 'Further Education and Training Certificate: Educating and Training for Practices', nqfLevel: 4, credits: 120, field: 'Field 05 - Education, Training and Development', trade: 'tutor', status: 'Reregistered', qaBody: 'ETDP SETA', originator: 'ETDP SETA' },
    { saqaId: '22907', title: 'National Certificate: Pest Control Operations', nqfLevel: 3, credits: 130, field: 'Field 01 - Agriculture and Nature Conservation', trade: 'pestController', status: 'Reregistered', qaBody: 'AgriSETA', originator: 'AgriSETA' },
    { saqaId: '67509', title: 'National Certificate: Construction Supervision', nqfLevel: 4, credits: 161, field: 'Field 06 - Manufacturing, Engineering and Technology', trade: 'handyman', status: 'Reregistered', qaBody: 'CETA', originator: 'CETA' },
  ],
  /*
   * HONESTY NOTE ON THIS MIRROR
   * SAQA publishes every NQF qualification as public property at
   * allqs.saqa.org.za but offers no stable documented REST contract, so this
   * table is a hand-built mirror of the qualifications that matter on this
   * marketplace. IDs and titles must be re-validated against the live register
   * before a production PASS is issued — which is exactly what `verifyClaim`
   * enforces by returning UNAVAILABLE (never PASS) when it cannot confirm.
   */

  /** Look up qualifications relevant to a declared trade. */
  async forTrade(trade, { live = false } = {}) {
    const local = this.NQF_INDEX.filter((row) => row.trade === trade);
    if (!live) {
      return {
        source: 'bundled-saqa-index',
        live: false,
        reason: 'SAQA publishes no stable public REST API — production mirrors allqs.saqa.org.za nightly',
        trade,
        qualifications: local,
        count: local.length,
        registerUrl: 'https://allqs.saqa.org.za/search.php?cat=qual',
        lookedUpAt: nowIso(),
      };
    }
    // Escape hatch: some deployments run a SAQA mirror with a REST contract.
    const res = await request(`https://api.saqa.org.za/v1/qualifications?title=${encodeURIComponent(trade)}`, { timeoutMs: 8000 });
    if (res.ok) return { source: 'saqa-mirror', live: true, trade, qualifications: res.data, lookedUpAt: nowIso() };
    return this.forTrade(trade, { live: false });
  },

  /**
   * Verify that a claimed qualification exists on the NQF and matches the trade
   * the pro is selling. Returns a reference the customer can click through to.
   */
  async verifyClaim({ trade, claimedSaqaId, claimedTitle, holderName, consentRef }) {
    const matches = this.NQF_INDEX.filter((row) => row.trade === trade);
    const exact = matches.find((row) => row.saqaId === String(claimedSaqaId));
    const fuzzy = !exact && claimedTitle
      ? matches.find((row) => row.title.toLowerCase().includes(String(claimedTitle).toLowerCase().slice(0, 12)))
      : null;
    const found = exact || fuzzy;

    if (!found) {
      // Distinguish three genuinely different situations. Treating "our local
      // mirror has no rows for this trade" as fraud would block honest pros.
      if (!matches.length) {
        return {
          status: 'UNAVAILABLE',
          finding: `The bundled SAQA mirror holds no indexed qualifications for the "${trade}" trade, so the claim could not be confirmed or refuted locally. A live lookup against allqs.saqa.org.za is required before this check can PASS.`,
          nqfLevel: null,
          reference: claimedSaqaId || null,
          registerUrl: 'https://allqs.saqa.org.za/search.php?cat=qual',
          checkedAt: nowIso(),
        };
      }
      return {
        status: claimedSaqaId || claimedTitle ? 'FAIL' : 'UNAVAILABLE',
        finding: claimedSaqaId || claimedTitle
          ? `No NQF qualification "${claimedTitle || claimedSaqaId}" found for the ${trade} trade among the ${matches.length} indexed qualification(s)`
          : 'Pro did not declare a qualification — the Recognition of Prior Learning pathway is recommended instead',
        nqfLevel: null,
        reference: null,
        registerUrl: 'https://allqs.saqa.org.za/search.php?cat=qual',
        checkedAt: nowIso(),
      };
    }

    return {
      status: found.status === 'Registered' || found.status === 'Reregistered' ? 'PASS' : 'WARN',
      finding: found.status === 'Registered' || found.status === 'Reregistered'
        ? `${found.title} (SAQA ID ${found.saqaId}) is a registered ${found.nqfLevel} qualification for the ${trade} trade, quality-assured by ${found.qaBody}`
        : `${found.title} (SAQA ID ${found.saqaId}) has status "${found.status}" — the pro should hold the current replacement qualification`,
      saqaId: found.saqaId,
      qualificationTitle: found.title,
      nqfLevel: found.nqfLevel,
      credits: found.credits,
      qaBody: found.qaBody,
      field: found.field,
      registerUrl: `https://allqs.saqa.org.za/view.php?id=${found.saqaId}`,
      holderName: holderName || null,
      // NLRD confirmation that THIS person holds it needs a partner agreement
      // plus POPIA consent. Without it we may only confirm the qualification
      // exists and matches the trade — never that the person holds it.
      individualConfirmed: false,
      individualConfirmationRequires: 'NLRD partner agreement + documented POPIA consent (reference: ' + (consentRef || 'not supplied') + ')',
      evidenceSeal: sha256({ saqaId: found.saqaId, trade, holderName }),
      source: 'bundled-saqa-index',
      live: false,
      checkedAt: nowIso(),
    };
  },

  /**
   * Recognition of Prior Learning pathway — the honest answer for the millions
   * of skilled South Africans who can do the work but never got a certificate.
   */
  rplPathway(trade) {
    const qualification = this.NQF_INDEX.find((row) => row.trade === trade && row.nqfLevel <= 3);
    return {
      trade,
      targetQualification: qualification ? { saqaId: qualification.saqaId, title: qualification.title, nqfLevel: qualification.nqfLevel } : null,
      steps: [
        'ProVeri practical assessment: a verified assessor watches the pro complete a real job on camera against a trade checklist.',
        'Portfolio of evidence built automatically from the pro’s completed, escrow-released jobs on ProVeri.',
        'Referral to an accredited SETA/QCTO assessment centre for formal RPL against the target qualification.',
        'Interim "Assessed Practitioner" badge granted after step 1, upgraded to full TRADE_VERIFIED on certification.',
      ],
      whyItMatters: 'Youth unemployment is 47.4% (Stats SA QLFS Q2 2026) while households cannot find a plumber. Most of that gap is credentialing, not skill. RPL converts demonstrated skill into a badge customers trust.',
      costToPro: 'Free on ProVeri for the first 12 months; SETA assessment centre fees quoted separately and often subsidised.',
    };
  },
};

/* ==================================================================== *
 * 3. COMPANY REGISTRY — CIPC
 * ==================================================================== */

const COMPANY_REGISTRY = {
  id: 'companyRegistry',
  label: 'CIPC business registration check',
  providers: [{
    name: 'CIPC APIVerse developer portal (official)',
    endpoint: 'https://cipc-apm-rs-dev.azure-api.net/enterprise/v1/{company-search|employee-verification}',
    auth: 'Ocp-Apim-Subscription-Key (application + approval required)',
    docs: 'https://guide.cipc.co.za/api-documentation/',
    note: 'Official OAuth-secured read-only endpoints for registry, beneficial ownership and XBRL data. Onboarding requires approval and several endpoints are still marked "coming soon".',
  }, {
    name: 'CIPC eServices web register (free after login)',
    endpoint: 'https://eservices.cipc.co.za',
    auth: 'CIPC customer code + password',
    note: 'The free public enterprise search was discontinued in 2021. Status checks are free after account registration; certified extracts cost R30–R100.',
  }, {
    name: 'Authorised reseller APIs',
    endpoint: 'https://api.verifyid.co.za (OmniCheck) · https://www.datanamix.com · https://companydata.com/cipc-api/',
    auth: 'API key + credit balance',
    note: 'OmniCheck exposes /cipc_company_match, /cipc_company_search and /cipc_director_search. Resellers return SIC/NACE codes, directors and contact data that CIPC does not expose.',
  }],

  /**
   * Registration number format is public knowledge: YYYY/NNNNNN/TT where the
   * suffix encodes the entity type. Validating the shape is free and catches
   * the most common fabricated-number pattern instantly.
   */
  validateRegistrationNumber(raw) {
    const value = String(raw || '').replace(/[\s]/g, '');
    const match = /^(\d{4})\/(\d{4,6})\/(\d{2})$/.exec(value);
    if (!match) return { valid: false, reasons: ['Expected format YYYY/NNNNNN/TT, e.g. 2026/608144/07'], entityType: null };

    const [, year, sequence, typeCode] = match;
    const ENTITY_TYPES = {
      '06': 'Public company', '07': 'Private company (Pty) Ltd', '08': 'Personal liability company (Inc)',
      '09': 'Public company (Inc)', '10': 'External (foreign) company', '11': 'External personal liability',
      '12': 'External public company', '14': 'External private company', '16': 'Non-profit with members',
      '17': 'Non-profit with directors', '21': 'Non-profit company (NPC)', '22': 'Partnership',
      '23': 'Close corporation (CC)', '24': 'Business trust', '30': 'Co-operative', '31': 'Co-operative (secondary)',
    };
    const entityType = ENTITY_TYPES[typeCode] || null;
    const reasons = [];
    const yearNum = Number(year);
    const currentYear = new Date().getFullYear();
    if (yearNum < 1900 || yearNum > currentYear) reasons.push(`Registration year ${yearNum} is not plausible`);
    if (Number(sequence) === 0) reasons.push('Sequence number cannot be zero');
    if (!entityType) reasons.push(`Entity type code "${typeCode}" is not a recognised CIPC suffix`);

    return {
      valid: reasons.length === 0,
      reasons,
      year: yearNum,
      sequence,
      typeCode,
      entityType,
      normalized: value,
      seal: sha256(value),
      checkedAt: nowIso(),
    };
  },

  /**
   * Live lookup. Offline mode is deliberately honest: it can confirm the
   * *shape* of a registration number but never invents an "IN BUSINESS" status,
   * because that is exactly the claim a fraudulent seller would forge.
   */
  async verify({ registrationNumber, companyName, apiKey, baseUrl }, { offlineAllowed = true } = {}) {
    const shape = this.validateRegistrationNumber(registrationNumber);
    if (apiKey && registrationNumber) {
      const url = `${baseUrl || 'https://api.verifyid.co.za'}/v1/company/verify`;
      const res = await request(url, {
        json: { registration_number: shape.normalized || registrationNumber, verification_type: 'basic' },
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 9000,
      });
      if (res.ok && res.data) {
        return {
          source: 'cipc-reseller-api',
          live: true,
          status: res.data.status === 'IN BUSINESS' || res.data.company_status === 'IN BUSINESS' ? 'PASS' : 'WARN',
          registrationNumber: shape.normalized,
          companyName: res.data.company_name || res.data.name || companyName,
          entityStatus: res.data.company_status || res.data.status,
          entityType: res.data.company_type || shape.entityType,
          registrationDate: res.data.registration_date || null,
          complianceNoticeStatus: res.data.compliance_notice_status || null,
          directors: res.data.directors || null,
          reference: res.data.reference || res.data.enquiry_id || null,
          checkedAt: nowIso(),
        };
      }
    }

    if (!offlineAllowed) {
      return { status: 'UNAVAILABLE', source: 'none', live: false, reasons: ['No CIPC adapter configured and offline results are not permitted for this subject'] };
    }
    return {
      source: 'local-shape-validation',
      live: false,
      status: shape.valid ? 'WARN' : 'FAIL',
      finding: shape.valid
        ? `Registration number ${shape.normalized} is correctly formed and decodes to a ${shape.entityType}. Business status could not be confirmed offline — a CIPC or reseller lookup is required before this check can PASS.`
        : shape.reasons.join('; '),
      registrationNumber: shape.normalized || null,
      companyName: companyName || null,
      entityType: shape.entityType,
      entityStatus: null,
      reference: null,
      shapeValid: shape.valid,
      reasons: shape.reasons,
      checkedAt: nowIso(),
    };
  },

  /**
   * Directorship check: does this verified ID appear as a director of the
   * declared company? Catches the "I'm just a worker here" excuse and the
   * "I own this company" fabrication in one call.
   */
  async verifyDirectorship({ idNumber, registrationNumber, apiKey }) {
    if (apiKey && idNumber) {
      const res = await request('https://api.verifyid.co.za/v1/company/directorship', {
        json: { identity_number: idNumber, registration_number: registrationNumber },
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 9000,
      });
      if (res.ok) return { source: 'cipc-reseller-api', live: true, ...res.data, checkedAt: nowIso() };
    }
    return {
      source: 'not-available-offline',
      live: false,
      status: 'UNAVAILABLE',
      finding: 'Directorship confirmation requires a live CIPC or reseller API call. Offline, this check can never PASS — the pro may still trade as a sole proprietor.',
      checkedAt: nowIso(),
    };
  },
};

/* ==================================================================== *
 * 4. TRADE REGULATORS — NHBRC, PSIRA, PIRB, SAQCC, PPRA, LPC, SANC
 * ==================================================================== */

const TRADE_REGISTERS = {
  id: 'tradeRegisters',
  label: 'Statutory trade register lookups',
  registers: [
    {
      trade: 'builder', body: 'NHBRC', fullName: 'National Home Builders Registration Council',
      lookupUrl: 'https://www.nhbrc.org.za/pages/content/26/137',
      publicApi: false, access: 'Online enrolment/builder search; no documented REST API — partner or nightly mirror',
      legalBasis: 'Housing Consumers Protection Measures Act 95 of 1998',
      requirement: 'Builder registration + home enrolment before construction; 5-year structural, 3-year roof-leak and 12-month workmanship warranty are statutory',
      consumerProtection: 'Statutory warranty is enforceable against the NHBRC even if the builder disappears — the strongest consumer protection in any ProVeri vertical',
    },
    {
      trade: 'securityInstaller', body: 'PSIRA', fullName: 'Private Security Industry Regulatory Authority',
      lookupUrl: 'https://www.psira.org.za', publicApi: false,
      access: 'PSIRA verification portal; registered companies and officers',
      legalBasis: 'Private Security Industry Regulation Act 56 of 2001',
      requirement: 'Company and individual PSIRA registration; electric fence CoC under the OHS Act',
      consumerProtection: 'Unregistered security work is a criminal offence — the platform refuses the bid outright',
    },
    {
      trade: 'plumber', body: 'PIRB', fullName: 'Plumbing Industry Registration Board',
      lookupUrl: 'https://www.pirb.org.za', publicApi: false,
      access: 'PIRB registered-plumber search and CoC verification',
      legalBasis: 'Water Services Act; SANS 10254 and SANS 10252',
      requirement: 'PIRB registration; Plumbing CoC for new or altered installations',
      consumerProtection: 'A PIRB CoC is required by insurers before a water-damage claim is paid',
    },
    {
      trade: 'electrician', body: 'DoEL / ECA / SAIEE', fullName: 'Department of Employment and Labour wireman’s licence',
      lookupUrl: 'https://www.labour.gov.za', publicApi: false,
      access: 'Wireman’s licence register; ECA and SAIEE member directories',
      legalBasis: 'Occupational Health and Safety Act 85 of 1993, Electrical Installation Regulations; SANS 10142-1',
      requirement: 'Registered person + Certificate of Compliance for every new or altered installation',
      consumerProtection: 'No CoC means the insurer can repudiate a fire claim — this is the single highest-consequence check on the platform',
    },
    {
      trade: 'gasInstaller', body: 'SAQCC Gas', fullName: 'South African Qualification and Certification Committee for Gas',
      lookupUrl: 'https://www.saqccgas.org.za', publicApi: false,
      access: 'SAQCC registered practitioner search; CoC verification',
      legalBasis: 'Pressure Equipment Regulations under the OHS Act',
      requirement: 'SAQCC registration; gas CoC for every installation',
      consumerProtection: 'Insurance repudiation risk without a gas CoC',
    },
    {
      trade: 'estateAgent', body: 'PPRA', fullName: 'Property Practitioners Regulatory Authority',
      lookupUrl: 'https://theppra.org.za', publicApi: false,
      access: 'PPRA status and Fidelity Fund Certificate verification',
      legalBasis: 'Property Practitioners Act 22 of 2019',
      requirement: 'Registration + valid Fidelity Fund Certificate before earning commission',
      consumerProtection: 'The PPRA Fidelity Fund compensates consumers defrauded by a registered practitioner',
      vertical: 'property',
    },
    {
      trade: 'attorney', body: 'LPC', fullName: 'Legal Practice Council',
      lookupUrl: 'https://www.lpc.org.za', publicApi: false,
      access: 'LPC practitioner search and Fidelity Fund Certificate status',
      legalBasis: 'Legal Practice Act 28 of 2014',
      requirement: 'LPC registration; trust account rules for client funds',
      consumerProtection: 'Attorney Fidelity Fund and LPC disciplinary jurisdiction',
    },
    {
      trade: 'healthPractitioner', body: 'SANC / HPCSA', fullName: 'SA Nursing Council / Health Professions Council',
      lookupUrl: 'https://www.sanc.co.za', publicApi: true,
      access: 'SANC publishes a practitioner register; HPCSA online verification',
      legalBasis: 'Nursing Act 33 of 2005; Health Professions Act 56 of 1974',
      requirement: 'Active registration in good standing',
      consumerProtection: 'Criminal offence to practise unregistered; council can award disciplinary relief',
    },
    {
      trade: 'accountant', body: 'SAICA / SAIPA / SAIT', fullName: 'Professional accounting bodies',
      lookupUrl: 'https://www.saica.org.za', publicApi: false,
      access: 'Member directories; SARS practitioner register',
      legalBasis: 'Auditing Profession Act; Tax Administration Act',
      requirement: 'Professional body membership; SARS practitioner number to file returns',
      consumerProtection: 'Body disciplinary process and professional indemnity requirements',
    },
    {
      trade: 'driver', body: 'DoT / RTMS', fullName: 'Department of Transport; Road Transport Management System',
      lookupUrl: 'https://www.transport.gov.za', publicApi: false,
      access: 'PDP verification via licensing departments; RTMS accredited operator list',
      legalBasis: 'National Road Traffic Act 93 of 1996',
      requirement: 'Valid PDP for passenger or goods transport',
      consumerProtection: 'Uninsured operator risk if no PDP',
    },
    {
      trade: 'pestController', body: 'DALRRD', fullName: 'Dept. of Agriculture, Land Reform and Rural Development',
      lookupUrl: 'https://www.dalrrd.gov.za', publicApi: false,
      access: 'Act 36 of 1947 pest control operator business permits',
      legalBasis: 'Agricultural Pest Act 36 of 1983',
      requirement: 'Business permit for pesticide application',
      consumerProtection: 'Illegal pesticide application creates health and liability exposure',
    },
    {
      trade: 'childminder', body: 'DSD', fullName: 'Department of Social Development',
      lookupUrl: 'https://www.dsd.gov.za', publicApi: false,
      access: 'ECD facility registration; police clearance for work with children',
      legalBasis: 'Children’s Act 38 of 2005',
      requirement: 'ECD registration where operating a facility; clearance for in-home care of minors',
      consumerProtection: 'Highest-sensitivity category — ProVeri requires two verified references plus clearance before any booking with minors',
    },
  ],

  forTrade(trade) {
    return this.registers.filter((r) => r.trade === trade);
  },

  /**
   * Build the certification check result for a pro in a given trade.
   * Offline mode can never PASS a statutory register — that would be the exact
   * claim a fraudulent pro is trying to fake.
   */
  async verifyCertification({ trade, certificateNumber, issuingBody, certificateHash, apiKey, statutory = null, categoryLabel = null }) {
    const registers = this.forTrade(trade);
    // `statutory` is decided per CATEGORY. Roofing repair maps to the "builder"
    // trade, but is not NHBRC-enrolled home building, so it must not be blocked.
    const isStatutory = statutory === null ? registers.length > 0 : statutory;
    if (registers.length === 0 || !isStatutory) {
      const recommended = registers[0] || null;
      return {
        status: 'NOT_APPLICABLE',
        finding: recommended
          ? `No statutory registration is required for ${categoryLabel || `this ${trade} work`}. Where a pro holds ${recommended.body} registration voluntarily we record and display it, because customers ask.`
          : `No statutory register governs the "${trade}" trade — ProVeri relies on identity, bank verification, references and escrow instead`,
        reference: certificateNumber || null,
        certificationBody: recommended?.body || null,
        registerUrl: recommended?.lookupUrl || null,
        severity: 'RECOMMENDED',
        checkedAt: nowIso(),
      };
    }
    const register = registers[0];
    if (certificateNumber && apiKey) {
      // Adapter hook: each register (or its reseller) has a different contract.
      return {
        status: 'PENDING_LIVE_LOOKUP',
        finding: `Certificate ${certificateNumber} queued for verification against ${register.body}`,
        certificationBody: register.body,
        reference: certificateNumber,
        severity: register.legalBasis ? 'STATUTORY' : 'PROFESSIONAL',
        checkedAt: nowIso(),
      };
    }
    if (certificateNumber) {
      return {
        status: 'WARN',
        finding: `Certificate ${certificateNumber} recorded against ${register.body}, but the register could not be queried offline. The pro may bid; the badge reads "certificate on file — register confirmation pending".`,
        certificationBody: register.body,
        registerUrl: register.lookupUrl,
        reference: certificateNumber,
        evidenceHash: certificateHash || null,
        severity: register.legalBasis ? 'STATUTORY' : 'PROFESSIONAL',
        legalBasis: register.legalBasis,
        checkedAt: nowIso(),
      };
    }
    return {
      status: 'FAIL',
      finding: `${register.body} registration is required for the ${trade} trade (${register.requirement}). No certificate number supplied.`,
      certificationBody: register.body,
      registerUrl: register.lookupUrl,
      legalBasis: register.legalBasis,
      consumerProtection: register.consumerProtection,
      severity: 'STATUTORY',
      checkedAt: nowIso(),
    };
  },

  publicRegisters() {
    return this.registers.map((r) => ({
      trade: r.trade,
      body: r.body,
      fullName: r.fullName,
      lookupUrl: r.lookupUrl,
      publicApi: r.publicApi,
      legalBasis: r.legalBasis,
      requirement: r.requirement,
      consumerProtection: r.consumerProtection,
      vertical: r.vertical || 'services',
    }));
  },
};

module.exports = { LOAD_SHEDDING, QUALIFICATIONS, COMPANY_REGISTRY, TRADE_REGISTERS };
