import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import tls from 'tls';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WorkerService {
  private readonly log = new Logger(WorkerService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduledChecks() {
    if (!this.workerEnabled()) return;
    const services = await this.prisma.microservice.findMany({ where: { monitoringEnabled: true } });

    for (const service of services) {
      await this.checkService(service).catch((error) => this.log.warn(`${service.name}: ${error.message}`));
    }
  }

  @Cron('0 8 * * *')
  async generateScheduledReports() {
    if (!this.workerEnabled()) return;
    const reportRules = await this.prisma.notificationRule.findMany({
      where: { enabled: true, type: 'REPORT' },
      select: { userId: true },
      distinct: ['userId'],
    });

    for (const rule of reportRules) {
      const to = new Date();
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const serviceWhere = { userId: rule.userId };
      const relatedServiceWhere = { service: serviceWhere };
      const metrics = await this.prisma.metric.findMany({ where: { ...relatedServiceWhere, createdAt: { gte: from, lte: to } } });
      const incidentCount = await this.prisma.incident.count({ where: { ...relatedServiceWhere, startedAt: { gte: from, lte: to } } });
      const uptime = metrics.length ? metrics.reduce((sum, metric) => sum + metric.availability, 0) / metrics.length : 100;
      const downtimeSec = metrics.reduce((sum, metric) => sum + metric.downtimeSec, 0);
      const avgResponseTimeMs = metrics.length ? Math.round(metrics.reduce((sum, metric) => sum + metric.responseTimeMs, 0) / metrics.length) : 0;

      const report = await this.prisma.report.create({
        data: {
          userId: rule.userId,
          title: 'Scheduled weekly SLA report',
          periodFrom: from,
          periodTo: to,
          uptime,
          downtimeSec,
          avgResponseTimeMs,
          incidentCount,
          slaTarget: 99.9,
          slaActual: uptime,
          sloViolations: uptime < 99.9 ? 1 : 0,
        },
      });

      await this.notifications.enqueue({
        type: 'REPORT',
        payload: {
          reportId: report.id,
          title: report.title,
          uptime,
          incidentCount,
        },
        dedupeKey: `REPORT:${rule.userId}:${from.toISOString().slice(0, 10)}`,
      });
    }
  }

  async checkService(service: any) {
    const result = await this.runHttpCheck(service, 'health');

    await this.runHttpCheck(service, 'liveness').catch((error) => this.log.warn(`${service.name} liveness: ${error.message}`));
    await this.runHttpCheck(service, 'readiness').catch((error) => this.log.warn(`${service.name} readiness: ${error.message}`));
    await this.checkSslCertificate(service).catch((error) => this.log.warn(`${service.name} ssl: ${error.message}`));
    const externalMetrics = await this.fetchServiceMetrics(service).catch((error) => {
      this.log.warn(`${service.name} metrics: ${error.message}`);
      return null;
    });

    const responseSlow = result.success && result.responseTimeMs > service.responseThresholdMs;
    const warning = responseSlow || result.reportedStatus === 'WARNING';
    const nextStatus = !result.success || result.reportedStatus === 'CRITICAL' ? 'CRITICAL' : warning ? 'WARNING' : 'OK';

    await this.prisma.metric.create({
      data: {
        serviceId: service.id,
        availability: result.success ? 100 : 0,
        responseTimeMs: result.responseTimeMs,
        successRate: result.success ? Number(externalMetrics?.successRate ?? 100) : 0,
        errorRate: result.success ? Number(externalMetrics?.errorRate ?? 0) : 100,
        httpStatus: result.statusCode,
        uptimeSec: result.success ? service.checkIntervalSec : 0,
        downtimeSec: result.success ? 0 : service.checkIntervalSec,
        failureCount: result.success ? Number(externalMetrics?.failureCount ?? 0) : 1,
        cpuUsage: this.optionalNumber(externalMetrics?.cpuUsage),
        ramUsage: this.optionalNumber(externalMetrics?.ramUsage),
        diskUsage: this.optionalNumber(externalMetrics?.diskUsage),
        requestsPerMinute: this.optionalNumber(externalMetrics?.requestsPerMinute),
        avgResponseTimeMs: Number(externalMetrics?.avgResponseTimeMs ?? result.responseTimeMs),
        peakResponseTimeMs: Number(externalMetrics?.peakResponseTimeMs ?? result.responseTimeMs),
        appErrorCount: result.success ? Number(externalMetrics?.appErrorCount ?? 0) : 1,
      },
    });

    if (responseSlow) {
      await this.ensureIncident(service.id, {
        title: `${service.name}: превышено время ответа`,
        description: `Время ответа ${result.responseTimeMs} мс выше порога ${service.responseThresholdMs} мс.`,
        severity: 'HIGH',
      });

      await this.notifications.enqueue({
        serviceId: service.id,
        type: 'THRESHOLD_EXCEEDED',
        payload: {
          service: service.name,
          metric: 'responseTimeMs',
          value: result.responseTimeMs,
          threshold: service.responseThresholdMs,
        },
        dedupeKey: `THRESHOLD_EXCEEDED:${service.id}:responseTimeMs`,
      });
    }

    if (result.reportedStatus === 'WARNING') {
      await this.ensureIncident(service.id, {
        title: `${service.name}: деградация зависимости`,
        description: 'Один из зависимых компонентов сообщил состояние WARNING.',
        severity: 'MEDIUM',
      });

      await this.notifications.enqueue({
        serviceId: service.id,
        type: 'DEPENDENCY_PROBLEM',
        payload: {
          service: service.name,
          status: result.reportedStatus,
          details: 'One or more dependencies reported a warning state',
        },
        dedupeKey: `DEPENDENCY_PROBLEM:${service.id}`,
      });
    }

    await this.enqueueMetricThresholds(service, externalMetrics);

    if (service.status !== nextStatus) {
      await this.prisma.microservice.update({ where: { id: service.id }, data: { status: nextStatus } });

      if (nextStatus === 'CRITICAL') {
        const incident = await this.ensureIncident(service.id, {
          title: `${service.name}: сервис недоступен`,
          description: result.errorMessage || `Неожиданный HTTP-статус ${result.statusCode}`,
          severity: 'CRITICAL',
        });

        await this.notifications.enqueue({
          serviceId: service.id,
          incidentId: incident.id,
          type: 'SERVICE_DOWN',
          payload: { service: service.name, error: result.errorMessage, statusCode: result.statusCode },
          dedupeKey: `SERVICE_DOWN:${service.id}`,
        });
      }

      if (service.status !== 'OK' && nextStatus === 'OK') {
        const resolvedAt = new Date();
        const openIncidents = await this.prisma.incident.findMany({
          where: { serviceId: service.id, status: { not: 'RESOLVED' } },
          select: { id: true, startedAt: true },
        });

        for (const incident of openIncidents) {
          await this.prisma.incident.update({
            where: { id: incident.id },
            data: {
              status: 'RESOLVED',
              resolvedAt,
              durationSec: Math.max(0, Math.floor((resolvedAt.getTime() - incident.startedAt.getTime()) / 1000)),
            },
          });
        }

        await this.notifications.enqueue({
          serviceId: service.id,
          type: 'SERVICE_RECOVERED',
          payload: { service: service.name },
          dedupeKey: `SERVICE_RECOVERED:${service.id}`,
        });
      }
    }
  }

  private async runHttpCheck(service: any, kind: string) {
    const started = Date.now();
    let success = false;
    let statusCode: number | undefined;
    let errorMessage: string | undefined;
    let reportedStatus: string | undefined;

    try {
      const response = await axios.get(this.endpointFor(service.url, kind), { timeout: service.timeoutMs, validateStatus: () => true });
      statusCode = response.status;
      reportedStatus = typeof response.data?.status === 'string' ? response.data.status.toUpperCase() : undefined;
      success = service.expectedStatusCodes.includes(response.status) && reportedStatus !== 'CRITICAL';
    } catch (error: any) {
      errorMessage = error.message;
    }

    const responseTimeMs = Date.now() - started;

    await this.prisma.healthCheck.create({
      data: {
        serviceId: service.id,
        kind,
        success,
        statusCode,
        responseTimeMs,
        errorMessage,
      },
    });

    return { success, statusCode, responseTimeMs, errorMessage, reportedStatus };
  }

  private async checkSslCertificate(service: any) {
    const url = new URL(service.url);
    if (url.protocol !== 'https:') return;

    const expiresAt = await this.sslExpiresAt(url.hostname, Number(url.port) || 443);
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

    if (daysLeft <= 14) {
      await this.ensureIncident(service.id, {
        title: `${service.name}: истекает SSL-сертификат`,
        description: `SSL-сертификат ${url.hostname} истекает через ${daysLeft} дн.`,
        severity: daysLeft <= 3 ? 'MEDIUM' : 'LOW',
      });

      await this.notifications.enqueue({
        serviceId: service.id,
        type: 'SSL_EXPIRING',
        payload: { service: service.name, host: url.hostname, expiresAt, daysLeft },
        dedupeKey: `SSL_EXPIRING:${service.id}`,
      });
    }
  }

  private endpointFor(rawUrl: string, kind: string) {
    const url = new URL(rawUrl);
    const isBasePath = !url.pathname || url.pathname === '/';

    if (isBasePath) {
      url.pathname = `/${kind}`;
      url.search = '';
    }

    return url.toString();
  }

  private metricsEndpointFor(rawUrl: string) {
    const url = new URL(rawUrl);
    url.pathname = '/metrics';
    url.search = '';
    return url.toString();
  }

  private async fetchServiceMetrics(service: any) {
    const response = await axios.get(this.metricsEndpointFor(service.url), {
      timeout: service.timeoutMs,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    return response.data && typeof response.data === 'object' ? response.data : null;
  }

  private optionalNumber(value: any) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  private async enqueueMetricThresholds(service: any, metrics: any) {
    if (!metrics) return;

    const checks = [
      ['cpuUsage', service.cpuThreshold],
      ['ramUsage', service.ramThreshold],
      ['diskUsage', service.diskThreshold],
      ['errorRate', service.errorRateThreshold],
    ] as const;

    for (const [metric, threshold] of checks) {
      const value = this.optionalNumber(metrics[metric]);
      if (value === undefined || value <= Number(threshold)) continue;

      await this.ensureIncident(service.id, {
        title: `${service.name}: превышен порог ${this.metricLabel(metric)}`,
        description: `${this.metricLabel(metric)}: ${value}% при пороге ${threshold}%.`,
        severity: metric === 'errorRate' ? 'HIGH' : 'MEDIUM',
      });

      await this.notifications.enqueue({
        serviceId: service.id,
        type: 'THRESHOLD_EXCEEDED',
        payload: {
          service: service.name,
          metric,
          value,
          threshold,
        },
        dedupeKey: `THRESHOLD_EXCEEDED:${service.id}:${metric}`,
      });
    }
  }

  private async ensureIncident(serviceId: string, data: { title: string; description: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }) {
    const existing = await this.prisma.incident.findFirst({
      where: {
        serviceId,
        title: data.title,
        status: { not: 'RESOLVED' },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (existing) return existing;

    return this.prisma.incident.create({
      data: {
        serviceId,
        title: data.title,
        description: data.description,
        severity: data.severity,
        status: 'NEW',
      },
    });
  }

  private metricLabel(metric: string) {
    if (metric === 'cpuUsage') return 'CPU';
    if (metric === 'ramUsage') return 'RAM';
    if (metric === 'diskUsage') return 'диска';
    if (metric === 'errorRate') return 'ошибок';
    return metric;
  }

  private workerEnabled() {
    return process.env.PROCESS_ROLE === 'worker' || process.env.RUN_WORKER_IN_API === 'true';
  }

  private sslExpiresAt(host: string, port: number) {
    return new Promise<Date>((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert?.valid_to) {
          reject(new Error('Could not read SSL certificate'));
          return;
        }

        resolve(new Date(cert.valid_to));
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error('SSL check timeout'));
      });
      socket.on('error', reject);
    });
  }
}
