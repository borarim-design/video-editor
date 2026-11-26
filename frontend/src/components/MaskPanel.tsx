import type { ManualMask, MaskState } from '../types';
import { Badge, Section, Segmented, Slider, Toggle } from './ui';

interface Props {
  masks: MaskState;
  duration: number;
  drawMode: boolean;
  onToggleEnabled: (v: boolean) => void;
  onMode: (m: MaskState['mode']) => void;
  onShape: (s: MaskState['shape']) => void;
  onStrength: (v: number) => void;
  onPad: (v: number) => void;
  onStartDraw: () => void;
  onDeleteManual: (id: string) => void;
  onUpdateManual: (id: string, patch: Partial<ManualMask>) => void;
  onSeek: (t: number) => void;
}

export default function MaskPanel({
  masks,
  duration,
  drawMode,
  onToggleEnabled,
  onMode,
  onShape,
  onStrength,
  onPad,
  onStartDraw,
  onDeleteManual,
  onUpdateManual,
  onSeek,
}: Props) {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section
        title="자동 얼굴 추적"
        right={<Badge tone="warn">정적 모드</Badge>}
        description="서버 없이 동작하는 GitHub Pages 모드입니다. 아래에서 가릴 영역을 직접 지정하면 그대로 적용돼요."
      >
        <button
          type="button"
          className="btn-ghost w-full cursor-not-allowed opacity-45"
          disabled
          title="GitHub Pages 모드에서는 수동 자막·수동 모자이크를 지원하며, AI 자동 기능은 추후 서버 연결 시 활성화됩니다"
        >
          🔍 얼굴 자동 감지 (서버 연결 시)
        </button>
        <Toggle
          label="모자이크 사용"
          checked={masks.enabled}
          onChange={onToggleEnabled}
          hint={masks.manual.length ? `${masks.manual.length}곳에 적용 중` : '영역을 추가하면 적용됩니다'}
        />
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
          <Slider label="영역 여백" value={masks.pad} min={0} max={0.6} step={0.01} onChange={onPad} hint="지정한 영역보다 조금 넓게 가리기" />
        </div>
      </Section>

      <Section
        title={`직접 지정 (${masks.manual.length})`}
        right={
          <button type="button" className={`chip ${drawMode ? 'chip-active' : ''}`} onClick={onStartDraw}>
            {drawMode ? '미리보기에서 드래그…' : '+ 영역 추가'}
          </button>
        }
        description="미리보기에서 드래그한 사각형이 지정 구간 동안 가려집니다. 효과·모양·강도는 위 설정을 따릅니다."
      >
        {masks.manual.length === 0 ? (
          <p className="rounded-lg border border-dashed border-studio-700 px-3 py-4 text-center text-[11px] text-studio-400">
            지정된 영역이 없습니다. 위 <b className="text-studio-200">+ 영역 추가</b>를 누르고 미리보기에서 드래그해 보세요.
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
