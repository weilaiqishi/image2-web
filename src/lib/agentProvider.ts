import type {
  AgentProtocol,
  AgentTurnResult,
  AnnotationDocumentV2,
  Attachment,
  ChatMessage,
  CreateImageTasksInput,
  GenerationRecommendation,
  Settings,
} from "../types";
import { translate } from "../i18n";

export interface AgentTurnInput {
  messages: ChatMessage[];
  attachments: Attachment[];
  attachmentImages: Record<string, string[]>;
  annotationDocuments?: Record<string, AnnotationDocumentV2>;
}

type ProxyAgent = (protocol: AgentProtocol, body: unknown) => Promise<unknown>;

export interface AgentTurnDiagnostics {
  request?: unknown;
  response?: unknown;
}

const systemPrompt = () => translate("agent.systemPrompt");

const taskProperties = {
  title: { type: "string" },
  prompt: { type: "string" },
  operation: { type: "string", enum: ["generate", "edit"] },
  referenceIds: { type: "array", items: { type: "string" } },
  annotationId: { type: ["string", "null"] },
  annotationDocumentId: { type: ["string", "null"] },
  annotationObjectIds: { type: "array", items: { type: "string" } },
  baseAssetId: { type: ["string", "null"] },
  preserve: { type: "array", items: { type: "string" } },
  variantGroupId: { type: ["string", "null"] },
};

const toolParameters = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tasks"],
  properties: {
    summary: { type: "string" },
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "prompt", "operation", "referenceIds", "annotationId", "annotationDocumentId", "annotationObjectIds", "baseAssetId", "preserve", "variantGroupId"],
        properties: taskProperties,
      },
    },
  },
};

function textHistory(messages: ChatMessage[]) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function currentContent(input: AgentTurnInput, protocol: AgentProtocol) {
  const parts: unknown[] = [];
  for (const attachment of input.attachments) {
    const descriptor = attachment.kind === "annotation" ? undefined : attachment.descriptor;
    const document = attachment.kind === "annotation" ? input.annotationDocuments?.[attachment.documentId] : undefined;
    const description = JSON.stringify(attachment.kind === "annotation" ? {
      attachmentId: attachment.id,
      kind: "annotation",
      documentId: attachment.documentId,
      baseAssetId: attachment.sourceAssetId,
      objects: document?.objects.map((object) => ({ displayName: object.displayName, id: object.id, kind: object.kind, note: object.note ?? "" })) ?? [],
    } : {
      attachmentId: attachment.id,
      kind: attachment.kind,
      label: descriptor?.label,
      roles: descriptor?.roles ?? ["other"],
      priority: descriptor?.priority ?? 0,
      preserve: descriptor?.preserve ?? [],
      assetId: attachment.kind === "asset" ? attachment.assetId : undefined,
    });
    parts.push({ type: protocol === "responses" ? "input_text" : "text", text: description });
    for (const image of input.attachmentImages[attachment.id] ?? []) {
      parts.push(protocol === "responses"
        ? { type: "input_image", image_url: image }
        : { type: "image_url", image_url: { url: image } });
    }
  }
  return parts;
}

export function buildAgentRequest(settings: Settings, input: AgentTurnInput): unknown {
  const history = textHistory(input.messages);
  const current = history.at(-1);
  const earlier = history.slice(0, -1);
  if (settings.agentProtocol === "responses") {
    return {
      model: settings.agentModel,
      instructions: systemPrompt(),
      input: [
        ...earlier,
        { role: current?.role ?? "user", content: [{ type: "input_text", text: current?.content ?? "" }, ...currentContent(input, "responses")] },
      ],
      tools: [{ type: "function", name: "create_image_tasks", description: translate("agent.createTasksDescription"), strict: true, parameters: toolParameters }],
      tool_choice: "auto",
    };
  }
  return {
    model: settings.agentModel,
    messages: [
      { role: "system", content: systemPrompt() },
      ...earlier,
      { role: current?.role ?? "user", content: [{ type: "text", text: current?.content ?? "" }, ...currentContent(input, "chat_completions")] },
    ],
    tools: [{ type: "function", function: { name: "create_image_tasks", description: translate("agent.createTasksDescription"), strict: true, parameters: toolParameters } }],
    tool_choice: "auto",
  };
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error(translate("errors.agentInvalidJson")); }
}

export function validateImagePlan(value: unknown, allowedReferenceIds: string[], input?: Pick<AgentTurnInput, "attachments" | "annotationDocuments">): CreateImageTasksInput {
  if (!value || typeof value !== "object") throw new Error(translate("errors.agentInvalidPlan"));
  const plan = value as CreateImageTasksInput;
  if (typeof plan.summary !== "string" || !Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error(translate("errors.agentPlanMissing"));
  if (plan.tasks.length > 8) throw new Error(translate("errors.taskLimit"));
  const allowed = new Set(allowedReferenceIds);
  const annotations = new Map((input?.attachments ?? []).filter((attachment) => attachment.kind === "annotation").map((attachment) => [attachment.documentId, attachment]));
  const imageLabels = new Set((input?.attachments ?? []).filter((attachment) => attachment.kind !== "annotation").map((attachment) => attachment.descriptor?.label).filter(Boolean));
  const allowedBaseAssetIds = new Set((input?.attachments ?? []).flatMap((attachment) => attachment.kind === "asset" ? [attachment.assetId] : attachment.kind === "annotation" ? [attachment.sourceAssetId] : []));
  for (const task of plan.tasks) {
    if (!task || typeof task.title !== "string" || typeof task.prompt !== "string" || !["generate", "edit"].includes(task.operation) || !Array.isArray(task.referenceIds)) {
      throw new Error(translate("errors.agentIncompleteTask"));
    }
    if (!task.title.trim() || !task.prompt.trim()) throw new Error(translate("errors.emptyTask"));
    if (task.referenceIds.some((referenceId) => !allowed.has(referenceId))) throw new Error(translate("errors.externalAttachment"));
    if (task.annotationId && !allowed.has(task.annotationId)) throw new Error(translate("errors.invalidAnnotation"));
    if (task.operation === "edit" && !task.baseAssetId) throw new Error(translate("errors.missingBaseAsset"));
    if (task.baseAssetId && input && !allowedBaseAssetIds.has(task.baseAssetId)) throw new Error(translate("errors.externalBaseAsset"));
    if (task.annotationDocumentId) {
      const attachment = annotations.get(task.annotationDocumentId);
      const document = input?.annotationDocuments?.[task.annotationDocumentId];
      if (!attachment || !document) throw new Error(translate("errors.invalidDocument"));
      const objectIds = new Set(document.objects.map((object) => object.id));
      if ((task.annotationObjectIds ?? []).some((objectId) => !objectIds.has(objectId))) throw new Error(translate("errors.invalidDocumentObject"));
      if (task.baseAssetId !== attachment.sourceAssetId) throw new Error(translate("errors.baseMismatch"));
      for (const match of task.prompt.matchAll(/@(Mark\d+|Region\d+|Move\d+|Note\d+)/g)) {
        if (!document.objects.some((object) => object.displayName === match[1])) throw new Error(translate("errors.invalidReference", { name: match[1] }));
      }
    }
    for (const match of task.prompt.matchAll(/@(Image\d+)/g)) {
      if (!imageLabels.has(match[1])) throw new Error(translate("errors.invalidReference", { name: match[1] }));
    }
  }
  return plan;
}

export function parseAgentResponse(protocol: AgentProtocol, payload: unknown, allowedReferenceIds: string[], input?: Pick<AgentTurnInput, "attachments" | "annotationDocuments">): AgentTurnResult {
  const response = payload as Record<string, any>;
  if (protocol === "responses") {
    const output = Array.isArray(response?.output) ? response.output : [];
    const call = output.find((item: any) => item?.type === "function_call" && item?.name === "create_image_tasks");
    const messageText = output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .filter((item: any) => item?.type === "output_text").map((item: any) => item.text).join("\n");
    return { text: messageText || response?.output_text || "", plan: call ? validateImagePlan(parseArguments(call.arguments), allowedReferenceIds, input) : undefined };
  }
  const message = response?.choices?.[0]?.message;
  const call = message?.tool_calls?.find((item: any) => item?.function?.name === "create_image_tasks");
  return { text: typeof message?.content === "string" ? message.content : "", plan: call ? validateImagePlan(parseArguments(call.function.arguments), allowedReferenceIds, input) : undefined };
}

export async function createAgentTurn(settings: Settings, input: AgentTurnInput, proxy: ProxyAgent, diagnostics?: AgentTurnDiagnostics): Promise<AgentTurnResult> {
  const request = buildAgentRequest(settings, input);
  if (diagnostics) diagnostics.request = request;
  const payload = await proxy(settings.agentProtocol, request);
  if (diagnostics) diagnostics.response = payload;
  return parseAgentResponse(settings.agentProtocol, payload, input.attachments.map((attachment) => attachment.id), input);
}

const recommendationParameters = {
  type: "object",
  additionalProperties: false,
  required: ["aspectRatio", "quality", "reason"],
  properties: {
    aspectRatio: { type: "string", enum: ["1:1", "4:3", "16:9", "3:4", "9:16"] },
    quality: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string" },
  },
};

export function buildRecommendationRequest(settings: Settings, imageDataUrl: string): unknown {
  const instruction = translate("agent.recommendInstruction");
  if (settings.agentProtocol === "responses") {
    return {
      model: settings.agentModel,
      instructions: instruction,
      input: [{ role: "user", content: [{ type: "input_text", text: translate("agent.recommendUser") }, { type: "input_image", image_url: imageDataUrl }] }],
      tools: [{ type: "function", name: "recommend_generation_settings", description: translate("agent.recommendTool"), strict: true, parameters: recommendationParameters }],
      tool_choice: "required",
    };
  }
  return {
    model: settings.agentModel,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: [{ type: "text", text: translate("agent.recommendUser") }, { type: "image_url", image_url: { url: imageDataUrl } }] },
    ],
    tools: [{ type: "function", function: { name: "recommend_generation_settings", description: translate("agent.recommendTool"), strict: true, parameters: recommendationParameters } }],
    tool_choice: "required",
  };
}

export function parseRecommendationResponse(protocol: AgentProtocol, payload: unknown): Omit<GenerationRecommendation, "status"> {
  const response = payload as Record<string, any>;
  const args = protocol === "responses"
    ? response?.output?.find((item: any) => item?.type === "function_call" && item?.name === "recommend_generation_settings")?.arguments
    : response?.choices?.[0]?.message?.tool_calls?.find((item: any) => item?.function?.name === "recommend_generation_settings")?.function?.arguments;
  const value = parseArguments(args) as Record<string, unknown> | undefined;
  if (!value || !["1:1", "4:3", "16:9", "3:4", "9:16"].includes(String(value.aspectRatio)) || !["low", "medium", "high"].includes(String(value.quality)) || typeof value.reason !== "string") {
    throw new Error(translate("errors.invalidRecommendation"));
  }
  return { aspectRatio: value.aspectRatio as GenerationRecommendation["aspectRatio"], quality: value.quality as GenerationRecommendation["quality"], reason: value.reason };
}

export async function recommendGenerationSettings(settings: Settings, imageDataUrl: string, proxy: ProxyAgent): Promise<Omit<GenerationRecommendation, "status">> {
  const payload = await proxy(settings.agentProtocol, buildRecommendationRequest(settings, imageDataUrl));
  return parseRecommendationResponse(settings.agentProtocol, payload);
}
