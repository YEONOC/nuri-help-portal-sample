/* contract.js — 총량계약 현황 화면 (계산은 contract-calc.js, ERP 자료는 erp-data.js) */
(function () {
  'use strict';

  var E = window.ErpData, C = window.ContractCalc, S = window.SampleData;
  if (!E || !C || !S) return;
  var K = S.KEYS;

  var state = { codes: [], contracts: [] };
  var store = E.emptyStore();

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
  function getJson(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : fallback; } catch (e) { return fallback; }
  }
  function setJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 무시 */ } }

  /* 브라우저 저장은 편의 기능. 실패해도 화면은 그대로 동작 */
  function load() {
    state.codes = getJson(K.ctCodes, []);
    state.contracts = getJson(K.ctContracts, []);
    store = E.load();
  }
  function save() { setJson(K.ctCodes, state.codes); setJson(K.ctContracts, state.contracts); }

  /* 임가공 관리에 등록된 제품 코드는 총량계약 계산에서 뺌 */
  function subcontractCodes() {
    return getJson(K.skPrd, []).map(function (c) { return (c.code || '').trim(); }).filter(Boolean);
  }
  function runCompute() {
    return C.compute({ contracts: state.contracts, codes: state.codes, excludeCodes: subcontractCodes(), month: today().slice(0, 7) }, store);
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
  function monthsText(l) { return l.start === l.end ? l.start : l.start + ' ~ ' + l.end; }

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

  /* ── 설정: 품목 코드 ─────────────────────────────────── */
  function renderCodes() {
    var body = $('codes-body');
    if (!state.codes.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-cell">품목이 없어요. 아래 버튼으로 추가해 주세요.</td></tr>';
      return;
    }
    body.innerHTML = state.codes.map(function (c, i) {
      var n = i + 1;
      return '<tr>' +
        '<td><input class="field" data-i="' + i + '" data-f="code" value="' + esc(c.code) + '" aria-label="품목 코드 ' + n + '" autocomplete="off"></td>' +
        '<td><input class="field" data-i="' + i + '" data-f="name" value="' + esc(c.name) + '" aria-label="품목명 ' + n + '" autocomplete="off"></td>' +
        '<td><input class="field" data-i="' + i + '" data-f="family" value="' + esc(c.family) + '" aria-label="계열 ' + n + '" autocomplete="off"></td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-del-code="' + i + '" aria-label="품목 ' + n + ' 지우기">지우기</button></td></tr>';
    }).join('');
  }
  $('codes-body').addEventListener('change', function (e) {
    var el = e.target, i = Number(el.getAttribute('data-i')), f = el.getAttribute('data-f');
    if (!f || !state.codes[i]) return;
    state.codes[i][f] = el.value.trim();
    save();
  });
  $('codes-body').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-code]');
    if (!btn) return;
    state.codes.splice(Number(btn.getAttribute('data-del-code')), 1);
    save(); renderCodes();
  });
  $('btn-add-code').addEventListener('click', function () {
    state.codes.push({ code: '', name: '', family: '' });
    save(); renderCodes();
    var inputs = $('codes-body').querySelectorAll('[data-f="code"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  /* ── 계약: 올리기 · 지우기 · 되살리기 ────────────────── */
  function activeByNo(no) { return state.contracts.filter(function (c) { return !c.deleted && c.no === no; })[0]; }

  function renderContracts() {
    var active = state.contracts.filter(function (c) { return !c.deleted; });
    var deleted = state.contracts.filter(function (c) { return c.deleted; });
    $('contract-body').innerHTML = active.length ? active.map(function (c) {
      return c.lines.map(function (l, li) {
        var head = li === 0;
        return '<tr><td>' + (head ? esc(c.customer) : '') + '</td><td>' + (head ? '<code>' + esc(c.no) + '</code>' : '') + '</td>' +
          '<td>' + esc(l.family) + '</td><td class="num">' + fmt(l.qty) + '</td><td class="num">' + (l.price === null ? '—' : fmt(l.price)) + '</td>' +
          '<td>' + esc(monthsText(l)) + '</td><td>' +
          (head ? '<button type="button" class="btn btn--secondary btn--small" data-del="' + esc(c.id) + '" aria-label="' + esc(c.no) + ' 지우기">지우기</button>' : '') +
          '</td></tr>';
      }).join('');
    }).join('') : '<tr><td colspan="7" class="empty-cell">등록된 계약이 없어요. 계약 CSV를 올려 주세요.</td></tr>';
    $('deleted-body').innerHTML = deleted.length ? deleted.map(function (c) {
      return '<tr><td>' + esc(c.customer) + '</td><td><code>' + esc(c.no) + '</code></td><td>' + esc(c.deletedAt || '') + '</td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-restore="' + esc(c.id) + '" aria-label="' + esc(c.no) + ' 되살리기">되살리기</button></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty-cell">삭제된 계약이 없어요.</td></tr>';
  }

  $('contract-file').addEventListener('change', function () {
    var file = this.files[0], msg = $('contract-msg');
    if (!file) return;
    readFile(file, function (text) {
      var res = C.parseContractCsv(text), added = 0, skipped = [], stamp = Date.now();
      res.contracts.forEach(function (c, i) {
        if (activeByNo(c.no)) { skipped.push(c.no); return; }
        c.id = 'c' + stamp + '-' + i; c.deleted = false;
        state.contracts.push(c); added++;
      });
      save(); renderContracts();
      msg.textContent = file.name + ' — 계약 ' + added + '개를 등록했어요.' +
        (skipped.length ? ' 이미 있는 관리번호 ' + skipped.join(', ') + '는 건너뛰었어요. 바꾸려면 지운 뒤 다시 올려 주세요.' : '') +
        (res.badLines.length ? ' 읽지 못한 ' + res.badLines.length + '행(CSV ' + res.badLines.join(', ') + '행)은 뺐어요.' : '');
    }, msg);
    this.value = '';
  });

  $('panel-contracts').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var msg = $('contract-msg'), id, c;
    if (btn.hasAttribute('data-del')) {
      id = btn.getAttribute('data-del');
      c = state.contracts.filter(function (x) { return x.id === id; })[0];
      if (!c || !window.confirm(c.no + ' 계약을 지울까요? 삭제된 계약에서 되살릴 수 있어요.')) return;
      c.deleted = true; c.deletedAt = today();
      msg.textContent = c.no + '를 지웠어요. 삭제된 계약에서 되살릴 수 있어요.';
    } else if (btn.hasAttribute('data-restore')) {
      id = btn.getAttribute('data-restore');
      c = state.contracts.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      if (activeByNo(c.no)) { msg.textContent = '같은 관리번호 ' + c.no + ' 계약이 이미 있어요. 그 계약을 지운 뒤 되살려 주세요.'; return; }
      c.deleted = false; delete c.deletedAt;
      msg.textContent = c.no + '를 되살렸어요.';
    } else return;
    save(); renderContracts();
  });

  /* ── ERP 자료 ────────────────────────────────────────── */
  function mergeMessage(name, label, res) {
    return name + ' — ' + label + ' 새로 ' + res.added + '건, 바꿈 ' + res.updated + '건' +
      (res.bad ? ', 읽지 못한 ' + res.bad + '행(CSV ' + res.badLines.slice(0, 10).join(', ') + '행)' : '') + '.';
  }
  function uploadErp(inputId, parse, merge, label) {
    $(inputId).addEventListener('change', function () {
      var file = this.files[0], msg = $('erp-msg');
      if (!file) return;
      readFile(file, function (text) {
        store = E.load();
        var res = merge(store, parse(text));
        E.save(store);
        msg.textContent = mergeMessage(file.name, label, res);
        renderErpSummary();
      }, msg);
      this.value = '';
    });
  }
  uploadErp('orders-file', E.parseOrdersCsv, E.mergeOrders, '주문');
  uploadErp('ships-file', E.parseShipmentsCsv, E.mergeShipments, '출고');

  function renderErpSummary() {
    var res = runCompute(), c = res.counts;
    $('erp-summary').innerHTML = '<h2>쌓인 자료</h2><div class="stat-grid">' +
      statCard('주문', fmt(Object.keys(store.orders).length) + '건') + statCard('출고일', fmt(Object.keys(store.ships).length) + '건') +
      statCard('총량계약에 반영', fmt(c.used) + '건') + statCard('임가공으로 보냄', fmt(c.subcontract) + '건') + '</div>' +
      (c.nomatch + c.unknownCode + c.noFamily
        ? '<p class="hint">반영하지 못한 주문 ' + (c.nomatch + c.unknownCode + c.noFamily) + '건은 "확인할 것" 탭에서 볼 수 있어요.</p>' : '');
  }

  /* ── 현황 ────────────────────────────────────────────── */
  var STATUS = { '미출고': 'muted', '진행 중': 'ok', '완료': 'muted' };
  var LEVEL = { ok: ['ok', '정상'], info: ['info', '참고 · 초과 있음'], warn: ['warn', '확인할 것 있음'] };

  function lineStatus(l) {
    if (l.status === '초과') return chip('info', '초과 ' + fmt(-l.remain));
    return chip(STATUS[l.status], l.status);
  }

  function renderStatus(res) {
    var groups = $('status-groups'), filter = $('status-filter');
    var active = res.contracts;
    if (!active.length) {
      $('status-stats').innerHTML = ''; filter.hidden = true;
      groups.innerHTML = '<p class="empty-cell">등록된 계약이 없어요. "견본 데이터 채우기"를 누르거나 계약 탭에서 계약 CSV를 올려 주세요.</p>';
      return;
    }
    $('status-stats').innerHTML = '<div class="stat-grid">' + statCard('계약(kg)', fmt(res.totals.qty)) +
      statCard('나간(kg)', fmt(res.totals.shipped)) + statCard('남은(kg)', fmt(res.totals.remain)) +
      statCard('매출 추정(원)', fmt(res.totals.sales)) + '</div>';
    var customers = [];
    active.forEach(function (r) { if (customers.indexOf(r.customer) === -1) customers.push(r.customer); });
    var sel = $('filter-customer'), prev = sel.value;
    sel.innerHTML = '<option value="">전체</option>' + customers.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === prev ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    filter.hidden = false;
    var list = active.filter(function (r) { return !sel.value || r.customer === sel.value; });
    groups.innerHTML = list.map(function (r) {
      var lv = LEVEL[r.level];
      var est = r.lines.reduce(function (s, l) { return s + l.estimated; }, 0);
      var open = r.lines.reduce(function (s, l) { return s + l.openOrders; }, 0);
      var rows = r.lines.map(function (l) {
        return '<tr><td>' + esc(l.family) + '</td><td>' + esc(monthsText(l)) + '</td><td class="num">' + fmt(l.qty) + '</td>' +
          '<td class="num">' + fmt(l.shipped) + '</td><td class="num">' + fmt(l.remain) + '</td>' +
          '<td class="num">' + (l.price === null ? '—' : fmt(l.price)) + '</td><td class="num">' + (l.sales === null ? '—' : fmt(l.sales)) + '</td>' +
          '<td>' + lineStatus(l) + '</td></tr>';
      }).join('');
      var notes = [];
      if (open) notes.push('아직 나가지 않은 주문 ' + open + '건');
      if (est) notes.push('출고일을 납기일로 추정한 주문 ' + est + '건');
      return '<div class="group-card"><div class="group-card__head"><h3>' + esc(r.customer + ' · ' + r.no) + '</h3>' + chip(lv[0], lv[1]) + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>계열</th><th>납품월</th><th class="num">계약(kg)</th><th class="num">나간(kg)</th>' +
        '<th class="num">남은(kg)</th><th class="num">단가(원)</th><th class="num">매출 추정(원)</th><th>상태</th></tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="2">합계</td><td class="num">' + fmt(r.qty) + '</td><td class="num">' + fmt(r.shipped) + '</td><td class="num">' +
        fmt(r.remain) + '</td><td></td><td class="num">' +
        (r.lines.every(function (l) { return l.sales === null; }) ? '—' : fmt(r.sales)) + '</td><td></td></tr></tfoot></table></div>' +
        (notes.length ? '<p class="hint" style="padding: var(--s2) var(--s3); margin: 0;">' + esc(notes.join(' · ')) + '</p>' : '') + '</div>';
    }).join('');
  }
  $('filter-customer').addEventListener('change', function () { renderStatus(runCompute()); });

  /* ── 확인할 것 ───────────────────────────────────────── */
  function renderCheck(res) {
    var k = res.check, html = '';
    html += callout('warn', '⚠', '계약에 없는 관리번호', Object.keys(k.nomatch).map(function (no) {
      return no + ' — 주문 ' + k.nomatch[no].orders + '건 (나간 ' + fmt(k.nomatch[no].qty) + ' kg). 계약을 등록하거나 주문의 관리번호를 고쳐 주세요.';
    }));
    html += callout('warn', '⚠', '등록되지 않은 품목코드', Object.keys(k.unknownCode).map(function (code) {
      return code + ' — 주문 ' + k.unknownCode[code] + '건. 설정 탭에 계열과 함께 적어 주세요. 임가공 제품이면 임가공 관리에 등록해 주세요.';
    }));
    html += callout('warn', '⚠', '계약에 없는 계열', k.noFamily.map(function (x) {
      return x.no + ' — 주문 ' + x.order + '의 ' + x.family + '이 계약에 없어요.';
    }));
    html += callout('warn', '⚠', '단가 없음', k.noPrice.map(function (x) {
      return x.customer + ' · ' + x.no + ' ' + x.family + ' — 단가가 없어 매출을 추정하지 못했어요.' +
        (x.noteHasNumber ? ' 비고에 숫자가 있어요. 단가를 계약에 적어 주세요.' : '');
    }));
    html += callout('info', 'ℹ', '출고일 추정', k.estimated.map(function (x) {
      return x.no + ' — 주문 ' + x.order + '는 출고현황에 없어 납기일 ' + x.date + '를 출고일로 추정했어요.';
    }));
    $('check-box').innerHTML = html || '<p class="empty-cell">확인할 것이 없어요.</p>';
    var n = Object.keys(k.nomatch).length + Object.keys(k.unknownCode).length + k.noFamily.length + k.noPrice.length;
    $('tab-check').textContent = n ? '확인할 것 (' + n + ')' : '확인할 것';
  }

  /* ── 계약 정산 ───────────────────────────────────────── */
  var SETTLE = { '일치': 'muted', '초과': 'info', '미출고': 'warn' };
  function renderSettle(res) {
    if (!res.settlement.length) { $('settle-box').innerHTML = '<p class="empty-cell">납품 기간이 끝난 계약이 없어요.</p>'; return; }
    $('settle-box').innerHTML = res.settlement.map(function (s) {
      return '<div class="group-card"><div class="group-card__head"><h3>' + esc(s.customer + ' · ' + s.no) + '</h3>' +
        '<span class="hint">납품 끝 ' + esc(s.end) + '</span></div><div class="table-wrap"><table><thead><tr><th>계열</th>' +
        '<th class="num">계약(kg)</th><th class="num">나간(kg)</th><th class="num">차이(kg)</th><th class="num">출고율(%)</th><th>표시</th></tr></thead><tbody>' +
        s.lines.map(function (l) {
          return '<tr><td>' + esc(l.family) + '</td><td class="num">' + fmt(l.qty) + '</td><td class="num">' + fmt(l.shipped) + '</td>' +
            '<td class="num">' + (l.diff > 0 ? '+' : '') + fmt(l.diff) + '</td><td class="num">' + fmt(l.rate) + '</td><td>' +
            chip(SETTLE[l.label], l.label) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }).join('');
  }

  /* ── 견본 · 모두 지우기 ──────────────────────────────── */
  $('btn-sample').addEventListener('click', function () {
    var msg = $('top-msg');
    if (!window.confirm('총량계약 현황과 임가공 관리의 내용을 모두 지우고 견본 데이터로 바꿀까요? 두 도구는 ERP 자료를 함께 써요.')) return;
    S.clearAll();
    S.fill('../data/samples/').then(function () {
      load(); renderAll();
      msg.textContent = '견본 데이터를 채웠어요. 임가공 관리에도 같은 견본이 들어갔어요.';
      selectTab($('tab-status'), false);
    }).catch(function () {
      msg.textContent = '견본 파일을 읽지 못했어요. 견본 CSV를 내려받아 직접 올려 주세요.';
    });
  });
  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('총량계약 현황과 임가공 관리의 설정·계약·ERP 자료를 이 브라우저에서 모두 지울까요? 되돌릴 수 없어요.')) return;
    S.clearAll(); load(); renderAll();
    $('top-msg').textContent = '모두 지웠어요.';
  });

  /* ── 시작 ────────────────────────────────────────────── */
  function renderAll() {
    var res = runCompute();
    renderCodes(); renderContracts(); renderErpSummary();
    renderStatus(res); renderCheck(res); renderSettle(res);
  }
  load();
  renderAll();
})();
