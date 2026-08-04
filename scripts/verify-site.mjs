import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { JSDOM } from "jsdom";
import { resolveAdConfig } from "./ad-config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = resolve(root, "dist-site");
const adConfig = resolveAdConfig(process.env, () => {});
const adsensePublisherClient = adConfig.adsense.publisherClient;
const adsenseClient = adConfig.adsense.client;
const adsenseSlot = adConfig.adsense.slot;

const pages = [
  { path: "index.html", lang: "zh-CN", canonicalSuffix: "/", home: true, ads: true },
  { path: "en/index.html", lang: "en", canonicalSuffix: "/en/", home: true, ads: true },
  { path: "cases/index.html", lang: "zh-CN", canonicalSuffix: "/cases/", content: true, ads: true },
  { path: "en/cases/index.html", lang: "en", canonicalSuffix: "/en/cases/", content: true, ads: true },
  { path: "guide/index.html", lang: "zh-CN", canonicalSuffix: "/guide/", content: true, ads: true },
  { path: "en/guide/index.html", lang: "en", canonicalSuffix: "/en/guide/", content: true, ads: true },
  { path: "troubleshooting/codex-image-not-saved/index.html", lang: "zh-CN", canonicalSuffix: "/troubleshooting/codex-image-not-saved/", content: true, troubleshooting: true, ads: true },
  { path: "en/troubleshooting/codex-image-not-saved/index.html", lang: "en", canonicalSuffix: "/en/troubleshooting/codex-image-not-saved/", content: true, troubleshooting: true, ads: true },
  { path: "about/index.html", lang: "zh-CN", canonicalSuffix: "/about/", content: true, noAds: true },
  { path: "en/about/index.html", lang: "en", canonicalSuffix: "/en/about/", content: true, noAds: true },
  { path: "privacy/index.html", lang: "zh-CN", canonicalSuffix: "/privacy/", content: true, noAds: true },
  { path: "en/privacy/index.html", lang: "en", canonicalSuffix: "/en/privacy/", content: true, noAds: true },
  { path: "404.html", lang: "zh-CN", canonicalSuffix: "/404.html", content: true, noAds: true, notFound: true },
];

const thirdPartyResourceSelector = [
  'script[src^="http"]',
  'iframe[src^="http"]',
  'img[src^="http"]',
  'link[rel="preconnect"][href^="http"]',
  'link[rel="dns-prefetch"][href^="http"]',
].join(",");

const seenMetadata = {
  title: new Map(),
  description: new Map(),
  canonical: new Map(),
};

for (const page of pages) {
  const html = await readFile(resolve(outputDir, page.path), "utf8");
  const $ = load(html);
  const failures = [];
  const metadata = {
    title: $("title").text().trim(),
    description: $('meta[name="description"]').attr("content")?.trim() || "",
    canonical: $('link[rel="canonical"]').attr("href")?.trim() || "",
  };

  if ($("html").attr("lang") !== page.lang) failures.push(`html lang must be ${page.lang}`);
  if ($("h1").length !== 1 || !$("h1").text().trim()) failures.push("must contain exactly one non-empty h1");
  if (($("title").text().trim().length || 0) < 8) failures.push("title is too short");
  if (($('meta[name="description"]').attr("content")?.length || 0) < 40) failures.push("description is too short");
  if (!$('link[rel="canonical"]').attr("href")?.endsWith(page.canonicalSuffix)) failures.push("canonical URL is missing or incorrect");
  for (const [field, value] of Object.entries(metadata)) {
    const duplicatePath = seenMetadata[field].get(value);
    if (value && duplicatePath) failures.push(`${field} duplicates ${duplicatePath}`);
    else if (value) seenMetadata[field].set(value, page.path);
  }
  if ($("img:not([alt])").length > 0) failures.push("every image needs an alt attribute");
  if ($('a[href^="/app/"]').length > 0) failures.push("marketing pages must not expose the browser app");
  if ($('script[src="/assets/site.js"]').length !== 1) failures.push("site.js must be loaded exactly once");
  if ($(thirdPartyResourceSelector).length > 0) failures.push("third-party resources must never be present in static HTML");
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

  if (page.troubleshooting) {
    const pageText = $("main").text().replace(/\s+/g, " ").trim();
    const canonical = $('link[rel="canonical"]').attr("href");
    const jsonLd = $('script[type="application/ld+json"]').toArray().map((script) => JSON.parse($(script).text()));
    const techArticle = jsonLd.find((item) => item["@type"] === "TechArticle");
    const breadcrumbSchema = jsonLd.find((item) => item["@type"] === "BreadcrumbList");
    const expectedAlternates = {
      "zh-CN": `${(process.env.SITE_ORIGIN || "https://image2-studio.pages.dev").replace(/\/$/, "")}/troubleshooting/codex-image-not-saved/`,
      en: `${(process.env.SITE_ORIGIN || "https://image2-studio.pages.dev").replace(/\/$/, "")}/en/troubleshooting/codex-image-not-saved/`,
      "x-default": `${(process.env.SITE_ORIGIN || "https://image2-studio.pages.dev").replace(/\/$/, "")}/troubleshooting/codex-image-not-saved/`,
    };

    if (!$("body").hasClass("troubleshooting-page") || $("body").attr("data-content-type") !== "troubleshooting") failures.push("troubleshooting page marker is missing");
    if ($("nav.breadcrumbs").length !== 1 || $("nav.breadcrumbs a").length < 2 || $("nav.breadcrumbs [aria-current='page']").length !== 1) failures.push("visible breadcrumbs are incomplete");
    for (const [hreflang, href] of Object.entries(expectedAlternates)) {
      if ($(`link[rel="alternate"][hreflang="${hreflang}"][href="${href}"]`).length !== 1) failures.push(`${hreflang} route pairing is incorrect`);
    }
    if ($('meta[property="og:type"][content="article"]').length !== 1) failures.push("article Open Graph type is missing");
    if ($('meta[property="article:published_time"][content="2026-08-03"]').length !== 1
      || $('meta[property="article:modified_time"][content="2026-08-03"]').length !== 1) failures.push("article dates are missing or incorrect");
    if (!techArticle) failures.push("TechArticle schema is missing");
    else {
      if (techArticle.headline !== $("h1").text().trim()) failures.push("TechArticle headline must match the visible h1");
      if (techArticle.inLanguage !== page.lang) failures.push("TechArticle language is incorrect");
      if (techArticle.url !== canonical || techArticle.mainEntityOfPage !== canonical) failures.push("TechArticle URL must match canonical");
      if (techArticle.datePublished !== "2026-08-03" || techArticle.dateModified !== "2026-08-03") failures.push("TechArticle dates are incorrect");
      if (!Array.isArray(techArticle.citation) || techArticle.citation.length < 3) failures.push("TechArticle needs official and project citations");
    }
    if (!breadcrumbSchema || breadcrumbSchema.itemListElement?.length !== 3) failures.push("BreadcrumbList schema is missing or incomplete");

    for (const id of ["triage", "decision-tree", "safe-checks", "saved-path", "gateway-failures", "bug-report", "image2-option", "sources"]) {
      if ($(`#${id}`).length !== 1) failures.push(`required troubleshooting section #${id} is missing`);
    }
    for (const diagnostic of ["tool-unavailable", "generation-running", "session-only", "missing-saved-path", "gateway-failure"]) {
      if ($(`[data-diagnostic="${diagnostic}"]`).length !== 1) failures.push(`diagnostic branch ${diagnostic} is missing`);
    }
    if ($(".diagnostic-rail > li").length !== 5 || $(".decision-tree > li").length < 4) failures.push("diagnostic rail or decision tree is incomplete");
    if ($("#bug-report .checklist > li").length < 5) failures.push("redacted bug-report checklist is incomplete");
    if (!["$imagegen", "saved_path", "generating", "base64", "401", "429"].every((term) => pageText.includes(term))) failures.push("required troubleshooting intent terms are missing");
    if (/\bsk-[A-Za-z0-9_-]{8,}/.test(html)) failures.push("page must never contain an API-key-shaped value");
    if ($('[data-boundary="image2-independent"]').length !== 1) failures.push("independent Image2 boundary is missing");
    if (!pageText.includes("OpenAI") || !pageText.includes("Sub2API")) failures.push("non-affiliation boundary must name OpenAI and Sub2API");
    if (page.lang === "zh-CN") {
      if (!pageText.includes("不能修复 Codex") || !pageText.includes("不保证任意网关兼容") || !pageText.includes("社区报告")) failures.push("Chinese product and evidence boundaries are incomplete");
    } else if (!pageText.includes("does not fix Codex") || !pageText.includes("does not guarantee arbitrary gateway compatibility") || !pageText.includes("Community reports")) failures.push("English product and evidence boundaries are incomplete");

    const primaryCta = $('[data-cta="continue-codex"]');
    const secondaryCta = $('[data-cta="image2-releases"]');
    if (primaryCta.length !== 1 || !primaryCta.hasClass("button-primary") || !/^https:\/\/(?:learn\.chatgpt\.com|github\.com\/openai\/codex)/.test(primaryCta.attr("href") || "")) failures.push("primary Codex troubleshooting CTA is missing or incorrect");
    if (secondaryCta.length !== 1 || !secondaryCta.hasClass("button-secondary") || secondaryCta.attr("href") !== "https://github.com/weilaiqishi/image2-web/releases") failures.push("secondary Image2 Releases CTA is missing or incorrect");
    if (primaryCta.parent().children().first().attr("data-cta") !== "continue-codex") failures.push("Codex CTA must precede the Image2 CTA");
  }

  if (page.noAds) {
    if (!$("body").is("[data-no-ads]")) failures.push("page must opt out with data-no-ads");
    if ($("[data-ad-unit]").length > 0) failures.push("no-ads page must not contain ad units");
    if (page.canonicalSuffix.endsWith("/privacy/")
      && ($("[data-consent-reset]").length !== 1 || !$("[data-consent-reset]").is("[hidden]"))) failures.push("privacy reset control must start hidden");
    if (page.canonicalSuffix.endsWith("/privacy/")) {
      const privacyText = $("main").text();
      if (!privacyText.includes("Google AdSense") || !privacyText.includes("Adsterra")) failures.push("privacy page must disclose both supported advertising providers");
      if ($('a[href="https://adsterra.com/privacy-policy-managed/"]').length !== 1) failures.push("official Adsterra privacy link is missing");
      if ($('a[href="https://adsterra.com/publishers-terms-managed/"]').length !== 1) failures.push("official Adsterra publisher terms link is missing");
      if ($("[data-ad-provider-status]").text().trim() !== adConfig.activeProvider) failures.push("active advertising provider disclosure is incorrect");
    }
  }

  if (page.ads) {
    if ($("[data-ad-unit]").length !== 1) failures.push("ad-bearing page needs exactly one inert data-ad-unit");
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
for (const suffix of ["/", "/en/", "/cases/", "/en/cases/", "/guide/", "/en/guide/", "/troubleshooting/codex-image-not-saved/", "/en/troubleshooting/codex-image-not-saved/", "/about/", "/en/about/", "/privacy/", "/en/privacy/"]) {
  assert.ok(sitemap.includes(`<loc>${(process.env.SITE_ORIGIN || "https://image2-studio.pages.dev").replace(/\/$/, "")}${suffix}</loc>`), `sitemap is missing ${suffix}`);
}
assert.ok(!sitemap.includes("404"), "404 must not appear in sitemap");

const origin = (process.env.SITE_ORIGIN || "https://image2-studio.pages.dev").replace(/\/$/, "");
const troubleshootingSitemapBlocks = [...sitemap.matchAll(/<url>[\s\S]*?<\/url>/g)].map((match) => match[0]);
for (const suffix of ["/troubleshooting/codex-image-not-saved/", "/en/troubleshooting/codex-image-not-saved/"]) {
  const block = troubleshootingSitemapBlocks.find((entry) => entry.includes(`<loc>${origin}${suffix}</loc>`));
  assert.ok(block, `troubleshooting sitemap block is missing ${suffix}`);
  for (const [hreflang, href] of [["zh-CN", `${origin}/troubleshooting/codex-image-not-saved/`], ["en", `${origin}/en/troubleshooting/codex-image-not-saved/`], ["x-default", `${origin}/troubleshooting/codex-image-not-saved/`]]) {
    assert.ok(block.includes(`hreflang="${hreflang}" href="${href}"`), `${suffix} sitemap block is missing ${hreflang}`);
  }
  assert.ok(block.includes("<lastmod>2026-08-03</lastmod>"), `${suffix} sitemap block has the wrong lastmod`);
}

for (const [guidePath, articlePath] of [["guide/index.html", "/troubleshooting/codex-image-not-saved/"], ["en/guide/index.html", "/en/troubleshooting/codex-image-not-saved/"]]) {
  const guideHtml = await readFile(resolve(outputDir, guidePath), "utf8");
  assert.ok(guideHtml.includes(`href="${articlePath}"`), `${guidePath} must link to the localized troubleshooting article`);
}

const redirects = await readFile(resolve(outputDir, "_redirects"), "utf8");
assert.ok(!/\/\*\s+\/index\.html\s+200/.test(redirects), "soft SPA fallback must not mask the real 404 page");

const headers = await readFile(resolve(outputDir, "_headers"), "utf8");
assert.ok(!/__(?:AD|ADSENSE|ADSTERRA)_[A-Z_]+__/.test(headers), "CSP contains unresolved advertising placeholders");
const cspHeaders = headers.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("Content-Security-Policy:"));
if (!adConfig.csp) {
  assert.equal(cspHeaders.length, 0, "static ad-enabled builds must omit CSP because AdSense only supports a fresh nonce-based strict CSP");
} else {
  assert.deepEqual(cspHeaders, [adConfig.csp], "the rendered CSP must exactly match the validated provider configuration");
  if (adConfig.activeProvider === "none") {
    assert.match(cspHeaders[0], /default-src 'self'/, "ad-disabled CSP must remain self-only by default");
    assert.doesNotMatch(headers, /googlesyndication|doubleclick/i, "default CSP must not allow Google ad domains");
  }
}

const adsText = await readFile(resolve(outputDir, "ads.txt"), "utf8");
const activeAdsText = adsText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
assert.deepEqual(activeAdsText, adConfig.adsTxtRecords, "ads.txt must contain only validated seller records");

const builtSiteScript = await readFile(resolve(outputDir, "assets/site.js"), "utf8");
assert.ok(!/__(?:AD|ADSENSE|ADSTERRA)_[A-Z_]+__/.test(builtSiteScript), "site.js contains unresolved advertising placeholders");
assert.match(builtSiteScript, /requestNonPersonalizedAds\s*=\s*1/, "AdSense must default to non-personalized ads");
assert.match(builtSiteScript, new RegExp(`const AD_PROVIDER = "${adConfig.activeProvider}";`), "site.js has the wrong active provider");
if (adConfig.activeProvider === "none") {
  assert.doesNotMatch(builtSiteScript, /https:\/\/pagead2\.googlesyndication\.com/, "disabled site.js must contain no Google loader URL");
  assert.match(builtSiteScript, /const ADSTERRA_OPTIONS_SOURCE = "";/, "disabled site.js must contain no Adsterra options");
  assert.match(builtSiteScript, /const ADSTERRA_SCRIPT_ORIGIN = "";/, "disabled site.js must contain no Adsterra script origin");
  assert.match(builtSiteScript, /const ADSTERRA_SCRIPT_URL = "";/, "disabled site.js must contain no Adsterra loader URL");
  assert.doesNotMatch(builtSiteScript, /highperformanceformat/i, "disabled site.js must contain no Adsterra domain");
}

function withAdConfig(source, client, slot, scriptUrl) {
  return source
    .replace(/const AD_PROVIDER = "[^"]*";/, 'const AD_PROVIDER = "adsense";')
    .replace(/const ADSENSE_CLIENT = "[^"]*";/, `const ADSENSE_CLIENT = "${client}";`)
    .replace(/const ADSENSE_SLOT = "[^"]*";/, `const ADSENSE_SLOT = "${slot}";`)
    .replace(/const ADSENSE_SCRIPT_URL = "[^"]*";/, `const ADSENSE_SCRIPT_URL = "${scriptUrl}";`)
    .replace(/const ADSTERRA_PLACEMENT_ID = "[^"]*";/, 'const ADSTERRA_PLACEMENT_ID = "";')
    .replace(/^const ADSTERRA_OPTIONS_SOURCE = .*;$/m, 'const ADSTERRA_OPTIONS_SOURCE = "";')
    .replace(/const ADSTERRA_SCRIPT_ORIGIN = "[^"]*";/, 'const ADSTERRA_SCRIPT_ORIGIN = "";')
    .replace(/const ADSTERRA_SCRIPT_URL = "[^"]*";/, 'const ADSTERRA_SCRIPT_URL = "";');
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
  if (consent) dom.window.localStorage.setItem("image2.ads.consent.v2", consent === "accepted" ? "accepted:adsense" : consent);
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
  assert.equal(scenario.document.querySelectorAll('script[src^="http"], iframe[src^="http"], img[src^="http"]').length, 0, `${message}: third-party request element detected`);
  assert.equal(scenario.document.querySelectorAll("ins.adsbygoogle").length, 0, `${message}: AdSense unit was initialized`);
}

const validRuntimeScript = withAdConfig(
  builtSiteScript,
  "ca-pub-1234567890123456",
  "1234567890",
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
);
const disabledRuntimeScript = withAdConfig(builtSiteScript, "", "", "")
  .replace('const AD_PROVIDER = "adsense";', 'const AD_PROVIDER = "none";');

const unknownScenario = runConsentScenario(validRuntimeScript);
assert.equal(unknownScenario.document.querySelector("[data-consent-banner]")?.hidden, false, "unknown consent must show the opt-in banner");
assert.equal(unknownScenario.document.querySelector("[data-consent-banner] a")?.getAttribute("href"), "/en/privacy/", "consent banner must link to localized privacy details");
assertNoAdRequest(unknownScenario, "unknown consent");
unknownScenario.dom.window.close();

const rejectedScenario = runConsentScenario(validRuntimeScript);
rejectedScenario.document.querySelector("[data-consent-reject]").click();
assert.equal(rejectedScenario.dom.window.localStorage.getItem("image2.ads.consent.v2"), "rejected", "reject choice must persist");
assertNoAdRequest(rejectedScenario, "rejected consent");
rejectedScenario.dom.window.close();

const acceptedScenario = runConsentScenario(validRuntimeScript);
const acceptButton = acceptedScenario.document.querySelector("[data-consent-accept]");
acceptButton.click();
acceptButton.click();
assert.equal(acceptedScenario.dom.window.localStorage.getItem("image2.ads.consent.v2"), "accepted:adsense", "accept choice must persist for the active provider");
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
  key: "image2.ads.consent.v2",
  oldValue: "accepted:adsense",
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
assert.equal(resetScenario.dom.window.localStorage.getItem("image2.ads.consent.v2"), null, "reset must clear the stored choice");
assertNoAdRequest(resetScenario, "consent reset on data-no-ads page");
resetScenario.dom.window.close();

console.log(`Marketing page, privacy, asset, CSP, and consent checks passed (ads: ${adConfig.activeProvider}).`);
