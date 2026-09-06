/**
 * viewer3d 전용 vitest 설정.
 * 저장소 루트(/home/user/Bim)의 postcss.config.mjs(@tailwindcss/postcss) 가 vite 탐색에 걸려
 * 테스트가 시작조차 못 하는 문제를 우회한다(인라인 postcss 설정 → 상위 탐색 중단).
 * 사용: `npx vitest run --config src/viewer3d/vitest.config.ts`
 * apps/web 전체의 근본 해결(vite.config.ts 의 css.postcss 또는 apps/web/postcss.config.cjs)은 frontend 담당.
 */
import { mergeConfig } from "vitest/config";
import base from "../../vite.config";

export default mergeConfig(base, {
  css: { postcss: { plugins: [] } },
  test: { include: ["src/viewer3d/**/*.test.{ts,tsx}"] },
});
