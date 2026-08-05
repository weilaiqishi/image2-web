import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "../site/assets/site.js"), "utf8");

const adsenseConfig = {
  AD_PROVIDER: "adsense",
  ADSENSE_CLIENT: "ca-pub-1234567890123456",
  ADSENSE_SLOT: "1234567890",
  ADSENSE_SCRIPT_URL: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
};

function withConfig(provider: "none" | "adsense" | "adsterra") {
  const values = provider === "adsense"
    ? adsenseConfig
    : {
        AD_PROVIDER: provider,
        ADSENSE_CLIENT: "",
        ADSENSE_SLOT: "",
        ADSENSE_SCRIPT_URL: "",
      };

  const compatibilityValues = {
    ADSTERRA_PLACEMENT_ID: "",
    ADSTERRA_OPTIONS_SOURCE_JSON: JSON.stringify(""),
    ADSTERRA_SCRIPT_ORIGIN: "",
    ADSTERRA_SCRIPT_URL: "",
  };

  return Object.entries({ ...values, ...compatibilityValues }).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`__${key}__`, value),
    source,
  );
}

function runScenario(provider: "none" | "adsense" | "adsterra", options: {
  consent?: string;
  legacyConsent?: string;
  noAds?: boolean;
  storageBlocked?: boolean;
  instrumentReload?: boolean;
  resetControl?: boolean;
} = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body data-locale="en"${options.noAds ? " data-no-ads" : ""}><aside class="ad-unit"></aside>${options.resetControl ? "<button data-consent-reset hidden>Reset</button>" : ""}</body></html>`,
    { url: "https://image2.test/guide/", runScripts: "outside-only" },
  );
  if (options.consent) {
    const storedConsent = options.consent === "accepted" ? `accepted:${provider}` : options.consent;
    dom.window.localStorage.setItem("image2.ads.consent.v2", storedConsent);
  }
  if (options.legacyConsent) dom.window.localStorage.setItem("image2.ads.consent.v1", options.legacyConsent);
  if (options.storageBlocked) {
    Object.defineProperty(dom.window, "localStorage", {
      configurable: true,
      value: {
        getItem() { throw new Error("storage blocked"); },
        setItem() { throw new Error("storage blocked"); },
        removeItem() { throw new Error("storage blocked"); },
      },
    });
  }
  const runtimeSource = options.instrumentReload
    ? withConfig(provider).replaceAll("window.location.reload();", "window.__consentReloads = (window.__consentReloads || 0) + 1;")
    : withConfig(provider);
  dom.window.eval(runtimeSource);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return dom;
}

function externalResources(dom: JSDOM) {
  return dom.window.document.querySelectorAll('script[src^="http"], iframe[src^="http"], img[src^="http"]');
}

describe("advertising runtime", () => {
  it("contains no CSP-specific or Adsterra-specific runtime code", () => {
    for (const forbidden of [
      "securitypolicyviolation",
      "csp-blocked",
      "ADSTERRA_",
      "Adsterra",
      "adsterra",
      "atOptions",
      "highperformanceformat",
      "MutationObserver",
      "data-ad-state",
      "no-fill",
      "loader-error",
      "ADSTERRA_RENDER_TIMEOUT_MS",
      "monitorAdsterraUnit",
      "initializeAdsterra",
      "data-image2-adsterra",
    ]) expect(source).not.toContain(forbidden);
  });

  it("does not run consent or local-storage behavior for an Adsterra build", () => {
    const dom = runScenario("adsterra", { resetControl: true });

    expect(dom.window.document.querySelector("[data-consent-banner]")).toBeNull();
    expect(dom.window.document.querySelector("[data-consent-reset]")?.hasAttribute("hidden")).toBe(true);
    expect(dom.window.document.body.hasAttribute("data-ad-consent")).toBe(false);
    expect(dom.window.localStorage.getItem("image2.ads.consent.v2")).toBeNull();
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });

  it("preserves zero third-party requests before AdSense consent", () => {
    const dom = runScenario("adsense");

    expect(dom.window.document.querySelector("[data-consent-banner]")?.hasAttribute("hidden")).toBe(false);
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });

  it("preserves AdSense rejection", () => {
    const dom = runScenario("adsense");
    (dom.window.document.querySelector("[data-consent-reject]") as HTMLButtonElement).click();

    expect(dom.window.localStorage.getItem("image2.ads.consent.v2")).toBe("rejected");
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });

  it("preserves one non-personalized AdSense initialization after consent", () => {
    const dom = runScenario("adsense");
    const accept = dom.window.document.querySelector("[data-consent-accept]") as HTMLButtonElement;
    accept.click();
    accept.click();

    const unit = dom.window.document.querySelector(".ad-unit") as HTMLElement;
    expect(dom.window.document.querySelectorAll("script[data-image2-adsense]")).toHaveLength(1);
    expect(unit.querySelectorAll("ins.adsbygoogle")).toHaveLength(1);
    expect((dom.window as typeof dom.window & { adsbygoogle: { requestNonPersonalizedAds: number } }).adsbygoogle.requestNonPersonalizedAds).toBe(1);
    dom.window.close();
  });

  it("preserves an AdSense opt-in for the current page when local storage is blocked", () => {
    const dom = runScenario("adsense", { storageBlocked: true });
    (dom.window.document.querySelector("[data-consent-accept]") as HTMLButtonElement).click();

    expect(dom.window.document.querySelectorAll(".ad-unit ins.adsbygoogle")).toHaveLength(1);
    dom.window.close();
  });

  it("never initializes AdSense on data-no-ads pages", () => {
    const dom = runScenario("adsense", { consent: "accepted", noAds: true });

    expect(dom.window.document.querySelector("[data-consent-banner]")).toBeNull();
    expect(externalResources(dom)).toHaveLength(0);
    expect(dom.window.document.querySelectorAll("ins.adsbygoogle")).toHaveLength(0);
    dom.window.close();
  });

  it("does not show consent controls when advertising is disabled", () => {
    const dom = runScenario("none", { resetControl: true });

    expect(dom.window.document.querySelector("[data-consent-banner]")).toBeNull();
    expect(dom.window.document.querySelector("[data-consent-reset]")?.hasAttribute("hidden")).toBe(true);
    expect(dom.window.document.body.hasAttribute("data-ad-consent")).toBe(false);
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });
});
