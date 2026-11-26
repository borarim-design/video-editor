import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type {
  EditSpec, HookTitle, ImageSticker, OverlayState, PersonTrack, ProjectMeta, SubtitleState, MaskState,
} from '../types';
import { outputGeometry } from '../lib/layout';
import { drawPreview, toSourceNorm } from '../lib/preview';
import { onStickerImageLoaded, stickerHitTest } from '../lib/stickers';
import { formatTime } from '../lib/format';

interface Props {
  project: ProjectMeta;
  videoRef: RefObject<HTMLVideoElement | null>;
  time: number;
  trim: { start: number; end: number };
  aspect: EditSpec['aspect'];
  subtitles: SubtitleState;
  hook: HookTitle;
  masks: MaskState;
  tracks: PersonTrack[];
  stickers: ImageSticker[];
  overlays: OverlayState;
  selectedStickerId: string | null;
  fontsTick: number;
  drawMode: boolean;
  playing: boolean;
  audioBlocked: boolean;
  onUnmute: () => void;
  onAddManual: (rect: { x: number; y: number; w: number; h: number }) => void;
  onDrawModeChange: (v: boolean) => void;
  onSelectSticker: (id: string | null) => void;
  onMoveSticker: (id: string, patch: { x: number; y: number }) => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function PreviewStage({
  project,
  videoRef,
  time,
  trim,
  aspect,
  subtitles,
  hook,
  masks,
  tracks,
  stickers,
  overlays,
  selectedStickerId,
  fontsTick,
  drawMode,
  playing,
  audioBlocked,
  onUnmute,
  onAddManual,
  onDrawModeChange,
  onSelectSticker,
  onMoveSticker,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Rect | null>(null);
  const [seekTick, setSeekTick] = useState(0);
  const [painted, setPainted] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const stickerDrag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const geo = useMemo(() => outputGeometry(project.width, project.height, aspect), [project, aspect]);
  const tTimeline = Math.max(0, Math.min(time - trim.start, Math.max(0.001, trim.end - trim.start)));

  const spec: EditSpec = useMemo(
    () => ({
      trim,
      aspect,
      subtitles: { enabled: subtitles.enabled, cues: subtitles.cues, style: subtitles.style },
      hook,
      stickers,
      overlays,
      masks: {
        enabled: masks.enabled,
        mode: masks.mode,
        shape: masks.shape,
        strength: masks.strength,
        pad: masks.pad,
        tracks: masks.tracks,
        manual: masks.manual,
      },
    }),
    [trim, aspect, subtitles, hook, stickers, overlays, masks],
  );

  const render = useCallback(
    (overrideTime?: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // 재생 프레임 루프에서는 state 가 아닌 실제 영상 시간을 넘겨 그린다.
      const tSource = overrideTime ?? time;
      const tClip = Math.max(0, Math.min(tSource - trim.start, Math.max(0.001, trim.end - trim.start)));
      const drew = drawPreview({
        canvas,
        video: videoRef.current,
        projectWidth: project.width,
        projectHeight: project.height,
        spec,
        tracks,
        t: tClip,
        tSource,
        dragBox: drag,
        selectedStickerId,
      });
      setPainted((prev) => (prev === drew ? prev : drew));
    },
    [project, spec, tracks, trim.start, trim.end, time, drag, videoRef, selectedStickerId],
  );

  const renderRef = useRef(render);
  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  useEffect(() => {
    // 재생 중에는 아래 프레임 루프가 매 프레임 그리므로, 늦은 state 시간으로 다시 그려
    // 화면이 튀지 않도록 건너뛴다.
    const v = videoRef.current;
    if (v && !v.paused && !v.ended) return;
    render();
  }, [render, fontsTick, seekTick, videoRef]);

  // 재생 중에는 requestAnimationFrame 으로 매 프레임 미리보기를 그린다.
  // (timeupdate 는 1초에 몇 번만 오기 때문에 캔버스가 멈춘 것처럼 보였다 → iOS 재생 안 됨의 원인)
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) {
        renderRef.current(video.currentTime);
      }
      raf = window.requestAnimationFrame(loop);
    };
    const video = videoRef.current;
    if (playing || (video && !video.paused && !video.ended)) {
      raf = window.requestAnimationFrame(loop);
    }
    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [playing, videoRef]);

  // iOS Safari 는 currentTime 0 프레임을 디코딩하지 않는 경우가 있어
  // 메타데이터가 오면 아주 살짝 seek 해서 첫 프레임을 강제로 만든다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoError(null);
    setPainted(false);
    // iOS Safari 인라인 재생 속성(React 가 모르는 attribute 는 직접 지정)
    ['playsinline', 'webkit-playsinline', 'x5-playsinline', 'disablepictureinpicture'].forEach((name) => {
      video.setAttribute(name, 'true');
    });

    const bump = () => setSeekTick((v) => v + 1);
    const kickFirstFrame = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      try {
        if (Math.abs(video.currentTime) < 0.001) video.currentTime = 0.04;
      } catch {
        /* ignore */
      }
      bump();
    };
    const onLoadedMeta = () => {
      kickFirstFrame();
      if (!video.videoWidth || !video.videoHeight) {
        setVideoError(
          '영상 해상도를 읽지 못했어요. 아이폰에서 찍은 .mov(HEVC)는 브라우저가 디코딩하지 못할 수 있습니다. MP4(H.264)로 변환해 주세요.',
        );
      }
    };
    const onError = () => {
      const code = video.error?.code;
      setVideoError(
        code === 4
          ? '브라우저가 이 영상 코덱을 지원하지 않습니다. 아이폰 HEVC .mov는 MP4(H.264)로 변환해 주세요.'
          : '영상을 재생하지 못했습니다. 파일을 다시 선택하거나 MP4(H.264)로 변환해 주세요.',
      );
    };
    const events: [string, () => void][] = [
      ['loadedmetadata', onLoadedMeta],
      ['loadeddata', kickFirstFrame],
      ['canplay', kickFirstFrame],
      ['canplaythrough', kickFirstFrame],
      ['seeked', bump],
      ['playing', bump],
      ['error', onError],
    ];
    events.forEach(([name, fn]) => video.addEventListener(name, fn));
    // 이벤트가 늦게 오는 기기에서도 첫 프레임을 여러 번 시도한다.
    const retries = [120, 400, 900, 1800].map((ms) => window.setTimeout(kickFirstFrame, ms));
    return () => {
      events.forEach(([name, fn]) => video.removeEventListener(name, fn));
      retries.forEach((id) => window.clearTimeout(id));
    };
  }, [videoRef, project.id]);

  // 스티커 이미지가 늦게 디코딩되면 한 번 더 그린다.
  useEffect(() => {
    onStickerImageLoaded(() => setSeekTick((v) => v + 1));
    return () => onStickerImageLoaded(null);
  }, []);

  const pointToCanvas = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (drawMode) {
      const p = pointToCanvas(e);
      dragStart.current = p;
      setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    // 스티커 드래그 — 가장 위에 있는 스티커부터 잡는다.
    const p = pointToCanvas(e);
    const hit = stickerHitTest(stickers, canvas.width, canvas.height, p.x, p.y);
    if (hit) {
      const st = stickers.find((s) => s.id === hit);
      if (st) {
        stickerDrag.current = { id: hit, dx: p.x - st.x * canvas.width, dy: p.y - st.y * canvas.height };
        onSelectSticker(hit);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    } else if (selectedStickerId) {
      onSelectSticker(null);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (stickerDrag.current) {
      const p = pointToCanvas(e);
      const { id, dx, dy } = stickerDrag.current;
      onMoveSticker(id, {
        x: Math.max(-0.1, Math.min(1.1, (p.x - dx) / canvas.width)),
        y: Math.max(-0.1, Math.min(1.1, (p.y - dy) / canvas.height)),
      });
      return;
    }
    if (!dragStart.current) return;
    const p = pointToCanvas(e);
    const s = dragStart.current;
    setDrag({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (stickerDrag.current) {
      stickerDrag.current = null;
      return;
    }
    if (!dragStart.current || !drag) {
      dragStart.current = null;
      return;
    }
    const start = dragStart.current;
    const end = pointToCanvas(e);
    dragStart.current = null;
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    setDrag(null);
    if (w < 8 || h < 8) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const a = toSourceNorm(canvas, project.width, project.height, spec, rect.left + Math.min(start.x, end.x) * (rect.width / canvas.width), rect.top + Math.min(start.y, end.y) * (rect.height / canvas.height));
    const b = toSourceNorm(canvas, project.width, project.height, spec, rect.left + Math.max(start.x, end.x) * (rect.width / canvas.width), rect.top + Math.max(start.y, end.y) * (rect.height / canvas.height));
    onAddManual({ x: a.x, y: a.y, w: Math.max(0.01, b.x - a.x), h: Math.max(0.01, b.y - a.y) });
    onDrawModeChange(false);
  };

  const activeTracks = masks.tracks.filter((t) => t.enabled).length;
  const stickerCount = stickers.filter((s) => s.enabled).length;

  return (
    <div className="relative flex flex-col lg:h-full lg:min-h-0">
      <div className="flex items-center justify-center p-2 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        <div
          ref={wrapRef}
          className="preview-fit relative mx-auto max-w-full lg:w-auto"
          style={{
            aspectRatio: `${geo.outW} / ${geo.outH}`,
            maxWidth: '100%',
            ['--preview-ar' as string]: `${geo.outH / geo.outW}`,
          }}
        >
          <div
            className="relative h-full w-full overflow-hidden rounded-xl border border-studio-700 bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]"
            style={{ maxHeight: '100%' }}
          >
            {/* iOS Safari 폴백: 캔버스가 아직 첫 프레임을 못 그렸을 때 영상 자체가 보인다. */}
            <video
              ref={videoRef}
              src={project.srcUrl}
              playsInline
              preload="auto"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity ${
                painted ? 'opacity-100' : 'opacity-0'
              } ${drawMode ? 'cursor-crosshair' : stickerCount ? 'cursor-move' : 'cursor-default'}`}
            />
            {videoError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-studio-950/90 px-6 text-center">
                <span className="text-2xl">🎬</span>
                <p className="text-xs font-bold text-studio-100">미리보기를 표시할 수 없어요</p>
                <p className="text-[11px] leading-relaxed text-studio-400">{videoError}</p>
              </div>
            ) : null}
            <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/80 backdrop-blur">
                {geo.outW}×{geo.outH}
              </span>
              {subtitles.enabled && subtitles.cues.length > 0 ? (
                <span className="rounded-md bg-neon/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">자막 {subtitles.cues.length}</span>
              ) : null}
              {stickerCount > 0 ? (
                <span className="rounded-md bg-neon-cyan/80 px-1.5 py-0.5 text-[10px] font-semibold text-studio-900">스티커 {stickerCount}</span>
              ) : null}
              {masks.enabled && activeTracks > 0 ? (
                <span className="rounded-md bg-neon/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">모자이크 {activeTracks}명</span>
              ) : null}
            </div>
            <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white/80 backdrop-blur">
              {formatTime(tTimeline)}
            </div>
            {drawMode ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
                <span className="rounded-full bg-neon-cyan px-3 py-1 text-[11px] font-bold text-studio-900 shadow">
                  미리보기에서 영역을 드래그하세요
                </span>
              </div>
            ) : null}
            {!drawMode && selectedStickerId ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                <span className="rounded-full bg-black/70 px-3 py-1 text-[10px] font-semibold text-white/90 backdrop-blur">
                  스티커를 끌어서 위치를 옮길 수 있어요
                </span>
              </div>
            ) : null}
            {audioBlocked ? (
              <button
                type="button"
                onClick={onUnmute}
                className="absolute bottom-2 left-2 inline-flex min-h-[44px] items-center gap-1 rounded-full bg-neon-amber px-3 text-[11px] font-bold text-studio-900 shadow-lg"
              >
                🔇 음소거 재생 중 · 소리 켜기
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
