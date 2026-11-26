import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { EditSpec, HookTitle, PersonTrack, ProjectMeta, SubtitleState, MaskState } from '../types';
import { outputGeometry } from '../lib/layout';
import { drawPreview, toSourceNorm } from '../lib/preview';
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
  fontsTick: number;
  drawMode: boolean;
  onAddManual: (rect: { x: number; y: number; w: number; h: number }) => void;
  onDrawModeChange: (v: boolean) => void;
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
  fontsTick,
  drawMode,
  onAddManual,
  onDrawModeChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Rect | null>(null);
  const [seekTick, setSeekTick] = useState(0);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const geo = useMemo(() => outputGeometry(project.width, project.height, aspect), [project, aspect]);
  const tTimeline = Math.max(0, Math.min(time - trim.start, Math.max(0.001, trim.end - trim.start)));

  const spec: EditSpec = useMemo(
    () => ({
      trim,
      aspect,
      subtitles: { enabled: subtitles.enabled, cues: subtitles.cues, style: subtitles.style },
      hook,
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
    [trim, aspect, subtitles, hook, masks],
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawPreview({
      canvas,
      video: videoRef.current,
      projectWidth: project.width,
      projectHeight: project.height,
      spec,
      tracks,
      t: tTimeline,
      tSource: time,
      dragBox: drag,
    });
  }, [project, spec, tracks, tTimeline, time, drag, videoRef]);

  useEffect(() => {
    render();
  }, [render, fontsTick, seekTick]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onSeeked = () => setSeekTick((v) => v + 1);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onSeeked);
    return () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onSeeked);
    };
  }, [videoRef, project.id]);

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
    if (!drawMode) return;
    const p = pointToCanvas(e);
    dragStart.current = p;
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragStart.current) return;
    const p = pointToCanvas(e);
    const s = dragStart.current;
    setDrag({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
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

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-4">
        <div
          ref={wrapRef}
          className="relative max-h-full"
          style={{ aspectRatio: `${geo.outW} / ${geo.outH}`, width: '100%', maxWidth: '100%' }}
        >
          <div
            className="relative h-full w-full overflow-hidden rounded-xl border border-studio-700 bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]"
            style={{ maxHeight: '100%' }}
          >
            <video
              ref={videoRef}
              src={project.srcUrl}
              playsInline
              muted={false}
              preload="auto"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-0"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={`absolute inset-0 h-full w-full object-contain ${drawMode ? 'cursor-crosshair' : 'cursor-default'}`}
            />
            <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/80 backdrop-blur">
                {geo.outW}×{geo.outH}
              </span>
              {subtitles.enabled && subtitles.cues.length > 0 ? (
                <span className="rounded-md bg-neon/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">자막 {subtitles.cues.length}</span>
              ) : null}
              {masks.enabled && activeTracks > 0 ? (
                <span className="rounded-md bg-neon-cyan/80 px-1.5 py-0.5 text-[10px] font-semibold text-studio-900">모자이크 {activeTracks}명</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
