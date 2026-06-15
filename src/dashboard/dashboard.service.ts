import { Injectable } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  private redis?: Redis;

  constructor(private prisma: PrismaService) {}

  async summary(user: any) {
    const cacheKey = `incidents64:dashboard:${user?.sub || 'anonymous'}`;
    const cached = await this.cacheGet(cacheKey);
    if (cached) return cached;

    const serviceWhere = { userId: user?.sub };
    const relatedServiceWhere = { service: serviceWhere };
    const serviceSelect = { id: true, name: true, status: true, environment: true };
    const metricSelect = {
      id: true,
      serviceId: true,
      availability: true,
      responseTimeMs: true,
      successRate: true,
      errorRate: true,
      failureCount: true,
      cpuUsage: true,
      ramUsage: true,
      diskUsage: true,
      requestsPerMinute: true,
      avgResponseTimeMs: true,
      peakResponseTimeMs: true,
      appErrorCount: true,
      createdAt: true,
    };
    const [total, ok, warning, critical, disabled, recentIncidents, slowest, mostErrors, metrics, audit, notifications] = await Promise.all([
      this.prisma.microservice.count({ where: serviceWhere }),
      this.prisma.microservice.count({ where: { ...serviceWhere, status: 'OK' } }),
      this.prisma.microservice.count({ where: { ...serviceWhere, status: 'WARNING' } }),
      this.prisma.microservice.count({ where: { ...serviceWhere, status: 'CRITICAL' } }),
      this.prisma.microservice.count({ where: { ...serviceWhere, status: 'DISABLED' } }),
      this.prisma.incident.findMany({
        where: relatedServiceWhere,
        select: { id: true, title: true, severity: true, status: true, startedAt: true, service: { select: serviceSelect } },
        orderBy: { startedAt: 'desc' },
        take: 8,
      }),
      this.prisma.metric.findMany({
        where: relatedServiceWhere,
        select: { ...metricSelect, service: { select: serviceSelect } },
        orderBy: { responseTimeMs: 'desc' },
        take: 8,
      }),
      this.prisma.metric.findMany({
        where: relatedServiceWhere,
        select: { ...metricSelect, service: { select: serviceSelect } },
        orderBy: { appErrorCount: 'desc' },
        take: 8,
      }),
      this.prisma.metric.findMany({ where: relatedServiceWhere, select: metricSelect, orderBy: { createdAt: 'desc' }, take: 240 }),
      this.prisma.auditLog.findMany({ where: { userId: user?.sub }, select: { id: true, action: true, entityType: true, metadata: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.notification.findMany({
        where: { service: serviceWhere },
        select: {
          id: true,
          channel: true,
          failedAt: true,
          createdAt: true,
          service: { select: serviceSelect },
          incident: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const result = {
      total,
      statuses: { ok, warning, critical, disabled },
      recentIncidents,
      slowestServices: slowest,
      mostErrorServices: mostErrors,
      changeFeed: this.changeFeed(recentIncidents, audit, notifications),
      charts: {
        timeline: metrics.reverse(),
        statusPie: [
          { name: 'OK', value: ok },
          { name: 'WARNING', value: warning },
          { name: 'CRITICAL', value: critical },
          { name: 'DISABLED', value: disabled },
        ],
        heatmap: this.heatmap(metrics),
      },
    };
    await this.cacheSet(cacheKey, result);
    return result;
  }

  private async cacheGet(key: string) {
    const redis = this.redisClient();
    if (!redis) return null;

    try {
      const cached = await redis.get(key);
      return cached && typeof cached === 'object' ? cached : null;
    } catch {
      return null;
    }
  }

  private async cacheSet(key: string, value: any) {
    const redis = this.redisClient();
    const ttl = Number(process.env.DASHBOARD_CACHE_TTL_SEC || 20);
    if (!redis || ttl <= 0) return;

    try {
      await redis.set(key, value, { ex: ttl });
    } catch {
      // Dashboard cache is an optimization; API should stay available if Redis has a transient issue.
    }
  }

  private redisClient() {
    if (this.redis) return this.redis;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    this.redis = new Redis({ url, token });
    return this.redis;
  }

  private changeFeed(incidents: any[], audit: any[], notifications: any[]) {
    const incidentItems = incidents.map((incident) => ({
      id: `incident-${incident.id}`,
      type: 'INCIDENT',
      title: incident.status === 'RESOLVED' ? 'Инцидент закрыт' : 'Создан инцидент',
      text: `${incident.service?.name || 'Сервис'}: ${incident.title}`,
      severity: incident.severity,
      createdAt: incident.startedAt,
    }));
    const auditItems = audit.map((event) => ({
      id: `audit-${event.id}`,
      type: 'AUDIT',
      title: this.auditTitle(event.action),
      text: this.auditText(event),
      severity: 'INFO',
      createdAt: event.createdAt,
    }));
    const notificationItems = notifications.map((notification) => ({
      id: `notification-${notification.id}`,
      type: 'NOTIFICATION',
      title: notification.failedAt ? 'Оповещение не доставлено' : 'Оповещение отправлено',
      text: `${notification.service?.name || notification.incident?.title || 'Событие'} через ${notification.channel}`,
      severity: notification.failedAt ? 'WARNING' : 'INFO',
      createdAt: notification.createdAt,
    }));

    return [...incidentItems, ...auditItems, ...notificationItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12);
  }

  private auditTitle(action: string) {
    if (action?.startsWith('service.')) return 'Изменение сервиса';
    if (action?.startsWith('incident.')) return 'Изменение инцидента';
    if (action?.startsWith('notification.')) return 'Изменение оповещения';
    if (action?.startsWith('report.')) return 'Работа с отчетом';
    if (action?.startsWith('auth.')) return 'Событие входа';
    return 'Событие системы';
  }

  private auditText(event: any) {
    const metadata = event.metadata || {};
    return metadata.name || metadata.title || metadata.email || event.action || 'Запись журнала событий';
  }

  private heatmap(metrics: any[]) {
    const buckets = new Map<string, { hour: string; checks: number; failures: number; avgResponseMs: number }>();
    const now = new Date();

    for (let i = 23; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 60 * 60 * 1000);
      date.setMinutes(0, 0, 0);
      const hour = date.toISOString();
      buckets.set(hour, { hour, checks: 0, failures: 0, avgResponseMs: 0 });
    }

    for (const metric of metrics) {
      const date = new Date(metric.createdAt);
      date.setMinutes(0, 0, 0);
      const key = date.toISOString();
      const bucket = buckets.get(key);
      if (!bucket) continue;

      bucket.checks += 1;
      bucket.failures += metric.failureCount || 0;
      bucket.avgResponseMs += metric.responseTimeMs || 0;
    }

    return Array.from(buckets.values()).map((bucket) => ({
      ...bucket,
      avgResponseMs: bucket.checks ? Math.round(bucket.avgResponseMs / bucket.checks) : 0,
      failureRate: bucket.checks ? Math.min(100, Math.round((bucket.failures / bucket.checks) * 100)) : 0,
    }));
  }
}
