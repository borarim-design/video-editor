import type { ProjectMeta } from '../types';
import { formatTime } from '../lib/format';

interface Props {
  project: ProjectMeta | null;
  exporting: boolean;
  onReset: () => void;
  onExport: () => void;
}

export default function TopBar({ project, exporting, onReset, onExport }: Props) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-studio-700/70 bg-studio-900/80 px-3 py-2 backdrop-blur sm:gap-3 sm:px-5 sm:py-2.5">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neon to-neon-cyan text-sm shadow-glow">
          ✂️
        </div>
        <div className="leading-tight">
          <p className="whitespace-nowrap text-[13px] font-extrabold tracking-tight text-white sm:text-sm">릴컷 스튜디오</p>
          <p className="hidden text-[10px] text-studio-400 sm:block">수동 자막 · 모자이크 · 릴스 비율</p>
        </div>
      </div>

      <span
        className="hidden items-center gap-1 rounded-full border border-studio-600 bg-studio-800/70 px-2 py-0.5 text-[10px] font-semibold text-studio-300 sm:inline-flex"
        title="GitHub Pages 모드: 서버 없이 이 브라우저에서만 동작합니다. AI 자동 자막·자동 얼굴 추적은 추후 서버 연결 시 활성화됩니다."
      >
        정적 모드 · 서버 없음
      </span>

      {project ? (
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-2 sm:ml-2">
          <span className="min-w-0 max-w-full truncate rounded-md bg-studio-800/80 px-2 py-1 text-[10px] text-studio-300 sm:max-w-xs sm:text-[11px]">
            {project.filename}
          </span>
          <span className="hidden rounded-md bg-studio-800/60 px-2 py-1 text-[10px] tabular-nums text-studio-400 sm:inline">
            {project.width}×{project.height} · {formatTime(project.duration)}
          </span>
        </div>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {project ? (
          <>
            <button type="button" className="btn-ghost whitespace-nowrap !px-2.5 !py-1.5 text-[11px] sm:!px-3 sm:text-xs" onClick={onReset}>
              새 영상
            </button>
            <button type="button" className="btn-primary whitespace-nowrap !px-2.5 !py-1.5 text-[11px] sm:!px-3.5 sm:text-xs" onClick={onExport} disabled={exporting}>
              {exporting ? '내보내는 중…' : '내보내기'}
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
