import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SaveSettingsInput, Settings } from "../types";

interface SettingsDialogProps {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (input: SaveSettingsInput) => Promise<void>;
}

export function SettingsDialog({ open, settings, onClose, onSave }: SettingsDialogProps) {
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
      <form className="settings-dialog" onSubmit={submit} aria-label="连接设置">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">本地连接</span>
            <h2>图片服务设置</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭设置" title="关闭">
            <X size={18} />
          </button>
        </div>

        <label className="field-label" htmlFor="base-url">OpenAI Base URL</label>
        <input
          id="base-url"
          className="text-input mono"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.openai.com/v1"
          required
        />

        <label className="field-label" htmlFor="agent-protocol">Agent 协议</label>
        <select id="agent-protocol" className="text-input mono" value={agentProtocol} onChange={(event) => setAgentProtocol(event.target.value as typeof agentProtocol)}>
          <option value="responses">Responses API</option>
          <option value="chat_completions">Chat Completions</option>
        </select>

        <label className="field-label" htmlFor="agent-model">Agent 模型</label>
        <input
          id="agent-model"
          className="text-input mono"
          value={agentModel}
          onChange={(event) => setAgentModel(event.target.value)}
          placeholder="gpt-5.6"
          required
        />

        <label className="field-label" htmlFor="image-model">图片模型</label>
        <input
          id="image-model"
          className="text-input mono"
          value={imageModel}
          onChange={(event) => setImageModel(event.target.value)}
          placeholder="gpt-image-2"
          required
        />

        <label className="field-label" htmlFor="api-key">
          API Key {settings.hasApiKey && <span className="saved-badge">已保存在系统凭证库</span>}
        </label>
        <div className="key-input-wrap">
          <KeyRound size={17} aria-hidden="true" />
          <input
            id="api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type={showKey ? "text" : "password"}
            placeholder={settings.hasApiKey ? "留空以继续使用已保存密钥" : "sk-..."}
          />
          <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "隐藏密钥" : "显示密钥"} title={showKey ? "隐藏密钥" : "显示密钥"}>
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <p className="field-note">密钥仅由 Rust 后端读取，并保存在 macOS Keychain 或 Windows Credential Manager。</p>

        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>取消</button>
          <button className="button primary" disabled={saving}>{saving ? "保存中" : "保存设置"}</button>
        </div>
      </form>
    </div>
  );
}
