import type { Cue, EditSpec, FontFamily, Job, ProjectMeta, RenderResult, TranscribeResult } from '../types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail)) return data.detail.map((d: { msg?: string }) => d.msg).join(', ');
  } catch {
    /* ignore */
  }
  return `${res.status} ${res.statusText}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

export function videoUrl(projectId: string): string {
  return `/api/projects/${projectId}/video`;
}

export async function listFonts(): Promise<FontFamily[]> {
  const data = await request<{ fonts: FontFamily[] }>('/api/fonts');
  return data.fonts;
}

export function uploadProject(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<ProjectMeta> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data.project as ProjectMeta);
        } catch (err) {
          reject(new Error('업로드 응답을 읽을 수 없습니다.'));
        }
      } else {
        let msg = `업로드 실패 (${xhr.status})`;
        try {
          const data = JSON.parse(xhr.responseText);
          if (typeof data.detail === 'string') msg = data.detail;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('네트워크 오류로 업로드하지 못했습니다.'));
    xhr.send(form);
  });
}

export async function getProject(id: string): Promise<{ project: ProjectMeta; tracks: unknown[] }> {
  return request(`/api/projects/${id}`);
}

export async function pollJob<T>(
  jobId: string,
  onUpdate?: (job: Job<T>) => void,
  intervalMs = 450,
): Promise<Job<T>> {
  for (let i = 0; i < 100000; i += 1) {
    const data = await request<{ job: Job<T> }>(`/api/jobs/${jobId}`);
    onUpdate?.(data.job);
    if (data.job.status === 'done' || data.job.status === 'error') return data.job;
    await sleep(intervalMs);
  }
  throw new Error('작업이 너무 오래 걸립니다.');
}

export async function startDetectFaces(projectId: string, sampleFps = 6): Promise<string> {
  const data = await request<{ jobId: string }>(`/api/projects/${projectId}/detect-faces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sampleFps }),
  });
  return data.jobId;
}

export async function startTranscribe(
  projectId: string,
  opts: { language?: string | null; start?: number; end?: number } = {},
): Promise<string> {
  const data = await request<{ jobId: string }>(`/api/projects/${projectId}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: opts.language ?? 'ko',
      start: opts.start,
      end: opts.end,
      maxChars: 16,
      maxWords: 6,
    }),
  });
  return data.jobId;
}

export async function startRender(projectId: string, spec: EditSpec): Promise<string> {
  const data = await request<{ jobId: string }>(`/api/projects/${projectId}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });
  return data.jobId;
}

export async function getTracks(projectId: string) {
  return request<{ tracks: import('../types').PersonTrack[]; meta: Record<string, unknown> }>(
    `/api/projects/${projectId}/tracks`,
  );
}

export function downloadUrl(jobId: string): string {
  return `/api/jobs/${jobId}/download`;
}

export function resultVideoUrl(jobId: string): string {
  return `/api/jobs/${jobId}/video`;
}

export type { Cue, RenderResult, TranscribeResult };
