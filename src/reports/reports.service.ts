import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  list(q: any, user: any) {
    const take = Math.min(100, Math.max(1, Number(q.take || q.limit) || 30));
    return this.prisma.report.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async comparison(q: any, user: any) {
    const days = Number(q.days || 7);
    const periodMs = Math.max(1, Math.min(days, 90)) * 24 * 60 * 60 * 1000;
    const currentTo = q.to ? new Date(q.to) : new Date();
    const currentFrom = q.from ? new Date(q.from) : new Date(currentTo.getTime() - periodMs);
    const previousTo = new Date(currentFrom.getTime());
    const previousFrom = new Date(currentFrom.getTime() - (currentTo.getTime() - currentFrom.getTime()));

    const [current, previous] = await Promise.all([
      this.periodStats(currentFrom, currentTo, user.sub),
      this.periodStats(previousFrom, previousTo, user.sub),
    ]);

    return {
      current: { periodFrom: currentFrom, periodTo: currentTo, ...current },
      previous: { periodFrom: previousFrom, periodTo: previousTo, ...previous },
      delta: {
        uptime: current.uptime - previous.uptime,
        downtimeSec: current.downtimeSec - previous.downtimeSec,
        avgResponseTimeMs: current.avgResponseTimeMs - previous.avgResponseTimeMs,
        incidentCount: current.incidentCount - previous.incidentCount,
        stabilityScore: current.stabilityScore - previous.stabilityScore,
      },
    };
  }

  async generate(user: any, dto: any) {
    const from = new Date(dto.periodFrom);
    const to = new Date(dto.periodTo);
    const stats = await this.periodStats(from, to, user.sub);
    const slaTarget = dto.slaTarget || 99.9;

    const report = await this.prisma.report.create({
      data: {
        userId: user.sub,
        title: dto.title || 'Uptime / SLA report',
        periodFrom: from,
        periodTo: to,
        uptime: stats.uptime,
        downtimeSec: stats.downtimeSec,
        avgResponseTimeMs: stats.avgResponseTimeMs,
        incidentCount: stats.incidentCount,
        slaTarget,
        slaActual: stats.uptime,
        sloViolations: stats.uptime < slaTarget ? 1 : 0,
      },
    });
    await this.audit.record({
      userId: user.sub,
      action: 'report.generated',
      entityType: 'Report',
      entityId: report.id,
      metadata: { title: report.title, periodFrom: report.periodFrom, periodTo: report.periodTo },
    });
    return report;
  }

  async export(id: string, user: any, formatInput: string) {
    const format = formatInput.toLowerCase();
    const report = await this.prisma.report.findFirst({ where: { id, userId: user.sub } });

    if (!report) throw new NotFoundException('Report not found');
    if (!['csv', 'xlsx', 'pdf'].includes(format)) throw new BadRequestException('Unsupported report format');

    const buffer =
      format === 'csv'
        ? Buffer.from('\ufeff' + this.toCsv(report), 'utf8')
        : format === 'xlsx'
          ? await this.toXlsx(report, user.sub)
          : await this.toPdf(report, user.sub);
    const contentType =
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf';
    const fileUrl = await this.storage.upload(`reports/${this.safeFileName(report.title)}-${this.formatFileDate(report.periodTo)}.${format}`, buffer, contentType);

    const exported = await this.prisma.report.update({
      where: { id: report.id },
      data: { fileUrl },
    });
    await this.audit.record({
      userId: user.sub,
      action: 'report.exported',
      entityType: 'Report',
      entityId: report.id,
      metadata: { format, fileUrl },
    });
    return exported;
  }

  async remove(id: string, user: any) {
    const removed = await this.prisma.report.deleteMany({ where: { id, userId: user.sub } });
    if (!removed.count) throw new NotFoundException('Report not found');
    await this.audit.record({
      userId: user.sub,
      action: 'report.deleted',
      entityType: 'Report',
      entityId: id,
    });
    return { ok: true };
  }

  private reportRows(report: any) {
    return [
      ['Название', report.title],
      ['Период с', this.formatDate(report.periodFrom)],
      ['Период по', this.formatDate(report.periodTo)],
      ['Доступность, %', this.num(report.uptime)],
      ['Простой, сек', report.downtimeSec],
      ['Среднее время ответа, мс', report.avgResponseTimeMs],
      ['Количество инцидентов', report.incidentCount],
      ['Цель SLA, %', report.slaTarget ?? ''],
      ['Фактический SLA, %', report.slaActual ?? ''],
      ['Нарушения SLO', report.sloViolations],
    ];
  }

  private async periodStats(from: Date, to: Date, userId: string) {
    const services = await this.prisma.microservice.findMany({ where: { userId }, select: { id: true } });
    const serviceIds = services.map((service) => service.id);
    if (!serviceIds.length) {
      return {
        uptime: 100,
        downtimeSec: 0,
        avgResponseTimeMs: 0,
        avgErrorRate: 0,
        incidentCount: 0,
        stabilityScore: 100,
        checks: 0,
      };
    }

    const metricWhere = { serviceId: { in: serviceIds }, createdAt: { gte: from, lte: to } };
    const incidentWhere = { serviceId: { in: serviceIds }, startedAt: { gte: from, lte: to } };
    const [metricAgg, incidentCount] = await Promise.all([
      this.prisma.metric.aggregate({
        where: metricWhere,
        _avg: { availability: true, responseTimeMs: true, errorRate: true },
        _sum: { downtimeSec: true },
        _count: { _all: true },
      }),
      this.prisma.incident.count({ where: incidentWhere }),
    ]);

    const checks = metricAgg._count._all;
    const uptime = checks ? Number(metricAgg._avg.availability || 0) : 100;
    const downtimeSec = Number(metricAgg._sum.downtimeSec || 0);
    const avgResponseTimeMs = checks ? Math.round(Number(metricAgg._avg.responseTimeMs || 0)) : 0;
    const avgErrorRate = checks ? Number(metricAgg._avg.errorRate || 0) : 0;
    const stabilityScore = Math.max(0, Math.min(100, uptime - avgErrorRate * 0.5 - incidentCount * 2 - Math.max(0, avgResponseTimeMs - 500) / 100));

    return {
      uptime,
      downtimeSec,
      avgResponseTimeMs,
      avgErrorRate,
      incidentCount,
      stabilityScore,
      checks,
    };
  }

  private toCsv(report: any) {
    return this.reportRows(report)
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  private async toXlsx(report: any, userId: string) {
    const details = await this.reportDetails(report, userId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Цифровой Наблюдатель';
    const sheet = workbook.addWorksheet('SLA отчет');

    sheet.columns = [
      { header: 'Показатель', key: 'metric', width: 32 },
      { header: 'Значение', key: 'value', width: 42 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(this.reportRows(report).map(([metric, value]) => ({ metric, value })));
    sheet.addRow({});
    sheet.addRow({ metric: 'Сервисы периода' });
    sheet.addRow({ metric: 'Сервис', value: 'SLA / средний ответ / инциденты' });
    for (const service of details.services) {
      sheet.addRow({ metric: service.name, value: `${this.num(service.availability)}% / ${service.avgResponseTimeMs} мс / ${service.incidentCount}` });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async toPdf(report: any, userId: string) {
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const details = await this.reportDetails(report, userId);
    const doc = new PDFDocument({ margin: 42, size: 'A4', info: { Title: report.title, Author: 'Цифровой Наблюдатель' } });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const fontRegular = 'C:/Windows/Fonts/arial.ttf';
    const fontBold = 'C:/Windows/Fonts/arialbd.ttf';
    if (fs.existsSync(fontRegular)) doc.registerFont('Regular', fontRegular);
    if (fs.existsSync(fontBold)) doc.registerFont('Bold', fontBold);
    const regular = fs.existsSync(fontRegular) ? 'Regular' : 'Helvetica';
    const bold = fs.existsSync(fontBold) ? 'Bold' : 'Helvetica-Bold';

    this.drawHeader(doc, regular, bold, report);
    this.drawSummaryCards(doc, regular, bold, report, details);
    this.drawAvailabilityChart(doc, regular, bold, details.services);
    this.drawServicesTable(doc, regular, bold, details.services);
    this.drawIncidents(doc, regular, bold, details.incidents);

    doc.font(regular).fontSize(8).fillColor('#64748b').text('Отчет сформирован системой «Цифровой Наблюдатель». Данные рассчитаны по метрикам и инцидентам пользователя.', 42, 780, { width: 510, align: 'center' });

    doc.end();

    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private async reportDetails(report: any, userId: string) {
    const services = await this.prisma.microservice.findMany({
      where: { userId },
      include: {
        metrics: { where: { createdAt: { gte: report.periodFrom, lte: report.periodTo } }, orderBy: { createdAt: 'asc' } },
        incidents: { where: { startedAt: { gte: report.periodFrom, lte: report.periodTo } } },
      },
      orderBy: { name: 'asc' },
    });
    const incidents = await this.prisma.incident.findMany({
      where: { service: { userId }, startedAt: { gte: report.periodFrom, lte: report.periodTo } },
      include: { service: true },
      orderBy: { startedAt: 'desc' },
      take: 12,
    });
    return {
      services: services.map((service: any) => {
        const metrics = service.metrics || [];
        const availability = metrics.length ? metrics.reduce((sum: number, metric: any) => sum + Number(metric.availability || 0), 0) / metrics.length : 100;
        const avgResponseTimeMs = metrics.length ? Math.round(metrics.reduce((sum: number, metric: any) => sum + Number(metric.responseTimeMs || 0), 0) / metrics.length) : 0;
        const avgErrorRate = metrics.length ? metrics.reduce((sum: number, metric: any) => sum + Number(metric.errorRate || 0), 0) / metrics.length : 0;
        return {
          id: service.id,
          name: service.name,
          status: service.status,
          environment: service.environment,
          availability,
          avgResponseTimeMs,
          avgErrorRate,
          incidentCount: service.incidents?.length || 0,
          checks: metrics.length,
        };
      }),
      incidents,
    };
  }

  private drawHeader(doc: any, regular: string, bold: string, report: any) {
    doc.rect(0, 0, 595, 118).fill('#0f172a');
    doc.roundedRect(42, 28, 46, 46, 10).fill('#0f766e');
    doc.strokeColor('#99f6e4').lineWidth(1.5).moveTo(53, 52).lineTo(61, 52).lineTo(66, 42).lineTo(73, 63).lineTo(80, 48).lineTo(90, 48).stroke();
    doc.circle(90, 48, 3).fill('#f97316');
    doc.fillColor('#f8fafc').font(bold).fontSize(21).text('Цифровой Наблюдатель', 104, 30);
    doc.fillColor('#cbd5e1').font(regular).fontSize(10).text('Веб-приложение для мониторинга микросервисной архитектуры', 104, 58);
    doc.fillColor('#ffffff').font(bold).fontSize(16).text(report.title, 42, 88, { width: 360 });
    doc.fillColor('#cbd5e1').font(regular).fontSize(9).text(`${this.formatDate(report.periodFrom)} - ${this.formatDate(report.periodTo)}`, 410, 90, { width: 140, align: 'right' });
  }

  private drawSummaryCards(doc: any, regular: string, bold: string, report: any, details: any) {
    const cards = [
      ['SLA', `${this.num(report.slaActual ?? report.uptime)}%`, report.slaActual >= (report.slaTarget || 99.9) ? '#10b981' : '#f59e0b'],
      ['Средний ответ', `${report.avgResponseTimeMs} мс`, '#14b8a6'],
      ['Инциденты', String(report.incidentCount), report.incidentCount ? '#ef4444' : '#10b981'],
      ['Сервисов', String(details.services.length), '#3b82f6'],
    ];
    let x = 42;
    for (const [label, value, color] of cards) {
      doc.roundedRect(x, 140, 120, 68, 8).fill('#f8fafc').strokeColor('#e2e8f0').stroke();
      doc.fillColor('#64748b').font(regular).fontSize(9).text(label, x + 12, 154);
      doc.fillColor(color).font(bold).fontSize(20).text(value, x + 12, 174, { width: 96 });
      x += 132;
    }
  }

  private drawAvailabilityChart(doc: any, regular: string, bold: string, services: any[]) {
    const y = 238;
    doc.fillColor('#0f172a').font(bold).fontSize(14).text('SLA по сервисам', 42, y);
    doc.fillColor('#64748b').font(regular).fontSize(9).text('Полоса показывает фактическую доступность за выбранный период.', 42, y + 18);
    const top = y + 44;
    const rows = services.slice(0, 8);
    rows.forEach((service, index) => {
      const rowY = top + index * 24;
      const pct = Math.max(0, Math.min(100, Number(service.availability || 0)));
      doc.fillColor('#334155').font(regular).fontSize(9).text(service.name, 42, rowY, { width: 135, ellipsis: true });
      doc.roundedRect(186, rowY + 2, 280, 9, 5).fill('#e2e8f0');
      doc.roundedRect(186, rowY + 2, 2.8 * pct, 9, 5).fill(pct >= 99.9 ? '#10b981' : pct >= 95 ? '#f59e0b' : '#ef4444');
      doc.fillColor('#0f172a').font(bold).fontSize(9).text(`${this.num(pct)}%`, 478, rowY - 1, { width: 60, align: 'right' });
    });
  }

  private drawServicesTable(doc: any, regular: string, bold: string, services: any[]) {
    let y = 500;
    doc.fillColor('#0f172a').font(bold).fontSize(14).text('Сводка по сервисам', 42, y);
    y += 24;
    const columns = [42, 222, 304, 384, 462];
    const headers = ['Сервис', 'SLA', 'Ответ', 'Ошибки', 'Инциденты'];
    doc.roundedRect(42, y, 510, 24, 6).fill('#f1f5f9');
    headers.forEach((header, index) => doc.fillColor('#334155').font(bold).fontSize(9).text(header, columns[index] + 8, y + 8, { width: index ? 70 : 160 }));
    y += 28;
    for (const service of services.slice(0, 10)) {
      doc.strokeColor('#e2e8f0').moveTo(42, y + 20).lineTo(552, y + 20).stroke();
      doc.fillColor('#0f172a').font(regular).fontSize(9).text(service.name, columns[0] + 8, y + 5, { width: 160, ellipsis: true });
      doc.text(`${this.num(service.availability)}%`, columns[1] + 8, y + 5);
      doc.text(`${service.avgResponseTimeMs} мс`, columns[2] + 8, y + 5);
      doc.text(`${this.num(service.avgErrorRate)}%`, columns[3] + 8, y + 5);
      doc.text(String(service.incidentCount), columns[4] + 8, y + 5);
      y += 24;
    }
  }

  private drawIncidents(doc: any, regular: string, bold: string, incidents: any[]) {
    if (!incidents.length) return;
    doc.addPage();
    doc.fillColor('#0f172a').font(bold).fontSize(16).text('Инциденты периода', 42, 42);
    let y = 76;
    for (const incident of incidents) {
      doc.roundedRect(42, y, 510, 58, 8).fill('#f8fafc').strokeColor('#e2e8f0').stroke();
      doc.fillColor('#0f172a').font(bold).fontSize(11).text(incident.title, 56, y + 12, { width: 360, ellipsis: true });
      doc.fillColor('#64748b').font(regular).fontSize(9).text(`${incident.service?.name || 'Сервис'} | ${this.statusRu(incident.severity)} | ${this.statusRu(incident.status)}`, 56, y + 31, { width: 360 });
      doc.fillColor('#0f766e').font(bold).fontSize(9).text(this.formatDate(incident.startedAt), 430, y + 18, { width: 100, align: 'right' });
      y += 70;
      if (y > 720) {
        doc.addPage();
        y = 42;
      }
    }
  }

  private safeFileName(value: string) {
    return String(value || 'sla-report')
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'sla-report';
  }

  private formatFileDate(value: Date) {
    return new Date(value).toISOString().slice(0, 10);
  }

  private formatDate(value: Date) {
    return new Date(value).toLocaleString('ru-RU');
  }

  private num(value: number) {
    return Number(value || 0).toFixed(2);
  }

  private statusRu(value: string) {
    const map: Record<string, string> = {
      OK: 'Норма',
      WARNING: 'Предупреждение',
      CRITICAL: 'Критично',
      DISABLED: 'Отключен',
      UNKNOWN: 'Нет данных',
      LOW: 'Низкая',
      MEDIUM: 'Средняя',
      HIGH: 'Высокая',
      NEW: 'Новый',
      IN_PROGRESS: 'В работе',
      RESOLVED: 'Решен',
    };
    return map[value] || value;
  }
}
