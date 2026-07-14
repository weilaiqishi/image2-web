import { render, screen } from "@testing-library/react";
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
});
