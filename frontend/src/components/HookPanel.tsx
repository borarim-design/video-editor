import type { FontFamily, HookPreset, HookTitle, SpeedLines } from '../types';
import { HOOK_PRESETS } from '../lib/presets';
import { fontFamilyName } from '../lib/fonts';
import { Section, Segmented, Slider, Toggle, Badge } from './ui';

interface Props {
  hook: HookTitle;
  fonts: FontFamily[];
  duration: number;
  onPatch: (patch: Partial<HookTitle>) => void;
  onPreset: (preset: HookPreset) => void;
  onSpeedLines: (patch: Partial<SpeedLines>) => void;
  onSeek: (t: number) => void;
}

export default function HookPanel({
  hook,
  fonts,
  duration,
  onPatch,
  onPreset,
  onSpeedLines,
  onSeek,
}: Props) {
  const family = fonts.find((f) => f.id === hook.font) || fonts[0];
  const weights = family?.weights ?? ['regular'];
  const rangeOn = hook.start != null || hook.end != null;
  const titleLines = hook.title.split('\n').length;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section
        title="상단 후킹 타이틀"
        right={<Badge tone={hook.enabled ? 'live' : 'default'}>{hook.enabled ? 'ON' : 'OFF'}</Badge>}
        description="영상 위쪽에 고정으로 띄우는 오프닝 헤드라인. 본문 자막과 별개로 움직입니다."
      >
        <Toggle
          label="후킹 타이틀 표시"
          checked={hook.enabled}
          onChange={(v) => onPatch({ enabled: v })}
          hint="끄면 미리보기·내보내기에서 모두 사라집니다."
        />
        <div className="grid grid-cols-2 gap-2">
          {HOOK_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p.id)}
              className={`rounded-xl border p-2.5 text-left transition ${
                hook.preset === p.id
                  ? 'border-neon/80 bg-neon/15 shadow-glow'
                  : 'border-studio-700 bg-studio-800/50 hover:border-studio-500'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{p.emoji}</span>
                <span className="text-xs font-bold text-studio-100">{p.name}</span>
              </div>
              <p className="mt-0.5 text-[10px] leading-snug text-studio-400">{p.tagline}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="문구">
        <label className="block">
          <span className="label">서브 문구 (알약 배지)</span>
          <input
            className="field mt-1"
            placeholder="예: 결혼준비 브이로그"
            value={hook.subtext}
            maxLength={26}
            onChange={(e) => onPatch({ subtext: e.target.value })}
          />
        </label>
        <label className="mt-2 block">
          <span className="label">메인 타이틀 (Enter로 최대 2줄)</span>
          <textarea
            className="field mt-1 resize-none"
            rows={2}
            placeholder={'예: 2027년에 결혼하면\n개이득인 이유'}
            value={hook.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
        </label>
        <p className="text-[10px] text-studio-500">
          {titleLines > 2 ? '2줄을 넘으면 자동으로 줄바꿈됩니다.' : `${titleLines}줄 · ${hook.title.length}자`}
        </p>
      </Section>

      <Section title="표시 시간">
        <Segmented
          size="sm"
          value={rangeOn ? 'range' : 'all'}
          options={[
            { value: 'all', label: '전체 영상' },
            { value: 'range', label: '구간 지정' },
          ]}
          onChange={(v) => {
            if (v === 'all') onPatch({ start: null, end: null });
            else onPatch({ start: 0, end: Math.max(1, Math.round(duration * 10) / 10) });
          }}
        />
        {rangeOn ? (
          <div className="flex items-center gap-1.5 text-[11px] text-studio-400">
            <input
              type="number"
              step={0.1}
              min={0}
              max={duration}
              value={hook.start ?? 0}
              onChange={(e) => onPatch({ start: Math.max(0, Number(e.target.value)) })}
              className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
            />
            <span>–</span>
            <input
              type="number"
              step={0.1}
              min={0}
              max={duration}
              value={hook.end ?? duration}
              onChange={(e) => onPatch({ end: Math.min(duration, Number(e.target.value)) })}
              className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
            />
            <span>초</span>
            <button type="button" className="chip ml-auto !px-2 !py-0.5" onClick={() => onSeek(hook.start ?? 0)}>
              이동
            </button>
          </div>
        ) : null}
      </Section>

      <Section title="폰트">
        <div className="grid grid-cols-2 gap-1.5">
          {fonts.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onPatch({ font: f.id, weight: f.weights.includes(hook.weight) ? hook.weight : f.defaultWeight })}
              className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                hook.font === f.id ? 'border-neon/80 bg-neon/15' : 'border-studio-700 bg-studio-800/40 hover:border-studio-500'
              }`}
            >
              <span
                className="block truncate text-[12px] text-studio-100"
                style={{ fontFamily: fontFamilyName(f.id, f.defaultWeight) }}
              >
                {f.name}
              </span>
            </button>
          ))}
        </div>
        {weights.length > 1 ? (
          <div className="pt-1">
            <Segmented
              size="sm"
              value={hook.weight}
              options={weights.map((w) => ({
                value: w,
                label: w === 'regular' ? '보통' : w === 'bold' ? '굵게' : '아주 굵게',
              }))}
              onChange={(w) => onPatch({ weight: w })}
            />
          </div>
        ) : null}
      </Section>

      <Section title="크기 · 위치 · 기울기">
        <Slider label="타이틀 크기" value={hook.fontSize} min={4} max={16} step={0.1} suffix="%" onChange={(v) => onPatch({ fontSize: v })} />
        <Slider label="서브 문구 크기" value={hook.subSize} min={1.5} max={7} step={0.1} suffix="%" onChange={(v) => onPatch({ subSize: v })} />
        <Slider label="세로 위치" value={hook.yPercent} min={6} max={70} step={0.5} suffix="%" onChange={(v) => onPatch({ yPercent: v })} />
        <Slider label="기울임" value={hook.skew} min={-20} max={20} step={0.5} suffix="°" onChange={(v) => onPatch({ skew: v })} />
        <Slider label="줄 간격" value={hook.lineHeight} min={1} max={1.6} step={0.02} onChange={(v) => onPatch({ lineHeight: v })} />
      </Section>

      <Section title="색">
        <div className="grid grid-cols-3 gap-2">
          {([
            ['color', '글자'],
            ['accent', '포인트'],
            ['strokeColor', '외곽선'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
              <input
                type="color"
                value={hook[key]}
                onChange={(e) => onPatch({ [key]: e.target.value } as Partial<HookTitle>)}
                className="h-6 w-6 rounded-md"
                aria-label={label}
              />
              <span className="text-[11px] text-studio-300">{label}</span>
            </label>
          ))}
        </div>
        <div>
          <span className="label">포인트 색 적용 줄</span>
          <div className="mt-1">
            <Segmented
              size="sm"
              value={String(hook.accentLine)}
              options={[
                { value: '0', label: '없음' },
                { value: '1', label: '1줄' },
                { value: '2', label: '2줄' },
              ]}
              onChange={(v) => onPatch({ accentLine: Number(v) })}
            />
          </div>
        </div>
        <Slider label="외곽선 두께" value={hook.strokeWidth} min={0} max={0.35} step={0.01} onChange={(v) => onPatch({ strokeWidth: v })} />
      </Section>

      <Section title="배지 · 박스 배경">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
            <input type="color" value={hook.pillColor} onChange={(e) => onPatch({ pillColor: e.target.value })} className="h-6 w-6 rounded-md" aria-label="배지 색" />
            <span className="text-[11px] text-studio-300">배지 색</span>
          </label>
          <label className="flex items-center gap-1.5 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
            <input type="color" value={hook.boxColor} onChange={(e) => onPatch({ boxColor: e.target.value })} className="h-6 w-6 rounded-md" aria-label="박스 색" />
            <span className="text-[11px] text-studio-300">박스 색</span>
          </label>
        </div>
        <Slider label="배지 불투명도" value={hook.pillOpacity} min={0} max={1} step={0.01} onChange={(v) => onPatch({ pillOpacity: v })} />
        <Slider label="박스 불투명도" value={hook.boxOpacity} min={0} max={0.95} step={0.01} onChange={(v) => onPatch({ boxOpacity: v })} />
      </Section>

      <Section
        title="집중선 (스피드라인)"
        right={hook.speedLines.enabled ? <Badge tone="live">ON</Badge> : undefined}
        description="화면 가장자리에서 중심으로 뻗는 흰 방사선. 도입부 임팩트용."
      >
        <Toggle
          label="집중선 오버레이"
          checked={hook.speedLines.enabled}
          onChange={(v) => onSpeedLines({ enabled: v })}
        />
        {hook.speedLines.enabled ? (
          <>
            <Slider label="선 개수" value={hook.speedLines.count} min={16} max={180} step={2} onChange={(v) => onSpeedLines({ count: v })} />
            <Slider label="불투명도" value={hook.speedLines.opacity} min={0.1} max={1} step={0.01} onChange={(v) => onSpeedLines({ opacity: v })} />
            <Slider label="중심 여백" value={hook.speedLines.innerRadius} min={0.3} max={0.9} step={0.01} onChange={(v) => onSpeedLines({ innerRadius: v })} />
            <label className="flex items-center gap-1.5 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
              <input type="color" value={hook.speedLines.color} onChange={(e) => onSpeedLines({ color: e.target.value })} className="h-6 w-6 rounded-md" aria-label="집중선 색" />
              <span className="text-[11px] text-studio-300">집중선 색</span>
            </label>
          </>
        ) : null}
      </Section>
    </div>
  );
}
