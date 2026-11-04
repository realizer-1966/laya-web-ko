# laya-web-ko · Laya 다국어(한국어) 브라우저 데모

`vishalmysore/layaForWeb` 포크. ConvAI의 **공식 다국어 체크포인트**
[`convaiinnovations/laya-multilingual`](https://huggingface.co/convaiinnovations/laya-multilingual)
(mmBERT-base 인코더, 322M, 100개 이상 언어)를 브라우저용 ONNX로 변환해 **한국어 UI**로 서비스합니다.
모든 추론은 페이지 안에서 실행되며 입력 데이터가 외부로 나가지 않습니다.

## 이 저장소로 바로 배포하기 (GitHub Actions)

1. GitHub에서 빈 저장소를 하나 만듭니다 (예: `laya-web-ko`).
2. 이 폴더에서 푸시합니다.
   ```bash
   git init -b main
   git add -A && git commit -m "Multilingual (Korean) Laya web demo"
   git remote add origin git@github.com:<계정>/laya-web-ko.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages → Source: GitHub Actions** 로 설정합니다.
4. **Actions → Build multilingual model and deploy → Run workflow** 를 실행합니다.
   (첫 실행은 변환 + 검증 + 양자화로 40~70분 정도 걸리고, 이어지는 실행은 캐시로 수 분입니다.)
5. 끝나면 `https://<계정>.github.io/laya-web-ko/` 에서 바로 쓸 수 있습니다.

Actions 실행 결과 화면의 **Artifacts → `laya-multilingual-q8e8`** 에서 변환된 ONNX 묶음(~350MB)을
받아 로컬에 보관할 수도 있습니다. Hugging Face에 두고 싶다면 저장소 변수 `HF_MODEL_REPO_MULTILINGUAL`과
시크릿 `HF_TOKEN`만 추가하면 사이트는 가벼운 채로 모델만 HF에서 불러옵니다.

## 로컬에서 빌드하기 (Actions 없이)

```bash
bash scripts/build-multilingual-local.sh   # VARIANTS=q8e8,q4e8 로 변경 가능
python serve.py                             # http://localhost:8000
```

## 모델이 없을 때

저장소를 그냥 Pages로 열고 모델을 아직 빌드하지 않았다면 페이지는 자동으로 **시뮬레이션 모드**를
제안합니다(`?mock=1` 쿼리로도 강제). 확률은 문자 2-gram + 어휘 사전 휴리스틱이며, 배지로 항상
실모델이 아님을 표시합니다. UI와 질문 형식을 모델 없이 확인할 때 쓰세요.

## 원본 대비 변경점

- `web/` 전체 한국어화, 한국어 프리셋 6종(지원 티켓·에이전트 가드레일·영업 리드·환자 메시지·배송 예외·제품 리뷰)
- 다국어 체크포인트를 기본 베이스로 사용 (`./model-multilingual/`)
- `web/laya-core.js`: `specialIds()`가 토크나이저 설정에서 특수토큰을 읽도록 수정
  → 영어(`[CLS]`/`[SEP]`/`[MASK]`)·다국어(`<bos>`/`<eos>`/`<mask>`) 모두 대응
- `web/runtime.js`: ort·tokenizers·laya-core를 동적 import (시뮬레이션 모드에서 vendor 불필요)
- `scripts/prepare_site.mjs`: `--model-dir` / `--external-model-base-multilingual` 지원, 기본 모델 `build-multilingual/model`
- `.github/workflows/deploy-multilingual.yml`: 변환 → PyTorch 대조 검증 → 사이트 조립 → 브라우저 스모크 테스트
  → (선택) HF 업로드 → Pages 배포. 모델 아티팩트 다운로드 포함
- `tests/browser_smoke_ml.py`: 영어 참조값 대신 "페이지 격리 → 다국어 빌드 로드 → 실추론 1회 → 값 범위 검증"

## 라이선스

Laya 및 이 변환 작업은 Apache-2.0입니다. `LICENSE`, `NOTICE.md`, `licenses/` 를 함께 배포합니다.
비공식 포크이며 ConvAI Innovations와 제휴 관계가 없습니다.
