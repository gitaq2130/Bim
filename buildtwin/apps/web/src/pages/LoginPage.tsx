import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLogin } from "../api/hooks";
import { ErrorBox } from "../components/ErrorBox";
import { useStore } from "../store";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const setAuth = useStore((s) => s.auth.login);
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(
      { username, password },
      {
        onSuccess: (r) => {
          setAuth({ token: r.access_token, role: r.role, userId: r.user_id });
          nav(loc.state?.from ?? "/projects", { replace: true });
        },
      },
    );
  };

  return (
    <div className="center-page">
      <form className="card" onSubmit={submit}>
        <h1>BuildTwin 로그인</h1>
        <label className="field">
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <ErrorBox error={login.error} />
        <button type="submit" className="primary" disabled={login.isPending}>
          {login.isPending ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
