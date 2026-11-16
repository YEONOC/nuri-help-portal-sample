/* erp-data.js — CSV 읽기와 ERP 자료 저장소 (총량계약 현황·임가공 관리가 함께 씀) */
/* ERP 자료는 쌓이기만 함: 같은 주문번호·입고번호는 새 값으로 바꾸고 나머지는 남김 */
(function (root) {
  'use strict';

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

  function normMonth(s) {
    var m = /^(\d{4})[-./](\d{1,2})/.exec(String(s || '').trim());
    if (!m) return '';
    var mo = Number(m[2]);
    if (mo < 1 || mo > 12) return '';
    return m[1] + '-' + (mo < 10 ? '0' : '') + mo;
  }

  function parseQty(s) {
    var t = String(s === undefined || s === null ? '' : s).replace(/[,\s]/g, '');
    if (t === '') return null;
    var n = Number(t);
    return isNaN(n) ? null : n;
  }

  /* ── ERP 파일 3종 ────────────────────────────────────── */
  /* [영업관리 › 주문현황]: 주문번호, 관리번호, 품목코드, 주문일, 납기일, 주문수량(kg), 출고수량(kg) */
  function parseOrdersCsv(text) {
    var csv = parseCsv(text), h = csv.header;
    var c = {
      no: findCol(h, ['주문번호'], 0), po: findCol(h, ['관리번호', 'po'], 1), code: findCol(h, ['품목코드', '품번'], 2),
      orderDate: findCol(h, ['주문일'], 3), dueDate: findCol(h, ['납기'], 4),
      qty: findCol(h, ['주문수량'], 5), shipped: findCol(h, ['출고수량'], 6)
    };
    return csv.rows.map(function (r) {
      var o = {
        line: r.line, no: r.cols[c.no] || '', po: r.cols[c.po] || '', code: r.cols[c.code] || '',
        orderDate: normDate(r.cols[c.orderDate]), dueDate: normDate(r.cols[c.dueDate]),
        qty: parseQty(r.cols[c.qty]), shipped: parseQty(r.cols[c.shipped])
      };
      if (!o.dueDate) o.dueDate = o.orderDate;
      if (o.shipped === null) o.shipped = 0;
      o.bad = !o.no || !o.code || o.qty === null || !o.dueDate;
      return o;
    });
  }

  /* [영업관리 › 출고현황]: 주문번호, 출고일, 출고수량(kg). 한 주문이 여러 번 나가면 마지막 출고일을 씀 */
  function parseShipmentsCsv(text) {
    var csv = parseCsv(text), h = csv.header;
    var c = { no: findCol(h, ['주문번호'], 0), date: findCol(h, ['출고일'], 1), qty: findCol(h, ['출고수량', '수량'], 2) };
    return csv.rows.map(function (r) {
      var s = { line: r.line, no: r.cols[c.no] || '', date: normDate(r.cols[c.date]), qty: parseQty(r.cols[c.qty]) };
      s.bad = !s.no || !s.date;
      return s;
    });
  }

  /* [구매관리 › 입고현황]: 입고번호, 입고일, 품목코드, 입고수량(kg) */
  function parseInboundCsv(text) {
    var csv = parseCsv(text), h = csv.header;
    var c = { no: findCol(h, ['입고번호'], 0), date: findCol(h, ['입고일'], 1), code: findCol(h, ['품목코드', '품번'], 2), qty: findCol(h, ['입고수량', '수량'], 3) };
    return csv.rows.map(function (r) {
      var x = { line: r.line, no: r.cols[c.no] || '', date: normDate(r.cols[c.date]), code: r.cols[c.code] || '', qty: parseQty(r.cols[c.qty]) };
      x.bad = !x.no || !x.date || !x.code || x.qty === null;
      return x;
    });
  }

  /* ── 저장소 ──────────────────────────────────────────── */
  var KEYS = { orders: 'erp_orders', ships: 'erp_ships', inbound: 'erp_inbound' };

  function emptyStore() { return { orders: {}, ships: {}, inbound: {} }; }

  /* 브라우저 저장은 편의 기능. 실패해도 빈 저장소로 동작 */
  function load() {
    var store = emptyStore();
    Object.keys(KEYS).forEach(function (k) {
      try {
        var v = JSON.parse(root.localStorage.getItem(KEYS[k]));
        if (v && typeof v === 'object' && !Array.isArray(v)) store[k] = v;
      } catch (e) { /* 무시 */ }
    });
    return store;
  }
  function save(store) {
    Object.keys(KEYS).forEach(function (k) {
      try { root.localStorage.setItem(KEYS[k], JSON.stringify(store[k])); } catch (e) { /* 무시 */ }
    });
  }

  function mergeInto(map, rows, keyOf, valueOf) {
    var res = { added: 0, updated: 0, bad: 0, badLines: [] };
    rows.forEach(function (r) {
      if (r.bad) { res.bad++; res.badLines.push(r.line); return; }
      var k = keyOf(r);
      if (map.hasOwnProperty(k)) res.updated++; else res.added++;
      map[k] = valueOf(r);
    });
    return res;
  }

  function mergeOrders(store, rows) {
    return mergeInto(store.orders, rows, function (r) { return r.no; }, function (r) {
      return { no: r.no, po: r.po, code: r.code, orderDate: r.orderDate, dueDate: r.dueDate, qty: r.qty, shipped: r.shipped };
    });
  }

  function mergeShipments(store, rows) {
    var byNo = {}, good = [];
    rows.forEach(function (r) {
      if (r.bad) { good.push(r); return; }
      if (!byNo[r.no]) { byNo[r.no] = { line: r.line, no: r.no, date: r.date, qty: 0, bad: false }; good.push(byNo[r.no]); }
      if (r.date > byNo[r.no].date) byNo[r.no].date = r.date;
      byNo[r.no].qty = round2(byNo[r.no].qty + (r.qty || 0));
    });
    return mergeInto(store.ships, good, function (r) { return r.no; }, function (r) { return { date: r.date, qty: r.qty }; });
  }

  function mergeInbound(store, rows) {
    return mergeInto(store.inbound, rows, function (r) { return r.no; }, function (r) {
      return { no: r.no, date: r.date, code: r.code, qty: r.qty };
    });
  }

  /* 주문의 출고일: 출고현황에 있으면 그 날짜, 없으면 납기일로 추정 */
  function shipDate(store, order) {
    var s = store.ships[order.no];
    if (s && s.date) return { date: s.date, estimated: false };
    return { date: order.dueDate, estimated: true };
  }

  function orderList(store) { return Object.keys(store.orders).map(function (k) { return store.orders[k]; }); }
  function inboundList(store) { return Object.keys(store.inbound).map(function (k) { return store.inbound[k]; }); }

  var api = {
    util: { round2: round2, parseCsv: parseCsv, findCol: findCol, normDate: normDate, normMonth: normMonth, parseQty: parseQty },
    parseOrdersCsv: parseOrdersCsv, parseShipmentsCsv: parseShipmentsCsv, parseInboundCsv: parseInboundCsv,
    emptyStore: emptyStore, load: load, save: save,
    mergeOrders: mergeOrders, mergeShipments: mergeShipments, mergeInbound: mergeInbound,
    shipDate: shipDate, orderList: orderList, inboundList: inboundList, KEYS: KEYS
  };
  root.ErpData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
