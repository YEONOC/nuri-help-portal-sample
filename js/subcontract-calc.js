/* subcontract-calc.js — 임가공 대조: 보낸 원료 대비 돌려받은 소재 (선입선출). 화면 코드와 분리 */
/* CSV 읽기는 blanket-order-calc.js(총량계약 PO 대조)를 함께 씀 */
(function (root) {
  'use strict';

  var BO = root.BlanketOrder || (typeof require !== 'undefined' ? require('./blanket-order-calc.js') : null);
  var U = BO.util;
  var round2 = U.round2;
  var EPS = 0.0001;
  var SEP = '\u0001';

  /* 임가공 의뢰 CSV: 업체, 관리번호, 비고 */
  function parseOrderCsv(text) {
    var csv = U.parseCsv(text), h = csv.header;
    var cVendor = U.findCol(h, ['업체', '임가공', '거래처'], 0);
    var cNo = U.findCol(h, ['관리번호', '의뢰번호'], 1);
    var cNote = U.findCol(h, ['비고', '메모'], 2);
    return csv.rows.map(function (r) {
      return { vendor: r.cols[cVendor] || '', no: r.cols[cNo] || '', note: r.cols[cNote] || '' };
    }).filter(function (o) { return o.no; });
  }

  function batchKey(vendor, no, family, month) { return [vendor, no, family, month].join(SEP); }

  function monthsBetween(month, today) {
    var a = /^(\d{4})-(\d{2})/.exec(month || ''), b = /^(\d{4})-(\d{2})/.exec(today || '');
    if (!a || !b) return 0;
    return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  }

  /* 기준 회수율: 업체 값(그 달 → 바로 앞 달) → 없으면 계열 공통 값(그 달 → 바로 앞 달) */
  function findRate(rates, vendor, family, month) {
    function pick(scopeVendor) {
      var exact = null, prev = null;
      (rates || []).forEach(function (x) {
        if ((x.vendor || '') !== scopeVendor || x.family !== family) return;
        if (!/^\d{4}-\d{2}$/.test(x.m || '') || x.r === '' || x.r === null || isNaN(Number(x.r))) return;
        if (x.m === month) exact = x;
        else if (x.m < month && (!prev || x.m > prev.m)) prev = x;
      });
      if (exact) return { r: Number(exact.r), from: '', scope: scopeVendor ? 'vendor' : 'common' };
      if (prev) return { r: Number(prev.r), from: prev.m, scope: scopeVendor ? 'vendor' : 'common' };
      return null;
    }
    return (vendor && pick(vendor)) || pick('');
  }

  /* settings: { codes, rates, orders, done: {batchKey: 완료 시점 마지막 입고일}, staleMonths, today } */
  function compute(settings, io) {
    var raw = {}, prd = {};
    (settings.codes || []).forEach(function (c) {
      var code = (c.code || '').trim();
      if (!code) return;
      if (c.type === 'prd') prd[code] = (c.family || '').trim();
      else raw[code] = (c.family || '').trim();
    });
    var orders = {};
    (settings.orders || []).forEach(function (o) { if (!orders[o.no]) orders[o.no] = o.vendor; });
    var done = settings.done || {};
    var stale = Number(settings.staleMonths) > 0 ? Number(settings.staleMonths) : 3;
    var today = settings.today || '';

    var groupMap = {}, groups = [];
    var counts = { total: 0, sent: 0, recv: 0, nomatch: 0, skip: 0, bad: 0 };
    var nomatchNos = {}, badLines = [], rowKinds = [];

    function groupOf(no) {
      if (!groupMap[no]) {
        groupMap[no] = { vendor: orders[no], no: no, batchMap: {}, batches: [], receipts: [], extra: 0, extraList: [], level: 'ok' };
        groups.push(groupMap[no]);
      }
      return groupMap[no];
    }

    (io || []).forEach(function (row) {
      var kind;
      if (row.bad) kind = 'bad';
      else if (!orders.hasOwnProperty(row.po)) kind = 'nomatch';
      else if (row.kind === '출고' && raw.hasOwnProperty(row.code)) kind = 'sent';
      else if (row.kind === '입고' && prd.hasOwnProperty(row.code)) kind = 'recv';
      else kind = 'skip';
      counts.total++; counts[kind]++; rowKinds.push(kind);

      if (kind === 'bad') badLines.push(row.line);
      if (kind === 'nomatch') { var n = row.po || '(빈칸)'; nomatchNos[n] = (nomatchNos[n] || 0) + 1; }
      if (kind === 'sent') {
        var g = groupOf(row.po), fam = raw[row.code], month = row.date.slice(0, 7), bk = fam + SEP + month;
        if (!g.batchMap[bk]) {
          var key = batchKey(g.vendor, g.no, fam, month);
          g.batchMap[bk] = {
            key: key, family: fam, month: month, sent: 0, rate: null, rateFrom: '', rateScope: '',
            expected: 0, received: 0, allocs: [], done: done.hasOwnProperty(key), closedAt: done[key] || ''
          };
          g.batches.push(g.batchMap[bk]);
        }
        g.batchMap[bk].sent += row.qty;
      }
      if (kind === 'recv') groupOf(row.po).receipts.push({ date: row.date, code: row.code, qty: row.qty, family: prd[row.code] });
    });

    var alerts = { danger: [], stale: [], rate: [], extra: [], early: [], info: [] };
    var totals = { sent: 0, expected: 0, received: 0, remain: 0, remainRaw: 0, loss: 0 };

    groups.sort(function (a, b) { return a.vendor.localeCompare(b.vendor) || a.no.localeCompare(b.no); });
    groups.forEach(function (g) {
      g.label = [g.vendor, g.no].filter(Boolean).join(' · ');
      delete g.batchMap;
      function warn() { if (g.level === 'ok') g.level = 'warn'; }

      g.batches.sort(function (a, b) { return a.month.localeCompare(b.month) || a.family.localeCompare(b.family); });
      g.batches.forEach(function (b) {
        b.sent = round2(b.sent);
        var famName = b.family || '(계열 없음)';
        var rate = findRate(settings.rates, g.vendor, b.family, b.month);
        if (!rate) {
          alerts.rate.push(g.label + ' — ' + famName + ' ' + b.month + ' 기준 회수율이 없어 받아야 할 소재를 계산하지 못했어요. 설정에서 회수율을 적어 주세요.');
          warn();
          return;
        }
        b.rate = rate.r; b.rateFrom = rate.from; b.rateScope = rate.scope;
        b.expected = round2(b.sent * rate.r / 100);
        if (rate.from) {
          alerts.rate.push(g.label + ' — ' + famName + ' ' + b.month + ' 회수율이 없어 ' + rate.from + ' 값(' + rate.r + '%)을 썼어요.');
          warn();
        }
      });

      /* 선입선출: 입고일 순서대로 가장 먼저 보낸 달부터 차감. 완료한 배치는 완료 시점 이후 입고를 받지 않음 */
      g.receipts.sort(function (a, b) { return a.date.localeCompare(b.date); });
      g.receipts.forEach(function (rc) {
        var left = rc.qty, earlyMonths = [];
        var rcMonth = rc.date.slice(0, 7);
        g.batches.forEach(function (b) {
          if (left <= EPS) return;
          if (rc.family && b.family !== rc.family) return;
          if (b.done && rc.date > b.closedAt) return;
          var avail = b.expected - b.received;
          if (avail <= EPS) return;
          var take = Math.min(left, avail);
          b.received = round2(b.received + take);
          left = round2(left - take);
          var early = rcMonth < b.month;
          if (early && earlyMonths.indexOf(b.month) === -1) earlyMonths.push(b.month);
          b.allocs.push({ date: rc.date, code: rc.code, qty: rc.qty, take: round2(take), rest: left, early: early });
        });
        if (earlyMonths.length) {
          alerts.early.push(g.label + ' — ' + rc.date + ' 입고를 그보다 늦게 보낸 ' + earlyMonths.join(', ') +
            ' 원료분에서 차감했어요. 출고 누락이나 날짜를 확인해 주세요.');
          warn();
        }
        if (left > EPS) {
          g.extra = round2(g.extra + left);
          g.extraList.push({ date: rc.date, code: rc.code, qty: rc.qty, over: left });
          alerts.extra.push(g.label + ' — ' + rc.date + ' 입고 ' + rc.qty.toLocaleString('ko-KR') + ' kg 중 ' +
            left.toLocaleString('ko-KR') + ' kg은 받아야 할 양보다 더 받았어요. 출고 누락이나 회수율을 확인해 주세요.');
          warn();
        }
      });

      g.sent = 0; g.expected = 0; g.received = 0; g.remain = 0; g.remainRaw = 0; g.loss = 0;
      g.batches.forEach(function (b) {
        b.remain = round2(b.expected - b.received);
        b.elapsed = monthsBetween(b.month, today);
        b.actualRate = b.sent > EPS ? round2(b.received / b.sent * 100) : 0;
        b.loss = 0; b.remainRaw = 0; b.stale = false;
        if (b.done) {
          if (b.rate !== null && b.remain > EPS) {
            b.loss = b.remain;
            alerts.danger.push(g.label + ' — ' + (b.family || '(계열 없음)') + ' ' + b.month + '분을 완료했는데 실제 회수율 ' +
              b.actualRate + '%가 기준 ' + b.rate + '%보다 낮아요 (' + b.loss.toLocaleString('ko-KR') + ' kg 덜 받음). 업체에 확인해 주세요.');
            g.level = 'danger';
          }
          b.status = b.loss > EPS ? '완료 · 덜 받음' : '완료';
        } else {
          if (b.rate && b.remain > EPS) b.remainRaw = round2(b.remain / b.rate * 100);
          b.status = b.received <= EPS ? '미회수' : (b.remain <= EPS ? '소진' : '회수 중');
          if (b.rate !== null && b.remain > EPS && b.elapsed >= stale) {
            b.stale = true;
            alerts.stale.push(g.label + ' — ' + (b.family || '(계열 없음)') + ' ' + b.month + '분 ' + b.remain.toLocaleString('ko-KR') +
              ' kg을 ' + b.elapsed + '개월째 받지 못했어요 (기준 ' + stale + '개월).');
            warn();
          }
          g.remain += b.remain > EPS ? b.remain : 0;
          g.remainRaw += b.remainRaw;
        }
        g.sent += b.sent; g.expected += b.expected; g.received += b.received; g.loss += b.loss;
      });
      g.received = round2(g.received + g.extra);
      ['sent', 'expected', 'received', 'remain', 'remainRaw', 'loss'].forEach(function (k) {
        g[k] = round2(g[k]); totals[k] += g[k];
      });
    });
    Object.keys(totals).forEach(function (k) { totals[k] = round2(totals[k]); });

    if (counts.nomatch) {
      alerts.info.push('관리번호가 등록된 임가공 의뢰와 맞지 않는 ' + counts.nomatch + '행을 뺐어요: ' +
        Object.keys(nomatchNos).map(function (k) { return k + ' (' + nomatchNos[k] + '행)'; }).join(', '));
    }
    if (counts.skip) alerts.info.push('설정에 없는 품목 코드이거나 구분이 맞지 않는 ' + counts.skip + '행을 뺐어요.');
    if (counts.bad) {
      alerts.info.push('날짜·수량·구분을 읽지 못한 ' + counts.bad + '행을 뺐어요 (CSV ' +
        badLines.slice(0, 10).join(', ') + (badLines.length > 10 ? ' …' : '') + '행).');
    }

    return { groups: groups, alerts: alerts, totals: totals, counts: counts, rowKinds: rowKinds, staleMonths: stale };
  }

  var api = { parseOrderCsv: parseOrderCsv, parseIoCsv: BO.parseIoCsv, compute: compute, batchKey: batchKey };
  root.Subcontract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
