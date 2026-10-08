import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AppNotification } from '../api';
import { timeAgo } from '../utils';
import Avatar from './Avatar';
import { TypeBadge } from './Badges';
import { BellIcon } from './Icons';
import { useDismiss } from './ui';

const POLL_MS = 30_000;

function sentence(n: AppNotification) {
  const who = n.actor?.name ?? 'Someone';
  switch (n.type) {
    case 'ASSIGNED': return <><b>{who}</b> assigned an issue to you</>;
    case 'MENTIONED': return <><b>{who}</b> mentioned you</>;
    case 'COMMENTED': return <><b>{who}</b> commented</>;
    case 'STATUS_CHANGED': return <><b>{who}</b> changed the status</>;
    case 'UPDATED': return <><b>{who}</b> updated {n.detail ? <span className="text-jira-subtle">{n.detail}</span> : 'an issue'}</>;
    case 'WATCHING': return <><b>{who}</b> added you as a watcher</>;
    case 'DELETED': return <><b>{who}</b> deleted an issue</>;
  }
}

/** Extra line under the sentence: comment excerpt or status change. */
function detailLine(n: AppNotification) {
  if (n.type === 'COMMENTED' || n.type === 'MENTIONED') return n.detail ? `“${n.detail}”` : null;
  if (n.type === 'STATUS_CHANGED') return n.detail;
  return null;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'direct' | 'all'>('direct');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  const { data: count } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: api.getUnreadCount,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list', tab, unreadOnly],
    queryFn: () => api.getNotifications(tab, unreadOnly, 40),
    enabled: open,
    refetchInterval: open ? POLL_MS : false,
  });
  const items = data?.items ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const toggleRead = useMutation({
    mutationFn: (n: AppNotification) => api.markNotificationRead(n.id, !n.readAt),
    onSuccess: refresh,
  });
  const readAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSuccess: refresh });

  const openItem = (n: AppNotification) => {
    if (!n.readAt) api.markNotificationRead(n.id).then(refresh);
    setOpen(false);
    if (n.issue) navigate(`/browse/${n.issue.key}`);
  };

  const unread = count?.unread ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`btn btn-icon relative ${open ? 'bg-jira-blue-light text-jira-blue' : 'btn-subtle'}`}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <BellIcon size={18} />
        {unread > 0 && (
          <span className="pointer-events-none absolute -top-1 -right-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-[#DE350B] text-white text-[10px] font-semibold leading-none tabular-nums ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="popover absolute right-0 top-full mt-2 w-[440px] py-0 overflow-hidden" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-lg font-medium">Notifications</h2>
            <label className="flex items-center gap-2 text-xs text-jira-subtle cursor-pointer select-none">
              Only show unread
              <button
                type="button"
                role="switch"
                aria-checked={unreadOnly}
                onClick={() => setUnreadOnly(!unreadOnly)}
                className={`relative w-8 h-4 rounded-full transition-colors ${unreadOnly ? 'bg-[#36B37E]' : 'bg-jira-border'}`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${unreadOnly ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
          <div className="flex items-center justify-between px-4 border-b border-jira-border">
            <div className="flex gap-4">
              {([['direct', 'Direct'], ['all', 'Watching']] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`relative pb-2 text-sm font-medium ${tab === k ? 'text-jira-blue after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-jira-blue' : 'text-jira-subtle hover:text-jira-navy'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-link btn-sm mb-1" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()}>
              Mark all as read
            </button>
          </div>

          <div className="max-h-[480px] overflow-y-auto">
            {isLoading && <p className="px-4 py-6 text-jira-muted">Loading…</p>}
            {!isLoading && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="font-medium">{unreadOnly ? 'You\'re all caught up' : 'No notifications yet'}</p>
                <p className="text-xs text-jira-muted mt-1">
                  {tab === 'direct'
                    ? 'You\'ll be notified here when someone assigns you an issue or @mentions you.'
                    : 'Updates to issues you report, are assigned or watch appear here.'}
                </p>
              </div>
            )}
            {items.map((n) => {
              const extra = detailLine(n);
              return (
                <div key={n.id} className={`group relative flex gap-3 px-4 py-3 border-b border-jira-border last:border-0 hover:bg-jira-gray ${n.readAt ? '' : 'bg-[#F4F8FF]'}`}>
                  <Avatar name={n.actor?.name ?? 'System'} size="md" />
                  <button type="button" onClick={() => openItem(n)} className="flex-1 min-w-0 text-left" disabled={!n.issue}>
                    <p className="text-sm leading-5">{sentence(n)}</p>
                    <p className="flex items-center gap-1.5 mt-1 text-sm">
                      {n.issue && <TypeBadge type={n.issue.type} />}
                      <span className={`shrink-0 ${n.issue ? 'text-jira-blue' : 'text-jira-muted line-through'}`}>{n.issueKey}</span>
                      <span className="truncate text-jira-navy">{n.issueSummary}</span>
                    </p>
                    {extra && <p className="mt-1 text-xs text-jira-subtle line-clamp-2">{extra}</p>}
                    <p className="mt-1 text-xs text-jira-muted">{timeAgo(n.createdAt)}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleRead.mutate(n)}
                    className="self-start mt-1 p-1 rounded-full hover:bg-jira-gray-hover"
                    title={n.readAt ? 'Mark as unread' : 'Mark as read'}
                    aria-label={n.readAt ? 'Mark as unread' : 'Mark as read'}
                  >
                    <span className={`block w-2.5 h-2.5 rounded-full ${n.readAt ? 'border-2 border-jira-border opacity-0 group-hover:opacity-100' : 'bg-jira-blue'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
