/* ==========================================================================
   ProVeri PWA — the marketplace

   /find-a-pro     verified pros, filterable
   /pro/:proId     a pro's shop window: their work first, then the proof
   /job/:jobId     one job — the homeowner compares quotes and books;
                   a pro reads the brief and sends a quote
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
  const metros = () => api.state.bundle?.catalog?.metros || [];

  /* ------------------------------------------------------------------ *
   * /find-a-pro
   * ------------------------------------------------------------------ */

  screens['/find-a-pro'] = async ({ query }) => {
    const page = h('div.page');
    const state = { category: query.category || '', metro: query.metro || '', q: query.q || '' };
    const list = h('div.work-grid', { style: { marginTop: '18px', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' } });
    const count = h('p.page-sub', 'Loading pros…');
    const select = (name, options, label) => h('select', {
      name, 'aria-label': label, style: { width: 'auto', minWidth: '160px', height: '44px', borderRadius: '12px', fontWeight: '600', fontSize: '14.5px' },
      onchange: (event) => { state[name] = event.target.value; load(); },
    }, options.map(([v, l]) => h('option', { value: v, selected: v === state[name] ? true : null }, l)));
    page.append(
      h('div.page-head', h('div.titles', [h('h1', 'Find a verified pro'), count])),
      h('div.row.wrap', { style: { gap: '8px' } }, [
        select('category', [['', 'All services'], ...categories().map((c) => [c.id, tradeName(c.id, c.label)]).sort((a, b) => a[1].localeCompare(b[1]))], 'Service'),
        select('metro', [['', 'All areas'], ...metros().map((m) => [m.id, m.name])], 'Area'),
      ]),
      list,
      h('div.card.accent', { style: { marginTop: '28px' } }, h('div.row', [
        h('div.grow', [h('div.strong', 'Rather have pros come to you?'), h('div.small.muted', 'Post your job once and compare quotes from verified pros nearby.')]),
        h('a.btn.sm', { href: `/post-job${state.category ? `?category=${state.category}` : ''}` }, 'Post a job'),
      ])),
    );
    async function load() {
      list.innerHTML = '';
      ui.skeletonItems(3, 'card').forEach((n) => list.append(n));
      const params = new URLSearchParams();
      if (state.category) params.set('categoryId', state.category);
      if (state.metro) params.set('metroId', state.metro);
      if (state.q) params.set('q', state.q);
      history.replaceState(history.state, '', `/find-a-pro${params.toString() ? `?${params}`.replace('categoryId', 'category').replace('metroId', 'metro') : ''}`);
      let rows = [];
      try { rows = await api.get(`/api/pros?${params}`); } catch (e) { list.innerHTML = ''; list.append(ui.empty('offline', 'Could not load pros', ui.friendlyError(e))); return; }
      list.innerHTML = '';
      count.textContent = rows.length ? `${plural(rows.length, 'verified pro')} — every one ID-checked, with payments protected` : 'No verified pros here yet';
      if (!rows.length) list.append(h('div', { style: { gridColumn: '1 / -1' } }, ui.empty('users', 'No pros match yet', 'Post your job anyway — we will notify pros as they join your area.', h('a.btn', { href: '/post-job' }, 'Post a job'))));
      rows.forEach((p) => list.append(window.ProVeri.proCard(p)));
    }
    load();
    return page;
  };

  /* ------------------------------------------------------------------ *
   * /pro/:proId — the shop window
   * ------------------------------------------------------------------ */

  screens['/pro/:proId'] = async ({ params }) => {
    const [pro, work] = await Promise.all([
      api.get(`/api/pros/${encodeURIComponent(params.proId)}`),
      api.get(`/api/pros/${encodeURIComponent(params.proId)}/portfolio`).catch(() => []),
    ]);
    const session = api.session();
    const isMe = session && session.userId === pro.proId;
    const first = firstName(pro.name);
    const ratings = pro.ratings || {};
    const stats = pro.stats || {};
    const verifiedWork = (work || []).filter((i) => i.verified).length;
    const page = h('div.page.mid');

    page.append(
      h('div.profile-cover'),
      h('div.profile-head', [
        avatar(pro.name, 'xl'),
        h('div', [
          h('h1', pro.name),
          h('div.muted', { style: { marginTop: '4px' } }, `${pro.primaryCategoryLabel || ''}${pro.location && pro.location.suburb ? ` · ${pro.location.suburb}` : ''}${pro.location && pro.location.serviceRadiusKm ? ` · travels ${pro.location.serviceRadiusKm} km` : ''}`),
          h('div.row.wrap', { style: { gap: '6px', marginTop: '10px' } }, [
            ui.trustBadge(pro.badge),
            pro.insurance && (pro.insurance.insured || pro.insurance.provider) ? ui.badge('Insured', 'neutral', 'shield') : null,
            pro.certificationBody ? ui.badge(`Registered · ${pro.certificationBody}`, 'neutral', 'file-check') : null,
          ]),
        ]),
      ]),
      h('div.stat-row', { style: { marginTop: '18px' } }, [
        h('div', [h('div.v', [icon('star', 18, { fill: true }), ratings.average ? Number(ratings.average).toFixed(1) : 'New']), h('div.l', ratings.count ? plural(ratings.count, 'verified review') : 'No reviews yet')]),
        h('div', [h('div.v', String(stats.completedJobs || 0)), h('div.l', 'Jobs on ProVeri')]),
        h('div', [h('div.v', stats.onTimePercent != null ? `${stats.onTimePercent}%` : '—'), h('div.l', 'On time')]),
      ]),
      isMe
        ? h('div.btn-row', { style: { marginTop: '16px' } }, [h('a.btn', { href: '/upload-work' }, [icon('plus', 18), 'Add work']), h('button.btn.ghost', { type: 'button', onclick: () => ui.share({ title: pro.name, text: `${pro.name} on ProVeri`, url: location.href }) }, [icon('share', 18), 'Share profile'])])
        : null,
    );

    if (pro.about) page.append(h('div.section.tight', h('p.lead-text', { style: { fontSize: '16px' } }, pro.about)));

    page.append(h('section.section', [
      ui.sectionHead(`Work by ${first}`, null, null, work.length ? `${plural(verifiedWork, 'verified job')} · ${work.length - verifiedWork} uploaded by the pro` : null),
      work.length
        ? h('div.work-grid', work.map((i) => window.ProVeri.workCard(i, { mini: true, hidePro: true })))
        : h('p.muted', `${first} has not published any work yet. Jobs finished on ProVeri appear here automatically.`),
    ]));

    const reasons = (pro.explanation && pro.explanation.reasons) || [];
    page.append(h('section.section', [
      ui.sectionHead('What ProVeri checked', null, null, 'Checked by us, not claimed by them.'),
      h('div.card', h('div.trust-points', reasons.length ? reasons.map((r) => h('div.trust-point' + (r.tone === 'pass' ? '' : '.plain'), [
        h('span.tp-ico', icon(r.tone === 'pass' ? 'check' : r.tone === 'fail' ? 'x-circle' : 'info', 16)),
        h('span.small', String(r.text || '').replace(/ — verified via .*$/, '')),
      ])) : [h('p.muted', 'Verification details are not available.')])),
      pro.statutoryTrade && pro.regulator ? h('p.small.muted', { style: { marginTop: '10px' } }, `${pro.primaryCategoryLabel} is a regulated trade: ${typeof pro.regulator === 'string' ? pro.regulator : pro.regulator.body || ''}.`) : null,
    ]));

    const reviews = pro.recentReviews || [];
    page.append(h('section.section', [
      ui.sectionHead('Reviews', null, null, 'Only homeowners who paid through ProVeri can review.'),
      reviews.length
        ? h('div.card', reviews.slice(0, 6).map((r) => h('div.review', [
          h('div.who', [
            avatar(r.customerName || r.authorName || 'Homeowner', 'sm'),
            r.customerId
              ? h('a.grow', { href: `/member/${encodeURIComponent(r.customerId)}`, style: { color: 'var(--ink)', fontWeight: 650 } }, [r.customerName || r.authorName || 'Homeowner', icon('chevron', 13)])
              : h('span.grow', r.customerName || r.authorName || 'Homeowner'),
            ui.starRow(r.rating),
          ]),
          r.comment || r.text ? h('p', r.comment || r.text) : null,
          h('div.tiny.muted', { style: { marginTop: '6px' } }, timeAgo(r.createdAt || r.at)),
        ])))
        : h('p.muted', 'No reviews yet.'),
    ]));

    if (!isMe) {
      page.append(h('div.cta-bar', h('div.cta-inner', [
        h('div.cta-info', [h('span.strong', pro.name), h('span.tiny', ratings.average ? `★ ${Number(ratings.average).toFixed(1)} · ${stats.completedJobs || 0} jobs` : 'Verified on ProVeri')]),
        h('a.btn', { href: `/post-job?proId=${encodeURIComponent(pro.proId)}&category=${encodeURIComponent(pro.primaryCategory || '')}` }, `Get a quote`),
      ])));
    }
    return page;
  };

  /* ------------------------------------------------------------------ *
   * /member/:customerId — a homeowner's public profile.
   * Two-way trust: pros who were paid through escrow rate the homeowner,
   * and those reviews live here for any pro to read before quoting.
   * ------------------------------------------------------------------ */

  screens['/member/:customerId'] = async ({ params }) => {
    const m = await api.get(`/api/customers/${encodeURIComponent(params.customerId)}/public-profile`);
    const page = h('div.page.mid');
    const ratings = m.ratings || {};

    page.append(
      ui.backButton('/', 'Back'),
      h('div.row.top', { style: { gap: '14px', marginTop: '6px' } }, [
        avatar(m.displayName, 'lg'),
        h('div.grow', [
          h('h1', { style: { fontSize: '25px' } }, m.displayName),
          h('div.small.muted', { style: { marginTop: '4px' } }, [m.suburb || 'South Africa', m.memberSince ? ` · member since ${ui.dateShort(m.memberSince)}` : '']),
          ratings.count ? h('div.row', { style: { gap: '6px', marginTop: '6px', alignItems: 'center' } }, [ui.starRow(ratings.average), h('span.small.muted', `${ratings.count} ${ratings.count === 1 ? 'review' : 'reviews'} from verified pros`)]) : null,
        ]),
      ]),
    );

    if (m.stats && (m.stats.jobsPosted || m.stats.jobsCompleted)) {
      page.append(h('div.stat-row', { style: { marginTop: '16px' } }, [
        h('div', [h('div.v', String(m.stats.jobsCompleted || 0)), h('div.l', 'Jobs completed')]),
        h('div', [h('div.v', String(m.stats.jobsPosted || 0)), h('div.l', 'Jobs posted')]),
        h('div', [h('div.v', ratings.count ? Number(ratings.average).toFixed(1) : '—'), h('div.l', 'Pro rating')]),
      ]));
    }

    page.append(h('section.section', [
      ui.sectionHead(`Reviews from pros`, null, null, 'Only pros who were paid through ProVeri escrow can review a homeowner — the same rule as pro reviews.'),
      (m.reviews || []).length
        ? h('div.card', m.reviews.map((r) => h('div.review', [
          h('div.who', [
            avatar(r.proName, 'sm'),
            r.proId ? h('a.grow', { href: `/pro/${encodeURIComponent(r.proId)}`, style: { color: 'var(--ink)', fontWeight: 650 } }, [r.proName, icon('chevron', 13)]) : h('span.grow', r.proName),
            ui.starRow(r.rating),
          ]),
          r.comment ? h('p', r.comment) : null,
          h('div.tiny.muted', { style: { marginTop: '6px' } }, [r.categoryLabel ? `${r.categoryLabel} · ` : '', timeAgo(r.createdAt), r.verified ? ' · verified job' : '']),
        ])))
        : ui.empty('star', 'No reviews yet', 'When a pro finishes and gets paid for a job through ProVeri, they can rate the homeowner here.'),
    ]));

    page.append(h('p.small.muted', { style: { padding: '0 2px 18px' } }, [icon('lock', 13), ` ${m.privacyNote || 'Contact details are never shown on public profiles.'}`]));
    return page;
  };

  /* ------------------------------------------------------------------ *
   * /job/:jobId
   * ------------------------------------------------------------------ */

  screens['/job/:jobId'] = async ({ params, query }) => {
    const session = api.session();
    const viewer = session ? session.userId : '';
    const job = await api.get(`/api/jobs/${encodeURIComponent(params.jobId)}?viewerId=${encodeURIComponent(viewer)}`);
    const isOwner = session && session.userId === job.customerId;
    const isPro = session && session.role === 'PRO';
    const open = ['OPEN', 'BIDDING'].includes(job.status);
    const page = h('div.page.mid');
    const reload = () => navigate(`/job/${job.jobId}`, { replace: true });

    page.append(
      ui.backButton(isPro ? '/orders' : '/orders', isPro ? 'Leads & jobs' : 'Your jobs'),
      h('div.row.top', { style: { gap: '12px', marginTop: '6px' } }, [
        tradeIcon(job.categoryId, 'lg'),
        h('div.grow', [
          h('h1', { style: { fontSize: '25px' } }, job.title),
          h('div.small.muted', { style: { marginTop: '4px' } }, `${job.categoryLabel} · ${job.location && job.location.suburb ? job.location.suburb : ''} · posted ${timeAgo(job.postedAt)}`),
        ]),
      ]),
      h('div.row.wrap', { style: { gap: '8px', margin: '12px 0 4px' } }, [
        ui.statusPill(ui.jobWords(job.status, job.bidCount)),
        h('span.fact', [icon('clock', 14), job.urgencyLabel || 'Flexible']),
        job.statutoryTrade ? h('span.fact', [icon('file-check', 14), 'Certificate required']) : null,
      ]),
    );

    if (isOwner) ownerView(page, job, session, reload);
    else if (isPro) proView(page, job, session, reload, query);
    else visitorView(page, job, session);

    return page;
  };

  function briefCard(job, { forPro } = {}) {
    const band = job.priceBand && job.priceBand.format;
    const photos = (job.photos || []).filter((p) => p.url || p.dataUrl);
    return h('div.card', [
      h('h3', forPro ? 'The brief' : 'Your job'),
      photos.length ? h('div.thumbs', { style: { marginTop: '10px' } }, photos.slice(0, 6).map((p) => h('div.thumb', [photoImg(p.url || p.dataUrl, p.caption || 'Job photo'), p.caption ? h('span.cover', p.caption) : null]))) : null,
      h('p', { style: { marginTop: '8px', whiteSpace: 'pre-line', color: 'var(--ink-2)' } }, job.description),
      h('dl.kv', { style: { marginTop: '14px' } }, [
        h('dt', 'Where'), h('dd', [job.location && job.location.suburb ? job.location.suburb : '—', forPro ? '' : (job.location && job.location.addressText && job.location.addressText !== job.location.suburb ? ` · ${job.location.addressText}` : '')]),
        h('dt', 'When'), h('dd', [job.urgencyLabel || 'Flexible', (job.preferredDates || []).length ? ` · from ${ui.relDay(job.preferredDates[0])}` : '']),
        job.budget && job.budget.statedCents ? h('dt', 'Budget') : null, job.budget && job.budget.statedCents ? h('dd', money(job.budget.statedCents)) : null,
        band ? h('dt', 'Typical price') : null, band ? h('dd', `${band.low} – ${band.high}`) : null,
      ]),
    ]);
  }

  function contextBanners(job) {
    const out = [];
    if (job.loadSheddingAdvice && job.loadSheddingAdvice.advice) out.push(h('div.banner.info', [h('span.ico', icon('zap', 20)), h('div.small', job.loadSheddingAdvice.advice)]));
    if (job.weatherAdvice && job.weatherAdvice.sensitive && job.weatherAdvice.advice) out.push(h('div.banner.' + (job.weatherAdvice.verdict === 'POSTPONE' ? 'warn' : 'info'), [h('span.ico', icon('sun', 20)), h('div.small', job.weatherAdvice.advice)]));
    return out.length ? h('div.stack.sm', { style: { marginTop: '12px' } }, out) : null;
  }

  /* ---- the homeowner: compare and book ---- */
  function ownerView(page, job, session, reload) {
    const bids = (job.bids || []).filter((b) => !b.masked && b.status !== 'WITHDRAWN');
    page.append(h('div.card', { style: { padding: '18px 14px 16px', marginTop: '14px' } }, ui.tracker(job.bookingId ? 2 : 0)));

    if (job.status === 'CANCELLED') {
      page.append(h('div.banner.warn', { style: { marginTop: '14px' } }, [h('span.ico', icon('x-circle', 20)), h('div.small', [h('b', 'You cancelled this job. '), 'Every quote was closed and the pros were told. Nothing was charged.', h('div', { style: { marginTop: '8px' } }, h('a.btn.sm', { href: `/post-job?category=${encodeURIComponent(job.categoryId)}&title=${encodeURIComponent(job.title || '')}` }, [icon('plus', 15), 'Post it again']))])]));
      page.append(h('div.section', briefCard(job)));
      return;
    }

    if (job.bookingId) {
      page.append(h('div.section.tight', h('a.order-card', { href: `/order/${job.bookingId}` }, [
        h('div.oc-top', [icon('check-circle', 22), h('div.grow', [h('div.oc-title', 'You have booked a pro for this job'), h('div.oc-sub', 'Payments, the arrival code and progress live on the job tracker.')])]),
        h('div.oc-next.action', [icon('route', 18), h('span.grow', 'Open the job tracker'), icon('chevron', 18)]),
      ])));
      page.append(h('div.section', briefCard(job)));
      return;
    }

    const sorted = bids.slice().sort((a, b) => a.totalCents - b.totalCents);
    const best = sorted.find((b) => /VERIFIED|ELITE/.test(b.proBadge || '')) || sorted[0];
    page.append(h('section.section', [
      ui.sectionHead(bids.length ? `${plural(bids.length, 'quote')} for you` : 'Quotes', null, null, bids.length ? 'Every pro here is ID-verified. Prices are checked against what this job usually costs.' : null),
      bids.length
        ? h('div.stack', sorted.map((bid) => quoteCard(job, bid, session, bid === best && sorted.length > 1, reload)))
        : h('div.card.center', { style: { padding: '28px 20px' } }, [
          h('div.empty', { style: { padding: '0' } }, [
            h('div.ico', icon('hourglass', 28)),
            h('h3', 'Waiting for quotes'),
            h('p', `${(job.matchedProIds || []).length ? `We told ${plural(job.matchedProIds.length, 'verified pro')} nearby about your job. ` : 'We are telling verified pros nearby about your job. '}Quotes usually arrive within a few hours — we will notify you.`),
          ]),
          h('div.btn-row', { style: { justifyContent: 'center', marginTop: '16px' } }, [h('a.btn.ghost', { href: `/browse?category=${job.categoryId}` }, `See ${tradeName(job.categoryId).toLowerCase()} work nearby`)]),
        ]),
      bids.length && open(job) ? h('button.btn.subtle.sm', { type: 'button', style: { marginTop: '14px' }, onclick: () => beatTheQuote(job, sorted[0]) }, [icon('trend', 16), 'Ask more pros to beat the best price']) : null,
    ]));
    page.append(h('div.section', [briefCard(job), contextBanners(job)]));

    // Changed your mind? One tap, free, and every quoting pro is told.
    if (open(job)) {
      page.append(h('div.center', { style: { padding: '2px 0 20px' } },
        h('button.btn.subtle.sm', { type: 'button', style: { color: 'var(--danger)' }, onclick: () => cancelJobSheet(job, session, reload) }, [icon('x-circle', 16), 'Cancel this job'])));
    }
  }

  function cancelJobSheet(job, session, reload) {
    const reason = h('input', { name: 'reason', type: 'text', placeholder: 'Found someone, fixed it myself… (optional)' });
    const go = h('button.btn.block.lg.danger.solid', { type: 'button' }, 'Cancel my job');
    go.addEventListener('click', async () => {
      try {
        await withButton(go, () => api.post(`/api/jobs/${job.jobId}/cancel`, { customerId: session.userId, reason: reason.value.trim() || undefined }));
        closeSheet();
        toast('Job cancelled — every pro who quoted has been told.', 'ok');
        reload();
      } catch { /* toasted */ }
    });
    sheet('Cancel this job?', h('div.stack', [
      h('p', 'Your job closes straight away. It is free, nothing is charged to anyone, and you can post it again any time.'),
      job.bidCount ? h('p.small.muted', `${plural(job.bidCount, 'pro')} who quoted will be notified that the job is closed.`) : null,
      h('label.field', [h('span', ['Why? ', h('small', 'optional — it helps us improve')]), reason]),
    ]), [go]);
  }

  function open(job) { return ['OPEN', 'BIDDING'].includes(job.status); }

  function quoteCard(job, bid, session, isBest, reload) {
    const verdict = bid.priceAssessment || {};
    const good = /BELOW|FAIR|WITHIN|MEDIAN/.test(verdict.verdict || '') && !/WELL_BELOW/.test(verdict.verdict || '');
    return h('div.quote-card' + (isBest ? '.best' : ''), [
      isBest ? h('span.ribbon.badge.verified.lg', [icon('award', 14), 'Best value']) : null,
      h('div.q-top', [
        avatar(bid.proName, 'lg'),
        h('div.grow', { style: { minWidth: 0 } }, [
          h('a.strong', { href: `/pro/${bid.proId}`, style: { color: 'var(--ink)' } }, bid.proName),
          h('div', { style: { marginTop: '4px' } }, ui.trustBadge(bid.proBadge)),
        ]),
        h('div.q-price', [h('span.money', money(bid.totalCents)), h('span.tiny.muted', 'all in')]),
      ]),
      h('div.q-facts', [
        bid.scheduledAt ? h('span.fact', [icon('calendar', 14), `Can start ${ui.relDay(bid.scheduledAt)}`]) : null,
        bid.durationHours ? h('span.fact', [icon('clock', 14), `About ${plural(bid.durationHours, 'hour')}`]) : null,
        h('span.fact', [icon('shield', 14), `${bid.warrantyDays || 14}-day warranty`]),
        bid.includesCoc ? h('span.fact.good', [icon('file-check', 14), 'Certificate included']) : null,
        verdict.headline ? h('span.fact' + (good ? '.good' : /WELL_BELOW|ABOVE/.test(verdict.verdict || '') ? '.warn' : ''), [icon('trend', 14), verdict.headline]) : null,
      ]),
      bid.message || bid.scopeOfWork ? h('div.q-msg', [bid.message ? h('div', `“${bid.message}”`) : null, bid.scopeOfWork ? h('div.small.muted', { style: { marginTop: bid.message ? '6px' : 0 } }, ['Includes: ', bid.scopeOfWork]) : null]) : null,
      verdict.advice && /WELL_BELOW|ABOVE/.test(verdict.verdict || '') ? h('p.small.muted', { style: { marginTop: '10px' } }, verdict.advice) : null,
      open(job) ? h('div.btn-row', [
        h('button.btn', { type: 'button', onclick: () => acceptSheet(job, bid, session, reload) }, `Accept & pay ${money(bid.totalCents)}`),
        h('a.btn.ghost', { href: `/pro/${bid.proId}` }, 'View profile'),
      ]) : null,
    ]);
  }

  function acceptSheet(job, bid, session, reload) {
    const method = h('select', { name: 'paymentMethod' }, [['card', 'Card'], ['instant-eft', 'Instant EFT'], ['payshap', 'PayShap']].map(([v, l]) => h('option', { value: v }, l)));
    const pay = h('button.btn.block.lg', { type: 'button' }, [icon('lock', 18), `Pay ${money(bid.totalCents)} securely`]);
    pay.addEventListener('click', async () => {
      let booking = null;
      try {
        await withButton(pay, async () => {
          booking = await api.post('/api/bookings', { jobId: job.jobId, bidId: bid.bidId, customerId: session.userId });
          await api.post(`/api/bookings/${booking.bookingId}/fund`, { customerId: session.userId, paymentMethod: method.value });
        });
        closeSheet();
        toast(`Booked! ${firstName(bid.proName)} is confirmed and your money is held safely.`, 'ok');
        navigate(`/order/${booking.bookingId}`);
      } catch {
        if (booking) { closeSheet(); navigate(`/order/${booking.bookingId}`); }
      }
    });
    sheet(`Book ${firstName(bid.proName)}`, h('div.stack', [
      h('div.receipt', [
        h('div.split-row', [h('span.lbl', job.title), h('span.money', money(bid.totalCents))]),
        h('div.split-row', [h('span.lbl', 'Released when you approve'), h('span', money(Math.round(bid.totalCents * 0.95)))]),
        h('div.split-row', [h('span.lbl', `Held for the ${bid.warrantyDays || 14}-day warranty`), h('span', money(Math.round(bid.totalCents * 0.05)))]),
      ]),
      h('div.trust-points', [
        h('div.trust-point', [h('span.tp-ico', icon('lock', 16)), h('span.small', [h('b', 'Held in escrow, not paid yet. '), `${firstName(bid.proName)} is paid only when you approve the finished job.`])]),
        h('div.trust-point', [h('span.tp-ico', icon('key', 16)), h('span.small', [h('b', 'Arrival code. '), 'On the day, check their code at the door before you let them in.'])]),
        h('div.trust-point', [h('span.tp-ico', icon('refresh', 16)), h('span.small', [h('b', 'Free to cancel '), 'before work starts.'])]),
      ]),
      h('label.field', [h('span', 'Pay with'), method]),
      h('p.tiny.muted', 'Demo server: no real money moves.'),
    ]), [pay]);
  }

  function beatTheQuote(job, target) {
    const go = h('button.btn.block.lg', { type: 'button' }, 'Invite more quotes');
    go.addEventListener('click', async () => {
      try {
        const result = await withButton(go, () => api.post(`/api/jobs/${job.jobId}/beat-the-quote`, { targetBidId: target.bidId, windowHours: 24 }));
        closeSheet();
        toast(`${plural((result.invitedProIds || []).length || 6, 'more pro')} invited to beat ${money(target.totalCents)}.`, 'ok');
      } catch { /* toasted */ }
    });
    sheet('Ask more pros to beat the price', h('div.stack', [
      h('p', `We invite up to 6 more verified ${tradeName(job.categoryId).toLowerCase()} pros to beat ${money(target.totalCents)} within 24 hours. Your current quotes stay valid.`),
      h('p.small.muted', 'No haggling, no phone calls — just more verified pros competing for your job.'),
    ]), [go]);
  }

  /* ---- a pro: read the brief, send a quote ---- */
  function proView(page, job, session, reload, query) {
    const mine = (job.bids || []).find((b) => !b.masked && b.proId === session.userId && b.status !== 'WITHDRAWN');
    const summary = job.bidSummary || {};
    page.append(h('div.section.tight', briefCard(job, { forPro: true })), contextBanners(job));
    page.append(h('div.section.tight', h('div.card.flat', h('div.row.wrap', { style: { gap: '18px' } }, [
      h('div', [h('div.tiny.muted', 'Quotes so far'), h('div.strong', String(summary.count || job.bidCount || 0))]),
      job.priceBand && job.priceBand.format ? h('div', [h('div.tiny.muted', 'Typical price'), h('div.strong', job.priceBand.format.typical)]) : null,
      h('div', [h('div.tiny.muted', 'Homeowner'), h('div.strong', firstName(job.customerName) || 'Verified homeowner')]),
    ]))));

    if (mine) {
      page.append(h('div.section.tight', h('div.next-card', [
        h('div.nc-kicker', [icon('check-circle', 15), 'Quote sent']),
        h('h2', `You quoted ${money(mine.totalCents)}`),
        h('p', `${firstName(job.customerName) || 'The homeowner'} is comparing quotes. You will be notified the moment they choose.`),
      ])));
      return;
    }
    if (!open(job)) {
      page.append(h('div.banner.info', { style: { marginTop: '14px' } }, [h('span.ico', icon('info', 20)), h('div.small', 'This job is no longer taking quotes.')]));
      return;
    }
    page.append(h('div.cta-bar', h('div.cta-inner', [
      h('div.cta-info', [h('span.strong', 'Interested?'), h('span.tiny', 'Send a fixed price — homeowners book in one tap')]),
      h('button.btn', { type: 'button', onclick: () => quoteSheet(job, session, reload) }, [icon('send', 18), 'Send a quote']),
    ])));
    if (query.quote === '1') setTimeout(() => quoteSheet(job, session, reload), 250);
  }

  function quoteSheet(job, session, reload) {
    const band = job.priceBand || {};
    const typical = band.p50Cents ? Math.round(band.p50Cents / 100) : '';
    const price = h('input', { name: 'total', type: 'number', inputmode: 'numeric', min: '50', step: '10', required: true, value: String(typical), style: { fontSize: '22px', fontWeight: 750 } });
    const hint = h('div.hint');
    const takeHome = h('div.small.muted');
    const paintHint = () => {
      const cents = Math.round(Number(price.value || 0) * 100);
      takeHome.textContent = cents ? `You receive ${money(Math.round(cents * 0.9))} after ProVeri’s 10% fee — paid minutes after approval.` : '';
      if (!cents || !band.p10Cents) { hint.textContent = band.format ? `Typical for this job: ${band.format.low} – ${band.format.high}` : ''; return; }
      if (cents < band.p10Cents) hint.textContent = `Lower than most quotes (${band.format.low}–${band.format.high}). Make sure materials are covered.`;
      else if (cents > band.p90Cents) hint.textContent = `Higher than most quotes (${band.format.low}–${band.format.high}). Explain what is included in your message.`;
      else hint.textContent = `Within the usual range for this job (${band.format.low}–${band.format.high}).`;
    };
    price.addEventListener('input', paintHint);
    paintHint();

    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(9, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const localValue = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T09:00`;
    let warranty = 30;
    const warrantyChips = h('div.chip-wrap', [14, 30, 90].map((d) => h('button.chip' + (d === warranty ? '.active' : ''), { type: 'button', onclick: (event) => { warranty = d; for (const c of Array.from(warrantyChips.querySelectorAll('.chip'))) c.classList.remove('active'); event.currentTarget.classList.add('active'); } }, `${d} days`)));
    const send = h('button.btn.block.lg', { type: 'button' }, [icon('send', 18), 'Send quote']);
    const form = h('div.stack', [
      h('label.field', [h('span', 'Your price, all in'), h('div.input-prefix', [h('b', 'R'), price]), hint]),
      h('label.field', [h('span', 'You can start'), h('input', { name: 'scheduledAt', type: 'datetime-local', value: localValue })]),
      h('label.field', [h('span', 'It will take'), h('select', { name: 'durationHours' }, [[1, 'About 1 hour'], [2, 'About 2 hours'], [4, 'Half a day'], [8, 'A full day'], [16, 'Two days'], [40, 'About a week']].map(([v, l]) => h('option', { value: String(v), selected: v === 2 ? true : null }, l)))]),
      h('div.field', [h('div.label', 'Workmanship warranty'), warrantyChips]),
      job.requiresCoc ? h('label.check-row', [h('input', { type: 'checkbox', name: 'includesCoc', checked: true }), h('div', [h('div.t', `${job.cocName || 'Certificate of Compliance'} included`), h('div.d', 'Required by law for this job')])]) : null,
      h('label.field', [h('span', 'What is included'), h('textarea', { name: 'scopeOfWork', rows: '3', placeholder: 'e.g. Remove old geyser, supply and fit 150L geyser, new valves, test and CoC' })]),
      h('label.field', [h('span', ['Message to the homeowner ', h('small', 'optional')]), h('textarea', { name: 'message', rows: '2', placeholder: 'Introduce yourself in a line or two' })]),
      takeHome,
    ]);
    send.addEventListener('click', async () => {
      const values = formValues(form);
      const totalCents = Math.round(Number(values.total || 0) * 100);
      if (!totalCents) { price.setAttribute('aria-invalid', 'true'); price.focus(); return; }
      try {
        await withButton(send, () => api.post(`/api/jobs/${job.jobId}/bids`, {
          proId: session.userId,
          totalCents,
          scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : undefined,
          durationHours: Number(values.durationHours || 2),
          warrantyDays: warranty,
          includesCoc: Boolean(values.includesCoc),
          scopeOfWork: values.scopeOfWork || undefined,
          message: values.message || undefined,
        }));
        closeSheet();
        toast(`Quote sent to ${firstName(job.customerName) || 'the homeowner'}.`, 'ok');
        reload();
      } catch (e) {
        if (/verification|KYC|verified identity/i.test(String(e && e.message))) {
          setTimeout(() => toast('Finish your verification to start quoting.', 'warn', { label: 'Continue', onClick: () => { closeSheet(); navigate('/become-a-pro'); } }), 300);
        }
      }
    });
    sheet('Send a quote', form, [send], { sub: job.title });
  }

  /* ---- anyone else ---- */
  function visitorView(page, job, session) {
    page.append(h('div.section.tight', briefCard(job, { forPro: true })));
    if (!session) {
      page.append(h('div.card.accent', { style: { marginTop: '14px' } }, h('div.row', [
        h('div.grow', [h('div.strong', 'Are you a pro?'), h('div.small.muted', 'Sign in with your pro account to quote on this job.')]),
        h('button.btn.sm', { type: 'button', onclick: () => account().openSignIn({ role: 'PRO', reason: 'Sign in to your pro account.' }) }, 'Sign in'),
      ])));
    } else {
      page.append(h('div.banner.info', { style: { marginTop: '14px' } }, [h('span.ico', icon('info', 20)), h('div.small', 'This job belongs to another homeowner. Only verified pros can quote on it.')]));
    }
  }
})();
