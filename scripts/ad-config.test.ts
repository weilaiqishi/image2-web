import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { APPROVED_ADSTERRA_BANNER, resolveAdConfig } from "./ad-config.mjs";

const validAdsense = {
  ADSENSE_CLIENT: "ca-pub-1234567890123456",
  ADSENSE_SLOT: "1234567890",
  ADSENSE_CMP_CERTIFIED: "true",
};

const validAdsterra = {
  ADSTERRA_PLACEMENT_ID: APPROVED_ADSTERRA_BANNER.placementId,
  ADSTERRA_ADS_TXT_RECORD: "example.test, seller-123, DIRECT, authority456",
  ADSTERRA_POLICY_REVIEWED: "true",
};

const headersTemplate = readFileSync(resolve(import.meta.dirname, "../site/_headers"), "utf8");

describe("resolveAdConfig", () => {
  it.each([
    ["default/none", {}, "none"],
    ["Adsterra", { AD_PROVIDER: "adsterra", ...validAdsterra }, "adsterra"],
    ["AdSense", { AD_PROVIDER: "adsense", ...validAdsense }, "adsense"],
  ])("renders zero CSP headers for the %s build", (_, env, expectedProvider) => {
    const config = resolveAdConfig(env);
    const headerLines = headersTemplate.split(/\r?\n/).map((line) => line.trim());

    expect(config.activeProvider).toBe(expectedProvider);
    expect(headerLines.filter((line) => /^Content-Security-Policy(?:-Report-Only)?:/i.test(line))).toHaveLength(0);
    expect(headerLines).toContain("X-Content-Type-Options: nosniff");
    expect(headerLines).toContain("X-Frame-Options: DENY");
    expect(headerLines).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(headerLines).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });

  it("defaults to no active provider and no CSP", () => {
    const config = resolveAdConfig({});

    expect(config.requestedProvider).toBe("none");
    expect(config.activeProvider).toBe("none");
    expect(config.adsEnabled).toBe(false);
    expect(config.adsTxtRecords).toEqual([]);
  });

  it("keeps AdSense verification metadata independent from ad serving", () => {
    const config = resolveAdConfig({ ADSENSE_CLIENT: validAdsense.ADSENSE_CLIENT });

    expect(config.activeProvider).toBe("none");
    expect(config.adsense.publisherClient).toBe(validAdsense.ADSENSE_CLIENT);
    expect(config.adsense.client).toBe("");
    expect(config.adsTxtRecords).toEqual([
      "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0",
    ]);
  });

  it("enables AdSense only when it is selected and every existing gate passes", () => {
    const config = resolveAdConfig({ AD_PROVIDER: "adsense", ...validAdsense });

    expect(config.activeProvider).toBe("adsense");
    expect(config.adsEnabled).toBe(true);
    expect(config.adsense.client).toBe(validAdsense.ADSENSE_CLIENT);
    expect(config.adsense.slot).toBe(validAdsense.ADSENSE_SLOT);
    expect(config.adsense.scriptUrl).toContain("googlesyndication.com");
  });

  it("fails closed when selected AdSense configuration is incomplete", () => {
    const warn = vi.fn();
    const config = resolveAdConfig({
      AD_PROVIDER: "adsense",
      ADSENSE_CLIENT: validAdsense.ADSENSE_CLIENT,
      ADSENSE_SLOT: validAdsense.ADSENSE_SLOT,
    }, warn);

    expect(config.activeProvider).toBe("none");
    expect(config.adsEnabled).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ADSENSE_CMP_CERTIFIED"));
  });

  it("enables an Adsterra display banner only with reviewed, complete public configuration", () => {
    const config = resolveAdConfig({ AD_PROVIDER: "adsterra", ...validAdsterra });

    expect(config.activeProvider).toBe("adsterra");
    expect(config.adsEnabled).toBe(true);
    expect(config.adsterra.tag).toBe(APPROVED_ADSTERRA_BANNER.tag);
    expect(config.adsterra.optionsSource).toBe(APPROVED_ADSTERRA_BANNER.optionsSource);
    expect(config.adsterra.placementId).toBe(APPROVED_ADSTERRA_BANNER.placementId);
    expect(config.adsterra.scriptOrigin).toBe("https://www.highperformanceformat.com");
    expect(config.adsterra.scriptUrl).toBe(APPROVED_ADSTERRA_BANNER.scriptUrl);
    expect(config.adsterra.format).toBe("display-banner-300x250");
    expect(config.adsterra.width).toBe(300);
    expect(config.adsterra.height).toBe(250);
    expect(config.adsTxtRecords).toContain(validAdsterra.ADSTERRA_ADS_TXT_RECORD);
  });

  it("does not accept runtime tag or loader overrides for Adsterra", () => {
    const config = resolveAdConfig({
      AD_PROVIDER: "adsterra",
      ...validAdsterra,
      ADSTERRA_OPTIONS_SOURCE: "atOptions = { key: 'attacker' };",
      ADSTERRA_SCRIPT_ORIGIN: "https://attacker.example",
      ADSTERRA_SCRIPT_URL: "https://attacker.example/invoke.js",
    });

    expect(config.activeProvider).toBe("adsterra");
    expect(config.adsterra.tag).toBe(APPROVED_ADSTERRA_BANNER.tag);
    expect(config.adsterra.optionsSource).toBe(APPROVED_ADSTERRA_BANNER.optionsSource);
    expect(config.adsterra.placementId).toBe(APPROVED_ADSTERRA_BANNER.placementId);
    expect(config.adsterra.scriptOrigin).toBe(new URL(APPROVED_ADSTERRA_BANNER.scriptUrl).origin);
    expect(config.adsterra.scriptUrl).toBe(APPROVED_ADSTERRA_BANNER.scriptUrl);
  });

  it("preserves the validated Google seller record when Adsterra is selected", () => {
    const config = resolveAdConfig({
      AD_PROVIDER: "adsterra",
      ADSENSE_CLIENT: validAdsense.ADSENSE_CLIENT,
      ...validAdsterra,
    });

    expect(config.adsTxtRecords).toEqual([
      "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0",
      validAdsterra.ADSTERRA_ADS_TXT_RECORD,
    ]);
  });

  it("does not require an Adsterra ads.txt record", () => {
    const config = resolveAdConfig({
      AD_PROVIDER: "adsterra",
      ...validAdsterra,
      ADSTERRA_ADS_TXT_RECORD: "",
    });

    expect(config.activeProvider).toBe("adsterra");
    expect(config.adsterra.adsTxtRecord).toBe("");
    expect(config.adsTxtRecords).toEqual([]);
  });

  it.each([
    ["missing placement ID", { ...validAdsterra, ADSTERRA_PLACEMENT_ID: "" }],
    ["unapproved placement ID", { ...validAdsterra, ADSTERRA_PLACEMENT_ID: "0123456789abcdef0123456789abcdef" }],
    ["unreviewed policy", { ...validAdsterra, ADSTERRA_POLICY_REVIEWED: "false" }],
  ])("fails closed for %s", (_, env) => {
    const warn = vi.fn();
    const config = resolveAdConfig({ AD_PROVIDER: "adsterra", ...env }, warn);

    expect(config.activeProvider).toBe("none");
    expect(config.adsEnabled).toBe(false);
    expect(config.adsterra.tag).toBe("");
    expect(config.adsterra.scriptUrl).toBe("");
    expect(warn).toHaveBeenCalled();
  });

  it("rejects an unknown provider without activating either network", () => {
    const warn = vi.fn();
    const config = resolveAdConfig({
      AD_PROVIDER: "automatic",
      ...validAdsense,
      ...validAdsterra,
    }, warn);

    expect(config.requestedProvider).toBe("none");
    expect(config.activeProvider).toBe("none");
    expect(config.adsense.client).toBe("");
    expect(config.adsterra.scriptUrl).toBe("");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("AD_PROVIDER"));
  });

  it("ignores rather than publishes a malformed optional Adsterra seller record", () => {
    const warn = vi.fn();
    const config = resolveAdConfig({
      AD_PROVIDER: "adsterra",
      ...validAdsterra,
      ADSTERRA_ADS_TXT_RECORD: "adsterra.com, guessed",
    }, warn);

    expect(config.activeProvider).toBe("adsterra");
    expect(config.adsTxtRecords).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ADSTERRA_ADS_TXT_RECORD"));
  });
});
