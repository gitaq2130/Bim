// 자유 입력 + 그룹핑이 필요한 필드를 위한 범용 유틸.
// 사용자가 입력/선택한 텍스트는 displayValue로 그대로 보존하고,
// 그룹핑·검색·통계 등은 별도로 계산되는 normalizedValue를 기준으로 동작시킨다.

export interface FreeTextValue {
  displayValue: string;
  normalizedValue: string;
}

export interface NormalizeConfig {
  /** 정규값 -> 알려진 표기 변형들 (예: "공무" -> ["공무부","공무팀","공무","공무부서"]) */
  aliases?: Record<string, string[]>;
  /** 별칭 테이블에 없을 때 어간을 추출하기 위해 제거할 흔한 접미사 (긴 것부터 검사) */
  suffixes?: string[];
}

const DEFAULT_SUFFIXES = ["관리팀", "경영팀", "보건팀", "환경팀", "부서", "팀", "부"];

export function normalizeFreeText(input: string, config: NormalizeConfig = {}): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const aliases = config.aliases ?? {};
  for (const [canonical, variants] of Object.entries(aliases)) {
    if (canonical === trimmed || variants.includes(trimmed)) return canonical;
  }

  const suffixes = [...(config.suffixes ?? DEFAULT_SUFFIXES)].sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (trimmed.length > suffix.length && trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length);
    }
  }
  return trimmed;
}

export function toFreeTextValue(input: string, config?: NormalizeConfig): FreeTextValue {
  return { displayValue: input.trim(), normalizedValue: normalizeFreeText(input, config) };
}
