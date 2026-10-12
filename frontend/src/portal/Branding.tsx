import type { PortalBranding } from '../api';

export const DEFAULT_ACCENT = '#0052CC';

/** White or dark text, whichever reads better on the accent colour. */
export function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#172B4D' : '#FFFFFF';
}

/** The help center's logo, or its initial on the accent colour. Logos are only ever shown through <img>. */
export function PortalLogo({ branding, name, size = 32 }: { branding?: PortalBranding | null; name: string; size?: number }) {
  if (branding?.logo) {
    return <img src={branding.logo} alt="" width={size} height={size} className="rounded-[3px] object-contain shrink-0" style={{ width: size, height: size }} />;
  }
  const bg = branding?.color ?? DEFAULT_ACCENT;
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-[3px] font-semibold shrink-0"
      style={{ width: size, height: size, background: bg, color: textOn(bg), fontSize: size * 0.45 }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** The banner at the top of a help center: accent colour, logo, name and welcome message. */
export function PortalHero({ branding, title, subtitle, compact, children }: {
  branding?: PortalBranding | null;
  title: string;
  subtitle?: string | null;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const bg = branding?.color ?? DEFAULT_ACCENT;
  const fg = textOn(bg);
  const welcome = branding?.welcome ?? subtitle;
  return (
    <div style={{ background: bg, color: fg }} className={compact ? 'px-4 py-4' : 'rounded-[3px] px-5 py-6 sm:px-8 sm:py-8'}>
      <div className="flex items-center gap-3">
        <PortalLogo branding={branding} name={title} size={compact ? 32 : 48} />
        <h1 className={compact ? 'text-base font-semibold' : 'text-xl sm:text-2xl font-semibold'}>{title}</h1>
      </div>
      {welcome && <p className={`${compact ? 'text-xs mt-2' : 'mt-3 max-w-3xl'} whitespace-pre-line opacity-90`}>{welcome}</p>}
      {children}
    </div>
  );
}
