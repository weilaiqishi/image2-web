import { useEffect, useRef } from "react";

interface StructuredComposerProps {
  value: string;
  knownTokens: string[];
  ariaLabel: string;
  placeholder: string;
  className?: string;
  activeTokens?: string[];
  focusRequest?: number;
  onChange: (value: string) => void;
  onTokenClick?: (token: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
}

function plainText(element: HTMLElement) {
  return Array.from(element.childNodes).map((node) => node.textContent ?? "").join("").replace(/\u00a0/g, " ");
}

function renderValue(element: HTMLDivElement, value: string, knownTokens: string[], activeTokens: string[] = []) {
  const tokens = [...new Set(knownTokens)].sort((left, right) => right.length - left.length);
  const pattern = tokens.length ? new RegExp(`(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g") : null;
  const parts = pattern ? value.split(pattern) : [value];
  element.replaceChildren(...parts.filter(Boolean).map((part) => {
    if (!tokens.includes(part)) return document.createTextNode(part);
    const chip = document.createElement("span");
    chip.className = "structured-token";
    if (activeTokens.includes(part)) chip.classList.add("active");
    chip.setAttribute("contenteditable", "false");
    chip.dataset.token = part;
    chip.textContent = part;
    return chip;
  }));
  element.dataset.empty = value ? "false" : "true";
  (element as HTMLDivElement & { value?: string }).value = value;
}

function moveCaretToEnd(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertPlainText(element: HTMLElement, text: string) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!selection || !range || !element.contains(range.commonAncestorContainer)) {
    element.append(document.createTextNode(text));
    moveCaretToEnd(element);
    return;
  }

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function StructuredComposer({ value, knownTokens, ariaLabel, placeholder, className = "", activeTokens = [], focusRequest = 0, onChange, onTokenClick, onKeyDown, onPaste }: StructuredComposerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const knownKey = knownTokens.join("\u0000");
  const activeKey = activeTokens.join("\u0000");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    (element as HTMLDivElement & { value?: string }).value = value;
    if (plainText(element) === value) return;
    renderValue(element, value, knownTokens, activeTokens);
    if (document.activeElement === element) moveCaretToEnd(element);
  }, [activeKey, activeTokens, knownKey, knownTokens, value]);

  useEffect(() => {
    if (!focusRequest || !ref.current) return;
    ref.current.focus();
    moveCaretToEnd(ref.current);
  }, [focusRequest]);

  return <div
    ref={ref}
    className={`structured-composer ${className}`.trim()}
    contentEditable
    role="textbox"
    aria-label={ariaLabel}
    aria-multiline="true"
    data-placeholder={placeholder}
    data-empty={value ? "false" : "true"}
    suppressContentEditableWarning
    onInput={(event) => {
      const element = event.currentTarget;
      const next = plainText(element);
      element.dataset.empty = next ? "false" : "true";
      (element as HTMLDivElement & { value?: string }).value = next;
      onChange(next);
    }}
    onChange={(event) => {
      const element = event.currentTarget;
      const injected = (event.target as HTMLDivElement & { value?: string }).value;
      const next = typeof injected === "string" ? injected : plainText(element);
      if (plainText(element) !== next) renderValue(element, next, knownTokens, activeTokens);
      onChange(next);
    }}
    onClick={(event) => {
      const target = event.target as HTMLElement;
      if (target.dataset.token) onTokenClick?.(target.dataset.token);
    }}
    onKeyDown={onKeyDown}
    onPaste={(event) => {
      onPaste?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      insertPlainText(event.currentTarget, event.clipboardData.getData("text/plain"));
      const next = plainText(event.currentTarget);
      event.currentTarget.dataset.empty = next ? "false" : "true";
      (event.currentTarget as HTMLDivElement & { value?: string }).value = next;
      onChange(next);
    }}
  />;
}
