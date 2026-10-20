/* ============================================================================
   VibeJournal — instrument catalogue + searchable picker
   Replaces the native <datalist>, which renders an unstyled, inconsistent
   list on mobile Safari and Android Chrome.
   ========================================================================== */
(function (global) {
  'use strict';

  var GROUPS = [
    { id: 'fav',    label: 'Popular' },
    { id: 'major',  label: 'Majors' },
    { id: 'cross',  label: 'Crosses' },
    { id: 'metal',  label: 'Metals' },
    { id: 'index',  label: 'Indices' },
    { id: 'crypto', label: 'Crypto' }
  ];

  var LIST = [
    // symbol, display, group, decimals, approx price
    ['EURUSD', 'EUR/USD', 'major', 5, 1.085],
    ['GBPUSD', 'GBP/USD', 'major', 5, 1.272],
    ['USDJPY', 'USD/JPY', 'major', 3, 149.2],
    ['AUDUSD', 'AUD/USD', 'major', 5, 0.661],
    ['USDCAD', 'USD/CAD', 'major', 5, 1.362],
    ['USDCHF', 'USD/CHF', 'major', 5, 0.884],
    ['NZDUSD', 'NZD/USD', 'major', 5, 0.604],

    ['EURGBP', 'EUR/GBP', 'cross', 5, 0.853],
    ['EURJPY', 'EUR/JPY', 'cross', 3, 161.9],
    ['GBPJPY', 'GBP/JPY', 'cross', 3, 189.7],
    ['EURCHF', 'EUR/CHF', 'cross', 5, 0.959],
    ['GBPCHF', 'GBP/CHF', 'cross', 5, 1.125],
    ['AUDJPY', 'AUD/JPY', 'cross', 3, 98.6],
    ['CADJPY', 'CAD/JPY', 'cross', 3, 109.5],
    ['CHFJPY', 'CHF/JPY', 'cross', 3, 168.8],
    ['AUDNZD', 'AUD/NZD', 'cross', 5, 1.094],
    ['EURAUD', 'EUR/AUD', 'cross', 5, 1.642],
    ['EURCAD', 'EUR/CAD', 'cross', 5, 1.478],
    ['GBPAUD', 'GBP/AUD', 'cross', 5, 1.925],
    ['EURNZD', 'EUR/NZD', 'cross', 5, 1.798],
    ['AUDCAD', 'AUD/CAD', 'cross', 5, 0.900],
    ['NZDJPY', 'NZD/JPY', 'cross', 3, 90.1],

    ['XAUUSD', 'Gold / USD', 'metal', 2, 2385.4],
    ['XAGUSD', 'Silver / USD', 'metal', 3, 27.42],
    ['XPTUSD', 'Platinum / USD', 'metal', 2, 964.0],
    ['XPDUSD', 'Palladium / USD', 'metal', 2, 938.0],
    ['XAUEUR', 'Gold / EUR', 'metal', 2, 2198.6],
    ['XAGEUR', 'Silver / EUR', 'metal', 3, 25.28],

    ['US30', 'Dow Jones 30', 'index', 1, 39250],
    ['NAS100', 'Nasdaq 100', 'index', 1, 18420],
    ['SPX500', 'S&P 500', 'index', 1, 5580],
    ['GER40', 'DAX 40', 'index', 1, 18410],
    ['UK100', 'FTSE 100', 'index', 1, 7712],
    ['JPN225', 'Nikkei 225', 'index', 1, 38940],
    ['AUS200', 'ASX 200', 'index', 1, 7640],

    ['BTCUSD', 'Bitcoin', 'crypto', 1, 63420],
    ['ETHUSD', 'Ethereum', 'crypto', 1, 2480],
    ['SOLUSD', 'Solana', 'crypto', 2, 148.6],
    ['XRPUSD', 'XRP', 'crypto', 4, 0.612],
    ['LTCUSD', 'Litecoin', 'crypto', 2, 84.2],
    ['BCHUSD', 'Bitcoin Cash', 'crypto', 1, 348.5],
    ['DOGEUSD', 'Dogecoin', 'crypto', 5, 0.1385]
  ];

  var INSTRUMENTS = LIST.map(function (r) {
    return { symbol: r[0], name: r[1], group: r[2], dp: r[3], price: r[4] };
  });

  var BY_SYMBOL = {};
  INSTRUMENTS.forEach(function (i) { BY_SYMBOL[i.symbol] = i; });

  function find(sym) { return BY_SYMBOL[String(sym || '').toUpperCase().trim()] || null; }

  function isKnown(sym) { return !!find(sym); }

  /** Sensible decimal places for a symbol's prices. */
  function decimals(sym) {
    var i = find(sym);
    return i ? i.dp : 5;
  }

  function label(sym) {
    var i = find(sym);
    return i ? i.name : String(sym || '').toUpperCase();
  }

  /** Rank matches so typing "xau" puts gold first, not at the bottom. */
  function score(inst, q) {
    var s = inst.symbol.toLowerCase();
    if (s === q) return 100;
    if (s.indexOf(q) === 0) return 80 - s.length;
    if (s.indexOf(q) > -1) return 60 - s.length;
    var n = inst.name.toLowerCase();
    if (n.indexOf(q) === 0) return 50 - s.length;
    if (n.indexOf(q) > -1) return 30 - s.length;
    var words = q.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (s.indexOf(words[i]) === -1 && n.indexOf(words[i]) === -1) return -1;
    }
    return 10 - s.length;
  }

  /**
   * Filter the catalogue.
   * @param {string} query free text
   * @param {string[]} preferred symbols to float to the top (your recent pairs)
   * @param {number} limit max results
   */
  function search(query, preferred, limit) {
    var q = String(query || '').trim().toLowerCase().replace(/[\s/_-]/g, '');
    limit = limit || 60;
    var fav = {};
    (preferred || []).forEach(function (p) { fav[String(p).toUpperCase()] = 1; });

    if (!q) {
      var favs = INSTRUMENTS.filter(function (i) { return fav[i.symbol]; });
      var rest = INSTRUMENTS.filter(function (i) { return !fav[i.symbol]; });
      return favs.concat(rest).slice(0, limit);
    }

    var normQ = q.replace(/\s+/g, '');
    var out = [];
    INSTRUMENTS.forEach(function (inst) {
      var sc = score(inst, normQ);
      if (sc < 0) return;
      if (fav[inst.symbol]) sc += 15;
      out.push({ inst: inst, sc: sc });
    });
    out.sort(function (a, b) { return b.sc - a.sc; });
    return out.slice(0, limit).map(function (o) { return o.inst; });
  }

  /** Group a result list for rendering, preserving relevance order within groups. */
  function group(results) {
    var order = ['fav', 'major', 'cross', 'metal', 'index', 'crypto'];
    var byId = {};
    results.forEach(function (r) { (byId[r.group] = byId[r.group] || []).push(r); });
    var out = [];
    order.forEach(function (id) {
      if (!byId[id] || !byId[id].length) return;
      var g = GROUPS.filter(function (x) { return x.id === id; })[0];
      out.push({ label: g ? g.label : id, items: byId[id] });
    });
    return out;
  }

  global.VJInstr = {
    LIST: INSTRUMENTS,
    GROUPS: GROUPS,
    find: find,
    isKnown: isKnown,
    decimals: decimals,
    label: label,
    search: search,
    group: group
  };
})(window);
