const AD_PROVIDER = "__AD_PROVIDER__";
const ADSENSE_CLIENT = "__ADSENSE_CLIENT__";
const ADSENSE_SLOT = "__ADSENSE_SLOT__";
const ADSENSE_SCRIPT_URL = "__ADSENSE_SCRIPT_URL__";
const ADSTERRA_PLACEMENT_ID = "__ADSTERRA_PLACEMENT_ID__";
const ADSTERRA_OPTIONS_SOURCE = __ADSTERRA_OPTIONS_SOURCE_JSON__;
const ADSTERRA_SCRIPT_ORIGIN = "__ADSTERRA_SCRIPT_ORIGIN__";
const ADSTERRA_SCRIPT_URL = "__ADSTERRA_SCRIPT_URL__";
const ADSTERRA_RENDER_TIMEOUT_MS = 10000;
const AD_CONSENT_KEY = "image2.ads.consent.v2";
const LEGACY_AD_CONSENT_KEY = "image2.ads.consent.v1";
const VALID_CONSENT = new Set(["accepted", "rejected"]);

let adsInitialized = false;
let siteInitialized = false;
let inMemoryAdConsent;

function parseStoredAdConsent(value) {
  if (value === "rejected") return "rejected";
  if (value === `accepted:${AD_PROVIDER}`) return "accepted";
  return "unknown";
}

function readAdConsent() {
  if (VALID_CONSENT.has(inMemoryAdConsent) || inMemoryAdConsent === "unknown") return inMemoryAdConsent;
  try {
    const value = window.localStorage.getItem(AD_CONSENT_KEY);
    const storedConsent = parseStoredAdConsent(value);
    if (storedConsent !== "unknown") return storedConsent;
    return window.localStorage.getItem(LEGACY_AD_CONSENT_KEY) === "rejected" ? "rejected" : "unknown";
  } catch {
    return "unknown";
  }
}

function writeAdConsent(value) {
  try {
    if (value === "unknown") window.localStorage.removeItem(AD_CONSENT_KEY);
    else window.localStorage.setItem(AD_CONSENT_KEY, value === "accepted" ? `accepted:${AD_PROVIDER}` : value);
  } catch {
    // A blocked storage API keeps the decision in-memory for this page only.
  }
  applyAdConsentState(value);
}

function applyAdConsentState(value) {
  inMemoryAdConsent = value;
  document.body.dataset.adConsent = value;
  document.querySelectorAll("[data-consent-status]").forEach((node) => {
    node.textContent = value;
  });
  document.querySelectorAll("[data-consent-reset]").forEach((button) => {
    button.hidden = !adsAreConfigured() || value === "unknown";
  });
  document.dispatchEvent(new CustomEvent("image2:ad-consent", { detail: { value, provider: AD_PROVIDER } }));
}

function adsenseIsConfigured() {
  return /^ca-pub-\d{16}$/.test(ADSENSE_CLIENT)
    && /^\d{10}$/.test(ADSENSE_SLOT)
    && ADSENSE_SCRIPT_URL.startsWith("https://");
}

function adsterraIsConfigured() {
  return /^[a-f0-9]{32}$/.test(ADSTERRA_PLACEMENT_ID)
    && ADSTERRA_OPTIONS_SOURCE.includes(`'key' : '${ADSTERRA_PLACEMENT_ID}'`)
    && ADSTERRA_OPTIONS_SOURCE.includes("'format' : 'iframe'")
    && ADSTERRA_OPTIONS_SOURCE.includes("'height' : 250")
    && ADSTERRA_OPTIONS_SOURCE.includes("'width' : 300")
    && ADSTERRA_OPTIONS_SOURCE.includes("'params' : {}")
    && ADSTERRA_SCRIPT_URL === `${ADSTERRA_SCRIPT_ORIGIN}/${ADSTERRA_PLACEMENT_ID}/invoke.js`;
}

const AD_PROVIDERS = {
  adsense: { label: "Google AdSense", isConfigured: adsenseIsConfigured, initialize: initializeAdsense },
  adsterra: { label: "Adsterra", isConfigured: adsterraIsConfigured, initialize: initializeAdsterra },
};

function activeAdProvider() {
  const provider = AD_PROVIDERS[AD_PROVIDER];
  return provider?.isConfigured() ? provider : null;
}

function adsAreConfigured() {
  return activeAdProvider() !== null;
}

function pageAllowsAds() {
  return !document.body.hasAttribute("data-no-ads") && document.querySelector("[data-ad-unit]") !== null;
}

function adLabels() {
  const provider = activeAdProvider();
  const providerLabel = provider?.label || "the selected advertising provider";
  const isAdsense = AD_PROVIDER === "adsense";
  return document.body.getAttribute("data-locale") === "zh-CN"
    ? {
        title: "是否允许加载广告？",
        description: isAdsense
          ? "只有你明确同意后，本页才会连接 Google AdSense，并默认请求非个性化广告。拒绝不会产生 Google 广告请求。"
          : `只有你明确同意后，本页才会连接 ${providerLabel} 并加载展示横幅。拒绝不会产生该广告平台的请求。`,
        accept: "同意并加载",
        reject: "拒绝",
        label: "广告隐私选择",
        details: "查看隐私说明",
        privacyHref: "/privacy/",
      }
    : {
        title: "Allow ads on this site?",
        description: isAdsense
          ? "This page connects to Google AdSense only after you opt in, and requests non-personalized ads by default. Rejecting sends no Google advertising request."
          : `This page connects to ${providerLabel} and loads a display banner only after you opt in. Rejecting sends no request to that advertising provider.`,
        accept: "Allow and load",
        reject: "Reject",
        label: "Advertising privacy choice",
        details: "Read the privacy details",
        privacyHref: "/en/privacy/",
      };
}

function ensureConsentBanner() {
  const existing = document.querySelector("[data-consent-banner]");
  if (existing) return existing;
  const labels = adLabels();
  const banner = document.createElement("section");
  banner.className = "consent-banner";
  banner.hidden = true;
  banner.setAttribute("data-consent-banner", "");
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", labels.label);
  banner.innerHTML = `
    <div class="consent-copy">
      <strong>${labels.title}</strong>
      <p>${labels.description}</p>
      <a href="${labels.privacyHref}">${labels.details}</a>
    </div>
    <div class="consent-actions">
      <button class="button button-secondary" type="button" data-consent-reject>${labels.reject}</button>
      <button class="button button-primary" type="button" data-consent-accept>${labels.accept}</button>
    </div>
  `;
  document.body.append(banner);
  return banner;
}

function hideConsentBanners() {
  document.querySelectorAll("[data-consent-banner]").forEach((banner) => { banner.hidden = true; });
}

function showConsentBanner() {
  if (!adsAreConfigured() || !pageAllowsAds()) return;
  ensureConsentBanner().hidden = false;
}

function initializeAdsense(units) {
  const queue = window.adsbygoogle = window.adsbygoogle || [];
  queue.requestNonPersonalizedAds = 1;

  units.forEach((unit) => {
    if (unit.hasAttribute("data-ad-initialized")) return;
    const requestedSlot = unit.getAttribute("data-ad-slot") || "";
    const slot = /^\d{10}$/.test(requestedSlot) ? requestedSlot : ADSENSE_SLOT;
    const ad = document.createElement("ins");
    ad.className = "adsbygoogle";
    ad.style.display = "block";
    ad.setAttribute("data-ad-client", ADSENSE_CLIENT);
    ad.setAttribute("data-ad-slot", slot);
    ad.setAttribute("data-ad-format", "auto");
    ad.setAttribute("data-full-width-responsive", "true");
    unit.replaceChildren(ad);
    unit.classList.add("is-ad-ready");
    unit.hidden = false;
    unit.setAttribute("data-ad-initialized", "");
    unit.setAttribute("aria-hidden", "false");
    queue.push({});
  });

  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.referrerPolicy = "strict-origin-when-cross-origin";
  script.src = `${ADSENSE_SCRIPT_URL}?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
  script.setAttribute("data-image2-adsense", "");
  document.head.append(script);
  return true;
}

function setAdsterraUnitState(unit, state) {
  const visible = state === "loading" || state === "rendered";
  unit.dataset.adState = state;
  unit.classList.toggle("is-ad-ready", visible);
  unit.hidden = !visible;
  unit.setAttribute("aria-hidden", String(!visible));
}

function monitorAdsterraUnit(unit, loaderScript) {
  let renderTimeout;
  const detectCreative = () => {
    if (!unit.querySelector("iframe")) return false;
    window.clearTimeout(renderTimeout);
    setAdsterraUnitState(unit, "rendered");
    observer.disconnect();
    return true;
  };
  const reportFailure = (state) => {
    if (detectCreative() || unit.dataset.adState === state) return;
    window.clearTimeout(renderTimeout);
    setAdsterraUnitState(unit, state);
    console.warn(`[Image2 ads] Adsterra ${state}; collapsing unrendered ad slot.`);
  };
  const observer = new MutationObserver(detectCreative);
  observer.observe(unit, { childList: true, subtree: true });
  loaderScript.addEventListener("load", detectCreative, { once: true });
  loaderScript.addEventListener("error", () => reportFailure("loader-error"), { once: true });
  renderTimeout = window.setTimeout(() => reportFailure("no-fill"), ADSTERRA_RENDER_TIMEOUT_MS);
}

function initializeAdsterra(units) {
  units.forEach((unit) => {
    if (unit.hasAttribute("data-ad-initialized")) return;
    unit.replaceChildren();
    unit.dataset.adProvider = "adsterra";
    unit.dataset.adPlacement = ADSTERRA_PLACEMENT_ID;
    unit.setAttribute("data-ad-initialized", "");
    setAdsterraUnitState(unit, "loading");
    const optionsScript = document.createElement("script");
    optionsScript.textContent = ADSTERRA_OPTIONS_SOURCE;
    unit.append(optionsScript);

    const loaderScript = document.createElement("script");
    // Match the approved parser-ordered tag: the loader must observe atOptions.
    loaderScript.async = false;
    loaderScript.src = ADSTERRA_SCRIPT_URL;
    loaderScript.setAttribute("data-image2-adsterra", "");
    monitorAdsterraUnit(unit, loaderScript);
    unit.append(loaderScript);
  });
  return true;
}

function initializeAds() {
  const provider = activeAdProvider();
  if (adsInitialized || !provider || !pageAllowsAds() || readAdConsent() !== "accepted") return false;
  const units = Array.from(document.querySelectorAll("[data-ad-unit]"));
  if (!units.length) return false;
  adsInitialized = provider.initialize(units);
  return adsInitialized;
}

function acceptAds() {
  writeAdConsent("accepted");
  hideConsentBanners();
  initializeAds();
}

function rejectAds() {
  writeAdConsent("rejected");
  hideConsentBanners();
}

function resetAdConsent() {
  const needsReload = adsInitialized;
  writeAdConsent("unknown");
  if (needsReload) {
    window.location.reload();
    return;
  }
  showConsentBanner();
}

function syncAdConsentFromStorage(event) {
  if (event.key !== AD_CONSENT_KEY && event.key !== null) return;
  const value = parseStoredAdConsent(event.newValue);
  applyAdConsentState(value);

  if (!adsAreConfigured() || !pageAllowsAds()) return;
  if (adsInitialized && value !== "accepted") {
    window.location.reload();
    return;
  }
  if (value === "accepted") {
    hideConsentBanners();
    initializeAds();
  } else if (value === "unknown") {
    showConsentBanner();
  } else {
    hideConsentBanners();
  }
}

function bindConsentControls() {
  document.querySelectorAll("[data-consent-accept]").forEach((button) => button.addEventListener("click", acceptAds));
  document.querySelectorAll("[data-consent-reject]").forEach((button) => button.addEventListener("click", rejectAds));
  document.querySelectorAll("[data-consent-reset]").forEach((button) => button.addEventListener("click", resetAdConsent));
}

function initializeConsent() {
  const consent = readAdConsent();
  writeAdConsent(consent);
  window.addEventListener("storage", syncAdConsentFromStorage);

  if (!adsAreConfigured() || !pageAllowsAds()) {
    bindConsentControls();
    return;
  }

  if (consent === "accepted") initializeAds();
  else if (consent === "unknown") ensureConsentBanner();
  bindConsentControls();
  if (consent === "unknown") showConsentBanner();
}

function initializeCaseLightbox() {
  const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
  const caseItems = Array.from(document.querySelectorAll(".case-item"));
  if (!caseItems.length) return;

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.getAttribute("data-filter") || "all";
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      caseItems.forEach((item) => {
        item.hidden = filter !== "all" && item.getAttribute("data-category") !== filter;
      });
    });
  });

  const locale = document.body.getAttribute("data-locale") || "en";
  const labels = locale === "zh-CN"
    ? { close: "关闭案例预览", previous: "上一个案例", next: "下一个案例", open: "放大查看" }
    : { close: "Close case preview", previous: "Previous case", next: "Next case", open: "Open full preview" };

  const lightbox = document.createElement("div");
  lightbox.className = "case-lightbox";
  lightbox.hidden = true;
  lightbox.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="${labels.close}" title="${labels.close}">×</button>
    <button class="lightbox-previous" type="button" aria-label="${labels.previous}" title="${labels.previous}">←</button>
    <figure><img alt="" /><figcaption><span></span><h3></h3><p></p></figcaption></figure>
    <button class="lightbox-next" type="button" aria-label="${labels.next}" title="${labels.next}">→</button>
  `;
  document.body.append(lightbox);

  const lightboxImage = lightbox.querySelector("img");
  const lightboxMeta = lightbox.querySelector("figcaption span");
  const lightboxTitle = lightbox.querySelector("figcaption h3");
  const lightboxDescription = lightbox.querySelector("figcaption p");
  let activeIndex = 0;
  let lastTrigger;

  const visibleCases = () => caseItems.filter((item) => !item.hidden);
  const renderCase = (index) => {
    const items = visibleCases();
    if (!items.length) return;
    activeIndex = (index + items.length) % items.length;
    const item = items[activeIndex];
    const image = item.querySelector("img");
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt;
    lightboxMeta.textContent = item.querySelector("span")?.textContent || "";
    lightboxTitle.textContent = item.querySelector("h3")?.textContent || "";
    lightboxDescription.textContent = item.querySelector("p")?.textContent || "";
  };
  const openCase = (item, trigger) => {
    const items = visibleCases();
    lastTrigger = trigger;
    renderCase(Math.max(0, items.indexOf(item)));
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
    lightbox.querySelector(".lightbox-close").focus();
  };
  const closeCase = () => {
    lightbox.hidden = true;
    document.body.classList.remove("lightbox-open");
    lastTrigger?.focus();
  };

  caseItems.forEach((item) => {
    const figure = item.querySelector("figure");
    const title = item.querySelector("h3")?.textContent || "";
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-label", `${labels.open}: ${title}`);
    figure.addEventListener("click", () => openCase(item, figure));
    figure.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCase(item, figure);
      }
    });
  });

  lightbox.querySelector(".lightbox-close").addEventListener("click", closeCase);
  lightbox.querySelector(".lightbox-previous").addEventListener("click", () => renderCase(activeIndex - 1));
  lightbox.querySelector(".lightbox-next").addEventListener("click", () => renderCase(activeIndex + 1));
  lightbox.addEventListener("click", (event) => { if (event.target === lightbox) closeCase(); });
  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") closeCase();
    if (event.key === "ArrowLeft") renderCase(activeIndex - 1);
    if (event.key === "ArrowRight") renderCase(activeIndex + 1);
  });
}

function initializeSite() {
  if (siteInitialized) return;
  siteInitialized = true;
  document.body.classList.add("is-ready");
  document.querySelectorAll("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
  initializeConsent();
  initializeCaseLightbox();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeSite, { once: true });
else initializeSite();
