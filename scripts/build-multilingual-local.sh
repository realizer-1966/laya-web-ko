#!/usr/bin/env bash
# 다국어 모델을 로컬 PC에서 변환하고 사이트를 조립합니다 (GitHub Actions 없이).
# 필요: Python 3.11+, Node 20+, 디스크 여유 8GB
set -euo pipefail
cd "$(dirname "$0")/.."

python -m pip install -r requirements-build.txt
python -m pip install -U "laya @ git+https://github.com/NandhaKishorM/laya.git"

python scripts/build_model.py \
  --repo convaiinnovations/laya-multilingual \
  --out build-multilingual \
  --variants "${VARIANTS:-q8e8}"

python scripts/verify_model.py --out build-multilingual

npm ci
node scripts/prepare_site.mjs --model-dir build-multilingual/model
echo "완료: dist/ (python serve.py 로 열기)"
