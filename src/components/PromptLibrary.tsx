import { Check, Copy, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { filterPromptTemplates, localizedCategory } from "../lib/promptCatalog";
import type { PromptCatalogSource, PromptTemplate } from "../types";

interface PromptLibraryProps {
  templates: PromptTemplate[];
  source: PromptCatalogSource;
  onUse: (template: PromptTemplate) => void;
}

export function PromptLibrary({ templates, source, onUse }: PromptLibraryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedSlug, setSelectedSlug] = useState(templates[0]?.slug);
  const [copied, setCopied] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    templates.forEach((template) => counts.set(template.category, (counts.get(template.category) ?? 0) + 1));
    return [...counts.entries()].sort((left, right) => localizedCategory(left[0]).localeCompare(localizedCategory(right[0]), "zh-CN"));
  }, [templates]);
  const filtered = useMemo(() => filterPromptTemplates(templates, query, category), [templates, query, category]);
  const selected = templates.find((template) => template.slug === selectedSlug) ?? filtered[0] ?? templates[0];

  useEffect(() => {
    if (!detailOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailOpen]);

  const copyPrompt = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="prompt-library">
      <aside className="library-sidebar">
        <div className="library-heading">
          <span className="eyebrow">灵感目录</span>
          <h2>提示词样片</h2>
          <p>从公开精选库保存到本机，可搜索并直接套用生成配置。</p>
        </div>
        <label className="library-search">
          <Search size={15} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题材、风格或标签" aria-label="搜索提示词" />
        </label>
        <div className="category-list" aria-label="提示词分类">
          <button className={category === "all" ? "active" : ""} type="button" onClick={() => setCategory("all")}>
            <span>全部</span><small>{templates.length}</small>
          </button>
          {categories.map(([value, count]) => (
            <button className={category === value ? "active" : ""} type="button" key={value} onClick={() => setCategory(value)}>
              <span>{localizedCategory(value)}</span><small>{count}</small>
            </button>
          ))}
        </div>
        <div className="library-source">
          <span>来源</span>
          <a href={source.url} target="_blank" rel="noreferrer">image-2.net</a>
          <small>公开目录 {source.discovered} 项 · 本地精选 {source.imported} 项</small>
        </div>
      </aside>

      <main className="library-contact-sheet">
        <div className="contact-sheet-topline">
          <span>{category === "all" ? "全部分类" : localizedCategory(category)}</span>
          <code>{String(filtered.length).padStart(2, "0")} FRAMES</code>
        </div>
        {filtered.length ? (
          <div className="prompt-grid">
            {filtered.map((template, index) => (
              <button
                className={`prompt-card ${selected?.slug === template.slug ? "selected" : ""}`}
                type="button"
                key={template.slug}
                onClick={() => { setSelectedSlug(template.slug); setDetailOpen(true); }}
                aria-label={`查看 ${template.title}`}
              >
                <span className="prompt-card-image">
                  <img src={template.thumbnail} alt="" loading="lazy" />
                  <i>{String(index + 1).padStart(2, "0")}</i>
                </span>
                <span className="prompt-card-copy">
                  <strong>{template.title}</strong>
                  <span>{localizedCategory(template.category)} · {template.aspectRatio}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="library-empty"><Search size={24} /><strong>没有匹配的样片</strong><span>换一个关键词或分类。</span></div>
        )}
      </main>

      {selected && (
        <aside className={`prompt-detail ${detailOpen ? "open" : ""}`}>
          <div className="prompt-detail-mobile-header"><span>模板详情</span><button type="button" onClick={() => setDetailOpen(false)} aria-label="关闭模板详情"><X size={18} /></button></div>
          <div className="detail-preview"><img src={selected.thumbnail} alt={selected.title} /></div>
          <div className="detail-title-row">
            <div><span className="eyebrow">{localizedCategory(selected.category)}</span><h2>{selected.title}</h2></div>
            <span className="detail-ratio">{selected.aspectRatio}</span>
          </div>
          <p className="detail-description">{selected.description}</p>
          <dl className="prompt-config">
            <div><dt>模型</dt><dd>{selected.model}</dd></div>
            <div><dt>建议分辨率</dt><dd>{selected.resolution}</dd></div>
            <div><dt>适合</dt><dd>{selected.bestFor || "通用图片生成"}</dd></div>
          </dl>
          <div className="prompt-copy-heading"><span>完整提示词</span><button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制"}</button></div>
          <p className="prompt-full-text">{selected.prompt}</p>
          <div className="phrase-list" aria-label="提示词结构">
            {selected.phrases.slice(0, 8).map((phrase, index) => <span key={`${phrase}-${index}`}><i>{index + 1}</i>{phrase}</span>)}
          </div>
          <button className="generate-button remix-button" type="button" onClick={() => onUse(selected)}><Sparkles size={18} />生成同款</button>
          <a className="detail-source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">查看原始模板与出处</a>
        </aside>
      )}
    </div>
  );
}
