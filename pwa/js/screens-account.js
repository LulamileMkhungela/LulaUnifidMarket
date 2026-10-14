/* ==========================================================================
   ProVeri PWA — accounts and conversations

   /sign-in            one flow: email + password, or Google (Firebase Auth)
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

  /* ================================================================== *
   * Sign in — email + password, or Google. Both are real Firebase
   * identities; there are no demo accounts in this app.
   * ================================================================== */

  const FIREBASE_SDK = [
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.addEventListener('load', resolve);
      tag.addEventListener('error', () => reject(new Error(`could not load ${src}`)));
      document.head.append(tag);
    });
  }

  let firebasePromise = null;
  /** Lazily boot the Firebase web SDK (only when a cloud config exists). */
  function firebaseAuth() {
    if (window.firebase && window.firebase.auth) return Promise.resolve(window.firebase.auth());
    if (!firebasePromise) {
      const cfg = (api.cloud() || {}).firebase;
      if (!cfg || !cfg.apiKey) return Promise.reject(new Error('Firebase is not configured on this server.'));
      firebasePromise = (async () => {
        for (const src of FIREBASE_SDK) await loadScript(src);
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp({
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            messagingSenderId: cfg.messagingSenderId,
            appId: cfg.appId || undefined,
          });
        }
        return window.firebase.auth();
      })();
    }
    return firebasePromise;
  }

  async function googleSignIn() {
    const auth = await firebaseAuth();
    const provider = new window.firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    const idToken = await result.user.getIdToken();
    return api.post('/api/auth/session', { idToken });
  }

  /**
   * The whole sign-in journey in one element. `onDone(session)` runs after a
   * successful sign-in or sign-up; by default the current screen re-renders.
   */
  function signInFlow(opts) {
    const options = opts || {};
    const cloud = api.cloud() || {};
    let mode = 'login';

    const error = h('div.field-error', { hidden: true });
    const email = h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.co.za' });
    const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: '6', placeholder: 'Your password' });
    const nameField = h('label.field', [h('span', 'Your name'), h('input', { name: 'fullName', type: 'text', autocomplete: 'name', placeholder: 'First and last name' })]);
    const suburbField = h('label.field', [h('span', ['Your suburb ', h('small', 'so we show pros near you')]), h('select', { name: 'suburbId' }, [h('option', { value: '' }, 'Choose later'), ...suburbOptions(options.suburbId || '')])]);
    nameField.hidden = true;
    suburbField.hidden = true;

    const submit = h('button.btn.block.lg', { type: 'button' }, 'Sign in');
    const modeLink = h('button.btn.sm.link', { type: 'button' }, 'Create one instead');

    function finish(session) {
      api.setSession(session);
      window.ProVeri.refreshBadges && window.ProVeri.refreshBadges(true);
      toast(session.name ? `Welcome, ${firstName(session.name)}.` : 'Signed in.', 'ok');
      if (options.onDone) options.onDone(session);
      else navigate(location.pathname, { replace: true });
    }
    function fail(message) {
      error.textContent = message;
      error.hidden = false;
    }

    function paintMode() {
      const registering = mode === 'register';
      nameField.hidden = !registering;
      suburbField.hidden = !registering;
      password.autocomplete = registering ? 'new-password' : 'current-password';
      password.placeholder = registering ? 'At least 6 characters' : 'Your password';
      submit.innerHTML = '';
      submit.append(registering ? 'Create my account' : 'Sign in', icon('arrow', 18));
      modeLink.innerHTML = '';
      modeLink.append(registering ? 'Already have an account? Sign in' : 'No account yet? Create one instead');
    }
    modeLink.addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; error.hidden = true; paintMode(); });

    submit.addEventListener('click', async () => {
      error.hidden = true;
      const values = { email: email.value.trim(), password: password.value };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) { fail('Enter a valid email address.'); email.focus(); return; }
      if (!values.password) { fail('Enter your password.'); password.focus(); return; }
      const body = mode === 'register'
        ? { ...values, fullName: (nameField.querySelector('input') || {}).value || '', suburbId: (suburbField.querySelector('select') || {}).value || null }
        : values;
      try {
        const result = await withButton(submit, () => api.post(mode === 'register' ? '/api/auth/register' : '/api/auth/login', body));
        closeSheet();
        finish(result.session);
      } catch (e) {
        fail(ui.friendlyError(e));
      }
    });

    const google = h('button.btn.block.lg.subtle', { type: 'button' }, [icon('globe', 18), 'Continue with Google']);
    google.addEventListener('click', async () => {
      error.hidden = true;
      try {
        const result = await withButton(google, googleSignIn);
        closeSheet();
        finish(result.session);
      } catch (e) {
        fail(`${ui.friendlyError(e)} — email sign-in works too.`);
      }
    });

    paintMode();
    const box = h('div.stack', [
      cloud.online === false
        ? h('div.banner.warn', [h('span.ico', icon('alert', 18)), h('div.small', 'This server cannot reach Firebase right now. Email accounts will be created on this server only, and Google sign-in is unavailable until it can.')])
        : null,
      google,
      h('div.or-line', 'or with your email'),
      h('label.field', [h('span', 'Email'), email]),
      h('label.field', [h('span', 'Password'), password]),
      nameField,
      suburbField,
      error,
      submit,
      h('p.tiny.muted.center', modeLink),
      h('p.tiny.muted.center', ['Are you a tradesperson? ', h('a', { href: '/become-a-pro', onclick: () => closeSheet() }, 'Join as a pro'), '.']),
    ]);
    setTimeout(() => email.focus(), 50);
    return box;
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
