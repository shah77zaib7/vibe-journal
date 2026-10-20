/* ============================================================================
   VibeJournal — UI helpers: formatting, toasts, dialogs, Chart.js theming
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- dom ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, evt, sel, fn) {
    if (typeof sel === 'function') { el.addEventListener(evt, sel, false); return; }
    el.addEventListener(evt, function (e) {
      var t = e.target.closest(sel);
      if (t && el.contains(t)) fn.call(t, e, t);
    }, false);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  /* ---------------- number formatting ---------------- */
  var CUR = '$';
  function setCurrency(c) { CUR = c || '$'; }
  function currency() { return CUR; }

  function group(int) {
    return String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function num(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    var neg = v < 0;
    var s = Math.abs(v).toFixed(dp == null ? 2 : dp);
    var parts = s.split('.');
    return (neg ? '-' : '') + group(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }

  /** Money with sign: +$120.50 / -$80.00 / $0.00 */
  function money(v, opts) {
    opts = opts || {};
    if (v == null || !isFinite(v)) return '—';
    var sign = v > 0 ? '+' : v < 0 ? '-' : '';
    return sign + (opts.plain ? '' : CUR) + num(Math.abs(v), opts.dp == null ? 2 : opts.dp);
  }

  /** Money without a forced + sign (balances, totals). */
  function bal(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    return (v < 0 ? '-' : '') + CUR + num(Math.abs(v), dp == null ? 2 : dp);
  }

  function pct(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    return num(v * 100, dp == null ? 1 : dp) + '%';
  }

  function ratio(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === Infinity) return '∞';
    return num(v, 2) + 'R';
  }

  function rmult(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + num(v, 2) + 'R';
  }

  function compact(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return s + num(a / 1e9, 1) + 'B';
    if (a >= 1e6) return s + num(a / 1e6, 1) + 'M';
    if (a >= 1e4) return s + num(a / 1e3, 1) + 'K';
    return s + num(a, 0);
  }

  function bytes(b) {
    if (!b) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i === 0 ? b : num(b, 1)) + ' ' + u[i];
  }

  /* ---------------- dates ---------------- */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fDate(ts) {
    var d = new Date(ts);
    return MON[d.getMonth()] + ' ' + d.getDate();
  }
  function fDateFull(ts) {
    var d = new Date(ts);
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function fTime(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
  }
  function fDateTime(ts) { return fDate(ts) + ' · ' + fTime(ts); }

  /** Relative label for the recent list. */
  function fRel(ts) {
    var diff = Date.now() - ts;
    var d = Math.floor(diff / 864e5);
    if (d <= 0) return 'Today · ' + fTime(ts);
    if (d === 1) return 'Yesterday · ' + fTime(ts);
    if (d < 7) return d + ' days ago';
    if (d < 365) return Math.floor(d / 7) + 'w ago';
    return fDateFull(ts);
  }

  /** ts -> value for <input type="datetime-local"> */
  function toLocalInput(ts) {
    var d = new Date(ts - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function isoDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------------- pnl class ---------------- */
  function pnlClass(v) {
    if (v == null || !isFinite(v)) return 'pnl-zero';
    return v > 0 ? 'pnl-pos' : v < 0 ? 'pnl-neg' : 'pnl-zero';
  }
  var RESULT_META = {
    win:  { label: 'Win',       cls: 'badge-win',  icon: 'i-up' },
    loss: { label: 'Loss',      cls: 'badge-loss', icon: 'i-down' },
    be:   { label: 'Breakeven', cls: 'badge-be',   icon: null },
    open: { label: 'Open',      cls: 'badge-open', icon: null }
  };
  function resultBadge(r) {
    var m = RESULT_META[r] || RESULT_META.open;
    return '<span class="badge ' + m.cls + '">' + (m.icon ? '<svg class="ic"><use href="#' + m.icon + '"/></svg>' : '') + m.label + '</span>';
  }
  function shortSym(sym) {
    var s = String(sym || '—').toUpperCase();
    // anything 5+ characters wraps to two lines so it can never overflow its tile
    return s.length > 4 ? s.slice(0, Math.ceil(s.length / 2)) + '<br>' + s.slice(Math.ceil(s.length / 2), 6)
                        : s;
  }

  /* ---------------- toasts ---------------- */
  function toast(msg, icon) {
    var host = $('#toasts');
    if (!host) return;
    var t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = (icon ? '<svg class="ic"><use href="#' + icon + '"/></svg>' : '') + '<span>' + esc(msg) + '</span>';
    host.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 260);
    }, 2400);
  }

  /* ---------------- confirm dialog ---------------- */
  var _cfResolve = null;
  function confirmDialog(opts) {
    var m = $('#confirmModal');
    $('#cfTitle').textContent = opts.title || 'Are you sure?';
    $('#cfBody').textContent = opts.body || 'This action cannot be undone.';
    var ok = $('#cfOk');
    ok.textContent = opts.okLabel || 'Confirm';
    ok.className = opts.danger === false ? 'btn-solid' : 'btn-solid';
    m.hidden = false;
    return new Promise(function (res) { _cfResolve = res; });
  }
  function _closeConfirm(v) {
    var m = $('#confirmModal');
    if (m.hidden) return;
    m.hidden = true;
    if (_cfResolve) { var r = _cfResolve; _cfResolve = null; r(v); }
  }
  document.addEventListener('DOMContentLoaded', function () {
    var ok = $('#cfOk'), cancel = $('#cfCancel'), m = $('#confirmModal');
    if (!ok) return;
    ok.addEventListener('click', function () { _closeConfirm(true); });
    cancel.addEventListener('click', function () { _closeConfirm(false); });
    m.addEventListener('click', function (e) { if (e.target === m) _closeConfirm(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) _closeConfirm(false); });
  });

  /* ---------------- files ---------------- */
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 400);
  }

  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /** Downscale + re-encode an image file so screenshots stay light. */
  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1400;
    quality = quality || 0.82;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          c.toBlob(function (b) {
            URL.revokeObjectURL(url);
            resolve(b || file);
          }, 'image/jpeg', quality);
        } catch (e) {
          URL.revokeObjectURL(url);
          resolve(file);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (/:(.*?);/.exec(parts[0]) || [, 'image/jpeg'])[1];
    var bin = atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ---------------- charts ---------------- */
  var charts = {};

  var _varCache = null;
  function cssVar(name) {
    if (!_varCache) {
      _varCache = {};
      var cs = getComputedStyle(document.documentElement);
      ['--ink', '--ink-2', '--ink-3', '--ink-4', '--chart-grid', '--glass-2',
       '--bg-base', '--pos', '--neg', '--solid', '--on-solid', '--fill-pos', '--fill-neg']
        .forEach(function (n) { _varCache[n] = cs.getPropertyValue(n).trim(); });
    }
    return _varCache[name] || '';
  }
  function invalidateCssVars() { _varCache = null; }
  document.addEventListener('vj:theme', invalidateCssVars);

  /** Parse a hex / rgb() CSS colour into [r,g,b]. */
  function parseColor(c) {
    c = String(c || '').trim();
    var m = /^#([0-9a-f]{3,8})$/i.exec(c);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = /rgba?\(([^)]+)\)/i.exec(c);
    if (m) {
      var p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return [p[0] || 0, p[1] || 0, p[2] || 0];
    }
    return [128, 128, 128];
  }

  /** Colour + alpha as a canvas-safe rgba() string (avoids relying on color-mix). */
  function alpha(color, a) {
    var p = parseColor(color);
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
  }

  /** Blend a colour toward the page background to produce a softer tone. */
  function fade(color, ratio, bg) {
    var c = parseColor(color), b = parseColor(bg);
    return 'rgb(' + Math.round(c[0] + (b[0] - c[0]) * ratio) + ',' +
                    Math.round(c[1] + (b[1] - c[1]) * ratio) + ',' +
                    Math.round(c[2] + (b[2] - c[2]) * ratio) + ')';
  }

  /** Monochrome ramp for ordinal data (donut segments, multi-series). */
  function ramp(n) {
    var ink = cssVar('--ink'), ink2 = cssVar('--ink-2'), ink3 = cssVar('--ink-3'), ink4 = cssVar('--ink-4');
    var base = [ink, ink2, ink3, ink4];
    if (n <= base.length) return base.slice(0, n);
    var out = base.slice();
    while (out.length < n) out.push(fade(ink2, 0.15 + (out.length - base.length) * 0.14, cssVar('--bg-base')));
    return out;
  }

  function isColorMode() { return document.documentElement.getAttribute('data-pnl') === 'color'; }
  function upDownColors() {
    return isColorMode()
      ? { up: cssVar('--pos'), down: cssVar('--neg') }
      : { up: cssVar('--ink'), down: cssVar('--ink-4') };
  }

  /**
   * Axis tick formatter that adapts precision to the data spread, so a curve
   * hovering around 10,000 doesn't label every gridline "10.0K".
   */
  function makeAxisFmt(values, tickCount) {
    var lo = Infinity, hi = -Infinity;
    values.forEach(function (v) {
      if (typeof v === 'number' && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    });
    if (!isFinite(lo)) return function (v) { return num(v, 0); };
    var spread = hi - lo;
    var n = Math.max(2, tickCount || 5);
    var step = spread / (n * 2);
    var dp = 0;
    if (step > 0 && step < 1) dp = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
    var huge = Math.abs(hi) >= 1e6;
    return function (v) {
      if (huge && dp === 0) return compact(v);
      return num(v, dp);
    };
  }

  function baseOptions() {
    var grid = cssVar('--chart-grid'), tick = cssVar('--ink-4');
    return {
      responsive: true,
      maintainAspectRatio: false,
      // 650ms of canvas repaint on every tab switch was the single biggest
      // cost on mobile; 260ms reads as deliberate and costs a quarter as much
      animation: { duration: 260, easing: 'easeOutQuart' },
      animations: { colors: false },
      resizeDelay: 120,
      transition: { duration: 0, easing: 'linear' },
      devicePixelRatio: Math.min(global.devicePixelRatio || 1, 2),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--solid'),
          titleColor: cssVar('--on-solid'),
          bodyColor: cssVar('--on-solid'),
          borderWidth: 0,
          padding: 10,
          cornerRadius: 12,
          displayColors: false,
          titleFont: { size: 11, weight: '600' },
          bodyFont: { size: 13, weight: '500' }
        }
      }
    };
  }

  function merge(target, src) {
    Object.keys(src).forEach(function (k) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
        target[k] = merge(target[k] || {}, src[k]);
      } else {
        target[k] = src[k];
      }
    });
    return target;
  }

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  /**
   * @param {string} sig  identity of the data. When it matches what's already
   *   on the canvas we skip the rebuild entirely — constructing a Chart.js
   *   instance costs ~80ms, and a tab switch used to pay that for every chart.
   */
  function draw(key, canvasId, config, sig) {
    var el = document.getElementById(canvasId);
    if (!el || !global.Chart) return null;
    var prev = charts[key];
    if (prev && prev.canvas === el && sig != null && prev.__sig === sig) return prev;
    var same = !!prev && prev.canvas === el;
    destroyChart(key);
    // a chart rebuilt because the user switched tabs shouldn't replay its
    // entrance animation — that was ~400ms of dead time on every switch
    if (same && config.options) config.options.animation = false;
    charts[key] = new Chart(el.getContext('2d'), config);
    charts[key].__sig = sig;
    return charts[key];
  }

  /** True when a chart for this key already targets the right canvas. */
  function has(key, canvasId) {
    var el = document.getElementById(canvasId);
    return !!(charts[key] && el && charts[key].canvas === el);
  }

  function destroyAll() { Object.keys(charts).forEach(destroyChart); }

  /* ---- equity / cumulative line ---- */
  function equityChart(key, canvasId, points, opts) {
    opts = opts || {};
    var o = baseOptions();
    var ink = cssVar('--ink'), grid = cssVar('--chart-grid'), tick = cssVar('--ink-4');
    var surface = cssVar('--glass-2');
    var ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    var g = ctx.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, alpha(ink, 0.26));
    grad.addColorStop(1, alpha(ink, 0));

    var ys = points.map(function (p) { return p.y; });
    var fmtY = makeAxisFmt(ys, 5);

    o.plugins.tooltip.callbacks = {
      title: function (items) { return items.length ? fDateFull(items[0].parsed.x) : ''; },
      label: function (item) { return 'Balance  ' + bal(item.parsed.y); },
      afterBody: function (items) {
        var p = points[items[0].dataIndex];
        if (!p || !p.trade) return '';
        var t = p.trade;
        return ['\n' + t.symbol + ' · ' + (t.direction === 'sell' ? 'Sell' : 'Buy') + '  ' + money(t.pnl) + '  (' + rmult(realizedR(t, opts.balance)) + ')'];
      }
    };
    o.scales = {
      x: {
        type: 'linear',
        grid: { color: grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: tick, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 22,
          callback: function (v) { return fDate(v); }
        }
      },
      y: {
        position: 'right',
        grid: { color: grid, drawTicks: false },
        border: { display: false },
        ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 5, padding: 6, callback: function (v) { return fmtY(v); } }
      }
    };
    o.elements = {
      line: { tension: .34, borderWidth: 2, borderColor: ink, fill: true, backgroundColor: grad },
      point: { radius: 0, hoverRadius: 5, hoverBorderWidth: 2, hoverBackgroundColor: ink, hoverBorderColor: surface, hitRadius: 14 }
    };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };

    // A single data point gives a degenerate x-domain (labels like "Nov 14 …
    // Mar 17"), so pad the axis to a readable window around the data.
    var xs = points.map(function (p) { return p.x; });
    if (xs.length) {
      var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
      var minSpan = 30 * 864e5;
      if (xmax - xmin < minSpan) {
        var mid = (xmin + xmax) / 2;
        xmin = mid - minSpan / 2;
        xmax = mid + minSpan / 2;
      }
      o.scales.x.min = xmin;
      o.scales.x.max = xmax;
    }

    return draw(key, canvasId, {
      type: 'line',
      data: {
        datasets: [{
          data: points.map(function (p) { return { x: p.x, y: p.y }; }),
          _points: points
        }]
      },
      options: o
    }, 'e' + points.length + ':' + points[0].y + ':' + points[points.length - 1].y + ':' + cssVar('--ink') + cssVar('--pos'));
  }

  /* ---- vertical bars (monthly pnl, etc.) ---- */
  function barChart(key, canvasId, labels, values, opts) {
    opts = opts || {};
    var o = baseOptions();
    var grid = cssVar('--chart-grid'), tick = cssVar('--ink-4');
    var ud = upDownColors();
    var surface = cssVar('--glass-2');
    var fmtY = makeAxisFmt(values, 5);

    o.interaction = { mode: 'index', intersect: false };
    o.plugins.tooltip.callbacks = {
      title: function (i) { return i[0].label; },
      label: function (item) {
        var extra = opts.meta ? opts.meta[item.dataIndex] : null;
        return [money(item.parsed.y)].concat(extra || []);
      }
    };
    o.scales = {
      x: { grid: { display: false }, border: { display: false },
           ticks: { color: tick, font: { size: 10 }, maxRotation: opts.rotate ? 45 : 0, autoSkipPadding: 10 } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false },
           ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 5, padding: 6,
                    callback: function (v) { return fmtY(v); } } }
    };
    o.elements = {
      bar: {
        borderRadius: 8, borderSkipped: false, maxBarThickness: 34,
        backgroundColor: function (c) {
          var v = c.raw;
          var col = v >= 0 ? ud.up : ud.down;
          if (opts.fade) {
            var max = Math.max.apply(null, values.map(Math.abs).concat([1]));
            var a = 0.32 + 0.68 * (Math.abs(v) / max);
            return alpha(col, a);
          }
          return col;
        },
        hoverBackgroundColor: ud.up,
        hoverBorderColor: surface,
        hoverBorderWidth: 2
      }
    };
    return draw(key, canvasId, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: values, borderWidth: 0 }] },
      options: o
    }, 'b' + labels.length + ':' + values.join(',') + ':' + cssVar('--pos') + cssVar('--ink'));
  }

  /* ---- horizontal bars (by strategy / pair) ---- */
  function hBarChart(key, canvasId, labels, values, opts) {
    opts = opts || {};
    var o = baseOptions();
    var grid = cssVar('--chart-grid'), tick = cssVar('--ink-4');
    var ud = upDownColors();
    var fmtX = makeAxisFmt(values, 5);
    o.indexAxis = 'y';
    o.interaction = { mode: 'nearest', axis: 'y', intersect: true };
    o.plugins.tooltip.callbacks = {
      label: function (item) { return money(item.parsed.x); }
    };
    o.scales = {
      x: { grid: { color: grid, drawTicks: false }, border: { display: false },
           ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 5, callback: function (v) { return fmtX(v); } } },
      y: { grid: { display: false }, border: { display: false },
           ticks: { color: cssVar('--ink-2'), font: { size: 11, weight: '500' } } }
    };
    o.elements = {
      bar: {
        borderRadius: 8, borderSkipped: false, maxBarThickness: 22,
        backgroundColor: function (c) {
          var col = c.raw >= 0 ? ud.up : ud.down;
          if (!opts.fade) return col;
          var max = Math.max.apply(null, values.map(Math.abs).concat([1]));
          return alpha(col, 0.32 + 0.68 * (Math.abs(c.raw) / max));
        }
      }
    };
    return draw(key, canvasId, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: values, borderWidth: 0 }] },
      options: o
    }, 'h' + labels.join('|') + ':' + values.join(',') + ':' + cssVar('--pos') + cssVar('--ink'));
  }

  /* ---- doughnut (result split) ---- */
  function doughnut(key, canvasId, labels, values, customColors) {
    var o = baseOptions();
    var colors = customColors || ramp(Math.max(labels.length, 1));
    o.cutout = '68%';
    o.plugins.tooltip.callbacks = {
      label: function (item) {
        var t = item.dataset.data.reduce(function (a, b) { return a + b; }, 0);
        return item.label + '  ' + item.parsed + '  (' + (t ? Math.round(item.parsed / t * 100) : 0) + '%)';
      }
    };
    return draw(key, canvasId, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          spacing: 3,
          borderRadius: 6,
          hoverOffset: 5
        }]
      },
      options: o
    }, 'd' + values.join(',') + ':' + colors.join(','));
  }

  /* ---- scatter (risk vs pnl) ---- */
  function scatterChart(key, canvasId, points, opts) {
    opts = opts || {};
    var o = baseOptions();
    var grid = cssVar('--chart-grid'), tick = cssVar('--ink-4');
    var ud = upDownColors();
    var surface = cssVar('--glass-2');
    var fmtX = makeAxisFmt(points.map(function (p) { return p.risk; }), 5);
    var fmtY = makeAxisFmt(points.map(function (p) { return p.y; }), 5);

    o.interaction = { mode: 'nearest', intersect: true };
    o.plugins.tooltip.callbacks = {
      title: function (i) { var p = points[i[0].dataIndex]; return p ? p.symbol + ' · ' + fDateFull(p.dt) : ''; },
      label: function (item) {
        var p = points[item.dataIndex];
        return ['Risk  ' + bal(p.risk), 'P&L  ' + money(p.pnl), rmult(p.r)];
      }
    };
    o.scales = {
      x: { title: { display: true, text: 'Risk', color: tick, font: { size: 10 }, padding: { top: 6 } },
           grid: { color: grid, drawTicks: false }, border: { display: false },
           ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 5, callback: function (v) { return compact(v); } } },
      y: { title: { display: true, text: 'P&L', color: tick, font: { size: 10 } },
           grid: { color: grid, drawTicks: false }, border: { display: false },
           ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 5, callback: function (v) { return compact(v); } } }
    };
    o.elements = {
      point: {
        radius: 5, hoverRadius: 7,
        backgroundColor: function (c) { return (c.raw && c.raw.y >= 0) ? ud.up : ud.down; },
        borderColor: surface, borderWidth: 1.5
      }
    };
    o.onClick = function (e, els) {
      if (!els.length || !opts.onSelect) return;
      opts.onSelect(points[els[0].index]);
    };
    o.onHover = function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };

    return draw(key, canvasId, {
      type: 'scatter',
      data: { datasets: [{ data: points.map(function (p) { return { x: p.risk, y: p.pnl }; }) }] },
      options: o
    }, 's' + points.length + ':' + points[0].risk + ':' + points[points.length - 1].risk + ':' + cssVar('--pos'));
  }

  global.VJUI = {
    $: $, $$: $$, on: on, esc: esc, uid: uid,
    setCurrency: setCurrency, currency: currency,
    num: num, money: money, bal: bal, pct: pct, ratio: ratio, rmult: rmult, compact: compact, bytes: bytes,
    fDate: fDate, fDateFull: fDateFull, fTime: fTime, fDateTime: fDateTime, fRel: fRel,
    toLocalInput: toLocalInput, isoDate: isoDate,
    pnlClass: pnlClass, resultBadge: resultBadge, shortSym: shortSym, RESULT_META: RESULT_META,
    toast: toast, confirm: confirmDialog,
    download: download, toCSV: toCSV, compressImage: compressImage,
    blobToDataURL: blobToDataURL, dataURLToBlob: dataURLToBlob,
    charts: {
      draw: draw, destroy: destroyChart, destroyAll: destroyAll,
      equity: equityChart, bar: barChart, hbar: hBarChart,
      doughnut: doughnut, scatter: scatterChart,
      cssVar: cssVar, ramp: ramp, isColorMode: isColorMode,
      alpha: alpha, fade: fade, parseColor: parseColor, axisFmt: makeAxisFmt,
      has: has, invalidate: invalidateCssVars
    }
  };
})(window);
