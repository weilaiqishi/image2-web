import type {
  AgentProtocol,
  AgentTurnResult,
  Attachment,
  ChatMessage,
  CreateImageTasksInput,
  GenerationRecommendation,
  Settings,
} from "../types";

export interface AgentTurnInput {
  messages: ChatMessage[];
  attachments: Attachment[];
  attachmentImages: Record<string, string[]>;
}

type ProxyAgent = (protocol: AgentProtocol, body: unknown) => Promise<unknown>;

const systemPrompt = `你是 Image2 Studio 的图片任务编排 Agent。理解用户目标，需要生成图片时必须调用 create_image_tasks。
每个不同视角或不同成品必须是独立任务，禁止用一个提示词和 n 参数代替。根据对象与用途自行决定视角，不要硬套固定三视图。
只能引用当前消息提供的附件 ID。提示词应完整重复需要保持一致的主体、妆容、服装、光线和背景约束。一次最多 8 个任务。
如果信息不足以可靠执行，先用文字提出一个简短问题，不要调用工具。`;

const taskProperties = {
  title: { type: "string" },
  prompt: { type: "string" },
  operation: { type: "string", enum: ["generate", "edit"] },
  referenceIds: { type: "array", items: { type: "string" } },
  annotationId: { type: ["string", "null"] },
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
        required: ["title", "prompt", "operation", "referenceIds", "annotationId"],
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
    parts.push({ type: protocol === "responses" ? "input_text" : "text", text: `附件 ${attachment.id}，类型 ${attachment.kind}` });
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
      instructions: systemPrompt,
      input: [
        ...earlier,
        { role: current?.role ?? "user", content: [{ type: "input_text", text: current?.content ?? "" }, ...currentContent(input, "responses")] },
      ],
      tools: [{ type: "function", name: "create_image_tasks", description: "创建一批需要严格串行执行的独立图片生成或编辑任务。", strict: true, parameters: toolParameters }],
      tool_choice: "auto",
    };
  }
  return {
    model: settings.agentModel,
    messages: [
      { role: "system", content: systemPrompt },
      ...earlier,
      { role: current?.role ?? "user", content: [{ type: "text", text: current?.content ?? "" }, ...currentContent(input, "chat_completions")] },
    ],
    tools: [{ type: "function", function: { name: "create_image_tasks", description: "创建一批需要严格串行执行的独立图片生成或编辑任务。", strict: true, parameters: toolParameters } }],
    tool_choice: "auto",
  };
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error("Agent 返回的任务参数不是有效 JSON"); }
}

export function validateImagePlan(value: unknown, allowedReferenceIds: string[]): CreateImageTasksInput {
  if (!value || typeof value !== "object") throw new Error("Agent 没有返回有效任务计划");
  const plan = value as CreateImageTasksInput;
  if (typeof plan.summary !== "string" || !Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error("任务计划缺少摘要或任务");
  if (plan.tasks.length > 8) throw new Error("一次最多创建 8 个图片任务");
  const allowed = new Set(allowedReferenceIds);
  for (const task of plan.tasks) {
    if (!task || typeof task.title !== "string" || typeof task.prompt !== "string" || !["generate", "edit"].includes(task.operation) || !Array.isArray(task.referenceIds)) {
      throw new Error("Agent 返回了不完整的图片任务");
    }
    if (!task.title.trim() || !task.prompt.trim()) throw new Error("任务标题和提示词不能为空");
    if (task.referenceIds.some((referenceId) => !allowed.has(referenceId))) throw new Error("Agent 引用了当前消息之外的附件");
    if (task.annotationId && !allowed.has(task.annotationId)) throw new Error("Agent 引用了无效标注附件");
  }
  return plan;
}

export function parseAgentResponse(protocol: AgentProtocol, payload: unknown, allowedReferenceIds: string[]): AgentTurnResult {
  const response = payload as Record<string, any>;
  if (protocol === "responses") {
    const output = Array.isArray(response?.output) ? response.output : [];
    const call = output.find((item: any) => item?.type === "function_call" && item?.name === "create_image_tasks");
    const messageText = output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .filter((item: any) => item?.type === "output_text").map((item: any) => item.text).join("\n");
    return { text: messageText || response?.output_text || "", plan: call ? validateImagePlan(parseArguments(call.arguments), allowedReferenceIds) : undefined };
  }
  const message = response?.choices?.[0]?.message;
  const call = message?.tool_calls?.find((item: any) => item?.function?.name === "create_image_tasks");
  return { text: typeof message?.content === "string" ? message.content : "", plan: call ? validateImagePlan(parseArguments(call.function.arguments), allowedReferenceIds) : undefined };
}

export async function createAgentTurn(settings: Settings, input: AgentTurnInput, proxy: ProxyAgent): Promise<AgentTurnResult> {
  const payload = await proxy(settings.agentProtocol, buildAgentRequest(settings, input));
  return parseAgentResponse(settings.agentProtocol, payload, input.attachments.map((attachment) => attachment.id));
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
  const instruction = "分析参考图的主体构图、方向与细节密度，推荐最适合后续同主体图片生成的画面比例和质量。必须调用 recommend_generation_settings，只给出简短、具体的中文理由。";
  if (settings.agentProtocol === "responses") {
    return {
      model: settings.agentModel,
      instructions: instruction,
      input: [{ role: "user", content: [{ type: "input_text", text: "请分析这张参考图并推荐生成设置。" }, { type: "input_image", image_url: imageDataUrl }] }],
      tools: [{ type: "function", name: "recommend_generation_settings", description: "根据参考图推荐生成比例和质量。", strict: true, parameters: recommendationParameters }],
      tool_choice: "required",
    };
  }
  return {
    model: settings.agentModel,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: [{ type: "text", text: "请分析这张参考图并推荐生成设置。" }, { type: "image_url", image_url: { url: imageDataUrl } }] },
    ],
    tools: [{ type: "function", function: { name: "recommend_generation_settings", description: "根据参考图推荐生成比例和质量。", strict: true, parameters: recommendationParameters } }],
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
    throw new Error("Agent 没有返回有效的推荐设置");
  }
  return { aspectRatio: value.aspectRatio as GenerationRecommendation["aspectRatio"], quality: value.quality as GenerationRecommendation["quality"], reason: value.reason };
}

export async function recommendGenerationSettings(settings: Settings, imageDataUrl: string, proxy: ProxyAgent): Promise<Omit<GenerationRecommendation, "status">> {
  const payload = await proxy(settings.agentProtocol, buildRecommendationRequest(settings, imageDataUrl));
  return parseRecommendationResponse(settings.agentProtocol, payload);
}
