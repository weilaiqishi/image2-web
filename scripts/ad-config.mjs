const ADSENSE_SCRIPT_URL = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
const ADSTERRA_SCRIPT_ORIGIN = "https://www.highperformanceformat.com";

export const APPROVED_ADSTERRA_BANNER = Object.freeze({
  siteHostname: "image2-studio.pages.dev",
  placementId: "091e951f349e105d9dd17535d7b97262",
  format: "iframe",
  width: 300,
  height: 250,
  params: Object.freeze({}),
  optionsSource: `
  atOptions = {
    'key' : '091e951f349e105d9dd17535d7b97262',
    'format' : 'iframe',
    'height' : 250,
    'width' : 300,
    'params' : {}
  };
`,
  scriptUrl: "https://www.highperformanceformat.com/091e951f349e105d9dd17535d7b97262/invoke.js",
  tag: `<script>
  atOptions = {
    'key' : '091e951f349e105d9dd17535d7b97262',
    'format' : 'iframe',
    'height' : 250,
    'width' : 300,
    'params' : {}
  };
</script>
<script src="https://www.highperformanceformat.com/091e951f349e105d9dd17535d7b97262/invoke.js"></script>`,
});

function isValidAdsTxtRecord(value) {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?,\s*[^,\s]+,\s*(?:DIRECT|RESELLER)(?:,\s*[a-z0-9]+)?$/i.test(value)
    && !/[\r\n]/.test(value);
}

export function resolveAdConfig(env, warn = console.warn) {
  const rawProvider = (env.AD_PROVIDER || "none").trim().toLowerCase();
  const requestedProvider = ["none", "adsense", "adsterra"].includes(rawProvider) ? rawProvider : "none";
  if (rawProvider !== requestedProvider) warn("Advertising disabled: AD_PROVIDER must be none, adsense, or adsterra");

  const requestedAdsenseClient = (env.ADSENSE_CLIENT || "").trim();
  const requestedAdsenseSlot = (env.ADSENSE_SLOT || "").trim();
  const validAdsenseClient = /^ca-pub-\d{16}$/.test(requestedAdsenseClient);
  const validAdsenseSlot = /^\d{10}$/.test(requestedAdsenseSlot);
  const certifiedCmpConfirmed = env.ADSENSE_CMP_CERTIFIED === "true";
  const adsenseEnabled = requestedProvider === "adsense"
    && validAdsenseClient
    && validAdsenseSlot
    && certifiedCmpConfirmed;

  if (requestedAdsenseClient && !validAdsenseClient) {
    warn("AdSense publisher verification disabled: ADSENSE_CLIENT must match ca-pub- plus 16 digits");
  }
  if (requestedProvider === "adsense" && !validAdsenseSlot) {
    warn("AdSense disabled: ADSENSE_SLOT must contain 10 digits");
  } else if (requestedProvider === "adsense" && !certifiedCmpConfirmed) {
    warn("AdSense disabled: set ADSENSE_CMP_CERTIFIED=true only after a Google-certified CMP is configured for production traffic");
  } else if (requestedProvider === "adsense" && !validAdsenseClient) {
    warn("AdSense disabled: a validated ADSENSE_CLIENT is required");
  }

  const requestedPlacementId = (env.ADSTERRA_PLACEMENT_ID || "").trim().toLowerCase();
  const requestedAdsTxtRecord = (env.ADSTERRA_ADS_TXT_RECORD || "").trim();
  const validAdsTxtRecord = isValidAdsTxtRecord(requestedAdsTxtRecord);
  const policyReviewed = env.ADSTERRA_POLICY_REVIEWED === "true";
  const approvedPlacementSelected = requestedPlacementId === APPROVED_ADSTERRA_BANNER.placementId;
  const adsterraEnabled = requestedProvider === "adsterra"
    && approvedPlacementSelected
    && policyReviewed;

  if (requestedProvider === "adsterra" && !approvedPlacementSelected) {
    warn("Adsterra disabled: ADSTERRA_PLACEMENT_ID must match the approved image2-studio.pages.dev 300x250 Display Banner");
  } else if (requestedProvider === "adsterra" && !policyReviewed) {
    warn("Adsterra disabled: set ADSTERRA_POLICY_REVIEWED=true only after the approved tag, privacy disclosure, and ad quality controls are reviewed");
  }
  if (requestedProvider === "adsterra" && requestedAdsTxtRecord && !validAdsTxtRecord) {
    warn("ADSTERRA_ADS_TXT_RECORD ignored: publish only an exact valid record supplied by Adsterra");
  }

  const activeProvider = adsenseEnabled ? "adsense" : adsterraEnabled ? "adsterra" : "none";
  const adsensePublisherClient = validAdsenseClient ? requestedAdsenseClient : "";
  const adsTxtRecords = [];
  if (adsensePublisherClient) {
    adsTxtRecords.push(`google.com, ${adsensePublisherClient.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0`);
  }
  if (adsterraEnabled && validAdsTxtRecord) adsTxtRecords.push(requestedAdsTxtRecord);

  return {
    requestedProvider,
    activeProvider,
    adsEnabled: activeProvider !== "none",
    adsTxtRecords,
    adsense: {
      publisherClient: adsensePublisherClient,
      client: adsenseEnabled ? requestedAdsenseClient : "",
      slot: adsenseEnabled ? requestedAdsenseSlot : "",
      scriptUrl: adsenseEnabled ? ADSENSE_SCRIPT_URL : "",
    },
    adsterra: {
      tag: adsterraEnabled ? APPROVED_ADSTERRA_BANNER.tag : "",
      optionsSource: adsterraEnabled ? APPROVED_ADSTERRA_BANNER.optionsSource : "",
      placementId: adsterraEnabled ? APPROVED_ADSTERRA_BANNER.placementId : "",
      scriptOrigin: adsterraEnabled ? ADSTERRA_SCRIPT_ORIGIN : "",
      scriptUrl: adsterraEnabled ? APPROVED_ADSTERRA_BANNER.scriptUrl : "",
      format: adsterraEnabled ? "display-banner-300x250" : "",
      width: adsterraEnabled ? APPROVED_ADSTERRA_BANNER.width : 0,
      height: adsterraEnabled ? APPROVED_ADSTERRA_BANNER.height : 0,
      adsTxtRecord: adsterraEnabled && validAdsTxtRecord ? requestedAdsTxtRecord : "",
    },
  };
}
