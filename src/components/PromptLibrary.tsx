import {
  Archive,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  FileDown,
  FileUp,
  Heart,
  History,
  NotebookPen,
  Pin,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { bridge, promptThumbnailSrc } from "../lib/bridge";
import { filterPromptTemplates, localizedCategory, type PromptFilters } from "../lib/promptCatalog";
import type { PromptCatalogPreferences, PromptCatalogSnapshot, PromptLocalState, PromptTemplateView } from "../types";

interface PromptLibraryProps {
  catalog: PromptCatalogSnapshot;
  syncing: boolean;
  onUse: (template: PromptTemplateView) => void;
  onLocalChange: (templateId: string, patch: Partial<PromptLocalState>) => void;
  onSync: (sourceId?: string) => void;
  onCancelSync: () => void;
  onPreferencesChange: (patch: Partial<PromptCatalogPreferences>) => void;
  onExport: (format: "json" | "zip") => void;
  onImport: (file: File) => void;
}

const sourceColors: Record<string, string> = {
  "image2-net": "#236a52",
  "awesome-gpt4o-images": "#b64535",
  "awesome-prompts": "#315f8c",
  "openai-cookbook": "#6d5f9a",
};

const viewOptions: Array<{ id: NonNullable<PromptFilters["view"]>; label: string; icon: typeof History }> = [
  { id: "all", label: "全部灵感", icon: History },
  { id: "favorites", label: "收藏", icon: Heart },
  { id: "recent", label: "最近使用", icon: History },
  { id: "modified", label: "本地改写", icon: NotebookPen },
  { id: "archived", label: "已归档", icon: Archive },
];

export function PromptLibrary({ catalog, syncing, onUse, onLocalChange, onSync, onCancelSync, onPreferencesChange, onExport, onImport }: PromptLibraryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [view, setView] = useState<NonNullable<PromptFilters["view"]>>("all");
  const [selectedId, setSelectedId] = useState(catalog.templates[0]?.id);
  const [copied, setCopied] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    catalog.templates.forEach((template) => counts.set(template.category, (counts.get(template.category) ?? 0) + 1));
    return [...counts.entries()].sort((left, right) => localizedCategory(left[0]).localeCompare(localizedCategory(right[0]), "zh-CN"));
  }, [catalog.templates]);
  const filtered = useMemo(() => filterPromptTemplates(catalog.templates, { query, category, sourceId, view }), [catalog.templates, query, category, sourceId, view]);
  const selected = catalog.templates.find((template) => template.id === selectedId) ?? filtered[0] ?? catalog.templates[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (!detailOpen && !updateOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (updateOpen) setUpdateOpen(false);
      else setDetailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailOpen, updateOpen]);

  const copyPrompt = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.displayPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="prompt-library">
      <aside className="library-sidebar">
        <div className="library-heading">
          <span className="eyebrow">本地灵感库</span>
          <h2>创作索引</h2>
          <p>{catalog.templates.length} 条模板 · {catalog.sources.length} 个来源</p>
        </div>
        <label className="library-search">
          <Search size={15} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、标签或署名" aria-label="搜索提示词" />
        </label>
        <nav className="library-view-list" aria-label="本地灵感视图">
          {viewOptions.map((option) => <button className={view === option.id ? "active" : ""} type="button" key={option.id} onClick={() => setView(option.id)}><option.icon size={14} /><span>{option.label}</span></button>)}
        </nav>
        <section className="library-filter-section">
          <header><span>来源</span><button type="button" onClick={() => setUpdateOpen(true)} aria-label="灵感库更新设置"><Settings2 size={14} /></button></header>
          <button className={sourceId === "all" ? "active" : ""} type="button" onClick={() => setSourceId("all")}><i className="source-spine all" /><span>全部来源</span><small>{catalog.templates.length}</small></button>
          {catalog.sources.map((source) => {
            const count = catalog.templates.filter((template) => template.sourceReferences.some((reference) => reference.sourceId === source.id)).length;
            return <button className={sourceId === source.id ? "active" : ""} type="button" key={source.id} onClick={() => setSourceId(source.id)}><i className="source-spine" style={{ background: sourceColors[source.id] }} /><span>{source.name}</span><small>{count}</small></button>;
          })}
        </section>
        <section className="library-filter-section categories">
          <header><span>分类</span></header>
          <button className={category === "all" ? "active" : ""} type="button" onClick={() => setCategory("all")}><span>全部分类</span></button>
          {categories.map(([value, count]) => <button className={category === value ? "active" : ""} type="button" key={value} onClick={() => setCategory(value)}><span>{localizedCategory(value)}</span><small>{count}</small></button>)}
        </section>
      </aside>

      <main className="library-contact-sheet">
        <div className="contact-sheet-topline">
          <div><span>{viewOptions.find((option) => option.id === view)?.label}</span><small>{sourceId === "all" ? "全部来源" : catalog.sources.find((source) => source.id === sourceId)?.name}</small></div>
          <code>{String(filtered.length).padStart(2, "0")} ITEMS</code>
        </div>
        {filtered.length ? (
          <div className="prompt-grid">
            {filtered.map((template, index) => {
              const color = sourceColors[template.sourceId] ?? "#4f5d57";
              return (
                <button
                  className={`prompt-card ${selected?.id === template.id ? "selected" : ""}`}
                  style={{ "--source-color": color } as CSSProperties}
                  type="button"
                  key={template.id}
                  onClick={() => { setSelectedId(template.id); setDetailOpen(true); }}
                  aria-label={`查看 ${template.displayTitle}`}
                >
                  <span className="prompt-card-image">
                    <CatalogImage path={template.cachedThumbnailPath} alt="" />
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    {template.archivedAt && <em>归档</em>}
                    {template.local.favorite && <Heart size={14} fill="currentColor" />}
                  </span>
                  <span className="prompt-card-copy">
                    <strong>{template.displayTitle}</strong>
                    <span>{localizedCategory(template.category)} · {template.aspectRatio || "自适应"}</span>
                    <small>{template.sourceReferences.map((source) => catalog.sources.find((item) => item.id === source.sourceId)?.name || source.sourceId).join(" + ")}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="library-empty"><Search size={24} /><strong>没有匹配的灵感</strong><span>调整来源、分类或关键词。</span></div>
        )}
      </main>

      {selected && (
        <aside className={`prompt-detail ${detailOpen ? "open" : ""}`}>
          <div className="prompt-detail-mobile-header"><span>模板详情</span><button type="button" onClick={() => setDetailOpen(false)} aria-label="关闭模板详情"><X size={18} /></button></div>
          <div className="detail-preview"><CatalogImage path={selected.cachedThumbnailPath} alt={selected.displayTitle} eager /></div>
          <div className="detail-title-row">
            <div><span className="eyebrow">{localizedCategory(selected.category)}</span><h2>{selected.displayTitle}</h2></div>
            <span className="detail-ratio">{selected.aspectRatio || "AUTO"}</span>
          </div>
          <div className="detail-local-actions">
            <button className={selected.local.favorite ? "active" : ""} type="button" onClick={() => onLocalChange(selected.id, { favorite: !selected.local.favorite })}><Heart size={15} fill={selected.local.favorite ? "currentColor" : "none"} />收藏</button>
            <button className={selected.local.pinned ? "active" : ""} type="button" onClick={() => onLocalChange(selected.id, { pinned: !selected.local.pinned })}><Pin size={15} />置顶</button>
            <button type="button" onClick={() => onLocalChange(selected.id, { hidden: true })}><EyeOff size={15} />隐藏</button>
          </div>
          <p className="detail-description">{selected.description || "该模板未提供额外说明。"}</p>
          <dl className="prompt-config">
            <div><dt>模型</dt><dd>{selected.modelFamilies.join(" / ")}</dd></div>
            <div><dt>建议分辨率</dt><dd>{selected.resolution || "自动"}</dd></div>
            <div><dt>使用次数</dt><dd>{selected.local.useCount}</dd></div>
          </dl>
          <label className="prompt-local-field"><span>本地标题</span><input defaultValue={selected.local.customTitle || ""} key={`${selected.id}-title`} placeholder={selected.title} onBlur={(event) => onLocalChange(selected.id, { customTitle: event.target.value || undefined })} /></label>
          <label className="prompt-local-field"><span>客户备注</span><textarea defaultValue={selected.local.note || ""} key={`${selected.id}-note`} placeholder="只保存在本机" onBlur={(event) => onLocalChange(selected.id, { note: event.target.value || undefined })} /></label>
          <div className="prompt-copy-heading"><span>本地提示词</span><button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制"}</button></div>
          <textarea className="prompt-full-editor" defaultValue={selected.displayPrompt} key={`${selected.id}-prompt`} onBlur={(event) => onLocalChange(selected.id, { customPrompt: event.target.value === selected.prompt ? undefined : event.target.value })} />
          <section className="detail-provenance">
            <span>来源与授权</span>
            {selected.sourceReferences.map((source) => <a href={source.sourceUrl} target="_blank" rel="noreferrer" key={`${source.sourceId}-${source.sourceKey}`}><i style={{ background: sourceColors[source.sourceId] }} /><div><strong>{catalog.sources.find((item) => item.id === source.sourceId)?.name || source.sourceId}</strong><small>{source.license || "未标注授权"} · {source.attribution || "未标注署名"}</small></div><ExternalLink size={13} /></a>)}
          </section>
          <button className="generate-button remix-button" type="button" onClick={() => onUse(selected)}><Sparkles size={18} />生成同款</button>
        </aside>
      )}

      {updateOpen && <CatalogUpdateDialog catalog={catalog} syncing={syncing} onClose={() => setUpdateOpen(false)} onSync={onSync} onCancelSync={onCancelSync} onPreferencesChange={onPreferencesChange} onExport={onExport} onImport={(file) => { onImport(file); setUpdateOpen(false); }} importInput={importInput} />}
    </div>
  );
}

function CatalogImage({ path, alt, eager = false }: { path?: string; alt: string; eager?: boolean }) {
  const [src, setSrc] = useState(promptThumbnailSrc(path));
  const attempted = useRef(false);
  useEffect(() => { setSrc(promptThumbnailSrc(path)); attempted.current = false; }, [path]);
  return <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} onError={() => {
    if (!path || attempted.current) return;
    attempted.current = true;
    void bridge.cachePromptThumbnail(path).then((localPath) => setSrc(promptThumbnailSrc(localPath))).catch(() => undefined);
  }} />;
}

function CatalogUpdateDialog({ catalog, syncing, onClose, onSync, onCancelSync, onPreferencesChange, onExport, onImport, importInput }: {
  catalog: PromptCatalogSnapshot;
  syncing: boolean;
  onClose: () => void;
  onSync: (sourceId?: string) => void;
  onCancelSync: () => void;
  onPreferencesChange: (patch: Partial<PromptCatalogPreferences>) => void;
  onExport: (format: "json" | "zip") => void;
  onImport: (file: File) => void;
  importInput: React.RefObject<HTMLInputElement | null>;
}) {
  const toggleSource = (sourceId: string) => {
    const enabled = new Set(catalog.preferences.enabledSourceIds);
    if (enabled.has(sourceId)) enabled.delete(sourceId); else enabled.add(sourceId);
    onPreferencesChange({ enabledSourceIds: [...enabled] });
  };
  const latest = catalog.syncRuns[0];
  return (
    <div className="modal-backdrop catalog-update-backdrop">
      <div className="catalog-update-dialog" role="dialog" aria-modal="true" aria-label="灵感库更新">
        <header><div><span>目录更新</span><h2>来源与本地同步</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭更新设置"><X size={18} /></button></header>
        <div className="catalog-update-body">
          <section className="catalog-source-settings">
            <div className="catalog-section-heading"><div><strong>来源</strong><small>单个来源失败不会删除已有目录</small></div>{syncing ? <button className="button" type="button" onClick={onCancelSync}><X size={15} />取消</button> : <button className="button" type="button" disabled={!catalog.preferences.enabledSourceIds.length} onClick={() => onSync()}><RefreshCw size={15} />检查更新</button>}</div>
            {catalog.sources.map((source) => <div className="catalog-source-row" key={source.id}><input aria-label={`启用 ${source.name}`} type="checkbox" checked={catalog.preferences.enabledSourceIds.includes(source.id)} onChange={() => toggleSource(source.id)} /><i style={{ background: sourceColors[source.id] }} /><div><strong>{source.name}</strong><small>{source.license || "授权未标注"} · {source.itemCount} 条{source.error ? ` · ${source.error}` : ""}</small></div><span className={source.status}>{source.status === "success" ? "正常" : source.status === "stale" ? "旧快照" : "异常"}</span><button type="button" disabled={syncing || !catalog.preferences.enabledSourceIds.includes(source.id)} onClick={() => onSync(source.id)} aria-label={`更新 ${source.name}`}><RefreshCw size={13} /></button></div>)}
          </section>
          <section className="catalog-policy-grid">
            <label><span>自动更新</span><select value={catalog.preferences.autoUpdate} onChange={(event) => onPreferencesChange({ autoUpdate: event.target.value as PromptCatalogPreferences["autoUpdate"] })}><option value="off">关闭</option><option value="startup">每次启动</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>
            <label><span>更新策略</span><select value={catalog.preferences.updateStrategy} onChange={(event) => onPreferencesChange({ updateStrategy: event.target.value as PromptCatalogPreferences["updateStrategy"] })}><option value="add-only">仅新增</option><option value="add-and-update">新增并更新</option></select></label>
            <label><span>缩略图</span><select value={catalog.preferences.thumbnailStrategy} onChange={(event) => onPreferencesChange({ thumbnailStrategy: event.target.value as PromptCatalogPreferences["thumbnailStrategy"] })}><option value="lazy">浏览时加载</option><option value="eager">更新时下载</option></select></label>
          </section>
          <section className="catalog-last-run">
            <div className="catalog-section-heading"><div><strong>最近一次检查</strong><small>{latest?.completedAt ? new Date(latest.completedAt).toLocaleString("zh-CN") : "尚未检查远程目录"}</small></div>{latest && <span className={latest.status}>{latest.status}</span>}</div>
            {latest ? <div className="sync-metrics"><span><strong>{latest.added}</strong>新增</span><span><strong>{latest.updated}</strong>修改</span><span><strong>{latest.archived}</strong>归档</span><span><strong>{latest.unchanged}</strong>未变化</span></div> : <p>当前使用随应用安装的目录版本 {catalog.catalogVersion}。</p>}
          </section>
          <section className="catalog-transfer">
            <div><strong>本地资料</strong><small>收藏、备注、改写和使用记录不会上传</small></div>
            <span><button type="button" onClick={() => onExport("json")}><FileDown size={14} />JSON</button><button type="button" onClick={() => onExport("zip")}><FileDown size={14} />ZIP</button><button type="button" onClick={() => importInput.current?.click()}><FileUp size={14} />导入</button></span>
            <input ref={importInput} hidden type="file" accept="application/json,.json,.zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} />
          </section>
        </div>
      </div>
    </div>
  );
}
