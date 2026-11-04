// 한국어 워크플로우 · 온톨로지 데모
// 원본 web/workflows.js 의 9개 워크플로우를 한국어로 옮기고, 온톨로지 표시·편집 기능을 추가했습니다.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x * 100).toFixed(1) + "%";
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 워크플로우 정의 (온톨로지) ────────────────────────────────────────────
// 각 워크플로우 = 결정 과제 + typed 질문 집합. 질문 타입은 choice / score / noul.
const WORKFLOWS = {
  support_ticket: {
    label: "지원 티켓 → 담당 팀 배정",
    desc: "고객 문의를 읽고 어느 팀이 처리할지 고릅니다. 신뢰도가 낮으면 사람이 배정합니다.",
    subject: true,
    questions: {
      team: { type: "choice", instructions: "이 티켓은 어떤 팀이 처리해야 합니까?",
        criteria: { bug: "앱이 꺼지거나 종료되는 고장·오작동", how_to: "사용법에 대한 질문입니다",
                    sales: "가격 또는 요금제 문의입니다", account_access: "로그인, 비밀번호 또는 계정 접근 문제입니다" } },
      urgency: { type: "score", instructions: "이 요청이 얼마나 급합니까?",
        criteria: ["기다려도 됨", "이번 주 안에", "오늘 안에", "지금 즉시"] },
      angry: { type: "noul", instructions: "고객이 화가 나 있거나 불만이 큽니다" },
    },
    example: { subject: "앱이 계속 강제 종료됩니다",
      message: "마지막 업데이트 이후로 앱을 켜자마자 꺼집니다. 한 시간 뒤에 발표 시연이 있는데 정말 급합니다. 환불까지 고려하고 있습니다." },
    decide: (a, t) => {
      const c = a.team, ok = c.confidence >= t;
      if (ok) return { auto: true, text: `${c.choice} 팀으로 자동 배정합니다.`, why: `팀 분류 신뢰도 ${pct(c.confidence)} ≥ 임계값 ${t.toFixed(2)}` };
      return { auto: false, text: `${c.choice} 팀 후보(신뢰도 ${pct(c.confidence)}) — 사람이 확인해 배정하세요.`, why: `신뢰도 ${pct(c.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },

  agent_action: {
    label: "에이전트 명령 → 승인 또는 차단",
    desc: "AI 에이전트가 실행하려는 명령(예: DB 쿼리)을 보고 자동 실행·보류·차단을 정합니다. 파괴적 명령은 신뢰도와 무관하게 막습니다.",
    questions: {
      destructive: { type: "noul", instructions: "이 명령은 데이터를 삭제하거나 되돌릴 수 없게 만듭니다" },
      needs_human: { type: "noul", instructions: "이 명령은 사람의 승인이 필요합니다" },
      safe_without_approval: { type: "noul", instructions: "이 명령은 추가 승인 없이 실행해도 안전합니다" },
      risk: { type: "score", instructions: "이 명령의 위험도는 어느 정도입니까?",
        criteria: ["위험 없음", "낮음", "중간", "높음", "치명적"] },
      verdict: { type: "choice", instructions: "이 명령을 어떻게 처리해야 합니까?",
        criteria: { approve: "그대로 실행을 승인합니다", hold: "사람의 승인을 기다립니다", block: "실행을 차단합니다" } },
    },
    example: { message: "psql -c 'DROP TABLE customers CASCADE;'" },
    decide: (a, t) => {
      const v = a.verdict, destructive = a.destructive?.noul ?? 0;
      if (destructive >= 0.6) return { auto: true, text: "차단 — 되돌릴 수 없는 삭제 명령입니다.", why: `파괴적 명령 확률 ${pct(destructive)}`, human: false };
      if (v.confidence >= t && v.choice === "approve") return { auto: true, text: "자동 승인 — 실행합니다.", why: `판정 신뢰도 ${pct(v.confidence)}` };
      if (v.choice === "block") return { auto: false, text: "차단 권고 — 사람이 확인하세요.", why: `판정 신뢰도 ${pct(v.confidence)}` };
      return { auto: false, text: "보류 — 사람의 승인이 필요합니다.", why: `판정 신뢰도 ${pct(v.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },

  comment_moderation: {
    label: "댓글 → 게시 · 보류 · 삭제",
    desc: "댓글의 유해성과 스팸 여부를 보고 게시 여부를 정합니다.",
    questions: {
      toxicity: { type: "score", instructions: "이 댓글의 유해성 수준은?",
        criteria: ["무해함", "약간 거칠다", "공격적", "혐오 표현"] },
      spam: { type: "noul", instructions: "이 댓글은 스팸 또는 광고입니다" },
      verdict: { type: "choice", instructions: "이 댓글을 어떻게 처리할까요?",
        criteria: { publish: "그대로 게시합니다", hold: "검토 대기로 보류합니다", remove: "삭제합니다" } },
    },
    example: { message: "이 제품 완전 사기입니다. 돈 내고 이딴 걸 받다니. 다들 사지 마세요!!" },
    decide: (a, t) => {
      const tox = a.toxicity.score, spam = a.spam.noul;
      if (tox >= 2.5 || spam >= 0.8) return { auto: true, text: "검토 대기로 보류 — 유해성 또는 스팸 신호가 강합니다.", why: `유해성 ${tox.toFixed(2)} / 스팸 ${pct(spam)}` };
      const v = a.verdict;
      if (v.confidence >= t && v.choice === "publish") return { auto: true, text: "자동 게시.", why: `판정 신뢰도 ${pct(v.confidence)}` };
      return { auto: false, text: `${v.choice} 권고 — 사람이 확인하세요.`, why: `판정 신뢰도 ${pct(v.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },

  monitoring_alert: {
    label: "모니터링 경보 → 호출 또는 기록",
    desc: "장애 경보를 보고 담당 팀을 호출할지 로그만 남길지 정합니다.",
    questions: {
      severity: { type: "score", instructions: "이 경보의 심각도는?",
        criteria: ["정보성", "경미", "보통", "심각", "서비스 중단"] },
      owner: { type: "choice", instructions: "누가 대응해야 합니까?",
        criteria: { infra: "인프라 팀", backend: "백엔드 팀", data: "데이터 팀", none: "대응 불필요" } },
      customer_impact: { type: "noul", instructions: "고객이 영향을 받고 있습니다" },
      action: { type: "choice", instructions: "어떤 조치를 취할까요?",
        criteria: { page: "담당자를 즉시 호출합니다", log: "티켓만 만들고 기록합니다", ignore: "무시합니다" } },
    },
    example: { message: "checkout-api 5xx 오류율 38% (5분 지속). 결제 실패 문의 급증." },
    decide: (a, t) => {
      const sev = a.severity.score, impact = a.customer_impact.noul;
      if (impact >= 0.7 && sev >= 2.5) return { auto: true, text: "즉시 호출 — 고객 영향이 확인됐습니다.", why: `심각도 ${sev.toFixed(2)} / 고객 영향 ${pct(impact)}` };
      const v = a.action;
      if (v.confidence >= t) return { auto: true, text: `${v.choice} 로 처리합니다.`, why: `판정 신뢰도 ${pct(v.confidence)}` };
      return { auto: false, text: "사람이 확인 후 조치하세요.", why: `판정 신뢰도 ${pct(v.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },

  email_triage: {
    label: "이메일 → 답장 필요 판단 + 마감 설정",
    desc: "받은 메일을 읽고 답장이 필요한지, 얼마나 급한지, 어떤 조치를 할지 정합니다.",
    questions: {
      needs_reply: { type: "noul", instructions: "이 메일에는 답장이 필요합니다" },
      urgency: { type: "score", instructions: "답장이 얼마나 급합니까?",
        criteria: ["여유 있음", "이번 주", "오늘 안에", "즉시"] },
      action: { type: "choice", instructions: "어떤 조치를 할까요?",
        criteria: { reply: "바로 답장을 작성합니다", todo: "할 일로 등록합니다", archive: "보관만 합니다" } },
    },
    example: { message: "계약서 최종본 오늘 18시까지 회신 부탁드립니다. 서명 페이지 링크 첨부했습니다." },
    decide: (a, t) => {
      if ((a.needs_reply?.noul ?? 0) < 0.5) return { auto: true, text: "보관 — 답장이 필요 없어 보입니다.", why: `답장 필요 확률 ${pct(a.needs_reply?.noul ?? 0)}` };
      const v = a.action;
      if (v.confidence >= t) return { auto: true, text: `${v.choice} 로 처리합니다.`, why: `판정 신뢰도 ${pct(v.confidence)}` };
      return { auto: false, text: "사람이 읽고 처리하세요.", why: `판정 신뢰도 ${pct(v.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },

  delivery_issue: {
    label: "배송 문제 → 고객 지원 조치",
    desc: "배송 지연·분실 문의를 읽고 어떤 지원 조치를 할지 정합니다.",
    questions: {
      urgency: { type: "score", instructions: "이 문의가 얼마나 급합니까?",
        criteria: ["여유 있음", "이번 주", "오늘 안에", "즉시"] },
      upset: { type: "noul", instructions: "고객이 많이 화가 나 있습니다" },
      action: { type: "choice", instructions: "어떤 조치를 할까요?",
        criteria: { refund: "환불을 처리합니다", reship: "재배송을 진행합니다", trace: "배송 조회 후 안내합니다", explain: "지연 사유를 안내합니다" } },
    },
    example: { message: "주문한 지 일주일째인데 배송이 안 됩니다. 아이 생일 선물이었어요. 정말 화가 납니다." },
    decide: (a, t) => {
      const v = a.action, upset = a.upset?.noul ?? 0;
      if (upset >= 0.75) return { auto: false, text: "사람이 직접 응대하세요 — 감정이 높습니다.", why: `불만 확률 ${pct(upset)}` };
      if (v.confidence >= t) return { auto: true, text: `${v.choice} 로 처리합니다.`, why: `판정 신뢰도 ${pct(v.confidence)}` };
      return { auto: false, text: `${v.choice} 권고 — 사람이 확인하세요.`, why: `판정 신뢰도 ${pct(v.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },

  inbound_lead: {
    label: "인바운드 리드 → CRM 다음 단계",
    desc: "문의 내용을 보고 리드 품질을 평가해 영업 다음 단계를 정합니다.",
    questions: {
      lead_quality: { type: "score", instructions: "이 리드의 구매 의향은?",
        criteria: ["정보 수집 단계", "관심 있음", "예산 확보", "도입 임박"] },
      next_step: { type: "choice", instructions: "다음 단계는 무엇입니까?",
        criteria: { demo: "데모 미팅을 잡습니다", nurture: "자료를 보내고 후속 연락합니다", qualify: "예산·일정을 먼저 확인합니다", disqualify: "대상이 아닙니다" } },
    },
    example: { message: "150명 규모 팀이고 내년 1월 도입 예정입니다. 예산은 확보되어 있고 보안 검토 자료를 먼저 받고 싶습니다." },
    decide: (a, t) => {
      const q = a.lead_quality.score, v = a.next_step;
      if (q >= 2.5) return { auto: true, text: "데모 미팅을 바로 제안하세요.", why: `구매 의향 ${q.toFixed(2)}/3` };
      if (v.confidence >= t) return { auto: true, text: `${v.choice} 로 처리합니다.`, why: `판정 신뢰도 ${pct(v.confidence)}` };
      return { auto: false, text: "사람이 검토 후 분류하세요.", why: `판정 신뢰도 ${pct(v.confidence)}` };
    },
  },

  clinic_message: {
    label: "병의원 메시지 → 진료과 배정 (합성 데이터)",
    desc: "환자 메시지를 읽고 어느 진료과로 보낼지 정합니다. 진단이 아니라 라우팅만 합니다.",
    questions: {
      route: { type: "choice", instructions: "이 메시지는 어느 진료과로 가야 합니까?",
        criteria: { general: "일반 진료", pediatrics: "소아과", orthopedics: "정형외과", dermatology: "피부과", admin: "원무과" } },
      urgent: { type: "noul", instructions: "이 메시지는 즉시 확인이 필요합니다" },
    },
    example: { message: "아이가 어제부터 39도 열이 나고 기침을 합니다. 오늘 진료 가능할까요?" },
    decide: (a, t) => {
      const r = a.route;
      if ((a.urgent?.noul ?? 0) >= 0.7) return { auto: false, text: "즉시 확인 필요 — 간호사가 먼저 확인하세요.", why: `긴급 확률 ${pct(a.urgent.noul)}` };
      if (r.confidence >= t) return { auto: true, text: `${r.choice} 로 자동 배정합니다.`, why: `신뢰도 ${pct(r.confidence)}` };
      return { auto: false, text: `${r.choice} 후보 — 원무과에서 확인하세요.`, why: `신뢰도 ${pct(r.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },

  product_review: {
    label: "제품 리뷰 → 게시 또는 에스컬레이션",
    desc: "리뷰의 감정과 주제를 보고 그대로 두거나 담당자에게 넘깁니다.",
    questions: {
      sentiment: { type: "score", instructions: "이 리뷰의 감정은?",
        criteria: ["매우 부정적", "부정적", "중립", "긍정적", "매우 긍정적"] },
      topic: { type: "choice", instructions: "주요 주제는 무엇입니까?",
        criteria: { quality: "제품 품질", shipping: "배송", price: "가격", support: "고객 지원", other: "기타" } },
      recommends: { type: "noul", instructions: "작성자가 이 제품을 추천합니다" },
    },
    example: { message: "포장이 찌그러진 채로 왔고 교환 요청에 사흘째 답이 없네요. 제품 자체는 괜찮지만 다시 살 것 같지는 않습니다." },
    decide: (a, t) => {
      const s = a.sentiment.score, rec = a.recommends?.noul ?? 0.5;
      if (s <= 1 && rec <= 0.35) return { auto: true, text: "에스컬레이션 — 부정 리뷰로 고객지원에 전달합니다.", why: `감정 ${s.toFixed(2)}/4, 추천 확률 ${pct(rec)}` };
      if (a.topic.confidence >= t) return { auto: true, text: "그대로 게시합니다.", why: `주제 분류 신뢰도 ${pct(a.topic.confidence)}` };
      return { auto: false, text: "사람이 확인하세요.", why: `신뢰도 ${pct(a.topic.confidence)} < 임계값 ${t.toFixed(2)}` };
    },
  },
};


// ── 모델 로딩 ────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
let BASE = params.get("modelBaseMultilingual") ? params.get("modelBaseMultilingual").replace(/\/?$/, "/") : "";
let MANIFEST = null;
let LAYA = null;          // Laya 인스턴스
let RT = null;            // { ort, Tokenizer, Laya }

function setStatus(t) { $("status").textContent = t; }

async function resolveBase() {
  if (BASE) return BASE;
  try {
    const cfg = await (await fetch("site-config.json")).json();
    if (cfg.modelBaseMultilingual) return (BASE = cfg.modelBaseMultilingual.replace(/\/?$/, "/"));
  } catch { /* site-config.json 은 선택 사항 */ }
  return (BASE = "./model-multilingual/");
}

async function initManifests() {
  const base = await resolveBase();
  const sel = $("variant");
  try {
    const r = await fetch(base + "manifest.json", { cache: "no-store" });
    if (!r.ok) throw new Error("manifest 없음");
    MANIFEST = await r.json();
  } catch (e) {
    sel.innerHTML = "";
    sel.add(new Option("모델 없음 — 빌드 후 사용 가능", "none"));
    sel.disabled = true;
    $("loadBtn").disabled = true;
    setStatus("모델 manifest를 찾을 수 없습니다. 워크플로우·온톨로지 편집은 그대로 사용할 수 있습니다.");
    return;
  }
  sel.innerHTML = "";
  for (const [id, v] of Object.entries(MANIFEST.variants)) {
    const mb = v.data?.size ? `약 ${Math.round(v.data.size / 1e6)} MB` : "";
    sel.add(new Option(`${id} — ${v.label ?? ""}${mb ? ` (${mb})` : ""}`, id));
  }
  $("loadBtn").disabled = false;
  setStatus(`모델 준비됨: ${Object.keys(MANIFEST.variants).join(", ")}. "모델 로드"를 누르세요.`);
}

async function fetchParts(variant, onProgress) {
  const d = variant.data ?? {};
  const parts = d.parts ?? [];
  const buf = new Uint8Array(d.size);
  let off = 0;
  for (let i = 0; i < parts.length; i++) {
    const res = await fetch(BASE + parts[i]);
    if (!res.ok) throw new Error(`${parts[i]} → HTTP ${res.status}`);
    const chunk = new Uint8Array(await res.arrayBuffer());
    buf.set(chunk, off); off += chunk.length;
    onProgress(off, d.size);
  }
  if (off !== d.size) throw new Error(`크기 불일치: ${off} / ${d.size}`);
  return buf;
}

async function loadModel() {
  const btn = $("loadBtn");
  btn.disabled = true;
  try {
    if (!RT) {
      setStatus("런타임 로드 중…");
      const [ortMod, tokMod, coreMod] = await Promise.all([
        import("./vendor/ort.min.mjs"), import("./vendor/tokenizers.min.mjs"), import("./laya-core.js"),
      ]);
      RT = { ort: ortMod.default?.InferenceSession ? ortMod.default : ortMod,
             Tokenizer: tokMod.Tokenizer ?? tokMod.default?.Tokenizer, Laya: coreMod.Laya };
    }
    const { ort, Tokenizer, Laya } = RT;
    const wantGpu = $("backend").value === "webgpu";
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

    const variantId = $("variant").value;
    const variant = MANIFEST.variants[variantId];
    setStatus("모델 다운로드 중…");
    const t0 = performance.now();
    const bytes = await fetchParts(variant, (got, total) =>
      setStatus(`${variant.data.name} 다운로드 중: ${Math.round(got / 1e6)} / ${Math.round(total / 1e6)} MB`));
    const dl = (performance.now() - t0) / 1000;

    setStatus("세션 초기화 중…");
    const t1 = performance.now();
    let session;
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: [wantGpu ? "webgpu" : "wasm"] });
    } catch (e) {
      if (!wantGpu) throw e;
      setStatus("WebGPU 실패 — WASM으로 재시도합니다.");
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    }
    const init = (performance.now() - t1) / 1000;

    const [tj, tc] = await Promise.all([
      (await fetch(BASE + "tokenizer.json")).text(),
      (await fetch(BASE + "tokenizer_config.json")).text(),
    ]);
    const tok = new Tokenizer(tj, tc);
    const cfg = await (await fetch(BASE + "rl_agent_config.json")).json();

    setStatus("웜업 중…");
    const t2 = performance.now();
    LAYA = new Laya(ort, session, tok, cfg);
    const warm = Math.round(performance.now() - t2);

    setStatus(`준비 완료. 다운로드 ${dl.toFixed(1)}초, 세션 초기화 ${init.toFixed(1)}초, 웜업 ${warm}ms.`);
    btn.textContent = "모델 다시 로드";
  } catch (e) {
    setStatus("모델 로드 실패: " + e.message);
    btn.disabled = false;
  }
}

// ── 실행 ────────────────────────────────────────────────────────────────
function currentSpec() { return WORKFLOWS[$("workflow").value]; }

async function run() {
  const spec = currentSpec();
  const subject = spec.subject ? $("subject").value.trim() : "";
  const message = $("message").value.trim();
  if (!message) { setStatus("메시지를 입력하세요."); return; }
  const state = spec.subject ? { ticket: { subject, message } } : { message };

  const t = Number($("threshold").value) / 100;
  $("result").innerHTML = `<p class="muted">추론 중…</p>`;

  let res;
  try {
    if (!LAYA) throw new Error("모델이 로드되지 않았습니다");
    res = await LAYA.systemOne(state, spec.questions);
  } catch (e) {
    $("result").innerHTML = `<div class="note">실행 실패: ${esc(e.message)}<br>모델을 로드했는지 확인하세요. 모델이 없어도 온톨로지 표시·편집은 사용할 수 있습니다.</div>`;
    return;
  }

  let verdict;
  try { verdict = spec.decide(res.answers, t); }
  catch { verdict = genericDecide(res.answers, t); }

  renderResult(spec, res, verdict);
}

function genericDecide(answers, t) {
  const conf = Math.min(...Object.values(answers).map((a) => a.confidence ?? 1));
  const summary = Object.entries(answers)
    .map(([k, a]) => a.type === "choice" ? `${k}=${a.choice}(${pct(a.probabilities[a.choice])})`
      : a.type === "score" ? `${k}=${a.score.toFixed(2)}`
      : `${k}=${pct(a.noul)}`).join(" · ");
  return conf >= t
    ? { auto: true, text: "자동 처리 — 모든 질문의 신뢰도가 임계값 이상입니다.", why: `${summary} · 최소 신뢰도 ${pct(conf)}` }
    : { auto: false, text: "사람에게 전달 — 신뢰도가 낮은 질문이 있습니다.", why: `${summary} · 최소 신뢰도 ${pct(conf)} < ${t.toFixed(2)}` };
}

function renderResult(spec, res, verdict) {
  const cards = Object.entries(res.answers).map(([qid, a]) => {
    let body;
    if (a.type === "choice") {
      const top = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
      body = `<div class="choice"><b>${esc(a.choice)}</b> <span class="muted">신뢰도 ${pct(a.confidence)}</span></div>` +
        top.map(([k, p]) => `<div class="bar"><span>${esc(k)}</span><span class="w" style="width:${Math.max(1, p * 100)}%"></span><span class="v">${pct(p)}</span></div>`).join("");
    } else if (a.type === "score") {
      body = `<div class="choice"><b>${a.score.toFixed(2)}</b> / ${a.legend.length - 1} <span class="muted">신뢰도 ${pct(a.confidence)}</span></div>` +
        a.legend.map((l, i) => `<div class="bar"><span>${esc(l)}</span><span class="w" style="width:${Math.max(1, (a.probabilities[i] ?? 0) * 100)}%"></span><span class="v">${pct(a.probabilities[i] ?? 0)}</span></div>`).join("");
    } else {
      body = `<div class="choice"><b>${pct(a.noul)}</b> <span class="muted">P(참) · 신뢰도 ${pct(a.confidence)}</span></div>`;
    }
    return `<div class="q"><div class="qid">${esc(qid)} <span class="muted">${esc(spec.questions[qid]?.type ?? a.type)}</span></div>
      <div class="qins">${esc(spec.questions[qid]?.instructions ?? "")}</div>${body}</div>`;
  }).join("");

  $("result").innerHTML = `
    <div class="outcome">
      <div class="title ${verdict.auto ? "auto" : "human"}">${verdict.auto ? "✅ 자동 처리" : "🙋 사람에게 전달"}</div>
      <div>${esc(verdict.text)}</div>
      <div class="muted" style="margin-top:6px">${esc(verdict.why)}</div>
    </div>
    <div class="grid2" style="margin-top:10px">
      <div class="muted">추론 시간</div><div>${res.ms?.toFixed?.(0) ?? "–"} ms</div>
      <div class="muted">입력 토큰 (질문 합계)</div><div>${res.tokens ?? "–"}</div>
      <div class="muted">백엔드</div><div>${esc($("backend").selectedOptions[0].textContent)}</div>
    </div>
    <div style="margin-top:12px">${cards}</div>
    <details style="margin-top:12px"><summary class="muted">원시 JSON</summary>
      <pre id="raw" class="mono">${esc(JSON.stringify(res, null, 2))}</pre></details>`;
}

// ── 온톨로지 표시 ────────────────────────────────────────────────────────
function renderOntology(spec, edited) {
  const rows = Object.entries(spec.questions).map(([qid, q]) => {
    let opts = "";
    if (q.type === "choice") {
      opts = Object.entries(q.criteria ?? {}).map(([k, v]) => `<span class="opt"><b>${esc(k)}</b> · ${esc(v)}</span>`).join("");
    } else if (q.type === "score") {
      opts = (q.criteria ?? []).map((c, i) => `<span class="opt">${i} · ${esc(c)}</span>`).join("");
    } else {
      opts = `<span class="opt">참 / 거짓</span>`;
    }
    return `<div class="onto">
      <div class="h"><span class="id">${esc(qid)}</span><span class="type">${esc(q.type)}</span></div>
      <div class="ins">${esc(q.instructions ?? "")}</div>
      <div class="opts">${opts}</div>
    </div>`;
  }).join("");
  $("ontology").innerHTML = `
    <div class="muted" style="margin-bottom:8px">
      결정 과제: <b>${esc(spec.label)}</b> ${edited ? '<span class="edited">(편집됨)</span>' : ""}<br>${esc(spec.desc ?? "")}
    </div>${rows}`;
  $("ontoCount").textContent = `${Object.keys(spec.questions).length}개 질문 · ${Object.keys(WORKFLOWS).length}개 워크플로우`;
}

// ── 편집기 ──────────────────────────────────────────────────────────────
const STORE = "laya-ko-workflows-v1";
const loadOverrides = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
const saveOverrides = (o) => localStorage.setItem(STORE, JSON.stringify(o));

function applyOverrides() {
  const o = loadOverrides();
  for (const [id, spec] of Object.entries(o)) {
    if (!WORKFLOWS[id]) continue;
    WORKFLOWS[id] = { ...WORKFLOWS[id], ...spec, decide: spec.decide ?? WORKFLOWS[id].decide };
  }
  return o;
}

function specToJson(spec) {
  return JSON.stringify({ label: spec.label, desc: spec.desc, subject: !!spec.subject, questions: spec.questions, example: spec.example }, null, 2);
}

function validateSpec(obj) {
  const errs = [];
  if (!obj || typeof obj !== "object") return ["JSON 최상위가 객체여야 합니다."];
  if (!obj.label || typeof obj.label !== "string") errs.push("label(이름)이 필요합니다.");
  const q = obj.questions;
  if (!q || typeof q !== "object" || !Object.keys(q).length) errs.push("questions(질문 집합)이 비어 있습니다.");
  for (const [id, d] of Object.entries(q ?? {})) {
    if (!["choice", "score", "noul"].includes(d?.type)) errs.push(`"${id}": type은 choice / score / noul 중 하나여야 합니다.`);
    if (!d?.instructions) errs.push(`"${id}": instructions(지시문)가 필요합니다.`);
    if (d?.type === "choice") {
      const n = Object.keys(d.criteria ?? {}).length;
      if (n < 2) errs.push(`"${id}": choice에는 criteria(선택지)가 2개 이상 필요합니다.`);
    }
    if (d?.type === "score") {
      if (!Array.isArray(d.criteria) || d.criteria.length < 2) errs.push(`"${id}": score에는 criteria(척도 배열)가 2개 이상 필요합니다.`);
    }
  }
  return errs;
}

function openEditor() {
  const id = $("workflow").value;
  $("editorBox").style.display = "";
  $("editorJson").value = specToJson(WORKFLOWS[id]);
  $("editorMsg").textContent = "";
  $("editorJson").focus();
}

function refreshOption(id) {
  const sel = $("workflow");
  const opt = [...sel.options].find((o) => o.value === id);
  if (opt) opt.textContent = WORKFLOWS[id].label;
}

function saveEditor() {
  const id = $("workflow").value;
  let obj;
  try { obj = JSON.parse($("editorJson").value); }
  catch (e) { $("editorMsg").innerHTML = `<span class="edited">JSON 오류: ${esc(e.message)}</span>`; return; }
  const errs = validateSpec(obj);
  if (errs.length) { $("editorMsg").innerHTML = `<span class="edited">${errs.map(esc).join("<br>")}</span>`; return; }

  // 질문 키가 그대로면 기존 자동 판정 규칙 유지, 바뀌면 일반 규칙으로 대체됩니다.
  const sameKeys = JSON.stringify(Object.keys(obj.questions).sort()) === JSON.stringify(Object.keys(WORKFLOWS[id].questions).sort());
  const spec = { ...WORKFLOWS[id], ...obj, subject: !!obj.subject };
  if (!sameKeys) delete spec.decide;
  WORKFLOWS[id] = spec;

  const o = loadOverrides();
  o[id] = { label: spec.label, desc: spec.desc, subject: !!spec.subject, questions: spec.questions, example: spec.example };
  saveOverrides(o);

  $("editorMsg").innerHTML = sameKeys
    ? '<span class="muted">저장했습니다(자동 판정 규칙 유지).</span>'
    : '<span class="edited">저장했습니다 — 질문 키가 바뀌어 자동 판정은 일반 규칙(신뢰도 기반)을 씁니다.</span>';
  renderOntology(spec, true);
  fillExample(spec);
  refreshOption(id);
  $("result").innerHTML = "";
}

function resetWorkflow() {
  const id = $("workflow").value;
  const o = loadOverrides();
  delete o[id];
  saveOverrides(o);
  location.reload();
}

function exportAll() {
  const blob = new Blob([JSON.stringify(loadOverrides(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "laya-ko-ontology-edits.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── 화면 채우기 ─────────────────────────────────────────────────────────
function fillExample(spec) {
  $("subjectRow").style.display = spec.subject ? "" : "none";
  $("subject").value = spec.example?.subject ?? "";
  $("message").value = spec.example?.message ?? "";
}

function selectWorkflow(id) {
  const spec = WORKFLOWS[id];
  const d = document.getElementById("wfDesc");
  if (d) d.textContent = spec.desc ?? "";
  fillExample(spec);
  renderOntology(spec, !!loadOverrides()[id]);
  $("result").innerHTML = "";
  $("editorBox").style.display = "none";
  $("editorMsg").textContent = "";
}

function init() {
  const overrides = applyOverrides();
  const sel = $("workflow");
  sel.innerHTML = "";
  for (const [id, spec] of Object.entries(WORKFLOWS)) {
    sel.add(new Option(spec.label + (overrides[id] ? " ✎" : ""), id));
  }
  sel.onchange = () => selectWorkflow(sel.value);
  const first = overrides[Object.keys(overrides)[0]] ? Object.keys(overrides)[0] : "support_ticket";
  sel.value = WORKFLOWS[first] ? first : "support_ticket";
  selectWorkflow(sel.value);

  $("loadBtn").onclick = loadModel;
  $("runBtn").onclick = run;
  $("threshold").oninput = () => { $("thresholdVal").textContent = (Number($("threshold").value) / 100).toFixed(2); };
  $("threshold").oninput();
  $("editBtn").onclick = openEditor;
  $("saveBtn").onclick = saveEditor;
  $("resetBtn").onclick = resetWorkflow;
  $("exportBtn").onclick = exportAll;
  $("copyOntoBtn").onclick = async () => {
    const spec = currentSpec();
    await navigator.clipboard?.writeText(specToJson(spec)).catch(() => {});
    $("copyOntoBtn").textContent = "복사됨";
    setTimeout(() => ($("copyOntoBtn").textContent = "온톨로지 JSON 복사"), 1500);
  };
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run();
  });

  initManifests();
}

init();
