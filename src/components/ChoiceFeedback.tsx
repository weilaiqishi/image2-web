import { Check, LoaderCircle, X } from "lucide-react";

export interface ChoiceFeedbackOption {
  id: string;
  label: string;
  description?: string;
  primary?: boolean;
}

interface ChoiceFeedbackProps {
  title: string;
  description: string;
  loading?: boolean;
  options?: ChoiceFeedbackOption[];
  onChoose?: (id: string) => void;
}

export function ChoiceFeedback({ title, description, loading, options = [], onChoose }: ChoiceFeedbackProps) {
  return (
    <section className={`choice-feedback ${loading ? "loading" : ""}`} aria-live="polite">
      <span className="choice-feedback-mark">{loading ? <LoaderCircle size={14} /> : <Check size={14} />}</span>
      <div><strong>{title}</strong><p>{description}</p></div>
      {!loading && <div className="choice-feedback-options">
        {options.map((option) => <button className={option.primary ? "primary" : ""} type="button" key={option.id} onClick={() => onChoose?.(option.id)} title={option.description}>{option.label}{option.id === "dismiss" && <X size={12} />}</button>)}
      </div>}
    </section>
  );
}
