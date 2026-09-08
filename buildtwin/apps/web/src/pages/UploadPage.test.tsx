import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { UploadPage } from "./UploadPage";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";

function renderUpload() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/upload" element={<UploadPage />} />
    </Routes>,
    { route: "/projects/p1/upload" },
  );
}

describe("UploadPage", () => {
  beforeEach(() => {
    resetStore();
    loginAs("contractor");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("RVT 업로드 → job 폴링 → result.status=needs_ifc_export 이면 IFC 내보내기 안내를 보여준다", async () => {
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith("/api/projects/p1/files") && init?.method === "POST") return { body: { job_id: "job-1", kind: "rvt" } };
      if (url.endsWith("/api/jobs/job-1"))
        return {
          body: {
            job_id: "job-1",
            status: "done",
            progress: 1,
            warnings: [{ code: "RVT_NO_APS", message: "APS credentials not configured" }],
            result: { status: "needs_ifc_export", source_kind: "rvt", message: "Revit 에서 IFC 로 내보내 주세요." },
          },
        };
      return undefined;
    });
    renderUpload();
    const user = userEvent.setup();
    const file = new File(["rvt-bytes"], "tower.rvt", { type: "application/octet-stream" });
    await user.upload(screen.getByTestId("file-input"), file);

    expect(screen.getByTestId("file-kind")).toHaveTextContent("Revit(RVT)");
    expect(screen.getByTestId("pre-upload-notice")).toHaveTextContent("IFC 내보내기");

    const guidance = await screen.findByTestId("ifc-export-guidance");
    expect(guidance).toHaveTextContent("IFC 내보내기 안내");
    expect(guidance).toHaveTextContent("Revit에서 [파일] → [내보내기] → [IFC]");
    expect(screen.getByTestId("job-progress")).toHaveAttribute("data-status", "done");

    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.init?.body).toBeInstanceOf(FormData);
    expect((post?.init?.body as FormData).get("kind")).toBe("rvt");
    expect((post?.init?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("DWG 는 'DXF 권장' 안내를 보여준다", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/api/projects/p1/files") && init?.method === "POST") return { body: { job_id: "job-2" } };
      if (url.endsWith("/api/jobs/job-2")) return { body: { job_id: "job-2", status: "running", progress: 0.4 } };
      return undefined;
    });
    renderUpload();
    const user = userEvent.setup();
    await user.upload(screen.getByTestId("file-input"), new File(["x"], "plan.dwg"));
    expect(screen.getByTestId("pre-upload-notice")).toHaveTextContent("DXF 권장");
    expect(await screen.findByText("40%")).toBeInTheDocument();
  });

  // ADR 0007 §7 규칙 1: 대장(xlsx) 업로드는 cm만. 서버가 403을 주기 전에 화면이 먼저 막아야 한다 —
  // "UI가 보여주는 것과 서버가 허용하는 것이 일치"해야 하므로 여기서 직접 확인한다.
  it("contractor 프로젝트 역할은 xlsx(문서관리대장)를 올리려 하면 서버 호출 없이 막힌다", async () => {
    const { calls } = mockFetch((url) => {
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "contractor" } };
      return undefined;
    });
    renderUpload();
    const user = userEvent.setup();
    await user.upload(screen.getByTestId("file-input"), new File(["a,b"], "register.xlsx"));

    expect(await screen.findByRole("alert")).toHaveTextContent("CM");
    expect(calls.some((c) => c.url.endsWith("/api/projects/p1/files") && c.init?.method === "POST")).toBe(false);
  });

  it("cm 프로젝트 역할은 xlsx(문서관리대장)를 업로드할 수 있다", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      if (url.endsWith("/api/projects/p1/files") && init?.method === "POST") return { body: { job_id: "job-3", kind: "xlsx" } };
      if (url.endsWith("/api/jobs/job-3")) return { body: { job_id: "job-3", kind: "document_register", status: "done", progress: 1 } };
      return undefined;
    });
    renderUpload();
    const user = userEvent.setup();
    await user.upload(screen.getByTestId("file-input"), new File(["a,b"], "register.xlsx"));

    expect(await screen.findByTestId("job-progress")).toHaveAttribute("data-status", "done");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
