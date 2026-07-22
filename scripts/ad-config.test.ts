import { describe, expect, it, vi } from "vitest";

import { APPROVED_ADSTERRA_BANNER, resolveAdConfig } from "./ad-config.mjs";

const validAdsense = {
  ADSENSE_CLIENT: "ca-pub-1234567890123456",
  ADSENSE_SLOT: "1234567890",
  ADSENSE_CMP_CERTIFIED: "true",
};

const validAdsterra = {
  ADSTERRA_PLACEMENT_ID: APPROVED_ADSTERRA_BANNER.placementId,
  ADSTERRA_CSP_ORIGINS: "https://www.highperformanceformat.com, https://media.example.test",
  ADSTERRA_ADS_TXT_RECORD: "example.test, seller-123, DIRECT, authority456",
  ADSTERRA_POLICY_REVIEWED: "true",
};

describe("resolveAdConfig", () => {
  it("defaults to no active provider and a self-only CSP", () => {
    const config = resolveAdConfig({});

    expect(config.requestedProvider).toBe("none");
    expect(config.activeProvider).toBe("none");
    expect(config.adsEnabled).toBe(false);
    expect(config.csp).toContain("default-src 'self'");
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
    expect(config.csp).toBe("");
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
    expect(config.csp).toContain("default-src 'self'");
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
    expect(config.csp).toContain("script-src 'self' 'unsafe-inline' https://www.highperformanceformat.com https://media.example.test");
    expect(config.csp).toContain("frame-src 'self' https://www.highperformanceformat.com https://media.example.test");
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
    ["script origin outside CSP", { ...validAdsterra, ADSTERRA_CSP_ORIGINS: "https://media.example.test" }],
  ])("fails closed for %s", (_, env) => {
    const warn = vi.fn();
    const config = resolveAdConfig({ AD_PROVIDER: "adsterra", ...env }, warn);

    expect(config.activeProvider).toBe("none");
    expect(config.adsEnabled).toBe(false);
    expect(config.adsterra.tag).toBe("");
    expect(config.adsterra.scriptUrl).toBe("");
    expect(config.csp).toContain("default-src 'self'");
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
