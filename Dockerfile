# 릴컷 스튜디오 — 프론트엔드 + 백엔드 통합 이미지
#
# 멀티스테이지 빌드: 프론트엔드를 정적 빌드해 FastAPI가 같은 오리진에서
# API와 함께 서빙한다. PORT 환경변수를 그대로 받으므로 Google Cloud Run에
# 바로 배포할 수 있다.
#
#   docker build -t reelcut .
#   docker run -p 8080:8080 reelcut           # → http://localhost:8080
#   docker run -p 8080:8080 -e PORT=8080 reelcut
#
# Cloud Run:
#   gcloud run deploy reelcut --source . --port 8080 --memory 4Gi --cpu 2 --timeout 900

# ---------------------------------------------------------------- 1) frontend
FROM node:20-slim AS frontend

WORKDIR /src/frontend

# 의존성 레이어를 먼저 캐시한다.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build          # tsc -b && vite build → /src/frontend/dist

# ----------------------------------------------------------------- 2) runtime
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    USING_OPENCV_HEADLESS=1

# ffmpeg: 렌더링/오디오, libgomp1: ctranslate2(whisper), fonts-noto-cjk: 시스템 폴백,
# curl: 헬스체크, libglib2.0-0: OpenCV 런타임 의존성
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg libgomp1 fonts-noto-cjk curl libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/app ./app
# 한글 폰트 원본을 이미지에 포함 → 프론트엔드도 /api/fonts 로 같은 파일을 받는다.
COPY backend/fonts ./fonts

COPY --from=frontend /src/frontend/dist ./static

ENV STATIC_DIR=/app/static \
    FONT_DIR=/app/fonts \
    WORK_DIR=/tmp/video-editor \
    MAX_UPLOAD_MB=250 \
    MAX_DURATION_SEC=300 \
    WHISPER_MODEL=base \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE=int8 \
    OUTPUT_FPS_CAP=30 \
    HF_HOME=/tmp/hf \
    XDG_CACHE_HOME=/tmp/.cache \
    TMPDIR=/tmp \
    PORT=8080

RUN useradd -m -u 1000 user \
    && mkdir -p /tmp/video-editor /tmp/hf /tmp/.cache \
    && chown -R user:user /app /home/user /tmp/video-editor /tmp/hf /tmp/.cache

USER user

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/api/health" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --timeout-keep-alive 75"]
