import type {
  EditSpec, ExportResult, HookTitle, ImageSticker, MaskState, OverlayState, ProjectMeta, SubtitleState,
} from '../types';
import { outputGeometry } from '../lib/layout';
import { formatBytes, formatTime } from '../lib/format';
import { ASPECTS } from '../lib/presets';
import { exportFormatLabel } from '../lib/exporter';
import { Badge, ProgressBar, Section } from './ui';

interface Props {
  project: ProjectMeta;
  trim: { start: number; end: number };
  aspect: EditSpec['aspect'];
  subtitles: SubtitleState;
  hook: HookTitle;
  masks: MaskState;
  stickers: ImageSticker[];
  overlays: OverlayState;
  audioCount: number;
  videoVolume: number;
  exporting: boolean;
  progress: number;
  message: string;
  result: ExportResult | null;
  error: string | null;
  onAspect: (a: EditSpec['aspect']) => void;
  onExport: () => void;
  onCancel: () => void;
}

export default function ExportPanel({
  project,
  trim,
  aspect,
  subtitles,
  hook,
  masks,
  stickers,
  overlays,
  audioCount,
  videoVolume,
  exporting,
  progress,
  message,
  result,
  error,
  onAspect,
  onExport,
  onCancel,
}: Props) {
  const geo = outputGeometry(project.width, project.height, aspect);
  const duration = Math.max(0, trim.end - trim.start);
  const manualCount = masks.manual.length;
  const format = exportFormatLabel();

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section title="내보내기 설정">
        <div>
          <span className="label">화면 비율</span>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAspect(a.id)}
                className={`rounded-lg border px-2 py-1.5 text-left transition ${
                  aspect === a.id ? 'border-neon/80 bg-neon/15' : 'border-studio-700 bg-studio-800/40 hover:border-studio-500'
                }`}
              >
                <span className="block text-xs font-bold text-studio-100">{a.name}</span>
                <span className="block text-[10px] text-studio-400">{a.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="최종 확인">
        <dl className="space-y-1.5 text-xs">
          {[
            ['해상도', `${geo.outW} × ${geo.outH}`],
            ['길이', `${duration.toFixed(2)}초 (${formatTime(trim.start)}–${formatTime(trim.end)})`],
            ['자막', subtitles.enabled ? `${subtitles.cues.length}개 · ${subtitles.style.preset}` : '없음'],
            ['후킹 타이틀', hook.enabled
              ? `${hook.preset} · ${hook.title.split('\n').filter(Boolean).length}줄${hook.speedLines.enabled ? ' · 집중선' : ''}`
              : '없음'],
            ['사진 스티커', stickers.filter((s) => s.enabled).length
              ? `${stickers.filter((s) => s.enabled).length}장 · ${[...new Set(stickers.filter((s) => s.enabled).map((s) => (s.frame === 'dashed' ? '점선' : s.frame === 'polaroid' ? '폴라로이드' : s.frame === 'rounded' ? '둥근 모서리' : '테두리 없음')))].join(', ')}`
              : '없음'],
            ['오버레이', [
              overlays.viewfinder.enabled ? '뷰파인더' : null,
              overlays.dateCard.enabled ? '날짜 카드' : null,
              overlays.placeCard.enabled ? '장소 카드' : null,
            ].filter(Boolean).join(' · ') || '없음'],
            ['모자이크', masks.enabled ? `직접 ${manualCount}곳 · ${masks.mode === 'blur' ? '블러' : '모자이크'} ${masks.strength}% · ${masks.shape === 'rect' ? '사각형' : masks.shape === 'ellipse' ? '타원' : '원형'}` : '없음'],
            ['오디오', `${audioCount ? `레이어 ${audioCount}개` : '추가 없음'} · 원본 ${Math.round(videoVolume * 100)}%`],
            ['원본', `${project.width}×${project.height} · ${project.fps.toFixed(2)}fps`],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-studio-800/70 pb-1.5 last:border-0">
              <dt className="text-studio-400">{k}</dt>
              <dd className="text-right font-medium text-studio-100">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="영상 만들기" right={<Badge>{format === 'MP4' ? 'MP4 · H.264/AAC' : 'WebM · VP9/Opus'}</Badge>}>
        <button type="button" className="btn-primary w-full" disabled={exporting} onClick={onExport}>
          {exporting ? '만드는 중…' : result ? `🎬 다시 만들기 (${format})` : `🚀 ${format}로 내보내기`}
        </button>
        {exporting ? (
          <div className="space-y-1.5">
            <ProgressBar value={progress} label={message || '영상 만드는 중'} />
            <button type="button" className="btn-ghost w-full !py-1.5 text-[11px]" onClick={onCancel}>
              ✕ 취소
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-neon-rose/40 bg-neon-rose/10 px-2.5 py-2 text-[11px] text-neon-rose">{error}</p>
        ) : null}
        {result ? (
          <div className="space-y-2">
            <video
              key={result.url}
              src={result.url}
              controls
              playsInline
              className="w-full rounded-lg border border-studio-700 bg-black"
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-studio-300">
              <Badge tone="live">완료</Badge>
              <span>
                {result.width}×{result.height} · {result.duration.toFixed(2)}초 · {formatBytes(result.sizeBytes)}
              </span>
              <span className="text-studio-500">만드는 데 {result.elapsedSec.toFixed(1)}초</span>
            </div>
            <a className="btn-ghost w-full" href={result.url} download={result.fileName}>
              ⬇️ {result.fileName} 내려받기
            </a>
          </div>
        ) : null}
        <p className="text-[10px] leading-relaxed text-studio-500">
          서버 없이 <b className="text-studio-300">이 브라우저에서</b> 미리보기와 같은 폰트·같은 좌표로 한 프레임씩 합성합니다.
          실제 재생 속도로 만들어지기 때문에 영상 길이만큼 시간이 걸리고, 그동안 이 탭을 다른 곳으로 전환하면 느려질 수 있어요.
          {format === 'WebM' ? ' 이 브라우저는 MP4 녹화를 지원하지 않아 WebM으로 저장됩니다(유튜브·인스타 업로드 가능).' : ''}
        </p>
      </Section>
    </div>
  );
}
