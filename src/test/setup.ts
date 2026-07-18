import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { beforeEach } from "vitest";
import { setLocale } from "../i18n";

beforeEach(() => {
  localStorage.clear();
  setLocale("zh-CN", { persist: false });
});

afterEach(cleanup);
