/* search.js — 전문 검색 (design.md 5-6) */
(function () {
  'use strict';

  /* ── 검색 대상 데이터 파일 목록 ──────────────────────── */
  var DATA_FILES = [
    { file: 'data/help-sales.json',    module: '영업 주문' },
    { file: 'data/help-purchase.json', module: '구매 발주' },
    { file: 'data/help-inventory.json',module: '재고 이동' },
    { file: 'data/help-approval.json', module: '전자결재' },
    { file: 'data/faq.json',           module: 'FAQ' },
    { file: 'data/glossary.json',      module: '용어집' },
  ];

  var index = [];   // { path, title, text, url }
  var loaded = false;

  /* 데이터·링크 경로는 사이트 최상위 기준. help/ 같은 하위 폴더 페이지에서도 같은 곳을 가리키게
     이 스크립트(js/search.js)의 위치에서 최상위를 계산 */
  var ROOT = (function () {
    var s = document.currentScript;
    try { return s && s.src ? new URL('../', s.src).href : ''; } catch (e) { return ''; }
  })();
  function fromRoot(path) {
    if (!path || path.charAt(0) === '#') return path || '#';
    try { return new URL(path, ROOT || location.href).href; } catch (e) { return path; }
  }

  /* ── 색인 구축 ───────────────────────────────────────── */
  function buildIndex(dataList) {
    index = [];
    dataList.forEach(function (src) {
      var data = src.data;
      // help-*.json: pages[]
      if (data.pages && Array.isArray(data.pages)) {
        data.pages.forEach(function (page) {
          var items = [].concat(
            page.steps  || [],
            page.faq    || [],
            page.desc   ? [page.desc] : []
          );
          items.forEach(function (item) {
            index.push({
              path:  src.module + (page.title ? ' › ' + page.title : ''),
              title: item.q || item.title || item.text || '',
              text:  item.a || item.body  || item.text || '',
              url:   item.url || page.url || '#',
            });
          });
          // 페이지 자체도 추가
          if (page.title) {
            index.push({
              path:  src.module,
              title: page.title,
              text:  page.desc || '',
              url:   page.url || '#',
            });
          }
        });
      }
      // faq.json: items[]
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach(function (item) {
          index.push({
            path:  src.module,
            title: item.q || '',
            text:  item.a || '',
            url:   item.url || '#',
          });
        });
      }
      // glossary.json: terms[]
      if (data.terms && Array.isArray(data.terms)) {
        data.terms.forEach(function (term) {
          index.push({
            path:  src.module,
            title: term.term || term.name || '',
            text:  term.def  || term.description || '',
            url:   term.url  || 'glossary.html',
          });
        });
      }
    });
  }

  function loadData(callback) {
    if (loaded) { callback(); return; }
    var promises = DATA_FILES.map(function (src) {
      return fetch(fromRoot(src.file))
        .then(function (r) { return r.json(); })
        .then(function (data) { return { module: src.module, data: data }; })
        .catch(function () { return { module: src.module, data: {} }; });
    });
    Promise.all(promises).then(function (dataList) {
      buildIndex(dataList);
      loaded = true;
      callback();
    });
  }

  /* ── 검색 실행 ───────────────────────────────────────── */
  function search(query) {
    if (!query.trim()) return [];
    var q = query.trim().toLowerCase();
    return index.filter(function (item) {
      return (item.title + ' ' + item.text + ' ' + item.path).toLowerCase().includes(q);
    }).slice(0, 20);
  }

  /* ── 일치 부분 굵게 ──────────────────────────────────── */
  function highlight(text, query) {
    if (!text) return '';
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp('(' + escaped + ')', 'gi'),
      '<mark>$1</mark>');
  }

  /* ── UI ──────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    var overlay    = document.getElementById('search-overlay');
    var input      = document.getElementById('search-input');
    var results    = document.getElementById('search-results');
    var btnOpen    = document.getElementById('btn-search');
    var btnClose   = document.getElementById('btn-search-close');

    if (!overlay || !input || !results) return;

    function openSearch() {
      overlay.removeAttribute('hidden');
      input.value = '';
      results.innerHTML = '';
      input.focus();
      /* 읽는 중에 입력한 검색어는 다 읽은 뒤 다시 찾음 */
      loadData(function () {
        if (input.value.trim()) renderResults(input.value);
      });
    }

    function closeSearch() {
      overlay.setAttribute('hidden', '');
      var prev = document.getElementById('btn-search');
      if (prev) prev.focus();
    }

    function renderResults(query) {
      var items = search(query);
      if (items.length === 0) {
        results.innerHTML = '<li class="search-no-result">찾는 내용이 없어요.</li>';
        return;
      }
      results.innerHTML = items.map(function (item) {
        var title = highlight(item.title, query);
        var text  = highlight(item.text.slice(0, 80), query);
        return '<li class="search-result-item">' +
          '<a href="' + fromRoot(item.url) + '">' +
          '<div class="search-result-item__path">' + item.path + '</div>' +
          '<div class="search-result-item__text">' + title +
            (text ? ' — ' + text : '') + '</div>' +
          '</a></li>';
      }).join('');
    }

    if (btnOpen) btnOpen.addEventListener('click', openSearch);
    if (btnClose) btnClose.addEventListener('click', closeSearch);

    input.addEventListener('input', function () {
      if (input.value.trim().length > 0) renderResults(input.value);
      else results.innerHTML = '';
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSearch();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === '/') {
        var tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        openSearch();
      }
      if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) {
        closeSearch();
      }
    });
  });
})();
