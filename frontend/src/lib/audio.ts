/**
 * 기기에서 고른 오디오 파일(BGM·효과음)을 서버 없이 읽는다.
 * 파일은 `URL.createObjectURL` 로 만든 blob URL 로만 다뤄져 브라우저를 벗어나지 않는다.
 */
import type { AudioLayer } from '../types';
import { uid } from './format';

const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac|weba|webm|mp4)$/i;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
}

function readDuration(el: HTMLAudioElement): number {
  const d = el.duration;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** 오디오 파일을 열어 레이어 기본값을 만든다(위치·길이는 호출한 쪽에서 맞춘다). */
export async function loadAudioFile(file: File): Promise<AudioLayer> {
  if (!isAudioFile(file)) {
    throw new Error('오디오 파일이 아닙니다. MP3 · M4A · WAV 파일을 선택해 주세요.');
  }
  const src = URL.createObjectURL(file);
  const el = document.createElement('audio');
  el.preload = 'metadata';
  el.src = src;
  try {
    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error('이 오디오 형식을 브라우저가 읽지 못했어요. MP3 · M4A · WAV 로 시도해 주세요.'));
      };
      const cleanup = () => {
        el.removeEventListener('loadedmetadata', ok);
        el.removeEventListener('error', fail);
      };
      el.addEventListener('loadedmetadata', ok);
      el.addEventListener('error', fail);
      window.setTimeout(fail, 12000);
    });
    let duration = readDuration(el);
    if (!duration) {
      // 일부 컨테이너는 metadata 시점에 길이가 없다 — durationchange 를 잠깐 기다린다.
      duration = await new Promise<number>((resolve) => {
        const done = () => {
          el.removeEventListener('durationchange', done);
          resolve(readDuration(el));
        };
        el.addEventListener('durationchange', done);
        window.setTimeout(done, 1500);
      });
    }
    if (!duration) throw new Error('오디오 길이를 읽지 못했어요. 다른 파일로 시도해 주세요.');
    return {
      id: uid('audio'),
      name: file.name.replace(/\.[^.]+$/, ''),
      src,
      duration: Math.round(duration * 100) / 100,
      start: 0,
      offset: 0,
      length: Math.round(duration * 100) / 100,
      volume: 0.8,
      muted: false,
      enabled: true,
    };
  } catch (err) {
    URL.revokeObjectURL(src);
    throw err;
  } finally {
    el.removeAttribute('src');
    try {
      el.load();
    } catch {
      /* ignore */
    }
  }
}

/** 파형 대신 쓰는 짧은 길이 표기(0:07) */
export function shortLength(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
