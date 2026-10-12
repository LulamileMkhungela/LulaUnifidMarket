/* ==========================================================================
   Lula ProVeri PWA — work screens
   bookings list · booking detail (escrow + evidence + warranty) · disputes ·
   notifications · become-a-pro onboarding · profile & wallet
   ========================================================================== */

window.ProVeri = window.ProVeri || {};
window.ProVeri.screens = window.ProVeri.screens || {};

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const {
    h, money, moneyBig, timeAgo, dateTimeShort, countdown, stars, badge, trustBadge,
    toast, sheet, closeSheet, loading, loadingCards, empty, navigate, formValues, withButton, copy, trustBar,
  } = window.ProVeri.ui;
  const screens = window.ProVeri.screens;

  const STATUS_ICON = {
    AWARDED: '🤝', AWAITING_PAYMENT: '💳', SCHEDULED: '📅', EN_ROUTE: '🚗', ON_SITE: '🏠',
    IN_PROGRESS: '🛠️', AWAITING_CONFIRMATION: '✅', COMPLETED: '🎉', IN_WARRANTY: '🛡️',
    CLOSED: '', CANCELLED: '🚫', DISPUTED: '⚖️', REFUNDED: '↩️',
  };

  /* ================= MY BOOKINGS ================= */

  screens['/bookings'] = async function bookings({ query }) {
    const session = api.session();
    if (!session) return h('div.empty', [h('div.ico', '🔐'), h('h3', 'Sign in to see your jobs'), h('p.small', 'Create a free account to post jobs or take work.')]);

    const root = h('div.fade-in.stack');
    const roleSwitch = h('div.seg', [
      h('button', { class: session.role === 'CUSTOMER' ? 'active' : '', onclick: (e) => switchRole(e, 'CUSTOMER') }, 'I’m hiring'),
      h('button', { class: session.role === 'PRO' ? 'active' : '', onclick: (e) => switchRole(e, 'PRO') }, 'I’m working'),
    ]);
    root.append(h('div.row.between', [h('h1', 'My jobs'), roleSwitch]));

    const list = h('div.list', { style: { marginTop: '12px' } });
    root.append(list);
    await render(list, session.role === 'PRO' ? 'pro' : 'customer');
    return root;

    function switchRole(event, role) {
      event.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      event.target.classList.add('active');
      render(list, role === 'PRO' ? 'pro' : 'customer');
    }

    async function render(container, mode) {
      container.innerHTML = '';
      container.append(loadingCards(3));
      const params = mode === 'pro' ? `proId=${session.userId}` : `customerId=${session.userId}`;
      try {
        const rows = await api.get(`/api/bookings?${params}`);
        const jobs = mode === 'pro' ? [] : await api.get(`/api/jobs?customerId=${session.userId}`).catch(() => []);
        container.innerHTML = '';
        if (!rows.length && !jobs.length) {
          container.append(empty('📦', 'Nothing here yet', mode === 'pro'
            ? 'Once you are verified, matched jobs arrive as bids you can place. Your earnings, wallet and SARS-ready summary live here too.'
            : 'Post your first job and watch verified pros bid in minutes.',
            h('button.btn', { onclick: () => navigate(mode === 'pro' ? '/become-a-pro' : '/post-job') }, mode === 'pro' ? 'Become a pro' : 'Post a job')));
          return;
        }
        if (jobs.length) {
          container.append(h('h4', 'Jobs I posted'));
          container.append(...jobs.slice(0, 6).map((job) => h('button.tile', { onclick: () => navigate(job.bookingId ? `/booking/${job.bookingId}` : `/job/${job.jobId}`) }, [
            h('span.lead', '🛠️'),
            h('div.grow', [h('div.t', job.title), h('div.d', `${job.categoryLabel} · ${job.suburb || ''} · ${job.bidCount} bid(s) · ${job.status}`)]),
          ])));
          container.append(h('div', { style: { height: '6px' } }));
        }
        container.append(h('h4', 'Bookings'));
        container.append(...rows.map((b) => h('button.tile', { onclick: () => navigate(`/booking/${b.bookingId}`) }, [
          h('span.lead', STATUS_ICON[b.status] || '📦'),
          h('div.grow', [
            h('div.row.wrap', { style: { gap: '6px' } }, [h('div.t', b.title), badge(b.status, b.status === 'DISPUTED' ? 'danger' : b.status === 'IN_WARRANTY' ? 'info' : 'neutral')]),
            h('div.d', `${b.categoryLabel} · ${mode === 'pro' ? b.customerName : b.proName} · ${b.suburb || ''}`),
            h('div.d', b.autoReleaseAt ? `auto-release in ${countdown(b.autoReleaseAt)}` : b.warrantyEndsAt && b.status === 'IN_WARRANTY' ? `warranty ends ${countdown(b.warrantyEndsAt)}` : dateTimeShort(b.scheduledAt || b.createdAt)),
          ]),
          h('div.meta', [h('div.money', money(b.totalCents)), h('div.tiny.muted', b.evidenceCount ? `${b.evidenceCount} proof` : '')]),
        ])));
      } catch (error) {
        container.innerHTML = '';
        container.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
      }
    }
  };

  /* ================= BOOKING DETAIL ================= */

  screens['/booking/:bookingId'] = async function bookingDetail({ params }) {
    const session = api.session();
    const root = h('div.fade-in.stack');
    root.append(loading(7));

    try {
      const booking = await api.get(`/api/bookings/${params.bookingId}?viewerId=${session?.userId || ''}`);
      const isPro = session?.userId === booking.proId;
      const isCustomer = session?.userId === booking.customerId;
      root.innerHTML = '';

      root.append(h('div.row.between', [
        h('h1', { style: { fontSize: '20px' } }, booking.title),
        badge(booking.status, booking.status === 'DISPUTED' ? 'danger' : 'neutral'),
      ]));
      root.append(h('p.tiny.muted', `${booking.reference} · ${booking.categoryLabel} · ${booking.address.suburb || booking.address.metro || ''}`));

      /* escrow position */
      root.append(h('div.card.accent', [
        h('div.kicker', `🔐 Escrow · ${booking.escrowProvider}`),
        h('div.row.between', [
          h('div', [h('div.tiny.muted', 'held safely'), h('span.money.big', money(booking.price.totalCents))]),
          h('div', { style: { textAlign: 'right' } }, [h('div.tiny.muted', 'auto-release'), h('div.small.money', booking.autoReleaseAt ? countdown(booking.autoReleaseAt) : '—')]),
        ]),
        h('div.split-row', [h('span.lbl', 'Pro payout (90%)'), h('span.money', money(Math.round(booking.price.totalCents * 0.9)))]),
        h('div.split-row', [h('span.lbl', 'Platform fee (10%)'), h('span.money', money(Math.round(booking.price.totalCents * 0.1)))]),
        h('div.split-row', [h('span.lbl', `Workmanship warranty holdback (5%, ${booking.warranty.days} days)`), h('span.money', money(booking.warranty.holdbackCents))]),
        booking.funding?.kind === 'REMITTANCE' && booking.funding.quote
          ? h('div.split-row', [h('span.lbl', `Funded from abroad (${booking.funding.quote.fromCurrency})`), h('span.money', money(booking.funding.quote.customerPaysCents))])
          : null,
        h('div.tiny.muted', { style: { marginTop: '8px' } }, 'Money moves only through the regulated partner. Lula ProVeri never holds client funds.'),
      ]));

      /* arrival gate code */
      if (isCustomer && !booking.arrival.verified && [ 'SCHEDULED', 'EN_ROUTE', 'AWAITING_PAYMENT' ].includes(booking.status)) {
        root.append(h('div.card.gold', [
          h('div.kicker.gold', '🚪 Your arrival gate code'),
          h('div.row.between', [
            h('span.money.big.mono', { style: { letterSpacing: '.2em', fontSize: '32px' } }, booking.arrival.gateCode),
            h('button.btn.sm.ghost', { onclick: () => copy(booking.arrival.gateCode, 'Gate code') }, 'Copy'),
          ]),
          h('p.tiny.muted', `${booking.proName} shows this at your door. Typing it here unlocks their verified photo, ID name and certificate. Five wrong attempts triggers a safety-desk call.`),
        ]));
      }
      if (isCustomer && booking.arrival.verified) {
        root.append(h('div.banner.ok', [h('span.ico', '✅'), h('div.small', `Identity handshake complete at ${dateTimeShort(booking.arrival.arrivedAt)} — you confirmed the arrival code.`)]));
      }

      /* timeline */
      root.append(h('div.card', [
        h('div.kicker', 'Timeline'),
        h('div.steps', { style: { marginTop: '10px' } }, timeline(booking).map(([state, icon, title, detail]) =>
          h('div.step.' + state, [h('div.dot', icon), h('div.body', [h('div.t', title), detail ? h('div.d', detail) : null])]))),
      ]));

      /* evidence */
      root.append(h('section.section', [
        h('div.row.between', [h('h2', `Proof of work (${booking.evidence.length})`), h('span.badge.verified', 'geosealed')]),
        booking.evidence.length
          ? h('div.evidence-strip', { style: { marginTop: '10px' } }, booking.evidence.map((e) => h('div.evidence-item', [
            h('span.ico', iconFor(e.type)),
            h('strong', e.label),
            e.note ? h('span', e.note) : null,
            e.geoVerified === true ? h('span.geo-ok', `✓ at the job (${e.distanceFromJobKm} km)`) : e.geoVerified === false ? h('span.geo-bad', `⚠ ${e.distanceFromJobKm} km away`) : null,
            h('span.seal', e.seal),
            h('span.tiny.muted', dateTimeShort(e.capturedAt)),
          ])))
          : h('p.small.muted', 'No proof of work yet. Escrow cannot release without it — this is the rule that makes “the pro never showed up” a decidable question.'),
        isPro && ['ON_SITE', 'IN_PROGRESS', 'SCHEDULED'].includes(booking.status)
          ? h('button.btn.block', { style: { marginTop: '12px' }, onclick: () => submitEvidence(booking) }, '📸 Upload proof of work')
          : null,
      ]));

      /* actions */
      const actions = h('div.col', { style: { gap: '8px' } });
      if (isCustomer && booking.status === 'AWAITING_PAYMENT') {
        actions.append(h('button.btn.block', { onclick: () => fund(booking) }, `💳 Pay ${money(booking.price.totalCents)} into escrow`));
      }
      if (isPro && ['SCHEDULED', 'AWAITING_PAYMENT'].includes(booking.status)) {
        actions.append(h('button.btn.block.ghost', { onclick: () => shareEta(booking) }, '🚗 Share my ETA'));
      }
      if (isPro && booking.status === 'ON_SITE') {
        actions.append(h('button.btn.block.ghost', { onclick: () => checkIn(booking, 'STARTED') }, '▶️ Check in — work started'));
      }
      if (isCustomer && booking.status === 'AWAITING_CONFIRMATION') {
        actions.append(h('button.btn.block', { onclick: () => confirmWork(booking) }, '✅ Work is done — release payment'));
        actions.append(h('button.btn.block.danger', { onclick: () => rejectWork(booking) }, '⛔ Work is not right'));
      }
      if (booking.status === 'IN_WARRANTY' && isCustomer) {
        actions.append(h('button.btn.block.ghost', { onclick: () => reportDefect(booking) }, `🛡️ Report a defect (warranty ends ${countdown(booking.warranty.endsAt)})`));
      }
      if ((isCustomer || isPro) && !['CLOSED', 'CANCELLED', 'REFUNDED'].includes(booking.status) && !booking.disputeId) {
        actions.append(h('button.btn.block.ghost', { onclick: () => openDispute(booking) }, '⚖️ Open a dispute'));
      }
      if (isCustomer && !booking.reviewId && ['COMPLETED', 'IN_WARRANTY', 'CLOSED'].includes(booking.status)) {
        actions.append(h('button.btn.block.gold', { onclick: () => writeReview(booking) }, '⭐ Leave a verified review'));
      }
      actions.append(h('button.btn.block.subtle', { onclick: () => navigate(`/pro/${booking.pro.proId}`) }, `View ${booking.pro.name}’s profile`));
      root.append(h('section.section', actions));

      /* messages */
      root.append(h('section.section', [
        h('div.row.between', [h('h2', 'Conversation'), h('span.badge.neutral', 'off-platform payment is blocked')]),
        h('div.list', { id: 'messages', style: { marginTop: '10px' } }),
        h('form.row', { style: { marginTop: '10px' }, onsubmit: sendMessage }, [
          h('input.grow', { type: 'text', name: 'body', placeholder: 'Message…', required: true }),
          h('button.btn.sm', { type: 'submit' }, 'Send'),
        ]),
      ]));
      loadMessages(booking, root.querySelector('#messages'));

      /* dispute */
      if (booking.dispute) {
        root.append(h('section.section', [
          h('div.card.danger', [
            h('div.kicker', `⚖️ Dispute ${booking.dispute.reference} — ${booking.dispute.status}`),
            h('p.small', booking.dispute.description),
            h('div.split-row', [h('span.lbl', 'Amount frozen'), h('span.money', money(booking.dispute.amountAtStakeCents))]),
            h('div.split-row', [h('span.lbl', 'Evidence window closes'), h('span', dateTimeShort(booking.dispute.evidenceWindowClosesAt))]),
            h('div.split-row', [h('span.lbl', 'Your evidence'), h('span', `${(booking.dispute.evidence?.customer?.length || 0)} customer · ${(booking.dispute.evidence?.pro?.length || 0)} pro`) ]),
            booking.dispute.resolution ? h('div.banner.ok', [h('span.ico', '️'), h('div.small', `${booking.dispute.resolution.outcome}: ${booking.dispute.resolution.reasoning}`)]) : null,
          ]),
        ]));
      }

      /* audit */
      root.append(h('details.fold', { style: { marginTop: '14px' } }, [
        h('summary', '🧾 Audit trail & proof digest'),
        h('div.fold-body', [
          h('div.row.between', [h('span.tiny.muted', 'Proof digest'), h('button.tiny.mono', { onclick: () => copy(booking.proofDigest, 'Proof digest') }, booking.proofDigest)]),
          h('div', { style: { marginTop: '8px' } }, (booking.auditTrail || []).slice(-14).reverse().map((entry) =>
            h('div.ledger-row', [
              h('span.lv.' + entry.level, entry.level),
              h('div.grow', [h('div', entry.summary), h('div.tiny.muted', dateTimeShort(entry.createdAt))]),
              h('span.seal', entry.seal),
            ]))),
        ]),
      ]));
    } catch (error) {
      root.innerHTML = '';
      root.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;

    function timeline(booking) {
      const steps = [];
      steps.push(['done', '🤝', 'Bid accepted & escrow opened', `${booking.proName} · ${money(booking.price.totalCents)}`]);
      steps.push(booking.escrow?.funded?.fundedAt ? ['done', '💳', 'Paid into escrow', `${dateTimeShort(booking.escrow.funded.fundedAt)} · ${booking.escrow.funded.method}`] : ['current', '💳', 'Waiting for payment', `Due within ${countdown(booking.createdAt)} of award`]);
      steps.push(booking.arrival.verified ? ['done', '🚪', 'Arrival code verified', dateTimeShort(booking.arrival.arrivedAt)] : ['pending', '🚪', 'Arrival handshake', 'The pro shows your 6-digit code at the door']);
      steps.push(booking.schedule.startedAt ? ['done', '🛠️', 'Work started', dateTimeShort(booking.schedule.startedAt)] : ['pending', '🛠️', 'Work in progress', '']);
      steps.push(booking.evidence.length ? ['done', '📸', `Proof of work submitted (${booking.evidence.length})`, dateTimeShort(booking.evidence.at(-1)?.uploadedAt)] : ['pending', '📸', 'Proof of work', 'Geotagged, hash-sealed evidence is required before release']);
      const accepted = booking.milestones.filter((m) => m.status === 'ACCEPTED' || m.status === 'RELEASED').length;
      steps.push(accepted === booking.milestones.length && accepted > 0 ? ['done', '✅', 'Customer confirmed', dateTimeShort(booking.schedule.confirmedAt)] : ['current', '✅', `Confirmation (${accepted}/${booking.milestones.length})`, booking.autoReleaseAt ? `Auto-release in ${countdown(booking.autoReleaseAt)} if you do nothing` : '']);
      steps.push(booking.status === 'IN_WARRANTY' ? ['current', '🛡️', `Workmanship warranty (${booking.warranty.days} days)`, `${money(booking.warranty.holdbackCents)} held until ${dateTimeShort(booking.warranty.endsAt)}`]
        : booking.warranty.released ? ['done', '🛡️', 'Warranty closed', `${money(booking.warranty.holdbackCents)} released to the pro`]
        : ['pending', '🛡️', 'Workmanship warranty', '']);
      return steps;
    }

    function iconFor(type) {
      return ({
        BEFORE_PHOTO: '🖼️', AFTER_PHOTO: '📸', PROGRESS_PHOTO: '🖼️', COC_DOCUMENT: '📜', PRO_SIGNATURE: '✍️',
        MATERIALS_RECEIPT: '🧾', JOB_CARD: '🗒️', INSPECTION_REPORT: '🔍', VIN_PHOTO: '🔢', ODOMETER_PHOTO: '⏱️',
        PREVIEW_LINK: '🔗', DELIVERABLE: '📦', SITE_SURVEY: '📐', WRITTEN_QUOTE: '', INVENTORY: '',
      })[type] || '📎';
    }

    async function loadMessages(booking, container) {
      try {
        const messages = await api.get(`/api/bookings/${booking.bookingId}/messages?userId=${session?.userId || ''}`);
        container.innerHTML = '';
        if (!messages.length) { container.append(h('p.small.muted', 'No messages yet. Anything about money or scope stays here — that is what makes disputes decidable.')); return; }
        container.append(...messages.map((m) => h('div.card.pad-sm', { style: m.fromUserId === session?.userId ? { marginLeft: '18px' } : { marginRight: '18px' } }, [
          h('div.row.between', [h('span.tiny.muted', m.fromRole), h('span.tiny.muted', timeAgo(m.createdAt))]),
          h('div.small', m.body),
          m.flagged ? h('div.banner.warn', { style: { marginTop: '6px' } }, [h('span.ico', '⚠️'), h('div.tiny', 'This message looks like it is moving the deal off ProVeri. You lose escrow, warranty and dispute protection if you follow it.')]) : null,
        ])));
      } catch { container.innerHTML = ''; container.append(h('p.small.muted', 'Messages unavailable.')); }
    }

    async function sendMessage(event) {
      event.preventDefault();
      const values = formValues(event.target);
      await api.post(`/api/bookings/${booking.bookingId}/messages`, { fromUserId: session.userId, body: values.body }).catch((e) => toast(e.message, 'danger'));
      event.target.reset();
      loadMessages(booking, root.querySelector('#messages'));
    }

    async function fund(booking) {
      const close = sheet('Pay into escrow', h('div.stack', [
        h('p.small', `${money(booking.price.totalCents)} is held by ${booking.escrowProvider}. It is released to ${booking.proName} only when you confirm the work.`),
        h('label.field', [h('span', 'Payment method'), h('select', { name: 'method' }, [
          h('option', { value: 'instant-eft' }, 'Instant EFT (Ozow)'), h('option', { value: 'card' }, 'Card'), h('option', { value: 'eft' }, 'EFT'),
        ])]),
        h('details.fold', [h('summary', '💱 Fund from abroad (Remit-a-Job)'), h('div.fold-body', [
          h('label.field', [h('span', 'I am paying in'), h('select', { name: 'remitFrom' }, [h('option', { value: '' }, 'South African Rand'), h('option', { value: 'GBP' }, 'British Pound'), h('option', { value: 'USD' }, 'US Dollar'), h('option', { value: 'EUR' }, 'Euro'), h('option', { value: 'BWP' }, 'Botswana Pula')])]),
          h('p.tiny.muted', 'Family abroad can fund a relative’s repairs. The quote is rate-locked for 30 minutes and the pro still receives rand.'),
        ])]),
      ]), [h('button.btn.block', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const formEl = document.getElementById('sheet').querySelector('form') || null;
          const selects = document.getElementById('sheet').querySelectorAll('select');
          const method = selects[0]?.value || 'instant-eft';
          const remit = selects[1]?.value || '';
          await api.post(`/api/bookings/${booking.bookingId}/fund`, { customerId: session.userId, paymentMethod: method, remitFrom: remit || undefined });
          close(); toast('Paid into escrow — money is safe', 'ok'); navigate(`/booking/${booking.bookingId}`);
        });
      } }, 'Pay now')]);
    }

    async function shareEta(booking) {
      await api.post(`/api/bookings/${booking.bookingId}/eta`, { proId: booking.proId, etaMinutes: 20 });
      toast('ETA shared with the customer', 'ok');
      navigate(`/booking/${booking.bookingId}`);
    }

    async function checkIn(booking, kind) {
      await api.post(`/api/bookings/${booking.bookingId}/check-in`, { actorId: booking.proId, kind });
      toast('Checked in', 'ok');
      navigate(`/booking/${booking.bookingId}`);
    }

    function submitEvidence(booking) {
      const open = booking.milestones.find((m) => m.status === 'PENDING' || m.status === 'REJECTED') || booking.milestones[0];
      const close = sheet('Upload proof of work', h('div.stack', [
        h('p.small', `For milestone: ${open.label}. Every item is timestamped, hashed and checked against the job address. Photos taken more than 2 km away hold the payout.`),
        h('label.field', [h('span', 'Evidence photos'), h('input', { type: 'file', name: 'photos', accept: 'image/*', multiple: true, capture: 'environment' })]),
        h('label.field', [h('span', 'Certificate (if this trade needs one)'), h('input', { type: 'file', name: 'coc', accept: 'image/*,application/pdf' })]),
        h('label.field', [h('span', 'Note to the customer'), h('textarea', { name: 'note', placeholder: 'What was done, what was tested, anything to watch' })]),
        h('div.banner.info', [h('span.ico', '📍'), h('div.tiny', 'Your device attaches GPS and the timestamp automatically. In the demo we simulate the geotag at the job address.')]),
      ]), [h('button.btn.block', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const formEls = document.getElementById('sheet');
          const note = formEls.querySelector('textarea[name=note]')?.value || '';
          const files = [...(formEls.querySelector('input[name=photos]')?.files || [])];
          const cocFile = formEls.querySelector('input[name=coc]')?.files?.[0];
          const items = files.length
            ? files.map((file, index) => ({ type: index === 0 && !booking.evidence.length ? 'BEFORE_PHOTO' : 'AFTER_PHOTO', note: file.name, geo: null, hash: `${file.name}-${file.size}-${file.lastModified}` }))
            : [{ type: 'AFTER_PHOTO', note: 'Simulated capture (demo)', geo: null, hash: `demo-${Date.now()}` }];
          if (cocFile) items.push({ type: 'COC_DOCUMENT', note: cocFile.name, hash: `${cocFile.name}-${cocFile.size}` });
          if (!items.some((i) => i.type === 'PRO_SIGNATURE')) items.push({ type: 'PRO_SIGNATURE', note: 'Signed on the customer’s device', hash: `sig-${Date.now()}` });
          await api.post(`/api/bookings/${booking.bookingId}/evidence`, { proId: booking.proId, milestoneId: open.milestoneId, items, note });
          close(); toast('Proof of work submitted — the customer has 48 hours to confirm', 'ok');
          navigate(`/booking/${booking.bookingId}`);
        });
      } }, 'Submit for confirmation')]);
    }

    function confirmWork(booking) {
      const close = sheet('Confirm the work', h('div.stack', [
        h('p.small', `This releases ${money(Math.round(booking.price.totalCents * 0.9))} to ${booking.proName} immediately, holds ${money(booking.warranty.holdbackCents)} for ${booking.warranty.days} days, and lets you leave a verified review.`),
        h('label.field', [h('span', 'Rating'), h('select', { name: 'rating' }, [5, 4.5, 4, 3.5, 3, 2, 1].map((r) => h('option', { value: r }, `${stars(r)} ${r}`)))]),
        h('label.field', [h('span', 'Say something (public, verified)'), h('textarea', { name: 'comment', placeholder: 'What was the experience like?' })]),
      ]), [h('button.btn.block', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const sheetEl = document.getElementById('sheet');
          const rating = Number(sheetEl.querySelector('select[name=rating]').value);
          const comment = sheetEl.querySelector('textarea[name=comment]').value;
          const milestone = booking.milestones.find((m) => m.status === 'EVIDENCE_SUBMITTED');
          await api.post(`/api/bookings/${booking.bookingId}/confirm`, { customerId: session.userId, milestoneId: milestone?.mileId || milestone?.milestoneId, comment, rating });
          close(); toast('Payment released — you are covered by the workmanship warranty', 'ok');
          navigate(`/booking/${booking.bookingId}`);
        });
      } }, 'Confirm & release')]);
    }

    function rejectWork(booking) {
      const close = sheet('What is wrong?', h('div.stack', [
        h('p.small', 'Your money stays in escrow. The pro is asked to correct the work, or you can open a dispute.'),
        h('label.field', [h('span', 'Reason'), h('textarea', { name: 'reason', required: true })]),
      ]), [h('button.btn.block.danger', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const reason = document.getElementById('sheet').querySelector('textarea').value;
          const milestone = booking.milestones.find((m) => m.status === 'EVIDENCE_SUBMITTED');
          await api.post(`/api/bookings/${booking.bookingId}/reject`, { customerId: session.userId, milestoneId: milestone?.milestoneId, reason });
          close(); toast('Work rejected — money stays in escrow', 'warn');
          navigate(`/booking/${booking.bookingId}`);
        });
      } }, 'Reject this milestone')]);
    }

    function reportDefect(booking) {
      const close = sheet('Report a warranty defect', h('div.stack', [
        h('p.small', `${money(booking.warranty.holdbackCents)} is held until ${dateTimeShort(booking.warranty.endsAt)}. If the pro does not fix it, that money pays another verified pro to finish.`),
        h('label.field', [h('span', 'What went wrong?'), h('textarea', { name: 'description', required: true })]),
      ]), [h('button.btn.block', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const description = document.getElementById('sheet').querySelector('textarea').value;
          await api.post(`/api/bookings/${booking.bookingId}/warranty-defect`, { actorId: session.userId, description });
          close(); toast('Defect reported — holdback frozen until it is fixed', 'warn');
          navigate(`/booking/${booking.bookingId}`);
        });
      } }, 'Report defect')]);
    }

    function openDispute(booking) {
      const close = sheet('Open a dispute', h('div.stack', [
        h('div.banner.warn', [h('span.ico', '⚖️'), h('div.small', `Escrow freezes immediately. Both sides get 72 hours to submit evidence. The outcome is decided on the hash-sealed record — check-ins, geotagged photos, messages and approved variations — and the weighting is published to you.`)]),
        h('label.field', [h('span', 'Category'), h('select', { name: 'category' }, ['WORK_QUALITY', 'WORK_INCOMPLETE', 'NOT_AS_QUOTED', 'DAMAGE', 'NO_SHOW', 'PAYMENT', 'SAFETY', 'OTHER'].map((c) => h('option', { value: c }, c.replace(/_/g, ' '))))]),
        h('label.field', [h('span', 'What happened?'), h('textarea', { name: 'description', required: true })]),
      ]), [h('button.btn.block.danger', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const values = formValues(document.getElementById('sheet'));
          await api.post(`/api/bookings/${booking.bookingId}/disputes`, { openedBy: session.userId, role: isPro ? 'PRO' : 'CUSTOMER', ...values });
          close(); toast('Dispute opened — escrow frozen', 'warn');
          navigate(`/booking/${booking.bookingId}`);
        });
      } }, 'Open dispute & freeze escrow')]);
    }

    function writeReview(booking) {
      const close = sheet('Leave a verified review', h('div.stack', [
        h('div.banner.ok', [h('span.ico', '⭐'), h('div.small', 'This review is marked “verified” because you paid for this job through ProVeri escrow. That is why ProVeri ratings cannot be bought.')]),
        h('label.field', [h('span', 'Rating'), h('select', { name: 'rating' }, [5, 4.5, 4, 3.5, 3, 2, 1].map((r) => h('option', { value: r }, `${stars(r)} ${r}`)))]),
        h('label.field', [h('span', 'Your review'), h('textarea', { name: 'comment', required: true })]),
      ]), [h('button.btn.block.gold', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const values = formValues(document.getElementById('sheet'));
          await api.post(`/api/bookings/${booking.bookingId}/reviews`, { customerId: session.userId, rating: Number(values.rating), comment: values.comment, tags: ['escrow_protected'] });
          close(); toast('Verified review published — thank you', 'ok');
          navigate(`/booking/${booking.bookingId}`);
        });
      } }, 'Publish verified review')]);
    }
  };

  /* ================= BECOME A PRO ================= */

  screens['/become-a-pro'] = async function becomeAPro() {
    const bundle = api.state.bundle || {};
    const categories = bundle.catalog?.categories || [];
    const suburbs = (bundle.catalog?.metros || []).flatMap((m) => (m.suburbs || []).map((s) => ({ ...s, metroName: m.name })));
    const banks = bundle.banks || [];
    const session = api.session();

    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Turn your skills into income'));
    root.append(h('p.muted.small', 'Verification takes one pass. After that, matched jobs arrive as notifications and payment is guaranteed the moment the customer funds escrow. No lead fees — you only pay when you are paid.'));

    root.append(h('div.card.gold', [
      h('div.kicker.gold', '💰 The deal, in one line'),
      h('p.small', { style: { margin: 0 } }, [h('strong', 'You keep 90%.'), ' 10% platform fee, taken only from released jobs. No subscription, no per-lead charge, no paying for jobs you do not win. 5% of your payout is held for 14 days as a workmanship warranty and then releases to you automatically.']),
    ]));

    const steps = h('div.card', [
      h('div.kicker', 'The verification pipeline'),
      h('div.steps', { style: { marginTop: '10px' } }, [
        stepRow('1', 'South African ID', '13-digit checksum and Home Affairs-format decode — free and instant on your device.'),
        stepRow('2', 'Phone + email PIN', 'Clickatell SMS and Brevo email one-time PINs.'),
        stepRow('3', 'Bank account in your own name', 'Account verification so payouts cannot be redirected. Then it locks — changing it later freezes payouts until a call-back.'),
        stepRow('4', 'Trade certificate (statutory trades)', 'PIRB, wireman’s licence, SAQCC gas, NHBRC, PSIRA… recorded against the issuing body’s register.'),
        stepRow('5', 'SAQA / NQF qualification', 'Matched against the public register, with an honest Recognition of Prior Learning route if you learned on the job.'),
        stepRow('6', 'Declaration & history', 'Criminal self-declaration, then your delivery history accrues on ProVeri.'),
      ]),
    ]);
    root.append(steps);
    function stepRow(n, title, body) { return h('div.step.pending', [h('div.dot', n), h('div.body', [h('div.t', title), h('div.d', body)])]); }

    const form = h('form.card.stack', { onsubmit: onSubmit, style: { marginTop: '14px' } });
    form.append(h('h2', 'Apply now'));
    form.append(h('div.form-grid', [
      h('label.field', [h('span', 'Full name'), h('input', { type: 'text', name: 'fullName', required: true })]),
      h('label.field', [h('span', 'South African ID number'), h('input', { type: 'text', name: 'idNumber', required: true, inputmode: 'numeric', maxlength: 13, placeholder: '13 digits' })]),
    ]));
    form.append(h('div.form-grid', [
      h('label.field', [h('span', 'Email'), h('input', { type: 'email', name: 'email', required: true })]),
      h('label.field', [h('span', 'Mobile'), h('input', { type: 'tel', name: 'mobile', required: true, placeholder: '082 123 4567' })]),
    ]));
    form.append(h('div.form-grid', [
      h('label.field', [h('span', 'Primary trade'), h('select', { name: 'primaryCategory', required: true }, [h('option', { value: '' }, 'Choose…'), ...categories.map((c) => h('option', { value: c.id }, c.label + (c.statutoryTrade ? ' (certificate required)' : '')))]),
      ]),
      h('label.field', [h('span', 'Base suburb'), h('select', { name: 'suburbId', required: true }, [h('option', { value: '' }, 'Choose…'), ...suburbs.map((s) => h('option', { value: s.id }, `${s.name} — ${s.metroName}`))])]),
    ]));
    form.append(h('div.form-grid', [
      h('label.field', [h('span', 'Hourly rate (rand)'), h('input', { type: 'number', name: 'hourlyRate', min: 0, step: 10 })]),
      h('label.field', [h('span', 'Callout fee (rand)'), h('input', { type: 'number', name: 'calloutFee', min: 0, step: 10 })]),
    ]));
    form.append(h('details.fold', [
      h('summary', '🏦 Payout bank account'),
      h('div.fold-body', h('div.form-grid', [
        h('label.field', [h('span', 'Bank'), h('select', { name: 'bankCode' }, banks.map((b) => h('option', { value: b.code }, b.name)))]),
        h('label.field', [h('span', 'Account number'), h('input', { type: 'text', name: 'accountNumber', inputmode: 'numeric' })]),
      ])),
    ]));
    form.append(h('details.fold', [
      h('summary', '📜 Certificate & qualification (if you have them)'),
      h('div.fold-body', h('div.form-grid', [
        h('label.field', [h('span', 'Certificate number'), h('input', { type: 'text', name: 'certificateNumber', placeholder: 'e.g. PIRB-2019-44821' })]),
        h('label.field', [h('span', 'SAQA qualification ID'), h('input', { type: 'text', name: 'saqaId', placeholder: 'e.g. 61709' })]),
      ])),
    ]));
    form.append(h('label.field', [h('span', 'About you'), h('textarea', { name: 'about', placeholder: 'What you do, how long you have done it, what makes your work trustworthy' })]));
    form.append(h('label', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
      h('input', { type: 'checkbox', name: 'declaration', required: true }),
      h('span.small', 'I declare that the information above is true, that I have no undisclosed criminal convictions relevant to this work, and that I consent (POPIA) to identity, bank and trade verification for the purpose of operating on ProVeri.'),
    ]));
    form.append(h('button.btn.block', { type: 'submit' }, 'Submit application & run verification'));

    const result = h('div.stack', { style: { marginTop: '14px' } });
    root.append(form, result);

    function statusTone(status) {
      if (status === 'PASS') return 'verified';
      if (status === 'WARN') return 'warn';
      if (status === 'FAIL') return 'danger';
      return 'info';
    }

    function clearedBanner() {
      return h('div.banner.ok', { style: { marginTop: '10px' } }, [
        h('span.ico', '\u{1F389}'),
        h('div', [h('strong', 'You are cleared to bid.'), h('div.small', 'Your free microsite is live and matched jobs will arrive as notifications.')]),
      ]);
    }

    function pendingBanner(verification) {
      const outstanding = []
        .concat(verification.pro.verification && verification.pro.verification.missingChecks ? verification.pro.verification.missingChecks : [])
        .concat(verification.pro.verification && verification.pro.verification.failedChecks ? verification.pro.verification.failedChecks : []);
      const detail = outstanding.length ? outstanding.join(', ') : 'see the checks above';
      return h('div.banner.warn', { style: { marginTop: '10px' } }, [
        h('span.ico', '\u23F3'),
        h('div', [
          h('strong', 'Almost there.'),
          h('div.small', 'Missing or failed: ' + detail + '. Statutory trades cannot trade without a certificate — use the RPL pathway if you learned on the job.'),
        ]),
      ]);
    }

    async function onSubmit(event) {
      event.preventDefault();
      const values = formValues(form);
      const button = form.querySelector('button[type=submit]');
      await withButton(button, async () => {
        // Validate the ID locally first — free, instant, and it tells the user
        // exactly what is wrong before we burn a pipeline run.
        const idCheck = await api.post('/api/verify/sa-id', { idNumber: values.idNumber });
        if (!idCheck.valid) throw new api.ApiError(400, { message: `ID number rejected: ${idCheck.reasons.join('; ')}` });

        const pro = await api.post('/api/pros', {
          fullName: values.fullName,
          email: values.email,
          mobile: values.mobile,
          idNumber: values.idNumber,
          suburbId: values.suburbId,
          primaryCategory: values.primaryCategory,
          hourlyRateCents: values.hourlyRate ? Math.round(values.hourlyRate * 100) : null,
          calloutFeeCents: values.calloutFee ? Math.round(values.calloutFee * 100) : null,
          about: values.about,
          tradeCertification: values.certificateNumber ? { certificateNumber: values.certificateNumber } : {},
          qualification: values.saqaId ? { saqaId: values.saqaId } : {},
          bankDetails: values.accountNumber ? { bankCode: values.bankCode, accountNumber: values.accountNumber, holderName: values.fullName } : undefined,
          criminalDeclaration: { declared: true, noConvictions: true },
          deviceFingerprint: navigator.userAgent.slice(0, 64),
        });

        const verification = await api.post(`/api/pros/${pro.proId}/verify`, {});
        api.setSession({ userId: pro.proId, role: 'PRO', name: pro.fullName });

        result.innerHTML = '';
        result.append(h('div.card.accent', [
          h('div.kicker', '🪪 Verification result'),
          h('div.row.between', [trustBadge(verification.pro.badge, verification.pro.trustScore), h('span.money.big', `${verification.pro.trustScore}/100`)]),
          trustBar(verification.pro.trustScore),
          h('div.list', { style: { marginTop: '12px' } }, verification.trail.map((t) =>
            h('div.card.pad-sm', [
              h('div.row.between', [h('strong.small', t.check.replace(/_/g, ' ')), badge(t.status, statusTone(t.status))]),
              t.finding ? h('div.tiny.muted', t.finding) : null,
              t.source ? h('div.tiny.muted', `source: ${t.source}`) : null,
            ]))),
          verification.pro.canBid ? clearedBanner() : pendingBanner(verification),
        ]));
        toast(verification.pro.canBid ? 'Verified — welcome to ProVeri' : 'Application received — finish the remaining checks', verification.pro.canBid ? 'ok' : 'warn');
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    return root;
  };

  /* ================= NOTIFICATIONS ================= */

  screens['/notifications'] = async function notifications() {
    const session = api.session();
    if (!session) return h('div.empty', [h('div.ico', '🔔'), h('h3', 'No notifications yet')]);
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Notifications'));
    const list = h('div.list', { style: { marginTop: '12px' } });
    root.append(list);
    try {
      const rows = await api.get(`/api/notifications/${session.userId}`);
      if (!rows.length) list.append(empty('🔔', 'Nothing yet', 'Bids, escrow confirmations, arrival codes and payouts will appear here.'));
      list.append(...rows.map((n) => h('button.tile', { onclick: async () => { await api.post(`/api/notifications/${n.notificationId}/read`); if (n.data?.bookingId) navigate(`/booking/${n.data.bookingId}`); else if (n.data?.jobId) navigate(`/job/${n.data.jobId}`); } }, [
        h('span.lead', iconForType(n.type)),
        h('div.grow', [h('div.t', n.title), h('div.d', n.body), h('div.tiny.muted', timeAgo(n.createdAt))]),
        n.read ? null : h('span.badge.elite', 'new'),
      ])));
    } catch (error) {
      list.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;

    function iconForType(type) {
      return ({ NEW_BID: '💰', BOOKING_CONFIRMED: '🤝', ESCROW_FUNDED: '🔐', PAYOUT_RELEASED: '💸', WORK_SUBMITTED_FOR_CONFIRMATION: '📸', DISPUTE_OPENED: '⚖️', NEW_JOB_MATCH: '️', PRO_EN_ROUTE: '🚗', NEW_REVIEW: '⭐', OFF_PLATFORM_WARNING: '⚠️', WARRANTY_DEFECT: '🛡️', AUTO_RELEASED: '⏰' })[type] || '🔔';
    }
  };

  /* ================= PROFILE & WALLET ================= */

  screens['/profile'] = async function profile() {
    const session = api.session();
    const root = h('div.fade-in.stack');
    if (!session) {
      root.append(h('div.card.accent', [
        h('div.kicker', '👤🏾 Get started'),
        h('h2', 'Create your free account'),
        h('p.small', 'Customers post jobs and pay into escrow. Pros get verified, win jobs and get paid with money already secured.'),
        h('div.col', [
          h('button.btn', { onclick: () => navigate('/post-job') }, 'I need work done'),
          h('button.btn.ghost', { onclick: () => navigate('/become-a-pro') }, 'I want jobs'),
        ]),
      ]));
      return root;
    }

    root.append(h('div.row.between', [
      h('h1', session.name || 'My profile'),
      badge(session.role, 'info'),
    ]));

    const actions = h('div.col', { style: { marginTop: '14px', gap: '8px' } });
    actions.append(h('button.btn.block.subtle', { onclick: () => navigate('/bookings') }, '📦 My jobs & bookings'));
    actions.append(h('button.btn.block.subtle', { onclick: () => navigate('/notifications') }, '🔔 Notifications'));

    if (session.role === 'PRO') {
      actions.append(h('button.btn.block.subtle', { onclick: () => navigate(`/pro/${session.userId}`) }, '🪪 My public profile & trust card'));
      actions.append(h('button.btn.block.subtle', { onclick: () => navigate('/wallet') }, '💸 Wallet, payouts & SARS summary'));
    } else {
      actions.append(h('button.btn.block.subtle', { onclick: () => navigate('/post-job') }, '🛠️ Post a job'));
    }
    actions.append(h('button.btn.block.subtle', { onclick: () => navigate('/vehicles') }, '🚗 Verified vehicles'));
    actions.append(h('button.btn.block.subtle', { onclick: () => navigate('/web-studio') }, '🖥️ Web Studio'));
    actions.append(h('button.btn.block.subtle', { onclick: () => navigate('/trust') }, '🛡️ Trust & transparency'));
    actions.append(h('button.btn.block.ghost', { onclick: () => { api.setSession(null); toast('Signed out of this device'); navigate('/'); } }, 'Sign out of this device'));
    root.append(actions);

    root.append(h('div.card', { style: { marginTop: '14px' } }, [
      h('div.kicker', 'ℹ️ About this deployment'),
      h('div.kv', [
        h('dt', 'Mode'), h('dd', api.state.integrationMode || 'live'),
        h('dt', 'Verticals'), h('dd', 'services · vehicles · property (soon)'),
        h('dt', 'Data'), h('dd', 'synthetic demo identities'),
      ]),
    ]));
    return root;
  };

  screens['/wallet'] = async function wallet() {
    const session = api.session();
    const root = h('div.fade-in.stack');
    if (!session) return h('div.empty', [h('div.ico', '💸'), h('h3', 'Sign in first')]);
    root.append(h('h1', 'Wallet & earnings'));
    const box = h('div.stack', { style: { marginTop: '12px' } });
    root.append(box);
    box.append(loading(4));
    try {
      const [walletData, tax] = await Promise.all([
        api.get(`/api/pros/${session.userId}/wallet`),
        api.get(`/api/pros/${session.userId}/tax-summary`).catch(() => null),
      ]);
      box.innerHTML = '';
      box.append(h('div.card.accent', [
        h('div.kicker', '💸 Position'),
        h('div.stat-grid', [
          mini(money(walletData.receivedCents), 'received'),
          mini(money(walletData.heldInEscrowCents), 'in escrow'),
          mini(money(walletData.pendingHoldbackCents), 'warranty hold'),
          mini(money(walletData.lifetimePlatformFeesPaidCents), 'fees paid'),
        ]),
      ]));
      box.append(h('div.card', [
        h('div.kicker', '⚡ Payout rails'),
        h('div.list', (walletData.rails || []).map((rail) => h('div.split-row', [
          h('span.lbl', rail.label), h('span', `${rail.settlement} · ${rail.feeCents ? money(rail.feeCents) : 'free'}`),
        ]))),
      ]));
      if (tax) {
        box.append(h('div.card', [
          h('div.kicker', '🧾 SARS-ready summary ' + tax.taxYear),
          h('div.split-row', [h('span.lbl', 'Gross job value'), h('span.money', money(tax.grossJobValueCents))]),
          h('div.split-row', [h('span.lbl', 'Platform fees (deductible)'), h('span.money', money(tax.platformFeesCents))]),
          h('div.split-row', [h('span.lbl', 'Net received'), h('span.money', money(tax.netReceivedCents))]),
          h('div.split-row', [h('span.lbl', 'VAT status'), h('span', tax.sarsNotes.vatStatus.replace(/_/g, ' '))]),
          h('p.tiny.muted', { style: { marginTop: '8px' } }, tax.sarsNotes.obligations.join(' ')),
          h('p.tiny.muted', `Provisional tax deadlines: ${tax.sarsNotes.provisionalTaxDeadlines.join(' and ')}`),
        ]));
      }
      if (walletData.recentTransactions?.length) {
        box.append(h('div.card', [
          h('div.kicker', 'Transactions'),
          ...walletData.recentTransactions.map((t) => h('div.split-row', [h('span.lbl', `${t.kind} · ${dateTimeShort(t.at)}`), h('span.money', money(t.amountCents))])),
        ]));
      }
    } catch (error) {
      box.innerHTML = '';
      box.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;

    function mini(value, label) { return h('div.pill-stat', [h('span.v', value), h('span.l', label)]); }
  };
})();
