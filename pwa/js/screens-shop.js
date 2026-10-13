/* ==========================================================================
   ProVeri PWA — the storefront

   /              home: what we do, how to start, real work, real pros
   /browse        explore the work feed (search understands "leaking geyser")
   /work/:itemId  one piece of work, photo first, with the truth about its badge
   /orders        your jobs (homeowner) · leads & jobs (pro)
   /order/:id     the job tracker (shared with /booking/:id)
   /post-job      three short steps, account creation folded into the last one
   /upload-work   a pro adds past work
   /me            account, settings and the rest of the platform

   Copy rules: say what happens to the person, not what the system does.
   No status codes on screen. Every screen has one obvious next step.
   ========================================================================== */

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const ui = window.ProVeri.ui;
  const {
    h, icon, money, timeAgo, toast, sheet, closeSheet, navigate, avatar, tradeIcon, tradeName, rating,
    withButton, formValues, shortName, firstName, plural, photoImg,
  } = ui;
  window.ProVeri.screens = window.ProVeri.screens || {};
  const screens = window.ProVeri.screens;
  const account = () => window.ProVeri.account;

  const POPULAR = ['plumbing', 'electrical', 'painting', 'handyman', 'solar-inverter', 'cleaning-home', 'gardening', 'roofing-gutters'];

  const categories = () => api.state.bundle?.catalog?.categories || [];
  const categoryById = (id) => categories().find((c) => c.id === id) || null;
  const metros = () => api.state.bundle?.catalog?.metros || [];

  /* ------------------------------------------------------------------ *
   * shared pieces
   * ------------------------------------------------------------------ */

  function workCard(item, opts) {
    const options = opts || {};
    const src = item.photo && (item.photo.url || item.photo.dataUrl);
    const approved = item.tier === 'CLIENT_CONFIRMED';
    return h('a.work-card' + (options.mini ? '.mini' : ''), { href: `/work/${item.itemId}` }, [
      h('div.wc-media', [
        src ? photoImg(src, item.title) : h('div.sealed-media', [icon('lock', 22), h('span', 'Photo sealed on record')]),
        item.verified ? h('span.wc-badge' + (approved ? '.gold' : ''), { title: approved ? 'Verified job, approved by the homeowner' : 'Verified job on ProVeri' }, [icon('verified', 15), 'Verified job']) : null,
        item.illustrative ? h('span.wc-demo', 'Demo photo') : null,
      ]),
      h('div.wc-body', [
        h('div.wc-title', item.title),
        h('div.wc-meta', [item.priceCents ? h('b', money(item.priceCents)) : null, item.priceCents ? ' · ' : null, item.suburb || item.metro || item.categoryLabel || '']),
        options.hidePro ? null : h('div.wc-pro', [
          avatar(item.proName || 'Pro', 'xs'),
          h('span.name', shortName(item.proName || 'Local pro')),
          item.proRating ? rating(item.proRating) : null,
        ]),
      ]),
    ]);
  }

  function proCard(pro) {
    const cat = categories().find((c) => c.label === pro.primaryCategoryLabel);
    return h('a.pro-card', { href: `/pro/${pro.proId}` }, [
      h('div.pc-top', [
        avatar(pro.name, 'lg'),
        h('div.grow', [
          h('div.pc-name', pro.name),
          h('div.pc-trade', `${pro.primaryCategoryLabel}${pro.suburb ? ` · ${pro.suburb}` : ''}`),
        ]),
      ]),
      h('div.pc-facts', [
        rating(pro.averageRating, pro.reviewCount),
        pro.completedJobs ? h('span', `${pro.completedJobs} jobs`) : null,
        pro.responseMedianMinutes ? h('span', [icon('clock', 14), ` replies in ~${pro.responseMedianMinutes} min`]) : null,
      ]),
      h('div.row.wrap', { style: { gap: '6px' } }, [
        ui.badge(ui.badgeText(pro.badge), /ELITE/.test(pro.badge) ? 'elite' : 'verified', /ELITE/.test(pro.badge) ? 'crown' : 'verified'),
        pro.insured ? ui.badge('Insured', 'neutral', 'shield') : null,
        cat ? null : null,
      ]),
    ]);
  }

  function siteFooter() {
    return h('footer.site-footer', [
      h('div.cols', [
        h('div', [
          h('a.brand', { href: '/', style: { marginBottom: '10px' } }, [h('span.word', [h('b', 'Pro'), h('span', 'Veri')])]),
          h('p', { style: { maxWidth: '36ch' } }, 'In South Africa, for South Africa. Verified local pros, real proof of work and payments that wait for your approval.'),
        ]),
        h('div', [h('h4', 'Homeowners'), h('a', { href: '/post-job' }, 'Post a job'), h('a', { href: '/browse' }, 'Explore work'), h('a', { href: '/find-a-pro' }, 'Find a pro'), h('a', { href: '/trust' }, 'How we protect you')]),
        h('div', [h('h4', 'Pros'), h('a', { href: '/become-a-pro' }, 'Join as a pro'), h('a', { href: '/upload-work' }, 'Add your work'), h('a', { href: '/web-studio' }, 'Free website')]),
        h('div', [h('h4', 'More'), h('a', { href: '/business-studio' }, 'Business sites'), h('a', { href: '/vehicles' }, 'Verified vehicles'), h('a', { href: '/integrations' }, 'Data & integrations')]),
      ]),
      h('div.fine', [h('span', `© ${new Date().getFullYear()} ProVeri`), ui.flagZA(), h('span', 'Payments held in escrow by registered partners · POPIA-aligned')]),
    ]);
  }
  window.ProVeri.siteFooter = siteFooter;
  window.ProVeri.workCard = workCard;
  window.ProVeri.proCard = proCard;

  function allTradesSheet(hrefFor, onPick) {
    const groups = new Map();
    for (const c of categories()) {
      const key = c.groupLabel || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    sheet('All services', h('div.stack.lg', [...groups.entries()].map(([label, list]) => h('div', [
      h('div.group-label', { style: { marginTop: 0 } }, label),
      h('div.trade-list', list.map((c) => (onPick
        ? h('button.tile', { type: 'button', onclick: () => { closeSheet(); onPick(c.id); } }, [tradeIcon(c.id, 'sm'), h('div.body', h('div.t', tradeName(c.id, c.label)))])
        : h('a.tile', { href: hrefFor(c.id), onclick: () => closeSheet() }, [tradeIcon(c.id, 'sm'), h('div.body', h('div.t', tradeName(c.id, c.label)))])))),
    ]))), null, { sub: `${categories().length} trades and services, every pro verified` });
  }

  function searchForm(value, opts) {
    const options = opts || {};
    const input = h('input', { name: 'q', type: 'search', value: value || '', placeholder: options.placeholder || 'What do you need done?', 'aria-label': 'What do you need done?', autocomplete: 'off', enterkeyhint: 'search' });
    return h('form.search-bar' + (options.compact ? '.compact' : ''), {
      role: 'search',
      onsubmit: (event) => {
        event.preventDefault();
        const q = input.value.trim();
        navigate(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse');
      },
    }, [icon('search', 20), input, h('button.btn', { type: 'submit' }, options.button || 'Search')]);
  }

  /* ------------------------------------------------------------------ *
   * /  — home
   * ------------------------------------------------------------------ */

  screens['/'] = async (ctx) => {
    const session = api.session();
    if (session && session.role === 'PRO' && window.ProVeri.proHome) return window.ProVeri.proHome(ctx);

    const page = h('div.page');
    const feedGrid = h('div.work-grid', ui.skeletonItems(4, 'grid'));
    const heroArt = h('div.hero-art', { 'aria-hidden': 'true' });

    // 1 — the promise, and the one thing to do about it.
    const greeting = session
      ? h('div', [h('span.eyebrow-pill', [ui.flagZA(), `Welcome back, ${firstName(session.name)}`])])
      : h('span.eyebrow-pill', [ui.flagZA(), 'Verified local pros across South Africa']);
    // Returning homeowners already know the promise: give them the search and
    // their next step, not the pitch.
    page.append(h('section.hero-home' + (session ? '.compact' : ''), [
      h('div', [
        greeting,
        session ? h('h1', ['What needs ', h('em', 'doing?')]) : h('h1', ['Hire a pro ', h('em', 'with proof.')]),
        session ? null : h('p.sub', 'See real jobs done near you, compare quotes from ID-verified pros, and only release payment when you are happy with the work.'),
        searchForm('', { placeholder: 'e.g. leaking geyser', button: 'Search' }),
        h('div.chip-row', POPULAR.slice(0, 6).map((id) => h('a.chip', { href: `/browse?category=${id}` }, [icon('t-' + id, 16), tradeName(id)]))),
        session ? null : h('div.hero-trust', [
          h('span', [icon('verified', 16), 'ID-checked pros']),
          h('span', [icon('lock', 16), 'Money held until you approve']),
          h('span', [icon('camera', 16), 'Real job photos']),
        ]),
      ]),
      heroArt,
    ]));

    // 2 — your next step, if you have one in flight.
    const nextSlot = h('div');
    page.append(nextSlot);
    if (session) fillNextStep(nextSlot, session);

    // 3 — services, one tap away.
    page.append(h('section.section', [
      h('div.section-head', [h('div', h('h2', 'Popular services')), h('button.link', { type: 'button', onclick: () => allTradesSheet((id) => `/browse?category=${id}`) }, ['All services', icon('chevron', 16)])]),
      h('div.trades', [
        ...POPULAR.slice(0, 7).map((id) => h('a.trade', { href: `/browse?category=${id}` }, [tradeIcon(id), tradeName(id)])),
        h('button.trade.all', { type: 'button', onclick: () => allTradesSheet((id) => `/browse?category=${id}`) }, [h('span.trade-ico', icon('grid', 22)), 'All services']),
      ]),
    ]));

    // 4 — the work itself.
    page.append(h('section.section', [
      ui.sectionHead('Work done near you', 'Explore all', '/browse', 'Every “Verified job” badge is backed by an escrow-released job on ProVeri — pros cannot buy it.'),
      feedGrid,
    ]));

    // 5 — how it works, in three sentences.
    page.append(h('section.section', [
      ui.sectionHead('How ProVeri works', 'How we protect you', '/trust'),
      h('div.steps-strip', [
        howStep(1, 'clipboard-check', 'Post your job for free', 'Say what needs doing. We send it to verified pros nearby — no calls, no chasing.'),
        howStep(2, 'quote', 'Compare real quotes', 'See each pro’s past work, reviews and price side by side. Message before you decide.'),
        howStep(3, 'lock', 'Pay safely, approve, done', 'Your money waits in escrow. The pro is paid only when you approve the finished job.'),
      ]),
    ]));

    // 6 — the pros.
    const prosRail = h('div.rail', [h('div.skeleton.card'), h('div.skeleton.card')]);
    page.append(h('section.section', [ui.sectionHead('Top-rated pros', 'Find a pro', '/find-a-pro'), prosRail]));

    // 7 — the other side of the market, once.
    page.append(h('section.section', h('div.pro-band', [
      h('div', [
        h('div.kicker', [icon('briefcase', 15), 'For tradespeople']),
        h('h2', 'Your best work is your best advert.'),
        h('p', 'Show the jobs you have done, get enquiries from homeowners nearby and get paid through ProVeri the moment work is approved.'),
        h('div.pb-points', [h('span', [icon('check', 16), 'No lead fees']), h('span', [icon('check', 16), '10% only when you win']), h('span', [icon('check', 16), 'Free website'])]),
      ]),
      h('div.btn-row', [
        h('a.btn.gold.lg', { href: '/become-a-pro' }, 'Join as a pro'),
        h('a.btn.on-dark.ghost.lg', { href: '/upload-work' }, 'Add your work'),
      ]),
    ])));

    page.append(siteFooter());

    // Data after first paint.
    loadFeed(feedGrid, heroArt, session);
    api.get('/api/pros').then((rows) => {
      prosRail.innerHTML = '';
      const top = (Array.isArray(rows) ? rows : []).filter((p) => p.averageRating).sort((a, b) => (b.averageRating * Math.log(2 + b.completedJobs)) - (a.averageRating * Math.log(2 + a.completedJobs))).slice(0, 8);
      if (!top.length) prosRail.append(h('p.muted', 'Verified pros appear here as they join.'));
      top.forEach((p) => prosRail.append(proCard(p)));
    }).catch(() => { prosRail.innerHTML = ''; prosRail.append(h('p.muted', 'Could not load pros right now.')); });

    return page;
  };

  function howStep(n, iconName, title, text) {
    return h('div.how-step', [h('span.hs-n', String(n)), h('div.hs-ico', icon(iconName, 24)), h('h3', title), h('p', text)]);
  }

  async function loadFeed(grid, heroArt, session) {
    let items = [];
    try {
      items = await api.get('/api/portfolio?limit=12&sort=verified');
    } catch { /* offline */ }
    grid.innerHTML = '';
    if (!items.length) {
      grid.append(h('div', { style: { gridColumn: '1 / -1' } }, ui.empty('images', 'Work will appear here', 'As pros complete jobs on ProVeri their work shows up near you.')));
      return;
    }
    items.slice(0, 8).forEach((item) => grid.append(workCard(item)));
    const withPhotos = items.filter((i) => i.photo && i.photo.url && i.verified).slice(0, 3);
    if (heroArt && withPhotos.length >= 3) {
      heroArt.append(
        ...withPhotos.map((item) => h('div.ha-card', photoImg(item.photo.url, ''))),
        h('div.ha-chip.one', [h('span.ic', icon('verified', 20)), h('div', ['Verified job', h('small', `${withPhotos[0].suburb || 'Near you'} · ${money(withPhotos[0].priceCents)}`)])]),
        h('div.ha-chip.two', [h('span.ic', icon('lock', 20)), h('div', ['Paid safely', h('small', 'Released on approval')])]),
      );
    }
    void session;
  }

  /** The one thing a signed-in homeowner should do next, lifted to the top. */
  async function fillNextStep(slot, session) {
    try {
      const [jobs, bookings] = await Promise.all([
        api.get(`/api/jobs?customerId=${encodeURIComponent(session.userId)}`),
        api.get(`/api/bookings?customerId=${encodeURIComponent(session.userId)}`),
      ]);
      const action = nextActionFor(jobs || [], bookings || []);
      if (!action) return;
      slot.append(h('section.section.tight', h('a.order-card', { href: action.href }, [
        h('div.oc-top', [
          tradeIcon(action.categoryId),
          h('div.grow', [h('div.oc-title', action.title), h('div.oc-sub', action.sub), h('div.oc-status', ui.statusPill(action.words))]),
        ]),
        h('div.oc-next' + (action.urgent ? '.action' : ''), [icon(action.icon, 18), h('span.grow', action.cta), icon('chevron', 18)]),
      ])));
    } catch { /* optional */ }
  }

  function nextActionFor(jobs, bookings) {
    const byPriority = [];
    for (const b of bookings) {
      const words = ui.bookingWords(b.status);
      if (b.status === 'AWARDED') byPriority.push({ p: 1, href: `/order/${b.bookingId}`, title: b.title, sub: `with ${b.proName}`, words, cta: `Pay ${money(b.totalCents)} to confirm the booking`, icon: 'lock', urgent: true, categoryId: b.categoryId });
      else if (b.status === 'AWAITING_CONFIRMATION') byPriority.push({ p: 0, href: `/order/${b.bookingId}`, title: b.title, sub: `${b.proName} says it is done`, words, cta: 'Check the work and approve payment', icon: 'check-circle', urgent: true, categoryId: b.categoryId });
      else if (['SCHEDULED', 'EN_ROUTE'].includes(b.status)) byPriority.push({ p: 2, href: `/order/${b.bookingId}`, title: b.title, sub: `${b.proName} · ${ui.relDay(b.scheduledAt)}`, words, cta: 'When they arrive, check their arrival code', icon: 'key', categoryId: b.categoryId });
    }
    for (const j of jobs) {
      if (j.bookingId) continue;
      if (j.status === 'BIDDING' || ((j.status === 'OPEN') && j.bidCount)) byPriority.push({ p: 1, href: `/job/${j.jobId}`, title: j.title, sub: `${j.suburb || ''} · posted ${timeAgo(j.postedAt)}`, words: ui.jobWords(j.status, j.bidCount), cta: `Compare ${plural(j.bidCount, 'quote')}`, icon: 'quote', urgent: true, categoryId: j.categoryId });
      else if (j.status === 'OPEN') byPriority.push({ p: 3, href: `/job/${j.jobId}`, title: j.title, sub: `posted ${timeAgo(j.postedAt)}`, words: ui.jobWords(j.status, 0), cta: 'Waiting for quotes from pros nearby', icon: 'hourglass', categoryId: j.categoryId });
    }
    byPriority.sort((a, b) => a.p - b.p);
    return byPriority[0] || null;
  }
  window.ProVeri.nextActionFor = nextActionFor;

  /* ------------------------------------------------------------------ *
   * /browse — explore the work
   * ------------------------------------------------------------------ */

  screens['/browse'] = async ({ query }) => {
    const page = h('div.page');
    const state = {
      q: query.q || '',
      category: query.category || '',
      area: query.area || '',
      sort: query.sort || 'verified',
      verified: query.verified === 'true',
      limit: 24,
    };

    const countLine = h('p.page-sub', 'Loading work…');
    page.append(h('div.page-head', h('div.titles', [h('h1', state.category ? tradeName(state.category, categoryById(state.category)?.label) : 'Explore work'), countLine])));
    page.append(searchForm(state.q, { compact: true, placeholder: 'Search, e.g. bathroom', button: 'Go' }));

    const smart = h('div', { style: { marginTop: '14px' } });
    const chips = h('div.chip-row', { style: { marginTop: '14px' } });
    const filters = h('div.filters.row', { style: { marginTop: '12px', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '2px' } });
    const grid = h('div.work-grid', { style: { marginTop: '18px' } }, ui.skeletonItems(6, 'grid'));
    const more = h('div.center', { style: { marginTop: '22px' } });
    page.append(smart, chips, filters, grid, more);

    // Chips: all, verified only, then the popular trades.
    const chip = (label, active, onclick, iconName) => h('button.chip' + (active ? '.active' : ''), { type: 'button', onclick }, [iconName ? icon(iconName, 16) : null, label]);
    const paintChips = () => {
      chips.innerHTML = '';
      chips.append(
        chip('All work', !state.verified && !state.category, () => { state.verified = false; state.category = ''; sync(); }),
        chip('Verified jobs only', state.verified, () => { state.verified = !state.verified; sync(); }, 'verified'),
        ...POPULAR.map((id) => chip(tradeName(id), state.category === id, () => { state.category = state.category === id ? '' : id; sync(); }, 't-' + id)),
      );
    };

    const select = (name, options, value, label) => h('select', {
      name, 'aria-label': label, style: { width: 'auto', flex: 'none', height: '40px', borderRadius: '12px', fontSize: '14px', fontWeight: '650', paddingLeft: '12px', paddingRight: '34px', backgroundPosition: 'right 10px center' },
      onchange: (event) => { state[name] = event.target.value; sync(); },
    }, options.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null }, l)));
    const paintFilters = () => {
      filters.innerHTML = '';
      filters.append(
        select('category', [['', 'All services'], ...categories().map((c) => [c.id, tradeName(c.id, c.label)]).sort((a, b) => a[1].localeCompare(b[1]))], state.category, 'Service'),
        select('area', [['', 'All areas'], ...metros().map((m) => [m.name, m.name])], state.area, 'Area'),
        select('sort', [['verified', 'Verified first'], ['recent', 'Newest'], ['rating', 'Top-rated pros']], state.sort, 'Sort'),
      );
    };

    const sync = () => {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.category) params.set('category', state.category);
      if (state.area) params.set('area', state.area);
      if (state.sort !== 'verified') params.set('sort', state.sort);
      if (state.verified) params.set('verified', 'true');
      history.replaceState(history.state, '', `/browse${params.toString() ? `?${params}` : ''}`);
      const title = page.querySelector('h1');
      if (title) title.textContent = state.category ? tradeName(state.category, categoryById(state.category)?.label) : 'Explore work';
      paintChips();
      paintFilters();
      load();
    };

    // Search understands jobs, not just titles: "leaking geyser" → plumbing.
    let resolved = null;
    if (state.q && !state.category) {
      try {
        const r = await api.post('/api/catalogue/resolve', { text: state.q });
        if (r.resolution && r.resolution.matched) resolved = r.resolution;
      } catch { /* plain search */ }
    }
    const paintSmart = () => {
      smart.innerHTML = '';
      const id = state.category || (resolved && resolved.categoryId);
      if (!id) return;
      const cat = categoryById(id);
      smart.append(h('div.card.accent.pad-sm', h('div.row', [
        tradeIcon(id),
        h('div.grow', [
          h('div.strong', (() => {
            const who = ((cat && cat.label) || tradeName(id)).toLowerCase();
            const what = tradeName(id).toLowerCase();
            const an = (w) => (/^[aeiou]/.test(w) ? 'an' : 'a');
            return state.q && resolved ? `Sounds like a job for ${an(who)} ${who}` : `Need ${an(what)} ${what} pro?`;
          })()),
          h('div.small.muted', 'Post it once and verified pros nearby send you quotes. Free, no obligation.'),
        ]),
        h('a.btn.sm', { href: `/post-job?category=${id}${state.q ? `&description=${encodeURIComponent(state.q)}` : ''}` }, 'Get quotes'),
      ])));
    };

    async function load() {
      grid.innerHTML = '';
      ui.skeletonItems(6, 'grid').forEach((c) => grid.append(c));
      paintSmart();
      const params = new URLSearchParams({ limit: String(state.limit), sort: state.sort });
      const category = state.category || (resolved && resolved.categoryId) || '';
      if (category) params.set('categoryId', category);
      else if (state.q) params.set('q', state.q);
      if (state.area) params.set('metro', state.area);
      if (state.verified) params.set('verified', 'true');
      let items = [];
      try { items = await api.get(`/api/portfolio?${params}`); } catch (e) { grid.innerHTML = ''; grid.append(h('div', { style: { gridColumn: '1 / -1' } }, ui.empty('offline', 'Could not load work', ui.friendlyError(e)))); return; }
      grid.innerHTML = '';
      const proven = items.filter((i) => i.verified).length;
      countLine.textContent = items.length
        ? `${plural(items.length, 'job')} by local pros · ${proven} proven on ProVeri`
        : 'Nothing here yet — 0 proven on ProVeri for this search';
      if (!items.length) {
        grid.append(h('div', { style: { gridColumn: '1 / -1' } }, ui.empty('search', 'No work matches yet', 'Pros are joining every week. Post your job anyway — verified pros nearby will still quote.',
          h('a.btn', { href: `/post-job${category ? `?category=${category}` : ''}` }, 'Post a job — free'))));
        more.innerHTML = '';
        return;
      }
      items.forEach((item) => grid.append(workCard(item)));
      more.innerHTML = '';
      if (items.length >= state.limit) more.append(h('button.btn.ghost', { type: 'button', onclick: () => { state.limit += 24; load(); } }, 'Show more work'));
    }

    paintChips();
    paintFilters();
    load();
    return page;
  };

  /* ------------------------------------------------------------------ *
   * /work/:itemId — one piece of work
   * ------------------------------------------------------------------ */

  screens['/work/:itemId'] = async ({ params }) => {
    const item = await api.get(`/api/portfolio/${encodeURIComponent(params.itemId)}`);
    const session = api.session();
    const pro = item.pro || {};
    const isOwner = session && session.userId === item.proId;
    const verified = item.tier !== 'SELF_DECLARED';
    const photos = (item.photos || []).filter((p) => p.url || p.dataUrl);
    const page = h('div.page');

    // Gallery first: the work is the product.
    const strip = h('div.photo-strip', photos.length
      ? photos.map((p, i) => h('figure.photo', [photoImg(p.url || p.dataUrl, p.caption || item.title, { loading: i ? 'lazy' : 'eager' })]))
      : [h('figure.photo.sealed', h('div.sealed-media', [icon('lock', 30), h('span', 'Photo sealed on record'), h('span', { style: { fontWeight: 500, opacity: 0.75 } }, 'The pro’s photo is fingerprinted, but not published.'), (item.photos || [])[0] && (item.photos || [])[0].hash ? h('code', `#${String((item.photos || [])[0].hash).slice(0, 12)}`) : null]))]);
    const counter = photos.length > 1 ? h('span.g-count', `1 / ${photos.length}`) : null;
    if (counter) {
      strip.addEventListener('scroll', () => {
        const index = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
        counter.textContent = `${index + 1} / ${photos.length}`;
      }, { passive: true });
    }
    const gallery = h('div.gallery', [
      strip,
      h('div.g-back', h('button.icon-btn.solid', { type: 'button', 'aria-label': 'Back', onclick: () => (history.state && history.state.app ? history.back() : navigate('/browse')) }, icon('arrow-left', 20))),
      h('div.g-actions', h('button.icon-btn.solid', { type: 'button', 'aria-label': 'Share', onclick: () => ui.share({ title: item.title, text: `${item.title} — on ProVeri`, url: location.href }) }, icon('share', 19))),
      photos.some((p) => p.illustrative) ? h('span.g-demo', 'Demo photo') : null,
      counter,
    ]);

    const statement = item.verification || { lines: [] };
    const trustCard = verified
      ? h('div.card.accent', [
        h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, [
          h('span.lead', { style: { width: '40px', height: '40px', borderRadius: '12px', background: 'var(--brand)', color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' } }, icon('verified', 22)),
          h('div.grow', [
            h('div.strong', item.tier === 'CLIENT_CONFIRMED' ? 'Verified job · homeowner approved' : 'Verified job'),
            h('div.small.muted', statement.label || ''),
          ]),
        ]),
        h('div.trust-points', { style: { marginTop: '14px' } }, (statement.lines || []).map((line) => h('div.trust-point', [h('span.tp-ico', icon('check', 16)), h('span', line)]))),
        item.ledgerSeal ? h('details.fold', { style: { marginTop: '14px', background: 'transparent', border: '0' } }, [
          h('summary', { style: { padding: '6px 0' } }, [icon('fingerprint', 18), h('span.small', 'Tamper-proof record')]),
          h('div.fold-body', { style: { padding: '0' } }, [
            h('p.small.muted', 'Every verified job is written to ProVeri’s audit ledger. Change one detail and the seal no longer matches.'),
            h('p.small', h('code', `Ledger seal ${String(item.ledgerSeal).slice(0, 16)}`)),
          ]),
        ]) : null,
      ])
      : h('div.card.flat', [
        h('div.row', { style: { gap: '10px' } }, [
          h('span.lead', { style: { width: '40px', height: '40px', borderRadius: '12px', background: 'var(--surface-3)', color: 'var(--ink-2)', display: 'grid', placeItems: 'center', flex: 'none' } }, icon('upload', 20)),
          h('div.grow', [h('div.strong', 'Uploaded by the pro'), h('div.small.muted', 'Not yet backed by a job on ProVeri')]),
        ]),
        h('div.trust-points', { style: { marginTop: '12px' } }, (statement.lines || []).map((line) => h('div.trust-point.plain', [h('span.tp-ico', icon('info', 16)), h('span', line)]))),
      ]);

    const proRow = h('a.pro-row.tile', { href: `/pro/${item.proId}` }, [
      avatar(pro.name || 'Pro', 'lg'),
      h('div.body', [
        h('div.t', pro.name || 'Local pro'),
        h('div.d', [pro.completedJobs ? `${pro.completedJobs} jobs done` : 'New on ProVeri', pro.suburb ? ` · ${pro.suburb}` : '']),
        h('div.row', { style: { gap: '8px', marginTop: '6px' } }, [rating(pro.rating), pro.badge ? ui.badge(ui.badgeText(pro.badge), /ELITE/.test(pro.badge) ? 'elite' : /VERIFIED/.test(pro.badge) ? 'verified' : 'neutral') : null]),
      ]),
      h('span.meta', icon('chevron', 20)),
    ]);

    const proFirst = firstName(pro.name) || 'the pro';
    const cta = isOwner
      ? h('div.cta-bar.desktop-inline', h('div.cta-inner', [
        h('button.btn.ghost.grow', { type: 'button', onclick: () => ui.share({ title: item.title, url: location.href }) }, [icon('share', 18), 'Share']),
        h('a.btn.grow', { href: '/upload-work' }, [icon('plus', 18), 'Add more work']),
      ]))
      : h('div.cta-bar.desktop-inline', h('div.cta-inner', [
        h('button.btn.ghost.grow', { type: 'button', onclick: () => messageAbout(item) }, [icon('chat', 18), `Message ${proFirst}`]),
        h('a.btn.grow', { href: `/post-job?proId=${encodeURIComponent(item.proId)}&category=${encodeURIComponent(item.categoryId || '')}&from=${encodeURIComponent(item.itemId)}` }, `Get a quote`),
      ]));

    const facts = h('div.detail-meta', [
      h('span', [icon('t-' + (item.categoryId || ''), 16), item.categoryLabel || 'Service']),
      item.suburb ? h('span', [icon('pin', 16), item.suburb]) : null,
      item.completedAt ? h('span', [icon('calendar', 16), `Done ${ui.dateShort(item.completedAt)}`]) : null,
    ]);

    const main = h('div', [
      gallery,
      h('div.detail-title', [h('h1', item.title), facts]),
      item.priceCents ? h('div.price-block', [h('span.money', money(item.priceCents)), h('span.muted.small', item.priceNote ? `· ${item.priceNote}` : '· what the homeowner paid')]) : null,
      item.description ? h('div.section.tight', [h('h3', 'About this job'), h('p.muted', { style: { marginTop: '8px', whiteSpace: 'pre-line' } }, item.description)]) : null,
      item.review ? h('div.section.tight.card', [h('div.row', [ui.starRow(item.rating), h('span.small.muted', 'Homeowner review')]), h('p', { style: { marginTop: '8px' } }, `“${item.review}”`)]) : null,
    ]);
    const side = h('div.side-card.stack', [trustCard, proRow, cta]);
    page.append(h('div.detail-grid', { style: { marginTop: '0' } }, [main, side]));

    const moreBox = h('div.section');
    page.append(moreBox);
    api.get(`/api/pros/${encodeURIComponent(item.proId)}/portfolio`).then((rows) => {
      const others = (rows || []).filter((r) => r.itemId !== item.itemId).slice(0, 4);
      if (!others.length) return;
      moreBox.append(ui.sectionHead(`More work by ${proFirst}`, 'See profile', `/pro/${item.proId}`), h('div.work-grid', others.map((o) => workCard(o, { mini: true, hidePro: true }))));
    }).catch(() => {});

    return page;
  };

  function messageAbout(item) {
    const session = api.session();
    const go = (s) => navigate(`/inbox/${encodeURIComponent(`work.${item.itemId}.${s.userId}`)}`);
    if (!session) return account().openSignIn({ reason: `Sign in to message ${firstName(item.pro && item.pro.name) || 'the pro'} — it takes a few seconds.`, onDone: go });
    if (session.userId === item.proId) return toast('This is your own work.', 'warn');
    go(session);
  }
  window.ProVeri.messageAbout = messageAbout;

  /* ------------------------------------------------------------------ *
   * /orders — your jobs (homeowner) · leads & jobs (pro)
   * ------------------------------------------------------------------ */

  screens['/orders'] = async ({ query }) => {
    const session = api.session();
    const page = h('div.page.mid');
    if (!session) {
      page.append(h('div.page-head', h('div.titles', h('h1', 'Your jobs'))));
      page.append(account().signInPanel({ title: 'Sign in to see your jobs', body: 'Track quotes, payments and progress for every job in one place.', iconName: 'jobs' }));
      return page;
    }
    if (session.role === 'PRO' && window.ProVeri.proJobs) return window.ProVeri.proJobs({ query });

    page.append(h('div.page-head', [h('div.titles', [h('h1', 'Your jobs'), h('p.page-sub', 'Everything you have posted and booked.')]), h('a.btn.sm.hide-mobile', { href: '/post-job' }, [icon('plus', 16), 'Post a job'])]));
    const seg = h('div.seg');
    const list = h('div.list', { style: { marginTop: '16px' } }, ui.skeletonItems(2, 'card'));
    page.append(seg, list);

    const [jobs, bookings] = await Promise.all([
      api.get(`/api/jobs?customerId=${encodeURIComponent(session.userId)}`).catch(() => []),
      api.get(`/api/bookings?customerId=${encodeURIComponent(session.userId)}`).catch(() => []),
    ]);
    const cards = orderCards(jobs || [], bookings || []);
    const active = cards.filter((c) => !c.past);
    const past = cards.filter((c) => c.past);
    const paint = (which) => {
      seg.innerHTML = '';
      seg.append(
        h('button' + (which === 'active' ? '.active' : ''), { type: 'button', onclick: () => paint('active') }, `Active · ${active.length}`),
        h('button' + (which === 'past' ? '.active' : ''), { type: 'button', onclick: () => paint('past') }, `Past · ${past.length}`),
      );
      list.innerHTML = '';
      const rows = which === 'active' ? active : past;
      if (!rows.length) {
        list.append(which === 'active'
          ? ui.empty('clipboard-check', 'No jobs yet', 'Post a job in about a minute and verified pros nearby will send you quotes.', h('div.btn-row', { style: { justifyContent: 'center' } }, [h('a.btn', { href: '/post-job' }, 'Post a job'), h('a.btn.ghost', { href: '/browse' }, 'Explore work')]))
          : ui.empty('history', 'Nothing finished yet', 'Completed jobs and their warranties will be kept here.'));
        return;
      }
      rows.forEach((c) => list.append(c.node));
    };
    paint(query.tab === 'past' ? 'past' : (active.length || !past.length ? 'active' : 'past'));
    return page;
  };

  /** One card per job: a posted job and its booking are the same thing to a homeowner. */
  function orderCards(jobs, bookings) {
    const byJob = new Map(bookings.map((b) => [b.jobId, b]));
    const used = new Set();
    const cards = [];
    for (const j of jobs) {
      const b = j.bookingId ? bookings.find((x) => x.bookingId === j.bookingId) : byJob.get(j.jobId);
      if (b) { used.add(b.bookingId); cards.push(bookingCard(b)); continue; }
      const words = ui.jobWords(j.status, j.bidCount);
      const past = ['CANCELLED', 'EXPIRED', 'COMPLETED'].includes(j.status);
      cards.push({
        at: j.postedAt,
        past,
        node: h('a.order-card', { href: `/job/${j.jobId}` }, [
          h('div.oc-top', [tradeIcon(j.categoryId), h('div.grow', [h('div.oc-title', j.title), h('div.oc-sub', `${j.suburb || ''}${j.suburb ? ' · ' : ''}posted ${timeAgo(j.postedAt)}`), h('div.oc-status', ui.statusPill(words))])]),
          ui.tracker(0),
          past ? null : h('div.oc-next' + (j.bidCount ? '.action' : ''), [icon(j.bidCount ? 'quote' : 'hourglass', 18), h('span.grow', j.bidCount ? `Compare ${plural(j.bidCount, 'quote')} and pick your pro` : 'Pros nearby have been told — quotes usually arrive within hours'), icon('chevron', 18)]),
        ]),
      });
    }
    for (const b of bookings) if (!used.has(b.bookingId)) cards.push(bookingCard(b));
    return cards.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  function bookingCard(b) {
    const words = ui.bookingWords(b.status);
    const past = ['CLOSED', 'CANCELLED', 'REFUNDED'].includes(b.status);
    const next = {
      AWARDED: ['lock', `Pay ${money(b.totalCents)} to confirm — held safely until you approve`, true],
      SCHEDULED: ['calendar', `Booked for ${ui.relDay(b.scheduledAt)} — check the pro’s arrival code at the door`, false],
      EN_ROUTE: ['navigation', `${b.proName} is on the way — have the booking screen ready`, true],
      ON_SITE: ['tool', 'Work is under way', false],
      STARTED: ['tool', 'Work is under way', false],
      IN_PROGRESS: ['tool', 'Work is under way', false],
      AWAITING_CONFIRMATION: ['check-circle', 'Check the finished work and approve payment', true],
      IN_WARRANTY: ['shield', b.reviewId ? `Covered by warranty until ${ui.dateShort(b.warrantyEndsAt)}` : 'How did it go? Leave a review', !b.reviewId],
      DISPUTED: ['alert', 'We are reviewing this job — your money is frozen safely', true],
    }[b.status];
    return {
      at: b.createdAt,
      past,
      node: h('a.order-card', { href: `/order/${b.bookingId}` }, [
        h('div.oc-top', [
          tradeIcon(b.categoryId),
          h('div.grow', [h('div.oc-title', b.title), h('div.oc-sub', `${b.proName} · ${money(b.totalCents)}`), h('div.oc-status', ui.statusPill(words))]),
        ]),
        ui.tracker(ui.bookingReached(b.status)),
        next ? h('div.oc-next' + (next[2] ? '.action' : ''), [icon(next[0], 18), h('span.grow', next[1]), icon('chevron', 18)]) : null,
      ]),
    };
  }
  window.ProVeri.bookingCard = bookingCard;

  screens['/order/:bookingId'] = async (ctx) => window.ProVeri.bookingTracker(ctx);

  /* ------------------------------------------------------------------ *
   * /post-job — three steps
   * ------------------------------------------------------------------ */

  const URGENCY = [
    { id: 'EMERGENCY', t: 'Emergency', d: 'Today, as soon as possible', icon: 'zap' },
    { id: 'URGENT', t: 'Within 2 days', d: 'Soon, but not an emergency', icon: 'timer' },
    { id: 'SOON', t: 'This week', d: 'Any day in the next 7 days', icon: 'calendar' },
    { id: 'FLEXIBLE', t: 'I’m flexible', d: 'Pick a time that suits the pro', icon: 'clock' },
  ];

  screens['/post-job'] = async ({ query }) => {
    const session = api.session();
    const page = h('div.page.narrow');
    if (session && session.role === 'PRO') {
      page.append(ui.backButton('/'), ui.empty('briefcase', 'You are signed in as a pro', 'Posting jobs is for homeowners. Switch to a homeowner account, or find jobs to quote on in Leads.',
        h('div.btn-row', { style: { justifyContent: 'center' } }, [h('a.btn', { href: '/orders' }, 'See my leads'), h('button.btn.ghost', { type: 'button', onclick: () => account().openSignIn({ title: 'Switch account' }) }, 'Switch account')])));
      return page;
    }

    let customer = null;
    if (session) customer = await api.get(`/api/customers/${encodeURIComponent(session.userId)}`).catch(() => null);
    const sharedText = query.description || query.text || sessionStorage.getItem('proveri.share-draft') || '';
    sessionStorage.removeItem('proveri.share-draft');

    const draft = {
      description: [query.title, sharedText].filter(Boolean).join(' — '),
      categoryId: query.category || '',
      detected: null,
      title: '',
      suburbId: (customer && customer.suburbId) || '',
      addressText: '',
      urgency: 'SOON',
      preferredDate: '',
      accessNotes: '',
      pets: false,
      budget: '',
      photos: [],
      proId: query.proId || '',
      from: query.from || '',
    };
    let invitedPro = null;
    if (draft.proId) api.get(`/api/pros/${encodeURIComponent(draft.proId)}`).then((p) => { invitedPro = p; paint(); }).catch(() => {});

    let step = 1;
    const stepper = h('div.stepper');
    const body = h('div');
    page.append(ui.backButton('/'), stepper, body);

    const paintStepper = () => {
      stepper.innerHTML = '';
      ['What', 'Where & when', 'Budget & post'].forEach((label, index) => {
        const n = index + 1;
        stepper.append(h('div.step-pill' + (n < step ? '.done' : n === step ? '.current' : ''), [
          h('span.bar', h('i')),
          h('span.lbl', [h('span.n', n < step ? icon('check', 12, { stroke: 3.2 }) : String(n)), label]),
        ]));
      });
    };

    const paint = () => {
      paintStepper();
      body.innerHTML = '';
      if (step === 1) body.append(stepWhat());
      if (step === 2) body.append(stepWhere());
      if (step === 3) body.append(stepBudget());
      window.scrollTo({ top: 0 });
    };

    /* ---- step 1: what ---- */
    function stepWhat() {
      const textarea = h('textarea', {
        name: 'description', rows: '5', required: true, maxlength: '2000',
        placeholder: 'e.g. Our geyser is leaking through the kitchen ceiling and needs replacing.',
      });
      textarea.value = draft.description;
      const error = h('div.field-error', { hidden: true });
      const detectedBox = h('div', { style: { marginTop: '14px' } });
      const ideas = h('div.chip-wrap', { style: { marginTop: '10px' } });

      const paintDetected = () => {
        detectedBox.innerHTML = '';
        ideas.innerHTML = '';
        const id = draft.categoryId || (draft.detected && draft.detected.categoryId);
        if (!id) {
          detectedBox.append(h('button.tile', { type: 'button', onclick: chooseTrade }, [h('span.lead.grey', icon('grid', 20)), h('div.body', [h('div.t', 'Choose a service'), h('div.d', 'Or keep typing and we will suggest one')]), h('span.meta', icon('chevron', 18))]));
          return;
        }
        const cat = categoryById(id);
        detectedBox.append(h('button.tile', { type: 'button', onclick: chooseTrade }, [
          tradeIcon(id),
          h('div.body', [h('div.d', draft.categoryId ? 'Service' : 'We think this is a job for'), h('div.t', cat ? cat.label : tradeName(id))]),
          h('span.meta', ['Change', icon('chevron', 18)]),
        ]));
        if (cat && cat.statutoryTrade) detectedBox.append(h('p.hint', [icon('shield', 14), ` By law this needs a registered pro. We only send it to pros whose ${cat.regulator && cat.regulator.body ? cat.regulator.body : 'trade'} registration is on file.`]));
        if (cat && (cat.commonJobs || []).length) {
          ideas.append(h('div.tiny.muted', { style: { width: '100%' } }, 'Common jobs — tap to use as the title'));
          cat.commonJobs.slice(0, 5).forEach((job) => ideas.append(h('button.chip.sm' + (draft.title === job ? '.active' : ''), { type: 'button', onclick: () => { draft.title = draft.title === job ? '' : job; paintDetected(); } }, job)));
        }
      };

      function chooseTrade() {
        allTradesSheet(null, (id) => {
          draft.categoryId = id;
          draft.title = '';
          paintDetected();
        });
      }

      let timer = null;
      textarea.addEventListener('input', () => {
        draft.description = textarea.value;
        error.hidden = true;
        clearTimeout(timer);
        if (draft.categoryId) return;
        timer = setTimeout(async () => {
          if (textarea.value.trim().length < 6) return;
          try {
            const r = await api.post('/api/catalogue/resolve', { text: textarea.value });
            draft.detected = r.resolution && r.resolution.matched ? r.resolution : null;
            paintDetected();
          } catch { /* offline: the server still detects on submit */ }
        }, 450);
      });
      paintDetected();

      const next = h('button.btn.block.lg', {
        type: 'button',
        onclick: () => {
          draft.description = textarea.value.trim();
          if (draft.description.length < 10) {
            error.textContent = 'Tell the pro a little more — what is wrong, and where?';
            error.hidden = false;
            textarea.setAttribute('aria-invalid', 'true');
            textarea.focus();
            return;
          }
          if (!draft.categoryId && !draft.detected) { chooseTrade(); toast('Pick the closest service so we can find the right pros.', 'warn'); return; }
          step = 2;
          paint();
        },
      }, ['Continue', icon('arrow', 18)]);

      return h('div.stack.lg', [
        h('div', [
          h('h1', { style: { fontSize: '28px' } }, invitedPro ? `What do you need ${firstName(invitedPro.displayName || invitedPro.name)} to do?` : 'What do you need done?'),
          h('p.page-sub', { style: { marginTop: '6px' } }, 'Describe it like you would to a friend. Pros quote better with detail.'),
        ]),
        invitedPro ? h('div.tile', [avatar(invitedPro.displayName || invitedPro.name), h('div.body', [h('div.d', 'This job goes to'), h('div.t', invitedPro.displayName || invitedPro.name)]), h('span.meta', ui.badge('Invited', 'verified'))]) : null,
        h('label.field', [h('span', ['Describe the job ', h('small', 'what, where in the house, how big')]), textarea, error]),
        h('div', [detectedBox, ideas]),
        next,
        h('p.tiny.muted.center', [icon('lock', 13), ' Free to post. No obligation to hire.']),
      ]);
    }

    /* ---- step 2: where & when ---- */
    function stepWhere() {
      const error = h('div.field-error', { hidden: true });
      const suburb = h('select', { name: 'suburbId', required: true }, [h('option', { value: '' }, 'Choose your suburb'), ...account().suburbOptions(draft.suburbId)]);
      suburb.value = draft.suburbId;
      const address = h('input', { name: 'address', type: 'text', autocomplete: 'street-address', placeholder: 'e.g. 12 Jacaranda Street (optional)', value: draft.addressText });
      const options = h('div.options', URGENCY.map((u) => h('label.option' + (draft.urgency === u.id ? '.selected' : ''), [
        h('input', { type: 'radio', name: 'urgency', value: u.id, checked: draft.urgency === u.id, onchange: () => { draft.urgency = u.id; for (const o of Array.from(options.querySelectorAll('.option'))) o.classList.remove('selected'); options.querySelectorAll('.option')[URGENCY.indexOf(u)].classList.add('selected'); } }),
        h('span.o-ico', icon(u.icon, 18)),
        h('span.o-t', u.t),
        h('span.o-d', u.d),
      ])));
      const date = h('input', { name: 'preferredDate', type: 'date', value: draft.preferredDate, min: new Date().toISOString().slice(0, 10) });
      const access = h('textarea', { name: 'accessNotes', rows: '2', placeholder: 'Gate code, parking, which entrance… (only shared with the pro you hire)', style: { minHeight: '84px' } });
      access.value = draft.accessNotes;
      const pets = h('input', { type: 'checkbox', name: 'pets', checked: draft.pets });

      /* Photos — at least 3, so pros quote the real job instead of guessing. */
      const thumbs = h('div.thumbs');
      const photoCount = h('div.tiny.muted', { style: { marginTop: '6px' } });
      const fileInput = h('input', { type: 'file', name: 'jobPhotos', accept: 'image/*', multiple: true, 'aria-label': 'Add photos of the problem' });
      const uploader = h('label.uploader', [
        fileInput,
        h('span.u-ico', icon('camera', 26)),
        h('span.u-t', 'Add photos of the problem'),
        h('span.u-d', 'At least 3 · wide shot, close-up, one more angle · we shrink big photos for you'),
      ]);
      const paintThumbs = () => {
        thumbs.innerHTML = '';
        draft.photos.forEach((p, index) => thumbs.append(h('div.thumb', [
          h('img', { src: p.dataUrl, alt: `Photo ${index + 1}` }),
          h('button.x', { type: 'button', 'aria-label': 'Remove photo', onclick: () => { draft.photos.splice(index, 1); paintThumbs(); } }, icon('close', 16)),
        ])));
        photoCount.innerHTML = '';
        photoCount.append(draft.photos.length < 3
          ? h('span', { style: { color: 'var(--danger)' } }, `Add at least 3 photos — ${3 - draft.photos.length} more to go`)
          : h('span', { style: { color: 'var(--brand)' } }, `${draft.photos.length} photos added — pros will quote more accurately`));
      };
      paintThumbs();
      fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []).slice(0, 6 - draft.photos.length);
        for (const file of files) {
          try {
            const dataUrl = await ui.compressImage(file, { maxEdge: 1600, maxBytes: 450 * 1024 });
            const url = await api.uploadPhoto(dataUrl, 'jobs'); // Supabase bucket, or null offline
            draft.photos.push({ dataUrl, url });
            paintThumbs();
          } catch (e) { toast(ui.friendlyError(e), 'warn'); }
        }
        fileInput.value = '';
      });

      return h('div.stack.lg', [
        h('div', [h('h1', { style: { fontSize: '28px' } }, 'Where, when and photos'), h('p.page-sub', { style: { marginTop: '6px' } }, 'We match you with pros who work in your area. Photos get you better quotes.')]),
        h('label.field', [h('span', 'Suburb'), suburb, error]),
        h('label.field', [h('span', ['Street address ', h('small', 'shared only with the pro you hire')]), address]),
        h('div.field', [h('div.label', ['Photos ', h('small', 'minimum 3 — only pros who quote see them')]), uploader, thumbs, photoCount]),
        h('div.field', [h('div.label', 'How soon?'), options]),
        h('label.field', [h('span', ['Preferred date ', h('small', 'optional')]), date]),
        h('details.fold', [
          h('summary', [icon('home', 18), h('span', ['Household & access', h('div.sub', 'Optional — helps the pro arrive prepared')])]),
          h('div.fold-body.stack', [
            h('label.field', [h('span', 'Access notes'), access]),
            h('label.check-row', [pets, h('div', [h('div.t', 'There are pets at home'), h('div.d', 'So the pro knows before they arrive')])]),
          ]),
        ]),
        h('div.btn-row', [
          h('button.btn.ghost.lg', { type: 'button', onclick: () => { save(); step = 1; paint(); } }, 'Back'),
          h('button.btn.lg', {
            type: 'button', style: { flex: '2' },
            onclick: () => {
              save();
              if (!draft.suburbId) { error.textContent = 'Choose your suburb so we can find pros near you.'; error.hidden = false; suburb.setAttribute('aria-invalid', 'true'); suburb.focus(); return; }
              if (draft.photos.length < 3) { toast(`Add at least 3 photos — ${3 - draft.photos.length} more to go. Pros quote the real job when they can see it.`, 'warn'); return; }
              step = 3;
              paint();
            },
          }, ['Continue', icon('arrow', 18)]),
        ]),
      ]);

      function save() {
        draft.suburbId = suburb.value;
        draft.addressText = address.value.trim();
        draft.preferredDate = date.value;
        draft.accessNotes = access.value.trim();
        draft.pets = pets.checked;
      }
    }

    /* ---- step 3: budget & post ---- */
    function stepBudget() {
      const categoryId = draft.categoryId || (draft.detected && draft.detected.categoryId);
      const cat = categoryById(categoryId);
      const suburb = metros().flatMap((m) => (m.suburbs || []).map((s) => ({ ...s, metroId: m.id, metroName: m.name }))).find((s) => s.id === draft.suburbId);
      const guide = h('div.card', [h('div.skeleton.line', { style: { width: '60%' } }), h('div.skeleton.line', { style: { width: '80%' } })]);
      if (categoryId) {
        api.get(`/api/price-band?categoryId=${encodeURIComponent(categoryId)}${suburb ? `&metroId=${suburb.metroId}` : ''}`).then((band) => {
          guide.innerHTML = '';
          guide.append(
            h('div.row.between', [h('div.strong', [icon('trend', 18), ` Typical price in ${suburb ? suburb.metroName.replace('City of ', '') : 'your area'}`]), h('span.badge.neutral', band.confidence === 'HIGH' ? 'Lots of data' : 'Early estimate')]),
            h('div.row', { style: { marginTop: '12px', gap: '10px', alignItems: 'baseline' } }, [h('span.money.big', band.format ? band.format.typical : money(band.p50Cents)), h('span.small.muted', 'typical')]),
            h('div.small.muted', { style: { marginTop: '4px' } }, band.format ? `Most jobs cost between ${band.format.low} and ${band.format.high}, depending on size.` : ''),
          );
        }).catch(() => { guide.innerHTML = ''; guide.append(h('p.small.muted', 'Price guide unavailable offline — pros will quote anyway.')); });
      } else guide.hidden = true;

      const budget = h('input', { name: 'budget', type: 'number', inputmode: 'numeric', min: '0', step: '50', placeholder: 'Not sure? Leave it empty', value: draft.budget });
      const summary = h('div.group', [
        summaryRow('What', draft.title || draft.description, () => { step = 1; paint(); }),
        summaryRow('Service', cat ? cat.label : 'We will match it', () => { step = 1; paint(); }),
        summaryRow('Where', suburb ? `${suburb.name}${draft.addressText ? ` · ${draft.addressText}` : ''}` : '—', () => { step = 2; paint(); }),
        summaryRow('When', (URGENCY.find((u) => u.id === draft.urgency) || {}).t + (draft.preferredDate ? ` · from ${ui.relDay(draft.preferredDate)}` : ''), () => { step = 2; paint(); }),
        summaryRow('Photos', `${draft.photos.length} added — pros can see the job`, () => { step = 2; paint(); }),
      ]);

      const postButton = h('button.btn.block.lg', { type: 'button', onclick: () => submit() }, ['Post my job — free', icon('arrow', 18)]);
      const identity = h('div');
      const paintIdentity = () => {
        identity.innerHTML = '';
        const s = api.session();
        if (s) {
          identity.append(h('div.tile', [avatar(s.name), h('div.body', [h('div.d', 'Posting as'), h('div.t', s.name)]), h('span.meta', h('button.btn.sm.subtle', { type: 'button', onclick: () => account().openSignIn({ title: 'Switch account', onDone: () => paintIdentity() }) }, 'Switch'))]));
          postButton.hidden = false;
        } else {
          postButton.hidden = true;
          identity.append(h('div.card', [
            h('h3', 'Last step: your contact number'),
            h('p.small.muted', { style: { margin: '4px 0 14px' } }, 'So pros can send you quotes. Your number stays private until you hire someone.'),
            account().signInFlow({ showDemo: true, suburbId: draft.suburbId, onDone: () => { paintIdentity(); submit(); } }),
          ]));
        }
      };
      paintIdentity();

      async function submit() {
        const s = api.session();
        if (!s) return;
        draft.budget = budget.value;
        const description = [draft.description, draft.pets ? 'There are pets at home.' : null].filter(Boolean).join('\n');
        // No title picked? Use the homeowner's own first sentence, not a catalogue guess.
        const firstSentence = draft.description.split(/(?<=[.!?])\s|\n/)[0].trim().replace(/[.!?]+$/, '');
        const ownTitle = firstSentence.length > 70 ? `${firstSentence.slice(0, 67).replace(/\s+\S*$/, '')}…` : firstSentence;
        const payload = {
          customerId: s.userId,
          description,
          title: draft.title || ownTitle || undefined,
          categoryId: categoryId || undefined,
          suburbId: draft.suburbId,
          addressText: draft.addressText || undefined,
          urgency: draft.urgency,
          preferredDates: draft.preferredDate ? [draft.preferredDate] : [],
          accessNotes: draft.accessNotes || undefined,
          budgetCents: draft.budget ? Math.round(Number(draft.budget) * 100) : undefined,
          householdNotes: draft.pets ? { pets: true } : {},
          photos: draft.photos.map((p) => ({ dataUrl: p.dataUrl, url: p.url || null, caption: null })),
          source: draft.proId ? 'PWA_INVITE' : 'PWA',
        };
        try {
          const job = await withButton(postButton, () => api.post('/api/jobs', payload));
          window.ProVeri.refreshBadges && window.ProVeri.refreshBadges(true);
          body.innerHTML = '';
          stepper.innerHTML = '';
          body.append(successScreen(job, cat || categoryById(job.categoryId), suburb));
          window.scrollTo({ top: 0 });
        } catch { /* toasted */ }
      }

      return h('div.stack.lg', [
        h('div', [h('h1', { style: { fontSize: '28px' } }, 'Budget, then post'), h('p.page-sub', { style: { marginTop: '6px' } }, 'A budget helps, but pros will quote either way.')]),
        guide,
        h('label.field', [h('span', ['Your budget ', h('small', 'optional')]), h('div.input-prefix', [h('b', 'R'), budget])]),
        h('div', [h('div.group-label', { style: { marginTop: 0 } }, 'Your job'), summary]),
        identity,
        postButton,
        h('div.trust-points', [
          h('div.trust-point', [h('span.tp-ico', icon('verified', 16)), h('span', [h('b', 'Only verified pros quote'), 'ID, phone and bank checked — and trade registration where the law requires it.'])]),
          h('div.trust-point', [h('span.tp-ico', icon('lock', 16)), h('span', [h('b', 'Your money waits for you'), 'When you book, payment is held in escrow and released only when you approve the work.'])]),
        ]),
        h('button.btn.ghost', { type: 'button', onclick: () => { draft.budget = budget.value; step = 2; paint(); } }, 'Back'),
      ]);
    }

    function summaryRow(label, value, onEdit) {
      return h('div.tile', [h('div.body', [h('div.d', label), h('div.t', { style: { fontSize: '15px', fontWeight: 650 } }, value)]), h('button.btn.sm.link', { type: 'button', onclick: onEdit }, 'Edit')]);
    }

    function successScreen(job, cat, suburb) {
      const pros = job.matchCount ?? (job.matchedProIds || []).length;
      return h('div.center', { style: { paddingTop: '18px' } }, [
        h('div.success-mark', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' }),
        h('h1', { style: { fontSize: '30px' } }, 'Your job is live'),
        h('p.lead-text', { style: { marginTop: '10px' } }, pros
          ? `We sent it to ${plural(pros, `verified ${(cat ? tradeName(cat.id, cat.label) : 'pro').toLowerCase()} pro`)} near ${suburb ? suburb.name : 'you'}.`
          : `We are finding verified pros near ${suburb ? suburb.name : 'you'} and will let you know as quotes arrive.`),
        job.categoryAutoDetected ? h('p.small.muted', { style: { marginTop: '6px' } }, `We filed it under ${job.categoryAutoDetected.label}.`) : null,
        h('div.card', { style: { textAlign: 'left', marginTop: '22px' } }, [
          h('h3', 'What happens next'),
          h('ol.next-steps', { style: { marginTop: '14px' } }, [
            h('li', h('div', [h('b', 'Quotes arrive'), h('span.muted', 'Usually within a few hours. We will notify you.')])),
            h('li', h('div', [h('b', 'Compare and choose'), h('span.muted', 'Look at each pro’s past work, reviews and price.')])),
            h('li', h('div', [h('b', 'Pay safely'), h('span.muted', 'Your money is held until you approve the finished job.')])),
          ]),
        ]),
        h('div.btn-row', { style: { marginTop: '22px' } }, [
          h('a.btn.lg', { href: `/job/${job.jobId}` }, 'Track my job'),
          h('a.btn.ghost.lg', { href: '/browse' }, 'Explore work'),
        ]),
      ]);
    }

    paint();
    return page;
  };

  /* ------------------------------------------------------------------ *
   * /upload-work — a pro adds past work
   * ------------------------------------------------------------------ */

  screens['/upload-work'] = async () => {
    const session = api.session();
    const page = h('div.page.narrow');
    page.append(ui.backButton('/'));
    const why = h('div.card.flat', [
      h('h3', 'How badges work'),
      h('div.trust-points', { style: { marginTop: '12px' } }, [
        h('div.trust-point', [h('span.tp-ico', icon('fingerprint', 16)), h('span', 'Every photo is sealed with a hash the moment you publish, so it cannot be quietly swapped later.')]),
        h('div.trust-point', [h('span.tp-ico', icon('x-circle', 16)), h('span', 'A photo another pro has already published is refused — the oldest trick in the trade does not work here.')]),
        h('div.trust-point', [h('span.tp-ico', icon('verified', 16)), h('span', 'Uploads show as “Uploaded by the pro”. Link a job you did through ProVeri and it earns the Verified badge — a badge nobody can buy.')]),
      ]),
    ]);

    if (!session || session.role !== 'PRO') {
      page.append(
        h('div.page-head', h('div.titles', [h('h1', 'Upload your past work'), h('p.page-sub', 'Homeowners hire the pro whose work they have seen. Show yours.')])),
        h('div.card.pad-lg.stack', [
          h('div.trust-points', [
            h('div.trust-point', [h('span.tp-ico', icon('camera', 16)), h('span', [h('b', 'Photos of real jobs'), 'Before and after shots win the most enquiries.'])]),
            h('div.trust-point', [h('span.tp-ico', icon('chat', 16)), h('span', [h('b', 'Homeowners message you'), 'Straight from the photo, about that exact job.'])]),
            h('div.trust-point', [h('span.tp-ico', icon('coins', 16)), h('span', [h('b', 'No lead fees'), 'You pay 10% only when you win and get paid.'])]),
          ]),
          h('div.btn-row', [
            h('a.btn.lg', { href: '/become-a-pro' }, 'Join as a pro'),
            !session ? h('button.btn.ghost.lg', { type: 'button', onclick: () => account().openSignIn({ role: 'PRO', reason: 'Sign in with the number on your pro account.' }) }, 'I already have an account') : null,
          ]),
          session ? h('p.small.muted', 'You are signed in as a homeowner. Pro accounts are separate so your jobs and your business stay apart.') : null,
        ]),
        why,
      );
      return page;
    }

    const [me, bookings, mine] = await Promise.all([
      api.get(`/api/pros/${encodeURIComponent(session.userId)}`).catch(() => null),
      api.get(`/api/bookings?proId=${encodeURIComponent(session.userId)}`).catch(() => []),
      api.get(`/api/pros/${encodeURIComponent(session.userId)}/portfolio`).catch(() => []),
    ]);

    const photos = [];
    const thumbs = h('div.thumbs');
    const photoCount = h('div.tiny.muted', { style: { marginTop: '6px' } });
    const fileInput = h('input', { type: 'file', name: 'photos', accept: 'image/*', multiple: true, 'aria-label': 'Add photos' });
    const uploader = h('label.uploader', [
      fileInput,
      h('span.u-ico', icon('camera', 26)),
      h('span.u-t', 'Add photos of the job'),
      h('span.u-d', 'At least 3 · before, during and after works best · we shrink big photos for you'),
    ]);
    const paintThumbs = () => {
      thumbs.innerHTML = '';
      photos.forEach((p, index) => thumbs.append(h('div.thumb', [
        h('img', { src: p.dataUrl, alt: `Photo ${index + 1}` }),
        index === 0 ? h('span.cover', 'Cover') : null,
        h('button.x', { type: 'button', 'aria-label': 'Remove photo', onclick: () => { photos.splice(index, 1); paintThumbs(); } }, icon('close', 16)),
      ])));
      photoCount.innerHTML = '';
      photoCount.append(photos.length < 3
        ? h('span', { style: { color: 'var(--danger)' } }, `Add at least 3 photos — ${3 - photos.length} more to go`)
        : h('span', { style: { color: 'var(--brand)' } }, `${photos.length} photos — homeowners trust work they can see`));
    };
    paintThumbs();
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []).slice(0, 6 - photos.length);
      for (const file of files) {
        try {
          const dataUrl = await ui.compressImage(file, { maxEdge: 1600, maxBytes: 450 * 1024 });
          const url = await api.uploadPhoto(dataUrl, 'work'); // Supabase bucket, or null offline
          photos.push({ dataUrl, url, caption: '' });
          paintThumbs();
        } catch (e) { toast(ui.friendlyError(e), 'warn'); }
      }
      fileInput.value = '';
    });

    const eligible = (bookings || []).filter((b) => ['IN_WARRANTY', 'CLOSED', 'COMPLETED'].includes(b.status));
    const linkOptions = h('div.options.one', [
      h('label.option.selected', [h('input', { type: 'radio', name: 'bookingId', value: '', checked: true }), h('span.o-t', 'Not a ProVeri job'), h('span.o-d', 'Shows as “Uploaded by the pro”')]),
      ...eligible.map((b) => h('label.option', [h('input', { type: 'radio', name: 'bookingId', value: b.bookingId }), h('span.o-t', b.title), h('span.o-d', `${b.customerName} · ${money(b.totalCents)} · earns the Verified badge`)])),
    ]);
    linkOptions.addEventListener('change', () => {
      for (const o of Array.from(linkOptions.querySelectorAll('.option'))) {
        const radio = o.querySelector('input');
        if (radio && radio.checked) o.classList.add('selected'); else o.classList.remove('selected');
      }
    });

    const form = h('form.stack.lg', {
      onsubmit: async (event) => {
        event.preventDefault();
        const values = formValues(form);
        if (photos.length < 3) { toast(`Add at least 3 photos of the job — ${3 - photos.length} more to go.`, 'warn'); return; }
        if (!String(values.title || '').trim()) { toast('Give the job a short title.', 'warn'); return; }
        const button = form.querySelector('button[type=submit]');
        try {
          const created = await withButton(button, () => api.post('/api/portfolio', {
            proId: session.userId,
            title: values.title,
            description: values.description || null,
            categoryId: values.categoryId || null,
            suburbId: values.suburbId || null,
            priceCents: values.price ? Math.round(Number(values.price) * 100) : null,
            completedAt: values.completedAt || null,
            bookingId: values.bookingId || null,
            photos: photos.map((p) => ({ dataUrl: p.dataUrl, url: p.url || null, caption: p.caption || null })),
          }));
          toast(created.tier === 'SELF_DECLARED' ? 'Published. Homeowners can now message you about it.' : 'Published with the Verified badge.', 'ok');
          navigate(`/work/${created.itemId}`);
        } catch { /* toasted */ }
      },
    }, [
      h('div.field', [h('div.label', ['Photos ', h('small', 'minimum 3')]), uploader, thumbs, photoCount]),
      h('label.field', [h('span', 'Job title'), h('input', { name: 'title', type: 'text', required: true, maxlength: '120', placeholder: 'e.g. Geyser replaced and ceiling repaired' })]),
      h('div.form-grid.two', [
        h('label.field', [h('span', 'Service'), h('select', { name: 'categoryId' }, categories().map((c) => h('option', { value: c.id, selected: me && c.id === me.primaryCategory ? true : null }, tradeName(c.id, c.label))))]),
        h('label.field', [h('span', 'Suburb'), h('select', { name: 'suburbId' }, [h('option', { value: '' }, 'Choose'), ...account().suburbOptions(me && me.location ? me.location.suburbId : '')])]),
      ]),
      h('div.form-grid.two', [
        h('label.field', [h('span', ['Price ', h('small', 'optional')]), h('div.input-prefix', [h('b', 'R'), h('input', { name: 'price', type: 'number', min: '0', step: '50', inputmode: 'numeric', placeholder: '0' })])]),
        h('label.field', [h('span', ['Finished on ', h('small', 'optional')]), h('input', { name: 'completedAt', type: 'date', max: new Date().toISOString().slice(0, 10) })]),
      ]),
      h('label.field', [h('span', ['What you did ', h('small', 'optional')]), h('textarea', { name: 'description', rows: '4', placeholder: 'Materials, how long it took, anything that made it tricky…' })]),
      h('div.field', [h('div.label', ['Was this a ProVeri job?', eligible.length ? h('small', `${eligible.length} eligible`) : null]), linkOptions]),
      h('button.btn.block.lg', { type: 'submit' }, [icon('upload', 18), 'Publish work']),
    ]);

    page.append(
      h('div.page-head', h('div.titles', [h('h1', 'Add your work'), h('p.page-sub', 'A photo of a finished job is worth a hundred adverts.')])),
      h('div.card.pad-lg', form),
      h('div.section.tight', why),
      h('div.section', [
        ui.sectionHead('Your published work', mine.length ? 'View profile' : null, `/pro/${session.userId}`),
        mine.length ? h('div.work-grid', mine.map((i) => workCard(i, { mini: true, hidePro: true }))) : h('p.muted', 'Nothing yet — your first upload will appear here. Jobs you finish on ProVeri are added automatically.'),
      ]),
    );
    return page;
  };

  /* ------------------------------------------------------------------ *
   * /me — account
   * ------------------------------------------------------------------ */

  screens['/me'] = async () => {
    const session = api.session();
    const page = h('div.page.narrow');
    if (!session) {
      page.append(
        h('div.page-head', h('div.titles', [h('h1', 'Sign in to ProVeri'), h('p.page-sub', 'One account to hire pros, track jobs and pay safely.')])),
        h('div.card.pad-lg', account().signInFlow({})),
        h('div.group-label', 'Explore'),
        h('div.group', [
          tile('/trust', 'shield', 'How we protect you', 'Escrow, verification and disputes, explained'),
          tile('/become-a-pro', 'briefcase', 'Join as a pro', 'Get hired for work you have already done', 'gold'),
        ]),
        installTile(),
      );
      return page;
    }

    const isPro = session.role === 'PRO';
    const profile = await api.get(isPro ? `/api/pros/${encodeURIComponent(session.userId)}` : `/api/customers/${encodeURIComponent(session.userId)}`).catch(() => null);
    const subtitle = isPro
      ? `${(profile && profile.primaryCategoryLabel) || 'Pro'}${profile && profile.location && profile.location.suburb ? ` · ${profile.location.suburb}` : ''}`
      : `Homeowner${profile && profile.suburb ? ` · ${profile.suburb}` : ''}`;

    page.append(
      h('div.page-head', h('div.titles', h('h1', 'Account'))),
      h('div.me-card', [
        avatar(session.name, 'xl'),
        h('div.grow', [
          h('h2', session.name),
          h('div.muted', subtitle),
          isPro && profile ? h('div', { style: { marginTop: '8px' } }, ui.trustBadge(profile.badge, profile.trustScore)) : null,
        ]),
      ]),
    );

    if (isPro) {
      page.append(
        h('div.group-label', 'Your business'),
        h('div.group', [
          tile(`/pro/${session.userId}`, 'user', 'Public profile', 'What homeowners see'),
          tile('/upload-work', 'camera', 'Add your work', 'Photos win enquiries'),
          tile('/orders', 'jobs', 'Leads & jobs', 'Quote, schedule and get paid'),
          tile('/wallet', 'wallet', 'Earnings', 'Payouts and what is on the way'),
          tile('/become-a-pro', 'shield', 'Verification', profile && profile.canBid ? 'You are cleared to quote' : 'Finish to start quoting', profile && profile.canBid ? '' : 'gold'),
        ]),
      );
    } else {
      page.append(
        h('div.group-label', 'Your activity'),
        h('div.group', [
          tile('/orders', 'jobs', 'Your jobs', 'Quotes, bookings and warranties'),
          tile('/inbox', 'inbox', 'Messages', 'Conversations with pros'),
          tile('/notifications', 'bell', 'Updates', 'Quotes, payments and progress'),
          tile(`/member/${session.userId}`, 'star', 'My public profile', 'What pros see: your reviews and rating'),
        ]),
      );
    }

    page.append(
      h('div.group-label', 'More from ProVeri'),
      h('div.group', [
        isPro ? tile('/notifications', 'bell', 'Updates', 'New leads, payments and reviews') : tile('/become-a-pro', 'briefcase', 'Join as a pro', 'Earn from your skills — no lead fees', 'gold'),
        tile('/business-studio', 'store', 'Business sites', 'A website for your business, with bookings'),
        tile('/web-studio', 'globe', 'Web Studio', 'Free microsite from your verified profile'),
        tile('/vehicles', 'car', 'Verified vehicles', 'Buy and sell cars with escrow'),
        tile('/property', 'building', 'Property', 'Coming soon'),
      ]),
      h('div.group-label', 'Help & trust'),
      h('div.group', [
        tile('/trust', 'shield', 'How we protect you', 'Escrow, verification and disputes'),
        tile('/integrations', 'link', 'Data & integrations', 'The live sources behind ProVeri'),
      ]),
      h('div.group-label', 'Team tools'),
      h('div.group', [
        tile('/admin', 'gauge', 'Trust desk', 'Risk, disputes and verification queue'),
        tile('/sales-desk', 'trend', 'Sales desk', 'Leads and campaigns'),
      ]),
      h('div.group-label', 'Settings'),
      appearance(),
      installTile(),
      h('div.btn-row', { style: { marginTop: '22px' } }, [
        h('button.btn.ghost', { type: 'button', onclick: () => account().openSignIn({ title: 'Switch account', reason: 'Sign in with another number, or pick a demo account.' }) }, [icon('users', 18), 'Switch account']),
        h('button.btn.danger', { type: 'button', onclick: () => { api.signOut(); toast('Signed out.', 'ok'); navigate('/'); } }, [icon('logout', 18), 'Sign out']),
      ]),
    );
    return page;
  };

  function tile(href, iconName, title, sub, tone) {
    return h('a.tile', { href }, [h('span.lead' + (tone ? '.' + tone : ''), icon(iconName, 20)), h('div.body', [h('div.t', title), sub ? h('div.d', sub) : null]), h('span.meta', icon('chevron', 18))]);
  }

  function installTile() {
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    return h('div.group', { style: { marginTop: '10px' } }, h('button.tile', { type: 'button', onclick: () => window.ProVeri.install && window.ProVeri.install() }, [
      h('span.lead.grey', icon('install', 20)),
      h('div.body', [h('div.t', standalone ? 'Installed on this device' : 'Install the app'), h('div.d', 'Opens like an app and works on a weak signal')]),
      h('span.meta', icon('chevron', 18)),
    ]));
  }

  function appearance() {
    const current = localStorage.getItem('proveri.theme') || 'system';
    const seg = h('div.seg.block');
    const set = (mode) => {
      if (mode === 'system') { localStorage.removeItem('proveri.theme'); document.documentElement.removeAttribute('data-theme'); }
      else { localStorage.setItem('proveri.theme', mode); document.documentElement.setAttribute('data-theme', mode); }
      for (const b of Array.from(seg.querySelectorAll('button'))) { if (b.dataset.mode === mode) b.classList.add('active'); else b.classList.remove('active'); }
    };
    [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].forEach(([mode, label]) => {
      const b = h('button' + (mode === current ? '.active' : ''), { type: 'button', onclick: () => set(mode) }, label);
      b.dataset.mode = mode;
      seg.append(b);
    });
    return h('div.card.pad-sm', [h('div.row.between', { style: { marginBottom: '10px' } }, [h('div.strong', [icon('sun', 18), ' Appearance'])]), seg]);
  }
})();
