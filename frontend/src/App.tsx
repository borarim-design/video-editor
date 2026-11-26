import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Aspect, Cue, EditSpec, ExportResult, FontFamily, HookPreset, HookTitle, ManualMask, MaskState,
  PersonTrack, Preset, ProjectMeta, SubtitleState, SubtitleStyle,
} from './types';
import { DEFAULT_HOOK, DEFAULT_MASKS, DEFAULT_STYLE, ASPECTS, HOOK_PRESETS, applyHookPreset, applyPreset, buildSpec } from './lib/presets';
import { ensureFontsLoaded, waitForFont, fontFamilyForStyle } from './lib/fonts';
import { loadLocalVideo } from './lib/local-media';
import { ExportCanceledError, exportVideo } from './lib/exporter';
import { clamp, formatTime, uid } from './lib/format';
import TopBar from './components/TopBar';
import UploadZone from './components/UploadZone';
import PreviewStage from './components/PreviewStage';
import Timeline from './components/Timeline';
import SubtitlePanel from './components/SubtitlePanel';
import MaskPanel from './components/MaskPanel';
import ExportPanel from './components/ExportPanel';
import HookPanel from './components/HookPanel';

type Tab = 'title' | 'subtitle' | 'mask' | 'export';

interface ExportState {
  busy: boolean;
  progress: number;
  message: string;
  result: ExportResult | null;
  error: string | null;
}

const IDLE_EXPORT: ExportState = { busy: false, progress: 0, message: '', result: null, error: null };

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const exportVideoRef = useRef<HTMLVideoElement | null>(null);
  const projectUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trim, setTrim] = useState({ start: 0, end: 0 });
  const [aspect, setAspect] = useState<Aspect>('original');
  const [subtitles, setSubtitles] = useState<SubtitleState>({ enabled: true, cues: [], style: DEFAULT_STYLE });
  const [hook, setHook] = useState<HookTitle>(DEFAULT_HOOK);
  const [masks, setMasks] = useState<MaskState>(DEFAULT_MASKS);
  const [tracks, setTracks] = useState<PersonTrack[]>([]);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [fontsTick, setFontsTick] = useState(0);
  const [tab, setTab] = useState<Tab>('subtitle');
  const [drawMode, setDrawMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [render, setRender] = useState<ExportState>(IDLE_EXPORT);

  useEffect(() => {
    ensureFontsLoaded()
      .then((list) => {
        setFonts(list);
        setFontsTick((v) => v + 1);
      })
      .catch(() => setToast('내장 폰트를 불러오지 못했습니다. 페이지를 새로 고침해 주세요.'));
  }, []);

  useEffect(() => {
    if (!fonts.length) return;
    const family = fontFamilyForStyle(subtitles.style);
    waitForFont(family).then(() => setFontsTick((v) => v + 1));
  }, [fonts.length, subtitles.style.font, subtitles.style.weight]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3600);
  }, []);

  const releaseResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
  }, []);

  const replaceProject = useCallback((meta: ProjectMeta | null) => {
    if (projectUrlRef.current && projectUrlRef.current !== meta?.srcUrl) {
      URL.revokeObjectURL(projectUrlRef.current);
    }
    projectUrlRef.current = meta?.srcUrl ?? null;
    setProject(meta);
  }, []);

  // ---------------------------------------------------------------- 파일 열기(서버 없이)
  const handleFile = useCallback(async (file: File) => {
    setUpload({ busy: true, error: null });
    try {
      const meta = await loadLocalVideo(file);
      releaseResult();
      replaceProject(meta);
      setTrim({ start: 0, end: meta.duration });
      setTime(0);
      setTracks([]);
      setMasks({ ...DEFAULT_MASKS, tracks: [] });
      setSubtitles({ enabled: true, cues: [], style: DEFAULT_STYLE });
      setHook(DEFAULT_HOOK);
      setRender(IDLE_EXPORT);
      setTab('subtitle');
      setUpload({ busy: false, error: null });
    } catch (err) {
      setUpload({ busy: false, error: err instanceof Error ? err.message : '영상을 열지 못했습니다.' });
    }
  }, [releaseResult, replaceProject]);

  const resetProject = useCallback(() => {
    setPlaying(false);
    releaseResult();
    replaceProject(null);
    setTracks([]);
    setSubtitles({ enabled: true, cues: [], style: DEFAULT_STYLE });
    setHook(DEFAULT_HOOK);
    setMasks(DEFAULT_MASKS);
    setUpload({ busy: false, error: null });
    setRender(IDLE_EXPORT);
  }, [releaseResult, replaceProject]);

  // ---------------------------------------------------------------- 재생
  const seekTo = useCallback((t: number) => {
    const video = videoRef.current;
    if (!project) return;
    const target = clamp(t, 0, project.duration);
    setTime(target);
    if (video) {
      try {
        video.currentTime = target;
      } catch {
        /* ignore */
      }
    }
  }, [project]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => showToast('재생할 수 없습니다.'));
    } else {
      video.pause();
    }
  }, [showToast]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setTime(video.currentTime);
      if (trim.end > trim.start && video.currentTime >= trim.end - 0.02) {
        video.currentTime = trim.start;
      }
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
    };
  }, [project?.id, trim.start, trim.end]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!project) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === 'ArrowLeft') seekTo(time - 1 / (project.fps || 30));
      if (e.code === 'ArrowRight') seekTo(time + 1 / (project.fps || 30));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, togglePlay, seekTo, time]);

  // ---------------------------------------------------------------- 자막
  const patchStyle = useCallback((patch: Partial<SubtitleStyle>) => {
    setSubtitles((s) => ({ ...s, style: { ...s.style, ...patch } }));
  }, []);

  const choosePreset = useCallback((preset: Preset) => {
    setSubtitles((s) => ({ ...s, style: applyPreset(s.style, preset) }));
  }, []);

  const chooseHookPreset = useCallback((preset: HookPreset) => {
    setHook((h) => {
      const next = applyHookPreset({ ...h, enabled: true }, preset);
      const def = HOOK_PRESETS.find((p) => p.id === preset);
      const fill: Partial<HookTitle> = { enabled: true };
      if (def && !h.title.trim()) fill.title = def.sampleTitle;
      if (def && !h.subtext.trim()) fill.subtext = def.sampleSub;
      return { ...next, ...fill };
    });
  }, []);

  const updateCue = useCallback((id: string, patch: Partial<Cue>) => {
    setSubtitles((s) => ({
      ...s,
      cues: s.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }, []);

  const deleteCue = useCallback((id: string) => {
    setSubtitles((s) => ({ ...s, cues: s.cues.filter((c) => c.id !== id) }));
  }, []);

  const addCue = useCallback(() => {
    const start = clamp(time - trim.start, 0, Math.max(0, trim.end - trim.start - 0.5));
    const cue: Cue = {
      id: uid('cue'),
      start: Number(start.toFixed(2)),
      end: Number(Math.min(trim.end - trim.start, start + 2).toFixed(2)),
      text: '새 자막',
      words: [],
    };
    setSubtitles((s) => ({ ...s, enabled: true, cues: [...s.cues, cue].sort((a, b) => a.start - b.start) }));
  }, [time, trim]);

  // ---------------------------------------------------------------- 모자이크(수동)
  const addManualMask = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    if (!project) return;
    const mask: ManualMask = {
      id: uid('mask'),
      ...rect,
      start: 0,
      end: Math.round(project.duration * 10) / 10,
    };
    setMasks((m) => ({ ...m, enabled: true, manual: [...m.manual, mask] }));
    showToast('영역을 추가했습니다. 구간을 조정해 보세요.');
  }, [project, showToast]);

  // ---------------------------------------------------------------- 내보내기(브라우저 단독)
  const handleCancelExport = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  const handleRender = useCallback(async () => {
    if (!project) return;
    const video = exportVideoRef.current;
    if (!video) {
      showToast('영상을 준비하지 못했습니다. 페이지를 새로 고침해 주세요.');
      return;
    }
    if (render.busy) return;

    releaseResult();
    setTab('export');
    setRender({ busy: true, progress: 0, message: '준비 중…', result: null, error: null });

    try {
      const spec: EditSpec = buildSpec(trim, aspect, subtitles, masks, hook);
      const result = await exportVideo({
        video,
        projectWidth: project.width,
        projectHeight: project.height,
        spec,
        tracks,
        trim,
        hasAudio: project.hasAudio,
        fps: project.fps || 30,
        fileBaseName: project.filename,
        onProgress: (ratio, message) => setRender((r) => ({ ...r, busy: true, progress: ratio, message })),
        onCancelReady: (cancel) => {
          cancelRef.current = cancel;
        },
      });
      cancelRef.current = null;
      resultUrlRef.current = result.url;
      setRender({ busy: false, progress: 1, message: '완료', result, error: null });
      showToast(result.extension === 'mp4' ? 'MP4가 완성되었습니다. 아래에서 내려받으세요.' : 'WebM이 완성되었습니다. 아래에서 내려받으세요.');
    } catch (err) {
      cancelRef.current = null;
      if (err instanceof ExportCanceledError) {
        setRender(IDLE_EXPORT);
        showToast('내보내기를 취소했습니다.');
        return;
      }
      setRender({
        busy: false, progress: 0, message: '', result: null,
        error: err instanceof Error ? err.message : '영상을 만들지 못했습니다.',
      });
    }
  }, [project, trim, aspect, subtitles, masks, hook, tracks, releaseResult, showToast, render.busy]);

  // ---------------------------------------------------------------- 파생값
  const timelineCues = useMemo(() => subtitles.cues, [subtitles.cues]);
  const currentTimeline = Math.max(0, time - trim.start);

  if (!project) {
    return (
      <div className="grid-bg min-h-full">
        <TopBar project={null} exporting={false} onReset={resetProject} onExport={() => undefined} />
        <UploadZone onFile={handleFile} busy={upload.busy} error={upload.error} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-studio-900">
      <TopBar project={project} exporting={render.busy} onReset={resetProject} onExport={handleRender} />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 overflow-x-auto border-b border-studio-700/50 px-3 py-2 sm:px-4">
            <span className="label shrink-0">비율</span>
            <div className="flex gap-1.5">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAspect(a.id)}
                  className={`chip shrink-0 ${aspect === a.id ? 'chip-active' : ''}`}
                  title={a.hint}
                >
                  {a.name}
                </button>
              ))}
            </div>
            <span className="ml-auto hidden shrink-0 text-[10px] text-studio-500 sm:block">
              {formatTime(currentTimeline, false)} / {formatTime(Math.max(0, trim.end - trim.start), false)} 편집본
            </span>
          </div>

          <div className="min-h-[42vh] flex-1">
            <PreviewStage
              project={project}
              videoRef={videoRef}
              time={time}
              trim={trim}
              aspect={aspect}
              subtitles={{ ...subtitles, cues: timelineCues }}
              hook={hook}
              masks={masks}
              tracks={tracks}
              fontsTick={fontsTick}
              drawMode={drawMode}
              onAddManual={addManualMask}
              onDrawModeChange={setDrawMode}
            />
          </div>

          <div className="shrink-0 space-y-2 px-3 pb-3 sm:px-4">
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost !px-3 !py-1.5" onClick={() => seekTo(time - 1 / (project.fps || 30))} aria-label="이전 프레임">
                ⏮
              </button>
              <button type="button" className="btn-primary !px-4 !py-1.5" onClick={togglePlay}>
                {playing ? '⏸ 일시정지' : '▶︎ 재생'}
              </button>
              <button type="button" className="btn-ghost !px-3 !py-1.5" onClick={() => seekTo(time + 1 / (project.fps || 30))} aria-label="다음 프레임">
                ⏭
              </button>
              <span className="font-mono text-[11px] tabular-nums text-studio-400">
                {formatTime(time)} / {formatTime(project.duration)}
              </span>
              <span className="ml-auto text-[10px] text-studio-500">Space 재생 · ←/→ 프레임</span>
            </div>
            <Timeline
              duration={project.duration}
              trim={trim}
              time={time}
              onChangeTrim={(t) => {
                setTrim(t);
                if (time < t.start || time > t.end) seekTo(t.start);
              }}
              onSeek={seekTo}
            />
          </div>
        </section>

        <aside className="flex min-h-0 w-full max-h-[55vh] flex-col border-t border-studio-700/70 bg-studio-900/60 lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
          <div className="flex shrink-0 gap-1 border-b border-studio-700/70 px-2 py-2">
            {([
              ['title', '후킹 타이틀'],
              ['subtitle', `자막${subtitles.cues.length ? ` ${subtitles.cues.length}` : ''}`],
              ['mask', `모자이크${masks.manual.length ? ` ${masks.manual.length}` : ''}`],
              ['export', '내보내기'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                  tab === key ? 'bg-neon/15 text-white shadow-glow' : 'text-studio-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {tab === 'title' ? (
              <HookPanel
                hook={hook}
                fonts={fonts}
                duration={project.duration}
                onPatch={(patch) => setHook((h) => ({ ...h, ...patch }))}
                onPreset={chooseHookPreset}
                onSpeedLines={(patch) => setHook((h) => ({ ...h, speedLines: { ...h.speedLines, ...patch } }))}
                onSeek={seekTo}
              />
            ) : null}
            {tab === 'subtitle' ? (
              <SubtitlePanel
                subtitles={subtitles}
                fonts={fonts}
                currentTime={currentTimeline}
                onStyle={patchStyle}
                onPreset={choosePreset}
                onToggle={(v) => setSubtitles((s) => ({ ...s, enabled: v }))}
                onCueChange={updateCue}
                onCueDelete={deleteCue}
                onCueAdd={addCue}
                onSeek={(t) => seekTo(trim.start + t)}
              />
            ) : null}
            {tab === 'mask' ? (
              <MaskPanel
                masks={masks}
                duration={project.duration}
                drawMode={drawMode}
                onToggleEnabled={(v) => setMasks((m) => ({ ...m, enabled: v }))}
                onMode={(mode) => setMasks((m) => ({ ...m, mode }))}
                onShape={(shape) => setMasks((m) => ({ ...m, shape }))}
                onStrength={(strength) => setMasks((m) => ({ ...m, strength }))}
                onPad={(pad) => setMasks((m) => ({ ...m, pad }))}
                onStartDraw={() => {
                  setDrawMode((v) => !v);
                  if (!drawMode) showToast('미리보기에서 가릴 영역을 드래그하세요.');
                }}
                onDeleteManual={(id) => setMasks((m) => ({ ...m, manual: m.manual.filter((x) => x.id !== id) }))}
                onUpdateManual={(id, patch) =>
                  setMasks((m) => ({ ...m, manual: m.manual.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
                }
                onSeek={seekTo}
              />
            ) : null}
            {tab === 'export' ? (
              <ExportPanel
                project={project}
                trim={trim}
                aspect={aspect}
                subtitles={subtitles}
                hook={hook}
                masks={masks}
                exporting={render.busy}
                progress={render.progress}
                message={render.message}
                result={render.result}
                error={render.error}
                onAspect={setAspect}
                onExport={handleRender}
                onCancel={handleCancelExport}
              />
            ) : null}
          </div>
        </aside>
      </main>

      {/* 내보내기 전용 원본 영상(화면에 보이지 않음). 미리보기 요소와 분리해 오디오 라우팅이 겹치지 않게 한다. */}
      <video
        ref={exportVideoRef}
        src={project.srcUrl}
        preload="auto"
        playsInline
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none"
        style={{ position: 'fixed', left: -9999, top: 0, width: 2, height: 2, opacity: 0.01 }}
      />

      {toast ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-studio-600 bg-studio-800/95 px-4 py-2 text-xs font-medium text-studio-100 shadow-xl backdrop-blur">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
