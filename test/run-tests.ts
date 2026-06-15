import 'reflect-metadata';
import assert from 'assert';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { Roles } from '../src/common/decorators';
import { RolesGuard } from '../src/common/roles.guard';
import { DiagnosticsService } from '../src/diagnostics/diagnostics.service';
import { IncidentsService } from '../src/incidents/incidents.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ServicesService } from '../src/services/services.service';
import { UsersService } from '../src/users/users.service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function testAuthEmailCode() {
  const tokenRow = {
    id: 'token-1',
    payload: { name: 'Test User', passwordHash: 'hashed-password' },
  };
  const prisma: any = {
    user: { findUnique: async () => null },
    emailToken: {
      findFirst: async () => tokenRow,
    },
    refreshToken: {
      create: async () => ({}),
    },
    $transaction: async (fn: any) =>
      fn({
        user: {
          create: async ({ data }: any) => ({ id: 'user-1', email: 'test@example.com', role: 'ADMIN', ...data }),
        },
        emailToken: {
          update: async () => ({}),
        },
      }),
  };
  const jwt: any = { signAsync: async () => 'jwt-token' };
  const audit: any = { record: async () => ({}) };
  const service = new AuthService(prisma, jwt, audit);

  const result = await service.confirmEmail('TEST@EXAMPLE.COM', '123456');

  assert.equal(result.user.email, 'test@example.com');
  assert.equal(result.user.emailConfirmed, true);
  assert.equal(result.accessToken, 'jwt-token');
}

async function testRbacGuard() {
  class Controller {
    adminOnly() {}
  }
  Roles('ADMIN')(Controller.prototype.adminOnly, 'adminOnly', Object.getOwnPropertyDescriptor(Controller.prototype, 'adminOnly')!);

  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const handler = Controller.prototype.adminOnly;
  const context = (role: string): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as any;

  assert.equal(guard.canActivate(context('ADMIN')), true);
  assert.equal(guard.canActivate(context('OBSERVER')), false);
}

async function testProfileUpdateDoesNotChangeEmail() {
  let updateData: any;
  const prisma: any = {
    user: {
      update: async ({ data }: any) => {
        updateData = data;
        return { id: 'user-1', email: 'old@example.com', ...data };
      },
    },
  };
  const storage: any = {};
  const audit: any = { record: async () => ({}) };
  const service = new UsersService(prisma, storage, audit);

  await service.update('user-1', { name: 'Updated', email: 'new@example.com', telegramChatId: '42' });

  assert.equal(updateData.name, 'Updated');
  assert.equal(updateData.telegramChatId, '42');
  assert.equal(updateData.email, undefined);
}

async function testNotificationAckAuditsAction() {
  let auditAction = '';
  const prisma: any = {
    notification: {
      updateMany: async () => ({ count: 1 }),
    },
  };
  const audit: any = {
    record: async (event: any) => {
      auditAction = event.action;
    },
  };
  const service = new NotificationsService(prisma, audit);

  const result = await service.ack({ sub: 'user-1' }, 'notification-1');

  assert.equal(result.ok, true);
  assert.equal(auditAction, 'notification.acknowledged');
}

async function testDiagnosticsStatuses() {
  const oldResend = process.env.RESEND_API_KEY;
  const oldFrom = process.env.RESEND_FROM;
  const oldRedis = process.env.REDIS_URL;
  const oldUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const oldUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.RESEND_API_KEY = 'key';
  process.env.RESEND_FROM = 'Incidents64 <noreply@incidents64.fun>';
  delete process.env.REDIS_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const prisma: any = {
    $queryRaw: async () => 1,
    healthCheck: {
      findFirst: async () => ({ checkedAt: new Date(), kind: 'health', success: true, service: { name: 'API' } }),
    },
  };
  const service = new DiagnosticsService(prisma);
  const result = await service.summary();

  assert.equal(result.database.status, 'OK');
  assert.equal(result.email.status, 'OK');
  assert.equal(result.redis.status, 'MISSING');
  assert.equal(result.worker.status, 'OK');

  if (oldResend === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = oldResend;
  if (oldFrom === undefined) delete process.env.RESEND_FROM;
  else process.env.RESEND_FROM = oldFrom;
  if (oldRedis === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = oldRedis;
  if (oldUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = oldUpstashUrl;
  if (oldUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = oldUpstashToken;
}

async function testAuditListFilters() {
  let where: any;
  const prisma: any = {
    auditLog: {
      findMany: async (args: any) => {
        where = args.where;
        return [];
      },
    },
  };
  const service = new AuditService(prisma);

  await service.list({ action: 'service.created', entityType: 'Microservice' }, { sub: 'user-1' });

  assert.equal(where.userId, 'user-1');
  assert.equal(where.action, 'service.created');
  assert.equal(where.entityType, 'Microservice');
}

async function testServicesListIsScopedToUser() {
  let where: any;
  const prisma: any = {
    microservice: {
      findMany: async (args: any) => {
        where = args.where;
        return [];
      },
    },
  };
  const audit: any = { record: async () => ({}) };
  const service = new ServicesService(prisma, audit);

  await service.findAll({ status: 'OK' }, { sub: 'user-1' });

  assert.equal(where.userId, 'user-1');
  assert.equal(where.status, 'OK');
}

async function testIncidentsListIsScopedToUserServices() {
  let where: any;
  const prisma: any = {
    incident: {
      findMany: async (args: any) => {
        where = args.where;
        return [];
      },
    },
  };
  const storage: any = {};
  const audit: any = { record: async () => ({}) };
  const service = new IncidentsService(prisma, storage, audit);

  await service.list({ status: 'NEW' }, { sub: 'user-1' });

  assert.equal(where.service.userId, 'user-1');
  assert.equal(where.status, 'NEW');
}

async function testMetricsListIsScopedToUserServices() {
  let where: any;
  const prisma: any = {
    metric: {
      findMany: async (args: any) => {
        where = args.where;
        return [];
      },
    },
  };
  const service = new MetricsService(prisma);

  await service.list({ serviceId: 'service-1' }, { sub: 'user-1' });

  assert.equal(where.serviceId, 'service-1');
  assert.equal(where.service.userId, 'user-1');
}

async function testNotificationLogIsScopedToUserRulesOrServices() {
  let where: any;
  const prisma: any = {
    notification: {
      findMany: async (args: any) => {
        where = args.where;
        return [];
      },
    },
  };
  const audit: any = { record: async () => ({}) };
  const service = new NotificationsService(prisma, audit);

  await service.log({ sub: 'user-1' }, {});

  assert.equal(where.OR[0].rule.userId, 'user-1');
  assert.equal(where.OR[1].service.userId, 'user-1');
}

async function run() {
  const tests = [
    ['auth email code confirmation', testAuthEmailCode],
    ['RBAC admin guard', testRbacGuard],
    ['profile update ignores email', testProfileUpdateDoesNotChangeEmail],
    ['notification ack audit', testNotificationAckAuditsAction],
    ['diagnostics statuses', testDiagnosticsStatuses],
    ['audit list filters', testAuditListFilters],
    ['services list scoped to user', testServicesListIsScopedToUser],
    ['incidents list scoped to user services', testIncidentsListIsScopedToUserServices],
    ['metrics list scoped to user services', testMetricsListIsScopedToUserServices],
    ['notification log scoped to user rules or services', testNotificationLogIsScopedToUserRulesOrServices],
  ] as const;

  for (const [name, test] of tests) {
    await test();
    console.log(`ok - ${name}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
