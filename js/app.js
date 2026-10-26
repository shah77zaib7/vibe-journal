/* ============================================================================
   VibeJournal — application
   ========================================================================== */
(function () {
  'use strict';

  var $ = VJUI.$, $$ = VJUI.$$, esc = VJUI.esc;
  var C = VJUI.charts;

  var DEFAULT_STRATEGIES = ['Liquidity Sweep', 'Fibonacci', 'Breakout', 'Trend Continuation', 'Range Reversal', 'Order Block', 'News Trade'];

  var S = {
    trades: [],
    settings: {
      balance: 10000, currency: '$', theme: 'dark',
      colorPnl: true, reduceMotion: false, strategies: DEFAULT_STRATEGIES.slice()
    },
    chartSymbol: '',
    chartFrame: '',
    view: 'dashboard',
    range: 30,
    filters: { from: '', to: '', pair: '', strategy: '', result: '', direction: '', tags: [] },
    query: '',
    rowCap: 150,
    sort: { key: 'dt', dir: 'desc' },
    editingId: null,
    pendingShot: null,
    shotRemoved: false,
    pnlTouched: false,
    timeGran: 'month',
    tab: 'perf',
    deferredInstall: null
  };

  /* ══════════════════════ settings ══════════════════════ */

  function saveSettings() { return VJDB.setMeta('settings', S.settings); }

  function applyTheme() {
    var html = document.documentElement;
    VJUI.charts.invalidate();
    html.setAttribute('data-theme', S.settings.theme);
    html.setAttribute('data-pnl', S.settings.colorPnl ? 'color' : 'mono');
    html.setAttribute('data-motion', S.settings.reduceMotion ? 'off' : 'on');
    VJUI.setCurrency(S.settings.currency);
    $$('meta[name="theme-color"]').forEach(function (m) { m.remove(); });
    var meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = S.settings.theme === 'dark' ? '#0B0B0D' : '#F9F9FB';
    document.head.appendChild(meta);
  }

  function syncSettingsUI() {
    $('#setBalance').value = S.settings.balance;
    $('#setCurrency').value = S.settings.currency;
    $('#curSymA').textContent = S.settings.currency;
    $('#setColorPnl').checked = !!S.settings.colorPnl;
    $('#setMotion').checked = !!S.settings.reduceMotion;
    $$('#themeSeg button').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.themeVal === S.settings.theme);
    });
    $('#themeBtn use').setAttribute('href', S.settings.theme === 'dark' ? '#i-moon' : '#i-sun');
    var list = $('#stratList');
    if (list) {
      list.innerHTML = S.settings.strategies
        .map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('');
    }
  }

  /* ══════════════════════ derived ══════════════════════ */

  function allStats() { return VJStats.bucket(S.trades, S.settings.balance); }
  function closedTrades() { return S.trades.filter(VJStats.isClosed); }

  function recentSymbols() {
    var seen = {}, out = [];
    S.trades.forEach(function (t) {
      if (t.symbol && !seen[t.symbol]) { seen[t.symbol] = 1; out.push(t.symbol); }
    });
    return out;
  }

  function tagUniverse() {
    var set = {};
    S.trades.forEach(function (t) { (t.tags || []).forEach(function (g) { set[g] = 1; }); });
    return Object.keys(set).sort();
  }

  /* ══════════════════════ navigation ══════════════════════ */

  var VIEW_META = {
    dashboard: { title: 'Dashboard', sub: function () {
      var n = S.trades.length;
      return n ? n + ' trade' + (n === 1 ? '' : 's') + ' tracked' : 'No trades yet';
    } },
    journal: { title: 'Journal', sub: function () { return S.trades.length + ' logged'; } },
    analytics: { title: 'Analytics', sub: function () {
      var s = allStats();
      return s.closed ? 'Win rate ' + VJUI.pct(s.winRate) + ' · PF ' + (s.profitFactor === Infinity ? '∞' : VJUI.num(s.profitFactor, 2)) : 'Nothing to analyse yet';
    } },
    settings: { title: 'Settings', sub: function () { return 'Everything is stored on this device'; } }
  };

  function go(view) {
    if (!VIEW_META[view]) view = 'dashboard';
    S.view = view;
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.dataset.view === view); });
    $$('[data-nav]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.nav === view); });
    $('#viewTitle').textContent = VIEW_META[view].title;
    $('#viewSub').textContent = VIEW_META[view].sub();
    try { history.replaceState(null, '', '#' + view); } catch (e) {}
    renderView(view);
    renderCloudStatus();
    window.scrollTo(0, 0);
  }

  function renderView(view) {
    if (view === 'dashboard') renderDashboard();
    else if (view === 'journal') renderJournal();
    else if (view === 'analytics') renderAnalytics();
    else if (view === 'settings') { renderSettings(); refreshStorage(); }
    $('#navCount').textContent = S.trades.length;
  }

  /**
   * @param {boolean} structural  true when the set of trades changed and charts
   *   must be rebuilt; false for settings-only changes where we can leave the
   *   existing canvases alone.
   */
  function renderAll(structural) {
    if (structural !== false) C.destroyAll();
    window.__vjRecentSymbols = recentSymbols();
    var sub = VIEW_META[S.view];
    $('#viewSub').textContent = sub.sub();
    $('#navCount').textContent = S.trades.length;
    renderView(S.view);
    if (S.trades.length !== S.lastStorageCount) {
      S.lastStorageCount = S.trades.length;
      refreshStorage();
    }
  }

  /* ══════════════════════ dashboard ══════════════════════ */

  function renderDashboard() {
    var s = allStats();
    var net = s.netPnl;
    var ret = S.settings.balance ? net / S.settings.balance : 0;

    var hp = $('#heroPnl');
    hp.textContent = VJUI.bal(net);
    hp.className = 'hero-value ' + VJUI.pnlClass(net);

    var d = $('#heroDelta');
    d.className = 'delta ' + VJUI.pnlClass(ret);
    d.innerHTML = '<svg class="ic xs"><use href="#' + (ret < 0 ? 'i-down' : 'i-up') + '"/></svg><span>' +
      (ret > 0 ? '+' : '') + VJUI.num(ret * 100, 2) + '%</span>';

    $('#heroBal').textContent = 'Balance ' + VJUI.bal(S.settings.balance + net);

    var circ = 2 * Math.PI * 52;
    var ring = $('#winRing');
    ring.style.strokeDashoffset = circ * (1 - (s.closed ? s.winRate : 0));
    ring.style.stroke = net < 0 && s.closed ? VJUI.charts.cssVar('--ink-2') : VJUI.charts.cssVar('--ink');
    $('#heroWR').textContent = s.closed ? Math.round(s.winRate * 100) + '%' : '—';

    // equity curve
    var pts = VJStats.equityCurve(S.trades, S.settings.balance, S.range);
    C.equity('hero', 'equityChart', pts, { balance: S.settings.balance });
    $('#equityEmpty').hidden = pts.length > 1;
    $$('.range-pill').forEach(function (b) { b.classList.toggle('is-active', +b.dataset.range === S.range); });

    // stat cards
    $('#sTrades').textContent = s.total;
    $('#sTradesSub').textContent = s.closed + ' closed' + (s.openCount ? ' · ' + s.openCount + ' open' : '');
    $('#sPF').textContent = s.closed ? (s.profitFactor === Infinity ? '∞' : VJUI.num(s.profitFactor, 2)) : '—';
    $('#sPFSub').textContent = s.closed ? VJUI.money(s.grossProfit, { plain: false }) + ' / ' + VJUI.money(-s.grossLoss) : ' ';
    $('#sRR').textContent = s.avgPlannedRR ? VJUI.num(s.avgPlannedRR, 2) + 'R' : '—';
    $('#sRRSub').textContent = s.avgPlannedRR ? 'planned on ' + S.trades.filter(function (t) { return VJStats.plannedRR(t); }).length + ' trades' : ' ';
    $('#sRisk').textContent = s.avgRisk ? VJUI.bal(s.avgRisk, 0) : '—';
    $('#sRiskSub').textContent = s.avgRisk
      ? VJUI.num(S.settings.balance ? s.avgRisk / S.settings.balance * 100 : 0, 2) + '% of balance'
      : ' ';

    // recent
    var recent = S.trades.slice(0, 6);
    var host = $('#recentList');
    host.innerHTML = recent.length
      ? recent.map(tradeRowHtml).join('')
      : emptyMini();

    // strategy breakdown
    var byS = VJStats.groupStats(S.trades, VJStats.byStrategy, S.settings.balance);
    var top = byS.slice(0, 6);
    $('#stratEmpty').hidden = top.length > 0;
    if (top.length) {
      C.hbar('strat', 'stratChart', top.map(function (r) { return r.key; }), top.map(function (r) { return r.net; }));
      var maxAbs = Math.max.apply(null, top.map(function (r) { return Math.abs(r.net); }).concat([1]));
      $('#stratList').innerHTML = top.map(function (r) {
        return '<div class="mini-row"><span class="nm">' + esc(r.key) +
          '<span class="mini-bar"><i style="width:' + Math.round(Math.abs(r.net) / maxAbs * 100) + '%"></i></span></span>' +
          '<span class="v ' + VJUI.pnlClass(r.net) + '">' + VJUI.money(r.net) + '</span>' +
          '<span class="tr-r" style="width:38px;text-align:right">' + VJUI.pct(r.winRate, 0) + '</span></div>';
      }).join('');
    } else {
      C.destroy('strat');
      $('#stratList').innerHTML = '';
    }

    // result doughnut
    var rs = s.resultSplit;
    var rsTotal = rs.win + rs.loss + rs.be + rs.open;
    $('#resultEmpty').hidden = rsTotal > 0;
    if (rsTotal) {
      var names = ['Win', 'Loss', 'Breakeven', 'Open'];
      var vals = [rs.win, rs.loss, rs.be, rs.open];
      var cols = [C.cssVar('--pos'), C.cssVar('--neg'), C.cssVar('--ink-3'), C.cssVar('--ink-4')];
      C.doughnut('result', 'resultChart', names, vals, cols);
      $('#resultLegend').innerHTML = names.map(function (n, i) {
        return '<span><i style="background:' + cols[i] + '"></i>' + n + ' <b>' + vals[i] + '</b></span>';
      }).join('');
    } else {
      C.destroy('result');
      $('#resultLegend').innerHTML = '';
    }
  }

  function emptyMini() {
    return '<div class="empty" style="padding:26px 10px">' +
      '<span class="empty-ic"><svg class="ic"><use href="#i-journal"/></svg></span>' +
      '<h3>Your journal is empty</h3><p>Log your first trade to start tracking your edge.</p>' +
      '<div class="empty-actions"><button class="btn-solid sm" data-action="new-trade">' +
      '<svg class="ic"><use href="#i-plus"/></svg><span>Log a trade</span></button>' +
      '<button class="btn-ghost sm" data-action="load-sample">Load sample data</button></div></div>';
  }

  function tradeRowHtml(t) {
    var p = VJStats.pnlOf(t);
    var rr = VJStats.realizedR(t, S.settings.balance);
    var sub = (t.strategy || 'No strategy') + (t.tags && t.tags.length ? ' · ' + t.tags[0] : '');
    return '<button class="trade-row' + (t.shotId ? ' has-shot' : '') + '" data-open="' + t.id + '">' +
      '<span class="tr-symbol">' + VJUI.shortSym(t.symbol) + '</span>' +
      '<span class="tr-main"><span class="tr-t"><span class="tr-sym">' + esc(t.symbol || '—') + '</span>' +
      '<span class="side-chip side-' + (t.direction === 'sell' ? 'sell' : 'buy') + '">' + (t.direction === 'sell' ? 'SELL' : 'BUY') + '</span>' +
      VJUI.resultBadge(t.result) + '</span>' +
      '<span class="tr-sub">' + esc(sub) + ' · ' + VJUI.fRel(t.dt) + '</span></span>' +
      '<span class="tr-right"><span class="tr-pnl ' + VJUI.pnlClass(t.result === 'open' ? null : p) + '">' +
      (t.result === 'open' ? 'Open' : VJUI.money(p)) + '</span>' +
      '<span class="tr-r">' + (rr != null ? VJUI.rmult(rr) : (VJStats.plannedRR(t) ? VJUI.ratio(VJStats.plannedRR(t)) : '')) + '</span></span></button>';
  }

  /* ══════════════════════ journal ══════════════════════ */

  function journalRows() {
    var f = S.filters;
    var rows = VJStats.applyFilters(S.trades, f).filter(function (t) { return VJStats.matchesQuery(t, S.query); });
    return VJStats.sortTrades(rows, S.sort.key, S.sort.dir, S.settings.balance);
  }

  function renderJournal() {
    // filter option lists
    var pairs = {}, strats = {};
    S.trades.forEach(function (t) { if (t.symbol) pairs[t.symbol] = 1; if (t.strategy) strats[t.strategy] = 1; });
    fillSelect($('#fPair'), Object.keys(pairs).sort(), 'All pairs', S.filters.pair);
    fillSelect($('#fStrat'), Object.keys(strats).sort(), 'All strategies', S.filters.strategy);

    // tag chips
    var tags = tagUniverse();
    $('#fTags').innerHTML = tags.length
      ? tags.map(function (g) {
          return '<button type="button" class="chip' + (S.filters.tags.indexOf(g) > -1 ? ' is-on' : '') + '" data-tag="' + esc(g) + '">' + esc(g) + '</button>';
        }).join('')
      : '';

    var all = journalRows();
    // rebuilding a few thousand <tr> on every keystroke is what makes big
    // journals feel broken — render a window and let the user extend it
    var rows = all.slice(0, S.rowCap);
    var capped = all.length > rows.length;
    $('#resultCount').innerHTML = all.length + ' trade' + (all.length === 1 ? '' : 's') +
      (capped ? ' <button class="link-btn" data-more style="margin-left:4px">show ' +
        Math.min(200, all.length - rows.length) + ' more</button>' : '');
    $('#journalEmpty').hidden = rows.length > 0;
    $('#tradeTable').style.display = rows.length ? '' : 'none';

    $('#tradeRows').innerHTML = rows.map(function (t) {
      var rr = VJStats.plannedRR(t);
      var risk = VJStats.riskAmount(t, S.settings.balance);
      return '<tr data-open="' + t.id + '">' +
        '<td class="t-mono">' + VJUI.fDate(t.dt) + ' <span style="color:var(--ink-4)">' + VJUI.fTime(t.dt) + '</span></td>' +
        '<td class="t-sym">' + esc(t.symbol || '—') + '</td>' +
        '<td><span class="side-chip side-' + (t.direction === 'sell' ? 'sell' : 'buy') + '">' + (t.direction === 'sell' ? 'SELL' : 'BUY') + '</span></td>' +
        '<td class="num t-mono">' + (t.entry == null ? '—' : VJUI.num(t.entry, VJInstr.decimals(t.symbol))) + '</td>' +
        '<td class="num hide-sm t-mono">' + (rr ? VJUI.num(rr, 2) + 'R' : '—') + '</td>' +
        '<td class="num hide-sm t-mono">' + (risk ? VJUI.num(risk, 0) : '—') + '</td>' +
        '<td class="num"><b class="' + VJUI.pnlClass(t.result === 'open' ? null : VJStats.pnlOf(t)) + '">' +
          (t.result === 'open' ? '—' : VJUI.money(VJStats.pnlOf(t))) + '</b></td>' +
        '<td>' + VJUI.resultBadge(t.result) + '</td>' +
        '<td class="hide-md" style="color:var(--ink-2)">' + esc(t.strategy || '—') + '</td>' +
        '<td class="right"><span class="t-row-act">' +
          '<button class="icon-btn xs" data-edit="' + t.id + '" aria-label="Edit"><svg class="ic"><use href="#i-edit"/></svg></button>' +
          '<button class="icon-btn xs" data-del="' + t.id + '" aria-label="Delete"><svg class="ic"><use href="#i-trash"/></svg></button>' +
        '</span></td></tr>';
    }).join('');

    // sort indicators
    $$('#tradeTable th.sortable').forEach(function (th) {
      if (th.dataset.sort === S.sort.key) th.setAttribute('data-dir', S.sort.dir);
      else th.removeAttribute('data-dir');
    });

    // active filter chips
    var chips = [];
    var f = S.filters;
    if (f.from) chips.push(['from', 'From ' + f.from]);
    if (f.to) chips.push(['to', 'To ' + f.to]);
    if (f.pair) chips.push(['pair', f.pair]);
    if (f.strategy) chips.push(['strategy', f.strategy]);
    if (f.result) chips.push(['result', VJUI.RESULT_META[f.result].label]);
    if (f.direction) chips.push(['direction', f.direction === 'buy' ? 'Buy' : 'Sell']);
    f.tags.forEach(function (g) { chips.push(['tag:' + g, '#' + g]); });
    $('#activeChips').innerHTML = chips.map(function (c) {
      return '<button class="chip is-on" data-drop="' + esc(c[0]) + '">' + esc(c[1]) + '<svg class="ic xs"><use href="#i-close"/></svg></button>';
    }).join('');
    var n = [f.from, f.to, f.pair, f.strategy, f.result, f.direction].filter(Boolean).length + f.tags.length;
    var fc = $('#filterCount');
    fc.hidden = n === 0;
    fc.textContent = n;
  }

  function fillSelect(sel, values, blankLabel, current) {
    var opts = ['<option value="">' + esc(blankLabel) + '</option>'].concat(
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }));
    sel.innerHTML = opts.join('');
    sel.value = current || '';
  }

  var SORT_PRESETS = {
    'dt:desc': 'Newest', 'dt:asc': 'Oldest',
    'pnl:desc': 'Best P&L', 'pnl:asc': 'Worst P&L',
    'symbol:asc': 'Pair A–Z',
    'riskAmount:desc': 'Highest risk',
    'plannedRR:desc': 'Best R:R',
    'result:asc': 'Result'
  };

  /* ══════════════════════ analytics ══════════════════════ */

  function renderAnalytics() {
    $$('.seg-bar .seg').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === S.tab); });
    $$('.tab-pane').forEach(function (p) { p.classList.toggle('is-active', p.dataset.pane === S.tab); });

    var s = allStats();
    var b = S.settings.balance;
    var has = s.closed > 0;

    if (S.tab === 'perf') {
      $('#aExp').textContent = has ? VJUI.money(s.expectancy) : '—';
      $('#aExpSub').textContent = has ? VJUI.rmult(s.expectancyR) + ' per trade' : 'per trade';
      $('#aExp').className = 'stat-v ' + VJUI.pnlClass(s.expectancy);
      $('#aAvgW').textContent = s.wins ? VJUI.bal(s.avgWin) : '—';
      $('#aAvgWSub').textContent = s.wins ? s.wins + ' winning trades' : ' ';
      $('#aAvgL').textContent = s.losses ? VJUI.bal(-s.avgLoss) : '—';
      $('#aAvgLSub').textContent = s.losses ? s.losses + ' losing trades' : ' ';
      $('#aBest').textContent = s.wins ? VJUI.money(s.best) : '—';
      $('#aBestSub').textContent = s.bestTrade ? s.bestTrade.symbol + ' · ' + VJUI.rmult(VJStats.realizedR(s.bestTrade, b)) : ' ';
      $('#aBest').className = 'stat-v ' + (s.wins ? 'pnl-pos' : '');
      $('#aWorst').textContent = s.losses ? VJUI.money(s.worst) : '—';
      $('#aWorstSub').textContent = s.worstTrade ? s.worstTrade.symbol + ' · ' + VJUI.rmult(VJStats.realizedR(s.worstTrade, b)) : ' ';
      $('#aWorst').className = 'stat-v ' + (s.losses ? 'pnl-neg' : '');
      $('#aPayoff').textContent = s.payoff === Infinity ? '∞' : (s.payoff ? VJUI.num(s.payoff, 2) : '—');
      $('#aPayoffSub').textContent = s.payoff && s.payoff !== Infinity ? 'need ' + VJUI.num(1 / s.payoff * 100, 0) + '% win rate to break even' : 'avg win ÷ avg loss';

      $('#perfNote').textContent = has ? s.closed + ' closed trades' : '';

      var closed = closedTrades().slice().sort(function (a, b2) { return a.dt - b2.dt; });
      var pts = [{ x: closed.length ? closed[0].dt : Date.now(), y: b }];
      var run = 0;
      closed.forEach(function (t) { run += VJStats.pnlOf(t); pts.push({ x: t.dt, y: b + run, trade: t }); });
      C.equity('cum', 'cumChart', pts, { balance: b });

      C.doughnut('aresult', 'aResultChart', ['Win', 'Loss', 'Breakeven', 'Open'],
        [s.resultSplit.win, s.resultSplit.loss, s.resultSplit.be, s.resultSplit.open],
        [C.cssVar('--pos'), C.cssVar('--neg'), C.cssVar('--ink-3'), C.cssVar('--ink-4')]);

      $('#streakGrid').innerHTML = [
        ['Current streak', s.curStreak ? (s.curStreak + (s.curStreakType === 'w' ? ' win' : ' loss') + (s.curStreak > 1 ? 'es' : '')) : '—'],
        ['Best win streak', s.maxWinStreak ? s.maxWinStreak + (s.maxWinStreak > 1 ? ' wins' : ' win') : '—'],
        ['Worst losing streak', s.maxLossStreak ? s.maxLossStreak + (s.maxLossStreak > 1 ? ' losses' : ' loss') : '—'],
        ['Breakeven rate', s.closed ? VJUI.pct(s.bes / s.closed) : '—'],
        ['Gross profit', VJUI.bal(s.grossProfit)],
        ['Gross loss', VJUI.bal(-s.grossLoss)]
      ].map(function (kv) { return '<div class="kv"><b>' + esc(kv[1]) + '</b><span>' + esc(kv[0]) + '</span></div>'; }).join('');
    }

    if (S.tab === 'strat') {
      var byS = VJStats.groupStats(S.trades, VJStats.byStrategy, b);
      C.hbar('stratBar', 'stratBar', byS.map(function (r) { return r.key; }), byS.map(function (r) { return r.net; }));
      $('#stratTbl').innerHTML = groupTable(byS, 'Strategy');
    }

    if (S.tab === 'pairs') {
      var byP = VJStats.groupStats(S.trades, VJStats.byPair, b);
      C.hbar('pairBar', 'pairBar', byP.map(function (r) { return r.key; }), byP.map(function (r) { return r.winRate * 100; }), { fade: true });
      $('#pairTbl').innerHTML = groupTable(byP, 'Pair', true);
    }
    if (S.tab === 'risk') {
      $('#rAvg').textContent = s.avgRisk ? VJUI.bal(s.avgRisk, 0) : '—';
      $('#rAvgSub').textContent = s.avgRisk ? VJUI.num(b ? s.avgRisk / b * 100 : 0, 2) + '% of balance' : ' ';
      $('#rMax').textContent = s.maxRisk ? VJUI.bal(s.maxRisk, 0) : '—';
      $('#rMaxSub').textContent = s.riskCount ? 'across ' + s.riskCount + ' trades' : ' ';
      $('#rTot').textContent = s.totalRisk ? VJUI.bal(s.totalRisk, 0) : '—';
      $('#rTotSub').textContent = s.closed ? VJUI.bal(s.netPnl) + ' realised' : ' ';
      $('#rReal').textContent = s.closed ? VJUI.rmult(s.realizedRTotal) : '—';
      $('#rRealSub').textContent = 'sum of realised R';
      $('#rReal').className = 'stat-v ' + VJUI.pnlClass(s.realizedRTotal);

      var pts = closedTrades()
        .map(function (t) {
          var r = VJStats.riskAmount(t, b);
          return r ? {
            x: t.dt, y: VJStats.pnlOf(t), risk: r, pnl: VJStats.pnlOf(t),
            r: VJStats.realizedR(t, b), id: t.id, symbol: t.symbol
          } : null;
        })
        .filter(Boolean);
      C.scatter('riskScatter', 'riskScatter', pts, { onSelect: function (p) { if (p.id) openDetail(p.id); } });

      var dist = VJStats.rDistribution(S.trades, b);
      C.bar('rDist', 'rDist', dist.map(function (d) { return d.label; }),
        dist.map(function (d) { return d.n; }), { fade: true });

      var cv = s.avgRisk ? s.riskStd / s.avgRisk : 0;
      $('#riskNote').textContent = s.riskCount > 1 ? 'Coefficient of variation ' + VJUI.num(cv * 100, 1) + '%' : '';
      $('#riskGrid').innerHTML = [
        ['Smallest risk', s.minRisk ? VJUI.bal(s.minRisk, 0) : '—'],
        ['Largest risk', s.maxRisk ? VJUI.bal(s.maxRisk, 0) : '—'],
        ['Risk spread', s.avgRisk ? VJUI.bal(s.maxRisk - s.minRisk, 0) : '—'],
        ['Consistency', cv ? (cv < 0.25 ? 'Very consistent' : cv < 0.5 ? 'Fairly consistent' : 'Inconsistent') : '—'],
        ['Avg planned R:R', s.avgPlannedRR ? VJUI.num(s.avgPlannedRR, 2) + 'R' : '—'],
        ['Realised R total', s.closed ? VJUI.rmult(s.realizedRTotal) : '—']
      ].map(function (kv) { return '<div class="kv"><b>' + esc(kv[1]) + '</b><span>' + esc(kv[0]) + '</span></div>'; }).join('');
    }

    if (S.tab === 'chart') {
      renderChartTab();
    }

    if (S.tab === 'time') {
      $$('#timeGran button').forEach(function (b2) { b2.classList.toggle('is-active', b2.dataset.gran === S.timeGran); });
      var rows = VJStats.timeSeries(S.trades, S.timeGran, b);
      C.bar('time', 'timeChart', rows.map(function (r) { return r.short; }), rows.map(function (r) { return r.net; }),
        { rotate: rows.length > 12, meta: rows.map(function (r) { return [r.n + ' trades · ' + r.wins + 'W / ' + r.losses + 'L', VJUI.pct(r.winRate, 0) + ' win rate']; }) });

      $('#timeTbl').innerHTML =
        '<thead><tr><th>Period</th><th class="num">Trades</th><th class="num">W / L</th><th class="num">Win rate</th><th class="num">Net P&L</th></tr></thead><tbody>' +
        (rows.length ? rows.slice().reverse().map(function (r) {
          return '<tr><td><b>' + esc(r.label) + '</b></td><td class="num">' + r.n + '</td>' +
            '<td class="num">' + r.wins + ' / ' + r.losses + '</td>' +
            '<td class="num">' + VJUI.pct(r.winRate) + '</td>' +
            '<td class="num ' + VJUI.pnlClass(r.net) + '"><b>' + VJUI.money(r.net) + '</b></td></tr>';
        }).join('') : '<tr><td colspan="5" style="color:var(--ink-4);padding:22px 10px;text-align:center">No closed trades in this period.</td></tr>') +
        '</tbody>';
    }
  }

  /* ══════════════════════ candlestick tab ══════════════════════ */

  function renderChartTab() {
    var trades = S.trades;

    // default to the most-traded pair, else the newest trade's pair
    if (!S.chartSymbol) {
      var counts = {};
      trades.forEach(function (t) { if (t.symbol) counts[t.symbol] = (counts[t.symbol] || 0) + 1; });
      var ranked = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
      S.chartSymbol = ranked[0] || (trades[0] && trades[0].symbol) || 'EURUSD';
    }
    var picker = document.querySelector('#chartPicker');
    var symInput = $('#chartSymbol');
    if (picker && picker.__setValue) { if (symInput.value !== S.chartSymbol) picker.__setValue(S.chartSymbol); }
    else if (symInput && symInput.value !== S.chartSymbol) { symInput.value = S.chartSymbol; }

    var pairTrades = trades.filter(function (t) { return t.symbol === S.chartSymbol; });
    var dp = VJInstr.decimals(S.chartSymbol);

    var usedFrame = VJCandles.mount($('#candleChart'), {
      symbol: S.chartSymbol,
      trades: pairTrades.slice().sort(function (a, b) { return a.dt - b.dt; }),
      dp: dp,
      frame: S.chartFrame,
      showLevels: pairTrades.length > 0
    });
    if (usedFrame) {
      S.chartFrame = usedFrame.id;
      $$('#chartFrame button').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.frame === usedFrame.id);
      });
    }

    var pos = VJUI.charts.cssVar('--pos'), neg = VJUI.charts.cssVar('--neg'), ink = VJUI.charts.cssVar('--ink');
    $('#candleLegend').innerHTML =
      '<span><i style="background:' + pos + '"></i>Up candle <b>' + pairTrades.filter(function (t) { return t.result === 'win'; }).length + 'W</b></span>' +
      '<span><i style="background:' + neg + '"></i>Down candle <b>' + pairTrades.filter(function (t) { return t.result === 'loss'; }).length + 'L</b></span>' +
      '<span><i style="background:' + ink + ';border-radius:50%"></i>Your entries <b>' + pairTrades.length + '</b></span>' +
      '<span style="color:var(--ink-4)">▲ win &nbsp;▼ loss</span>';

    var net = VJStats.bucket(pairTrades, S.settings.balance);
    $('#chartNote').textContent = pairTrades.length
      ? pairTrades.length + ' trades · ' + VJUI.pct(net.winRate) + ' win rate · ' + VJUI.money(net.netPnl)
      : 'No trades on this pair yet';

    $('#chartTrades').innerHTML = pairTrades.length
      ? pairTrades.slice(0, 20).map(tradeRowHtml).join('')
      : '<div class="empty" style="padding:26px 10px"><span class="empty-ic"><svg class="ic"><use href="#i-chart"/></svg></span>' +
        '<h3>Nothing on ' + esc(S.chartSymbol) + ' yet</h3><p>Log a trade on this pair and it will appear on the chart.</p></div>';

    $('#candleSourceNote').innerHTML =
      'Candles are a <b>deterministic illustrative price series</b> generated on-device — this app has no backend, so there is no live feed to pull. ' +
      'It is stable for a given symbol. Your entries, stops and targets drawn on top are your real trades.';
  }

  function groupTable(rows, label, winRateCol) {
    if (!rows.length) {
      return '<thead><tr><th>' + label + '</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Net P&L</th></tr></thead>' +
        '<tbody><tr><td colspan="4" style="color:var(--ink-4);padding:22px 10px;text-align:center">Nothing to show yet.</td></tr></tbody>';
    }
    return '<thead><tr><th>' + label + '</th><th class="num">Trades</th><th class="num">W / L</th><th class="num">Win rate</th>' +
      (winRateCol ? '' : '<th class="num">PF</th>') + '<th class="num">Avg R</th><th class="num">Net P&amp;L</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><b>' + esc(r.key) + '</b></td><td class="num">' + r.n + '</td>' +
          '<td class="num">' + r.wins + ' / ' + r.losses + '</td>' +
          '<td class="num">' + VJUI.pct(r.winRate) + '</td>' +
          (winRateCol ? '' : '<td class="num">' + (r.pf === Infinity ? '∞' : VJUI.num(r.pf, 2)) + '</td>') +
          '<td class="num">' + VJUI.rmult(r.avgR) + '</td>' +
          '<td class="num ' + VJUI.pnlClass(r.net) + '"><b>' + VJUI.money(r.net) + '</b></td></tr>';
      }).join('') + '</tbody>';
  }

  /* ══════════════════════ settings ══════════════════════ */

  function renderSettings() {
    syncSettingsUI();
    refreshStorage();
    renderCloudStatus();
  }

  function renderCloudStatus() {
    if (!window.VJCloud) return;
    var st = VJCloud.status();
    var title = $('#sideCloudTitle'), sub = $('#sideCloudSub');
    if (title && sub) {
      if (!st.configured) { title.textContent = 'Cloud backup'; sub.textContent = 'Not set up'; }
      else if (st.signedIn) {
        title.textContent = (st.user && st.user.name) || 'Signed in';
        sub.textContent = st.syncing ? 'Syncing…' :
          (st.pending ? st.pending + ' pending' : 'Synced ' + (st.lastSyncAt ? VJUI.fRel(st.lastSyncAt) : 'never'));
      } else { title.textContent = 'Cloud backup'; sub.textContent = 'Not signed in'; }
      var sc = title.closest('.side-cloud');
      if (sc) sc.classList.toggle('is-on', !!st.signedIn);
    }
    var btn = $('#setCloudBtn'), desc = $('#setCloudDesc'), status = $('#setSyncStatus');
    if (btn) btn.textContent = !st.configured ? 'Set up' : (st.signedIn ? 'Manage' : 'Sign in');
    if (desc) {
      desc.textContent = !st.configured
        ? 'Add your Supabase keys to js/config.js to enable Google Sign-In and sync.'
        : (st.signedIn
          ? 'Signed in as ' + ((st.user && st.user.email) || 'your account') + '. Your journal is mirrored to your Supabase project.'
          : 'Sign in to back up your journal to your own Supabase project and sync across devices.');
    }
    if (status) {
      status.textContent = !st.configured ? 'Cloud backup is not configured yet.'
        : (!st.signedIn ? 'Not signed in.'
          : (st.syncing ? 'Syncing…'
            : (st.error ? 'Error: ' + st.error
              : 'Up to date · ' + (st.pending ? st.pending + ' pending' : 'last synced ' + (st.lastSyncAt ? VJUI.fRel(st.lastSyncAt) : 'never')))));
    }
  }

  function doSyncNow() {
    if (!window.VJCloud) return;
    if (!VJCloud.isConfigured()) { VJUI.toast('Cloud backup is not configured', 'i-alert'); return; }
    if (!VJCloud.currentUser()) { VJCloudUI.open(); return; }
    VJUI.toast('Syncing…');
    VJCloud.syncNow().then(function () {
      VJUI.toast('Synced', 'i-check');
      renderAll();
    }).catch(function (e) {
      VJUI.toast('Sync failed: ' + e.message, 'i-alert');
    });
  }

  function refreshStorage() {
    Promise.all([VJDB.estimate(), VJDB.tradeCount()]).then(function (res) {
      var e = res[0], count = res[1];
      var pctUsed = e.quota ? Math.min(100, e.usage / e.quota * 100) : 0;
      var fill = $('#storageFill');
      if (fill) fill.style.width = Math.max(pctUsed, count ? 2 : 0) + '%';
      var txt = VJUI.bytes(e.usage) + ' used · ' + count + ' trade' + (count === 1 ? '' : 's');
      if ($('#storageText')) $('#storageText').textContent = txt;
      if ($('#storageAbout')) {
      var backend = VJDB.backend && VJDB.backend() === 'sqlite' ? ' · native SQLite' : '';
      $('#storageAbout').textContent = txt + backend + (e.quota ? ' of ' + VJUI.bytes(e.quota) + ' available to this site' : '');
    }
    });
  }

  /* ══════════════════════ trade form ══════════════════════ */

  var formState = { dir: 'buy', result: 'open', riskMode: 'amount' };

  function openForm(trade) {
    S.editingId = trade ? trade.id : null;
    S.pendingShot = null;
    S.shotRemoved = false;
    S.pnlTouched = false;
    formState.dir = trade ? trade.direction : 'buy';
    formState.result = trade ? trade.result : 'open';
    formState.riskMode = trade ? (trade.riskMode || 'amount') : 'amount';

    $('#tsTitle').textContent = trade ? 'Edit trade' : 'New trade';
    $('#deleteTrade').hidden = !trade;
    $('#f-dt').value = VJUI.toLocalInput(trade ? trade.dt : Date.now());
    var symPicker = document.querySelector('#symbolPicker');
    if (symPicker && symPicker.__setValue) symPicker.__setValue(trade ? (trade.symbol || '') : '');
    else $('#f-symbol').value = trade ? (trade.symbol || '') : '';
    $('#f-entry').value = trade && trade.entry != null ? trade.entry : '';
    $('#f-sl').value = trade && trade.sl != null ? trade.sl : '';
    $('#f-tp').value = trade && trade.tp != null ? trade.tp : '';
    $('#f-lots').value = trade && trade.lots != null ? trade.lots : '';
    $('#f-risk').value = trade && trade.risk != null ? trade.risk : '';
    $('#f-pnl').value = trade && trade.pnl != null ? trade.pnl : '';
    $('#f-strategy').value = trade ? (trade.strategy || '') : (S.settings.strategies[0] || '');
    $('#f-tags').value = trade && trade.tags ? trade.tags.join(', ') : '';
    $('#f-notes').value = trade ? (trade.notes || '') : '';

    syncSegments();
    updateRiskUI();
    updateRatio();
    clearShotUI();

    if (trade && trade.shotId) {
      VJDB.getShot(trade.shotId).then(function (rec) {
        if (rec && rec.blob) showShot(URL.createObjectURL(rec.blob));
      });
    }

    openSheet($('#tradeSheet'));
    setTimeout(function () { (trade ? $('#f-notes') : $('#f-symbol')).focus({ preventScroll: true }); }, 380);
  }

  function syncSegments() {
    $$('#f-dir .seg-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.val === formState.dir); });
    $$('#f-result .seg-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.val === formState.result); });
    $$('#f-riskmode .seg-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.val === formState.riskMode); });
  }

  function updateRiskUI() {
    var pctMode = formState.riskMode === 'percent';
    $('#riskPrefix').textContent = pctMode ? '' : S.settings.currency;
    $('#f-risk-label').textContent = pctMode ? 'Risk %' : 'Risk amount';
    $('#riskHelp').textContent = pctMode
      ? 'Percent of your ' + VJUI.bal(S.settings.balance, 0) + ' starting balance.'
      : 'Money you stand to lose if stopped out.';
    $('#pnlPrefix').textContent = S.settings.currency;
  }

  function currentRisk() {
    var v = parseFloat($('#f-risk').value);
    if (!isFinite(v) || v <= 0) return 0;
    return formState.riskMode === 'percent' ? (v / 100) * S.settings.balance : v;
  }

  function updateRatio() {
    var entry = parseFloat($('#f-entry').value);
    var sl = parseFloat($('#f-sl').value);
    var tp = parseFloat($('#f-tp').value);
    var sym = $('#f-symbol').value;

    var rr = null, pipsRisk = null, pipsRew = null;
    if (isFinite(entry) && isFinite(sl) && isFinite(tp)) {
      var r = Math.abs(entry - sl);
      rr = r > 0 ? Math.abs(tp - entry) / r : null;
    }
    if (isFinite(entry) && isFinite(sl)) pipsRisk = VJStats.distInPips(entry, sl, sym);
    if (isFinite(entry) && isFinite(tp)) pipsRew = VJStats.distInPips(entry, tp, sym);

    $('#calcRR').textContent = rr ? VJUI.num(rr, 2) + 'R' : '—';
    $('#calcPips').textContent = pipsRisk != null ? VJUI.num(pipsRisk, 1) + ' pips' : '—';
    $('#calcPips2').textContent = pipsRew != null ? VJUI.num(pipsRew, 1) + ' pips' : '—';
    $('#calcRR').className = rr ? VJUI.pnlClass(rr - 1) : '';
  }

  /** Sensible P&L defaults when you mark a trade win/loss without typing a number. */
  function autoPnl() {
    if (S.pnlTouched) return;
    var risk = currentRisk();
    if (!risk) { $('#f-pnl').value = ''; return; }
    var rr = VJStats.plannedRR({
      entry: parseFloat($('#f-entry').value),
      sl: parseFloat($('#f-sl').value),
      tp: parseFloat($('#f-tp').value)
    });
    var mult = rr && isFinite(rr) ? rr : 1;
    var v = formState.result === 'win' ? risk * mult
          : formState.result === 'loss' ? -risk
          : formState.result === 'be' ? 0 : '';
    $('#f-pnl').value = v === '' ? '' : Math.round(v * 100) / 100;
    $('#pnlHelp').textContent = formState.result === 'open'
      ? 'Leave blank while the trade is open.'
      : 'Auto-filled from risk × R:R — edit if it differs.';
  }

  function readForm() {
    var entry = parseFloat($('#f-entry').value);
    var sl = parseFloat($('#f-sl').value);
    var tp = parseFloat($('#f-tp').value);
    var riskRaw = parseFloat($('#f-risk').value);
    var pnl = parseFloat($('#f-pnl').value);
    var lots = parseFloat($('#f-lots').value);
    var symbol = $('#f-symbol').value.trim().toUpperCase();
    var strategy = $('#f-strategy').value.trim();
    var tags = $('#f-tags').value.split(',').map(function (g) { return g.trim().toLowerCase(); }).filter(Boolean);

    return {
      id: S.editingId || VJUI.uid(),
      dt: new Date($('#f-dt').value).getTime(),
      symbol: symbol,
      direction: formState.dir,
      entry: isFinite(entry) ? entry : null,
      sl: isFinite(sl) ? sl : null,
      tp: isFinite(tp) ? tp : null,
      lots: isFinite(lots) ? lots : null,
      riskMode: formState.riskMode,
      risk: isFinite(riskRaw) ? riskRaw : null,
      riskAmount: formState.riskMode === 'amount' && isFinite(riskRaw) ? riskRaw : (isFinite(riskRaw) ? (riskRaw / 100) * S.settings.balance : null),
      plannedRR: (isFinite(entry) && isFinite(sl) && isFinite(tp) && Math.abs(entry - sl) > 0)
        ? Math.abs(tp - entry) / Math.abs(entry - sl) : null,
      strategy: strategy,
      result: formState.result,
      pnl: isFinite(pnl) ? pnl : null,
      notes: $('#f-notes').value.trim(),
      tags: Array.from(new Set(tags)),
      createdAt: S.editingId ? (findTrade(S.editingId) || {}).createdAt || Date.now() : Date.now(),
      updatedAt: Date.now()
    };
  }

  function findTrade(id) { return S.trades.filter(function (t) { return t.id === id; })[0]; }

  function saveForm() {
    var symbol = $('#f-symbol').value.trim();
    var dtRaw = $('#f-dt').value;
    if (!symbol) { $('#f-symbol').focus(); VJUI.toast('Add a pair or symbol', 'i-alert'); return; }
    if (!dtRaw) { $('#f-dt').focus(); VJUI.toast('Pick a date and time', 'i-alert'); return; }
    if (!$('#f-entry').value) { $('#f-entry').focus(); VJUI.toast('Add your entry price', 'i-alert'); return; }

    var t = readForm();
    if (!isFinite(t.dt)) t.dt = Date.now();

    // remember custom strategies
    if (t.strategy && S.settings.strategies.indexOf(t.strategy) === -1) {
      S.settings.strategies.push(t.strategy);
      saveSettings();
      syncSettingsUI();
    }

    var after = function () {
      // tell the cloud layer this trade changed locally
      if (window.VJCloud) window.VJCloud.markDirty(t.id);
      S.trades = S.editingId
        ? S.trades.map(function (x) { return x.id === t.id ? t : x; })
        : [t].concat(S.trades);
      S.trades.sort(function (a, b) { return b.dt - a.dt; });
      renderAll();
      closeSheet();
      if (window.VJNative) window.VJNative.haptic('success');
      VJUI.toast(S.editingId ? 'Trade updated' : 'Trade logged', 'i-check');
    };

    // NOTE: the trade row must always be written — writing only the screenshot
    // would leave the trade in memory and lose it on reload.
    if (S.pendingShot) {
      t.shotId = t.id;
      VJDB.putShot(t.id, S.pendingShot)
        .then(function () { return VJDB.putTrade(t); })
        .then(after)
        .catch(function () {
          delete t.shotId;
          return VJDB.putTrade(t).then(after);
        });
    } else if (S.shotRemoved) {
      t.shotId = null;
      VJDB.deleteShot(t.id).then(function () { return VJDB.putTrade(t); }).then(after);
    } else {
      VJDB.putTrade(t).then(after).catch(function () {
        VJUI.toast('Could not save that trade', 'i-alert');
      });
    }
  }

  function deleteCurrent() {
    var id = S.editingId;
    if (!id) return;
    VJUI.confirm({
      title: 'Delete this trade?',
      body: 'It and its screenshot will be removed from your journal. This cannot be undone.',
      okLabel: 'Delete'
    }).then(function (ok) {
      if (!ok) return;
      VJDB.deleteTrade(id).then(function () {
        if (window.VJCloud) window.VJCloud.markDeleted(id);
        S.trades = S.trades.filter(function (t) { return t.id !== id; });
        closeSheet();
        renderAll();
        VJUI.toast('Trade deleted');
      });
    });
  }

  /* ---------------- screenshot ---------------- */

  function showShot(url) {
    $('#shotImg').src = url;
    $('#shotPreview').hidden = false;
    $('#shotDrop').style.display = 'none';
  }
  function clearShotUI() {
    $('#shotPreview').hidden = true;
    $('#shotDrop').style.display = '';
    $('#shotLabel').textContent = 'Add chart screenshot';
    $('#shotImg').removeAttribute('src');
  }

  function onShotPick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { VJUI.toast('That file is not an image', 'i-alert'); return; }
    if (file.size > 12 * 1024 * 1024) { VJUI.toast('Image is too large (max 12 MB)', 'i-alert'); return; }
    VJUI.compressImage(file, 1400, 0.82).then(function (blob) {
      S.pendingShot = blob;
      S.shotRemoved = false;
      showShot(URL.createObjectURL(blob));
      VJUI.toast('Screenshot attached');
    }).catch(function () { VJUI.toast('Could not read that image', 'i-alert'); });
  }

  /* ══════════════════════ detail sheet ══════════════════════ */

  var detailId = null;

  function openDetail(id) {
    var t = findTrade(id);
    if (!t) return;
    detailId = id;
    var b = S.settings.balance;
    var rr = VJStats.plannedRR(t);
    var real = VJStats.realizedR(t, b);
    var risk = VJStats.riskAmount(t, b);
    var p = VJStats.pnlOf(t);

    $('#detailBody').innerHTML =
      '<div class="det-hero">' +
        '<div class="det-mark">' + VJUI.shortSym(t.symbol) + '</div>' +
        '<div class="det-id"><div class="det-sym">' + esc(t.symbol || '—') + '</div>' +
        '<div class="det-sub"><span class="side-chip side-' + (t.direction === 'sell' ? 'sell' : 'buy') + '">' +
        (t.direction === 'sell' ? 'SELL' : 'BUY') + '</span> &nbsp; ' + VJUI.resultBadge(t.result) + '</div></div>' +
        '<div class="det-pnl"><b class="' + VJUI.pnlClass(t.result === 'open' ? null : p) + '">' +
        (t.result === 'open' ? '—' : VJUI.money(p)) + '</b><span>' + (real != null ? VJUI.rmult(real) : (rr ? 'planned ' + VJUI.ratio(rr) : '')) + '</span></div>' +
      '</div>' +
      '<div class="det-sec-t">Execution</div>' +
      '<div class="det-grid">' +
        cell('Date', VJUI.fDateFull(t.dt)) +
        cell('Time', VJUI.fTime(t.dt)) +
        cell('Entry', t.entry != null ? VJUI.num(t.entry, t.entry > 100 ? 2 : 5) : '—', true) +
        cell('Stop loss', t.sl != null ? VJUI.num(t.sl, t.sl > 100 ? 2 : 5) : '—', true) +
        cell('Take profit', t.tp != null ? VJUI.num(t.tp, t.tp > 100 ? 2 : 5) : '—', true) +
        cell('Lot size', t.lots != null ? VJUI.num(t.lots, 2) : '—') +
        cell('Risk', risk ? VJUI.bal(risk) : '—') +
        cell('Planned R:R', rr ? VJUI.num(rr, 2) + 'R' : '—') +
      '</div>' +
      (t.strategy || (t.tags || []).length
        ? '<div class="det-sec-t">Context</div><div class="det-grid">' +
          cell('Strategy', t.strategy || '—') +
          cell('Tags', (t.tags || []).length ? t.tags.map(function (g) { return '#' + g; }).join(' ') : '—') +
        '</div>' : '') +
      (t.notes ? '<div class="det-sec-t">Notes</div><div class="det-notes">' + esc(t.notes) + '</div>' : '') +
      '<div class="det-sec-t">Price action</div>' +
      '<div class="candle-box candle-box-mini"><canvas id="detCandle"></canvas></div>' +
      (t.shotId ? '<div class="det-sec-t">Screenshot</div><img class="det-shot" id="detShot" alt="Trade screenshot" />' : '');

    openSheet($('#detailSheet'));

    VJCandles.mount($('#detCandle'), {
      symbol: t.symbol, trades: [t], dp: VJInstr.decimals(t.symbol),
      showLevels: true, count: 60
    });

    if (t.shotId) {
      VJDB.getShot(t.shotId).then(function (rec) {
        if (rec && rec.blob && detailId === id) {
          var img = $('#detShot');
          if (img) img.src = URL.createObjectURL(rec.blob);
        }
      });
    }
  }

  function cell(label, value, mono) {
    return '<div class="det-cell"><span>' + esc(label) + '</span><b' + (mono ? ' class="mono"' : '') + '>' + esc(value) + '</b></div>';
  }

  /* ══════════════════════ sheet plumbing ══════════════════════ */

  var openSheets = [];

  function openSheet(el) {
    $('#scrim').hidden = false;
    el.hidden = false;
    el.classList.remove('closing');
    openSheets.push(el);
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    var el = openSheets.pop();
    if (!el) return;
    el.classList.add('closing');
    setTimeout(function () {
      el.hidden = true;
      el.classList.remove('closing');
      if (!openSheets.length) {
        $('#scrim').hidden = true;
        document.body.style.overflow = '';
      }
    }, 200);
  }

  function closeTopSheet() {
    if (!openSheets.length) return false;
    closeSheet();
    return true;
  }

  /* ══════════════════════ import / export ══════════════════════ */

  function exportJSON() {
    VJUI.toast('Preparing backup…');
    Promise.all([VJDB.allShots()]).then(function (res) {
      var shots = {};
      return Promise.all(res[0].map(function (s) {
        return VJUI.blobToDataURL(s.blob).then(function (d) { shots[s.id] = d; });
      })).then(function () {
        var payload = {
          app: 'VibeJournal',
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: S.settings,
          trades: S.trades,
          screenshots: shots
        };
        VJUI.download('vibejournal-backup-' + VJUI.isoDate(Date.now()) + '.json',
          JSON.stringify(payload, null, 2), 'application/json');
        VJUI.toast('Backup downloaded', 'i-check');
      });
    }).catch(function () { VJUI.toast('Export failed', 'i-alert'); });
  }

  function exportCSV() {
    var head = ['Date', 'Time', 'Symbol', 'Direction', 'Entry', 'StopLoss', 'TakeProfit', 'Lots',
      'RiskMode', 'Risk', 'RiskAmount', 'PlannedRR', 'RealizedR', 'Strategy', 'Result', 'PnL',
      'WinRateContext', 'Tags', 'Notes'];
    var rows = [head].concat(S.trades.slice().sort(function (a, b) { return a.dt - b.dt; }).map(function (t) {
      var d = new Date(t.dt);
      return [
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        VJUI.fTime(t.dt),
        t.symbol, t.direction,
        t.entry == null ? '' : t.entry,
        t.sl == null ? '' : t.sl,
        t.tp == null ? '' : t.tp,
        t.lots == null ? '' : t.lots,
        t.riskMode || 'amount',
        t.risk == null ? '' : t.risk,
        VJStats.riskAmount(t, S.settings.balance) || '',
        t.plannedRR == null ? '' : t.plannedRR.toFixed(3),
        (function () { var r = VJStats.realizedR(t, S.settings.balance); return r == null ? '' : r.toFixed(3); })(),
        t.strategy || '', t.result,
        t.pnl == null ? '' : t.pnl,
        S.settings.balance ? (VJStats.pnlOf(t) / S.settings.balance).toFixed(4) : '',
        (t.tags || []).join(' '), t.notes || ''
      ];
    }));
    VJUI.download('vibejournal-trades-' + VJUI.isoDate(Date.now()) + '.csv',
      '﻿' + VJUI.toCSV(rows), 'text/csv;charset=utf-8');
    VJUI.toast('CSV downloaded', 'i-check');
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (e) { VJUI.toast('That file is not valid JSON', 'i-alert'); return; }

      var trades = Array.isArray(data) ? data : data.trades;
      if (!Array.isArray(trades)) { VJUI.toast('No trades found in that file', 'i-alert'); return; }

      var valid = trades.filter(function (t) { return t && t.id && t.dt; });
      if (!valid.length) { VJUI.toast('No valid trades in that file', 'i-alert'); return; }

      VJUI.confirm({
        title: 'Import ' + valid.length + ' trade' + (valid.length === 1 ? '' : 's') + '?',
        body: 'This replaces everything currently in your journal.',
        okLabel: 'Replace & import'
      }).then(function (ok) {
        if (!ok) return;
        VJUI.toast('Importing…');
        var shots = (data && data.screenshots) || {};
        VJDB.clearAll().then(function () {
          if (data.settings) {
            S.settings = Object.assign({}, S.settings, data.settings);
            S.settings.strategies = (S.settings.strategies || DEFAULT_STRATEGIES).slice();
            applyTheme();
            saveSettings();
            syncSettingsUI();
          }
          var keys = Object.keys(shots);
          return Promise.all(keys.map(function (k) {
            var blob = VJUI.dataURLToBlob(shots[k]);
            var copy = null;
            valid.forEach(function (t) { if (t.id === k) copy = t; });
            if (copy) copy.shotId = k;
            return VJDB.putShot(k, blob);
          }));
        }).then(function () {
          return VJDB.bulkPutTrades(valid);
        }).then(function () {
          return VJDB.allTrades();
        }).then(function (rows) {
          S.trades = rows;
          syncSettingsUI();
          renderAll();
          VJUI.toast('Imported ' + valid.length + ' trades', 'i-check');
        }).catch(function (e) {
          VJUI.toast('Import failed: ' + e.message, 'i-alert');
        });
      });
    };
    reader.onerror = function () { VJUI.toast('Could not read that file', 'i-alert'); };
    reader.readAsText(file);
  }

  function clearEverything() {
    VJUI.confirm({
      title: 'Erase everything?',
      body: 'Every trade, screenshot and setting will be permanently deleted from this device.',
      okLabel: 'Erase everything'
    }).then(function (ok) {
      if (!ok) return;
      VJDB.clearAll().then(function () {
        if (window.VJCloud) {
          window.VJCloud.markDeleted = window.VJCloud.markDeleted || function () {};
          window.VJCloud.state.pending = 0;
        }
        S.trades = [];
        S.settings = {
          balance: 10000, currency: '$', theme: 'dark',
          colorPnl: true, reduceMotion: false, strategies: DEFAULT_STRATEGIES.slice()
        };
        S.filters = { from: '', to: '', pair: '', strategy: '', result: '', direction: '', tags: [] };
        S.query = ''; $('#q').value = '';
        return saveSettings();
      }).then(function () {
        applyTheme();
        syncSettingsUI();
        renderAll();
        VJUI.toast('All data cleared');
      });
    });
  }

  /* ══════════════════════ sample data ══════════════════════ */

  function loadSample() {
    VJUI.confirm({
      title: 'Load sample data?',
      body: 'Adds 40 example trades to your journal so you can explore the charts and stats. You can remove them later.',
      okLabel: 'Load samples'
    }).then(function (ok) {
      if (!ok) return;
      var rows = buildSampleTrades();
      VJDB.bulkPutTrades(rows).then(function () {
        return VJDB.allTrades();
      }).then(function (all) {
        S.trades = all;
        renderAll();
        VJUI.toast('Loaded ' + rows.length + ' sample trades', 'i-check');
        go('dashboard');
      });
    });
  }

  function buildSampleTrades() {
    // deterministic, well-distributed PRNG (mulberry32) so the sample looks
    // identical every time without relying on float precision
    var seed = 20261017 >>> 0;
    function rnd() {
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    function between(a, b) { return a + rnd() * (b - a); }

    var syms = [
      { s: 'EURUSD', base: 1.0850, pip: 0.0001, rr: 2.2, wr: 0.56 },
      { s: 'GBPUSD', base: 1.2720, pip: 0.0001, rr: 2.0, wr: 0.52 },
      { s: 'XAUUSD', base: 2385.0, pip: 0.1,     rr: 2.6, wr: 0.48 },
      { s: 'USDJPY', base: 149.20, pip: 0.01,   rr: 1.8, wr: 0.60 },
      { s: 'US30',   base: 39250,  pip: 1,      rr: 3.0, wr: 0.45 }
    ];
    var strats = ['Liquidity Sweep', 'Fibonacci', 'Breakout', 'Trend Continuation', 'Order Block'];
    var tagPool = ['asia', 'london', 'ny', 'fvg', 'ob', 'a+ setup', 'news', 'weekend'];
    var out = [];
    var now = Date.now();

    for (var i = 0; i < 40; i++) {
      var cfg = pick(syms);
      var daysAgo = Math.floor(Math.pow(i / 40, 1.25) * 96);
      var dt = now - daysAgo * 864e5 - Math.floor(between(0, 20)) * 36e5;
      var dir = rnd() > 0.47 ? 'buy' : 'sell';
      var dist = between(1.4, 3.6) * cfg.pip * (cfg.base > 1000 ? 1 : 1);
      var entry = cfg.base + between(-0.004, 0.004) * (cfg.base > 1000 ? 40 : 1);
      var sl = dir === 'buy' ? entry - dist : entry + dist;
      var rr = between(Math.max(1.2, cfg.rr - 0.7), cfg.rr + 0.9);
      var tp = dir === 'buy' ? entry + dist * rr : entry - dist * rr;
      var riskPct = Math.round(between(0.6, 2.0) * 100) / 100;   // stored as a % of balance
      var riskUsd = riskPct / 100 * S.settings.balance;          // …so P&L must scale off the dollars
      var won = rnd() < cfg.wr;

      var result, pnl;
      if (i >= 38) { result = 'open'; pnl = null; }
      else if (rnd() < 0.05) { result = 'be'; pnl = 0; }
      else if (won) {
        result = 'win';
        var frac = between(0.45, 1.25);
        pnl = Math.round(riskUsd * rr * frac * 100) / 100;
      } else {
        result = 'loss';
        pnl = -Math.round(riskUsd * between(0.82, 1.06) * 100) / 100;
      }

      var nTags = Math.floor(rnd() * 3);
      var tags = [];
      for (var k = 0; k < nTags; k++) { var tg = pick(tagPool); if (tags.indexOf(tg) === -1) tags.push(tg); }

      out.push({
        id: VJUI.uid(),
        dt: dt,
        symbol: cfg.s,
        direction: dir,
        entry: Math.round(entry * 100000) / 100000,
        sl: Math.round(sl * 100000) / 100000,
        tp: Math.round(tp * 100000) / 100000,
        lots: Math.round(between(0.1, 1.5) * 100) / 100,
        riskMode: 'percent',
        risk: riskPct,
        riskAmount: Math.round(riskUsd * 100) / 100,
        plannedRR: Math.round(rr * 100) / 100,
        strategy: pick(strats),
        result: result,
        pnl: pnl,
        notes: result === 'open' ? 'Still managing — watching for liquidity grab above.'
          : won ? 'Entry on the sweep, TP filled into the session high.'
          : 'Chased the entry after the impulse. Waited too long for the retrace.',
        tags: tags,
        createdAt: dt, updatedAt: dt
      });
    }
    return out;
  }

  /* ══════════════════════ gestures ══════════════════════ */

  function initGestures() {
    // drag a sheet down to dismiss
    ['#tradeSheet', '#detailSheet'].forEach(function (sel) {
      var el = $(sel);
      var startY = 0, dy = 0, dragging = false, handle;
      var grab = el.querySelector('.sheet-grab');
      var head = el.querySelector('.sheet-head');

      function down(e) {
        if (window.innerWidth >= 620) return;
        handle = e.target.closest('.sheet-grab, .sheet-head');
        if (!handle || e.target.closest('button, input, .icon-btn')) return;
        startY = (e.touches ? e.touches[0].clientY : e.clientY);
        dy = 0; dragging = true;
        el.style.transition = 'none';
      }
      function move(e) {
        if (!dragging) return;
        dy = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
        if (dy < 0) dy = 0;
        el.style.transform = 'translateY(' + dy + 'px)';
        if (e.cancelable) e.preventDefault();
      }
      function up() {
        if (!dragging) return;
        dragging = false;
        el.style.transition = '';
        el.style.transform = '';
        if (dy > 110) closeSheet();
      }
      [grab, head].forEach(function (h) {
        if (!h) return;
        h.addEventListener('touchstart', down, { passive: true });
        h.addEventListener('mousedown', down);
      });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', up);
      window.addEventListener('mouseup', up);
    });

    // swipe from the left edge to go back a view
    var order = ['dashboard', 'journal', 'analytics', 'settings'];
    var hintShown = false;
    var sx = 0, sy = 0, active = false;
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      if (t.clientX > 22 || openSheets.length) { active = false; return; }
      sx = t.clientX; sy = t.clientY; active = true;
      if (!hintShown) {
        hintShown = true;
        var hint = $('#edgeHint');
        hint.hidden = false;
        setTimeout(function () { hint.hidden = true; }, 2600);
      }
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!active) return;
      active = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
      if (dx < 70 || dy > 60) return;
      var i = order.indexOf(S.view);
      if (i > 0) go(order[i - 1]);
    }, { passive: true });
  }

  /* ══════════════════════ wiring ══════════════════════ */

  function initEvents() {
    // nav
    VJUI.on(document, 'click', '[data-nav]', function () { go(this.dataset.nav); });
    VJUI.on(document, 'click', '[data-goto]', function () { go(this.dataset.goto); });

    // global actions
    VJUI.on(document, 'click', '[data-action]', function () {
      var a = this.dataset.action;
      if (a === 'new-trade') openForm(null);
      else if (a === 'load-sample') loadSample();
      else if (a === 'export-json') exportJSON();
      else if (a === 'export-csv') exportCSV();
      else if (a === 'import') $('#importFile').click();
      else if (a === 'clear-all') clearEverything();
      else if (a === 'install') doInstall();
      else if (a === 'open-search') { go('journal'); setTimeout(function () { $('#q').focus(); }, 120); }
      else if (a === 'open-cloud') { VJCloudUI.open(); }
      else if (a === 'sync-now') { doSyncNow(); }
    });

    VJUI.on(document, 'click', '[data-close]', function () { closeSheet(); });
    $('#scrim').addEventListener('click', function () { closeSheet(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openSheets.length) closeSheet();
      if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); go('journal'); $('#q').focus(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openForm(null); }
    });

    // open a trade from a row
    VJUI.on(document, 'click', '[data-open]', function (e, t) {
      if (e.target.closest('[data-del]')) return;
      if (S.view === 'journal') {
        var id = this.dataset.open;
        if (e.target.closest('[data-edit]')) { openForm(findTrade(id)); return; }
        openDetail(id);
      } else {
        openDetail(this.dataset.open);
      }
    });
    VJUI.on(document, 'click', '[data-edit]', function (e) {
      e.stopPropagation();
      openForm(findTrade(this.dataset.edit));
    });
    VJUI.on(document, 'click', '[data-del]', function (e) {
      e.stopPropagation();
      var id = this.dataset.del;
      var t = findTrade(id);
      VJUI.confirm({
        title: 'Delete this ' + (t ? t.symbol : '') + ' trade?',
        body: 'It will be permanently removed from your journal.',
        okLabel: 'Delete'
      }).then(function (ok) {
        if (!ok) return;
        VJDB.deleteTrade(id).then(function () {
          if (window.VJCloud) window.VJCloud.markDeleted(id);
          S.trades = S.trades.filter(function (x) { return x.id !== id; });
          renderAll();
          VJUI.toast('Trade deleted');
        });
      });
    });
    $('#detailEdit').addEventListener('click', function () {
      var id = detailId;
      closeSheet();
      setTimeout(function () { openForm(findTrade(id)); }, 240);
    });

    // dashboard range
    VJUI.on(document, 'click', '.range-pill', function () {
      S.range = +this.dataset.range;
      renderDashboard();
    });
    VJUI.on(document, 'click', '.stat-card[data-goto]', function () { go(this.dataset.goto); });

    // journal
    var qTimer;
    $('#q').addEventListener('input', function () {
      clearTimeout(qTimer);
      var v = this.value;
      qTimer = setTimeout(function () { S.query = v.trim(); S.rowCap = 150; renderJournal(); }, 180);
    });
    $('#filterBtn').addEventListener('click', function () {
      var p = $('#filterPanel');
      p.hidden = !p.hidden;
      this.classList.toggle('is-active', !p.hidden);
    });
    $('#sortBtn').addEventListener('click', function () {
      var presets = Object.keys(SORT_PRESETS);
      var i = presets.indexOf(S.sort.key + ':' + S.sort.dir);
      var next = presets[(i + 1) % presets.length];
      var parts = next.split(':');
      S.sort = { key: parts[0], dir: parts[1] };
      $('#sortLabel').textContent = SORT_PRESETS[next];
      S.rowCap = 150;
      renderJournal();
    });
    $('#sortLabel').textContent = SORT_PRESETS['dt:desc'];

    VJUI.on($('#tradeTable'), 'click', 'th.sortable', function () {
      var k = this.dataset.sort;
      S.sort = { key: k, dir: S.sort.key === k && S.sort.dir === 'desc' ? 'asc' : 'desc' };
      var p = S.sort.key + ':' + S.sort.dir;
      $('#sortLabel').textContent = SORT_PRESETS[p] || 'Sorted';
      S.rowCap = 150;
      renderJournal();
    });

    ['#fFrom:from', '#fTo:to', '#fPair:pair', '#fStrat:strategy', '#fResult:result', '#fDir:direction'].forEach(function (pair) {
      var parts = pair.split(':');
      $(parts[0]).addEventListener('change', function () { S.filters[parts[1]] = this.value; });
    });
    $('#applyFilters').addEventListener('click', function () {
      renderJournal();
      VJUI.toast('Filters applied', 'i-check');
    });
    $('#clearFilters').addEventListener('click', function () {
      S.filters = { from: '', to: '', pair: '', strategy: '', result: '', direction: '', tags: [] };
      S.query = ''; $('#q').value = '';
      ['#fFrom', '#fTo', '#fPair', '#fStrat', '#fResult', '#fDir'].forEach(function (s) { $(s).value = ''; });
      renderJournal();
    });
    VJUI.on($('#fTags'), 'click', '[data-tag]', function () {
      var tag = this.dataset.tag;
      var i = S.filters.tags.indexOf(tag);
      if (i > -1) S.filters.tags.splice(i, 1); else S.filters.tags.push(tag);
      this.classList.toggle('is-on');
      renderJournal();
    });
    VJUI.on($('#resultCount'), 'click', '[data-more]', function () {
      S.rowCap += 200;
      renderJournal();
    });
    VJUI.on($('#activeChips'), 'click', '[data-drop]', function () {
      var key = this.dataset.drop;
      if (key.indexOf('tag:') === 0) {
        var tag = key.slice(4);
            S.filters.tags = S.filters.tags.filter(function (t) { return t !== tag; });
        S.rowCap = 150;
      } else {
        S.filters[key] = '';
        var map = { from: '#fFrom', to: '#fTo', pair: '#fPair', strategy: '#fStrat', result: '#fResult', direction: '#fDir' };
        if (map[key]) $(map[key]).value = '';
      }
      renderJournal();
    });

    // analytics tabs
    VJUI.on($('.seg-bar'), 'click', '.seg', function () {
      S.tab = this.dataset.tab;
      renderAnalytics();
    });

    // chart tab symbol
    var chartSym = $('#chartSymbol');
    if (chartSym) {
      chartSym.addEventListener('change', function () {
        var v = this.value.trim().toUpperCase();
        if (v) { S.chartSymbol = v; renderChartTab(); }
      });
      chartSym.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var v = this.value.trim().toUpperCase();
          if (v) { S.chartSymbol = v; this.blur(); renderChartTab(); }
        }
      });
    }
    VJUI.on($('#timeGran'), 'click', 'button', function () {
      S.timeGran = this.dataset.gran;
      renderAnalytics();
    });

    // settings
    $('#setBalance').addEventListener('change', function () {
      var v = parseFloat(this.value);
      S.settings.balance = isFinite(v) && v >= 0 ? v : 0;
      this.value = S.settings.balance;
      saveSettings().then(function () { C.invalidate(); renderAll(); VJUI.toast('Starting balance updated', 'i-check'); });
    });
    $('#setCurrency').addEventListener('change', function () {
      S.settings.currency = this.value;
      saveSettings().then(function () { applyTheme(); renderAll(false); syncSettingsUI(); });
    });
    VJUI.on($('#themeSeg'), 'click', 'button', function () {
      S.settings.theme = this.dataset.themeVal;
      applyTheme(); saveSettings(); syncSettingsUI();
      if (window.VJNative) window.VJNative.setStatusBar(S.settings.theme);
      setTimeout(function () { C.invalidate(); renderAll(); }, 20);
    });
    $('#themeBtn').addEventListener('click', function () {
      S.settings.theme = S.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme(); saveSettings(); syncSettingsUI();
      if (window.VJNative) window.VJNative.setStatusBar(S.settings.theme);
      setTimeout(function () { C.invalidate(); renderAll(); }, 20);
    });
    $('#setColorPnl').addEventListener('change', function () {
      S.settings.colorPnl = this.checked;
      applyTheme(); saveSettings();
      setTimeout(function () { C.invalidate(); renderAll(); }, 20);
    });
    $('#setMotion').addEventListener('change', function () {
      S.settings.reduceMotion = this.checked;
      applyTheme(); saveSettings();
    });
    $('#importFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importJSON(this.files[0]);
      this.value = '';
    });

    // form
    VJUI.on($('#f-dir'), 'click', '.seg-btn', function () { formState.dir = this.dataset.val; syncSegments(); });
    VJUI.on($('#f-result'), 'click', '.seg-btn', function () {
      formState.result = this.dataset.val;
      syncSegments();
      autoPnl();
    });
    VJUI.on($('#f-riskmode'), 'click', '.seg-btn', function () {
      var prev = currentRisk();
      formState.riskMode = this.dataset.val;
      syncSegments(); updateRiskUI();
      if (prev && isFinite(prev) && prev > 0) {
        $('#f-risk').value = formState.riskMode === 'percent'
          ? Math.round(prev / S.settings.balance * 10000) / 100
          : Math.round(prev * 100) / 100;
      }
      autoPnl();
    });
    ['#f-entry', '#f-sl', '#f-tp'].forEach(function (s) {
      $(s).addEventListener('input', function () { updateRatio(); autoPnl(); });
    });
    $('#f-risk').addEventListener('input', autoPnl);
    $('#f-pnl').addEventListener('input', function () { S.pnlTouched = true; });
    $('#saveTrade').addEventListener('click', saveForm);
    $('#deleteTrade').addEventListener('click', deleteCurrent);
    $('#tradeForm').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); saveForm(); }
    });
    $('#shotDrop').addEventListener('click', function (e) { e.preventDefault(); $('#shotInput').click(); });
    $('#shotInput').addEventListener('change', function () {
      if (this.files && this.files[0]) onShotPick(this.files[0]);
      this.value = '';
    });
    $('#shotRemove').addEventListener('click', function () {
      S.pendingShot = null; S.shotRemoved = true;
      clearShotUI();
    });

    // install prompt
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      S.deferredInstall = e;
      $('#installBtn').hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      S.deferredInstall = null;
      $('#installBtn').hidden = true;
      VJUI.toast('VibeJournal installed', 'i-check');
    });
  }

  /* ══════════════════════ native shell ══════════════════════ */

  function initNative() {
    if (!window.VJNative || !window.VJNative.isNative) return;

    // status bar follows the theme
    window.VJNative.setStatusBar(S.settings.theme);

    // let the app draw under the status bar, then reserve room for it
    document.documentElement.classList.add('is-native');
    window.VJNative.statusBarHeight().then(function (h) {
      if (h) document.documentElement.style.setProperty('--native-status-h', h + 'px');
    });

    // hide the splash once the first paint is done
    setTimeout(function () { window.VJNative.hideSplash(); }, 120);

    // Android hardware back: close a sheet first, then step back a view
    var order = ['dashboard', 'journal', 'analytics', 'settings'];
    window.VJNative.onBack(function () {
      if (VJPicker && VJPicker.close && VJPicker.isOpen && VJPicker.isOpen()) return true;
      if (openSheets.length) { closeSheet(); return true; }
      if (S.view !== 'dashboard') { go(order[order.indexOf(S.view) - 1]); return true; }
      return false;
    });
  }

  /* ══════════════════════ cloud ══════════════════════ */

  function initCloud() {
    if (!window.VJCloud) return;

    VJCloud.onAuthChange(function () {
      renderCloudStatus();
      if (VJCloudUI) VJCloudUI.render();
    });

    VJCloud.init(VJDB).then(function () {
      renderCloudStatus();
      VJCloud.startAutoSync();
    });

    // Android: the OAuth callback comes back as a deep link
    if (window.VJNative && window.VJNative.plugins && window.VJNative.plugins.App) {
      window.VJNative.plugins.App.addListener('appUrlOpen', function (data) {
        if (!data || !data.url) return;
        VJCloud.handleDeepLink(data.url).then(function (handled) {
          if (handled) {
            VJUI.toast('Signed in', 'i-check');
            renderCloudStatus();
            if (VJCloudUI) VJCloudUI.render();
            // close the auth browser if it is open
            var b = window.VJNative.plugins.Browser;
            if (b) { try { b.close(); } catch (e) {} }
          }
        });
      });
    }
  }

  function doInstall() {
    if (!S.deferredInstall) {
      VJUI.toast('Use your browser menu → “Install app” or “Add to Home Screen”');
      return;
    }
    S.deferredInstall.prompt();
    S.deferredInstall.userChoice.then(function (r) {
      if (r.outcome === 'accepted') $('#installBtn').hidden = true;
      S.deferredInstall = null;
    });
  }

  /* ══════════════════════ boot ══════════════════════ */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    // in the native app the assets ship inside the APK — a caching service
    // worker only serves to make updates confusing
    if (window.VJNative && window.VJNative.isNative) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline caching unavailable */ });
    });
  }

  function boot() {
    VJDB.requestPersistent();

    VJDB.getMeta('settings').then(function (saved) {
      if (saved) S.settings = Object.assign(S.settings, saved);
      if (!Array.isArray(S.settings.strategies) || !S.settings.strategies.length) {
        S.settings.strategies = DEFAULT_STRATEGIES.slice();
      }
      applyTheme();
      syncSettingsUI();
      return VJDB.allTrades();
    }).then(function (trades) {
      S.trades = trades;
      var hash = (location.hash || '').replace('#', '');
      go(VIEW_META[hash] ? hash : 'dashboard');
      refreshStorage();
      // manifest shortcut: index.html?action=new
      if (/[?&]action=new/.test(location.search)) setTimeout(function () { openForm(null); }, 260);
    }).catch(function (err) {
      applyTheme();
      go('dashboard');
      VJUI.toast('Storage unavailable: ' + err.message, 'i-alert');
    });

    initEvents();
    initGestures();
    initNative();
    VJPicker.init();
    initCloud();
    window.__vjRecentSymbols = recentSymbols();
    registerSW();

    // keep figures honest when the app is left open overnight
    setInterval(function () {
      if (S.view === 'dashboard' || S.view === 'analytics') renderAll();
    }, 900000);

    $('#appVer').textContent = '1.0.0';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
