import { useQuery } from '@tanstack/react-query';
import { api, User } from '../api';

interface UserPickerProps {
  value?: string;
  onChange: (userId: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
}

export default function UserPicker({ value, onChange, placeholder = 'Unassigned', allowClear = true }: UserPickerProps) {
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.getUsers(),
  });

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="w-full border border-jira-border rounded px-2 py-1 text-sm"
    >
      {allowClear && <option value="">{placeholder}</option>}
      {users?.map((u: User) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );
}
