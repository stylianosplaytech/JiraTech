import {
  PrismaClient, UserRole, ComponentType, IssueType, Priority, IssueStatus, CustomFieldType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding JiraTech database...');

  const passwordHash = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@jiratech.local' },
    update: { name: 'System Admin' },
    create: {
      email: 'admin@jiratech.local',
      name: 'System Admin',
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  const pm = await prisma.user.upsert({
    where: { email: 'pm@jiratech.local' },
    update: { name: 'Maria Papadopoulou' },
    create: {
      email: 'pm@jiratech.local',
      name: 'Maria Papadopoulou',
      passwordHash,
      role: UserRole.PROGRAM_MANAGER,
    },
  });

  const dev = await prisma.user.upsert({
    where: { email: 'dev@jiratech.local' },
    update: { name: 'Andreas Eracleous' },
    create: {
      email: 'dev@jiratech.local',
      name: 'Andreas Eracleous',
      passwordHash,
      role: UserRole.DEVELOPER,
    },
  });

  const qa = await prisma.user.upsert({
    where: { email: 'qa@jiratech.local' },
    update: { name: 'Alexander Deriabin' },
    create: {
      email: 'qa@jiratech.local',
      name: 'Alexander Deriabin',
      passwordHash,
      role: UserRole.QA_SPECIALIST,
    },
  });

  const project = await prisma.project.upsert({
    where: { key: 'SPORTS' },
    update: {},
    create: { key: 'SPORTS', name: 'Sports Development' },
  });

  const teams = await Promise.all([
    prisma.component.upsert({
      where: { projectId_name: { projectId: project.id, name: '@MOJ' } },
      update: {},
      create: { name: '@MOJ', type: ComponentType.TEAM, projectId: project.id, leadId: dev.id },
    }),
    prisma.component.upsert({
      where: { projectId_name: { projectId: project.id, name: '@QA' } },
      update: {},
      create: { name: '@QA', type: ComponentType.TEAM, projectId: project.id, leadId: qa.id },
    }),
    prisma.component.upsert({
      where: { projectId_name: { projectId: project.id, name: '@DEVOPS' } },
      update: {},
      create: { name: '@DEVOPS', type: ComponentType.TEAM, projectId: project.id },
    }),
    prisma.component.upsert({
      where: { projectId_name: { projectId: project.id, name: '@DB' } },
      update: {},
      create: { name: '@DB', type: ComponentType.TEAM, projectId: project.id },
    }),
  ]);

  await prisma.component.upsert({
    where: { projectId_name: { projectId: project.id, name: 'GBT (genbetTrading)' } },
    update: {},
    create: { name: 'GBT (genbetTrading)', type: ComponentType.SERVICE, projectId: project.id },
  });

  await prisma.component.upsert({
    where: { projectId_name: { projectId: project.id, name: 'GBO (genbetOdds)' } },
    update: {},
    create: { name: 'GBO (genbetOdds)', type: ComponentType.SERVICE, projectId: project.id },
  });

  await prisma.component.upsert({
    where: { projectId_name: { projectId: project.id, name: 'GEN (genbet)' } },
    update: {},
    create: { name: 'GEN (genbet)', type: ComponentType.RELEASE_TRAIN, projectId: project.id },
  });

  const versions = await Promise.all([
    prisma.version.upsert({
      where: { projectId_name: { projectId: project.id, name: 'GBT-26.12.0' } },
      update: {},
      create: { name: 'GBT-26.12.0', projectId: project.id },
    }),
    prisma.version.upsert({
      where: { projectId_name: { projectId: project.id, name: 'GBO-26.12.0' } },
      update: {},
      create: { name: 'GBO-26.12.0', projectId: project.id },
    }),
    prisma.version.upsert({
      where: { projectId_name: { projectId: project.id, name: '1.62.0.0' } },
      update: {},
      create: { name: '1.62.0.0', projectId: project.id },
    }),
  ]);

  const labels = await Promise.all([
    prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name: 'FT2' } },
      update: {},
      create: { name: 'FT2', projectId: project.id },
    }),
    prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name: 'SEO' } },
      update: {},
      create: { name: 'SEO', projectId: project.id },
    }),
    prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name: 'YBET' } },
      update: {},
      create: { name: 'YBET', projectId: project.id },
    }),
  ]);

  const customFieldDefs = [
    { key: 'priority_justification', name: 'Priority Justification', type: CustomFieldType.SELECT, options: ['YBET', 'Critical', 'Standard'], order: 1 },
    { key: 'customer', name: '[pts] Customer', type: CustomFieldType.TEXT, order: 2 },
    { key: 'customer_account', name: 'Customer Account', type: CustomFieldType.TEXT, order: 3 },
    { key: 'target_version', name: '[pts] Target Version/s', type: CustomFieldType.VERSION, order: 4 },
    { key: 'progress_status', name: 'Progress Status', type: CustomFieldType.SELECT, options: ['Not Started', 'In Progress', 'Done'], order: 5 },
    { key: 'reopen_count', name: 'Reopen Count', type: CustomFieldType.NUMBER, order: 6 },
    { key: 'inherited_account', name: 'CACHED Inherited Account', type: CustomFieldType.NUMBER, order: 7 },
  ];

  const fieldMap: Record<string, string> = {};
  for (const def of customFieldDefs) {
    const field = await prisma.customFieldDefinition.upsert({
      where: { projectId_key: { projectId: project.id, key: def.key } },
      update: { name: def.name, type: def.type, order: def.order },
      create: {
        projectId: project.id,
        key: def.key,
        name: def.name,
        type: def.type,
        options: def.options ? JSON.stringify(def.options) : null,
        order: def.order,
      },
    });
    fieldMap[def.key] = field.id;
  }

  const existingCount = await prisma.issue.count({ where: { projectId: project.id } });
  if (existingCount === 0) {
    const pi = await prisma.programIncrement.create({
      data: {
        name: 'PI26.32',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-11-30'),
        projectId: project.id,
        sprints: {
          create: [
            { name: 'Sprint 1', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-14') },
            { name: 'Sprint 2', startDate: new Date('2026-08-15'), endDate: new Date('2026-08-28') },
            { name: 'Sprint 3', startDate: new Date('2026-08-29'), endDate: new Date('2026-09-11') },
            { name: 'Sprint 4', startDate: new Date('2026-09-12'), endDate: new Date('2026-09-25') },
          ],
        },
      },
      include: { sprints: true },
    });

    const featureEpic = await prisma.issue.create({
      data: {
        key: 'SPORTS-1', number: 1, type: IssueType.FEATURE_EPIC,
        summary: 'In-play Overask v1 PI26.32', epicName: 'In-play Overask',
        status: IssueStatus.TO_DO, priority: Priority.HIGH,
        projectId: project.id, piId: pi.id, reporterId: pm.id,
        components: { create: [{ componentId: teams[0].id }, { componentId: teams[1].id }] },
        labels: { create: [{ labelId: labels[0].id }] },
      },
    });

    const story = await prisma.issue.create({
      data: {
        key: 'SPORTS-2', number: 2, type: IssueType.STORY,
        summary: 'As a trader, I want to set overask limits for in-play events, in order to manage risk',
        status: IssueStatus.TO_DO, priority: Priority.HIGHEST,
        projectId: project.id, parentId: featureEpic.id, piId: pi.id,
        reporterId: pm.id, assigneeId: dev.id, sprintId: pi.sprints[0].id,
        estimate: 40, remainingEstimate: 32,
        components: { create: [{ componentId: teams[0].id }] },
        labels: { create: [{ labelId: labels[0].id }] },
        watchers: { create: [{ userId: qa.id }, { userId: pm.id }] },
        versions: { create: [{ versionId: versions[2].id, isFix: false }] },
        customFieldValues: {
          create: [
            { fieldId: fieldMap.customer, value: '10bet' },
            { fieldId: fieldMap.customer_account, value: '10bet UK' },
            { fieldId: fieldMap.target_version, value: versions[2].id },
            { fieldId: fieldMap.progress_status, value: 'Not Started' },
            { fieldId: fieldMap.priority_justification, value: 'YBET' },
            { fieldId: fieldMap.reopen_count, value: '1' },
            { fieldId: fieldMap.inherited_account, value: '51747' },
          ],
        },
        workLogs: {
          create: [
            { userId: dev.id, timeSpentMinutes: 85, comment: 'Initial investigation' },
          ],
        },
      },
    });

    await prisma.issue.create({
      data: {
        key: 'SPORTS-3', number: 3, type: IssueType.ANALYSIS,
        summary: 'Analyse overask domain requirements',
        status: IssueStatus.DOING, priority: Priority.HIGH,
        projectId: project.id, parentId: story.id, piId: pi.id,
        reporterId: pm.id, assigneeId: dev.id, estimate: 8, remainingEstimate: 4,
        watchers: { create: [{ userId: pm.id }] },
      },
    });

    await prisma.issue.create({
      data: {
        key: 'SPORTS-4', number: 4, type: IssueType.CODE,
        summary: 'Implement overask limit API endpoint',
        status: IssueStatus.DOING, priority: Priority.HIGHEST,
        projectId: project.id, parentId: story.id, piId: pi.id,
        reporterId: pm.id, assigneeId: dev.id, estimate: 16,
        components: { create: [{ componentId: teams[0].id }] },
      },
    });

    const bauEpic = await prisma.issue.create({
      data: {
        key: 'SPORTS-5', number: 5, type: IssueType.BAU_EPIC,
        summary: 'Incident Management 2026', epicName: 'Incident Management',
        status: IssueStatus.DOING, priority: Priority.HIGH,
        projectId: project.id, reporterId: admin.id,
      },
    });

    await prisma.issue.create({
      data: {
        key: 'SPORTS-6', number: 6, type: IssueType.DEFECT,
        summary: 'In-play bet placement failing for football events',
        status: IssueStatus.DOING, priority: Priority.HIGHEST,
        projectId: project.id, parentId: bauEpic.id,
        reporterId: admin.id, assigneeId: dev.id, blocked: true,
        components: { create: [{ componentId: teams[2].id }] },
        labels: { create: [{ labelId: labels[1].id }] },
        watchers: { create: [{ userId: admin.id }] },
      },
    });

    const releaseEpic = await prisma.issue.create({
      data: {
        key: 'SPORTS-7', number: 7, type: IssueType.RELEASE_EPIC,
        summary: 'GB26.12.0', epicName: 'Genbet',
        status: IssueStatus.TO_DO, priority: Priority.HIGH,
        projectId: project.id, reporterId: pm.id,
      },
    });

    await prisma.issue.create({
      data: {
        key: 'SPORTS-8', number: 8, type: IssueType.RELEASE_CANDIDATE,
        summary: 'RC1 - Initial regression build',
        status: IssueStatus.TO_DO, priority: Priority.HIGH,
        projectId: project.id, parentId: releaseEpic.id, reporterId: pm.id,
        versions: { create: versions.slice(0, 2).map((v) => ({ versionId: v.id, isFix: true })) },
      },
    });

    await prisma.issueLink.create({
      data: {
        type: 'RELATES_TO',
        sourceId: story.id,
        targetId: featureEpic.id,
      },
    });
  } else {
    const story = await prisma.issue.findFirst({ where: { key: 'SPORTS-2' } });
    if (story) {
      await prisma.issueWatcher.upsert({
        where: { issueId_userId: { issueId: story.id, userId: qa.id } },
        update: {},
        create: { issueId: story.id, userId: qa.id },
      });
    }
  }

  console.log('Seed complete!');
  console.log('Login: admin@jiratech.local / admin123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
