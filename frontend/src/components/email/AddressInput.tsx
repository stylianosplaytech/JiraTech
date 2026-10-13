import { useState, type KeyboardEvent } from 'react';
import type { EmailAddress } from '../../api';
import { XIcon } from '../Icons';
import { parseAddress } from './recipients';

/**
 * Recipients as chips. Type an address and press Enter, comma or Tab (or paste several); people on the request are
 * suggested as you type.
 */
export default function AddressInput({
  id, value, onChange, suggestions = [], autoFocus,
}: {
  id: string;
  value: EmailAddress[];
  onChange: (v: EmailAddress[]) => void;
  suggestions?: EmailAddress[];
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const taken = new Set(value.map((a) => a.email.toLowerCase()));
  const q = text.trim().toLowerCase();
  const matches = q
    ? suggestions.filter((s) => !taken.has(s.email.toLowerCase()) && (s.email.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q))).slice(0, 6)
    : [];

  const add = (list: EmailAddress[]) => {
    const fresh = list.filter((a, i) => !taken.has(a.email) && list.findIndex((b) => b.email === a.email) === i);
    if (fresh.length) onChange([...value, ...fresh]);
  };

  /** Adds what was typed; false when it isn't an address. */
  const commit = (raw = text) => {
    const parts = raw.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return true;
    const parsed = parts.map(parseAddress);
    const bad = parts.filter((_, i) => !parsed[i]);
    add(parsed.filter((a): a is EmailAddress => !!a));
    setText(bad.join(', '));
    setError(bad.length > 0);
    return bad.length === 0;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
      return;
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && text.trim())) {
      if (e.key === 'Enter' && matches[active]) {
        e.preventDefault();
        add([matches[active]]);
        setText('');
        setActive(0);
        return;
      }
      if (text.trim()) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Enter') {
        e.preventDefault();
      }
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="relative">
      <div className={`input flex flex-wrap items-center gap-1 py-1 min-h-[36px] h-auto ${error ? 'border-[#DE350B]' : ''}`}>
        {value.map((a) => (
          <span key={a.email} className="inline-flex items-center gap-1 rounded-[3px] bg-jira-gray-hover px-1.5 py-0.5 text-xs max-w-full" title={a.email}>
            <span className="truncate">{a.name ? `${a.name} <${a.email}>` : a.email}</span>
            <button type="button" aria-label={`Remove ${a.email}`} className="text-jira-subtle hover:text-jira-navy" onClick={() => onChange(value.filter((x) => x.email !== a.email))}>
              <XIcon size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          autoFocus={autoFocus}
          className="flex-1 min-w-[160px] bg-transparent outline-none text-sm py-0.5"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(false); setActive(0); }}
          onKeyDown={onKeyDown}
          onBlur={() => commit()}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (/[,;\n]/.test(pasted)) { e.preventDefault(); commit(`${text}${pasted}`); }
          }}
          placeholder={value.length ? '' : 'name@company.com'}
          autoComplete="off"
        />
      </div>
      {error && <p className="field-error">Not an email address: {text}</p>}
      {matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 popover">
          {matches.map((m, i) => (
            <button
              key={m.email}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); add([m]); setText(''); setActive(0); }}
              className={`menu-item w-full text-left ${i === active ? 'bg-jira-gray-hover' : ''}`}
            >
              <span className="truncate">{m.name ?? m.email}</span>
              {m.name && <span className="text-xs text-jira-muted truncate ml-1">{m.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
