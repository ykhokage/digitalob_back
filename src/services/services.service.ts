import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerService } from '../worker/worker.service';

@Injectable()
export class ServicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private worker: WorkerService,
  ) {}

  async findAll(q: any, user: any) {
    const where: any = { userId: user?.sub };
    if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }];
    if (q.status) where.status = q.status;
    if (q.environment) where.environment = q.environment;
    if (q.tag) where.tags = { has: q.tag };

    const services = await this.prisma.microservice.findMany({
      where,
      include: {
        metrics: { orderBy: { createdAt: 'desc' }, take: 1 },
        dependencies: { include: { target: true } },
        dependents: { include: { source: true } },
        _count: { select: { incidents: true, metrics: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: Number(q.skip) || 0,
    });

    const sort = String(q.sort || '');
    const direction = String(q.direction || 'desc') === 'asc' ? 1 : -1;
    const metricSorts: Record<string, string> = {
      responseTimeMs: 'responseTimeMs',
      errorRate: 'errorRate',
      cpuUsage: 'cpuUsage',
      ramUsage: 'ramUsage',
      diskUsage: 'diskUsage',
      requestsPerMinute: 'requestsPerMinute',
      availability: 'availability',
    };

    if (metricSorts[sort]) {
      services.sort((a: any, b: any) => {
        const av = Number(a.metrics?.[0]?.[metricSorts[sort]] ?? -1);
        const bv = Number(b.metrics?.[0]?.[metricSorts[sort]] ?? -1);
        return (av - bv) * direction;
      });
    }

    if (sort === 'name') services.sort((a, b) => a.name.localeCompare(b.name) * direction);
    if (sort === 'incidents') services.sort((a: any, b: any) => ((a._count?.incidents || 0) - (b._count?.incidents || 0)) * direction);

    return services.slice(0, Number(q.take) || 100);
  }

  async architecture(user: any) {
    const services = await this.prisma.microservice.findMany({
      where: { userId: user?.sub },
      include: {
        metrics: { orderBy: { createdAt: 'desc' }, take: 1 },
        dependencies: { include: { target: true } },
        dependents: { include: { source: true } },
        incidents: { where: { status: { not: 'RESOLVED' } }, orderBy: { startedAt: 'desc' }, take: 3 },
      },
      orderBy: [{ groupName: 'asc' }, { name: 'asc' }],
    });

    const nodes = services.map((service: any) => {
      const activeIncidents = service.incidents?.length || 0;
      const latest = service.metrics?.[0];
      const impactedBy = service.dependencies
        .map((dependency: any) => dependency.target)
        .filter((target: any) => ['WARNING', 'CRITICAL', 'DISABLED'].includes(target.status))
        .map((target: any) => ({ id: target.id, name: target.name, status: target.status }));

      return {
        id: service.id,
        name: service.name,
        status: service.status,
        environment: service.environment,
        groupName: service.groupName,
        ownerTeam: service.ownerTeam,
        url: service.url,
        activeIncidents,
        dependencyCount: service.dependencies.length,
        dependentCount: service.dependents.length,
        latestMetric: latest
          ? {
              responseTimeMs: latest.responseTimeMs,
              availability: latest.availability,
              errorRate: latest.errorRate,
              cpuUsage: latest.cpuUsage,
              ramUsage: latest.ramUsage,
            }
          : null,
        impactedBy,
        riskScore: this.riskScore(service.status, activeIncidents, impactedBy.length, latest),
      };
    });

    const edges = services.flatMap((service: any) =>
      service.dependencies.map((dependency: any) => ({
        id: `${service.id}-${dependency.targetId}`,
        sourceId: service.id,
        targetId: dependency.targetId,
        sourceName: service.name,
        targetName: dependency.target.name,
        sourceStatus: service.status,
        targetStatus: dependency.target.status,
        impact: ['WARNING', 'CRITICAL', 'DISABLED'].includes(dependency.target.status) ? 'HIGH' : 'NORMAL',
      })),
    );

    return { nodes, edges };
  }

  async sla(q: any, user: any) {
    const days = Math.max(1, Math.min(Number(q.days || 30), 90));
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const services = await this.prisma.microservice.findMany({
      where: { userId: user?.sub },
      include: {
        metrics: { where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: 'asc' } },
        incidents: { where: { startedAt: { gte: from, lte: to } } },
      },
      orderBy: { name: 'asc' },
    });

    return services.map((service: any) => this.serviceSla(service, from, to));
  }

  findOne(id: string, user: any) {
    return this.prisma.microservice.findFirstOrThrow({
      where: { id, userId: user?.sub },
      include: {
        metrics: { orderBy: { createdAt: 'desc' }, take: 100 },
        incidents: { orderBy: { startedAt: 'desc' }, take: 20 },
        dependencies: { include: { target: true } },
        dependents: { include: { source: true } },
      },
    });
  }

  async insights(id: string, user: any) {
    const service: any = await this.prisma.microservice.findFirstOrThrow({
      where: { id, userId: user?.sub },
      include: {
        metrics: { orderBy: { createdAt: 'desc' }, take: 20 },
        incidents: { where: { status: { not: 'RESOLVED' } }, orderBy: { startedAt: 'desc' }, take: 5 },
        dependencies: { include: { target: true } },
      },
    });
    const latest = service.metrics?.[0];
    const previous = service.metrics?.[1];
    const hints: { level: string; title: string; text: string }[] = [];

    if (!latest) {
      hints.push({ level: 'INFO', title: 'Недостаточно данных', text: 'По сервису еще нет метрик, поэтому причина деградации не определяется.' });
      return hints;
    }

    if (latest.responseTimeMs > service.responseThresholdMs) {
      hints.push({
        level: 'WARNING',
        title: 'Высокое время ответа',
        text: `Последняя проверка заняла ${latest.responseTimeMs} мс при пороге ${service.responseThresholdMs} мс. Возможна перегрузка сервиса или зависимой системы.`,
      });
    }
    if (latest.errorRate > service.errorRateThreshold || Number(latest.appErrorCount || 0) > 0) {
      hints.push({
        level: 'CRITICAL',
        title: 'Рост ошибок приложения',
        text: `Ошибка составляет ${Number(latest.errorRate || 0).toFixed(2)}%, ошибок приложения: ${latest.appErrorCount || 0}. Проверьте логи и последние изменения сервиса.`,
      });
    }
    if (Number(latest.cpuUsage || 0) > service.cpuThreshold) {
      hints.push({ level: 'WARNING', title: 'CPU выше порога', text: `CPU ${Number(latest.cpuUsage).toFixed(1)}% при пороге ${service.cpuThreshold}%. Возможная причина: повышенная нагрузка или тяжелые операции.` });
    }
    if (Number(latest.ramUsage || 0) > service.ramThreshold) {
      hints.push({ level: 'WARNING', title: 'RAM выше порога', text: `RAM ${Number(latest.ramUsage).toFixed(1)}% при пороге ${service.ramThreshold}%. Возможна утечка памяти или недостаточный лимит ресурсов.` });
    }
    if (previous && latest.responseTimeMs > previous.responseTimeMs * 1.8) {
      hints.push({ level: 'INFO', title: 'Резкий скачок задержки', text: `Время ответа выросло с ${previous.responseTimeMs} мс до ${latest.responseTimeMs} мс. Стоит проверить внешние зависимости и сетевые задержки.` });
    }
    const failedDeps = service.dependencies.map((dependency: any) => dependency.target).filter((target: any) => ['WARNING', 'CRITICAL', 'DISABLED'].includes(target.status));
    if (failedDeps.length) {
      hints.push({ level: 'CRITICAL', title: 'Проблема в зависимости', text: `Нестабильные зависимые сервисы: ${failedDeps.map((item: any) => item.name).join(', ')}. Возможна каскадная деградация.` });
    }
    if (!hints.length) {
      hints.push({ level: 'OK', title: 'Критичных признаков нет', text: 'По последним метрикам явная причина деградации не обнаружена.' });
    }

    return hints;
  }

  async create(dto: any, user: any) {
    const created = await this.prisma.microservice.create({ data: { ...dto, userId: user?.sub } });
    await this.audit.record({
      userId: user?.sub,
      action: 'service.created',
      entityType: 'Microservice',
      entityId: created.id,
      metadata: { name: created.name, url: created.url },
    });
    return created;
  }

  async checkNow(id: string, user?: any) {
    const service = await this.assertOwnedService(id, user);
    await this.worker.checkService(service);
    return this.findOne(id, user);
  }

  async update(id: string, dto: any, user?: any) {
    await this.assertOwnedService(id, user);
    const updated = await this.prisma.microservice.update({ where: { id }, data: dto });
    await this.audit.record({
      userId: user?.sub,
      action: 'service.updated',
      entityType: 'Microservice',
      entityId: id,
      metadata: { fields: Object.keys(dto || {}) },
    });
    return updated;
  }

  async remove(id: string, user?: any) {
    await this.assertOwnedService(id, user);
    const removed = await this.prisma.microservice.delete({ where: { id } });
    await this.audit.record({
      userId: user?.sub,
      action: 'service.deleted',
      entityType: 'Microservice',
      entityId: id,
      metadata: { name: removed.name, url: removed.url },
    });
    return removed;
  }

  async setDependencies(id: string, targetIds: string[], user?: any) {
    await this.assertOwnedService(id, user);
    const uniqueTargetIds = Array.from(new Set(targetIds));
    if (uniqueTargetIds.length) {
      const ownedTargets = await this.prisma.microservice.count({ where: { id: { in: uniqueTargetIds }, userId: user?.sub } });
      if (ownedTargets !== uniqueTargetIds.length) throw new BadRequestException('Dependencies must belong to the current user');
    }
    const result = await this.prisma.$transaction([
      this.prisma.serviceDependency.deleteMany({ where: { sourceId: id } }),
      this.prisma.serviceDependency.createMany({
        data: uniqueTargetIds.map((targetId) => ({ sourceId: id, targetId })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit.record({
      userId: user?.sub,
      action: 'service.dependencies.updated',
      entityType: 'Microservice',
      entityId: id,
      metadata: { targetIds: uniqueTargetIds },
    });
    return result;
  }

  async toggleMonitoring(id: string, enabled: boolean, user?: any) {
    await this.assertOwnedService(id, user);
    const updated = await this.prisma.microservice.update({
      where: { id },
      data: { monitoringEnabled: enabled, status: enabled ? 'UNKNOWN' : 'DISABLED' },
    });
    await this.audit.record({
      userId: user?.sub,
      action: enabled ? 'service.monitoring.enabled' : 'service.monitoring.disabled',
      entityType: 'Microservice',
      entityId: id,
    });
    return updated;
  }

  private assertOwnedService(id: string, user?: any) {
    return this.prisma.microservice.findFirstOrThrow({ where: { id, userId: user?.sub }, select: { id: true } });
  }

  private riskScore(status: string, activeIncidents: number, impactedBy: number, metric?: any) {
    const statusScore: Record<string, number> = { OK: 8, UNKNOWN: 18, WARNING: 45, CRITICAL: 80, DISABLED: 65 };
    const metricScore = metric ? Math.min(35, Math.max(0, Number(metric.errorRate || 0) * 2 + Math.max(0, Number(metric.responseTimeMs || 0) - 500) / 80)) : 10;
    return Math.round(Math.min(100, (statusScore[status] ?? 25) + activeIncidents * 10 + impactedBy * 12 + metricScore));
  }

  private serviceSla(service: any, from: Date, to: Date) {
    const metrics = service.metrics || [];
    const incidentCount = service.incidents?.length || 0;
    const uptime = metrics.length ? metrics.reduce((sum: number, metric: any) => sum + Number(metric.availability || 0), 0) / metrics.length : 100;
    const downtimeSec = metrics.reduce((sum: number, metric: any) => sum + Number(metric.downtimeSec || 0), 0);
    const avgResponseTimeMs = metrics.length ? Math.round(metrics.reduce((sum: number, metric: any) => sum + Number(metric.responseTimeMs || 0), 0) / metrics.length) : 0;
    const avgErrorRate = metrics.length ? metrics.reduce((sum: number, metric: any) => sum + Number(metric.errorRate || 0), 0) / metrics.length : 0;
    const checks = metrics.length;
    const failedChecks = metrics.reduce((sum: number, metric: any) => sum + Number(metric.failureCount || 0), 0);
    return {
      serviceId: service.id,
      serviceName: service.name,
      status: service.status,
      environment: service.environment,
      periodFrom: from,
      periodTo: to,
      availability: Number(uptime.toFixed(3)),
      downtimeSec,
      avgResponseTimeMs,
      avgErrorRate: Number(avgErrorRate.toFixed(3)),
      incidentCount,
      checks,
      failedChecks,
      slaTarget: 99.9,
      slaMet: uptime >= 99.9,
    };
  }
}
