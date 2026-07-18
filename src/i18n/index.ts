import { useSyncExternalStore } from "react";
import { en } from "./en";
import { zhCN, type TranslationKey } from "./zh-CN";

export type Locale = "zh-CN" | "en";
export type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "image2.locale";
const resources: Record<Locale, Record<TranslationKey, string>> = { "zh-CN": zhCN, en };
const listeners = new Set<() => void>();

function detectedLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en") return stored;
  } catch {
    // Storage can be unavailable in privacy-restricted WebViews.
  }
  return globalThis.navigator?.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

let currentLocale: Locale = detectedLocale();

function syncDocumentLanguage() {
  if (globalThis.document?.documentElement) globalThis.document.documentElement.lang = currentLocale;
}

syncDocumentLanguage();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale, options: { persist?: boolean } = {}) {
  if (locale === currentLocale) {
    syncDocumentLanguage();
    return;
  }
  currentLocale = locale;
  syncDocumentLanguage();
  if (options.persist !== false) {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, locale); } catch { /* noop */ }
  }
  listeners.forEach((listener) => listener());
}

export function translate(key: TranslationKey, params: TranslationParams = {}, locale = currentLocale): string {
  return resources[locale][key].replace(/\{([a-zA-Z0-9]+)\}/g, (match, name: string) => name in params ? String(params[name]) : match);
}

export function useI18n() {
  const locale = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getLocale,
    getLocale,
  );
  return {
    locale,
    localeTag: locale === "zh-CN" ? "zh-CN" : "en-US",
    setLocale,
    t: (key: TranslationKey, params?: TranslationParams) => translate(key, params, locale),
  };
}

export function localizedErrorMessage(message: string): string {
  if (currentLocale === "zh-CN") return message;
  const exact: Record<string, TranslationKey> = {
    "图片请求需要在 Image2 Studio 桌面客户端中运行": "errors.desktopRequired",
    "找不到图片": "errors.imageNotFound",
    "找不到标注合成图": "errors.overlayNotFound",
    "灵感库文件格式不受支持": "errors.catalogUnsupported",
    "灵感库导入已回滚": "errors.catalogRollback",
    "尚未配置 OpenAI API Key": "errors.apiKeyMissing",
    "Agent 协议不受支持": "errors.unsupportedProtocol",
    "灵感目录地址格式不正确": "errors.catalogUrlInvalid",
    "灵感目录地址不在白名单中": "errors.catalogUrlDenied",
    "标注合成图文件过大": "errors.overlayTooLarge",
    "标注合成图格式不受支持": "errors.overlayFormatUnsupported",
    "Base URL 格式不正确": "errors.baseUrlInvalid",
    "Base URL 必须使用 HTTPS；只有本机服务可使用 HTTP": "errors.httpsRequired",
    "Agent 与图片模型名称不能为空": "errors.modelNamesRequired",
    "Agent 服务返回错误": "errors.agentServiceError",
    "API Key 无效": "errors.invalidApiKey",
    "请求过于频繁或额度不足": "errors.rateLimited",
    "Agent 服务暂时不可用": "errors.agentUnavailable",
    "图片数据格式不正确": "errors.imageDataInvalid",
    "无法解析图片数据": "errors.imageDecodeFailed",
    "图片服务返回错误": "errors.imageServiceError",
    "图片服务暂时不可用": "errors.imageUnavailable",
    "图片服务没有返回结果": "errors.imageResultMissing",
    "无法解析生成图片": "errors.generatedImageDecodeFailed",
    "图片响应缺少图像数据": "errors.imagePayloadMissing",
    "找不到参考图片": "errors.referenceNotFound",
    "请输入图片描述": "errors.promptRequired",
    "导入图片文件过大": "errors.importTooLarge",
    "导入图片格式不受支持": "errors.importFormatUnsupported",
    "找不到原始图片": "errors.originalNotFound",
    "编辑任务缺少标注合成图": "errors.editOverlayMissing",
    "编辑任务最多支持 6 张参考图": "errors.tooManyEditReferences",
    "版本名称格式不正确": "errors.versionNameInvalid",
    "缩略图路径不在目录白名单中": "errors.thumbnailPathDenied",
    "缩略图文件名不正确": "errors.thumbnailNameInvalid",
    "缩略图文件过大": "errors.thumbnailTooLarge",
    "灵感目录版本不受支持": "errors.catalogVersionUnsupported",
    "灵感目录校验值缺失": "errors.catalogChecksumMissing",
    "灵感目录校验失败，已保留旧版本": "errors.catalogChecksumFailed",
    "灵感目录缺少数据分片": "errors.catalogChunksMissing",
    "灵感目录分片数量不正确": "errors.catalogChunkCountInvalid",
    "灵感目录分片地址缺失": "errors.catalogChunkUrlMissing",
    "灵感目录分片校验值缺失": "errors.catalogChunkChecksumMissing",
    "灵感目录分片校验失败，已保留旧版本": "errors.catalogChunkChecksumFailed",
    "灵感目录分片内容不正确": "errors.catalogChunkInvalid",
  };
  if (exact[message]) return translate(exact[message]);
  const requestMatch = message.match(/^(API Key 无效|请求过于频繁或额度不足|Agent 服务暂时不可用|图片服务暂时不可用)（请求 (.+)）$/);
  if (requestMatch) return `${localizedErrorMessage(requestMatch[1])} (request ${requestMatch[2]})`;
  const credentialMatch = message.match(/^无法访问系统凭证库: (.+)$/);
  if (credentialMatch) return translate("errors.credentialStore", { message: credentialMatch[1] });
  const saveKeyMatch = message.match(/^保存密钥失败: (.+)$/);
  if (saveKeyMatch) return translate("errors.saveKeyFailed", { message: saveKeyMatch[1] });
  const fieldMatch = message.match(/^(.+) 格式不正确$/);
  if (fieldMatch) return translate("errors.invalidField", { label: fieldMatch[1] });
  return message;
}

export type { TranslationKey } from "./zh-CN";
