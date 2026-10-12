/* ==========================================================================
   Lula ProVeri PWA — marketplace screens
   home · find-a-pro · post-job · job detail · pro profile
   ========================================================================== */

window.ProVeri = window.ProVeri || {};
window.ProVeri.screens = window.ProVeri.screens || {};

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const {
    h, money, moneyBig, timeAgo, dateShort, countdown, stars, badge, trustBadge,
    toast, sheet, loading, loadingCards, empty, navigate, formValues, withButton, trustBar, sectionHead,
  } = window.ProVeri.ui;

  const screens = window.ProVeri.screens;

  /* ================= HOME ================= */

  screens['/'] = async function home() {
    const snap = api.state.snapshot || (await api.get('/api/snapshot'));
    api.state.snapshot = snap;
    const session = api.session();

    const root = h('div.fade-in.stack');

    root.append(h('section.hero', [
      h('h1', [ 'Verified pros. Escrow-protected money. ', h('em', 'Proof of work.') ]),
      h('p.sub', 'Post a job and get bids from KYC-verified pros near you — your money stays in escrow until you confirm the work is done. Or turn your skills into income, with payment guaranteed before you start.'),
      h('div.hero-actions', [
        h('button.btn.on-dark', { onclick: () => navigate('/post-job') }, '🛠️ I need work done'),
        h('button.btn.on-dark.ghost', { onclick: () => navigate('/become-a-pro') }, '💼 I want jobs'),
      ]),
      h('div.stat-grid', { style: { marginTop: '16px' } }, [
        stat(`${snap.supply.verifiedPros}`, 'verified pros'),
        stat(`${snap.demand.jobsCompleted + snap.transactions.completed}`, 'jobs completed'),
        stat(money(snap.money.releasedToProsCents), 'paid to pros'),
        stat(`${snap.trust.averageRating || '—'}★`, `${snap.trust.verifiedReviews} verified reviews`),
        stat(`${snap.money.heldInEscrowCents ? money(snap.money.heldInEscrowCents) : 'R0'}`, 'in escrow now'),
        stat(snap.trust.chainValid ? '✓ sealed' : '—', 'audit chain'),
      ]),
    ]));

    function stat(value, label) {
      return h('div.pill-stat', { style: { background: 'rgba(255,255,255,.12)', borderColor: 'rgba(255,255,255,.2)', color: '#fff' } }, [
        h('span.v', value), h('span.l', { style: { color: 'rgba(255,255,255,.75)' } }, label),
      ]);
    }

    /* load-shedding + weather context strip */
    root.append(h('section.section', [
      h('div.scroller-x', { id: 'context-strip' }, [h('div.skeleton.card', { style: { width: '260px' } })]),
    ]));
    loadContextStrip(root.querySelector('#context-strip'), snap);

    /* categories */
    root.append(h('section.section', [
      sectionHead('What do you need done?', 'All categories', '/find-a-pro'),
      h('div.cat-grid', { id: 'home-cats' }, [h('div.skeleton.card'), h('div.skeleton.card'), h('div.skeleton.card'), h('div.skeleton.card')]),
    ]));
    loadCategories(root.querySelector('#home-cats'));

    /* how it works */
    root.append(h('section.section', [
      h('h2', 'How ProVeri protects both sides'),
      h('div.steps', { style: { marginTop: '14px' } }, [
        step('1', 'done', 'Post or bid', 'Customers post a job. Verified pros bid. Every bid is annotated with the real market band so nobody gets anchored by a fake R99 callout.'),
        step('2', 'done', 'Money goes into escrow', 'When a bid is accepted you pay into escrow — TradeSafe for big jobs, Paystack or PayFast for standard ones. The pro sees “payment guaranteed”, you see “nobody gets paid yet”.'),
        step('3', 'done', 'Proof of work', 'The pro uploads geotagged, hash-sealed before/after photos and any required certificate. A photo taken far from your address holds the payout.'),
        step('4', 'current', 'You confirm, they get paid', 'Confirm to release. 5% is held for a 14-day workmanship warranty — if something is wrong, that money fixes it.'),
      ]),
    ]));

    /* differentiators */
    root.append(h('section.section', [
      h('h2', 'Why ProVeri, not a classifieds site'),
      h('div.list', { style: { marginTop: '12px' } }, snap.guarantees.map((g) =>
        h('div.card.pad-sm', [
          h('div.row', { style: { gap: '10px' } }, [h('span', { style: { fontSize: '20px' } }, g.icon), h('div.grow', [h('div.t', { style: { fontWeight: 700 } }, g.title), h('div.small.muted', g.body)])]),
        ]))),
    ]));

    /* second vertical + web studio */
    root.append(h('section.section', [
      h('div.scroller-x', [
        h('div.card', { style: { width: '280px', cursor: 'pointer' }, onclick: () => navigate('/vehicles') }, [
          h('div.kicker', '🚗 Second vertical'),
          h('h3', 'Verified vehicles'),
          h('p.small.muted', 'VIN, ownership, stolen and finance checks before a listing goes live — plus a Service Passport built from real escrow-released jobs.'),
          h('div.row', { style: { marginTop: '8px' } }, [badge('beta', 'info'), badge(`${snap.supply ? '' : ''}`, 'neutral')]),
        ]),
        h('div.card', { style: { width: '280px', cursor: 'pointer' }, onclick: () => navigate('/web-studio') }, [
          h('div.kicker.gold', '🖥️ Web Studio'),
          h('h3', 'Preview before you pay'),
          h('p.small.muted', 'Every verified pro gets a free data-bound microsite. Paid packages are delivered through the same escrow and milestone machinery as a plumbing job.'),
        ]),
        h('div.card', { style: { width: '280px', cursor: 'pointer' }, onclick: () => navigate('/property') }, [
          h('div.kicker', '🏠 Coming soon'),
          h('h3', 'Property & conveyancing'),
          h('p.small.muted', 'Title, municipal clearance and PPRA/FFC verification. Join the waitlist — and read exactly why it is not live yet.'),
        ]),
      ]),
    ]));

    if (session) {
      root.append(h('section.section', [
        h('div.banner.ok', [h('span.ico', '👋'), h('div', [h('strong', `Welcome back, ${session.name || session.userId}`), h('div.small', 'Your jobs, bookings and wallet are under My jobs.')])]),
      ]));
    }

    return root;
  };

  function step(number, state, title, body) {
    return h('div.step.' + state, [
      h('div.dot', number),
      h('div.body', [h('div.t', title), h('div.d', body)]),
    ]);
  }

  async function loadContextStrip(container, snap) {
    container.innerHTML = '';
    const cards = [];

    try {
      const ls = await api.get('/api/public/loadshedding');
      const stage = ls.status?.national?.stage ?? 0;
      cards.push(h('div.card.pad-sm', { style: { width: '250px' } }, [
        h('div.kicker', stage > 0 ? '⚡ Load shedding active' : '⚡ Grid stable'),
        h('div.row.between', [h('span.money.big', stage > 0 ? `Stage ${stage}` : 'Stage 0'), h('span.tiny.muted', ls.status?.live ? 'live' : 'offline model')]),
        h('p.tiny.muted', { style: { marginBottom: 0 } }, stage > 0
          ? 'Power-dependent jobs are scheduled around published outage windows automatically.'
          : 'No national load shedding. Power-dependent jobs can be booked freely.'),
      ]));
    } catch { cards.push(h('div.card.pad-sm', { style: { width: '250px' } }, [h('div.kicker', '⚡ Load shedding'), h('p.tiny.muted', 'Unavailable offline')])); }

    try {
      const geo = api.state.bundle?.catalog?.metros?.find((m) => m.id === 'jhb') || api.state.bundle?.catalog?.metros?.[0];
      const wx = await api.get(`/api/public/weather?lat=${geo?.center?.lat ?? -26.2}&lon=${geo?.center?.lon ?? 28.05}&days=3`);
      const today = wx.daily?.[0];
      cards.push(h('div.card.pad-sm', { style: { width: '250px' } }, [
        h('div.kicker', `${today?.condition?.icon || '🌤️'} Weather, Johannesburg`),
        h('div.row.between', [h('span.money.big', `${today?.highC ?? '—'}°`), h('span.tiny.muted', `${today?.rainProbabilityPercent ?? 0}% rain`) ]),
        h('p.tiny.muted', { style: { marginBottom: 0 } }, today?.condition?.outdoorOk === false
          ? `${today.condition.label} — exterior trades get auto-reschedule protection.`
          : 'Good conditions for exterior work today.'),
      ]));
    } catch { cards.push(h('div.card.pad-sm', { style: { width: '250px' } }, [h('div.kicker', '🌤️ Weather'), h('p.tiny.muted', 'Unavailable offline')])); }

    cards.push(h('div.card.pad-sm', { style: { width: '250px' } }, [
      h('div.kicker', '📊 Labour market context'),
      h('div.row.between', [h('span.money.big', `${snap.labourMarket?.unemploymentRate ?? 33.6}%`), h('span.tiny.muted', 'Stats SA Q2 2026')]),
      h('p.tiny.muted', { style: { marginBottom: 0 } }, `${(snap.labourMarket?.unemployedPersons / 1e6 || 8.5).toFixed(1)}M unemployed. Every job posted here is income for a skilled neighbour.`),
    ]));

    container.append(...cards);
  }

  async function loadCategories(container) {
    container.innerHTML = '';
    let categories = [];
    try {
      categories = (await api.get('/api/categories')).slice(0, 12);
    } catch {
      categories = (api.state.bundle?.catalog?.categories || []).slice(0, 12).map((c) => ({ id: c.id, label: c.label, group: c.group, statutoryTrade: c.statutoryTrade }));
    }
    const groups = api.state.bundle?.catalog?.groups || [];
    container.append(...categories.map((c) => {
      const group = groups.find((g) => g.id === c.group);
      return h('button.cat-card', { onclick: () => navigate(`/find-a-pro?category=${c.id}`) }, [
        h('span.ico', group?.icon || ''),
        h('span.name', c.label),
        c.statutoryTrade ? h('span.law', '⚖ certificate required') : h('span.sub', 'verified pros only'),
      ]);
    }));
  }

  /* ================= FIND A PRO / BROWSE ================= */

  screens['/find-a-pro'] = async function findAPro({ query }) {
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Find a verified pro'));
    root.append(h('p.muted.small', 'Only pros who passed identity, phone, email and bank verification appear here. Statutory trades also need their certificate on file.'));

    const bundle = api.state.bundle || {};
    const categories = bundle.catalog?.categories || [];
    const metros = bundle.catalog?.metros || [];

    const controls = h('div.card', [
      h('label.field', [h('span', 'Service'), h('select', { name: 'category' }, [
        h('option', { value: '' }, 'All services'),
        ...categories.map((c) => h('option', { value: c.id, selected: query.category === c.id }, c.label)),
      ])]),
      h('div.form-grid', [
        h('label.field', [h('span', 'Metro'), h('select', { name: 'metroId' }, [
          h('option', { value: '' }, 'All metros'),
          ...metros.map((m) => h('option', { value: m.id }, m.name)),
        ])]),
        h('label.field', [h('span', 'Radius (km)'), h('input', { type: 'number', name: 'radiusKm', value: 25, min: 1, max: 400 })]),
      ]),
      h('div.row.wrap', [
        h('button.chip', { name: 'instant', onclick: (e) => e.target.classList.toggle('active') }, ' Instant book'),
        h('button.chip', { onclick: (e) => e.target.classList.toggle('active'), dataset: { filter: 'elite' } }, '🏆 Elite'),
        h('button.chip', { onclick: (e) => e.target.classList.toggle('active'), dataset: { filter: 'insured' } }, '🛡 Insured'),
        h('button.btn.sm', { onclick: runSearch }, 'Search'),
      ]),
    ]);
    root.append(controls);

    const results = h('div.list', { style: { marginTop: '14px' } });
    root.append(results);

    async function runSearch() {
      const values = formValues(controls);
      results.innerHTML = '';
      results.append(loadingCards(4));
      const params = new URLSearchParams();
      if (values.category) params.set('categoryId', values.category);
      if (values.metroId) params.set('metroId', values.metroId);
      if (values.radiusKm) params.set('radiusKm', values.radiusKm);
      params.set('limit', '30');
      try {
        const pros = await api.get(`/api/pros?${params}`);
        results.innerHTML = '';
        if (!pros.length) {
          results.append(empty('🔎', 'No verified pros match yet', 'Try a wider radius or a different metro — ProVeri is growing fastest where trust is scarcest.'));
          return;
        }
        results.append(...pros.map(proTile));
      } catch (error) {
        results.innerHTML = '';
        results.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
      }
    }

    await runSearch();
    return root;
  };

  function proTile(pro) {
    return h('button.tile', { onclick: () => navigate(`/pro/${pro.proId}`) }, [
      h('div.grow', [
        h('div.row.wrap', { style: { gap: '6px' } }, [
          h('span.t', pro.name),
          trustBadge(pro.badge, pro.trustScore),
          pro.newlyVerified ? badge('newly verified', 'info') : null,
        ]),
        h('div.d', `${pro.primaryCategoryLabel} · ${pro.suburb || pro.metro || 'South Africa'}${pro.distanceKm != null ? ` · ${pro.distanceKm} km away` : ''}`),
        h('div.row', { style: { marginTop: '6px', gap: '6px' } }, [
          pro.averageRating ? h('span.tiny', `${stars(pro.averageRating)} ${pro.averageRating} (${pro.reviewCount})`) : h('span.tiny.muted', 'no reviews yet'),
          pro.completedJobs ? h('span.tiny.muted', `· ${pro.completedJobs} jobs`) : null,
          pro.insured ? h('span.tiny', { style: { color: 'var(--brand-700)' } }, '· insured') : null,
        ]),
      ]),
      h('div.meta', [
        h('div.tiny.muted', pro.instantBook ? 'instant book' : 'quotes'),
        pro.hourlyRateCents ? h('div.tiny.money', `${money(pro.hourlyRateCents)}/h`) : null,
      ]),
    ]);
  }

  /* ================= PRO PROFILE ================= */

  screens['/pro/:proId'] = async function proProfile({ params }) {
    const root = h('div.fade-in.stack');
    root.append(loading(5));
    try {
      const [profile, trust] = await Promise.all([
        api.get(`/api/pros/${params.proId}`),
        api.get(`/api/pros/${params.proId}/trust`).catch(() => null),
      ]);

      root.innerHTML = '';
      root.append(h('div.hero', [
        h('div.row.between', [
          h('h1', { style: { fontSize: '22px' } }, profile.name),
          trustBadge(profile.badge, profile.trustScore),
        ]),
        h('p.sub', `${profile.primaryCategoryLabel} · ${profile.location.suburb || profile.location.metro} · serves ${profile.location.serviceRadiusKm} km radius`),
        h('div.row.wrap', [
          h('button.btn.on-dark', { onclick: () => navigate(`/post-job?category=${profile.primaryCategory}&pro=${profile.proId}`) }, 'Request a quote'),
          profile.pricing?.instantBook ? h('button.btn.gold', { onclick: () => toast('Instant booking opens once you post the job — the price is fixed at callout + first hour.', 'ok') }, `⚡ Instant book`) : null,
          h('button.btn.on-dark.ghost', { onclick: () => window.ProVeri.ui.share({ title: profile.name, text: `${profile.name} on Lula ProVeri`, url: location.origin + profile.micrositeUrl }) }, 'Share'),
        ]),
      ]));

      root.append(h('div.card', [
        h('div.kicker', '🪪 Verification — every check, its source'),
        h('div.row.between', [h('span.money.big', `${profile.trustScore}/100`), h('span.tiny.muted', 'ProVeri trust score')]),
        trustBar(profile.trustScore),
        h('ul', { style: { marginTop: '12px', paddingLeft: '18px' } }, (profile.explanation?.reasons || []).map((r) =>
          h('li.small', [h('span', r.icon + ' '), r.text]))),
        profile.explanation?.statutoryNote ? h('p.tiny.muted', profile.explanation.statutoryNote) : null,
        h('div.row.between', { style: { marginTop: '10px' } }, [
          h('span.tiny.muted', 'Audit seal'),
          h('button.tiny.mono', { onclick: () => window.ProVeri.ui.copy(profile.proofDigest, 'Audit seal') }, profile.proofDigest),
        ]),
      ]));

      root.append(h('div.stat-grid', [
        mini(profile.stats.completedJobs || 0, 'jobs done'),
        mini(profile.ratings.average ? `${profile.ratings.average}★` : '—', `${profile.ratings.count} reviews`),
        mini(profile.stats.onTimePercent != null ? `${profile.stats.onTimePercent}%` : '—', 'on time'),
        mini(profile.stats.responseMedianMinutes != null ? `${profile.stats.responseMedianMinutes}m` : '—', 'reply time'),
        mini(profile.stats.repeatCustomerPercent ? `${profile.stats.repeatCustomerPercent}%` : '—', 'repeat clients'),
        mini(profile.stats.disputeCount || 0, 'disputes'),
      ]));

      if (profile.about) root.append(h('div.card', [h('div.kicker', 'About'), h('p.small', profile.about)]));

      if (profile.qualification) {
        root.append(h('div.card', [
          h('div.kicker', '🎓 Qualification'),
          h('div.t', { style: { fontWeight: 700 } }, profile.qualification.title),
          h('div.small.muted', `NQF level ${profile.qualification.nqfLevel}`),
          profile.qualification.registerUrl ? h('a.small', { href: profile.qualification.registerUrl, target: '_blank', rel: 'noopener' }, 'View on the SAQA register ↗') : null,
        ]));
      }

      root.append(h('section.section', [
        h('div.row.between', [h('h2', `Verified reviews (${profile.ratings.count})`), h('span.badge.verified', 'escrow-released only')]),
        ratingDistribution(profile.ratings.distribution),
        h('div', (profile.recentReviews || []).map((r) => h('div.review', [
          h('div.row.between', [h('span.stars', stars(r.rating)), h('span.who', timeAgo(r.createdAt))]),
          h('p.small', { style: { marginTop: '6px' } }, r.comment),
          h('div.row', { style: { gap: '6px' } }, [
            h('span.who', `${r.categoryLabel} · ${r.suburb || ''}`),
            r.photoCount ? h('span.badge.info', `${r.photoCount} photo(s)`) : null,
          ]),
        ]))),
        !profile.recentReviews?.length ? h('p.small.muted', 'No reviews yet — this pro is newly verified.') : null,
      ]));

      if (profile.portfolio?.length) {
        root.append(h('section.section', [
          h('h2', 'Proof of work'),
          h('p.small.muted', 'Portfolio images come from geotagged evidence on completed, escrow-released jobs.'),
          h('div.evidence-strip', profile.portfolio.map((p) => h('div.evidence-item', [
            h('span.ico', '📸'), h('strong', p.title), p.caption ? h('span', p.caption) : null, h('span.seal', p.seal),
          ]))),
        ]));
      }

      root.append(h('div.card', [
        h('div.kicker', '🌐 Free microsite'),
        h('p.small.muted', 'This pro has a data-bound microsite that never goes stale:'),
        h('a.mono.small', { href: profile.micrositeUrl, target: '_blank', rel: 'noopener' }, location.origin + profile.micrositeUrl),
      ]));

      if (trust?.rplPathway) {
        root.append(h('details.fold', [
          h('summary', '🎓 Recognition of Prior Learning pathway'),
          h('div.fold-body', [
            h('p.small', trust.rplPathway.whyItMatters),
            h('ol.small', trust.rplPathway.steps.map((s) => h('li', s))),
          ]),
        ]));
      }
    } catch (error) {
      root.innerHTML = '';
      root.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;

    function mini(value, label) {
      return h('div.pill-stat', [h('span.v', String(value)), h('span.l', label)]);
    }
    function ratingDistribution(dist) {
      if (!dist) return null;
      const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
      return h('div.col', { style: { gap: '4px', margin: '10px 0' } }, [5, 4, 3, 2, 1].map((star) =>
        h('div.rating-row', [
          h('span', `${star}★`),
          h('div.bar', h('i', { style: { width: `${(dist[star] / total) * 100}%` } })),
          h('span.muted', String(dist[star] || 0)),
        ])));
    }
  };

  /* ================= POST A JOB ================= */

  screens['/post-job'] = async function postJob({ query }) {
    const session = api.session();
    const bundle = api.state.bundle || {};
    const categories = bundle.catalog?.categories || [];
    const metros = bundle.catalog?.metros || [];

    if (!session) {
      return onboardingPrompt('Post a job', 'Create a free customer account to post a job. Email and mobile are confirmed with a one-time PIN.');
    }

    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Post a job'));
    root.append(h('p.muted.small', 'Describe the work in your own words. ProVeri matches verified pros instantly, annotates every bid with the real market band, and tells you about weather and load-shedding risks before you commit.'));

    const form = h('form.card.stack', { onsubmit: onSubmit });

    form.append(h('label.field', [
      h('span', 'What do you need done? ', h('small', '(plain language is fine)')),
      h('textarea', { name: 'description', required: true, placeholder: 'e.g. Geyser is leaking onto the kitchen ceiling and I need it replaced today' }),
      h('div.hint', 'We resolve this to a category automatically, and you can change it.'),
    ]));

    form.append(h('div.form-grid', [
      h('label.field', [h('span', 'Category'), h('select', { name: 'categoryId' }, [
        h('option', { value: '' }, 'Auto-detect from my description'),
        ...categories.map((c) => h('option', { value: c.id, selected: query.category === c.id }, c.label)),
      ])]),
      h('label.field', [h('span', 'Suburb / address'), h('input', { type: 'text', name: 'address', required: true, placeholder: 'e.g. Bryanston, Johannesburg', value: '' })]),
    ]));

    form.append(h('div.form-grid', [
      h('label.field', [h('span', 'Budget (optional, rand)'), h('input', { type: 'number', name: 'budget', min: 0, step: 50, placeholder: 'Leave blank to see bids' })]),
      h('label.field', [h('span', 'Urgency'), h('select', { name: 'urgency' }, [
        h('option', { value: 'EMERGENCY' }, 'Emergency — today'),
        h('option', { value: 'URGENT' }, 'Urgent — within 48 hours'),
        h('option', { value: 'SOON', selected: true }, 'This week'),
        h('option', { value: 'SCHEDULED' }, 'Scheduled date'),
        h('option', { value: 'FLEXIBLE' }, 'Flexible'),
      ])]),
    ]));

    form.append(h('details.fold', [
      h('summary', '🏠 Household & access details (safety)'),
      h('div.fold-body', [
        h('div.row.wrap', [
          h('label.field', { style: { margin: 0 } }, [h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [h('input', { type: 'checkbox', name: 'children' }), h('span.small', 'Children on the premises')])]),
          h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [h('input', { type: 'checkbox', name: 'vulnerable' }), h('span.small', 'Vulnerable occupants')]),
          h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [h('input', { type: 'checkbox', name: 'inHome', checked: true }), h('span.small', 'Work inside the home')]),
        ]),
        h('p.tiny.muted', { style: { marginTop: '8px' } }, 'These only add verification steps (arrival codes, clearance checks, two-person visits). They never change who can see your job or what it costs.'),
      ]),
    ]));

    form.append(h('button.btn.block', { type: 'submit' }, 'Match me with verified pros'));

    const liveAdvice = h('div.stack', { style: { marginTop: '14px' } });
    root.append(form, liveAdvice);

    // Live guidance while typing: category resolution + price band.
    const descriptionBox = form.querySelector('textarea[name=description]');
    let debounce = null;
    descriptionBox.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const text = descriptionBox.value.trim();
        if (text.length < 8) { liveAdvice.innerHTML = ''; return; }
        try {
          const { resolution } = await api.post('/api/catalogue/resolve', { text });
          liveAdvice.innerHTML = '';
          if (resolution.matched) {
            const category = categories.find((c) => c.id === resolution.categoryId);
            liveAdvice.append(h('div.banner.info', [
              h('span.ico', category?.statutoryTrade ? '⚖️' : '🧭'),
              h('div', [
                h('strong', `Looks like: ${category?.label || resolution.categoryId}`),
                h('div.small', `Matched on: ${resolution.why.join(', ') || 'description'}`),
                category?.statutoryTrade ? h('div.small', 'This is a statutory trade — bids are only accepted from pros with the issuing body’s certificate on file.') : null,
              ]),
            ]));
            const select = form.querySelector('select[name=categoryId]');
            if (select && !select.value) select.value = resolution.categoryId;
          }
        } catch { /* offline or typing fast — ignore */ }
      }, 420);
    });

    async function onSubmit(event) {
      event.preventDefault();
      const values = formValues(form);
      const button = form.querySelector('button[type=submit]');
      await withButton(button, async () => {
        const job = await api.post('/api/jobs', {
          customerId: session.userId,
          categoryId: values.categoryId || null,
          description: values.description,
          title: values.description.slice(0, 70),
          addressText: values.address,
          budgetCents: values.budget ? Math.round(values.budget * 100) : null,
          urgency: values.urgency,
          locationType: values.inHome ? 'IN_HOME' : 'ON_SITE',
          householdNotes: { childrenOnPremises: values.children, vulnerableOccupants: values.vulnerable },
        });
        toast(`Job posted — ${job.matchReport?.candidates?.length || 0} verified pro(s) notified`, 'ok');
        navigate(`/job/${job.jobId}`);
      });
    }

    return root;
  };

  function onboardingPrompt(title, body) {
    const root = h('div.fade-in.stack');
    root.append(h('div.card.accent', [
      h('div.kicker', '👤🏾 One quick step'),
      h('h2', title),
      h('p.small', body),
      h('div.col', [
        h('button.btn', { onclick: () => showCustomerSignup() }, 'Create my free account'),
        h('button.btn.ghost', { onclick: () => showProSignup() }, 'I’m a pro — I want work'),
      ]),
    ]));
    return root;
  }

  function showCustomerSignup() {
    const bundle = window.ProVeri.api.state.bundle || {};
    const suburbs = (bundle.catalog?.metros || []).flatMap((m) => m.suburbs || []);
    const form = h('form.stack', { onsubmit: submit });
    form.append(
      h('label.field', [h('span', 'Full name'), h('input', { type: 'text', name: 'fullName', required: true })]),
      h('label.field', [h('span', 'Email'), h('input', { type: 'email', name: 'email', required: true })]),
      h('label.field', [h('span', 'Mobile'), h('input', { type: 'tel', name: 'mobile', required: true, placeholder: '082 123 4567' })]),
      h('label.field', [h('span', 'Suburb'), h('select', { name: 'suburbId' }, [h('option', { value: '' }, 'Prefer not to say'), ...suburbs.map((s) => h('option', { value: s.id }, `${s.name} (${s.postalCode})`))])]),
      h('button.btn.block', { type: 'submit' }, 'Create account'),
    );
    window.ProVeri.ui.sheet('Create your free account', form);

    async function submit(event) {
      event.preventDefault();
      const values = window.ProVeri.ui.formValues(form);
      const button = form.querySelector('button[type=submit]');
      await window.ProVeri.ui.withButton(button, async () => {
        const customer = await window.ProVeri.api.post('/api/customers', { ...values, suburbId: values.suburbId || undefined });
        await window.ProVeri.api.post(`/api/customers/${customer.customerId}/verify-channel`, { channel: 'email', reference: `OTP_${customer.customerId.slice(-8)}` });
        await window.ProVeri.api.post(`/api/customers/${customer.customerId}/verify-channel`, { channel: 'mobile', reference: `OTP_${customer.customerId.slice(-8)}` });
        window.ProVeri.api.setSession({ userId: customer.customerId, role: 'CUSTOMER', name: customer.fullName });
        window.ProVeri.ui.closeSheet();
        window.ProVeri.ui.toast(`Welcome, ${customer.fullName.split(' ')[0]} — email and mobile verified`, 'ok');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    }
  }

  function showProSignup() {
    window.ProVeri.ui.navigate('/become-a-pro');
    window.ProVeri.ui.closeSheet();
  }

  /* ================= JOB DETAIL ================= */

  screens['/job/:jobId'] = async function jobDetail({ params, query }) {
    const root = h('div.fade-in.stack');
    root.append(loading(6));
    const session = api.session();

    try {
      const job = await api.get(`/api/jobs/${params.jobId}?viewerId=${session?.userId || ''}`);
      root.innerHTML = '';

      root.append(h('div.row.between', [
        h('h1', { style: { fontSize: '20px' } }, job.title),
        badge(job.status, job.status === 'OPEN' || job.status === 'BIDDING' ? 'info' : 'neutral'),
      ]));
      root.append(h('p.tiny.muted', `${job.reference} · ${job.categoryLabel} · ${job.location.suburb || job.location.metro || ''} · posted ${timeAgo(job.postedAt)}`));

      if (job.statutoryTrade) {
        root.append(h('div.banner.warn', [h('span.ico', '⚖️'), h('div', [h('strong', 'Statutory trade'), h('div.small', 'Bids are only accepted from pros with the issuing body’s certificate on file. Uncertified bids are blocked before they reach you.')])]));
      }

      root.append(h('div.card', [h('div.kicker', 'The job'), h('p.small', job.description)]));

      /* price intelligence */
      if (job.priceBand) {
        root.append(h('div.card', [
          h('div.kicker', '📊 Fair-Price Intelligence'),
          h('div.row.between', [
            h('div', [h('div.tiny.muted', 'typical'), h('span.money.big', money(job.priceBand.p50Cents))]),
            h('div', [h('div.tiny.muted', 'low end'), h('span.money', money(job.priceBand.p10Cents))]),
            h('div', [h('div.tiny.muted', 'high end'), h('span.money', money(job.priceBand.p90Cents))]),
          ]),
          h('p.tiny.muted', { style: { marginTop: '10px' } }, job.priceBand.guidance),
        ]));
      }

      /* context: weather, load shedding, holidays */
      if (job.weatherAdvice?.sensitive) {
        root.append(h('div.banner.' + (job.weatherAdvice.verdict === 'POSTPONE' ? 'warn' : 'info'), [
          h('span.ico', '🌦️'),
          h('div', [h('strong', job.weatherAdvice.advice.split('.')[0] + '.'), h('div.small', job.weatherAdvice.advice)]),
        ]));
      }
      if (job.loadSheddingAdvice) {
        root.append(h('div.banner.' + (job.loadSheddingAdvice.nationalStage >= 3 ? 'warn' : 'info'), [
          h('span.ico', '⚡'),
          h('div', [
            h('strong', job.loadSheddingAdvice.advice),
            job.loadSheddingAdvice.recommendedSlots?.length ? h('div.small', `Outage-free slots: ${job.loadSheddingAdvice.recommendedSlots.slice(0, 3).map((s) => window.ProVeri.ui.dateTimeShort(s.start)).join(' · ')}`) : null,
            job.loadSheddingAdvice.upsell ? h('div.small', { style: { marginTop: '6px' } }, [h('a', { href: `/find-a-pro?category=${job.loadSheddingAdvice.upsell.categoryId}` }, job.loadSheddingAdvice.upsell.message)]) : null,
          ]),
        ]));
      }
      if (job.holidayAdvice?.days?.length) {
        const day = job.holidayAdvice.days[0];
        if (day.kind !== 'WEEKDAY') {
          root.append(h('div.banner.warn', [h('span.ico', '📅'), h('div', h('strong', `${day.name || day.kind}: ${day.advice}`))]));
        }
        if (day.payday?.peak) root.append(h('div.banner.info', [h('span.ico', '💸'), h('div.small', day.payday.reason)]));
      }

      /* safety plan */
      if (job.safetyPlan?.steps?.length) {
        root.append(h('details.fold', [
          h('summary', '🔐 Your safety plan for this job'),
          h('div.fold-body', h('div.steps', job.safetyPlan.steps.map((s) =>
            h('div.step.done', [h('div.dot', s.required ? '🔒' : 'ℹ️'), h('div.body', [h('div.t', s.title), h('div.d', s.detail)])])))),
        ]));
      }

      /* bids */
      root.append(h('section.section', [
        h('div.row.between', [
          h('h2', `Bids (${job.bids.length})`),
          job.status === 'BIDDING' || job.status === 'OPEN'
            ? h('button.btn.sm.ghost', { onclick: () => beatTheQuote(job) }, '⚔️ Beat this quote')
            : null,
        ]),
        h('div.list', { style: { marginTop: '10px' } }, job.bids.length ? job.bids.map((bid) => bidCard(job, bid, session)) : [
          h('div.empty.card.flat', [
            h('div.ico', '⏳'), h('h3', 'Waiting for the first bid'),
            h('p.small.muted', `${job.matchReport?.candidates?.length || job.matchedProIds?.length || 0} verified pro(s) were notified. Median first response on ProVeri is minutes, not the 4–24 hours typical of older platforms.`),
          ]),
        ]),
      ]));

      /* matching explanation */
      if (job.matchReport) {
        root.append(h('details.fold', [
          h('summary', `🧮 Why these pros? (${job.matchReport.eligible} matched of ${job.matchReport.poolSize} in the pool)`),
          h('div.fold-body', [
            h('p.small.muted', job.matchReport.fairness.statement),
            h('div.list', { style: { marginTop: '8px' } }, job.matchReport.candidates.slice(0, 6).map((c) =>
              h('div.card.pad-sm', [
                h('div.row.between', [h('strong.small', c.name), h('span.badge.verified', `match ${c.score}`)]),
                h('div.tiny.muted', c.whyRecommended),
                h('div.row', { style: { gap: '6px', marginTop: '6px', flexWrap: 'wrap' } }, c.flags.map((f) =>
                  badge(f.code.replace(/_/g, ' '), f.kind === 'GOOD' ? 'verified' : f.kind === 'WARN' ? 'warn' : f.kind === 'BLOCKING' ? 'danger' : 'info'))),
              ]))),
            job.matchReport.blocked ? h('p.tiny.muted', { style: { marginTop: '8px' } }, `Hidden from matching: ${JSON.stringify(job.matchReport.blockedReasons) || 'none'}`) : null,
          ]),
        ]));
      }

      if (job.bookingId) {
        root.append(h('button.btn.block', { onclick: () => navigate(`/booking/${job.bookingId}`) }, '📦 Open the booking and escrow'));
      }
    } catch (error) {
      root.innerHTML = '';
      root.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;

    function bidCard(job, bid, session) {
      if (bid.masked) {
        return h('div.card.pad-sm', [h('div.tiny.muted', 'Another verified pro has bid. Competing bid prices stay hidden until the job is awarded — pros quote the work, not each other.')]);
      }
      const verdict = bid.priceAssessment;
      const tone = verdict?.verdict === 'WELL_BELOW_MARKET' ? 'warn' : verdict?.verdict === 'WELL_ABOVE_MARKET' ? 'info' : 'ok';
      const canAccept = session?.userId === job.customerId && ['OPEN', 'BIDDING'].includes(job.status);
      return h('div.card', [
        h('div.row.between', [
          h('div.row', { style: { gap: '8px' } }, [
            h('strong', bid.proName),
            trustBadge(bid.proBadge, bid.proTrustScore),
          ]),
          h('span.money.big', money(bid.totalCents)),
        ]),
        h('div.small', { style: { margin: '8px 0' } }, bid.scopeOfWork),
        h('div.row.wrap', { style: { gap: '6px' } }, [
          verdict ? badge(verdict.headline || verdict.verdict, tone) : null,
          bid.includesCoc ? badge(bid.cocName || 'CoC included', 'verified') : null,
          badge(`${bid.warrantyDays}-day warranty`, 'info'),
          bid.materialsQuoteCents ? badge(`materials ${money(bid.materialsQuoteCents)}`, 'neutral') : null,
        ]),
        verdict?.advice ? h('p.tiny.muted', { style: { marginTop: '8px' } }, verdict.advice) : null,
        h('div.row', { style: { marginTop: '8px', gap: '6px', flexWrap: 'wrap' } }, bid.inclusions.map((i) => h('span.badge.neutral', `+ ${i}`))),
        bid.exclusions?.length ? h('div.row', { style: { marginTop: '6px', gap: '6px', flexWrap: 'wrap' } }, bid.exclusions.map((i) => h('span.tiny.muted', `− ${i}`))) : null,
        canAccept ? h('div.row', { style: { marginTop: '12px' } }, [
          h('button.btn.sm', { onclick: () => acceptBid(job, bid) }, `Accept & pay ${money(bid.totalCents)} into escrow`),
          h('button.btn.sm.ghost', { onclick: () => navigate(`/pro/${bid.proId}`) }, 'View pro'),
        ]) : null,
      ]);
    }

    async function acceptBid(job, bid) {
      const escrowSplit = [
        ['Pro payout (90%)', Math.round(bid.totalCents * 0.9)],
        ['Platform fee (10%)', Math.round(bid.totalCents * 0.1)],
        ['— of which held as 5% workmanship warranty', Math.round(bid.totalCents * 0.05)],
      ];
      const sheetClose = sheet('Confirm and pay into escrow', h('div.stack', [
        h('p.small', `You pay ${money(bid.totalCents)} now. ${bid.proName} is only paid when you confirm the work — and 5% stays held for a ${bid.warrantyDays}-day workmanship warranty.`),
        h('div.card.pad-sm', escrowSplit.map(([label, cents]) => h('div.split-row', [h('span.lbl', label), h('span.money', money(cents))]))),
        h('div.banner.info', [h('span.ico', '🔐'), h('div.small', 'Funds are held by a regulated partner (TradeSafe above R5,000; Paystack, PayFast, Ozow or Yoco below). Lula ProVeri never touches client money.')]),
        h('label.field', [h('span', 'Preferred payment method'), h('select', { name: 'method' }, [
          h('option', { value: 'instant-eft' }, 'Instant EFT (Ozow)'),
          h('option', { value: 'card' }, 'Card'),
          h('option', { value: 'eft' }, 'EFT'),
        ])]),
      ]), [
        h('button.btn.block', { onclick: async (event) => {
          await withButton(event.target, async () => {
            const booking = await api.post('/api/bookings', { jobId: job.jobId, bidId: bid.bidId, customerId: session.userId });
            await api.post(`/api/bookings/${booking.bookingId}/fund`, { customerId: session.userId, paymentMethod: 'instant-eft' });
            sheetClose();
            toast('Paid into escrow — the pro is guaranteed payment on completion', 'ok');
            navigate(`/booking/${booking.bookingId}`);
          });
        } }, 'Pay into escrow'),
      ]);
    }

    async function beatTheQuote(job) {
      const target = job.bids.find((b) => !b.masked);
      if (!target) { toast('There is no bid to beat yet', 'warn'); return; }
      sheet('Beat this quote', h('div.stack', [
        h('p.small', `We will invite up to 6 more verified ${job.categoryLabel} pros to undercut ${target.proName}’s ${money(target.totalCents)} bid over the next 24 hours. Your original bid stays live and protected.`),
        h('div.banner.ok', [h('span.ico', '⚔️'), h('div.small', 'This is how ProVeri keeps prices honest without you haggling: competition between verified pros, on the record.')]),
      ]), [
        h('button.btn.block', { onclick: async (event) => {
          await withButton(event.target, async () => {
            const result = await api.post(`/api/jobs/${job.jobId}/beat-the-quote`, { targetBidId: target.bidId, windowHours: 24 });
            sheetClose();
            toast(`${result.invitedProIds?.length || 6} pros invited to beat the quote`, 'ok');
          });
        } }, 'Invite competing bids'),
      ]);
    }
  };
})();
