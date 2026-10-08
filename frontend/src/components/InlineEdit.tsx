import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, XIcon } from './Icons';

/** Click-to-edit single-line text. Enter or ✓ saves, Escape or ✕ cancels. */
export function InlineText({
  value, onSave, placeholder = 'None', className = '', inputClassName = '', type = 'text', validate, display,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  type?: 'text' | 'number';
  validate?: (v: string) => string | null;
  display?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);

  const save = () => {
    const v = draft.trim();
    const err = validate?.(v) ?? null;
    if (err) { setError(err); return; }
    setEditing(false);
    setError(null);
    if (v !== value) onSave(v);
  };
  const cancel = () => { setEditing(false); setDraft(value); setError(null); };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`w-full text-left rounded-[3px] px-2 py-1 -mx-2 hover:bg-jira-gray-hover transition-colors ${className}`}
      >
        {display ?? (value ? value : <span className="text-jira-muted">{placeholder}</span>)}
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        ref={ref}
        type={type}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') cancel();
        }}
        className={`input ${inputClassName} ${error ? 'border-[#DE350B]' : ''}`}
      />
      {error && <span className="field-error">{error}</span>}
      <div className="absolute right-0 top-full mt-1 flex gap-1 z-10">
        <button type="button" onClick={save} className="btn btn-default btn-sm btn-icon bg-white shadow-card" aria-label="Save"><CheckIcon size={14} /></button>
        <button type="button" onClick={cancel} className="btn btn-default btn-sm btn-icon bg-white shadow-card" aria-label="Cancel"><XIcon size={14} /></button>
      </div>
    </div>
  );
}

/** Click-to-edit multi-line text (descriptions). */
export function InlineTextarea({
  value, onSave, placeholder = 'Add a description…', saving,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  saving?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true); }}
        className="rounded-[3px] px-2 py-1.5 -mx-2 hover:bg-jira-gray-hover cursor-text min-h-[40px] transition-colors"
      >
        {value
          ? <p className="whitespace-pre-wrap break-words leading-6">{value}</p>
          : <p className="text-jira-muted">{placeholder}</p>}
      </div>
    );
  }

  const save = () => { setEditing(false); if (draft !== value) onSave(draft); };
  return (
    <div>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
          if (e.key === 'Escape') { setEditing(false); setDraft(value); }
        }}
        rows={Math.max(6, draft.split('\n').length + 1)}
        className="input"
        placeholder={placeholder}
      />
      <div className="flex items-center gap-2 mt-2">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>Save</button>
        <button type="button" className="btn btn-subtle" onClick={() => { setEditing(false); setDraft(value); }}>Cancel</button>
        <span className="text-xs text-jira-muted ml-auto">Ctrl+Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}
