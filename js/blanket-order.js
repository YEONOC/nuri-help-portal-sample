/* blanket-order.js — 총량계약 PO 대조 화면 (계산은 blanket-order-calc.js) */
(function () {
  'use strict';

  var BO = window.BlanketOrder;
  if (!BO) return;

  var KEYS = { codes: 'blo_codes', families: 'blo_families', pos: 'blo_pos', io: 'blo_io' };
  var state = { codes: [], families: {}, pos: [], io: [] };
  var openFamilies = {};
  var PREVIEW_ROWS = 30;

  var SAMPLE = {
    codes: [
      { code: 'NR-90-0001', name: '원료 S1', type: 'raw', family: 'A형 계열' },
      { code: 'NR-90-0002', name: '원료 S2', type: 'raw', family: 'B형 계열' },
      { code: 'NR-01-0001', name: '합금 소재 A형', type: 'prd', family: 'A형 계열' },
      { code: 'NR-02-0003', name: '합금 소재 B형', type: 'prd', family: 'B형 계열' }
    ],
    families: {
      'A형 계열': [{ m: '2026-04', r: 92 }, { m: '2026-05', r: 91 }, { m: '2026-06', r: 93 }],
      'B형 계열': [{ m: '2026-04', r: 88 }, { m: '2026-05', r: 89 }]
    }
  };

  /* ── 공통 ────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* 브라우저 저장은 편의 기능. 실패해도 화면은 그대로 동작 */
  function load() {
    Object.keys(KEYS).forEach(function (k) {
      try {
        var v = JSON.parse(localStorage.getItem(KEYS[k]));
        if (v && typeof v === 'object') state[k] = v;
      } catch (e) { /* 무시 */ }
    });
    if (!Array.isArray(state.codes)) state.codes = [];
    if (!Array.isArray(state.pos)) state.pos = [];
    if (!Array.isArray(state.io)) state.io = [];
    if (Array.isArray(state.families)) state.families = {};
  }
  function save() {
    Object.keys(KEYS).forEach(function (k) {
      try { localStorage.setItem(KEYS[k], JSON.stringify(state[k])); } catch (e) { /* 무시 */ }
    });
  }
  function runCompute() { return BO.compute(state, state.io); }

  function readFile(file, onText, msgEl) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try { onText(String(e.target.result)); }
      catch (err) { msgEl.textContent = 'CSV를 읽지 못했어요. 첫 행의 열 이름과 UTF-8 인코딩을 확인해 주세요.'; }
    };
    reader.onerror = function () { msgEl.textContent = '파일을 열지 못했어요. 다시 선택해 주세요.'; };
    reader.readAsText(file, 'UTF-8');
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
          '<option value="raw"' + (c.type !== 'prd' ? ' selected' : '') + '>원료 (입고)</option>' +
          '<option value="prd"' + (c.type === 'prd' ? ' selected' : '') + '>제품 (출고)</option></select></td>' +
        '<td><input class="field" data-i="' + i + '" data-f="family" list="family-options" value="' + esc(c.family) + '" aria-label="계열 ' + n + '" autocomplete="off"></td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-del-code="' + i + '" aria-label="품목 ' + n + ' 지우기">지우기</button></td>' +
        '</tr>';
    }).join('');
  }

  $('codes-body').addEventListener('change', function (e) {
    var el = e.target, i = Number(el.getAttribute('data-i')), f = el.getAttribute('data-f');
    if (!f || !state.codes[i]) return;
    state.codes[i][f] = el.value.trim();
    if (f === 'family' && state.codes[i].family && !state.families[state.codes[i].family]) {
      state.families[state.codes[i].family] = [];
      openFamilies[state.codes[i].family] = true;
    }
    save();
    renderFamilies();
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

  /* ── 1. 설정: 계열별 월 회수율 ───────────────────────── */
  function nextMonth(m) {
    var p = /^(\d{4})-(\d{2})$/.exec(m || '');
    if (!p) return '';
    var y = Number(p[1]), mo = Number(p[2]) + 1;
    if (mo > 12) { mo = 1; y++; }
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }

  function renderFamilies() {
    var names = Object.keys(state.families);
    $('family-options').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    var box = $('families-box');
    if (!names.length) {
      box.innerHTML = '<p class="hint">계열이 없어요. 품목 코드의 계열 칸에 이름을 적거나 아래에서 추가해 주세요.</p>';
      return;
    }
    box.innerHTML = names.map(function (name, fi) {
      var rates = state.families[name];
      var codes = state.codes.filter(function (c) { return c.family === name && c.type !== 'prd' && c.code; })
        .map(function (c) { return c.code; });
      var rows = rates.map(function (r, ri) {
        return '<tr>' +
          '<td><input type="month" class="field" data-fam="' + fi + '" data-ri="' + ri + '" data-f="m" value="' + esc(r.m) + '" aria-label="' + esc(name) + ' 연월 ' + (ri + 1) + '"></td>' +
          '<td><input type="number" class="field field--num" min="0" step="0.1" data-fam="' + fi + '" data-ri="' + ri + '" data-f="r" value="' + esc(r.r) + '" aria-label="' + esc(name) + ' 회수율 ' + (ri + 1) + '"></td>' +
          '<td><button type="button" class="btn btn--secondary btn--small" data-fam="' + fi + '" data-del-rate="' + ri + '" aria-label="' + esc(name) + ' ' + esc(r.m) + ' 회수율 지우기">지우기</button></td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="3" class="empty-cell">회수율이 없어요.</td></tr>';
      return '<details class="family-box" data-name="' + esc(name) + '"' + (openFamilies[name] ? ' open' : '') + '>' +
        '<summary>' + esc(name) + '<span>' + rates.length + '개월 등록' +
          (codes.length ? ' · 원료 ' + esc(codes.join(', ')) : ' · 연결된 원료 없음') + '</span></summary>' +
        '<div class="family-box__body"><div class="table-wrap"><table>' +
        '<thead><tr><th>연월</th><th class="num">회수율(%)</th><th><span class="sr-only">지우기</span></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        '<div class="btn-row">' +
          '<button type="button" class="btn btn--secondary btn--small" data-add-rate="' + fi + '">연월 추가</button>' +
          '<button type="button" class="btn btn--danger btn--small" data-del-family="' + fi + '">계열 지우기</button>' +
        '</div></div></details>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('details'), function (d) {
      d.addEventListener('toggle', function () { openFamilies[d.getAttribute('data-name')] = d.open; });
    });
  }

  function familyName(el) {
    return Object.keys(state.families)[Number(el.getAttribute('data-fam') || el.getAttribute('data-add-rate') || el.getAttribute('data-del-family'))];
  }

  $('families-box').addEventListener('change', function (e) {
    var el = e.target, f = el.getAttribute('data-f');
    if (!f) return;
    var rates = state.families[familyName(el)], ri = Number(el.getAttribute('data-ri'));
    if (!rates || !rates[ri]) return;
    rates[ri][f] = f === 'r' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    save();
  });
  $('families-box').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var name = familyName(btn), rates = state.families[name];
    if (!rates) return;
    if (btn.hasAttribute('data-add-rate')) {
      var last = rates[rates.length - 1];
      rates.push({ m: last ? nextMonth(last.m) : '', r: last ? last.r : '' });
    } else if (btn.hasAttribute('data-del-rate')) {
      rates.splice(Number(btn.getAttribute('data-del-rate')), 1);
    } else if (btn.hasAttribute('data-del-family')) {
      if (!window.confirm(name + '의 회수율을 모두 지울까요? 되돌릴 수 없어요.')) return;
      delete state.families[name];
    } else return;
    openFamilies[name] = true;
    save(); renderFamilies();
  });
  $('form-add-family').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('new-family').value.trim();
    if (!name) return;
    if (!state.families[name]) state.families[name] = [];
    openFamilies[name] = true;
    $('new-family').value = '';
    save(); renderFamilies();
  });

  /* ── 2. PO 등록 ──────────────────────────────────────── */
  function addPos(list) {
    var added = 0, skipped = 0;
    list.forEach(function (p) {
      var dup = state.pos.some(function (x) { return x.po === p.po && x.loc === p.loc; });
      if (dup) skipped++;
      else { state.pos.push({ co: p.co, po: p.po, loc: p.loc, note: p.note }); added++; }
    });
    return { added: added, skipped: skipped };
  }

  function renderPos() {
    var body = $('po-body');
    if (!state.pos.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-cell">등록된 PO가 없어요. PO CSV를 올리거나 아래에서 추가해 주세요.</td></tr>';
      return;
    }
    body.innerHTML = state.pos.map(function (p, i) {
      return '<tr><td>' + esc(p.co) + '</td><td><code>' + esc(p.po) + '</code></td><td>' + (esc(p.loc) || '—') +
        '</td><td class="wrap">' + esc(p.note) + '</td>' +
        '<td><button type="button" class="btn btn--secondary btn--small" data-del-po="' + i + '" aria-label="' + esc(p.po) + ' ' + esc(p.loc) + ' 지우기">지우기</button></td></tr>';
    }).join('');
  }

  $('po-file').addEventListener('change', function () {
    var file = this.files[0], msg = $('po-msg');
    if (!file) return;
    readFile(file, function (text) {
      var list = BO.parsePoCsv(text);
      if (!list.length) { msg.textContent = file.name + ' — PO 번호를 찾지 못했어요. 첫 행의 열 이름을 확인해 주세요.'; return; }
      var res = addPos(list);
      save(); renderPos();
      msg.textContent = !res.added
        ? file.name + ' — 새로 등록할 PO가 없어요. ' + res.skipped + '개 모두 이미 있어요.'
        : file.name + ' — PO ' + res.added + '개를 등록했어요.' +
          (res.skipped ? ' 이미 있는 ' + res.skipped + '개는 건너뛰었어요.' : '');
    }, msg);
    this.value = '';
  });
  $('po-body').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-po]');
    if (!btn) return;
    state.pos.splice(Number(btn.getAttribute('data-del-po')), 1);
    save(); renderPos();
  });
  $('form-add-po').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = { co: $('po-co').value.trim(), po: $('po-no').value.trim(), loc: $('po-loc').value.trim(), note: $('po-note').value.trim() };
    var msg = $('po-msg');
    if (!p.co || !p.po) { msg.textContent = '회사와 PO 번호를 적어 주세요.'; return; }
    var res = addPos([p]);
    msg.textContent = res.added ? p.po + '를 등록했어요.' : '같은 PO 번호·납품지가 이미 있어요.';
    if (res.added) { ['po-co', 'po-no', 'po-loc', 'po-note'].forEach(function (id) { $(id).value = ''; }); }
    save(); renderPos();
  });

  /* ── 3. 입출고 올리기 ────────────────────────────────── */
  var KIND_LABEL = {
    'in': ['ok', '입고 반영'], out: ['ok', '출고 반영'], nomatch: ['warn', 'PO 없음'],
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
      var rows = BO.parseIoCsv(text);
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
      statCard('전체 행', fmt(c.total)) + statCard('입고 반영', fmt(c['in'])) + statCard('출고 반영', fmt(c.out)) +
      statCard('뺀 행', fmt(c.nomatch + c.skip + c.bad)) + '</div>';
    if (!state.pos.length) {
      html += '<div class="callout callout--warn"><span class="callout__icon" aria-hidden="true">⚠</span><div class="callout__body">' +
        '<strong class="callout__title">주의</strong><p>등록된 PO가 없어 모든 행이 빠졌어요. 2번 탭에서 PO를 먼저 등록해 주세요.</p></div></div>';
    }
    html += '<div class="table-wrap"><table><thead><tr><th class="num">CSV 행</th><th>구분</th><th>관리번호</th><th>품목 코드</th>' +
      '<th>날짜</th><th class="num">수량(kg)</th><th>납품지</th><th>처리</th></tr></thead><tbody>' +
      state.io.slice(0, PREVIEW_ROWS).map(function (r, i) {
        var k = KIND_LABEL[res.rowKinds[i]];
        return '<tr><td class="num">' + r.line + '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.po) + '</td><td><code>' + esc(r.code) +
          '</code></td><td>' + (esc(r.date) || '—') + '</td><td class="num">' + (r.qty === null ? '—' : fmt(r.qty)) + '</td><td>' +
          (esc(r.loc) || '—') + '</td><td>' + chip(k[0], k[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (state.io.length > PREVIEW_ROWS) html += '<p class="hint">앞의 ' + PREVIEW_ROWS + '행만 보여 줘요. 계산에는 모든 행을 써요.</p>';
    box.innerHTML = html;
  }

  /* ── 4. 대조 결과 ────────────────────────────────────── */
  var lastResult = null;
  var LEVEL_CHIP = { ok: ['ok', '정상'], warn: ['warn', '참고 표시 있음'], danger: ['danger', '확인 필요 · 초과 출고'] };
  var STATUS_CHIP = { '미출고': 'muted', '출고 중': 'ok', '소진': 'muted' };

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
    if (!state.io.length) {
      groups.innerHTML = '<p class="empty-cell">아직 계산할 내용이 없어요. 2번 탭에서 PO를 등록하고 3번 탭에서 입출고 목록을 올려 주세요.</p>';
      return;
    }
    var res = lastResult = runCompute();
    alerts.innerHTML =
      callout('danger', '✕', '확인 필요 — 초과 출고', res.alerts.danger) +
      callout('warn', '⚠', '참고 — 회수율', res.alerts.warn) +
      callout('warn', '⚠', '참고 — 입고보다 먼저 나간 출고', res.alerts.early) +
      callout('info', 'ℹ', '참고 — 계산에서 뺀 행', res.alerts.info);
    stats.innerHTML = '<div class="stat-grid">' +
      statCard('입고 원료(kg)', fmt(res.totals.input)) + statCard('예상 출고(kg)', fmt(res.totals.expected)) +
      statCard('실제 출고(kg)', fmt(res.totals.shipped)) + statCard('잔량(kg)', fmt(res.totals.remain)) + '</div>';

    var cos = [];
    res.groups.forEach(function (g) { if (cos.indexOf(g.co) === -1) cos.push(g.co); });
    var prev = $('filter-co').value;
    $('filter-co').innerHTML = '<option value="">전체</option>' +
      cos.map(function (c) { return '<option value="' + esc(c) + '"' + (c === prev ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    filter.hidden = !res.groups.length;
    renderGroups();
  }

  function allocText(a) {
    var s = a.date + ' 출고 ' + fmt(a.shipQty) + ' kg 중 ' + fmt(a.take) + ' kg을 차감했어요.';
    if (a.early) s += ' 출고일이 이 입고 달보다 앞서요(참고).';
    if (a.restTo === 'next') s += ' 이 입고분은 소진됐고, 나머지 ' + fmt(a.rest) + ' kg은 다음 입고분에서 차감해요.';
    if (a.restTo === 'over') s += ' 나머지 ' + fmt(a.rest) + ' kg은 차감할 입고분이 없어 초과 출고로 남겼어요.';
    return s;
  }

  function detailCells(id, items) {
    if (!items.length) return { btn: '<span class="hint">출고 없음</span>', row: '' };
    return {
      btn: '<button type="button" class="detail-toggle" aria-expanded="false" aria-controls="' + id + '" aria-label="차감 내역 보기">보기</button>',
      row: '<tr class="detail-row" id="' + id + '" hidden><td colspan="9"><ul>' +
        items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></td></tr>'
    };
  }

  function renderGroups() {
    var box = $('result-groups');
    if (!lastResult) return;
    var co = $('filter-co').value, issueOnly = $('filter-issue').checked;
    var list = lastResult.groups.filter(function (g) {
      return (!co || g.co === co) && (!issueOnly || g.level !== 'ok');
    });
    if (!lastResult.groups.length) {
      box.innerHTML = '<p class="empty-cell">대조할 행이 없어요. 등록된 PO 번호와 품목 코드 설정을 확인해 주세요.</p>';
      return;
    }
    if (!list.length) { box.innerHTML = '<p class="empty-cell">조건에 맞는 PO가 없어요.</p>'; return; }

    box.innerHTML = list.map(function (g, gi) {
      var lv = LEVEL_CHIP[g.level];
      var rows = g.batches.map(function (b, bi) {
        var d = detailCells('detail-' + gi + '-' + bi, b.allocs.map(allocText));
        var rate = b.rate === null ? '없음' : fmt(b.rate) + (b.rateFrom ? '<br><span class="hint">' + esc(b.rateFrom) + ' 값</span>' : '');
        return '<tr><td>' + esc(b.month) + '</td><td>' + (esc(b.family) || '(계열 없음)') + '</td>' +
          '<td class="num">' + fmt(b.input) + '</td><td class="num">' + rate + '</td>' +
          '<td class="num">' + fmt(b.expected) + '</td><td class="num">' + fmt(b.used) + '</td>' +
          '<td class="num">' + fmt(b.remain) + '</td><td>' + chip(STATUS_CHIP[b.status], b.status) + '</td><td class="col-detail">' + d.btn + '</td></tr>' + d.row;
      }).join('');
      if (g.excess > 0) {
        var x = detailCells('detail-' + gi + '-x', g.excessList.map(function (e) {
          return e.date + ' 출고 ' + fmt(e.shipQty) + ' kg 중 ' + fmt(e.over) + ' kg을 차감하지 못했어요.';
        }));
        rows += '<tr><td colspan="5">차감할 입고분이 없는 출고</td><td class="num">' + fmt(g.excess) + '</td>' +
          '<td class="num">' + fmt(-g.excess) + '</td><td>' + chip('danger', '초과 출고') + '</td><td class="col-detail">' + x.btn + '</td></tr>' + x.row;
      }
      return '<div class="group-card"><div class="group-card__head"><h3>' + esc(g.label) + '</h3>' + chip(lv[0], lv[1]) + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>입고 월</th><th>계열</th><th class="num">입고(kg)</th>' +
        '<th class="num">회수율(%)</th><th class="num">예상 출고(kg)</th><th class="num">차감(kg)</th>' +
        '<th class="num">잔량(kg)</th><th>상태</th><th class="col-detail">내역</th></tr></thead><tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="2">합계</td><td class="num">' + fmt(g.input) + '</td><td></td><td class="num">' + fmt(g.expected) +
        '</td><td class="num">' + fmt(g.shipped) + '</td><td class="num">' + fmt(g.remain) + '</td><td colspan="2"></td></tr></tfoot>' +
        '</table></div></div>';
    }).join('');
  }

  $('result-groups').addEventListener('click', function (e) {
    var btn = e.target.closest('.detail-toggle');
    if (!btn) return;
    var row = $(btn.getAttribute('aria-controls'));
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    btn.textContent = open ? '보기' : '접기';
    btn.setAttribute('aria-label', open ? '차감 내역 보기' : '차감 내역 접기');
    if (row) row.hidden = open;
  });
  $('filter-co').addEventListener('change', renderGroups);
  $('filter-issue').addEventListener('change', renderGroups);

  /* ── 견본 채우기 · 모두 지우기 ───────────────────────── */
  function hasData() {
    return state.codes.length || Object.keys(state.families).length || state.pos.length || state.io.length;
  }
  function renderAll() { renderCodes(); renderFamilies(); renderPos(); renderIoPreview(); }

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
    state.families = clone(SAMPLE.families);
    state.pos = []; state.io = [];
    Promise.all([
      fetchText('../data/samples/blanket-order-po-sample.csv'),
      fetchText('../data/samples/blanket-order-io-sample.csv')
    ]).then(function (texts) {
      addPos(BO.parsePoCsv(texts[0]));
      state.io = BO.parseIoCsv(texts[1]);
      msg.textContent = '견본 데이터를 채웠어요. 결과 탭을 열었어요.';
      save(); renderAll();
      selectTab($('tab-result'), false);
    }).catch(function () {
      msg.textContent = '견본 설정만 채웠어요. 견본 CSV는 2·3번 탭에서 내려받아 올려 주세요.';
      save(); renderAll();
    });
  });

  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('설정, 등록된 PO, 올린 입출고 목록을 이 브라우저에서 모두 지울까요? 되돌릴 수 없어요.')) return;
    state.codes = []; state.families = {}; state.pos = []; state.io = [];
    openFamilies = {};
    save(); renderAll();
    $('top-msg').textContent = '모두 지웠어요.';
    selectTab($('tab-settings'), false);
  });

  /* ── 시작 ────────────────────────────────────────────── */
  load();
  renderAll();
})();
