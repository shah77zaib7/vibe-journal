/* ============================================================================
   VibeJournal — analytics engine
   Pure functions over an array of trades. No DOM, no side effects.
   ========================================================================== */
(function (global) {
  'use strict';

  var CLOSED = { win: 1, loss: 1, be: 1 };

  function isClosed(t) { return !!CLOSED[t.result]; }
  function pnlOf(t) { return typeof t.pnl === 'number' && isFinite(t.pnl) ? t.pnl : 0; }

  /** Risk expressed in account currency, normalised from amount/percent. */
  function riskAmount(t, balance) {
    if (t.riskMode === 'percent' && typeof t.risk === 'number') {
      return (t.risk / 100) * (balance || 0);
    }
    if (typeof t.riskAmount === 'number' && isFinite(t.riskAmount) && t.riskAmount > 0) {
      return t.riskAmount;
    }
    if (t.riskMode === 'amount' && typeof t.risk === 'number') return t.risk;
    return 0;
  }

  /** Planned reward:risk from the price geometry. */
  function plannedRR(t) {
    if (typeof t.plannedRR === 'number' && isFinite(t.plannedRR) && t.plannedRR > 0) return t.plannedRR;
    if (t.entry == null || t.sl == null || t.tp == null) return null;
    var risk = Math.abs(t.entry - t.sl);
    var rew = Math.abs(t.tp - t.entry);
    if (!risk) return null;
    return rew / risk;
  }

  /** Realised R multiple, if risk is known. */
  function realizedR(t, balance) {
    if (!isClosed(t)) return null;
    var r = riskAmount(t, balance);
    if (!r) return null;
    return pnlOf(t) / r;
  }

  function pipSize(symbol) {
    var s = String(symbol || '').toUpperCase();
    if (!s) return 0.0001;
    if (s.indexOf('JPY') > -1) return 0.01;
    if (s.indexOf('XAU') > -1 || s.indexOf('XAG') > -1) return 0.1;
    if (s.indexOf('BTC') > -1 || s.indexOf('ETH') > -1) return 1;
    if (s.indexOf('USD') > -1) return 0.0001;
    return 0.0001;
  }

  function distInPips(from, to, symbol) {
    if (from == null || to == null) return null;
    var ps = pipSize(symbol);
    if (!ps) return null;
    return Math.abs(to - from) / ps;
  }

  function sum(arr, f) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += f ? f(arr[i], i) : arr[i];
    return s;
  }
  function mean(arr, f) { return arr.length ? sum(arr, f) / arr.length : 0; }
  function stdev(arr, f) {
    if (arr.length < 2) return 0;
    var m = mean(arr, f);
    return Math.sqrt(sum(arr, function (v, i) { var d = (f ? f(v, i) : v) - m; return d * d; }) / (arr.length - 1));
  }

  function bucket(trades, balance) {
    var closed = trades.filter(isClosed);
    var wins = closed.filter(function (t) { return t.result === 'win'; });
    var losses = closed.filter(function (t) { return t.result === 'loss'; });
    var grossProfit = sum(wins, pnlOf);
    var grossLoss = Math.abs(sum(losses, pnlOf));
    var net = sum(closed, pnlOf);
    var open = trades.filter(function (t) { return t.result === 'open'; });

    var risks = trades.map(function (t) { return riskAmount(t, balance); }).filter(function (r) { return r > 0; });
    var planned = trades.map(plannedRR).filter(function (r) { return r != null && isFinite(r) && r > 0; });
    var realized = closed.map(function (t) { return realizedR(t, balance); }).filter(function (r) { return r != null; });

    // streaks over chronologically ordered closed trades
    var chrono = closed.slice().sort(function (a, b) { return a.dt - b.dt; });
    var curType = null, curLen = 0, maxW = 0, maxL = 0, run = 0, runType = null;
    chrono.forEach(function (t) {
      var k = t.result === 'win' ? 'w' : t.result === 'loss' ? 'l' : null;
      if (k === null) return;
      if (k === runType) { run++; } else { runType = k; run = 1; }
      if (k === 'w' && run > maxW) maxW = run;
      if (k === 'l' && run > maxL) maxL = run;
    });
    if (chrono.length) {
      var last = chrono[chrono.length - 1].result;
      if (last === 'win' || last === 'loss') {
        curType = last === 'win' ? 'w' : 'l';
        for (var i = chrono.length - 1; i >= 0; i--) {
          var rr = chrono[i].result === 'win' ? 'w' : chrono[i].result === 'loss' ? 'l' : null;
          if (rr !== curType) break;
          curLen++;
        }
      }
    }

    var winRate = closed.length ? wins.length / closed.length : 0;
    var avgWin = wins.length ? grossProfit / wins.length : 0;
    var avgLoss = losses.length ? grossLoss / losses.length : 0;
    var avgRisk = mean(risks);

    return {
      total: trades.length,
      closed: closed.length,
      openCount: open.length,
      wins: wins.length,
      losses: losses.length,
      bes: closed.length - wins.length - losses.length,

      winRate: winRate,
      netPnl: net,
      grossProfit: grossProfit,
      grossLoss: grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
      payoff: avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0),
      avgWin: avgWin,
      avgLoss: avgLoss,
      expectancy: closed.length ? net / closed.length : 0,
      expectancyR: realized.length ? mean(realized) : 0,
      realizedRTotal: realized.length ? sum(realized) : 0,

      best: wins.length ? Math.max.apply(null, wins.map(pnlOf)) : (net > 0 ? net : 0),
      worst: losses.length ? Math.min.apply(null, losses.map(pnlOf)) : 0,
      bestTrade: wins.length ? wins.reduce(function (a, b) { return pnlOf(a) >= pnlOf(b) ? a : b; }) : null,
      worstTrade: losses.length ? losses.reduce(function (a, b) { return pnlOf(a) <= pnlOf(b) ? a : b; }) : null,

      avgPlannedRR: planned.length ? mean(planned) : null,
      avgRisk: avgRisk,
      maxRisk: risks.length ? Math.max.apply(null, risks) : 0,
      minRisk: risks.length ? Math.min.apply(null, risks) : 0,
      totalRisk: sum(risks),
      riskStd: stdev(risks),
      riskCount: risks.length,

      maxWinStreak: maxW,
      maxLossStreak: maxL,
      curStreak: curLen,
      curStreakType: curType,

      resultSplit: {
        win: wins.length, loss: losses.length,
        be: closed.length - wins.length - losses.length,
        open: open.length
      },
      avgHoldHours: mean(closed, function (t) {
        return t.closedDt ? Math.max(0, (t.closedDt - t.dt) / 36e5) : null;
      }) || 0
    };
  }

  /** Aggregate a subset of trades into a per-key row. */
  function groupStats(trades, keyFn, balance) {
    var map = Object.create(null);
    trades.forEach(function (t) {
      var k = keyFn(t) || 'Untagged';
      (map[k] = map[k] || []).push(t);
    });
    return Object.keys(map).map(function (k) {
      var rows = map[k];
      var s = bucket(rows, balance);
      return {
        key: k, n: s.total, closed: s.closed,
        wins: s.wins, losses: s.losses,
        net: s.netPnl, winRate: s.winRate,
        pf: s.profitFactor, expectancy: s.expectancy,
        avgRisk: s.avgRisk, avgPlannedRR: s.avgPlannedRR,
        avgR: s.expectancyR
      };
    }).sort(function (a, b) { return b.net - a.net; });
  }

  function byStrategy(t) { return t.strategy || 'Untagged'; }
  function byPair(t) { return t.symbol || '—'; }
  function byDirection(t) { return t.direction || 'buy'; }

  /* ---------------- equity curve ---------------- */

  /**
   * Cumulative balance over time.
   * @param rangeDays 0 = all time, else trailing window
   */
  function equityCurve(trades, balance, rangeDays) {
    var now = Date.now();
    var from = rangeDays ? now - rangeDays * 864e5 : -Infinity;

    var rows = trades
      .filter(function (t) { return isClosed(t) && t.dt >= from; })
      .slice()
      .sort(function (a, b) { return a.dt - b.dt; });

    // anchor the curve to the true starting balance (only realised P&L accumulates)
    var base = balance;
    if (rangeDays && rows.length) {
      var start = rows[0].dt;
      var before = sum(trades.filter(function (t) { return isClosed(t) && t.dt < start; }), pnlOf);
      base = balance + before;
    }

    var points = [{ x: rows.length ? rows[0].dt : now, y: base, pnl: 0, trade: null }];
    var run = 0;
    rows.forEach(function (t) {
      run += pnlOf(t);
      points.push({ x: t.dt, y: base + run, pnl: pnlOf(t), trade: t });
    });
    if (rows.length && points[points.length - 1].x < now) {
      points.push({ x: now, y: base + run, pnl: 0, trade: null });
    }
    return points;
  }

  /* ---------------- time buckets ---------------- */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function mondayOf(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }

  /** @param gran 'month' | 'week' | 'dow' | 'hour' */
  function timeSeries(trades, gran, balance) {
    var map = Object.create(null), order = [];

    trades.filter(isClosed).forEach(function (t) {
      var d = new Date(t.dt), key, label, short = (d.getMonth() + 1) + '/' + d.getDate();
      if (gran === 'week') {
        var m = new Date(mondayOf(t.dt));
        key = 'w' + mondayOf(t.dt);
        label = MONTHS[m.getMonth()] + ' ' + m.getDate();
        short = label;
      } else if (gran === 'dow') {
        key = 'd' + d.getDay();
        label = DOWS[d.getDay()];
        short = label;
      } else if (gran === 'hour') {
        key = 'h' + d.getHours();
        label = String(d.getHours()).padStart(2, '0') + ':00';
        short = label;
      } else {
        key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        label = MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2);
        short = MONTHS[d.getMonth()];
      }
      if (!map[key]) { map[key] = { key: key, label: label, short: short, n: 0, wins: 0, losses: 0, net: 0, ts: t.dt }; order.push(key); }
      var row = map[key];
      row.n++; row.net += pnlOf(t);
      if (t.result === 'win') row.wins++;
      if (t.result === 'loss') row.losses++;
    });

    var rows = order.map(function (k) { return map[k]; });
    if (gran === 'dow') rows.sort(function (a, b) { return (+a.key.slice(1) + 6) % 7 - ((+b.key.slice(1) + 6) % 7); });
    else if (gran === 'hour') rows.sort(function (a, b) { return +a.key.slice(1) - +b.key.slice(1); });
    else rows.sort(function (a, b) { return a.ts - b.ts; });

    rows.forEach(function (r) { r.winRate = r.n ? r.wins / r.n : 0; });
    return rows;
  }

  /* ---------------- R distribution ---------------- */

  function rDistribution(trades, balance) {
    var edges = [-Infinity, -2, -1, 0, 1, 2, 3, Infinity];
    var labels = ['< -2R', '-2 to -1R', '-1 to 0R', '0 to 1R', '1 to 2R', '2 to 3R', '> 3R'];
    var bins = labels.map(function (l) { return { label: l, n: 0 }; });
    trades.filter(isClosed).forEach(function (t) {
      var r = realizedR(t, balance);
      if (r == null) return;
      for (var i = 0; i < edges.length - 1; i++) {
        if (r >= edges[i] && (i === edges.length - 2 ? r <= edges[i + 1] : r < edges[i + 1])) { bins[i].n++; return; }
      }
    });
    return bins;
  }

  /* ---------------- filtering / sorting ---------------- */

  function matchesQuery(t, q) {
    if (!q) return true;
    var hay = [t.symbol, t.strategy, t.notes, t.result, t.direction, (t.tags || []).join(' '), String(t.pnl)].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (word) { return hay.indexOf(word) > -1; });
  }

  function applyFilters(trades, f) {
    if (!f) return trades;
    var from = f.from ? new Date(f.from + 'T00:00:00').getTime() : null;
    var to = f.to ? new Date(f.to + 'T23:59:59.999').getTime() : null;
    var tagSet = (f.tags || []).filter(Boolean);

    return trades.filter(function (t) {
      if (from != null && t.dt < from) return false;
      if (to != null && t.dt > to) return false;
      if (f.pair && t.symbol !== f.pair) return false;
      if (f.strategy && t.strategy !== f.strategy) return false;
      if (f.result && t.result !== f.result) return false;
      if (f.direction && t.direction !== f.direction) return false;
      if (tagSet.length) {
        var own = t.tags || [];
        if (!tagSet.every(function (tg) { return own.indexOf(tg) > -1; })) return false;
      }
      return true;
    });
  }

  function sortTrades(trades, key, dir, balance) {
    var mul = dir === 'asc' ? 1 : -1;
    var copy = trades.slice();
    copy.sort(function (a, b) {
      var av, bv;
      switch (key) {
        case 'pnl': av = a.pnl == null ? -Infinity : a.pnl; bv = b.pnl == null ? -Infinity : b.pnl; break;
        case 'entry': av = a.entry; bv = b.entry; break;
        case 'riskAmount': av = riskAmount(a, balance); bv = riskAmount(b, balance); break;
        case 'plannedRR': av = plannedRR(a) || 0; bv = plannedRR(b) || 0; break;
        default: av = a[key]; bv = b[key];
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * mul;
      return (av - bv) * mul;
    });
    return copy;
  }

  global.VJStats = {
    isClosed: isClosed,
    pnlOf: pnlOf,
    riskAmount: riskAmount,
    plannedRR: plannedRR,
    realizedR: realizedR,
    pipSize: pipSize,
    distInPips: distInPips,
    bucket: bucket,
    groupStats: groupStats,
    byStrategy: byStrategy,
    byPair: byPair,
    byDirection: byDirection,
    equityCurve: equityCurve,
    timeSeries: timeSeries,
    rDistribution: rDistribution,
    matchesQuery: matchesQuery,
    applyFilters: applyFilters,
    sortTrades: sortTrades,
    MONTHS: MONTHS
  };
})(window);
