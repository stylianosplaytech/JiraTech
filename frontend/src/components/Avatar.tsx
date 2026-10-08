import { initials } from '../utils';

const COLORS = ['bg-blue-600', 'bg-teal-600', 'bg-purple-600', 'bg-amber-600', 'bg-rose-600', 'bg-emerald-600'];

export default function Avatar({ name, size = 'sm' }: { name: string; size?: 'xs' | 'sm' | 'md' }) {
  const color = COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];
  const dims = size === 'xs' ? 'w-5 h-5 text-[9px]' : size === 'md' ? 'w-8 h-8 text-xs' : 'w-6 h-6 text-[10px]';
  return (
    <span
      className={`${dims} ${color} inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0`}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
