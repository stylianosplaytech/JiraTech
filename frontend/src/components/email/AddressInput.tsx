import { useState, type KeyboardEvent } from 'react';
import type { EmailAddress } from '../../api';
import { UsersIcon, XIcon } from '../Icons';
import { isRef, parseAddress, type Recipient, type RecipientRef } from './recipients';

type Match = { kind: 'person'; address: EmailAddress } | { kind: 'ref'; ref: RecipientRef };

const keyOf = (r: Recipient) => (isRef(r) ? `${r.type}:${r.id}` : r.email.toLowerCase());
const count = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Recipients as chips. Type to search people, organizations and recipient groups, or type an address and press
 * Enter, comma or Tab (or paste several). A group or organization is one chip and goes to everyone in it.
 */
export default function AddressInput({
  id, value, onChange, suggestions = [], refs = [], autoFocus, placeholder,
}: {
  id: string;
  value: Recipient[];
  onChange: (v: Recipient[]) => void;
  /** People to suggest */
  suggestions?: EmailAddress[];
  /** Recipient groups and organizations to suggest */
  refs?: RecipientRef[];
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const taken = new Set(value.map(keyOf));
  const q = text.trim().toLowerCase();
  const matches: Match[] = q ? [
    ...refs.filter((r) => !taken.has(keyOf(r)) && r.name.toLowerCase().includes(q)).slice(0, 5).map((ref) => ({ kind: 'ref' as const, ref })),
    ...suggestions
      .filter((s) => !taken.has(s.email.toLowerCase()) && (s.email.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q)))
      .slice(0, 6)
      .map((address) => ({ kind: 'person' as const, address })),
  ] : [];

  const add = (list: Recipient[]) => {
    const fresh = list.filter((r, i) => !taken.has(keyOf(r)) && list.findIndex((x) => keyOf(x) === keyOf(r)) === i);
    if (fresh.length) onChange([...value, ...fresh]);
  };
  const pick = (m: Match) => {
    add([m.kind === 'ref' ? m.ref : m.address]);
    setText('');
    setActive(0);
  };

  /** Adds what was typed as addresses; false when it isn't one. */
  const commit = (raw = text) => {
    const parts = raw.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return true;
    const parsed = parts.map(parseAddress);
    const bad = parts.filter((_, i) => !parsed[i]);
    add(parsed.filter((a): a is EmailAddress => !!a));
    setText(bad.join(', '));
    // Text that matches a group or person is a search in progress, not a mistake.
    setError(bad.length > 0 && !matches.length);
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
        pick(matches[active]);
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
        {value.map((r) => {
          const key = keyOf(r);
          const ref = isRef(r) ? r : null;
          const label = ref ? `${ref.name} (${ref.recipients.length})` : (r as EmailAddress).name ? `${(r as EmailAddress).name} <${(r as EmailAddress).email}>` : (r as EmailAddress).email;
          const title = ref
            ? `${ref.type === 'group' ? 'Recipient group' : 'Organization'}: ${ref.recipients.map((a) => a.email).join(', ') || 'nobody yet'}`
            : (r as EmailAddress).email;
          return (
            <span
              key={key}
              className={`inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-xs max-w-full ${ref ? 'bg-[#EAE6FF] text-[#403294]' : 'bg-jira-gray-hover'}`}
              title={title}
            >
              {ref && <UsersIcon size={12} className="shrink-0" />}
              <span className="truncate">{label}</span>
              <button type="button" aria-label={`Remove ${ref ? ref.name : (r as EmailAddress).email}`} className="opacity-70 hover:opacity-100" onClick={() => onChange(value.filter((x) => keyOf(x) !== key))}>
                <XIcon size={12} />
              </button>
            </span>
          );
        })}
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
          placeholder={value.length ? '' : (placeholder ?? 'Name, email, organization or group')}
          autoComplete="off"
        />
      </div>
      {error && <p className="field-error">Not an email address: {text}</p>}
      {matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 popover max-h-72 overflow-y-auto">
          {matches.map((m, i) => (
            <button
              key={m.kind === 'ref' ? keyOf(m.ref) : m.address.email}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              className={`menu-item w-full text-left ${i === active ? 'bg-jira-gray-hover' : ''}`}
            >
              {m.kind === 'ref' ? (
                <>
                  <UsersIcon size={14} className="text-[#403294] shrink-0" />
                  <span className="truncate">{m.ref.name}</span>
                  <span className="text-xs text-jira-muted ml-auto shrink-0">
                    {m.ref.type === 'group' ? 'Recipient group' : 'Organization'} · {count(m.ref.recipients.length)}
                  </span>
                </>
              ) : (
                <>
                  <span className="truncate">{m.address.name ?? m.address.email}</span>
                  {m.address.name && <span className="text-xs text-jira-muted truncate ml-1">{m.address.email}</span>}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
