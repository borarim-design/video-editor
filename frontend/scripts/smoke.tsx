/**
 * 서버 렌더 스모크 테스트 — 앱이 최소한 크래시 없이 렌더되는지 확인한다.
 * (Canvas·영상은 브라우저에서만 동작하므로 여기서는 초기 화면 구조만 검사)
 */
import { renderToString } from 'react-dom/server';
import App from '../src/App';

const html = renderToString(<App />);

const checks = [
  '릴컷 스튜디오',
  '영상 파일을 끌어다 놓거나',
  '자동 AI 자막',
  '얼굴 추적 모자이크',
  '릴스·숏츠 비율',
];

const missing = checks.filter((c) => !html.includes(c));
if (missing.length) {
  console.error('SSR smoke 실패 — 누락:', missing.join(', '));
  process.exit(1);
}
if (html.length < 2000) {
  console.error('SSR smoke 실패 — 출력이 너무 짧습니다:', html.length);
  process.exit(1);
}
console.log(`SSR smoke OK (${html.length} bytes)`);
