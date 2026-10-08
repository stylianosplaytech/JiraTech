import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Issue } from '../api';
import UserPicker from './UserPicker';

interface PeopleSectionProps {
  issue: Issue;
  currentUserId?: string;
}

export default function PeopleSection({ issue, currentUserId }: PeopleSectionProps) {
  const queryClient = useQueryClient();
  const isWatching = issue.watchers?.some((w) => w.userId === currentUserId);

  const updatePeople = useMutation({
    mutationFn: (data: { assigneeId?: string; reporterId?: string }) =>
      api.updateIssue(issue.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue', issue.id] }),
  });

  const watch = useMutation({
    mutationFn: () => api.addWatcher(issue.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue', issue.id] }),
  });

  const unwatch = useMutation({
    mutationFn: () => api.removeWatcher(issue.id, currentUserId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue', issue.id] }),
  });

  const removeWatcher = useMutation({
    mutationFn: (userId: string) => api.removeWatcher(issue.id, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue', issue.id] }),
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.getUsers(),
  });

  const watcherUserIds = new Set(issue.watchers?.map((w) => w.userId) ?? []);
  const availableWatchers = users?.filter((u) => !watcherUserIds.has(u.id)) ?? [];

  return (
    <div className="bg-white rounded-lg border border-jira-border p-4 space-y-4">
      <h3 className="text-sm font-medium text-gray-700">People</h3>

      <div>
        <span className="text-xs text-gray-500 block mb-1">Assignee</span>
        <UserPicker
          value={issue.assignee?.id}
          onChange={(assigneeId) => updatePeople.mutate({ assigneeId })}
          placeholder="Unassigned"
        />
      </div>

      <div>
        <span className="text-xs text-gray-500 block mb-1">Reporter</span>
        <UserPicker
          value={issue.reporter?.id}
          onChange={(reporterId) => reporterId && updatePeople.mutate({ reporterId })}
          placeholder="No reporter"
          allowClear={false}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500">
            Watchers ({issue.watchers?.length ?? 0})
          </span>
          {currentUserId && (
            <button
              type="button"
              onClick={() => (isWatching ? unwatch.mutate() : watch.mutate())}
              className="text-xs text-jira-blue hover:underline"
            >
              {isWatching ? 'Stop watching' : 'Start watching'}
            </button>
          )}
        </div>
        <ul className="space-y-1">
          {issue.watchers?.map((w) => (
            <li key={w.userId} className="flex items-center justify-between text-sm">
              <span>{w.user.name}</span>
              <button
                type="button"
                onClick={() => removeWatcher.mutate(w.userId)}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {availableWatchers.length > 0 && (
          <select
            className="mt-2 w-full border border-jira-border rounded px-2 py-1 text-xs"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                api.addWatcher(issue.id, e.target.value).then(() => {
                  queryClient.invalidateQueries({ queryKey: ['issue', issue.id] });
                  e.target.value = '';
                });
              }
            }}
          >
            <option value="">Add watcher...</option>
            {availableWatchers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
