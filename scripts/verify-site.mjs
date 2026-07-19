import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { JSDOM } from "jsdom";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = resolve(root, "dist-site");
const requestedAdsenseClient = (process.env.ADSENSE_CLIENT || "").trim();
const requestedAdsenseSlot = (process.env.ADSENSE_SLOT || "").trim();
const validAdsenseClient = /^ca-pub-\d{16}$/.test(requestedAdsenseClient);
const validAdsenseSlot = /^\d{10}$/.test(requestedAdsenseSlot);
const adsenseEnabled = validAdsenseClient
  && validAdsenseSlot
  && process.env.ADSENSE_CMP_CERTIFIED === "true";
const adsensePublisherClient = validAdsenseClient ? requestedAdsenseClient : "";
const adsenseClient = adsenseEnabled ? requestedAdsenseClient : "";
const adsenseSlot = adsenseEnabled ? requestedAdsenseSlot : "";

const pages = [
  { path: "index.html", lang: "zh-CN", canonicalSuffix: "/", home: true, ads: true },
  { path: "en/index.html", lang: "en", canonicalSuffix: "/en/", home: true, ads: true },
  { path: "cases/index.html", lang: "zh-CN", canonicalSuffix: "/cases/", content: true, ads: true },
  { path: "en/cases/index.html", lang: "en", canonicalSuffix: "/en/cases/", content: true, ads: true },
  { path: "guide/index.html", lang: "zh-CN", canonicalSuffix: "/guide/", content: true, ads: true },
  { path: "en/guide/index.html", lang: "en", canonicalSuffix: "/en/guide/", content: true, ads: true },
  { path: "about/index.html", lang: "zh-CN", canonicalSuffix: "/about/", content: true, noAds: true },
  { path: "en/about/index.html", lang: "en", canonicalSuffix: "/en/about/", content: true, noAds: true },
  { path: "privacy/index.html", lang: "zh-CN", canonicalSuffix: "/privacy/", content: true, noAds: true },
  { path: "en/privacy/index.html", lang: "en", canonicalSuffix: "/en/privacy/", content: true, noAds: true },
  { path: "404.html", lang: "zh-CN", canonicalSuffix: "/404.html", content: true, noAds: true, notFound: true },
];

const googleResourceSelector = [
  'script[src*="google"]',
  'script[src*="doubleclick"]',
  'iframe[src*="google"]',
  'iframe[src*="doubleclick"]',
  'img[src*="google"]',
  'img[src*="doubleclick"]',
  'link[rel="preconnect"][href*="google"]',
  'link[rel="dns-prefetch"][href*="google"]',
].join(",");

for (const page of pages) {
  const html = await readFile(resolve(outputDir, page.path), "utf8");
  const $ = load(html);
  const failures = [];

  if ($("html").attr("lang") !== page.lang) failures.push(`html lang must be ${page.lang}`);
  if ($("h1").length !== 1 || !$("h1").text().trim()) failures.push("must contain exactly one non-empty h1");
  if (($("title").text().trim().length || 0) < 8) failures.push("title is too short");
  if (($('meta[name="description"]').attr("content")?.length || 0) < 40) failures.push("description is too short");
  if (!$('link[rel="canonical"]').attr("href")?.endsWith(page.canonicalSuffix)) failures.push("canonical URL is missing or incorrect");
  if ($("img:not([alt])").length > 0) failures.push("every image needs an alt attribute");
  if ($('a[href^="/app/"]').length > 0) failures.push("marketing pages must not expose the browser app");
  if ($('script[src="/assets/site.js"]').length !== 1) failures.push("site.js must be loaded exactly once");
  if ($(googleResourceSelector).length > 0) failures.push("Google resources must never be present in static HTML");
  if ($("ins.adsbygoogle").length > 0) failures.push("AdSense elements must be created only after consent");
  if (/__[A-Z0-9_]+__/.test(html)) failures.push("contains an unresolved build placeholder");

  if (!page.notFound) {
    if ($('link[rel="alternate"][hreflang="zh-CN"]').length !== 1) failures.push("zh-CN hreflang is missing");
    if ($('link[rel="alternate"][hreflang="en"]').length !== 1) failures.push("English hreflang is missing");
  }

  if (page.home) {
    if ($("h1").text().trim() !== "Image2 Studio") failures.push("homepage h1 must be literal Image2 Studio");
    if ($('meta[property="og:image"]').length !== 1) failures.push("Open Graph image is missing");
    if ($('a[href*="github.com/weilaiqishi/image2-web/releases"]').length < 2) failures.push("GitHub Releases CTAs are missing");
    if ($(".case-item img").length < 8) failures.push("generated case gallery must contain at least eight images");
    for (const href of ["/cases/", "/guide/", "/about/", "/privacy/"]) {
      const localizedHref = page.lang === "en" ? `/en${href}` : href;
      if ($(`a[href="${localizedHref}"]`).length < 1) failures.push(`internal link ${localizedHref} is missing`);
    }
  }

  if (page.content) {
    if (!$("body").hasClass("content-page")) failures.push("content page body needs content-page class");
    if ($("main.content-main").length !== 1) failures.push("content-main is missing");
    if ($("article.content-article").length !== 1) failures.push("content-article is missing");
    if ($(".content-header").length !== 1 || $(".content-body").length !== 1) failures.push("content header or body is missing");
  }

  if (page.noAds) {
    if (!$("body").is("[data-no-ads]")) failures.push("page must opt out with data-no-ads");
    if ($("[data-ad-unit]").length > 0) failures.push("no-ads page must not contain ad units");
    if (page.canonicalSuffix.endsWith("/privacy/")
      && ($("[data-consent-reset]").length !== 1 || !$("[data-consent-reset]").is("[hidden]"))) failures.push("privacy reset control must start hidden");
  }

  if (page.ads) {
    if ($("[data-ad-unit]").length < 1) failures.push("ad-bearing page needs an inert data-ad-unit");
    if ($('meta[name="google-adsense-account"]').length !== 1
      || $('meta[name="google-adsense-account"]').attr("content") !== adsensePublisherClient) failures.push("official AdSense account meta is incorrect");
    if ($('meta[name="adsense-client"]').attr("content") !== adsenseClient) failures.push("AdSense client build value is incorrect");
    if ($('meta[name="adsense-slot"]').attr("content") !== adsenseSlot) failures.push("AdSense slot build value is incorrect");
    $("[data-ad-unit]").each((_, unit) => {
      const element = $(unit);
      if (!element.is("[hidden]")) failures.push("ad units must start hidden");
      if (element.attr("aria-hidden") !== "true") failures.push("ad units must start aria-hidden");
      if (element.children().length > 0) failures.push("ad units must be inert before consent");
    });
  }

  if (page.notFound && !($('meta[name="robots"]').attr("content") || "").includes("noindex")) failures.push("404 must be noindex");

  for (const script of $('script[type="application/ld+json"]').toArray()) JSON.parse($(script).text());
  if (failures.length) throw new Error(`${page.path}: ${failures.join("; ")}`);
}

const requiredFiles = [
  "assets/site.css",
  "assets/site.js",
  "ads.txt",
  "images/og-image2-studio.jpg",
  "images/studio-workspace-dark.jpg",
  "images/guide/settings.jpg",
  "images/guide/workspace.jpg",
  "images/guide/annotation.webp",
  "images/cases/case-fashion.webp",
  "images/cases/case-product.webp",
  "images/cases/case-food.webp",
  "images/cases/case-ui.webp",
  "images/cases/case-architecture.webp",
  "images/cases/case-game.webp",
  "images/cases/case-illustration.webp",
  "images/cases/case-storyboard.webp",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  "_redirects",
];

for (const file of requiredFiles) await access(resolve(outputDir, file));

const sitemap = await readFile(resolve(outputDir, "sitemap.xml"), "utf8");
for (const suffix of ["/", "/en/", "/cases/", "/en/cases/", "/guide/", "/en/guide/", "/about/", "/en/about/", "/privacy/", "/en/privacy/"]) {
  assert.ok(sitemap.includes(`<loc>${(process.env.SITE_ORIGIN || "https://image2-studio.pages.dev").replace(/\/$/, "")}${suffix}</loc>`), `sitemap is missing ${suffix}`);
}
assert.ok(!sitemap.includes("404"), "404 must not appear in sitemap");

const redirects = await readFile(resolve(outputDir, "_redirects"), "utf8");
assert.ok(!/\/\*\s+\/index\.html\s+200/.test(redirects), "soft SPA fallback must not mask the real 404 page");

const headers = await readFile(resolve(outputDir, "_headers"), "utf8");
assert.ok(!/__ADSENSE_[A-Z_]+__/.test(headers), "CSP contains unresolved AdSense placeholders");
const cspHeaders = headers.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("Content-Security-Policy:"));
if (adsenseEnabled) {
  assert.equal(cspHeaders.length, 0, "static ad-enabled builds must omit CSP because AdSense only supports a fresh nonce-based strict CSP");
} else {
  assert.equal(cspHeaders.length, 1, "ad-disabled builds must retain one enforced CSP header");
  assert.match(cspHeaders[0], /default-src 'self'/, "ad-disabled CSP must remain self-only by default");
  assert.doesNotMatch(headers, /googlesyndication|doubleclick/i, "default CSP must not allow Google ad domains");
}

const adsText = await readFile(resolve(outputDir, "ads.txt"), "utf8");
const activeAdsText = adsText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
if (validAdsenseClient) {
  assert.ok(activeAdsText.includes(`google.com, ${adsensePublisherClient.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0`), "validated publisher ads.txt record is missing");
} else {
  assert.equal(activeAdsText.length, 0, "placeholder ads.txt must not publish a fake seller record");
}

const builtSiteScript = await readFile(resolve(outputDir, "assets/site.js"), "utf8");
assert.ok(!/__ADSENSE_[A-Z_]+__/.test(builtSiteScript), "site.js contains unresolved AdSense placeholders");
assert.match(builtSiteScript, /requestNonPersonalizedAds\s*=\s*1/, "AdSense must default to non-personalized ads");
if (!adsenseEnabled) assert.doesNotMatch(builtSiteScript, /https:\/\/pagead2\.googlesyndication\.com/, "default site.js must contain no Google loader URL");

function withAdConfig(source, client, slot, scriptUrl) {
  return source
    .replace(/const ADSENSE_CLIENT = "[^"]*";/, `const ADSENSE_CLIENT = "${client}";`)
    .replace(/const ADSENSE_SLOT = "[^"]*";/, `const ADSENSE_SLOT = "${slot}";`)
    .replace(/const ADSENSE_SCRIPT_URL = "[^"]*";/, `const ADSENSE_SCRIPT_URL = "${scriptUrl}";`);
}

function runConsentScenario(source, { consent, noAds = false, resetControl = false, storageBlocked = false, instrumentReload = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body data-locale="en"${noAds ? " data-no-ads" : ""}><aside data-ad-unit aria-hidden="true" hidden></aside>${resetControl ? "<button data-consent-reset hidden>Reset</button>" : ""}</body></html>`, {
    url: "https://image2.test/guide/",
    runScripts: "outside-only",
  });
  const requests = [];
  dom.window.fetch = (...args) => {
    requests.push({ kind: "fetch", args });
    return Promise.resolve({ ok: true });
  };
  class TestXMLHttpRequest {
    open(method, url) { this.method = method; this.url = url; }
    send() { requests.push({ kind: "xhr", method: this.method, url: this.url }); }
  }
  dom.window.XMLHttpRequest = TestXMLHttpRequest;
  if (consent) dom.window.localStorage.setItem("image2.ads.consent.v1", consent);
  if (storageBlocked) {
    Object.defineProperty(dom.window, "localStorage", {
      configurable: true,
      value: {
        getItem() { throw new Error("storage blocked"); },
        setItem() { throw new Error("storage blocked"); },
        removeItem() { throw new Error("storage blocked"); },
      },
    });
  }
  const runtimeSource = instrumentReload
    ? source.replaceAll("window.location.reload();", "window.__consentReloads = (window.__consentReloads || 0) + 1;")
    : source;
  dom.window.eval(runtimeSource);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return { dom, document: dom.window.document, requests };
}

function assertNoAdRequest(scenario, message) {
  assert.equal(scenario.requests.length, 0, `${message}: fetch/XHR request detected`);
  assert.equal(scenario.document.querySelectorAll('script[src*="google"], script[src*="doubleclick"], iframe[src*="google"], iframe[src*="doubleclick"], img[src*="google"], img[src*="doubleclick"]').length, 0, `${message}: Google request element detected`);
  assert.equal(scenario.document.querySelectorAll("ins.adsbygoogle").length, 0, `${message}: AdSense unit was initialized`);
}

const validRuntimeScript = withAdConfig(
  builtSiteScript,
  "ca-pub-1234567890123456",
  "1234567890",
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
);
const disabledRuntimeScript = withAdConfig(builtSiteScript, "", "", "");

const unknownScenario = runConsentScenario(validRuntimeScript);
assert.equal(unknownScenario.document.querySelector("[data-consent-banner]")?.hidden, false, "unknown consent must show the opt-in banner");
assert.equal(unknownScenario.document.querySelector("[data-consent-banner] a")?.getAttribute("href"), "/en/privacy/", "consent banner must link to localized privacy details");
assertNoAdRequest(unknownScenario, "unknown consent");
unknownScenario.dom.window.close();

const rejectedScenario = runConsentScenario(validRuntimeScript);
rejectedScenario.document.querySelector("[data-consent-reject]").click();
assert.equal(rejectedScenario.dom.window.localStorage.getItem("image2.ads.consent.v1"), "rejected", "reject choice must persist");
assertNoAdRequest(rejectedScenario, "rejected consent");
rejectedScenario.dom.window.close();

const acceptedScenario = runConsentScenario(validRuntimeScript);
const acceptButton = acceptedScenario.document.querySelector("[data-consent-accept]");
acceptButton.click();
acceptButton.click();
assert.equal(acceptedScenario.dom.window.localStorage.getItem("image2.ads.consent.v1"), "accepted", "accept choice must persist");
assert.equal(acceptedScenario.document.querySelectorAll("script[data-image2-adsense]").length, 1, "accepted consent must load AdSense once");
assert.equal(acceptedScenario.document.querySelectorAll("ins.adsbygoogle").length, 1, "accepted consent must initialize each ad unit once");
assert.equal(acceptedScenario.document.querySelector("[data-ad-unit]").hidden, false, "accepted ad unit must become visible");
assert.equal(acceptedScenario.dom.window.adsbygoogle.requestNonPersonalizedAds, 1, "accepted ads must remain non-personalized by default");
assert.equal(acceptedScenario.requests.length, 0, "site code must not issue fetch/XHR calls while loading AdSense");
acceptedScenario.dom.window.close();

const persistedScenario = runConsentScenario(validRuntimeScript, { consent: "accepted" });
assert.equal(persistedScenario.document.querySelectorAll("script[data-image2-adsense]").length, 1, "persisted opt-in must initialize AdSense once");
persistedScenario.dom.window.close();

const crossTabWithdrawalScenario = runConsentScenario(validRuntimeScript, { consent: "accepted", instrumentReload: true });
crossTabWithdrawalScenario.dom.window.dispatchEvent(new crossTabWithdrawalScenario.dom.window.StorageEvent("storage", {
  key: "image2.ads.consent.v1",
  oldValue: "accepted",
  newValue: "rejected",
  storageArea: crossTabWithdrawalScenario.dom.window.localStorage,
  url: "https://image2.test/privacy/",
}));
assert.equal(crossTabWithdrawalScenario.document.body.dataset.adConsent, "rejected", "cross-tab withdrawal must update the local consent state");
assert.equal(crossTabWithdrawalScenario.dom.window.__consentReloads, 1, "cross-tab withdrawal must reload a tab that already initialized ads");
crossTabWithdrawalScenario.dom.window.close();

const blockedStorageScenario = runConsentScenario(validRuntimeScript, { storageBlocked: true });
blockedStorageScenario.document.querySelector("[data-consent-accept]").click();
assert.equal(blockedStorageScenario.document.querySelectorAll("script[data-image2-adsense]").length, 1, "explicit opt-in must work for the current page when storage is blocked");
blockedStorageScenario.dom.window.close();

const noAdsScenario = runConsentScenario(validRuntimeScript, { consent: "accepted", noAds: true });
assertNoAdRequest(noAdsScenario, "data-no-ads page");
assert.equal(noAdsScenario.document.querySelector("[data-consent-banner]"), null, "data-no-ads page must not initialize the banner");
noAdsScenario.dom.window.close();

const disabledScenario = runConsentScenario(disabledRuntimeScript, { consent: "accepted" });
assertNoAdRequest(disabledScenario, "unconfigured build");
assert.equal(disabledScenario.document.querySelector("[data-consent-banner]"), null, "unconfigured build must not initialize the banner");
disabledScenario.dom.window.close();

const resetScenario = runConsentScenario(validRuntimeScript, { consent: "rejected", noAds: true, resetControl: true });
resetScenario.document.querySelector("[data-consent-reset]").click();
assert.equal(resetScenario.dom.window.localStorage.getItem("image2.ads.consent.v1"), null, "reset must clear the stored choice");
assertNoAdRequest(resetScenario, "consent reset on data-no-ads page");
resetScenario.dom.window.close();

console.log(`Marketing page, privacy, asset, CSP, and consent checks passed (AdSense ${adsenseEnabled ? "configured" : "disabled"}).`);
