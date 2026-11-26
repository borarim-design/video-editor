import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Aspect, Cue, EditSpec, FontFamily, ManualMask, MaskState, PersonTrack, Preset,
  ProjectMeta, RenderResult, SubtitleState, SubtitleStyle,
} from './types';
import { DEFAULT_MASKS, DEFAULT_STYLE, ASPECTS, applyPreset, buildSpec } from './lib/presets';
import { ensureFontsLoaded, waitForFont, fontFamilyForStyle } from './lib/fonts';
import {
  downloadUrl, pollJob, resultVideoUrl, startDetectFaces, startRender, startTranscribe, uploadProject,
} from './lib/api';
import { clamp, formatTime, uid } from './lib/format';
import TopBar from './components/TopBar';
import UploadZone from './components/UploadZone';
import PreviewStage from './components/PreviewStage';
import Timeline from './components/Timeline';
import SubtitlePanel from './components/SubtitlePanel';
import MaskPanel from './components/MaskPanel';
import ExportPanel from './components/ExportPanel';

type Tab = 'subtitle' | 'mask' | 'export';

interface AsyncState {
  busy: boolean;
  progress: number;
  message: string;
}

const IDLE: AsyncState = { busy: false, progress: 0, message: '' };

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trim, setTrim] = useState({ start: 0, end: 0 });
  const [aspect, setAspect] = useState<Aspect>('original');
  const [subtitles, setSubtitles] = useState<SubtitleState>({ enabled: true, cues: [], style: DEFAULT_STYLE });
  const [masks, setMasks] = useState<MaskState>(DEFAULT_MASKS);
  const [tracks, setTracks] = useState<PersonTrack[]>([]);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [fontsTick, setFontsTick] = useState(0);
  const [tab, setTab] = useState<Tab>('subtitle');
  const [drawMode, setDrawMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [upload, setUpload] = useState<{ busy: boolean; progress: number; error: string | null }>({
    busy: false, progress: 0, error: null,
  });
  const [asr, setAsr] = useState<AsyncState>(IDLE);
  const [detect, setDetect] = useState<AsyncState>(IDLE);
  const [render, setRender] = useState<{
    busy: boolean; progress: number; message: string; result: RenderResult | null;
    jobId: string | null; error: string | null;
  }>({ busy: false, progress: 0, message: '', result: null, jobId: null, error: null });

  useEffect(() => {
    ensureFontsLoaded()
      .then((list) => {
        setFonts(list);
        setFontsTick((v) => v + 1);
      })
      .catch(() => setToast('폰트 목록을 불러오지 못했습니다. 서버 연결을 확인해 주세요.'));
  }, []);

  useEffect(() => {
    if (!fonts.length) return;
    const family = fontFamilyForStyle(subtitles.style);
    waitForFont(family).then(() => setFontsTick((v) => v + 1));
  }, [fonts.length, subtitles.style.font, subtitles.style.weight]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3200);
  }, []);

  // ---------------------------------------------------------------- 업로드
  const handleFile = useCallback(async (file: File) => {
    setUpload({ busy: true, progress: 0, error: null });
    try {
      const meta = await uploadProject(file, (p) => setUpload({ busy: true, progress: p, error: null }));
      setProject(meta);
      setTrim({ start: 0, end: meta.duration });
      setTime(0);
      setTracks([]);
      setMasks({ ...DEFAULT_MASKS, tracks: [] });
      setSubtitles({ enabled: true, cues: [], style: DEFAULT_STYLE });
      setRender({ busy: false, progress: 0, message: '', result: null, jobId: null, error: null });
      setTab('subtitle');
      setUpload({ busy: false, progress: 1, error: null });
    } catch (err) {
      setUpload({ busy: false, progress: 0, error: err instanceof Error ? err.message : '업로드 실패' });
    }
  }, []);

  const resetProject = useCallback(() => {
    setPlaying(false);
    setProject(null);
    setTracks([]);
    setSubtitles({ enabled: true, cues: [], style: DEFAULT_STYLE });
    setMasks(DEFAULT_MASKS);
    setUpload({ busy: false, progress: 0, error: null });
    setRender({ busy: false, progress: 0, message: '', result: null, jobId: null, error: null });
  }, []);

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

  const handleAutoSubtitles = useCallback(async () => {
    if (!project) return;
    setAsr({ busy: true, progress: 0, message: '음성 추출 중…' });
    try {
      const jobId = await startTranscribe(project.id, { language: 'ko', start: trim.start, end: trim.end });
      const job = await pollJob<{ cues: Cue[] }>(jobId, (j) =>
        setAsr({ busy: true, progress: j.progress, message: j.message }),
      );
      if (job.status !== 'done' || !job.result) throw new Error(job.error || '자막 생성 실패');
      const cues = job.result.cues;
      setSubtitles((s) => ({ ...s, enabled: true, cues }));
      setAsr(IDLE);
      showToast(cues.length ? `자막 ${cues.length}개를 만들었습니다.` : '인식된 음성이 없습니다.');
      setTab('subtitle');
    } catch (err) {
      setAsr(IDLE);
      showToast(err instanceof Error ? err.message : '자막 생성 실패');
    }
  }, [project, trim.start, trim.end, showToast]);

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

  // ---------------------------------------------------------------- 모자이크
  const handleDetect = useCallback(async () => {
    if (!project) return;
    setDetect({ busy: true, progress: 0, message: '프레임 분석 중…' });
    try {
      const jobId = await startDetectFaces(project.id, 6);
      const job = await pollJob<{ tracks: PersonTrack[] }>(jobId, (j) =>
        setDetect({ busy: true, progress: j.progress, message: j.message }),
      );
      if (job.status !== 'done' || !job.result) throw new Error(job.error || '얼굴 분석 실패');
      const found = job.result.tracks;
      setTracks(found);
      setMasks((m) => ({ ...m, enabled: true, tracks: found.map((t) => ({ id: t.id, enabled: true })) }));
      setDetect(IDLE);
      showToast(found.length ? `인물 ${found.length}명을 찾았습니다.` : '얼굴을 찾지 못했습니다. 직접 영역을 지정해 보세요.');
      setTab('mask');
    } catch (err) {
      setDetect(IDLE);
      showToast(err instanceof Error ? err.message : '얼굴 분석 실패');
    }
  }, [project, showToast]);

  const toggleTrack = useCallback((id: number, enabled: boolean) => {
    setMasks((m) => {
      const exists = m.tracks.some((t) => t.id === id);
      return {
        ...m,
        tracks: exists ? m.tracks.map((t) => (t.id === id ? { ...t, enabled } : t)) : [...m.tracks, { id, enabled }],
      };
    });
  }, []);

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

  // ---------------------------------------------------------------- 내보내기
  const handleRender = useCallback(async () => {
    if (!project) return;
    setRender({ busy: true, progress: 0, message: '준비 중…', result: null, jobId: null, error: null });
    setTab('export');
    try {
      const spec: EditSpec = buildSpec(trim, aspect, subtitles, masks);
      const jobId = await startRender(project.id, spec);
      const job = await pollJob<RenderResult>(jobId, (j) =>
        setRender((r) => ({ ...r, busy: true, progress: j.progress, message: j.message })),
      );
      if (job.status !== 'done' || !job.result) throw new Error(job.error || '렌더링 실패');
      const result = {
        ...job.result,
        downloadUrl: job.result.downloadUrl || downloadUrl(jobId),
        playUrl: job.result.playUrl || resultVideoUrl(jobId),
      };
      setRender({ busy: false, progress: 1, message: '완료', result, jobId, error: null });
      showToast('MP4가 완성되었습니다.');
    } catch (err) {
      setRender({
        busy: false, progress: 0, message: '', result: null, jobId: null,
        error: err instanceof Error ? err.message : '렌더링 실패',
      });
    }
  }, [project, trim, aspect, subtitles, masks, showToast]);

  // ---------------------------------------------------------------- 파생값
  const timelineCues = useMemo(() => subtitles.cues, [subtitles.cues]);
  const currentTimeline = Math.max(0, time - trim.start);

  if (!project) {
    return (
      <div className="grid-bg min-h-full">
        <TopBar project={null} exporting={false} onReset={resetProject} onExport={() => undefined} />
        <UploadZone onFile={handleFile} busy={upload.busy} progress={upload.progress} error={upload.error} />
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
              ['subtitle', `자막${subtitles.cues.length ? ` ${subtitles.cues.length}` : ''}`],
              ['mask', `모자이크${tracks.length ? ` ${tracks.length}` : ''}`],
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
            {tab === 'subtitle' ? (
              <SubtitlePanel
                subtitles={subtitles}
                fonts={fonts}
                hasAudio={project.hasAudio}
                currentTime={currentTimeline}
                autoBusy={asr.busy}
                autoProgress={asr.progress}
                autoMessage={asr.message}
                onStyle={patchStyle}
                onPreset={choosePreset}
                onToggle={(v) => setSubtitles((s) => ({ ...s, enabled: v }))}
                onCueChange={updateCue}
                onCueDelete={deleteCue}
                onCueAdd={addCue}
                onSeek={(t) => seekTo(trim.start + t)}
                onAuto={handleAutoSubtitles}
              />
            ) : null}
            {tab === 'mask' ? (
              <MaskPanel
                masks={masks}
                tracks={tracks}
                duration={project.duration}
                busy={detect.busy}
                progress={detect.progress}
                message={detect.message}
                drawMode={drawMode}
                onToggleEnabled={(v) => setMasks((m) => ({ ...m, enabled: v }))}
                onMode={(mode) => setMasks((m) => ({ ...m, mode }))}
                onShape={(shape) => setMasks((m) => ({ ...m, shape }))}
                onStrength={(strength) => setMasks((m) => ({ ...m, strength }))}
                onPad={(pad) => setMasks((m) => ({ ...m, pad }))}
                onToggleTrack={toggleTrack}
                onDetect={handleDetect}
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
                masks={masks}
                exporting={render.busy}
                progress={render.progress}
                message={render.message}
                result={render.result}
                jobId={render.jobId}
                error={render.error}
                onAspect={setAspect}
                onExport={handleRender}
              />
            ) : null}
          </div>
        </aside>
      </main>

      {toast ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-studio-600 bg-studio-800/95 px-4 py-2 text-xs font-medium text-studio-100 shadow-xl backdrop-blur">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
