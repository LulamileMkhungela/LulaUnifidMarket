/* ==========================================================================
   ProVeri PWA — UI toolkit (no framework, no build step)

   Small, boring building blocks so the screens can stay about the person
   using them: hyperscript, formatting, the icon set, avatars, trade glyphs,
   human status language, toasts, sheets and phone-photo compression.
   ========================================================================== */

window.ProVeri = window.ProVeri || {};

(function () {
  'use strict';

  /*
   * Screens compose with `condition ? node : null`. h() skips empty children,
   * but native Element.append() prints the word "null" for them — a bug class
   * that only shows up on a real phone. Make append() skip empties too.
   */
  if (typeof Element !== 'undefined' && Element.prototype && Element.prototype.append && !Element.prototype.append.proveriSafe) {
    const nativeAppend = Element.prototype.append;
    const safeAppend = function append(...nodes) {
      return nativeAppend.apply(this, nodes.filter((n) => n !== null && n !== undefined && n !== false));
    };
    safeAppend.proveriSafe = true;
    Element.prototype.append = safeAppend;
  }

  /**
   * Hyperscript-lite. h('div.card', { onclick }, [child, 'text'])
   * A string `style` is written as an attribute, which is how CSS custom
   * properties (--av-bg …) get through; an object style is assigned.
   */
  function h(tag, props, children) {
    const [name, ...classes] = String(tag).split('.');
    const element = document.createElement(name || 'div');
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

  /* ---------------- money, dates, words ---------------- */

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

  /** Chat-style stamp: 14:05 today, "Mon" this week, "3 Oct" before that. */
  function shortStamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
    const days = (now - d) / 86400000;
    if (days < 6) return d.toLocaleDateString('en-ZA', { weekday: 'short' });
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  }

  /** "Today", "Tomorrow", or "Thu 16 Oct". */
  function relDay(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(Date.now() + 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /** For use mid-sentence: "today", "tomorrow" or "on Thu 16 Oct". */
  function relDayInline(iso) {
    const label = relDay(iso);
    return label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : `on ${label}`;
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

  function plural(count, word, many) {
    return `${count} ${count === 1 ? word : (many || `${word}s`)}`;
  }

  function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  /** "Sipho Dlamini" → "Sipho D." ; business names are left alone. */
  function shortName(name) {
    const clean = String(name || '').trim();
    if (!clean || clean.includes('·')) return clean;
    const parts = clean.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) return clean;
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }

  function initials(name) {
    const parts = String(name || '?').replace(/[·|].*$/, '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function stars(rating) {
    const value = Number(rating) || 0;
    const full = Math.floor(value);
    const half = value - full >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
  }

  /* ---------------- icons ---------------- */

  /** h(icon('home')) — a 24-grid line icon inheriting currentColor. */
  function icon(name, size, opts) {
    const px = size || 22;
    const paths = (window.ProVeri.ICONS || {})[name] || (window.ProVeri.ICONS || {}).sparkle || '';
    const stroke = (opts && opts.stroke) || (px <= 16 ? 2.2 : px <= 20 ? 2 : 1.85);
    const fill = opts && opts.fill ? 'currentColor' : 'none';
    return h('span.icon', {
      style: `width:${px}px;height:${px}px`,
      'aria-hidden': 'true',
      html: `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="${fill}" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`,
    });
  }

  function hasIcon(name) {
    return Boolean((window.ProVeri.ICONS || {})[name]);
  }

  /** The South African flag, drawn — emoji flags render as "ZA" on Windows. */
  function flagZA() {
    return h('span.flag-za', {
      'aria-label': 'South Africa',
      html: '<svg viewBox="0 0 30 20" width="20" height="14" preserveAspectRatio="none"><rect width="30" height="10" fill="#E03C31"/><rect y="10" width="30" height="10" fill="#001489"/><path d="M0 0 12 10 0 20" fill="#fff"/><path d="M0 0l12 10h18" stroke="#fff" stroke-width="6.6" fill="none"/><path d="M0 20l12-10" stroke="#fff" stroke-width="6.6"/><path d="M0 0l12 10h18M0 20l12-10" stroke="#007A4D" stroke-width="4" fill="none"/><path d="M0 3.3 8 10 0 16.7z" fill="#FFB612"/><path d="M0 5.6 5.3 10 0 14.4z" fill="#000"/></svg>',
    });
  }

  /* ---------------- colour families ---------------- */

  const PALETTE = {
    green: ['#ddf2e6', '#0b5d44'], blue: ['#dfe9fb', '#1f4f9f'], amber: ['#fcefcb', '#8a5300'], teal: ['#d5f0f0', '#0f5f63'],
    slate: ['#e3e8ec', '#36474f'], orange: ['#fde5d4', '#9a3e0c'], pink: ['#fbe0ec', '#9d1f5a'], violet: ['#ece3fb', '#5b2bb5'],
    indigo: ['#e2e4fb', '#3730a3'], cyan: ['#d8eef7', '#0b5874'],
  };
  const PALETTE_KEYS = Object.keys(PALETTE);
  const TRADE_FAMILY = {
    plumbing: 'blue', electrical: 'amber', 'gas-installation': 'orange', handyman: 'blue', 'building-construction': 'orange',
    'roofing-gutters': 'slate', 'appliance-repair': 'blue', airconditioning: 'cyan', painting: 'violet', 'solar-inverter': 'amber',
    'cleaning-home': 'teal', 'pest-control': 'green', 'borehole-water': 'cyan', gardening: 'green', 'paving-waterproofing': 'slate',
    'fencing-gates': 'green', 'electric-fence-security': 'slate', 'auto-mechanical': 'slate', 'vehicle-inspection': 'indigo',
    'towing-transport': 'orange', 'moving-removals': 'orange', 'courier-logistics': 'orange', catering: 'pink', 'events-decor': 'pink',
    'beauty-mobile': 'pink', 'care-nursing': 'violet', childcare: 'violet', 'web-digital': 'indigo', 'it-support': 'indigo',
    'accounting-tax': 'teal', 'legal-compliance': 'slate', 'tutoring-education': 'cyan',
  };

  function hashOf(text) {
    let x = 0;
    for (const ch of String(text || '')) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return x;
  }

  /** A person's initials on a calm colour that is always the same for them. */
  function avatar(name, size, opts) {
    const [bg, fg] = PALETTE[PALETTE_KEYS[hashOf(name) % PALETTE_KEYS.length]];
    return h('span.avatar' + (size ? '.' + size : ''), {
      style: `--av-bg:${bg};--av-fg:${fg}`,
      title: (opts && opts.title) || null,
      'aria-hidden': 'true',
    }, initials(name));
  }

  /** The trade glyph on its family colour. */
  function tradeIcon(categoryId, size) {
    const id = typeof categoryId === 'object' && categoryId ? categoryId.id : categoryId;
    const [bg, fg] = PALETTE[TRADE_FAMILY[id] || 'green'];
    const px = size === 'lg' ? 28 : size === 'sm' ? 18 : 22;
    return h('span.trade-ico' + (size ? '.' + size : ''), { style: `--tg-bg:${bg};--tg-fg:${fg}` },
      icon(hasIcon('t-' + id) ? 't-' + id : 'tool', px));
  }

  /* Catalogue labels are written for the regulator ("Solar, inverter & battery
   * installer"); tiles and chips need what a person would say. */
  const TRADE_NAME = {
    plumbing: 'Plumbing', electrical: 'Electrical', painting: 'Painting', handyman: 'Handyman', 'solar-inverter': 'Solar & backup',
    'cleaning-home': 'Cleaning', gardening: 'Garden', 'roofing-gutters': 'Roofing', 'pest-control': 'Pest control',
    'appliance-repair': 'Appliances', airconditioning: 'Aircon', 'gas-installation': 'Gas', 'building-construction': 'Building',
    'paving-waterproofing': 'Paving', 'fencing-gates': 'Fencing & gates', 'electric-fence-security': 'Security',
    'borehole-water': 'Borehole & water', catering: 'Catering', 'events-decor': 'Events', 'beauty-mobile': 'Beauty',
    'web-digital': 'Web & digital', 'it-support': 'IT support', 'auto-mechanical': 'Mechanic', 'vehicle-inspection': 'Car inspection',
    'towing-transport': 'Towing', 'moving-removals': 'Moving', 'courier-logistics': 'Courier', 'accounting-tax': 'Accounting',
    'legal-compliance': 'Legal', 'tutoring-education': 'Tutoring', 'care-nursing': 'Home care', childcare: 'Childcare',
  };

  function tradeName(id, fallback) {
    return TRADE_NAME[id] || fallback || 'Service';
  }

  /** catIcon(category) — legacy callers put this inside a span; now a line glyph. */
  function catIcon(category) {
    const id = typeof category === 'string' ? category : category && category.id;
    return icon(hasIcon('t-' + id) ? 't-' + id : 'tool', 20);
  }

  /* ---------------- trust language ---------------- */

  const BADGE_TEXT = {
    PROVERI_ELITE: ['Elite pro', 'elite', 'crown'],
    PROVERI_VERIFIED: ['Verified pro', 'verified', 'verified'],
    TRADE_VERIFIED: ['Verified & certified', 'verified', 'verified'],
    IDENTITY_VERIFIED: ['ID verified', 'verified', 'id'],
    VEHICLE_VERIFIED: ['Verified vehicle', 'verified', 'verified'],
    VEHICLE_ESCROW_READY: ['Escrow-ready vehicle', 'verified', 'verified'],
    RECHECK_REQUIRED: ['Checks in progress', 'warn', 'hourglass'],
    UNVERIFIED: ['Not verified yet', 'neutral', 'shield-plain'],
    SUSPENDED: ['Suspended', 'danger', 'alert-circle'],
    REMOVED_FOR_RISK: ['Not cleared', 'danger', 'alert-circle'],
  };

  function badgeText(name) {
    return (BADGE_TEXT[name] || [String(name || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())])[0];
  }

  function badge(text, tone, iconName) {
    return h('span.badge.' + (tone || 'neutral'), [iconName ? icon(iconName, 13) : null, String(text).replace(/_/g, ' ')]);
  }

  /** A pro's standing in words, with the score beside it when known. */
  function trustBadge(badgeName, score) {
    const [label, tone, ic] = BADGE_TEXT[badgeName] || [badgeText(badgeName), 'neutral', null];
    return h('span', { class: 'row', style: { gap: '6px' } }, [
      badge(label, tone, ic),
      score != null ? h('span.tiny.muted', `${score}/100`) : null,
    ]);
  }

  /** ★ 4.9 (119) — or "New" for someone with no reviews yet. */
  function rating(value, count) {
    const v = Number(value) || 0;
    return h('span.rating', [
      icon('star', 14, { fill: true }),
      v ? v.toFixed(1) : 'New',
      count ? h('span.n', `(${count})`) : null,
    ]);
  }

  /** A filled star row for ratings — gold, tabular, honest about halves. */
  function starRow(value) {
    const v = Number(value) || 0;
    const pct = Math.round(Math.max(0, Math.min(100, (v / 5) * 100)) * 10) / 10;
    return h('span.stars-row', { 'aria-label': `${v} out of 5` }, [
      h('span.stars', [
        h('span.base', '★★★★★'),
        h('span.on', { style: { width: `${pct}%` } }, '★★★★★'),
      ]),
      h('span.val', v ? v.toFixed(1) : 'new'),
    ]);
  }

  /* Where a job is, said the way a person would say it. One table for the
   * whole app so "Awaiting payment" never reads three different ways. */
  const BOOKING_WORDS = {
    AWARDED: { label: 'Waiting for payment', tone: 'action', step: 1 },
    SCHEDULED: { label: 'Booked', tone: 'good', step: 2 },
    EN_ROUTE: { label: 'Pro on the way', tone: 'wait', step: 2 },
    ON_SITE: { label: 'Pro has arrived', tone: 'wait', step: 3 },
    STARTED: { label: 'Work in progress', tone: 'wait', step: 3 },
    IN_PROGRESS: { label: 'Work in progress', tone: 'wait', step: 3 },
    AWAITING_CONFIRMATION: { label: 'Ready for your approval', tone: 'action', step: 4 },
    COMPLETED: { label: 'Approved & paid', tone: 'good', step: 5 },
    IN_WARRANTY: { label: 'Done · under warranty', tone: 'good', step: 5 },
    CLOSED: { label: 'Completed', tone: 'done', step: 5 },
    DISPUTED: { label: 'Under review', tone: 'bad', step: 4 },
    CANCELLED: { label: 'Cancelled', tone: 'done', step: 0 },
    REFUNDED: { label: 'Refunded', tone: 'done', step: 0 },
  };
  const JOB_WORDS = {
    OPEN: { label: 'Finding pros', tone: 'wait', step: 0 },
    BIDDING: { label: 'Quotes in', tone: 'action', step: 0 },
    AWARDED: { label: 'Pro chosen', tone: 'good', step: 1 },
    BOOKED: { label: 'Booked', tone: 'good', step: 2 },
    COMPLETED: { label: 'Completed', tone: 'done', step: 5 },
    CANCELLED: { label: 'Cancelled', tone: 'done', step: 0 },
    EXPIRED: { label: 'Expired', tone: 'done', step: 0 },
  };
  const TRACK_LABELS = ['Quotes', 'Paid safely', 'Booked', 'Work done', 'Approved'];

  /* The same moment reads differently from the other side of the job. */
  const BOOKING_WORDS_PRO = {
    AWARDED: { label: 'Waiting for payment', tone: 'wait', step: 1 },
    SCHEDULED: { label: 'Booked', tone: 'good', step: 2 },
    EN_ROUTE: { label: 'On your way', tone: 'action', step: 2 },
    ON_SITE: { label: 'On site', tone: 'action', step: 3 },
    AWAITING_CONFIRMATION: { label: 'Waiting for approval', tone: 'wait', step: 4 },
    COMPLETED: { label: 'Paid', tone: 'good', step: 5 },
    IN_WARRANTY: { label: 'Paid · in warranty', tone: 'good', step: 5 },
  };

  function bookingWords(status, role) {
    if (role === 'PRO' && BOOKING_WORDS_PRO[status]) return BOOKING_WORDS_PRO[status];
    return BOOKING_WORDS[status] || { label: String(status || '').replace(/_/g, ' ').toLowerCase(), tone: 'done', step: 0 };
  }

  function jobWords(status, bidCount) {
    if (status === 'BIDDING' || (status === 'OPEN' && bidCount)) return { label: bidCount ? plural(bidCount, 'quote') + ' in' : 'Quotes in', tone: 'action', step: 0 };
    return JOB_WORDS[status] || { label: String(status || '').replace(/_/g, ' ').toLowerCase(), tone: 'done', step: 0 };
  }

  function statusPill(words) {
    return h('span.status.pill.' + words.tone, words.label);
  }

  /**
   * Five dots: Quotes → Paid safely → Booked → Work done → Approved.
   * `reached` is how many are complete (0–5).
   */
  function tracker(reached, labels) {
    const names = labels || TRACK_LABELS;
    return h('div.tracker', { role: 'list', 'aria-label': `Step ${Math.min(reached + 1, names.length)} of ${names.length}` },
      names.map((label, index) => {
        const state = index < reached ? 'done' : index === reached ? 'current' : 'pending';
        return h('div.track-step.' + state, { role: 'listitem' }, [
          h('span.dot', state === 'done' ? icon('check', 14, { stroke: 3 }) : null),
          h('span.lbl', label),
        ]);
      }));
  }

  /** Booking status → how far along the five-dot tracker it is. */
  function bookingReached(status) {
    const map = { AWARDED: 1, SCHEDULED: 2, EN_ROUTE: 2, ON_SITE: 3, STARTED: 3, IN_PROGRESS: 3, AWAITING_CONFIRMATION: 4, DISPUTED: 4, COMPLETED: 5, IN_WARRANTY: 5, CLOSED: 5 };
    return map[status] ?? 0;
  }

  /* ---------------- feedback ---------------- */

  /** toast('Saved', 'ok', { label: 'Undo', onClick }) */
  function toast(message, tone, action) {
    const container = document.getElementById('toasts');
    if (!container) return null;
    const name = tone === 'ok' ? 'check-circle' : tone === 'warn' ? 'alert' : tone === 'danger' ? 'alert-circle' : 'info';
    const node = h('div.toast' + (tone ? '.' + tone : ''), { role: tone === 'danger' ? 'alert' : 'status' }, [
      h('span.t-ico', icon(name, 20)),
      h('span.grow', message),
      action ? h('button.t-action', { type: 'button', onclick: () => { action.onClick(); node.remove(); } }, action.label) : null,
    ]);
    container.append(node);
    setTimeout(() => node.classList.add('leaving'), action ? 6500 : 4200);
    setTimeout(() => node.remove(), action ? 6900 : 4600);
    return node;
  }

  let lastFocus = null;

  /**
   * sheet(title, content, actions, { sub, rowActions })
   * A bottom sheet on phones, a centred dialog on desktop. Escape, the
   * backdrop and the close button all dismiss it, and focus comes back.
   */
  function sheet(title, content, actions, opts) {
    const options = opts || {};
    const backdrop = document.getElementById('sheet-backdrop');
    const sheetEl = document.getElementById('sheet');
    lastFocus = document.activeElement;
    sheetEl.innerHTML = '';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-label', typeof title === 'string' ? title : 'Dialog');
    const list = actions ? (Array.isArray(actions) ? actions : [actions]).filter(Boolean) : [];
    // Native append() prints "null" for a null argument — only pass real nodes.
    const parts = [
      h('div.grab'),
      h('div.sheet-head', [
        h('h3', [title, options.sub ? h('div.sub', options.sub) : null]),
        h('button.sheet-close', { type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('close', 20)),
      ]),
      h('div.sheet-body', content),
    ];
    if (list.length) parts.push(h('div.sheet-foot' + (options.rowActions ? '.row-actions' : ''), list));
    sheetEl.append(...parts);
    backdrop.classList.add('open');
    sheetEl.classList.add('open');
    document.body.classList.add('sheet-open');
    setTimeout(() => {
      const first = sheetEl.querySelector('input:not([type=hidden]),select,textarea');
      if (first && options.autofocus !== false && window.matchMedia && window.matchMedia('(min-width: 640px)').matches) first.focus();
    }, 60);
    return closeSheet;
  }

  function closeSheet() {
    const backdrop = document.getElementById('sheet-backdrop');
    const sheetEl = document.getElementById('sheet');
    if (backdrop) backdrop.classList.remove('open');
    if (sheetEl) sheetEl.classList.remove('open');
    if (document.body) document.body.classList.remove('sheet-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch { /* element gone */ }
    }
    lastFocus = null;
  }

  document.addEventListener('click', (event) => {
    if (event.target && event.target.id === 'sheet-backdrop') closeSheet();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById('sheet')?.classList.contains('open')) closeSheet();
  });

  function loading(lines) {
    return h('div.loading-page.fade-in', [
      h('div.skeleton.title'),
      ...Array.from({ length: lines || 3 }).map((_, i) => h('div.skeleton.line', { style: { width: `${92 - i * 14}%` } })),
    ]);
  }

  function loadingCards(count) {
    return h('div.list', Array.from({ length: count || 3 }).map(() => h('div.skeleton.card')));
  }

  /** Skeleton placeholders as a plain array (safe to spread into h()). */
  function skeletonItems(count, kind) {
    return Array.from({ length: count || 3 }).map(() => (kind === 'grid'
      ? h('div', [h('div.skeleton.media'), h('div.skeleton.line', { style: { width: '80%' } }), h('div.skeleton.line', { style: { width: '50%' } })])
      : h('div.skeleton.card')));
  }

  function loadingGrid(count) {
    return h('div.work-grid', Array.from({ length: count || 4 }).map(() => h('div', [h('div.skeleton.media'), h('div.skeleton.line', { style: { width: '80%' } }), h('div.skeleton.line', { style: { width: '50%' } })])));
  }

  /** empty('inbox', 'No messages yet', 'Body…', action) — icon name or a legacy emoji. */
  function empty(iconName, title, body, action) {
    return h('div.empty.card', [
      h('div.ico', hasIcon(iconName) ? icon(iconName, 28) : iconName),
      h('h3', title),
      body ? h('p', body) : null,
      action || null,
    ]);
  }

  /* ---------------- navigation ---------------- */

  function navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, '', path);
    else history.pushState({ app: true }, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  /** Normalise a legacy address onto its canonical URL — no re-render, no history entry. */
  function redirectTo(path) {
    try { history.replaceState(history.state || {}, '', path); } catch { /* older browsers */ }
  }

  /** Explore is one destination with two modes: the work, and the pros who do it. */
  function exploreSeg(active) {
    const tab = (id, to, label) => h('button' + (active === id ? '.active' : ''), {
      type: 'button',
      ...(active === id ? { 'aria-current': 'page' } : {}),
      onclick: () => { if (active !== id) navigate(to); },
    }, label);
    return h('div.seg', { style: { margin: '2px 0 4px' } }, [tab('work', '/browse', 'Work near you'), tab('pros', '/find-a-pro', 'Verified pros')]);
  }

  /** ← Back: to where you came from inside the app, else to a sensible parent. */
  function backButton(fallback, label) {
    return h('button.back-btn', {
      type: 'button',
      onclick: () => {
        if (history.state && history.state.app && history.length > 1) history.back();
        else navigate(fallback || '/');
      },
    }, [icon('chevron-left', 22), label || 'Back']);
  }

  /** Intercept plain in-app links. */
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest && event.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.includes('wa.me')) return;
    if (anchor.hasAttribute('target') || anchor.hasAttribute('download')) return;
    if (/^\/(api|docs|openapi|p\/|s\/|admin-assets)/.test(href)) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  });

  /* ---------------- small helpers ---------------- */

  function formValues(form) {
    const data = {};
    for (const element of Array.from(form.querySelectorAll('input,select,textarea'))) {
      if (!element.name) continue;
      if (element.type === 'checkbox') data[element.name] = element.checked;
      else if (element.type === 'radio') { if (element.checked) data[element.name] = element.value; else if (!(element.name in data)) data[element.name] = data[element.name] ?? null; }
      else if (element.type === 'number') data[element.name] = element.value === '' ? null : Number(element.value);
      else if (element.type === 'file') continue;
      else data[element.name] = element.value;
    }
    return data;
  }

  /** Spinner on the button while `fn` runs; a failure becomes a toast. */
  async function withButton(button, fn) {
    button.classList.add('loading');
    button.disabled = true;
    try {
      return await fn();
    } catch (error) {
      toast(friendlyError(error), error && error.queued ? 'warn' : 'danger');
      throw error;
    } finally {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  /** Server messages are written for developers; soften the common ones. */
  function friendlyError(error) {
    const message = String((error && error.message) || 'Something went wrong');
    if (error && error.status === 0) return message;
    if (/KYC-001|verified identity|bank verification must all pass/i.test(message)) return 'Finish your verification (ID, phone and bank) before sending quotes.';
    if (/TRD-001|certificate/i.test(message) && /trade|statutory|register/i.test(message)) return 'This trade needs your registration certificate on file before you can quote.';
    if (/already bid/i.test(message)) return 'You have already sent a quote for this job.';
    if (/PRT-002/i.test(message)) return 'That photo is already published by another pro, so it cannot be used.';
    return message.charAt(0).toUpperCase() + message.slice(1);
  }

  function copy(text, label) {
    if (!navigator.clipboard) { toast('Copying is not available on this device', 'warn'); return; }
    navigator.clipboard.writeText(text).then(
      () => toast(`${label || 'Copied'}`, 'ok'),
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

  function sectionHead(title, link, href, sub) {
    return h('div.section-head', [
      h('div', [h('h2', title), sub ? h('div.sub', sub) : null]),
      link ? h('a', { href }, [link, icon('chevron', 16)]) : null,
    ]);
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

  /**
   * Phone cameras produce 3–8 MB photos; the API accepts ~900 KB per photo.
   * Shrink to a 1600px long edge and re-encode as JPEG, stepping the quality
   * down until it fits. EXIF (including GPS) is dropped by the re-encode,
   * which is what we want for privacy.
   */
  async function compressImage(file, { maxEdge = 1600, maxBytes = 600 * 1024 } = {}) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('That file is not a photo');
    let source;
    if (typeof createImageBitmap === 'function') {
      try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { source = null; }
    }
    if (!source) {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not read that photo'));
        img.src = URL.createObjectURL(file);
      });
    }
    const w = source.width || source.naturalWidth;
    const hgt = source.height || source.naturalHeight;
    const scale = Math.min(1, maxEdge / Math.max(w, hgt));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(hgt * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length * 0.75 > maxBytes && quality > 0.45) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    if (source.close) source.close();
    return dataUrl;
  }

  window.ProVeri.ui = {
    h, money, moneyBig, timeAgo, shortStamp, relDay, relDayInline, dateShort, dateTimeShort, countdown, plural, firstName, shortName, initials,
    stars, starRow, rating, icon, hasIcon, flagZA, thumb, photoImg, avatar, tradeIcon, tradeName,
    catIcon, badge, badgeText, trustBadge, bookingWords, jobWords, statusPill, tracker, bookingReached, TRACK_LABELS,
    toast, sheet, closeSheet, loading, loadingCards, loadingGrid, skeletonItems, empty, navigate, redirectTo, exploreSeg, backButton, formValues, withButton, friendlyError,
    copy, share, trustBar, sectionHead, compressImage,
  };
})();
