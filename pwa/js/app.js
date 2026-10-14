/* ==========================================================================
   ProVeri PWA — shell: router, header, tabs, the Post button,
   badges, connectivity, install and the service worker.
   ========================================================================== */

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const { h, toast, navigate, icon, avatar, firstName } = window.ProVeri.ui;
  const screens = window.ProVeri.screens;

  const main = document.getElementById('app-main');
  const nav = document.getElementById('app-nav');
  const headerNav = document.getElementById('header-nav');
  const headActions = document.getElementById('head-actions');
  const offlinePill = document.getElementById('offline-pill');
  const fabLabel = document.getElementById('fab-label');

  /* ---------------- route matching ---------------- */

  const routes = Object.keys(screens).map((pattern) => ({
    pattern,
    regex: new RegExp('^' + pattern.split('/').map((segment) => (segment.startsWith(':') ? '([^/]+)' : segment)).join('/') + '/?$'),
    keys: pattern.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1)),
  }));

  function matchRoute(pathname) {
    for (const route of routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      const params = {};
      route.keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1] || ''); });
      return { handler: screens[route.pattern], params, pattern: route.pattern };
    }
    return null;
  }

  /**
   * Task screens own the bottom of the screen (a sticky "Accept & pay", a
   * composer, a three-step form), so the tab bar slides away on them.
   */
  const FOCUS_ROUTES = /^\/(work\/|order\/|booking\/|job\/|post-job|upload-work|pro\/|inbox\/|site\/|vehicle\/|checkout|become-a-pro)/;

  /**
   * Like a native app, the whole product sits behind real sign-in: profiles,
   * quotes, feeds, inbox — everything except the sign-in screen itself.
   * After Google/email sign-in the flow re-renders the very page you asked
   * for, so deep links survive the gate.
   */
  const AUTH_FREE = /^\/sign-in\/?$/;

  function signInGate() {
    document.body.classList.add('auth-gate');
    return h('div.page.gate-page', [
      h('div.gate-hero', [
        h('div.gate-mark', icon('shield', 30)),
        h('h1.gate-title', 'Welcome to ProVeri'),
        h('p.gate-sub', 'Sign in to see verified pros, real work near you and your own jobs. Google or email — it takes a few seconds.'),
      ]),
      h('div.card.pad-lg', window.ProVeri.account.signInFlow({})),
      h('div.gate-points', [
        h('div.gp', [icon('user-check', 17), h('span', 'ID-verified pros with checked trade badges')]),
        h('div.gp', [icon('lock', 17), h('span', 'Payment held in escrow until you approve the work')]),
        h('div.gp', [icon('star', 17), h('span', 'Reviews only from jobs really paid through ProVeri')]),
      ]),
      h('p.tiny.muted.gate-legal', 'No demo accounts — every sign-in is a real identity. By continuing you agree to our terms and privacy policy.'),
    ]);
  }

  /* ---------------- render ---------------- */

  let currentRender = 0;

  async function render() {
    const pathname = location.pathname;
    const query = Object.fromEntries(new URLSearchParams(location.search).entries());
    const token = ++currentRender;
    window.ProVeri.ui.closeSheet();

    const matched = matchRoute(pathname);
    updateChrome(pathname);

    if (!api.session()) {
      document.body.classList.add('auth-gate'); // auth screens own the whole phone: no tab bar, no header actions
      if (!AUTH_FREE.test(pathname)) {
        document.title = 'Sign in · ProVeri';
        main.innerHTML = '';
        main.append(signInGate());
        return;
      }
    } else {
      document.body.classList.remove('auth-gate');
    }

    if (!matched) {
      main.innerHTML = '';
      main.append(h('div.page.narrow', h('div.empty', [
        h('div.ico', icon('map', 28)), h('h3', 'We could not find that page'),
        h('p', 'The link may be old, or the page has moved.'),
        h('button.btn', { onclick: () => navigate('/') }, 'Go to the home screen'),
      ])));
      return;
    }

    document.title = titleFor(pathname);
    main.innerHTML = '';
    main.append(h('div.page', window.ProVeri.ui.loading(3)));
    window.scrollTo({ top: 0 });

    try {
      const node = await matched.handler({ params: matched.params, query });
      if (token !== currentRender) return; // a newer navigation superseded this one
      main.innerHTML = '';
      node.classList.add('screen-enter');
      main.append(node);
      if (location.pathname !== pathname) {
        // a legacy address normalised itself mid-render: sync chrome to the canonical URL
        document.title = titleFor(location.pathname);
        updateChrome(location.pathname);
      }
    } catch (error) {
      if (token !== currentRender) return;
      main.innerHTML = '';
      main.append(h('div.page.narrow', h('div.empty', [
        h('div.ico', icon(error.status === 0 ? 'offline' : 'alert', 28)),
        h('h3', error.status === 0 ? 'You seem to be offline' : error.status === 404 ? 'This no longer exists' : 'That did not load'),
        h('p', error.status === 404 ? 'It may have been removed or the link is wrong.' : window.ProVeri.ui.friendlyError(error)),
        h('div.btn-row', { style: { justifyContent: 'center', marginTop: '18px' } }, [
          h('button.btn', { onclick: render }, 'Try again'),
          h('button.btn.ghost', { onclick: () => navigate('/') }, 'Home'),
        ]),
      ])));
    }
    refreshBadges();
  }

  function titleFor(pathname) {
    const titles = {
      '/': 'ProVeri — hire a pro with proof',
      '/browse': 'Explore real work near you · ProVeri',
      '/orders': 'Your jobs · ProVeri',
      '/inbox': 'Inbox · ProVeri',
      '/me': 'Your account · ProVeri',
      '/sign-in': 'Sign in · ProVeri',
      '/upload-work': 'Add your work · ProVeri',
      '/find-a-pro': 'Find a verified pro · ProVeri',
      '/post-job': 'Post a job · ProVeri',
      '/trust': 'How we protect you · ProVeri',
      '/vehicles': 'Verified vehicles · ProVeri',
      '/property': 'Property (coming soon) · ProVeri',
      '/business-studio': 'Business Site Studio · ProVeri',
      '/sites': 'Sites built on ProVeri',
      '/sales-desk': 'Sales desk · ProVeri',
      '/become-a-pro': 'Join as a pro · ProVeri',
      '/admin': 'Trust desk · ProVeri',
      '/integrations': 'Data & integrations · ProVeri',
      '/wallet': 'Earnings · ProVeri',
    };
    if (titles[pathname]) return titles[pathname];
    if (pathname.startsWith('/work/')) return 'Work · ProVeri';
    if (pathname.startsWith('/order/')) return 'Job tracker · ProVeri';
    if (pathname.startsWith('/job/')) return 'Job · ProVeri';
    if (pathname.startsWith('/booking/')) return 'Job tracker · ProVeri';
    if (pathname.startsWith('/pro/')) return 'Pro profile · ProVeri';
    if (pathname.startsWith('/inbox/')) return 'Conversation · ProVeri';
    if (pathname.startsWith('/vehicle/')) return 'Vehicle · ProVeri';
    if (pathname.startsWith('/site/')) return 'Site editor · ProVeri';
    return 'ProVeri';
  }

  function activeTab(pathname) {
    if (pathname === '/') return '/';
    if (/^\/(browse|work\/|pro\/|find-a-pro)/.test(pathname)) return '/browse';
    if (/^\/(orders|order\/|booking|job\/|post-job|wallet)/.test(pathname)) return '/orders';
    if (/^\/(inbox|notifications)/.test(pathname)) return '/inbox';
    return null;
  }

  /* ---------------- chrome: tabs, header, Post ---------------- */

  function updateChrome(pathname) {
    const active = activeTab(pathname);
    for (const button of Array.from(nav.querySelectorAll('button[data-nav]'))) {
      // classList.toggle is avoided on purpose: add/remove behave the same everywhere.
      if (button.dataset.nav === active) { button.classList.add('active'); button.setAttribute('aria-current', 'page'); }
      else { button.classList.remove('active'); button.removeAttribute('aria-current'); }
    }
    if (FOCUS_ROUTES.test(pathname)) document.body.classList.add('focus-mode');
    else document.body.classList.remove('focus-mode');
    paintHeader(active);
  }

  function paintHeader(active) {
    const session = api.session();
    const isPro = session && session.role === 'PRO';
    if (fabLabel) fabLabel.textContent = isPro ? 'Add work' : 'Post';

    headerNav.innerHTML = '';
    const links = [
      ['/', 'Home', 'home'],
      ['/browse', 'Explore', 'search'],
      ['/orders', isPro ? 'Leads & jobs' : 'Your jobs', 'jobs'],
      ['/inbox', 'Inbox', 'inbox'],
    ];
    for (const [href, label] of links) {
      headerNav.append(h('a.nav-link' + (active === href ? '.active' : ''), { href }, [
        label,
        href === '/inbox' && badgeCount ? h('span.count-badge', String(Math.min(badgeCount, 99))) : null,
      ]));
    }

    headActions.innerHTML = '';
    headActions.append(h('a.btn.sm.head-post', { href: isPro ? '/upload-work' : '/post-job' }, [icon('plus', 18), isPro ? 'Add work' : 'Post a job']));
    if (session) {
      headActions.append(h('a.avatar-btn', { href: '/me', 'aria-label': `Your account — ${session.name || 'signed in'}`, title: session.name || 'Your account' }, [
        avatar(session.name || 'You'),
        isPro ? h('span.role-dot', { title: 'Pro account' }, icon('tool', 9, { stroke: 3 })) : null,
      ]));
    } else {
      headActions.append(h('button.btn.sm.ghost', { type: 'button', onclick: () => window.ProVeri.account.openSignIn() }, 'Sign in'));
    }
  }

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-nav]');
    if (!button) return;
    navigate(button.dataset.nav);
  });

  /* One button, both sides of the market. */
  const fab = document.getElementById('fab');
  if (fab) {
    fab.addEventListener('click', () => {
      const session = api.session();
      if (session && session.role === 'PRO') return navigate('/upload-work');
      if (session) return navigate('/post-job');
      const { sheet, closeSheet } = window.ProVeri.ui;
      sheet('What would you like to do?', h('div.list', [
        h('button.tile', { type: 'button', onclick: () => { closeSheet(); navigate('/post-job'); } }, [
          h('span.lead', icon('clipboard-check', 22)),
          h('div.body', [h('div.t', 'Get a job done'), h('div.d', 'Describe it once, get quotes from verified pros nearby. Free to post.')]),
          h('span.meta', icon('chevron', 18)),
        ]),
        h('button.tile', { type: 'button', onclick: () => { closeSheet(); navigate('/become-a-pro'); } }, [
          h('span.lead.gold', icon('camera', 22)),
          h('div.body', [h('div.t', 'I am a pro — show my work'), h('div.d', 'Get hired for work you have already done. No lead fees.')]),
          h('span.meta', icon('chevron', 18)),
        ]),
      ]));
    });
  }

  window.addEventListener('popstate', render);
  window.addEventListener('proveri:session', () => {
    badgeCount = 0;
    const gated = document.body.classList.contains('auth-gate');
    // Signed in on the gate, or signed out somewhere inside: re-render.
    if ((api.session() && gated) || (!api.session() && !AUTH_FREE.test(location.pathname))) { render(); return; }
    paintHeader(activeTab(location.pathname));
    refreshBadges(true);
  });

  /* Header gains a hairline once the page scrolls under it. */
  let scrolled = false;
  window.addEventListener('scroll', () => {
    const now = window.scrollY > 6;
    if (now === scrolled) return;
    scrolled = now;
    if (now) document.body.classList.add('scrolled'); else document.body.classList.remove('scrolled');
  }, { passive: true });

  /* ---------------- unread badges ---------------- */

  let badgeCount = 0;
  let badgeFetchedAt = 0;

  async function refreshBadges(force) {
    const session = api.session();
    const inboxTab = nav.querySelector('button[data-nav="/inbox"]');
    if (!session) { paintBadge(inboxTab, 0); return; }
    if (!force && Date.now() - badgeFetchedAt < 15000) { paintBadge(inboxTab, badgeCount); return; }
    badgeFetchedAt = Date.now();
    try {
      const [inbox, updates] = await Promise.all([
        api.get(`/api/inbox/${encodeURIComponent(session.userId)}`).catch(() => ({ unread: 0 })),
        api.get(`/api/notifications/${encodeURIComponent(session.userId)}?unreadOnly=true&limit=99`).catch(() => []),
      ]);
      badgeCount = (inbox.unread || 0) + (Array.isArray(updates) ? updates.length : 0);
    } catch { /* badges are a nicety */ }
    paintBadge(inboxTab, badgeCount);
    paintHeader(activeTab(location.pathname));
  }
  window.ProVeri.refreshBadges = refreshBadges;

  function paintBadge(button, count) {
    if (!button) return;
    const existing = button.querySelector('.count-badge');
    if (existing) existing.remove();
    if (count > 0) button.append(h('span.count-badge', { 'aria-label': `${count} unread` }, String(Math.min(count, 99))));
  }

  setInterval(() => { if (document.visibilityState === 'visible') refreshBadges(true); }, 60000);

  /* ---------------- connectivity ---------------- */

  function paintConnectivity() {
    offlinePill.hidden = navigator.onLine;
  }
  window.addEventListener('online', () => {
    paintConnectivity();
    toast('Back online.', 'ok');
  });
  window.addEventListener('offline', () => {
    paintConnectivity();
    toast('You are offline. You can still browse what you have already seen.', 'warn');
  });
  window.addEventListener('proveri:queue-replayed', (event) => {
    const ok = (event.detail || []).filter((r) => r.ok).length;
    if (ok) toast(`${ok === 1 ? 'Your saved change was' : `${ok} saved changes were`} sent now that you are back online.`, 'ok');
  });

  /* ---------------- install ---------------- */

  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
  });
  window.ProVeri.canInstall = () => Boolean(deferredInstall);
  window.ProVeri.install = async function install() {
    if (!deferredInstall) {
      window.ProVeri.ui.sheet('Install ProVeri on your phone', h('div.stack', [
        h('p.muted', 'It opens like an app, sends you job updates and works with a weak signal.'),
        h('div.tile', [h('span.lead.grey', icon('phone', 22)), h('div.body', [h('div.t', 'iPhone (Safari)'), h('div.d', 'Tap Share, then “Add to Home Screen”.')])]),
        h('div.tile', [h('span.lead.grey', icon('install', 22)), h('div.body', [h('div.t', 'Android (Chrome)'), h('div.d', 'Tap the ⋮ menu, then “Install app”.')])]),
      ]));
      return false;
    }
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice;
    deferredInstall = null;
    return choice.outcome === 'accepted';
  };

  /* ---------------- service worker ---------------- */

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A fresh version of ProVeri is ready.', 'ok', { label: 'Reload', onClick: () => location.reload() });
          }
        });
      });
    } catch (error) {
      console.warn('Service worker registration failed:', error.message);
    }
  }

  /* ---------------- boot ---------------- */

  let booted = false;

  async function boot() {
    if (booted) return; // deferred scripts can see readyState 'interactive' *and* DOMContentLoaded
    booted = true;
    paintConnectivity();
    paintHeader(activeTab(location.pathname));
    registerServiceWorker();
    try {
      await api.boot();
    } catch (error) {
      console.warn('boot fetch failed:', error.message);
    }
    await render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
