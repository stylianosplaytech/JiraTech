import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomFieldDefinition, type Issue } from '../api';
import { InlineText } from './InlineEdit';
import { SelectPicker } from './Pickers';
import { errorMessage, useToast } from './ui';

function parseOptions(options?: string): string[] {
  if (!options) return [];
  try {
    return JSON.parse(options) as string[];
  } catch {
    return [];
  }
}

/** Custom fields rendered as rows of the issue's Details panel. Text and numbers save on Enter, not per keystroke. */
export default function CustomFieldRows({ issue, Row, readOnly }: {
  issue: Issue;
  readOnly?: boolean;
  Row: (props: { label: string; children: React.ReactNode }) => JSX.Element;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: definitions } = useQuery({ queryKey: ['custom-fields'], queryFn: () => api.getCustomFieldDefinitions() });
  const { data: versions } = useQuery({ queryKey: ['versions'], queryFn: () => api.getVersions() });

  const updateField = useMutation({
    mutationFn: (customFields: Record<string, string>) => api.updateCustomFields(issue.id, customFields),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!definitions?.length) return null;

  const valueMap = new Map(issue.customFieldValues?.map((v) => [v.field.key, v.value]) ?? []);
  const save = (key: string, value: string) => updateField.mutate({ [key]: value });

  const render = (def: CustomFieldDefinition) => {
    const current = valueMap.get(def.key) ?? '';
    if (def.key === 'reopen_count') {
      return <span className="px-2">{current || '0'}</span>;
    }
    if (def.type === 'SELECT' || def.type === 'VERSION') {
      const options = def.type === 'SELECT'
        ? parseOptions(def.options).map((o) => ({ id: o, label: o }))
        : (versions ?? []).map((v) => ({ id: v.id, label: v.name }));
      return (
        <SelectPicker
          disabled={readOnly}
          value={current || null}
          onChange={(id) => save(def.key, id ?? '')}
          options={options}
          allowClear
        />
      );
    }
    return (
      <InlineText
        readOnly={readOnly}
        value={current}
        type={def.type === 'NUMBER' ? 'number' : 'text'}
        onSave={(v) => save(def.key, v)}
        className="mx-0"
      />
    );
  };

  return (
    <>
      {definitions.map((def) => (
        <Row key={def.id} label={def.name}>{render(def)}</Row>
      ))}
    </>
  );
}
