/**
 * E2E 전용 vite preview 설정(담당: qa). apps/web/vite.config.ts 를 그대로 쓰되 /api 프록시 대상을
 * 테스트가 띄운 uvicorn 포트(E2E_API_PORT)로 바꾼다. apps/web 를 cwd 로 두고 실행한다:
 *   npx vite preview --config ../../tests/e2e/vite.preview.config.mts --port <P> --strictPort --host 127.0.0.1
 */
import { mergeConfig } from "vite";
import base from "../../apps/web/vite.config";

const apiPort = process.env.E2E_API_PORT ?? "8000";

export default mergeConfig(base, {
  preview: {
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
});
