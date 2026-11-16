/* subcontract-calc.js — 임가공 관리: 업체에서 받은 원료 × 회수율 = 지급 의무량, 출고를 선입선출로 차감 (화면 코드와 분리) */
(function (root) {
  'use strict';

  var E = root.ErpData || (typeof require !== 'undefined' ? require('./erp-data.js') : null);
  var round2 = E.util.round2;
  var EPS = 0.0001;

  /* 품목코드 하나는 한 업체에만. 원료 코드와 제품 코드끼리도 겹치면 안 됨 */
  function codeOwner(settings, code, skip) {
    var found = null;
    ['rawCodes', 'prdCodes'].forEach(function (kind) {
      (settings[kind] || []).forEach(function (c, i) {
        if (found || (skip && skip.kind === kind && skip.index === i)) return;
        if ((c.code || '').trim() === code) found = { kind: kind, vendor: c.vendor };
      });
    });
    return found;
  }

  /* 그해 회수율 → 없으면 가장 가까운 앞 해 값 */
  function findRate(rates, code, year) {
    var exact = null, prev = null;
    (rates || []).forEach(function (x) {
      if (x.code !== code || x.r === '' || x.r === null || isNaN(Number(x.r))) return;
      if (String(x.year) === year) exact = x;
      else if (String(x.year) < year && (!prev || String(x.year) > String(prev.year))) prev = x;
    });
    if (exact) return { r: Number(exact.r), from: '' };
    if (prev) return { r: Number(prev.r), from: String(prev.year) };
    return null;
  }

  /* settings: { vendors[{name}], rawCodes[{code, name, vendor}], prdCodes[{code, name, vendor}], rates[{code, year, r}] } */
  function compute(settings, store) {
    var raw = {}, prd = {}, names = {};
    (settings.rawCodes || []).forEach(function (c) { if (c.code && c.vendor) { raw[c.code] = c.vendor; names[c.code] = c.name || c.code; } });
    (settings.prdCodes || []).forEach(function (c) { if (c.code && c.vendor) prd[c.code] = c.vendor; });

    var vendorMap = {}, vendors = [];
    (settings.vendors || []).forEach(function (v) {
      if (!v.name || vendorMap[v.name]) return;
      vendorMap[v.name] = { name: v.name, monthMap: {}, months: [], ships: [], extra: 0, extraList: [] };
      vendors.push(vendorMap[v.name]);
    });

    var alerts = { rate: [], extra: [], estimated: [], info: [] };
    var counts = { inbound: 0, inboundUsed: 0, inboundSkip: 0, ships: 0 };

    E.inboundList(store).forEach(function (x) {
      counts.inbound++;
      var v = vendorMap[raw[x.code]];
      if (!v) { counts.inboundSkip++; return; }
      counts.inboundUsed++;
      var m = x.date.slice(0, 7);
      if (!v.monthMap[m]) { v.monthMap[m] = { month: m, items: {}, owed: 0, deducted: 0, allocs: [], rateNotes: [] }; v.months.push(v.monthMap[m]); }
      v.monthMap[m].items[x.code] = round2((v.monthMap[m].items[x.code] || 0) + x.qty);
    });

    E.orderList(store).forEach(function (o) {
      var v = vendorMap[prd[o.code]];
      if (!v || (o.shipped || 0) <= EPS) return;
      var sd = E.shipDate(store, o);
      counts.ships++;
      v.ships.push({ order: o.no, code: o.code, date: sd.date, estimated: sd.estimated, qty: o.shipped });
      if (sd.estimated) alerts.estimated.push(v.name + ' — ' + o.no + ' 출고일이 없어 납기일 ' + sd.date + '로 추정했어요.');
    });

    var totals = { received: 0, owed: 0, shipped: 0, remain: 0 };
    vendors.forEach(function (v) {
      v.months.sort(function (a, b) { return a.month.localeCompare(b.month); });
      v.months.forEach(function (m) {
        var year = m.month.slice(0, 4);
        m.lines = Object.keys(m.items).sort().map(function (code) {
          var rate = findRate(settings.rates, code, year);
          var owed = rate ? round2(m.items[code] * rate.r / 100) : 0;
          if (!rate) {
            alerts.rate.push(v.name + ' — ' + m.month + ' ' + names[code] + '(' + code + ') ' + year + '년 회수율이 없어 줘야 할 양을 계산하지 못했어요. 설정에서 회수율을 적어 주세요.');
          } else if (rate.from) {
            alerts.rate.push(v.name + ' — ' + m.month + ' ' + names[code] + '(' + code + ') ' + year + '년 회수율이 없어 ' + rate.from + '년 값(' + rate.r + '%)을 썼어요.');
          }
          m.owed = round2(m.owed + owed);
          return { code: code, name: names[code], qty: m.items[code], rate: rate ? rate.r : null, rateFrom: rate ? rate.from : '', owed: owed };
        });
        m.received = round2(m.lines.reduce(function (s, l) { return s + l.qty; }, 0));
      });

      /* 선입선출: 출고일 순서대로 가장 오래된 달의 잔량부터 차감 */
      v.ships.sort(function (a, b) { return a.date.localeCompare(b.date) || a.order.localeCompare(b.order); });
      v.ships.forEach(function (s) {
        var left = s.qty;
        v.months.forEach(function (m) {
          if (left <= EPS) return;
          var avail = m.owed - m.deducted;
          if (avail <= EPS) return;
          var take = Math.min(left, avail);
          m.deducted = round2(m.deducted + take);
          left = round2(left - take);
          m.allocs.push({ order: s.order, date: s.date, estimated: s.estimated, qty: s.qty, take: round2(take), rest: left });
        });
        if (left > EPS) {
          v.extra = round2(v.extra + left);
          v.extraList.push({ order: s.order, date: s.date, over: left });
          alerts.extra.push(v.name + ' — ' + s.date + ' 출고(' + s.order + ') 중 ' + left.toLocaleString('ko-KR') +
            ' kg은 줘야 할 양보다 더 내줬어요. 입고 누락이나 회수율을 확인해 주세요.');
        }
      });

      v.received = 0; v.owed = 0; v.shipped = 0;
      v.months.forEach(function (m) {
        m.remain = round2(m.owed - m.deducted);
        v.received += m.received; v.owed += m.owed;
      });
      v.ships.forEach(function (s) { v.shipped += s.qty; });
      v.received = round2(v.received); v.owed = round2(v.owed); v.shipped = round2(v.shipped);
      v.remain = round2(v.months.reduce(function (s, m) { return s + (m.remain > EPS ? m.remain : 0); }, 0));
      var cur = v.months.filter(function (m) { return m.remain > EPS; })[0];
      v.current = cur ? { month: cur.month, started: cur.deducted > EPS } : null;
      delete v.monthMap;
      totals.received += v.received; totals.owed += v.owed; totals.shipped += v.shipped; totals.remain += v.remain;
    });
    Object.keys(totals).forEach(function (k) { totals[k] = round2(totals[k]); });

    if (counts.inboundSkip) alerts.info.push('임가공 원료로 등록되지 않은 품목코드의 입고 ' + counts.inboundSkip + '건은 뺐어요.');

    return { vendors: vendors, totals: totals, alerts: alerts, counts: counts };
  }

  var api = { compute: compute, findRate: findRate, codeOwner: codeOwner };
  root.SubcontractCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
