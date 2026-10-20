/* ============================================================================
   VibeJournal — candlestick chart
   Hand-rolled canvas renderer (lighter and far more controllable than a chart
   plugin, and it keeps the whole thing offline).

   DATA NOTE: there is no backend, so the price series is synthesised
   deterministically per instrument — same symbol always yields the same
   candles, so the chart is stable across reloads and devices. Your trades,
   entries, stops and targets plotted on top are 100% real, because they come
   from your own journal. Swap VJCandles.series() for a real fetch to use live
   market data.
   ========================================================================== */
(function (global) {
  'use strict';

  var $ = VJUI.$;
  var cache = Object.create(null);

  /* ---------------- synthetic series ---------------- */

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function mulberry(seed) {
    var s = seed >>> 0;
    return function () {
      s = s + 0x6D2B79F5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var FRAMES = [
    { id: '1h', label: '1H',  ms: 36e5 },
    { id: '4h', label: '4H',  ms: 4 * 36e5 },
    { id: '1d', label: '1D',  ms: 864e5 },
    { id: '1w', label: '1W',  ms: 7 * 864e5 }
  ];

  /** Pick a candle interval that spans the user's trades in ~100 candles. */
  function autoFrame(spanMs) {
    if (!spanMs || spanMs <= 0) return FRAMES[2];
    var want = spanMs / 100;
    var best = FRAMES[0], bestD = Infinity;
    FRAMES.forEach(function (f) {
      var d = Math.abs(f.ms - want);
      if (d < bestD) { bestD = d; best = f; }
    });
    return best;
  }

  function frameById(id) {
    for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].id === id) return FRAMES[i];
    return FRAMES[2];
  }

  /** Deterministic OHLC candles for an instrument, ending "now". */
  function series(symbol, count, endTs, frameMs) {
    count = count || 120;
    endTs = endTs || Date.now();
    frameMs = frameMs || 864e5;
    var key = symbol + '|' + count + '|' + frameMs + '|' + Math.floor(endTs / 3.6e6); // stable within the hour
    if (cache[key]) return cache[key];

    var inst = VJInstr.find(symbol);
    var base = inst ? inst.price : 1;
    var dp = inst ? inst.dp : 5;

    // volatility scales with the instrument, in relative terms
    var vol = symbol.indexOf('BTC') > -1 ? 0.022
      : symbol.indexOf('XAU') > -1 ? 0.011
      : symbol.indexOf('XAG') > -1 ? 0.019
      : symbol.indexOf('USDJPY') > -1 || symbol.indexOf('JPY') > -1 ? 0.0055
      : symbol.indexOf('US30') > -1 || symbol.indexOf('NAS') > -1 ? 0.009
      : 0.0065;

    var rnd = mulberry(hash(symbol + '|' + frameMs));
    var last = base * (1 + (rnd() - 0.5) * vol * 6);
    var out = [];
    var t = endTs - count * frameMs;

    for (var i = 0; i < count; i++) {
      var drift = (rnd() - 0.48) * vol * 1.5;
      var open = last;
      // occasional impulse so the series has structure, not just noise
      if (rnd() < 0.035) drift += (rnd() - 0.5) * vol * 7;
      var close = open * (1 + drift);
      var hi = Math.max(open, close) * (1 + rnd() * vol * 0.9);
      var lo = Math.min(open, close) * (1 - rnd() * vol * 0.9);
      var p = Math.pow(10, dp);
      out.push({
        t: t + i * frameMs,
        o: Math.round(open * p) / p,
        h: Math.round(hi * p) / p,
        l: Math.round(lo * p) / p,
        c: Math.round(close * p) / p
      });
      last = close;
    }
    cache[key] = out;
    return out;
  }

  /* ---------------- renderer ---------------- */

  function cssVar(n) { return VJUI.charts.cssVar(n); }

  function render(canvas, opts) {
    if (!canvas) return;
    var candles = opts.candles || [];
    var trades = opts.trades || [];
    var dp = opts.dp || 2;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 0, cssH = canvas.clientHeight || 0;
    if (!cssW || !cssH) return;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    if (!candles.length) return;

    var posCol = VJUI.charts.isColorMode() ? VJUI.charts.cssVar('--pos') : '#8E8E93';
    var negCol = VJUI.charts.isColorMode() ? VJUI.charts.cssVar('--neg') : '#F5F5F7';
    var grid = VJUI.charts.cssVar('--chart-grid');
    var tick = VJUI.charts.cssVar('--ink-4');
    var ink = VJUI.charts.cssVar('--ink');
    var ink2 = VJUI.charts.cssVar('--ink-2');
    var markCol = VJUI.charts.isColorMode() ? VJUI.charts.cssVar('--pos') : VJUI.charts.cssVar('--ink');

    var padR = 58, padT = 10, padB = 22, padL = 8;
    var W = cssW - padL - padR, H = cssH - padT - padB;

    var lo = Infinity, hi = -Infinity;
    candles.forEach(function (c) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
    trades.forEach(function (t) {
      [t.entry, t.sl, t.tp].forEach(function (v) {
        if (v == null) return;
        if (v < lo) lo = v; if (v > hi) hi = v;
      });
    });
    var span = (hi - lo) || (hi * 0.01) || 1;
    lo -= span * 0.08; hi += span * 0.08;
    span = hi - lo;

    var t0 = candles[0].t, t1 = candles[candles.length - 1].t;
    var tspan = (t1 - t0) || 1;

    function X(t) { return padL + ((t - t0) / tspan) * W; }
    function Y(v) { return padT + (1 - (v - lo) / span) * H; }

    // horizontal grid + price axis
    g.font = '10px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    var steps = Math.max(2, Math.min(5, Math.floor(H / 46)));
    for (var i = 0; i <= steps; i++) {
      var v = lo + (span * i) / steps;
      var y = Y(v);
      g.strokeStyle = grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(padL, Math.round(y) + .5);
      g.lineTo(padL + W, Math.round(y) + .5);
      g.stroke();
      g.fillStyle = tick;
      g.fillText(VJUI.num(v, dp), padL + W + 8, y);
    }

    // time axis
    g.textAlign = 'center';
    g.fillStyle = tick;
    var ticks = Math.max(2, Math.min(5, Math.floor(W / 90)));
    for (var j = 0; j <= ticks; j++) {
      var tt = t0 + (tspan * j) / ticks;
      var x = X(tt);
      g.fillText(VJUI.fDate(tt), x, padT + H + 12);
    }

    // candles
    var slot = W / candles.length;
    var bw = Math.max(1.5, Math.min(11, slot * 0.62));
    candles.forEach(function (c) {
      var up = c.c >= c.o;
      var col = up ? posCol : negCol;
      var x = X(c.t);
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineWidth = Math.max(1, bw * 0.16);
      g.beginPath();
      g.moveTo(Math.round(x) + .5, Y(c.h));
      g.lineTo(Math.round(x) + .5, Y(c.l));
      g.stroke();
      var yo = Y(c.o), yc = Y(c.c);
      var top = Math.min(yo, yc);
      var hgt = Math.max(1, Math.abs(yc - yo));
      if (up) {
        g.strokeRect(Math.round(x - bw / 2) + .5, Math.round(top) + .5, Math.round(bw), Math.round(hgt));
      } else {
        g.fillRect(Math.round(x - bw / 2), Math.round(top), Math.round(bw), Math.round(hgt));
      }
    });

    // trade markers
    trades.forEach(function (t) {
      if (t.entry == null) return;
      var x = X(Math.max(t0, Math.min(t1, t.dt)));
      var y = Y(t.entry);
      var win = t.result === 'win', lose = t.result === 'loss';
      var col = win ? posCol : lose ? negCol : markCol;

      g.strokeStyle = VJUI.charts.alpha(col, 0.45);
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, padT + H);
      g.stroke();
      g.setLineDash([]);

      // entry marker: ▲ above the line for a win, ▼ below for a loss
      g.fillStyle = col;
      if (t.result === 'be') {
        g.beginPath();
        g.arc(x, y, 3.2, 0, Math.PI * 2);
        g.fill();
      } else {
        var up = win;
        var tip = up ? y - 9 : y + 9;
        var base = up ? y : y;
        g.beginPath();
        g.moveTo(x, tip);
        g.lineTo(x - 4.6, base);
        g.lineTo(x + 4.6, base);
        g.closePath();
        g.fill();
      }

      // stop / target on the newest trade only — otherwise it's noise
      if (t.showLevels) {
        [['sl', negCol], ['tp', posCol]].forEach(function (pair) {
          var val = t[pair[0]];
          if (val == null) return;
          var yy = Y(val);
          g.strokeStyle = VJUI.charts.alpha(pair[1], 0.6);
          g.setLineDash([4, 4]);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(padL, Math.round(yy) + .5);
          g.lineTo(padL + W, Math.round(yy) + .5);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = pair[1];
          g.textAlign = 'left';
          g.fillText(pair[0].toUpperCase(), padL + 4, yy - 7);
        });
      }
    });

    // last price tag
    var lastC = candles[candles.length - 1];
    var ly = Y(lastC.c);
    g.fillStyle = lastC.c >= lastC.o ? posCol : negCol;
    g.fillRect(padL + W + 4, ly - 9, padR - 8, 18);
    g.fillStyle = VJUI.charts.isColorMode() ? '#fff' : (lastC.c >= lastC.o ? '#0B0B0D' : '#fff');
    g.textAlign = 'center';
    g.fillText(VJUI.num(lastC.c, dp), padL + W + 4 + (padR - 8) / 2, ly);
  }

  /**
   * Mount a candle chart into a canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {object} o { symbol, trades, height, showLevels }
   */
  function mount(canvas, o) {
    if (!canvas) return;
    var symbol = o.symbol;
    var trades = (o.trades || []).slice();
    if (!trades.length && !symbol) return;

    var ts = trades.map(function (t) { return t.dt; });
    var newest = ts.length ? Math.max.apply(null, ts) : Date.now();
    var oldest = ts.length ? Math.min.apply(null, ts) : newest;
    var span = newest - oldest;

    // choose an interval that fits the trades into a readable number of candles
    var frame = o.frame ? frameById(o.frame) : autoFrame(span);
    var count = o.count || 110;
    if (ts.length) {
      // enough candles to cover oldest -> newest at this interval, plus margin
      var need = Math.ceil(span / frame.ms) + Math.max(6, Math.round(count * 0.12));
      count = Math.max(40, Math.min(320, need));
    }
    var end = ts.length ? newest + Math.round(count * 0.08) * frame.ms : Date.now();
    var candles = series(symbol, count, end, frame.ms);

    // only the most recent trade draws SL/TP — every trade drawing them turns
    // the chart into an unreadable stack of dashed lines
    var lastId = ts.length ? trades.slice().sort(function (a, b) { return b.dt - a.dt; })[0].id : null;
    var marks = trades.map(function (t) {
      return {
        dt: t.dt, entry: t.entry, sl: t.sl, tp: t.tp, result: t.result,
        showLevels: !!o.showLevels && t.id === lastId
      };
    });

    render(canvas, { candles: candles, trades: marks, dp: o.dp != null ? o.dp : VJInstr.decimals(symbol) });
    return frame;
  }

  global.VJCandles = { series: series, render: render, mount: mount, FRAMES: FRAMES, autoFrame: autoFrame, frameById: frameById };
})(window);
