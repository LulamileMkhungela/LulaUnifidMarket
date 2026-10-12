/* ==========================================================================
   Lula ProVeri PWA — tiny UI toolkit (no framework, no build step)
   ========================================================================== */

window.ProVeri = window.ProVeri || {};

(function () {
  'use strict';

  /**
   * Hyperscript-lite. h('div.card', { onclick }, [child, 'text'])
   */
  function h(tag, props, children) {
    let element;
    const [name, ...classes] = String(tag).split('.');
    element = document.createElement(name || 'div');
    if (classes.length) element.className = classes.join(' ');

    // h('div', [a, b]), h('div', 'text') and h('div', node) are all used across
    // the screens, so a second argument that is not a props object is children.
    if (props !== null && typeof props === 'object' && !Array.isArray(props) && !(props instanceof Node)) {
      // a props object
    } else if (props !== undefined && props !== null) {
      children = children === undefined ? props : [props, children];
      props = {};
    }

    props = props || {};
    children = children === undefined ? [] : (Array.isArray(children) ? children : [children]);

    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') element.className = `${element.className} ${value}`.trim();
      else if (key === 'html') element.innerHTML = value;
      else if (key === 'text') element.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
      else if (key === 'dataset') Object.assign(element.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
      else if (key === 'value') element.value = value;
      else if (key === 'checked') element.checked = Boolean(value);
      else if (key === 'disabled') element.disabled = Boolean(value);
      else if (value === true) element.setAttribute(key, '');
      else element.setAttribute(key, String(value));
    }

    for (const child of children.flat(4)) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
  }

  /* ---------------- money, dates, stars ---------------- */

  const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const zarExact = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function money(cents, exact) {
    if (cents === null || cents === undefined) return '—';
    return (exact ? zarExact : zar).format(cents / 100);
  }

  function moneyBig(cents) {
    return h('span.money.big', money(cents));
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} d ago`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months} mo ago`;
    return `${Math.round(months / 12)} y ago`;
  }

  function dateShort(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function dateTimeShort(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function countdown(iso) {
    if (!iso) return '';
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours >= 1) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function stars(rating) {
    const value = Number(rating) || 0;
    const full = Math.floor(value);
    const half = value - full >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
  }

  function badge(text, tone) {
    return h('span.badge.' + (tone || 'neutral'), String(text).replace(/_/g, ' '));
  }

  function trustBadge(badgeName, score) {
    const tone = badgeName === 'PROVERI_ELITE' ? 'elite'
      : ['PROVERI_VERIFIED', 'TRADE_VERIFIED', 'IDENTITY_VERIFIED', 'VEHICLE_VERIFIED', 'VEHICLE_ESCROW_READY'].includes(badgeName) ? 'verified'
      : badgeName === 'RECHECK_REQUIRED' ? 'warn'
      : ['SUSPENDED', 'REMOVED_FOR_RISK'].includes(badgeName) ? 'danger'
      : 'neutral';
    return h('span', { class: 'row', style: { gap: '6px' } },
      badge(badgeName, tone),
      score != null ? h('span.tiny.muted', `${score}/100`) : null);
  }

  /* ---------------- feedback ---------------- */

  function toast(message, tone) {
    const container = document.getElementById('toasts');
    const icon = tone === 'ok' ? '✅' : tone === 'warn' ? '⚠️' : tone === 'danger' ? '⛔' : 'ℹ️';
    const node = h('div.toast.' + (tone || ''), [h('span', icon), h('span.grow', message)]);
    container.append(node);
    setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .3s'; }, 4200);
    setTimeout(() => node.remove(), 4700);
    return node;
  }

  function sheet(title, content, actions) {
    const backdrop = document.getElementById('sheet-backdrop');
    const sheetEl = document.getElementById('sheet');
    sheetEl.innerHTML = '';
    sheetEl.append(
      h('div.grab'),
      h('div.row.between', { style: { marginBottom: '12px' } }, [
        h('h3', title),
        h('button.chip', { onclick: closeSheet }, 'Close'),
      ]),
      content,
      actions ? h('div.col', { style: { marginTop: '16px' } }, actions) : null,
    );
    backdrop.classList.add('open');
    sheetEl.classList.add('open');
    return closeSheet;

    function closeSheet() {
      backdrop.classList.remove('open');
      sheetEl.classList.remove('open');
    }
  }

  function closeSheet() {
    document.getElementById('sheet-backdrop').classList.remove('open');
    document.getElementById('sheet').classList.remove('open');
  }

  document.addEventListener('click', (event) => {
    if (event.target.id === 'sheet-backdrop') closeSheet();
  });

  function loading(lines) {
    return h('div.fade-in', Array.from({ length: lines || 3 }).map(() => h('div.skeleton.line', { style: { width: `${60 + Math.random() * 35}%` } })));
  }

  function loadingCards(count) {
    return h('div.list', Array.from({ length: count || 3 }).map(() => h('div.skeleton.card')));
  }

  function empty(icon, title, body, action) {
    return h('div.empty.card.flat', [
      h('div.ico', icon),
      h('h3', title),
      body ? h('p.small', body) : null,
      action || null,
    ]);
  }

  /* ---------------- navigation ---------------- */

  function navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, '', path);
    else history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  /** Intercept plain in-app links. */
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('wa.me') || href.includes('wa.me')) return;
    if (anchor.hasAttribute('target')) return;
    event.preventDefault();
    navigate(href);
  });

  /* ---------------- small helpers ---------------- */

  function formValues(form) {
    const data = {};
    for (const element of form.querySelectorAll('input,select,textarea')) {
      if (!element.name) continue;
      if (element.type === 'checkbox') data[element.name] = element.checked;
      else if (element.type === 'number') data[element.name] = element.value === '' ? null : Number(element.value);
      else data[element.name] = element.value;
    }
    return data;
  }

  async function withButton(button, fn) {
    const original = button.textContent;
    button.classList.add('loading');
    button.disabled = true;
    try {
      return await fn();
    } catch (error) {
      toast(error.message || 'Something went wrong', 'danger');
      throw error;
    } finally {
      button.classList.remove('loading');
      button.disabled = false;
      button.textContent = original;
    }
  }

  function copy(text, label) {
    navigator.clipboard?.writeText(text).then(
      () => toast(`${label || 'Copied'} — ${text}`, 'ok'),
      () => toast('Could not copy on this device', 'warn'),
    );
  }

  function share({ title, text, url }) {
    if (navigator.share) {
      navigator.share({ title, text, url }).catch(() => {});
      return true;
    }
    copy(url || text, 'Link copied');
    return false;
  }

  function trustBar(score) {
    return h('div.trust-bar', h('i', { style: { width: `${Math.max(4, Number(score) || 0)}%` } }));
  }

  function sectionHead(title, link, href) {
    return h('div.section-head', [h('h2', title), link ? h('a', { href }, link) : null]);
  }

  /* ---------------- crisp line icons (no emoji in the chrome) ---------------- */

  const ICON_PATHS = {
    home: '<path d="M3.5 10.6 12 3.4l8.5 7.2"/><path d="M5.6 9.4V20a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1V9.4"/>',
    search: '<circle cx="11" cy="11" r="6.6"/><path d="m16 16 4.6 4.6"/>',
    receipt: '<path d="M6.5 3h11v18l-1.9-1.4L13.7 21l-1.7-1.4L10.3 21l-1.9-1.4L6.5 21Z"/><path d="M9.5 8h5M9.5 12h5"/>',
    user: '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.6 20.4c1.4-3.7 4.4-5.6 7.4-5.6s6 1.9 7.4 5.6"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    star: '<path d="m12 3.7 2.47 5.02 5.53.8-4 3.9.94 5.5L12 16.33l-4.94 2.6.94-5.5-4-3.9 5.53-.8Z"/>',
    shield: '<path d="M12 3.2 18.6 6v5.6c0 4.3-2.8 7.2-6.6 8.9-3.8-1.7-6.6-4.6-6.6-8.9V6Z"/><path d="m9.2 11.9 2 2 3.6-3.9"/>',
    camera: '<path d="M4 8.2h3l1.6-2.4h6.8L17 8.2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.4" r="3.4"/>',
    pin: '<path d="M12 21.2s-6.8-5.9-6.8-10.7a6.8 6.8 0 1 1 13.6 0c0 4.8-6.8 10.7-6.8 10.7Z"/><circle cx="12" cy="10.3" r="2.5"/>',
    chat: '<path d="M4 5.6h16v10.6h-10L4 20.6Z"/><path d="M8 9.4h8M8 12.4h5"/>',
    chevron: '<path d="m9.4 5.8 6.2 6.2-6.2 6.2"/>',
    bell: '<path d="M6.4 9.6a5.6 5.6 0 1 1 11.2 0c0 4.6 1.8 5.8 1.8 5.8H4.6s1.8-1.2 1.8-5.8"/><path d="M10.2 19.4a1.9 1.9 0 0 0 3.6 0"/>',
    close: '<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>',
    check: '<path d="m5.4 12.4 4.6 4.6 8.6-9.8"/>',
    arrow: '<path d="M4.8 12h14.4M13.6 6.2 19.4 12l-5.8 5.8"/>',
    wallet: '<path d="M4 7.4A1.4 1.4 0 0 1 5.4 6h13.2v12.6H5.4A1.4 1.4 0 0 1 4 17.2Z"/><path d="M15 12.3h5.4"/><circle cx="16.6" cy="12.3" r=".9"/>',
    upload: '<path d="M12 15.6V4.4M6.8 9.2 12 4l5.2 5.2M4.4 19.6h15.2"/>',
    sparkle: '<path d="m12 3.6 1.7 4.9 4.9 1.7-4.9 1.7L12 16.8l-1.7-4.9-4.9-1.7 4.9-1.7Z"/><path d="M18.8 15.6l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
    filter: '<path d="M4.6 6.4h14.8M7.4 12h9.2M10.2 17.6h3.6"/>',
    tool: '<path d="M14.2 6.6a3.9 3.9 0 1 0-5.3 5.3L4 16.8V20h3.2l4.9-4.9a3.9 3.9 0 0 0 5.3-5.3l-2.6 2.6-2.2-2.2Z"/>',
    car: '<path d="M3.6 16.2v-3.6l1.8-.7 2.2-4.3h8.8l2.2 4.3 1.8.7v3.6"/><path d="M3.6 16.2h16.8v2.2h-2.6v-2.2M3.6 16.2v2.2h2.6v-2.2"/><circle cx="7.6" cy="13.6" r="1"/><circle cx="16.4" cy="13.6" r="1"/>',
    globe: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.4 2.5 3.6 5.3 3.6 8.4s-1.2 5.9-3.6 8.4c-2.4-2.5-3.6-5.3-3.6-8.4S9.6 6.1 12 3.6Z"/>',
    store: '<path d="M4.2 9.8h15.6V20H4.2Z"/><path d="M3.2 9.8 5.6 4.2h12.8l2.4 5.6"/><path d="M9.8 20v-5.4h4.4V20"/>',
    briefcase: '<rect x="3.4" y="7.6" width="17.2" height="11.8" rx="2"/><path d="M9 7.6V6a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 6v1.6M3.4 12.6h17.2"/>',
    link: '<path d="m9.8 14.2 4.4-4.4"/><path d="M11.2 6.8 13 5a3.9 3.9 0 0 1 5.5 5.5l-1.8 1.8"/><path d="M12.8 17.2 11 19a3.9 3.9 0 0 1-5.5-5.5l1.8-1.8"/>',
    scale: '<path d="M12 4.4v15.2M6.4 8.2h11.2M8.6 19.6h6.8"/><path d="m6.4 8.2-2.8 6.2h5.6Z"/><path d="m17.6 8.2-2.8 6.2h5.6Z"/>',
    install: '<path d="M12 3.8v10.6M7.6 10.2 12 14.6l4.4-4.4"/><path d="M4.4 19.6h15.2"/>',
  };

  /** h(icon('home')) — a 24-grid stroke icon inheriting currentColor. */
  function icon(name, size) {
    const px = size || 22;
    return h('span.icon', {
      style: { width: px + 'px', height: px + 'px' },
      html: `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.sparkle}</svg>`,
    });
  }

  /* The catalogue's own icons repeat (four trades share a sponge), so the shop
   * draws one distinct glyph per trade. Falls back to the catalogue icon. */
  const CAT_ICONS = {
    plumbing: '🚿', electrical: '⚡', 'solar-inverter': '☀️', 'gas-installation': '🔥',
    'building-construction': '🧱', handyman: '🛠️', painting: '🎨', 'cleaning-home': '🧼',
    'pest-control': '🐜', gardening: '🌿', 'paving-waterproofing': '🪨', 'fencing-gates': '🚧',
    'electric-fence-security': '📹', 'borehole-water': '💧', 'appliance-repair': '🔩',
    airconditioning: '❄️', 'roofing-gutters': '🏠', catering: '🍲', 'events-decor': '🎉',
    'beauty-mobile': '💅', 'web-digital': '💻', 'it-support': '🖥️', 'auto-mechanical': '🚗',
    'vehicle-inspection': '🔍', 'towing-transport': '🚚', 'moving-removals': '📦',
    'courier-logistics': '🛵', 'accounting-tax': '🧾', 'legal-compliance': '⚖️',
    'tutoring-education': '📚', 'care-nursing': '🩺', childcare: '🧸',
  };

  /** catIcon({ id, icon }) — the glyph the shop shows for a trade. */
  function catIcon(category) {
    if (!category) return '🧰';
    const id = typeof category === 'string' ? category : category.id;
    return CAT_ICONS[id] || (typeof category === 'object' && category.icon) || '🧰';
  }

  /**
   * Hosted artwork ships a 480px sibling next to the full frame, so a grid of
   * twelve jobs costs ~250 KB instead of ~2 MB on a phone. Uploaded photos are
   * inline data URLs and are returned untouched.
   */
  function thumb(url) {
    if (typeof url === 'string' && url.indexOf('/img/work/') === 0 && !/\.thumb\.jpe?g$/i.test(url)) {
      return url.replace(/\.jpe?g$/i, '.thumb.jpg');
    }
    return url;
  }

  /** A lazy <img> that falls back to the full frame if the thumbnail is missing. */
  function photoImg(src, alt, extra) {
    return h('img', Object.assign({
      src: thumb(src),
      'data-full': src,
      alt: alt || '',
      loading: 'lazy',
      decoding: 'async',
      onerror: (event) => {
        const img = event.target;
        const full = img.getAttribute('data-full');
        if (full && img.getAttribute('src') !== full) img.setAttribute('src', full);
      },
    }, extra || {}));
  }

  /** A filled star row for ratings — gold, tabular, honest about halves. */
  function starRow(rating) {
    const value = Number(rating) || 0;
    const pct = Math.round(Math.max(0, Math.min(100, (value / 5) * 100)) * 10) / 10;
    return h('span.stars-row', { 'aria-label': `${value} out of 5` }, [
      h('span.stars', [
        h('span.base', '★★★★★'),
        h('span.on', { style: { width: `${pct}%` } }, '★★★★★'),
      ]),
      h('span.val', value ? value.toFixed(1) : 'new'),
    ]);
  }

  window.ProVeri.ui = {
    h, money, moneyBig, timeAgo, dateShort, dateTimeShort, countdown, stars, starRow, icon, thumb, photoImg,
    catIcon, badge, trustBadge,
    toast, sheet, closeSheet, loading, loadingCards, empty, navigate, formValues, withButton,
    copy, share, trustBar, sectionHead,
  };
})();
