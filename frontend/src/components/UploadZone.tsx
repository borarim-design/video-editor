import { useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  busy?: boolean;
  error?: string | null;
}

export default function UploadZone({ onFile, busy, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-studio-700 bg-studio-850/80 px-3 py-1 text-[11px] font-semibold tracking-wide text-neon-soft">
            <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-neon-lime" />
            서버 없이 브라우저에서 바로 · 파일은 업로드되지 않습니다
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            릴컷 스튜디오
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-studio-300">
            영상을 고르면 말하는 단어를 짚어주는 자막과 모자이크를 입혀 MP4로 바로 내려받아요.
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
            <p className="mt-1 text-xs text-studio-400">MP4 · MOV · WebM · 파일은 내 컴퓨터에서 나가지 않습니다</p>
          </div>
          {busy ? (
            <p className="animate-pulseSoft text-[11px] text-studio-300">영상을 여는 중…</p>
          ) : null}
        </button>

        {error ? (
          <p className="mt-4 rounded-xl border border-neon-rose/40 bg-neon-rose/10 px-4 py-3 text-sm text-neon-rose">
            {error}
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['✨', '단어 하이라이트 자막', '수동 자막에 단어 강조·바운스·박스·지글지글'],
            ['🫥', '수동 모자이크', '드래그로 영역 지정, 블러↔모자이크 강도 조절'],
            ['📱', '릴스·숏츠 비율', '9:16 · 1:1 · 16:9 · 4:5 로 바로 내보내기'],
          ].map(([emoji, title, desc]) => (
            <div key={title} className="rounded-2xl border border-studio-700/70 bg-studio-850/50 p-4">
              <div className="text-lg">{emoji}</div>
              <p className="mt-2 text-sm font-semibold text-studio-100">{title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-studio-400">{desc}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 rounded-xl border border-studio-700/60 bg-studio-850/40 px-4 py-3 text-[11px] leading-relaxed text-studio-400">
          지금은 <b className="text-studio-200">서버 없는 정적 버전</b>이라 <b className="text-studio-200">AI 자동 자막</b>과
          <b className="text-studio-200"> 자동 얼굴 추적</b>은 꺼져 있습니다. 수동 자막·수동 모자이크·트림·비율·후킹 타이틀은
          모두 그대로 동작하고, 영상은 이 브라우저 안에서만 만들어집니다.
        </p>
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
