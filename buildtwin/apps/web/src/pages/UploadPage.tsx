/**
 * 파일 업로드: 드래그앤드롭 → 종류 자동 판별 → POST /projects/{pid}/files → job_id 폴링.
 * RVT: job.result.status === "needs_ifc_export" 면 IFC 내보내기 안내. DWG: DXF 권장 안내.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { isJobTerminal, useJob, useUploadFile } from "../api/hooks";
import type { FileKind, Job } from "../api/types";
import { ErrorBox } from "../components/ErrorBox";
import { FILE_KIND_LABELS, IFC_EXPORT_GUIDANCE, detectFileKind, preUploadNotice } from "../lib/fileKind";
import { pct } from "../lib/format";

interface UploadEntry {
  localId: number;
  fileName: string;
  kind: FileKind;
  jobId: string | null;
  error: unknown;
}

let seq = 0;

export function UploadPage() {
  const { id: projectId = "" } = useParams();
  const upload = useUploadFile(projectId);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const kind = detectFileKind(file.name);
        const localId = ++seq;
        setEntries((es) => [{ localId, fileName: file.name, kind, jobId: null, error: null }, ...es]);
        if (kind === "unknown") {
          setEntries((es) => es.map((e) => (e.localId === localId ? { ...e, error: new Error(preUploadNotice("unknown") ?? "") } : e)));
          continue;
        }
        upload.mutate(
          { file, kind },
          {
            onSuccess: (r) => setEntries((es) => es.map((e) => (e.localId === localId ? { ...e, jobId: r.job_id } : e))),
            onError: (err) => setEntries((es) => es.map((e) => (e.localId === localId ? { ...e, error: err } : e))),
          },
        );
      }
    },
    [upload],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div className="page">
      <h1>파일 업로드</h1>
      <div
        className={dragging ? "dropzone active" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        data-testid="dropzone"
      >
        <p>여기에 파일을 끌어다 놓거나 클릭해서 선택하세요.</p>
        <p className="muted small">IFC(1순위) · DXF · DWG(DXF 권장) · RVT(IFC 내보내기/APS) · E57/LAS/PLY · CSV/XML/XER</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          aria-label="파일 선택"
          data-testid="file-input"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <ul className="list">
        {entries.map((en) => (
          <li key={en.localId} className="card">
            <UploadCard entry={en} projectId={projectId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function UploadCard({ entry, projectId }: { entry: UploadEntry; projectId: string }) {
  const notice = preUploadNotice(entry.kind);
  return (
    <div className="col gap">
      <div className="row gap">
        <strong>{entry.fileName}</strong>
        <span className="badge neutral" data-testid="file-kind">
          {FILE_KIND_LABELS[entry.kind]}
        </span>
      </div>
      {notice && (
        <p className="notice" data-testid="pre-upload-notice">
          {notice}
        </p>
      )}
      <ErrorBox error={entry.error} />
      {entry.jobId ? <JobProgress jobId={entry.jobId} kind={entry.kind} projectId={projectId} /> : !entry.error && <p className="muted">업로드 중…</p>}
    </div>
  );
}

function JobProgress({ jobId, kind, projectId }: { jobId: string; kind: FileKind; projectId: string }) {
  const job = useJob(jobId);
  const qc = useQueryClient();
  const invalidatedRef = useRef(false);
  const j = job.data;

  if (j && isJobTerminal(j) && !invalidatedRef.current) {
    invalidatedRef.current = true;
    // 완료 후 객체·도면·모델 목록 갱신 (서버 상태는 Query 캐시에만)
    qc.invalidateQueries({ queryKey: ["projects", projectId] });
  }

  if (job.isError) return <ErrorBox error={job.error} />;
  if (!j) return <p className="muted">작업 상태 조회 중… (job {jobId})</p>;

  const progress = j.progress > 1 ? j.progress / 100 : j.progress;
  return (
    <div className="col gap" data-testid="job-progress" data-status={j.status}>
      <div className="row gap">
        <span className="badge neutral">{statusLabel(j)}</span>
        <progress value={progress} max={1} />
        <span className="small">{pct(progress)}</span>
        <span className="muted small">job {jobId}</span>
      </div>
      {kind === "rvt" && !isJobTerminal(j) && <p className="notice">APS 변환 중… (RVT → IFC)</p>}
      {j.result?.status === "needs_ifc_export" && (
        <div className="notice strong" data-testid="ifc-export-guidance">
          <strong>IFC 내보내기 안내</strong>
          <p>이 RVT 파일은 서버에서 직접 열 수 없고 APS 변환도 가능하지 않습니다. Revit에서 IFC로 내보낸 뒤 다시 업로드하세요.</p>
          <ol>
            {IFC_EXPORT_GUIDANCE.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ol>
          {j.result.message && <p className="muted small">{j.result.message}</p>}
        </div>
      )}
      {j.status === "failed" && <p className="error">{j.error ?? j.result?.message ?? "작업 실패"}</p>}
      {j.status === "done" && j.result?.status !== "needs_ifc_export" && (
        <p className="ok">
          처리 완료{j.result?.stats ? ` — ${Object.entries(j.result.stats).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
        </p>
      )}
      {j.warnings && j.warnings.length > 0 && (
        <details>
          <summary>경고 {j.warnings.length}건</summary>
          <ul>
            {j.warnings.map((w, i) => (
              <li key={i}>{typeof w === "string" ? w : `[${w.code}] ${w.message}`}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function statusLabel(j: Job): string {
  switch (j.status) {
    case "queued":
      return "대기";
    case "running":
      return "처리중";
    case "done":
      return j.result?.status === "needs_ifc_export" ? "IFC 내보내기 필요" : j.result?.status === "partial" ? "부분 완료" : "완료";
    case "failed":
      return "실패";
    default:
      return j.status;
  }
}
