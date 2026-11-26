/**
 * 폰트 카탈로그 (정적 빌드용).
 *
 * 서버 없이 GitHub Pages에서 단독 실행되도록, backend/fonts/*.ttf 를
 * frontend/public/fonts/ 로 복사해 두고 빌드 결과에 그대로 포함시킨다.
 * 경로는 Vite base(`import.meta.env.BASE_URL`, 기본 "/video-editor/")를 따른다.
 *
 * 파일 목록·굵기·설명은 backend/app/fonts.py 의 FAMILIES 와 같게 유지한다.
 * (백엔드를 다시 붙일 때도 같은 폰트 파일을 쓰므로 결과물이 동일하다.)
 */
import type { FontFamily } from '../types';

const BASE = import.meta.env.BASE_URL || '/';

/** `${BASE}fonts/<파일명>` 형태의 정적 URL */
export function staticFontUrl(file: string): string {
  return `${BASE.replace(/\/+$/, '')}/fonts/${file}`;
}

interface FontDef {
  id: string;
  name: string;
  category: string;
  description: string;
  sample: string;
  defaultWeight: string;
  files: Record<string, string>;
}

const DEFS: FontDef[] = [
  {
    id: 'pretendard',
    name: '프리텐다드',
    category: '고딕',
    description: '요즘 가장 많이 쓰는 기본 고딕. 깔끔한 정보 전달용',
    sample: '오늘의 브이로그',
    defaultWeight: 'bold',
    files: {
      regular: 'pretendard-regular.ttf',
      bold: 'pretendard-bold.ttf',
      extrabold: 'pretendard-extrabold.ttf',
    },
  },
  {
    id: 'gmarket',
    name: 'G마켓 산스',
    category: '고딕',
    description: '광고·홍보에 잘 붙는 단단한 고딕',
    sample: '지금 바로 확인!',
    defaultWeight: 'bold',
    files: { regular: 'gmarket-medium.ttf', bold: 'gmarket-bold.ttf' },
  },
  {
    id: 'blackhan',
    name: '검은고딕',
    category: '임팩트',
    description: '굵고 강한 제목용. 훅 문구에 최적',
    sample: '충격 반전',
    defaultWeight: 'regular',
    files: { regular: 'blackhan-regular.ttf' },
  },
  {
    id: 'notosans',
    name: 'Noto Sans KR',
    category: '고딕',
    description: '어디서나 무난한 표준 고딕',
    sample: '자막 예시입니다',
    defaultWeight: 'regular',
    files: { regular: 'notosans-regular.ttf', bold: 'notosans-bold.ttf' },
  },
  {
    id: 'nanummyeongjo',
    name: '나눔명조',
    category: '명조',
    description: '차분한 아날로그 명조. 감성 브이로그에',
    sample: '그날의 기록',
    defaultWeight: 'regular',
    files: { regular: 'nanummyeongjo-regular.ttf', bold: 'nanummyeongjo-bold.ttf' },
  },
  {
    id: 'maruburi',
    name: '마루부리',
    category: '명조',
    description: '부드러운 획의 현대적 명조. 지글지글 자막과 찰떡',
    sample: '삐뚤빼뚤 명조',
    defaultWeight: 'regular',
    files: { regular: 'maruburi-regular.ttf' },
  },
  {
    id: 'nanumpen',
    name: '나눔손글씨 펜',
    category: '손글씨',
    description: '가볍게 적은 듯한 펜글씨',
    sample: '손글씨 자막',
    defaultWeight: 'regular',
    files: { regular: 'nanumpen-regular.ttf' },
  },
  {
    id: 'gaegu',
    name: '개구',
    category: '손글씨',
    description: '삐뚤빼뚤 귀여운 손글씨',
    sample: '이거 봐봐!',
    defaultWeight: 'regular',
    files: { regular: 'gaegu-regular.ttf', bold: 'gaegu-bold.ttf' },
  },
  {
    id: 'cafe24',
    name: '카페24 써라운드',
    category: '둥근 제목',
    description: '통통하고 둥근 제목용. 릴스 후킹 타이틀에 인기',
    sample: '이거 진짜 실화?',
    defaultWeight: 'regular',
    files: { regular: 'cafe24surround-regular.ttf' },
  },
  {
    id: 'paperlogy',
    name: '페이퍼로지',
    category: '임팩트',
    description: '각지고 굵은 제목체. 정보 전달형 문구에 강함',
    sample: '월세 30만원',
    defaultWeight: 'regular',
    files: { regular: 'paperlogy-extra.ttf' },
  },
  {
    id: 'dohyeon',
    name: '배민 도현체',
    category: '임팩트',
    description: '배달의민족 도현체. 굵고 단단한 제목',
    sample: '학예회 때',
    defaultWeight: 'regular',
    files: { regular: 'dohyeon-regular.ttf' },
  },
  {
    id: 'bagel',
    name: '베이글팻원',
    category: '둥근 제목',
    description: '아주 통통한 둥근 글자. 귀여운 훅 문구에',
    sample: '완전 개이득',
    defaultWeight: 'regular',
    files: { regular: 'bagel-regular.ttf' },
  },
  {
    id: 'jua',
    name: '주아',
    category: '둥근모꼴',
    description: '둥글둥글 통통 튀는 느낌',
    sample: '두근두근',
    defaultWeight: 'regular',
    files: { regular: 'jua-regular.ttf' },
  },
  {
    id: 'galmuri',
    name: '갈무리 11',
    category: '레트로',
    description: '옛날 게임 감성의 픽셀 레트로',
    sample: '레트로 감성',
    defaultWeight: 'regular',
    files: { regular: 'galmuri11-regular.ttf' },
  },
];

const weightOrder = (w: string) => (w === 'regular' ? 0 : 1);

/** 정적 번들에 포함된 폰트 패밀리 목록 */
export const FONT_CATALOG: FontFamily[] = DEFS.map((def) => ({
  id: def.id,
  name: def.name,
  category: def.category,
  description: def.description,
  sample: def.sample,
  defaultWeight: def.defaultWeight,
  weights: Object.keys(def.files).sort((a, b) => weightOrder(a) - weightOrder(b)),
  files: Object.fromEntries(
    Object.entries(def.files).map(([weight, file]) => [weight, staticFontUrl(file)]),
  ),
}));
