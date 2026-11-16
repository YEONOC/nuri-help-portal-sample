/* sample-data.js — 총량계약 현황·임가공 관리 견본 데이터 (두 도구가 ERP 자료를 함께 쓰므로 한 번에 채움) */
(function (root) {
  'use strict';

  var KEYS = {
    ctCodes: 'ct_codes', ctContracts: 'ct_contracts',
    skVendors: 'sk_vendors', skRaw: 'sk_raw', skPrd: 'sk_prd', skRates: 'sk_rates', skHistory: 'sk_history'
  };

  var SETTINGS = {
    ctCodes: [
      { code: 'NR-01-0001', name: '합금 소재 A형 · 형태 가', family: 'A형 계열' },
      { code: 'NR-01-0002', name: '합금 소재 A형 · 형태 나', family: 'A형 계열' },
      { code: 'NR-02-0001', name: '합금 소재 B형 · 형태 가', family: 'B형 계열' },
      { code: 'NR-02-0002', name: '합금 소재 B형 · 형태 나', family: 'B형 계열' }
    ],
    skVendors: [{ name: '임가공업체 P' }, { name: '임가공업체 Q' }],
    skRaw: [
      { code: 'NR-90-0001', name: '원료 S1', vendor: '임가공업체 P' },
      { code: 'NR-90-0002', name: '원료 S2', vendor: '임가공업체 P' },
      { code: 'NR-91-0001', name: '원료 S1', vendor: '임가공업체 Q' }
    ],
    skPrd: [
      { code: 'NR-01-9001', name: '합금 소재 A형 (임가공)', vendor: '임가공업체 P' },
      { code: 'NR-02-9001', name: '합금 소재 B형 (임가공)', vendor: '임가공업체 Q' }
    ],
    skRates: [
      { code: 'NR-90-0001', year: '2025', r: 84 },
      { code: 'NR-90-0001', year: '2026', r: 85 },
      { code: 'NR-90-0002', year: '2026', r: 78 },
      { code: 'NR-91-0001', year: '2026', r: 80 }
    ],
    skHistory: [
      { at: '2026-03-02', code: 'NR-90-0001', year: '2026', before: 83, after: 85 }
    ]
  };

  function setJson(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ }
  }

  function fetchText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('fetch');
      return r.text();
    });
  }

  /* base: 도구 화면에서 견본 CSV 폴더까지의 경로 */
  function fill(base) {
    var E = root.ErpData, C = root.ContractCalc;
    return Promise.all([
      fetchText(base + 'contract-sample.csv'), fetchText(base + 'erp-orders-sample.csv'),
      fetchText(base + 'erp-shipments-sample.csv'), fetchText(base + 'erp-inbound-sample.csv')
    ]).then(function (t) {
      var stamp = Date.now();
      var contracts = C.parseContractCsv(t[0]).contracts.map(function (c, i) {
        c.id = 'c' + stamp + '-' + i; c.deleted = false; return c;
      });
      var store = E.emptyStore();
      E.mergeOrders(store, E.parseOrdersCsv(t[1]));
      E.mergeShipments(store, E.parseShipmentsCsv(t[2]));
      E.mergeInbound(store, E.parseInboundCsv(t[3]));
      E.save(store);
      Object.keys(SETTINGS).forEach(function (k) { setJson(KEYS[k], SETTINGS[k]); });
      setJson(KEYS.ctContracts, contracts);
    });
  }

  function clearAll() {
    Object.keys(KEYS).forEach(function (k) { try { root.localStorage.removeItem(KEYS[k]); } catch (e) { /* 무시 */ } });
    Object.keys(root.ErpData.KEYS).forEach(function (k) { try { root.localStorage.removeItem(root.ErpData.KEYS[k]); } catch (e) { /* 무시 */ } });
  }

  root.SampleData = { KEYS: KEYS, fill: fill, clearAll: clearAll };
})(window);
