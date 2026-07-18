import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SaveSettingsInput, Settings } from "../types";
import { useI18n } from "../i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface SettingsDialogProps {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (input: SaveSettingsInput) => Promise<void>;
}

export function SettingsDialog({ open, settings, onClose, onSave }: SettingsDialogProps) {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [agentProtocol, setAgentProtocol] = useState(settings.agentProtocol);
  const [agentModel, setAgentModel] = useState(settings.agentModel);
  const [imageModel, setImageModel] = useState(settings.imageModel);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setAgentProtocol(settings.agentProtocol);
    setAgentModel(settings.agentModel);
    setImageModel(settings.imageModel);
  }, [settings]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ baseUrl, agentProtocol, agentModel, imageModel, apiKey: apiKey || undefined });
      setApiKey("");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="settings-dialog" onSubmit={submit} aria-label={t("settings.open")}>
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">{t("settings.eyebrow")}</span>
            <h2>{t("settings.title")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("settings.close")} title={t("common.close")}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-language-row">
          <span className="field-label">{t("language.label")}</span>
          <LanguageSwitcher />
        </div>

        <label className="field-label" htmlFor="base-url">{t("settings.baseUrl")}</label>
        <input
          id="base-url"
          className="text-input mono"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.openai.com/v1"
          required
        />

        <label className="field-label" htmlFor="agent-protocol">{t("settings.agentProtocol")}</label>
        <select id="agent-protocol" className="text-input mono" value={agentProtocol} onChange={(event) => setAgentProtocol(event.target.value as typeof agentProtocol)}>
          <option value="responses">{t("settings.responsesApi")}</option>
          <option value="chat_completions">{t("settings.chatCompletions")}</option>
        </select>

        <label className="field-label" htmlFor="agent-model">{t("settings.agentModel")}</label>
        <input
          id="agent-model"
          className="text-input mono"
          value={agentModel}
          onChange={(event) => setAgentModel(event.target.value)}
          placeholder="gpt-5.6"
          required
        />

        <label className="field-label" htmlFor="image-model">{t("settings.imageModel")}</label>
        <input
          id="image-model"
          className="text-input mono"
          value={imageModel}
          onChange={(event) => setImageModel(event.target.value)}
          placeholder="gpt-image-2"
          required
        />

        <label className="field-label" htmlFor="api-key">
          {t("settings.apiKey")} {settings.hasApiKey && <span className="saved-badge">{t("settings.apiKeySaved")}</span>}
        </label>
        <div className="key-input-wrap">
          <KeyRound size={17} aria-hidden="true" />
          <input
            id="api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type={showKey ? "text" : "password"}
            placeholder={settings.hasApiKey ? t("settings.keepSavedKey") : "sk-..."}
          />
          <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? t("settings.hideKey") : t("settings.showKey")} title={showKey ? t("settings.hideKey") : t("settings.showKey")}>
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <p className="field-note">{t("settings.keyNote")}</p>

        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button className="button primary" disabled={saving}>{saving ? t("common.saving") : t("settings.save")}</button>
        </div>
      </form>
    </div>
  );
}
