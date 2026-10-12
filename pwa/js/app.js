/* ==========================================================================
   Lula ProVeri PWA — bootstrap, client router, navigation, install & SW
   ========================================================================== */

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const { h, toast, navigate } = window.ProVeri.ui;
  const screens = window.ProVeri.screens;

  const main = document.getElementById('app-main');
  const nav = document.getElementById('app-nav');
  const connPill = document.getElementById('conn-pill');
  const notifDot = document.getElementById('notif-dot');

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

  /* ---------------- render ---------------- */

  let currentRender = 0;

  async function render() {
    const pathname = location.pathname;
    const query = Object.fromEntries(new URLSearchParams(location.search).entries());
    const token = ++currentRender;

    const matched = matchRoute(pathname);
    if (!matched) {
      main.innerHTML = '';
      main.append(h('div.empty', [
        h('div.ico', '🧭'), h('h3', 'Page not found'),
        h('p.small', `${pathname} does not exist on ProVeri.`),
        h('button.btn', { onclick: () => navigate('/') }, 'Take me home'),
      ]));
      return;
    }

    updateNav(pathname);
    document.title = titleFor(pathname);
    main.innerHTML = '';
    main.append(h('div.skeleton.line', { style: { width: '45%' } }), h('div.skeleton.card'), h('div.skeleton.card'));
    main.scrollTop = 0;
    window.scrollTo({ top: 0 });

    try {
      const node = await matched.handler({ params: matched.params, query });
      if (token !== currentRender) return; // a newer navigation superseded this one
      main.innerHTML = '';
      main.append(node);
    } catch (error) {
      if (token !== currentRender) return;
      main.innerHTML = '';
      main.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', [h('strong', 'Could not load this screen'), h('div.small', error.message)])]),
        h('button.btn.ghost', { style: { marginTop: '12px' }, onclick: render }, 'Try again'));
    }
  }

  function titleFor(pathname) {
    const titles = {
      '/': 'Lula ProVeri — real work near you 🇿🇦',
      '/browse': 'Browse work near you · Lula ProVeri',
      '/orders': 'My orders · Lula ProVeri',
      '/me': 'You · Lula ProVeri',
      '/upload-work': 'Upload your work · Lula ProVeri',
      '/find-a-pro': 'Find a verified pro · Lula ProVeri',
      '/post-job': 'Post a job · Lula ProVeri',
      '/bookings': 'My jobs · Lula ProVeri',
      '/trust': 'Trust & transparency · Lula ProVeri',
      '/vehicles': 'Verified vehicles · Lula ProVeri',
      '/property': 'Property (coming soon) · Lula ProVeri',
      '/web-studio': 'Web Studio · Lula ProVeri',
      '/business-studio': 'Business Site Studio · Lula ProVeri',
      '/sites': 'Sites built on ProVeri',
      '/sales-desk': 'Sales desk · Lula ProVeri',
      '/become-a-pro': 'Become a verified pro · Lula ProVeri',
      '/admin': 'Trust desk · Lula ProVeri',
      '/integrations': 'Data & integrations · Lula ProVeri',
      '/wallet': 'Wallet & earnings · Lula ProVeri',
      '/notifications': 'Notifications · Lula ProVeri',
      '/profile': 'Profile · Lula ProVeri',
    };
    if (titles[pathname]) return titles[pathname];
    if (pathname.startsWith('/work/')) return 'Work · Lula ProVeri';
    if (pathname.startsWith('/order/')) return 'Order · Lula ProVeri';
    if (pathname.startsWith('/job/')) return 'Job · Lula ProVeri';
    if (pathname.startsWith('/booking/')) return 'Booking · Lula ProVeri';
    if (pathname.startsWith('/pro/')) return 'Pro profile · Lula ProVeri';
    if (pathname.startsWith('/vehicle/')) return 'Vehicle · Lula ProVeri';
    if (pathname.startsWith('/site/')) return 'Site editor · Lula ProVeri';
    return 'Lula ProVeri';
  }

  function updateNav(pathname) {
    const active = pathname === '/' ? '/'
      : pathname.startsWith('/browse') || pathname.startsWith('/work/') || pathname.startsWith('/pro/') || pathname.startsWith('/find-a-pro') ? '/browse'
      : pathname.startsWith('/orders') || pathname.startsWith('/order/') || pathname.startsWith('/booking') || pathname.startsWith('/job/') || pathname.startsWith('/post-job') ? '/orders'
      : pathname.startsWith('/me') || pathname.startsWith('/profile') || pathname.startsWith('/wallet') || pathname.startsWith('/notifications') || pathname.startsWith('/upload-work') ? '/me'
      : null;
    nav.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('active', button.dataset.nav === active);
    });
  }

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-nav]');
    if (!button) return;
    navigate(button.dataset.nav);
  });

  document.getElementById('btn-notifications').addEventListener('click', () => navigate('/notifications'));
  document.getElementById('btn-profile').addEventListener('click', () => navigate('/me'));

  /* One button, two sides of the market: hire somebody, or publish your work. */
  const fab = document.getElementById('fab');
  if (fab) {
    fab.addEventListener('click', () => {
      const session = window.ProVeri.api.session();
      const { h: make, sheet: openSheet } = window.ProVeri.ui;
      openSheet('What do you want to do?', make('div.col', { style: { gap: '10px' } }, [
        make('button.btn.block', {
          onclick: () => { window.ProVeri.ui.closeSheet(); navigate('/post-job'); },
        }, '🛠️ I need work done — post a job'),
        make('button.btn.block.ghost', {
          onclick: () => { window.ProVeri.ui.closeSheet(); navigate(session && session.role === 'PRO' ? '/upload-work' : '/become-a-pro'); },
        }, session && session.role === 'PRO' ? '📷 Upload work I have done' : '📷 I am a pro — publish my work'),
        make('p.tiny.muted', 'Home owners reach out to pros through the work they publish. Every escrow-released job adds itself to your portfolio automatically.'),
      ]));
    });
  }

  window.addEventListener('popstate', render);

  /* ---------------- connectivity ---------------- */

  function paintConnectivity() {
    const online = navigator.onLine;
    connPill.textContent = online ? '●' : 'offline';
    connPill.title = online ? 'Online' : 'Offline — cached catalogue and queued changes';
    connPill.classList.toggle('offline', !online);
  }
  window.addEventListener('online', paintConnectivity);
  window.addEventListener('offline', () => {
    paintConnectivity();
    toast('You are offline. ProVeri keeps working from the cached catalogue, and anything you submit is queued and sent on reconnect.', 'warn');
  });
  window.addEventListener('proveri:queue-replayed', (event) => {
    const ok = (event.detail || []).filter((r) => r.ok).length;
    toast(`${ok} queued change(s) synced now that you are back online`, 'ok');
  });

  /* ---------------- install prompt ---------------- */

  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    const seen = sessionStorage.getItem('proveri.install-dismissed');
    if (!seen && !window.matchMedia('(display-mode: standalone)').matches) {
      setTimeout(() => {
        toast('Tip: install ProVeri to your home screen for the full app experience — it also works offline.', 'ok');
      }, 4000);
    }
  });
  window.ProVeri.install = async function install() {
    if (!deferredInstall) {
      toast('On iPhone: Share → Add to Home Screen. On Android/Chrome: menu → Install app.', 'warn');
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
            toast('A new version of ProVeri is ready — reload to switch.', 'ok');
          }
        });
      });
    } catch (error) {
      console.warn('Service worker registration failed:', error.message);
    }
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    paintConnectivity();
    registerServiceWorker();

    try {
      await api.boot();
    } catch (error) {
      console.warn('boot fetch failed:', error.message);
    }

    // Share-target deep link: ?title=&text= from the Web Share API.
    const params = new URLSearchParams(location.search);
    if (params.get('text') && location.pathname === '/post-job') {
      sessionStorage.setItem('proveri.share-draft', params.get('text'));
    }

    await render();

    // Unread notifications dot.
    const session = api.session();
    if (session) {
      api.get(`/api/notifications/${session.userId}?unreadOnly=true&limit=1`)
        .then((rows) => { notifDot.hidden = !rows.length; })
        .catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
