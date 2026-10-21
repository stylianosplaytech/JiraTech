import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NotificationScheme } from '../api';
import NotificationSchemeEditor, { sameScheme } from './NotificationSchemeEditor';
import { errorMessage, useDialogs, useToast } from './ui';

/** "Email notifications" section of the project page: the global scheme, or the project's own (project admins). */
export default function ProjectNotifications({ projectKey, canAdmin }: { projectKey: string; canAdmin: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [draft, setDraft] = useState<NotificationScheme | null>(null);
  const { data } = useQuery({
    queryKey: ['project-notification-scheme', projectKey],
    queryFn: () => api.getProjectNotificationScheme(projectKey),
  });

  const save = useMutation({
    mutationFn: (scheme: NotificationScheme | null) => api.saveProjectNotificationScheme(projectKey, scheme),
    onSuccess: (saved, scheme) => {
      queryClient.setQueryData(['project-notification-scheme', projectKey], saved);
      setDraft(null);
      toast(scheme ? 'Notification settings saved' : 'This project now uses the global notification settings');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!data) return null;
  const editing = draft !== null;

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold">Email notifications</h2>
        {canAdmin && !editing && (
          <div className="flex gap-2">
            {!data.inherited && (
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={save.isPending}
                onClick={async () => {
                  if (await confirm({
                    title: 'Use the global notification settings?',
                    message: "This project's own settings are deleted, and it follows the settings administrators choose for every project.",
                    confirmLabel: 'Use global settings',
                  })) save.mutate(null);
                }}
              >
                Use global settings
              </button>
            )}
            <button type="button" className="btn btn-default btn-sm" onClick={() => setDraft(data.scheme)}>
              {data.inherited ? 'Customize' : 'Edit'}
            </button>
          </div>
        )}
      </div>
      <p className="text-jira-subtle mb-4">
        {data.inherited
          ? 'Who gets an email when something happens to an issue. This project uses the global settings.'
          : 'Who gets an email when something happens to an issue. This project has its own settings.'}
      </p>
      {editing ? (
        <form className="card p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(draft); }}>
          <NotificationSchemeEditor value={draft} onChange={setDraft} />
          <div className="flex items-center gap-2 mt-4">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={save.isPending || (!data.inherited && sameScheme(draft, data.scheme))}
            >
              Save
            </button>
            <button type="button" className="btn btn-subtle" onClick={() => setDraft(null)}>Cancel</button>
            {!sameScheme(draft, data.global) && (
              <button type="button" className="btn btn-subtle ml-auto" onClick={() => setDraft(data.global)}>Start from the global settings</button>
            )}
          </div>
        </form>
      ) : (
        <div className="card p-4"><NotificationSchemeEditor value={data.scheme} /></div>
      )}
    </section>
  );
}
