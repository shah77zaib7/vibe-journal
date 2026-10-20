/* ============================================================================
   VibeJournal — instrument picker
   A proper combobox: type to filter, grouped clean list, keyboard + touch.
   Native <datalist> is unusable on mobile, so this replaces it everywhere.
   ========================================================================== */
(function (global) {
  'use strict';

  var $ = VJUI.$, esc = VJUI.esc;
  var openEl = null;
  var activeIndex = -1;
  var current = [];

  function build(panel) {
    var input = $('input', panel);
    var list = $('.picker-list', panel);
    var menu = $('.picker-menu', panel);
    var wrap = panel.closest('.picker') || panel.parentElement;
    var clear = $('.picker-clear', panel);
    var caret = $('.picker-caret', panel);

    if (!input || !list || !menu) return;

    var preferred = (global.__vjRecentSymbols || []);
    // while the field still holds the previously chosen value, show the whole
    // catalogue — otherwise opening the picker to *browse* just filters to one row
    var committed = input.value;
    var suppressOpen = false;

    function render(forceQuery) {
      var q = forceQuery != null ? forceQuery : input.value;
      current = VJInstr.search(q, preferred, 80);
      var grouped = VJInstr.group(current);
      activeIndex = current.length ? 0 : -1;

      if (!current.length) {
        var typed = q.trim().toUpperCase();
        list.innerHTML = '<div class="picker-none">' +
          (typed
            ? 'No match — use <b>' + esc(typed) + '</b> as a custom symbol'
            : 'Type to search pairs, metals, indices or crypto') +
          '</div>';
      } else {
        var html = '';
        grouped.forEach(function (g) {
          html += '<div class="picker-group"><div class="picker-group-t">' + esc(g.label) + '</div>';
          g.items.forEach(function (inst) {
            var i = current.indexOf(inst);
            html += '<button type="button" class="picker-item" role="option" data-sym="' + esc(inst.symbol) + '" data-i="' + i + '">' +
              '<span class="pi-sym">' + esc(inst.symbol) + '</span>' +
              '<span class="pi-name">' + esc(inst.name) + '</span>' +
              '<svg class="ic pi-chk"><use href="#i-check"/></svg>' +
            '</button>';
          });
          html += '</div>';
        });
        list.innerHTML = html;
      }
      if (clear) clear.hidden = !input.value;
      paintActive();
    }

    function paintActive() {
      var items = $$('.picker-item', list);
      items.forEach(function (el, n) { el.classList.toggle('is-active', n === activeIndex); });
      if (activeIndex >= 0 && items[activeIndex]) {
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    function openPicker() {
      if (openEl && openEl !== panel) close();
      openEl = panel;
      panel.classList.add('is-open');
      wrap.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      // The form lives in a scrolling bottom sheet, so an absolutely
      // positioned menu would be clipped. Anchor a fixed popover to the input
      // and keep it glued while the page scrolls.
      if (menu.parentNode !== document.body) document.body.appendChild(menu);
      menu.style.display = 'block';
      render(input.value === committed ? '' : input.value);  // fill first
      position();
      setTimeout(function () { input.focus(); }, 0);
    }

    function position() {
      var r = input.getBoundingClientRect();
      var list = menu.querySelector('.picker-list');
      var below = window.innerHeight - r.bottom - 12;
      var above = r.top - 12;

      // never taller than the space we actually have
      var maxH = Math.max(140, Math.min(264, below, above < below ? above : Infinity));
      list.style.maxHeight = maxH + 'px';

      var h = list.scrollHeight || list.offsetHeight || 200;
      var top = r.bottom + 6;
      if (h > below && above > below) top = Math.max(8, r.top - h - 6);
      top = Math.max(8, Math.min(top, window.innerHeight - 40));

      var w = Math.max(r.width, 220);
      var left = Math.min(r.left, window.innerWidth - w - 8);
      menu.style.top = top + 'px';
      menu.style.left = Math.max(8, left) + 'px';
      menu.style.width = w + 'px';
    }

    function closePicker() {
      panel.classList.remove('is-open');
      wrap.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      menu.style.display = 'none';
      if (openEl === panel) openEl = null;
    }

    function choose(sym) {
      input.value = sym;
      committed = sym;
      closePicker();
      // the synthetic input would otherwise re-open the list we just dismissed
      suppressOpen = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      suppressOpen = false;
    }

    input.addEventListener('focus', function () { openPicker(); });
    input.addEventListener('input', function () {
      if (suppressOpen) return;
      committed = null;   // the user is typing — filter from now on
      if (!panel.classList.contains('is-open')) openPicker(); else render();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!panel.classList.contains('is-open')) { openPicker(); return; }
        if (!current.length) return;
        activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + current.length) % current.length;
        paintActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (panel.classList.contains('is-open') && current[activeIndex]) {
          choose(current[activeIndex].symbol);
        } else {
          // a symbol that isn't in the catalogue is still valid
          var typed = input.value.trim().toUpperCase();
          if (typed) {
            input.value = typed; committed = typed; closePicker();
            suppressOpen = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            suppressOpen = false;
          }
        }
      } else if (e.key === 'Escape') {
        if (panel.classList.contains('is-open')) { e.preventDefault(); closePicker(); }
      } else if (e.key === 'Tab') {
        closePicker();
      }
    });

    // moving focus out of the field dismisses the list
    input.addEventListener('focusout', function () {
      setTimeout(function () {
        if (openEl === panel && !wrap.contains(document.activeElement)) closePicker();
      }, 120);
    });

    if (caret) caret.addEventListener('click', function (e) {
      e.preventDefault();
      panel.classList.contains('is-open') ? closePicker() : openPicker();
    });
    if (clear) clear.addEventListener('click', function (e) {
      e.preventDefault();
      input.value = '';
      committed = null;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });

    list.addEventListener('click', function (e) {
      var b = e.target.closest('.picker-item');
      if (b) choose(b.dataset.sym);
    });
    list.addEventListener('mousemove', function (e) {
      var b = e.target.closest('.picker-item');
      if (b) {
        var i = +b.dataset.i;
        if (i !== activeIndex) { activeIndex = i; paintActive(); }
      }
    });

    // close when focus or a click lands outside
    document.addEventListener('click', function (e) {
      if (openEl === panel && !wrap.contains(e.target)) closePicker();
    });
    panel.__close = closePicker;
    panel.__render = render;
    panel.__wrap = wrap;
    panel.__input = input;
    // set the value without triggering a filter, for programmatic updates
    panel.__setValue = function (v) { input.value = v == null ? '' : v; committed = input.value; };
  }

  function init() {
    $$('.picker').forEach(build);
  }

  function openOne(sel) {
    var p = $(sel);
    if (!p) return;
    var input = $('input', p);
    if (input) { input.focus(); input.select(); }
  }

  // The menu is reparented to <body>, so containment must be tested against
  // the picker's wrapper, not the menu itself.
  function activeInPanel(panel) {
    var el = document.activeElement;
    return !!(panel.__wrap && el && panel.__wrap.contains(el));
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openEl && openEl.__close) openEl.__close();
  });
  document.addEventListener('click', function () {
    setTimeout(function () {
      if (openEl && !activeInPanel(openEl)) openEl.__close();
    }, 0);
  });

  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  global.VJPicker = { init: init, open: openOne, close: function () { if (openEl && openEl.__close) openEl.__close(); } };
})(window);
