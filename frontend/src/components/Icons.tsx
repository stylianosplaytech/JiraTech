import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

export const PlusIcon = (p: IconProps) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const SearchIcon = (p: IconProps) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const ChevronDownIcon = (p: IconProps) => <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>;
export const ChevronRightIcon = (p: IconProps) => <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>;
export const XIcon = (p: IconProps) => <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const CheckIcon = (p: IconProps) => <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>;
export const MoreIcon = (p: IconProps) => <svg {...base(p)}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></svg>;
export const LinkIcon = (p: IconProps) => <svg {...base(p)}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>;
export const PaperclipIcon = (p: IconProps) => <svg {...base(p)}><path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" /></svg>;
export const TrashIcon = (p: IconProps) => <svg {...base(p)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>;
export const EditIcon = (p: IconProps) => <svg {...base(p)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
export const EyeIcon = (p: IconProps) => <svg {...base(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
export const ClockIcon = (p: IconProps) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
export const SubtaskIcon = (p: IconProps) => <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M6.5 10v4.5a2 2 0 0 0 2 2H14" /></svg>;
export const CopyIcon = (p: IconProps) => <svg {...base(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
export const DownloadIcon = (p: IconProps) => <svg {...base(p)}><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" /></svg>;
export const FilterIcon = (p: IconProps) => <svg {...base(p)}><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></svg>;
export const StarIcon = (p: IconProps) => <svg {...base(p)}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9Z" /></svg>;
export const LogoutIcon = (p: IconProps) => <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
export const AlertIcon = (p: IconProps) => <svg {...base(p)}><path d="M12 9v4m0 4h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>;
export const BoardIcon = (p: IconProps) => <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v12" /></svg>;
export const ListIcon = (p: IconProps) => <svg {...base(p)}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>;
export const FolderIcon = (p: IconProps) => <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>;
export const ChartIcon = (p: IconProps) => <svg {...base(p)}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>;
export const CalendarIcon = (p: IconProps) => <svg {...base(p)}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
export const UsersIcon = (p: IconProps) => <svg {...base(p)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>;
export const BellIcon = (p: IconProps) => <svg {...base(p)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>;
export const MessageIcon =(p: IconProps) => <svg {...base(p)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>;

// ─── Issue type icons (16px rounded squares, Jira-style) ─────────────────────

const TYPE_STYLE: Record<string, { bg: string; glyph: 'bookmark' | 'bug' | 'check' | 'bolt' | 'sub' | 'flag' | 'code' | 'doc' | 'rocket' | 'test' | 'gear' | 'search' }> = {
  EPIC: { bg: '#6554C0', glyph: 'bolt' },
  FEATURE_EPIC: { bg: '#6554C0', glyph: 'bolt' },
  BAU_EPIC: { bg: '#8777D9', glyph: 'bolt' },
  RELEASE_EPIC: { bg: '#5243AA', glyph: 'flag' },
  STORY: { bg: '#36B37E', glyph: 'bookmark' },
  DEFECT: { bg: '#E5493A', glyph: 'bug' },
  BUG_FIX: { bg: '#E5493A', glyph: 'bug' },
  TASK: { bg: '#4BADE8', glyph: 'check' },
  RELEASE_CANDIDATE: { bg: '#00A3BF', glyph: 'flag' },
  SUB_TASK: { bg: '#4BADE8', glyph: 'sub' },
  ANALYSIS: { bg: '#2684FF', glyph: 'search' },
  CODE: { bg: '#00875A', glyph: 'code' },
  CODE_REVIEW: { bg: '#00875A', glyph: 'code' },
  ARCH_REVIEW: { bg: '#00875A', glyph: 'code' },
  CODE_MERGE: { bg: '#00875A', glyph: 'code' },
  DOCUMENTATION: { bg: '#6B778C', glyph: 'doc' },
  TEST_CASE: { bg: '#FF991F', glyph: 'test' },
  TEST_RUN: { bg: '#FF991F', glyph: 'test' },
  DEPLOYMENT: { bg: '#FF5630', glyph: 'rocket' },
  CONFIGURATION: { bg: '#505F79', glyph: 'gear' },
};

const GLYPHS: Record<string, JSX.Element> = {
  bookmark: <path d="M5 3.5h6v9L8 10.5l-3 2Z" fill="white" />,
  bug: <><circle cx="8" cy="8" r="3.3" fill="white" /></>,
  check: <path d="m4.5 8.2 2.3 2.3 4.7-4.8" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  bolt: <path d="M9 2.5 4.5 9h3l-.5 4.5L11.5 7h-3Z" fill="white" />,
  sub: <><rect x="3.5" y="3.5" width="4.5" height="4.5" rx=".5" fill="none" stroke="white" strokeWidth="1.3" /><rect x="8" y="8" width="4.5" height="4.5" rx=".5" fill="white" /></>,
  flag: <path d="M5 13V3.5h6l-1.5 2.5L11 8.5H6" stroke="white" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  code: <path d="M6 5 3.5 8 6 11M10 5l2.5 3L10 11" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  doc: <path d="M5 3.5h4l2 2v7H5ZM6.5 8h3M6.5 10.5h3" stroke="white" strokeWidth="1.2" fill="none" />,
  rocket: <path d="M8 3c2 1.5 2.5 4 2 7H6c-.5-3 0-5.5 2-7ZM6 10l-1.5 2.5M10 10l1.5 2.5" stroke="white" strokeWidth="1.3" fill="none" strokeLinejoin="round" />,
  test: <path d="M6.5 3.5v4L4 12.5h8l-2.5-5v-4M5.5 3.5h5" stroke="white" strokeWidth="1.3" fill="none" strokeLinejoin="round" />,
  gear: <><circle cx="8" cy="8" r="2" fill="none" stroke="white" strokeWidth="1.4" /><path d="M8 3.5v1.5M8 11v1.5M3.5 8H5M11 8h1.5" stroke="white" strokeWidth="1.4" /></>,
  search: <><circle cx="7.3" cy="7.3" r="2.6" fill="none" stroke="white" strokeWidth="1.5" /><path d="m9.3 9.3 2.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></>,
};

export function IssueTypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const style = TYPE_STYLE[type] ?? { bg: '#6B778C', glyph: 'check' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" role="img" aria-label={type.replace(/_/g, ' ').toLowerCase()}>
      <title>{type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</title>
      <rect width="16" height="16" rx="3" fill={style.bg} />
      {GLYPHS[style.glyph]}
    </svg>
  );
}

// ─── Priority icons ──────────────────────────────────────────────────────────

const PRIORITY: Record<string, { color: string; path: string }> = {
  HIGHEST: { color: '#CD1317', path: 'M3 9.5 8 5l5 4.5M3 13 8 8.5l5 4.5' },
  HIGH: { color: '#E9494A', path: 'M3 10.5 8 6l5 4.5' },
  MEDIUM: { color: '#E97F33', path: 'M3 6.5h10M3 10h10' },
  LOW: { color: '#2D8738', path: 'M3 5.5 8 10l5-4.5' },
  LOWEST: { color: '#57A55A', path: 'M3 3 8 7.5 13 3M3 6.5 8 11l5-4.5' },
};

export function PriorityGlyph({ priority, size = 16 }: { priority: string; size?: number }) {
  const p = PRIORITY[priority] ?? PRIORITY.MEDIUM;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" role="img" aria-label={`${priority.toLowerCase()} priority`}>
      <title>{priority.charAt(0) + priority.slice(1).toLowerCase()}</title>
      <path d={p.path} stroke={p.color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
