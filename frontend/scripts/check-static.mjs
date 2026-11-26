/**
 * 정적 빌드 산출물 검사 — GitHub Pages 에 그대로 올릴 수 있는지 확인한다.
 *
 *   1) dist/index.html 의 자산 경로가 base(`/video-editor/`) 로 시작하는지
 *   2) 폰트 21개 파일(14종)이 dist/fonts 에 복사됐는지
 *   3) JS 번들이 같은 base 로 폰트를 찾는지 (서버 API 호출이 없는지)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.VITE_BASE_PATH || '/video-editor/';
const dist = join(root, 'dist');

const fail = (msg) => {
  console.error('✗', msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log('✓', msg);

if (!existsSync(dist)) {
  fail('dist 가 없습니다. 먼저 `npm run build` 를 실행하세요.');
  process.exit(1);
}

// 1) index.html
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const badRefs = assetRefs.filter((u) => u.startsWith('/') && !u.startsWith(base));
if (badRefs.length) fail(`base(${base}) 가 아닌 절대 경로: ${badRefs.join(', ')}`);
else ok(`index.html 자산 ${assetRefs.length}개 모두 base 경로 사용`);

if (!new RegExp(`(?:src|href)="${base}assets/`).test(html)) fail('번들 자산 경로가 base 아래에 없습니다');
if (!html.includes(`${base}favicon.svg`)) fail('favicon 경로가 base 아래에 없습니다');

// 2) 폰트
const fontDirs = [join(dist, 'fonts')];
const fonts = existsSync(fontDirs[0]) ? readdirSync(fontDirs[0]) : [];
const ttf = fonts.filter((f) => f.toLowerCase().endsWith('.ttf'));
if (ttf.length !== 20) fail(`dist/fonts 의 ttf 가 ${ttf.length}개입니다(기대 20개)`);
else ok(`dist/fonts ttf 20개 + LICENSE.md (총 ${fonts.length}개 파일)`);

const familyManifest = [
  'pretendard-regular.ttf', 'pretendard-bold.ttf', 'pretendard-extrabold.ttf',
  'gmarket-medium.ttf', 'gmarket-bold.ttf',
  'blackhan-regular.ttf', 'notosans-regular.ttf', 'notosans-bold.ttf',
  'nanummyeongjo-regular.ttf', 'nanummyeongjo-bold.ttf',
  'maruburi-regular.ttf', 'nanumpen-regular.ttf',
  'gaegu-regular.ttf', 'gaegu-bold.ttf',
  'cafe24surround-regular.ttf', 'paperlogy-extra.ttf', 'dohyeon-regular.ttf',
  'bagel-regular.ttf', 'jua-regular.ttf', 'galmuri11-regular.ttf',
];
const missingFonts = familyManifest.filter((f) => !fonts.includes(f));
if (missingFonts.length) fail(`누락된 폰트 파일: ${missingFonts.join(', ')}`);
else ok('카탈로그 폰트 14종(20파일) 모두 존재');

// 3) JS 번들
const assetDir = join(dist, 'assets');
const jsFiles = existsSync(assetDir) ? readdirSync(assetDir).filter((f) => f.endsWith('.js')) : [];
if (!jsFiles.length) fail('dist/assets 에 JS 번들이 없습니다');
const js = jsFiles.map((f) => readFileSync(join(assetDir, f), 'utf8')).join('\n');
if (!js.includes(base)) fail(`번들에 base(${base}) 문자열이 없습니다`);
else ok(`번들에 base(${base}) 포함`);
if (!js.includes('/fonts/')) fail('번들에 /fonts/ 경로가 없습니다');
else ok('번들이 정적 /fonts/ 경로를 사용');

const apiHits = [...js.matchAll(/[`'"]\/api\//g)].length;
if (apiHits > 0) fail(`번들에 서버 API 경로가 ${apiHits}곳 남아 있습니다`);
else ok('번들에 /api/ 호출 없음');

console.log(process.exitCode ? '\n정적 빌드 검사 실패' : '\n정적 빌드 검사 통과');
