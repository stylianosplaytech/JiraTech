import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomerPortal } from '../api';
import { SelectPicker } from './Pickers';
import { XIcon } from './Icons';
import { Spinner, errorMessage, useToast } from './ui';

/** How the customer reaches a portal, e.g. "Through Globex" or "Open to any customer". */
function reach(p: CustomerPortal) {
  const ways = [
    ...(p.viaOrganizations.length ? [`Through ${p.viaOrganizations.map((o) => o.name).join(', ')}`] : []),
    ...(p.direct ? ['Added individually'] : []),
    ...(p.open ? ['Open to any customer'] : []),
  ];
  return ways.join(' · ');
}

/** The portals one customer can use (People page, global admins): remove them from one, or add them to another. */
export default function CustomerPortals({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['customer-portals', userId];
  const { data: portals, isLoading } = useQuery({ queryKey: key, queryFn: () => api.getCustomerPortals(userId) });

  const done = (list: CustomerPortal[]) => {
    queryClient.setQueryData(key, list);
    queryClient.invalidateQueries({ queryKey: ['portals'] });
    queryClient.invalidateQueries({ queryKey: ['desk-customers'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'error');
  const allow = useMutation({ mutationFn: (portalId: string) => api.allowCustomerPortal(userId, portalId), onSuccess: done, onError });
  const remove = useMutation({ mutationFn: (portalId: string) => api.removeCustomerPortal(userId, portalId), onSuccess: done, onError });
  const busy = allow.isPending || remove.isPending;

  if (isLoading || !portals) return <Spinner />;
  const usable = portals.filter((p) => p.canUse);
  const removed = portals.filter((p) => p.excluded);
  const others = portals.filter((p) => !p.canUse && !p.excluded);

  return (
    <div>
      <span className="field-label">Portals</span>
      {portals.length === 0 && <p className="text-jira-muted text-sm">No service desk has a portal yet.</p>}
      {portals.length > 0 && usable.length === 0 && <p className="text-jira-muted text-sm">None: they can't raise requests anywhere.</p>}
      {usable.map((p) => (
        <div key={p.id} className="flex items-center gap-2 py-1">
          <span className="flex-1 min-w-0">
            <span className="block truncate">{p.name} <span className="text-jira-muted text-xs">{p.project.key}</span></span>
            <span className="block text-jira-muted text-xs truncate">{reach(p)}</span>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => remove.mutate(p.id)}
            className="btn btn-subtle btn-sm text-jira-muted hover:text-jira-navy"
            aria-label={`Remove from ${p.name}`}
            title={p.open || p.viaOrganizations.length ? 'Keep them off this portal, even though it is open or serves their organization' : 'Remove from this portal'}
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
      {removed.length > 0 && (
        <>
          <div className="text-xs font-semibold text-jira-muted mt-3 mb-1">Removed</div>
          {removed.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1">
              <span className="flex-1 min-w-0">
                <span className="block truncate text-jira-subtle line-through">{p.name} <span className="text-xs">{p.project.key}</span></span>
                <span className="block text-jira-muted text-xs truncate">Kept off it although it's {p.viaOrganizations.length ? `used by ${p.viaOrganizations.map((o) => o.name).join(', ')}` : 'open to any customer'}</span>
              </span>
              <button type="button" disabled={busy} onClick={() => allow.mutate(p.id)} className="btn btn-subtle btn-sm">Restore</button>
            </div>
          ))}
        </>
      )}
      {others.length > 0 && (
        <div className="mt-2">
          <SelectPicker
            value={undefined}
            onChange={(id) => id && allow.mutate(id)}
            placeholder="+ Add to portal"
            options={others.map((p) => ({ id: p.id, label: p.name, hint: p.project.name }))}
          />
        </div>
      )}
      <span className="field-help">Changes apply straight away. Organization membership is managed on the Organizations tab.</span>
    </div>
  );
}
