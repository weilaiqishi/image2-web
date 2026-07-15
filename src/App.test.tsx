import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

describe("Image2 Agent workspace", () => {
  it("rotates the logo while the workspace is loading", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".app-loading .brand-mark.working")).toBeInTheDocument();
  });

  it("opens agent connection settings on first launch", async () => {
    render(<App />);
    expect(await screen.findByRole("form", { name: "连接设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "串行任务" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "给 Image2 Agent 发消息" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "分辨率" })).toHaveValue("1K");
    expect(screen.getByPlaceholderText("gpt-5.6")).toBeInTheDocument();
  });

  it("creates three visible tasks from an agent turn", async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText("API Key"), { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    fireEvent.change(await screen.findByRole("textbox", { name: "给 Image2 Agent 发消息" }), { target: { value: "保持妆容一致，生成三视图" } });
    fireEvent.change(screen.getByRole("combobox", { name: "分辨率" }), { target: { value: "2K" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findAllByText("正面视图")).not.toHaveLength(0);
    expect(screen.getAllByText("左侧视图")).not.toHaveLength(0);
    expect(screen.getAllByText("右侧视图")).not.toHaveLength(0);
    expect(screen.getByText("已拆分为 3 个串行任务。")).toBeInTheDocument();
  });

  it("restores the inspiration library and applies a template to the composer", async () => {
    render(<App />);
    const close = await screen.findByRole("button", { name: "关闭设置" }).catch(() => null);
    if (close) fireEvent.click(close);
    fireEvent.click(await screen.findByRole("button", { name: "灵感库" }));
    expect(screen.getByRole("heading", { name: "提示词样片" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索提示词" }), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "查看 Neon-Lit Tokyo Street" }));
    fireEvent.click(screen.getByRole("button", { name: "生成同款" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "给 Image2 Agent 发消息" }).value).toContain("Tokyo street");
  });

  it("previews a reference and applies the agent recommendation", async () => {
    const { container } = render(<App />);
    const close = await screen.findByRole("button", { name: "关闭设置" }).catch(() => null);
    if (close) fireEvent.click(close);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const image = new File(["image"], "makeup.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [image] } });
    expect(await screen.findByText("makeup.png")).toBeInTheDocument();
    expect(container.querySelector(".composer-attachment img")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览 makeup.png" }));
    expect(screen.getByRole("dialog", { name: "预览 makeup.png" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(await screen.findByText("推荐 3:4 · 精细")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用推荐" }));
    expect(screen.getByRole("combobox", { name: "比例" })).toHaveValue("3:4");
    expect(screen.getByRole("combobox", { name: "质量" })).toHaveValue("high");
  });
});
