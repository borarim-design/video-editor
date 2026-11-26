import type { FontFamily, SubtitleStyle } from '../types';
import { FONT_CATALOG } from './font-catalog';

/** 로드된 폰트 패밀리 목록(전역) */
export const FONT_REGISTRY: FontFamily[] = [];

export function resolveWeight(familyId: string, weight: string): string {
  const family = FONT_REGISTRY.find((f) => f.id === familyId) ?? FONT_CATALOG.find((f) => f.id === familyId);
  if (!family) return 'regular';
  if (family.weights.includes(weight)) return weight;
  return family.defaultWeight;
}

/** Canvas에서 쓸 CSS font-family 이름. 굵기 파일을 각각 별도 패밀리로 등록해
 *  파일마다 다른 패밀리 이름을 쓰도록 한다(브라우저 합성 볼드 방지). */
export function fontFamilyName(fontId: string, weight: string): string {
  return `VE_${fontId}_${resolveWeight(fontId, weight)}`;
}

export function fontFamilyForStyle(style: SubtitleStyle): string {
  return fontFamilyName(style.font, style.weight);
}

/** 정적으로 번들된 폰트를 @font-face 로 등록한다(서버 호출 없음). */
let loading: Promise<FontFamily[]> | null = null;

export function ensureFontsLoaded(): Promise<FontFamily[]> {
  if (loading) return loading;
  loading = (async () => {
    const fonts = FONT_CATALOG;
    if (FONT_REGISTRY.length === 0) FONT_REGISTRY.push(...fonts);
    const jobs: Promise<unknown>[] = [];
    fonts.forEach((family) => {
      Object.entries(family.files).forEach(([weight, url]) => {
        const face = new FontFace(fontFamilyName(family.id, weight), `url(${url})`, {
          weight: '400',
          style: 'normal',
          display: 'block',
        });
        jobs.push(
          face
            .load()
            .then((loaded) => {
              document.fonts.add(loaded);
            })
            .catch(() => undefined),
        );
      });
    });
    await Promise.all(jobs);
    return fonts;
  })();
  return loading;
}

export async function waitForFont(family: string, sizePx = 64): Promise<void> {
  try {
    await document.fonts.load(`400 ${sizePx}px "${family}"`, '가나다 ABC 123');
  } catch {
    /* 폰트가 없어도 미리보기는 계속 */
  }
}
