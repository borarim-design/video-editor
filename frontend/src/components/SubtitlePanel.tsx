import { useEffect, useRef, useState } from 'react';
import type { Cue, FontFamily, Preset, SubtitleState, SubtitleStyle } from '../types';
import { PRESETS } from '../lib/presets';
import { fontFamilyName } from '../lib/fonts';
import { formatTime, parseTimecode, timecodeInput } from '../lib/format';
import { Badge, Section, Segmented, Slider, Toggle } from './ui';

interface Props {
  subtitles: SubtitleState;
  fonts: FontFamily[];
  currentTime: number;
  selectedCueId: string | null;
  onStyle: (patch: Partial<SubtitleStyle>) => void;
  onPreset: (preset: Preset) => void;
  onToggle: (v: boolean) => void;
  onCueChange: (id: string, patch: Partial<Cue>) => void;
  onCueDelete: (id: string) => void;
  onCueAdd: () => string;
  onSelectCue: (id: string | null) => void;
  onSeek: (t: number) => void;
}

export default function SubtitlePanel({
  subtitles,
  fonts,
  currentTime,
  selectedCueId,
  onStyle,
  onPreset,
  onToggle,
  onCueChange,
  onCueDelete,
  onCueAdd,
  onSelectCue,
  onSeek,
}: Props) {
  const { style, cues, enabled } = subtitles;
  const family = fonts.find((f) => f.id === style.font) || fonts[0];
  const weights = family?.weights ?? ['regular'];
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const activeCue = cues.find((c) => c.start <= currentTime && currentTime <= c.end);

  const scrollToCue = (id: string) => {
    const el = document.getElementById(`cue-row-${id}`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // 타임라인 등에서 자막이 선택되면 해당 행으로 스크롤한다.
  useEffect(() => {
    if (selectedCueId) scrollToCue(selectedCueId);
  }, [selectedCueId]);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const handleAdd = () => {
    const id = onCueAdd();
    onSelectCue(id);
    setFlashId(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2000);
    window.setTimeout(() => scrollToCue(id), 60);
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      {/* 최상단 고정: 탭을 열자마자 자막을 추가할 수 있어야 한다. */}
      <div className="sticky top-0 z-20 space-y-1.5 border-b border-studio-700/60 bg-studio-900/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={handleAdd} className="btn-primary min-h-[44px] w-full text-sm">
          ➕ 자막 추가
          <span className="text-[11px] font-medium opacity-80">현재 {formatTime(currentTime, false)}</span>
        </button>
        <Toggle label="자막 표시" checked={enabled} onChange={onToggle} />
      </div>

      <Section
        title={`자막 목록 (${cues.length})`}
        description="행을 누르면 그 시점으로 이동합니다. 텍스트·시간을 직접 고칠 수 있어요."
      >
        <div className="space-y-1.5">
          {cues.length === 0 ? (
            <p className="rounded-lg border border-dashed border-studio-700 px-3 py-6 text-center text-[11px] text-studio-400">
              아직 자막이 없습니다. 위의 <span className="font-semibold text-studio-200">➕ 자막 추가</span> 를 누르면 현재
              재생 위치에 자막이 생겨요.
            </p>
          ) : null}
          {cues.map((cue) => {
            const isActive = activeCue?.id === cue.id;
            const isSelected = selectedCueId === cue.id;
            const isFlash = flashId === cue.id;
            return (
              <div
                key={cue.id}
                id={`cue-row-${cue.id}`}
                onPointerDown={() => onSelectCue(cue.id)}
                className={`rounded-lg border px-2 py-1.5 transition ${
                  isFlash
                    ? 'border-neon-amber bg-neon-amber/15 shadow-glow'
                    : isSelected
                      ? 'border-neon bg-neon/15'
                      : isActive
                        ? 'border-neon/70 bg-neon/10'
                        : 'border-studio-700 bg-studio-800/40'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded bg-studio-700 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-studio-200 hover:bg-studio-600"
                    onClick={() => onSeek(cue.start)}
                  >
                    {formatTime(cue.start, false)}
                  </button>
                  <span className="text-studio-500">→</span>
                  <input
                    className="w-16 rounded bg-studio-900/70 px-1 py-0.5 font-mono text-[10px] tabular-nums text-studio-200"
                    defaultValue={timecodeInput(cue.end)}
                    key={`${cue.id}-end-${cue.end}`}
                    onBlur={(e) => {
                      const v = parseTimecode(e.target.value);
                      if (v != null && v > cue.start) onCueChange(cue.id, { end: v });
                    }}
                  />
                  <button
                    type="button"
                    className="ml-auto rounded px-1.5 text-xs text-studio-400 hover:bg-neon-rose/20 hover:text-neon-rose"
                    onClick={() => onCueDelete(cue.id)}
                    aria-label="자막 삭제"
                  >
                    ✕
                  </button>
                </div>
                <input
                  className="mt-1 w-full rounded bg-transparent px-0.5 py-0.5 text-[12px] text-studio-100 outline-none focus:bg-studio-900/60"
                  value={cue.text}
                  onChange={(e) => onCueChange(cue.id, { text: e.target.value, words: [] })}
                  placeholder="자막 문구"
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="AI 자동 자막"
        right={<Badge tone="warn">정적 모드</Badge>}
        description="서버 없이 동작하는 GitHub Pages 모드입니다. 수동 자막은 위의 ➕ 자막 추가 버튼으로 언제든 넣을 수 있어요."
      >
        <button
          type="button"
          className="btn-ghost w-full cursor-not-allowed opacity-45"
          disabled
          title="GitHub Pages 모드에서는 수동 자막·수동 모자이크를 지원하며, AI 자동 기능은 추후 서버 연결 시 활성화됩니다"
        >
          ✨ 자동 자막 생성 (서버 연결 시)
        </button>
        <p className="text-[11px] leading-relaxed text-studio-400">
          GitHub Pages 모드에서는 수동 자막·수동 모자이크를 지원하며, AI 자동 기능은 추후 서버 연결 시 활성화됩니다.
        </p>
      </Section>

      <Section title="스타일 프리셋" description="릴스·숏츠에서 도는 요즘 스타일. 언제든 세부 조정 가능.">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p.id)}
              className={`rounded-xl border p-2.5 text-left transition ${
                style.preset === p.id
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

      <Section title="폰트" right={<span className="text-[10px] text-studio-400">{fonts.length}종 · 내장</span>}>
        <div className="grid grid-cols-2 gap-1.5">
          {fonts.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onStyle({ font: f.id, weight: f.weights.includes(style.weight) ? style.weight : f.defaultWeight })}
              className={`rounded-lg border px-2.5 py-2 text-left transition ${
                style.font === f.id ? 'border-neon/80 bg-neon/15' : 'border-studio-700 bg-studio-800/40 hover:border-studio-500'
              }`}
            >
              <span
                className="block truncate text-[13px] text-studio-100"
                style={{ fontFamily: fontFamilyName(f.id, f.defaultWeight) }}
              >
                {f.name}
              </span>
              <span className="text-[9px] uppercase tracking-wide text-studio-400">{f.category}</span>
            </button>
          ))}
        </div>
        {weights.length > 1 ? (
          <div className="pt-1">
            <Segmented
              size="sm"
              value={style.weight}
              options={weights.map((w) => ({
                value: w,
                label: w === 'regular' ? '보통' : w === 'bold' ? '굵게' : '아주 굵게',
              }))}
              onChange={(w) => onStyle({ weight: w })}
            />
          </div>
        ) : null}
        {family ? <p className="text-[10px] text-studio-400">{family.description}</p> : null}
        <p
          className="rounded-lg bg-studio-900/70 px-2.5 py-2 text-center text-sm text-studio-100"
          style={{ fontFamily: fontFamilyName(style.font, style.weight) }}
        >
          {family?.sample ?? '오늘도 한 컷'} · 자막 미리보기
        </p>
      </Section>

      <Section title="크기 · 위치">
        <Slider label="글자 크기" value={style.fontSize} min={3} max={14} step={0.2} suffix="%" onChange={(v) => onStyle({ fontSize: v })} hint="화면 높이 대비 비율" />
        <Slider label="세로 위치" value={style.yPercent} min={8} max={92} step={0.5} suffix="%" onChange={(v) => onStyle({ yPercent: v })} />
        <Slider label="줄 간격" value={style.lineHeight} min={1} max={1.8} step={0.02} onChange={(v) => onStyle({ lineHeight: v })} />
        <Slider label="최대 폭" value={style.maxWidthPct} min={40} max={96} step={1} suffix="%" onChange={(v) => onStyle({ maxWidthPct: v })} />
      </Section>

      <Section
        title="지글지글 효과"
        right={style.wobble > 0 ? <Badge tone="live">ON</Badge> : undefined}
        description="글자마다 미세하게 흔들려 손글씨·명조 감성을 냅니다. 미리보기와 최종 영상이 같은 난수로 움직여요."
      >
        <Slider label="흔들림 강도" value={style.wobble} min={0} max={100} step={1} suffix="%" onChange={(v) => onStyle({ wobble: v })} />
        <div className="flex gap-1.5">
          {[
            { label: '없음', v: 0 },
            { label: '살짝', v: 30 },
            { label: '지글지글', v: 60 },
            { label: '아주 많이', v: 95 },
          ].map((o) => (
            <button key={o.v} type="button" className={`chip ${style.wobble === o.v ? 'chip-active' : ''}`} onClick={() => onStyle({ wobble: o.v })}>
              {o.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="색 · 효과">
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: 'color' as const, label: '글자색' },
            { key: 'accent' as const, label: '강조색' },
            { key: 'strokeColor' as const, label: '외곽선' },
          ].map((c) => (
            <label key={c.key} className="flex items-center gap-2 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
              <input
                type="color"
                value={style[c.key]}
                onChange={(e) => onStyle({ [c.key]: e.target.value } as Partial<SubtitleStyle>)}
                className="h-6 w-6 rounded-md"
                aria-label={c.label}
              />
              <span className="text-[11px] text-studio-300">{c.label}</span>
            </label>
          ))}
        </div>
        <Slider label="외곽선 두께" value={style.strokeWidth} min={0} max={0.35} step={0.01} onChange={(v) => onStyle({ strokeWidth: v })} />
        <Slider label="그림자" value={style.shadow} min={0} max={0.3} step={0.01} onChange={(v) => onStyle({ shadow: v })} />
        <Slider label="강조 단어 확대" value={style.highlightScale} min={1} max={1.5} step={0.01} onChange={(v) => onStyle({ highlightScale: v })} />
        <Slider label="배경 박스 불투명도" value={style.boxOpacity} min={0} max={1} step={0.01} onChange={(v) => onStyle({ boxOpacity: v })} />
        <label className="flex items-center gap-2 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
          <input
            type="color"
            value={style.boxColor}
            onChange={(e) => onStyle({ boxColor: e.target.value })}
            className="h-6 w-6 rounded-md"
            aria-label="박스 색"
          />
          <span className="text-[11px] text-studio-300">배경 박스 색</span>
        </label>
      </Section>
    </div>
  );
}
