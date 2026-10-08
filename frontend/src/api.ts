const API = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

export const PROJECT_STORAGE_KEY = 'projectKey';

export function getCurrentProjectKey(): string | null {
  return localStorage.getItem(PROJECT_STORAGE_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const projectKey = getCurrentProjectKey();
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(projectKey ? { 'X-Project-Key': projectKey } : {}),
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
  transitionIssue: (id: string, target: { statusId?: string; status?: string }, resolution?: string) =>
    request<Issue>(`/issues/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ ...target, resolution }),
    }),
  getTransitions: (id: string) => request<WorkflowStatusRef[]>(`/issues/${id}/transitions`),
  getWorkflow: (key: string) => request<Workflow>(`/projects/${key}/workflow`),
  addWorkflowStatus: (key: string, data: { name: string; category: string }) =>
    request<WorkflowStatus>(`/projects/${key}/workflow/statuses`, { method: 'POST', body: JSON.stringify(data) }),
  updateWorkflowStatus: (key: string, statusId: string, data: { name?: string; category?: string }) =>
    request<WorkflowStatus>(`/projects/${key}/workflow/statuses/${statusId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteWorkflowStatus: (key: string, statusId: string, moveTo?: string) =>
    request<Workflow>(`/projects/${key}/workflow/statuses/${statusId}${moveTo ? `?moveTo=${moveTo}` : ''}`, { method: 'DELETE' }),
  reorderWorkflow: (key: string, statusIds: string[]) =>
    request<Workflow>(`/projects/${key}/workflow/order`, { method: 'PUT', body: JSON.stringify({ statusIds }) }),
  setWorkflowTransitions: (key: string, transitions: { fromStatusId: string; toStatusId: string }[]) =>
    request<Workflow>(`/projects/${key}/workflow/transitions`, { method: 'PUT', body: JSON.stringify({ transitions }) }),
  deleteIssue: (id: string) =>
    request<{ deleted: boolean; key: string }>(`/issues/${id}`, { method: 'DELETE' }),
  createLink: (id: string, target: { targetId?: string; targetKey?: string }, type: string) =>
    request<Issue>(`/issues/${id}/links`, {
      method: 'POST',
      body: JSON.stringify({ ...target, type }),
    }),
  deleteLink: (id: string, linkId: string) =>
    request<Issue>(`/issues/${id}/links/${linkId}`, { method: 'DELETE' }),
  getComments: (id: string) => request<Comment[]>(`/issues/${id}/comments`),
  addComment: (id: string, body: string) =>
    request<Comment>(`/issues/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateComment: (id: string, commentId: string, body: string) =>
    request<Comment>(`/issues/${id}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteComment: (id: string, commentId: string) =>
    request(`/issues/${id}/comments/${commentId}`, { method: 'DELETE' }),
  getHistory: (id: string) => request<HistoryEntry[]>(`/issues/${id}/history`),
  deleteAttachment: (id: string, attachmentId: string) =>
    request(`/issues/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),

  getNotifications: (scope: 'all' | 'direct' = 'all', unreadOnly = false, limit = 30) =>
    request<{ items: AppNotification[]; unread: number }>(`/notifications?scope=${scope}&unread=${unreadOnly}&limit=${limit}`),
  getUnreadCount: () => request<{ unread: number }>('/notifications/unread-count'),
  markNotificationRead: (id: string, read = true) =>
    request<{ unread: number }>(`/notifications/${id}/${read ? 'read' : 'unread'}`, { method: 'POST' }),
  markAllNotificationsRead: () => request<{ unread: number }>('/notifications/read-all', { method: 'POST' }),
  markIssueNotificationsRead: (issueId: string) =>
    request<{ unread: number }>(`/notifications/issue/${issueId}/read`, { method: 'POST' }),
  getNotificationPreferences: () => request<{ emailNotifications: boolean }>('/notifications/preferences'),
  setNotificationPreferences: (prefs: { emailNotifications: boolean }) =>
    request<{ emailNotifications: boolean }>('/notifications/preferences', { method: 'PATCH', body: JSON.stringify(prefs) }),

  getProjects: () => request<Project[]>('/projects'),
  getProject: (key: string) => request<ProjectDetail>(`/projects/${key}`),
  createProject: (data: { key: string; name: string; description?: string; leadId?: string; strictHierarchy?: boolean }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  getProjectMembers: (key: string) =>
    request<{ leadId: string | null; defaultAccess: ProjectAccess; members: ProjectMember[] }>(`/projects/${key}/members`),
  setProjectMember: (key: string, userId: string, role: ProjectRole) =>
    request<ProjectMember>(`/projects/${key}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeProjectMember: (key: string, userId: string) =>
    request(`/projects/${key}/members/${userId}`, { method: 'DELETE' }),
  updateProject: (key: string, data: { name?: string; description?: string; leadId?: string; defaultAccess?: ProjectAccess }) =>
    request<Project>(`/projects/${key}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createVersion: (data: { name: string; description?: string; releaseDate?: string }) =>
    request<Version>('/versions', { method: 'POST', body: JSON.stringify(data) }),
  updateVersion: (id: string, data: { released?: boolean; releaseDate?: string; name?: string }) =>
    request<Version>(`/versions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createComponent: (data: { name: string; type: string; leadId?: string }) =>
    request<Component>('/components', { method: 'POST', body: JSON.stringify(data) }),

  search: (jql: string, startAt = 0, maxResults = 50) =>
    request<SearchResult>('/search', { method: 'POST', body: JSON.stringify({ jql, startAt, maxResults }) }),
  quickSearch: (q: string) =>
    request<{ issues: Issue[]; projects: Pick<Project, 'id' | 'key' | 'name'>[] }>(
      `/search/quick?q=${encodeURIComponent(q)}`,
    ),
  getFilters: () => request<SavedFilter[]>('/filters'),
  createFilter: (data: { name: string; jql: string; description?: string; shared?: boolean }) =>
    request<SavedFilter>('/filters', { method: 'POST', body: JSON.stringify(data) }),
  updateFilter: (id: string, data: { name?: string; jql?: string; shared?: boolean }) =>
    request<SavedFilter>(`/filters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFilter: (id: string) => request(`/filters/${id}`, { method: 'DELETE' }),
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
  description?: string | null;
  released?: boolean;
  releaseDate?: string | null;
  _count?: { issueVersions: number };
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
  target?: { id: string; key: string; summary: string; type: string; status?: string; workflowStatus?: WorkflowStatusRef | null };
  source?: { id: string; key: string; summary: string; type: string; status?: string; workflowStatus?: WorkflowStatusRef | null };
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

export type NotificationType =
  | 'ASSIGNED' | 'MENTIONED' | 'COMMENTED' | 'STATUS_CHANGED' | 'UPDATED' | 'WATCHING' | 'DELETED';

export interface AppNotification {
  id: string;
  type: NotificationType;
  issueKey: string;
  issueSummary: string;
  detail: string | null;
  readAt: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
  issue: { id: string; key: string; summary: string; type: string; status: string } | null;
}

export type ProjectRole = 'VIEWER' | 'MEMBER' | 'ADMIN';
export type EffectiveRole = 'NONE' | ProjectRole;
export type ProjectAccess = 'NONE' | 'VIEWER' | 'MEMBER';

export interface Permissions {
  role: EffectiveRole;
  canBrowse: boolean;
  canComment: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  canDelete?: boolean;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: ProjectRole;
  user: { id: string; name: string; email: string; role: string };
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  strictHierarchy: boolean;
  defaultAccess: ProjectAccess;
  myRole?: EffectiveRole;
  leadId?: string | null;
  lead?: { id: string; name: string; email: string } | null;
  createdAt: string;
  _count?: { issues: number };
}

export interface ProjectDetail extends Project {
  permissions: Permissions;
  components: Component[];
  versions: Version[];
  issueCountsByStatus: Record<string, number>;
}

export interface Comment {
  id: string;
  issueId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; email: string };
}

export interface HistoryEntry {
  id: string;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export interface SearchResult {
  jql: string;
  startAt: number;
  maxResults: number;
  total: number;
  issues: Issue[];
}

export interface SavedFilter {
  id: string;
  name: string;
  jql: string;
  description?: string;
  shared: boolean;
  ownerId: string;
  owner: { id: string; name: string };
}

export interface Issue {
  id: string;
  key: string;
  workflowStatus?: WorkflowStatusRef | null;
  project?: { id: string; key: string; name: string; strictHierarchy?: boolean; leadId?: string | null };
  permissions?: Permissions;
  reporterId?: string;
  _count?: { comments: number; children: number };
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
  projectKey?: string;
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
  columns: { statusId: string; name: string; status: string; issues: Issue[] }[];
}

/** A status in a project's workflow; category is Backlog / To Do / In Progress / Done. */
export interface WorkflowStatusRef {
  id: string;
  name: string;
  category: string;
}

export interface WorkflowStatus extends WorkflowStatusRef {
  position: number;
  issueCount?: number;
}

export interface Workflow {
  statuses: WorkflowStatus[];
  transitions: { id: string; fromStatusId: string; toStatusId: string }[];
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
