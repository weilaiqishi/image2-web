import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerationPanel } from "./GenerationPanel";
import type { GenerationParams } from "../types";

const params: GenerationParams = {
  prompt: "",
  aspectRatio: "1:1",
  resolution: "1K",
  size: "1024x1024",
  quality: "medium",
  outputFormat: "png",
};

function renderPanel(onReferences = vi.fn()) {
  render(
    <GenerationPanel
      params={params}
      references={[]}
      busy={false}
      onChange={vi.fn()}
      onReferences={onReferences}
      onRemoveReference={vi.fn()}
      onGenerate={vi.fn()}
    />,
  );
  return onReferences;
}

describe("GenerationPanel clipboard references", () => {
  it("adds pasted images as references", () => {
    const onReferences = renderPanel();
    const image = new File(["image"], "clipboard.png", { type: "image/png" });

    fireEvent.paste(screen.getByRole("textbox", { name: "图片描述" }), {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
        files: [image],
      },
    });

    expect(onReferences).toHaveBeenCalledWith([image]);
  });

  it("leaves text-only paste unchanged", () => {
    const onReferences = renderPanel();

    fireEvent.paste(screen.getByRole("textbox", { name: "图片描述" }), {
      clipboardData: { items: [], files: [] },
    });

    expect(onReferences).not.toHaveBeenCalled();
  });
});
