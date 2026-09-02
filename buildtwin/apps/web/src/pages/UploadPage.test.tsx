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
});
