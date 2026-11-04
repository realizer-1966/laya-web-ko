// 실제 모델 경로에서만 필요한 무거운 의존성을 동적 로드합니다(시뮬레이션 모드는 이 파일을 불러오지 않음).
const ortMod = await import("./vendor/ort.min.mjs");
const tokMod = await import("./vendor/tokenizers.min.mjs");
const coreMod = await import("./laya-core.js");

export const ort = ortMod.default?.InferenceSession ? ortMod.default : ortMod; // ort는 네임스페이스 혹은 default 모두 허용
export const Tokenizer = tokMod.Tokenizer ?? tokMod.default?.Tokenizer;
export const Laya = coreMod.Laya;