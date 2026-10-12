import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Issue } from '../api';
import { SlaRow } from './SlaBadge';
import { SelectPicker } from './Pickers';
import Avatar from './Avatar';
import { XIcon } from './Icons';
import { errorMessage, useToast } from './ui';

/** Service desk side panel on an issue: request type, customer, SLAs and the customers it's shared with. */
export default function RequestPanel({ issue, canEdit }: { issue: Issue; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: info } = useQuery({
    queryKey: ['request-info', issue.id, issue.workflowStatus?.id, issue.priority, issue.updatedAt],
    queryFn: () => api.getRequestInfo(issue.id),
    refetchInterval: 60_000,
  });
  const { data: customers = [] } = useQuery({ queryKey: ['users', 'customers'], queryFn: () => api.getUsers(undefined, 'customers') });

  const customerIds = new Set(customers.map((c) => c.id));
  const participants = (issue.watchers ?? []).filter((w) => customerIds.has(w.userId) && w.userId !== issue.reporter?.id);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['issue'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const add = useMutation({ mutationFn: (userId: string) => api.addWatcher(issue.id, userId), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (userId: string) => api.removeWatcher(issue.id, userId), onSuccess: refresh, onError });

  const reporterIsCustomer = !!issue.reporter && customerIds.has(issue.reporter.id);
  const shared = new Set([issue.reporter?.id, ...participants.map((p) => p.userId)]);

  return (
    <div className="card mb-4">
      <div className="card-header">
        <h2 className="card-title">Service request</h2>
        <Link to={`/portal/requests/${issue.key}`} className="btn btn-link btn-sm">View in help center</Link>
      </div>
      <div className="px-4 py-2 divide-y divide-jira-border">
        <div className="py-1.5 grid grid-cols-[120px_1fr] gap-2 text-[13px]">
          <span className="text-jira-subtle font-medium">Request type</span>
          <span>{issue.requestType?.name ?? <span className="text-jira-muted">None (raised outside the portal)</span>}</span>
          <span className="text-jira-subtle font-medium">Customer</span>
          <span className="flex items-center gap-2 min-w-0">
            {issue.reporter ? <><Avatar name={issue.reporter.name} size="xs" /><span className="truncate">{issue.reporter.name}</span></> : '—'}
            {issue.reporter && !reporterIsCustomer && <span className="lozenge bg-jira-gray-hover text-[#42526E]">Staff</span>}
          </span>
        </div>
        <div className="py-1">
          <SlaRow label="Time to first response" clock={info?.sla?.firstResponse} />
          <SlaRow label="Time to resolution" clock={info?.sla?.resolution} />
        </div>
        <div className="py-2">
          <div className="text-[13px] font-medium text-jira-subtle mb-1">Shared with</div>
          {participants.length === 0 && <p className="text-xs text-jira-muted mb-1">Only the customer who raised it.</p>}
          {participants.map((p) => (
            <div key={p.userId} className="group flex items-center gap-2 py-1">
              <Avatar name={p.user.name} size="xs" />
              <span className="flex-1 truncate">{p.user.name}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove.mutate(p.userId)}
                  className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-jira-muted hover:text-jira-navy"
                  aria-label={`Stop sharing with ${p.user.name}`}
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <SelectPicker
              value={undefined}
              onChange={(id) => id && add.mutate(id)}
              placeholder="+ Share with a customer"
              options={customers.filter((c) => !shared.has(c.id)).map((c) => ({ id: c.id, label: c.name, hint: c.email, icon: <Avatar name={c.name} size="xs" /> }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
