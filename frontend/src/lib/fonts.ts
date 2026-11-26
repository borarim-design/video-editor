import type { FontFamily, SubtitleStyle } from '../types';
import { listFonts } from './api';

/** 로드된 폰트 패밀리 목록(전역) */
export const FONT_REGISTRY: FontFamily[] = [];

export function resolveWeight(familyId: string, weight: string): string {
  const family = FONT_REGISTRY.find((f) => f.id === familyId);
  if (!family) return 'regular';
  if (family.weights.includes(weight)) return weight;
  return family.defaultWeight;
}

/** Canvas에서 쓸 CSS font-family 이름. 굵기 파일을 각각 별도 패밀리로 등록해
 *  백엔드 Pillow가 고르는 파일과 정확히 같아지도록 한다. */
export function fontFamilyName(fontId: string, weight: string): string {
  return `VE_${fontId}_${resolveWeight(fontId, weight)}`;
}

export function fontFamilyForStyle(style: SubtitleStyle): string {
  return fontFamilyName(style.font, style.weight);
}

let loading: Promise<FontFamily[]> | null = null;

/** /api/fonts 로 목록을 받고, 같은 파일을 @font-face 로 등록한다. */
export function ensureFontsLoaded(): Promise<FontFamily[]> {
  if (loading) return loading;
  loading = (async () => {
    const fonts = await listFonts();
    FONT_REGISTRY.splice(0, FONT_REGISTRY.length, ...fonts);
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
