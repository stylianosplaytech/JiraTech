import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Issue } from '../api';
import { TypeBadge } from './Badges';
import { SearchIcon, XIcon } from './Icons';

/** Type-ahead issue search across all projects (by key or summary). */
export default function IssuePicker({
  value,
  onChange,
  excludeIds = [],
  placeholder = 'Search by key or summary…',
  autoFocus,
}: {
  value: Issue | null;
  onChange: (issue: Issue | null) => void;
  excludeIds?: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['quick-search', debounced],
    queryFn: () => api.quickSearch(debounced),
    enabled: debounced.length >= 1,
  });
  const results = data?.issues.filter((i) => !excludeIds.includes(i.id)) ?? [];

  if (value) {
    return (
      <div className="flex items-center gap-2 h-9 rounded-[3px] border-2 border-jira-border bg-white px-2">
        <TypeBadge type={value.type} />
        <span className="text-jira-subtle shrink-0">{value.key}</span>
        <span className="truncate flex-1">{value.summary}</span>
        <button type="button" onClick={() => onChange(null)} className="text-jira-muted hover:text-jira-navy" aria-label="Clear">
          <XIcon size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-jira-muted pointer-events-none" />
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="input pl-8"
      />
      {open && debounced && (
        <div className="popover absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-jira-muted">{isFetching ? 'Searching…' : 'No matching issues'}</div>
          ) : results.map((i) => (
            <button
              key={i.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(i); setQ(''); setOpen(false); }}
              className="menu-item"
            >
              <TypeBadge type={i.type} />
              <span className="text-jira-subtle shrink-0">{i.key}</span>
              <span className="truncate">{i.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
