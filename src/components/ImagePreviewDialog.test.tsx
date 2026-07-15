import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImagePreviewDialog } from "./ImagePreviewDialog";

describe("ImagePreviewDialog", () => {
  it("shows the full image and closes with Escape", () => {
    const onClose = vi.fn();
    render(<ImagePreviewDialog src="data:image/png;base64,AA==" title="生成结果" onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "预览 生成结果" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "生成结果" })).toHaveAttribute("src", "data:image/png;base64,AA==");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
