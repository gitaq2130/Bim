import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { installSessionCacheGuard } from "./api/sessionCache";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

// ADR 0010 규칙 2: 세션 경계(= auth.userId 의 변화)에서 캐시를 폐기한다. 앱 수명 동안 한 번 설치한다.
// 이 QueryClient 는 앱 싱글턴이므로 로그아웃해도 이전 사용자의 서버 상태가 그대로 남았다 —
// 실측: 다른 계정으로 로그인하면 이전 사용자의 프로젝트가 화면에 뜨고 RequireProjectAccess 까지 통과했다.
installSessionCacheGuard(queryClient);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
