// Laya 한국어 데모 — web/app.js 의 한글화 + 다국어 베이스 + 시뮬레이션(모형) 모드.
// 실제 추론 경로는 원본과 동일하게 vendor/ort.min.mjs, vendor/tokenizers.min.mjs 를 동적 import 하므로
// 모형 모드(?mock=1)에서는 vendor 없이도 페이지가 동작합니다.
const $ = (id) => document.getElementById(id);

const BASES = {
  laya:         { label: "Laya (영어, general)",           dir: "./model/",             param: "modelBase",              configKey: "modelBase" },
  typed:        { label: "Laya (typed decisions)",         dir: "./model-typed/",       param: "modelBaseTyped",         configKey: "modelBaseTyped" },
  multilingual: { label: "Laya (다국어, 100+ 언어)",        dir: "./model-multilingual/", param: "modelBaseMultilingual",   configKey: "modelBaseMultilingual" },
};
let MODEL_DIR = BASES.multilingual.dir;
let MANIFEST = null;
let BASE_KEY = "multilingual";
const MOCK = new URLSearchParams(location.search).get("mock") !== null;

const PRESETS = {
  "지원 티켓 (한국어)": {
    state: { ticket: { subject: "앱 실행 시 강제 종료됩니다", text: "마지막 업데이트 이후로 앱을 켜자마자 꺼집니다. 한 시간 뒤에 발표 시연이 있는데 정말 급합니다!" } },
    questions: {
      team:   { type: "choice", instructions: "이 티켓은 어떤 팀이 처리해야 합니까?", criteria: { bug: "앱이 꺼지거나 종료되는 고장·오작동", how_to: "사용법에 대한 질문입니다", sales: "가격 또는 요금제 문의입니다", account_access: "로그인, 비밀번호 또는 계정 접근 문제입니다" } },
      urgency:{ type: "score",  instructions: "얼마나 긴급합니까?", criteria: ["기다려도 됨", "이번 주 안에", "오늘 안에", "지금 즉시"] },
      angry:  { type: "noul",   instructions: "고객이 화가 난 어조입니다" },
    },
  },
  "AI 에이전트 가드레일 (한국어)": {
    state: "에이전트 계획: 운영 데이터베이스에서 `DELETE FROM customers WHERE last_login < '2020-01-01'` 실행. 백업은 없고, 사람 검토도 없었습니다.",
    questions: {
      safe_without_approval: { type: "noul", instructions: "사람의 사전 승인 없이 실행해도 안전합니다" },
      destructive:           { type: "noul", instructions: "이 명령은 되돌릴 수 없는 파괴적 작업입니다" },
      needs_human:           { type: "noul", instructions: "실행 전에 사람이 승인해야 합니다" },
    },
  },
  "영업 리드 스코어링 (한국어)": {
    state: "안녕하세요, 물류 회사(400명 규모)의 엔지니어링 책임자입니다. 이번 분기에 벤더를 검토 중이고 예산은 승인됐습니다. 다음 주에 보안 담당자와 함께 데모를 받고 싶습니다.",
    questions: {
      lead_quality: { type: "score",  instructions: "이 영업 리드는 얼마나 유망합니까?", criteria: ["맞지 않음", "관심 약함", "다소 관심", "강한 구매 신호"] },
      next_step:    { type: "choice", instructions: "영업팀의 다음 조치는?", criteria: { book_demo: "데모 일정 잡기", nurture: "네이처링 캠페인 등록", ignore: "조치 불필요" } },
    },
  },
  "환자 메시지 라우팅 (한국어)": {
    state: "환자 메시지: 오늘 아침부터 가슴이 조이고 숨이 가쁘고, 왼팔에 저림이 있습니다.",
    questions: {
      route:  { type: "choice", instructions: "이 메시지는 어디로 전달해야 합니까?", criteria: { emergency: "즉시 응급 조치가 필요합니다", nurse: "당일 내 간호사 트리아지", admin: "행정 처리", refill: "약 처방 갱신" } },
      urgent: { type: "noul",   instructions: "환자가 생명 위험 증상을 묘사하고 있습니다" },
    },
  },
  "배송 예외 처리 (한국어)": {
    state: "택배가 물류센터에서 스캔되었습니다. 주소 라벨이 부분적으로 훼손되어 읽을 수 없고 수령인 전화번호도 없습니다. 고객은 금요일 행사에 필요해서 그 전까지 받아야 합니다.",
    questions: {
      action:  { type: "choice", instructions: "고객지원팀은 무엇을 해야 합니까?", criteria: { reship: "대체 물품 발송", notify: "지연 안내 문자 발송", fix_address: "전화로 주소 재확인", wait: "대기, 조치 불필요" } },
      at_risk: { type: "noul",   instructions: "고객의 기한 내 배송이 위태롭습니다" },
    },
  },
  "제품 리뷰 (한국어)": {
    state: "배터리 지속시간은 훌륭하고 화면도 선명한데, 볼륨을 높이면 스피커에서 잡음이 납니다. 그래도 추천합니다.",
    questions: {
      sentiment:        { type: "score", instructions: "리뷰의 전체 감성은?", criteria: ["매우 부정", "부정", "호불호", "긍정", "매우 긍정"] },
      mentions_defect:  { type: "noul",  instructions: "리뷰어가 하드웨어 결함을 언급했습니다" },
    },
  },
};

let laya = null;
let backendUsed = "";
let lastResult = null;

function setStatus(msg, cls = "") { const s = $("status"); s.textContent = msg; s.className = "status " + cls; }
function setProgress(f) { $("progress").style.display = f == null ? "none" : "block"; if (f != null) $("progressBar").style.width = (f * 100).toFixed(1) + "%"; }
function badge(text, ok = false, warn = false) { const b = document.createElement("span"); b.className = "badge" + (ok ? " ok" : warn ? " warn" : ""); b.textContent = text; $("badges").appendChild(b); }

// ---------------------------------------------------------------------------
// 시뮬레이션(모형) 모드 — 실제 모델 없이 UI/파이프라인을 체험하기 위한 결정적 휴리스틱.
// 확률은 옵션 기술문의 키워드가 상태 텍스트에 얼마나 등장하는지로 계산합니다.
// 진짜 모델 출력이 아님을 배지로 항상 표시합니다.
// ---------------------------------------------------------------------------
function tokenizeKo(s) {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
}
function bigrams(s) {
  const t = String(s).toLowerCase().replace(/\s+/g, "");
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    if (g.includes("니") || g.includes("습")) continue; // 종결어미(니다/입니다/습니다) 노이즈 제거
    set.add(g);
  }
  return set;
}
// 한국어는 교착어라 어미가 변형되므로 단어 일치 대신 문자 2-gram 교집합을 사용합니다.
function overlapScore(criterion, stateWords, stateText) {
  const grams = bigrams(criterion);
  if (!grams.size) return 0;
  let hit = 0;
  const st = String(stateText).toLowerCase();
  for (const g of grams) if (st.includes(g)) hit += 1;
  let score = 2.0 * hit + 8.0 * (hit / grams.size);
  for (const w of stateWords) if (String(criterion).toLowerCase().includes(w) && w.length > 1) score += 1;
  if (criterion && st.includes(criterion)) score += 2;
  return score;
}
function softmax(z) { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, v) => a + v, 0); return e.map((v) => v / s); }
function confidenceFromProbs(p) {
  if (p.length < 2) return 1;
  let ent = 0; for (const q of p) ent -= q * Math.log(Math.min(Math.max(q, 1e-12), 1));
  return Math.min(Math.max(1 - ent / Math.log(p.length), 0), 1);
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// 강도 어휘 사전 — 시뮬레이션용 휴리스틱. score 질문의 위치, noul 질문의 참 확률을 어휘 힌트로 조정.
const URGENCY_LEX = [["지금", 1.0], ["즉시", 1.0], ["한 시간", 0.9], ["급하", 0.9], ["긴급", 1.0], ["오늘", 0.55], ["이번 주", 0.35], ["시연", 0.4], ["발표", 0.4], ["데모", 0.4], ["시간 뒤", 0.3], ["urgent", 0.9], ["asap", 1.0], ["today", 0.6], ["now", 0.8], ["deadline", 0.5]];
const NEG_LEX = ["화가", "화난", "불만", "짜증", "최악", "실망", "환불", "접수", "!!", "!!!", "정말"];

class MockLaya {
  constructor() { this.mock = true; }
  async systemOne(state, questions) {
    const t0 = performance.now();
    const stateText = typeof state === "string" ? state : JSON.stringify(state);
    const stateWords = new Set(tokenizeKo(stateText));
    const answers = {};
    let tokens = 0;
    for (const [qid, q] of Object.entries(questions)) {
      tokens += Math.ceil(tokenizeKo(stateText + JSON.stringify(q)).length * 1.6);
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria);
        const z = keys.map((k) => 2.2 * overlapScore(String(q.criteria[k] ?? k), stateWords, stateText) + 0.15);
        if (Math.max(...z) === 0.15) { z.forEach((_, i) => (z[i] = 0.15 + (i === 0 ? 0.02 : 0))); }
        const p = softmax(z);
        const top = p.indexOf(Math.max(...p));
        answers[qid] = { type: "choice", choice: keys[top], probabilities: Object.fromEntries(keys.map((k, i) => [k, r4(p[i])])), confidence: r4(confidenceFromProbs(p)) };
      } else if (q.type === "score") {
        const levels = q.criteria;
        const hits = levels.map((c) => overlapScore(String(c), stateWords, stateText));
        const ins = (q.instructions ?? "") + " " + stateText;
        let lex = 0;
        for (const [kw, w] of URGENCY_LEX) if (stateText.toLowerCase().includes(kw.toLowerCase())) lex = Math.max(lex, w);
        const base = hits.reduce((a, h, i) => a + h * i, 0) / Math.max(1, hits.reduce((a, h) => a + h, 0) * (levels.length - 1) || 1);
        const intensity = Math.max(base, lex); // 어휘 힌트가 있으면 그 값을 최소치로 사용
        const k = levels.length, center = intensity * (k - 1);
        const z = levels.map((_, i) => -1.6 * Math.abs(i - center));
        const p = softmax(z);
        const score = p.reduce((a, v, i) => a + i * v, 0);
        answers[qid] = { type: "score", score: r4(score), legend: Object.fromEntries(levels.map((c, i) => [String(i), c])), probabilities: Object.fromEntries(p.map((v, i) => [String(i), r4(v)])), confidence: r4(confidenceFromProbs(p)) };
      } else { // noul
        let yes;
        if (String(q.instructions ?? "").match(/화가|화난|angry|감정|emotion/i)) {
          let hit = 0;
          for (const kw of NEG_LEX) if (stateText.includes(kw)) hit += kw.length > 2 ? 1.2 : 0.8;
          yes = 1 / (1 + Math.exp(-(1.3 * hit - 1.2)));
        } else {
          const h = overlapScore(String(q.instructions ?? ""), stateWords, stateText);
          yes = 1 / (1 + Math.exp(-(0.9 * h - 1.4)));
        }
        const p = [1 - yes, yes];
        answers[qid] = { type: "noul", noul: r4(yes), confidence: r4(Math.max(yes, 1 - yes)) };
      }
    }
    return { model: "laya-multilingual-web (SIMULATION)", answers, usage: { input_tokens: tokens, output_tokens: 0 }, latency_ms: performance.now() - t0 };
  }
}

// --------------------------------------------------------------------------- 실제 모델 로드 경로
async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}. 모델이 빌드되어 있나요? README를 참고하세요.`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress?.(got, total);
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function fetchParts(entry, onProgress) {
  let cache = null;
  try { cache = await caches.open("laya-" + entry.sha256.slice(0, 16)); } catch { /* 사생활 보호 모드 등: 그냥 다운로드 */ }
  const out = new Uint8Array(entry.size); let off = 0, fromCache = 0;
  for (const part of entry.parts) {
    const url = MODEL_DIR + part;
    let bytes = null;
    try { const hit = cache && await cache.match(url); if (hit) { bytes = new Uint8Array(await hit.arrayBuffer()); fromCache++; } } catch {}
    if (!bytes) {
      bytes = await fetchBytes(url, (got) => onProgress(off + got, entry.size));
      try { if (cache) await cache.put(url, new Response(bytes)); } catch { /* 쿼터 초과: 무시 */ }
    }
    if (off + bytes.length > entry.size) throw new Error("가중치가 manifest 크기보다 큽니다");
    out.set(bytes, off); off += bytes.length; onProgress(off, entry.size);
  }
  if (off !== entry.size) throw new Error(`가중치 불완전: ${off} / ${entry.size} 바이트`);
  fetchParts.lastFromCache = fromCache;
  return out;
}

async function loadModel() {
  $("loadBtn").disabled = true; $("runBtn").disabled = true;
  $("badges").innerHTML = "";
  try {
    if (MOCK || MOCK_FORCED) {
      laya = new MockLaya(); backendUsed = "simulation";
      setStatus("시뮬레이션 모드가 활성화되었습니다. 아래 예제를 실행해 보세요. 실제 모델 추론이 아닙니다.");
      badge("시뮬레이션 (모형 휴리스틱)", false, true);
      $("runBtn").disabled = false;
      return;
    }
    const { ort, Tokenizer, Laya } = await import("./runtime.js");
    const v = MANIFEST.variants[$("variant").value];
    let want = $("backend").value;
    const gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter?.());
    const noWebGPU = $("variant").value === "q8e8";
    let backendNote = "";
    if (want === "auto" && gpu && noWebGPU) backendNote = "자동 선택: WASM. 이 빌드는 WebGPU를 지원하지 않습니다(int8 연산자에 WebGPU 커널이 없음).";
    if (want === "auto") want = gpu && !noWebGPU ? "webgpu" : "wasm";
    if (want === "webgpu" && noWebGPU) throw new Error("int8 빌드는 WebGPU에서 실행할 수 없습니다. int4 빌드를 선택하거나 WASM을 사용하세요.");
    if (want === "webgpu" && !gpu) throw new Error("이 브라우저에는 WebGPU가 없습니다. WASM을 선택하세요.");

    ort.env.wasm.wasmPaths = new URL("./vendor/", import.meta.url).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

    setStatus("토크나이저와 설정을 불러오는 중…"); setProgress(0);
    const [tj, tc, cfg] = await Promise.all(
      ["tokenizer.json", "tokenizer_config.json", "rl_agent_config.json"].map((f) => fetch(MODEL_DIR + f).then((r) => { if (!r.ok) throw new Error(f + ": HTTP " + r.status); return r.json(); })));
    const tokenizer = new Tokenizer(tj, tc);
    tokenizer.config = tc; // specialIds가 토크나이저 설정에서 특수토큰(<bos>/<eos>/<mask>/<pad> 또는 [CLS]/[SEP])을 읽도록

    const t0 = performance.now();
    const progress = (name) => (got, total) => { setProgress(total ? got / total : null); setStatus(`${name} 다운로드 중: ${(got / 1048576).toFixed(0)}${total ? " / " + (total / 1048576).toFixed(0) : ""} MB`); };
    const graph = await fetchBytes(MODEL_DIR + v.onnx);
    const data = await fetchParts(v.data, progress(v.data.name));
    const dlMs = performance.now() - t0;

    setStatus("추론 세션 생성 중 (첫 실행은 시간이 걸릴 수 있습니다)…"); setProgress(null);
    const t1 = performance.now();
    const session = await ort.InferenceSession.create(graph, {
      executionProviders: want === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
      graphOptimizationLevel: "all",
      externalData: [{ path: v.data.name, data }],
    });
    const initMs = performance.now() - t1;
    laya = new Laya(ort, session, tokenizer, cfg);
    backendUsed = want;
    setStatus("웜업 중…");
    const w0 = performance.now();
    await laya.systemOne("웜업", { w: { type: "noul", instructions: "웜업 호출입니다" } });
    const warmMs = performance.now() - w0;
    setStatus(`준비 완료. 다운로드 ${(dlMs / 1000).toFixed(1)}초${fetchParts.lastFromCache ? ` (파트 ${fetchParts.lastFromCache}/${v.data.parts.length} 브라우저 캐시 사용)` : ""}, 세션 초기화 ${(initMs / 1000).toFixed(1)}초, 웜업 ${warmMs.toFixed(0)}ms.`);
    badge(want === "webgpu" ? "WebGPU" : "WASM" + (ort.env.wasm.numThreads > 1 ? ` · ${ort.env.wasm.numThreads} 스레드` : " · 1 스레드"), true);
    badge($("variant").selectedOptions[0]?.textContent.split(" (")[0] ?? $("variant").value);
    if (backendNote) badge(backendNote);
    badge("교차 출처 격리: " + (self.crossOriginIsolated ? "예" : "아니오"));
    $("runBtn").disabled = false;
  } catch (e) {
    console.error(e); setStatus("모델을 로드할 수 없습니다: " + (e?.message || e), "warn");
  } finally { setProgress(null); $("loadBtn").disabled = false; }
}

let MOCK_FORCED = false;
$("mockNote").innerHTML = '이 페이지 옆에 모델 빌드가 없습니다. <button class="secondary" id="mockBtn" style="padding:4px 10px;font-size:12px">시뮬레이션 모드로 체험하기</button> — 실제 모델 없이 UI와 질문 형식을 시험해 볼 수 있습니다(확률은 휴리스틱으로 계산).';
$("mockBtn").addEventListener("click", () => { MOCK_FORCED = true; loadModel(); });

// --------------------------------------------------------------------------- 결과 렌더링
function fmtPct(x) { return (x * 100).toFixed(1) + "%"; }
function barRow(name, p, top) {
  const d = document.createElement("div"); d.className = "bar" + (top ? " top" : "");
  d.innerHTML = `<span class="name"></span><span class="track"><span class="fill" style="display:block;width:${(p * 100).toFixed(1)}%"></span></span><span class="val">${fmtPct(p)}</span>`;
  d.querySelector(".name").textContent = name;
  return d;
}
function render(res) {
  lastResult = res;
  $("resultCard").style.display = "";
  $("sLatency").textContent = res.latency_ms.toFixed(1);
  $("sTokens").textContent = res.usage.input_tokens;
  $("sBackend").textContent = backendUsed;
  const box = $("answers"); box.innerHTML = "";
  const thr = Number($("thresh").value);
  for (const [qid, a] of Object.entries(res.answers)) {
    const q = document.createElement("div"); q.className = "q";
    const head = document.createElement("div"); head.className = "qhead";
    const headline = a.type === "choice" ? a.choice : a.type === "score" ? `점수 ${a.score.toFixed(2)}` : `P(참) ${fmtPct(a.noul)}`;
    head.innerHTML = `<span><span class="qname"></span> <span class="qtype">${a.type}</span></span><span><b class="hl"></b></span>`;
    head.querySelector(".qname").textContent = qid; head.querySelector(".hl").textContent = headline;
    q.appendChild(head);
    if (a.type === "choice") {
      const entries = Object.entries(a.probabilities); const mx = Math.max(...entries.map((e) => e[1]));
      entries.forEach(([k, p]) => q.appendChild(barRow(k, p, p === mx)));
    } else if (a.type === "score") {
      const mx = Math.max(...Object.values(a.probabilities));
      Object.entries(a.probabilities).forEach(([i, p]) => q.appendChild(barRow(`${i}: ${a.legend[i]}`, p, p === mx)));
    } else {
      q.appendChild(barRow("예", a.noul, a.noul >= 0.5)); q.appendChild(barRow("아니오", 1 - a.noul, a.noul < 0.5));
    }
    const m = document.createElement("div"); m.className = "meta";
    m.textContent = `신뢰도 ${a.confidence.toFixed(3)} — Laya의 신뢰도는 분포의 정규화 엔트로피를 1에서 뺀 값이라, 점수형 질문처럼 분포가 넓게 퍼지면 최상위 확률이 높아도 낮게 나옵니다.`;
    q.appendChild(m);
    const dec = document.createElement("div"); dec.className = "decision";
    const auto = a.confidence >= thr;
    dec.innerHTML = auto ? `임계값 ${thr.toFixed(2)} 이상 → <b class="auto">자동 처리</b>` : `신뢰도가 임계값 ${thr.toFixed(2)} 미만 → <b class="human">사람에게 넘김</b>`;
    q.appendChild(dec);
    box.appendChild(q);
  }
  $("raw").textContent = JSON.stringify(res, null, 2);
}

async function run() {
  if (!laya) return;
  let state, questions;
  const raw = $("state").value.trim();
  try { state = raw.startsWith("{") || raw.startsWith("[") ? JSON.parse(raw) : $("state").value; } catch { state = $("state").value; }
  try { questions = JSON.parse($("questions").value); } catch (e) { setStatus("질문 JSON이 아닙니다: " + e.message, "warn"); return; }
  $("runBtn").disabled = true;
  try { render(await laya.systemOne(state, questions)); setStatus("완료."); }
  catch (e) { console.error(e); setStatus("실행 실패: " + (e?.message || e), "warn"); }
  finally { $("runBtn").disabled = false; }
}

// --------------------------------------------------------------------------- 초기화
async function resolveBaseDir(key) {
  const b = BASES[key];
  let dir = new URLSearchParams(location.search).get(b.param);
  if (!dir) { try { const c = await fetch("./site-config.json"); if (c.ok) dir = (await c.json())[b.configKey]; } catch {} }
  return (dir || b.dir).replace(/\/?$/, "/");
}
async function probeBase(key) {
  const dir = await resolveBaseDir(key);
  try {
    const r = await fetch(dir + "manifest.json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    return { key, dir, manifest: await r.json() };
  } catch (e) { return { key, dir, manifest: null, error: e }; }
}

let AVAILABLE = {};
function applyBase(key) {
  BASE_KEY = key;
  const a = AVAILABLE[key];
  MODEL_DIR = a.dir; MANIFEST = a.manifest;
  const vsel = $("variant"); vsel.innerHTML = "";
  for (const [k, v] of Object.entries(MANIFEST.variants)) vsel.add(new Option(`${v.label} (약 ${Math.round(v.data.size / 1048576)} MB)`, k));
  laya = null; $("runBtn").disabled = true; $("loadBtn").disabled = false; $("badges").innerHTML = "";
  setStatus(`${BASES[key].label} 선택됨. 아직 로드하지 않았습니다.`);
}

async function initManifests() {
  const probes = await Promise.all(Object.keys(BASES).map(probeBase));
  const sel = $("baseModel"); sel.innerHTML = "";
  for (const p of probes) if (p.manifest) { AVAILABLE[p.key] = p; sel.add(new Option(BASES[p.key].label, p.key)); }
  // 다국어 빌드가 있으면 기본 선택, 없으면 첫 번째 사용 가능 모델
  const prefer = ["multilingual", "laya", "typed"].find((k) => AVAILABLE[k]);
  if (prefer) {
    $("baseModelRow").style.display = Object.keys(AVAILABLE).length > 1 ? "" : "none";
    applyBase(prefer);
  } else {
    // 모델이 없으면: 빌드 드롭다운을 시뮬레이션 상태로 갱신하고 mock 폴백 UI 노출
    const vsel = $("variant");
    vsel.innerHTML = "";
    vsel.add(new Option(MOCK ? "시뮬레이션 (모형 휴리스틱)" : "모델 없음 — 빌드 후 사용 가능", "none"));
    vsel.disabled = true;
    $("backend").disabled = true;
    $("mockNote").style.display = "";
    setStatus(MOCK
      ? "시뮬레이션 모드: 실제 모델 빌드가 없어 휴리스틱 확률로 동작합니다."
      : "이 페이지 옆에 모델 manifest가 없습니다. 실제 모델은 README의 변환 절차를 따라 빌드하세요.");
  }
  if (MOCK) { MOCK_FORCED = true; loadModel(); }
}
$("loadBtn").addEventListener("click", loadModel);

for (const k of Object.keys(PRESETS)) $("preset").add(new Option(k, k));
function applyPreset() {
  const p = PRESETS[$("preset").value];
  $("state").value = typeof p.state === "string" ? p.state : JSON.stringify(p.state, null, 2);
  $("questions").value = JSON.stringify(p.questions, null, 2);
}
$("preset").addEventListener("change", applyPreset); applyPreset();
$("thresh").addEventListener("input", () => { $("threshVal").textContent = Number($("thresh").value).toFixed(2); if (lastResult) render(lastResult); });
$("runBtn").addEventListener("click", run);
$("baseModel").addEventListener("change", () => applyBase($("baseModel").value));
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run(); });
window.__laya = { loadModel, run, get ready() { return !!laya; }, get instance() { return laya; } };
initManifests();