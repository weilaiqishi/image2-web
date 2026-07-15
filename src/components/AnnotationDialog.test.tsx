import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "../types";
import { AnnotationDialog } from "./AnnotationDialog";

vi.mock("./AnnotationEditor", () => ({
  AnnotationEditor: ({ onSubmit }: { onSubmit: (input: unknown) => void }) => (
    <button type="button" onClick={() => onSubmit({ documentJson: "{\"objects\":[]}", annotatedDataUrl: "data:image/png;base64,AA==", instruction: "提亮眼妆" })}>模拟提交标注</button>
  ),
}));

const asset: AssetRecord = {
  id: "asset-1",
  filePath: "/asset.png",
  mimeType: "image/png",
  prompt: "人像",
  createdAt: new Date().toISOString(),
  kind: "generated",
};

describe("AnnotationDialog", () => {
  it("returns a structured annotation attachment to the composer", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<AnnotationDialog asset={asset} onClose={onClose} onExport={vi.fn()} onSubmit={onSubmit} />);
    expect(screen.getByRole("dialog", { name: "标注修改" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "模拟提交标注" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "annotation", sourceAssetId: "asset-1", instruction: "提亮眼妆" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
