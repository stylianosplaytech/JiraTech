const API = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    let message = res.statusText;
    try {
      const err = JSON.parse(text) as { message?: string };
      message = err.message ?? message;
    } catch {
      if (res.status >= 500) {
        message = 'Cannot reach the API server. Make sure the backend is running (port 3000).';
      } else if (text) {
        message = text;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>('/auth/me'),
  getUsers: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return request<User[]>(`/users${qs}`);
  },
  createUser: (data: { email: string; name: string; password: string; role: string }) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: { email?: string; name?: string; password?: string; role?: string }) =>
    request<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getIssues: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Issue[]>(`/issues${qs}`);
  },
  getIssue: (id: string) => request<Issue>(`/issues/${id}`),
  createIssue: (data: CreateIssuePayload) =>
    request<Issue>('/issues', { method: 'POST', body: JSON.stringify(data) }),
  updateIssue: (id: string, data: UpdateIssuePayload) =>
    request<Issue>(`/issues/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  transitionIssue: (id: string, status: string, resolution?: string) =>
    request<Issue>(`/issues/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ status, resolution }),
    }),
  createLink: (id: string, targetId: string, type: string) =>
    request(`/issues/${id}/links`, {
      method: 'POST',
      body: JSON.stringify({ targetId, type }),
    }),
  addWatcher: (id: string, userId?: string) =>
    request<Issue>(`/issues/${id}/watchers`, {
      method: 'POST',
      body: JSON.stringify(userId ? { userId } : {}),
    }),
  removeWatcher: (id: string, userId: string) =>
    request<Issue>(`/issues/${id}/watchers/${userId}`, { method: 'DELETE' }),
  getWorkLogs: (id: string) => request<WorkLog[]>(`/issues/${id}/worklogs`),
  createWorkLog: (id: string, timeSpentMinutes: number, comment?: string) =>
    request<Issue>(`/issues/${id}/worklogs`, {
      method: 'POST',
      body: JSON.stringify({ timeSpentMinutes, comment }),
    }),
  updateCustomFields: (id: string, customFields: Record<string, string>) =>
    request<Issue>(`/issues/${id}/custom-fields`, {
      method: 'PATCH',
      body: JSON.stringify({ customFields }),
    }),
  uploadAttachment: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Attachment>(`/issues/${id}/attachments`, { method: 'POST', body: form });
  },
  getAttachmentUrl: (issueId: string, attachmentId: string) =>
    `${API}/issues/${issueId}/attachments/${attachmentId}`,
  getLabels: () => request<Label[]>('/labels'),
  createLabel: (name: string) =>
    request<Label>('/labels', { method: 'POST', body: JSON.stringify({ name }) }),
  getVersions: () => request<Version[]>('/versions'),
  getCustomFieldDefinitions: () => request<CustomFieldDefinition[]>('/custom-fields'),
  getBoard: (sprintId?: string) => {
    const qs = sprintId ? `?sprintId=${sprintId}` : '';
    return request<BoardData>(`/board${qs}`);
  },
  getComponents: (type?: string) => {
    const qs = type ? `?type=${type}` : '';
    return request<Component[]>(`/components${qs}`);
  },
  getPis: () => request<ProgramIncrement[]>('/planning/pis'),
  getDashboard: (piId?: string) => {
    const qs = piId ? `?piId=${piId}` : '';
    return request<DashboardData>(`/dashboard${qs}`);
  },
  updateRag: (id: string, ragStatus: string) =>
    request(`/dashboard/issues/${id}/rag`, {
      method: 'PATCH',
      body: JSON.stringify({ ragStatus }),
    }),
  escalate: (id: string, action: string, toTeam?: string, note?: string) =>
    request(`/incidents/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ action, toTeam, note }),
    }),
  runSchedule: (piId: string, teamCapacity?: Record<string, number>) =>
    request<ScheduleResult>('/scheduling/run', {
      method: 'POST',
      body: JSON.stringify({ piId, teamCapacity }),
    }),
  getReleaseCandidates: (epicId: string) =>
    request<Issue[]>(`/releases/${epicId}/candidates`),
  getReleaseNotes: (epicId: string) =>
    request<ReleaseNotes>(`/releases/${epicId}/notes`),
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface Component {
  id: string;
  name: string;
  type: string;
  lead?: { id: string; name: string };
}

export interface Label {
  id: string;
  name: string;
}

export interface Version {
  id: string;
  name: string;
  released?: boolean;
}

export interface CustomFieldDefinition {
  id: string;
  key: string;
  name: string;
  type: string;
  options?: string;
  required: boolean;
  order: number;
}

export interface CustomFieldValue {
  issueId: string;
  fieldId: string;
  value: string;
  field: CustomFieldDefinition;
}

export interface IssueWatcher {
  issueId: string;
  userId: string;
  user: { id: string; name: string; email: string };
}

export interface IssueVersion {
  issueId: string;
  versionId: string;
  isFix: boolean;
  version: Version;
}

export interface IssueLink {
  id: string;
  type: string;
  target?: { id: string; key: string; summary: string; type: string };
  source?: { id: string; key: string; summary: string; type: string };
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

export interface WorkLog {
  id: string;
  timeSpentMinutes: number;
  comment?: string;
  createdAt: string;
  user: { id: string; name: string };
}

export interface Issue {
  id: string;
  key: string;
  type: string;
  summary: string;
  description?: string;
  status: string;
  resolution?: string;
  priority: string;
  epicName?: string;
  blocked?: boolean;
  ragStatus?: string;
  estimate?: number;
  remainingEstimate?: number;
  createdAt?: string;
  updatedAt?: string;
  assignee?: { id: string; name: string; email?: string };
  reporter?: { id: string; name: string; email?: string };
  parent?: { id: string; key: string; summary: string; type?: string; epicName?: string };
  children?: Issue[];
  components?: { component: Component }[];
  labels?: { label: Label }[];
  versions?: IssueVersion[];
  customFieldValues?: CustomFieldValue[];
  watchers?: IssueWatcher[];
  attachments?: Attachment[];
  workLogs?: WorkLog[];
  linksFrom?: IssueLink[];
  linksTo?: IssueLink[];
  sprint?: { id: string; name: string };
  pi?: { id: string; name: string };
  scheduledStart?: string;
  scheduledEnd?: string;
  parentId?: string;
}

export interface CreateIssuePayload {
  type: string;
  summary: string;
  description?: string;
  priority?: string;
  parentId?: string;
  epicName?: string;
  estimate?: number;
  remainingEstimate?: number;
  assigneeId?: string;
  reporterId?: string;
  componentIds?: string[];
  labelIds?: string[];
  fixVersionIds?: string[];
  affectsVersionIds?: string[];
  customFields?: Record<string, string>;
}

export interface UpdateIssuePayload extends Partial<CreateIssuePayload> {
  blocked?: boolean;
}

export interface BoardData {
  columns: { status: string; issues: Issue[] }[];
}

export interface ProgramIncrement {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  sprints: { id: string; name: string }[];
  _count?: { issues: number };
}

export interface DashboardData {
  summary: { total: number; closed: number; inProgress: number; completionRate: number };
  byStatus: Record<string, number>;
  byRag: Record<string, number>;
  blocked: Issue[];
  atRisk: Issue[];
  recentEscalations: Array<{
    action: string;
    createdAt: string;
    issue: { key: string; summary: string };
    user: { name: string };
  }>;
}

export interface ReleaseNotes {
  release: string;
  versions: string[];
  features: Array<{ key: string; summary: string }>;
  bugFixes: Array<{ key: string; summary: string }>;
  totalItems: number;
}

export interface ScheduleResult {
  scheduled: Array<{ key: string; summary: string }>;
  unscheduled: Array<{ key: string; summary: string }>;
  violatedConstraints: string[];
  unusedCapacity: Record<string, number>;
  criticalPaths: string[][];
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function isEpicType(type?: string): boolean {
  return !!type && ['EPIC', 'FEATURE_EPIC', 'BAU_EPIC', 'RELEASE_EPIC'].includes(type);
}
