import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NotificationScheme } from '../api';
import NotificationSchemeEditor, { sameScheme } from '../components/NotificationSchemeEditor';
import { EmptyState, PageHeader, Spinner, errorMessage, useDialogs, useToast } from '../components/ui';

/** /settings/notifications — who is emailed about issue events, in every project without its own scheme (global admins). */
export default function NotificationSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const { data: me, isLoading: loadingMe } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isAdmin = me?.role === 'ADMIN';
  const { data, isLoading } = useQuery({ queryKey: ['notification-scheme'], queryFn: api.getNotificationScheme, enabled: isAdmin });
  const [draft, setDraft] = useState<NotificationScheme | null>(null);
  useEffect(() => { if (data) setDraft(data.scheme); }, [data]);

  const save = useMutation({
    mutationFn: (scheme: NotificationScheme | null) => api.saveNotificationScheme(scheme),
    onSuccess: (saved, scheme) => {
      queryClient.setQueryData(['notification-scheme'], saved);
      queryClient.invalidateQueries({ queryKey: ['project-notification-scheme'] });
      toast(scheme ? 'Notification settings saved' : 'Notification settings reset to the defaults');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (loadingMe || (isAdmin && isLoading)) return <Spinner />;
  if (!isAdmin) return <EmptyState title="Only administrators can manage notification settings" />;
  if (!data || !draft) return <Spinner />;

  const dirty = !sameScheme(draft, data.scheme);
  const atDefaults = sameScheme(draft, data.defaults);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Email notifications" />
      <p className="text-jira-subtle mb-4 max-w-3xl">
        Choose who gets an email when something happens to an issue. This applies to every project, except projects whose
        administrators set their own on the project page. How emails are sent is set in{' '}
        <Link to="/settings/email" className="link">Email settings</Link>.
      </p>
      <form
        className="card p-4"
        onSubmit={(e) => { e.preventDefault(); save.mutate(draft); }}
      >
        <NotificationSchemeEditor value={draft} onChange={setDraft} />
        <div className="flex items-center gap-2 mt-4">
          <button type="submit" className="btn btn-primary" disabled={!dirty || save.isPending}>Save</button>
          {dirty && <button type="button" className="btn btn-subtle" onClick={() => setDraft(data.scheme)}>Discard changes</button>}
          <span className="flex-1" />
          {!data.isDefault && (
            <button
              type="button"
              className="btn btn-subtle"
              disabled={save.isPending}
              onClick={async () => {
                if (await confirm({
                  title: 'Reset to the defaults?',
                  message: 'Reporters, assignees and watchers are emailed about every change, and people about being mentioned or added as a watcher.',
                  confirmLabel: 'Reset',
                })) save.mutate(null);
              }}
            >
              Reset to defaults
            </button>
          )}
          {data.isDefault && !dirty && atDefaults && <span className="text-xs text-jira-muted">Using the defaults</span>}
        </div>
      </form>
    </div>
  );
}
