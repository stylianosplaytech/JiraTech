/**
 * Demo data for trying out JiraTech: extra people, two standard projects (PAY, MOB),
 * more SPORTS work, comments, links, watchers, work logs, history and saved filters.
 *
 * Runs on top of the base seed (prisma/seed.ts) and is safe to re-run: anything that
 * already exists is left alone.
 *
 *   npm run db:seed:demo -w backend
 */
import {
  ComponentType, IssueResolution, IssueStatus, IssueType, LinkType, Priority, PrismaClient, ProjectAccess, ProjectRole,
  RagStatus, UserRole,
  type Issue, type User,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const NOW = Date.now();
const ago = (days: number, hours = 0) => new Date(NOW - days * 86_400_000 - hours * 3_600_000);

// ─── People ──────────────────────────────────────────────────────────────────

const PEOPLE: { email: string; name: string; role: UserRole }[] = [
  { email: 'elena@jiratech.local', name: 'Elena Christodoulou', role: UserRole.TEAM_LEAD },
  { email: 'nikos@jiratech.local', name: 'Nikos Georgiou', role: UserRole.DEVELOPER },
  { email: 'sofia@jiratech.local', name: 'Sofia Ioannou', role: UserRole.QA_SPECIALIST },
  { email: 'daniel@jiratech.local', name: 'Daniel Cohen', role: UserRole.RELEASE_MANAGER },
  { email: 'katerina@jiratech.local', name: 'Katerina Antoniou', role: UserRole.PRODUCT_OWNER },
  { email: 'marcus@jiratech.local', name: 'Marcus Weber', role: UserRole.SCRUM_MASTER },
  { email: 'lina@jiratech.local', name: 'Lina Haddad', role: UserRole.DEVELOPER },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Status = 'BACKLOG' | 'TO_DO' | 'DOING' | 'CLOSED';
const FLOW: Status[] = ['BACKLOG', 'TO_DO', 'DOING', 'CLOSED'];

interface IssueSpec {
  type: IssueType;
  summary: string;
  description?: string;
  status?: Status;
  resolution?: IssueResolution;
  priority?: Priority;
  assignee?: User;
  reporter: User;
  parent?: Issue;
  labels?: string[];
  components?: string[];
  fix?: string[];
  affects?: string[];
  estimate?: number;
  createdDaysAgo: number;
  blocked?: boolean;
  rag?: RagStatus;
  epicName?: string;
  sprintName?: string;
  piId?: string;
  watchers?: User[];
  custom?: Record<string, string>;
}

class Builder {
  private labelIds = new Map<string, string>();
  private componentIds = new Map<string, string>();
  private versionIds = new Map<string, string>();
  private sprintIds = new Map<string, string>();
  private fieldIds = new Map<string, string>();

  constructor(private projectId: string, private projectKey: string) {}

  async load() {
    for (const l of await prisma.label.findMany({ where: { projectId: this.projectId } })) this.labelIds.set(l.name, l.id);
    for (const c of await prisma.component.findMany({ where: { projectId: this.projectId } })) this.componentIds.set(c.name, c.id);
    for (const v of await prisma.version.findMany({ where: { projectId: this.projectId } })) this.versionIds.set(v.name, v.id);
    for (const f of await prisma.customFieldDefinition.findMany({ where: { projectId: this.projectId } })) this.fieldIds.set(f.key, f.id);
    const sprints = await prisma.sprint.findMany({ where: { pi: { projectId: this.projectId } } });
    for (const s of sprints) this.sprintIds.set(s.name, s.id);
    return this;
  }

  async labels(names: string[]) {
    for (const name of names) {
      const l = await prisma.label.upsert({
        where: { projectId_name: { projectId: this.projectId, name } },
        update: {},
        create: { name, projectId: this.projectId },
      });
      this.labelIds.set(name, l.id);
    }
  }

  async components(list: { name: string; type?: ComponentType; lead?: User }[]) {
    for (const c of list) {
      const comp = await prisma.component.upsert({
        where: { projectId_name: { projectId: this.projectId, name: c.name } },
        update: {},
        create: { name: c.name, type: c.type ?? ComponentType.SERVICE, projectId: this.projectId, leadId: c.lead?.id },
      });
      this.componentIds.set(c.name, comp.id);
    }
  }

  async fields(list: { key: string; name: string; type: 'TEXT' | 'SELECT' | 'NUMBER'; options?: string[]; order: number }[]) {
    for (const f of list) {
      const def = await prisma.customFieldDefinition.upsert({
        where: { projectId_key: { projectId: this.projectId, key: f.key } },
        update: {},
        create: { ...f, options: f.options ? JSON.stringify(f.options) : null, projectId: this.projectId },
      });
      this.fieldIds.set(f.key, def.id);
    }
  }

  async versions(list:{ name: string; released?: boolean; releaseDate?: Date; description?: string }[]) {
    for (const v of list) {
      const ver = await prisma.version.upsert({
        where: { projectId_name: { projectId: this.projectId, name: v.name } },
        update: {},
        create: { ...v, projectId: this.projectId },
      });
      this.versionIds.set(v.name, ver.id);
    }
  }

  private async nextKey() {
    const project = await prisma.project.update({
      where: { id: this.projectId },
      data: { issueCounter: { increment: 1 } },
    });
    let number = project.issueCounter;
    const { _max } = await prisma.issue.aggregate({ where: { projectId: this.projectId }, _max: { number: true } });
    if ((_max.number ?? 0) >= number) {
      number = (_max.number ?? 0) + 1;
      await prisma.project.update({ where: { id: this.projectId }, data: { issueCounter: number } });
    }
    return { key: `${this.projectKey}-${number}`, number };
  }

  async issue(s: IssueSpec): Promise<Issue> {
    const existing = await prisma.issue.findFirst({ where: { projectId: this.projectId, summary: s.summary } });
    if (existing) return existing;

    const status = s.status ?? 'BACKLOG';
    const created = ago(s.createdDaysAgo, 3);
    const lastTouch = ago(Math.max(0, s.createdDaysAgo - Math.ceil(s.createdDaysAgo * 0.7)), 1);
    const resolution = status === 'CLOSED' ? (s.resolution ?? IssueResolution.COMPLETED) : null;
    const id = (map: Map<string, string>, name: string, kind: string) => {
      const v = map.get(name);
      if (!v) throw new Error(`${this.projectKey}: unknown ${kind} "${name}"`);
      return v;
    };

    const { key, number } = await this.nextKey();
    const issue = await prisma.issue.create({
      data: {
        key,
        number,
        projectId: this.projectId,
        type: s.type,
        summary: s.summary,
        description: s.description,
        status: status as IssueStatus,
        resolution,
        priority: s.priority ?? Priority.MEDIUM,
        assigneeId: s.assignee?.id,
        reporterId: s.reporter.id,
        parentId: s.parent?.id,
        epicName: s.epicName,
        estimate: s.estimate,
        remainingEstimate: s.estimate != null ? (status === 'CLOSED' ? 0 : s.estimate) : undefined,
        blocked: s.blocked ?? false,
        ragStatus: s.rag ?? RagStatus.GREEN,
        sprintId: s.sprintName ? id(this.sprintIds, s.sprintName, 'sprint') : undefined,
        piId: s.piId,
        createdAt: created,
        updatedAt: lastTouch,
        labels: s.labels?.length ? { create: s.labels.map((n) => ({ labelId: id(this.labelIds, n, 'label') })) } : undefined,
        components: s.components?.length ? { create: s.components.map((n) => ({ componentId: id(this.componentIds, n, 'component') })) } : undefined,
        versions: (s.fix?.length || s.affects?.length) ? {
          create: [
            ...(s.fix ?? []).map((n) => ({ versionId: id(this.versionIds, n, 'version'), isFix: true })),
            ...(s.affects ?? []).map((n) => ({ versionId: id(this.versionIds, n, 'version'), isFix: false })),
          ],
        } : undefined,
        watchers: {
          create: [...new Map([s.reporter, ...(s.assignee ? [s.assignee] : []), ...(s.watchers ?? [])].map((u) => [u.id, u])).values()]
            .map((u) => ({ userId: u.id, createdAt: created })),
        },
        customFieldValues: s.custom ? {
          create: Object.entries(s.custom).map(([k, value]) => ({ fieldId: id(this.fieldIds, k, 'custom field'), value })),
        } : undefined,
      },
    });

    // Plausible history: created → assigned → walked through the workflow.
    const steps = FLOW.indexOf(status);
    const span = (created.getTime() - lastTouch.getTime()) / (steps + 2);
    const at = (i: number) => new Date(created.getTime() - span * i);
    const history: { field: string; fromValue: string | null; toValue: string | null; userId: string; createdAt: Date }[] = [
      { field: 'created', fromValue: null, toValue: key, userId: s.reporter.id, createdAt: created },
    ];
    if (s.assignee) history.push({ field: 'assignee', fromValue: null, toValue: s.assignee.name, userId: s.reporter.id, createdAt: at(0.5) });
    for (let i = 1; i <= steps; i++) {
      history.push({ field: 'status', fromValue: FLOW[i - 1], toValue: FLOW[i], userId: (s.assignee ?? s.reporter).id, createdAt: at(i) });
    }
    if (resolution) history.push({ field: 'resolution', fromValue: null, toValue: resolution, userId: (s.assignee ?? s.reporter).id, createdAt: at(steps) });
    await prisma.issueHistory.createMany({ data: history.map((h) => ({ ...h, issueId: issue.id })) });
    return issue;
  }
}

async function comment(issue: Issue, author: User, body: string, daysAgo: number, hours = 0) {
  const exists = await prisma.comment.findFirst({ where: { issueId: issue.id, body } });
  if (exists) return;
  const at = ago(daysAgo, hours);
  await prisma.comment.create({ data: { issueId: issue.id, authorId: author.id, body, createdAt: at, updatedAt: at } });
  await prisma.issueWatcher.upsert({
    where: { issueId_userId: { issueId: issue.id, userId: author.id } },
    update: {},
    create: { issueId: issue.id, userId: author.id },
  });
}

const LINK_TEXT: Record<LinkType, [string, string]> = {
  BLOCKS: ['blocks', 'is blocked by'],
  DEPENDS_ON: ['depends on', 'is depended on by'],
  RELATES_TO: ['relates to', 'relates to'],
  PARENT_LINK: ['is parent of', 'is child of'],
};

async function link(source: Issue, target: Issue, type: LinkType, by: User, daysAgo: number) {
  const exists = await prisma.issueLink.findUnique({ where: { sourceId_targetId_type: { sourceId: source.id, targetId: target.id, type } } });
  if (exists) return;
  const at = ago(daysAgo);
  await prisma.issueLink.create({ data: { sourceId: source.id, targetId: target.id, type, createdAt: at } });
  await prisma.issueHistory.createMany({
    data: [
      { issueId: source.id, userId: by.id, field: 'link', toValue: `${LINK_TEXT[type][0]} ${target.key}`, createdAt: at },
      { issueId: target.id, userId: by.id, field: 'link', toValue: `${LINK_TEXT[type][1]} ${source.key}`, createdAt: at },
    ],
  });
}

async function worklog(issue: Issue, user: User, minutes: number, text: string, daysAgo: number) {
  const exists = await prisma.workLog.findFirst({ where: { issueId: issue.id, userId: user.id, comment: text } });
  if (exists) return;
  await prisma.workLog.create({ data: { issueId: issue.id, userId: user.id, timeSpentMinutes: minutes, comment: text, createdAt: ago(daysAgo) } });
}

async function filter(owner: User, name: string, jql: string, shared: boolean, description?: string) {
  const exists = await prisma.savedFilter.findFirst({ where: { ownerId: owner.id, name } });
  if (!exists) await prisma.savedFilter.create({ data: { ownerId: owner.id, name, jql, shared, description } });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);
  const byEmail = async (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });

  for (const p of PEOPLE) {
    await prisma.user.upsert({ where: { email: p.email }, update: {}, create: { ...p, passwordHash } });
  }
  const admin = await byEmail('admin@jiratech.local');
  const maria = await byEmail('pm@jiratech.local');
  const andreas = await byEmail('dev@jiratech.local');
  const alex = await byEmail('qa@jiratech.local');
  const [elena, nikos, sofia, daniel, katerina, marcus, lina] = await Promise.all(PEOPLE.map((p) => byEmail(p.email)));

  // ── PAY: Payments Platform ────────────────────────────────────────────────
  const pay = await prisma.project.upsert({
    where: { key: 'PAY' },
    update: {},
    create: {
      key: 'PAY',
      name: 'Payments Platform',
      description: 'Checkout, wallets and payment-provider integrations for all brands. PCI-scoped: never paste card data into tickets.',
      leadId: elena.id,
      strictHierarchy: false,
    },
  });
  const P = await new Builder(pay.id, 'PAY').load();
  await P.labels(['pci', 'backend', 'frontend', 'tech-debt', 'customer-reported', 'q4-goal']);
  await P.components([
    { name: 'Checkout', lead: nikos },
    { name: 'Wallet', lead: lina },
    { name: 'Fraud Detection', lead: elena },
    { name: 'API Gateway', lead: andreas },
    { name: 'Reporting' },
  ]);
  await P.versions([
    { name: '2.4.0', released: true, releaseDate: ago(40), description: 'Saved cards' },
    { name: '2.5.0', released: true, releaseDate: ago(12), description: 'Refund flow' },
    { name: '2.6.0', releaseDate: ago(-14), description: 'Apple Pay and Google Pay' },
    { name: '3.0.0', releaseDate: ago(-75), description: 'Multi-currency wallet' },
  ]);
  await P.fields([
    { key: 'customer', name: 'Customer / brand', type: 'TEXT', order: 1 },
    { key: 'severity', name: 'Severity', type: 'SELECT', options: ['S1 - Outage', 'S2 - Major', 'S3 - Minor', 'S4 - Cosmetic'], order: 2 },
  ]);

  const payEpicWallets = await P.issue({
    type: IssueType.EPIC, summary: 'Digital wallets: Apple Pay and Google Pay', epicName: 'Digital wallets',
    description: 'Let customers pay with Apple Pay and Google Pay on web and in the mobile apps.\n\nSuccess: 25% of mobile deposits via wallets within 3 months of launch.',
    status: 'DOING', priority: Priority.HIGH, reporter: katerina, assignee: elena, createdDaysAgo: 38, labels: ['q4-goal'], fix: ['2.6.0'],
    watchers: [maria, daniel],
  });
  const payEpicMulti = await P.issue({
    type: IssueType.EPIC, summary: 'Multi-currency wallet', epicName: 'Multi-currency',
    description: 'Hold balances in EUR, GBP and USD with live FX conversion between them.',
    status: 'TO_DO', priority: Priority.MEDIUM, reporter: katerina, assignee: lina, createdDaysAgo: 30, fix: ['3.0.0'],
  });
  const payEpicFraud = await P.issue({
    type: IssueType.EPIC, summary: 'Fraud scoring v2', epicName: 'Fraud v2',
    description: 'Replace the rules engine with the ML scoring service. Keep false positives under 0.5%.',
    status: 'BACKLOG', priority: Priority.MEDIUM, reporter: elena, createdDaysAgo: 22, labels: ['backend'],
  });

  const applePay = await P.issue({
    type: IssueType.STORY, parent: payEpicWallets, summary: 'Pay with Apple Pay on the web checkout',
    description: 'As a customer on Safari, I want to pay with Apple Pay so I don\'t have to type my card details.\n\nAcceptance criteria:\n- Button only shows when the device supports Apple Pay\n- Payment sheet shows the merchant name and the total\n- Declines show the same error message as cards',
    status: 'DOING', priority: Priority.HIGH, reporter: katerina, assignee: nikos, createdDaysAgo: 26, estimate: 24,
    labels: ['frontend', 'q4-goal'], components: ['Checkout'], fix: ['2.6.0'], watchers: [sofia],
  });
  const googlePay = await P.issue({
    type: IssueType.STORY, parent: payEpicWallets, summary: 'Pay with Google Pay on Android and Chrome',
    description: 'Same as the Apple Pay story, for Google Pay. Use the PSP\'s hosted tokenisation so we stay out of PCI scope.',
    status: 'TO_DO', priority: Priority.HIGH, reporter: katerina, assignee: lina, createdDaysAgo: 26, estimate: 20,
    labels: ['frontend', 'q4-goal'], components: ['Checkout'], fix: ['2.6.0'],
  });
  const merchantId = await P.issue({
    type: IssueType.TASK, parent: payEpicWallets, summary: 'Register Apple Pay merchant ID and domain verification',
    description: 'Needs the production domain verification file hosted at /.well-known/apple-developer-merchantid-domain-association.',
    status: 'CLOSED', priority: Priority.HIGHEST, reporter: elena, assignee: andreas, createdDaysAgo: 25, estimate: 4, components: ['API Gateway'],
  });
  const walletTokens = await P.issue({
    type: IssueType.TASK, parent: payEpicWallets, summary: 'Store wallet payment tokens in the vault',
    status: 'DOING', priority: Priority.HIGH, reporter: elena, assignee: lina, createdDaysAgo: 20, estimate: 12,
    labels: ['backend', 'pci'], components: ['Wallet'], fix: ['2.6.0'], blocked: true, rag: RagStatus.AMBER,
    description: 'Blocked until the vault team enables the new token type in production.',
  });
  for (const [summary, assignee, status] of [
    ['Apple Pay button component', nikos, 'CLOSED'],
    ['Payment sheet error handling', nikos, 'DOING'],
    ['E2E tests for Apple Pay happy path', sofia, 'TO_DO'],
  ] as const) {
    await P.issue({
      type: IssueType.SUB_TASK, parent: applePay, summary, status, reporter: nikos, assignee,
      createdDaysAgo: 18, estimate: 6, components: ['Checkout'],
    });
  }

  const refundBug = await P.issue({
    type: IssueType.DEFECT, summary: 'Partial refunds are shown twice in the transaction history',
    description: 'Steps to reproduce:\n1. Make a €50 card deposit\n2. Refund €20 from the back office\n3. Open Account → History\n\nExpected: one refund line of €20\nActual: two lines of €20, balance is correct',
    status: 'TO_DO', priority: Priority.HIGH, reporter: sofia, assignee: lina, createdDaysAgo: 9,
    labels: ['customer-reported'], components: ['Reporting', 'Wallet'], affects: ['2.5.0'], fix: ['2.6.0'],
    custom: { customer: 'Brand A (UK)', severity: 'S3 - Minor' },
  });
  const timeoutBug = await P.issue({
    type: IssueType.DEFECT, summary: 'Checkout times out after 30s when the 3-D Secure page is slow',
    description: 'The gateway closes the connection at 30s while the bank\'s 3DS page is still open. Customers get charged but see an error.',
    status: 'DOING', priority: Priority.HIGHEST, reporter: daniel, assignee: andreas, createdDaysAgo: 4,
    labels: ['backend', 'customer-reported'], components: ['API Gateway', 'Checkout'], affects: ['2.5.0'], fix: ['2.6.0'],
    rag: RagStatus.RED, watchers: [elena, maria, katerina], custom: { customer: 'All brands', severity: 'S2 - Major' },
  });
  const fxRates = await P.issue({
    type: IssueType.STORY, parent: payEpicMulti, summary: 'Show live FX rate before converting between wallets',
    status: 'TO_DO', priority: Priority.MEDIUM, reporter: katerina, assignee: lina, createdDaysAgo: 15, estimate: 16,
    components: ['Wallet'], fix: ['3.0.0'], labels: ['frontend'],
  });
  await P.issue({
    type: IssueType.STORY, parent: payEpicMulti, summary: 'Hold balances in GBP and USD',
    status: 'BACKLOG', priority: Priority.MEDIUM, reporter: katerina, createdDaysAgo: 15, estimate: 32,
    components: ['Wallet'], fix: ['3.0.0'], labels: ['backend'],
  });
  const fraudModel = await P.issue({
    type: IssueType.STORY, parent: payEpicFraud, summary: 'Call the ML scoring service on every deposit',
    status: 'BACKLOG', priority: Priority.LOW, reporter: elena, createdDaysAgo: 12, estimate: 20, components: ['Fraud Detection'],
  });
  await P.issue({
    type: IssueType.TASK, summary: 'Upgrade the PSP SDK to v9',
    description: 'v8 is end-of-life in January. Changelog: idempotency keys are now required on refunds.',
    status: 'TO_DO', priority: Priority.MEDIUM, reporter: andreas, assignee: nikos, createdDaysAgo: 7, estimate: 8,
    labels: ['tech-debt', 'backend'], components: ['API Gateway'],
  });
  await P.issue({
    type: IssueType.TASK, summary: 'Remove the legacy card form (v1)',
    status: 'BACKLOG', priority: Priority.LOWEST, reporter: nikos, createdDaysAgo: 33, labels: ['tech-debt', 'frontend'], components: ['Checkout'],
  });
  await P.issue({
    type: IssueType.STORY, summary: 'Saved cards: let customers set a default card',
    status: 'CLOSED', priority: Priority.MEDIUM, reporter: katerina, assignee: nikos, createdDaysAgo: 44, estimate: 10,
    components: ['Checkout'], fix: ['2.4.0'], labels: ['frontend'],
  });
  await P.issue({
    type: IssueType.STORY, summary: 'Refund flow in the back office',
    status: 'CLOSED', priority: Priority.HIGH, reporter: katerina, assignee: lina, createdDaysAgo: 35, estimate: 28,
    components: ['Wallet', 'Reporting'], fix: ['2.5.0'],
  });
  await P.issue({
    type: IssueType.DEFECT, summary: 'Currency symbol missing on the receipt email',
    status: 'CLOSED', resolution: IssueResolution.REJECTED, priority: Priority.LOW, reporter: sofia, assignee: nikos, createdDaysAgo: 19,
    description: 'Closed as won\'t fix: the email template is owned by CRM and already fixed on their side.',
  });
  await P.issue({
    type: IssueType.TASK, summary: 'Monthly PCI DSS evidence pack for October',
    status: 'TO_DO', priority: Priority.HIGH, reporter: elena, assignee: daniel, createdDaysAgo: 2, labels: ['pci'],
  });

  // ── MOB: Mobile App ───────────────────────────────────────────────────────
  const mob = await prisma.project.upsert({
    where: { key: 'MOB' },
    update: {},
    create: {
      key: 'MOB',
      name: 'Mobile App',
      description: 'iOS and Android sportsbook apps.',
      leadId: katerina.id,
      strictHierarchy: false,
    },
  });
  const M = await new Builder(mob.id, 'MOB').load();
  await M.labels(['ux', 'crash', 'accessibility', 'performance', 'release-blocker']);
  await M.components([
    { name: 'iOS', lead: nikos },
    { name: 'Android', lead: lina },
    { name: 'Push Notifications' },
    { name: 'Bet Slip', lead: andreas },
  ]);
  await M.versions([
    { name: '5.1', released: true, releaseDate: ago(21) },
    { name: '5.2', releaseDate: ago(-10) },
    { name: '5.3', releaseDate: ago(-40) },
  ]);

  const mobEpicA11y = await M.issue({
    type: IssueType.EPIC, summary: 'Accessibility: WCAG 2.2 AA for the bet slip', epicName: 'A11y bet slip',
    status: 'DOING', priority: Priority.HIGH, reporter: katerina, assignee: marcus, createdDaysAgo: 28,
    labels: ['accessibility'], fix: ['5.2'],
  });
  const crash = await M.issue({
    type: IssueType.DEFECT, summary: 'App crashes when opening a live match with more than 200 markets',
    description: 'Crashlytics: OutOfMemoryError in MarketListAdapter. 1.2% of Android sessions on 5.1.\n\nDevice: Samsung A12, Android 11.',
    status: 'DOING', priority: Priority.HIGHEST, reporter: sofia, assignee: lina, createdDaysAgo: 6,
    labels: ['crash', 'release-blocker'], components: ['Android'], affects: ['5.1'], fix: ['5.2'], rag: RagStatus.RED,
    watchers: [katerina, daniel, marcus],
  });
  const voiceOver = await M.issue({
    type: IssueType.STORY, parent: mobEpicA11y, summary: 'VoiceOver reads odds and selections on the bet slip',
    status: 'DOING', priority: Priority.HIGH, reporter: katerina, assignee: nikos, createdDaysAgo: 20, estimate: 12,
    labels: ['accessibility'], components: ['iOS', 'Bet Slip'], fix: ['5.2'],
  });
  await M.issue({
    type: IssueType.STORY, parent: mobEpicA11y, summary: 'TalkBack support for stake input',
    status: 'TO_DO', priority: Priority.HIGH, reporter: katerina, assignee: lina, createdDaysAgo: 20, estimate: 10,
    labels: ['accessibility'], components: ['Android', 'Bet Slip'], fix: ['5.2'],
  });
  await M.issue({
    type: IssueType.TASK, parent: mobEpicA11y, summary: 'Colour-contrast audit of odds buttons',
    status: 'CLOSED', priority: Priority.MEDIUM, reporter: marcus, assignee: sofia, createdDaysAgo: 24, estimate: 4,
    labels: ['accessibility', 'ux'],
  });
  const push = await M.issue({
    type: IssueType.STORY, summary: 'Push notification when a bet is settled',
    status: 'TO_DO', priority: Priority.MEDIUM, reporter: katerina, assignee: andreas, createdDaysAgo: 14, estimate: 16,
    components: ['Push Notifications', 'iOS', 'Android'], fix: ['5.3'], labels: ['ux'],
  });
  await M.issue({
    type: IssueType.TASK, summary: 'Cut the 5.2 release branch and freeze translations',
    status: 'TO_DO', priority: Priority.HIGH, reporter: daniel, assignee: daniel, createdDaysAgo: 3, fix: ['5.2'],
  });
  await M.issue({
    type: IssueType.DEFECT, summary: 'Bet slip total overlaps the keyboard on small iPhones',
    status: 'TO_DO', priority: Priority.MEDIUM, reporter: sofia, assignee: nikos, createdDaysAgo: 5,
    labels: ['ux'], components: ['iOS', 'Bet Slip'], affects: ['5.1'], fix: ['5.2'],
  });
  await M.issue({
    type: IssueType.STORY, summary: 'Cold start under 2 seconds on mid-range Android',
    status: 'BACKLOG', priority: Priority.LOW, reporter: katerina, createdDaysAgo: 17, labels: ['performance'], components: ['Android'],
  });
  await M.issue({
    type: IssueType.STORY, summary: 'Face ID login',
    status: 'CLOSED', priority: Priority.MEDIUM, reporter: katerina, assignee: nikos, createdDaysAgo: 40, estimate: 14,
    components: ['iOS'], fix: ['5.1'],
  });
  await M.issue({
    type: IssueType.DEFECT, summary: 'Dark mode: market headers unreadable',
    status: 'CLOSED', priority: Priority.LOW, reporter: alex, assignee: lina, createdDaysAgo: 27, components: ['Android'], fix: ['5.1'], labels: ['ux'],
  });

  // ── SPORTS: more work under the existing epics (strict hierarchy) ─────────
  const sports = await prisma.project.findUniqueOrThrow({ where: { key: 'SPORTS' } });
  const S = await new Builder(sports.id, 'SPORTS').load();
  await S.labels(['trading', 'odds-feed']);
  const sportsIssue = (key: string) => prisma.issue.findUniqueOrThrow({ where: { key } });
  const overaskEpic = await sportsIssue('SPORTS-1');
  const overaskStory = await sportsIssue('SPORTS-2');
  const incidentEpic = await sportsIssue('SPORTS-5');
  const releaseEpic = await sportsIssue('SPORTS-7');
  const pi = overaskEpic.piId ?? undefined;

  const cashout = await S.issue({
    type: IssueType.STORY, parent: overaskEpic, summary: 'As a trader, I want to approve overasks from the live dashboard',
    description: 'Show pending overask requests in the trading dashboard with Accept / Counter-offer / Reject actions.',
    status: 'TO_DO', priority: Priority.HIGH, reporter: maria, assignee: andreas, createdDaysAgo: 16, estimate: 20,
    components: ['@MOJ', 'GBT (genbetTrading)'], labels: ['trading', 'FT2'], fix: ['GBT-26.12.0'], sprintName: 'Sprint 3', piId: pi,
    custom: { priority_justification: 'Critical', progress_status: 'Not Started' },
  });
  const counterOffer = await S.issue({
    type: IssueType.STORY, parent: overaskEpic, summary: 'As a customer, I want to accept a counter-offer on my bet',
    status: 'BACKLOG', priority: Priority.MEDIUM, reporter: maria, createdDaysAgo: 16, estimate: 16,
    components: ['@MOJ'], labels: ['FT2'], sprintName: 'Sprint 4', piId: pi,
  });
  for (const [type, summary, assignee, status] of [
    [IssueType.CODE, 'Overask queue endpoint', andreas, 'CLOSED'],
    [IssueType.CODE_REVIEW, 'Review overask queue endpoint', elena, 'DOING'],
    [IssueType.TEST_CASE, 'Test cases for overask approval', alex, 'TO_DO'],
    [IssueType.DOCUMENTATION, 'Trader guide: approving overasks', marcus, 'BACKLOG'],
  ] as const) {
    await S.issue({
      type, summary, parent: cashout, status, assignee, reporter: andreas, createdDaysAgo: 12, estimate: 6,
      components: ['@MOJ'], sprintName: 'Sprint 3', piId: pi,
    });
  }
  const oddsBug = await S.issue({
    type: IssueType.DEFECT, parent: incidentEpic, summary: 'Odds feed drops Asian handicap markets after a reconnect',
    description: 'After the feed reconnects, AH markets stay suspended until a manual resync. Seen 3 times this week during peak.',
    status: 'DOING', priority: Priority.HIGHEST, reporter: alex, assignee: andreas, createdDaysAgo: 3,
    components: ['@DB', 'GBO (genbetOdds)'], labels: ['odds-feed'], affects: ['GBO-26.12.0'], fix: ['GBO-26.12.0'],
    rag: RagStatus.RED, blocked: false, custom: { customer: 'Brand B', priority_justification: 'Critical', progress_status: 'In Progress' },
    watchers: [maria, elena],
  });
  await S.issue({
    type: IssueType.TASK, parent: incidentEpic, summary: 'Add alerting when a feed is suspended for more than 60s',
    status: 'TO_DO', priority: Priority.HIGH, reporter: maria, assignee: nikos, createdDaysAgo: 2, estimate: 6,
    components: ['@DEVOPS'], labels: ['odds-feed'], rag: RagStatus.AMBER,
  });
  await S.issue({
    type: IssueType.DEFECT, parent: overaskStory, summary: 'Overask limit ignores the customer\'s stake factor',
    status: 'CLOSED', priority: Priority.HIGH, reporter: alex, assignee: andreas, createdDaysAgo: 21,
    components: ['@MOJ'], affects: ['GBT-26.12.0'], fix: ['GBT-26.12.0'], custom: { reopen_count: '1' },
  });
  await S.issue({
    type: IssueType.TEST_RUN, parent: releaseEpic, summary: 'Regression run for GB26.12.0',
    status: 'TO_DO', priority: Priority.HIGH, reporter: daniel, assignee: alex, createdDaysAgo: 4, components: ['@QA'],
    fix: ['1.62.0.0'],
  });
  await S.issue({
    type: IssueType.DEPLOYMENT, parent: releaseEpic, summary: 'Deploy GB26.12.0 to production',
    status: 'BACKLOG', priority: Priority.HIGH, reporter: daniel, assignee: daniel, createdDaysAgo: 4, components: ['@DEVOPS'],
    fix: ['1.62.0.0'],
  });

  // ── Work for the admin account, so "assigned to me" views have content ────
  const adminReview = await P.issue({
    type: IssueType.TASK, summary: 'Approve the Q4 payment provider fee renegotiation',
    description: 'Finance needs sign-off by the end of the month. Proposal is attached to the Confluence page.',
    status: 'TO_DO', priority: Priority.HIGH, reporter: elena, assignee: admin, createdDaysAgo: 3, labels: ['q4-goal'],
  });
  await M.issue({
    type: IssueType.TASK, summary: 'Approve App Store listing text for 5.2',
    status: 'DOING', priority: Priority.MEDIUM, reporter: katerina, assignee: admin, createdDaysAgo: 2, fix: ['5.2'],
  });
  await S.issue({
    type: IssueType.TASK, parent: incidentEpic, summary: 'Grant on-call engineers access to the feed admin console',
    status: 'BACKLOG', priority: Priority.LOW, reporter: maria, assignee: admin, createdDaysAgo: 5, components: ['@DEVOPS'],
  });
  await comment(adminReview, elena, '@admin@jiratech.local the new fee schedule saves about 0.12% per transaction. Can you approve by Friday?', 2);

  // ── Conversations ─────────────────────────────────────────────────────────
  await comment(applePay, nikos, 'Button and payment sheet are working on staging. Still need the merchant ID in production before we can test end to end.', 10, 5);
  await comment(applePay, elena, `Merchant ID is registered (${merchantId.key}). @nikos@jiratech.local you should be unblocked now.`, 9, 2);
  await comment(applePay, sofia, 'Found an issue: the sheet shows "JiraTech Ltd" instead of the brand name. Is that expected?', 6, 4);
  await comment(applePay, katerina, 'Not expected — it must show the brand. @nikos@jiratech.local can you take that as part of this story?', 6, 1);
  await comment(applePay, nikos, 'Yes, fixed in the latest build. Display name now comes from the brand config.', 5, 3);

  await comment(timeoutBug, daniel, '14 customer complaints since Friday. This needs to go out as a hotfix, not wait for 2.6.0.', 4, 2);
  await comment(timeoutBug, andreas, 'Root cause: the gateway idle timeout is 30s and the 3DS redirect keeps the connection open. Raising it to 120s for the /3ds routes only.', 3, 6);
  await comment(timeoutBug, elena, '@daniel@jiratech.local agreed — please plan a hotfix release once Andreas has a PR.', 3, 2);
  await comment(timeoutBug, andreas, 'PR is up. @sofia@jiratech.local could you run the slow-3DS test suite against it?', 1, 5);

  await comment(walletTokens, lina, 'Waiting on the vault team (their ticket VLT-1182). They expect to enable the token type next Tuesday.', 7);
  await comment(walletTokens, elena, 'Marked as blocked and amber. Let\'s re-check on Tuesday.', 6);

  await comment(refundBug, sofia, 'Reproduced on staging with any partial refund. Full refunds are fine.', 8);
  await comment(refundBug, lina, 'The history API returns both the refund and the refund-reversal event. Will filter reversals out.', 5);

  await comment(crash, sofia, 'Crash rate is 1.2% of Android sessions on 5.1 — highest in the app. Attaching the Crashlytics trace to the ticket.', 6);
  await comment(crash, lina, 'We inflate every market row up front. Switching the list to paging should fix it.', 4);
  await comment(crash, katerina, 'This is a release blocker for 5.2. @daniel@jiratech.local please don\'t cut the branch without it.', 3);
  await comment(crash, daniel, 'Noted. Holding the branch cut until this is merged.', 2);

  await comment(oddsBug, alex, 'Happened again at 20:14 during the derby. Resync fixed it within 2 minutes but we were suspended for 9 minutes before anyone noticed.', 2);
  await comment(oddsBug, maria, 'Raised the priority. I\'ve also created a task for alerting so we notice faster next time.', 2);
  await comment(oddsBug, andreas, 'Reconnect handler is skipping the AH snapshot because of a stale sequence number. Fix in progress.', 1);

  await comment(cashout, maria, 'Traders asked for keyboard shortcuts: A to accept, R to reject.', 10);
  await comment(cashout, andreas, 'Makes sense, adding it to the acceptance criteria.', 9);

  await comment(voiceOver, nikos, 'Odds are read as "two point five" — accessibility team prefers "2.5". Using an accessibility label to fix.', 8);
  await comment(push, andreas, 'Depends on the settlement events being published to the notification service.', 6);

  // ── Links (including cross-project) ───────────────────────────────────────
  await link(merchantId, applePay, LinkType.BLOCKS, elena, 24);
  await link(walletTokens, googlePay, LinkType.BLOCKS, lina, 18);
  await link(applePay, voiceOver, LinkType.RELATES_TO, katerina, 15);
  await link(timeoutBug, applePay, LinkType.RELATES_TO, andreas, 3);
  await link(fxRates, refundBug, LinkType.RELATES_TO, lina, 5);
  await link(fraudModel, timeoutBug, LinkType.DEPENDS_ON, elena, 2);
  await link(crash, oddsBug, LinkType.RELATES_TO, sofia, 2);
  await link(cashout, counterOffer, LinkType.BLOCKS, maria, 14);
  await link(push, crash, LinkType.DEPENDS_ON, katerina, 3);

  // ── Work logged ───────────────────────────────────────────────────────────
  await worklog(applePay, nikos, 300, 'Payment sheet integration', 9);
  await worklog(applePay, nikos, 240, 'Brand display name fix', 5);
  await worklog(applePay, sofia, 90, 'Exploratory testing on iOS Safari', 6);
  await worklog(merchantId, andreas, 150, 'Domain verification and certificates', 23);
  await worklog(timeoutBug, andreas, 360, 'Investigation and gateway config change', 2);
  await worklog(crash, lina, 420, 'Paging adapter for the market list', 3);
  await worklog(oddsBug, andreas, 180, 'Reproduced reconnect in staging', 1);
  await worklog(voiceOver, nikos, 210, 'Accessibility labels for odds', 7);

  // ── Project roles ─────────────────────────────────────────────────────────
  // PAY: everyone can read, only the team can change things. MOB: private to the app team.
  // SPORTS keeps the open default (everyone is a member).
  const setRoles = async (projectId: string, defaultAccess: ProjectAccess, roles: [User, ProjectRole][]) => {
    await prisma.project.update({ where: { id: projectId }, data: { defaultAccess } });
    for (const [u, role] of roles) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: u.id } },
        update: {},
        create: { projectId, userId: u.id, role },
      });
    }
  };
  await setRoles(pay.id, ProjectAccess.VIEWER, [
    [elena, ProjectRole.ADMIN], [nikos, ProjectRole.MEMBER], [lina, ProjectRole.MEMBER], [andreas, ProjectRole.MEMBER],
    [sofia, ProjectRole.MEMBER], [katerina, ProjectRole.MEMBER], [daniel, ProjectRole.VIEWER],
  ]);
  await setRoles(mob.id, ProjectAccess.NONE, [
    [katerina, ProjectRole.ADMIN], [nikos, ProjectRole.MEMBER], [lina, ProjectRole.MEMBER], [andreas, ProjectRole.MEMBER],
    [sofia, ProjectRole.MEMBER], [marcus, ProjectRole.MEMBER], [daniel, ProjectRole.VIEWER], [alex, ProjectRole.VIEWER],
  ]);

  // ── Saved filters ─────────────────────────────────────────────────────────
  await filter(admin, 'Release blockers', 'labels = release-blocker OR (priority = Highest AND status != CLOSED) ORDER BY priority DESC', true,
    'Anything that could stop a release, across all projects');
  await filter(admin, 'My open work', 'assignee = currentUser() AND status != CLOSED ORDER BY priority DESC', false);
  await filter(admin, 'Created this week', 'created >= -7d ORDER BY created DESC', false);
  await filter(maria, 'SPORTS defects', 'project = SPORTS AND type = Defect ORDER BY priority DESC', true);
  await filter(elena, 'PAY blocked or at risk', 'project = PAY AND (blocked = true OR priority = Highest) AND status != CLOSED', true);
  await filter(katerina, 'MOB 5.2 scope', 'project = MOB AND fixVersion = 5.2 ORDER BY status ASC', true);

  const counts = await Promise.all([
    prisma.user.count(), prisma.project.count(), prisma.issue.count(), prisma.comment.count(),
    prisma.issueLink.count(), prisma.workLog.count(), prisma.savedFilter.count(),
  ]);
  console.log(`Demo data ready: ${counts[0]} people, ${counts[1]} projects, ${counts[2]} issues, ${counts[3]} comments, `
    + `${counts[4]} links, ${counts[5]} work logs, ${counts[6]} saved filters.`);
  console.log('All demo users log in with the same password as the base seed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
