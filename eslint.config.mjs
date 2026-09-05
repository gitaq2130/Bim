import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "android/**",
    "artifact/dist/**",

    // 앱과 별개로 도는 스탠드얼론 스크립트. 각자 package.json 과 런타임을
    // 가지므로 Next.js 앱의 린트 규칙 대상이 아니다.
    "tools-site/**",
    "doc-automation/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
