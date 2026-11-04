// Laya (다국어) 워크플로우·온톨로지 데모 — 한국어판.
// 원본 web/workflows.js 의 구조와 동작을 그대로 따르고, 문구만 한국어로 옮겼습니다.
// 추가로 온톨로지 표시 + 편집(로컬 저장) 기능이 붙어 있습니다.
import { Laya } from "./laya-core.js";

const $ = (id) => document.getElementById(id);

// 모델 빌드 위치. 쿼리 파라미터로 덮어쓸 수 있습니다.
const BASES = {
  ml: { label: "Laya (다국어, 100+ 언어)", dir: "./model-multilingual/", param: "modelBaseMultilingual" },
};
let MODEL_DIR = BASES.ml.dir;
let MANIFEST = null;

const AUTO = "auto", HOLD = "hold", BLOCK = "block";
const chip = (t) => t;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x * 100).toFixed(0) + "%";

// 원본과 같은 아홉 개 워크플로우. questions 는 그 업무에 고정된 타입 스키마이며,
// 방문자가 입력한 문장과 무관하게 고정됩니다. toState 가 Laya 에 넣을 state 를 만들고,
// decide 가 Laya 의 답을 읽어 실제 조치를 정합니다.
const WORKFLOWS = {
  "support-tickets": {
    label: "지원 티켓 → 담당 팀 배정",
    description: "티켓을 팀 대기열과 우선순위로 보내거나, 판단이 어려우면 사람에게 넘깁니다.",
    needsSubject: true,
    questions: {
      team: { type: "choice", instructions: "이 티켓은 어떤 팀이 처리해야 합니까?", criteria: { bug: "앱이 꺼지거나 종료되는 고장·오작동", how_to: "사용법에 대한 질문입니다", feature_request: "새 기능을 요청하는 글입니다", account_access: "로그인, 비밀번호 또는 계정 접근 문제" } },
      urgency: { type: "score", instructions: "이 요청이 얼마나 급합니까?", criteria: ["기다려도 됨", "이번 주 안에", "오늘 안에", "지금 즉시"] },
      angry: { type: "noul", instructions: "고객이 화가 나 있습니다" },
    },
    toState: (subject, text) => ({ ticket: { subject: subject || "(제목 없음)", text } }),
    decide(a, thr) {
      const team = a.team, urg = a.urgency, angry = a.angry;
      const level = urg.legend[String(Math.round(urg.score))] ?? urg.legend["0"];
      const chips = [chip(`팀: ${team.choice}`), chip(`우선순위: ${level}`), chip(angry.noul >= 0.5 ? "고객이 화가 남" : "고객은 차분함")];
      if (team.confidence >= thr && urg.confidence >= thr)
        return { status: AUTO, title: `${team.choice} 팀으로 배정, 우선순위 "${level}"`, detail: `팀 배정과 긴급도 판단 모두 확신이 높아(≥ ${thr.toFixed(2)}) 티켓을 자동으로 접수했습니다.`, chips };
      return { status: HOLD, title: `제안: ${team.choice} 팀, 우선순위 "${level}" — 사람 확인 필요`, detail: `팀 판단 신뢰도 ${team.confidence.toFixed(2)}, 긴급도 신뢰도 ${urg.confidence.toFixed(2)}, 기준 ${thr.toFixed(2)}. 신뢰도가 기준보다 낮아 제안을 붙여 분류 대기열로 보냅니다.`, chips };
    },
    examples: [
      { subject: "앱 실행하자마자 꺼짐", text: "지난 업데이트 이후로 앱을 열면 바로 꺼집니다. 한 시간 뒤에 시연이 있어요!" },
      { subject: "또 작업 내용을 잃었습니다", text: "이번 달에 벌써 세 번째로 작업물이 사라졌어요. 정말 지칩니다. 고쳐주세요." },
    ],
  },

  "agent-guardrails": {
    label: "에이전트 명령 → 승인 또는 차단",
    description: "AI 에이전트가 실행하려는 계획을 통제합니다. 위험 신호가 하나라도 있으면 신뢰도와 무관하게 차단합니다.",
    questions: {
      destructive: { type: "noul", instructions: "이 작업은 되돌릴 수 없는 파괴적 작업입니다" },
      needs_human: { type: "noul", instructions: "실행 전에 사람의 승인이 필요합니다" },
      safe_without_approval: { type: "noul", instructions: "사람 승인 없이 실행해도 안전합니다" },
      risk: { type: "score", instructions: "이 작업의 위험도는 얼마나 됩니까?", criteria: ["낮음", "보통", "높음", "치명적"] },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const { destructive, needs_human, safe_without_approval, risk } = a;
      const chips = [chip(`파괴적: ${destructive.noul >= 0.5 ? "예" : "아니오"} (${pct(destructive.noul)})`), chip(`사람 승인 필요: ${needs_human.noul >= 0.5 ? "예" : "아니오"} (${pct(needs_human.noul)})`), chip(`위험도: ${risk.legend[String(Math.round(risk.score))]}`)];
      if (needs_human.noul >= 0.5 || destructive.noul >= 0.5 || Math.round(risk.score) >= 2)
        return { status: BLOCK, title: "차단 — 사람 승인 대기", detail: "“사람 승인 필요”, “파괴적”, “높음/치명적 위험” 중 하나라도 더 그럴듯하면 신뢰도와 상관없이 차단합니다. 실제 승인 게이트가 실패 시 안전하게 닫히는(fail-closed) 방식과 같습니다.", chips };
      if (safe_without_approval.noul >= 0.5 && safe_without_approval.confidence >= thr)
        return { status: AUTO, title: "승인 — 자동 실행", detail: `모든 위험 신호가 "안전" 을 가리키고, "승인 없이 안전" 판단의 신뢰도가 기준(≥ ${thr.toFixed(2)})을 넘었습니다.`, chips };
      return { status: HOLD, title: "검토 대기 — 판단이 애매함", detail: "위험하다고 볼 근거는 없지만, 사람 없이 넘겨도 된다고 확신할 만큼은 아닙니다.", chips };
    },
    examples: [
      { text: "에이전트 계획: 운영 데이터베이스에서 `DELETE FROM customers WHERE last_login < '2020-01-01'` 실행. 백업도 없고 사람 검토도 없음." },
      { text: "에이전트 계획: 새 기능 브랜치를 만들고 변경 사항으로 드래프트 PR을 올린다." },
    ],
  },

  "content-moderation": {
    label: "댓글 → 게시, 보류 또는 삭제",
    description: "공개 댓글을 통제합니다. 확신이 있을 때만 자동 처리하고, 아니면 사람 검토자에게 넘깁니다.",
    questions: {
      verdict: { type: "choice", instructions: "이 댓글은 어떻게 처리해야 합니까?", criteria: { allow: "게시해도 됨", review: "사람 검토 필요", remove: "규정 위반이라 삭제해야 함" } },
      toxicity: { type: "score", instructions: "언어가 얼마나 독합니까?", criteria: ["없음", "약함", "강함", "심각"] },
      spam: { type: "noul", instructions: "이 댓글은 스팸 또는 광고입니다" },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const v = a.verdict, tox = a.toxicity, spam = a.spam;
      const chips = [chip(`판정: ${v.choice} (${pct(v.probabilities[v.choice])})`), chip(`독성: ${tox.legend[String(Math.round(tox.score))]}`), chip(spam.noul >= 0.5 ? "스팸으로 보임" : "스팸 아님")];
      if (v.confidence < thr) return { status: HOLD, title: "검토자에게 보류", detail: `판정 신뢰도(${v.confidence.toFixed(2)})가 기준 ${thr.toFixed(2)} 보다 낮아 자동 적용하지 않았습니다.`, chips };
      if (v.choice === "remove") return { status: BLOCK, title: "자동 삭제", detail: `"삭제" 로 확신 있게 판정했습니다(≥ ${thr.toFixed(2)}).`, chips };
      if (v.choice === "allow") return { status: AUTO, title: "자동 게시", detail: `"게시" 로 확신 있게 판정했습니다(≥ ${thr.toFixed(2)}).`, chips };
      return { status: HOLD, title: "검토자에게 보류", detail: "모델 스스로 사람이 봐야 한다고 판단했습니다.", chips };
    },
    examples: [
      { text: "당신은 완전히 멍청하고 여기 있는 모두가 그걸 압니다. 닥쳐요." },
      { text: "좋은 글이네요. 설정 방법 자세히 설명해줘서 고맙습니다!" },
    ],
  },

  "it-incidents": {
    label: "모니터링 경보 → 담당 팀 호출 또는 기록",
    description: "심각하거나 치명적인 장애는 담당 팀을 즉시 호출하고, 그 외에는 티켓으로 기록합니다.",
    questions: {
      severity: { type: "score", instructions: "이 장애는 얼마나 심각합니까?", criteria: ["경미", "보통", "심각", "치명적"] },
      owner: { type: "choice", instructions: "어느 팀이 담당해야 합니까?", criteria: { network: "네트워크·DNS", database: "데이터베이스", application: "애플리케이션 개발팀", security: "보안팀" } },
      customer_impact: { type: "noul", instructions: "지금 고객이 영향을 받고 있습니다" },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const sev = a.severity, owner = a.owner, impact = a.customer_impact;
      const level = sev.legend[String(Math.round(sev.score))];
      const chips = [chip(`severity: ${level}`), chip(`owner: ${owner.choice}`), chip(impact.noul >= 0.5 ? "지금 고객 영향 있음" : "고객 영향 보고 없음")];
      if (Math.round(sev.score) >= 2) return { status: BLOCK, title: `${owner.choice} 팀 즉시 호출`, detail: "심각·치명적 장애는 담당 팀 판단 신뢰도가 낮아도 바로 호출합니다 — 장애 대응에서는 놓치는 것보다 잘못 부르는 쪽이 쌉니다.", chips };
      if (owner.confidence >= thr) return { status: AUTO, title: `${owner.choice} 팀에 기록, 호출 없음`, detail: `경미·보통 장애이고 담당 팀 판단이 확실합니다(≥ ${thr.toFixed(2)}).`, chips };
      return { status: HOLD, title: "기록했지만 담당 팀이 불분명", detail: `담당 팀 신뢰도 ${owner.confidence.toFixed(2)} 가 기준 ${thr.toFixed(2)} 보다 낮아, 사람이 어느 팀인지 분류해야 합니다.`, chips };
    },
    examples: [
      { text: "경보: 주 데이터베이스 CPU가 20분째 100%입니다. 모든 사용자의 검색과 로그인이 500 오류를 반환합니다." },
      { text: "로그 서버 디스크 사용량이 71%입니다. 영향받는 서비스는 없습니다." },
    ],
  },

  "email-triage": {
    label: "이메일 → 조치와 기한을 붙여 분류",
    description: "이메일을 조치 대기열(지금 답장, 나중에 답장, 보관, 전달)에 기한과 함께 분류합니다.",
    questions: {
      action: { type: "choice", instructions: "이 이메일로 수신자가 무엇을 해야 합니까?", criteria: { reply_now: "오늘 답장", reply_later: "이번 주 안에 답장", archive: "답장 필요 없음", delegate: "다른 사람에게 전달" } },
      needs_reply: { type: "noul", instructions: "보낸 사람이 답장을 기대하고 있습니다" },
      urgency: { type: "score", instructions: "이 이메일은 얼마나 급합니까?", criteria: ["낮음", "보통", "높음", "즉시"] },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const act = a.action, reply = a.needs_reply;
      const due = { reply_now: "오늘 마감", reply_later: "이번 주 마감", archive: "마감 없음", delegate: "즉시 전달" }[act.choice];
      const chips = [chip(`action: ${act.choice.replace("_", " ")}`), chip(due), chip(reply.noul >= 0.5 ? "답장 기대" : "답장 기대 없음")];
      if (act.confidence >= thr) return { status: AUTO, title: `분류됨: ${act.choice.replace("_", " ")} (${due})`, detail: `신뢰도 ${act.confidence.toFixed(2)} ≥ ${thr.toFixed(2)} 로 자동 분류했습니다.`, chips };
      return { status: HOLD, title: `제안: ${act.choice.replace("_", " ")} (${due}) — 신뢰도 낮음`, detail: `신뢰도 ${act.confidence.toFixed(2)} 가 기준 ${thr.toFixed(2)} 보다 낮아, 자동 분류 대신 제안 라벨만 붙여 받은편지함에 둡니다.`, chips };
    },
    examples: [
      { text: "긴급: 서버실에 물이 차고 있습니다. 지금 바로 전화 주세요." },
      { text: "뉴스레터: 스프레드시트를 잘 쓰는 열 가지 팁. 언제든 구독을 해지할 수 있습니다." },
    ],
  },

  "delivery-exceptions": {
    label: "배송 예외 → 자동 처리 또는 창고 확인",
    description: "배송 예외를 처리합니다: 지연 알림은 자동 발송, 주소·파손 문제는 사람이 확인합니다.",
    questions: {
      kind: { type: "choice", instructions: "어떤 배송 예외입니까?", criteria: { delay: "배송 지연", address: "주소 문제", damage: "파손·분실", refused: "수령 거부" } },
      customer_contacted: { type: "noul", instructions: "고객이 이미 문의했거나 불만을 제기했습니다" },
      order_value: { type: "score", instructions: "주문 금액은 얼마입니까?", criteria: ["저가(5만원 미만)", "보통(5~20만원)", "고가(20~50만원)", "매우 고가(50만원 이상)"] },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const kind = a.kind, value = a.order_value;
      const band = value.legend[String(Math.round(value.score))];
      const chips = [chip(`kind: ${kind.choice}`), chip(band), chip(a.customer_contacted.noul >= 0.5 ? "고객 이미 문의" : "고객 문의 없음")];
      if (kind.choice === "delay") return { status: AUTO, title: "지연 안내 발송, 보상 쿠폰 조건 확인", detail: "지연은 고객에게 가장 민감한 유형이라 자동 안내를 보냅니다.", chips };
      if (kind.confidence >= thr && Math.round(value.score) <= 1) return { status: AUTO, title: `자동 처리: ${kind.choice}`, detail: `유형 판단 신뢰도 ${kind.confidence.toFixed(2)} ≥ ${thr.toFixed(2)} 이고 ${band} 주문이라 자동 처리합니다.`, chips };
      return { status: HOLD, title: `창고 확인: ${kind.choice}`, detail: `유형 신뢰도 ${kind.confidence.toFixed(2)}, ${band} 주문 — 금액이 크거나 판단이 불확실해 사람이 확인합니다.`, chips };
    },
    examples: [
      { text: "주문 44821: 택배가 3일째 같은 허브에 머물고 있습니다. 고객이 오늘 아침 문의했습니다.", subject: "택배 지연" },
      { text: "주문 51903: 상자가 찌그러진 채 도착했고 노트북 화면이 깨져 있습니다. 환불을 원합니다.", subject: "파손" },
    ],
  },

  "sales-leads": {
    label: "세일즈 리드 → 우선순위와 다음 조치",
    description: "인바운드 리드를 점수화하고, 따뜻한 리드만 영업 담당자에게 넘깁니다.",
    questions: {
      priority: { type: "score", instructions: "이 리드는 얼마나 유망합니까?", criteria: ["차가움", "미지근함", "따뜻함", "뜨거움"] },
      role: { type: "choice", instructions: "연락하는 사람은 의사결정권자입니까?", criteria: { decision_maker: "의사결정권자", influencer: "영향력만 있음", end_user: "최종 사용자", unknown: "알 수 없음" } },
      budget_mentioned: { type: "noul", instructions: "예산이 언급되었습니다" },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const p = a.priority, role = a.role;
      const heat = p.legend[String(Math.round(p.score))];
      const chips = [chip(`priority: ${heat}`), chip(`role: ${role.choice.replace("_", " ")}`), chip(a.budget_mentioned.noul >= 0.5 ? "예산 언급됨" : "예산 언급 없음")];
      if (Math.round(p.score) >= 2 && role.choice === "decision_maker") return { status: AUTO, title: "영업 담당자에게 즉시 배정", detail: `${heat} 리드이고 의사결정권자라 최우선으로 배정합니다.`, chips };
      if (p.confidence >= thr) return { status: AUTO, title: `${heat} 리드로 육성 목록에 추가`, detail: `신뢰도 ${p.confidence.toFixed(2)} ≥ ${thr.toFixed(2)} — 자동 이메일 시퀀스를 시작합니다.`, chips };
      return { status: HOLD, title: "점수 불확실 — 영업 담당자 확인 필요", detail: `점수 신뢰도 ${p.confidence.toFixed(2)} 가 기준 ${thr.toFixed(2)} 보다 낮습니다.`, chips };
    },
    examples: [
      { text: "안녕하세요, 저는 데이터 팀을 이끄는 CTO입니다. 4분기 예산 8천만원이 남아 있어 이번 달에 도입을 결정하고 싶습니다." },
      { text: "학생입니다. 과제용으로 써보려고 하는데 무료 체험만 해볼 수 있나요?" },
    ],
  },

  "patient-messages": {
    label: "환자 메시지 → 임상 담당자 라우팅",
    description: "환자 포털 메시지를 분류하고, 응급 신호가 있으면 간호사 호출을 우회해 즉시 연결합니다.",
    questions: {
      kind: { type: "choice", instructions: "이 메시지는 어떤 종류입니까?", criteria: { refill: "처방 재발급", scheduling: "예약 변경", clinical: "임상 질문", billing: "진료비·보험" } },
      clinical_question: { type: "noul", instructions: "답변에 임상적 판단이 필요합니다" },
      urgent: { type: "noul", instructions: "응급 신호가 있습니다" },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const k = a.kind, clin = a.clinical_question, urg = a.urgent;
      const chips = [chip(`kind: ${k.choice}`), chip(clin.noul >= 0.5 ? "임상 판단 필요" : "임상 판단 불필요"), chip(urg.noul >= 0.5 ? "응급 신호" : "응급 아님")];
      if (urg.noul >= 0.5) return { status: BLOCK, title: "즉시 간호사 호출 — 자동 응답하지 않음", detail: `응급 신호 확률 ${(urg.noul * 100).toFixed(1)}%. 응급 신호가 있으면 어떤 자동 응답도 보내지 않습니다.`, chips };
      if ((k.choice === "refill" || k.choice === "scheduling") && k.confidence >= thr) return { status: AUTO, title: `자동 처리: ${k.choice}`, detail: `신뢰도 ${k.confidence.toFixed(2)} ≥ ${thr.toFixed(2)} 이고 임상 판단이 필요 없는 행정 요청입니다.`, chips };
      return { status: HOLD, title: "담당 간호사에게 전달", detail: `유형 신뢰도 ${k.confidence.toFixed(2)}, 기준 ${thr.toFixed(2)} — 환자 건강 관련 메시지는 판단이 불확실하면 사람이 봅니다.`, chips };
    },
    examples: [
      { text: "혈압약 리필을 요청하고 싶습니다. 다음 주에 떨어집니다." },
      { text: "어제부터 가슴이 조이고 숨이 차는데, 새 약 때문인가요? 지금 응급실에 가야 하나요?" },
    ],
  },

  "product-reviews": {
    label: "제품 리뷰 → 감정과 게시 여부 판정",
    description: "리뷰의 감정과 안전 문제를 판정합니다. 안전 이슈나 협박은 자동 게시하지 않습니다.",
    questions: {
      sentiment: { type: "choice", instructions: "이 리뷰의 전체 감정은 무엇입니까?", criteria: { positive: "긍정적", neutral: "중립적", negative: "부정적", hostile: "적대적·협박" } },
      safety_issue: { type: "noul", instructions: "안전 문제(부상, 화재, 알레르기 등)를 언급합니다" },
      spam: { type: "noul", instructions: "광고 또는 스팸으로 보입니다" },
    },
    toState: (subject, text) => text,
    decide(a, thr) {
      const s = a.sentiment, safe = a.safety_issue, spam = a.spam;
      const chips = [chip(`sentiment: ${s.choice}`), chip(safe.noul >= 0.5 ? "안전 문제 언급" : "안전 문제 없음"), chip(spam.noul >= 0.5 ? "스팸 의심" : "스팸 아님")];
      if (s.choice === "hostile" || safe.noul >= 0.5) return { status: BLOCK, title: "자동 게시 보류 — 안전/브랜드 검토 필요", detail: `적대적 리뷰이거나 안전 문제 언급(안전 확률 ${(safe.noul * 100).toFixed(1)}%)이라 자동 게시하지 않습니다.`, chips };
      if (spam.noul >= 0.5) return { status: HOLD, title: "스팸 의심 — 검토 대기열", detail: `스팸 확률 ${(spam.noul * 100).toFixed(1)}%.`, chips };
      if (s.confidence >= thr) return { status: AUTO, title: `게시: ${s.choice}`, detail: `감정 신뢰도 ${s.confidence.toFixed(2)} ≥ ${thr.toFixed(2)}, 안전 문제 없음.`, chips };
      return { status: HOLD, title: "검토 대기열로 이동", detail: `감정 신뢰도 ${s.confidence.toFixed(2)} 가 기준 ${thr.toFixed(2)} 보다 낮습니다.`, chips };
    },
    examples: [
      { text: "세 번째 구매입니다. 배송도 빠르고 포장도 깔끔했어요. 다음에도 여기서 살게요." },
      { text: "충전 중에 연기가 났습니다. 집에 불이 날 뻔했어요. 환불은커녕 연락도 안 옵니다." },
    ],
  },
};

const ORDER = Object.keys(WORKFLOWS);

const statusEl = $("status"), loadBtn = $("loadBtn"), runBtn = $("runBtn"), variantSel = $("variant");

let engine = null, manifests = {}, loadedLabel = "";
const STORE = "laya.workflows.ko.v1";
let overrides = {};
try { overrides = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { overrides = {}; }

// 편집본을 기본 정의 위에 덮어씁니다(질문 키가 바뀌면 decide 규칙은 일반 규칙으로 대체).
function applyOverride(id, base) {
  const ov = overrides[id];
  if (!ov) return base;
  const sameKeys = JSON.stringify(Object.keys(ov.questions ?? {}).sort()) === JSON.stringify(Object.keys(base.questions ?? {}).sort());
  const out = { ...base, ...ov };
  if (!sameKeys || typeof ov.decide !== "function") out.decide = genericDecide;
  return out;
}

function genericDecide(a, t) {
  const qs = Object.keys(a);
  const weakest = qs.reduce((w, k) => (a[k].confidence < a[w].confidence ? k : w), qs[0]);
  const status = a[weakest].confidence >= t ? AUTO : HOLD;
  return { status, title: status === AUTO ? "신뢰도 기준 통과 — 자동 처리" : "신뢰도 부족 — 사람 확인", detail: "편집된 온톨로지에는 전용 규칙이 없어 신뢰도 기반 일반 규칙으로 판정했습니다.", chips: [chip(weakest, a[weakest].confidence.toFixed(2))] };
}

async function init() {
  fillDomainSelect();
  onDomainChange();
  loadBtn.addEventListener("click", loadModel);
  $("domain").addEventListener("change", onDomainChange);
  $("exampleBtn").addEventListener("click", () => {
    const spec = currentSpec();
    const i = Number($("exampleBtn").dataset.i || 0) % spec.examples.length;
    $("message").value = spec.example ?? spec.examples[i];
    $("exampleBtn").dataset.i = i + 1;
    $("subject").value = spec.needsSubject ? ($("subject").value || "예시 제목") : "";
  });
  runBtn.addEventListener("click", run);
  $("thresh").addEventListener("input", () => { $("threshVal").textContent = Number($("thresh").value).toFixed(2); });
  const ms = await probeAll();
  if (!Object.keys(ms).length) {
    variantSel.innerHTML = '<option>모델 없음 — 빌드 후 사용 가능</option>';
    variantSel.disabled = true;
    loadBtn.disabled = true;
    setStatus("모델 manifest를 찾을 수 없습니다. 워크플로우·온톨로지 편집은 그대로 사용할 수 있습니다.");
    return;
  }
  manifests = ms;
  const opts = [];
  for (const [bk, man] of Object.entries(ms)) {
    for (const [vk, v] of Object.entries(man.variants || {})) {
      const mb = v.bytes ? Math.round(v.bytes / 1e6) : null;
      opts.push(`<option value="${vk}" data-base="${bk}">${vk} — ${v.label || ""}${mb ? ` (약 ${mb} MB)` : ""}</option>`);
    }
  }
  variantSel.innerHTML = opts.join("");
  $("baseModelRow").style.display = "";
  $("loadCard").style.display = "";
  setStatus(`모델 준비됨: ${variantSel.value}. "모델 로드"를 누르세요.`);
}

function setStatus(text, busy = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("busy", busy);
}
function setProgress(frac) {
  $("progress").hidden = frac === null;
  if (frac !== null) $("progressBar").style.width = `${Math.round(frac * 100)}%`;
}
function badges(list) {
  $("badges").innerHTML = "";
  for (const b of list) {
    const el = document.createElement("span");
    el.className = "badge";
    el.innerHTML = b.href ? `<a href="${b.href}" target="_blank" rel="noopener">${b.text} ↗</a>` : b.text;
    el.id = `badge-${b.id}`;
    $("badges").appendChild(el);
  }
}

function resolveBase(def) {
  const q = new URLSearchParams(location.search).get(def.param);
  const override = q ?? (typeof window !== "undefined" ? window.__SITE_CONFIG__?.[def.configKey] : null);
  if (override === null || override === undefined) return def.dir;
  return String(override).replace(/\/?$/, "/");
}

async function probeAll() {
  const out = {};
  await Promise.all(Object.entries(BASES).map(async ([k, def]) => {
    const m = await probeBase(def);
    if (m) out[k] = m;
  }));
  return out;
}

async function probeBase(def) {
  const base = resolveBase(def);
  try {
    const r = await fetch(base + "manifest.json", { cache: "no-store" });
    if (!r.ok) return null;
    return { ...(await r.json()), base, key: def.param };
  } catch { return null; }
}

function setLoading() {
  loadBtn.disabled = true;
  loadBtn.textContent = "로드 중…";
  runBtn.disabled = true;
}
function setReady() {
  loadBtn.disabled = false;
  loadBtn.textContent = "모델 로드";
  runBtn.disabled = false;
}

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
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

async function fetchParts(dir, entry, onProgress) {
  let cache = null;
  try { cache = await caches.open("laya-" + entry.sha256.slice(0, 16)); } catch { /* 사생활 보호 모드 */ }
  const out = new Uint8Array(entry.size); let off = 0;
  for (const part of entry.parts) {
    const url = dir + part;
    let bytes = null;
    try { const hit = cache && await cache.match(url); if (hit) bytes = new Uint8Array(await hit.arrayBuffer()); } catch {}
    if (!bytes) {
      bytes = await fetchBytes(url, (got) => onProgress?.(off + got, entry.size));
      try { if (cache) await cache.put(url, new Response(bytes)); } catch {}
    }
    if (off + bytes.length > entry.size) throw new Error("가중치가 manifest 크기보다 큽니다");
    out.set(bytes, off); off += bytes.length; onProgress?.(off, entry.size);
  }
  if (off !== entry.size) throw new Error(`가중치 불완전: ${off} / ${entry.size} 바이트`);
  return out;
}

async function loadModel() {
  const opt = variantSel.selectedOptions[0];
  if (!opt || !manifests[opt.dataset.base]) return;
  const man = manifests[opt.dataset.base];
  const v = man.variants[opt.value];
  const dir = man.base;
  setLoading();
  setProgress(0);
  loadBtn.textContent = "다운로드 중…";
  try {
    // index.html 과 동일한 실제 추론 경로(runtime.js → laya-core.js)
    const { ort, Tokenizer, Laya } = await import("./runtime.js");
    ort.env.wasm.wasmPaths = new URL("./vendor/", import.meta.url).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

    setStatus("토크나이저와 설정을 불러오는 중…", true);
    const [tj, tc, cfg] = await Promise.all(
      ["tokenizer.json", "tokenizer_config.json", "rl_agent_config.json"].map((f) =>
        fetch(dir + f).then((r) => { if (!r.ok) throw new Error(f + ": HTTP " + r.status); return r.json(); })));
    const tokenizer = new Tokenizer(tj, tc);
    tokenizer.config = tc; // 특수토큰(<bos>/<eos>/<mask>/<pad>)을 토크나이저 설정에서 읽습니다

    const graph = await fetchBytes(dir + v.onnx);
    const data = await fetchParts(dir, v.data, (got, total) => {
      setProgress(total ? got / total : null);
      setStatus(`가중치 다운로드 중: ${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`, true);
    });

    setStatus("추론 세션 생성 중 (첫 실행은 시간이 걸릴 수 있습니다)…", true);
    setProgress(null);
    const session = await ort.InferenceSession.create(graph, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      externalData: [{ path: v.data.name, data }],
    });
    engine = new Laya(ort, session, tokenizer, cfg);
    loadedLabel = `${opt.dataset.base}/${opt.value}`;
    setProgress(null);
    setStatus("모델 준비 완료. 메시지를 넣고 실행하세요.", false);
    badges([{ id: "load", text: "모델 로드됨" }, { id: "backend", text: `backend: wasm${ort.env.wasm.numThreads > 1 ? ` · ${ort.env.wasm.numThreads} 스레드` : ""}` }]);
    setReady();
  } catch (e) {
    console.error(e);
    engine = null; loadedLabel = "";
    setStatus(`모델 로드 실패: ${e.message}`, false);
    setProgress(null);
    badges([{ id: "err", text: "모델 없음" }]);
    setReady();
  }
}

/* ------------------------------------------------------- 입력/온톨로지 */
function currentSpec() {
  const id = $("domain").value;
  return applyOverride(id, WORKFLOWS[id]);
}

function renderOntology() {
  const box = $("ontology");
  const spec = currentSpec();
  const qs = spec.questions ?? {};
  const keys = Object.keys(qs);
  box.innerHTML = "";
  for (const k of keys) {
    const q = qs[k];
    const wrap = document.createElement("div");
    wrap.className = "q";
    const head = document.createElement("div");
    head.className = "qhead";
    head.innerHTML = `<span class="qname">${esc(k)}</span><span class="qtype">${q.type.toUpperCase()}</span>`;
    wrap.appendChild(head);
    const ins = document.createElement("div");
    ins.className = "qins";
    ins.textContent = q.instructions ?? "";
    wrap.appendChild(ins);
    const list = document.createElement("div");
    list.className = "crit";
    if (Array.isArray(q.criteria)) {
      q.criteria.forEach((c, i) => list.appendChild(chipEl(`${i} · ${c}`)));
    } else if (q.criteria && typeof q.criteria === "object") {
      for (const [ck, cv] of Object.entries(q.criteria)) list.appendChild(chipEl(`${ck} · ${cv}`));
    } else {
      list.appendChild(chipEl("예 / 아니오"));
    }
    wrap.appendChild(list);
    box.appendChild(wrap);
  }
}

function chipEl(text) {
  const s = document.createElement("span");
  s.className = "chip";
  s.textContent = text;
  return s;
}

function applyDomain() {
  const spec = currentSpec();
  $("domainDesc").textContent = spec.description ?? "";
  $("subjectField").hidden = !spec.needsSubject;
  const ex = spec.examples?.[0];
  if (ex) {
    $("message").value = ex.message ?? "";
    if (spec.needsSubject) $("subject").value = ex.subject ?? "";
  }
  renderOntology();
  $("resultCard").hidden = true;
  setStatus(engine ? "모델 준비 완료. 메시지를 넣고 실행하세요." : "모델을 먼저 로드하세요.", false);
}

/* ------------------------------------------------------------- 실행 */
function barRow(key, label, prob, chosen, sub) {
  const row = document.createElement("div");
  row.className = "bar" + (chosen ? " chosen" : "");
  row.innerHTML =
    `<span class="k">${esc(label)}</span><span class="w"><i style="width:${Math.max(1, Math.round(prob * 100))}%"></i></span>` +
    `<span class="v">${key === "score" ? sub : (prob * 100).toFixed(1) + "%"}</span>`;
  return row;
}

function renderAnswers(spec, answers, elapsed, tokens) {
  const box = $("answers");
  box.innerHTML = "";
  for (const [qid, a] of Object.entries(answers)) {
    const q = spec.questions[qid];
    const wrap = document.createElement("div");
    wrap.className = "q";
    const head = document.createElement("div");
    head.className = "qhead";
    head.innerHTML = `<span class="qname">${esc(qid)}</span><span class="qtype">${(q?.type ?? a.type ?? "").toUpperCase()}</span>` +
      `<span class="muted" style="margin-left:auto">신뢰도 ${a.confidence.toFixed(3)}</span>`;
    wrap.appendChild(head);

    if (a.type === "choice") {
      const sorted = Object.entries(a.probs).sort((x, y) => y[1] - x[1]);
      for (const [k, p] of sorted) wrap.appendChild(barRow("choice", k, p, k === a.choice));
    } else if (a.type === "score") {
      const max = Math.max(...Object.values(a.probs));
      for (const [k, p] of Object.entries(a.probs)) {
        wrap.appendChild(barRow("score", `${k} · ${(q?.criteria ?? [])[Number(k)] ?? ""}`, p, p === max));
      }
      wrap.appendChild(barRow("score", "점수", 1, true, a.score.toFixed(2)));
    } else {
      wrap.appendChild(barRow("noul", "참", a.probYes, a.probYes >= 0.5));
      wrap.appendChild(barRow("noul", "거짓", 1 - a.probYes, a.probYes < 0.5));
    }
    box.appendChild(wrap);
  }

  const verdict = spec.decide(answers, Number($("thresh").value), loadedLabel);
  const oc = $("outcome");
  oc.className = "outcome " + verdict.status;
  oc.innerHTML = `<div class="ostatus">${verdict.status}</div><div class="otitle">${esc(verdict.title)}</div>` +
    `<div class="odetail">${esc(verdict.detail)}</div>` +
    (verdict.chips?.length ? `<div class="ochips">${verdict.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : "");
  oc.hidden = false;

  $("raw").textContent = JSON.stringify({ workflow: $("domain").value, model: loadedLabel, elapsed_ms: Math.round(elapsed), prompt_tokens: tokens, answers }, null, 2);
}

async function run() {
  if (!engine || !loadedLabel) return setStatus("모델이 로드되지 않았습니다. 위에서 로드하세요.", true);
  const spec = currentSpec();
  const message = $("message").value.trim();
  if (!message) return setStatus("메시지를 입력하세요.", true);
  const state = {};
  if (spec.needsSubject) state.subject = $("subject").value.trim();
  state.message = message;

  $("runBtn").disabled = true;
  $("resultCard").hidden = false;
  $("answers").innerHTML = "";
  $("outcome").hidden = true;
  $("raw").textContent = "";
  const t0 = performance.now();
  try {
    const res = await engine.systemOne(state, spec.questions);
    const elapsed = performance.now() - t0;
    const tokens = res.usage?.input_tokens ?? 0;
    renderAnswers(spec, res.answers, elapsed, tokens);
    setStatus(`추론 완료 · ${Math.round(elapsed)} ms · ${tokens} 토큰`, false);
  } catch (e) {
    console.error(e);
    setStatus(`실행 실패: ${e.message}`, true);
  } finally {
    $("runBtn").disabled = false;
  }
}

/* --------------------------------------------------------- 온톨로지 편집 */

function saveOverrides() {
  try { localStorage.setItem(STORE, JSON.stringify(overrides)); } catch {}
}


function fillDomainSelect() {
  const sel = $("domain");
  sel.innerHTML = "";
  for (const id of ORDER) {
    const spec = currentSpec0(id);
    sel.add(new Option(spec.label + (overrides[id] ? " ✎" : ""), id));
  }
}

function currentSpec0(id) {
  const base = WORKFLOWS[id];
  const o = overrides[id];
  return o ? { ...base, ...o, id } : base;
}

function openEditor() {
  const spec = currentSpec();
  const json = { label: spec.label, description: spec.description, needsSubject: !!spec.needsSubject, questions: spec.questions };
  $("editorJson").value = JSON.stringify(json, null, 2);
  $("editorBox").style.display = "block";
  $("editorMsg").textContent = "";
  $("editorBox").scrollIntoView({ block: "nearest" });
}

function saveEditor() {
  let obj;
  try { obj = JSON.parse($("editorJson").value); } catch (e) { return ($("editorMsg").textContent = `JSON 오류: ${e.message}`); }
  if (!obj || typeof obj !== "object" || !obj.questions || typeof obj.questions !== "object") {
    return ($("editorMsg").textContent = "questions 객체가 필요합니다.");
  }
  const id = $("domain").value;
  const base = WORKFLOWS[id];
  for (const [qid, q] of Object.entries(obj.questions)) {
    if (!["choice", "score", "noul"].includes(q?.type)) return ($("editorMsg").textContent = `${qid}: type 은 choice/score/noul 중 하나여야 합니다.`);
    if (q.type === "choice" && (typeof q.criteria !== "object" || Array.isArray(q.criteria))) return ($("editorMsg").textContent = `${qid}: choice 는 criteria 객체가 필요합니다.`);
    if (q.type === "score" && !Array.isArray(q.criteria)) return ($("editorMsg").textContent = `${qid}: score 는 criteria 배열이 필요합니다.`);
    if (!q.instructions) return ($("editorMsg").textContent = `${qid}: instructions 가 필요합니다.`);
  }
  const sameKeys = JSON.stringify(Object.keys(obj.questions).sort()) === JSON.stringify(Object.keys(base.questions).sort());
  // 자동 판정 규칙은 질문 정의가 바뀌면 의미가 달라진다. 키가 같으면 그대로 유지.
  overrides[id] = { label: obj.label ?? base.label, description: obj.description ?? base.description, needsSubject: !!obj.needsSubject, questions: obj.questions };
  saveOverrides();
  fillDomainSelect();
  $("domain").value = id;
  onDomainChange();
  $("editorMsg").textContent = sameKeys
    ? "저장했습니다. 질문 키가 같아 기존 자동 판정 규칙을 그대로 씁니다."
    : "저장했습니다. 질문 키가 바뀌어 자동 판정은 신뢰도 기반 일반 규칙으로 판정합니다.";
}

function exportAll() {
  const out = {};
  for (const id of ORDER) out[id] = currentSpec0(id);
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "laya-workflows-ko.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function resetWorkflow() {
  delete overrides[$("domain").value];
  saveOverrides();
  const id = $("domain").value;
  fillDomainSelect();
  $("domain").value = id;
  onDomainChange();
  $("editorMsg").textContent = "이 워크플로우를 기본값으로 되돌렸습니다.";
}

function copyOntology() {
  const spec = currentSpec();
  const json = JSON.stringify({ label: spec.label, needsSubject: !!spec.needsSubject, questions: spec.questions }, null, 2);
  navigator.clipboard?.writeText(json).then(
    () => ($("editorMsg").textContent = "온톨로지 JSON을 클립보드에 복사했습니다."),
    () => ($("editorMsg").textContent = "복사에 실패했습니다.")
  );
}

/* --------------------------------------------------------------- wiring */
let exampleIndex = 0;

function onDomainChange() {
  const spec = currentSpec();
  $("domainDesc").textContent = spec.description ?? "";
  $("subjectField").hidden = !spec.needsSubject;
  renderOntology();
  const ex = spec.examples?.[0];
  if (ex) {
    $("message").value = ex.message;
    if (spec.needsSubject) $("subject").value = ex.subject ?? "";
  }
  $("exampleBtn").textContent = spec.examples?.length > 1 ? `예시 문장 (${(exampleIndex % spec.examples.length) + 1}/${spec.examples.length})` : "예시 문장";
  $("resultCard").hidden = true;
  $("outcome").hidden = true;
  $("answers").innerHTML = "";
  $("raw").textContent = "";
}

$("domain").addEventListener("change", () => { exampleIndex = 0; onDomainChange(); });
$("exampleBtn").addEventListener("click", () => {
  const spec = currentSpec();
  const list = spec.examples ?? [];
  if (!list.length) return;
  exampleIndex = (exampleIndex + 1) % list.length;
  const ex = list[exampleIndex];
  $("message").value = ex.message;
  if (spec.needsSubject) $("subject").value = ex.subject ?? "";
  $("exampleBtn").textContent = list.length > 1 ? `예시 문장 (${exampleIndex + 1}/${list.length})` : "예시 문장";
});
$("thresh").addEventListener("input", () => ($("threshVal").textContent = Number($("thresh").value).toFixed(2)));
$("runBtn").addEventListener("click", run);
$("editBtn").addEventListener("click", openEditor);
$("saveBtn").addEventListener("click", saveEditor);
$("exportBtn").addEventListener("click", exportAll);
$("resetBtn").addEventListener("click", resetWorkflow);
$("copyOntoBtn").addEventListener("click", copyOntology);
$("editorCancelBtn").addEventListener("click", () => ($("editorBox").hidden = true));
$("message").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});

fillDomainSelect();
$("threshVal").textContent = Number($("thresh").value).toFixed(2);
onDomainChange();
init();
