import { describe, expect, it } from "vitest";
import type { AgentDiagnosticLog, Settings } from "../types";
import { createInitialWorkspace } from "./workspaceStore";
import { conversationLogFilename, createConversationLogExport, sanitizeDiagnosticValue } from "./diagnosticLog";

const settings: Settings = {
  baseUrl: "https://gateway.example/v1",
  agentProtocol: "responses",
  agentModel: "gpt-5.6",
  imageModel: "gpt-image-2",
  hasApiKey: true,
};

describe("conversation diagnostic logs", () => {
  it("redacts secrets, image data and signed URL queries", () => {
    const sanitized = sanitizeDiagnosticValue({
      apiKey: "sk-secret",
      image_url: "data:image/png;base64,aGVsbG8=",
      resultUrl: "https://cdn.example/image.png?signature=secret&expires=1#preview",
      fabricJson: "{\"objects\":[]}",
    });
    const json = JSON.stringify(sanitized);
    expect(json).not.toContain("sk-secret");
    expect(json).not.toContain("aGVsbG8=");
    expect(json).not.toContain("signature=secret");
    expect(json).toContain("omitted data URL");
    expect(json).toContain("omitted fabricJson");
  });

  it("exports only the selected conversation and its Agent calls", () => {
    const workspace = createInitialWorkspace();
    const conversationId = workspace.selectedConversationId;
    workspace.conversations.push({ id: "other", title: "Other", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    workspace.messages.push(
      { id: "message-current", conversationId, role: "user", content: "make a poster", attachments: [{ id: "attachment-current", kind: "reference", name: "source.png", dataUrl: "data:image/png;base64,aGVsbG8=" }], createdAt: "2026-01-01" },
      { id: "message-other", conversationId: "other", role: "user", content: "private other conversation", attachments: [], createdAt: "2026-01-01" },
    );
    const log: AgentDiagnosticLog = {
      id: "log-current", conversationId, startedAt: "2026-01-01", completedAt: "2026-01-01",
      protocol: "responses", model: "gpt-5.6", status: "failed", allowedAttachmentIds: ["attachment-current"],
      response: { output: [{ arguments: "{\"referenceIds\":[\"wrong-id\"]}" }] }, error: "invalid attachment",
    };
    workspace.diagnosticLogs.push(log, { ...log, id: "log-other", conversationId: "other" });

    const json = JSON.stringify(createConversationLogExport(workspace, settings, conversationId, "2026-01-02T03:04:05.000Z"));
    expect(json).toContain("message-current");
    expect(json).toContain("wrong-id");
    expect(json).not.toContain("private other conversation");
    expect(json).not.toContain("aGVsbG8=");
    expect(conversationLogFilename(conversationId, new Date("2026-01-02T03:04:05.000Z"))).toMatch(/^image2-log-.+-20260102T030405Z\.json$/);
  });
});
