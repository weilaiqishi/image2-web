import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StructuredComposer } from "./StructuredComposer";

describe("StructuredComposer", () => {
  it("renders known references as indivisible, focusable-by-click tokens", () => {
    const onChange = vi.fn();
    const onTokenClick = vi.fn();
    const { container } = render(<StructuredComposer value="修改 @Region01 并参考 @Image001" knownTokens={["@Region01", "@Image001"]} ariaLabel="结构化提示词" placeholder="输入" onChange={onChange} onTokenClick={onTokenClick} />);
    const tokens = container.querySelectorAll<HTMLElement>(".structured-token");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toHaveAttribute("contenteditable", "false");
    fireEvent.click(tokens[0]);
    expect(onTokenClick).toHaveBeenCalledWith("@Region01");
    fireEvent.input(screen.getByRole("textbox", { name: "结构化提示词" }), { target: { textContent: "新的要求" } });
    expect(onChange).toHaveBeenLastCalledWith("新的要求");
  });

  it("pastes text without carrying source formatting into the composer", () => {
    const onChange = vi.fn();
    render(<StructuredComposer value="" knownTokens={[]} ariaLabel="结构化提示词" placeholder="输入" onChange={onChange} />);
    const composer = screen.getByRole("textbox", { name: "结构化提示词" });
    composer.focus();
    fireEvent.paste(composer, {
      clipboardData: {
        files: [],
        getData: (type: string) => type === "text/plain" ? "可见文字" : '<span style="color: black">可见文字</span>',
      },
    });

    expect(composer).toHaveTextContent("可见文字");
    expect(composer.querySelector("span")).toBeNull();
    expect(onChange).toHaveBeenCalledWith("可见文字");
  });
});
