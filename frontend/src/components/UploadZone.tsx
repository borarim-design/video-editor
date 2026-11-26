import { useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  busy?: boolean;
  progress?: number;
  error?: string | null;
}

export default function UploadZone({ onFile, busy, progress = 0, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-studio-700 bg-studio-850/80 px-3 py-1 text-[11px] font-semibold tracking-wide text-neon-soft">
            <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-neon-lime" />
            자동 AI 자막 · 추적 모자이크
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            릴컷 스튜디오
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-studio-300">
            영상을 올리면 말하는 단어를 짚어주는 자막과, 얼굴을 따라가는 모자이크까지 한 번에.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHover(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          className={`group relative flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-14 transition ${
            hover ? 'border-neon bg-neon/10' : 'border-studio-600 bg-studio-850/60 hover:border-neon/70 hover:bg-studio-850'
          } ${busy ? 'cursor-wait opacity-80' : ''}`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-neon to-neon-cyan text-2xl shadow-glow">
            🎬
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-white">영상 파일을 끌어다 놓거나 눌러서 선택</p>
            <p className="mt-1 text-xs text-studio-400">MP4 · MOV · WebM · 최대 5분 / 250MB</p>
          </div>
          {busy ? (
            <div className="w-48">
              <div className="h-1.5 overflow-hidden rounded-full bg-studio-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-neon to-neon-cyan transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-center text-[11px] text-studio-300">업로드 중… {Math.round(progress * 100)}%</p>
            </div>
          ) : null}
        </button>

        {error ? (
          <p className="mt-4 rounded-xl border border-neon-rose/40 bg-neon-rose/10 px-4 py-3 text-sm text-neon-rose">
            {error}
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['✨', '단어 하이라이트 자막', '말하는 단어만 컬러·확대로 톡톡'],
            ['🫥', '얼굴 추적 모자이크', '사람별 ON/OFF, 블러↔모자이크 강도 조절'],
            ['📱', '릴스·숏츠 비율', '9:16 · 1:1 · 16:9 한 번에 내보내기'],
          ].map(([emoji, title, desc]) => (
            <div key={title} className="rounded-2xl border border-studio-700/70 bg-studio-850/50 p-4">
              <div className="text-lg">{emoji}</div>
              <p className="mt-2 text-sm font-semibold text-studio-100">{title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-studio-400">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
