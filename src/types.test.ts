import { describe, expect, it } from "vitest";
import { SIZE_PRESETS } from "./types";

describe("GPT Image 2 size presets", () => {
  it("keeps every dimension divisible by 16 and inside the pixel limit", () => {
    for (const sizes of Object.values(SIZE_PRESETS)) {
      for (const size of Object.values(sizes)) {
        const [width, height] = size.split("x").map(Number);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(width).toBeLessThanOrEqual(3840);
        expect(height).toBeLessThanOrEqual(3840);
        expect(width * height).toBeGreaterThanOrEqual(655_360);
        expect(width * height).toBeLessThanOrEqual(8_294_400);
      }
    }
  });
});
