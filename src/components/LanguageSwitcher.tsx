import { Languages } from "lucide-react";
import { useI18n } from "../i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="language-switcher" role="group" aria-label={t("language.label")}>
      <Languages size={15} aria-hidden="true" />
      <button className={locale === "zh-CN" ? "active" : ""} type="button" onClick={() => setLocale("zh-CN")} aria-label={t("language.switchToChinese")} title={t("language.chinese")}>中</button>
      <button className={locale === "en" ? "active" : ""} type="button" onClick={() => setLocale("en")} aria-label={t("language.switchToEnglish")} title={t("language.english")}>EN</button>
    </div>
  );
}
