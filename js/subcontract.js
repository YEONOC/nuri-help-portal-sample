/* subcontract.js — 임가공 관리 화면 (계산은 subcontract-calc.js, ERP 자료는 erp-data.js) */
(function () {
  'use strict';

  var E = window.ErpData, SC = window.SubcontractCalc, S = window.SampleData;
  if (!E || !SC || !S) return;
  var K = S.KEYS;

  var state = { vendors: [], rawCodes: [], prdCodes: [], rates: [], history: [] };
  var store = E.emptyStore();
  var selectedVendor = '';

  /* ── 공통 ────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
  function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function monthLabel(m) { return m ? m.slice(0, 4) + '년 ' + Number(m.slice(5, 7)) + '월' : ''; }
  function getJson(key) {
    try { var v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function setJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 무시 */ } }

  /* 브라우저 저장은 편의 기능. 실패해도 화면은 그대로 동작 */
  function load() {
    state.vendors = getJson(K.skVendors); state.rawCodes = getJson(K.skRaw); state.prdCodes = getJson(K.skPrd);
    state.rates = getJson(K.skRates); state.history = getJson(K.skHistory);
    store = E.load();
  }
  function save() {
    setJson(K.skVendors, state.vendors); setJson(K.skRaw, state.rawCodes); setJson(K.skPrd, state.prdCodes);
    setJson(K.skRates, state.rates); setJson(K.skHistory, state.history);
  }
  function runCompute() { return SC.compute(state, store); }

  function readFile(file, onText, msgEl) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try { onText(String(e.target.result)); }
      catch (err) { msgEl.textContent = 'CSV를 읽지 못했어요. 첫 행의 열 이름과 UTF-8 인코딩을 확인해 주세요.'; }
    };
    reader.onerror = function () { msgEl.textContent = '파일을 열지 못했어요. 다시 선택해 주세요.'; };
    reader.readAsText(file, 'UTF-8');
  }
  function chip(level, text) { return '<span class="state state--' + level + '">' + esc(text) + '</span>'; }
  function statCard(label, value) {
    return '<div class="stat-card"><div class="stat-card__label">' + esc(label) + '</div><div class="stat-card__value">' + esc(value) + '</div></div>';
  }
  function callout(kind, icon, title, items) {
    if (!items.length) return '';
    return '<div class="callout callout--' + kind + '"><span class="callout__icon" aria-hidden="true">' + icon + '</span>' +
      '<div class="callout__body"><strong class="callout__title">' + esc(title) + ' (' + items.length + '건)</strong>' +
      '<ul class="alert-list">' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></div>';
  }
  function vendorOptions(selected) {
    return state.vendors.map(function (v) {
      return '<option value="' + esc(v.name) + '"' + (v.name === selected ? ' selected' : '') + '>' + esc(v.name) + '</option>';
    }).join('');
  }
  function vendorOf(code) {
    var c = state.rawCodes.filter(function (x) { return x.code === code; })[0];
    return c ? c.vendor : '';
  }

  /* ── 탭 ──────────────────────────────────────────────── */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tool-tab'));
  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    renderAll();
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { selectTab(tab, false); });
    tab.addEventListener('keydown', function (e) {
      var next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(i + tabs.length - 1) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); selectTab(next, true); }
    });
  });

  /* ── 설정 ────────────────────────────────────────────── */
  function msg(text) { $('settings-msg').textContent = text; }

  /* 품목 코드 하나는 한 업체에만: 이미 있으면 경고하고 막음 */
  function dupMessage(code, skip) {
    var owner = SC.codeOwner(state, code, skip);
    if (!owner) return '';
    return code + '는 이미 ' + owner.vendor + '의 ' + (owner.kind === 'rawCodes' ? '원료' : '제품') + ' 코드로 등록돼 있어요. 품목 코드 하나는 한 업체에만 둘 수 있어요.';
  }

  function renderSettings() {
    $('vendor-body').innerHTML = state.vendors.length ? state.vendors.map(function (v, i) {
      var nRaw = state.rawCodes.filter(function (c) { return c.vendor === v.name; }).length;
      var nPrd = state.prdCodes.filter(function (c) { return c.vendor === v.name; }).length;
      return '<tr><td>' + esc(v.name) + '</td><td class="num">' + nRaw + '</td><td class="num">' + nPrd + '</td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-del-vendor="' + i + '" aria-label="' + esc(v.name) + ' 지우기">지우기</button></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty-cell">등록된 업체가 없어요.</td></tr>';

    function codeRows(list, kind) {
      return list.length ? list.map(function (c, i) {
        var n = i + 1, label = kind === 'raw' ? '원료' : '제품';
        return '<tr><td><input class="field" data-kind="' + kind + '" data-i="' + i + '" data-f="code" value="' + esc(c.code) + '" aria-label="' + label + ' 품목 코드 ' + n + '" autocomplete="off"></td>' +
          '<td><input class="field" data-kind="' + kind + '" data-i="' + i + '" data-f="name" value="' + esc(c.name) + '" aria-label="' + label + ' 품목명 ' + n + '" autocomplete="off"></td>' +
          '<td><select class="field" data-kind="' + kind + '" data-i="' + i + '" data-f="vendor" aria-label="' + label + ' 업체 ' + n + '">' + vendorOptions(c.vendor) + '</select></td>' +
          '<td><button type="button" class="btn btn--secondary btn--small" data-del-code="' + kind + '" data-i="' + i + '" aria-label="' + label + ' 코드 ' + esc(c.code) + ' 지우기">지우기</button></td></tr>';
      }).join('') : '<tr><td colspan="4" class="empty-cell">등록된 코드가 없어요.</td></tr>';
    }
    $('raw-body').innerHTML = codeRows(state.rawCodes, 'raw');
    $('prd-body').innerHTML = codeRows(state.prdCodes, 'prd');
    $('raw-vendor').innerHTML = vendorOptions($('raw-vendor').value);
    $('prd-vendor').innerHTML = vendorOptions($('prd-vendor').value);
    $('rate-code').innerHTML = state.rawCodes.map(function (c) {
      return '<option value="' + esc(c.code) + '">' + esc(c.code + ' ' + c.name + ' (' + c.vendor + ')') + '</option>';
    }).join('');
    if (!$('rate-year').value) $('rate-year').value = today().slice(0, 4);

    var rates = state.rates.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      return a.r.code.localeCompare(b.r.code) || String(a.r.year).localeCompare(String(b.r.year));
    });
    $('rate-body').innerHTML = rates.length ? rates.map(function (x) {
      var r = x.r;
      return '<tr><td><code>' + esc(r.code) + '</code></td><td>' + esc(vendorOf(r.code) || '(업체 없음)') + '</td><td>' + esc(r.year) + '</td>' +
        '<td><input type="number" class="field field--num" min="0" max="100" step="0.1" data-rate="' + x.i + '" value="' + esc(r.r) + '" aria-label="' + esc(r.code + ' ' + r.year) + '년 회수율"></td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-del-rate="' + x.i + '" aria-label="' + esc(r.code + ' ' + r.year) + '년 회수율 지우기">지우기</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty-cell">등록된 회수율이 없어요.</td></tr>';

    $('history-body').innerHTML = state.history.length ? state.history.slice().reverse().map(function (h) {
      return '<tr><td>' + esc(h.at) + '</td><td><code>' + esc(h.code) + '</code></td><td>' + esc(h.year) + '</td>' +
        '<td class="num">' + (h.before === null || h.before === undefined ? '—' : fmt(h.before)) + '</td><td class="num">' + (h.after === null ? '지움' : fmt(h.after)) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty-cell">바꾼 기록이 없어요.</td></tr>';
  }

  function setRate(code, year, value) {
    var existing = state.rates.filter(function (r) { return r.code === code && String(r.year) === String(year); })[0];
    var before = existing ? Number(existing.r) : null;
    if (existing) existing.r = value; else state.rates.push({ code: code, year: String(year), r: value });
    if (before !== value) state.history.push({ at: today(), code: code, year: String(year), before: before, after: value });
  }

  $('form-vendor').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('vendor-name').value.trim();
    if (!name) { msg('업체 이름을 적어 주세요.'); return; }
    if (state.vendors.some(function (v) { return v.name === name; })) { msg(name + '는 이미 있어요.'); return; }
    state.vendors.push({ name: name }); $('vendor-name').value = '';
    msg(name + '를 추가했어요.'); save(); renderSettings();
  });

  function addCode(kind, codeId, nameId, vendorId) {
    var code = $(codeId).value.trim(), name = $(nameId).value.trim(), vendor = $(vendorId).value;
    if (!code || !vendor) { msg('품목 코드와 업체를 적어 주세요. 업체가 없으면 먼저 추가해 주세요.'); return; }
    var dup = dupMessage(code);
    if (dup) { msg(dup); return; }
    (kind === 'raw' ? state.rawCodes : state.prdCodes).push({ code: code, name: name, vendor: vendor });
    $(codeId).value = ''; $(nameId).value = '';
    msg(code + '를 ' + vendor + '에 추가했어요.'); save(); renderSettings();
  }
  $('form-raw').addEventListener('submit', function (e) { e.preventDefault(); addCode('raw', 'raw-code', 'raw-name', 'raw-vendor'); });
  $('form-prd').addEventListener('submit', function (e) { e.preventDefault(); addCode('prd', 'prd-code', 'prd-name', 'prd-vendor'); });

  $('form-rate').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('rate-code').value, year = String(Math.round(Number($('rate-year').value))), v = $('rate-value').value;
    if (!code) { msg('원료 코드를 먼저 등록해 주세요.'); return; }
    if (!/^\d{4}$/.test(year) || v === '' || isNaN(Number(v))) { msg('연도와 회수율을 적어 주세요.'); return; }
    setRate(code, year, Number(v)); $('rate-value').value = '';
    msg(code + ' ' + year + '년 회수율을 ' + Number(v) + '%로 정했어요. 그해 줘야 할 양을 다시 계산했어요.');
    save(); renderSettings();
  });

  $('panel-settings').addEventListener('change', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-rate')) {
      var r = state.rates[Number(el.getAttribute('data-rate'))];
      if (!r) return;
      if (el.value === '' || isNaN(Number(el.value))) { el.value = r.r; msg('회수율은 숫자로 적어 주세요.'); return; }
      setRate(r.code, r.year, Number(el.value));
      msg(r.code + ' ' + r.year + '년 회수율을 ' + Number(el.value) + '%로 바꿨어요. 그해 줘야 할 양을 다시 계산했어요.');
      save(); renderSettings();
      return;
    }
    var kind = el.getAttribute('data-kind'), f = el.getAttribute('data-f'), i = Number(el.getAttribute('data-i'));
    if (!kind || !f) return;
    var list = kind === 'raw' ? state.rawCodes : state.prdCodes, item = list[i];
    if (!item) return;
    var value = el.value.trim();
    if (f === 'code') {
      var dup = dupMessage(value, { kind: kind === 'raw' ? 'rawCodes' : 'prdCodes', index: i });
      if (!value || dup) { el.value = item.code; msg(dup || '품목 코드를 비울 수 없어요.'); return; }
      if (kind === 'raw') state.rates.forEach(function (r) { if (r.code === item.code) r.code = value; });
    }
    item[f] = value;
    save(); renderSettings();
  });

  $('panel-settings').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-del-vendor')) {
      var v = state.vendors[Number(btn.getAttribute('data-del-vendor'))];
      if (!v) return;
      var used = state.rawCodes.concat(state.prdCodes).some(function (c) { return c.vendor === v.name; });
      if (used) { msg(v.name + '의 원료·제품 코드를 먼저 지워 주세요.'); return; }
      if (!window.confirm(v.name + '를 지울까요?')) return;
      state.vendors = state.vendors.filter(function (x) { return x !== v; });
      msg(v.name + '를 지웠어요.');
    } else if (btn.hasAttribute('data-del-code')) {
      var kind = btn.getAttribute('data-del-code'), list = kind === 'raw' ? state.rawCodes : state.prdCodes;
      var c = list[Number(btn.getAttribute('data-i'))];
      if (!c || !window.confirm(c.code + '를 지울까요? 이 코드의 입출고는 계산에서 빠져요.')) return;
      list.splice(list.indexOf(c), 1);
      msg(c.code + '를 지웠어요.');
    } else if (btn.hasAttribute('data-del-rate')) {
      var r = state.rates[Number(btn.getAttribute('data-del-rate'))];
      if (!r || !window.confirm(r.code + ' ' + r.year + '년 회수율을 지울까요?')) return;
      state.history.push({ at: today(), code: r.code, year: String(r.year), before: Number(r.r), after: null });
      state.rates.splice(state.rates.indexOf(r), 1);
      msg(r.code + ' ' + r.year + '년 회수율을 지웠어요. 이력에 남겼어요.');
    } else return;
    save(); renderSettings();
  });

  /* ── ERP 자료 ────────────────────────────────────────── */
  function uploadErp(inputId, parse, merge, label) {
    $(inputId).addEventListener('change', function () {
      var file = this.files[0], m = $('erp-msg');
      if (!file) return;
      readFile(file, function (text) {
        store = E.load();
        var res = merge(store, parse(text));
        E.save(store);
        m.textContent = file.name + ' — ' + label + ' 새로 ' + res.added + '건, 바꿈 ' + res.updated + '건' +
          (res.bad ? ', 읽지 못한 ' + res.bad + '행(CSV ' + res.badLines.slice(0, 10).join(', ') + '행)' : '') + '.';
        renderErp();
      }, m);
      this.value = '';
    });
  }
  uploadErp('inbound-file', E.parseInboundCsv, E.mergeInbound, '입고');
  uploadErp('orders-file', E.parseOrdersCsv, E.mergeOrders, '주문');
  uploadErp('ships-file', E.parseShipmentsCsv, E.mergeShipments, '출고');

  function renderErp() {
    var res = runCompute(), c = res.counts;
    $('erp-summary').innerHTML = '<h2>쌓인 자료</h2><div class="stat-grid">' +
      statCard('입고', fmt(Object.keys(store.inbound).length) + '건') + statCard('임가공 원료 입고', fmt(c.inboundUsed) + '건') +
      statCard('주문', fmt(Object.keys(store.orders).length) + '건') + statCard('임가공 제품 출고', fmt(c.ships) + '건') + '</div>';
  }

  /* ── 현황 ────────────────────────────────────────────── */
  function currentText(v) {
    if (!v.current) return v.owed > 0 ? '남은 양 없음' : '받은 원료 없음';
    return monthLabel(v.current.month) + '분 ' + (v.current.started ? '갚는 중' : '차례');
  }

  function renderStatus() {
    var res = runCompute(), a = res.alerts;
    $('status-alerts').innerHTML =
      callout('warn', '⚠', '참고 — 회수율', a.rate) +
      callout('warn', '⚠', '참고 — 줘야 할 양보다 더 내줌', a.extra) +
      callout('info', 'ℹ', '참고 — 출고일 추정', a.estimated) +
      callout('info', 'ℹ', '참고 — 계산에서 뺀 자료', a.info);
    if (!res.vendors.length) {
      $('status-stats').innerHTML = ''; $('vendor-cards').innerHTML = ''; $('vendor-detail').innerHTML =
        '<p class="empty-cell">등록된 업체가 없어요. "견본 데이터 채우기"를 누르거나 설정 탭에서 업체와 품목 코드를 등록해 주세요.</p>';
      return;
    }
    $('status-stats').innerHTML = '<div class="stat-grid">' + statCard('받은 원료(kg)', fmt(res.totals.received)) +
      statCard('줘야 할 제품(kg)', fmt(res.totals.owed)) + statCard('내준 제품(kg)', fmt(res.totals.shipped)) +
      statCard('남은 의무량(kg)', fmt(res.totals.remain)) + '</div>';
    if (!res.vendors.some(function (v) { return v.name === selectedVendor; })) selectedVendor = res.vendors[0].name;
    $('vendor-cards').innerHTML = '<h3>업체를 누르면 월별로 볼 수 있어요</h3><div class="stat-grid">' + res.vendors.map(function (v) {
      return '<button type="button" class="stat-card stat-card--button" data-vendor="' + esc(v.name) + '" aria-pressed="' + (v.name === selectedVendor) + '" aria-controls="vendor-detail">' +
        '<div class="stat-card__label">' + esc(v.name) + ' · 남은 의무량(kg)</div><div class="stat-card__value">' + fmt(v.remain) + '</div>' +
        '<div class="stat-card__sub">' + esc(currentText(v)) + (v.extra > 0 ? ' · 더 내줌 ' + fmt(v.extra) + ' kg' : '') + '</div></button>';
    }).join('') + '</div>';
    renderDetail(res.vendors.filter(function (v) { return v.name === selectedVendor; })[0]);
  }

  function allocText(x) {
    return x.date + ' 출고 ' + x.order + ' ' + fmt(x.qty) + ' kg 중 ' + fmt(x.take) + ' kg을 차감했어요.' +
      (x.estimated ? ' 출고일은 납기일로 추정했어요.' : '') +
      (x.rest > 0.0001 ? ' 나머지 ' + fmt(x.rest) + ' kg은 다음 달분에서 차감해요.' : '');
  }

  function renderDetail(v) {
    var box = $('vendor-detail');
    if (!v) { box.innerHTML = ''; return; }
    if (!v.months.length) { box.innerHTML = '<p class="empty-cell">' + esc(v.name) + '에서 받은 원료가 없어요.</p>'; return; }
    var rows = v.months.map(function (m, i) {
      var id = 'month-' + i;
      var items = m.lines.map(function (l) {
        return esc(l.name) + ' ' + fmt(l.qty) + ' kg × ' + (l.rate === null ? '회수율 없음' : fmt(l.rate) + '%' + (l.rateFrom ? ' (' + l.rateFrom + '년 값)' : ''));
      }).join('<br>');
      var state = m.remain <= 0.0001 ? chip('muted', '다 갚음') : (m.deducted > 0.0001 ? chip('ok', '갚는 중') : chip('muted', '차례 전'));
      var toggle = m.allocs.length ? '<button type="button" class="detail-toggle" aria-expanded="false" aria-controls="' + id + '" aria-label="차감 내역 보기">내역</button>' : '';
      var detail = m.allocs.length ? '<tr class="detail-row" id="' + id + '" hidden><td colspan="7"><ul>' +
        m.allocs.map(function (x) { return '<li>' + esc(allocText(x)) + '</li>'; }).join('') + '</ul></td></tr>' : '';
      return '<tr><td>' + esc(monthLabel(m.month)) + '</td><td class="wrap">' + items + '</td><td class="num">' + fmt(m.owed) + '</td>' +
        '<td class="num">' + fmt(m.deducted) + '</td><td class="num">' + fmt(m.remain) + '</td><td>' + state + '</td><td class="col-detail">' + toggle + '</td></tr>' + detail;
    }).join('');
    box.innerHTML = '<div class="group-card"><div class="group-card__head"><h3>' + esc(v.name) + ' — 월별</h3>' +
      '<span class="hint">' + esc(currentText(v)) + '</span></div><div class="table-wrap"><table><thead><tr><th>받은 달</th><th>받은 원료 × 회수율</th>' +
      '<th class="num">줘야 할(kg)</th><th class="num">차감(kg)</th><th class="num">남은(kg)</th><th>상태</th><th class="col-detail">내역</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td>합계</td><td>받은 원료 ' + fmt(v.received) + ' kg</td><td class="num">' + fmt(v.owed) + '</td><td class="num">' +
      fmt(v.shipped - v.extra) + '</td><td class="num">' + fmt(v.remain) + '</td><td colspan="2"></td></tr></tfoot></table></div></div>';
  }

  $('vendor-cards').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-vendor]');
    if (!btn) return;
    selectedVendor = btn.getAttribute('data-vendor');
    renderStatus();
    var again = document.querySelector('[data-vendor="' + CSS.escape(selectedVendor) + '"]');
    if (again) again.focus();
  });
  $('vendor-detail').addEventListener('click', function (e) {
    var btn = e.target.closest('.detail-toggle');
    if (!btn) return;
    var row = $(btn.getAttribute('aria-controls')), open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    btn.textContent = open ? '내역' : '접기';
    btn.setAttribute('aria-label', open ? '차감 내역 보기' : '차감 내역 접기');
    if (row) row.hidden = open;
  });

  /* ── 견본 · 모두 지우기 ──────────────────────────────── */
  $('btn-sample').addEventListener('click', function () {
    var m = $('top-msg');
    if (!window.confirm('총량계약 현황과 임가공 관리의 내용을 모두 지우고 견본 데이터로 바꿀까요? 두 도구는 ERP 자료를 함께 써요.')) return;
    S.clearAll();
    S.fill('../data/samples/').then(function () {
      load(); selectedVendor = '';
      m.textContent = '견본 데이터를 채웠어요. 총량계약 현황에도 같은 견본이 들어갔어요.';
      selectTab($('tab-status'), false);
    }).catch(function () {
      m.textContent = '견본 파일을 읽지 못했어요. 견본 CSV를 내려받아 직접 올려 주세요.';
    });
  });
  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('총량계약 현황과 임가공 관리의 설정·계약·ERP 자료를 이 브라우저에서 모두 지울까요? 되돌릴 수 없어요.')) return;
    S.clearAll(); load(); renderAll();
    $('top-msg').textContent = '모두 지웠어요.';
  });

  /* ── 시작 ────────────────────────────────────────────── */
  function renderAll() { renderSettings(); renderErp(); renderStatus(); }
  load();
  renderAll();
})();
