/* blanket-order-calc.js — 총량계약 PO 대조: CSV 읽기와 선입선출 계산 (화면 코드와 분리) */
(function (root) {
  'use strict';

  var EPS = 0.0001;
  var SEP = '\u0001';

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ── CSV ─────────────────────────────────────────────── */
  function splitLine(line) {
    var out = [], cur = '', quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function parseCsv(text) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    var rows = [];
    lines.forEach(function (line, i) {
      if (line.trim()) rows.push({ line: i + 1, cols: splitLine(line) });
    });
    return { header: rows.length ? rows[0].cols : [], rows: rows.slice(1) };
  }

  /* 열 이름으로 위치를 찾고, 없으면 정해진 순서를 사용 */
  function findCol(header, names, fallback) {
    for (var i = 0; i < header.length; i++) {
      var h = header[i].replace(/\s/g, '').toLowerCase();
      for (var j = 0; j < names.length; j++) {
        if (h.indexOf(names[j]) !== -1) return i;
      }
    }
    return fallback;
  }

  function normDate(s) {
    var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(s || '').trim());
    if (!m) return '';
    var mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return m[1] + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }

  function parseQty(s) {
    var n = parseFloat(String(s || '').replace(/[,\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  function parsePoCsv(text) {
    var csv = parseCsv(text), h = csv.header;
    var cCo = findCol(h, ['회사', '거래처', '고객'], 0);
    var cPo = findCol(h, ['po', '관리번호', '계약번호'], 1);
    var cLoc = findCol(h, ['납품지', '납품처'], 2);
    var cNote = findCol(h, ['비고', '메모'], 3);
    return csv.rows.map(function (r) {
      return {
        co: r.cols[cCo] || '', po: r.cols[cPo] || '',
        loc: r.cols[cLoc] || '', note: r.cols[cNote] || ''
      };
    }).filter(function (p) { return p.po; });
  }

  function parseIoCsv(text) {
    var csv = parseCsv(text), h = csv.header;
    var cKind = findCol(h, ['구분', '유형'], 0);
    var cPo = findCol(h, ['관리번호', 'po'], 1);
    var cCode = findCol(h, ['품목코드', '품번', '품목'], 2);
    var cDate = findCol(h, ['날짜', '일자'], 3);
    var cQty = findCol(h, ['수량', '중량', '무게'], 4);
    var cLoc = findCol(h, ['납품지', '납품처'], 5);
    return csv.rows.map(function (r) {
      var kindRaw = r.cols[cKind] || '';
      var kind = kindRaw.indexOf('입고') !== -1 ? '입고' : (kindRaw.indexOf('출고') !== -1 ? '출고' : kindRaw);
      var row = {
        line: r.line, kind: kind, po: r.cols[cPo] || '', code: r.cols[cCode] || '',
        date: normDate(r.cols[cDate]), qty: parseQty(r.cols[cQty]), loc: r.cols[cLoc] || ''
      };
      row.bad = !row.date || row.qty === null || !row.code || (kind !== '입고' && kind !== '출고');
      return row;
    });
  }

  /* ── 회수율 찾기: 그 달 값 → 없으면 바로 앞 달 값 ───── */
  function findRate(families, family, month) {
    var list = (families[family] || []).filter(function (x) {
      return /^\d{4}-\d{2}$/.test(x.m || '') && x.r !== '' && x.r !== null && !isNaN(Number(x.r));
    });
    var exact = null, prev = null;
    list.forEach(function (x) {
      if (x.m === month) exact = x;
      else if (x.m < month && (!prev || x.m > prev.m)) prev = x;
    });
    if (exact) return { r: Number(exact.r), from: '' };
    if (prev) return { r: Number(prev.r), from: prev.m };
    return null;
  }

  /* ── 대조 계산 ───────────────────────────────────────── */
  function compute(settings, io) {
    var raw = {}, prd = {};
    (settings.codes || []).forEach(function (c) {
      var code = (c.code || '').trim();
      if (!code) return;
      if (c.type === 'prd') prd[code] = (c.family || '').trim();
      else raw[code] = (c.family || '').trim();
    });
    var families = settings.families || {};

    var poInfo = {};
    (settings.pos || []).forEach(function (p) {
      if (!poInfo[p.po]) poInfo[p.po] = { co: p.co, locs: [] };
      if (poInfo[p.po].locs.indexOf(p.loc) === -1) poInfo[p.po].locs.push(p.loc);
    });

    var groupMap = {};
    var counts = { total: 0, 'in': 0, out: 0, nomatch: 0, skip: 0, bad: 0 };
    var nomatchPos = {}, badLines = [], rowKinds = [];

    function groupOf(row) {
      var info = poInfo[row.po];
      var loc = row.loc || (info.locs.length === 1 ? info.locs[0] : '');
      var key = row.po + SEP + loc;
      if (!groupMap[key]) {
        groupMap[key] = {
          co: info.co, po: row.po, loc: loc, batchMap: {}, batches: [], ships: [],
          excess: 0, excessList: [], level: 'ok'
        };
      }
      return groupMap[key];
    }

    (io || []).forEach(function (row) {
      var kind;
      if (row.bad) kind = 'bad';
      else if (!poInfo[row.po]) kind = 'nomatch';
      else if (row.kind === '입고' && raw.hasOwnProperty(row.code)) kind = 'in';
      else if (row.kind === '출고' && prd.hasOwnProperty(row.code)) kind = 'out';
      else kind = 'skip';
      counts.total++; counts[kind]++; rowKinds.push(kind);

      if (kind === 'bad') badLines.push(row.line);
      if (kind === 'nomatch') {
        var name = row.po || '(빈칸)';
        nomatchPos[name] = (nomatchPos[name] || 0) + 1;
      }
      if (kind === 'in') {
        var g = groupOf(row), fam = raw[row.code], month = row.date.slice(0, 7);
        var bk = fam + SEP + month;
        if (!g.batchMap[bk]) {
          g.batchMap[bk] = { family: fam, month: month, input: 0, rate: null, rateFrom: '', expected: 0, used: 0, allocs: [] };
          g.batches.push(g.batchMap[bk]);
        }
        g.batchMap[bk].input += row.qty;
      }
      if (kind === 'out') {
        groupOf(row).ships.push({ date: row.date, code: row.code, qty: row.qty, family: prd[row.code] });
      }
    });

    var alerts = { danger: [], warn: [], early: [], info: [] };
    var totals = { input: 0, expected: 0, shipped: 0, remain: 0 };

    var groups = Object.keys(groupMap).map(function (k) { return groupMap[k]; });
    groups.sort(function (a, b) {
      return a.co.localeCompare(b.co) || a.po.localeCompare(b.po) || a.loc.localeCompare(b.loc);
    });

    groups.forEach(function (g) {
      g.label = [g.co, g.po, g.loc].filter(Boolean).join(' · ');
      delete g.batchMap;

      g.batches.sort(function (a, b) { return a.month.localeCompare(b.month) || a.family.localeCompare(b.family); });
      g.batches.forEach(function (b) {
        b.input = round2(b.input);
        var famName = b.family || '(계열 없음)';
        var rate = findRate(families, b.family, b.month);
        if (!rate) {
          alerts.warn.push(g.label + ' — ' + famName + ' ' + b.month + ' 회수율이 없어 나가야 할 제품을 계산하지 못했어요. 설정에서 회수율을 적어 주세요.');
          if (g.level === 'ok') g.level = 'warn';
          return;
        }
        b.rate = rate.r; b.rateFrom = rate.from;
        b.expected = round2(b.input * rate.r / 100);
        if (rate.from) {
          alerts.warn.push(g.label + ' — ' + famName + ' ' + b.month + ' 회수율이 없어 ' + rate.from + ' 값(' + rate.r + '%)을 썼어요.');
          if (g.level === 'ok') g.level = 'warn';
        }
      });

      /* 선입선출: 출고일 순서대로, 가장 먼저 들어온 달의 잔량부터 차감 */
      g.ships.sort(function (a, b) { return a.date.localeCompare(b.date); });
      g.ships.forEach(function (s) {
        var left = s.qty, last = null, earlyMonths = [];
        var shipMonth = s.date.slice(0, 7);
        g.batches.forEach(function (b) {
          if (left <= EPS) return;
          if (s.family && b.family !== s.family) return;
          var avail = b.expected - b.used;
          if (avail <= EPS) return;
          var take = Math.min(left, avail);
          b.used = round2(b.used + take);
          left = round2(left - take);
          last = {
            date: s.date, code: s.code, shipQty: s.qty, take: round2(take), rest: left,
            restTo: left > EPS ? 'next' : '', early: shipMonth < b.month
          };
          if (last.early && earlyMonths.indexOf(b.month) === -1) earlyMonths.push(b.month);
          b.allocs.push(last);
        });
        if (earlyMonths.length) {
          alerts.early.push(g.label + ' — ' + s.date + ' 출고를 그보다 늦은 ' + earlyMonths.join(', ') +
            ' 입고분에서 차감했어요. 입고 누락이나 날짜를 확인해 주세요.');
          if (g.level === 'ok') g.level = 'warn';
        }
        if (left > EPS) {
          if (last) last.restTo = 'over';
          g.excess = round2(g.excess + left);
          g.excessList.push({ date: s.date, code: s.code, shipQty: s.qty, over: left });
          g.level = 'danger';
          alerts.danger.push(g.label + ' — ' + s.date + ' 출고 ' + s.qty.toLocaleString('ko-KR') + ' kg 중 ' +
            left.toLocaleString('ko-KR') + ' kg이 나가야 할 양을 넘었어요. 입고 누락이나 관리번호를 확인해 주세요.');
        }
      });

      g.input = 0; g.expected = 0; g.shipped = 0;
      g.batches.forEach(function (b) {
        b.remain = round2(b.expected - b.used);
        b.status = b.used <= EPS ? '미출고' : (b.remain <= EPS ? '소진' : '출고 중');
        g.input += b.input; g.expected += b.expected;
      });
      g.ships.forEach(function (s) { g.shipped += s.qty; });
      g.input = round2(g.input); g.expected = round2(g.expected); g.shipped = round2(g.shipped);
      g.remain = round2(g.expected - g.shipped);

      totals.input += g.input; totals.expected += g.expected; totals.shipped += g.shipped;
    });
    totals.input = round2(totals.input); totals.expected = round2(totals.expected);
    totals.shipped = round2(totals.shipped); totals.remain = round2(totals.expected - totals.shipped);

    if (counts.nomatch) {
      alerts.info.push('관리번호가 등록된 PO와 맞지 않는 ' + counts.nomatch + '행을 뺐어요: ' +
        Object.keys(nomatchPos).map(function (k) { return k + ' (' + nomatchPos[k] + '행)'; }).join(', '));
    }
    if (counts.skip) alerts.info.push('설정에 없는 품목 코드이거나 구분이 맞지 않는 ' + counts.skip + '행을 뺐어요.');
    if (counts.bad) {
      alerts.info.push('날짜·수량·구분을 읽지 못한 ' + counts.bad + '행을 뺐어요 (CSV ' +
        badLines.slice(0, 10).join(', ') + (badLines.length > 10 ? ' …' : '') + '행).');
    }

    return { groups: groups, alerts: alerts, totals: totals, counts: counts, rowKinds: rowKinds };
  }

  var api = { parsePoCsv: parsePoCsv, parseIoCsv: parseIoCsv, compute: compute };
  root.BlanketOrder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
