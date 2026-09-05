import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreateProject, useProjects } from "../api/hooks";
import { ErrorBox } from "../components/ErrorBox";
import { fmtDate } from "../lib/format";
import { useStore } from "../store";

export function ProjectsPage() {
  const projects = useProjects();
  const create = useCreateProject();
  const role = useStore((s) => s.auth.role);
  const [name, setName] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim() }, { onSuccess: () => setName("") });
  };

  return (
    <div className="page">
      <h1>프로젝트</h1>
      {role === "admin" && (
        <form className="row gap" onSubmit={submit}>
          <input placeholder="새 프로젝트 이름" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="primary" disabled={create.isPending}>
            생성
          </button>
        </form>
      )}
      <ErrorBox error={create.error} />
      <ErrorBox error={projects.error} />
      {projects.isPending && <p>불러오는 중…</p>}
      {projects.data && projects.data.length === 0 && <p className="muted">프로젝트가 없습니다.</p>}
      <ul className="list">
        {projects.data?.map((p) => (
          <li key={p.project_id} className="card row gap">
            <div className="col">
              <strong>{p.name}</strong>
              <span className="muted small">
                {p.project_id} · {fmtDate(p.created_at)}
              </span>
            </div>
            <div className="spacer" />
            <Link className="btn" to={`/projects/${p.project_id}/upload`}>
              업로드
            </Link>
            <Link className="btn" to={`/projects/${p.project_id}/viewer`}>
              뷰어
            </Link>
            <Link className="btn" to={`/projects/${p.project_id}/summary`}>
              주간요약
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
