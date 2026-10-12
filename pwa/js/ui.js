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

  window.ProVeri.ui = {
    h, money, moneyBig, timeAgo, dateShort, dateTimeShort, countdown, stars, badge, trustBadge,
    toast, sheet, closeSheet, loading, loadingCards, empty, navigate, formValues, withButton,
    copy, share, trustBar, sectionHead,
  };
})();
