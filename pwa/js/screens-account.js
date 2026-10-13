/* ==========================================================================
   ProVeri PWA — accounts and conversations

   /sign-in            one flow: number or email → code → (new? your name)
   /inbox              every conversation, plus job updates
   /inbox/:id          one conversation with a composer

   window.ProVeri.account.openSignIn() puts the same flow in a sheet, so any
   screen can ask "who are you?" at the moment it matters — never before.
   ========================================================================== */

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const ui = window.ProVeri.ui;
  const { h, icon, toast, sheet, closeSheet, navigate, avatar, withButton, firstName, shortStamp, timeAgo } = ui;
  window.ProVeri.screens = window.ProVeri.screens || {};
  const screens = window.ProVeri.screens;

  /* ================================================================== *
   * Sign in
   * ================================================================== */

  let rosterCache = null;
  async function roster() {
    if (rosterCache) return rosterCache;
    try { rosterCache = await api.get('/api/demo/roster'); } catch { rosterCache = { customers: [], pros: [] }; }
    return rosterCache;
  }

  /**
   * The whole sign-in journey in one element. `onDone(session)` runs after a
   * successful sign-in or sign-up; by default the current screen re-renders.
   */
  function signInFlow(opts) {
    const options = opts || {};
    const box = h('div.signin');
    let identifier = '';

    const finish = (session, isNew) => {
      api.setSession(session);
      closeSheet();
      toast(isNew ? `Welcome to ProVeri, ${firstName(session.name)}.` : `Signed in as ${session.name}.`, 'ok');
      if (options.onDone) options.onDone(session);
      else window.dispatchEvent(new PopStateEvent('popstate'));
    };

    stepIdentifier();
    return box;

    function stepIdentifier(prefill) {
      box.innerHTML = '';
      const input = h('input', {
        name: 'identifier', type: 'text', inputmode: 'email', autocomplete: 'username',
        placeholder: '082 123 4567 or you@email.co.za', value: prefill || identifier || '', required: true,
        'aria-label': 'Mobile number or email',
      });
      const error = h('div.field-error', { hidden: true });
      const submit = h('button.btn.block.lg', { type: 'submit' }, ['Continue', icon('arrow', 18)]);
      const form = h('form.stack', {
        onsubmit: async (event) => {
          event.preventDefault();
          error.hidden = true;
          input.removeAttribute('aria-invalid');
          identifier = input.value.trim();
          if (!identifier) { error.textContent = 'Enter your mobile number or email.'; error.hidden = false; input.setAttribute('aria-invalid', 'true'); return; }
          try {
            const challenge = await withButton(submit, () => api.post('/api/auth/start', { identifier, role: options.role || null }));
            stepCode(challenge);
          } catch (e) {
            error.textContent = ui.friendlyError(e);
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
          }
        },
      }, [
        h('label.field', [h('span', 'Mobile number or email'), input]),
        error,
        submit,
        h('p.tiny.muted.center', 'We will send you a 6-digit code. No passwords to remember.'),
      ]);
      box.append(form);
      if (options.showDemo !== false) box.append(demoAccounts());
    }

    function stepCode(challenge) {
      box.innerHTML = '';
      const code = h('input.otp-input', {
        name: 'code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6',
        pattern: '[0-9]*', placeholder: '••••••', required: true, 'aria-label': '6-digit code',
      });
      const error = h('div.field-error', { hidden: true });
      const submit = h('button.btn.block.lg', { type: 'submit' }, 'Confirm');
      const verify = async () => {
        error.hidden = true;
        try {
          const result = await withButton(submit, () => api.post('/api/auth/verify', { challengeId: challenge.challengeId, code: code.value.trim() }));
          if (result.newUser) stepCreate(result);
          else finish(result.session, false);
        } catch (e) {
          error.textContent = ui.friendlyError(e);
          error.hidden = false;
          code.setAttribute('aria-invalid', 'true');
        }
      };
      code.addEventListener('input', () => {
        code.value = code.value.replace(/\D/g, '').slice(0, 6);
        if (code.value.length === 6) verify();
      });
      box.append(h('form.stack', { onsubmit: (event) => { event.preventDefault(); verify(); } }, [
        h('p', ['We sent a code to ', h('b', challenge.destination), '.']),
        challenge.demoCode ? h('div.demo-code', [
          icon('info', 20),
          h('div.grow', [h('div.tiny', 'Demo server — no SMS is sent. Your code is'), h('b', challenge.demoCode)]),
          h('button.btn.sm.subtle', { type: 'button', onclick: () => { code.value = challenge.demoCode; verify(); } }, 'Use it'),
        ]) : null,
        h('label.field', [h('span', 'Enter the 6-digit code'), code]),
        error,
        submit,
        h('div.row.between', [
          h('button.btn.link', { type: 'button', onclick: () => stepIdentifier(identifier) }, ['Use a different number']),
          h('button.btn.link', {
            type: 'button',
            onclick: async (event) => {
              try { stepCode(await withButton(event.currentTarget, () => api.post('/api/auth/start', { identifier }))); toast('New code sent.', 'ok'); } catch { /* toasted */ }
            },
          }, 'Send a new code'),
        ]),
      ]));
      setTimeout(() => code.focus(), 50);
    }

    function stepCreate(result) {
      box.innerHTML = '';
      const suburbs = suburbOptions(options.suburbId);
      const name = h('input', { name: 'fullName', type: 'text', autocomplete: 'name', placeholder: 'e.g. Naledi Sithole', required: true });
      const submit = h('button.btn.block.lg', { type: 'submit' }, 'Create my account');
      box.append(h('form.stack', {
        onsubmit: async (event) => {
          event.preventDefault();
          const values = ui.formValues(event.currentTarget);
          if (!String(values.fullName || '').trim()) { name.setAttribute('aria-invalid', 'true'); name.focus(); return; }
          try {
            const created = await withButton(submit, () => api.post('/api/auth/register', { signupToken: result.signupToken, fullName: values.fullName, suburbId: values.suburbId || null }));
            finish(created.session, true);
          } catch { /* toasted */ }
        },
      }, [
        h('div.banner.ok', [h('span.ico', icon('check-circle', 20)), h('div', [h('strong', 'Number confirmed'), h('div.small', 'You are new here — two quick details and you are in.')])]),
        h('label.field', [h('span', 'Your name'), name]),
        h('label.field', [h('span', ['Your suburb ', h('small', 'so we show pros near you')]), h('select', { name: 'suburbId' }, [h('option', { value: '' }, 'Choose later'), ...suburbs])]),
        submit,
        h('p.tiny.muted.center', ['Are you a tradesperson? ', h('a', { href: '/become-a-pro', onclick: () => closeSheet() }, 'Join as a pro instead'), '.']),
      ]));
      setTimeout(() => name.focus(), 50);
    }

    function demoAccounts() {
      const list = h('div.list', [h('div.skeleton.card', { style: { height: '64px' } })]);
      roster().then((r) => {
        list.innerHTML = '';
        const customer = (r.customers || [])[0];
        const metro = customer ? customer.metro : null;
        const preferred = ['Plumber', 'Handyman', 'Electrician'];
        const pros = (r.pros || []).filter((p) => p.canBid && (!metro || p.metro === metro))
          .sort((a, b) => (preferred.indexOf(a.category) + 1 || 9) - (preferred.indexOf(b.category) + 1 || 9)).slice(0, 2);
        const people = [
          customer ? { session: { userId: customer.customerId, role: 'CUSTOMER', name: customer.name }, d: `Homeowner · ${customer.suburb}` } : null,
          ...pros.map((p) => ({ session: { userId: p.proId, role: 'PRO', name: p.name }, d: `${p.category} · ${p.suburb}` })),
        ].filter(Boolean);
        for (const person of people) {
          list.append(h('button.persona', { type: 'button', onclick: () => finish(person.session, false) }, [
            avatar(person.session.name),
            h('div.grow', [h('div.t', person.session.name), h('div.d', person.d)]),
            icon('chevron', 18),
          ]));
        }
        if (!people.length) list.append(h('p.tiny.muted', 'Demo accounts are not available on this server.'));
      });
      return h('div', [
        h('div.or-line', 'or explore with a demo account'),
        list,
        h('p.tiny.muted', { style: { marginTop: '10px' } }, 'Demo accounts skip the code so you can try both sides of the marketplace. No real money moves.'),
      ]);
    }
  }

  function suburbOptions(selected) {
    const metros = api.state.bundle?.catalog?.metros || [];
    return metros.map((metro) => h('optgroup', { label: metro.name }, (metro.suburbs || []).map((s) => h('option', { value: s.id, selected: s.id === selected ? true : null }, s.name))));
  }

  function openSignIn(opts) {
    const options = opts || {};
    sheet(options.title || 'Sign in or create an account', signInFlow(options), null, { sub: options.reason || 'Track jobs, message pros and pay safely.' });
  }

  /** A page-sized "sign in to continue" panel for screens that need a session. */
  function signInPanel({ title, body, iconName, next } = {}) {
    return h('div.card.pad-lg', [
      h('div.empty', { style: { padding: '8px 0 18px' } }, [
        h('div.ico', icon(iconName || 'lock', 28)),
        h('h3', title || 'Sign in to continue'),
        body ? h('p', body) : null,
      ]),
      signInFlow({ onDone: next ? () => navigate(next, { replace: true }) : null }),
    ]);
  }

  window.ProVeri.account = { openSignIn, signInFlow, signInPanel, suburbOptions };

  screens['/sign-in'] = async ({ query }) => {
    const page = h('div.page.narrow');
    if (api.session()) {
      page.append(h('div.empty', [h('div.ico', icon('user-check', 28)), h('h3', `You are signed in as ${api.session().name}`), h('a.btn', { href: query.next || '/' }, 'Continue')]));
      return page;
    }
    page.append(
      h('div.page-head', h('div.titles', [h('h1', 'Sign in or join'), h('p.page-sub', 'One account for hiring and for getting hired.')])),
      h('div.card.pad-lg', signInFlow({ onDone: () => navigate(query.next || '/', { replace: true }) })),
    );
    return page;
  };

  /* ================================================================== *
   * Inbox
   * ================================================================== */

  screens['/inbox'] = async ({ query }) => {
    const session = api.session();
    const page = h('div.page.mid');
    page.append(h('div.page-head', h('div.titles', [h('h1', 'Inbox')])));
    if (!session) {
      page.append(signInPanel({ title: 'Your messages live here', body: 'Sign in to message pros about their work and chat about your bookings.', iconName: 'inbox' }));
      return page;
    }
    const tab = query.tab === 'updates' ? 'updates' : 'messages';
    const seg = h('div.seg');
    const body = h('div', { style: { marginTop: '16px' } }, ui.loadingCards(3));
    page.append(seg, body);

    const [inbox, updates] = await Promise.all([
      api.get(`/api/inbox/${encodeURIComponent(session.userId)}`).catch(() => ({ conversations: [], unread: 0 })),
      api.get(`/api/notifications/${encodeURIComponent(session.userId)}?limit=60`).catch(() => []),
    ]);
    const unreadUpdates = (updates || []).filter((n) => !n.read).length;

    const paint = (which) => {
      seg.innerHTML = '';
      seg.append(
        h('button' + (which === 'messages' ? '.active' : ''), { type: 'button', onclick: () => paint('messages') }, ['Messages', inbox.unread ? h('span.count-badge', String(inbox.unread)) : null]),
        h('button' + (which === 'updates' ? '.active' : ''), { type: 'button', onclick: () => paint('updates') }, ['Updates', unreadUpdates ? h('span.count-badge', String(unreadUpdates)) : null]),
      );
      body.innerHTML = '';
      if (which === 'messages') body.append(conversationList(inbox.conversations || [], session));
      else body.append(updatesList(updates || [], session));
      history.replaceState(history.state, '', which === 'updates' ? '/inbox?tab=updates' : '/inbox');
    };
    paint(tab);
    return page;
  };

  function conversationList(conversations, session) {
    if (!conversations.length) {
      return ui.empty('inbox', 'No messages yet',
        session.role === 'PRO'
          ? 'When a homeowner asks about your work or books you, the conversation appears here.'
          : 'Found work you like? Message the pro straight from the photo — the conversation lands here.',
        h('a.btn', { href: '/browse' }, session.role === 'PRO' ? 'See the work feed' : 'Explore work near you'));
    }
    return h('div.group', conversations.map((c) => h('a.conv' + (c.unread ? '.unread' : ''), { href: `/inbox/${encodeURIComponent(c.conversationId)}` }, [
      h('div.cv-media', c.photoUrl
        ? [ui.photoImg(c.photoUrl, '', { class: 'thumbnail' }), avatar(c.counterpart.name, 'xs')]
        : [avatar(c.counterpart.name, 'lg')]),
      h('div.cv-body', [
        h('div.cv-row', [h('span.cv-name', c.counterpart.name), h('span.cv-time', shortStamp(c.lastAt))]),
        h('div.cv-subject', c.kind === 'BOOKING' ? `Booking · ${c.subject}` : `About: ${c.subject}`),
        h('div.cv-preview', c.lastMessage ? `${c.lastMessage.fromMe ? 'You: ' : ''}${c.lastMessage.body}` : 'No messages yet'),
      ]),
      c.unread ? h('span.count-badge', String(c.unread)) : null,
    ])));
  }

  function updatesList(rows, session) {
    if (!rows.length) return ui.empty('bell', 'No updates yet', 'Quotes, payments and job progress will show up here.');
    const unread = rows.filter((n) => !n.read);
    const markAll = unread.length ? h('button.btn.sm.subtle', {
      type: 'button',
      onclick: async (event) => {
        await withButton(event.currentTarget, async () => {
          await Promise.all(unread.map((n) => api.post(`/api/notifications/${n.notificationId}/read`, {}).catch(() => null)));
        });
        window.ProVeri.refreshBadges && window.ProVeri.refreshBadges(true);
        navigate('/inbox?tab=updates', { replace: true });
      },
    }, 'Mark all as read') : null;
    return h('div', [
      markAll ? h('div.row', { style: { justifyContent: 'flex-end', marginBottom: '10px' } }, markAll) : null,
      h('div.group', rows.map((n) => {
        const d = n.data || {};
        const bookingId = n.bookingId || d.bookingId;
        const jobId = n.jobId || d.jobId;
        const conversationId = n.conversationId || d.conversationId;
        const itemId = n.itemId || d.itemId;
        const target = bookingId ? `/order/${bookingId}` : jobId ? `/job/${jobId}` : conversationId ? `/inbox/${encodeURIComponent(conversationId)}` : itemId ? `/work/${itemId}` : null;
        const meta = updateIcon(n.type);
        return h(target ? 'a.tile' : 'div.tile', { href: target || null, onclick: () => { if (!n.read) api.post(`/api/notifications/${n.notificationId}/read`, {}).catch(() => {}); } }, [
          h('span.lead.' + meta.tone, icon(meta.icon, 20)),
          h('div.body', [
            h('div.t', n.title || 'Update'),
            n.body ? h('div.d', n.body) : null,
            h('div.d', { style: { marginTop: '4px' } }, timeAgo(n.at || n.createdAt)),
          ]),
          !n.read ? h('span.notice-dot', { 'aria-label': 'unread' }) : null,
        ]);
      })),
    ]);
  }

  function updateIcon(type) {
    const t = String(type || '');
    if (/BID|QUOTE/.test(t)) return { icon: 'quote', tone: 'gold' };
    if (/PAY|ESCROW|FUND|PAYOUT|RELEASE/.test(t)) return { icon: 'wallet', tone: '' };
    if (/MATCH|LEAD/.test(t)) return { icon: 'zap', tone: 'gold' };
    if (/DISPUTE|REJECT|RISK/.test(t)) return { icon: 'alert', tone: 'red' };
    if (/EN_ROUTE|ARRIV|ON_SITE/.test(t)) return { icon: 'navigation', tone: 'blue' };
    if (/PORTFOLIO|ENQUIR|MESSAGE|REPLY/.test(t)) return { icon: 'chat', tone: 'blue' };
    return { icon: 'bell', tone: 'grey' };
  }

  /* ================================================================== *
   * One conversation
   * ================================================================== */

  screens['/inbox/:conversationId'] = async ({ params }) => {
    const session = api.session();
    const page = h('div.page.mid');
    if (!session) {
      page.append(ui.backButton('/inbox'), signInPanel({ title: 'Sign in to read this conversation', iconName: 'inbox', next: location.pathname }));
      return page;
    }
    const conversationId = params.conversationId;
    const url = `/api/inbox/${encodeURIComponent(session.userId)}/${encodeURIComponent(conversationId)}`;
    let convo = await api.get(url);
    window.ProVeri.refreshBadges && window.ProVeri.refreshBadges(true);

    const chat = h('div.chat', { 'aria-live': 'polite' });
    const head = h('div.row', { style: { gap: '12px', padding: '6px 0 10px' } }, [
      avatar(convo.counterpart.name, 'lg'),
      h('div.grow', [
        h('div.strong', { style: { fontSize: '17px' } }, convo.counterpart.name),
        h('div.small.muted', convo.myRole === 'PRO' ? 'Homeowner' : 'Pro on ProVeri'),
      ]),
    ]);
    const context = convo.kind === 'WORK_ENQUIRY'
      ? h('a.tile', { href: `/work/${convo.itemId}` }, [
        convo.photoUrl ? h('span.lead', { style: { overflow: 'hidden', padding: 0 } }, ui.photoImg(convo.photoUrl, '', { style: { width: '100%', height: '100%', objectFit: 'cover' } })) : h('span.lead', icon('images', 20)),
        h('div.body', [h('div.d', 'About this work'), h('div.t', convo.subject)]),
        h('span.meta', icon('chevron', 18)),
      ])
      : h('a.tile', { href: `/order/${convo.bookingId}` }, [
        ui.tradeIcon(convo.categoryId, 'sm'),
        h('div.body', [h('div.d', 'Booking'), h('div.t', convo.subject)]),
        h('span.meta', ['Job tracker', icon('chevron', 18)]),
      ]);

    const hireNudge = convo.kind === 'WORK_ENQUIRY' && convo.myRole === 'CUSTOMER'
      ? h('div.card.accent.pad-sm', { style: { marginTop: '10px' } }, h('div.row', [
        h('div.grow.small', [h('b', `Ready for a price from ${firstName(convo.counterpart.name)}?`), h('div.muted', 'Post the job and they can send you a protected quote.')]),
        h('a.btn.sm', { href: `/post-job?proId=${encodeURIComponent(convo.counterpart.userId)}&from=${encodeURIComponent(convo.itemId || '')}` }, 'Get a quote'),
      ]))
      : null;

    page.append(ui.backButton('/inbox', 'Inbox'), head, context, hireNudge,
      h('div.banner.info', { style: { marginTop: '12px' } }, [h('span.ico', icon('shield', 20)), h('div.small', 'Keep chats and payments on ProVeri. Paying a pro directly loses your payment protection — and nobody here will ever ask you to.')]),
      chat);

    const paintMessages = () => {
      chat.innerHTML = '';
      if (!convo.messages.length) {
        chat.append(h('div.empty', { style: { padding: '24px 0' } }, [h('p', convo.myRole === 'CUSTOMER' ? `Say hello and ask ${firstName(convo.counterpart.name)} about the job you need.` : 'No messages yet.')]));
        return;
      }
      let lastDay = '';
      for (const m of convo.messages) {
        const day = new Date(m.at).toDateString();
        if (day !== lastDay) { chat.append(h('div.day', ui.relDay(m.at))); lastDay = day; }
        chat.append(h('div.bubble' + (m.fromMe ? '.me' : '') + (m.flagged ? '.flagged' : ''), [m.body, h('span.b-time', new Date(m.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }))]));
      }
    };
    paintMessages();

    const input = h('textarea', { name: 'message', rows: '1', placeholder: 'Write a message…', 'aria-label': 'Message', maxlength: '4000' });
    const send = h('button.btn.send', { type: 'submit', 'aria-label': 'Send' }, icon('send', 20));
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      try {
        convo = await withButton(send, () => api.post(url, { message: text }));
        input.value = '';
        paintMessages();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      } catch { /* toasted */ }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); }
    });
    const suggestions = convo.myRole === 'CUSTOMER' && !convo.messages.length
      ? h('div.suggestions', ['Are you available next week?', 'Could you do something similar at my place?', 'Roughly what would this cost?'].map((s) => h('button.chip.sm', { type: 'button', onclick: () => { input.value = s; input.focus(); } }, s)))
      : null;
    page.append(h('div.composer', [suggestions, h('form', { onsubmit: (event) => { event.preventDefault(); submit(); } }, [input, send])]));

    // Poll gently for replies while this conversation is on screen.
    const path = location.pathname;
    const timer = setInterval(async () => {
      if (location.pathname !== path) { clearInterval(timer); return; }
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      try {
        const fresh = await api.get(url);
        if (fresh.messages.length !== convo.messages.length) { convo = fresh; paintMessages(); }
      } catch { /* next tick */ }
    }, 8000);

    setTimeout(() => window.scrollTo({ top: document.body ? document.body.scrollHeight : 0 }), 60);
    return page;
  };
})();
