import { useState } from "react";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "확인",
  requireNote = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  requireNote?: boolean;
  busy?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{title}</h3>
        {message && (
          /* 이 단락은 "이 결정이 실제로 무엇을 바꾸는가"를 말한다 — kind 마다 다르고, 화면이 지키지 못할
             약속을 하면 안 되는 자리다. 테스트가 절 단위로 고정할 수 있게 testid 를 둔다. */
          <p data-testid="confirm-message">{message}</p>
        )}
        <label className="field">
          <span>사유 / 메모{requireNote ? " (필수)" : ""}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>
        <div className="row gap">
          <button type="button" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || (requireNote && !note.trim())}
            onClick={() => onConfirm(note.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
