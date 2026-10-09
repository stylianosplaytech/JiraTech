import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDismiss } from './ui';
import { CheckIcon, ChevronDownIcon, PlusIcon, SearchIcon, XIcon } from './Icons';

export interface PickerOption {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

/**
 * Multi-value field (components, labels, versions…): selected values show as chips; clicking opens a
 * searchable checklist. Toggling never clears the other selections. With `commitOnClose`, changes are
 * saved once when the list closes instead of on every click.
 */
export function MultiPicker({
  options, value, onChange, placeholder = 'None', commitOnClose = false, onCreate, createLabel = 'Create',
  disabled, emptyText = 'No options', className = '',
}: {
  options: PickerOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  commitOnClose?: boolean;
  onCreate?: (name: string) => Promise<PickerOption>;
  createLabel?: string;
  disabled?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [extra, setExtra] = useState<PickerOption[]>([]);

  useEffect(() => { if (!open) setDraft(value); }, [value, open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    if (commitOnClose) {
      const changed = draft.length !== value.length || draft.some((id) => !value.includes(id));
      if (changed) onChange(draft);
    }
  }, [commitOnClose, draft, value, onChange]);
  const ref = useDismiss<HTMLDivElement>(open, close);

  const all = useMemo(() => {
    const seen = new Set(options.map((o) => o.id));
    return [...options, ...extra.filter((o) => !seen.has(o.id))];
  }, [options, extra]);
  const selected = commitOnClose ? draft : value;
  const byId = new Map(all.map((o) => [o.id, o]));
  const q = query.trim().toLowerCase();
  const filtered = all.filter((o) => !q || o.label.toLowerCase().includes(q));
  const exactExists = all.some((o) => o.label.toLowerCase() === q);

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (commitOnClose) setDraft(next);
    else onChange(next);
  };

  const remove = (id: string) => {
    const next = value.filter((x) => x !== id);
    onChange(next);
  };

  const create = async () => {
    if (!onCreate || !q) return;
    setCreating(true);
    try {
      const opt = await onCreate(query.trim());
      setExtra((e) => [...e, opt]);
      toggle(opt.id);
      setQuery('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } }}
        className={`group flex flex-wrap items-center gap-1 min-h-[32px] px-1.5 py-1 rounded-[3px] border-2 transition-colors
          ${open ? 'border-jira-focus bg-white' : 'border-transparent hover:bg-jira-gray-hover'}
          ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
      >
        {selected.length === 0 && <span className="text-jira-muted px-0.5">{placeholder}</span>}
        {selected.map((id) => {
          const o = byId.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-1 max-w-full rounded-[3px] bg-jira-gray-hover px-1.5 py-0.5 text-xs text-jira-navy">
              {o?.icon}
              <span className="truncate">{o?.label ?? 'Unknown'}</span>
              {!disabled && !(commitOnClose && open) && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(id); }}
                  className="text-jira-muted hover:text-jira-navy"
                  aria-label={`Remove ${o?.label ?? ''}`}
                >
                  <XIcon size={12} />
                </button>
              )}
            </span>
          );
        })}
        {!disabled && <ChevronDownIcon size={14} className="ml-auto text-jira-muted opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" />}
      </div>

      {open && (
        <div className="popover absolute left-0 top-full mt-1 w-full min-w-[240px]" role="listbox" aria-multiselectable="true">
          <div className="px-2 pb-1 pt-1">
            <div className="relative">
              <SearchIcon size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-jira-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (filtered.length === 1) toggle(filtered[0].id);
                    else if (onCreate && q && !exactExists) void create();
                  }
                }}
                placeholder="Search…"
                className="input h-8 pl-7"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.map((o) => {
              const checked = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(o.id)}
                  className={`menu-item ${checked ? 'bg-jira-blue-light/60' : ''}`}
                >
                  <span className={`flex items-center justify-center w-4 h-4 rounded-[3px] border-2 shrink-0
                    ${checked ? 'bg-jira-blue border-jira-blue text-white' : 'border-jira-border bg-white'}`}
                  >
                    {checked && <CheckIcon size={11} strokeWidth={3} />}
                  </span>
                  {o.icon}
                  <span className="truncate flex-1">{o.label}</span>
                  {o.hint && <span className="text-xs text-jira-muted">{o.hint}</span>}
                </button>
              );
            })}
            {filtered.length === 0 && !(onCreate && q) && <div className="px-3 py-2 text-sm text-jira-muted">{emptyText}</div>}
          </div>
          {onCreate && q && !exactExists && (
            <button type="button" onClick={() => void create()} disabled={creating} className="menu-item border-t border-jira-border text-jira-blue">
              <PlusIcon size={14} /> {createLabel} “{query.trim()}”
            </button>
          )}
          {commitOnClose && (
            <div className="flex justify-end gap-1 px-2 pt-1 border-t border-jira-border mt-1">
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => { setDraft(value); setOpen(false); setQuery(''); }}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={close}>Done</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Single-value field with a searchable list (assignee, priority, project…). Saves on pick. */
export function SelectPicker({
  options, value, onChange, placeholder = 'None', allowClear = false, clearLabel = 'None', disabled,
  footer, variant = 'inline', searchable = true,
}: {
  options: PickerOption[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  footer?: (close: () => void) => ReactNode;
  variant?: 'inline' | 'field';
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const listRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.id === value);
  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => !q || o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q));

  const pick = (id: string | null) => { onChange(id); close(); };

  const triggerClass = variant === 'field'
    ? `input flex items-center gap-2 text-left ${open ? 'bg-white border-jira-focus' : ''}`
    : `flex w-full items-center gap-2 min-h-[32px] px-2 rounded-[3px] border-2 text-left transition-colors
       ${open ? 'border-jira-focus bg-white' : 'border-transparent hover:bg-jira-gray-hover'}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${triggerClass} disabled:cursor-default disabled:hover:bg-transparent`}
      >
        {current ? (
          <>
            {current.icon}
            <span className="truncate flex-1">{current.label}</span>
          </>
        ) : (
          <span className="text-jira-muted flex-1 truncate">{placeholder}</span>
        )}
        {variant === 'field' && <ChevronDownIcon size={14} className="text-jira-muted shrink-0" />}
      </button>
      {open && (
        <div className="popover absolute left-0 top-full mt-1 w-full min-w-[220px]" role="listbox">
          {searchable && options.length > 6 && (
            <div className="px-2 pb-1 pt-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && filtered[0]) { e.preventDefault(); pick(filtered[0].id); } }}
                placeholder="Search…"
                className="input h-8"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto" ref={listRef}>
            {allowClear && (
              <button type="button" onClick={() => pick(null)} className={`menu-item ${!value ? 'bg-jira-blue-light/60' : ''}`}>
                <span className="text-jira-muted">{clearLabel}</span>
              </button>
            )}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => pick(o.id)}
                className={`menu-item ${o.id === value ? 'bg-jira-blue-light/60' : ''}`}
              >
                {o.icon}
                <span className="truncate flex-1">{o.label}</span>
                {o.hint && <span className="text-xs text-jira-muted truncate max-w-[45%]">{o.hint}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-jira-muted">No matches</div>}
          </div>
          {footer && <div className="border-t border-jira-border mt-1 pt-1">{footer(close)}</div>}
        </div>
      )}
    </div>
  );
}
