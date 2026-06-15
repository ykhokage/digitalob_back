import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const demoTag = 'demo-stand';

@Injectable()
export class DemoService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async state(user: any) {
    const services = await this.prisma.microservice.findMany({
      where: { userId: user.sub, tags: { has: demoTag } },
      include: {
        metrics: { orderBy: { createdAt: 'desc' }, take: 1 },
        incidents: { orderBy: { startedAt: 'desc' }, take: 3 },
        dependencies: { include: { target: true } },
      },
      orderBy: { name: 'asc' },
    });
    const incidentCount = await this.prisma.incident.count({ where: { service: { userId: user.sub, tags: { has: demoTag } } } });
    const notificationCount = await this.prisma.notification.count({ where: { service: { userId: user.sub, tags: { has: demoTag } } } });
    return { ready: services.length > 0, services, incidentCount, notificationCount };
  }

  async reset(user: any) {
    const services = await this.prisma.microservice.findMany({ where: { userId: user.sub, tags: { has: demoTag } }, select: { id: true } });
    const ids = services.map((service) => service.id);
    if (ids.length) await this.prisma.microservice.deleteMany({ where: { id: { in: ids }, userId: user.sub } });
    await this.audit.record({ userId: user.sub, action: 'demo.reset', entityType: 'DemoStand', metadata: { serviceCount: ids.length } });
    return { ok: true, removed: ids.length };
  }

  async run(user: any) {
    await this.reset(user);
    const now = Date.now();

    const gateway = await this.createService(user.sub, {
      name: 'Демо API Gateway',
      url: 'http://localhost:4100/health',
      status: 'WARNING',
      responseThresholdMs: 450,
      ownerTeam: 'Команда платформы',
    });
    const billing = await this.createService(user.sub, {
      name: 'Демо Billing Service',
      url: 'http://localhost:4103/health',
      status: 'CRITICAL',
      responseThresholdMs: 500,
      ownerTeam: 'Команда платежей',
    });
    const auth = await this.createService(user.sub, {
      name: 'Демо Auth Service',
      url: 'http://localhost:4101/health',
      status: 'OK',
      responseThresholdMs: 400,
      ownerTeam: 'Команда доступа',
    });

    await this.prisma.serviceDependency.createMany({
      data: [
        { sourceId: gateway.id, targetId: billing.id },
        { sourceId: gateway.id, targetId: auth.id },
      ],
      skipDuplicates: true,
    });

    await this.createMetrics(gateway.id, now, 'WARNING');
    await this.createMetrics(billing.id, now, 'CRITICAL');
    await this.createMetrics(auth.id, now, 'OK');

    const incident = await this.prisma.incident.create({
      data: {
        serviceId: billing.id,
        title: 'Демо: деградация платежного сервиса',
        description: 'Сервис отвечает медленно, растет процент ошибок и влияет на API Gateway через зависимость.',
        severity: 'HIGH',
        status: 'NEW',
        startedAt: new Date(now - 9 * 60 * 1000),
        rootCause: null,
      },
    });

    const notification = await this.prisma.notification.create({
      data: {
        serviceId: billing.id,
        incidentId: incident.id,
        type: 'THRESHOLD_EXCEEDED',
        channel: 'EMAIL',
        recipient: user.email,
        payload: {
          demo: true,
          title: 'Демо-оповещение: превышен порог',
          message: 'Billing Service превысил пороги времени ответа, ошибок и CPU.',
        },
        sentAt: new Date(now - 8 * 60 * 1000),
      },
    });

    await this.audit.record({
      userId: user.sub,
      action: 'demo.scenario.started',
      entityType: 'DemoStand',
      metadata: { services: [gateway.name, billing.name, auth.name], incidentId: incident.id, notificationId: notification.id },
    });

    return {
      ok: true,
      message: 'Демо-сценарий создан: деградация сервиса, инцидент, уведомление и влияние на карту архитектуры.',
      services: [gateway, billing, auth],
      incident,
      notification,
    };
  }

  private createService(userId: string, data: any) {
    return this.prisma.microservice.create({
      data: {
        userId,
        type: 'REST API',
        environment: 'TEST',
        checkIntervalSec: 30,
        timeoutMs: 3000,
        expectedStatusCodes: [200],
        errorRateThreshold: 5,
        cpuThreshold: 75,
        ramThreshold: 80,
        diskThreshold: 90,
        groupName: 'Демо-контур защиты',
        tags: [demoTag, 'защита', 'демонстрация'],
        monitoringEnabled: true,
        ...data,
      },
    });
  }

  private async createMetrics(serviceId: string, now: number, mode: 'OK' | 'WARNING' | 'CRITICAL') {
    const data = Array.from({ length: 18 }, (_, index) => {
      const degraded = index > 10;
      const critical = mode === 'CRITICAL' && degraded;
      const warning = mode === 'WARNING' && degraded;
      const responseTimeMs = critical ? 1200 + index * 18 : warning ? 650 + index * 8 : 160 + index * 3;
      const errorRate = critical ? 12 + (index % 4) : warning ? 4 + (index % 3) : 0.2;
      return {
        serviceId,
        availability: critical ? 94.5 : warning ? 98.4 : 99.98,
        responseTimeMs,
        successRate: Math.max(0, 100 - errorRate),
        errorRate,
        httpStatus: critical ? 503 : 200,
        uptimeSec: critical ? 45 : 60,
        downtimeSec: critical ? 15 : warning ? 3 : 0,
        failureCount: critical ? 2 : warning ? 1 : 0,
        cpuUsage: critical ? 88 + (index % 5) : warning ? 72 + (index % 4) : 22 + (index % 8),
        ramUsage: critical ? 82 + (index % 6) : warning ? 64 + (index % 5) : 35 + (index % 9),
        diskUsage: 42 + (index % 8),
        requestsPerMinute: critical ? 260 + index * 4 : warning ? 180 + index * 3 : 90 + index,
        avgResponseTimeMs: responseTimeMs,
        peakResponseTimeMs: responseTimeMs + 240,
        appErrorCount: critical ? 9 + (index % 5) : warning ? 2 : 0,
        createdAt: new Date(now - (18 - index) * 2 * 60 * 1000),
      };
    });
    await this.prisma.metric.createMany({ data });
  }
}
