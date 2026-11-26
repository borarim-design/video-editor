import type { ManualMask, MaskState, PersonTrack } from '../types';
import { Badge, ProgressBar, Section, Segmented, Slider, Toggle } from './ui';
import { formatTime } from '../lib/format';

interface Props {
  masks: MaskState;
  tracks: PersonTrack[];
  duration: number;
  busy: boolean;
  progress: number;
  message: string;
  drawMode: boolean;
  onToggleEnabled: (v: boolean) => void;
  onMode: (m: MaskState['mode']) => void;
  onShape: (s: MaskState['shape']) => void;
  onStrength: (v: number) => void;
  onPad: (v: number) => void;
  onToggleTrack: (id: number, enabled: boolean) => void;
  onDetect: () => void;
  onStartDraw: () => void;
  onDeleteManual: (id: string) => void;
  onUpdateManual: (id: string, patch: Partial<ManualMask>) => void;
  onSeek: (t: number) => void;
}

export default function MaskPanel({
  masks,
  tracks,
  duration,
  busy,
  progress,
  message,
  drawMode,
  onToggleEnabled,
  onMode,
  onShape,
  onStrength,
  onPad,
  onToggleTrack,
  onDetect,
  onStartDraw,
  onDeleteManual,
  onUpdateManual,
  onSeek,
}: Props) {
  const enabledCount = masks.tracks.filter((t) => t.enabled).length;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section
        title="자동 얼굴 추적"
        right={<Badge tone={tracks.length ? 'live' : 'default'}>{tracks.length ? `${tracks.length}명 감지` : '미감지'}</Badge>}
        description="영상 전체를 훑어 얼굴을 찾고 인물별로 묶습니다. 외부 모델 다운로드 없이 Haar + 피부색 보완으로 동작해요."
      >
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={onDetect}>
          {busy ? '분석 중…' : tracks.length ? '🔄 다시 분석' : '🔍 얼굴 자동 감지'}
        </button>
        {busy ? <ProgressBar value={progress} label={message || '프레임 분석 중'} /> : null}
        <Toggle
          label="모자이크 사용"
          checked={masks.enabled}
          onChange={onToggleEnabled}
          hint={enabledCount ? `${enabledCount}명에게 적용 중` : '인물을 켜면 적용됩니다'}
        />
      </Section>

      <Section
        title={`인물 (${tracks.length})`}
        right={
          tracks.length > 1 ? (
            <button
              type="button"
              className="chip"
              onClick={() => {
                const allOn = masks.tracks.length === tracks.length && masks.tracks.every((t) => t.enabled);
                tracks.forEach((t) => onToggleTrack(t.id, !allOn));
              }}
            >
              전체 {masks.tracks.length === tracks.length && masks.tracks.every((t) => t.enabled) ? '해제' : '선택'}
            </button>
          ) : undefined
        }
      >
        {tracks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-studio-700 px-3 py-6 text-center text-[11px] text-studio-400">
            아직 감지된 인물이 없습니다.
            <br />
            위 버튼으로 분석하거나, 아래에서 직접 영역을 지정하세요.
          </p>
        ) : (
          <div className="space-y-1.5">
            {tracks.map((track) => {
              const toggle = masks.tracks.find((t) => t.id === track.id);
              const on = toggle?.enabled ?? false;
              return (
                <div
                  key={track.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                    on ? 'border-neon/60 bg-neon/10' : 'border-studio-700 bg-studio-800/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSeek(track.start)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-studio-700 text-[11px] font-bold text-studio-100"
                  >
                    {track.id}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-studio-100">{track.label}</p>
                    <p className="truncate text-[10px] text-studio-400">
                      {formatTime(track.start, false)}–{formatTime(track.end, false)} · 추적률 {Math.round(track.coverage * 100)}%
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleTrack(track.id, !on)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-neon' : 'bg-studio-600'}`}
                    aria-label={`${track.label} 모자이크 ${on ? '끄기' : '켜기'}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="효과 설정">
        <div className="space-y-2">
          <div>
            <span className="label">효과 종류</span>
            <div className="mt-1">
              <Segmented
                value={masks.mode}
                options={[
                  { value: 'blur', label: '블러 (흐리게)' },
                  { value: 'pixelate', label: '모자이크 (픽셀)' },
                ]}
                onChange={onMode}
              />
            </div>
          </div>
          <div>
            <span className="label">마스크 모양</span>
            <div className="mt-1">
              <Segmented
                value={masks.shape}
                options={[
                  { value: 'rect', label: '사각형' },
                  { value: 'ellipse', label: '타원' },
                  { value: 'circle', label: '원형' },
                ]}
                onChange={onShape}
              />
            </div>
          </div>
          <Slider
            label={masks.mode === 'blur' ? '블러 강도' : '모자이크 강도'}
            value={masks.strength}
            min={1}
            max={100}
            step={1}
            suffix="%"
            onChange={onStrength}
            hint="1%는 살짝, 100%는 완전히 가립니다 (미리보기에 즉시 반영)"
          />
          <Slider label="얼굴 여백" value={masks.pad} min={0} max={0.6} step={0.01} onChange={onPad} hint="얼굴 박스보다 조금 넓게 가리기" />
        </div>
      </Section>

      <Section
        title={`직접 지정 (${masks.manual.length})`}
        right={
          <button type="button" className={`chip ${drawMode ? 'chip-active' : ''}`} onClick={onStartDraw}>
            {drawMode ? '미리보기에서 드래그…' : '+ 영역 추가'}
          </button>
        }
        description="미리보기에서 드래그한 사각형이 지정 구간 동안 가려집니다."
      >
        {masks.manual.length === 0 ? (
          <p className="rounded-lg border border-dashed border-studio-700 px-3 py-4 text-center text-[11px] text-studio-400">
            지정된 영역이 없습니다.
          </p>
        ) : (
          <div className="space-y-1.5">
            {masks.manual.map((m, idx) => (
              <div key={m.id} className="rounded-lg border border-studio-700 bg-studio-800/40 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-studio-300">
                  <span className="font-semibold text-studio-100">영역 {idx + 1}</span>
                  <span className="text-studio-500">
                    {Math.round(m.w * 100)}×{Math.round(m.h * 100)}%
                  </span>
                  <button
                    type="button"
                    className="ml-auto rounded px-1.5 text-xs text-studio-400 hover:bg-neon-rose/20 hover:text-neon-rose"
                    onClick={() => onDeleteManual(m.id)}
                    aria-label="영역 삭제"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-studio-400">
                  <span>구간</span>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={duration}
                    value={Number(m.start.toFixed(1))}
                    onChange={(e) => onUpdateManual(m.id, { start: Math.max(0, Number(e.target.value)) })}
                    className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={duration}
                    value={Number(m.end.toFixed(1))}
                    onChange={(e) => onUpdateManual(m.id, { end: Math.min(duration, Number(e.target.value)) })}
                    className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
                  />
                  <span>초</span>
                  <button type="button" className="ml-auto chip !px-2 !py-0.5" onClick={() => onSeek(m.start)}>
                    이동
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
