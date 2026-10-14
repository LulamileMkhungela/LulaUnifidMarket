/* ==========================================================================
   ProVeri PWA — vertical screens
   vehicles (list + detail + Service Passport) · property waitlist · Web Studio
   ========================================================================== */

window.ProVeri = window.ProVeri || {};
window.ProVeri.screens = window.ProVeri.screens || {};

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const {
    h, money, moneyBig, timeAgo, dateTimeShort, countdown, stars, badge, trustBadge,
    toast, sheet, closeSheet, loading, loadingCards, empty, navigate, formValues, withButton, copy, share,
  } = window.ProVeri.ui;
  const screens = window.ProVeri.screens;

  /* ================= VEHICLES ================= */

  screens['/vehicles'] = async function vehicles() {
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Verified vehicles'));
    root.append(h('p.muted.small', 'The TrustShield engine, rebuilt on the ProVeri trust kernel. A listing earns its badge only when identity, VIN consistency, ownership, stolen status, finance and an independent condition check all pass — and the condition check can come straight from a ProVeri inspection job.'));

    root.append(h('div.scroller-x', [
      h('div.card', { style: { width: '270px' } }, [
        h('div.kicker', '🔀 The merge'),
        h('p.small.muted', { style: { margin: 0 } }, 'Book a pre-purchase inspection as a service job and the report writes itself into the car listing’s trust chain. Service that car later and the job joins its Service Passport. No classifieds site owns both sides of that record.'),
      ]),
      h('div.card', { style: { width: '270px' } }, [
        h('div.kicker.gold', '🚫 Tamper = removed'),
        h('p.small.muted', { style: { margin: 0 } }, 'Change a verified VIN, engine number or registration document after verification and the listing is removed outright. Edit the price mid-negotiation and the edit is blocked without a buyer-approved addendum.'),
      ]),
    ]));

    const list = h('div.list', { style: { marginTop: '14px' } });
    root.append(list);
    list.append(loadingCards(3));
    try {
      const rows = await api.get('/api/vehicles');
      list.innerHTML = '';
      if (!rows.length) { list.append(empty('🚗', 'No listings yet', 'The vehicles vertical is in beta. List your car and it goes through the same verification pipeline as everything else.')); return root; }
      list.append(...rows.map((v) => h('button.tile', { onclick: () => navigate(`/vehicle/${v.listingId}`) }, [
        h('span.lead', '🚗'),
        h('div.grow', [
          h('div.row.wrap', { style: { gap: '6px' } }, [h('div.t', v.title), trustBadge(v.trustBadge, v.trustScore)]),
          h('div.d', `${v.suburb || v.metro || ''} · VIN ${v.vinFingerprint} · ${v.sellerType === 'TRADE_OR_DEALER' ? 'trade' : 'private'}`),
          h('div.row', { style: { gap: '6px', marginTop: '5px', flexWrap: 'wrap' } }, [
            v.hasOutstandingFinance ? badge('finance outstanding', 'warn') : badge('no finance', 'verified'),
            v.inspectionBridged ? badge('inspected on proveri', 'elite') : null,
          ]),
        ]),
        h('div.meta', [h('div.money', money(v.priceCents)), h('div.tiny.muted', v.status.toLowerCase().replace(/_/g, ' '))]),
      ])));
    } catch (error) {
      list.innerHTML = '';
      list.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;
  };

  screens['/vehicle/:listingId'] = async function vehicleDetail({ params }) {
    const root = h('div.fade-in.stack');
    root.append(loading(6));
    try {
      const [listing, answer] = await Promise.all([
        api.get(`/api/vehicles/${params.listingId}`),
        api.get(`/api/vehicles/${params.listingId}/buyer-answer`),
      ]);
      root.innerHTML = '';

      root.append(h('div.hero', [
        h('div.row.between', [h('h1', { style: { fontSize: '22px' } }, listing.title), trustBadge(listing.trustBadge, listing.trustScore)]),
        h('p.sub', `${listing.reference} · ${listing.asset.odometerKm?.toLocaleString('en-ZA')} km · ${listing.location.suburb || listing.location.metro || ''} · ${listing.sellerType === 'TRADE_OR_DEALER' ? 'trade seller' : 'private seller'}`),
        h('div.row.wrap', [
          h('span.money.big', money(listing.priceCents)),
          h('button.btn.on-dark.ghost', { onclick: () => share({ title: listing.title, text: `${listing.title} on ProVeri`, url: location.href }) }, 'Share'),
        ]),
      ]));

      if (listing.status === 'REMOVED') {
        root.append(h('div.banner.danger', [h('span.ico', '🚫'), h('div', [h('strong', 'This listing was removed.'), h('div.small', `${listing.removal?.code}: ${listing.removal?.reason}`)])]));
      }

      root.append(h('div.card', [
        h('div.kicker', '❓ The buyer question, answered'),
        h('p.small', { style: { fontWeight: 700 } }, answer.question),
        h('div.list', { style: { marginTop: '10px' } }, answer.breakdown.map((row) => h('div.card.pad-sm', [
          h('div.row.between', [h('strong.small', row.question), badge(row.status, row.status === 'PASS' ? 'verified' : row.status === 'FAIL' ? 'danger' : row.status === 'WARN' ? 'warn' : 'info')]),
          row.finding ? h('div.tiny.muted', row.finding) : null,
          h('div.tiny.muted', `source: ${row.source}`),
          row.evidenceSeal ? h('div.tiny.mono.muted', `seal ${row.evidenceSeal}`) : null,
        ]))),
        h('div.banner.ok', { style: { marginTop: '10px' } }, [h('span.ico', answer.answer === 'YES' ? '✅' : '⏳'), h('div', h('strong', answer.answer))]),
      ]));

      root.append(h('div.card', [
        h('div.kicker', '🛡️ Protections on this purchase'),
        h('ul.small', Object.entries(answer.protections).map(([key, value]) => h('li', [h('strong', key.replace(/([A-Z])/g, ' $1').toLowerCase() + ': '), value]))),
      ]));

      root.append(h('div.card', [
        h('div.kicker', '🚘 The car'),
        h('p.small', listing.description),
        h('div.kv', [
          h('dt', 'VIN'), h('dd', h('button.mono.tiny', { onclick: () => copy(listing.asset.vin, 'VIN') }, `${listing.asset.vin.slice(0, 6)}•••••• (tap to copy)`)),
          h('dt', 'Engine'), h('dd', listing.asset.engineNumber || '—'),
          h('dt', 'Registration'), h('dd', `${listing.asset.registrationNumber} (${listing.asset.plateFormat || 'unknown format'})`),
          h('dt', 'Colour'), h('dd', listing.asset.colour || '—'),
          h('dt', 'Condition'), h('dd', listing.asset.condition),
          h('dt', 'Known defects'), h('dd', listing.asset.knownDefects?.length ? listing.asset.knownDefects.join('; ') : 'none declared'),
          h('dt', 'Included'), h('dd', listing.asset.includedItems?.join(', ') || '—'),
          h('dt', 'Title holder'), h('dd', listing.asset.titleHolder?.type === 'BANK' ? `${listing.asset.titleHolder.institution} (${money(listing.asset.titleHolder.settlementCents)})` : 'No finance — seller is the owner'),
        ]),
      ]));

      if (listing.passport?.bridgedFromServices?.length) {
        root.append(h('div.card.gold', [
          h('div.kicker.gold', '🔀 Cross-vertical evidence'),
          h('p.small', 'This listing’s condition report was produced by a ProVeri inspection job — escrow-funded, geotagged and hash-sealed. It is not a seller-uploaded PDF.'),
          h('div.list', listing.passport.bridgedFromServices.map((b) => h('div.split-row', [h('span.lbl', b.evidenceType), h('span.mono.tiny', b.bridgeId)]))),
        ]));
      }

      const passport = await api.get(`/api/vehicles/passport/${listing.asset.vin}`).catch(() => null);
      if (passport) {
        root.append(h('details.fold', { open: true }, [
          h('summary', `📘 Service Passport (${passport.entries.length} entries)`),
          h('div.fold-body', [
            h('p.tiny.muted', 'Every entry comes from an escrow-released ProVeri job or a verified sale, so the history cannot be edited or fabricated.'),
            h('div.list', passport.entries.map((e) => h('div.card.pad-sm', [
              h('div.row.between', [h('strong.small', e.kind === 'SALE' ? '🤝 Sale' : `🛠️ ${e.categoryLabel || 'Service'}`), h('span.tiny.muted', dateTimeShort(e.at))]),
              h('div.small', e.summary),
              e.proName ? h('div.tiny.muted', `by ${e.proName}`) : null,
              h('div.tiny.mono.muted', `seal ${String(e.seal).slice(0, 16)}`),
            ]))),
          ]),
        ]));
      }

      root.append(h('details.fold', [
        h('summary', `🧾 Version history (${listing.versions.length}) & audit trail`),
        h('div.fold-body', [
          h('p.tiny.muted', 'Every edit is hashed into an immutable chain. This is what makes tamper-detection possible instead of aspirational.'),
          h('div', listing.versions.slice(-8).reverse().map((v) => h('div.ledger-row', [
            h('span.lv.INFO', `v${v.version}`),
            h('div.grow', [h('div', v.reason), h('div.tiny.muted', dateTimeShort(v.capturedAt))]),
            h('span.seal', v.hash.slice(0, 12)),
          ]))),
        ]),
      ]));

      const session = api.session();
      if (session && listing.status === 'VERIFIED') {
        root.append(h('div.col', { style: { marginTop: '14px' } }, [
          h('button.btn.block', { onclick: () => negotiate(listing) }, '💬 Start negotiating (locks the listing)'),
        ]));
      }
    } catch (error) {
      root.innerHTML = '';
      root.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;

    function negotiate(listing) {
      const session = api.session();
      const close = sheet('Make an offer', h('div.stack', [
        h('p.small', `Asking ${money(listing.priceCents)}. Starting a negotiation locks the description, price, condition, included items, known defects and inspection evidence. Any change after that needs your written approval as an addendum.`),
        h('label.field', [h('span', 'Your offer (rand)'), h('input', { type: 'number', name: 'offer', min: 0, step: 500, value: Math.round(listing.priceCents / 100 * 0.96) })]),
        h('label.field', [h('span', 'Conditions'), h('textarea', { name: 'terms', placeholder: 'e.g. subject to a fresh roadworthy certificate and the same VIN at handover' })]),
      ]), [h('button.btn.block', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const values = formValues(document.getElementById('sheet'));
          await api.post(`/api/vehicles/${listing.listingId}/negotiations`, {
            buyerId: session.userId,
            offerCents: Math.round(values.offer * 100),
            terms: { subjectTo: values.terms ? values.terms.split(';') : [] },
          });
          close(); toast('Negotiation started — the listing is now locked', 'ok');
          navigate(`/vehicle/${listing.listingId}`);
        });
      } }, 'Lock & offer')]);
    }
  };

  /* ================= PROPERTY (coming soon) ================= */

  screens['/property'] = async function property() {
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Property & conveyancing'));
    root.append(h('div.card', [
      h('div.kicker', '🏠 Coming soon'),
      h('p.small', 'Title verification, municipal clearance, PPRA/FFC agent checks and conveyancer trust-account protection for deposits and Offers to Purchase.'),
      h('div.banner.info', [h('span.ico', '🤔'), h('div.small', 'We publish why this is not live yet rather than shipping a teaser. Property deposits already sit in conveyancer trust accounts under the Legal Practice Act, so the marginal consumer benefit is smaller than in services or vehicles — and neither the Deeds Office nor municipal clearance has a stable public API we can verify against today.')]),
    ]));

    const vertical = (api.state.snapshot?.verticals || []).find((v) => v.id === 'property');
    root.append(h('section.section', [
      h('h2', 'What is planned'),
      h('div.list', { style: { marginTop: '10px' } }, [
        feature('Title & ownership match before a listing goes live', 'Deeds Office search wired into the same verification pipeline as vehicles.'),
        feature('Conveyancer trust-account allowlist', 'Bank-detail substitution is the classic property fraud. Trust accounts are whitelisted and any change needs a call-back on independently sourced contacts.'),
        feature('Municipal clearance monitoring', 'Rates, water and electricity status watched until transfer registration.'),
        feature('Offer to Purchase with tracked suspensive conditions', 'Deadlines, bond approval and guarantees on one timeline.'),
        feature('Deeds Office registration milestones', 'Escrow releases on registration, not on a phone call.'),
        feature('Maintenance retainers served by verified ProVeri trades', 'The bridge back into the services vertical.'),
      ]),
    ]));

    const form = h('form.card.stack', { style: { marginTop: '14px' }, onsubmit: join });
    form.append(h('h2', `Join the waitlist${vertical?.waitlistCount ? ` (${vertical.waitlistCount} already)` : ''}`));
    form.append(h('label.field', [h('span', 'Name'), h('input', { type: 'text', name: 'name', required: true })]));
    form.append(h('label.field', [h('span', 'Email'), h('input', { type: 'email', name: 'email', required: true })]));
    form.append(h('label.field', [h('span', 'What would you use it for?'), h('textarea', { name: 'note', placeholder: 'Buying, selling, agent, conveyancer…' })]));
    form.append(h('button.btn.block', { type: 'submit' }, 'Join waitlist'));
    root.append(form);
    return root;

    function feature(title, body) {
      return h('div.card.pad-sm', [h('div.t', { style: { fontWeight: 700 } }, title), h('div.small.muted', body)]);
    }
    async function join(event) {
      event.preventDefault();
      const values = formValues(event.target);
      const button = event.target.querySelector('button[type=submit]');
      await withButton(button, async () => {
        const result = await api.post('/api/verticals/property/waitlist', values);
        toast(`You are number ${result.position} on the property waitlist`, 'ok');
        event.target.reset();
      });
    }
  };

  /* ================= WEB STUDIO ================= */

  /* One studio, one front door. /web-studio was a second marketing page for the
     same product as Business Site Studio — the address now normalises onto it. */
  screens['/web-studio'] = async (ctx) => {
    window.ProVeri.ui.redirectTo('/business-studio');
    return screens['/business-studio'](ctx);
  };
})();
