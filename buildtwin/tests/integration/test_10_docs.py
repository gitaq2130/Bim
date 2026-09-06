"""gen_api_doc.py 가 docs/api.md 를 실제로 생성한다."""
from __future__ import annotations

from pathlib import Path

from services.api.scripts.gen_api_doc import DEFAULT_OUT, generate, render


def test_gen_api_doc_writes_markdown(tmp_path: Path):
    out = generate(tmp_path / "api.md")
    text = out.read_text(encoding="utf-8")
    for path in ("/api/auth/login", "/api/projects/{project_id}/files", "/api/jobs/{job_id}", "/api/objects/{global_id}",
                 "/api/objects/{global_id}/transitions", "/api/scans/{scan_id}/alignment", "/api/review-requests/{review_request_id}/resolve",
                 "/api/projects/{project_id}/weekly-summary", "/api/models/{model_id}/plan-section"):
        assert path in text, path
    assert "ObjectDetail" in text and "StateTransition" in text and "ReviewRequest" in text


def test_repo_docs_api_md_is_generated():
    """저장소의 docs/api.md 는 생성 결과와 같아야 한다(make docs 로 갱신)."""
    from services.api.main import create_app

    expected = render(create_app().openapi())
    assert DEFAULT_OUT.exists() and DEFAULT_OUT.read_text(encoding="utf-8") == expected
