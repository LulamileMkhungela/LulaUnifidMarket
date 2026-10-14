/* ==========================================================================
   ProVeri PWA — Business Site Studio + sales desk
   /business-studio   template gallery, plans, live sites, scaffold wizard
   /site/:siteId      editor: content, theme, assets, permissions, bookings,
                      subscription, update credits, publish gate, export
   /sites             gallery of published sites (opens the real HTML pages)
   /sales-desk        lead pipeline, next best actions, pitch kit
   ========================================================================== */

window.ProVeri = window.ProVeri || {};
window.ProVeri.screens = window.ProVeri.screens || {};

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const {
    h, money, timeAgo, badge, toast, sheet, loading, loadingCards, empty,
    navigate, formValues, withButton, copy, share,
  } = window.ProVeri.ui;
  const screens = window.ProVeri.screens;

  /* ================= STUDIO HOME ================= */

  screens['/business-studio'] = async function businessStudio() {
    const root = h('div.fade-in.stack');
    const [catalogue, plans, sites, stats] = await Promise.all([
      api.get('/api/sites/templates'),
      api.get('/api/sites/plans'),
      api.get('/api/sites').catch(() => []),
      api.get('/api/sites/stats').catch(() => null),
    ]);

    root.append(h('h1', 'Business Site Studio'));
    root.append(h('p.muted.small', plans.promise));

    root.append(h('div.card.gold', [
      h('div.kicker.gold', '⚡ The difference'),
      h('p.small', { style: { margin: 0 } }, 'A website demo with dead buttons is a brochure. Every booking form on a ProVeri site is live: it creates a reservation with a reference number, or — when the business is a verified pro — posts a real job so the customer can pay into escrow and the pro is paid on proof of work.'),
      stats ? h('div.row.wrap', { style: { gap: '6px', marginTop: '10px' } }, [
        badge(`${stats.live} live sites`, 'verified'),
        badge(`${stats.bookings} bookings taken`, 'info'),
        badge(`${stats.bookingsConvertedToJobs} became escrow jobs`, 'elite'),
        badge(`${money(stats.monthlyRecurringCents)}/mo recurring`, 'gold'),
      ]) : null,
    ]));

    /* -------- templates -------- */
    root.append(h('section.section', [
      h('div.section-head', [h('h2', 'Pick an industry'), h('a', { href: '/sites' }, 'See live sites →')]),
      h('p.small.muted', 'Ten templates built from real South African businesses: sections, booking fields, theme palettes and sample content are all pre-wired, so a preview exists before the first conversation.'),
      h('div.cat-grid', { style: { marginTop: '12px' } }, catalogue.templates.map((t) => h('button.card.pad-sm', { style: { textAlign: 'left', cursor: 'pointer' }, onclick: () => scaffoldSheet(t) }, [
        h('div.row', { style: { gap: '8px' } }, [h('span', { style: { fontSize: '22px' } }, t.icon), h('div.grow', [h('div.t', { style: { fontWeight: 700 } }, t.label)])]),
        h('div.small.muted', { style: { marginTop: '6px' } }, t.blurb),
        h('div.row.wrap', { style: { gap: '5px', marginTop: '8px' } }, [
          badge(`${t.sections.length} sections`, 'neutral'),
          badge(t.bookingIntake === 'JOB' ? 'booking → escrow job' : t.bookingIntake.toLowerCase(), t.bookingIntake === 'JOB' ? 'elite' : 'info'),
          t.proNative ? badge('pro native', 'verified') : null,
          t.vehicleBridge ? badge('fleet bridge', 'gold') : null,
        ]),
      ]))),
    ]));

    /* -------- plans -------- */
    root.append(h('section.section', [
      h('h2', 'Monthly plans — R0 to build'),
      h('p.small.muted', plans.positioning.strategy),
      h('div.list', { style: { marginTop: '12px' } }, plans.plans.map((plan) => h('div.card', [
        h('div.row.between', [
          h('div', [h('h3', plan.name), h('div.tiny.muted', plan.audience)]),
          h('div', { style: { textAlign: 'right' } }, [h('div.money.big', money(plan.priceCents)), h('div.tiny.muted', `${plan.setupDisplay} · ${plan.updatesDisplay}`)]),
        ]),
        h('p.small.muted', plan.blurb),
        h('ul.small', plan.features.map((f) => h('li', f))),
        h('div.banner.warn', { style: { marginTop: '8px' } }, [h('span.ico', '🤝'), h('div.tiny', `Honest boundary: ${plan.honestBoundary}`)]),
        h('div.banner.ok', [h('span.ico', '🔀'), h('div.tiny', plan.proveriUpgrade)]),
        plan.popular ? h('div.row', { style: { marginTop: '8px' } }, badge('recommended', 'elite')) : null,
      ]))),
      h('details.fold', { style: { marginTop: '10px' } }, [
        h('summary', 'Compare plans feature by feature'),
        h('div.fold-body', h('div.list', plans.comparison.map((row) => h('div.split-row', [
          h('span.lbl.small', row.feature),
          h('span.tiny', [renderCell(row.essential), ' · ', renderCell(row['business-growth']), ' · ', renderCell(row.enterprise)].reduce((acc, node) => acc.concat(node), [])),
        ])))),
      ]),
    ]));

    /* -------- sites -------- */
    root.append(h('section.section', [
      h('div.section-head', [h('h2', 'Sites in the studio'), h('button.btn.sm.ghost', { onclick: () => navigate('/sales-desk') }, 'Sales desk')]),
      sites.length ? h('div.list', { style: { marginTop: '10px' } }, sites.map((s) => h('button.tile', { onclick: () => navigate(`/site/${s.siteId}`) }, [
        h('span.lead', statusIcon(s.status)),
        h('div.grow', [
          h('div.t', s.name),
          h('div.d', `${s.industry} · ${s.suburb || s.metro || 'South Africa'} · ${s.catalogueItems} items · ${s.bookings} booking(s)`),
          h('div.row', { style: { gap: '5px', marginTop: '5px', flexWrap: 'wrap' } }, [
            badge(s.status.toLowerCase(), s.status === 'LIVE' ? 'verified' : s.status === 'BLOCKED' ? 'danger' : 'warn'),
            s.permissionGate === 'blocked' ? badge('permission gate closed', 'danger') : null,
            s.proName ? badge(`pro: ${s.proName}`, 'elite') : null,
          ]),
        ]),
        h('div.meta', [h('div.money', money(s.monthlyCents)), h('div.tiny.muted', `${s.updateCredits} updates`)]),
      ]))) : empty('🖥️', 'No sites yet', 'Pick an industry above and a full preview exists in one tap.'),
    ]));

    /* -------- compliance -------- */
    root.append(h('section.section', [
      h('h2', 'Publishing is gated, not trusted'),
      h('div.list', [
        h('div.card.pad-sm', [h('div.t', 'WEB-002 · permission before publish'), h('div.small.muted', 'A site cannot go public while any asset lacks a permission record from the rights holder. Where a face is identifiable, POPIA consent is required on top of copyright clearance. Credit is not permission.')]),
        h('div.card.pad-sm', [h('div.t', 'WEB-001 · update allowance is metered'), h('div.small.muted', 'Two or five minor updates a month are included. Beyond that the studio refuses the edit and offers a renewal, an upgrade, or a paid extra update at the published rate — never a silent invoice.')]),
        h('div.card.pad-sm', [h('div.t', 'WEB-003 · AI images are labelled'), h('div.small.muted', 'A generated image renders an "illustrative" note wherever it appears, and an AI asset used as a full-bleed hero with nowhere to put the note is flagged before publish.')]),
      ]),
    ]));

    return root;

    function renderCell(value) {
      if (value === true) return '✅';
      if (value === false) return '—';
      return String(value);
    }

    function scaffoldSheet(template) {
      const close = sheet(`${template.icon} ${template.label}`, h('form.stack', { name: 'scaffold' }, [
        h('p.small.muted', template.blurb),
        h('label.field', [h('span', 'Business name'), h('input', { type: 'text', name: 'businessName', required: true, placeholder: 'e.g. Harbour Light Seafood' })]),
        h('div.form-grid', [
          h('label.field', [h('span', 'Suburb'), h('input', { type: 'text', name: 'suburb', placeholder: 'e.g. Sea Point' })]),
          h('label.field', [h('span', 'Phone'), h('input', { type: 'tel', name: 'phone', placeholder: '021 434 0000' })]),
        ]),
        h('div.form-grid', [
          h('label.field', [h('span', 'Email'), h('input', { type: 'email', name: 'email' })]),
          h('label.field', [h('span', 'Theme'), h('select', { name: 'themeId' }, template.themePresets.map((t) => h('option', { value: t.id }, t.name)))]),
        ]),
        h('label.field', [h('span', 'Plan'), h('select', { name: 'planId' }, plans.plans.map((p) => h('option', { value: p.id, selected: p.id === 'business-growth' }, `${p.name} — ${money(p.priceCents)}/mo`)))]),
        h('label.field', [h('span', 'Start from sample content?'), h('select', { name: 'useSampleContent' }, [h('option', { value: 'yes' }, 'Yes — fill it so the preview is worth showing'), h('option', { value: 'no' }, 'No — empty catalogue')])]),
        h('p.tiny.muted', 'R0 is taken. The site is created as a draft with an unlisted preview URL.'),
      ]), [h('button.btn.block', { onclick: async (event) => {
        await withButton(event.target, async () => {
          const values = formValues(document.getElementById('sheet').querySelector('form'));
          const site = await api.post('/api/sites', {
            templateId: template.id,
            businessName: values.businessName,
            suburb: values.suburb || null,
            themeId: values.themeId,
            planId: values.planId,
            useSampleContent: values.useSampleContent === 'yes',
            contact: { phone: values.phone || null, email: values.email || null, suburb: values.suburb || null },
          });
          close();
          toast(`${site.name} created — R0 taken`, 'ok');
          navigate(`/site/${site.siteId}`);
        });
      } }, 'Create the site')]);
    }
  };

  function statusIcon(status) {
    return { LIVE: '🟢', PREVIEW: '👁️', BLOCKED: '⛔', DRAFT: '📝', PAUSED: '⏸️', ARCHIVED: '🗄️' }[status] || '🖥️';
  }

  /* ================= SITE EDITOR ================= */

  screens['/site/:siteId'] = async function siteEditor({ params }) {
    const root = h('div.fade-in.stack');
    const data = await api.get(`/api/sites/${params.siteId}`);
    const site = data;
    root.append(h('div.row.between', [
      h('div', [h('h1', site.name), h('div.small.muted', `${site.industry} · ${site.reference}`)]),
      h('div', [badge(site.status.toLowerCase(), site.status === 'LIVE' ? 'verified' : site.status === 'BLOCKED' ? 'danger' : 'warn')]),
    ]));

    root.append(h('div.row.wrap', { style: { gap: '8px' } }, [
      h('a.btn.sm', { href: site.status === 'LIVE' ? site.urls.live : site.urls.preview, target: '_blank', rel: 'noopener' }, site.status === 'LIVE' ? '🌐 Open live site' : '👁️ Open preview'),
      h('button.btn.sm.ghost', { onclick: () => exportSheet(site) }, '⬇️ Export single file'),
      h('button.btn.sm.ghost', { onclick: () => shareSite(site) }, '📤 Share'),
    ]));

    if (!data.permissionState.gateOpen) {
      root.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', [
        h('strong', 'Publishing is blocked — policy WEB-002'),
        h('div.small', `${data.permissionState.assetsUncleared} asset(s) have no permission record: ${data.permissionState.unclearedFiles.slice(0, 3).join(', ')}`),
        data.permissionState.popiaOutstanding ? h('div.small', `${data.permissionState.popiaOutstanding} asset(s) show identifiable people without POPIA consent.`) : null,
      ])]));
    }

    /* -------- subscription & update credits -------- */
    root.append(h('section.section', [
      h('h2', 'Plan & update credits'),
      h('div.card', [
        h('div.split-row', [h('span.lbl', 'Plan'), h('span', `${site.plan.planName} — ${money(site.plan.monthlyCents)}/month`)]),
        h('div.split-row', [h('span.lbl', 'Status'), h('span', site.plan.status.toLowerCase().replace('_', ' '))]),
        h('div.split-row', [h('span.lbl', 'Updates used'), h('span', site.plan.updateCreditsTotal === -1 ? 'unlimited' : `${site.plan.updateCreditsUsed}/${site.plan.updateCreditsTotal} this period`)]),
        h('div.split-row', [h('span.lbl', 'Renews'), h('span', site.plan.renewsAt ? site.plan.renewsAt.slice(0, 10) : '—')]),
        h('div.split-row', [h('span.lbl', 'Extra update'), h('span', money(site.plan.extraUpdateCents))]),
        h('div.row.wrap', { style: { gap: '8px', marginTop: '10px' } }, [
          site.plan.status === 'ACTIVE'
            ? h('button.btn.sm', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/sites/${site.siteId}/renew`, {}); toast('Next month billed, allowance reset', 'ok'); navigate(`/site/${site.siteId}`); }) }, 'Renew month')
            : h('button.btn.sm', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/sites/${site.siteId}/subscribe`, { planId: site.plan.planId }); toast('Subscription started — month one is held in escrow until the site is live', 'ok'); navigate(`/site/${site.siteId}`); }) }, 'Start subscription'),
          h('button.btn.sm.ghost', { onclick: () => updateSheet(site) }, 'Log an update'),
          site.plan.status === 'ACTIVE' ? h('button.btn.sm.ghost', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/sites/${site.siteId}/cancel-subscription`, { reason: 'Cancelled in the demo' }); toast('Cancelled — the export is still yours', 'warn'); navigate(`/site/${site.siteId}`); }) }, 'Cancel') : null,
        ]),
        h('p.tiny.muted', { style: { marginTop: '8px' } }, 'Month one goes into escrow and is released when the site is live. That is how "we host and maintain it" stops being a verbal promise.'),
      ]),
      data.updates.length ? h('details.fold', [
        h('summary', `${data.updates.length} logged update(s)`),
        h('div.fold-body', h('div.list', data.updates.map((u) => h('div.split-row', [
          h('span.lbl.small', u.summary),
          h('span.tiny', `${u.chargedCents ? `billed ${money(u.chargedCents)}` : 'credit'} · ${u.at.slice(0, 10)}`),
        ])))),
      ]) : null,
    ]));

    /* -------- theme -------- */
    root.append(h('section.section', [
      h('h2', 'Theme'),
      h('div.row.wrap', { style: { gap: '8px' } }, [
        h('div.card.pad-sm', { style: { minWidth: '120px' } }, [
          h('div.tiny.muted', 'Current'),
          h('div.row', { style: { gap: '4px', marginTop: '6px' } }, ['primary', 'accent', 'dark', 'light'].map((k) => h('span', { style: { width: '20px', height: '20px', borderRadius: '4px', background: site.theme[k], display: 'inline-block', border: '1px solid rgba(0,0,0,.2)' } }))),
          h('div.tiny', { style: { marginTop: '6px' } }, `contrast ${site.theme.contrastRatio || '—'}:1`),
        ]),
        h('button.btn.sm.ghost', { onclick: () => themeSheet(site) }, 'Change theme'),
      ]),
    ]));

    /* -------- content -------- */
    root.append(h('section.section', [
      h('h2', site.catalogueLabel || (site.catalogue[0] && site.catalogue[0].name) || 'Catalogue'),
      h('div.list', site.catalogue.map((category) => h('div.card.pad-sm', [
        h('div.t', category.name),
        h('div.list', { style: { marginTop: '6px' } }, category.items.map((item) => h('div.split-row', [
          h('span.lbl.small', [item.name, item.image ? ' 🖼️' : ' ', item.aiGenerated ? ' 🤖' : '']),
          h('span.money.small', item.price),
        ]))),
      ]))),
      h('div.row.wrap', { style: { gap: '8px', marginTop: '10px' } }, [
        h('button.btn.sm', { onclick: () => contentSheet(site) }, 'Edit content'),
        h('button.btn.sm.ghost', { onclick: () => aiPromptSheet(site) }, '🤖 AI image prompt'),
      ]),
    ]));

    /* -------- assets & permissions -------- */
    root.append(h('section.section', [
      h('div.section-head', [h('h2', 'Assets & permissions'), h('span.tiny.muted', `${data.permissionState.assetsCleared}/${data.permissionState.totalAssets} cleared`)]),
      data.assets.length ? h('div.list', data.assets.map((a) => h('div.card.pad-sm', [
        h('div.row.between', [
          h('div.grow', [h('div.t.small', a.filename), h('div.tiny.muted', a.caption)]),
          a.permission ? badge('permission ✓', 'verified') : badge('needs permission', 'danger'),
        ]),
        h('div.row.wrap', { style: { gap: '5px', marginTop: '6px' } }, [
          badge(a.classification.category, 'neutral'),
          badge(`${a.classification.confidence}% confidence`, a.classification.confidence > 60 ? 'info' : 'warn'),
          badge(a.classification.placement.toLowerCase(), 'neutral'),
          a.attachedTo ? badge(`→ ${a.attachedTo.item}`, 'elite') : null,
          a.aiGenerated ? badge('AI — labelled illustrative', 'gold') : null,
          a.classification.needsReview ? badge('check by hand', 'warn') : null,
        ]),
        a.permission ? h('div.tiny.muted', { style: { marginTop: '6px' } }, `Cleared by ${a.permission.grantedBy} via ${a.permission.method} · seal ${a.permission.seal}`) : null,
      ]))) : h('p.small.muted', 'No assets yet. Add one and the studio classifies it against this industry’s vocabulary and files it onto the matching catalogue item.'),
      h('div.row.wrap', { style: { gap: '8px', marginTop: '10px' } }, [
        h('button.btn.sm', { onclick: () => assetSheet(site) }, 'Add asset'),
        data.permissionState.assetsUncleared ? h('button.btn.sm.gold', { onclick: () => permissionSheet(site, data.permissionState) }, 'Record permission') : null,
        h('button.btn.sm.ghost', { onclick: () => navigate('/trust') }, 'Why this is enforced'),
      ]),
    ]));

    /* -------- bookings -------- */
    root.append(h('section.section', [
      h('h2', `Bookings (${data.bookings.length})`),
      data.bookings.length ? h('div.list', data.bookings.map((b) => h('div.card.pad-sm', [
        h('div.row.between', [
          h('div.grow', [h('div.t.small', b.summary), h('div.tiny.muted', `${b.contact.name || 'visitor'} · ${b.reference} · ${timeAgo(b.createdAt)}`)]),
          badge(b.status.toLowerCase().replace(/_/g, ' '), b.status === 'CONVERTED_TO_JOB' ? 'elite' : b.status === 'NEW' ? 'warn' : 'verified'),
        ]),
        h('div.row.wrap', { style: { gap: '5px', marginTop: '6px' } }, [
          b.amountQuotedCents ? badge(`quoted ${money(b.amountQuotedCents)}`, 'gold') : null,
          b.contact.whatsappLink ? h('a.btn.sm.ghost', { href: b.contact.whatsappLink, target: '_blank', rel: 'noopener' }, '💬 Reply') : null,
          b.jobId ? h('a.btn.sm', { href: `/job/${b.jobId}`, 'data-link': true, onclick: (e) => { e.preventDefault(); navigate(`/job/${b.jobId}`); } }, 'Open escrow job') : null,
          b.status === 'NEW' ? h('button.btn.sm', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/site-bookings/${b.bookingId}/decision`, { decision: 'CONFIRMED', note: 'Confirmed from the studio' }); toast('Booking confirmed', 'ok'); navigate(`/site/${site.siteId}`); }) }, 'Confirm') : null,
        ]),
        b.leadId ? h('div.tiny.muted', { style: { marginTop: '6px' } }, 'Site is not published yet — captured as a warm sales lead instead.') : null,
      ]))) : h('p.small.muted', 'No bookings yet. Publish the site and the form starts working immediately.'),
    ]));

    /* -------- publish -------- */
    root.append(h('section.section', [
      h('h2', 'Publish'),
      h('div.card', [
        h('div.split-row', [h('span.lbl', 'Status'), h('span', site.status)]),
        h('div.split-row', [h('span.lbl', 'Permission gate'), h('span', data.permissionState.gateOpen ? 'open ✓' : 'closed ⛔')]),
        h('div.split-row', [h('span.lbl', 'Live URL'), h('span.tiny.mono', site.urls.live)]),
        h('div.row.wrap', { style: { gap: '8px', marginTop: '10px' } }, [
          site.status !== 'PREVIEW' && site.status !== 'LIVE' ? h('button.btn.sm.ghost', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/sites/${site.siteId}/preview`, {}); toast('Unlisted preview ready', 'ok'); navigate(`/site/${site.siteId}`); }) }, 'Build preview') : null,
          site.status !== 'LIVE' ? h('button.btn.sm', { onclick: (e) => withButton(e.target, async () => {
            const result = await api.post(`/api/sites/${site.siteId}/publish`, {});
            toast(result.warnings.length ? `Published with ${result.warnings.length} warning(s)` : `Live at ${result.url}`, 'ok');
            navigate(`/site/${site.siteId}`);
          }) }, '🚀 Publish') : h('button.btn.sm.ghost', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/sites/${site.siteId}/pause`, { reason: 'Paused from the studio' }); toast('Paused', 'warn'); navigate(`/site/${site.siteId}`); }) }, 'Pause'),
        ]),
      ]),
      h('details.fold', { style: { marginTop: '10px' } }, [
        h('summary', 'Timeline'),
        h('div.fold-body', h('div.list', site.timeline.slice().reverse().map((t) => h('div.split-row', [
          h('span.lbl.small', t.event.replace(/_/g, ' ').toLowerCase()),
          h('span.tiny', `${t.note} · ${t.at.slice(0, 16).replace('T', ' ')}`),
        ])))),
      ]),
    ]));

    return root;
  };

  /* -------- editor sheets -------- */

  function themeSheet(site) {
    api.get('/api/sites/templates').then((catalogue) => {
      const template = catalogue.templates.find((t) => t.id === site.templateId);
      const close = sheet('Theme', h('div.stack', [
        h('p.small.muted', 'Presets are paired for contrast. A custom palette is checked against WCAG AA before it is accepted.'),
        h('div.list', template.themePresets.map((preset) => h('button.tile', { onclick: async (e) => {
          await withButton(e.target, async () => {
            await api.patch(`/api/sites/${site.siteId}/theme`, { presetId: preset.id });
            close(); toast(`${preset.name} applied`, 'ok'); navigate(`/site/${site.siteId}`);
          });
        } }, [
          h('div.row', { style: { gap: '4px' } }, ['primary', 'accent', 'dark', 'light'].map((k) => h('span', { style: { width: '18px', height: '18px', borderRadius: '4px', background: preset[k], display: 'inline-block', border: '1px solid rgba(0,0,0,.2)' } }))),
          h('div.grow', [h('div.t', preset.name), h('div.d', preset.fontDisplay)]),
        ]))),
        h('form.stack', { style: { marginTop: '10px' } }, [
          h('div.form-grid', [
            h('label.field', [h('span', 'Primary'), h('input', { type: 'text', name: 'primary', placeholder: '#0E7C5A' })]),
            h('label.field', [h('span', 'Accent'), h('input', { type: 'text', name: 'accent', placeholder: '#F2A65A' })]),
          ]),
          h('button.btn.sm.block', { type: 'button', onclick: async (e) => {
            await withButton(e.target, async () => {
              const values = formValues(e.target.closest('form'));
              const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v));
              const updated = await api.patch(`/api/sites/${site.siteId}/theme`, patch);
              close();
              toast(updated.theme.contrastOk ? 'Custom theme applied' : `Applied, but contrast is ${updated.theme.contrastRatio}:1 — below WCAG AA`, updated.theme.contrastOk ? 'ok' : 'warn');
              navigate(`/site/${site.siteId}`);
            });
          } }, 'Apply custom colours'),
        ]),
      ]), [h('button.btn.block.ghost', { onclick: () => close() }, 'Close')]);
    });
  }

  function contentSheet(site) {
    const close = sheet('Edit content', h('form.stack', { name: 'content' }, [
      h('label.field', [h('span', 'Tagline'), h('input', { type: 'text', name: 'tagline', value: site.tagline })]),
      h('label.field', [h('span', 'Description / story'), h('textarea', { name: 'description', rows: 3 }, site.description)]),
      h('label.field', [h('span', 'Hours (one per line: Day | Time)'), h('textarea', { name: 'hours', rows: 3 }, site.hours.map((x) => `${x.day} | ${x.time}`).join('\n'))]),
      h('label.field', [h('span', 'Catalogue (JSON)'), h('textarea', { name: 'catalogue', rows: 6 }, JSON.stringify(site.catalogue, null, 1))]),
      h('p.tiny.muted', site.status === 'LIVE' ? 'This site is live, so the edit consumes one update credit. Beyond the allowance the studio offers a renewal, an upgrade, or a paid extra update.' : 'This site is not live yet, so edits are free.'),
    ]), [h('button.btn.block', { onclick: async (e) => {
      await withButton(e.target, async () => {
        const values = formValues(document.getElementById('sheet').querySelector('form'));
        const patch = { tagline: values.tagline, description: values.description };
        if (values.hours) patch.hours = values.hours.split('\n').filter(Boolean).map((line) => { const [day, time] = line.split('|'); return { day: day.trim(), time: (time || '').trim() }; });
        if (values.catalogue) patch.catalogue = JSON.parse(values.catalogue);
        await api.patch(`/api/sites/${site.siteId}/content`, patch);
        close(); toast('Content updated', 'ok'); navigate(`/site/${site.siteId}`);
      });
    } }, 'Save changes')]);
  }

  function assetSheet(site) {
    const close = sheet('Add an asset', h('form.stack', { name: 'asset' }, [
      h('p.small.muted', 'Point this at a file the business sent. The studio classifies it against the industry vocabulary, files it onto the matching catalogue item, and marks it as needing permission before publish.'),
      h('label.field', [h('span', 'Filename'), h('input', { type: 'text', name: 'filename', required: true, placeholder: 'grilled-linefish-mains.jpg' })]),
      h('label.field', [h('span', 'Caption (drives classification)'), h('input', { type: 'text', name: 'caption', placeholder: 'Whole grilled linefish with salsa verde' })]),
      h('div.form-grid', [
        h('label.field', [h('span', 'Source'), h('select', { name: 'source' }, ['owner-supplied', 'social-import', 'photographer', 'licensed-stock', 'ai-generated', 'proveri-generated'].map((s) => h('option', { value: s }, s)))]),
        h('label.field', [h('span', 'Size (KB)'), h('input', { type: 'number', name: 'kb', placeholder: '800' })]),
      ]),
      h('label.field', [h('span', 'AI-generated?'), h('select', { name: 'aiGenerated' }, [h('option', { value: 'no' }, 'No — a real photo'), h('option', { value: 'yes' }, 'Yes — label it as illustrative')])]),
    ]), [h('button.btn.block', { onclick: async (e) => {
      await withButton(e.target, async () => {
        const values = formValues(document.getElementById('sheet').querySelector('form'));
        const asset = await api.post(`/api/sites/${site.siteId}/assets`, {
          filename: values.filename,
          caption: values.caption,
          source: values.source,
          bytes: values.kb ? Number(values.kb) * 1024 : 0,
          aiGenerated: values.aiGenerated === 'yes',
        });
        close();
        toast(`Classified as ${asset.classification.category}${asset.attachedTo ? ` → filed onto "${asset.attachedTo.item}"` : ''}`, 'ok');
        navigate(`/site/${site.siteId}`);
      });
    } }, 'Add & classify')]);
  }

  function permissionSheet(site, state) {
    const close = sheet('Record permission', h('form.stack', { name: 'permission' }, [
      h('div.banner.warn', [h('span.ico', '⚖️'), h('div.tiny', 'Credit is not permission. The business may not even own the copyright to its own social photos — the photographer might. Record who cleared it and how.')]),
      h('p.small.muted', `Clearing ${state.assetsUncleared} asset(s): ${state.unclearedFiles.slice(0, 4).join(', ')}`),
      h('div.form-grid', [
        h('label.field', [h('span', 'Permission from'), h('input', { type: 'text', name: 'grantedBy', required: true, placeholder: 'Full name' })]),
        h('label.field', [h('span', 'Their role'), h('input', { type: 'text', name: 'role', placeholder: 'owner / manager / photographer' })]),
      ]),
      h('div.form-grid', [
        h('label.field', [h('span', 'How'), h('select', { name: 'method' }, ['whatsapp', 'email', 'in-person', 'signed-form'].map((m) => h('option', { value: m }, m)))]),
        h('label.field', [h('span', 'Licence'), h('select', { name: 'licence' }, ['owner-cleared', 'creator-licensed', 'licensed-stock'].map((m) => h('option', { value: m }, m)))]),
      ]),
      h('label.field', [h('span', 'Identifiable people in these images?'), h('select', { name: 'identifiablePeople' }, [h('option', { value: 'no' }, 'No'), h('option', { value: 'yes' }, 'Yes — POPIA consent needed')])]),
      h('label.field', [h('span', 'POPIA consent on file?'), h('select', { name: 'popiaConsent' }, [h('option', { value: 'no' }, 'No'), h('option', { value: 'yes' }, 'Yes — written consent stored')])]),
      h('label.field', [h('span', 'Evidence (email subject, message, file name)'), h('input', { type: 'text', name: 'evidenceHash', placeholder: 'whatsapp-screenshot-2026-10-12' })]),
      h('label.field', [h('span', 'Notes'), h('textarea', { name: 'notes', rows: 2 })]),
    ]), [h('button.btn.block', { onclick: async (e) => {
      await withButton(e.target, async () => {
        const values = formValues(document.getElementById('sheet').querySelector('form'));
        await api.post(`/api/sites/${site.siteId}/permissions`, {
          grantedBy: values.grantedBy,
          role: values.role,
          method: values.method,
          licence: values.licence,
          identifiablePeople: values.identifiablePeople === 'yes',
          popiaConsent: values.popiaConsent === 'yes',
          evidenceHash: values.evidenceHash || null,
          notes: values.notes || null,
        });
        close(); toast('Permission recorded in the audit ledger', 'ok'); navigate(`/site/${site.siteId}`);
      });
    } }, 'Record & seal')]);
  }

  function updateSheet(site) {
    const close = sheet('Log an update', h('form.stack', { name: 'update' }, [
      h('label.field', [h('span', 'What changed?'), h('input', { type: 'text', name: 'summary', required: true, placeholder: 'Winter menu prices updated' })]),
      h('label.field', [h('span', 'Allowance used up — bill an extra update?'), h('select', { name: 'approveExtra' }, [h('option', { value: 'no' }, 'No — refuse if the allowance is gone'), h('option', { value: 'yes' }, `Yes — bill ${money(site.plan.extraUpdateCents)}`)])]),
      h('p.tiny.muted', 'Metered by policy WEB-001 so nobody is silently billed and nobody works for free.'),
    ]), [h('button.btn.block', { onclick: async (e) => {
      await withButton(e.target, async () => {
        const values = formValues(document.getElementById('sheet').querySelector('form'));
        await api.post(`/api/sites/${site.siteId}/updates`, { summary: values.summary, approveExtra: values.approveExtra === 'yes' });
        close(); toast('Update logged', 'ok'); navigate(`/site/${site.siteId}`);
      });
    } }, 'Log update')]);
  }

  function aiPromptSheet(site) {
    const close = sheet('AI image prompt', h('form.stack', { name: 'ai' }, [
      h('p.small.muted', 'Missing photo? Generate one — but it must be labelled. A generated steak cannot stand in for a real one without saying so.'),
      h('label.field', [h('span', 'Item or subject'), h('input', { type: 'text', name: 'itemText', required: true, placeholder: 'Whole grilled linefish' })]),
      h('div.stack', { id: 'ai-out' }),
    ]), [h('button.btn.block', { onclick: async (e) => {
      await withButton(e.target, async () => {
        const values = formValues(document.getElementById('sheet').querySelector('form'));
        const result = await api.get(`/api/sites/${site.siteId}/ai-prompt?itemText=${encodeURIComponent(values.itemText)}`);
        const out = document.getElementById('ai-out');
        out.innerHTML = '';
        out.append(
          h('div.card.pad-sm', [h('div.tiny.muted', 'Prompt'), h('p.small.mono', result.prompt)]),
          h('div.card.pad-sm', [h('div.tiny.muted', 'Negative prompt'), h('p.small.mono', result.negativePrompt)]),
          h('div.banner.warn', [h('span.ico', '🏷️'), h('div.tiny', result.labelling.rule)]),
          h('button.btn.sm.ghost', { onclick: () => copy(result.prompt, 'Prompt copied') }, 'Copy prompt'),
        );
      });
    } }, 'Generate prompt')]);
  }

  function exportSheet(site) {
    sheet('Export', h('div.stack', [
      h('p.small.muted', 'One self-contained HTML file: CSS inlined, assets as data URIs. No build step, no dependencies, no broken relative paths in a sub-folder. The client owns this file even after cancelling.'),
      h('div.row.wrap', { style: { gap: '8px' } }, [
        h('a.btn.sm', { href: `/export/${site.slug}` }, '⬇️ Download the file'),
        h('a.btn.sm.ghost', { href: '/api/sites/export-bundle?includeHtml=false' }, 'Whole account bundle (JSON)'),
      ]),
      h('p.tiny.muted', 'The bundle also contains a deploy/index.html gallery, a sitemap and a GitHub Actions workflow for Pages.'),
    ]), [h('button.btn.block.ghost', { onclick: () => window.ProVeri.ui.closeSheet() }, 'Close')]);
  }

  function shareSite(site) {
    share({ title: site.name, text: `${site.name} — ${site.tagline}`, url: `${location.origin}${site.status === 'LIVE' ? site.urls.live : site.urls.preview}` });
  }

  /* ================= PUBLIC SITES GALLERY ================= */

  screens['/sites'] = async function sitesGallery() {
    const root = h('div.fade-in.stack');
    const sites = await api.get('/api/sites?publicOnly=true');
    const stats = await api.get('/api/sites/stats').catch(() => null);
    root.append(h('h1', 'Sites built on ProVeri'));
    root.append(h('p.muted.small', 'Real pages, served as plain HTML with no JavaScript required. Open one and use the booking form — it creates a real record.'));
    if (stats) {
      root.append(h('div.row.wrap', { style: { gap: '6px' } }, [
        badge(`${stats.live} live`, 'verified'),
        badge(`${stats.bookings} bookings taken`, 'info'),
        badge(`${stats.assetsPermissionCleared}/${stats.assets} assets permission-cleared`, 'gold'),
      ]));
    }
    root.append(sites.length ? h('div.list', { style: { marginTop: '12px' } }, sites.map((s) => h('a.tile', { href: s.url, target: '_blank', rel: 'noopener' }, [
      h('span.lead', '🌐'),
      h('div.grow', [h('div.t', s.name), h('div.d', `${s.industry} · ${s.suburb || s.metro || ''}`), h('div.tiny.muted', s.tagline)]),
      h('div.meta', [h('div.tiny', 'open →')]),
    ]))) : empty('🌐', 'Nothing published yet', 'Sites appear here the moment they pass the permission gate and go live.'));
    root.append(h('div.row', { style: { marginTop: '12px' } }, [
      h('a.btn.sm.ghost', { href: '/api/sites/gallery', target: '_blank', rel: 'noopener' }, 'Server-rendered gallery (no JS)'),
      h('button.btn.sm', { onclick: () => navigate('/business-studio') }, 'Open the studio'),
    ]));
    return root;
  };

  /* ================= SALES DESK ================= */

  screens['/sales-desk'] = async function salesDesk() {
    const root = h('div.fade-in.stack');
    const [leads, stats, actions, meta] = await Promise.all([
      api.get('/api/leads'),
      api.get('/api/leads/stats'),
      api.get('/api/leads/actions'),
      api.get('/api/leads/stages'),
    ]);

    root.append(h('h1', 'Sales desk'));
    root.append(h('p.muted.small', 'The field playbook turned into a pipeline: research a business, diagnose its website for free, build a working preview, then walk in between 14:30 and 16:30 with the site already on your phone.'));

    root.append(h('div.card.gold', [
      h('div.kicker.gold', '📊 Pipeline'),
      h('div.row.wrap', { style: { gap: '10px', marginTop: '6px' } }, [
        mini(stats.open, 'open leads'),
        mini(stats.won, 'won'),
        mini(stats.conversionRate + '%', 'conversion'),
        mini(money(stats.monthlyRecurringCents), 'MRR'),
        mini(money(stats.weightedPipelineCents), 'weighted'),
        mini(stats.overdueFollowUps, 'overdue'),
      ]),
      h('div.row.wrap', { style: { gap: '5px', marginTop: '8px' } }, Object.entries(stats.byWebsiteStatus).map(([status, count]) => badge(`${count} ${status.toLowerCase()}`, 'neutral'))),
    ]));

    root.append(h('section.section', [
      h('h2', 'Do this next'),
      actions.length ? h('div.list', actions.map((a) => h('div.card.pad-sm', [
        h('div.row.between', [
          h('div.grow', [h('div.t.small', a.businessName), h('div.tiny.muted', `${a.suburb || ''} · ${a.stage.toLowerCase().replace(/_/g, ' ')} · ${money(a.valueCents)}/mo`)]),
          a.overdue ? badge('overdue', 'danger') : badge(`priority ${a.priority}`, 'warn'),
        ]),
        h('div.small', { style: { marginTop: '6px' } }, a.action),
        h('div.row.wrap', { style: { gap: '6px', marginTop: '8px' } }, [
          h('button.btn.sm', { onclick: () => leadSheet(a.leadId) }, 'Open lead'),
          h('button.btn.sm.ghost', { onclick: () => pitchSheet(a.leadId) }, '🎤 Pitch kit'),
          a.optOut ? badge('opted out — do not contact', 'danger') : null,
        ]),
      ]))) : empty('🎯', 'Nothing due', 'Every lead has a next action date further out than today.'),
      h('button.btn.sm', { style: { marginTop: '10px' }, onclick: () => captureSheet(meta) }, '＋ Add a lead'),
    ]));

    root.append(h('section.section', [
      h('h2', 'All leads'),
      h('div.list', leads.map((l) => h('button.tile', { onclick: () => leadSheet(l.leadId) }, [
        h('span.lead', String(l.priority)),
        h('div.grow', [
          h('div.t', l.businessName),
          h('div.d', `${l.industry || 'unclassified'} · ${l.suburb || l.metro || ''} · ${l.websiteStatus}`),
          h('div.row', { style: { gap: '5px', marginTop: '5px', flexWrap: 'wrap' } }, [
            badge(l.stage.toLowerCase().replace(/_/g, ' '), l.stage === 'WON' ? 'verified' : l.stage === 'LOST' ? 'neutral' : 'info'),
            l.healthScore !== null && l.healthScore !== undefined ? badge(`${l.healthScore}/100`, l.healthScore < 50 ? 'danger' : 'warn') : null,
            l.siteSlug ? badge('demo built', 'gold') : null,
            l.optOut ? badge('opted out', 'danger') : null,
          ]),
        ]),
        h('div.meta', [h('div.money', l.dealValueCents ? money(l.dealValueCents) : '—'), h('div.tiny.muted', `${l.touches} touch(es)`)]),
      ]))),
    ]));

    root.append(h('section.section', [
      h('h2', 'The status vocabulary'),
      h('p.small.muted', 'What the salesperson actually observes in the field, with the priority it implies.'),
      h('div.list', meta.websiteStatuses.map((s) => h('div.split-row', [
        h('span.lbl.small', `${s.label} (${s.severity})`),
        h('span.tiny', s.note),
      ]))),
    ]));

    return root;

    function mini(value, label) {
      return h('div', { style: { minWidth: '74px' } }, [h('div.t', { style: { fontSize: '16px', fontWeight: 700 } }, String(value)), h('div.tiny.muted', label)]);
    }

    function captureSheet(stages) {
      const close = sheet('Add a lead', h('form.stack', { name: 'lead' }, [
        h('label.field', [h('span', 'Business name'), h('input', { type: 'text', name: 'businessName', required: true })]),
        h('div.form-grid', [
          h('label.field', [h('span', 'Industry'), h('input', { type: 'text', name: 'industry', placeholder: 'restaurant, transport, salon…' })]),
          h('label.field', [h('span', 'Suburb'), h('input', { type: 'text', name: 'suburb' })]),
        ]),
        h('div.form-grid', [
          h('label.field', [h('span', 'Their website'), h('input', { type: 'url', name: 'url', placeholder: 'https:// (blank if none)' })]),
          h('label.field', [h('span', 'Contact'), h('input', { type: 'tel', name: 'phone' })]),
        ]),
        h('label.field', [h('span', 'Website status'), h('select', { name: 'websiteStatus' }, stages.websiteStatuses.map((s) => h('option', { value: s.id }, `${s.label} — ${s.note}`)))]),
        h('label.field', [h('span', 'Source'), h('select', { name: 'source' }, ['FIELD_RESEARCH', 'WALK_IN', 'REFERRAL', 'WEBSITE_BOOKING', 'AD_CAMPAIGN'].map((s) => h('option', { value: s }, s.toLowerCase().replace(/_/g, ' '))))]),
        h('label.field', [h('span', 'Notes'), h('textarea', { name: 'notes', rows: 2 })]),
      ]), [h('button.btn.block', { onclick: async (e) => {
        await withButton(e.target, async () => {
          const values = formValues(document.getElementById('sheet').querySelector('form'));
          const lead = await api.post('/api/leads', { ...values, url: values.url || null });
          close(); toast(`${lead.businessName} added — priority ${lead.priority}: ${lead.priorityAction}`, 'ok');
          navigate('/sales-desk');
        });
      } }, 'Capture lead')]);
    }
  };

  async function leadSheet(leadId) {
    const lead = await api.get(`/api/leads/${leadId}`);
    const close = sheet(lead.businessName, h('div.stack', [
      h('div.row.wrap', { style: { gap: '5px' } }, [
        badge(lead.stage.toLowerCase().replace(/_/g, ' '), lead.stage === 'WON' ? 'verified' : 'info'),
        badge(`priority ${lead.priority}`, 'warn'),
        badge(lead.websiteStatusLabel, 'neutral'),
      ]),
      h('div.split-row', [h('span.lbl', 'Contact'), h('span.small', [lead.contactName || '—', lead.phone ? ` · ${lead.phone}` : ''].join(''))]),
      h('div.split-row', [h('span.lbl', 'Where'), h('span.small', `${lead.suburb || ''}${lead.metro ? `, ${lead.metro}` : ''}`)]),
      h('div.split-row', [h('span.lbl', 'Their site'), h('span.small', lead.url || 'none')]),
      h('div.split-row', [h('span.lbl', 'Next action'), h('span.small', lead.nextActionAt ? lead.nextActionAt.slice(0, 10) : '—')]),
      lead.diagnostic ? h('div.card.pad-sm', [
        h('div.t.small', lead.diagnostic.simulated ? 'Diagnostic (simulated — integrations offline)' : `Diagnostic ${lead.diagnostic.healthScore}/100 (grade ${lead.diagnostic.grade})`),
        h('p.small.muted', { style: { marginTop: '4px' } }, lead.diagnostic.primaryGap),
        lead.diagnostic.recommendedPlanName ? h('div.tiny', `Recommend: ${lead.diagnostic.recommendedPlanName}`) : null,
        lead.diagnostic.simulationNote ? h('p.tiny.muted', lead.diagnostic.simulationNote) : null,
      ]) : null,
      lead.siteSlug ? h('div.banner.ok', [h('span.ico', '🖥️'), h('div.tiny', [
        'Preview built: ',
        h('a', { href: `/preview/${lead.siteSlug}`, target: '_blank', rel: 'noopener' }, `/preview/${lead.siteSlug}`),
      ])]) : null,
      h('div.list', { style: { marginTop: '8px' } }, lead.timeline.slice().reverse().slice(0, 6).map((t) => h('div.split-row', [
        h('span.lbl.tiny', t.event.replace(/_/g, ' ').toLowerCase()),
        h('span.tiny', t.note),
      ]))),
      h('div.row.wrap', { style: { gap: '6px', marginTop: '10px' } }, [
        lead.diagnostic ? null : h('button.btn.sm', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/leads/${leadId}/diagnose`, {}); toast('Diagnosed', 'ok'); close(); leadSheet(leadId); }) }, 'Run free diagnostic'),
        !lead.siteId ? h('button.btn.sm.gold', { onclick: (e) => withButton(e.target, async () => { const demo = await api.post(`/api/leads/${leadId}/demo`, {}); toast(`Preview ready at ${demo.previewUrl}`, 'ok'); close(); leadSheet(leadId); }) }, 'Build the demo') : null,
        lead.stage !== 'WON' ? h('button.btn.sm', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/leads/${leadId}/convert`, { planId: lead.subscriptionPlanId || 'business-growth' }); toast('Won — subscription started, month one in escrow', 'ok'); close(); navigate('/sales-desk'); }) }, '🏆 Mark won') : null,
        lead.siteId ? h('button.btn.sm.ghost', { onclick: () => { close(); navigate(`/site/${lead.siteId}`); } }, 'Open the site') : null,
      ]),
      h('div.row.wrap', { style: { gap: '6px', marginTop: '6px' } }, [
        h('button.btn.sm.ghost', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/leads/${leadId}/outreach`, { channel: 'WHATSAPP', template: 'WHATSAPP', note: 'Logged from the studio' }); toast('Outreach logged', 'ok'); close(); leadSheet(leadId); }) }, 'Log WhatsApp touch'),
        h('button.btn.sm.ghost', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/leads/${leadId}/lose`, { reason: 'Not interested' }); toast('Marked lost', 'warn'); close(); navigate('/sales-desk'); }) }, 'Mark lost'),
        !lead.consent.optOut ? h('button.btn.sm.ghost', { onclick: (e) => withButton(e.target, async () => { await api.post(`/api/leads/${leadId}/opt-out`, { reason: 'Asked us to stop', requestedVia: 'phone' }); toast('POPIA objection recorded — all channels blocked', 'warn'); close(); navigate('/sales-desk'); }) }, 'Record POPIA opt-out') : h('div.banner.danger', [h('span.ico', '⛔'), h('div.tiny', 'This lead objected. Policy LEAD-001 blocks every channel.')]),
      ]),
    ]), [
      h('button.btn.block', { onclick: () => { close(); pitchSheet(leadId); } }, '🎤 Open the pitch kit'),
      h('button.btn.block.ghost', { onclick: () => close() }, 'Close'),
    ]);
  }

  async function pitchSheet(leadId) {
    const kit = await api.get(`/api/leads/${leadId}/pitch-kit`);
    const close = sheet(`Pitch kit · ${kit.businessName}`, h('div.stack', [
      h('div.banner.ok', [h('span.ico', '⏰'), h('div', [
        h('strong', `Walk in ${kit.timing.bestWindow}`),
        h('div.small', kit.timing.avoid),
        h('div.small', `Priority action: ${kit.timing.priorityAction}`),
      ])]),
      h('div.card.pad-sm', [
        h('div.t.small', 'What you know before you knock'),
        h('div.tiny.muted', `${kit.opening.websiteStatus}${kit.opening.healthScore !== null ? ` · scored ${kit.opening.healthScore}/100 (${kit.opening.grade})` : ''}`),
        h('p.small', { style: { marginTop: '4px' } }, kit.opening.specificGap),
        kit.opening.failedChecks?.length ? h('ul.small', kit.opening.failedChecks.map((f) => h('li', `${f.label} — ${f.fix}`))) : null,
      ]),
      h('div.card.pad-sm', [
        h('div.t.small', 'The 60 seconds'),
        h('div.list', { style: { marginTop: '6px' } }, kit.script.map((beat) => beat.stageDirection
          ? h('div.tiny.muted', `(${beat.line})`)
          : h('div.small', [h('strong', `${beat.beat}: `), beat.line]))),
      ]),
      h('div.card.pad-sm', [
        h('div.t.small', 'Recommend'),
        h('div.row.between', [h('div.t', kit.recommendation.planName), h('div.money', money(kit.recommendation.priceCents))]),
        h('div.tiny.muted', `${kit.recommendation.buildCostDisplay} · ${kit.recommendation.updatesIncluded}`),
        h('p.small', { style: { marginTop: '6px' } }, kit.recommendation.why),
        h('div.banner.warn', [h('span.ico', '🤝'), h('div.tiny', kit.recommendation.honestBoundary)]),
        h('div.banner.ok', [h('span.ico', '🔀'), h('div.tiny', kit.recommendation.proveriUpgrade)]),
        h('p.tiny.muted', kit.recommendation.anchorStrategy),
        h('p.small', { style: { fontStyle: 'italic' } }, `“${kit.recommendation.oneLiner}”`),
      ]),
      kit.showThem.previewUrl ? h('div.banner.ok', [h('span.ico', '📱'), h('div', [
        h('strong', 'Show them this'),
        h('div.small', [h('a', { href: kit.showThem.previewUrl, target: '_blank', rel: 'noopener' }, kit.showThem.previewUrl)]),
        h('div.small', kit.showThem.note),
      ])]) : h('div.banner.warn', [h('span.ico', '📱'), h('div.small', kit.showThem.note)]),
      h('details.fold', [
        h('summary', 'Objections'),
        h('div.fold-body', h('div.list', kit.objections.map((o) => h('div.card.pad-sm', [h('div.t.small', `“${o.objection}”`), h('p.small.muted', o.answer)])))),
      ]),
      h('details.fold', [
        h('summary', 'Cold email & WhatsApp'),
        h('div.fold-body', h('div.stack', [
          h('div.card.pad-sm', [h('div.tiny.muted', `Subject: ${kit.coldEmail.subject}`), h('pre.small', { style: { whiteSpace: 'pre-wrap' } }, kit.coldEmail.body), h('button.btn.sm.ghost', { onclick: () => copy(`${kit.coldEmail.subject}\n\n${kit.coldEmail.body}`, 'Email copied') }, 'Copy')]),
          h('div.card.pad-sm', [h('div.tiny.muted', 'WhatsApp'), h('p.small', kit.whatsapp), h('button.btn.sm.ghost', { onclick: () => copy(kit.whatsapp, 'Message copied') }, 'Copy')]),
        ])),
      ]),
      h('details.fold', [
        h('summary', 'Before you knock — permissions & AI images'),
        h('div.fold-body', h('div.stack', [
          h('div.card.pad-sm', [
            h('div.t.small', 'Permission checklist'),
            h('ul.small', { style: { marginTop: '6px' } }, kit.permissions.checklist.map((c) => h('li', [
              c.label,
              c.required ? h('span.tiny.muted', ' · always') : c.requiredWhen ? h('span.tiny.muted', ` · when ${c.requiredWhen}`) : null,
            ]))),
            h('p.tiny.muted', { style: { marginTop: '6px' } }, kit.permissions.demoSafeDefault),
          ]),
          h('div.card.pad-sm', [
            h('div.t.small', 'If they have no photos worth using'),
            h('div.list', { style: { marginTop: '6px' } }, kit.aiImages.budgetStack.map((step) => h('div.split-row', [
              h('span.lbl.tiny', step.step),
              h('span.tiny', [step.tool, step.cost].filter(Boolean).join(' — ')),
            ]))),
            h('p.tiny.muted', { style: { marginTop: '6px' } }, kit.aiImages.labellingPolicy),
          ]),
        ])),
      ]),
      h('p.tiny.mono.muted', `seal ${kit.seal}`),
    ]), [
      h('button.btn.block', { onclick: async (e) => {
        await withButton(e.target, async () => {
          await api.post(`/api/leads/${leadId}/outreach`, { channel: 'WALK_IN', note: `Pitch kit used — ${kit.recommendation.planName}` });
          toast('Walk-in logged against the lead', 'ok'); close(); navigate('/sales-desk');
        });
      } }, 'I am going in — log it'),
      h('button.btn.block.ghost', { onclick: () => close() }, 'Close'),
    ]);
  }
})();
