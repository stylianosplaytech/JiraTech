import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { SelectPicker } from './Pickers';
import Avatar from './Avatar';

interface UserPickerProps {
  value?: string;
  onChange: (userId: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  variant?: 'inline' | 'field';
  /** Adds an "Assign to me" shortcut. */
  currentUserId?: string;
}

export default function UserPicker({
  value, onChange, placeholder = 'Unassigned', allowClear = true, variant = 'field', currentUserId,
}: UserPickerProps) {
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.getUsers() });

  return (
    <SelectPicker
      variant={variant}
      value={value}
      onChange={(id) => onChange(id ?? undefined)}
      placeholder={placeholder}
      allowClear={allowClear}
      clearLabel={placeholder}
      options={(users ?? []).map((u) => ({
        id: u.id,
        label: u.name,
        hint: u.email,
        icon: <Avatar name={u.name} size="xs" />,
      }))}
      footer={currentUserId && currentUserId !== value
        ? (close) => (
          <button type="button" className="menu-item text-jira-blue" onClick={() => { onChange(currentUserId); close(); }}>
            Assign to me
          </button>
        )
        : undefined}
    />
  );
}
