import { Module } from '@nestjs/common';

import { PrismaModule } from './prisma/prisma.module';

import { AuthModule } from './auth/auth.module';

import { IssuesModule } from './issues/issues.module';

import { ComponentsModule } from './components/components.module';

import { PlanningModule } from './planning/planning.module';

import { SchedulingModule } from './scheduling/scheduling.module';

import { ReleasesModule } from './releases/releases.module';

import { IncidentsModule } from './incidents/incidents.module';

import { DashboardModule } from './dashboard/dashboard.module';

import { BoardModule } from './board/board.module';

import { HealthModule } from './health/health.module';

import { UsersModule } from './users/users.module';

import { LabelsModule } from './labels/labels.module';

import { CustomFieldsModule } from './custom-fields/custom-fields.module';

import { VersionsModule } from './versions/versions.module';



@Module({

  imports: [

    PrismaModule,

    HealthModule,

    AuthModule,

    UsersModule,

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

    BoardModule,

  ],

})

export class AppModule {}

