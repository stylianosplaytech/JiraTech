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
  /** Staff by default; `kind` also lists service desk customers. */
  getUsers: (search?: string, kind: 'staff' | 'customers' | 'all' = 'staff') => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (kind !== 'staff') params.set('kind', kind);
    const qs = params.toString();
    return request<User[]>(`/users${qs ? `?${qs}` : ''}`);
  },
  /** Without a password, sendInvite (the default) emails them a link to choose their own. */
  createUser: (data: { email: string; name: string; password?: string; role: string; sendInvite?: boolean }) =>
    request<User & { invitation: Invitation | null }>('/users', { method: 'POST', body: JSON.stringify(data) }),
  /** Emails a new welcome link to choose a password. */
  inviteUser: (id: string) => request<Invitation>(`/users/${id}/invite`, { method: 'POST' }),
  // ─── Welcome and reset links (no login needed) ─────────────────────────────
  /** Emails a link to choose a new password; answers the same whether or not the address has an account. */
  forgotPassword: (email: string) =>
    request<{ requested: boolean }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  /** welcome: choosing a first password (rather than resetting one) */
  getPasswordLink: (token: string) =>
    request<{ name: string; email: string; customer: boolean; welcome: boolean }>(`/auth/password-links/${encodeURIComponent(token)}`),
  setPassword: (token: string, password: string) =>
    request<{ accessToken: string; user: User }>('/auth/set-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  // ─── Outgoing email for the whole application (global admins) ─────────────
  getMailSettings: () => request<MailSettings>('/mail-settings'),
  /** Fields left out keep their value; '' clears (smtpPassword is write-only). */
  saveMailSettings: (data: MailSettingsPatch) => request<MailSettings>('/mail-settings', { method: 'PUT', body: JSON.stringify(data) }),
  /** "Connect Gmail account": the Google sign-in page to open. */
  startGmailConnect: (origin: string) =>
    request<{ url: string; redirectUri: string }>('/mail-settings/google/start', { method: 'POST', body: JSON.stringify({ origin }) }),
  disconnectGmail: () => request<MailSettings>('/mail-settings/google/disconnect', { method: 'POST' }),
  sendTestMail: (to: string) =>
    request<{ sent: boolean; source: MailSource; file: string | null }>('/mail-settings/test', { method: 'POST', body: JSON.stringify({ to }) }),
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
  getMovePreview: (id: string, projectKey: string) =>
    request<MovePreview>(`/issues/${id}/move?to=${encodeURIComponent(projectKey)}`),
  moveIssue: (id: string, data: MoveIssuePayload) =>
    request<Issue>(`/issues/${id}/move`, { method: 'POST', body: JSON.stringify(data) }),
  getWorkflow: (key: string) => request<Workflow>(`/projects/${key}/workflow`),
  addWorkflowStatus: (key: string, data: { name: string; category: string }) =>
    request<WorkflowStatus>(`/projects/${key}/workflow/statuses`, { method: 'POST', body: JSON.stringify(data) }),
  updateWorkflowStatus: (key: string, statusId: string, data: { name?: string; category?: string; pausesSla?: boolean }) =>
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
  addComment: (id: string, body: string, internal = false) =>
    request<Comment>(`/issues/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, internal }) }),
  updateComment: (id: string, commentId: string, body: string) =>
    request<Comment>(`/issues/${id}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteComment: (id: string, commentId: string) =>
    request(`/issues/${id}/comments/${commentId}`, { method: 'DELETE' }),
  getHistory: (id: string) => request<HistoryEntry[]>(`/issues/${id}/history`),
  getIssueEmails: (id: string) => request<IssueEmails>(`/issues/${id}/emails`),
  sendIssueEmail: (id: string, data: SendEmailPayload) =>
    request<IssueEmail>(`/issues/${id}/emails`, { method: 'POST', body: JSON.stringify(data) }),
  retryIssueEmail: (id: string, emailId: string) =>
    request<IssueEmail>(`/issues/${id}/emails/${emailId}/retry`, { method: 'POST' }),
  renderEmailTemplate: (id: string, templateId: string, to?: string) =>
    request<{ subject: string | null; html: string }>(`/issues/${id}/emails/render-template`, { method: 'POST', body: JSON.stringify({ templateId, to }) }),
  /** `project`: the templates offered on that service desk; `scope` narrows it to the global or its own ones. */
  getEmailTemplates: (opts: { project?: string; scope?: 'global' | 'project' } = {}) => {
    const qs = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]).toString();
    return request<EmailTemplate[]>(`/email-templates${qs ? `?${qs}` : ''}`);
  },
  createEmailTemplate: (data: EmailTemplatePayload) =>
    request<EmailTemplate>('/email-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateEmailTemplate: (templateId: string, data: EmailTemplatePayload) =>
    request<EmailTemplate>(`/email-templates/${templateId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmailTemplate: (templateId: string) =>
    request<{ deleted: boolean }>(`/email-templates/${templateId}`, { method: 'DELETE' }),
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
  createProject: (data: { key: string; name: string; description?: string; leadId?: string; strictHierarchy?: boolean; type?: ProjectType }) =>
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
  /** Pass a project key to read another project's list than the current one. */
  getLabels: (projectKey?: string) => request<Label[]>(`/labels${projectKey ? `?project=${projectKey}` : ''}`),
  createLabel: (name: string) =>
    request<Label>('/labels', { method: 'POST', body: JSON.stringify({ name }) }),
  getVersions: (projectKey?: string) => request<Version[]>(`/versions${projectKey ? `?project=${projectKey}` : ''}`),
  getCustomFieldDefinitions: () => request<CustomFieldDefinition[]>('/custom-fields'),
  /** Creates the field in the current project. */
  createCustomField: (data: { key: string; name: string; type: string; options?: string[] }) =>
    request<CustomFieldDefinition>('/custom-fields', { method: 'POST', body: JSON.stringify(data) }),
  getBoard: (sprintId?: string) => {
    const qs = sprintId ? `?sprintId=${sprintId}` : '';
    return request<BoardData>(`/board${qs}`);
  },
  getComponents: (type?: string, projectKey?: string) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (projectKey) params.set('project', projectKey);
    const qs = params.toString();
    return request<Component[]>(`/components${qs ? `?${qs}` : ''}`);
  },
  bulkChange: (data: BulkRequest) =>
    request<BulkResult>('/issues/bulk', { method: 'POST', body: JSON.stringify(data) }),
  getPis: () => request<ProgramIncrement[]>('/planning/pis'),
  getDashboard: (piId?: string) => {
    const qs = piId ? `?piId=${piId}` : '';
    return request<DashboardData>(`/dashboard${qs}`);
  },
  getReport: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request<ReportData>(`/reports${qs ? `?${qs}` : ''}`);
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

  // ─── Service desk (agents and project admins) ──────────────────────────────
  getServiceDesk: (key: string) => request<ServiceDeskSettings>(`/service-desk/${key}`),
  getQueues: (key: string) => request<Queue[]>(`/service-desk/${key}/queues`),
  getQueueIssues: (key: string, queueId: string, startAt = 0) =>
    request<QueuePage>(`/service-desk/${key}/queues/${queueId}/issues?startAt=${startAt}`),
  createQueue: (key: string, data: { name: string; jql: string }) =>
    request<Queue>(`/service-desk/${key}/queues`, { method: 'POST', body: JSON.stringify(data) }),
  updateQueue: (key: string, id: string, data: { name?: string; jql?: string }) =>
    request<Queue>(`/service-desk/${key}/queues/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteQueue: (key: string, id: string) => request(`/service-desk/${key}/queues/${id}`, { method: 'DELETE' }),
  createRequestType: (key: string, data: RequestTypePayload) =>
    request<RequestType>(`/service-desk/${key}/request-types`, { method: 'POST', body: JSON.stringify(data) }),
  updateRequestType: (key: string, id: string, data: Partial<RequestTypePayload>) =>
    request<RequestType>(`/service-desk/${key}/request-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRequestType: (key: string, id: string) => request(`/service-desk/${key}/request-types/${id}`, { method: 'DELETE' }),
  setSlaTargets: (key: string, targets: SlaTarget[]) =>
    request<SlaTarget[]>(`/service-desk/${key}/sla`, { method: 'PUT', body: JSON.stringify({ targets }) }),
  // ─── A service desk's customer portals (project admins change them) ────────
  getPortals: (key: string) => request<PortalAdmin[]>(`/service-desk/${key}/portals`),
  createPortal: (key: string, data: { name: string; slug: string }) =>
    request<PortalAdmin>(`/service-desk/${key}/portals`, { method: 'POST', body: JSON.stringify(data) }),
  /** '' clears welcome, colour or logo; requestTypeIds [] offers all request types. */
  updatePortal: (key: string, id: string, data: {
    name?: string; slug?: string; open?: boolean; welcome?: string; color?: string; logo?: string; requestTypeIds?: string[];
  }) => request<PortalAdmin>(`/service-desk/${key}/portals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePortal: (key: string, id: string) =>
    request<{ deleted: boolean; movedTo: Named }>(`/service-desk/${key}/portals/${id}`, { method: 'DELETE' }),
  addPortalOrganization: (key: string, id: string, organizationId: string) =>
    request<PortalAdmin>(`/service-desk/${key}/portals/${id}/organizations/${organizationId}`, { method: 'PUT' }),
  removePortalOrganization: (key: string, id: string, organizationId: string) =>
    request<PortalAdmin>(`/service-desk/${key}/portals/${id}/organizations/${organizationId}`, { method: 'DELETE' }),
  addPortalCustomer: (key: string, id: string, userId: string) =>
    request<PortalAdmin>(`/service-desk/${key}/portals/${id}/customers/${userId}`, { method: 'PUT' }),
  removePortalCustomer: (key: string, id: string, userId: string) =>
    request<PortalAdmin>(`/service-desk/${key}/portals/${id}/customers/${userId}`, { method: 'DELETE' }),
  /** Lets an excluded customer use the portal again (through it being open or their organization). */
  removePortalExclusion: (key: string, id: string, userId: string) =>
    request<PortalAdmin>(`/service-desk/${key}/portals/${id}/exclusions/${userId}`, { method: 'DELETE' }),
  // ─── A service desk's email address (project admins change it) ─────────────
  getEmailChannel: (key: string) => request<EmailChannelSettings>(`/service-desk/${key}/email`),
  /** Fields left out keep their value; '' clears the optional ones (imapPassword is write-only). */
  saveEmailChannel: (key: string, data: EmailChannelPatch) =>
    request<EmailChannel>(`/service-desk/${key}/email`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmailChannel: (key: string) => request<{ deleted: boolean }>(`/service-desk/${key}/email`, { method: 'DELETE' }),
  getEmailMessages: (key: string) => request<EmailMessage[]>(`/service-desk/${key}/email/messages`),
  testEmailConnection: (key: string) =>
    request<{ ok: boolean; messages: number; unseen: number }>(`/service-desk/${key}/email/test-connection`, { method: 'POST' }),
  checkEmail: (key: string) =>
    request<{ received: number; created: number; commented: number; ignored: number; failed: number }>(`/service-desk/${key}/email/check`, { method: 'POST' }),
  sendTestEmail: (key: string, data: { from: string; fromName?: string; subject: string; body: string }) =>
    request<{ outcome: EmailOutcome; detail: string | null; issueKey: string | null }>(`/service-desk/${key}/email/test-email`, { method: 'POST', body: JSON.stringify(data) }),
  setRequestOrganization: (issueId: string, organizationId: string | null) =>
    request<{ organization: Named | null }>(`/service-desk/requests/${issueId}/organization`, { method: 'PATCH', body: JSON.stringify({ organizationId }) }),

  // ─── Customer organizations (global admins change them) ────────────────────
  getOrganizations: () => request<Organization[]>('/organizations'),
  getRecipientGroups: () => request<RecipientGroup[]>('/recipient-groups'),
  createRecipientGroup: (data: RecipientGroupPayload) =>
    request<RecipientGroup>('/recipient-groups', { method: 'POST', body: JSON.stringify(data) }),
  updateRecipientGroup: (id: string, data: RecipientGroupPayload) =>
    request<RecipientGroup>(`/recipient-groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecipientGroup: (id: string) => request<{ deleted: boolean }>(`/recipient-groups/${id}`, { method: 'DELETE' }),
  createOrganization: (name: string) =>
    request<Organization>('/organizations', { method: 'POST', body: JSON.stringify({ name }) }),
  renameOrganization: (id: string, name: string) =>
    request<Organization>(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteOrganization: (id: string) => request(`/organizations/${id}`, { method: 'DELETE' }),
  // ─── One customer's portals (global admins, from the People page) ─────────
  getCustomerPortals: (userId: string) => request<CustomerPortal[]>(`/users/${userId}/portals`),
  allowCustomerPortal: (userId: string, portalId: string) =>
    request<CustomerPortal[]>(`/users/${userId}/portals/${portalId}`, { method: 'PUT' }),
  /** Also excludes them when the portal is open or serves one of their organizations. */
  removeCustomerPortal: (userId: string, portalId: string) =>
    request<CustomerPortal[]>(`/users/${userId}/portals/${portalId}`, { method: 'DELETE' }),
  addOrganizationMember: (id: string, userId: string) =>
    request<Organization>(`/organizations/${id}/members/${userId}`, { method: 'PUT' }),
  removeOrganizationMember: (id: string, userId: string) =>
    request<Organization>(`/organizations/${id}/members/${userId}`, { method: 'DELETE' }),
  getRequestInfo: (issueId: string) => request<RequestInfo>(`/service-desk/requests/${issueId}`),

  // ─── Help centers (customers and staff) ────────────────────────────────────
  getMyPortals: () => request<PortalSummary[]>('/portal/portals'),
  getPortal: (slug: string) => request<PortalPage>(`/portal/portals/${slug}`),
  raiseRequest: (slug: string, data: {
    requestTypeId: string; summary: string; description?: string; fields?: Record<string, string>; onBehalfOfId?: string;
    organizationId?: string; shareWithOrganization?: boolean;
  }) =>
    request<{ key: string }>(`/portal/portals/${slug}/requests`, { method: 'POST', body: JSON.stringify(data) }),
  getMyRequests: (status: 'open' | 'closed' | 'all', q?: string) =>
    request<PortalRequestSummary[]>(`/portal/requests?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  getPortalRequest: (key: string) => request<PortalRequest>(`/portal/requests/${key}`),
  /** The requester shares their request with one of their organizations, or makes it private (null). */
  shareRequest: (key: string, organizationId: string | null) =>
    request<PortalRequest>(`/portal/requests/${key}/share`, { method: 'POST', body: JSON.stringify({ organizationId }) }),
  replyToRequest: (key: string, body: string) =>
    request<PortalRequest>(`/portal/requests/${key}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Added without a password and hasn't chosen one from the welcome email yet */
  invitePending?: boolean;
}

/** A welcome email: `sent` is false when it couldn't be delivered (see Email settings). */
export interface Invitation {
  sent: boolean;
  expiresAt: string;
}

/**
 * Where outgoing email is configured: Email settings (Gmail account or SMTP server), the GMAIL_* or SMTP_* environment
 * variables, or none of them (files in backend/mail-outbox).
 */
export type MailSource = 'gmail' | 'settings' | 'gmail-environment' | 'environment' | 'outbox';

export interface MailSettings {
  /** SMTP server, or a Gmail account through Google's API */
  transport: 'SMTP' | 'GMAIL';
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  hasPassword: boolean;
  gmailClientId: string | null;
  hasGmailSecret: boolean;
  /** The connected Gmail account */
  gmailAccount: string | null;
  fromName: string | null;
  fromAddress: string | null;
  appUrl: string | null;
  source: MailSource;
  /** The sender in use, e.g. "JiraTech" <jira@example.com> */
  from: string;
  /** Where links in emails point */
  effectiveAppUrl: string;
  environment: { smtpHost: string | null; gmailUser: string | null; mailFrom: string | null; appUrl: string | null };
}

export type MailSettingsPatch = {
  transport?: 'SMTP' | 'GMAIL'; gmailClientId?: string; gmailClientSecret?: string;
  smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string; smtpPassword?: string;
  fromName?: string; fromAddress?: string; appUrl?: string;
};

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

export type ProjectType = 'SOFTWARE' | 'SERVICE_DESK';

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  type: ProjectType;
  portalOpen?: boolean;
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
  /** Service desks: an internal note that customers don't see. */
  internal?: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; email: string };
}

export interface EmailAddress {
  email: string;
  name?: string | null;
  /** The recipient group or organization it was reached through */
  via?: string | null;
}

/** A recipient group or organization picked as a whole in To, Cc or Bcc. */
export interface RecipientRefPayload {
  type: 'group' | 'organization';
  id: string;
}

export interface RecipientGroup {
  id: string;
  name: string;
  description: string | null;
  users: { id: string; name: string; email: string }[];
  organizations: { id: string; name: string; memberCount: number }[];
  addresses: EmailAddress[];
  /** Everyone it reaches right now */
  recipients: EmailAddress[];
  updatedAt: string;
}

export interface RecipientGroupPayload {
  name: string;
  description?: string;
  userIds: string[];
  organizationIds: string[];
  addresses: EmailAddress[];
}

/** An email received on a service desk request, or sent from it. */
export interface IssueEmail {
  id: string;
  /** The comment it is shown in place of (null for the email that raised the request) */
  commentId: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  fromEmail: string;
  fromName: string | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  replyTo: string | null;
  subject: string;
  /** Sanitized; shown in a sandboxed frame */
  html: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
  sentBy: { id: string; name: string } | null;
  attachments: { id: string; filename: string; mimeType: string; size: number }[];
}

export interface IssueEmails {
  emails: IssueEmail[];
  /** JiraTech's own addresses, left out of Reply all */
  ownAddresses: string[];
  /** Set when replies come back to the request (an enabled email channel) */
  channelAddress: string | null;
}

export type EmailMode = 'reply' | 'replyAll' | 'forward' | 'new';

export interface SendEmailPayload {
  mode: EmailMode;
  replyToId?: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  toGroups?: RecipientRefPayload[];
  ccGroups?: RecipientRefPayload[];
  bccGroups?: RecipientRefPayload[];
  subject: string;
  html: string;
  includeQuote?: boolean;
  attachmentIds?: string[];
  internal?: boolean;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  /** null: a global template */
  projectId: string | null;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface EmailTemplatePayload {
  name: string;
  subject?: string;
  body: string;
  /** Only when creating a service desk's own template */
  projectKey?: string;
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
  project?: { id: string; key: string; name: string; strictHierarchy?: boolean; leadId?: string | null; type?: ProjectType };
  requestType?: { id: string; name: string } | null;
  /** Service desks: how the request came in */
  source?: 'EMAIL' | 'PORTAL' | null;
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

export interface BulkRequest {
  issueIds: string[];
  action: 'edit' | 'transition' | 'watch' | 'delete' | 'move';
  notify?: boolean;
  assigneeId?: string | null;
  priority?: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  addComponentIds?: string[];
  addFixVersionIds?: string[];
  statusName?: string;
  resolution?: string;
  projectKey?: string;
}

export interface MoveIssuePayload {
  projectKey: string;
  statusId?: string;
  parentId?: string | null;
  requestTypeId?: string | null;
}

export interface MovePreview {
  key: string;
  target: { key: string; name: string; type: ProjectType; strictHierarchy: boolean };
  statuses: WorkflowStatusRef[];
  suggestedStatusId: string;
  parentRequired: boolean;
  currentParent: { id: string; key: string } | null;
  requestTypes: { id: string; name: string }[];
  suggestedRequestTypeId: string | null;
  subtasks: { id: string; key: string; summary: string }[];
  dropped: { components: string[]; versions: string[]; customFields: string[]; sprints: string[]; pis: string[] };
}

export interface BulkResult {
  succeeded: { id: string; key: string }[];
  failed: { id: string; key: string; error: string }[];
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
  pausesSla?: boolean;
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

export type TypeGroup = 'EPIC' | 'STORY' | 'BUG' | 'TASK' | 'OTHER';

export interface ReportIssueRow {
  key: string;
  summary: string;
  type: string;
  typeGroup: TypeGroup;
  priority: string;
  status: string;
  statusName: string;
  createdAt: string;
  assignee: string | null;
  parentKey: string | null;
  ageDays: number;
}

export interface SlaOutcomes {
  met: number;
  missed: number;
  /** Still open and past the goal */
  breached: number;
  atRisk: number;
  onTrack: number;
  paused: number;
  noGoal: number;
  /** Met as a share of met + missed + breached; null when none decided yet */
  metPct: number | null;
  /** Average time once the clock stopped */
  avgMinutes: number | null;
}

/** Service desks only: how SLA goals were kept. */
export interface SlaReport {
  goalsSet: boolean;
  requests: number;
  firstResponse: SlaOutcomes;
  resolution: SlaOutcomes;
  byPriority: {
    priority: string; requests: number;
    firstResponseGoal: number | null; firstResponseAvg: number | null; firstResponseMetPct: number | null;
    resolutionGoal: number | null; resolutionAvg: number | null; resolutionMetPct: number | null;
  }[];
  byPortal: { name: string; requests: number; firstResponseMetPct: number | null; resolutionMetPct: number | null }[];
  perMonth: { month: string; met: number; missed: number }[];
  attention: {
    key: string; summary: string; priority: string; statusName: string; portal: string | null; organization: string | null;
    assignee: string | null; createdAt: string; firstResponse: SlaClock | null; resolution: SlaClock | null;
  }[];
}

export interface ReportData {
  /** Service desks only */
  sla: SlaReport | null;
  project: { key: string; name: string };
  period: { from: string; to: string };
  generatedAt: string;
  summary: { total: number; open: number; closed: number; percentComplete: number; overallStatus: string };
  byStatus: { name: string; category: string; count: number }[];
  byType: { type: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  pendingByType: { type: string; count: number }[];
  closedByAssignee: { name: string; count: number }[];
  unassignedClosed: number;
  closedPerMonth: ({ month: string; total: number } & Record<TypeGroup, number>)[];
  longestOpen: { group: TypeGroup; issues: ReportIssueRow[] }[];
  openByPriority: { priority: string; count: number }[];
  openIssues: ReportIssueRow[];
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

// ─── Service desk ────────────────────────────────────────────────────────────

export interface SlaClock {
  goalMinutes: number;
  elapsedMinutes: number;
  /** Negative once breached. */
  remainingMinutes: number;
  breached: boolean;
  completed: boolean;
  paused: boolean;
}

export interface Sla {
  firstResponse: SlaClock | null;
  resolution: SlaClock | null;
}

export interface SlaTarget {
  priority: string;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
}

export interface RequestTypeField {
  requestTypeId: string;
  fieldId: string;
  required: boolean;
  position: number;
  field: CustomFieldDefinition;
}

export interface RequestType {
  id: string;
  name: string;
  description: string | null;
  issueType: string;
  position: number;
  fields: RequestTypeField[];
  _count?: { issues: number };
}

export interface RequestTypePayload {
  name: string;
  description?: string;
  issueType: string;
  fields?: { fieldId: string; required: boolean }[];
}

export interface Queue {
  id: string;
  name: string;
  jql: string;
  position: number;
  count?: number;
  error?: string | null;
}

export interface QueueRow {
  id: string;
  key: string;
  summary: string;
  type: string;
  priority: string;
  status: string;
  workflowStatus: WorkflowStatusRef | null;
  requestType: { id: string; name: string } | null;
  organization: Named | null;
  portal: { id: string; slug: string; name: string } | null;
  reporter: { id: string; name: string; email: string } | null;
  assignee: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  sla: Sla;
}

export interface QueuePage {
  queue: Queue;
  total: number;
  startAt: number;
  maxResults: number;
  issues: QueueRow[];
}

export interface ServiceDeskSettings {
  project: { id: string; key: string; name: string };
  requestTypes: RequestType[];
  slaTargets: SlaTarget[];
  queues: Queue[];
}

export interface Named {
  id: string;
  name: string;
}

/** A portal's look; null colour/logo means the default style. */
export interface PortalBranding {
  welcome: string | null;
  color: string | null;
  logo: string | null;
}

/** A service desk portal as its project admins see it. */
export interface PortalAdmin {
  id: string;
  /** /portal/:slug */
  slug: string;
  name: string;
  /** Any customer may use it (otherwise only the listed organizations and customers) */
  open: boolean;
  branding: PortalBranding;
  organizations: (Named & { members: number })[];
  customers: { id: string; name: string; email: string }[];
  /** Kept off it although it's open or serves their organization */
  excluded: { id: string; name: string; email: string }[];
  /** Empty: every request type of the project */
  requestTypeIds: string[];
  requests: number;
}

/** A service desk's email address and the mailbox (IMAP) it is read from. */
export interface EmailChannel {
  address: string;
  enabled: boolean;
  imapHost: string | null;
  imapPort: number;
  /** TLS from the start; otherwise STARTTLS */
  imapSecure: boolean;
  imapUser: string | null;
  hasPassword: boolean;
  imapFolder: string;
  /** Default portal for new requests (null: the project's first) */
  portalId: string | null;
  /** Request type of new requests (null: the portal's first) */
  requestTypeId: string | null;
  /** Unknown senders become customers */
  createCustomers: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Set by environment variables with this prefix (e.g. EMAIL_HELP_): read-only in the app */
  environmentPrefix: string | null;
}

export interface EmailChannelSettings {
  channel: EmailChannel | null;
  /** False when the server was started with MAIL_POLLING=false */
  polling: boolean;
  pollSeconds: number;
}

export type EmailChannelPatch = Partial<Omit<EmailChannel, 'hasPassword' | 'lastCheckedAt' | 'lastError' | 'portalId' | 'requestTypeId' | 'environmentPrefix'>> & {
  imapPassword?: string;
  portalId?: string;
  requestTypeId?: string;
};

export type EmailOutcome = 'CREATED' | 'COMMENTED' | 'IGNORED' | 'FAILED';

export interface EmailMessage {
  id: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  outcome: EmailOutcome;
  detail: string | null;
  issueKey: string | null;
  test: boolean;
  receivedAt: string;
}

/** A service desk portal, and whether (and how) one customer can use it. */
export interface CustomerPortal {
  id: string;
  slug: string;
  name: string;
  project: { key: string; name: string };
  /** Any customer may use it */
  open: boolean;
  /** Listed on it individually */
  direct: boolean;
  /** Their organizations it serves */
  viaOrganizations: Named[];
  /** Kept off it although it's open or serves their organization */
  excluded: boolean;
  canUse: boolean;
}

export interface Organization extends Named {
  members:{ userId: string; user: { id: string; name: string; email: string } }[];
  portals: { portalId: string; portal: { id: string; slug: string; name: string; project: { key: string; name: string } } }[];
  _count: { issues: number };
}

export interface RequestInfo {
  serviceDesk: boolean;
  requestType: { id: string; name: string } | null;
  portal: { id: string; slug: string; name: string } | null;
  organization: Named | null;
  /** Organizations the project's portals serve (what agents can share the request with) */
  organizations: Named[];
  sla: Sla | null;
}

/** A portal in the help center list. */
export interface PortalSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Staff only: the project it feeds */
  project: { key: string; name: string } | null;
  branding: PortalBranding;
}

export interface PortalField {
  key: string;
  name: string;
  type: 'TEXT' | 'NUMBER' | 'SELECT' | 'DATE';
  options: string[];
  required: boolean;
}

/** One portal's landing page and request forms. */
export interface PortalPage {
  slug: string;
  name: string;
  description: string | null;
  branding: PortalBranding;
  /** The raiser's organizations this portal serves */
  shareWith: Named[];
  canRaiseOnBehalf: boolean;
  requestTypes: { id: string; name: string; description: string | null; fields: PortalField[] }[];
}

export interface PortalStatus {
  name: string;
  category: string;
}

export interface PortalRequestSummary {
  key: string;
  summary: string;
  status: PortalStatus;
  requestType: { id: string; name: string } | null;
  portal: { slug: string; name: string } | null;
  reporter: { id: string; name: string } | null;
  organization: Named | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortalRequest {
  id: string;
  key: string;
  summary: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  resolution: string | null;
  status: PortalStatus;
  /** The portal it was raised through, with its look */
  portal: { slug: string; name: string; branding: PortalBranding } | null;
  requestType: { id: string; name: string } | null;
  reporter: { id: string; name: string } | null;
  organization: Named | null;
  /** Set for the requester only: the organizations they can share it with */
  shareWith: Named[] | null;
  participants: { id: string; name: string }[];
  fields: { name: string; value: string }[];
  comments: { id: string; body: string; createdAt: string; author: { id: string; name: string; agent: boolean } }[];
}

export const isCustomer = (user?: { role: string } | null) => user?.role === 'CUSTOMER';

/** "45m", "3h 20m", "2d 4h". */
export function formatDuration(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return `${d}d${h ? ` ${h}h` : ''}`;
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
