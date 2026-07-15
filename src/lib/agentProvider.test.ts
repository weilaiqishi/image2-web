import { describe, expect, it } from "vitest";
import type { Settings } from "../types";
import { buildAgentRequest, buildRecommendationRequest, parseAgentResponse, parseRecommendationResponse, validateImagePlan } from "./agentProvider";

const settings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  agentProtocol: "responses",
  agentModel: "gpt-5.6",
  imageModel: "gpt-image-2",
  hasApiKey: true,
};

const plan = {
  summary: "三视图",
  tasks: [
    { title: "正面", prompt: "正面妆容", operation: "generate", referenceIds: ["ref-1"] },
    { title: "左侧", prompt: "左侧妆容", operation: "generate", referenceIds: ["ref-1"] },
    { title: "右侧", prompt: "右侧妆容", operation: "generate", referenceIds: ["ref-1"] },
  ],
};

describe("Agent protocol adapters", () => {
  it("builds a Responses request with one strict image task tool", () => {
    const request = buildAgentRequest(settings, {
      messages: [{ id: "m", conversationId: "c", role: "user", content: "生成三视图", attachments: [], createdAt: "now" }],
      attachments: [{ id: "ref-1", kind: "reference", name: "face.png", dataUrl: "data:image/png;base64,AA==" }],
      attachmentImages: { "ref-1": ["data:image/png;base64,AA=="] },
    }) as any;
    expect(request.model).toBe("gpt-5.6");
    expect(request.tools[0].name).toBe("create_image_tasks");
    expect(request.tools[0].strict).toBe(true);
    expect(request.input.at(-1).content).toContainEqual(expect.objectContaining({ type: "input_image" }));
  });

  it("parses Responses and Chat Completions tool calls identically", () => {
    const responses = parseAgentResponse("responses", { output: [{ type: "function_call", name: "create_image_tasks", arguments: JSON.stringify(plan) }] }, ["ref-1"]);
    const chat = parseAgentResponse("chat_completions", { choices: [{ message: { tool_calls: [{ function: { name: "create_image_tasks", arguments: JSON.stringify(plan) } }] } }] }, ["ref-1"]);
    expect(responses.plan).toEqual(plan);
    expect(chat.plan).toEqual(plan);
  });

  it("rejects task overflow and references outside the current turn", () => {
    expect(() => validateImagePlan({ summary: "too many", tasks: Array.from({ length: 9 }, (_, index) => ({ title: `${index}`, prompt: "x", operation: "generate", referenceIds: [] })) }, [])).toThrow("最多创建 8 个");
    expect(() => validateImagePlan(plan, [])).toThrow("当前消息之外");
  });

  it("builds and parses reference-based setting recommendations for both protocols", () => {
    const request = buildRecommendationRequest(settings, "data:image/png;base64,AA==") as any;
    expect(request.tools[0].name).toBe("recommend_generation_settings");
    expect(request.input[0].content).toContainEqual(expect.objectContaining({ type: "input_image" }));
    const recommendation = { aspectRatio: "3:4", quality: "high", reason: "竖向人像需要保留妆容细节" };
    expect(parseRecommendationResponse("responses", { output: [{ type: "function_call", name: "recommend_generation_settings", arguments: JSON.stringify(recommendation) }] })).toEqual(recommendation);
    expect(parseRecommendationResponse("chat_completions", { choices: [{ message: { tool_calls: [{ function: { name: "recommend_generation_settings", arguments: JSON.stringify(recommendation) } }] } }] })).toEqual(recommendation);
  });
});
