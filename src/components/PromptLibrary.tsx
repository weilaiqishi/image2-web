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
import { useI18n, type TranslationKey } from "../i18n";
import { bridge, promptThumbnailSrc } from "../lib/bridge";
import { filterPromptTemplates, localizedCategory, type PromptFilters } from "../lib/promptCatalog";
import type { PromptCatalogPreferences, PromptCatalogSnapshot, PromptLocalState, PromptSyncRun, PromptTemplateView } from "../types";

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
  "awesome-prompts": "#315f8c",
};

const viewOptionKeys: Array<{ id: NonNullable<PromptFilters["view"]>; label: TranslationKey; icon: typeof History }> = [
  { id: "all", label: "library.viewAll", icon: History },
  { id: "favorites", label: "library.viewFavorites", icon: Heart },
  { id: "recent", label: "library.viewRecent", icon: History },
  { id: "modified", label: "library.viewModified", icon: NotebookPen },
  { id: "archived", label: "library.viewArchived", icon: Archive },
];

const syncStatusKeys: Record<PromptSyncRun["status"], TranslationKey> = {
  running: "sync.running", completed: "sync.completed", partial: "sync.partial", failed: "sync.failed", cancelled: "sync.cancelled",
};

export function PromptLibrary({ catalog, syncing, onUse, onLocalChange, onSync, onCancelSync, onPreferencesChange, onExport, onImport }: PromptLibraryProps) {
  const { locale, localeTag, t } = useI18n();
  const viewOptions = viewOptionKeys.map((option) => ({ ...option, label: t(option.label) }));
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
    return [...counts.entries()].sort((left, right) => localizedCategory(left[0]).localeCompare(localizedCategory(right[0]), localeTag));
  }, [catalog.templates, locale, localeTag]);
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
          <span className="eyebrow">{t("library.eyebrow")}</span>
          <h2>{t("library.title")}</h2>
          <p>{t("library.summary", { templates: catalog.templates.length, sources: catalog.sources.length })}</p>
        </div>
        <label className="library-search">
          <Search size={15} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library.searchPlaceholder")} aria-label={t("library.searchLabel")} />
        </label>
        <nav className="library-view-list" aria-label={t("library.viewsLabel")}>
          {viewOptions.map((option) => <button className={view === option.id ? "active" : ""} type="button" key={option.id} onClick={() => setView(option.id)}><option.icon size={14} /><span>{option.label}</span></button>)}
        </nav>
        <section className="library-filter-section">
          <header><span>{t("library.sources")}</span><button type="button" onClick={() => setUpdateOpen(true)} aria-label={t("library.updateSettings")}><Settings2 size={14} /></button></header>
          <button className={sourceId === "all" ? "active" : ""} type="button" onClick={() => setSourceId("all")}><i className="source-spine all" /><span>{t("library.allSources")}</span><small>{catalog.templates.length}</small></button>
          {catalog.sources.map((source) => {
            const count = catalog.templates.filter((template) => template.sourceReferences.some((reference) => reference.sourceId === source.id)).length;
            return <button className={sourceId === source.id ? "active" : ""} type="button" key={source.id} onClick={() => setSourceId(source.id)}><i className="source-spine" style={{ background: sourceColors[source.id] }} /><span>{source.name}</span><small>{count}</small></button>;
          })}
        </section>
        <section className="library-filter-section categories">
          <header><span>{t("library.categories")}</span></header>
          <button className={category === "all" ? "active" : ""} type="button" onClick={() => setCategory("all")}><span>{t("library.allCategories")}</span></button>
          {categories.map(([value, count]) => <button className={category === value ? "active" : ""} type="button" key={value} onClick={() => setCategory(value)}><span>{localizedCategory(value)}</span><small>{count}</small></button>)}
        </section>
      </aside>

      <main className="library-contact-sheet">
        <div className="contact-sheet-topline">
          <div><span>{viewOptions.find((option) => option.id === view)?.label}</span><small>{sourceId === "all" ? t("library.allSources") : catalog.sources.find((source) => source.id === sourceId)?.name}</small></div>
          <code>{String(filtered.length).padStart(2, "0")} {t("common.items")}</code>
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
                  aria-label={t("library.viewTemplate", { title: template.displayTitle })}
                >
                  <span className="prompt-card-image">
                    <CatalogImage path={template.cachedThumbnailPath} alt="" />
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    {template.archivedAt && <em>{t("library.archived")}</em>}
                    {template.local.favorite && <Heart size={14} fill="currentColor" />}
                  </span>
                  <span className="prompt-card-copy">
                    <strong>{template.displayTitle}</strong>
                    <span>{localizedCategory(template.category)} · {template.aspectRatio || t("common.adaptive")}</span>
                    <small>{template.sourceReferences.map((source) => catalog.sources.find((item) => item.id === source.sourceId)?.name || source.sourceId).join(" + ")}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="library-empty"><Search size={24} /><strong>{t("library.noMatches")}</strong><span>{t("library.adjustFilters")}</span></div>
        )}
      </main>

      {selected && (
        <aside className={`prompt-detail ${detailOpen ? "open" : ""}`}>
          <div className="prompt-detail-mobile-header"><span>{t("library.templateDetails")}</span><button type="button" onClick={() => setDetailOpen(false)} aria-label={t("library.closeTemplateDetails")}><X size={18} /></button></div>
          <div className="detail-preview"><CatalogImage path={selected.cachedThumbnailPath} alt={selected.displayTitle} eager /></div>
          <div className="detail-title-row">
            <div><span className="eyebrow">{localizedCategory(selected.category)}</span><h2>{selected.displayTitle}</h2></div>
            <span className="detail-ratio">{selected.aspectRatio || "AUTO"}</span>
          </div>
          <div className="detail-local-actions">
            <button className={selected.local.favorite ? "active" : ""} type="button" onClick={() => onLocalChange(selected.id, { favorite: !selected.local.favorite })}><Heart size={15} fill={selected.local.favorite ? "currentColor" : "none"} />{t("library.favorite")}</button>
            <button className={selected.local.pinned ? "active" : ""} type="button" onClick={() => onLocalChange(selected.id, { pinned: !selected.local.pinned })}><Pin size={15} />{t("library.pin")}</button>
            <button type="button" onClick={() => onLocalChange(selected.id, { hidden: true })}><EyeOff size={15} />{t("library.hide")}</button>
          </div>
          <p className="detail-description">{selected.description || t("library.noDescription")}</p>
          <dl className="prompt-config">
            <div><dt>{t("library.model")}</dt><dd>{selected.modelFamilies.join(" / ")}</dd></div>
            <div><dt>{t("library.recommendedResolution")}</dt><dd>{selected.resolution || t("common.auto")}</dd></div>
            <div><dt>{t("library.usageCount")}</dt><dd>{selected.local.useCount}</dd></div>
          </dl>
          <label className="prompt-local-field"><span>{t("library.localTitle")}</span><input defaultValue={selected.local.customTitle || ""} key={`${selected.id}-title`} placeholder={selected.title} onBlur={(event) => onLocalChange(selected.id, { customTitle: event.target.value || undefined })} /></label>
          <label className="prompt-local-field"><span>{t("library.clientNote")}</span><textarea defaultValue={selected.local.note || ""} key={`${selected.id}-note`} placeholder={t("library.localOnly")} onBlur={(event) => onLocalChange(selected.id, { note: event.target.value || undefined })} /></label>
          <div className="prompt-copy-heading"><span>{t("library.localPrompt")}</span><button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t("common.copied") : t("common.copy")}</button></div>
          <textarea className="prompt-full-editor" defaultValue={selected.displayPrompt} key={`${selected.id}-prompt`} onBlur={(event) => onLocalChange(selected.id, { customPrompt: event.target.value === selected.prompt ? undefined : event.target.value })} />
          <section className="detail-provenance">
            <span>{t("library.provenance")}</span>
            {selected.sourceReferences.map((source) => <a href={source.sourceUrl} target="_blank" rel="noreferrer" key={`${source.sourceId}-${source.sourceKey}`}><i style={{ background: sourceColors[source.sourceId] }} /><div><strong>{catalog.sources.find((item) => item.id === source.sourceId)?.name || source.sourceId}</strong><small>{source.license || t("library.licenseUnknown")} · {source.attribution || t("library.attributionUnknown")}</small></div><ExternalLink size={13} /></a>)}
          </section>
          <button className="generate-button remix-button" type="button" onClick={() => onUse(selected)}><Sparkles size={18} />{t("library.remix")}</button>
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
  const { localeTag, t } = useI18n();
  const toggleSource = (sourceId: string) => {
    const enabled = new Set(catalog.preferences.enabledSourceIds);
    if (enabled.has(sourceId)) enabled.delete(sourceId); else enabled.add(sourceId);
    onPreferencesChange({ enabledSourceIds: [...enabled] });
  };
  const latest = catalog.syncRuns[0];
  return (
    <div className="modal-backdrop catalog-update-backdrop">
      <div className="catalog-update-dialog" role="dialog" aria-modal="true" aria-label={t("library.updateDialog")}>
        <header><div><span>{t("library.updateEyebrow")}</span><h2>{t("library.updateTitle")}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t("library.closeUpdate")}><X size={18} /></button></header>
        <div className="catalog-update-body">
          <section className="catalog-source-settings">
            <div className="catalog-section-heading"><div><strong>{t("library.sources")}</strong><small>{t("library.sourceFailureNote")}</small></div>{syncing ? <button className="button" type="button" onClick={onCancelSync}><X size={15} />{t("common.cancel")}</button> : <button className="button" type="button" disabled={!catalog.preferences.enabledSourceIds.length} onClick={() => onSync()}><RefreshCw size={15} />{t("library.checkUpdates")}</button>}</div>
            {catalog.sources.map((source) => <div className="catalog-source-row" key={source.id}><input aria-label={t("library.enableSource", { name: source.name })} type="checkbox" checked={catalog.preferences.enabledSourceIds.includes(source.id)} onChange={() => toggleSource(source.id)} /><i style={{ background: sourceColors[source.id] }} /><div><strong>{source.name}</strong><small>{source.license || t("library.licenseUnknown")} · {t("library.itemCount", { count: source.itemCount })}{source.error ? ` · ${source.error}` : ""}</small></div><span className={source.status}>{source.status === "success" ? t("common.normal") : source.status === "stale" ? t("common.stale") : t("common.error")}</span><button type="button" disabled={syncing || !catalog.preferences.enabledSourceIds.includes(source.id)} onClick={() => onSync(source.id)} aria-label={t("library.updateSource", { name: source.name })}><RefreshCw size={13} /></button></div>)}
          </section>
          <section className="catalog-policy-grid">
            <label><span>{t("library.autoUpdate")}</span><select value={catalog.preferences.autoUpdate} onChange={(event) => onPreferencesChange({ autoUpdate: event.target.value as PromptCatalogPreferences["autoUpdate"] })}><option value="off">{t("library.autoUpdateOff")}</option><option value="startup">{t("library.autoUpdateStartup")}</option><option value="daily">{t("library.autoUpdateDaily")}</option><option value="weekly">{t("library.autoUpdateWeekly")}</option></select></label>
            <label><span>{t("library.updateStrategy")}</span><select value={catalog.preferences.updateStrategy} onChange={(event) => onPreferencesChange({ updateStrategy: event.target.value as PromptCatalogPreferences["updateStrategy"] })}><option value="add-only">{t("library.addOnly")}</option><option value="add-and-update">{t("library.addAndUpdate")}</option></select></label>
            <label><span>{t("library.thumbnails")}</span><select value={catalog.preferences.thumbnailStrategy} onChange={(event) => onPreferencesChange({ thumbnailStrategy: event.target.value as PromptCatalogPreferences["thumbnailStrategy"] })}><option value="lazy">{t("library.thumbnailLazy")}</option><option value="eager">{t("library.thumbnailEager")}</option></select></label>
          </section>
          <section className="catalog-last-run">
            <div className="catalog-section-heading"><div><strong>{t("library.lastCheck")}</strong><small>{latest?.completedAt ? new Date(latest.completedAt).toLocaleString(localeTag) : t("library.neverChecked")}</small></div>{latest && <span className={latest.status}>{t(syncStatusKeys[latest.status])}</span>}</div>
            {latest ? <div className="sync-metrics"><span><strong>{latest.added}</strong>{t("library.metricAdded")}</span><span><strong>{latest.updated}</strong>{t("library.metricUpdated")}</span><span><strong>{latest.archived}</strong>{t("library.metricArchived")}</span><span><strong>{latest.unchanged}</strong>{t("library.metricUnchanged")}</span></div> : <p>{t("library.bundledVersion", { version: catalog.catalogVersion })}</p>}
          </section>
          <section className="catalog-transfer">
            <div><strong>{t("library.localData")}</strong><small>{t("library.localDataNote")}</small></div>
            <span><button type="button" onClick={() => onExport("json")}><FileDown size={14} />JSON</button><button type="button" onClick={() => onExport("zip")}><FileDown size={14} />ZIP</button><button type="button" onClick={() => importInput.current?.click()}><FileUp size={14} />{t("library.import")}</button></span>
            <input ref={importInput} hidden type="file" accept="application/json,.json,.zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} />
          </section>
        </div>
      </div>
    </div>
  );
}
