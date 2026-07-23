import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImagePreviewDialog } from "./ImagePreviewDialog";

describe("ImagePreviewDialog", () => {
  it("shows the full image and closes with Escape", async () => {
    const onClose = vi.fn();
    render(<ImagePreviewDialog src="data:image/png;base64,AA==" title="生成结果" onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "预览 生成结果" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "生成结果" })).toHaveAttribute("src", "data:image/png;base64,AA==");
    expect(document.querySelector(".image-preview-stage")).not.toBeInTheDocument();
    expect(document.querySelector(".yarl__slide_image")).toBeInTheDocument();

    fireEvent.keyDown(document.querySelector(".yarl__container")!, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
