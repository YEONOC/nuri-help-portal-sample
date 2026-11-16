/* subcontract.js — 임가공 대조 화면 (계산은 subcontract-calc.js) */
(function () {
  'use strict';

  var SC = window.Subcontract;
  if (!SC) return;

  var KEYS = { codes: 'sc_codes', rates: 'sc_rates', orders: 'sc_orders', io: 'sc_io', done: 'sc_done', staleMonths: 'sc_stale' };
  var state = { codes: [], rates: [], orders: [], io: [], done: {}, staleMonths: 3 };
  var openFamilies = {};
  var PREVIEW_ROWS = 30;

  var SAMPLE = {
    codes: [
      { code: 'NR-90-0001', name: '원료 S1', type: 'raw', family: 'A형 계열' },
      { code: 'NR-90-0002', name: '원료 S2', type: 'raw', family: 'B형 계열' },
      { code: 'NR-01-0001', name: '합금 소재 A형', type: 'prd', family: 'A형 계열' },
      { code: 'NR-02-0003', name: '합금 소재 B형', type: 'prd', family: 'B형 계열' }
    ],
    rates: [
      { vendor: '', family: 'A형 계열', m: '2026-04', r: 90 },
      { vendor: '', family: 'A형 계열', m: '2026-05', r: 91 },
      { vendor: '', family: 'A형 계열', m: '2026-06', r: 90 },
      { vendor: '임가공업체 Q', family: 'B형 계열', m: '2026-06', r: 88 }
    ],
    done: [{ vendor: '임가공업체 P', no: 'SC-2026-001', family: 'A형 계열', month: '2026-04', closedAt: '2026-08-05' }]
  };

  /* ── 공통 ────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /* 브라우저 저장은 편의 기능. 실패해도 화면은 그대로 동작 */
  function load() {
    Object.keys(KEYS).forEach(function (k) {
      try {
        var v = JSON.parse(localStorage.getItem(KEYS[k]));
        if (v !== null && v !== undefined) state[k] = v;
      } catch (e) { /* 무시 */ }
    });
    ['codes', 'rates', 'orders', 'io'].forEach(function (k) { if (!Array.isArray(state[k])) state[k] = []; });
    if (!state.done || typeof state.done !== 'object' || Array.isArray(state.done)) state.done = {};
    if (!(Number(state.staleMonths) > 0)) state.staleMonths = 3;
  }
  function save() {
    Object.keys(KEYS).forEach(function (k) {
      try { localStorage.setItem(KEYS[k], JSON.stringify(state[k])); } catch (e) { /* 무시 */ }
    });
  }
  function runCompute() {
    return SC.compute({
      codes: state.codes, rates: state.rates, orders: state.orders, done: state.done,
      staleMonths: state.staleMonths, today: today()
    }, state.io);
  }

  function readFile(file, onText, msgEl) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try { onText(String(e.target.result)); }
      catch (err) { msgEl.textContent = 'CSV를 읽지 못했어요. 첫 행의 열 이름과 UTF-8 인코딩을 확인해 주세요.'; }
    };
    reader.onerror = function () { msgEl.textContent = '파일을 열지 못했어요. 다시 선택해 주세요.'; };
    reader.readAsText(file, 'UTF-8');
  }

  function vendors() {
    var list = [];
    state.orders.forEach(function (o) { if (o.vendor && list.indexOf(o.vendor) === -1) list.push(o.vendor); });
    state.rates.forEach(function (r) { if (r.vendor && list.indexOf(r.vendor) === -1) list.push(r.vendor); });
    return list.sort();
  }
  function familyNames() {
    var list = [];
    state.codes.forEach(function (c) { if (c.family && list.indexOf(c.family) === -1) list.push(c.family); });
    state.rates.forEach(function (r) { if (r.family && list.indexOf(r.family) === -1) list.push(r.family); });
    Object.keys(openFamilies).forEach(function (f) { if (list.indexOf(f) === -1) list.push(f); });
    return list;
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
    if (tab.id === 'tab-io') renderIoPreview();
    if (tab.id === 'tab-result') renderResult();
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

  /* ── 1. 설정: 품목 코드 ──────────────────────────────── */
  function renderCodes() {
    var body = $('codes-body');
    if (!state.codes.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-cell">품목이 없어요. 아래 버튼으로 추가해 주세요.</td></tr>';
      return;
    }
    body.innerHTML = state.codes.map(function (c, i) {
      var n = i + 1;
      return '<tr>' +
        '<td><input class="field" data-i="' + i + '" data-f="code" value="' + esc(c.code) + '" aria-label="품목 코드 ' + n + '" autocomplete="off"></td>' +
        '<td><input class="field" data-i="' + i + '" data-f="name" value="' + esc(c.name) + '" aria-label="품목명 ' + n + '" autocomplete="off"></td>' +
        '<td><select class="field" data-i="' + i + '" data-f="type" aria-label="구분 ' + n + '">' +
          '<option value="raw"' + (c.type !== 'prd' ? ' selected' : '') + '>원료 (보냄)</option>' +
          '<option value="prd"' + (c.type === 'prd' ? ' selected' : '') + '>가공품 (받음)</option></select></td>' +
        '<td><input class="field" data-i="' + i + '" data-f="family" list="family-options" value="' + esc(c.family) + '" aria-label="계열 ' + n + '" autocomplete="off"></td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-del-code="' + i + '" aria-label="품목 ' + n + ' 지우기">지우기</button></td>' +
        '</tr>';
    }).join('');
  }

  $('codes-body').addEventListener('change', function (e) {
    var el = e.target, i = Number(el.getAttribute('data-i')), f = el.getAttribute('data-f');
    if (!f || !state.codes[i]) return;
    state.codes[i][f] = el.value.trim();
    if (f === 'family' && state.codes[i].family) openFamilies[state.codes[i].family] = true;
    save(); renderFamilies();
  });
  $('codes-body').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-code]');
    if (!btn) return;
    state.codes.splice(Number(btn.getAttribute('data-del-code')), 1);
    save(); renderCodes(); renderFamilies();
  });
  $('btn-add-code').addEventListener('click', function () {
    state.codes.push({ code: '', name: '', type: 'raw', family: '' });
    save(); renderCodes();
    var inputs = $('codes-body').querySelectorAll('[data-f="code"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  /* ── 1. 설정: 기준 회수율 ────────────────────────────── */
  function nextMonth(m) {
    var p = /^(\d{4})-(\d{2})$/.exec(m || '');
    if (!p) return '';
    var y = Number(p[1]), mo = Number(p[2]) + 1;
    if (mo > 12) { mo = 1; y++; }
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }

  function renderFamilies() {
    var names = familyNames(), vs = vendors();
    $('family-options').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    var box = $('families-box');
    if (!names.length) {
      box.innerHTML = '<p class="hint">계열이 없어요. 품목 코드의 계열 칸에 이름을 적거나 아래에서 추가해 주세요.</p>';
      return;
    }
    box.innerHTML = names.map(function (name) {
      var rows = [];
      state.rates.forEach(function (r, ri) { if (r.family === name) rows.push({ r: r, ri: ri }); });
      var body = rows.map(function (x, k) {
        var r = x.r, ri = x.ri, label = esc(name) + ' ' + (k + 1);
        var opts = '<option value=""' + (!r.vendor ? ' selected' : '') + '>공통</option>' +
          vs.map(function (v) { return '<option value="' + esc(v) + '"' + (r.vendor === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
        return '<tr>' +
          '<td><select class="field" data-ri="' + ri + '" data-f="vendor" aria-label="' + label + ' 업체">' + opts + '</select></td>' +
          '<td><input type="month" class="field" data-ri="' + ri + '" data-f="m" value="' + esc(r.m) + '" aria-label="' + label + ' 연월"></td>' +
          '<td><input type="number" class="field field--num" min="0" step="0.1" data-ri="' + ri + '" data-f="r" value="' + esc(r.r) + '" aria-label="' + label + ' 회수율"></td>' +
          '<td><button type="button" class="btn btn--secondary btn--small" data-del-rate="' + ri + '" aria-label="' + label + ' 회수율 지우기">지우기</button></td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="4" class="empty-cell">회수율이 없어요.</td></tr>';
      var codes = state.codes.filter(function (c) { return c.family === name && c.type !== 'prd' && c.code; })
        .map(function (c) { return c.code; });
      return '<details class="family-box" data-name="' + esc(name) + '"' + (openFamilies[name] ? ' open' : '') + '>' +
        '<summary>' + esc(name) + '<span>' + rows.length + '개 등록' +
          (codes.length ? ' · 원료 ' + esc(codes.join(', ')) : ' · 연결된 원료 없음') + '</span></summary>' +
        '<div class="family-box__body"><div class="table-wrap"><table>' +
        '<thead><tr><th>업체</th><th>연월</th><th class="num">회수율(%)</th><th><span class="sr-only">지우기</span></th></tr></thead>' +
        '<tbody>' + body + '</tbody></table></div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn btn--secondary btn--small" data-add-rate="' + esc(name) + '">회수율 추가</button>' +
          '<button type="button" class="btn btn--danger btn--small" data-del-family="' + esc(name) + '">계열 회수율 모두 지우기</button>' +
        '</div></div></details>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('details'), function (d) {
      d.addEventListener('toggle', function () { openFamilies[d.getAttribute('data-name')] = d.open; });
    });
  }

  $('families-box').addEventListener('change', function (e) {
    var el = e.target, f = el.getAttribute('data-f'), r = state.rates[Number(el.getAttribute('data-ri'))];
    if (!f || !r) return;
    r[f] = f === 'r' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    save();
  });
  $('families-box').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var name;
    if (btn.hasAttribute('data-add-rate')) {
      name = btn.getAttribute('data-add-rate');
      var last = null;
      state.rates.forEach(function (r) { if (r.family === name) last = r; });
      state.rates.push({ vendor: last ? last.vendor : '', family: name, m: last ? nextMonth(last.m) : '', r: last ? last.r : '' });
    } else if (btn.hasAttribute('data-del-rate')) {
      var gone = state.rates.splice(Number(btn.getAttribute('data-del-rate')), 1)[0];
      name = gone && gone.family;
    } else if (btn.hasAttribute('data-del-family')) {
      name = btn.getAttribute('data-del-family');
      if (!window.confirm(name + '의 회수율을 모두 지울까요? 되돌릴 수 없어요.')) return;
      state.rates = state.rates.filter(function (r) { return r.family !== name; });
    } else return;
    if (name) openFamilies[name] = true;
    save(); renderFamilies();
  });
  $('form-add-family').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('new-family').value.trim();
    if (!name) return;
    openFamilies[name] = true;
    $('new-family').value = '';
    renderFamilies();
  });

  $('stale-months').addEventListener('change', function () {
    var n = Math.round(Number(this.value));
    state.staleMonths = n > 0 ? n : 3;
    this.value = state.staleMonths;
    save();
  });
  $('form-stale').addEventListener('submit', function (e) { e.preventDefault(); });

  /* ── 2. 의뢰 등록 ────────────────────────────────────── */
  function addOrders(list) {
    var added = 0, skipped = 0;
    list.forEach(function (o) {
      if (state.orders.some(function (x) { return x.no === o.no; })) skipped++;
      else { state.orders.push({ vendor: o.vendor, no: o.no, note: o.note }); added++; }
    });
    return { added: added, skipped: skipped };
  }

  function renderOrders() {
    var body = $('order-body');
    if (!state.orders.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-cell">등록된 의뢰가 없어요. 의뢰서 CSV를 올리거나 아래에서 추가해 주세요.</td></tr>';
      return;
    }
    body.innerHTML = state.orders.map(function (o, i) {
      return '<tr><td>' + esc(o.vendor) + '</td><td><code>' + esc(o.no) + '</code></td><td class="wrap">' + esc(o.note) + '</td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-del-order="' + i + '" aria-label="' + esc(o.no) + ' 지우기">지우기</button></td></tr>';
    }).join('');
  }

  $('order-file').addEventListener('change', function () {
    var file = this.files[0], msg = $('order-msg');
    if (!file) return;
    readFile(file, function (text) {
      var list = SC.parseOrderCsv(text);
      if (!list.length) { msg.textContent = file.name + ' — 관리번호를 찾지 못했어요. 첫 행의 열 이름을 확인해 주세요.'; return; }
      var res = addOrders(list);
      save(); renderOrders(); renderFamilies();
      msg.textContent = !res.added
        ? file.name + ' — 새로 등록할 의뢰가 없어요. ' + res.skipped + '개 모두 이미 있어요.'
        : file.name + ' — 의뢰 ' + res.added + '개를 등록했어요.' + (res.skipped ? ' 이미 있는 ' + res.skipped + '개는 건너뛰었어요.' : '');
    }, msg);
    this.value = '';
  });
  $('order-body').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-order]');
    if (!btn) return;
    state.orders.splice(Number(btn.getAttribute('data-del-order')), 1);
    save(); renderOrders(); renderFamilies();
  });
  $('form-add-order').addEventListener('submit', function (e) {
    e.preventDefault();
    var o = { vendor: $('order-vendor').value.trim(), no: $('order-no').value.trim(), note: $('order-note').value.trim() };
    var msg = $('order-msg');
    if (!o.vendor || !o.no) { msg.textContent = '업체와 관리번호를 적어 주세요.'; return; }
    var res = addOrders([o]);
    msg.textContent = res.added ? o.no + '를 등록했어요.' : '같은 관리번호가 이미 있어요.';
    if (res.added) { ['order-vendor', 'order-no', 'order-note'].forEach(function (id) { $(id).value = ''; }); }
    save(); renderOrders(); renderFamilies();
  });

  /* ── 3. 입출고 올리기 ────────────────────────────────── */
  var KIND_LABEL = {
    sent: ['ok', '보냄 반영'], recv: ['ok', '받음 반영'], nomatch: ['warn', '의뢰 없음'],
    skip: ['muted', '대상 아님'], bad: ['danger', '읽지 못함']
  };
  function chip(level, text) { return '<span class="state state--' + level + '">' + esc(text) + '</span>'; }
  function statCard(label, value) {
    return '<div class="stat-card"><div class="stat-card__label">' + esc(label) + '</div><div class="stat-card__value">' + esc(value) + '</div></div>';
  }

  $('io-file').addEventListener('change', function () {
    var file = this.files[0], msg = $('io-msg');
    if (!file) return;
    readFile(file, function (text) {
      var rows = SC.parseIoCsv(text);
      if (!rows.length) { msg.textContent = file.name + ' — 읽을 행이 없어요. 파일 내용을 확인해 주세요.'; return; }
      state.io = rows;
      save(); renderIoPreview();
      msg.textContent = file.name + ' — ' + rows.length + '행을 읽었어요. 4번 탭에서 결과를 확인해 주세요.';
    }, msg);
    this.value = '';
  });

  function renderIoPreview() {
    var box = $('io-preview');
    if (!state.io.length) { box.innerHTML = ''; return; }
    var res = runCompute(), c = res.counts;
    var html = '<h2>읽은 결과</h2><div class="stat-grid">' +
      statCard('전체 행', fmt(c.total)) + statCard('보냄 반영', fmt(c.sent)) + statCard('받음 반영', fmt(c.recv)) +
      statCard('뺀 행', fmt(c.nomatch + c.skip + c.bad)) + '</div>';
    if (!state.orders.length) {
      html += '<div class="callout callout--warn"><span class="callout__icon" aria-hidden="true">⚠</span><div class="callout__body">' +
        '<strong class="callout__title">주의</strong><p>등록된 의뢰가 없어 모든 행이 빠졌어요. 2번 탭에서 의뢰를 먼저 등록해 주세요.</p></div></div>';
    }
    html += '<div class="table-wrap"><table><thead><tr><th class="num">CSV 행</th><th>구분</th><th>관리번호</th><th>품목 코드</th>' +
      '<th>날짜</th><th class="num">수량(kg)</th><th>처리</th></tr></thead><tbody>' +
      state.io.slice(0, PREVIEW_ROWS).map(function (r, i) {
        var k = KIND_LABEL[res.rowKinds[i]];
        return '<tr><td class="num">' + r.line + '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.po) + '</td><td><code>' + esc(r.code) +
          '</code></td><td>' + (esc(r.date) || '—') + '</td><td class="num">' + (r.qty === null ? '—' : fmt(r.qty)) + '</td><td>' +
          chip(k[0], k[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (state.io.length > PREVIEW_ROWS) html += '<p class="hint">앞의 ' + PREVIEW_ROWS + '행만 보여 줘요. 계산에는 모든 행을 써요.</p>';
    box.innerHTML = html;
  }

  /* ── 4. 대조 결과 ────────────────────────────────────── */
  var lastResult = null;
  var LEVEL_CHIP = { ok: ['ok', '정상'], warn: ['warn', '참고 표시 있음'], danger: ['danger', '확인 필요 · 덜 받음'] };
  var STATUS_CHIP = { '미회수': 'muted', '회수 중': 'ok', '소진': 'muted', '완료': 'muted', '완료 · 덜 받음': 'danger' };

  function callout(kind, icon, title, items) {
    if (!items.length) return '';
    return '<div class="callout callout--' + kind + '"><span class="callout__icon" aria-hidden="true">' + icon + '</span>' +
      '<div class="callout__body"><strong class="callout__title">' + esc(title) + ' (' + items.length + '건)</strong>' +
      '<ul class="alert-list">' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></div>';
  }

  function renderResult() {
    var alerts = $('result-alerts'), stats = $('result-stats'), filter = $('result-filter'), groups = $('result-groups');
    lastResult = null;
    alerts.innerHTML = ''; stats.innerHTML = ''; filter.hidden = true;
    $('stale-months').value = state.staleMonths;
    if (!state.io.length) {
      groups.innerHTML = '<p class="empty-cell">아직 계산할 내용이 없어요. 2번 탭에서 의뢰를 등록하고 3번 탭에서 입출고 목록을 올려 주세요.</p>';
      return;
    }
    var res = lastResult = runCompute(), a = res.alerts;
    alerts.innerHTML =
      callout('danger', '✕', '확인 필요 — 완료했는데 덜 받음', a.danger) +
      callout('warn', '⚠', '참고 — 오래 받지 못한 양', a.stale) +
      callout('warn', '⚠', '참고 — 회수율', a.rate) +
      callout('warn', '⚠', '참고 — 받아야 할 양보다 더 받음', a.extra) +
      callout('warn', '⚠', '참고 — 보내기 전에 받은 소재', a.early) +
      callout('info', 'ℹ', '참고 — 계산에서 뺀 행', a.info);
    stats.innerHTML = '<div class="stat-grid">' +
      statCard('보낸 원료(kg)', fmt(res.totals.sent)) + statCard('받아야 할 소재(kg)', fmt(res.totals.expected)) +
      statCard('받은 소재(kg)', fmt(res.totals.received)) + statCard('업체에 남은 원료(kg)', fmt(res.totals.remainRaw)) + '</div>';

    var vs = [];
    res.groups.forEach(function (g) { if (vs.indexOf(g.vendor) === -1) vs.push(g.vendor); });
    var prev = $('filter-vendor').value;
    $('filter-vendor').innerHTML = '<option value="">전체</option>' +
      vs.map(function (v) { return '<option value="' + esc(v) + '"' + (v === prev ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    filter.hidden = !res.groups.length;
    renderGroups();
  }

  function allocText(a) {
    var s = a.date + ' 입고 ' + fmt(a.qty) + ' kg 중 ' + fmt(a.take) + ' kg을 차감했어요.';
    if (a.early) s += ' 입고일이 이 원료를 보낸 달보다 앞서요(참고).';
    if (a.rest > 0.0001) s += ' 나머지 ' + fmt(a.rest) + ' kg은 다음 원료분에서 차감해요.';
    return s;
  }

  function batchState(b) {
    if (b.done) return chip(b.loss > 0 ? 'danger' : 'muted', (b.loss > 0 ? '덜 받음 ' : '완료 ') + fmt(b.actualRate) + '%');
    if (b.stale) return chip('warn', b.status + ' ' + b.elapsed + '개월');
    return chip(STATUS_CHIP[b.status], b.status);
  }

  function renderGroups() {
    var box = $('result-groups');
    if (!lastResult) return;
    var vendor = $('filter-vendor').value, issueOnly = $('filter-issue').checked;
    var list = lastResult.groups.filter(function (g) {
      return (!vendor || g.vendor === vendor) && (!issueOnly || g.level !== 'ok');
    });
    if (!lastResult.groups.length) {
      box.innerHTML = '<p class="empty-cell">대조할 행이 없어요. 등록된 관리번호와 품목 코드 설정을 확인해 주세요.</p>';
      return;
    }
    if (!list.length) { box.innerHTML = '<p class="empty-cell">조건에 맞는 의뢰가 없어요.</p>'; return; }

    box.innerHTML = list.map(function (g, gi) {
      var lv = LEVEL_CHIP[g.level];
      var rows = g.batches.map(function (b, bi) {
        var id = 'detail-' + gi + '-' + bi;
        var rate = b.rate === null ? '없음' : fmt(b.rate) +
          '<br><span class="hint">' + (b.rateScope === 'vendor' ? '업체' : '공통') + (b.rateFrom ? ' · ' + Number(b.rateFrom.slice(5)) + '월' : '') + '</span>';
        var doneBtn = b.rate === null ? '' : (b.done
          ? '<button type="button" class="detail-toggle" data-undone="' + esc(b.key) + '" aria-label="' + esc(g.label + ' ' + b.month) + '분 완료 취소">완료 취소</button>'
          : '<button type="button" class="detail-toggle" data-done="' + esc(b.key) + '" aria-label="' + esc(g.label + ' ' + b.month) + '분 완료">완료</button>');
        var toggle = b.allocs.length
          ? '<button type="button" class="detail-toggle" aria-expanded="false" aria-controls="' + id + '" aria-label="차감 내역 보기">내역</button>' : '';
        var detail = b.allocs.length
          ? '<tr class="detail-row" id="' + id + '" hidden><td colspan="9"><ul>' +
            b.allocs.map(function (x) { return '<li>' + esc(allocText(x)) + '</li>'; }).join('') + '</ul></td></tr>' : '';
        return '<tr><td>' + esc(b.month) + '</td><td>' + (esc(b.family) || '(계열 없음)') + '</td>' +
          '<td class="num">' + fmt(b.sent) + '</td><td class="num">' + rate + '</td>' +
          '<td class="num">' + fmt(b.expected) + '</td><td class="num">' + fmt(b.received) + '</td>' +
          '<td class="num">' + fmt(b.remain) + '</td><td>' + batchState(b) + '</td>' +
          '<td class="col-detail wrap">' + doneBtn + ' ' + toggle + '</td></tr>' + detail;
      }).join('');
      if (g.extra > 0) {
        rows += '<tr><td colspan="5">받아야 할 양보다 더 받은 소재</td><td class="num">' + fmt(g.extra) + '</td>' +
          '<td class="num">' + fmt(-g.extra) + '</td><td>' + chip('warn', '더 받음') + '</td><td class="col-detail"></td></tr>';
      }
      return '<div class="group-card"><div class="group-card__head"><h3>' + esc(g.label) + '</h3>' + chip(lv[0], lv[1]) + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>보낸 달</th><th>계열</th><th class="num">보낸(kg)</th>' +
        '<th class="num">회수율(%)</th><th class="num">받을(kg)</th><th class="num">받은(kg)</th>' +
        '<th class="num">남은(kg)</th><th>상태</th><th class="col-detail">처리</th></tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="2">합계</td><td class="num">' + fmt(g.sent) + '</td><td></td><td class="num">' + fmt(g.expected) +
        '</td><td class="num">' + fmt(g.received) + '</td><td class="num">' + fmt(g.remain) + '</td><td colspan="2">' +
        (g.loss > 0 ? '덜 받음 ' + fmt(g.loss) + ' kg' : '') + '</td></tr></tfoot>' +
        '</table></div></div>';
    }).join('');
  }

  /* 완료: 그때까지 이 배치에 차감된 마지막 입고일로 닫음. 이후 입고는 다음 원료분으로 */
  function findBatch(key) {
    var found = null;
    (lastResult ? lastResult.groups : []).forEach(function (g) {
      g.batches.forEach(function (b) { if (b.key === key) found = b; });
    });
    return found;
  }

  $('result-groups').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-done')) {
      var key = btn.getAttribute('data-done'), b = findBatch(key);
      var lastDate = '';
      if (b) b.allocs.forEach(function (x) { if (x.date > lastDate) lastDate = x.date; });
      state.done[key] = lastDate;
      save(); renderResult();
      $('top-msg').textContent = (b ? b.month + '분' : '배치') + '을 완료했어요.' + (lastDate ? ' ' + lastDate + ' 입고까지로 닫았어요.' : ' 받은 소재 없이 닫았어요.');
      return;
    }
    if (btn.hasAttribute('data-undone')) {
      delete state.done[btn.getAttribute('data-undone')];
      save(); renderResult();
      $('top-msg').textContent = '완료를 취소했어요.';
      return;
    }
    if (btn.hasAttribute('aria-controls')) {
      var row = $(btn.getAttribute('aria-controls'));
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      btn.textContent = open ? '내역' : '접기';
      btn.setAttribute('aria-label', open ? '차감 내역 보기' : '차감 내역 접기');
      if (row) row.hidden = open;
    }
  });
  $('filter-vendor').addEventListener('change', renderGroups);
  $('filter-issue').addEventListener('change', renderGroups);

  /* ── 견본 채우기 · 모두 지우기 ───────────────────────── */
  function hasData() {
    return state.codes.length || state.rates.length || state.orders.length || state.io.length;
  }
  function renderAll() {
    renderCodes(); renderFamilies(); renderOrders(); renderIoPreview();
    $('stale-months').value = state.staleMonths;
  }
  function fetchText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('fetch');
      return r.text();
    });
  }

  $('btn-sample').addEventListener('click', function () {
    var msg = $('top-msg');
    if (hasData() && !window.confirm('지금 내용을 지우고 견본 데이터로 바꿀까요?')) return;
    state.codes = clone(SAMPLE.codes);
    state.rates = clone(SAMPLE.rates);
    state.orders = []; state.io = []; state.done = {}; state.staleMonths = 3;
    SAMPLE.done.forEach(function (d) { state.done[SC.batchKey(d.vendor, d.no, d.family, d.month)] = d.closedAt; });
    Promise.all([
      fetchText('../data/samples/subcontract-order-sample.csv'),
      fetchText('../data/samples/subcontract-io-sample.csv')
    ]).then(function (texts) {
      addOrders(SC.parseOrderCsv(texts[0]));
      state.io = SC.parseIoCsv(texts[1]);
      msg.textContent = '견본 데이터를 채웠어요. 결과 탭을 열었어요.';
      save(); renderAll();
      selectTab($('tab-result'), false);
    }).catch(function () {
      msg.textContent = '견본 설정만 채웠어요. 견본 CSV는 2·3번 탭에서 내려받아 올려 주세요.';
      save(); renderAll();
    });
  });

  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('설정, 등록된 의뢰, 올린 입출고 목록, 완료 표시를 이 브라우저에서 모두 지울까요? 되돌릴 수 없어요.')) return;
    state.codes = []; state.rates = []; state.orders = []; state.io = []; state.done = {}; state.staleMonths = 3;
    openFamilies = {};
    save(); renderAll();
    $('top-msg').textContent = '모두 지웠어요.';
    selectTab($('tab-settings'), false);
  });

  /* ── 시작 ────────────────────────────────────────────── */
  load();
  renderAll();
})();
