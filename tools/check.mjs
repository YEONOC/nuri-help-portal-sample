#!/usr/bin/env node
/**
 * tools/check.mjs
 * 금지 단어 · JSON 문법 · 내부 링크 id · 외부 URL 검사
 * 사용: node tools/check.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 무시 경로 ──────────────────────────────────────────────────────────────
// .claude: 로컬 미리보기 설정 (git에 올리지 않음 — .gitignore)
const SKIP_DIRS = new Set(['.private', '.git', '.claude', 'node_modules', 'fonts']);
const TEXT_EXTS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.csv']);

// ── 파일 목록 ──────────────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (SKIP_DIRS.has(rel.split('/')[0])) continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ── 금지 단어 로드 ─────────────────────────────────────────────────────────
function loadForbidden() {
  const path = join(ROOT, '.private', 'forbidden-words.txt');
  if (!existsSync(path)) { console.warn('  △ .private/forbidden-words.txt 없음 — 금지 단어 검사 건너뜀'); return []; }
  return readFileSync(path, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

// ── 출력 헬퍼 ──────────────────────────────────────────────────────────────
let errors = 0;
let warnings = 0;
function err(msg)  { console.error('  ✗', msg); errors++; }
function warn(msg) { console.warn ('  △', msg); warnings++; }
function ok(msg)   { console.log  ('  ✓', msg); }

// ── 초기화 ─────────────────────────────────────────────────────────────────
const forbidden = loadForbidden();
const allFiles  = walk(ROOT).filter(f => TEXT_EXTS.has(extname(f)));
// 검사 자신과 기준 문서는 금지 단어를 언급할 수 있으므로 제외
const SKIP_FORBIDDEN = new Set(['tools/check.mjs', 'CLAUDE.md', 'design.md']);

console.log(`\n검사 대상: ${allFiles.length}개 파일\n`);

// ── 1. 금지 단어 ───────────────────────────────────────────────────────────
console.log('[ 1 ] 금지 단어');
let hitCount = 0;
for (const f of allFiles) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  if (SKIP_FORBIDDEN.has(rel)) continue;
  const lower = readFileSync(f, 'utf8').toLowerCase();
  for (const word of forbidden) {
    if (lower.includes(word.toLowerCase())) {
      err(`${rel}: 금지 단어 "${word}"`);
      hitCount++;
    }
  }
}
if (hitCount === 0) ok('금지 단어 없음');

// ── 2. JSON 문법 ───────────────────────────────────────────────────────────
console.log('\n[ 2 ] JSON 문법');
let jsonOk = 0;
for (const f of allFiles) {
  if (extname(f) !== '.json') continue;
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  try { JSON.parse(readFileSync(f, 'utf8')); jsonOk++; }
  catch (e) { err(`${rel}: JSON 파싱 오류 — ${e.message}`); }
}
if (jsonOk > 0) ok(`JSON 파일 ${jsonOk}개 통과`);
else ok('JSON 파일 없음 (통과)');

// ── 3. 내부 링크 · id ──────────────────────────────────────────────────────
console.log('\n[ 3 ] 내부 링크 · id');
const htmlFiles = allFiles.filter(f => extname(f) === '.html');

const idCache = {};
function getIds(file) {
  if (idCache[file]) return idCache[file];
  const ids = new Set([...readFileSync(file, 'utf8').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  idCache[file] = ids;
  return ids;
}

let linkErrs = 0;
for (const f of htmlFiles) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const text = readFileSync(f, 'utf8');
  const dir  = dirname(f);

  // href="#id" — 같은 파일 안 id
  for (const [, frag] of text.matchAll(/href="#([^"]+)"/g)) {
    if (!getIds(f).has(frag)) {
      err(`${rel}: href="#${frag}" — id="${frag}" 없음`);
      linkErrs++;
    }
  }

  // href="path.html#id" — 다른 파일 id
  for (const [, path, frag] of text.matchAll(/href="([^"#]+\.html)#([^"]+)"/g)) {
    if (path.startsWith('http')) continue;
    const target = resolve(dir, path);
    if (!existsSync(target)) {
      err(`${rel}: href="${path}#${frag}" — 파일 없음`);
      linkErrs++;
    } else if (!getIds(target).has(frag)) {
      err(`${rel}: href="${path}#${frag}" — id="${frag}" 없음`);
      linkErrs++;
    }
  }

  // href="path.html" — 파일 존재 여부 (경고)
  for (const [, path] of text.matchAll(/href="([^"#?]+\.html)"/g)) {
    if (path.startsWith('http')) continue;
    const target = resolve(dir, path);
    if (!existsSync(target)) {
      warn(`${rel}: href="${path}" — 파일 아직 없음`);
    }
  }
}
if (linkErrs === 0) ok('내부 링크 오류 없음');

// ── 4. 외부 URL ────────────────────────────────────────────────────────────
console.log('\n[ 4 ] 외부 URL');
// GitHub Pages 배포 도메인과 GitHub.com 링크는 허용
const ALLOWED_HOSTS = ['github.io', 'github.com'];
let extErrs = 0;
for (const f of allFiles) {
  if (!['.html', '.css', '.js', '.mjs'].includes(extname(f))) continue;
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const text = readFileSync(f, 'utf8');
  for (const [, url] of text.matchAll(/(?:src|href|url)\s*[=(]["']?(https?:\/\/[^\s"')>]+)/g)) {
    if (ALLOWED_HOSTS.some(h => url.includes(h))) continue;
    err(`${rel}: 외부 URL — "${url.slice(0, 80)}"`);
    extErrs++;
  }
}
if (extErrs === 0) ok('외부 URL 없음');

// ── 최종 결과 ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
if (errors > 0) {
  console.error(`\n오류 ${errors}개, 경고 ${warnings}개\n`);
  process.exit(1);
} else {
  if (warnings > 0) console.warn(`\n오류 없음 · 경고 ${warnings}개\n`);
  else console.log('\n모든 검사 통과 ✓\n');
  process.exit(0);
}
