import type { ChangeEvent } from 'react';
import type {
  DateCardOverlay, ImageSticker, OverlayState, PlaceCardOverlay, ViewfinderOverlay,
} from '../types';
import { STICKER_FRAMES, STICKER_WIDTHS } from '../lib/presets';
import { Badge, Section, Segmented, Slider, Toggle } from './ui';

interface Props {
  stickers: ImageSticker[];
  selectedId: string | null;
  overlays: OverlayState;
  duration: number;
  currentTime: number;
  onAddFiles: (files: FileList | null) => void;
  onSelect: (id: string | null) => void;
  onPatchSticker: (id: string, patch: Partial<ImageSticker>) => void;
  onRemoveSticker: (id: string) => void;
  onViewfinder: (patch: Partial<ViewfinderOverlay>) => void;
  onDateCard: (patch: Partial<DateCardOverlay>) => void;
  onPlaceCard: (patch: Partial<PlaceCardOverlay>) => void;
  onSeek: (t: number) => void;
}

const MAX_STICKERS = 3;

export default function OverlayPanel({
  stickers,
  selectedId,
  overlays,
  duration,
  currentTime,
  onAddFiles,
  onSelect,
  onPatchSticker,
  onRemoveSticker,
  onViewfinder,
  onDateCard,
  onPlaceCard,
  onSeek,
}: Props) {
  const selected = stickers.find((s) => s.id === selectedId) ?? null;
  const full = stickers.length >= MAX_STICKERS;

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    onAddFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section
        title="사진 스티커 (PiP)"
        right={<Badge tone={stickers.length ? 'live' : 'default'}>{stickers.length}/{MAX_STICKERS}</Badge>}
        description="영상 위에 사진을 얹고 끌어서 옮깁니다. 미리보기에서 드래그하거나 아래 X·Y 슬라이더로 맞추세요."
      >
        <label
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-xs font-semibold transition ${
            full
              ? 'cursor-not-allowed border-studio-700 text-studio-500'
              : 'border-studio-500 text-studio-200 hover:border-neon/70 hover:text-white'
          }`}
        >
          <span className="text-sm">🖼️</span>
          {full ? '3장까지 올릴 수 있어요' : '사진 추가 (최대 3장)'}
          <input type="file" accept="image/*" multiple className="hidden" disabled={full} onChange={pick} />
        </label>

        {stickers.length ? (
          <div className="space-y-1.5">
            {stickers.map((st) => (
              <div
                key={st.id}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition ${
                  st.id === selectedId ? 'border-neon/80 bg-neon/10' : 'border-studio-700 bg-studio-800/40'
                }`}
              >
                <button type="button" onClick={() => onSelect(st.id === selectedId ? null : st.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <img src={st.src} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold text-studio-100">{st.name || '사진'}</span>
                    <span className="block text-[10px] text-studio-400">
                      {st.frame === 'dashed' ? '점선' : st.frame === 'polaroid' ? '폴라로이드' : st.frame === 'rounded' ? '둥근 모서리' : '테두리 없음'} · {Math.round(st.width * 100)}%
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onPatchSticker(st.id, { enabled: !st.enabled })}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${st.enabled ? 'bg-neon/25 text-neon-soft' : 'bg-studio-700 text-studio-400'}`}
                >
                  {st.enabled ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveSticker(st.id)}
                  className="rounded px-1 text-[11px] text-studio-400 hover:text-neon-rose"
                  aria-label="스티커 삭제"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-studio-700/60 bg-studio-800/30 px-2.5 py-2 text-[11px] leading-relaxed text-studio-400">
            레퍼런스처럼 계좌 캡처, 메뉴 사진, 서브 컷을 얹어 보세요. 점선 흰 테두리·폴라로이드·둥근 모서리 중에 고를 수 있습니다.
          </p>
        )}

        {selected ? (
          <div className="space-y-2 rounded-xl border border-studio-700 bg-studio-900/60 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-studio-200">스티커 배치</span>
              <span className="text-[10px] text-studio-500">미리보기에서 드래그 가능</span>
            </div>
            <div>
              <span className="label">테두리</span>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {STICKER_FRAMES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    title={f.hint}
                    onClick={() => onPatchSticker(selected.id, { frame: f.id })}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      selected.frame === f.id
                        ? 'border-neon/80 bg-neon/15 text-white'
                        : 'border-studio-700 bg-studio-800/40 text-studio-300 hover:border-studio-500'
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([['x', '가로'], ['y', '세로'], ['width', '크기']] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1">
                  <span className="text-[10px] text-studio-400">{label}</span>
                  <input
                    type="range"
                    className="w-full"
                    min={key === 'width' ? STICKER_WIDTHS.min : 0}
                    max={key === 'width' ? STICKER_WIDTHS.max : 1}
                    step={0.005}
                    value={selected[key]}
                    onChange={(e) => onPatchSticker(selected.id, { [key]: Number(e.target.value) } as Partial<ImageSticker>)}
                  />
                  <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-studio-200">
                    {Math.round(selected[key] * 100)}
                  </span>
                </label>
              ))}
            </div>
            <Slider
              label="기울기"
              value={selected.rotation}
              min={-30}
              max={30}
              step={0.5}
              suffix="°"
              onChange={(v) => onPatchSticker(selected.id, { rotation: v })}
            />
            <Slider
              label="투명도"
              value={selected.opacity}
              min={0.2}
              max={1}
              step={0.01}
              onChange={(v) => onPatchSticker(selected.id, { opacity: v })}
            />
            <label className="flex items-center gap-1.5 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
              <input
                type="color"
                value={selected.frameColor}
                onChange={(e) => onPatchSticker(selected.id, { frameColor: e.target.value })}
                className="h-6 w-6 rounded-md"
                aria-label="테두리 색"
              />
              <span className="text-[11px] text-studio-300">테두리 색</span>
            </label>
            <div>
              <span className="label">표시 구간</span>
              <div className="mt-1">
                <Segmented
                  size="sm"
                  value={selected.start != null || selected.end != null ? 'range' : 'all'}
                  options={[
                    { value: 'all', label: '전체' },
                    { value: 'range', label: '구간' },
                  ]}
                  onChange={(v) => onPatchSticker(selected.id, v === 'all'
                    ? { start: null, end: null }
                    : { start: Math.round(currentTime * 10) / 10, end: Math.min(duration, Math.round((currentTime + 3) * 10) / 10) })}
                />
              </div>
              {selected.start != null || selected.end != null ? (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-studio-400">
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={duration}
                    value={selected.start ?? 0}
                    onChange={(e) => onPatchSticker(selected.id, { start: Math.max(0, Number(e.target.value)) })}
                    className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={duration}
                    value={selected.end ?? duration}
                    onChange={(e) => onPatchSticker(selected.id, { end: Math.min(duration, Number(e.target.value)) })}
                    className="w-16 rounded bg-studio-900/80 px-1 py-0.5 tabular-nums text-studio-100"
                  />
                  <span>초</span>
                  <button type="button" className="chip ml-auto !px-2 !py-0.5" onClick={() => onSeek(selected.start ?? 0)}>
                    이동
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Section>

      <Section
        title="카메라 뷰파인더 프레임"
        right={<Badge tone={overlays.viewfinder.enabled ? 'live' : 'default'}>{overlays.viewfinder.enabled ? 'ON' : 'OFF'}</Badge>}
        description="상단 Auto · HDR Off, 3×3 그리드, 하단 셔터 버튼까지 카메라 화면처럼 덮습니다."
      >
        <Toggle
          label="뷰파인더 오버레이"
          checked={overlays.viewfinder.enabled}
          onChange={(v) => onViewfinder({ enabled: v })}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">상단 왼쪽</span>
            <input className="field mt-1" value={overlays.viewfinder.topLeft} maxLength={22} onChange={(e) => onViewfinder({ topLeft: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">상단 오른쪽</span>
            <input className="field mt-1" value={overlays.viewfinder.topRight} maxLength={12} onChange={(e) => onViewfinder({ topRight: e.target.value })} />
          </label>
        </div>
        <label className="block">
          <span className="label">하단 모드 (| 로 구분)</span>
          <input className="field mt-1" value={overlays.viewfinder.bottomLabels} onChange={(e) => onViewfinder({ bottomLabels: e.target.value })} />
        </label>
        <Slider label="불투명도" value={overlays.viewfinder.opacity} min={0.2} max={1} step={0.01} onChange={(v) => onViewfinder({ opacity: v })} />
        <Slider label="검은 바 진하기" value={overlays.viewfinder.bandOpacity} min={0} max={0.8} step={0.01} onChange={(v) => onViewfinder({ bandOpacity: v })} />
      </Section>

      <Section
        title="날짜 스탬프 카드"
        right={<Badge tone={overlays.dateCard.enabled ? 'live' : 'default'}>{overlays.dateCard.enabled ? 'ON' : 'OFF'}</Badge>}
        description="view of today / SUN / 22 — 미니 캘린더 카드. 문구와 날짜를 직접 고칩니다."
      >
        <Toggle
          label="날짜 카드 표시"
          checked={overlays.dateCard.enabled}
          onChange={(v) => onDateCard({ enabled: v })}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block">
            <span className="label">윗줄 문구</span>
            <input className="field mt-1" value={overlays.dateCard.eyebrow} maxLength={24} onChange={(e) => onDateCard({ eyebrow: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">요일</span>
            <input className="field mt-1" value={overlays.dateCard.weekday} maxLength={4} onChange={(e) => onDateCard({ weekday: e.target.value.toUpperCase() })} />
          </label>
          <label className="block">
            <span className="label">날짜</span>
            <input className="field mt-1" value={overlays.dateCard.day} maxLength={4} onChange={(e) => onDateCard({ day: e.target.value })} />
          </label>
          <label className="col-span-2 block">
            <span className="label">월 · 연도</span>
            <input className="field mt-1" value={overlays.dateCard.monthYear} maxLength={16} onChange={(e) => onDateCard({ monthYear: e.target.value })} />
          </label>
        </div>
        <Slider label="크기" value={overlays.dateCard.scale} min={0.5} max={1.8} step={0.02} onChange={(v) => onDateCard({ scale: v })} />
        <Slider label="가로 위치" value={overlays.dateCard.x} min={0.05} max={0.95} step={0.005} onChange={(v) => onDateCard({ x: v })} />
        <Slider label="세로 위치" value={overlays.dateCard.y} min={0.05} max={0.95} step={0.005} onChange={(v) => onDateCard({ y: v })} />
        <Slider label="기울기" value={overlays.dateCard.rotation} min={-15} max={15} step={0.5} suffix="°" onChange={(v) => onDateCard({ rotation: v })} />
      </Section>

      <Section
        title="여행 장소 카드"
        right={<Badge tone={overlays.placeCard.enabled ? 'live' : 'default'}>{overlays.placeCard.enabled ? 'ON' : 'OFF'}</Badge>}
        description="장소명·별점·소요시간·영업 상태와 경로/시작/티켓/통화 버튼이 들어간 미니 지도 카드."
      >
        <Toggle
          label="장소 카드 표시"
          checked={overlays.placeCard.enabled}
          onChange={(v) => onPlaceCard({ enabled: v })}
        />
        <label className="block">
          <span className="label">장소명</span>
          <input className="field mt-1" value={overlays.placeCard.title} maxLength={26} onChange={(e) => onPlaceCard({ title: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">별점</span>
            <input
              type="number"
              step={0.1}
              min={0}
              max={5}
              value={overlays.placeCard.rating}
              onChange={(e) => onPlaceCard({ rating: Math.max(0, Math.min(5, Number(e.target.value))) })}
              className="field mt-1 tabular-nums"
            />
          </label>
          <label className="block">
            <span className="label">리뷰 수</span>
            <input className="field mt-1" value={overlays.placeCard.reviews} maxLength={12} onChange={(e) => onPlaceCard({ reviews: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">소요시간</span>
            <input className="field mt-1" value={overlays.placeCard.duration} maxLength={16} onChange={(e) => onPlaceCard({ duration: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">영업 상태</span>
            <input className="field mt-1" value={overlays.placeCard.status} maxLength={30} onChange={(e) => onPlaceCard({ status: e.target.value })} />
          </label>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-studio-700 bg-studio-800/50 px-2 py-1.5">
          <input
            type="color"
            value={overlays.placeCard.accent}
            onChange={(e) => onPlaceCard({ accent: e.target.value })}
            className="h-6 w-6 rounded-md"
            aria-label="포인트 색"
          />
          <span className="text-[11px] text-studio-300">포인트 색</span>
        </div>
        <Slider label="크기" value={overlays.placeCard.scale} min={0.5} max={1.6} step={0.02} onChange={(v) => onPlaceCard({ scale: v })} />
        <Slider label="가로 위치" value={overlays.placeCard.x} min={0.05} max={0.95} step={0.005} onChange={(v) => onPlaceCard({ x: v })} />
        <Slider label="세로 위치" value={overlays.placeCard.y} min={0.05} max={0.95} step={0.005} onChange={(v) => onPlaceCard({ y: v })} />
      </Section>
    </div>
  );
}
