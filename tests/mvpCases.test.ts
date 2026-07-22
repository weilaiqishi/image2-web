import { describe, expect, it } from "vitest";
import catalog from "./fixtures/mvp-image-cases/cases.json";

describe("article MVP case catalog", () => {
  it("keeps the audited 46-case baseline complete and uniquely numbered", () => {
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.cases).toHaveLength(46);
    expect(new Set(catalog.cases.map((item) => item.id)).size).toBe(46);
    expect(catalog.cases.filter((item) => item.type === "UI")).toHaveLength(12);
    expect(catalog.cases.filter((item) => item.type === "REAL")).toHaveLength(30);
    expect(catalog.cases.filter((item) => item.type === "DEFERRED")).toHaveLength(2);
    expect(catalog.cases.filter((item) => item.type === "NEGATIVE")).toHaveLength(2);
  });

  it("requires executable steps and assertions for every case", () => {
    for (const item of catalog.cases) {
      expect(item.id).toMatch(/^MVP-[A-Z]+-\d{2}$/);
      expect(item.title.trim()).not.toBe("");
      expect(item.steps.length).toBeGreaterThan(0);
      expect(item.assertions.length).toBeGreaterThan(0);
    }
  });

  it("preserves the eight-case minimum paid regression set", () => {
    expect(catalog.minimumPaidRegression).toHaveLength(8);
    expect(new Set(catalog.minimumPaidRegression).size).toBe(8);
    for (const id of catalog.minimumPaidRegression) {
      expect(catalog.cases.find((item) => item.id === id)).toMatchObject({ type: "REAL", blocking: true });
    }
  });
});
