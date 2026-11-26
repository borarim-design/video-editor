import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Aspect, AudioLayer, Cue, DateCardOverlay, EditSpec, ExportResult, FontFamily, HookPreset, HookTitle, ImageSticker,
  ManualMask, MaskState, OverlayState, PersonTrack, PlaceCardOverlay, Preset, SubtitleState,
  SubtitleStyle, VideoClip, ViewfinderOverlay,
} from './types';
import {
  DEFAULT_HOOK, DEFAULT_MASKS, DEFAULT_OVERLAYS, DEFAULT_STYLE, ASPECTS, HOOK_PRESETS,
  applyHookPreset, applyPreset, buildSpec, hookDecorOf, newSticker,
} from './lib/presets';
import { ensureFontsLoaded, waitForFont, fontFamilyForStyle } from './lib/fonts';
import { loadVideoClip } from './lib/local-media';
import { clipLength, clipStartTime, locateClip, projectFromClips, totalDuration } from './lib/clips';
import { loadAudioFile } from './lib/audio';
import { ExportCanceledError, exportVideo } from './lib/exporter';
import { clamp, formatTime, uid } from './lib/format';
import { forgetStickerImage, preloadStickerImages } from './lib/stickers';
import TopBar from './components/TopBar';
import UploadZone from './components/UploadZone';
import PreviewStage from './components/PreviewStage';
import TimelineTracks from './components/TimelineTracks';
import SubtitlePanel from './components/SubtitlePanel';
import MaskPanel from './components/MaskPanel';
import ExportPanel from './components/ExportPanel';
import HookPanel from './components/HookPanel';
import OverlayPanel from './components/OverlayPanel';
import AudioPanel from './components/AudioPanel';

type Tab = 'title' | 'subtitle' | 'overlay' | 'mask' | 'audio' | 'export';

interface ExportState {
  busy: boolean;
  progress: number;
  message: string;
  result: ExportResult | null;
  error: string | null;
}

const IDLE_EXPORT: ExportState = { busy: false, progress: 0, message: '', result: null, error: null };

export default function App() {
  /** 클립 id → 미리보기 <video> 요소(클립마다 하나, 지금 클립만 재생) */
  const videoEls = useRef<Map<string, HTMLVideoElement>>(new Map());
  const resultUrlRef = useRef<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const [clips, setClips] = useState<VideoClip[]>([]);
  const clipsRef = useRef<VideoClip[]>([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const activeClipRef = useRef(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const playingRef = useRef(false);

  // 클립 목록에서 프로젝트 메타(해상도·합산 길이·이름)를 만든다.
  const project = useMemo(() => projectFromClips(clips), [clips]);
  // 편집본 시간축은 0초(첫 클립 시작)부터 클립 합산 길이까지.
  const trim = useMemo(() => ({ start: 0, end: project?.duration ?? 0 }), [project]);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [aspect, setAspect] = useState<Aspect>('original');
  const [subtitles, setSubtitles] = useState<SubtitleState>({ enabled: true, cues: [], style: DEFAULT_STYLE });
  const [hook, setHook] = useState<HookTitle>(DEFAULT_HOOK);
  const [masks, setMasks] = useState<MaskState>(DEFAULT_MASKS);
  const [stickers, setStickers] = useState<ImageSticker[]>([]);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlayState>(DEFAULT_OVERLAYS);
  const [tracks, setTracks] = useState<PersonTrack[]>([]);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [fontsTick, setFontsTick] = useState(0);
  const [tab, setTab] = useState<Tab>('subtitle');
  const [drawMode, setDrawMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // iOS Safari 가 오디오 재생을 막아 음소거로 재생 중인 상태
  const [audioBlocked, setAudioBlocked] = useState(false);
  // 오디오 레이어(BGM·효과음) · 원본 영상 볼륨
  const [audioLayers, setAudioLayers] = useState<AudioLayer[]>([]);
  const [videoVolume, setVideoVolume] = useState(1);
  const [videoMuted, setVideoMuted] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioLayersRef = useRef<AudioLayer[]>([]);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    audioLayersRef.current = audioLayers;
  }, [audioLayers]);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

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

  const stickerUrlsRef = useRef<string[]>([]);

  const clearStickers = useCallback(() => {
    stickerUrlsRef.current.forEach((url) => {
      forgetStickerImage(url);
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    stickerUrlsRef.current = [];
    setStickers([]);
    setSelectedStickerId(null);
  }, []);

  useEffect(() => () => {
    stickerUrlsRef.current.forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
  }, []);

  const pauseEveryClip = useCallback(() => {
    videoEls.current.forEach((el) => {
      if (!el.paused) el.pause();
    });
  }, []);

  /** 새 프로젝트를 열 때 편집 상태를 초기화한다(클립은 호출한 쪽에서 넣는다). */
  const resetEditState = useCallback(() => {
    setTime(0);
    activeClipRef.current = 0;
    setActiveClipIndex(0);
    setTracks([]);
    setMasks({ ...DEFAULT_MASKS, tracks: [] });
    clearStickers();
    setOverlays(DEFAULT_OVERLAYS);
    setSubtitles({ enabled: true, cues: [], style: DEFAULT_STYLE });
    setHook(DEFAULT_HOOK);
    setRender(IDLE_EXPORT);
    setAudioBlocked(false);
    setAudioLayers((cur) => {
      cur.forEach((l) => URL.revokeObjectURL(l.src));
      return [];
    });
    setVideoVolume(1);
    setVideoMuted(false);
    setSelectedCueId(null);
    setSelectedAudioId(null);
    setDrawMode(false);
  }, [clearStickers]);

  // ---------------------------------------------------------------- 파일 열기(서버 없이 · 여러 개)
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUpload({ busy: true, error: null });
      const first = clipsRef.current.length === 0;
      try {
        const loaded: VideoClip[] = [];
        for (const file of files) {
          // eslint-disable-next-line no-await-in-loop
          loaded.push(await loadVideoClip(file));
        }
        if (!loaded.length) throw new Error('영상 파일이 없습니다.');
        releaseResult();
        pauseEveryClip();
        if (first) resetEditState();
        const next = [...clipsRef.current, ...loaded];
        clipsRef.current = next;
        setClips(next);
        if (first) {
          activeClipRef.current = 0;
          setActiveClipIndex(0);
          setTime(0);
          setTab('subtitle');
        }
        setSelectedClipId((cur) => cur ?? loaded[0].id);
        setUpload({ busy: false, error: null });
        if (!first) showToast(`${loaded.length}개 영상을 뒤에 이어 붙였어요.`);
      } catch (err) {
        setUpload({ busy: false, error: err instanceof Error ? err.message : '영상을 열지 못했습니다.' });
      }
    },
    [releaseResult, pauseEveryClip, resetEditState, showToast],
  );

  const resetProject = useCallback(() => {
    setPlaying(false);
    playingRef.current = false;
    pauseEveryClip();
    releaseResult();
    const old = clipsRef.current;
    clipsRef.current = [];
    setClips([]);
    videoEls.current.clear();
    old.forEach((c) => URL.revokeObjectURL(c.url));
    setSelectedClipId(null);
    resetEditState();
    setUpload({ busy: false, error: null });
  }, [pauseEveryClip, releaseResult, resetEditState]);

  /** 지금 편집본 시간(활성 클립의 실제 재생 위치 기준) */
  const currentGlobalTime = useCallback(() => {
    const list = clipsRef.current;
    const idx = activeClipRef.current;
    const clip = list[idx];
    if (!clip) return 0;
    const el = videoEls.current.get(clip.id);
    const local = el ? Math.max(0, Math.min(clipLength(clip), el.currentTime - clip.trimStart)) : 0;
    return clipStartTime(list, idx) + local;
  }, []);

  // ---------------------------------------------------------------- 오디오 레이어(BGM·효과음)
  /** 편집본 시간(clipTime)에 맞춰 오디오 레이어를 재생·정지·보정한다. */
  const syncAudioPreview = useCallback((clipTime: number, playingNow: boolean, forceSeek = false) => {
    const els = audioElsRef.current;
    for (const layer of audioLayersRef.current) {
      const el = els.get(layer.id);
      if (!el) continue;
      const rel = clipTime - layer.start;
      const active = layer.enabled && rel >= -0.08 && rel < layer.length - 0.03;
      const wantVolume = layer.muted ? 0 : clamp(layer.volume, 0, 1);
      if (Math.abs(el.volume - wantVolume) > 0.01) el.volume = wantVolume;
      const wantTime = layer.offset + Math.max(0, rel);
      if (!active || !playingNow) {
        if (!el.paused) el.pause();
        if (active && Math.abs(el.currentTime - wantTime) > 0.15) {
          try {
            el.currentTime = wantTime;
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      // 출발·재개 시에는 정확한 위치로 맞춘 뒤 재생한다(처음 어긋나면 계속 어긋난다).
      if (el.paused || forceSeek || Math.abs(el.currentTime - wantTime) > 0.2) {
        try {
          el.currentTime = wantTime;
        } catch {
          /* ignore */
        }
      }
      if (el.paused) void el.play().catch(() => undefined);
    }
  }, []);

  // 레이어 목록이 바뀌면 재생용 <audio> 요소를 만들고/지운다(화면에는 그리지 않는다).
  useEffect(() => {
    const els = audioElsRef.current;
    const alive = new Set(audioLayers.map((l) => l.id));
    els.forEach((el, id) => {
      if (alive.has(id)) return;
      el.pause();
      el.removeAttribute('src');
      try {
        el.load();
      } catch {
        /* ignore */
      }
      el.remove();
      els.delete(id);
    });
    audioLayers.forEach((layer) => {
      if (els.has(layer.id)) return;
      const el = new Audio();
      el.preload = 'auto';
      el.src = layer.src;
      // 문서에 붙여 둔다(분리된 미디어 요소는 iOS Safari 에서 재생 중 GC 될 수 있다). 화면에는 보이지 않는다.
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      el.dataset.audioLayer = layer.id;
      document.body.appendChild(el);
      els.set(layer.id, el);
    });
    syncAudioPreview(currentGlobalTime(), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioLayers, syncAudioPreview]);

  const pauseAllAudio = useCallback(() => {
    audioElsRef.current.forEach((el) => {
      if (!el.paused) el.pause();
    });
  }, []);

  useEffect(
    () => () => {
      audioElsRef.current.forEach((el) => {
        el.pause();
        el.removeAttribute('src');
        el.remove();
      });
      audioElsRef.current.clear();
    },
    [],
  );

  // 원본 영상 볼륨(모든 클립 요소에 같은 값)
  useEffect(() => {
    videoEls.current.forEach((el) => {
      el.volume = clamp(videoMuted ? 0 : videoVolume, 0, 1);
    });
  }, [videoVolume, videoMuted, clips]);

  // ---------------------------------------------------------------- 재생(클립을 이어서)
  /** 클립 경계를 넘어갈 때 그 클립의 트림 시작으로 옮기고(필요하면) 이어서 재생한다. */
  const playClipAt = useCallback(
    (index: number, autoplay: boolean) => {
      const list = clipsRef.current;
      const clip = list[index];
      if (!clip) return;
      const prev = list[activeClipRef.current];
      if (prev && prev.id !== clip.id) {
        const prevEl = videoEls.current.get(prev.id);
        if (prevEl && !prevEl.paused) prevEl.pause();
      }
      activeClipRef.current = index;
      setActiveClipIndex(index);
      const el = videoEls.current.get(clip.id);
      if (el) {
        try {
          if (Math.abs(el.currentTime - clip.trimStart) > 0.02) el.currentTime = clip.trimStart;
        } catch {
          /* ignore */
        }
        el.volume = clamp(videoMuted ? 0 : videoVolume, 0, 1);
        if (autoplay) {
          el.play().catch(() => {
            // iOS 자동재생/오디오 정책 → 음소거로 한 번 더 시도한다.
            el.muted = true;
            setAudioBlocked(true);
            void el.play().catch(() => undefined);
          });
        }
      }
      const at = clipStartTime(list, index);
      setTime(at);
      syncAudioPreview(at, autoplay, true);
    },
    [syncAudioPreview, videoMuted, videoVolume],
  );

  const seekTo = useCallback(
    (t: number) => {
      const list = clipsRef.current;
      if (!list.length) return;
      const target = clamp(t, 0, Math.max(0, totalDuration(list)));
      const loc = locateClip(list, target);
      const clip = list[loc.index];
      if (!clip) return;
      videoEls.current.forEach((el, id) => {
        if (id !== clip.id && !el.paused) el.pause();
      });
      if (activeClipRef.current !== loc.index) {
        activeClipRef.current = loc.index;
        setActiveClipIndex(loc.index);
      }
      const el = videoEls.current.get(clip.id);
      if (el) {
        try {
          el.currentTime = clamp(loc.source, 0, clip.duration || loc.source);
        } catch {
          /* ignore */
        }
      }
      setTime(target);
      syncAudioPreview(target, false);
    },
    [syncAudioPreview],
  );

  /**
   * 재생 시작 — iOS Safari 는 play() 가 사용자 제스처 콜스택 안에서 동기로 불려야 하고,
   * 오디오가 막히면(NotAllowedError) 음소거로 재시도해야 재생이 된다.
   * 그래서 이 함수 안에서는 await·setTimeout·상태 업데이트를 거치지 않고 즉시 play() 를 부른다.
   */
  const startPlayback = useCallback(() => {
    const list = clipsRef.current;
    const clip = list[activeClipRef.current];
    const el = clip ? videoEls.current.get(clip.id) ?? null : null;
    if (!clip || !el) return;
    // 끝에 붙어 있으면 다음 클립(마지막이면 처음)으로 되감고 재생한다.
    if (el.ended || el.currentTime >= clip.trimEnd - 0.05) {
      if (activeClipRef.current + 1 < list.length) {
        playClipAt(activeClipRef.current + 1, true);
        return;
      }
      playClipAt(0, true);
      return;
    }
    const attempt = el.play();
    // 같은 제스처 안에서 오디오 레이어도 함께 출발시킨다.
    syncAudioPreview(currentGlobalTime(), true);
    if (!attempt || typeof attempt.then !== 'function') return;
    attempt.then(
      () => {
        if (el.muted) setAudioBlocked(true);
      },
      (err: unknown) => {
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotSupportedError') {
          showToast('브라우저가 이 영상 코덱을 재생하지 못합니다. MP4(H.264)로 변환해 주세요.');
          return;
        }
        // iOS 자동재생/오디오 정책 → 음소거로 한 번 더 시도한다(음소거 재생은 허용된다).
        el.muted = true;
        setAudioBlocked(true);
        const retry = el.play();
        if (retry && typeof retry.catch === 'function') {
          retry.catch(() => showToast('영상을 재생하지 못했어요. 재생 버튼을 한 번 더 눌러 주세요.'));
        }
      },
    );
  }, [playClipAt, showToast, syncAudioPreview, currentGlobalTime]);

  const togglePlay = useCallback(() => {
    const list = clipsRef.current;
    const clip = list[activeClipRef.current];
    const el = clip ? videoEls.current.get(clip.id) ?? null : null;
    if (!el) return;
    if (!el.paused && !el.ended) el.pause();
    else startPlayback();
  }, [startPlayback]);

  const unmutePlayback = useCallback(() => {
    videoEls.current.forEach((el) => {
      el.muted = false;
    });
    setAudioBlocked(false);
  }, []);

  // 재생 중에는 requestAnimationFrame 으로 영상 시간을 따라가며 UI 시간을 갱신하고,
  // 클립 끝에 닿으면 다음 클립으로 넘어가 이어서 재생한다.
  useEffect(() => {
    let raf = 0;
    let lastUi = 0;
    const follow = (now: number) => {
      raf = window.requestAnimationFrame(follow);
      const list = clipsRef.current;
      const idx = activeClipRef.current;
      const clip = list[idx];
      if (!clip) return;
      const el = videoEls.current.get(clip.id);
      if (!el) return;
      const acting = !el.paused && !el.ended;
      if (!acting) {
        if (playingRef.current) {
          playingRef.current = false;
          setPlaying(false);
          syncAudioPreview(currentGlobalTime(), false);
        }
        return;
      }
      if (!playingRef.current) {
        playingRef.current = true;
        setPlaying(true);
      }
      if (el.currentTime >= clip.trimEnd - 0.02 || el.ended) {
        // 이 클립 끝 → 다음 클립, 마지막이면 처음으로 돌아가 계속 재생
        if (idx + 1 < list.length) playClipAt(idx + 1, true);
        else playClipAt(0, true);
        return;
      }
      if (now - lastUi >= 100) {
        lastUi = now;
        const t = clipStartTime(list, idx) + Math.max(0, el.currentTime - clip.trimStart);
        setTime(t);
        syncAudioPreview(t, true);
      }
    };
    raf = window.requestAnimationFrame(follow);
    return () => window.cancelAnimationFrame(raf);
  }, [currentGlobalTime, playClipAt, syncAudioPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!clipsRef.current.length) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === 'ArrowLeft') seekTo(time - 1 / 30);
      if (e.code === 'ArrowRight') seekTo(time + 1 / 30);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekTo, time]);

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

  const addCue = useCallback((): string => {
    const total = trim.end > trim.start ? trim.end : time;
    const start = clamp(time, 0, Math.max(0, total - 0.5));
    const cue: Cue = {
      id: uid('cue'),
      start: Number(start.toFixed(2)),
      end: Number(Math.min(total, start + 2).toFixed(2)),
      text: '새 자막',
      words: [],
    };
    setSubtitles((s) => ({ ...s, enabled: true, cues: [...s.cues, cue].sort((a, b) => a.start - b.start) }));
    return cue.id;
  }, [time, trim.end, trim.start]);

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

  /** 퀵 버튼 `+ 모자이크` — 지금 시점에 기본 영역을 만들고 모자이크 탭을 연다. */
  const addMosaicQuick = useCallback(() => {
    if (!project) return;
    const total = project.duration;
    // 지금 시점을 포함하도록 0.1초 단위로 내림(올림하면 방금 만든 영역이 아직 구간 밖이 된다).
    const start = Math.max(0, Math.min(Math.floor(time * 10) / 10, Math.max(0, total - 0.3)));
    const end = Math.min(total, start + 3);
    const mask: ManualMask = {
      id: uid('mask'),
      x: 0.32,
      y: 0.3,
      w: 0.36,
      h: 0.36,
      start: Number(start.toFixed(2)),
      end: Number(Math.max(start + 0.3, end).toFixed(2)),
    };
    setMasks((m) => ({ ...m, enabled: true, manual: [...m.manual, mask] }));
    setDrawMode(false);
    setTab('mask');
    showToast('모자이크 영역을 지금 시점에 추가했어요. 미리보기에서 드래그하면 새 영역을 그릴 수 있어요.');
  }, [project, showToast, time]);

  // ---------------------------------------------------------------- 클립 순서·트림·삭제
  const moveClip = useCallback((id: string, dir: -1 | 1) => {
    const list = clipsRef.current.slice();
    const i = list.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    pauseEveryClip();
    pauseAllAudio();
    clipsRef.current = list;
    setClips(list);
    activeClipRef.current = j;
    setActiveClipIndex(j);
    const clip = list[j];
    const el = videoEls.current.get(clip.id);
    if (el) {
      try {
        el.currentTime = clip.trimStart;
      } catch {
        /* ignore */
      }
    }
    setTime(clipStartTime(list, j));
    showToast(`${j + 1}번째 클립으로 옮겼어요.`);
  }, [pauseEveryClip, pauseAllAudio, showToast]);

  const trimClip = useCallback((id: string, patch: { trimStart?: number; trimEnd?: number }) => {
    const list = clipsRef.current.map((c) => {
      if (c.id !== id) return c;
      const trimStart = clamp(patch.trimStart ?? c.trimStart, 0, Math.max(0, c.duration - 0.2));
      const trimEnd = clamp(patch.trimEnd ?? c.trimEnd, Math.min(c.duration, trimStart + 0.2), c.duration);
      return { ...c, trimStart, trimEnd };
    });
    clipsRef.current = list;
    setClips(list);
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const clip = list[idx];
    const start = clipStartTime(list, idx);
    const end = start + clipLength(clip);
    // 잘려 나간 구간을 보고 있었다면 그 클립 시작으로 옮긴다.
    if (time < start - 0.001 || time > end + 0.001) {
      activeClipRef.current = idx;
      setActiveClipIndex(idx);
      const el = videoEls.current.get(clip.id);
      if (el) {
        try {
          el.currentTime = clip.trimStart;
        } catch {
          /* ignore */
        }
      }
      setTime(start);
    }
  }, [time]);

  const deleteClip = useCallback((id: string) => {
    const list = clipsRef.current;
    if (list.length <= 1) {
      showToast('클립이 하나뿐이라 삭제할 수 없어요. 위의 "새 영상"을 눌러 다른 영상으로 시작해 주세요.');
      return;
    }
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const removed = list[idx];
    pauseEveryClip();
    pauseAllAudio();
    const el = videoEls.current.get(id);
    if (el) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    const next = list.filter((c) => c.id !== id);
    clipsRef.current = next;
    setClips(next);
    videoEls.current.delete(id);
    URL.revokeObjectURL(removed.url);
    const keep = Math.min(idx, next.length - 1);
    const clip = next[keep];
    activeClipRef.current = keep;
    setActiveClipIndex(keep);
    const keepEl = videoEls.current.get(clip.id);
    if (keepEl) {
      try {
        keepEl.currentTime = clip.trimStart;
      } catch {
        /* ignore */
      }
    }
    setTime(clipStartTime(next, keep));
    setSelectedClipId(clip.id);
    showToast('클립을 삭제했어요.');
  }, [pauseEveryClip, pauseAllAudio, showToast]);

  // ---------------------------------------------------------------- 사진 스티커 · 위젯
  const addStickerFiles = useCallback((files: FileList | null) => {
    if (!files || !files.length) return;
    const room = 3 - stickers.length;
    if (room <= 0) {
      showToast('스티커는 3장까지 올릴 수 있어요.');
      return;
    }
    const next: ImageSticker[] = [];
    Array.from(files).slice(0, room).forEach((file, i) => {
      if (!file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      stickerUrlsRef.current.push(url);
      next.push(newSticker(uid('sticker'), file.name.replace(/\.[^.]+$/, ''), url, stickers.length + i));
    });
    if (!next.length) {
      showToast('이미지 파일만 올릴 수 있어요.');
      return;
    }
    setStickers((cur) => [...cur, ...next].slice(0, 3));
    setSelectedStickerId(next[0].id);
    setTab('overlay');
  }, [stickers.length, showToast]);

  const patchSticker = useCallback((id: string, patch: Partial<ImageSticker>) => {
    setStickers((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeSticker = useCallback((id: string) => {
    const target = stickers.find((s) => s.id === id);
    if (target) {
      forgetStickerImage(target.src);
      if (target.src.startsWith('blob:')) URL.revokeObjectURL(target.src);
      stickerUrlsRef.current = stickerUrlsRef.current.filter((u) => u !== target.src);
    }
    setStickers((cur) => cur.filter((s) => s.id !== id));
    setSelectedStickerId((cur) => (cur === id ? null : cur));
  }, [stickers]);

  const patchViewfinder = useCallback((patch: Partial<ViewfinderOverlay>) => {
    setOverlays((o) => ({ ...o, viewfinder: { ...o.viewfinder, ...patch } }));
  }, []);
  const patchDateCard = useCallback((patch: Partial<DateCardOverlay>) => {
    setOverlays((o) => ({ ...o, dateCard: { ...o.dateCard, ...patch } }));
  }, []);
  const patchPlaceCard = useCallback((patch: Partial<PlaceCardOverlay>) => {
    setOverlays((o) => ({ ...o, placeCard: { ...o.placeCard, ...patch } }));
  }, []);

  // ---------------------------------------------------------------- 오디오 레이어 파일
  const openAudioPicker = useCallback(() => {
    if (audioLayers.length >= 3) {
      showToast('오디오 레이어는 3개까지 올릴 수 있어요.');
      return;
    }
    audioInputRef.current?.click();
  }, [audioLayers.length, showToast]);

  const addAudioFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return;
      if (audioLayers.length >= 3) {
        showToast('오디오 레이어는 3개까지 올릴 수 있어요.');
        return;
      }
      const room = 3 - audioLayers.length;
      const clipLength = Math.max(0.2, trim.end - trim.start);
      for (const file of Array.from(files).slice(0, room)) {
        try {
          const layer = await loadAudioFile(file);
          const length = Math.round(Math.min(layer.duration, clipLength) * 100) / 100;
          setAudioLayers((cur) => (cur.length >= 3 ? cur : [...cur, { ...layer, start: 0, offset: 0, length }]));
          setTab('audio');
          showToast(`${layer.name} 을(를) 오디오 레이어에 올렸어요.`);
        } catch (err) {
          showToast(err instanceof Error ? err.message : '오디오 파일을 열지 못했어요.');
        }
      }
    },
    [audioLayers.length, showToast, trim.start, trim.end],
  );

  const patchAudio = useCallback((id: string, patch: Partial<AudioLayer>) => {
    setAudioLayers((cur) => cur.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const removeAudio = useCallback((id: string) => {
    setAudioLayers((cur) => {
      const target = cur.find((l) => l.id === id);
      if (target) URL.revokeObjectURL(target.src);
      return cur.filter((l) => l.id !== id);
    });
    setSelectedAudioId((cur) => (cur === id ? null : cur));
  }, []);

  // ---------------------------------------------------------------- 내보내기(브라우저 단독)
  const handleCancelExport = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  const handleRender = useCallback(async () => {
    if (!project || !clips.length) return;
    if (render.busy) return;

    // 미리보기 재생은 멈춘다(같은 소리가 이중으로 나지 않도록).
    pauseEveryClip();
    pauseAllAudio();

    releaseResult();
    setTab('export');
    setRender({ busy: true, progress: 0, message: '준비 중…', result: null, error: null });

    try {
      const spec: EditSpec = buildSpec(trim, aspect, subtitles, masks, hook, stickers, overlays);
      await preloadStickerImages(stickers);
      const result = await exportVideo({
        clips: clips.map((c) => ({
          id: c.id,
          url: c.url,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
          hasAudio: c.hasAudio,
        })),
        projectWidth: project.width,
        projectHeight: project.height,
        spec,
        tracks,
        fps: project.fps || 30,
        fileBaseName: clips[0]?.name ?? project.filename,
        audioLayers,
        videoVolume: videoMuted ? 0 : videoVolume,
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
  }, [project, clips, trim, aspect, subtitles, masks, hook, stickers, overlays, tracks, releaseResult, showToast, render.busy, audioLayers, videoVolume, videoMuted, pauseEveryClip, pauseAllAudio]);

  // ---------------------------------------------------------------- 파생값
  const timelineCues = useMemo(() => subtitles.cues, [subtitles.cues]);
  const currentTimeline = Math.max(0, time - trim.start);

  if (!project) {
    return (
      <div className="grid-bg min-h-full">
        <TopBar project={null} exporting={false} onReset={resetProject} onExport={() => undefined} />
        <UploadZone onFiles={handleFiles} busy={upload.busy} error={upload.error} />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-studio-900 lg:h-full lg:overflow-hidden">
      <TopBar project={project} exporting={render.busy} onReset={resetProject} onExport={handleRender} />

      <div className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)_auto]">
        {/* 모바일: 스크롤해도 화면 위에 붙는 미리보기 / 데스크톱: 왼쪽 위 고정 영역 */}
        <div className="sticky top-0 z-30 flex shrink-0 flex-col border-b border-studio-700/60 bg-studio-900/95 shadow-[0_12px_30px_-22px_rgba(0,0,0,1)] backdrop-blur lg:static lg:z-auto lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:border-b-0 lg:bg-transparent lg:shadow-none lg:backdrop-blur-none">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 sm:px-4 sm:py-2">
            <span className="label shrink-0">비율</span>
            <div className="flex flex-wrap gap-1">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAspect(a.id)}
                  className={`chip shrink-0 !px-2.5 !py-1 ${aspect === a.id ? 'chip-active' : ''}`}
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

          <div className="shrink-0 lg:min-h-0 lg:flex-1">
            <PreviewStage
              project={project}
              clips={clips}
              activeIndex={activeClipIndex}
              videoEls={videoEls}
              time={time}
              trim={trim}
              aspect={aspect}
              subtitles={{ ...subtitles, cues: timelineCues }}
              hook={hook}
              masks={masks}
              tracks={tracks}
              stickers={stickers}
              overlays={overlays}
              selectedStickerId={selectedStickerId}
              fontsTick={fontsTick}
              drawMode={drawMode}
              playing={playing}
              audioBlocked={audioBlocked}
              onUnmute={unmutePlayback}
              onAddManual={addManualMask}
              onDrawModeChange={setDrawMode}
              onSelectSticker={setSelectedStickerId}
              onMoveSticker={(id, patch) => patchSticker(id, patch)}
            />
          </div>

          <div className="shrink-0 px-3 pb-2 sm:px-4 sm:pb-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                className="btn-ghost min-h-[40px] !px-2.5 !py-1.5 sm:min-h-[44px] sm:!px-3"
                onClick={() => seekTo(time - 1 / (project.fps || 30))}
                aria-label="이전 프레임"
              >
                ⏮
              </button>
              <button
                type="button"
                className="btn-primary min-h-[40px] whitespace-nowrap !px-3 !py-1.5 text-xs sm:min-h-[44px] sm:!px-4 sm:text-sm"
                onClick={togglePlay}
                aria-label={playing ? '일시정지' : '재생'}
              >
                {playing ? '⏸ 일시정지' : '▶︎ 재생'}
              </button>
              <button
                type="button"
                className="btn-ghost min-h-[40px] !px-2.5 !py-1.5 sm:min-h-[44px] sm:!px-3"
                onClick={() => seekTo(time + 1 / (project.fps || 30))}
                aria-label="다음 프레임"
              >
                ⏭
              </button>
              <span className="min-w-0 truncate whitespace-nowrap font-mono text-[10px] tabular-nums text-studio-400 sm:text-[11px]">
                {formatTime(time)} / {formatTime(project.duration)}
              </span>
              <span className="ml-auto hidden text-[10px] text-studio-500 sm:block">Space 재생 · ←/→ 프레임</span>
            </div>
          </div>
        </div>

        <div className="flex-1 px-3 pb-4 pt-2 sm:px-4 lg:col-start-1 lg:row-start-2 lg:pb-3">
          <TimelineTracks
            duration={project.duration}
            trim={trim}
            time={time}
            clips={clips}
            activeIndex={activeClipIndex}
            selectedClipId={selectedClipId}
            cues={subtitles.cues}
            stickers={stickers}
            overlays={overlays}
            audioLayers={audioLayers}
            selectedCueId={selectedCueId}
            selectedStickerId={selectedStickerId}
            selectedAudioId={selectedAudioId}
            onSeek={seekTo}
            onSelectCue={(id) => {
              setSelectedCueId(id);
              setTab('subtitle');
              const cue = subtitles.cues.find((c) => c.id === id);
              if (cue) seekTo(trim.start + cue.start);
            }}
            onSelectSticker={(id) => {
              setSelectedStickerId(id);
              setTab('overlay');
            }}
            onSelectAudio={(id) => {
              setSelectedAudioId(id);
              setTab('audio');
            }}
            onAddCue={() => {
              const id = addCue();
              setSelectedCueId(id);
              setTab('subtitle');
            }}
            onAddMosaic={addMosaicQuick}
            onAddAudio={openAudioPicker}
            onAddVideo={() => videoInputRef.current?.click()}
            onSelectClip={(id) => {
              setSelectedClipId(id);
              const idx = clips.findIndex((c) => c.id === id);
              if (idx >= 0) seekTo(clipStartTime(clips, idx));
            }}
            onMoveClip={moveClip}
            onTrimClip={trimClip}
            onDeleteClip={deleteClip}
          />
        </div>

        <aside className="flex w-full flex-col border-t border-studio-700/70 bg-studio-900/60 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:border-l lg:border-t-0">
          <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-studio-700/70 px-2 py-2 sm:grid-cols-6">
            {([
              ['title', '후킹 타이틀'],
              ['subtitle', `자막${subtitles.cues.length ? ` ${subtitles.cues.length}` : ''}`],
              ['overlay', `오버레이${stickers.length ? ` ${stickers.length}` : ''}`],
              ['mask', `모자이크${masks.manual.length ? ` ${masks.manual.length}` : ''}`],
              ['audio', `오디오${audioLayers.length ? ` ${audioLayers.length}` : ''}`],
              ['export', '내보내기'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`min-h-[36px] rounded-lg px-1 py-1.5 text-[11px] font-semibold leading-tight transition ${
                  tab === key ? 'bg-neon/15 text-white shadow-glow' : 'text-studio-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="lg:min-h-0 lg:flex-1">
            {tab === 'title' ? (
              <HookPanel
                hook={hook}
                fonts={fonts}
                duration={project.duration}
                onPatch={(patch) => setHook((h) => ({ ...h, ...patch }))}
                onPreset={chooseHookPreset}
                onSpeedLines={(patch) => setHook((h) => ({ ...h, speedLines: { ...h.speedLines, ...patch } }))}
                onDecor={(patch) => setHook((h) => ({ ...h, decor: { ...hookDecorOf(h), ...patch } }))}
                onSeek={seekTo}
              />
            ) : null}
            {tab === 'subtitle' ? (
              <SubtitlePanel
                subtitles={subtitles}
                fonts={fonts}
                currentTime={currentTimeline}
                selectedCueId={selectedCueId}
                onStyle={patchStyle}
                onPreset={choosePreset}
                onToggle={(v) => setSubtitles((s) => ({ ...s, enabled: v }))}
                onCueChange={updateCue}
                onCueDelete={(id) => {
                  deleteCue(id);
                  setSelectedCueId((cur) => (cur === id ? null : cur));
                }}
                onCueAdd={addCue}
                onSelectCue={setSelectedCueId}
                onSeek={(t) => seekTo(trim.start + t)}
              />
            ) : null}
            {tab === 'audio' ? (
              <AudioPanel
                layers={audioLayers}
                videoVolume={videoVolume}
                videoMuted={videoMuted}
                clipLength={Math.max(0, trim.end - trim.start)}
                onAdd={openAudioPicker}
                onPatch={patchAudio}
                onRemove={removeAudio}
                onVideoVolume={setVideoVolume}
                onVideoMuted={setVideoMuted}
                onSeek={(t) => {
                  seekTo(trim.start + t);
                  const layer = audioLayers.find((l) => Math.abs(l.start - t) < 0.001);
                  if (layer) setSelectedAudioId(layer.id);
                }}
              />
            ) : null}
            {tab === 'overlay' ? (
              <OverlayPanel
                stickers={stickers}
                selectedId={selectedStickerId}
                overlays={overlays}
                duration={project.duration}
                currentTime={currentTimeline}
                onAddFiles={addStickerFiles}
                onSelect={setSelectedStickerId}
                onPatchSticker={patchSticker}
                onRemoveSticker={removeSticker}
                onViewfinder={patchViewfinder}
                onDateCard={patchDateCard}
                onPlaceCard={patchPlaceCard}
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
                stickers={stickers}
                overlays={overlays}
                audioCount={audioLayers.length}
                videoVolume={videoMuted ? 0 : videoVolume}
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
      </div>

      {/* 오디오 레이어 파일 선택(화면에는 보이지 않음) */}
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg"
        multiple
        className="hidden"
        onChange={(e) => {
          void addAudioFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 영상 추가(여러 개 선택 가능) — 화면에는 보이지 않음 */}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void handleFiles(files);
          e.target.value = '';
        }}
      />

      {toast ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-studio-600 bg-studio-800/95 px-4 py-2 text-xs font-medium text-studio-100 shadow-xl backdrop-blur">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
