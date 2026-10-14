import { BadRequestException } from '@nestjs/common';

/**
 * What a service notice says and how it looks. Templates hold one with the usual texts; whoever sends a notice can
 * change every text in it (and add or remove sections) before it goes out. Texts are plain: line breaks are kept.
 */
export interface NoticeContent {
  /** 'banner': full-width header bars (maintenance reminders). 'alert': a coloured card header (incidents). */
  style: NoticeStyle;
  /** #rrggbb: header, headings and boxes are drawn in shades of it */
  color: string;
  /** Top line: "PLAYTECH SPORTS SERVICE NOTIFICATION" on a banner, "PRIORITY 1" above an alert's headline */
  eyebrow: string;
  /** "Maintenance Reminder" / "P1 Service Interruption Notification" */
  headline: string;
  /** The underlined heading the body starts with, e.g. the release's name */
  title: string;
  sections: NoticeSection[];
  /** Small print at the bottom, e.g. who to contact */
  footer: string;
  /** The text logo at the very bottom: "playtech" and its badge, "SPORTS" (either may be empty) */
  brand: string;
  brandTag: string;
  /** An uploaded logo (a data: URI of a PNG, JPEG or GIF), shown instead of the text logo; '' for none */
  logo: string;
  /** How tall the logo image is drawn, in pixels */
  logoHeight: number;
}

export type NoticeStyle = 'banner' | 'alert';
export const NOTICE_STYLES: NoticeStyle[] = ['banner', 'alert'];

export type NoticeSection =
  /** A label and its value on one row, e.g. "Impact Level: 1 / Low". `options` are suggested values. */
  | { kind: 'field'; label: string; value: string; options?: string[] }
  /** A boxed group of label/value lines, e.g. Date & Time with Date, Start and End */
  | { kind: 'box'; label: string; lines: NoticeLine[] }
  /** A paragraph of text */
  | { kind: 'text'; value: string }
  /** A highlighted note with a heading, e.g. "Note to shops" */
  | { kind: 'note'; label: string; value: string }
  /** A small underlined line, e.g. "Next update will be sent in 30 minutes." */
  | { kind: 'small'; value: string };

export type NoticeSectionKind = NoticeSection['kind'];
export const SECTION_KINDS: NoticeSectionKind[] = ['field', 'box', 'text', 'note', 'small'];

/** `input` only changes how it is edited (a date or time picker that writes the text); the value stays text. */
export interface NoticeLine {
  label: string;
  value: string;
  input?: 'date' | 'time' | 'text';
}

const MAX_SECTIONS = 40;
/** About 300 KB of image once decoded: plenty for a logo, small enough for every mail server. */
const MAX_LOGO = 400_000;
const LOGO = /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+=*$/;
export const DEFAULT_LOGO_HEIGHT = 48;
const MAX_LINES = 12;
const MAX_OPTIONS = 20;
const SHORT = 200;
const LONG = 5000;

/** A notice's content from the browser (or the database), checked and trimmed; throws on anything unusable. */
export function normalizeContent(raw: unknown): NoticeContent {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('The notice has no content');
  const c = raw as Record<string, unknown>;
  const style = NOTICE_STYLES.includes(c.style as NoticeStyle) ? (c.style as NoticeStyle) : 'banner';
  const color = typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color.trim()) ? c.color.trim().toLowerCase() : DEFAULT_COLOR[style];
  if (!Array.isArray(c.sections)) throw new BadRequestException('The notice has no sections');
  if (c.sections.length > MAX_SECTIONS) throw new BadRequestException(`A notice can have up to ${MAX_SECTIONS} sections`);
  return {
    style,
    color,
    eyebrow: text(c.eyebrow, SHORT),
    headline: text(c.headline, SHORT),
    title: text(c.title, SHORT),
    sections: c.sections.map(section),
    footer: text(c.footer, LONG),
    brand: text(c.brand, 40),
    brandTag: text(c.brandTag, 20),
    logo: logo(c.logo),
    logoHeight: typeof c.logoHeight === 'number' && Number.isFinite(c.logoHeight)
      ? Math.min(160, Math.max(16, Math.round(c.logoHeight)))
      : DEFAULT_LOGO_HEIGHT,
  };
}

function logo(v: unknown) {
  if (typeof v !== 'string' || !v) return '';
  if (v.length > MAX_LOGO) throw new BadRequestException('The logo is too large: use an image under 300 KB');
  if (!LOGO.test(v)) throw new BadRequestException('The logo must be a PNG, JPEG or GIF image');
  return v;
}

export function parseContent(json: string): NoticeContent {
  try {
    return normalizeContent(JSON.parse(json));
  } catch {
    return blankContent();
  }
}

function section(raw: unknown): NoticeSection {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (s.kind) {
    case 'field': {
      const options = Array.isArray(s.options)
        ? [...new Set(s.options.map((o) => text(o, SHORT)).filter(Boolean))].slice(0, MAX_OPTIONS)
        : [];
      return { kind: 'field', label: text(s.label, SHORT), value: text(s.value, LONG), ...(options.length ? { options } : {}) };
    }
    case 'box': {
      const lines = Array.isArray(s.lines) ? s.lines.slice(0, MAX_LINES).map(line) : [];
      return { kind: 'box', label: text(s.label, SHORT), lines };
    }
    case 'note':
      return { kind: 'note', label: text(s.label, SHORT), value: text(s.value, LONG) };
    case 'text':
    case 'small':
      return { kind: s.kind, value: text(s.value, LONG) };
    default:
      throw new BadRequestException(`Unknown kind of section: ${String(s.kind)}`);
  }
}

function line(raw: unknown): NoticeLine {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const input = l.input === 'date' || l.input === 'time' ? l.input : undefined;
  return { label: text(l.label, SHORT), value: text(l.value, SHORT), ...(input ? { input } : {}) };
}

/** Line breaks kept (as \n), other control characters dropped, trailing spaces trimmed. */
function text(v: unknown, max: number) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

const DEFAULT_COLOR: Record<NoticeStyle, string> = { banner: '#2a7fba', alert: '#b91c1c' };

export function blankContent(): NoticeContent {
  return {
    style: 'banner', color: DEFAULT_COLOR.banner, eyebrow: '', headline: '', title: '', sections: [], footer: '', brand: '', brandTag: '',
    logo: '', logoHeight: DEFAULT_LOGO_HEIGHT,
  };
}

/** The templates a new installation starts with, modelled on Playtech Sports' own notices. */
export const STARTER_TEMPLATES: { name: string; description: string; subject: string; content: NoticeContent }[] = [
  {
    name: 'Maintenance reminder',
    description: 'Planned maintenance or a release: impact, downtime, when and what is affected.',
    subject: 'Maintenance Reminder: DBX/Moj 26.5 Release',
    content: {
      style: 'banner',
      color: '#2a7fba',
      eyebrow: 'PLAYTECH SPORTS SERVICE NOTIFICATION',
      headline: 'Maintenance Reminder',
      title: 'DBX/Moj 26.5 Release',
      sections: [
        { kind: 'field', label: 'Details', value: '—' },
        { kind: 'field', label: 'Impact Level', value: '1 / Low', options: ['1 / Low', '2 / Medium', '3 / High', '4 / Critical'] },
        { kind: 'field', label: 'Downtime', value: 'No — Non-downtime', options: ['No — Non-downtime', 'Yes — Downtime expected'] },
        {
          kind: 'box',
          label: 'Date & Time',
          lines: [
            { label: 'Date', value: 'Wednesday 12th August 2026', input: 'date' },
            { label: 'Start Time (UTC)', value: '07:44', input: 'time' },
            { label: 'Expected End Time (UTC)', value: '10:44', input: 'time' },
          ],
        },
        { kind: 'field', label: 'Affected Components', value: 'galerabet.br, hollandcasino, brasilbet.br' },
      ],
      footer: 'For any details and/or clarifications please contact your Technical Account Manager',
      brand: 'playtech',
      brandTag: 'SPORTS',
      logo: '',
      logoHeight: DEFAULT_LOGO_HEIGHT,
    },
  },
  {
    name: 'P1 service interruption',
    description: 'A priority 1 incident in progress, with what shops should do and when the next update comes.',
    subject: 'P1 Service Interruption Notification',
    content: {
      style: 'alert',
      color: '#b91c1c',
      eyebrow: 'PRIORITY 1',
      headline: 'P1 Service Interruption Notification',
      title: '',
      sections: [
        { kind: 'text', value: 'This notification is to inform you of a service interruption currently impacting our services. Our technical teams are already working on resolving this interruption.' },
        {
          kind: 'box',
          label: 'Date & Time',
          lines: [
            { label: 'Date', value: 'N/A', input: 'date' },
            { label: 'Start', value: 'N/A', input: 'time' },
            { label: 'End', value: '', input: 'time' },
          ],
        },
        { kind: 'note', label: 'Note to shops', value: 'Please be aware of a general service interruption.\nPlease do not restart your machines.' },
        { kind: 'small', value: 'Next update will be sent in 30 minutes.' },
      ],
      footer: '',
      brand: 'playtech',
      brandTag: 'SPORTS',
      logo: '',
      logoHeight: DEFAULT_LOGO_HEIGHT,
    },
  },
];
