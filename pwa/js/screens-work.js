/* ==========================================================================
   ProVeri PWA — doing the work

   window.ProVeri.proHome      the pro's home: leads, next job, earnings
   window.ProVeri.proJobs      /orders for a pro: leads → quoted → booked → done
   window.ProVeri.bookingTracker  /order/:id and /booking/:id, for both sides
   /become-a-pro               three steps to a verified pro account
   /wallet                     earnings
   /notifications, /bookings, /profile — kept as doors into the new screens

   The tracker shows the ONE thing that needs doing now, by whom, in words.
   ========================================================================== */

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const ui = window.ProVeri.ui;
  const {
    h, icon, money, timeAgo, toast, sheet, closeSheet, navigate, avatar, tradeIcon, tradeName, rating,
    withButton, formValues, firstName, plural, photoImg,
  } = ui;
  window.ProVeri.screens = window.ProVeri.screens || {};
  const screens = window.ProVeri.screens;
  const account = () => window.ProVeri.account;
  const categories = () => api.state.bundle?.catalog?.categories || [];
  const categoryById = (id) => categories().find((c) => c.id === id) || null;

  const ACTIVE_BOOKING = ['AWARDED', 'SCHEDULED', 'EN_ROUTE', 'ON_SITE', 'STARTED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'];

  function greeting() {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }

  /* ================================================================== *
   * Pro home
   * ================================================================== */

  window.ProVeri.proHome = async function proHome() {
    const session = api.session();
    const page = h('div.page');
    const [profile, jobs, bookings, wallet, work] = await Promise.all([
      api.get(`/api/pros/${encodeURIComponent(session.userId)}`).catch(() => null),
      api.get(`/api/jobs?proId=${encodeURIComponent(session.userId)}`).catch(() => []),
      api.get(`/api/bookings?proId=${encodeURIComponent(session.userId)}`).catch(() => []),
      api.get(`/api/pros/${encodeURIComponent(session.userId)}/wallet`).catch(() => null),
      api.get(`/api/pros/${encodeURIComponent(session.userId)}/portfolio`).catch(() => []),
    ]);
    const leads = (jobs || []).filter((j) => !j.myBid && ['OPEN', 'BIDDING'].includes(j.status));
    const active = (bookings || []).filter((b) => ACTIVE_BOOKING.includes(b.status));
    const stats = (profile && profile.stats) || {};

    page.append(h('div.dash-head', [
      avatar(session.name, 'lg'),
      h('div.grow', [
        h('div.muted.small', profile ? `${profile.primaryCategoryLabel || 'Pro'}${profile.location && profile.location.suburb ? ` · ${profile.location.suburb}` : ''}` : 'Pro'),
        h('h1', `${greeting()}, ${firstName(session.name)}`),
      ]),
    ]));

    if (profile && !profile.verified) page.append(h('div.section.tight', verificationCard(profile)));

    page.append(h('div.section.tight', h('div.kpis', [
      kpi('/orders', 'zap', 'gold', String(leads.length), leads.length === 1 ? 'New lead' : 'New leads'),
      kpi('/orders?tab=booked', 'calendar', 'blue', String(active.length), active.length === 1 ? 'Active job' : 'Active jobs'),
      kpi('/wallet', 'wallet', '', money((wallet && (wallet.receivedCents || 0)) || stats.totalEarnedCents || 0), 'Earned on ProVeri'),
      kpi(`/pro/${session.userId}`, 'star', 'gold', profile && profile.ratings && profile.ratings.average ? Number(profile.ratings.average).toFixed(1) : 'New', profile && profile.ratings && profile.ratings.count ? `${plural(profile.ratings.count, 'review')}` : 'No reviews yet'),
    ])));

    // The next job, if one needs the pro.
    const next = active.find((b) => ['SCHEDULED', 'EN_ROUTE', 'ON_SITE', 'STARTED', 'IN_PROGRESS'].includes(b.status)) || active[0];
    if (next) {
      page.append(h('section.section', [ui.sectionHead('Your next job', 'All jobs', '/orders?tab=booked'), proBookingCard(next).node]));
    }

    page.append(h('section.section', [
      ui.sectionHead('New leads for you', leads.length ? 'See all' : null, '/orders', 'Jobs homeowners posted near you, matched to your trade.'),
      leads.length
        ? h('div.list', leads.slice(0, 3).map(leadCard))
        : ui.empty('zap', 'No new leads right now', 'When a homeowner nearby posts a job in your trade, it lands here and we notify you.', h('a.btn.ghost', { href: '/upload-work' }, 'Add work to get found')),
    ]));

    page.append(h('section.section', [
      ui.sectionHead('Your work', 'Add work', '/upload-work', 'Homeowners message you straight from these photos.'),
      (work || []).length
        ? h('div.work-grid', work.slice(0, 4).map((i) => window.ProVeri.workCard(i, { mini: true, hidePro: true })))
        : h('a.uploader', { href: '/upload-work', style: { textDecoration: 'none', color: 'inherit' } }, [h('span.u-ico', icon('camera', 26)), h('span.u-t', 'Add your first job'), h('span.u-d', 'Before-and-after photos help homeowners choose you.')]),
    ]));
    page.append(window.ProVeri.siteFooter());
    return page;
  };

  function kpi(href, iconName, tone, value, label) {
    return h('a.kpi', { href }, [h('span.k-ico' + (tone ? '.' + tone : ''), icon(iconName, 18)), h('span.k-v', value), h('span.k-l', label)]);
  }

  function verificationCard(profile) {
    const reasons = (profile.explanation && profile.explanation.reasons) || [];
    const passed = reasons.filter((r) => r.tone === 'pass').length;
    const pct = reasons.length ? Math.round((passed / reasons.length) * 100) : 20;
    return h('div.card.gold', [
      h('div.row.top', [
        h('span.k-ico.gold', { style: { width: '40px', height: '40px', borderRadius: '12px', display: 'grid', placeItems: 'center', background: 'var(--sun)', color: '#3a2500', flex: 'none' } }, icon('shield', 22)),
        h('div.grow', [
          h('div.strong', 'Finish verification to start quoting'),
          h('div.small', { style: { color: 'var(--ink-2)' } }, 'Homeowners only see quotes from verified pros. You can already add work to your profile.'),
          h('div.meter', h('i', { style: { width: `${pct}%` } })),
        ]),
      ]),
      h('a.btn.sm', { href: '/become-a-pro', style: { marginTop: '14px' } }, ['Continue verification', icon('arrow', 16)]),
    ]);
  }

  function leadCard(j) {
    return h('a.lead-card', { href: `/job/${j.jobId}?quote=1` }, [
      h('div.lc-top', [
        tradeIcon(j.categoryId),
        h('div.grow', [h('div.lc-title', j.title), h('div.lc-sub', `${j.suburb || ''} · ${j.urgency || ''} · ${timeAgo(j.postedAt)}`)]),
        j.bidCount ? h('span.badge.neutral', plural(j.bidCount, 'quote')) : h('span.badge.verified', 'Be first'),
      ]),
      j.excerpt ? h('div.lc-excerpt', j.excerpt) : null,
      h('div.lc-foot', [
        j.budgetCents ? h('span.fact.good', [icon('banknote', 14), `Budget ${money(j.budgetCents)}`]) : (j.priceBandFormat ? h('span.fact', [icon('trend', 14), `Typical ${j.priceBandFormat.typical}`]) : null),
        j.statutoryTrade ? h('span.fact', [icon('file-check', 14), 'CoC needed']) : null,
        h('span.grow'),
        h('span.btn.sm', 'Send a quote'),
      ]),
    ]);
  }
  window.ProVeri.leadCard = leadCard;

  function proBookingCard(b) {
    const words = ui.bookingWords(b.status, 'PRO');
    const next = {
      AWARDED: ['hourglass', `Waiting for ${firstName(b.customerName)} to pay — we will tell you`, false],
      SCHEDULED: ['navigation', `Booked for ${ui.relDay(b.scheduledAt)} — tap “I’m on my way” when you leave`, true],
      EN_ROUTE: ['key', 'Read your arrival code at the door', true],
      ON_SITE: ['tool', 'Start the job', true],
      STARTED: ['camera', 'Upload proof when you are done', true],
      IN_PROGRESS: ['camera', 'Upload proof when you are done', true],
      AWAITING_CONFIRMATION: ['hourglass', `Waiting for approval${b.autoReleaseAt ? ` — pays out by ${ui.relDay(b.autoReleaseAt)} at the latest` : ''}`, false],
      IN_WARRANTY: ['check-circle', `Paid · warranty until ${ui.dateShort(b.warrantyEndsAt)}`, false],
      DISPUTED: ['alert', 'Under review — add your evidence', true],
    }[b.status];
    return {
      at: b.createdAt,
      past: ['CLOSED', 'CANCELLED', 'REFUNDED'].includes(b.status),
      node: h('a.order-card', { href: `/booking/${b.bookingId}` }, [
        h('div.oc-top', [tradeIcon(b.categoryId), h('div.grow', [h('div.oc-title', b.title), h('div.oc-sub', `${b.customerName} · ${b.suburb || ''} · ${money(b.totalCents)}`), h('div.oc-status', ui.statusPill(words))])]),
        ui.tracker(ui.bookingReached(b.status)),
        next ? h('div.oc-next' + (next[2] ? '.action' : ''), [icon(next[0], 18), h('span.grow', next[1]), icon('chevron', 18)]) : null,
      ]),
    };
  }

  /* ================================================================== *
   * Pro: leads & jobs
   * ================================================================== */

  window.ProVeri.proJobs = async function proJobs({ query }) {
    const session = api.session();
    const page = h('div.page.mid');
    page.append(h('div.page-head', h('div.titles', [h('h1', 'Leads & jobs'), h('p.page-sub', 'Quote on new jobs, then run them to payment.')])));
    const [profile, jobs, bookings] = await Promise.all([
      api.get(`/api/pros/${encodeURIComponent(session.userId)}`).catch(() => null),
      api.get(`/api/jobs?proId=${encodeURIComponent(session.userId)}`).catch(() => []),
      api.get(`/api/bookings?proId=${encodeURIComponent(session.userId)}`).catch(() => []),
    ]);
    if (profile && !profile.verified) page.append(h('div.banner.warn', { style: { marginBottom: '14px' } }, [h('span.ico', icon('shield', 20)), h('div', [h('strong', 'You can see leads, but not quote yet'), h('div.small', ['Finish verification first. ', h('a', { href: '/become-a-pro' }, 'Continue verification')])])]));

    const open = ['OPEN', 'BIDDING'];
    const lists = {
      leads: (jobs || []).filter((j) => !j.myBid && open.includes(j.status)),
      quoted: (jobs || []).filter((j) => j.myBid && open.includes(j.status)),
      booked: (bookings || []).filter((b) => ACTIVE_BOOKING.includes(b.status)),
      done: [
        ...(bookings || []).filter((b) => !ACTIVE_BOOKING.includes(b.status)),
        ...(jobs || []).filter((j) => j.myBid && !open.includes(j.status) && !(bookings || []).some((b) => b.jobId === j.jobId)),
      ],
    };
    const seg = h('div.seg');
    const body = h('div.list', { style: { marginTop: '16px' } });
    page.append(seg, body);

    const labels = { leads: 'New leads', quoted: 'Quoted', booked: 'Booked', done: 'Done' };
    const paint = (which) => {
      seg.innerHTML = '';
      for (const key of Object.keys(labels)) {
        seg.append(h('button' + (key === which ? '.active' : ''), { type: 'button', onclick: () => paint(key) }, [labels[key], lists[key].length ? h('span.count-badge', String(lists[key].length)) : null]));
      }
      body.innerHTML = '';
      const rows = lists[which];
      if (!rows.length) {
        const copy = {
          leads: ['zap', 'No new leads right now', 'We match you to jobs in your trade and area, and notify you the moment one is posted.'],
          quoted: ['quote', 'No open quotes', 'Quotes you send appear here until the homeowner decides.'],
          booked: ['calendar', 'No active jobs', 'When a homeowner accepts your quote and pays, the job shows up here.'],
          done: ['history', 'Nothing finished yet', 'Completed jobs and payouts are kept here.'],
        }[which];
        body.append(ui.empty(copy[0], copy[1], copy[2]));
        return;
      }
      if (which === 'leads') rows.forEach((j) => body.append(leadCard(j)));
      if (which === 'quoted') rows.forEach((j) => body.append(h('a.lead-card', { href: `/job/${j.jobId}` }, [
        h('div.lc-top', [tradeIcon(j.categoryId), h('div.grow', [h('div.lc-title', j.title), h('div.lc-sub', `${j.suburb || ''} · quoted ${timeAgo(j.myBid.createdAt)}`)]), h('span.money', money(j.myBid.totalCents))]),
        h('div.lc-foot', [h('span.status.pill.wait', 'Waiting for the homeowner'), j.bidCount > 1 ? h('span.small.muted', `${plural(j.bidCount - 1, 'other quote')}`) : null]),
      ])));
      if (which === 'booked') rows.forEach((b) => body.append(proBookingCard(b).node));
      if (which === 'done') rows.forEach((row) => body.append(row.bookingId && row.proName !== undefined && row.customerName !== undefined
        ? proBookingCard(row).node
        : h('a.lead-card', { href: `/job/${row.jobId}` }, [h('div.lc-top', [tradeIcon(row.categoryId), h('div.grow', [h('div.lc-title', row.title), h('div.lc-sub', 'Another pro was chosen')]), h('span.status.pill', 'Not selected')])])));
    };
    paint(['leads', 'quoted', 'booked', 'done'].includes(query.tab) ? query.tab : (lists.leads.length || !lists.booked.length ? 'leads' : 'booked'));
    return page;
  };

  /* ================================================================== *
   * The job tracker — /order/:id and /booking/:id
   * ================================================================== */

  window.ProVeri.bookingTracker = async function bookingTracker({ params }) {
    const session = api.session();
    const viewer = session ? session.userId : '';
    const b = await api.get(`/api/bookings/${encodeURIComponent(params.bookingId)}?viewerId=${encodeURIComponent(viewer)}`);
    const role = session && session.userId === b.customerId ? 'CUSTOMER' : session && session.userId === b.proId ? 'PRO' : 'VIEWER';
    const words = ui.bookingWords(b.status, role);
    const page = h('div.page.mid');
    const reload = () => navigate(location.pathname, { replace: true });

    page.append(
      ui.backButton('/orders', 'Your jobs'),
      h('div.row.top', { style: { gap: '12px', marginTop: '6px' } }, [
        tradeIcon(b.categoryId, 'lg'),
        h('div.grow', [
          h('h1', { style: { fontSize: '25px' } }, b.title),
          h('div.small.muted', { style: { marginTop: '4px' } }, `${b.address && b.address.suburb ? b.address.suburb : ''} · Ref ${b.reference}`),
        ]),
      ]),
      h('div.row', { style: { margin: '12px 0 18px' } }, [ui.statusPill(words)]),
      h('div.card', { style: { padding: '18px 14px 16px' } }, ui.tracker(ui.bookingReached(b.status))),
    );

    // 1 — the one thing that needs doing now.
    const next = nextStep(b, role);
    if (next) page.append(h('div.section.tight', next));

    // 2 — who is on the other side.
    const counterpart = role === 'PRO'
      ? { name: b.customerName, sub: 'Homeowner', href: `/member/${encodeURIComponent(b.customerId)}`, extra: b.customerMobile ? h('a.icon-btn.solid', { href: `tel:${b.customerMobile}`, 'aria-label': `Call ${b.customerName}`, title: `Call ${b.customerName}` }, icon('call', 18)) : null }
      : { name: (b.pro && b.pro.name) || b.proName, sub: [b.pro && b.pro.completedJobs ? `${b.pro.completedJobs} jobs` : null, b.pro && b.pro.averageRating ? `★ ${Number(b.pro.averageRating).toFixed(1)}` : null].filter(Boolean).join(' · ') || 'Your pro', extra: null };
    page.append(h('div.section.tight', h('div.tile', [
      avatar(counterpart.name, 'lg'),
      h('div.body', [
        counterpart.href ? h('a.t', { href: counterpart.href, style: { color: 'var(--ink)' } }, [counterpart.name, icon('chevron', 13)]) : h('div.t', counterpart.name),
        h('div.d', counterpart.sub),
        role !== 'PRO' && b.proBadge ? h('div', { style: { marginTop: '6px' } }, ui.trustBadge(b.proBadge)) : null,
      ]),
      h('div.row', { style: { gap: '8px' } }, [
        counterpart.extra,
        role !== 'VIEWER' ? h('a.btn.sm', { href: `/inbox/${encodeURIComponent(`booking.${b.bookingId}`)}` }, [icon('chat', 16), 'Message']) : null,
      ]),
    ])));

    // 3 — where the money is, in words.
    page.append(h('div.section', [h('h2', { style: { fontSize: '20px', marginBottom: '12px' } }, 'Where your money is'), moneyCard(b, role)]));

    // 4 — what was agreed.
    const scope = b.scope || {};
    page.append(h('div.section', [
      h('h2', { style: { fontSize: '20px', marginBottom: '12px' } }, 'The job'),
      h('div.card', h('dl.kv', [
        h('dt', 'When'), h('dd', b.schedule && b.schedule.scheduledAt ? `${ui.relDay(b.schedule.scheduledAt)}${b.schedule.durationHours ? ` · about ${plural(b.schedule.durationHours, 'hour')}` : ''}` : 'To be arranged'),
        h('dt', 'Where'), h('dd', [b.address && (b.address.addressText || b.address.suburb) || '—']),
        h('dt', 'Warranty'), h('dd', b.warranty ? `${b.warranty.days} days on workmanship` : '—'),
        b.statutoryTrade ? h('dt', 'Certificate') : null, b.statutoryTrade ? h('dd', 'Certificate of Compliance included') : null,
      ])),
      scope.scopeOfWork || scope.description ? h('details.fold', { style: { marginTop: '10px' } }, [h('summary', [icon('file', 18), 'Agreed scope of work']), h('div.fold-body', h('p.muted', { style: { whiteSpace: 'pre-line' } }, scope.scopeOfWork || scope.description))]) : null,
    ]));

    // 5 — proof of work, if any.
    const photos = (b.evidence || []).filter((e) => e.imageUrl);
    if ((b.evidence || []).length) {
      page.append(h('div.section', [
        h('h2', { style: { fontSize: '20px', marginBottom: '12px' } }, 'Proof of work'),
        photos.length ? h('div.thumbs', photos.slice(0, 6).map((e) => h('div.thumb', [photoImg(e.imageUrl, e.label), h('span.cover', e.illustrative ? 'Demo photo' : e.label)]))) : null,
        h('div.list', { style: { marginTop: '12px' } }, (b.evidence || []).slice(0, 8).map((e) => h('div.tile', [
          h('span.lead' + (e.geoVerified === false ? '.red' : ''), icon(/PHOTO/.test(e.type) ? 'camera' : /SIGNATURE/.test(e.type) ? 'edit' : 'file-check', 18)),
          h('div.body', [h('div.t', e.label || e.type), h('div.d', [ui.dateTimeShort(e.capturedAt), e.geoVerified === true ? ' · taken at the job address' : e.geoVerified === false ? ' · taken away from the job address' : ''])]),
          h('span.meta', h('code', { style: { fontSize: '11px' } }, `#${String(e.seal || e.hash || '').slice(0, 8)}`)),
        ]))),
      ]));
    }

    // 6 — the full record, for whoever wants it.
    const trail = (b.auditTrail || []).slice(-12).reverse();
    page.append(h('div.section', [
      trail.length ? h('details.fold', [
        h('summary', [icon('history', 18), h('span', ['Full history', h('div.sub', 'Every step is sealed in the audit ledger')])]),
        h('div.fold-body', h('div.steps', trail.map((t, i) => h('div.step' + (i === 0 ? '.current' : '.done'), [h('span.dot'), h('div.body', [h('div.t', t.summary || t.action || 'Update'), h('div.d', ui.dateTimeShort(t.at || t.timestamp))])])))),
      ]) : null,
      role !== 'VIEWER' && ACTIVE_BOOKING.includes(b.status) && b.status !== 'DISPUTED'
        ? h('div.btn-row', { style: { marginTop: '14px' } }, [
          h('button.btn.subtle.sm', { type: 'button', onclick: () => helpSheet(b, role, reload) }, [icon('help', 16), 'Get help with this job']),
        ])
        : null,
    ]));
    return page;
  };

  function moneyCard(b, role) {
    const total = b.price ? b.price.totalCents : 0;
    const payout = b.payout || null;
    const escrowWords = {
      AWAITING_PAYMENT: 'Not paid yet',
      FUNDED: `Held safely by ${b.escrowProvider || 'our escrow partner'}`,
      HELD: `Held safely by ${b.escrowProvider || 'our escrow partner'}`,
      PARTIALLY_RELEASED: 'Paid to the pro, warranty amount still held',
      RELEASED: 'Paid to the pro',
      FROZEN: 'Frozen while we review',
      REFUNDED: 'Refunded',
    }[b.escrowStatus] || 'Held safely';
    return h('div.receipt', [
      h('div.split-row', [h('span.lbl', 'Total for this job'), h('span.money', money(total))]),
      h('div.split-row', [h('span.lbl', 'Status'), h('span.strong', escrowWords)]),
      payout ? h('div.split-row', [h('span.lbl', 'Released to the pro'), h('span.money', money(payout.amountCents))]) : null,
      payout && payout.holdbackCents ? h('div.split-row', [h('span.lbl', `Warranty holdback${b.warranty && b.warranty.endsAt ? ` · until ${ui.dateShort(b.warranty.endsAt)}` : ''}`), h('span.money', money(payout.holdbackCents))]) : null,
      payout && role === 'PRO' ? h('div.split-row', [h('span.lbl', 'ProVeri fee (10%)'), h('span.money', money(payout.platformFeeCents))]) : null,
      b.price && b.price.priceAssessment && b.price.priceAssessment.headline ? h('div.split-row', [h('span.lbl', 'Fair-price check'), h('span.small', b.price.priceAssessment.headline)]) : null,
      h('div.trust-point', { style: { padding: '12px 0 6px' } }, [h('span.tp-ico', icon('lock', 16)), h('span.small', [h('b', 'Nobody is paid before you confirm.'), role === 'PRO' ? 'The homeowner’s money is already secured, so you will be paid the moment they approve.' : 'If something goes wrong, the money stays put while we sort it out.'])]),
    ]);
  }

  function nextStep(b, role) {
    const pro = firstName((b.pro && b.pro.name) || b.proName);
    const homeowner = firstName(b.customerName);
    const card = (tone, kicker, title, text, actions, extra) => h('div.next-card' + (tone ? '.' + tone : ''), [
      h('div.nc-kicker', kicker),
      h('h2', title),
      text ? h('p', text) : null,
      extra || null,
      actions && actions.length ? h('div.btn-row', actions) : null,
    ]);
    const reload = () => navigate(location.pathname, { replace: true });

    if (role === 'CUSTOMER') {
      switch (b.status) {
        case 'AWARDED':
          return card('action', [icon('lock', 15), 'Your move'], `Pay ${money(b.price.totalCents)} to lock in ${pro}`,
            `Your money is held by ${b.escrowProvider || 'our escrow partner'} — ${pro} is only paid when you approve the finished work.`,
            [h('button.btn.on-dark.lg', { type: 'button', onclick: () => paySheet(b, reload) }, [icon('lock', 18), 'Pay securely'])]);
        case 'SCHEDULED':
        case 'EN_ROUTE':
          return card(b.status === 'EN_ROUTE' ? 'action' : '', [icon(b.status === 'EN_ROUTE' ? 'navigation' : 'calendar', 15), b.status === 'EN_ROUTE' ? `${pro} is on the way` : 'Booked'],
            b.status === 'EN_ROUTE' ? `Arriving in about ${(b.arrival && b.arrival.eta && b.arrival.eta.minutes) || 20} minutes` : `${pro} is coming ${ui.relDayInline(b.schedule && b.schedule.scheduledAt)}`,
            `Before you open the gate, ask ${pro} for their 6-digit arrival code and enter it here. If it does not match, do not let them in.`,
            [h('button.btn.on-dark.lg', { type: 'button', onclick: () => arrivalSheet(b, reload) }, [icon('key', 18), 'Check arrival code'])]);
        case 'ON_SITE':
        case 'STARTED':
        case 'IN_PROGRESS':
          return card('', [icon('tool', 15), 'Work in progress'], `${pro} is working on it`, `When ${pro} uploads photos of the finished job, you will be asked to approve. Until then your money stays held.`);
        case 'AWAITING_CONFIRMATION':
          return card('action', [icon('check-circle', 15), 'Your move'], `${pro} says the job is done`,
            `Check the work${(b.evidence || []).some((e) => e.imageUrl) ? ' and the photos below' : ''}. Approving pays ${pro}; if something is not right, say so and the money stays held.${b.autoReleaseAt ? ` If you do nothing, payment releases automatically ${ui.relDayInline(b.autoReleaseAt)}.` : ''}`,
            [
              h('button.btn.on-dark.lg', { type: 'button', onclick: () => approveSheet(b, reload) }, 'Approve & pay'),
              h('button.btn.on-dark.ghost.lg', { type: 'button', onclick: () => rejectSheet(b, reload) }, 'Something’s not right'),
            ]);
        case 'IN_WARRANTY':
          return card('', [icon('shield', 15), 'All done'], b.reviewId ? 'Thanks — the job is complete' : `How did ${pro} do?`,
            `Workmanship is covered until ${ui.dateShort(b.warranty && b.warranty.endsAt)}. If a problem shows up, report it here and the held amount pays for the fix.`,
            [
              !b.reviewId ? h('button.btn.gold.lg', { type: 'button', onclick: () => reviewSheet(b, reload) }, [icon('star', 18), 'Leave a review']) : null,
              h('button.btn.on-dark.ghost.lg', { type: 'button', onclick: () => defectSheet(b, reload) }, 'Report a problem'),
            ].filter(Boolean));
        case 'DISPUTED':
          return card('bad', [icon('alert', 15), 'Under review'], 'We are looking into this job', 'The money is frozen until it is resolved. Both sides can add evidence; you will get the decision and the reasons in writing.');
        default:
          return null;
      }
    }

    if (role === 'PRO') {
      switch (b.status) {
        case 'AWARDED':
          return card('', [icon('hourglass', 15), 'Waiting'], `Waiting for ${homeowner} to pay`, 'As soon as the money is secured in escrow you will be notified, and the job is guaranteed.');
        case 'SCHEDULED':
          return card('', [icon('calendar', 15), 'Booked'], `${ui.relDay(b.schedule && b.schedule.scheduledAt)} at ${b.address && b.address.suburb ? b.address.suburb : 'the job address'}`,
            `${homeowner} will ask for your arrival code at the door:`,
            [h('button.btn.on-dark.lg', { type: 'button', onclick: () => etaSheet(b, reload) }, [icon('navigation', 18), 'I’m on my way'])],
            gateCode(b));
        case 'EN_ROUTE':
          return card('action', [icon('key', 15), 'At the door'], `Read this code to ${homeowner}`, `${homeowner} types it in to confirm it is really you.`, null, gateCode(b));
        case 'ON_SITE':
          return card('action', [icon('tool', 15), 'You are in'], 'Start the job', 'Starting the job records the time — it protects you if anything is disputed later.',
            [h('button.btn.on-dark.lg', { type: 'button', onclick: async (event) => { try { await withButton(event.currentTarget, () => api.post(`/api/bookings/${b.bookingId}/check-in`, { actorId: b.proId, kind: 'STARTED' })); toast('Job started.', 'ok'); reload(); } catch { /* toasted */ } } }, [icon('play', 18), 'Start the job'])]);
        case 'STARTED':
        case 'IN_PROGRESS':
          return card('action', [icon('camera', 15), 'When you are done'], 'Upload proof and get paid', `Add the photos and documents this job needs. ${homeowner} approves, and you are paid in minutes.`,
            [h('button.btn.on-dark.lg', { type: 'button', onclick: () => evidenceSheet(b, reload) }, [icon('upload', 18), 'Upload proof of work'])]);
        case 'AWAITING_CONFIRMATION':
          return card('', [icon('hourglass', 15), 'Waiting for approval'], `${homeowner} is checking the work`, b.autoReleaseAt ? `If ${homeowner} does not respond, your payment releases automatically ${ui.relDayInline(b.autoReleaseAt)}.` : 'You will be notified the moment it is approved.');
        case 'IN_WARRANTY':
        case 'CLOSED':
          return card('', [icon('check-circle', 15), b.customerReviewId ? 'Paid & rated' : 'Paid'],
            b.customerReviewId ? `Thanks — you rated ${homeowner}` : (b.payout ? `${money(b.payout.amountCents)} paid to you` : 'Job complete'),
            b.payout && b.payout.holdbackCents ? `${money(b.payout.holdbackCents)} warranty holdback releases ${ui.dateShort(b.warranty && b.warranty.endsAt)}.` : null,
            [
              !b.customerReviewId ? h('button.btn.gold.lg', { type: 'button', onclick: () => customerReviewSheet(b, reload) }, [icon('star', 18), `Rate ${homeowner}`]) : null,
              h('a.btn.on-dark.ghost.sm', { href: `/member/${encodeURIComponent(b.customerId)}` }, [icon('user', 15), 'Their profile']),
            ].filter(Boolean));
        case 'DISPUTED':
          return card('bad', [icon('alert', 15), 'Under review'], 'This job is being reviewed', 'Add any photos, messages or documents that show what happened. The decision is made on the sealed record.');
        default:
          return null;
      }
    }
    return null;
  }

  function gateCode(b) {
    return b.arrival && b.arrival.gateCode ? h('div.code', b.arrival.gateCode.replace(/(\d{3})(\d{3})/, '$1 $2')) : null;
  }

  /* ---------------- tracker sheets ---------------- */

  function paySheet(b, done) {
    const method = h('div.options.one', [
      ['card', 'Card', 'Visa, Mastercard — 3-D Secure', 'wallet'],
      ['instant-eft', 'Instant EFT', 'Straight from your banking app', 'bank'],
      ['payshap', 'PayShap', 'Pay with your phone number', 'phone'],
    ].map(([value, t, d, ic], index) => h('label.option' + (index === 0 ? '.selected' : ''), [h('input', { type: 'radio', name: 'paymentMethod', value, checked: index === 0 }), h('span.row', [h('span.o-ico', { style: { marginBottom: 0 } }, icon(ic, 18)), h('span', [h('span.o-t', { style: { display: 'block' } }, t), h('span.o-d', d)])])])));
    method.addEventListener('change', () => { for (const o of Array.from(method.querySelectorAll('.option'))) { const r = o.querySelector('input'); if (r && r.checked) o.classList.add('selected'); else o.classList.remove('selected'); } });
    const remit = h('select', { name: 'remitFrom' }, [['', 'No — paying in rand'], ['GBP', 'British pound (GBP)'], ['USD', 'US dollar (USD)'], ['EUR', 'Euro (EUR)'], ['AUD', 'Australian dollar (AUD)']].map(([v, l]) => h('option', { value: v }, l)));
    const pay = h('button.btn.block.lg', { type: 'button' }, [icon('lock', 18), `Pay ${money(b.price.totalCents)}`]);
    pay.addEventListener('click', async () => {
      const values = formValues(document.getElementById('sheet'));
      try {
        await withButton(pay, () => api.post(`/api/bookings/${b.bookingId}/fund`, { customerId: b.customerId, paymentMethod: values.paymentMethod || 'card', remitFrom: values.remitFrom || undefined }));
        closeSheet();
        toast('Paid. Your money is held safely until you approve the work.', 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('Pay securely', h('div.stack', [
      h('div.receipt', [
        h('div.split-row', [h('span.lbl', b.title), h('span.money', money(b.price.totalCents))]),
        h('div.split-row', [h('span.lbl', 'Held by'), h('span.strong', b.escrowProvider || 'Escrow partner')]),
      ]),
      method,
      h('details.fold', [h('summary', [icon('globe', 18), 'Paying from abroad?']), h('div.fold-body', h('label.field', [h('span', 'Your currency'), remit]))]),
      h('p.tiny.muted', 'Demo server: no real money moves. In production the payment page is run by the escrow partner.'),
    ]), [pay]);
  }

  function arrivalSheet(b, done) {
    const code = h('input.otp-input', { name: 'code', type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'off', placeholder: '••••••', 'aria-label': 'Arrival code' });
    const check = h('button.btn.block.lg', { type: 'button' }, 'Check code');
    const run = async () => {
      try {
        const result = await withButton(check, () => api.post(`/api/bookings/${b.bookingId}/arrival-code`, { customerId: b.customerId, code: code.value.trim() }));
        if (result && result.verified) {
          const u = result.unlock || {};
          sheet('It is really them', h('div.stack', [
            h('div.center', [h('div.success-mark', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' })]),
            h('div.tile', [avatar(u.proFullName || b.proName, 'lg'), h('div.body', [h('div.t', u.proFullName || b.proName), h('div', { style: { marginTop: '6px' } }, ui.trustBadge(u.badge || b.proBadge))])]),
            h('div.trust-points', [
              u.completedJobs ? h('div.trust-point', [h('span.tp-ico', icon('check', 16)), h('span', `${u.completedJobs} jobs completed on ProVeri`)]) : null,
              u.insured ? h('div.trust-point', [h('span.tp-ico', icon('shield', 16)), h('span', 'Insured for public liability')]) : null,
              u.certificationBody ? h('div.trust-point', [h('span.tp-ico', icon('file-check', 16)), h('span', `Registered with ${u.certificationBody}${u.certificateReference ? ` (${u.certificateReference})` : ''}`)]) : null,
            ]),
            h('p.small.muted', 'The visit is now logged. Your money stays held until you approve the finished work.'),
          ]), [h('button.btn.block.lg', { type: 'button', onclick: () => { closeSheet(); done(); } }, 'Let them in')]);
        } else {
          code.value = '';
          code.setAttribute('aria-invalid', 'true');
          toast((result && result.message) || 'That code does not match. Do not let them in.', 'danger');
        }
      } catch { /* toasted */ }
    };
    check.addEventListener('click', run);
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); if (code.value.length === 6) run(); });
    sheet('Check the arrival code', h('div.stack', [
      h('p', `Ask ${firstName(b.proName)} to read out the 6-digit code from their ProVeri app.`),
      code,
      h('div.banner.warn', [h('span.ico', icon('shield', 20)), h('div.small', 'If the code is wrong, keep the gate closed. A real ProVeri pro always has the code.')]),
    ]), [check]);
  }

  function approveSheet(b, done) {
    let stars = 5;
    const starRow = h('div.row', { style: { gap: '6px' }, role: 'radiogroup', 'aria-label': 'Rating' });
    const paintStars = () => {
      starRow.innerHTML = '';
      for (let i = 1; i <= 5; i += 1) {
        starRow.append(h('button', { type: 'button', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, style: { color: i <= stars ? 'var(--sun)' : 'var(--line-2)' }, onclick: () => { stars = i; paintStars(); } }, icon('star', 34, { fill: true, stroke: 1.2 })));
      }
    };
    paintStars();
    const comment = h('textarea', { name: 'comment', rows: '3', placeholder: 'What went well? (optional — shown on their profile)' });
    const approve = h('button.btn.block.lg', { type: 'button' }, `Approve & pay ${firstName(b.proName)}`);
    approve.addEventListener('click', async () => {
      const milestone = (b.milestones || []).find((m) => m.status === 'EVIDENCE_SUBMITTED');
      try {
        await withButton(approve, () => api.post(`/api/bookings/${b.bookingId}/confirm`, { customerId: b.customerId, milestoneId: milestone && milestone.milestoneId, rating: stars, comment: comment.value.trim() || undefined }));
        closeSheet();
        toast(`Done — ${firstName(b.proName)} has been paid. You are covered by the warranty.`, 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('Approve the work', h('div.stack', [
      h('p.muted', `This pays ${firstName(b.proName)} now. ${b.warranty ? `${money(b.warranty.holdbackCents)} is held for ${b.warranty.days} days in case something needs fixing.` : ''}`),
      h('div.field', [h('div.label', 'How was it?'), starRow]),
      h('label.field', [h('span', 'Say something'), comment]),
    ]), [approve]);
  }

  function rejectSheet(b, done) {
    const reason = h('textarea', { name: 'reason', rows: '4', required: true, placeholder: 'e.g. The tap still drips when it is closed.' });
    const send = h('button.btn.block.lg', { type: 'button' }, 'Send to the pro');
    send.addEventListener('click', async () => {
      if (!reason.value.trim()) { reason.setAttribute('aria-invalid', 'true'); reason.focus(); return; }
      const milestone = (b.milestones || []).find((m) => m.status === 'EVIDENCE_SUBMITTED');
      try {
        await withButton(send, () => api.post(`/api/bookings/${b.bookingId}/reject`, { customerId: b.customerId, milestoneId: milestone && milestone.milestoneId, reason: reason.value.trim() }));
        closeSheet();
        toast('Sent. Your money stays held while the pro fixes it.', 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('What needs fixing?', h('div.stack', [
      h('p.muted', `${firstName(b.proName)} is asked to put it right and upload new proof. Your money stays held the whole time.`),
      h('label.field', [h('span', 'What is wrong?'), reason]),
    ]), [send]);
  }

  function reviewSheet(b, done) {
    let stars = 5;
    const row = h('div.row', { style: { gap: '6px' } });
    const paint = () => { row.innerHTML = ''; for (let i = 1; i <= 5; i += 1) row.append(h('button', { type: 'button', 'aria-label': `${i} stars`, style: { color: i <= stars ? 'var(--sun)' : 'var(--line-2)' }, onclick: () => { stars = i; paint(); } }, icon('star', 34, { fill: true, stroke: 1.2 }))); };
    paint();
    const comment = h('textarea', { name: 'comment', rows: '4', placeholder: 'Would you hire them again? What stood out?' });
    const publish = h('button.btn.block.lg.gold', { type: 'button' }, 'Publish review');
    publish.addEventListener('click', async () => {
      if (!comment.value.trim()) { comment.setAttribute('aria-invalid', 'true'); comment.focus(); return; }
      try {
        await withButton(publish, () => api.post(`/api/bookings/${b.bookingId}/reviews`, { customerId: b.customerId, rating: stars, comment: comment.value.trim(), tags: ['escrow_protected'] }));
        closeSheet();
        toast('Thank you — your review is live.', 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet(`Review ${firstName(b.proName)}`, h('div.stack', [
      h('div.banner.ok', [h('span.ico', icon('verified', 20)), h('div.small', 'Marked “verified” because you paid through ProVeri. That is why ratings here cannot be bought.')]),
      row,
      h('label.field', [h('span', 'Your review'), comment]),
    ]), [publish]);
  }

  /** Two-way trust: the pro rates the homeowner, on the homeowner's public profile. */
  function customerReviewSheet(b, done) {
    let stars = 5;
    const row = h('div.row', { style: { gap: '6px' } });
    const paint = () => { row.innerHTML = ''; for (let i = 1; i <= 5; i += 1) row.append(h('button', { type: 'button', 'aria-label': `${i} stars`, style: { color: i <= stars ? 'var(--sun)' : 'var(--line-2)' }, onclick: () => { stars = i; paint(); } }, icon('star', 34, { fill: true, stroke: 1.2 }))); };
    paint();
    const comment = h('textarea', { name: 'comment', rows: '4', placeholder: 'Clear brief? Easy access? Paid on time? Would you work for them again?' });
    const tags = h('div.chip-wrap', { style: { marginTop: '2px' } });
    const picked = new Set();
    ['Clear brief', 'Easy access', 'Friendly household', 'Would work again'].forEach((t) => {
      tags.append(h('button.chip.sm', { type: 'button', onclick: (event) => { if (picked.has(t)) { picked.delete(t); event.currentTarget.classList.remove('active'); } else { picked.add(t); event.currentTarget.classList.add('active'); } } }, t));
    });
    const publish = h('button.btn.block.lg.gold', { type: 'button' }, 'Publish review');
    publish.addEventListener('click', async () => {
      if (!comment.value.trim()) { comment.setAttribute('aria-invalid', 'true'); comment.focus(); return; }
      try {
        await withButton(publish, () => api.post(`/api/bookings/${b.bookingId}/customer-reviews`, { proId: b.proId, rating: stars, comment: comment.value.trim(), tags: [...picked] }));
        closeSheet();
        toast(`Thank you — your review is live on ${firstName(b.customerName)}’s profile.`, 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet(`Review ${firstName(b.customerName)}`, h('div.stack', [
      h('div.banner.ok', [h('span.ico', icon('verified', 20)), h('div.small', `Verified because you were paid through ProVeri escrow. It shows on ${firstName(b.customerName)}’s public member profile — first name and last initial only.`)]),
      row,
      h('label.field', [h('span', 'Your review'), comment, tags]),
    ]), [publish]);
  }

  function defectSheet(b, done) {
    const text = h('textarea', { name: 'description', rows: '4', placeholder: 'What has gone wrong since the job was finished?' });
    const send = h('button.btn.block.lg', { type: 'button' }, 'Report problem');
    send.addEventListener('click', async () => {
      if (!text.value.trim()) { text.focus(); return; }
      try {
        await withButton(send, () => api.post(`/api/bookings/${b.bookingId}/warranty-defect`, { actorId: b.customerId, description: text.value.trim() }));
        closeSheet();
        toast('Reported. The held amount is frozen until it is fixed.', 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('Report a problem', h('div.stack', [
      h('p.muted', `${b.warranty ? `${money(b.warranty.holdbackCents)} is held until ${ui.dateShort(b.warranty.endsAt)}. ` : ''}If ${firstName(b.proName)} does not fix it, that money pays another verified pro to finish the job.`),
      h('label.field', [h('span', 'What is wrong?'), text]),
    ]), [send]);
  }

  function helpSheet(b, role, done) {
    const startedStatuses = ['ON_SITE', 'STARTED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];
    sheet('Get help with this job', h('div.list', [
      h('button.tile', { type: 'button', onclick: () => { closeSheet(); navigate(`/inbox/${encodeURIComponent(`booking.${b.bookingId}`)}`); } }, [h('span.lead.blue', icon('chat', 20)), h('div.body', [h('div.t', `Message ${role === 'PRO' ? firstName(b.customerName) : firstName(b.proName)}`), h('div.d', 'Most things are sorted with a quick message')]), h('span.meta', icon('chevron', 18))]),
      !startedStatuses.includes(b.status) ? h('button.tile', { type: 'button', onclick: () => cancelSheet(b, role, done) }, [h('span.lead.grey', icon('x-circle', 20)), h('div.body', [h('div.t', 'Cancel the booking'), h('div.d', role === 'CUSTOMER' ? 'Free before work starts — your money comes back' : 'The homeowner is refunded in full')]), h('span.meta', icon('chevron', 18))]) : null,
      h('button.tile', { type: 'button', onclick: () => disputeSheet(b, role, done) }, [h('span.lead.red', icon('alert', 20)), h('div.body', [h('div.t', 'Open a dispute'), h('div.d', 'Freezes the money while ProVeri reviews the sealed record')]), h('span.meta', icon('chevron', 18))]),
    ]));
  }

  function cancelSheet(b, role, done) {
    const reason = h('textarea', { name: 'reason', rows: '3', placeholder: 'Optional — helps us improve' });
    const go = h('button.btn.block.lg.danger.solid', { type: 'button' }, 'Cancel booking');
    go.addEventListener('click', async () => {
      try {
        await withButton(go, () => api.post(`/api/bookings/${b.bookingId}/cancel`, { actorId: role === 'PRO' ? b.proId : b.customerId, role, reason: reason.value.trim() || 'Cancelled in the app' }));
        closeSheet();
        toast('Booking cancelled.', 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('Cancel this booking?', h('div.stack', [h('p.muted', 'Before work starts, cancelling is free and any payment is refunded in full (Consumer Protection Act cooling-off).'), h('label.field', [h('span', 'Reason'), reason])]), [go]);
  }

  function disputeSheet(b, role, done) {
    const category = h('select', { name: 'category' }, [['WORK_QUALITY', 'The quality of the work'], ['WORK_INCOMPLETE', 'The work is not finished'], ['NOT_AS_QUOTED', 'Not what was quoted'], ['DAMAGE', 'Something was damaged'], ['NO_SHOW', 'They did not show up'], ['PAYMENT', 'A payment problem'], ['SAFETY', 'I felt unsafe'], ['OTHER', 'Something else']].map(([v, l]) => h('option', { value: v }, l)));
    const description = h('textarea', { name: 'description', rows: '4', placeholder: 'What happened? Dates and details help.' });
    const go = h('button.btn.block.lg.danger.solid', { type: 'button' }, 'Open dispute');
    go.addEventListener('click', async () => {
      if (!description.value.trim()) { description.focus(); return; }
      try {
        await withButton(go, () => api.post(`/api/bookings/${b.bookingId}/disputes`, { openedBy: role === 'PRO' ? b.proId : b.customerId, role, category: category.value, description: description.value.trim() }));
        closeSheet();
        toast('Dispute opened. The money is frozen until it is resolved.', 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('Open a dispute', h('div.stack', [
      h('div.banner.warn', [h('span.ico', icon('scale', 20)), h('div.small', 'The money freezes immediately. Both sides get 72 hours to add evidence, and the decision is made on the sealed record — check-ins, photos, messages and agreed changes.')]),
      h('label.field', [h('span', 'What is it about?'), category]),
      h('label.field', [h('span', 'What happened?'), description]),
    ]), [go]);
  }

  function etaSheet(b, done) {
    const minutes = h('div.chip-wrap', [10, 20, 30, 45, 60].map((m, i) => h('button.chip' + (i === 1 ? '.active' : ''), { type: 'button', dataset: { m: String(m) }, onclick: (event) => { for (const c of Array.from(minutes.querySelectorAll('.chip'))) c.classList.remove('active'); event.currentTarget.classList.add('active'); } }, `${m} min`)));
    const go = h('button.btn.block.lg', { type: 'button' }, [icon('navigation', 18), 'Tell them I’m on my way']);
    go.addEventListener('click', async () => {
      const active = Array.from(minutes.querySelectorAll('.chip')).find((c) => c.classList.contains('active'));
      try {
        await withButton(go, () => api.post(`/api/bookings/${b.bookingId}/eta`, { proId: b.proId, etaMinutes: Number(active ? active.dataset.m : 20) }));
        closeSheet();
        toast(`${firstName(b.customerName)} knows you are on the way.`, 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('How far away are you?', h('div.stack', [minutes, h('p.small.muted', 'We let the homeowner know and remind them to check your arrival code.')]), [go]);
  }

  /** The bundled, clearly-labelled demo photographs, by trade. */
  function demoPhotoFor(categoryId) {
    const map = {
      plumbing: 'burst-pipe-repair', electrical: 'db-board-electrical', painting: 'interior-painting', handyman: 'lounge-repaint',
      'cleaning-home': 'deep-clean', gardening: 'garden-landscaping', 'roofing-gutters': 'roof-gutters', 'solar-inverter': 'solar-inverter',
      'vehicle-inspection': 'vehicle-inspection', 'auto-mechanical': 'brake-service', 'web-digital': 'business-website',
      'electric-fence-security': 'cctv-fence', 'beauty-mobile': 'beauty-kit', 'building-construction': 'bathroom-tiling',
    };
    return `/img/work/${map[categoryId] || 'bathroom-tiling'}.jpg`;
  }

  async function sha256Hex(text) {
    try {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  function evidenceSheet(b, done) {
    const milestone = (b.milestones || []).find((m) => m.status === 'PENDING' || m.status === 'REJECTED') || (b.milestones || [])[0];
    const types = api.state.bundle?.evidenceTypes || [];
    const label = (id) => (types.find((t) => t.id === id) || {}).label || id.replace(/_/g, ' ').toLowerCase();
    const required = (milestone && milestone.requiredEvidence) || ['AFTER_PHOTO', 'PRO_SIGNATURE'];
    const items = {};
    const isPhoto = (id) => /PHOTO/.test(id);
    const rows = h('div.list');

    const paint = () => {
      rows.innerHTML = '';
      for (const id of required) {
        if (id === 'PRO_SIGNATURE' || id === 'CUSTOMER_CONFIRMATION') continue;
        const have = items[id];
        const input = h('input', { type: 'file', accept: isPhoto(id) ? 'image/*' : 'image/*,application/pdf', capture: isPhoto(id) ? 'environment' : null, style: { display: 'none' } });
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if (!file) return;
          try {
            if (/^image\//.test(file.type)) {
              const dataUrl = await ui.compressImage(file, { maxEdge: 1280, maxBytes: 300 * 1024 });
              items[id] = { type: id, imageUrl: dataUrl, hash: await sha256Hex(dataUrl), capturedAt: new Date().toISOString(), note: file.name };
            } else {
              items[id] = { type: id, hash: await sha256Hex(`${file.name}:${file.size}:${file.lastModified}`), capturedAt: new Date().toISOString(), note: file.name };
            }
            paint();
          } catch (e) { toast(ui.friendlyError(e), 'warn'); }
        });
        rows.append(h('div.tile', [
          have && have.imageUrl ? h('span.lead', { style: { padding: 0, overflow: 'hidden' } }, h('img', { src: ui.thumb(have.imageUrl), alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } })) : h('span.lead' + (have ? '' : '.grey'), icon(have ? 'check' : isPhoto(id) ? 'camera' : 'file', 20)),
          h('div.body', [h('div.t', label(id)), h('div.d', have ? (have.illustrative ? 'Demo photo added' : 'Added') : isPhoto(id) ? 'Take or choose a photo' : 'Photo or PDF of the document')]),
          h('div.row', { style: { gap: '6px' } }, [
            !have && isPhoto(id) ? h('button.btn.sm.link', { type: 'button', onclick: async () => { const url = demoPhotoFor(b.categoryId); items[id] = { type: id, imageUrl: url, illustrative: true, hash: await sha256Hex(`${url}:${id}:${Date.now()}`), capturedAt: new Date().toISOString(), note: 'Demo photo' }; paint(); } }, 'Demo') : null,
            h('button.btn.sm' + (have ? '.subtle' : ''), { type: 'button', onclick: () => input.click() }, have ? 'Replace' : 'Add'),
          ]),
          input,
        ]));
      }
    };
    paint();

    const confirm = h('input', { type: 'checkbox', name: 'signature' });
    const note = h('textarea', { name: 'note', rows: '3', placeholder: 'What you did, what you tested, anything to keep an eye on' });
    const submit = h('button.btn.block.lg', { type: 'button' }, 'Send for approval');
    submit.addEventListener('click', async () => {
      const missing = required.filter((id) => id !== 'PRO_SIGNATURE' && id !== 'CUSTOMER_CONFIRMATION' && !items[id]);
      if (missing.length) { toast(`Still needed: ${missing.map(label).join(', ')}`, 'warn'); return; }
      if (required.includes('PRO_SIGNATURE') && !confirm.checked) { toast('Tick the box to sign off the work.', 'warn'); return; }
      const list = Object.values(items);
      if (required.includes('PRO_SIGNATURE')) list.push({ type: 'PRO_SIGNATURE', hash: await sha256Hex(`${b.proId}:${b.bookingId}:${Date.now()}`), capturedAt: new Date().toISOString(), note: `Signed off by ${b.proName} in the app` });
      if (required.includes('CUSTOMER_CONFIRMATION')) list.push({ type: 'CUSTOMER_CONFIRMATION', hash: await sha256Hex(`${b.customerId}:${Date.now()}`), capturedAt: new Date().toISOString(), note: 'Shown to the homeowner on site' });
      try {
        await withButton(submit, () => api.post(`/api/bookings/${b.bookingId}/evidence`, { proId: b.proId, milestoneId: milestone && milestone.milestoneId, items: list, note: note.value.trim() || undefined }));
        closeSheet();
        toast(`Sent. ${firstName(b.customerName)} has been asked to approve.`, 'ok');
        done();
      } catch { /* toasted */ }
    });
    sheet('Upload proof of work', h('div.stack', [
      h('p.small.muted', milestone ? `For: ${milestone.label}. Each item is time-stamped and sealed, so nobody can change it later.` : 'Each item is time-stamped and sealed.'),
      rows,
      required.includes('PRO_SIGNATURE') ? h('label.check-row', [confirm, h('div', [h('div.t', 'I confirm the work is finished as quoted'), h('div.d', `This is your signature on the job (${b.proName}).`)])]) : null,
      h('label.field', [h('span', ['Note to the homeowner ', h('small', 'optional')]), note]),
    ]), [submit]);
  }

  /* ================================================================== *
   * Routes
   * ================================================================== */

  screens['/booking/:bookingId'] = async (ctx) => window.ProVeri.bookingTracker(ctx);

  screens['/bookings'] = async ({ query }) => screens['/orders']({ query });

  screens['/notifications'] = async () => screens['/inbox']({ query: { tab: 'updates' } });

  screens['/profile'] = async () => screens['/me']({ query: {} });

  /* ---------------- /wallet ---------------- */

  screens['/wallet'] = async () => {
    const session = api.session();
    const page = h('div.page.mid');
    page.append(ui.backButton('/me', 'Account'), h('div.page-head', h('div.titles', [h('h1', 'Earnings'), h('p.page-sub', 'What you have been paid, and what is on the way.')])));
    if (!session || session.role !== 'PRO') {
      page.append(ui.empty('wallet', 'Earnings are for pros', 'Join as a pro to get paid through ProVeri — straight to your bank, minutes after the homeowner approves.', h('a.btn', { href: '/become-a-pro' }, 'Join as a pro')));
      return page;
    }
    const [wallet, tax] = await Promise.all([
      api.get(`/api/pros/${encodeURIComponent(session.userId)}/wallet`).catch(() => null),
      api.get(`/api/pros/${encodeURIComponent(session.userId)}/tax-summary`).catch(() => null),
    ]);
    if (!wallet) { page.append(ui.empty('wallet', 'No earnings yet', 'Your first payout appears here.')); return page; }
    page.append(
      h('div.kpis', [
        h('div.kpi', [h('span.k-ico', icon('banknote', 18)), h('span.k-v', money(wallet.receivedCents || 0)), h('span.k-l', 'Paid to you')]),
        h('div.kpi', [h('span.k-ico.blue', icon('lock', 18)), h('span.k-v', money(wallet.heldInEscrowCents || 0)), h('span.k-l', 'Secured in escrow')]),
        h('div.kpi', [h('span.k-ico.gold', icon('shield', 18)), h('span.k-v', money(wallet.pendingHoldbackCents || 0)), h('span.k-l', 'Warranty holdback')]),
        h('div.kpi', [h('span.k-ico', icon('receipt', 18)), h('span.k-v', money(wallet.lifetimePlatformFeesPaidCents || 0)), h('span.k-l', 'ProVeri fees paid')]),
      ]),
      h('div.section', [
        h('h2', { style: { fontSize: '20px', marginBottom: '12px' } }, 'Recent payouts'),
        (wallet.recentTransactions || []).length
          ? h('div.group', wallet.recentTransactions.map((t) => h(t.bookingId ? 'a.tile' : 'div.tile', { href: t.bookingId ? `/booking/${t.bookingId}` : null }, [
            h('span.lead', icon(t.kind === 'PAYOUT' ? 'banknote' : 'receipt', 20)),
            h('div.body', [h('div.t', t.kind === 'PAYOUT' ? 'Payout' : String(t.kind || '').replace(/_/g, ' ').toLowerCase()), h('div.d', `${ui.dateTimeShort(t.at)} · ${t.reference || ''}`)]),
            h('span.money', money(t.amountCents)),
          ])))
          : h('p.muted', 'No payouts yet.'),
      ]),
      tax ? h('div.section', h('details.fold', [h('summary', [icon('file', 18), h('span', ['Tax summary', h('div.sub', 'For your SARS return')])]), h('div.fold-body', h('dl.kv', [
        h('dt', 'Gross earnings'), h('dd', money(tax.grossCents ?? tax.grossEarningsCents ?? 0)),
        h('dt', 'Fees paid'), h('dd', money(tax.platformFeesCents ?? tax.feesCents ?? 0)),
        h('dt', 'Jobs'), h('dd', String(tax.jobs ?? tax.jobCount ?? 0)),
      ]))])) : null,
      h('p.tiny.muted', { style: { marginTop: '18px' } }, 'Payouts go to the bank account verified in your name. Changing it triggers a security hold.'),
    );
    return page;
  };

  /* ---------------- /become-a-pro ---------------- */

  screens['/become-a-pro'] = async () => {
    const session = api.session();
    const page = h('div.page.narrow');
    page.append(ui.backButton('/'));

    if (session && session.role === 'PRO') {
      const profile = await api.get(`/api/pros/${encodeURIComponent(session.userId)}`).catch(() => null);
      page.append(h('div.page-head', h('div.titles', [h('h1', 'Your verification'), h('p.page-sub', 'What homeowners can trust about you, checked by ProVeri.')])));
      if (profile) page.append(verificationStatus(profile, session));
      return page;
    }

    const banks = api.state.bundle?.banks || [];
    const state = { step: 1, values: {} };
    const stepper = h('div.stepper');
    const body = h('div');
    page.append(
      h('div.page-head', h('div.titles', [h('h1', 'Join as a pro'), h('p.page-sub', 'Get hired for the work you have already done. Takes about 3 minutes.')])),
      session ? h('div.banner.info', { style: { marginBottom: '14px' } }, [h('span.ico', icon('info', 20)), h('div.small', `You are signed in as ${session.name} (homeowner). Your pro account is separate, so your business and your home jobs stay apart.`)]) : null,
      stepper, body,
    );

    const paintStepper = () => {
      stepper.innerHTML = '';
      ['About you', 'Your trade', 'Get paid'].forEach((label, index) => {
        const n = index + 1;
        stepper.append(h('div.step-pill' + (n < state.step ? '.done' : n === state.step ? '.current' : ''), [h('span.bar', h('i')), h('span.lbl', [h('span.n', n < state.step ? icon('check', 12, { stroke: 3.2 }) : String(n)), label])]));
      });
    };
    const keep = (form) => Object.assign(state.values, formValues(form));
    const paint = () => {
      paintStepper();
      body.innerHTML = '';
      body.append(state.step === 1 ? stepAbout() : state.step === 2 ? stepTrade() : stepPaid());
      window.scrollTo({ top: 0 });
    };

    function stepAbout() {
      const v = state.values;
      const idInput = h('input', { name: 'idNumber', type: 'text', inputmode: 'numeric', maxlength: '13', autocomplete: 'off', placeholder: '13-digit SA ID number', value: v.idNumber || '' });
      const idHint = h('div.hint', 'Checked against the Home Affairs format. Only a sealed fingerprint is stored — never the number itself.');
      const checkId = async () => {
        const raw = idInput.value.replace(/\s+/g, '');
        if (raw.length !== 13) return;
        try {
          const r = await api.post('/api/verify/sa-id', { idNumber: raw });
          idHint.innerHTML = '';
          idHint.append(r.valid ? h('span', { style: { color: 'var(--brand-ink)', fontWeight: 650 } }, ['✓ Valid South African ID · age ', String(r.age)]) : h('span.field-error', `That ID number does not check out: ${(r.reasons || []).join(', ')}`));
        } catch { /* offline */ }
      };
      idInput.addEventListener('input', () => { idInput.value = idInput.value.replace(/\D/g, '').slice(0, 13); if (idInput.value.length === 13) checkId(); });
      const form = h('form.stack.lg', {
        onsubmit: (event) => {
          event.preventDefault();
          keep(form);
          const missing = ['fullName', 'mobile', 'email', 'idNumber'].filter((k) => !String(state.values[k] || '').trim());
          if (missing.length) { toast('Fill in all four details to continue.', 'warn'); return; }
          if (String(state.values.idNumber).replace(/\D/g, '').length !== 13) { toast('An SA ID number has 13 digits.', 'warn'); return; }
          state.step = 2;
          paint();
        },
      }, [
        h('label.field', [h('span', 'Full name (as on your ID)'), h('input', { name: 'fullName', type: 'text', autocomplete: 'name', required: true, value: v.fullName || (session ? session.name : '') })]),
        h('div.form-grid.two', [
          h('label.field', [h('span', 'Mobile number'), h('input', { name: 'mobile', type: 'tel', autocomplete: 'tel', placeholder: '082 123 4567', required: true, value: v.mobile || '' })]),
          h('label.field', [h('span', 'Email'), h('input', { name: 'email', type: 'email', autocomplete: 'email', placeholder: 'you@example.co.za', required: true, value: v.email || '' })]),
        ]),
        h('label.field', [h('span', ['SA ID number ', h('button.btn.link', { type: 'button', style: { fontSize: '12.5px' }, onclick: async () => { try { const r = await api.get(`/api/demo/synthesise-sa-id?seed=${encodeURIComponent((formValues(form).fullName || 'demo') + Date.now())}&age=34`); idInput.value = r.idNumber; checkId(); } catch { /* offline */ } } }, 'Use a demo ID')]), idInput, idHint]),
        h('button.btn.block.lg', { type: 'submit' }, ['Continue', icon('arrow', 18)]),
        h('p.tiny.muted.center', 'Already have a pro account? Sign in from the account screen with your mobile number.'),
      ]);
      return form;
    }

    function stepTrade() {
      const v = state.values;
      const certBox = h('div');
      const trade = h('select', { name: 'primaryCategory', required: true }, [h('option', { value: '' }, 'Choose your main trade'), ...categories().map((c) => h('option', { value: c.id, selected: v.primaryCategory === c.id ? true : null }, c.label))]);
      const paintCert = () => {
        certBox.innerHTML = '';
        const cat = categoryById(trade.value);
        if (!cat || !cat.statutoryTrade) return;
        certBox.append(h('div.card.gold.stack', [
          h('div.row.top', [icon('file-check', 20), h('div.small', [h('b', `${cat.label}s must be registered by law. `), `Add your ${(cat.regulator && cat.regulator.body) || 'registration'} number — we check it before you can quote on ${cat.label.toLowerCase()} jobs.`])]),
          h('div.form-grid.two', [
            h('label.field', [h('span', 'Registered with'), h('input', { name: 'certBody', type: 'text', value: v.certBody || (cat.regulator && cat.regulator.body) || '', placeholder: 'e.g. PIRB' })]),
            h('label.field', [h('span', 'Registration number'), h('input', { name: 'certNumber', type: 'text', value: v.certNumber || '', placeholder: 'e.g. 123456' })]),
          ]),
        ]));
      };
      trade.addEventListener('change', paintCert);
      const form = h('form.stack.lg', {
        onsubmit: (event) => {
          event.preventDefault();
          keep(form);
          if (!state.values.primaryCategory) { toast('Choose your main trade.', 'warn'); return; }
          if (!state.values.suburbId) { toast('Choose the suburb you work from.', 'warn'); return; }
          state.step = 3;
          paint();
        },
      }, [
        h('label.field', [h('span', 'Main trade'), trade]),
        certBox,
        h('div.form-grid.two', [
          h('label.field', [h('span', 'You work from'), h('select', { name: 'suburbId', required: true }, [h('option', { value: '' }, 'Choose suburb'), ...account().suburbOptions(v.suburbId)])]),
          h('label.field', [h('span', 'Travel up to'), h('select', { name: 'serviceRadiusKm' }, [10, 25, 40, 60, 100].map((km) => h('option', { value: String(km), selected: String(v.serviceRadiusKm || 25) === String(km) ? true : null }, `${km} km`)))]),
        ]),
        h('label.field', [h('span', ['Business name ', h('small', 'optional')]), h('input', { name: 'businessName', type: 'text', value: v.businessName || '', placeholder: 'e.g. Dlamini Plumbing' })]),
        h('label.field', [h('span', ['About you ', h('small', 'optional — shown on your profile')]), h('textarea', { name: 'about', rows: '3', placeholder: 'Years of experience, what you are best at, areas you cover' }, v.about || '')]),
        h('div.btn-row', [h('button.btn.ghost.lg', { type: 'button', onclick: () => { keep(form); state.step = 1; paint(); } }, 'Back'), h('button.btn.lg', { type: 'submit', style: { flex: '2' } }, ['Continue', icon('arrow', 18)])]),
      ]);
      setTimeout(paintCert, 0);
      return form;
    }

    function stepPaid() {
      const v = state.values;
      const submit = h('button.btn.block.lg', { type: 'submit' }, 'Create my pro account');
      const form = h('form.stack.lg', {
        onsubmit: async (event) => {
          event.preventDefault();
          keep(form);
          const values = state.values;
          if (!values.bankCode || !String(values.accountNumber || '').trim()) { toast('Add the bank account you want to be paid into.', 'warn'); return; }
          if (!values.declaration || !values.consent) { toast('Please confirm both declarations.', 'warn'); return; }
          const bank = banks.find((x) => x.code === values.bankCode);
          const idNumber = String(values.idNumber).replace(/\D/g, '');
          try {
            await withButton(submit, async () => {
              const pro = await api.post('/api/pros', {
                fullName: values.fullName, mobile: values.mobile, email: values.email, idNumber,
                primaryCategory: values.primaryCategory, suburbId: values.suburbId, serviceRadiusKm: Number(values.serviceRadiusKm || 25),
                businessName: values.businessName || undefined, about: values.about || undefined,
                tradeCertification: values.certNumber ? { body: values.certBody || undefined, certificateNumber: values.certNumber } : {},
                bankDetails: { bankCode: values.bankCode, accountNumber: String(values.accountNumber).replace(/\s+/g, ''), branchCode: bank ? bank.universalBranchCode : undefined, holderName: values.fullName, accountType: values.accountType || 'SAVINGS' },
                criminalDeclaration: { declared: true, noConvictions: true, disclosures: [] },
              });
              const verified = await api.post(`/api/pros/${pro.proId}/verify`, { idNumber });
              api.setSession({ userId: pro.proId, role: 'PRO', name: (verified.pro && verified.pro.displayName) || pro.displayName || values.fullName });
              body.innerHTML = '';
              stepper.innerHTML = '';
              body.append(welcome(verified));
              window.scrollTo({ top: 0 });
            });
          } catch { /* toasted */ }
        },
      }, [
        h('div.banner.ok', [h('span.ico', icon('banknote', 20)), h('div.small', [h('b', 'Paid minutes after approval. '), 'Straight to your account — no invoices, no chasing. The account must be in your own name.'])]),
        h('label.field', [h('span', 'Bank'), h('select', { name: 'bankCode', required: true }, [h('option', { value: '' }, 'Choose your bank'), ...banks.map((bk) => h('option', { value: bk.code, selected: v.bankCode === bk.code ? true : null }, bk.name))])]),
        h('div.form-grid.two', [
          h('label.field', [h('span', 'Account number'), h('input', { name: 'accountNumber', type: 'text', inputmode: 'numeric', autocomplete: 'off', required: true, value: v.accountNumber || '', placeholder: 'e.g. 1020304050' })]),
          h('label.field', [h('span', 'Account type'), h('select', { name: 'accountType' }, [['SAVINGS', 'Savings'], ['CHEQUE', 'Cheque / current'], ['TRANSMISSION', 'Transmission']].map(([val, l]) => h('option', { value: val, selected: v.accountType === val ? true : null }, l)))]),
        ]),
        h('div.card.flat', [
          h('label.check-row', [h('input', { type: 'checkbox', name: 'declaration', checked: Boolean(v.declaration) }), h('div', [h('div.t', 'I have no criminal convictions'), h('div.d', 'A signed declaration. False declarations remove you from ProVeri.')])]),
          h('label.check-row', [h('input', { type: 'checkbox', name: 'consent', checked: Boolean(v.consent) }), h('div', [h('div.t', 'ProVeri may verify my ID, bank and trade details'), h('div.d', 'Used only for verification, payouts and disputes (POPIA).')])]),
        ]),
        submit,
        h('div.btn-row', [h('button.btn.ghost', { type: 'button', onclick: () => { keep(form); state.step = 2; paint(); } }, 'Back')]),
        h('p.tiny.muted', 'ProVeri charges 10% only on jobs you win and get paid for. No sign-up fee, no lead fees.'),
      ]);
      return form;
    }

    function welcome(result) {
      const pro = result.pro || {};
      const ok = Boolean(pro.canBid);
      return h('div.center', { style: { paddingTop: '10px' } }, [
        h('div.success-mark', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' }),
        h('h1', { style: { fontSize: '30px' } }, ok ? 'You are verified' : 'Your account is ready'),
        h('p.lead-text', { style: { marginTop: '10px' } }, ok ? 'You can quote on jobs near you right away.' : 'A few checks still need attention before you can quote — you can add your work in the meantime.'),
        h('div.card', { style: { textAlign: 'left', marginTop: '20px' } }, checklist(result.trail || [])),
        h('div.btn-row', { style: { marginTop: '20px' } }, [
          h('a.btn.lg', { href: ok ? '/orders' : '/upload-work' }, ok ? 'See jobs to quote on' : 'Add your first work'),
          h('a.btn.ghost.lg', { href: '/' }, 'Go to my dashboard'),
        ]),
      ]);
    }

    paint();
    return page;
  };

  const CHECK_WORDS = {
    sa_id_document: 'South African ID',
    mobile_and_email_otp: 'Phone and email',
    bank_account_verification: 'Bank account in your name',
    cipc_business_status: 'Business registration (CIPC)',
    sars_tax_compliance: 'Tax compliance (SARS)',
    saqa_qualification: 'Qualification (SAQA)',
    trade_certification: 'Trade registration',
    public_liability_insurance: 'Public liability insurance',
    criminal_self_declaration: 'Criminal record declaration',
    platform_history: 'Track record on ProVeri',
  };

  function checklist(trail) {
    const rows = trail.filter((t) => t.status !== 'NOT_APPLICABLE');
    return h('div.trust-points', rows.map((t) => {
      const ok = t.status === 'PASS';
      const optional = t.status === 'UNAVAILABLE';
      return h('div.trust-point' + (ok ? '' : '.plain'), [
        h('span.tp-ico', { style: t.status === 'FAIL' ? { background: 'var(--danger-tint)', color: 'var(--danger)' } : t.status === 'WARN' ? { background: 'var(--warn-tint)', color: 'var(--warn)' } : {} }, icon(ok ? 'check' : t.status === 'FAIL' ? 'x-circle' : optional ? 'dot' : 'hourglass', 16)),
        h('span', [h('b', CHECK_WORDS[t.check] || t.check), h('span.small.muted', ok ? 'Verified' : optional ? 'Optional — add it later to rank higher' : (t.finding || 'Needs attention'))]),
      ]);
    }));
  }

  function verificationStatus(profile, session) {
    const reasons = (profile.explanation && profile.explanation.reasons) || [];
    const box = h('div.stack.lg', [
      h('div.me-card', [
        avatar(session.name, 'lg'),
        h('div.grow', [h('h2', { style: { fontSize: '20px' } }, profile.name || session.name), h('div', { style: { marginTop: '6px' } }, ui.trustBadge(profile.badge, profile.trustScore))]),
      ]),
      profile.verified
        ? h('div.banner.ok', [h('span.ico', icon('check-circle', 20)), h('div', [h('strong', 'You are cleared to quote'), h('div.small', 'Homeowners see your verified badge on every quote.')])])
        : h('div.banner.warn', [h('span.ico', icon('hourglass', 20)), h('div', [h('strong', 'Not cleared to quote yet'), h('div.small', 'The items below need attention. Re-check after you have fixed them.')])]),
      h('div.card', h('div.trust-points', reasons.map((r) => h('div.trust-point' + (r.tone === 'pass' ? '' : '.plain'), [
        h('span.tp-ico', { style: r.tone === 'fail' ? { background: 'var(--danger-tint)', color: 'var(--danger)' } : r.tone === 'warn' ? { background: 'var(--warn-tint)', color: 'var(--warn)' } : {} }, icon(r.tone === 'pass' ? 'check' : r.tone === 'fail' ? 'x-circle' : 'hourglass', 16)),
        h('span.small', r.text),
      ])))),
    ]);
    if (!profile.verified) {
      const idInput = h('input', { name: 'idNumber', type: 'text', inputmode: 'numeric', maxlength: '13', placeholder: 'Your 13-digit ID number' });
      const go = h('button.btn.block', { type: 'button' }, 'Re-check my verification');
      go.addEventListener('click', async () => {
        try {
          const r = await withButton(go, () => api.post(`/api/pros/${session.userId}/verify`, { idNumber: idInput.value.replace(/\D/g, '') || undefined }));
          toast(r.pro && r.pro.canBid ? 'Verified — you can quote now.' : 'Checked. Some items still need attention.', r.pro && r.pro.canBid ? 'ok' : 'warn');
          navigate('/become-a-pro', { replace: true });
        } catch { /* toasted */ }
      });
      box.append(h('div.card.stack', [h('h3', 'Run the checks again'), h('p.small.muted', 'Re-enter your ID number so it can be validated — we only ever keep a sealed fingerprint of it.'), idInput, go]));
    }
    box.append(h('a.btn.ghost.block', { href: `/pro/${session.userId}` }, 'See my public profile'));
    return box;
  }
})();
