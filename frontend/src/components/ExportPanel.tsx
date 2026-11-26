import type { EditSpec, MaskState, ProjectMeta, RenderResult, SubtitleState } from '../types';
import { outputGeometry } from '../lib/layout';
import { formatBytes, formatTime } from '../lib/format';
import { ASPECTS } from '../lib/presets';
import { Badge, ProgressBar, Section } from './ui';

interface Props {
  project: ProjectMeta;
  trim: { start: number; end: number };
  aspect: EditSpec['aspect'];
  subtitles: SubtitleState;
  masks: MaskState;
  exporting: boolean;
  progress: number;
  message: string;
  result: RenderResult | null;
  jobId: string | null;
  error: string | null;
  onAspect: (a: EditSpec['aspect']) => void;
  onExport: () => void;
}

export default function ExportPanel({
  project,
  trim,
  aspect,
  subtitles,
  masks,
  exporting,
  progress,
  message,
  result,
  jobId,
  error,
  onAspect,
  onExport,
}: Props) {
  const geo = outputGeometry(project.width, project.height, aspect);
  const duration = Math.max(0, trim.end - trim.start);
  const activeTracks = masks.tracks.filter((t) => t.enabled).length;
  const manualCount = masks.manual.length;

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
            ['모자이크', masks.enabled ? `인물 ${activeTracks}명 · 직접 ${manualCount}곳 · ${masks.mode === 'blur' ? '블러' : '모자이크'} ${masks.strength}%` : '없음'],
            ['원본', `${project.width}×${project.height} · ${project.fps.toFixed(2)}fps`],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-studio-800/70 pb-1.5 last:border-0">
              <dt className="text-studio-400">{k}</dt>
              <dd className="text-right font-medium text-studio-100">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="MP4 만들기" right={<Badge>H.264 · AAC</Badge>}>
        <button type="button" className="btn-primary w-full" disabled={exporting} onClick={onExport}>
          {exporting ? '내보내는 중…' : result ? '🎬 다시 내보내기' : '🚀 MP4로 내보내기'}
        </button>
        {exporting ? <ProgressBar value={progress} label={message || '렌더링 중'} /> : null}
        {error ? (
          <p className="rounded-lg border border-neon-rose/40 bg-neon-rose/10 px-2.5 py-2 text-[11px] text-neon-rose">{error}</p>
        ) : null}
        {result ? (
          <div className="space-y-2">
            <video
              key={result.downloadUrl}
              src={result.playUrl}
              controls
              playsInline
              className="w-full rounded-lg border border-studio-700 bg-black"
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-studio-300">
              <Badge tone="live">완료</Badge>
              <span>
                {result.width}×{result.height} · {result.duration.toFixed(2)}초 · {formatBytes(result.sizeBytes)}
              </span>
              <span className="text-studio-500">렌더 {result.elapsedSec.toFixed(1)}초</span>
            </div>
            <a className="btn-ghost w-full" href={result.downloadUrl} download={result.fileName}>
              ⬇️ {result.fileName} 내려받기
            </a>
            {jobId ? <p className="text-center text-[10px] text-studio-500">job {jobId}</p> : null}
          </div>
        ) : null}
        <p className="text-[10px] leading-relaxed text-studio-500">
          렌더링은 서버에서 진행됩니다. 미리보기와 같은 폰트 파일·같은 좌표 계산을 쓰기 때문에 결과물이 미리보기와 일치합니다.
          (필요한 인물만 골라 가릴 수 있고, 자막 스타일도 그대로 적용됩니다.)
        </p>
      </Section>
    </div>
  );
}
