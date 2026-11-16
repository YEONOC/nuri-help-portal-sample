/* theme.js — 다크 모드·현장 모드 스위치 (design.md 2-3, 3-1) */
(function () {
  'use strict';

  /* ── 저장·읽기 헬퍼 (실패해도 기본값으로 동작) ─────────── */
  function load(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, val); } catch { /* 무시 */ }
  }

  /* ── 다크 모드 ───────────────────────────────────────────── */
  var darkStored = load('theme');
  if (darkStored === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (darkStored === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  // 저장값 없으면 CSS media query가 처리

  /* ── 현장 모드 ───────────────────────────────────────────── */
  if (load('fieldmode') === 'on') {
    document.documentElement.setAttribute('data-fieldmode', 'on');
  }

  /* ── 인쇄 쪽 아래: 페이지 제목 · 도움말 기준일 · 인쇄 날짜 (design.md 7장) ── */
  /* print.css의 고정 문구를 덮어씀. 기준일을 못 읽어도 제목·인쇄 날짜는 찍힘 */
  var scriptSrc = document.currentScript && document.currentScript.src;
  var contentDate = '';

  function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function cssString(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

  function applyPrintFooter() {
    var title = document.title.split(' — ')[0];
    var right = (contentDate ? '도움말 ' + contentDate + ' 기준 · ' : '') + '인쇄 ' + today() + ' · ';
    var style = document.getElementById('print-footer-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'print-footer-style';
      document.head.appendChild(style);
    }
    style.textContent = '@media print { @page {' +
      ' @bottom-left { content: ' + cssString('누리금속(가상) 업무 도움말 포털 · ' + title) + '; font-size: 9pt; color: #555; }' +
      ' @bottom-right { content: ' + cssString(right) + ' counter(page); font-size: 9pt; color: #555; }' +
      ' } }';
  }

  applyPrintFooter();
  window.addEventListener('beforeprint', applyPrintFooter);

  /* 인쇄할 때 접힌 FAQ 답이 빠지지 않게 펼쳤다가, 인쇄 후 원래대로 접음 */
  var openedForPrint = [];
  window.addEventListener('beforeprint', function () {
    openedForPrint = Array.prototype.filter.call(document.querySelectorAll('details:not([open])'), function (d) {
      d.open = true;
      return true;
    });
  });
  window.addEventListener('afterprint', function () {
    openedForPrint.forEach(function (d) { d.open = false; });
    openedForPrint = [];
  });
  if (scriptSrc && window.fetch) {
    fetch(new URL('../data/site.json', scriptSrc).href)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(data.contentDate || '')) {
          contentDate = data.contentDate;
          applyPrintFooter();
        }
      })
      .catch(function () { /* 기준일 없이 찍음 */ });
  }

  /* ── DOM 준비 후 버튼 연결 ───────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    var btnDark  = document.getElementById('btn-darkmode');
    var btnField = document.getElementById('btn-fieldmode');

    function updateDarkBtn() {
      if (!btnDark) return;
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.hasAttribute('data-theme') &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      btnDark.setAttribute('aria-pressed', String(isDark));
      btnDark.textContent = isDark ? '라이트' : '다크';
    }

    function updateFieldBtn() {
      if (!btnField) return;
      var on = document.documentElement.getAttribute('data-fieldmode') === 'on';
      btnField.setAttribute('aria-pressed', String(on));
      btnField.textContent = on ? '글자 작게' : '글자 크게';
    }

    if (btnDark) {
      updateDarkBtn();
      btnDark.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        var isDark = current === 'dark' ||
          (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
        var next = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        save('theme', next);
        updateDarkBtn();
      });
    }

    if (btnField) {
      updateFieldBtn();
      btnField.addEventListener('click', function () {
        var on = document.documentElement.getAttribute('data-fieldmode') === 'on';
        if (on) {
          document.documentElement.removeAttribute('data-fieldmode');
          save('fieldmode', 'off');
        } else {
          document.documentElement.setAttribute('data-fieldmode', 'on');
          save('fieldmode', 'on');
        }
        updateFieldBtn();
      });
    }

    /* ── 태블릿 사이드바 토글 ─────────────────────────────── */
    var sidebar    = document.getElementById('sidebar');
    var btnSidebarClose = document.getElementById('btn-sidebar-close');

    var btnMenu = document.getElementById('btn-menu');

    function openSidebar() {
      if (!sidebar) return;
      sidebar.classList.add('is-open');
      if (btnMenu) btnMenu.setAttribute('aria-expanded', 'true');
    }
    function closeSidebar() {
      if (!sidebar) return;
      sidebar.classList.remove('is-open');
      if (btnMenu) btnMenu.setAttribute('aria-expanded', 'false');
    }

    if (btnMenu) btnMenu.addEventListener('click', openSidebar);
    if (btnSidebarClose) btnSidebarClose.addEventListener('click', closeSidebar);

    document.addEventListener('click', function (e) {
      if (sidebar && sidebar.classList.contains('is-open') &&
          !sidebar.contains(e.target) && e.target !== btnMenu) {
        closeSidebar();
      }
    });
  });
})();
