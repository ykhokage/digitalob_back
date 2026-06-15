import 'dotenv/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ServicesModule } from './services/services.module';
import { MetricsModule } from './metrics/metrics.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { IncidentsModule } from './incidents/incidents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { StorageModule } from './storage/storage.module';
import { WorkerModule } from './worker/worker.module';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { AuditModule } from './audit/audit.module';
import { DemoModule } from './demo/demo.module';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';

const throttlerStorage = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? new RedisThrottlerStorage() : undefined;

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 120, blockDuration: 60000 }], storage: throttlerStorage }), ScheduleModule.forRoot(), PrismaModule, AuditModule, AuthModule, UsersModule, ServicesModule, MetricsModule, DashboardModule, IncidentsModule, NotificationsModule, ReportsModule, StorageModule, WorkerModule, DiagnosticsModule, DemoModule], providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }] })
export class AppModule {}
