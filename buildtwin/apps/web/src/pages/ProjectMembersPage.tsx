/**
 * 프로젝트 멤버 관리 (admin 전용, ADR 0006 §4). 표 + 추가 폼만 — 사용자 검색 등은 MVP 범위 밖.
 */
import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useAddProjectMember, useProjectMembers, useRemoveProjectMember } from "../api/hooks";
import type { ProjectRole } from "../api/types";
import { ErrorBox } from "../components/ErrorBox";
import { ROLE_LABELS } from "../domain/labels";
import { fmtDate } from "../lib/format";

const PROJECT_ROLES: ProjectRole[] = ["contractor", "cm", "client"];

export function ProjectMembersPage() {
  const { id: projectId = "" } = useParams();
  const members = useProjectMembers(projectId);
  const addMember = useAddProjectMember(projectId);
  const removeMember = useRemoveProjectMember(projectId);

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("contractor");
  const [removing, setRemoving] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) return;
    addMember.mutate({ user_id: userId.trim(), role }, { onSuccess: () => setUserId("") });
  };

  const remove = (targetUserId: string) => {
    setRemoving(targetUserId);
    removeMember.mutate(targetUserId, { onSettled: () => setRemoving(null) });
  };

  return (
    <div className="page">
      <h1>프로젝트 멤버</h1>
      <p className="muted small">
        여기서 준 역할이 이 프로젝트에서의 실제 권한입니다(ADR 0006). 같은 사용자가 다른 프로젝트에서는 다른 역할일 수 있습니다.
      </p>

      <ErrorBox error={members.error} />
      {members.isPending && <p>불러오는 중…</p>}
      {members.data && members.data.length === 0 && <p className="muted">멤버가 없습니다.</p>}
      {members.data && members.data.length > 0 && (
        <table className="table" data-testid="members-table">
          <thead>
            <tr>
              <th>사용자 ID</th>
              <th>이메일</th>
              <th>역할</th>
              <th>추가일</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.data.map((m) => (
              <tr key={m.user_id} data-testid="member-row">
                <td>{m.user_id}</td>
                <td>{m.email ?? "-"}</td>
                <td>{ROLE_LABELS[m.role]}</td>
                <td>{fmtDate(m.added_at)}</td>
                <td>
                  <button type="button" disabled={removing === m.user_id} onClick={() => remove(m.user_id)}>
                    제거
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ErrorBox error={removeMember.error} />

      <fieldset className="card">
        <legend>멤버 추가</legend>
        <form className="row gap" onSubmit={submit}>
          <label className="field">
            <span>사용자 ID</span>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user-xxxx" />
          </label>
          <label className="field">
            <span>역할</span>
            <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary" disabled={addMember.isPending}>
            추가
          </button>
        </form>
        <ErrorBox error={addMember.error} />
      </fieldset>
    </div>
  );
}
