/* ==========================================================================
   Lula ProVeri PWA — trust, transparency, integrations and the admin console
   ========================================================================== */

window.ProVeri = window.ProVeri || {};
window.ProVeri.screens = window.ProVeri.screens || {};

(function () {
  'use strict';
  const { api } = window.ProVeri;
  const {
    h, money, moneyBig, timeAgo, dateTimeShort, countdown, stars, badge, trustBadge,
    toast, sheet, loading, loadingCards, empty, navigate, formValues, withButton, copy,
  } = window.ProVeri.ui;
  const screens = window.ProVeri.screens;

  /* ================= TRUST & TRANSPARENCY ================= */

  screens['/trust'] = async function trust() {
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Trust & transparency'));
    root.append(h('p.muted.small', 'A marketplace that sells “verified” has to be able to prove it. Everything below is generated from the hash-chained audit ledger — the same chain that settles disputes.'));

    const head = h('div.card.accent');
    root.append(head);
    head.append(loading(2));

    const sections = h('div.stack', { style: { marginTop: '14px' } });
    root.append(sections);
    sections.append(loadingCards(3));

    try {
      const [report, ledger, policies, integrationsData] = await Promise.all([
        api.get('/api/trust/transparency'),
        api.get('/api/trust/ledger?limit=18'),
        api.get('/api/trust/policies'),
        api.get('/api/integrations'),
      ]);

      head.innerHTML = '';
      head.append(
        h('div.kicker', '🧾 Platform integrity receipt'),
        h('div.row.between', [
          h('div', [h('div.tiny.muted', 'ledger entries'), h('span.money.big', String(report.ledgerEntries))]),
          h('div', [h('div.tiny.muted', 'chain'), h('span.badge.' + (report.chainValid ? 'verified' : 'danger'), report.chainValid ? 'valid' : 'broken')]),
        ]),
        h('div.row.between', { style: { marginTop: '8px' } }, [
          h('span.tiny.mono.muted', report.publishedReceipt),
          h('button.btn.sm.ghost', { onclick: () => copy(report.publishedReceipt, 'Receipt') }, 'Copy'),
        ]),
        h('p.tiny.muted', { style: { marginTop: '8px' } }, 'Every entry hashes the one before it. Edit or delete any of them and this receipt changes — that is the whole mechanism.'),
      );

      sections.innerHTML = '';

      /* verification outcomes */
      sections.append(h('div.card', [
        h('div.kicker', '🪪 Verification, honestly'),
        h('div.stat-grid', [
          mini(report.verifications.started, 'started'),
          mini(report.verifications.checksRecorded, 'checks'),
          mini(report.verifications.passed, 'passed'),
          mini(report.verifications.failed, 'failed'),
          mini(report.policy.byEffect?.REMOVE || 0, 'removed'),
          mini(report.crossVerticalBridges, 'bridged'),
        ]),
        h('p.tiny.muted', { style: { marginTop: '10px' } }, 'A failed check is not hidden — it is published, because a badge that only counts successes is advertising.'),
      ]));

      /* money */
      sections.append(h('div.card', [
        h('div.kicker', '💰 Where the money is'),
        h('div.split-row', [h('span.lbl', 'Currently held in escrow'), h('span.money', money(report.escrow.currentlyHeldCents))]),
        h('div.split-row', [h('span.lbl', 'Released to pros'), h('span.money', money(report.escrow.releasedToProsCents))]),
        h('div.split-row', [h('span.lbl', 'Refunded to customers'), h('span.money', money(report.escrow.refundedToCustomersCents))]),
        h('div.split-row', [h('span.lbl', 'Frozen by open disputes'), h('span', String(report.escrow.frozenCount))]),
        h('div.split-row', [h('span.lbl', 'Total protected'), h('span.money', money(report.escrow.totalValueCents))]),
      ]));

      /* policies */
      sections.append(h('details.fold', [
        h('summary', `⚖️ The rule book (${policies.policies.length} policies)`),
        h('div.fold-body', h('div.list', policies.policies.map((p) => h('div.card.pad-sm', [
          h('div.row.between', [h('strong.small', `${p.id} · ${p.name.replace(/_/g, ' ')}`), badge(p.effect, p.effect === 'REMOVE' || p.effect === 'FREEZE' ? 'danger' : p.effect === 'BLOCK' ? 'warn' : 'info')]),
          h('div.tiny.muted', `Protects: ${p.protects}`),
          h('div.small', p.statement),
        ])))),
      ]));

      /* risk catalogue */
      sections.append(h('details.fold', [
        h('summary', `🚨 Risk signals we watch (${Object.keys(policies.signals).length})`),
        h('div.fold-body', h('div.list', Object.entries(policies.signals).map(([key, signal]) => h('div.split-row', [
          h('span.lbl', signal.label),
          h('span', badge(signal.weight >= 40 ? 'critical' : signal.weight >= 25 ? 'high' : 'medium', signal.weight >= 40 ? 'danger' : signal.weight >= 25 ? 'warn' : 'neutral')),
        ])))),
      ]));

      /* fairness */
      sections.append(h('div.card', [
        h('div.kicker', '️ Fairness guard'),
        h('p.small', 'Locality and published crime data may only ever raise verification friction — extra ID checks, arrival codes, two-person visits. They may never change a pro’s ranking, a customer’s price or who may work where.'),
        h('p.tiny.muted', 'This is enforced in code: the risk engine throws if anyone calls the locality signal for a purpose other than safety. Search the source for PROH-001.'),
      ]));

      /* integrations */
      sections.append(h('details.fold', [
        h('summary', `🔌 ${integrationsData.catalogue.length} external data sources & partners`),
        h('div.fold-body', [
          h('div.row.wrap', { style: { marginBottom: '10px' } }, [
            badge(`mode: ${integrationsData.mode}`, 'info'),
            ...Object.entries(integrationsData.configured).filter(([, on]) => on).map(([key]) => badge(key, 'verified')),
          ]),
          h('div.list', integrationsData.catalogue.map((source) => h('div.card.pad-sm', [
            h('div.row.between', [h('strong.small', source.name), badge(source.tier, source.tier === 'LIVE' ? 'verified' : source.tier === 'MIRRORED' ? 'info' : 'neutral')]),
            h('div.tiny.muted', source.purpose),
            h('div.tiny.mono.muted', source.endpoint),
            h('div.tiny.muted', `auth: ${source.auth} · ${source.cost || source.licence || ''}`),
            source.ethicsGuard ? h('div.tiny', { style: { color: 'var(--warn-600)' } }, source.ethicsGuard) : null,
          ]))),
          h('button.btn.sm.ghost', { onclick: probe }, 'Probe the free sources now'),
        ]),
      ]));

      /* ledger */
      sections.append(h('details.fold', { open: true }, [
        h('summary', `🧾 Latest ledger entries (${ledger.entries.length})`),
        h('div.fold-body', h('div', ledger.entries.map((entry) => h('div.ledger-row', [
          h('span.lv.' + entry.level, entry.level),
          h('div.grow', [h('div', entry.payload.summary || entry.action), h('div.tiny.muted', `${entry.action} · ${dateTimeShort(entry.createdAt)}`)]),
          h('span.seal', entry.hash.slice(0, 12)),
        ])))),
      ]));
    } catch (error) {
      head.innerHTML = '';
      head.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
      sections.innerHTML = '';
    }
    return root;

    function mini(value, label) { return h('div.pill-stat', [h('span.v', String(value)), h('span.l', label)]); }

    async function probe() {
      toast('Probing free public sources…');
      const result = await api.post('/api/integrations/probe');
      sheet('Public source probe', h('div.stack', [
        h('div.row.between', [h('strong', `${result.liveCount}/${result.totalCount} reachable`), h('span.tiny.muted', result.probedAt.slice(11, 19))]),
        h('div.list', result.results.map((r) => h('div.split-row', [
          h('span.lbl', `${r.reachable ? '✅' : '❌'} ${r.name}`),
          h('span.tiny', `${r.latencyMs} ms${r.source ? ` · ${r.source}` : ''}`),
        ]))),
        h('p.tiny.muted', 'Sources that cannot be reached fall back to the bundled dataset, and every number on the platform is labelled with which one produced it.'),
      ]));
    }
  };

  /* ================= PROOF LOOKUP ================= */

  screens['/proof/:subjectId'] = async function proof({ params }) {
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Proof of record'));
    const box = h('div.stack', { style: { marginTop: '12px' } });
    root.append(box);
    box.append(loading(3));
    try {
      const data = await api.get(`/api/trust/proof/${params.subjectId}`);
      box.innerHTML = '';
      box.append(h('div.card', [
        h('div.kicker', '🔐 Digest'),
        h('div.row.between', [h('span.mono.small', data.proof.digest.slice(0, 24)), h('button.btn.sm.ghost', { onclick: () => copy(data.proof.digest, 'Digest') }, 'Copy')]),
        h('div.split-row', [h('span.lbl', 'Entries'), h('span', String(data.proof.entries))]),
        h('div.split-row', [h('span.lbl', 'Chain intact'), h('span.badge.' + (data.proof.chain ? 'verified' : 'danger'), data.proof.chain ? 'yes' : 'no')]),
      ]));
      box.append(h('div.card', [
        h('div.kicker', 'Timeline'),
        h('div', data.timeline.map((t) => h('div.ledger-row', [
          h('span.lv.INFO', t.level),
          h('div.grow', [h('div', t.summary), h('div.tiny.muted', dateTimeShort(t.createdAt))]),
          h('span.seal', t.seal),
        ]))),
      ]));
    } catch (error) {
      box.innerHTML = '';
      box.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;
  };

  /* ================= ADMIN ================= */

  screens['/admin'] = async function admin() {
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Trust desk'));
    root.append(h('p.muted.small', 'The operational view: queues, integrity, high-risk subjects and the escrow position.'));
    const box = h('div.stack', { style: { marginTop: '12px' } });
    root.append(box);
    box.append(loadingCards(4));
    try {
      const data = await api.get('/api/admin/console');
      box.innerHTML = '';

      box.append(h('div.card', [
        h('div.kicker', '⚙️ Integrity'),
        h('div.split-row', [h('span.lbl', 'Ledger chain'), h('span.badge.' + (data.ledger.integrity.chainValid ? 'verified' : 'danger'), data.ledger.integrity.chainValid ? 'valid' : 'broken')]),
        h('div.split-row', [h('span.lbl', 'Entries'), h('span', String(data.ledger.integrity.entries))]),
        h('div.split-row', [h('span.lbl', 'Head hash'), h('span.mono.tiny', data.ledger.integrity.headHash.slice(0, 20))]),
      ]));

      box.append(h('div.card', [
        h('div.kicker', '🗂️ Queues'),
        h('div.stat-grid', [
          mini(data.queues.prosAwaitingVerification, 'pros in verification'),
          mini(data.queues.jobsAwaitingBids, 'jobs with no bids'),
          mini(data.queues.bookingsAwaitingConfirmation, 'awaiting confirm'),
          mini(data.queues.disputesOpen, 'disputes open'),
          mini(data.queues.warrantiesOpen, 'warranties open'),
          mini(data.queues.webStudioPipeline, 'web studio jobs'),
        ]),
      ]));

      box.append(h('div.card', [
        h('div.kicker', '💰 Escrow position'),
        h('div.split-row', [h('span.lbl', 'Held'), h('span.money', money(data.escrow.currentlyHeldCents))]),
        h('div.split-row', [h('span.lbl', 'Released to pros'), h('span.money', money(data.escrow.releasedToProsCents))]),
        h('div.split-row', [h('span.lbl', 'Refunded'), h('span.money', money(data.escrow.refundedToCustomersCents))]),
      ]));

      box.append(h('div.card', [
        h('div.kicker', '🚨 Policy & risk'),
        h('div.split-row', [h('span.lbl', 'Policy decisions'), h('span', String(data.policy.decisions))]),
        ...Object.entries(data.policy.byEffect || {}).map(([effect, count]) => h('div.split-row', [h('span.lbl', effect), h('span', String(count))])),
        h('div.split-row', [h('span.lbl', 'Signals recorded'), h('span', String(data.risk.stats.totalSignals))]),
      ]));

      if (data.risk.highRiskSubjects.length) {
        box.append(h('div.card.danger', [
          h('div.kicker', '⛔ High-risk subjects'),
          h('div.list', data.risk.highRiskSubjects.map((s) => h('div.card.pad-sm', [
            h('div.row.between', [h('strong.small', s.name), badge(s.tier, 'danger')]),
            h('div.tiny.muted', `fraud ${s.fraudScore} · reliability ${s.reliabilityScore} · ${s.openSignals.length} open signal(s)`),
            h('div.list', { style: { marginTop: '6px' } }, s.openSignals.map((sig) => h('div.tiny', `• ${sig.label || sig.type}`))),
          ]))),
        ]));
      }

      box.append(h('div.card', [
        h('div.kicker', '📈 Verticals'),
        h('div.split-row', [h('span.lbl', 'Services'), h('span', `${data.jobs.jobsPosted} jobs · ${data.bookings.completed} completed · ${data.bookings.disputeRate}% dispute rate`)]),
        h('div.split-row', [h('span.lbl', 'Vehicles'), h('span', `${data.vehicles.listings} listings · ${data.vehicles.verified} verified · ${data.vehicles.bridgedInspections} bridged inspections`)]),
        h('div.split-row', [h('span.lbl', 'Web Studio'), h('span', `${data.webStudio.micrositesLive} microsites · ${data.webStudio.ordersDelivered}/${data.webStudio.orders} delivered`)]),
      ]));

      box.append(h('div.card', [
        h('div.kicker', '🕒 Critical ledger events'),
        h('div', (data.ledger.recentCritical || []).slice(0, 12).map((entry) => h('div.ledger-row', [
          h('span.lv.CRITICAL', 'CRIT'),
          h('div.grow', [h('div', entry.payload.summary), h('div.tiny.muted', dateTimeShort(entry.createdAt))]),
          h('span.seal', entry.hash.slice(0, 10)),
        ]))),
      ]));

      box.append(h('button.btn.block.ghost', { onclick: runScheduler }, '▶️ Run scheduler sweep now'));
    } catch (error) {
      box.innerHTML = '';
      box.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;

    function mini(value, label) { return h('div.pill-stat', [h('span.v', String(value)), h('span.l', label)]); }
    async function runScheduler() {
      const result = await api.post('/api/scheduler/run');
      toast(`Sweep: ${result.autoReleases.length} auto-release(s), ${result.warrantyClosed.length} warrant(ies) closed, ${result.disputesEscalated.length} dispute(s) escalated`, 'ok');
      navigate('/admin');
    }
  };

  /* ================= INTEGRATIONS PAGE ================= */

  screens['/integrations'] = async function integrationsPage() {
    const root = h('div.fade-in.stack');
    root.append(h('h1', 'Data & integrations'));
    root.append(h('p.muted.small', 'Every external dependency ProVeri uses, with its endpoint, cost, licence and auth model. Free sources ship today; partners switch on with a key. Nothing is silently simulated — every number is labelled with the source that produced it.'));
    const box = h('div.stack', { style: { marginTop: '12px' } });
    root.append(box);
    box.append(loadingCards(4));
    try {
      const data = await api.get('/api/integrations');
      box.innerHTML = '';
      box.append(h('div.card', [
        h('div.row.wrap', [badge(`mode: ${data.mode}`, 'info'), badge(`${data.freeTier.length} free sources`, 'verified')]),
        h('div.kv', { style: { marginTop: '10px' } }, [
          h('dt', 'HTTP requests'), h('dd', String(data.http.requests || 0)),
          h('dt', 'Cache hits'), h('dd', `${data.http.cacheHits || 0} (${data.http.cacheHitRate || 0}%)`),
          h('dt', 'Skipped offline'), h('dd', String(data.http.skippedOffline || 0)),
        ]),
      ]));
      const byTier = {};
      for (const source of data.catalogue) (byTier[source.tier] = byTier[source.tier] || []).push(source);
      for (const [tier, sources] of Object.entries(byTier)) {
        box.append(h('section.section', [
          h('h2', tier.replace(/_/g, ' ')),
          h('div.list', { style: { marginTop: '10px' } }, sources.map((s) => h('div.card.pad-sm', [
            h('div.row.between', [h('strong.small', s.name), s.free === true ? badge('free', 'verified') : null]),
            h('div.tiny.muted', s.purpose),
            h('div.tiny.mono.muted', s.endpoint),
            h('div.tiny.muted', [s.auth, s.cost || s.licence, s.rateLimit].filter(Boolean).join(' · ')),
            s.keyEndpoints ? h('div.tiny.mono.muted', s.keyEndpoints.slice(0, 4).map((k) => typeof k === 'string' ? k : `${k.method} ${k.path}`).join(' · ')) : null,
          ]))),
        ]));
      }
      box.append(h('section.section', [
        h('h2', 'Payment & messaging rails'),
        h('div.list', { style: { marginTop: '10px' } }, (data.payments || []).map((p) => h('div.card.pad-sm', [
          h('div.row.between', [h('strong.small', p.name), badge(p.kind, 'info')]),
          h('div.tiny.muted', p.bestFor || p.usedFor || ''),
          h('div.tiny.mono.muted', p.endpoint),
          p.feeModel ? h('div.tiny.muted', p.feeModel) : null,
        ]))),
      ]));
    } catch (error) {
      box.innerHTML = '';
      box.append(h('div.banner.danger', [h('span.ico', '⛔'), h('div', error.message)]));
    }
    return root;
  };
})();
