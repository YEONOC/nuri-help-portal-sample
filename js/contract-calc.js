/* contract-calc.js — 총량계약 현황: 관리번호로 주문을 묶어 계약별·계열별 나간 양·남은 양 계산 (화면 코드와 분리) */
(function (root) {
  'use strict';

  var E = root.ErpData || (typeof require !== 'undefined' ? require('./erp-data.js') : null);
  var U = E.util;
  var round2 = U.round2;
  var EPS = 0.0001;

  /* 계약 CSV: 고객사, 관리번호, 계열, 계약수량(kg), 단가(원/kg), 납품시작월, 납품끝월, 비고. 한 행 = 계열 하나 */
  function parseContractCsv(text) {
    var csv = U.parseCsv(text), h = csv.header;
    var c = {
      customer: U.findCol(h, ['고객', '회사', '거래처'], 0), no: U.findCol(h, ['관리번호', 'po'], 1),
      family: U.findCol(h, ['계열'], 2), qty: U.findCol(h, ['계약수량', '수량'], 3), price: U.findCol(h, ['단가'], 4),
      start: U.findCol(h, ['시작'], 5), end: U.findCol(h, ['끝', '종료'], 6), note: U.findCol(h, ['비고', '메모'], 7)
    };
    var rows = csv.rows.map(function (r) {
      var x = {
        line: r.line, customer: r.cols[c.customer] || '', no: r.cols[c.no] || '', family: r.cols[c.family] || '',
        qty: U.parseQty(r.cols[c.qty]), price: U.parseQty(r.cols[c.price]),
        start: U.normMonth(r.cols[c.start]), end: U.normMonth(r.cols[c.end]), note: r.cols[c.note] || ''
      };
      if (!x.end) x.end = x.start;
      if (!x.start) x.start = x.end;
      x.bad = !x.no || !x.family || x.qty === null || !x.end;
      return x;
    });
    var byNo = {}, contracts = [], bad = [];
    rows.forEach(function (x) {
      if (x.bad) { bad.push(x.line); return; }
      if (!byNo[x.no]) {
        byNo[x.no] = { no: x.no, customer: x.customer, note: '', lines: [] };
        contracts.push(byNo[x.no]);
      }
      var ct = byNo[x.no];
      if (x.note && ct.note.indexOf(x.note) === -1) ct.note = ct.note ? ct.note + ' / ' + x.note : x.note;
      ct.lines.push({ family: x.family, qty: x.qty, price: x.price, start: x.start, end: x.end, note: x.note });
    });
    return { contracts: contracts, badLines: bad };
  }

  function lastMonth(ct) {
    var m = '';
    ct.lines.forEach(function (l) { if (l.end > m) m = l.end; });
    return m;
  }

  /* settings: { contracts, codes[{code, family}], excludeCodes[], month: 'YYYY-MM' } */
  function compute(settings, store) {
    var family = {};
    (settings.codes || []).forEach(function (c) { if (c.code) family[c.code.trim()] = (c.family || '').trim(); });
    var exclude = {};
    (settings.excludeCodes || []).forEach(function (c) { exclude[c] = true; });
    var month = settings.month || '';

    var active = (settings.contracts || []).filter(function (c) { return !c.deleted; });
    var byNo = {};
    var results = active.map(function (ct) {
      var r = {
        id: ct.id, no: ct.no, customer: ct.customer, note: ct.note || '', end: lastMonth(ct), level: 'ok',
        lines: ct.lines.map(function (l) {
          return { family: l.family, qty: l.qty, price: l.price, start: l.start, end: l.end, note: l.note || '',
                   shipped: 0, orders: 0, openOrders: 0, estimated: 0 };
        })
      };
      byNo[ct.no] = r;
      return r;
    });

    var check = { nomatch: {}, unknownCode: {}, noFamily: [], noPrice: [], estimated: [] };
    var counts = { total: 0, used: 0, subcontract: 0, nomatch: 0, unknownCode: 0, noFamily: 0 };

    E.orderList(store).forEach(function (o) {
      counts.total++;
      if (exclude[o.code]) { counts.subcontract++; return; }
      if (!family.hasOwnProperty(o.code)) {
        counts.unknownCode++;
        check.unknownCode[o.code] = (check.unknownCode[o.code] || 0) + 1;
        return;
      }
      var r = byNo[o.po];
      if (!r) {
        counts.nomatch++;
        var key = o.po || '(빈칸)';
        if (!check.nomatch[key]) check.nomatch[key] = { orders: 0, qty: 0 };
        check.nomatch[key].orders++;
        check.nomatch[key].qty = round2(check.nomatch[key].qty + (o.shipped || 0));
        return;
      }
      var fam = family[o.code];
      var line = r.lines.filter(function (l) { return l.family === fam; })[0];
      if (!line) {
        counts.noFamily++;
        check.noFamily.push({ no: o.po, order: o.no, family: fam || '(계열 없음)' });
        return;
      }
      counts.used++;
      line.orders++;
      if ((o.shipped || 0) > EPS) {
        line.shipped = round2(line.shipped + o.shipped);
        if (E.shipDate(store, o).estimated) {
          line.estimated++;
          check.estimated.push({ no: o.po, order: o.no, date: o.dueDate });
        }
      } else {
        line.openOrders++;
      }
    });

    var totals = { qty: 0, shipped: 0, remain: 0, sales: 0 };
    results.forEach(function (r) {
      r.qty = 0; r.shipped = 0; r.sales = 0;
      r.lines.forEach(function (l) {
        l.remain = round2(l.qty - l.shipped);
        l.sales = l.price !== null ? round2(l.shipped * l.price) : null;
        if (l.price === null) {
          check.noPrice.push({ no: r.no, customer: r.customer, family: l.family, noteHasNumber: /\d/.test(l.note || r.note) });
          if (r.level === 'ok') r.level = 'warn';
        }
        if (l.shipped <= EPS) l.status = '미출고';
        else if (l.remain < -EPS) { l.status = '초과'; if (r.level === 'ok') r.level = 'info'; }
        else if (l.remain <= EPS) l.status = '완료';
        else l.status = '진행 중';
        r.qty += l.qty; r.shipped += l.shipped; r.sales += l.sales || 0;
      });
      r.qty = round2(r.qty); r.shipped = round2(r.shipped); r.remain = round2(r.qty - r.shipped); r.sales = round2(r.sales);
      r.ended = !!month && !!r.end && r.end < month;
      totals.qty += r.qty; totals.shipped += r.shipped; totals.sales += r.sales;
    });
    totals.qty = round2(totals.qty); totals.shipped = round2(totals.shipped);
    totals.remain = round2(totals.qty - totals.shipped); totals.sales = round2(totals.sales);

    results.sort(function (a, b) { return a.customer.localeCompare(b.customer) || a.no.localeCompare(b.no); });

    /* 계약 정산: 납품 마지막 달이 지난 계약 */
    var settlement = results.filter(function (r) { return r.ended; }).map(function (r) {
      return {
        no: r.no, customer: r.customer, end: r.end,
        lines: r.lines.map(function (l) {
          var diff = round2(l.shipped - l.qty);
          return { family: l.family, qty: l.qty, shipped: l.shipped, diff: diff,
                   rate: l.qty > EPS ? round2(l.shipped / l.qty * 100) : 0,
                   label: Math.abs(diff) <= EPS ? '일치' : (diff > 0 ? '초과' : '미출고') };
        })
      };
    });

    return { contracts: results, totals: totals, check: check, counts: counts, settlement: settlement };
  }

  var api = { parseContractCsv: parseContractCsv, compute: compute };
  root.ContractCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
