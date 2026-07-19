import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../components/SettingsDialog";
import { buildAgentRequest } from "../lib/agentProvider";
import { localizedErrorMessage, setLocale, translate } from ".";
import { compileEditRequest } from "../lib/promptCompiler";
import type { AnnotationDocumentV2, Settings } from "../types";

const settings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  agentProtocol: "responses",
  agentModel: "gpt-5.6",
  imageModel: "gpt-image-2",
  hasApiKey: false,
};

describe("bilingual internationalization", () => {
  it("switches the rendered UI immediately and persists the locale", () => {
    render(<SettingsDialog open settings={settings} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "连接中转站" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));

    expect(screen.getByRole("heading", { name: "Connect a gateway" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("image2.locale")).toBe("en");
  });

  it("localizes interpolation and backend error messages", () => {
    setLocale("en");
    expect(translate("workspace.taskCount", { count: 3 })).toBe("3 tasks");
    expect(localizedErrorMessage("API Key 无效（请求 req-7）")).toBe("Invalid API Key (request req-7)");
  });

  it("asks the Agent to answer in the selected language", () => {
    setLocale("en");
    const request = buildAgentRequest(settings, {
      messages: [{ id: "message", conversationId: "conversation", role: "user", content: "Create three views", attachments: [], createdAt: "now" }],
      attachments: [],
      attachmentImages: {},
    }) as { instructions: string };
    expect(request.instructions).toContain("Always respond to the user in English");
  });

  it("compiles edit previews in English without changing stable object tokens", () => {
    setLocale("en");
    const document: AnnotationDocumentV2 = {
      id: "document-1",
      sourceAssetId: "asset-1",
      conversationId: "conversation-1",
      sourceWidth: 100,
      sourceHeight: 100,
      fabricJson: "{}",
      objects: [{ id: "object-1", documentId: "document-1", kind: "rect", displayName: "Region01", sequence: 1, geometry: { kind: "rect", x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, color: "#D64536", createdAt: "now", updatedAt: "now" }],
      promptText: "Change @Region01 to white",
      promptTokens: [],
      status: "attached",
      overlayAssetId: "overlay-1",
      legacy: false,
      nextSequence: { point: 1, rect: 2, mask: 1, arrow: 1, note: 1 },
      createdAt: "now",
      updatedAt: "now",
    };
    const request = compileEditRequest(document, [], { prompt: "", aspectRatio: "1:1", resolution: "1K", size: "1024x1024", quality: "medium", outputFormat: "png" });
    expect(request.prompt).toContain("Annotation objects:");
    expect(request.prompt).toContain("Region01: rectangle");
    expect(request.prompt).not.toContain("标注对象");
  });
});
