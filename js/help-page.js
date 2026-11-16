/* help-page.js — JSON에서 도움말 페이지 렌더링 */
var HelpPage = (function () {
  'use strict';

  /* ── 메뉴 경로 칩 변환 (design.md 5-1) ───────────────── */
  // [메뉴 › 하위] → chip--menu, {버튼} → chip--btn, '항목' → chip--field
  function parseChips(text) {
    return text
      .replace(/\[([^\]]+)\]/g, '<span class="chip chip--menu">$1</span>')
      .replace(/\{([^}]+)\}/g, '<span class="chip chip--btn">$1</span>')
      .replace(/'([^']+)'/g,   '<span class="chip chip--field">$1</span>');
  }

  /* ── 단계 목록 렌더링 (design.md 5-2) ───────────────── */
  function renderSteps(steps) {
    if (!steps || !steps.length) return '';
    var items = steps.map(function (step, i) {
      var body   = parseChips(step.text);
      var result = step.result
        ? '<span class="step-item__result">' + step.result + '</span>'
        : '';
      return '<li class="step-item">' +
        '<span class="step-item__num" aria-hidden="true">' + (i + 1) + '</span>' +
        '<div class="step-item__body">' + body + result + '</div>' +
        '</li>';
    });
    return '<ol class="step-list" role="list">' + items.join('') + '</ol>';
  }

  /* ── FAQ 렌더링 (design.md 5-5) ─────────────────────── */
  function renderFaq(faq, sectionId) {
    if (!faq || !faq.length) return '';
    var items = faq.map(function (item) {
      return '<li class="faq-item"><details>' +
        '<summary>' + item.q + '</summary>' +
        '<div class="faq-answer"><p>' + parseChips(item.a) + '</p></div>' +
        '</details></li>';
    });
    /* 한 페이지에 절마다 FAQ가 있으므로 id를 절 이름으로 구분 (예: draft-faq) */
    return '<h3 id="' + sectionId + '-faq">자주 묻는 질문</h3>' +
      '<ul class="faq-list">' + items.join('') + '</ul>';
  }

  /* ── 섹션 렌더링 ────────────────────────────────────── */
  function renderSection(page) {
    var desc = page.desc
      ? '<p class="section-desc">' + page.desc + '</p>'
      : '';
    return '<section id="' + page.id + '" aria-labelledby="h-' + page.id + '">' +
      '<h2 id="h-' + page.id + '">' + page.title + '</h2>' +
      desc +
      renderSteps(page.steps) +
      renderFaq(page.faq, page.id) +
      '</section>';
  }

  /* ── 목차 렌더링 ────────────────────────────────────── */
  function renderToc(pages) {
    var items = pages.map(function (p) {
      return '<li><a href="#' + p.id + '">' + p.title + '</a></li>';
    });
    return '<nav class="page-toc-inline" aria-label="이 페이지 목차">' +
      '<ul>' + items.join('') + '</ul>' +
      '</nav>';
  }

  /* ── 흐름도: 선형 ────────────────────────────────────── */
  function buildLinearFlow(steps) {
    var W = 280, CX = 140, BX = 40, BW = 200, BH = 36, BRX = 4;
    var PAD = 10, GAP = 24;
    var n = steps.length;
    var totalH = PAD + n * BH + (n - 1) * GAP + PAD;
    var shapes = '';

    for (var i = 0; i < n; i++) {
      var by = PAD + i * (BH + GAP);
      var step = steps[i];
      var isErp = (step.kind === 'erp');
      shapes +=
        '<rect class="flow-box ' + (isErp ? 'flow-box--primary' : 'flow-box--surface') +
        '" x="' + BX + '" y="' + by + '" width="' + BW + '" height="' + BH + '" rx="' + BRX + '"/>' +
        '<text class="flow-label ' + (isErp ? 'flow-label--primary' : 'flow-label--surface') +
        '" x="' + CX + '" y="' + (by + BH / 2) + '" dominant-baseline="central" text-anchor="middle">' +
        step.label + '</text>';
      if (i < n - 1) {
        var ly1 = by + BH, ly2 = ly1 + 14, ty = ly1 + 22;
        shapes +=
          '<line class="flow-line" x1="' + CX + '" y1="' + ly1 + '" x2="' + CX + '" y2="' + ly2 + '"/>' +
          '<polygon class="flow-arrowhead" points="' + CX + ',' + ty + ' ' +
          (CX - 6) + ',' + ly2 + ' ' + (CX + 6) + ',' + ly2 + '"/>';
      }
    }
    return '<svg viewBox="0 0 ' + W + ' ' + totalH +
      '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="업무 흐름도">' +
      '<title>업무 흐름도</title>' + shapes + '</svg>';
  }

  /* ── 흐름도: 분기 ────────────────────────────────────── */
  function buildBranchFlow(steps, branches) {
    var W = 300, PRE_CX = 150, PRE_BX = 50, PRE_BW = 200;
    var L_CX = 75, R_CX = 225, BR_BX_L = 10, BR_BX_R = 160, BR_BW = 130;
    var BH = 36, BRX = 4, PAD = 10, GAP = 24;
    var n = steps.length;
    var shapes = '';

    for (var i = 0; i < n; i++) {
      var by = PAD + i * (BH + GAP);
      var step = steps[i];
      var isErp = (step.kind === 'erp');
      shapes +=
        '<rect class="flow-box ' + (isErp ? 'flow-box--primary' : 'flow-box--surface') +
        '" x="' + PRE_BX + '" y="' + by + '" width="' + PRE_BW + '" height="' + BH + '" rx="' + BRX + '"/>' +
        '<text class="flow-label ' + (isErp ? 'flow-label--primary' : 'flow-label--surface') +
        '" x="' + PRE_CX + '" y="' + (by + BH / 2) + '" dominant-baseline="central" text-anchor="middle">' +
        step.label + '</text>';
      if (i < n - 1) {
        var ly1 = by + BH, ly2 = ly1 + 14, ty = ly1 + 22;
        shapes +=
          '<line class="flow-line" x1="' + PRE_CX + '" y1="' + ly1 + '" x2="' + PRE_CX + '" y2="' + ly2 + '"/>' +
          '<polygon class="flow-arrowhead" points="' + PRE_CX + ',' + ty + ' ' +
          (PRE_CX - 6) + ',' + ly2 + ' ' + (PRE_CX + 6) + ',' + ly2 + '"/>';
      }
    }

    var lastBottom = PAD + n * BH + (n - 1) * GAP;
    var stemY = lastBottom + 12;
    var brLy2 = stemY + 10, brTip = stemY + 18, brBoxY = brTip + 2;

    shapes +=
      '<line class="flow-line" x1="' + PRE_CX + '" y1="' + lastBottom + '" x2="' + PRE_CX + '" y2="' + stemY + '"/>' +
      '<line class="flow-line" x1="' + L_CX + '" y1="' + stemY + '" x2="' + R_CX + '" y2="' + stemY + '"/>' +
      '<line class="flow-line" x1="' + L_CX + '" y1="' + stemY + '" x2="' + L_CX + '" y2="' + brLy2 + '"/>' +
      '<polygon class="flow-arrowhead" points="' + L_CX + ',' + brTip + ' ' +
      (L_CX - 6) + ',' + brLy2 + ' ' + (L_CX + 6) + ',' + brLy2 + '"/>' +
      '<line class="flow-line" x1="' + R_CX + '" y1="' + stemY + '" x2="' + R_CX + '" y2="' + brLy2 + '"/>' +
      '<polygon class="flow-arrowhead" points="' + R_CX + ',' + brTip + ' ' +
      (R_CX - 6) + ',' + brLy2 + ' ' + (R_CX + 6) + ',' + brLy2 + '"/>';

    var brBox = function (b, bx, cx) {
      var bc = b.kind === 'erp' ? 'flow-box--primary' :
               (b.kind === 'warn' ? 'flow-box--warn' : 'flow-box--surface');
      var tc = b.kind === 'erp' ? 'flow-label--primary' :
               (b.kind === 'warn' ? 'flow-label--warn' : 'flow-label--surface');
      return '<rect class="flow-box ' + bc + '" x="' + bx + '" y="' + brBoxY +
             '" width="' + BR_BW + '" height="' + BH + '" rx="' + BRX + '"/>' +
             '<text class="flow-label ' + tc + '" x="' + cx + '" y="' + (brBoxY + BH / 2) +
             '" dominant-baseline="central" text-anchor="middle">' + b.label + '</text>';
    };
    shapes += brBox(branches[0], BR_BX_L, L_CX) + brBox(branches[1], BR_BX_R, R_CX);

    var totalH = brBoxY + BH + PAD;
    return '<svg viewBox="0 0 ' + W + ' ' + totalH +
      '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="업무 흐름도">' +
      '<title>업무 흐름도</title>' + shapes + '</svg>';
  }

  /* ── 흐름도 섹션 렌더링 (design.md 5-2) ────────────── */
  function renderFlowchart(fc) {
    if (!fc || !fc.steps || !fc.steps.length) return '';
    var svg = '';
    if (fc.type === 'linear') {
      svg = buildLinearFlow(fc.steps);
    } else if (fc.type === 'branch') {
      svg = buildBranchFlow(fc.steps, fc.branches || []);
    }
    if (!svg) return '';
    return '<div class="flow-diagram" aria-label="업무 흐름도"><h2>업무 흐름</h2>' + svg +
      '<p class="flow-legend"><span class="flow-dot flow-dot--erp">●</span> ERP 처리 단계' +
      '&emsp;<span class="flow-dot flow-dot--ext">●</span> 외부 사건·결과</p></div>';
  }

  /* ── 오류 메시지 ────────────────────────────────────── */
  function renderError() {
    return '<div class="callout callout--danger">' +
      '<span class="callout__icon" aria-hidden="true">✕</span>' +
      '<div class="callout__body">' +
      '<strong class="callout__title">오류</strong>' +
      '<p>콘텐츠를 불러오지 못했어요. 새로고침해 보세요.</p>' +
      '</div></div>';
  }

  /* ── 사이드바 현재 위치 표시 ────────────────────────── */
  function markCurrentSidebar() {
    var current = window.location.pathname.split('/').pop();
    var links = document.querySelectorAll('.sidebar a');
    links.forEach(function (a) {
      var href = a.getAttribute('href').split('/').pop();
      if (href === current) {
        a.setAttribute('aria-current', 'page');
      } else {
        a.removeAttribute('aria-current');
      }
    });
  }

  /* ── 검색 열기 시 데이터 사전 로드 알림 ───────────────── */
  function notifySearch(data) {
    if (window.__helpPageData) window.__helpPageData.push(data);
    else window.__helpPageData = [data];
  }

  /* ── 공개 API ───────────────────────────────────────── */
  function load(jsonPath, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    fetch(jsonPath)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var html = '<h1>' + data.title + '</h1>' +
          renderFlowchart(data.flowchart) +
          renderToc(data.pages) +
          data.pages.map(renderSection).join('');
        el.innerHTML = html;
        document.title = data.title + ' — 업무 도움말 포털';
        markCurrentSidebar();
        notifySearch(data);
      })
      .catch(function () {
        el.innerHTML = renderError();
      });
  }

  return { load: load };
})();
