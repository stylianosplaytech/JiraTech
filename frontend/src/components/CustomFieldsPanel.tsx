import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CustomFieldDefinition, Issue, Version } from '../api';

interface CustomFieldsPanelProps {
  issue: Issue;
  editable?: boolean;
}

function parseOptions(options?: string): string[] {
  if (!options) return [];
  try {
    return JSON.parse(options) as string[];
  } catch {
    return [];
  }
}

export default function CustomFieldsPanel({ issue, editable = true }: CustomFieldsPanelProps) {
  const queryClient = useQueryClient();
  const { data: definitions } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: () => api.getCustomFieldDefinitions(),
  });
  const { data: versions } = useQuery({
    queryKey: ['versions'],
    queryFn: () => api.getVersions(),
  });

  const updateField = useMutation({
    mutationFn: (customFields: Record<string, string>) =>
      api.updateCustomFields(issue.id, customFields),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue', issue.id] }),
  });

  if (!definitions?.length) return null;

  const valueMap = new Map(
    issue.customFieldValues?.map((v) => [v.field.key, v.value]) ?? [],
  );

  const versionName = (id: string) =>
    versions?.find((v: Version) => v.id === id)?.name ?? id;

  const handleChange = (key: string, value: string) => {
    updateField.mutate({ [key]: value });
  };

  const renderField = (def: CustomFieldDefinition) => {
    const current = valueMap.get(def.key) ?? '';

    if (!editable || def.key === 'reopen_count') {
      let display = current || 'None';
      if (def.type === 'VERSION' && current) display = versionName(current);
      return <span className="text-sm">{display}</span>;
    }

    if (def.type === 'SELECT') {
      const opts = parseOptions(def.options);
      return (
        <select
          value={current}
          onChange={(e) => handleChange(def.key, e.target.value)}
          className="w-full border border-jira-border rounded px-2 py-1 text-sm"
        >
          <option value="">None</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }

    if (def.type === 'VERSION') {
      return (
        <select
          value={current}
          onChange={(e) => handleChange(def.key, e.target.value)}
          className="w-full border border-jira-border rounded px-2 py-1 text-sm"
        >
          <option value="">None</option>
          {versions?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      );
    }

    if (def.type === 'NUMBER') {
      return (
        <input
          type="number"
          value={current}
          onChange={(e) => handleChange(def.key, e.target.value)}
          className="w-full border border-jira-border rounded px-2 py-1 text-sm"
        />
      );
    }

    return (
      <input
        type="text"
        value={current}
        onChange={(e) => handleChange(def.key, e.target.value)}
        className="w-full border border-jira-border rounded px-2 py-1 text-sm"
      />
    );
  };

  return (
    <div className="bg-white rounded-lg border border-jira-border p-4 space-y-3">
      <h3 className="text-sm font-medium text-gray-500">Custom Fields</h3>
      {definitions.map((def) => (
        <div key={def.id} className="grid grid-cols-2 gap-2 items-center">
          <span className="text-sm text-gray-500">{def.name}</span>
          {renderField(def)}
        </div>
      ))}
    </div>
  );
}
