import { useQuery } from '@tanstack/react-query';
import { api, type AdminScope } from './api';

/** What the signed-in user may set up webhooks and automation for: every project (global admins) or the ones they administer. */
export function useAdminScope() {
  return useQuery({ queryKey: ['admin-scope'], queryFn: api.getAdminScope, staleTime: 60_000 });
}

/** Whether there is anything the user may manage at all. */
export const canManageAny = (scope?: AdminScope) => !!scope && (scope.global || scope.projects.length > 0);

/** The project a new webhook or rule starts in: none (all projects) for global admins, else the first they administer. */
export const defaultProjectKey = (scope?: AdminScope) => (scope && !scope.global ? scope.projects[0]?.key ?? '' : '');
