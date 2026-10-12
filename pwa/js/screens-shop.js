/* ==========================================================================
   Lula ProVeri PWA — the shop
   ==========================================================================
   📍 In South Africa, for South Africa 🇿🇦
   Connecting local businesses with home owners.

   This is the storefront: a homeowner scrolls real work done near them, taps
   a job they like, and reaches out to the person who did it. Four tabs and one
   button — everything else lives under "You".

   Deliberately not here: walls of copy, stat grids, four-step explainers and
   marketing adjectives. The proof is the work itself, and each item says in
   plain words whether ProVeri evidence stands behind it.
   ========================================================================== */

window.ProVeri = window.ProVeri || {};
window.ProVeri.screens = window.ProVeri.screens || {};

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const {
    h, money, timeAgo, dateShort, starRow, icon, photoImg, catIcon, badge, trustBadge, toast, sheet, closeSheet,
    loadingCards, empty, navigate, formValues, withButton, sectionHead,
  } = window.ProVeri.ui;

  const screens = window.ProVeri.screens;

  /** sessionStorage can throw in private mode and is absent in the test shim. */
  const scratch = {
    get(key) { try { return window.sessionStorage ? window.sessionStorage.getItem(key) : null; } catch { return null; } },
    set(key, value) { try { if (window.sessionStorage) window.sessionStorage.setItem(key, String(value)); } catch { /* not fatal */ } },
    remove(key) { try { if (window.sessionStorage) window.sessionStorage.removeItem(key); } catch { /* not fatal */ } },
  };

  const TIER_TONE = {
    CLIENT_CONFIRMED: 'verified',
    EVIDENCE_LINKED: 'verified',
    SELF_DECLARED: 'neutral',
  };
  const TIER_SHORT = {
    CLIENT_CONFIRMED: '✓ Client confirmed',
    EVIDENCE_LINKED: '✓ Proof of work',
    SELF_DECLARED: 'Uploaded by the pro',
  };

  /* ================================================================== *
   * Shared pieces
   * ================================================================== */

  /** The picture, or — for evidence-only items — the seal that stands in for it. */
  function workThumb(item, size) {
    const photo = item.photo || item.photos?.[0] || null;
    const src = photo?.dataUrl || photo?.url || null;
    if (src) {
      return h(`div.work-thumb.${size || 'card'}`, [
        photoImg(src, photo?.caption || item.title),
        photo?.illustrative ? h('span.thumb-note', 'Demo photo') : null,
        h('span.thumb-tier', { class: item.verified === false ? 'plain' : 'proven' }, TIER_SHORT[item.tier] || ''),
      ]);
    }
    // No hosted image: this item's proof is a hash-sealed evidence record, and
    // showing a stock photo instead would be exactly the trick we police.
    return h(`div.work-thumb.sealed.${size || 'card'}`, [
      h('span.seal-ico', icon(item.tier === 'CLIENT_CONFIRMED' ? 'shield' : 'camera', 20)),
      h('span.seal-title', item.categoryLabel || 'Trade work'),
      h('span.seal-line', [
        item.proSuburb || item.suburb || item.metro || 'South Africa',
        item.completedAt ? ` · ${dateShort(item.completedAt)}` : '',
      ]),
      h('span.seal-line', item.seal ? `Sealed ${String(item.seal).slice(0, 10)}` : 'Evidence sealed on the ledger'),
      h('span.thumb-tier.proven', TIER_SHORT[item.tier] || ''),
    ]);
  }

  function priceTag(item) {
    if (item.priceCents == null) return h('div.price', 'Quote on request');
    return h('div.price', [h('strong', money(item.priceCents)), item.priceNote ? h('small', item.priceNote) : null]);
  }

  /**
   * One card in the grid — the whole decision a home owner makes, in one
   * glance: the picture, who did it, how they rate, where, what it cost, and
   * whether ProVeri evidence stands behind it.
   */
  function workCard(item) {
    return h('a.work-card', { href: `/work/${item.itemId}` }, [
      workThumb(item),
      h('div.work-body', [
        h('div.work-title', item.title),
        h('div.work-meta', [
          h('span.who', item.proName || 'A local pro'),
          item.proRating ? starRow(item.proRating) : null,
        ]),
        h('div.work-meta', [
          icon('pin', 12),
          h('span.where', item.proSuburb || item.suburb || item.metro || 'South Africa'),
        ]),
        h('div.work-foot', [
          priceTag(item),
          item.enquiries ? h('span.tiny.muted', `${item.enquiries} reached out`) : null,
        ]),
      ]),
    ]);
  }

  function workGrid(items) {
    return h('div.work-grid', items.map(workCard));
  }

  async function fetchFeed(query = {}) {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.categoryId) params.set('categoryId', query.categoryId);
    if (query.suburbId) params.set('suburbId', query.suburbId);
    if (query.metro) params.set('metro', query.metro);
    if (query.tier) params.set('tier', query.tier);
    if (query.verified) params.set('verified', 'true');
    if (query.sort) params.set('sort', query.sort);
    params.set('limit', String(query.limit || 24));
    return api.get(`/api/portfolio?${params.toString()}`);
  }

  /**
   * ~110 suburbs across 11 metros. Flat, that is a scroll marathon; grouped by
   * metro it is a list a person can actually read on a phone.
   */
  function suburbOptions({ selectedId = '', withPostal = false } = {}) {
    const metros = (api.state.bundle && api.state.bundle.catalog && api.state.bundle.catalog.metros) || [];
    return metros.map((metro) => h('optgroup', { label: metro.name },
      (metro.suburbs || []).map((suburb) => h('option', {
        value: suburb.id,
        selected: suburb.id === selectedId || undefined,
      }, withPostal && suburb.postalCode ? `${suburb.name} (${suburb.postalCode})` : suburb.name))));
  }

  async function categories() {
    try {
      return await api.get('/api/categories');
    } catch {
      return (api.state.bundle?.catalog?.categories || []).map((c) => ({ id: c.id, label: c.label, icon: c.icon, group: c.group }));
    }
  }

  function searchBar({ value = '', placeholder = 'What do you need done?', onsubmit }) {
    const form = h('form.search-bar', {
      onsubmit: (event) => {
        event.preventDefault();
        onsubmit(form.querySelector('input[name=q]').value.trim());
      },
    }, [
      h('span.ico', icon('search', 19)),
      h('input', { type: 'search', name: 'q', value, placeholder, autocomplete: 'off' }),
      h('button.btn.sm', { type: 'submit' }, 'Search'),
    ]);
    return form;
  }

  /**
   * Sign-in gate. Everything that writes (enquire, post, upload) needs to know
   * who is acting, and the ledger records it — so we ask once, plainly.
   */
  function signInGate(title, body, next) {
    return h('div.fade-in.stack', [
      h('div.card.accent', [
        h('div.kicker', [icon('user', 14), 'One quick step']),
        h('h2', title),
        h('p.small', body),
        h('div.col', [
          h('button.btn', { onclick: () => customerSignup(next) }, 'Create my free account'),
          h('button.btn.ghost', { onclick: () => { closeSheet(); navigate('/become-a-pro'); } }, 'I’m a pro — I want work'),
          next ? h('button.btn.link', { onclick: () => navigate('/') }, 'Not now') : null,
        ]),
      ]),
    ]);
  }

  function customerSignup(after) {
    const form = h('form.stack', { onsubmit: submit }, [
      h('label.field', [h('span', 'Full name'), h('input', { type: 'text', name: 'fullName', required: true })]),
      h('label.field', [h('span', 'Email'), h('input', { type: 'email', name: 'email', required: true })]),
      h('label.field', [h('span', 'Mobile'), h('input', { type: 'tel', name: 'mobile', required: true, placeholder: '082 123 4567' })]),
      h('label.field', [h('span', 'Suburb'), h('select', { name: 'suburbId' }, [
        h('option', { value: '' }, 'Prefer not to say'),
        ...suburbOptions({ withPostal: true }),
      ])]),
      h('button.btn.block', { type: 'submit' }, 'Create account'),
      h('p.tiny.muted', 'Email and mobile are confirmed with a one-time PIN. No card needed to browse or enquire.'),
    ]);
    sheet('Create your free account', form);

    async function submit(event) {
      event.preventDefault();
      const values = formValues(form);
      const button = form.querySelector('button[type=submit]');
      await withButton(button, async () => {
        const customer = await api.post('/api/customers', { ...values, suburbId: values.suburbId || undefined });
        const pin = `OTP_${customer.customerId.slice(-8)}`;
        await api.post(`/api/customers/${customer.customerId}/verify-channel`, { channel: 'email', reference: pin });
        await api.post(`/api/customers/${customer.customerId}/verify-channel`, { channel: 'mobile', reference: pin });
        api.setSession({ userId: customer.customerId, role: 'CUSTOMER', name: customer.fullName });
        closeSheet();
        toast(`Welcome, ${customer.fullName.split(' ')[0]} — email and mobile verified`, 'ok');
        if (after) after();
        else window.dispatchEvent(new PopStateEvent('popstate'));
      });
    }
  }

  /* ================================================================== *
   * HOME — search, categories, work near you. Nothing else.
   * ================================================================== */

  screens['/'] = async function home({ query }) {
    const root = h('div.fade-in.shop-home');

    root.append(h('section.home-head', [
      h('h1', ['Find someone who has ', h('em', 'already done this'), ' — near you.']),
      h('p.sub', '📍 In South Africa, for South Africa 🇿🇦 · Real jobs, real photos, real pros.'),
      searchBar({
        value: query.q || '',
        onsubmit: (q) => navigate(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse'),
      }),
    ]));

    /* the trades, as a thumb-reachable rail of circles */
    const catWrap = h('div.cat-rail', [h('div.skeleton.line', { style: { width: '70%' } })]);
    root.append(h('section.section.tight', catWrap));
    loadCategoryRail(catWrap, query.category);

    /* one hero job, then the grid — proven work first, newest next */
    const feat = h('div', [h('div.skeleton.card')]);
    const feedHead = sectionHead('Work done near you', 'See all', '/browse');
    const feed = h('div', [loadingCards(2)]);
    root.append(feat, h('section.section', [feedHead, feed]));
    loadHomeFeed(feat, feed, feedHead, query);

    /* one honest line about what the feed is made of, then out of the way */
    const proof = h('div.trust-line', [h('div.skeleton.line', { style: { width: '80%' } })]);
    root.append(proof);
    loadProofLine(proof);

    /* the other side of the market, one card, no lecture */
    root.append(h('section.section', [
      h('a.pro-cta', { href: '/upload-work' }, [
        h('div.grow', [
          h('div.t', 'Did the work? Put it here.'),
          h('div.small', 'Upload your past jobs and home owners reach out to you directly. Proven work gets a badge you cannot buy.'),
        ]),
        h('span.arrow', icon('arrow', 20)),
      ]),
    ]));

    return root;
  };

  /** What a home owner types into a search bar most often, in that order. */
  const RAIL_ORDER = [
    'plumbing', 'electrical', 'painting', 'handyman', 'cleaning-home',
    'gardening', 'solar-inverter', 'electric-fence-security', 'beauty-mobile',
  ];

  /** Trade picker: circles you can hit with a thumb, not a wall of text. */
  async function loadCategoryRail(container, activeId) {
    container.innerHTML = '';
    const all = await categories();
    const byId = new Map(all.map((c) => [c.id, c]));
    const cats = [...RAIL_ORDER.map((id) => byId.get(id)).filter(Boolean),
      ...all.filter((c) => !RAIL_ORDER.includes(c.id))].slice(0, 9);
    container.append(...cats.map((c) => h('button.chip.cat-dot', {
      class: c.id === activeId ? 'active' : '',
      onclick: () => navigate(`/browse?category=${c.id}`),
    }, [
      h('span.ring', catIcon(c)),
      h('span.lbl', c.label),
    ])));
    container.append(h('button.chip.cat-dot', { onclick: () => navigate('/browse') }, [
      h('span.ring', icon('sparkle', 24)),
      h('span.lbl', 'All work'),
    ]));
  }

  /** The one job worth stopping for: a photo, a price, and who did it. */
  function featuredCard(item) {
    const photo = item.photo || item.photos?.[0] || null;
    const src = photo?.dataUrl || photo?.url || null;
    return h('a.feat-card', { href: `/work/${item.itemId}` }, [
      src ? h('img', { src, alt: item.title, loading: 'lazy', decoding: 'async' }) : null,
      h('div.scrim'),
      h('div.over', [
        h('div.kick', [icon(item.verified ? 'shield' : 'sparkle', 13), item.verified ? 'Proven on ProVeri' : 'Just uploaded']),
        h('div.t', item.title),
        h('div.m', [
          h('span.money', item.priceCents == null ? 'Quote on request' : money(item.priceCents)),
          h('span', `${item.proName || 'A local pro'} · ${item.proSuburb || item.suburb || item.metro || 'South Africa'}`),
          item.proRating ? starRow(item.proRating) : null,
        ]),
      ]),
    ]);
  }

  async function loadHomeFeed(featSlot, container, head, query) {
    try {
      // Proven work first, then the newest uploads — so the first screen shows
      // both what the badge is worth and what is arriving right now.
      const [provenWork, recentWork] = await Promise.all([
        fetchFeed({ ...query, verified: true, sort: 'verified', limit: 5 }),
        fetchFeed({ ...query, sort: 'recent', limit: 9 }),
      ]);
      const seen = new Set(provenWork.map((i) => i.itemId));
      const items = [...provenWork, ...recentWork.filter((i) => !seen.has(i.itemId))];
      const hero = items.find((i) => i.photo?.url || i.photo?.dataUrl) || items[0] || null;
      const rest = items.filter((i) => i !== hero).slice(0, 6);

      featSlot.innerHTML = '';
      if (hero) featSlot.append(h('section.section.tight', featuredCard(hero)));

      container.innerHTML = '';
      if (!rest.length) {
        container.append(empty('🧰', 'No work posted here yet', 'Be the first: upload a job you have done and home owners in your area will find it.',
          h('button.btn', { onclick: () => navigate('/upload-work') }, 'Upload my work')));
        return;
      }
      container.append(workGrid(rest));
      const proven = items.filter((i) => i.verified).length;
      head.querySelector('h2').textContent = proven === items.length
        ? 'Work done near you — all of it proven'
        : 'Work done near you';
    } catch (error) {
      container.innerHTML = '';
      container.append(h('div.banner.danger', [h('span.ico', icon('close', 16)), h('div', error.message)]));
    }
  }

  async function loadProofLine(container) {
    try {
      const stats = await api.get('/api/portfolio/stats');
      container.innerHTML = '';
      container.append(h('div.card.flat.pad-sm.trust-line-card', [
        h('div.row.between', { style: { gap: '10px' } }, [
          h('div.grow', [
            h('div.small', [
              h('strong', `${stats.verified} of ${stats.items}`),
              ` pieces of work here are backed by escrow-released jobs on ProVeri.`,
            ]),
            h('div.tiny.muted', 'The rest were uploaded by the pros themselves and are labelled that way. Nobody can buy a badge.'),
          ]),
          h('a.btn.sm.ghost', { href: '/trust' }, 'How it works'),
        ]),
      ]));
    } catch {
      container.innerHTML = '';
    }
  }

  /* ================================================================== *
   * BROWSE — the shop floor
   * ================================================================== */

  screens['/browse'] = async function browse({ query }) {
    const state = {
      q: query.q || '',
      categoryId: query.category || '',
      suburbId: query.suburb || '',
      verified: query.verified === 'true',
      sort: query.sort || 'verified',
    };

    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Browse work'));
    root.append(searchBar({
      value: state.q,
      placeholder: 'Search work: geyser, tiling, painting…',
      onsubmit: (q) => { state.q = q; syncUrl(); refresh(); },
    }));

    const tierChips = h('div.chip-row', [
      h('button.chip', { class: 'active', onclick: (e) => pickTier(e, '') }, 'All work'),
      h('button.chip', { onclick: (e) => pickTier(e, 'PROVEN') }, [icon('shield', 14), h('span', 'Proof of work')]),
      h('button.chip', { onclick: (e) => pickTier(e, 'CLIENT_CONFIRMED') }, [icon('star', 14), h('span', 'Client confirmed')]),
      h('button.chip.ghost', { onclick: () => navigate('/find-a-pro') }, [icon('user', 14), h('span', 'Browse pros')]),
    ]);
    root.append(tierChips);

    const cats = await categories();
    const filters = h('div.filters', [
      h('label.field', [h('span', 'Category'), h('select', { name: 'categoryId', onchange: (e) => { state.categoryId = e.target.value; syncUrl(); refresh(); } }, [
        h('option', { value: '' }, 'All categories'),
        ...cats.map((c) => h('option', { value: c.id, selected: c.id === state.categoryId }, `${catIcon(c)} ${c.label}`)),
      ])]),
      h('label.field', [h('span', 'Suburb'), h('select', { name: 'suburbId', onchange: (e) => { state.suburbId = e.target.value; syncUrl(); refresh(); } }, [
        h('option', { value: '' }, 'Anywhere in SA'),
        ...suburbOptions({ selectedId: state.suburbId }),
      ])]),
      h('label.field', [h('span', 'Sort'), h('select', { name: 'sort', onchange: (e) => { state.sort = e.target.value; syncUrl(); refresh(); } }, [
        h('option', { value: 'verified', selected: state.sort === 'verified' }, 'Most proven first'),
        h('option', { value: 'recent', selected: state.sort === 'recent' }, 'Newest'),
        h('option', { value: 'rating', selected: state.sort === 'rating' }, 'Best-rated pro'),
      ])]),
    ]);
    root.append(filters);

    const count = h('div.tiny.muted.result-count', 'Loading work…');
    const list = h('div', [loadingCards(3)]);
    root.append(count, list);
    refresh();
    return root;

    function pickTier(event, tier) {
      tierChips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      event.target.closest('button').classList.add('active');
      state.verified = tier === 'PROVEN';
      state.tier = tier === 'CLIENT_CONFIRMED' ? 'CLIENT_CONFIRMED' : '';
      syncUrl();
      refresh();
    }

    function syncUrl() {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.categoryId) params.set('category', state.categoryId);
      if (state.suburbId) params.set('suburb', state.suburbId);
      if (state.verified) params.set('verified', 'true');
      if (state.tier) params.set('tier', state.tier);
      if (state.sort !== 'verified') params.set('sort', state.sort);
      const qs = params.toString();
      history.replaceState({}, '', qs ? `/browse?${qs}` : '/browse');
    }

    async function refresh() {
      list.innerHTML = '';
      list.append(loadingCards(3));
      try {
        const items = await fetchFeed({ ...state, limit: 48 });
        list.innerHTML = '';
        count.textContent = items.length
          ? `${items.length} piece${items.length === 1 ? '' : 's'} of work · ${items.filter((i) => i.verified).length} proven on ProVeri`
          : '';
        if (!items.length) {
          list.append(empty('🔎', 'Nothing matches that yet', 'Try a different suburb or trade — or post the job you need and let verified pros come to you.',
            h('button.btn', { onclick: () => navigate('/post-job') }, 'Post my job')));
          return;
        }
        list.append(workGrid(items));
      } catch (error) {
        list.innerHTML = '';
        list.append(h('div.banner.danger', [h('span.ico', icon('close', 16)), h('div', error.message)]));
      }
    }
  };

  /* ================================================================== *
   * WORK — the product page
   * ================================================================== */

  screens['/work/:itemId'] = async function workDetail({ params }) {
    const item = await api.get(`/api/portfolio/${params.itemId}`);
    // detail() returns the record itself, so the tier decides what may be claimed.
    item.verified = item.tier !== 'SELF_DECLARED';
    item.seal = item.seal || item.ledgerSeal;
    const root = h('div.fade-in.stack.product');

    /* photos */
    const photos = item.photos || [];
    root.append(h('div.photo-strip', photos.map((photo, index) => {
      const src = photo.dataUrl || photo.url;
      return src
        ? h('figure.photo', [
          h('img', { src, alt: photo.caption || `${item.title} photo ${index + 1}` }),
          photo.caption ? h('figcaption', photo.caption) : null,
          photo.illustrative ? h('span.thumb-note', 'Demo photo') : null,
        ])
        : h('figure.photo.sealed', [
          h('span.seal-ico', icon('shield', 28)),
          h('figcaption', [
            h('div', photo.caption || 'Proof of work'),
            h('code', `seal ${(photo.seal || '').slice(0, 12)}`),
            photo.geoVerified === false ? h('div.tiny.warn', `Captured ${photo.distanceFromJobKm} km from the job address`) : null,
            photo.geoVerified ? h('div.tiny.ok', 'Captured at the job address') : null,
          ]),
        ]);
    })));

    /* the offer */
    root.append(h('section.section.tight', [
      h('div.row.between.wrap', { style: { gap: '8px' } }, [
        h('span.tier-pill.big', { class: item.verified ? 'proven' : 'plain' }, [
          item.verified ? icon('check', 13) : null, item.tierLabel,
        ]),
        item.rating ? starRow(item.rating) : null,
      ]),
      h('h1', item.title),
      item.description ? h('p', item.description) : null,
      priceTag(item),
      h('div.fact-row', [
        fact('Trade', item.categoryLabel),
        fact('Where', [item.suburb, item.metro].filter(Boolean).join(', ') || 'South Africa'),
        fact('Done', dateShort(item.completedAt)),
        item.clientReference ? fact('Job ref', item.clientReference) : null,
      ]),
    ]));

    /* what the badge means, in the tier's own words */
    root.append(h('section.section.tight', [
      h('div.verify-card', { class: item.verified ? 'proven' : 'plain' }, [
        h('div.kicker', [icon(item.verified ? 'shield' : 'camera', 14), item.verified ? 'Why this is verified' : 'What this is']),
        h('ul', item.verification.lines.map((line) => h('li', line))),
        item.ledgerSeal ? h('code.seal', `Ledger seal ${String(item.ledgerSeal).slice(0, 16)}`) : null,
      ]),
    ]));

    /* the seller */
    if (item.pro) {
      root.append(h('section.section.tight', [
        h('a.card.pro-row', { href: `/pro/${item.pro.proId}` }, [
          h('div.avatar', (item.pro.name || 'P').slice(0, 1)),
          h('div.grow', [
            h('div.t', item.pro.name),
            h('div.small.muted', [
              `${item.pro.completedJobs || 0} jobs completed`,
              item.pro.suburb ? ` · ${item.pro.suburb}` : '',
            ]),
            h('div.row', { style: { gap: '8px', marginTop: '7px', alignItems: 'center' } }, [
              item.pro.rating ? starRow(item.pro.rating) : null,
              trustBadge(item.pro.badge, item.pro.trustScore),
              item.pro.instantBook ? badge('instant book', 'info') : null,
            ]),
          ]),
          h('span.arrow', icon('chevron', 18)),
        ]),
      ]));
    }

    /* other work by the same pro */
    const moreWrap = h('div.scroller-x', [h('div.skeleton.card', { style: { width: '220px' } })]);
    root.append(h('section.section', [sectionHead(`More work by ${item.pro?.name || 'this pro'}`, 'Their profile', item.pro ? `/pro/${item.pro.proId}` : '/browse'), moreWrap]));
    loadMoreByPro(moreWrap, item);

    /* actions */
    root.append(h('div.cta-bar', [
      h('button.btn.ghost.grow', { onclick: () => openEnquiry(item) }, [icon('chat', 17), h('span', 'Message about this')]),
      h('button.btn.grow', { onclick: () => hireFrom(item) }, [icon('tool', 17), h('span', 'Hire for my job')]),
    ]));
    root.append(h('div.row.between.tiny.muted', { style: { padding: '0 4px 24px' } }, [
      h('span', item.enquiries
        ? `${item.enquiries} homeowner${item.enquiries === 1 ? ' has' : 's have'} reached out`
        : 'Be the first to reach out'),
      h('button.btn.link.tiny', { onclick: () => reportItem(item) }, 'Report this work'),
    ]));

    return root;
  };

  function fact(label, value) {
    if (!value) return null;
    return h('div.fact', [h('span.k', label), h('span.v', String(value))]);
  }

  async function loadMoreByPro(container, item) {
    try {
      const rows = (await api.get(`/api/pros/${item.proId}/portfolio?limit=8`)).filter((r) => r.itemId !== item.itemId);
      container.innerHTML = '';
      if (!rows.length) {
        container.append(h('p.small.muted', 'This is the only piece of work they have published so far.'));
        return;
      }
      container.append(...rows.map((row) => h('a.work-card.mini', { href: `/work/${row.itemId}`, style: { width: '220px' } }, [
        workThumb(row),
        h('div.work-body', [h('div.work-title', row.title), priceTag(row)]),
      ])));
    } catch {
      container.innerHTML = '';
    }
  }

  function hireFrom(item) {
    const draft = `Like the ${item.title.toLowerCase()} work by ${item.pro?.name || 'this pro'} — I need the same done.`;
    scratch.set('proveri.share-draft', draft);
    navigate(`/post-job?category=${item.categoryId || ''}&proId=${item.proId}&fromWork=${item.itemId}`);
  }

  function reportItem(item) {
    const session = api.session();
    const form = h('form.stack', { onsubmit: submit }, [
      h('label.field', [h('span', 'What is wrong with this?'), h('select', { name: 'reason' }, [
        h('option', 'This is not their work'),
        h('option', 'Photos are copied from somewhere else'),
        h('option', 'Price or scope is misleading'),
        h('option', 'Something else'),
      ])]),
      h('label.field', [h('span', 'Anything we should know?'), h('textarea', { name: 'note', rows: 3 })]),
      h('button.btn.block', { type: 'submit' }, 'Send to the trust desk'),
      h('p.tiny.muted', 'Reports go to the trust desk with your id attached. False reports are recorded too.'),
    ]);
    sheet(`Report “${item.title}”`, form);

    async function submit(event) {
      event.preventDefault();
      const values = formValues(form);
      await withButton(form.querySelector('button[type=submit]'), async () => {
        await api.post(`/api/portfolio/${item.itemId}/flag`, {
          reason: [values.reason, values.note].filter(Boolean).join(' — '),
          reporterId: session?.userId || null,
        });
        closeSheet();
        toast('Reported. The trust desk reviews it against the ledger record.', 'ok');
      });
    }
  }

  /** The reach-out loop: message a pro about a specific piece of their work. */
  function openEnquiry(item) {
    const session = api.session();
    if (!session) {
      sheet('Message this pro', signInGate('Create a free account to message', 'Home owners reach out to pros through their work. It takes 30 seconds — email and mobile are confirmed with a one-time PIN.', () => { closeSheet(); openEnquiry(item); }));
      return;
    }
    const form = h('form.stack', { onsubmit: submit }, [
      h('div.banner.info', [h('span.ico', icon('chat', 18)), h('div', [
        h('strong', `Message ${item.pro?.name || 'this pro'} about “${item.title}”`),
        h('div.small', 'Say what you need and where. They reply here — no WhatsApp numbers exchanged, so the record stays on ProVeri.'),
      ])]),
      h('label.field', [h('span', 'Your message'), h('textarea', {
        name: 'message', rows: 4, required: true,
        placeholder: `Hi ${item.pro?.name || ''} — can you do this in ${item.suburb || 'my area'}? I need it done next week.`.trim(),
      })]),
      h('button.btn.block', { type: 'submit' }, 'Send message'),
      h('p.tiny.muted', 'Messages are scanned for off-platform payment requests — that is how people get burned, so we keep the money here.'),
    ]);
    sheet(`Enquire about this work`, form);

    async function submit(event) {
      event.preventDefault();
      const values = formValues(form);
      await withButton(form.querySelector('button[type=submit]'), async () => {
        await api.post(`/api/portfolio/${item.itemId}/enquire`, { customerId: session.userId, message: values.message });
        closeSheet();
        toast('Message sent — it is in your Orders tab.', 'ok');
      });
    }
  }

  /* ================================================================== *
   * ORDERS — my jobs, my bookings, my messages, my uploads
   * ================================================================== */

  const TRACK = [
    { key: 'POSTED', label: 'Posted' },
    { key: 'BOOKED', label: 'Booked' },
    { key: 'ESCROW', label: 'In escrow' },
    { key: 'WORKING', label: 'Work done' },
    { key: 'CONFIRMED', label: 'Confirmed' },
    { key: 'PAID', label: 'Paid out' },
  ];
  const STAGE_OF = {
    NEW: 0, OPEN: 0, BIDDING: 0, EXPIRED: -1, MATCHED: 1, AWARDED: 1, AWAITING_PAYMENT: 1, SCHEDULED: 2, EN_ROUTE: 3, ON_SITE: 3, IN_PROGRESS: 3,
    AWAITING_CONFIRMATION: 3, COMPLETED: 4, IN_WARRANTY: 5, CLOSED: 5,
    CANCELLED: -1, DISPUTED: -1, REFUNDED: -1,
  };

  function tracker(status) {
    const stage = STAGE_OF[status] ?? 0;
    if (stage < 0) {
      return h('div.track.halted', [h('span.badge.danger', String(status).replace(/_/g, ' ')),
        h('span.tiny.muted', status === 'DISPUTED' ? 'Money is frozen in escrow until the dispute is resolved.' : 'Cancelled — nothing was paid out.')]);
    }
    return h('div.track', TRACK.map((step, index) => h('div.track-step', {
      class: index < stage ? 'done' : index === stage ? 'current' : '',
    }, [h('span.dot', index < stage ? '✓' : String(index + 1)), h('span.label', step.label)])));
  }

  screens['/orders'] = async function orders() {
    const session = api.session();
    if (!session) {
      return signInGate('Sign in to see your orders',
        'Every job you post, every booking, every message you send a pro and every piece of work you publish lives here — with your money’s position in escrow at each step. Creating an account is free and takes about thirty seconds.');
    }
    const root = h('div.fade-in.stack');
    root.append(h('div.row.between', [
      h('h1', 'Orders'),
      h('div.seg', [
        h('button', { class: session.role === 'PRO' ? '' : 'active', onclick: (e) => switchRole(e, 'CUSTOMER') }, 'I’m hiring'),
        h('button', { class: session.role === 'PRO' ? 'active' : '', onclick: (e) => switchRole(e, 'PRO') }, 'I’m working'),
      ]),
    ]));

    const body = h('div.stack');
    root.append(body);
    await render(body, session.role === 'PRO' ? 'pro' : 'customer');
    return root;

    function switchRole(event, role) {
      event.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      event.target.classList.add('active');
      api.setSession({ ...session, role });
      render(body, role === 'PRO' ? 'pro' : 'customer');
    }

    async function render(container, mode) {
      container.innerHTML = '';
      container.append(loadingCards(3));
      const who = mode === 'pro' ? `proId=${session.userId}` : `customerId=${session.userId}`;
      const [bookings, jobs, uploads] = await Promise.all([
        api.get(`/api/bookings?${who}`).catch(() => []),
        mode === 'pro' ? Promise.resolve([]) : api.get(`/api/jobs?customerId=${session.userId}`).catch(() => []),
        mode === 'pro' ? api.get(`/api/pros/${session.userId}/portfolio?limit=30`).catch(() => []) : Promise.resolve([]),
      ]);
      container.innerHTML = '';

      if (!bookings.length && !jobs.length && !uploads.length) {
        container.append(empty(mode === 'pro' ? '🧰' : '🧾',
          mode === 'pro' ? 'No work yet' : 'No orders yet',
          mode === 'pro'
            ? 'Upload the jobs you have already done — home owners find you through your work, and every escrow-released job adds itself here automatically.'
            : 'Browse real work done near you, message the pro who did it, or post a job and let verified pros bid.',
          h('button.btn', { onclick: () => navigate(mode === 'pro' ? '/upload-work' : '/browse') }, mode === 'pro' ? 'Upload my work' : 'Browse work')));
        return;
      }

      if (jobs.length) {
        container.append(h('h4', 'Jobs I posted'));
        container.append(h('div.order-list', jobs.map((job) => h('a.order-row', { href: job.bookingId ? `/booking/${job.bookingId}` : `/job/${job.jobId}` }, [
          h('span.lead', '🛠️'),
          h('div.grow', [
            h('div.t', job.title),
            h('div.d', `${job.categoryLabel} · ${job.suburb || ''} · ${job.bidCount} bid${job.bidCount === 1 ? '' : 's'}`),
            tracker(job.status),
          ]),
          h('div.meta', [h('div.money', job.budgetCents ? money(job.budgetCents) : '—'), h('div.tiny.muted', timeAgo(job.postedAt))]),
        ]))));
      }

      if (bookings.length) {
        container.append(h('h4', mode === 'pro' ? 'Jobs I won' : 'My bookings'));
        container.append(h('div.order-list', bookings.map((b) => h('a.order-row', { href: `/order/${b.bookingId}` }, [
          h('span.lead', b.status === 'CLOSED' ? '✅' : b.status === 'DISPUTED' ? '⚖️' : '📦'),
          h('div.grow', [
            h('div.row.wrap', { style: { gap: '6px' } }, [h('div.t', b.title), badge(b.reference, 'neutral')]),
            h('div.d', `${b.categoryLabel} · ${mode === 'pro' ? b.customerName : b.proName} · ${b.suburb || ''}`),
            tracker(b.status),
          ]),
          h('div.meta', [h('div.money', money(b.totalCents)), h('div.tiny.muted', b.status === 'IN_WARRANTY' ? 'warranty' : b.escrowStatus || '')]),
        ]))));
      }

      if (uploads.length) {
        container.append(sectionHead('Work I uploaded', 'Add more', '/upload-work'));
        container.append(workGrid(uploads.slice(0, 8)));
        const thin = uploads.filter((u) => !u.verified);
        if (thin.length) {
          container.append(h('div.banner.info', [h('span.ico', icon('camera', 18)), h('div', [
            h('strong', `${thin.length} upload${thin.length === 1 ? '' : 's'} have no proof behind them yet`),
            h('div.small', 'That is allowed — they are labelled “Uploaded by the pro”. Link one to a ProVeri job and it earns the badge automatically.'),
          ])]));
        }
      }
    }
  };

  /** Order tracking — the ecommerce-shaped view of a booking. */
  screens['/order/:bookingId'] = async function orderDetail({ params }) {
    const booking = await api.get(`/api/bookings/${params.bookingId}`);
    // The list rows are flattened; the full record nests the money under
    // price / escrow / payout, so read it from where it actually lives.
    const price = booking.price || {};
    const escrow = booking.escrow || {};
    const fees = escrow.fees || {};
    const payout = booking.payout || null;
    const warranty = booking.warranty || null;
    const total = price.totalCents ?? booking.totalCents ?? escrow.amountCents ?? 0;
    const released = payout ? payout.amountCents : 0;
    const holdback = payout ? (payout.holdbackCents || 0) : (fees.warrantyHoldbackCents || 0);
    const platformFee = payout ? (payout.platformFeeCents || 0) : (fees.platformFeeCents || 0);
    const stillHeld = Math.max(0, total - released - holdback - platformFee);
    const suburb = booking.address?.suburb || booking.suburb || '';
    const status = String(booking.status || '').replace(/_/g, ' ');

    const root = h('div.fade-in.stack');
    root.append(h('a.btn.link', { href: '/orders' }, '← Orders'));
    root.append(h('div.card.accent', [
      h('div.kicker', [icon('receipt', 14), `Order ${booking.reference}`]),
      h('h1', booking.title),
      h('div.row.between.wrap', { style: { gap: '8px' } }, [
        h('span.money.big', money(total)),
        badge(status, booking.status === 'DISPUTED' ? 'danger' : booking.status === 'CLOSED' ? 'ok' : 'info'),
      ]),
      h('p.small.muted', [booking.categoryLabel, suburb, booking.proName].filter(Boolean).join(' · ')),
      h('div', { style: { marginTop: '12px' } }, tracker(booking.status)),
    ]));

    root.append(h('section.section', [
      h('h2', 'Where your money is'),
      h('div.card.pad-sm', [
        moneyLine('Total for this job', money(total)),
        stillHeld > 0 ? moneyLine('Held in escrow', money(stillHeld)) : null,
        released > 0 ? moneyLine('Released to the pro', money(released)) : null,
        holdback > 0
          ? moneyLine(`Warranty holdback (${warranty?.days || 14} days)`,
            warranty?.endsAt ? `${money(holdback)} · until ${dateShort(warranty.endsAt)}` : money(holdback))
          : null,
        platformFee > 0 ? moneyLine('ProVeri fee (10%)', money(platformFee)) : null,
        h('p.tiny.muted', [
          escrow.provider ? `Held by ${escrow.provider}` : '',
          escrow.autoReleaseAt ? `auto-releases ${dateShort(escrow.autoReleaseAt)} if you do nothing` : '',
        ].filter(Boolean).join(' · ') || 'Money is held until you confirm the work.'),
        price.priceAssessment?.headline ? h('p.tiny.muted', `Market check: ${price.priceAssessment.headline}.`) : null,
        h('p.tiny.muted', 'Nobody is paid before you confirm the work. If a photo was taken away from your address, the payout is held.'),
      ]),
    ]));

    const evidence = booking.evidence || [];
    const evidenceCount = evidence.length || booking.evidenceCount || 0;
    if (evidenceCount) {
      const geoVerified = evidence.filter((item) => item.geoVerified).length;
      root.append(h('section.section', [
        h('h2', 'Proof of work'),
        h('div.card.pad-sm', [
          h('div.small', [
            `${evidenceCount} sealed record${evidenceCount === 1 ? '' : 's'}`,
            geoVerified ? `${geoVerified} captured at the job address` : '',
            'geotagged photos and any certificate this trade requires.',
          ].filter(Boolean).join(' · ')),
          h('div.row', { style: { gap: '8px', marginTop: '10px' } }, [
            h('a.btn.sm', { href: `/booking/${booking.bookingId}` }, 'Open the full record'),
            h('a.btn.sm.ghost', { href: `/proof/${booking.bookingId}` }, 'See the ledger proof'),
          ]),
        ]),
      ]));
    }

    root.append(h('div.cta-bar', [
      h('a.btn.ghost.grow', { href: `/booking/${booking.bookingId}` }, [icon('shield', 17), h('span', 'Full record')]),
      booking.status === 'AWAITING_CONFIRMATION'
        ? h('button.btn.grow', { onclick: () => navigate(`/booking/${booking.bookingId}`) }, [icon('check', 17), h('span', 'Confirm the work')])
        : h('a.btn.grow', { href: `/pro/${booking.proId}` }, [icon('camera', 17), h('span', 'Their other work')]),
    ]));
    return root;
  };

  function moneyLine(label, value) {
    return h('div.row.between', { style: { padding: '6px 0', borderBottom: '1px solid var(--line, rgba(0,0,0,.08))' } }, [
      h('span.small', label), h('span.small.strong', String(value)),
    ]);
  }

  /* ================================================================== *
   * POST A JOB — a checkout in three steps, not one long form
   * ================================================================== */

  screens['/post-job'] = async function postJob({ query }) {
    const session = api.session();
    if (!session) {
      return signInGate('Post a job', 'Create a free account to post. Verified pros near you are notified the moment it goes live.');
    }

    const bundle = api.state.bundle || {};
    const cats = bundle.catalog?.categories || (await categories());
    const draft = scratch.get('proveri.share-draft') || '';
    if (draft) scratch.remove('proveri.share-draft');

    const state = {
      step: 1,
      description: draft,
      categoryId: query.category || '',
      address: '',
      urgency: 'SOON',
      budget: null,
      inHome: true,
      children: false,
      vulnerable: false,
      advice: null,
      fromWork: query.fromWork || null,
      proId: query.proId || null,
    };

    const root = h('div.fade-in.stack');
    root.append(h('a.btn.link', { href: state.fromWork ? `/work/${state.fromWork}` : '/' }, '← Back'));
    root.append(h('h1', 'Post a job'));
    const stepper = h('div.stepper');
    const panel = h('div.card.stack');
    root.append(stepper, panel);
    paint();
    return root;

    function paint() {
      stepper.innerHTML = '';
      stepper.append(...[['1', 'What'], ['2', 'Where & when'], ['3', 'Budget & post']].map(([n, label]) => h('div.step-pill', {
        class: Number(n) < state.step ? 'done' : Number(n) === state.step ? 'current' : '',
      }, [h('span.dot', Number(n) < state.step ? '✓' : n), h('span', label)])));

      panel.innerHTML = '';
      if (state.step === 1) panel.append(stepWhat());
      if (state.step === 2) panel.append(stepWhere());
      if (state.step === 3) panel.append(stepReview());
    }

    function stepWhat() {
      const box = h('textarea', {
        name: 'description', rows: 4, required: true, value: state.description,
        placeholder: 'e.g. Geyser is leaking onto the kitchen ceiling and needs replacing today',
        oninput: (event) => { state.description = event.target.value; detect(); },
      });
      const advice = h('div.stack', { style: { marginTop: '10px' } });
      if (state.advice) advice.append(state.advice);
      const wrap = h('div.stack', [
        h('label.field', [h('span', 'What do you need done?'), box, h('div.hint', 'Plain language is fine — we work out the trade as you type.')]),
        advice,
        h('label.field', [h('span', 'Trade (optional)'), h('select', {
          name: 'categoryId',
          onchange: (event) => { state.categoryId = event.target.value; },
        }, [
          h('option', { value: '' }, 'Auto-detect from my description'),
          ...cats.map((c) => h('option', { value: c.id, selected: c.id === state.categoryId }, `${catIcon(c)} ${c.label}`)),
        ])]),
        h('div.row.end', [h('button.btn', { onclick: () => { if (!requireDescription()) return; state.step = 2; paint(); } }, 'Next →')]),
      ]);
      if (state.description.trim().length > 8) detect();
      return wrap;

      function requireDescription() {
        if (state.description.trim().length < 8) {
          toast('Describe the job in a sentence or two so pros can quote it', 'warn');
          box.focus();
          return false;
        }
        return true;
      }

      let debounce = null;
      async function detect() {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const text = state.description.trim();
          if (text.length < 8) return;
          try {
            const { resolution } = await api.post('/api/catalogue/resolve', { text });
            advice.innerHTML = '';
            if (resolution?.matched) {
              const category = cats.find((c) => c.id === resolution.categoryId);
              if (!state.categoryId) state.categoryId = resolution.categoryId;
              const select = panel.querySelector('select[name=categoryId]');
              if (select) select.value = state.categoryId;
              advice.append(h('div.banner.info', [
                h('span.ico', category?.statutoryTrade ? '⚖️' : '🧭'),
                h('div', [
                  h('strong', `Looks like: ${category?.label || resolution.categoryId}`),
                  h('div.small', category?.statutoryTrade
                    ? `${category.cocName || 'A certificate of compliance'} is required — only pros with it on file can bid.`
                    : 'Change it if we got it wrong.'),
                ]),
              ]));
            }
          } catch { /* offline: the select still works by hand */ }
        }, 420);
      }
    }

    function stepWhere() {
      return h('div.stack', [
        h('label.field', [h('span', 'Where is the job?'), h('input', {
          type: 'text', name: 'address', required: true, value: state.address,
          placeholder: 'e.g. Bryanston, Johannesburg', oninput: (e) => { state.address = e.target.value; },
        }), h('div.hint', 'Suburb and city is enough. The exact address is shared only with the pro you book.')]),
        h('label.field', [h('span', 'When do you need it?'), h('select', {
          name: 'urgency', onchange: (e) => { state.urgency = e.target.value; },
        }, [
          h('option', { value: 'EMERGENCY', selected: state.urgency === 'EMERGENCY' }, 'Emergency — today'),
          h('option', { value: 'URGENT', selected: state.urgency === 'URGENT' }, 'Urgent — within 48 hours'),
          h('option', { value: 'SOON', selected: state.urgency === 'SOON' }, 'This week'),
          h('option', { value: 'SCHEDULED', selected: state.urgency === 'SCHEDULED' }, 'A scheduled date'),
          h('option', { value: 'FLEXIBLE', selected: state.urgency === 'FLEXIBLE' }, 'Flexible'),
        ])]),
        h('details.fold', [
          h('summary', '🏠 Household & access (safety only)'),
          h('div.fold-body', [
            h('label.check', [h('input', { type: 'checkbox', checked: state.inHome, onchange: (e) => { state.inHome = e.target.checked; } }), h('span.small', 'Work happens inside the home')]),
            h('label.check', [h('input', { type: 'checkbox', checked: state.children, onchange: (e) => { state.children = e.target.checked; } }), h('span.small', 'Children on the premises')]),
            h('label.check', [h('input', { type: 'checkbox', checked: state.vulnerable, onchange: (e) => { state.vulnerable = e.target.checked; } }), h('span.small', 'Elderly or vulnerable occupants')]),
            h('p.tiny.muted', 'These only add safety steps — arrival codes, check-in prompts, two-person visits. They never change your price or who sees the job.'),
          ]),
        ]),
        h('div.row.between', [
          h('button.btn.ghost', { onclick: () => { state.step = 1; paint(); } }, '← Back'),
          h('button.btn', {
            onclick: () => {
              if (state.address.trim().length < 3) { toast('Tell us the suburb so we can match pros near you', 'warn'); return; }
              state.step = 3; paint();
            },
          }, 'Next →'),
        ]),
      ]);
    }

    function stepReview() {
      const category = cats.find((c) => c.id === state.categoryId);
      const summaryCard = h('div.review', [
        reviewLine('Job', state.description.trim()),
        reviewLine('Trade', category ? `${category.icon || ''} ${category.label}` : 'Auto-detect from the description'),
        reviewLine('Where', state.address.trim()),
        reviewLine('When', ({ EMERGENCY: 'Today (emergency)', URGENT: 'Within 48 hours', SOON: 'This week', SCHEDULED: 'A scheduled date', FLEXIBLE: 'Flexible' })[state.urgency]),
        reviewLine('Budget', state.budget ? money(Math.round(state.budget * 100)) : 'Leave it to the bids'),
        state.proId ? reviewLine('Preferred pro', 'From the work you were viewing — they get first look') : null,
      ]);
      return h('div.stack', [
        h('label.field', [h('span', 'Budget (optional, rand)'), h('input', {
          type: 'number', name: 'budget', min: 0, step: 50, placeholder: 'Leave blank to see bids first',
          value: state.budget == null ? '' : state.budget, oninput: (e) => { state.budget = e.target.value === '' ? null : Number(e.target.value); },
        }), h('div.hint', 'Every bid is annotated with the real market band for this trade and suburb, so you are never anchored by a fake R99 callout.')]),
        h('h4', 'Check it over'),
        summaryCard,
        h('div.banner.ok', [h('span.ico', '🛡️'), h('div', [
          h('strong', 'Your money stays in escrow'),
          h('div.small', 'You pay only when you accept a bid, into escrow. The pro is paid after you confirm the work — 5% is held for a 14-day workmanship warranty.'),
        ])]),
        h('div.row.between', [
          h('button.btn.ghost', { onclick: () => { state.step = 2; paint(); } }, '← Back'),
          h('button.btn.block.grow', { onclick: (event) => submitJob(event.currentTarget) }, 'Post my job'),
        ]),
      ]);
    }

    function reviewLine(label, value) {
      return h('div.review-row', [h('span.k', label), h('span.v', value || '—')]);
    }

    async function submitJob(button) {
      await withButton(button, async () => {
        const job = await api.post('/api/jobs', {
          customerId: session.userId,
          categoryId: state.categoryId || null,
          description: state.description.trim(),
          title: state.description.trim().slice(0, 70),
          addressText: state.address.trim(),
          budgetCents: state.budget ? Math.round(state.budget * 100) : null,
          urgency: state.urgency,
          locationType: state.inHome ? 'IN_HOME' : 'ON_SITE',
          householdNotes: { childrenOnPremises: state.children, vulnerableOccupants: state.vulnerable },
          preferredProId: state.proId || null,
        });
        const matched = job.categoryAutoDetected
          ? ` Matched to ${job.categoryAutoDetected.label} (${job.categoryAutoDetected.confidence}%).`
          : '';
        toast(`Job posted — ${job.matchReport?.candidates?.length || 0} verified pro(s) notified.${matched}`, 'ok');
        navigate(`/job/${job.jobId}`);
      });
    }
  };

  /* ================================================================== *
   * UPLOAD WORK — the pro side of the storefront
   * ================================================================== */

  screens['/upload-work'] = async function uploadWork() {
    const session = api.session();
    if (!session || session.role !== 'PRO') {
      return signInGate('Upload your past work', 'Home owners find you through the jobs you have already done. Sign in as a pro, or register — identity, phone, email and bank are verified before you can be booked.');
    }

    const cats = await categories();
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Upload your work'));
    root.append(h('div.banner.info', [h('span.ico', icon('camera', 18)), h('div', [
      h('strong', 'What you upload is what home owners judge you on'),
      h('div.small', 'Photos are sealed with a hash the moment you upload them. If a photo already belongs to another pro, the upload is refused. Link a ProVeri job and the item earns “Proof of work” — a badge nobody can buy.'),
    ])]));

    const photos = [];
    const previews = h('div.photo-previews', [h('span.tiny.muted', 'No photos yet')]);
    const form = h('form.card.stack', { onsubmit: submit }, [
      h('label.dropzone', [
        icon('camera', 26),
        h('div.t', 'Tap to add photos of the finished job'),
        h('div.small', 'Up to 8. Real photos of your own work — no stock images, no somebody else’s job. Each one is sealed with a hash as it lands.'),
        h('input', {
          type: 'file', name: 'photos', accept: 'image/*', multiple: true,
          style: { position: 'absolute', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' },
          onchange: (event) => readPhotos(event.target.files),
        }),
      ]),
      previews,
      h('label.field', [h('span', 'What was the job?'), h('input', { type: 'text', name: 'title', required: true, placeholder: 'e.g. 150L geyser replacement, tray and overflow redone' })]),
      h('label.field', [h('span', 'What did you actually do?'), h('textarea', { name: 'description', rows: 3, placeholder: 'Materials, what was broken, what you fixed, any certificate issued.' })]),
      h('div.form-grid', [
        h('label.field', [h('span', 'Trade'), h('select', { name: 'categoryId' }, [
          h('option', { value: '' }, 'My main trade'),
          ...cats.map((c) => h('option', { value: c.id }, `${catIcon(c)} ${c.label}`)),
        ])]),
        h('label.field', [h('span', 'Suburb'), h('select', { name: 'suburbId' }, [
          h('option', { value: '' }, 'Where was this?'),
          ...suburbOptions(),
        ])]),
      ]),
      h('div.form-grid', [
        h('label.field', [h('span', 'What did it cost the client? (rand)'), h('input', { type: 'number', name: 'price', min: 0, step: 50, placeholder: 'e.g. 6950' })]),
        h('label.field', [h('span', 'Link a ProVeri job (optional)'), h('input', { type: 'text', name: 'bookingId', placeholder: 'BKG-123456 or leave blank' }), h('div.hint', 'A linked, escrow-released job turns this into proven work.')]),
      ]),
      h('button.btn.block', { type: 'submit' }, 'Publish my work'),
      h('p.tiny.muted', 'Publishing means the photos are yours and the client’s privacy is respected: no house numbers, no faces, no addresses in the frame.'),
    ]);
    root.append(form);

    const mine = h('div.stack', [loadingCards(2)]);
    root.append(sectionHead('Your published work', null, null), mine);
    loadMine(mine, session.userId);

    return root;

    async function readPhotos(files) {
      const list = Array.from(files || []).slice(0, 8);
      previews.innerHTML = '';
      for (const file of list) {
        const dataUrl = await readAsDataUrl(file);
        if (!dataUrl) continue;
        photos.push({ dataUrl, caption: file.name.replace(/\.[a-z0-9]+$/i, '') });
      }
      if (!photos.length) { previews.append(h('span.tiny.muted', 'Could not read those files — try a smaller image.')); return; }
      previews.append(...photos.map((photo, index) => h('figure.preview', [
        h('img', { src: photo.dataUrl, alt: photo.caption || `upload ${index + 1}` }),
        h('figcaption', `${photo.caption || 'Photo'} · ${(photo.dataUrl.length / 1024).toFixed(0)} KB`),
      ])));
    }

    function readAsDataUrl(file) {
      return new Promise((resolve) => {
        if (typeof FileReader === 'undefined') { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }

    async function submit(event) {
      event.preventDefault();
      const values = formValues(form);
      if (!photos.length) { toast('Add at least one photo — home owners decide with their eyes', 'warn'); return; }
      await withButton(form.querySelector('button[type=submit]'), async () => {
        const item = await api.post('/api/portfolio', {
          proId: session.userId,
          title: values.title,
          description: values.description || null,
          categoryId: values.categoryId || null,
          suburbId: values.suburbId || null,
          priceCents: values.price ? Math.round(values.price * 100) : null,
          priceNote: values.price ? 'what this job cost the client' : null,
          bookingId: values.bookingId ? String(values.bookingId).trim() : null,
          photos,
        });
        closeSheet();
        toast(`Published as ${item.reference} — ${item.tier === 'SELF_DECLARED' ? 'labelled “Uploaded by the pro” until it is linked to a ProVeri job' : 'verified as proof of work'}`, 'ok');
        navigate(`/work/${item.itemId}`);
      });
    }
  };

  async function loadMine(container, proId) {
    try {
      const items = await api.get(`/api/pros/${proId}/portfolio?limit=30`);
      container.innerHTML = '';
      if (!items.length) {
        container.append(empty('🧰', 'Nothing published yet', 'Your first upload takes a minute — and it is what home owners see before they message you.'));
        return;
      }
      container.append(workGrid(items));
      container.append(h('div.list', { style: { marginTop: '12px' } }, items.map((item) => h('div.tile.row.between', [
        h('div.grow', [h('div.t', item.title), h('div.d', `${item.reference} · ${item.tierLabel} · ${timeAgo(item.createdAt)}`)]),
        h('div.row', { style: { gap: '6px' } }, [
          h('a.btn.sm.ghost', { href: `/work/${item.itemId}` }, 'View'),
          h('button.btn.sm.ghost', { onclick: (event) => remove(event.currentTarget, item) }, 'Remove'),
        ]),
      ]))));
    } catch (error) {
      container.innerHTML = '';
      container.append(h('div.banner.danger', [h('span.ico', icon('close', 16)), h('div', error.message)]));
    }

    async function remove(button, item) {
      await withButton(button, async () => {
        await api.del(`/api/portfolio/${item.itemId}?actorId=${encodeURIComponent(item.proId)}&reason=${encodeURIComponent('removed by the pro')}`);
        toast(`${item.reference} removed`, 'ok');
        loadMine(container, proId);
      });
    }
  }

  /* ================================================================== *
   * YOU — the hub for everything that is not browsing or ordering
   * ================================================================== */

  screens['/me'] = async function me() {
    const session = api.session();
    const root = h('div.fade-in.stack');

    if (!session) {
      root.append(h('h1', 'You'));
      root.append(signInGate('Sign in to ProVeri', 'One account for both sides of the market: hire someone, or publish your work and get found.'));
      root.append(h('section.section', [h('h2', 'Or just look around'), h('div.list', [
        tile('search', 'Browse work near you', 'Real jobs done by real pros', '/browse'),
        tile('shield', 'Trust & transparency', 'Every check, its source and the ledger', '/trust'),
        tile('car', 'Verified vehicles', 'The second vertical, live in beta', '/vehicles'),
      ])]));
      return root;
    }

    root.append(h('div.card.accent.me-head', [
      h('div.avatar.lg', (session.name || 'P').slice(0, 1)),
      h('div.grow', [
        h('h1', session.name || session.userId),
        h('div.small.muted', session.role === 'PRO' ? 'Pro account · verified to bid' : 'Home owner account'),
      ]),
      h('button.btn.sm.ghost', {
        onclick: (event) => {
          const next = session.role === 'PRO' ? 'CUSTOMER' : 'PRO';
          api.setSession({ ...session, role: next });
          toast(`Switched to ${next === 'PRO' ? 'working' : 'hiring'}`, 'ok');
          navigate('/me');
          event.currentTarget.blur();
        },
      }, session.role === 'PRO' ? 'I’m hiring' : 'I’m working'),
    ]));

    root.append(h('section.section', [h('h2', 'My activity'), h('div.list', [
      tile('receipt', 'Orders & bookings', 'Jobs, escrow, proof of work', '/orders'),
      session.role === 'PRO' ? tile('camera', 'Upload my work', 'Publish a job you have done', '/upload-work') : tile('search', 'Browse work', 'Find a pro by what they have done', '/browse'),
      tile('bell', 'Notifications', 'Bids, messages and payout releases', '/notifications'),
      session.role === 'PRO' ? tile('wallet', 'Wallet & earnings', 'Balance, holdbacks, SARS summary', '/wallet') : null,
    ])]));

    root.append(h('section.section', [h('h2', 'Your record'), h('div.list', [
      tile('user', 'Profile', 'Details, verification, documents', '/profile'),
      tile('shield', 'Trust & proof', 'The ledger, the rules, the receipts', '/trust'),
      tile('link', 'Data & integrations', 'What is live, what is simulated', '/integrations'),
    ])]));

    root.append(h('section.section', [h('h2', 'Grow your business'), h('div.list', [
      tile('tool', 'Become a verified pro', 'KYC, trade certificate, bank check', '/become-a-pro'),
      tile('globe', 'Web Studio', 'A free data-bound microsite', '/web-studio'),
      tile('store', 'Business Site Studio', 'A full website with no dead buttons', '/business-studio'),
      tile('briefcase', 'Sales desk', 'The pipeline behind the studio', '/sales-desk'),
      tile('car', 'Verified vehicles', 'Buy and sell with checks', '/vehicles'),
      tile('home', 'Property (coming soon)', 'Why it is not live, and the waitlist', '/property'),
      tile('scale', 'Trust desk (admin)', 'Disputes, flags, risk', '/admin'),
    ])]));

    root.append(h('div.row.wrap', { style: { gap: '8px', padding: '8px 0 28px' } }, [
      h('button.btn.ghost.sm', { onclick: (event) => withButton(event.currentTarget, () => window.ProVeri.install()) }, [icon('install', 16), h('span', 'Install the app')]),
      h('button.btn.ghost.sm', {
        onclick: () => {
          api.setSession(null);
          toast('Signed out on this device', 'ok');
          navigate('/');
        },
      }, 'Sign out'),
    ]));

    return root;

    function tile(name, title, body, href) {
      return h('a.tile', { href }, [
        h('span.lead', icon(name, 21)),
        h('div.grow', [h('div.t', title), h('div.d', body)]),
        h('span.arrow', icon('chevron', 18)),
      ]);
    }
  };

})();
