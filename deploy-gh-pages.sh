#!/usr/bin/env bash
# GitHub Pages(브랜치 배포)용 재배포 스크립트
#
#   main 브랜치의 소스를 프론트엔드로 빌드해서, 산출물(frontend/dist)만
#   gh-pages 브랜치 루트에 올린다. main 브랜치는 건드리지 않는다.
#
#   최초 1회(보라님): 저장소 Settings → Pages → Source = "Deploy from a branch",
#                     Branch = gh-pages / (root) 로 지정.
#
#   실행: bash deploy-gh-pages.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
GIT_DIR="$ROOT/.git"

export PATH="/workspace/.local/node/bin:$PATH"

echo "▶ 프론트엔드 빌드"
cd "$ROOT/frontend"
npm run build
npm run check:static

# Jekyll 처리 방지
touch dist/.nojekyll

echo "▶ gh-pages 커밋 생성"
cd dist
IDX="$(mktemp -u)"
export GIT_INDEX_FILE="$IDX"
git --git-dir="$GIT_DIR" --work-tree=. add -A -f .
TREE="$(git --git-dir="$GIT_DIR" write-tree)"
COMMIT="$(git --git-dir="$GIT_DIR" \
  -c user.name="임보라" -c user.email="borarim0105@gmail.com" \
  commit-tree "$TREE" -m "deploy: $(date '+%Y-%m-%d %H:%M') 정적 빌드 (main $(git --git-dir="$GIT_DIR" rev-parse --short main))")"
rm -f "$IDX"

echo "▶ 푸시"
git --git-dir="$GIT_DIR" push origin "$COMMIT:refs/heads/gh-pages"

echo "✔ 배포 커밋: $COMMIT"
echo "  https://borarim-design.github.io/video-editor/"
