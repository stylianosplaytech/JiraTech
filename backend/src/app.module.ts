import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AccessModule } from './access/access.module';
import { WorkflowModule } from './workflow/workflow.module';
import { AuthModule } from './auth/auth.module';
import { IssuesModule } from './issues/issues.module';
import { ComponentsModule } from './components/components.module';
import { PlanningModule } from './planning/planning.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { ReleasesModule } from './releases/releases.module';
import { IncidentsModule } from './incidents/incidents.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { BoardModule } from './board/board.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { LabelsModule } from './labels/labels.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { VersionsModule } from './versions/versions.module';
import { ProjectsModule } from './projects/projects.module';
import { SearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    AccessModule,
    WorkflowModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    SearchModule,
    NotificationsModule,
    IssuesModule,
    ComponentsModule,
    LabelsModule,
    CustomFieldsModule,
    VersionsModule,
    PlanningModule,
    SchedulingModule,
    ReleasesModule,
    IncidentsModule,
    DashboardModule,
    ReportsModule,
    BoardModule,
  ],
})
export class AppModule {}
