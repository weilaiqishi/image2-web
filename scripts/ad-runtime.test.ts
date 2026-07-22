import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { APPROVED_ADSTERRA_BANNER } from "./ad-config.mjs";

const source = readFileSync(resolve(import.meta.dirname, "../site/assets/site.js"), "utf8");
const adsterraKey = APPROVED_ADSTERRA_BANNER.placementId;

function withConfig(provider: "none" | "adsense" | "adsterra") {
  const values = provider === "adsense"
    ? {
        AD_PROVIDER: "adsense",
        ADSENSE_CLIENT: "ca-pub-1234567890123456",
        ADSENSE_SLOT: "1234567890",
        ADSENSE_SCRIPT_URL: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
        ADSTERRA_PLACEMENT_ID: "",
        ADSTERRA_OPTIONS_SOURCE_JSON: JSON.stringify(""),
        ADSTERRA_SCRIPT_ORIGIN: "",
        ADSTERRA_SCRIPT_URL: "",
      }
    : provider === "adsterra"
      ? {
          AD_PROVIDER: "adsterra",
          ADSENSE_CLIENT: "",
          ADSENSE_SLOT: "",
          ADSENSE_SCRIPT_URL: "",
          ADSTERRA_PLACEMENT_ID: adsterraKey,
          ADSTERRA_OPTIONS_SOURCE_JSON: JSON.stringify(APPROVED_ADSTERRA_BANNER.optionsSource),
          ADSTERRA_SCRIPT_ORIGIN: new URL(APPROVED_ADSTERRA_BANNER.scriptUrl).origin,
          ADSTERRA_SCRIPT_URL: APPROVED_ADSTERRA_BANNER.scriptUrl,
        }
      : {
          AD_PROVIDER: "none",
          ADSENSE_CLIENT: "",
          ADSENSE_SLOT: "",
          ADSENSE_SCRIPT_URL: "",
          ADSTERRA_PLACEMENT_ID: "",
          ADSTERRA_OPTIONS_SOURCE_JSON: JSON.stringify(""),
          ADSTERRA_SCRIPT_ORIGIN: "",
          ADSTERRA_SCRIPT_URL: "",
        };

  return Object.entries(values).reduce(
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
} = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body data-locale="en"${options.noAds ? " data-no-ads" : ""}><aside data-ad-unit aria-hidden="true" hidden></aside><button data-consent-reset hidden>Reset</button></body></html>`,
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
  it.each(["adsense", "adsterra"] as const)("makes zero third-party requests before consent for %s", (provider) => {
    const dom = runScenario(provider);

    expect(dom.window.document.querySelector("[data-consent-banner]")?.hasAttribute("hidden")).toBe(false);
    expect(externalResources(dom)).toHaveLength(0);
    expect(dom.window.document.querySelector("[data-ad-unit]")?.hasAttribute("hidden")).toBe(true);
    dom.window.close();
  });

  it.each(["adsense", "adsterra"] as const)("makes zero third-party requests after rejection for %s", (provider) => {
    const dom = runScenario(provider);
    (dom.window.document.querySelector("[data-consent-reject]") as HTMLButtonElement).click();

    expect(dom.window.localStorage.getItem("image2.ads.consent.v2")).toBe("rejected");
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });

  it("loads one Adsterra display tag after explicit consent", () => {
    const dom = runScenario("adsterra");
    const accept = dom.window.document.querySelector("[data-consent-accept]") as HTMLButtonElement;
    accept.click();
    accept.click();

    const scripts = dom.window.document.querySelectorAll("[data-ad-unit] > script");
    const unit = dom.window.document.querySelector("[data-ad-unit]") as HTMLElement;
    expect(scripts).toHaveLength(2);
    expect(scripts[0].textContent).toBe(APPROVED_ADSTERRA_BANNER.optionsSource);
    expect(scripts[1].getAttribute("src")).toBe(APPROVED_ADSTERRA_BANNER.scriptUrl);
    expect((scripts[1] as HTMLScriptElement).async).toBe(false);
    expect(scripts[1].hasAttribute("data-image2-adsterra")).toBe(true);
    expect(unit.dataset.adProvider).toBe("adsterra");
    expect(unit.dataset.adPlacement).toBe(adsterraKey);
    expect(unit.hidden).toBe(false);
    expect(dom.window.document.querySelectorAll("ins.adsbygoogle")).toHaveLength(0);
    dom.window.close();
  });

  it("preserves the existing AdSense non-personalized behavior", () => {
    const dom = runScenario("adsense", { consent: "accepted" });

    expect(dom.window.document.querySelectorAll("script[data-image2-adsense]")).toHaveLength(1);
    expect(dom.window.document.querySelectorAll("ins.adsbygoogle")).toHaveLength(1);
    expect((dom.window as typeof dom.window & { adsbygoogle: { requestNonPersonalizedAds: number } }).adsbygoogle.requestNonPersonalizedAds).toBe(1);
    dom.window.close();
  });

  it("does not carry a legacy acceptance to a newly disclosed provider", () => {
    const dom = runScenario("adsterra", { legacyConsent: "accepted" });

    expect(dom.window.document.querySelector("[data-consent-banner]")?.hasAttribute("hidden")).toBe(false);
    expect(dom.window.localStorage.getItem("image2.ads.consent.v2")).toBeNull();
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });

  it("requires fresh consent when the configured provider changes", () => {
    const dom = runScenario("adsterra", { consent: "accepted:adsense" });

    expect(dom.window.document.querySelector("[data-consent-banner]")?.hasAttribute("hidden")).toBe(false);
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });

  it("carries a legacy rejection forward as the privacy-preserving choice", () => {
    const dom = runScenario("adsterra", { legacyConsent: "rejected" });

    expect(dom.window.localStorage.getItem("image2.ads.consent.v2")).toBe("rejected");
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });

  it("reloads an initialized Adsterra page when another tab withdraws consent", () => {
    const dom = runScenario("adsterra", { consent: "accepted", instrumentReload: true });
    dom.window.dispatchEvent(new dom.window.StorageEvent("storage", {
      key: "image2.ads.consent.v2",
      oldValue: "accepted:adsterra",
      newValue: "rejected",
      storageArea: dom.window.localStorage,
      url: "https://image2.test/privacy/",
    }));

    expect(dom.window.document.body.dataset.adConsent).toBe("rejected");
    expect((dom.window as typeof dom.window & { __consentReloads: number }).__consentReloads).toBe(1);
    dom.window.close();
  });

  it.each(["adsense", "adsterra"] as const)("never initializes %s on data-no-ads pages", (provider) => {
    const dom = runScenario(provider, { consent: "accepted", noAds: true });

    expect(dom.window.document.querySelector("[data-consent-banner]")).toBeNull();
    expect(externalResources(dom)).toHaveLength(0);
    expect(dom.window.document.querySelector("[data-ad-unit]")?.hasAttribute("hidden")).toBe(true);
    dom.window.close();
  });

  it("keeps the current page functional when local storage is blocked", () => {
    const dom = runScenario("adsterra", { storageBlocked: true });
    (dom.window.document.querySelector("[data-consent-accept]") as HTMLButtonElement).click();

    expect(dom.window.document.querySelectorAll("[data-ad-unit] > script")).toHaveLength(2);
    dom.window.close();
  });

  it("does not show consent controls when advertising is disabled", () => {
    const dom = runScenario("none");

    expect(dom.window.document.querySelector("[data-consent-banner]")).toBeNull();
    expect(externalResources(dom)).toHaveLength(0);
    dom.window.close();
  });
});
