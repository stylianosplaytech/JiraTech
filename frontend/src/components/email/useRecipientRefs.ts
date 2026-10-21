import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import type { RecipientRef } from './recipients';

/** Recipient groups and organizations, to pick as a whole in To, Cc or Bcc. */
export function useRecipientRefs() {
  const { data: organizations = [] } = useQuery({ queryKey: ['organizations'], queryFn: api.getOrganizations });
  const { data: groups = [] } = useQuery({ queryKey: ['recipient-groups'], queryFn: api.getRecipientGroups });
  return useMemo<RecipientRef[]>(() => [
    ...groups.map((g) => ({ type: 'group' as const, id: g.id, name: g.name, recipients: g.recipients })),
    ...organizations.map((o) => ({ type: 'organization' as const, id: o.id, name: o.name, recipients: o.members.map((m) => ({ email: m.user.email, name: m.user.name })) })),
  ], [groups, organizations]);
}
