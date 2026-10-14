import { escapeHtml } from '../issue-email/email-html';
import { NoticeContent, NoticeSection } from './notice-content';

/**
 * A service notice as an email: tables and inline styles only, so Outlook and Gmail show it the way the preview does.
 * The browser's preview is this same HTML.
 */
export function renderNoticeHtml(c: NoticeContent): string {
  const accent = c.color;
  const dark = mix(accent, '#000000', 0.35);
  const font = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const alert = c.style === 'alert';

  const header = alert
    ? (c.eyebrow || c.headline) && `<tr><td style="background:${accent};padding:18px 24px;text-align:center;border-radius:8px 8px 0 0">`
      + (c.eyebrow ? `<div style="color:${mix(accent, '#ffffff', 0.75)};font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">${t(c.eyebrow)}</div>` : '')
      + (c.headline ? `<div style="color:#ffffff;font-size:19px;font-weight:700">${t(c.headline)}</div>` : '')
      + '</td></tr>'
    : (c.eyebrow ? `<tr><td style="background:${dark};color:#ffffff;padding:15px 24px;text-align:center;font-size:16px;font-weight:700;letter-spacing:1px">${t(c.eyebrow)}</td></tr>` : '')
      + (c.headline ? `<tr><td style="background:${accent};color:#ffffff;padding:11px 24px;text-align:center;font-size:14px;font-weight:700">${t(c.headline)}</td></tr>` : '');

  const title = c.title
    ? `<tr><td colspan="2" style="padding:0 0 10px;border-bottom:2px solid ${accent};color:${dark};font-size:16px;font-weight:700">${t(c.title)}</td></tr>`
      + '<tr><td colspan="2" style="height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>'
    : '';

  const body = c.sections.map((s) => section(s, c)).filter(Boolean).join('');

  const brand = c.brand || c.brandTag
    ? '<tr><td style="padding:16px 24px 28px;text-align:center">'
      + (c.brand ? `<span style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:700;font-size:22px;color:${BRAND_COLOR};letter-spacing:-0.5px;vertical-align:middle">${t(c.brand)}</span>` : '')
      + (c.brandTag ? `<span style="display:inline-block;margin-left:2px;width:40px;height:40px;line-height:40px;border-radius:20px;background:${BRAND_COLOR};color:#ffffff;font-size:9px;font-weight:700;text-align:center;vertical-align:middle">${t(c.brandTag)}</span>` : '')
      + '</td></tr>'
    : '';

  const footer = c.footer
    ? `<tr><td style="padding:32px 24px 4px;text-align:center;color:#555555;font-size:11px;line-height:1.5">${t(c.footer)}</td></tr>`
    : '';

  const card = alert
    ? 'background:#ffffff;border-radius:8px;border:1px solid #e3e7ee'
    : 'background:#ffffff;border:1px solid #dfe3e8';

  return `<div style="margin:0;padding:24px 8px;background:${alert ? '#eef2f8' : '#f1f3f5'};${font}">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto;${card};border-collapse:separate">`
    + header
    + `<tr><td style="padding:24px 28px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;color:#172b4d;font-size:13px;line-height:1.5">${title}${body}</table></td></tr>`
    + footer
    + brand
    + '</table></div>';
}

function section(s: NoticeSection, c: NoticeContent): string {
  const accent = c.color;
  const alert = c.style === 'alert';
  const row = (inner: string) => `<tr><td style="padding:0 0 12px">${inner}</td></tr>`;
  const labelRow = (label: string, value: string) => '<tr>'
    + `<td style="padding:10px 12px 10px 0;border-bottom:1px solid #eef0f3;width:32%;vertical-align:top;font-weight:700;color:#42526e;font-size:12px">${label ? `${t(label)}:` : ''}</td>`
    + `<td style="padding:10px 0;border-bottom:1px solid #eef0f3;vertical-align:top">${value}</td></tr>`;
  const sub = (inner: string) => `<tr><td colspan="2" style="padding:0">${inner}</td></tr>`;

  switch (s.kind) {
    case 'field':
      return s.label || s.value ? labelRow(s.label, s.value ? t(s.value) : '—') : '';
    case 'box': {
      const lines = s.lines.filter((l) => l.label || l.value)
        .map((l) => `<div style="margin:2px 0">${l.label ? `<strong>${t(l.label)}:</strong> ` : ''}${t(l.value)}</div>`).join('');
      if (!s.label && !lines) return '';
      if (!alert) {
        return labelRow(s.label, `<div style="background:#f6f8fa;border:1px solid #e1e5ea;border-radius:3px;padding:12px 14px;font-size:12px">${lines}</div>`);
      }
      return sub(row(`<div style="background:${mix(accent, '#ffffff', 0.95)};border:1px solid ${mix(accent, '#ffffff', 0.8)};border-radius:8px;padding:14px 16px;font-size:12px">`
        + (s.label ? `<div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#5e6c84;margin-bottom:8px">${t(s.label)}</div>` : '')
        + `${lines}</div>`));
    }
    case 'note':
      if (!s.label && !s.value) return '';
      return sub(row(`<div style="background:#f8fafc;border-left:3px solid ${accent};border-radius:0 8px 8px 0;padding:12px 16px;font-size:12px">`
        + (s.label ? `<div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#5e6c84;margin-bottom:6px">${t(s.label)}</div>` : '')
        + `${t(s.value)}</div>`));
    case 'text':
      return s.value ? sub(row(`<div style="font-size:13px">${t(s.value)}</div>`)) : '';
    case 'small':
      return s.value ? sub(row(`<div style="font-size:11px;text-decoration:underline;color:#42526e">${t(s.value)}</div>`)) : '';
    default:
      return '';
  }
}

/** The text version sent alongside the HTML. */
export function renderNoticeText(c: NoticeContent): string {
  const out: string[] = [];
  if (c.eyebrow) out.push(c.eyebrow);
  if (c.headline) out.push(c.headline);
  if (out.length) out.push('');
  if (c.title) out.push(c.title, '='.repeat(Math.min(60, c.title.length)), '');
  for (const s of c.sections) {
    if (s.kind === 'field') {
      if (s.label || s.value) out.push(`${s.label ? `${s.label}: ` : ''}${s.value || '—'}`);
    } else if (s.kind === 'box') {
      if (s.label) out.push(`${s.label}:`);
      for (const l of s.lines) if (l.label || l.value) out.push(`  ${l.label ? `${l.label}: ` : ''}${l.value}`);
    } else if (s.kind === 'note') {
      out.push('', ...(s.label ? [s.label.toUpperCase()] : []), s.value, '');
    } else if (s.value) {
      out.push(s.value, '');
    }
  }
  if (c.footer) out.push('', c.footer);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The logo keeps its own colour whatever the notice's colour is. */
const BRAND_COLOR = '#4f86c6';

/** Escaped, line breaks kept. */
const t = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

/** `a` moved `amount` (0–1) of the way towards `b`. */
function mix(a: string, b: string, amount: number) {
  const pa = parse(a);
  const pb = parse(b);
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
