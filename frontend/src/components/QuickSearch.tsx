import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { jqlValue } from '../utils';
import { TypeBadge } from './Badges';

/** Header search box. "/" focuses it; Enter opens an exact key match or runs a text search. */
export default function QuickSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data } = useQuery({
    queryKey: ['quick-search', debounced],
    queryFn: () => api.quickSearch(debounced),
    enabled: debounced.length >= 2,
  });

  const close = () => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };

  const submit = () => {
    const term = q.trim();
    if (!term) return;
    const exact = data?.issues.find((i) => i.key.toUpperCase() === term.toUpperCase());
    if (exact) navigate(`/browse/${exact.key}`);
    else navigate(`/search?jql=${encodeURIComponent(`text ~ ${jqlValue(term)} ORDER BY updated DESC`)}`);
    close();
  };

  const showResults = open && debounced.length >= 2 && data;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') close();
        }}
        placeholder="Search  ( / )"
        className="w-56 focus:w-80 transition-all bg-white/15 placeholder-white/70 text-white focus:bg-white focus:text-jira-navy focus:placeholder-gray-400 rounded px-3 py-1.5 text-sm outline-none"
      />
      {showResults && (
        <div className="absolute right-0 top-full mt-1 w-96 bg-white text-jira-navy border border-jira-border rounded shadow-lg z-50 overflow-hidden">
          {data.issues.length === 0 && data.projects.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-500">No matches. Press Enter to search all text.</div>
          )}
          {data.issues.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase text-gray-500">Issues</div>
              {data.issues.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { navigate(`/browse/${i.key}`); close(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-jira-gray"
                >
                  <TypeBadge type={i.type} />
                  <span className="text-gray-500 shrink-0">{i.key}</span>
                  <span className="truncate">{i.summary}</span>
                </button>
              ))}
            </>
          )}
          {data.projects.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase text-gray-500">Projects</div>
              {data.projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { navigate(`/projects/${p.key}`); close(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-jira-gray"
                >
                  <span className="font-mono text-xs bg-jira-gray rounded px-1.5 py-0.5">{p.key}</span>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={submit}
            className="w-full border-t border-jira-border px-3 py-2 text-left text-sm text-jira-blue hover:bg-jira-gray"
          >
            Search all issues for “{q.trim()}”
          </button>
        </div>
      )}
    </div>
  );
}
