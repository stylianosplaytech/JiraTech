import { useRef, useState } from 'react';
import type { NoticeContent, NoticeLine, NoticeSection } from '../../api';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, TrashIcon, XIcon } from '../Icons';
import { Dropdown, errorMessage, useToast } from '../ui';
import { readLogo } from './logo';

const KINDS: { kind: NoticeSection['kind']; label: string; hint: string }[] = [
  { kind: 'field', label: 'Field', hint: 'A label and its value, e.g. Impact Level' },
  { kind: 'box', label: 'Box of lines', hint: 'e.g. Date & Time with Date, Start and End' },
  { kind: 'text', label: 'Paragraph', hint: 'A paragraph of text' },
  { kind: 'note', label: 'Note', hint: 'A highlighted note with a heading' },
  { kind: 'small', label: 'Small print', hint: 'e.g. Next update will be sent in 30 minutes.' },
];

const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<NoticeSection['kind'], string>;

function blankSection(kind: NoticeSection['kind']): NoticeSection {
  switch (kind) {
    case 'field': return { kind, label: '', value: '' };
    case 'box': return { kind, label: 'Date & Time', lines: [{ label: 'Date', value: '', input: 'date' }, { label: 'Start Time (UTC)', value: '', input: 'time' }, { label: 'End Time (UTC)', value: '', input: 'time' }] };
    case 'note': return { kind, label: '', value: '' };
    default: return { kind, value: '' };
  }
}

const ORDINAL = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "2026-08-12" → "Wednesday 12th August 2026", the way the notices write dates. */
export function formatNoticeDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const month = date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${weekday} ${ORDINAL(d)} ${month} ${y}`;
}

/**
 * Every text of a service notice, editable: its header, its sections (added, removed and reordered freely) and its
 * footer. `template` also offers the look (style, colour, logo) and the suggested values of fields up front; when
 * sending a notice they are tucked away under "Look".
 */
export default function NoticeEditor({ value, onChange, template = false }: {
  value: NoticeContent;
  onChange: (v: NoticeContent) => void;
  template?: boolean;
}) {
  const [showLook, setShowLook] = useState(template);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const upload = async (file: File) => {
    setReading(true);
    try {
      set({ logo: await readLogo(file) });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setReading(false);
    }
  };
  const set = (patch: Partial<NoticeContent>) => onChange({ ...value, ...patch });
  const setSection = (i: number, s: NoticeSection) => set({ sections: value.sections.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, by: -1 | 1) => {
    const list = [...value.sections];
    const [s] = list.splice(i, 1);
    list.splice(i + by, 0, s);
    set({ sections: list });
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <button type="button" className="card-header w-full text-left" onClick={() => setShowLook((s) => !s)} aria-expanded={showLook}>
          <span className="card-title flex items-center gap-1">
            {showLook ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />} Look
          </span>
          {!showLook && (
            <span className="flex items-center gap-2 text-xs text-jira-muted">
              {value.logo && <img src={value.logo} alt="" className="h-4 w-auto max-w-[60px] object-contain" />}
              {value.style === 'alert' ? 'Alert card' : 'Banner'}
              <span className="w-4 h-4 rounded-[3px] border border-jira-border" style={{ background: value.color }} />
            </span>
          )}
        </button>
        {showLook && (
          <div className="p-4 grid gap-3 sm:grid-cols-2">
            <div>
              <span className="field-label">Style</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Style">
                {([['banner', 'Banner'], ['alert', 'Alert card']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={value.style === id}
                    onClick={() => set({ style: id })}
                    className={`btn btn-sm ${value.style === id ? 'bg-jira-blue-light text-jira-blue' : 'btn-default'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="field-help">{value.style === 'alert' ? 'A coloured card header, for incidents.' : 'Full-width header bars, for maintenance and releases.'}</p>
            </div>
            <div>
              <label className="field-label" htmlFor="notice-color">Colour</label>
              <div className="flex items-center gap-2">
                <input id="notice-color" type="color" className="h-9 w-12 rounded-[3px] border-2 border-jira-border bg-white p-0.5 cursor-pointer" value={value.color} onChange={(e) => set({ color: e.target.value })} />
                {['#2a7fba', '#1b4f72', '#b91c1c', '#d97706', '#15803d', '#6d28d9'].map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} className={`w-6 h-6 rounded-full border-2 ${value.color === c ? 'border-jira-navy' : 'border-white shadow'}`} style={{ background: c }} onClick={() => set({ color: c })} />
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <span className="field-label">Logo image</span>
              <div className="flex flex-wrap items-center gap-3">
                {value.logo && (
                  <span className="inline-flex items-center justify-center rounded-[3px] border border-jira-border bg-white p-2">
                    <img src={value.logo} alt="Logo" style={{ height: Math.min(value.logoHeight, 64) }} className="w-auto max-w-[220px] object-contain" />
                  </span>
                )}
                <button type="button" className="btn btn-default btn-sm" disabled={reading} onClick={() => fileRef.current?.click()}>
                  {reading ? 'Reading…' : value.logo ? 'Replace logo' : 'Upload logo'}
                </button>
                {value.logo && <button type="button" className="btn btn-subtle btn-sm" onClick={() => set({ logo: '' })}>Remove</button>}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }}
                />
              </div>
              {value.logo ? (
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs text-jira-muted shrink-0" htmlFor="notice-logo-height">Height</label>
                  <input id="notice-logo-height" type="range" min={16} max={160} step={2} className="w-48" value={value.logoHeight} onChange={(e) => set({ logoHeight: Number(e.target.value) })} />
                  <span className="text-xs text-jira-muted w-12">{value.logoHeight} px</span>
                </div>
              ) : (
                <p className="field-help">PNG, JPEG, GIF, WebP or SVG. Large images are shrunk; it is shown instead of the text logo below.</p>
              )}
            </div>
            <div>
              <label className="field-label" htmlFor="notice-brand">{value.logo ? 'Logo text (the image’s alt text)' : 'Logo text'}</label>
              <input id="notice-brand" className="input" maxLength={40} value={value.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="playtech" />
            </div>
            <div>
              <label className="field-label" htmlFor="notice-brand-tag">Logo badge</label>
              <input id="notice-brand-tag" disabled={!!value.logo} title={value.logo ? 'Not shown while there is a logo image' : undefined} className="input" maxLength={20} value={value.brandTag} onChange={(e) => set({ brandTag: e.target.value })} placeholder="SPORTS" />
            </div>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="card-title">Header</div>
        <div>
          <label className="field-label" htmlFor="notice-eyebrow">{value.style === 'alert' ? 'Small line above the headline' : 'Top banner'}</label>
          <input id="notice-eyebrow" className="input" maxLength={200} value={value.eyebrow} onChange={(e) => set({ eyebrow: e.target.value })} placeholder={value.style === 'alert' ? 'PRIORITY 1' : 'PLAYTECH SPORTS SERVICE NOTIFICATION'} />
        </div>
        <div>
          <label className="field-label" htmlFor="notice-headline">Headline</label>
          <input id="notice-headline" className="input" maxLength={200} value={value.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="Maintenance Reminder" />
        </div>
        <div>
          <label className="field-label" htmlFor="notice-title">Title</label>
          <input id="notice-title" className="input" maxLength={200} value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. DBX/Moj 26.5 Release (optional)" />
          <p className="field-help">The underlined heading the notice starts with.</p>
        </div>
      </div>

      <div className="space-y-2">
        {value.sections.map((s, i) => (
          // Sections have no ids; their position is who they are while editing.
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="card">
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-jira-border bg-jira-gray">
              <span className="text-xs font-semibold text-jira-subtle flex-1">{KIND_LABEL[s.kind]}</span>
              <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ChevronDownIcon size={14} className="rotate-180" />
              </button>
              <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label="Move down" disabled={i === value.sections.length - 1} onClick={() => move(i, 1)}>
                <ChevronDownIcon size={14} />
              </button>
              <button type="button" className="btn btn-subtle btn-sm btn-icon" aria-label={`Remove ${KIND_LABEL[s.kind].toLowerCase()}`} onClick={() => set({ sections: value.sections.filter((_, j) => j !== i) })}>
                <TrashIcon size={14} />
              </button>
            </div>
            <div className="p-3">
              <SectionEditor section={s} onChange={(next) => setSection(i, next)} template={template} id={`notice-s${i}`} />
            </div>
          </div>
        ))}
        <Dropdown
          width="w-80"
          trigger={({ toggle }) => <button type="button" className="btn btn-default btn-sm" onClick={toggle}><PlusIcon size={14} /> Add section</button>}
        >
          {(close) => KINDS.map((k) => (
            <button key={k.kind} type="button" className="menu-item" onClick={() => { close(); set({ sections: [...value.sections, blankSection(k.kind)] }); }}>
              <span className="flex-1">{k.label}<span className="block text-xs text-jira-muted">{k.hint}</span></span>
            </button>
          ))}
        </Dropdown>
      </div>

      <div className="card p-4">
        <label className="field-label" htmlFor="notice-footer">Footer</label>
        <textarea id="notice-footer" className="input" rows={2} maxLength={5000} value={value.footer} onChange={(e) => set({ footer: e.target.value })} placeholder="For any details and/or clarifications please contact your Technical Account Manager" />
      </div>
    </div>
  );
}

const rows = (v: string, min = 1) => Math.min(10, Math.max(min, v.split('\n').length));

function SectionEditor({ section: s, onChange, template, id }: {
  section: NoticeSection;
  onChange: (s: NoticeSection) => void;
  template: boolean;
  id: string;
}) {
  switch (s.kind) {
    case 'field':
      return (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <label className="field-label" htmlFor={`${id}-label`}>Label</label>
            <input id={`${id}-label`} className="input" maxLength={200} value={s.label} onChange={(e) => onChange({ ...s, label: e.target.value })} placeholder="Impact Level" />
          </div>
          <div>
            <label className="field-label" htmlFor={`${id}-value`}>Value</label>
            <textarea id={`${id}-value`} className="input" rows={rows(s.value)} maxLength={5000} value={s.value} onChange={(e) => onChange({ ...s, value: e.target.value })} />
            {!!s.options?.length && (
              <div className="flex flex-wrap gap-1 mt-1">
                {s.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => onChange({ ...s, value: o })}
                    className={`rounded-full px-2 py-0.5 text-xs border ${s.value === o ? 'bg-jira-blue-light border-jira-blue text-jira-blue' : 'border-jira-border text-jira-subtle hover:bg-jira-gray-hover'}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
          {template && (
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor={`${id}-options`}>Suggested values (optional, one per line)</label>
              <textarea
                id={`${id}-options`}
                className="input"
                rows={Math.max(2, (s.options?.length ?? 0) + 1)}
                value={(s.options ?? []).join('\n')}
                onChange={(e) => onChange({ ...s, options: e.target.value.split('\n') })}
                placeholder={'1 / Low\n2 / Medium\n3 / High'}
              />
              <p className="field-help">Offered as one-click choices when sending; any other text can still be typed.</p>
            </div>
          )}
        </div>
      );
    case 'box':
      return (
        <div className="space-y-2">
          <div>
            <label className="field-label" htmlFor={`${id}-label`}>Heading</label>
            <input id={`${id}-label`} className="input" maxLength={200} value={s.label} onChange={(e) => onChange({ ...s, label: e.target.value })} placeholder="Date & Time" />
          </div>
          {s.lines.map((l, i) => (
            <LineEditor
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              line={l}
              id={`${id}-l${i}`}
              template={template}
              onChange={(next) => onChange({ ...s, lines: s.lines.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => onChange({ ...s, lines: s.lines.filter((_, j) => j !== i) })}
            />
          ))}
          {s.lines.length < 12 && (
            <button type="button" className="btn btn-subtle btn-sm" onClick={() => onChange({ ...s, lines: [...s.lines, { label: '', value: '' }] })}>
              <PlusIcon size={14} /> Add line
            </button>
          )}
        </div>
      );
    case 'note':
      return (
        <div className="space-y-2">
          <div>
            <label className="field-label" htmlFor={`${id}-label`}>Heading</label>
            <input id={`${id}-label`} className="input" maxLength={200} value={s.label} onChange={(e) => onChange({ ...s, label: e.target.value })} placeholder="Note to shops" />
          </div>
          <div>
            <label className="field-label" htmlFor={`${id}-value`}>Text</label>
            <textarea id={`${id}-value`} className="input" rows={rows(s.value, 2)} maxLength={5000} value={s.value} onChange={(e) => onChange({ ...s, value: e.target.value })} />
          </div>
        </div>
      );
    default:
      return (
        <div>
          <label className="sr-only" htmlFor={`${id}-value`}>Text</label>
          <textarea id={`${id}-value`} className="input" rows={rows(s.value, s.kind === 'text' ? 3 : 1)} maxLength={5000} value={s.value} onChange={(e) => onChange({ ...s, value: e.target.value })} />
        </div>
      );
  }
}

function LineEditor({ line: l, id, template, onChange, onRemove }: {
  line: NoticeLine;
  id: string;
  template: boolean;
  onChange: (l: NoticeLine) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-start gap-2">
      <input aria-label="Line label" className="input sm:w-44 shrink-0" maxLength={200} value={l.label} onChange={(e) => onChange({ ...l, label: e.target.value })} placeholder="Label" />
      <input id={id} aria-label={`${l.label || 'Line'} value`} className="input flex-1 min-w-[140px]" maxLength={200} value={l.value} onChange={(e) => onChange({ ...l, value: e.target.value })} placeholder="Value" />
      {l.input === 'date' && (
        <input
          type="date"
          aria-label={`Pick ${l.label || 'a date'}`}
          title="Pick a date"
          className="input w-[140px] shrink-0"
          onChange={(e) => { if (e.target.value) onChange({ ...l, value: formatNoticeDate(e.target.value) }); }}
        />
      )}
      {l.input === 'time' && (
        <input
          type="time"
          aria-label={`Pick ${l.label || 'a time'}`}
          title="Pick a time"
          className="input w-[110px] shrink-0"
          value={/^\d{2}:\d{2}$/.test(l.value) ? l.value : ''}
          onChange={(e) => onChange({ ...l, value: e.target.value })}
        />
      )}
      {template && (
        <select aria-label="Picker" className="input w-[110px] shrink-0" value={l.input ?? 'text'} onChange={(e) => onChange({ ...l, input: e.target.value as NoticeLine['input'] })}>
          <option value="text">Text</option>
          <option value="date">Date picker</option>
          <option value="time">Time picker</option>
        </select>
      )}
      <button type="button" className="btn btn-subtle btn-icon shrink-0" aria-label={`Remove ${l.label || 'line'}`} onClick={onRemove}><XIcon size={14} /></button>
    </div>
  );
}
