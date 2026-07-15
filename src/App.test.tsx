import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

describe("Image2 Studio shell", () => {
  it("opens local connection settings on first launch", async () => {
    render(<App />);
    expect(await screen.findByRole("form", { name: "连接设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://api.openai.com/v1")).toBeInTheDocument();
  });

  it("applies a catalog prompt and returns to generation", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "关闭设置" }));
    fireEvent.click(screen.getByRole("button", { name: "灵感" }));
    expect(screen.getByRole("heading", { name: "提示词样片" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索提示词" }), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "查看 Neon-Lit Tokyo Street" }));
    fireEvent.click(screen.getByRole("button", { name: "生成同款" }));

    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "图片描述" }).value).toContain("Tokyo street");
    expect(screen.getByRole("button", { name: "16:9" })).toHaveClass("selected");
  });
});
