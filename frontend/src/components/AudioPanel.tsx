import type { AudioLayer } from '../types';
import { shortLength } from '../lib/audio';
import { Badge, Section, Slider, Toggle } from './ui';

/** 오디오 레이어(BGM·효과음) 패널 — 레이어별 볼륨·시작·음소거, 원본 영상 볼륨. */
interface Props {
  layers: AudioLayer[];
  videoVolume: number;
  videoMuted: boolean;
  clipLength: number;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<AudioLayer>) => void;
  onRemove: (id: string) => void;
  onVideoVolume: (v: number) => void;
  onVideoMuted: (v: boolean) => void;
  onSeek: (t: number) => void;
}

export default function AudioPanel({
  layers,
  videoVolume,
  videoMuted,
  clipLength,
  onAdd,
  onPatch,
  onRemove,
  onVideoVolume,
  onVideoMuted,
  onSeek,
}: Props) {
  const maxStart = Math.max(0, Math.round((clipLength - 0.2) * 10) / 10);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section
        title="오디오 레이어"
        right={<Badge tone="live">{layers.length} / 3</Badge>}
        description="배경음악·효과음을 영상 위에 얹습니다. 미리보기와 내보내기(MP4)에 함께 믹싱돼요."
      >
        <button
          type="button"
          onClick={onAdd}
          className="btn-primary min-h-[44px] w-full text-sm"
          disabled={layers.length >= 3}
        >
          🎵 오디오 추가 (MP3 · M4A · WAV)
        </button>
        {layers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-studio-700 px-3 py-4 text-center text-[11px] text-studio-400">
            아직 오디오 레이어가 없습니다. 기기에서 음원을 골라 올려 보세요.
          </p>
        ) : null}

        <div className="space-y-2">
          {layers.map((layer) => {
            const end = layer.start + layer.length;
            return (
              <div key={layer.id} className="rounded-xl border border-studio-700 bg-studio-800/50 p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{layer.muted ? '🔇' : '🎵'}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-studio-100">{layer.name}</span>
                  <Badge tone={layer.muted ? 'warn' : 'default'}>
                    {shortLength(layer.start)}–{shortLength(end)}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => onRemove(layer.id)}
                    className="rounded px-1.5 text-xs text-studio-400 hover:bg-neon-rose/20 hover:text-neon-rose"
                    aria-label="오디오 삭제"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  <Slider
                    label="볼륨"
                    value={Math.round(layer.volume * 100)}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    onChange={(v) => onPatch(layer.id, { volume: v / 100, muted: false })}
                  />
                  <Slider
                    label="시작 시점"
                    value={Math.min(layer.start, maxStart)}
                    min={0}
                    max={Math.max(0.1, maxStart)}
                    step={0.1}
                    suffix="초"
                    onChange={(v) => onPatch(layer.id, { start: Math.round(v * 10) / 10 })}
                    hint="편집본 기준 — 이 시점부터 소리가 깔립니다."
                  />
                  <Toggle
                    label="음소거"
                    checked={layer.muted}
                    onChange={(v) => onPatch(layer.id, { muted: v })}
                    hint="블록은 남아 있고 소리만 꺼져요."
                  />
                  <div className="flex gap-1.5">
                    <button type="button" className="chip flex-1 justify-center" onClick={() => onSeek(layer.start)}>
                      이 시점으로 이동
                    </button>
                    <button
                      type="button"
                      className="chip flex-1 justify-center"
                      onClick={() => onPatch(layer.id, { offset: 0, start: 0, length: Math.min(layer.duration, clipLength) })}
                    >
                      처음부터
                    </button>
                  </div>
                  <p className="text-[10px] text-studio-400">
                    원본 {shortLength(layer.duration)} 중 {shortLength(layer.length)} 사용 · 파일 안 {shortLength(layer.offset)} 지점부터
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="원본 영상 소리" description="영상에 들어 있는 소리 크기입니다(0%면 무음).">
        <Slider
          label="영상 볼륨"
          value={videoMuted ? 0 : Math.round(videoVolume * 100)}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onChange={(v) => {
            onVideoMuted(false);
            onVideoVolume(v / 100);
          }}
        />
        <Toggle label="영상 소리 끄기" checked={videoMuted} onChange={onVideoMuted} />
      </Section>
    </div>
  );
}
