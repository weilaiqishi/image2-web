import type { AgentDiagnosticLog, Settings, WorkspaceState } from "../types";

const MAX_TEXT_LENGTH = 50_000;
const SECRET_KEY = /authorization|api.?key|access.?token|secret/i;
const LARGE_DOCUMENT_KEY = /^(fabricJson|documentJson)$/i;

function dataUrlSummary(value: string) {
  const separator = value.indexOf(",");
  const header = separator >= 0 ? value.slice(5, separator) : "unknown";
  const mimeType = header.split(";")[0] || "unknown";
  const payloadLength = separator >= 0 ? value.length - separator - 1 : 0;
  const approximateBytes = header.includes("base64") ? Math.floor(payloadLength * 0.75) : payloadLength;
  return `[omitted data URL: ${mimeType}, approximately ${approximateBytes} bytes]`;
}

function safeRemoteUrl(value: string) {
  try {
    const parsed = new URL(value);
    const hasSensitiveQuery = [...parsed.searchParams.keys()].some((key) => /key|token|signature|credential|secret|sig/i.test(key));
    if (hasSensitiveQuery) parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

export function sanitizeDiagnosticValue(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.startsWith("data:")) return dataUrlSummary(value);
    if (LARGE_DOCUMENT_KEY.test(key)) return `[omitted ${key}: ${value.length} characters]`;
    const safeValue = /^https?:\/\//i.test(value) ? safeRemoteUrl(value) : value;
    return safeValue.length > MAX_TEXT_LENGTH
      ? `${safeValue.slice(0, MAX_TEXT_LENGTH)}\n[truncated ${safeValue.length - MAX_TEXT_LENGTH} characters]`
      : safeValue;
  }
  if (typeof value === "undefined") return undefined;
  if (depth >= 14) return "[omitted: maximum diagnostic depth reached]";
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item, key, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([entryKey, entryValue]) => [entryKey, sanitizeDiagnosticValue(entryValue, entryKey, depth + 1)]));
  }
  return String(value);
}

export function createConversationLogExport(
  workspace: WorkspaceState,
  settings: Settings,
  conversationId: string,
  exportedAt = new Date().toISOString(),
) {
  const conversation = workspace.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error("Conversation not found");
  const batches = workspace.batches.filter((batch) => batch.conversationId === conversationId);
  const batchIds = new Set(batches.map((batch) => batch.id));
  const annotations = Object.fromEntries(Object.entries(workspace.annotationDocuments)
    .filter(([, document]) => document.conversationId === conversationId));
  const diagnosticLogs: AgentDiagnosticLog[] = workspace.diagnosticLogs
    .filter((log) => log.conversationId === conversationId);

  return sanitizeDiagnosticValue({
    schemaVersion: 1,
    exportedAt,
    app: {
      name: "Image2 Studio",
      workspaceVersion: workspace.version,
      locale: globalThis.navigator?.language,
      userAgent: globalThis.navigator?.userAgent,
    },
    settings: {
      baseUrl: settings.baseUrl,
      agentProtocol: settings.agentProtocol,
      agentModel: settings.agentModel,
      imageModel: settings.imageModel,
      hasApiKey: settings.hasApiKey,
    },
    conversation,
    messages: workspace.messages.filter((message) => message.conversationId === conversationId),
    draft: workspace.drafts[conversationId],
    batches,
    tasks: workspace.tasks.filter((task) => batchIds.has(task.batchId)),
    annotationDocuments: annotations,
    agentCalls: diagnosticLogs,
  });
}

export function conversationLogFilename(conversationId: string, exportedAt = new Date()) {
  const timestamp = exportedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const id = conversationId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 12) || "conversation";
  return `image2-log-${id}-${timestamp}.json`;
}
