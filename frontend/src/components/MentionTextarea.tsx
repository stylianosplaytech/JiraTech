import { useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type User } from '../api';
import Avatar from './Avatar';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Textarea with @mention suggestions: type "@" and part of a name or email, then pick a person
 * (↑/↓ and Enter or Tab). Mentions are stored as "@email" so the server can notify that person.
 */
export default function MentionTextarea({ value, onChange, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [active, setActive] = useState(0);
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.getUsers() });

  const matches = query === null
    ? []
    : (users ?? [])
      .filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 6);
  const open = query !== null && matches.length > 0;

  const detect = (text: string, caret: number) => {
    const m = /(^|[\s(])@([\w.+-]*)$/.exec(text.slice(0, caret));
    if (m) {
      setQuery(m[2]);
      setStart(caret - m[2].length - 1);
      setActive(0);
    } else {
      setQuery(null);
    }
  };

  const insert = (u: User) => {
    const caret = ref.current?.selectionStart ?? value.length;
    const mention = `@${u.email} `;
    const next = value.slice(0, start) + mention + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = start + mention.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); insert(matches[active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); return; }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={handleKey}
        onClick={(e) => detect(value, e.currentTarget.selectionStart)}
        onBlur={(e) => { setTimeout(() => setQuery(null), 150); rest.onBlur?.(e); }}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <div className="popover absolute left-0 top-full mt-1 w-72" role="listbox" aria-label="Mention someone">
          <div className="menu-heading">Mention someone</div>
          {matches.map((u, i) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => insert(u)}
              className={`menu-item ${i === active ? 'bg-jira-blue-light/60' : ''}`}
            >
              <Avatar name={u.name} size="xs" />
              <span className="truncate">{u.name}</span>
              <span className="ml-auto text-xs text-jira-muted truncate">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
