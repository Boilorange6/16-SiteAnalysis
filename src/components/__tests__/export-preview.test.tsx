import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExportPreview from "@/components/export-preview";
import type { SlideSpec } from "@/lib/slide-spec";

vi.mock("@/lib/ppt-generator", () => ({
  generatePptFromSlides: vi.fn().mockResolvedValue(undefined),
}));
import { generatePptFromSlides } from "@/lib/ppt-generator";

function spec(id: string, title: string, warning?: string): SlideSpec {
  return { id, title, warning, elements: [{ kind: "text", x: 0, y: 0, w: 1, h: 0.1, text: title, fontSizePt: 20, color: "#1E3A8A" }] };
}

const SPECS = [spec("cover", "표지"), spec("overview", "입지 현황 종합"), spec("subway", "교통 분석")];

beforeEach(() => vi.clearAllMocks());

describe("ExportPreview", () => {
  it("썸네일을 슬라이드 수만큼 렌더하고 다운로드 버튼에 선택 수를 표시한다", () => {
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    expect(screen.getAllByTestId(/^thumb-(?!check-)/)).toHaveLength(3);
    expect(screen.getByRole("button", { name: /PPT 다운로드 \(3장\)/ })).toBeTruthy();
  });

  it("체크 해제한 슬라이드는 다운로드에서 제외된다", async () => {
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    await user.click(screen.getByTestId("thumb-check-overview"));
    const btn = screen.getByRole("button", { name: /PPT 다운로드 \(2장\)/ });
    await user.click(btn);
    expect(generatePptFromSlides).toHaveBeenCalledOnce();
    const passed = vi.mocked(generatePptFromSlides).mock.calls[0][0] as SlideSpec[];
    expect(passed.map((s) => s.id)).toEqual(["cover", "subway"]);
  });

  it("전체 해제 시 다운로드 버튼이 비활성화된다", async () => {
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    for (const s of SPECS) await user.click(screen.getByTestId(`thumb-check-${s.id}`));
    expect(screen.getByRole("button", { name: /PPT 다운로드/ })).toHaveProperty("disabled", true);
  });

  it("썸네일 클릭으로 메인 미리보기 슬라이드를 바꾼다", async () => {
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    await user.click(screen.getByTestId("thumb-subway"));
    expect(screen.getByTestId("main-slide").textContent).toContain("교통 분석");
  });

  it("warning이 있는 슬라이드는 경고 배지를 표시한다", () => {
    render(<ExportPreview specs={[spec("cover", "표지", "지도 캡처 실패")]} fileName="t.pptx" onClose={() => {}} />);
    expect(screen.getByText(/지도 캡처 실패/)).toBeTruthy();
  });

  it("닫기 버튼이 onClose를 호출한다", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("생성 실패 시 에러 메시지를 모달 안에 표시하고 모달은 유지한다", async () => {
    vi.mocked(generatePptFromSlides).mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /PPT 다운로드/ }));
    expect(await screen.findByText(/PPT 생성에 실패했습니다/)).toBeTruthy();
  });
});
