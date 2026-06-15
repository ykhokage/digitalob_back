import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class IncidentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  list(q: any, user?: any) {
    const where: any = { service: { userId: user?.sub } };
    if (q.serviceId) where.serviceId = q.serviceId;
    if (q.status) where.status = q.status;
    if (q.severity) where.severity = q.severity;
    if (q.from || q.to) where.startedAt = { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined };
    const take = Math.min(200, Math.max(1, Number(q.take || q.limit) || 50));

    return this.prisma.incident.findMany({
      where,
      include: {
        service: true,
        assignedTo: { select: { id: true, name: true, email: true, role: true } },
        _count: { select: { comments: true, notifications: true } },
      },
      orderBy: { startedAt: 'desc' },
      take,
    });
  }

  findOne(id: string, user?: any) {
    return this.prisma.incident.findFirstOrThrow({
      where: { id, service: { userId: user?.sub } },
      include: { service: true, assignedTo: { select: { id: true, name: true, email: true, role: true } }, comments: { include: { user: true } }, notifications: true },
    });
  }

  async create(dto: any, user?: any) {
    await this.assertOwnedService(dto.serviceId, user);
    if (dto.assignedToId) await this.assertUser(dto.assignedToId);
    const created = await this.prisma.incident.create({ data: dto });
    await this.audit.record({
      userId: user?.sub,
      action: 'incident.created',
      entityType: 'Incident',
      entityId: created.id,
      metadata: { title: created.title, severity: created.severity, serviceId: created.serviceId },
    });
    return created;
  }

  async update(id: string, dto: any, user?: any) {
    const incident = await this.assertOwnedIncident(id, user);
    if (dto.serviceId) await this.assertOwnedService(dto.serviceId, user);
    if (dto.assignedToId) await this.assertUser(dto.assignedToId);
    const data = { ...dto };

    if (dto.status === 'RESOLVED' && incident.status !== 'RESOLVED') {
      if (!String(dto.rootCause || incident.rootCause || '').trim()) {
        throw new BadRequestException('Root cause is required to resolve incident');
      }
      data.rootCause = String(dto.rootCause || incident.rootCause).trim();
      data.resolvedAt = new Date();
      data.durationSec = Math.max(0, Math.floor((Date.now() - incident.startedAt.getTime()) / 1000));
    }

    if (dto.status && dto.status !== 'RESOLVED') {
      data.resolvedAt = null;
      data.durationSec = null;
    }

    const updated = await this.prisma.incident.update({ where: { id }, data });
    if (dto.status && dto.status !== incident.status) {
      await this.prisma.incidentComment.create({
        data: {
          incidentId: id,
          userId: user?.sub,
          body: `Статус изменен: ${incident.status} -> ${dto.status}`,
        },
      }).catch(() => {});
    }
    await this.audit.record({
      userId: user?.sub,
      action: 'incident.updated',
      entityType: 'Incident',
      entityId: id,
      metadata: { fields: Object.keys(dto || {}) },
    });
    return updated;
  }

  async remove(id: string, user?: any) {
    await this.assertOwnedIncident(id, user);
    const removed = await this.prisma.incident.delete({ where: { id } });
    await this.audit.record({
      userId: user?.sub,
      action: 'incident.deleted',
      entityType: 'Incident',
      entityId: id,
      metadata: { title: removed.title, serviceId: removed.serviceId },
    });
    return removed;
  }

  async comment(id: string, userId: string, body: string) {
    await this.assertOwnedIncident(id, { sub: userId });
    const comment = await this.prisma.incidentComment.create({ data: { incidentId: id, userId, body } });
    await this.audit.record({
      userId,
      action: 'incident.comment.created',
      entityType: 'Incident',
      entityId: id,
      metadata: { bodyLength: body.length },
    });
    return comment;
  }

  async resolve(id: string, user?: any, rootCause?: string) {
    const incident = await this.assertOwnedIncident(id, user);
    const cleanRootCause = String(rootCause || '').trim();
    if (!cleanRootCause) throw new BadRequestException('Root cause is required to resolve incident');
    const updated = await this.prisma.incident.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        rootCause: cleanRootCause,
        resolvedAt: new Date(),
        durationSec: Math.floor((Date.now() - incident.startedAt.getTime()) / 1000),
      },
    });
    await this.prisma.incidentComment.create({
      data: {
        incidentId: id,
        userId: user?.sub,
        body: `Инцидент закрыт. Причина: ${cleanRootCause}`,
      },
    }).catch(() => {});
    await this.audit.record({
      userId: user?.sub,
      action: 'incident.resolved',
      entityType: 'Incident',
      entityId: id,
      metadata: { durationSec: updated.durationSec, rootCause: cleanRootCause },
    });
    return updated;
  }

  async export(q: any, formatInput: string, user?: any) {
    const format = formatInput.toLowerCase();
    if (!['csv', 'pdf'].includes(format)) throw new BadRequestException('Unsupported incident export format');

    const incidents = await this.list({ ...q, take: q.take || 1000 }, user);
    const buffer = format === 'csv' ? Buffer.from('\ufeff' + this.toCsv(incidents), 'utf8') : await this.toPdf(incidents);
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf';
    const fileUrl = await this.storage.upload(`exports/incidenty-${new Date().toISOString().slice(0, 10)}-${Date.now()}.${format}`, buffer, contentType);

    return { ok: true, fileUrl };
  }

  private assertOwnedService(id: string, user?: any) {
    return this.prisma.microservice.findFirstOrThrow({ where: { id, userId: user?.sub }, select: { id: true } });
  }

  private assertOwnedIncident(id: string, user?: any) {
    return this.prisma.incident.findFirstOrThrow({
      where: { id, service: { userId: user?.sub } },
      include: { service: true },
    });
  }

  private assertUser(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true } });
  }

  private toCsv(incidents: any[]) {
    const rows = [
      ['Инцидент', 'Сервис', 'Критичность', 'Статус', 'Ответственный', 'Начало', 'Завершение', 'Длительность, сек', 'Причина', 'Описание'],
      ...incidents.map((incident) => [
        incident.title,
        incident.service?.name || '',
        incident.severity,
        incident.status,
        incident.assignedTo?.email || '',
        incident.startedAt?.toISOString?.() || '',
        incident.resolvedAt?.toISOString?.() || '',
        incident.durationSec || '',
        incident.rootCause || '',
        incident.description || '',
      ]),
    ];

    return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  }

  private async toPdf(incidents: any[]) {
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const doc = new PDFDocument({ margin: 42, size: 'A4', info: { Title: 'Экспорт инцидентов', Author: 'Цифровой Наблюдатель' } });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const fontRegular = 'C:/Windows/Fonts/arial.ttf';
    const fontBold = 'C:/Windows/Fonts/arialbd.ttf';
    if (fs.existsSync(fontRegular)) doc.registerFont('Regular', fontRegular);
    if (fs.existsSync(fontBold)) doc.registerFont('Bold', fontBold);
    const regular = fs.existsSync(fontRegular) ? 'Regular' : 'Helvetica';
    const bold = fs.existsSync(fontBold) ? 'Bold' : 'Helvetica-Bold';

    doc.rect(0, 0, 595, 112).fill('#0f172a');
    doc.roundedRect(42, 28, 44, 44, 10).fill('#0f766e');
    doc.strokeColor('#99f6e4').lineWidth(1.5).moveTo(52, 52).lineTo(60, 52).lineTo(65, 42).lineTo(72, 62).lineTo(79, 48).lineTo(88, 48).stroke();
    doc.circle(88, 48, 3).fill('#f97316');
    doc.fillColor('#f8fafc').font(bold).fontSize(20).text('Цифровой Наблюдатель', 104, 30);
    doc.fillColor('#cbd5e1').font(regular).fontSize(10).text('Экспорт инцидентов микросервисной архитектуры', 104, 58);
    doc.fillColor('#ffffff').font(bold).fontSize(15).text(`Инциденты: ${incidents.length}`, 42, 86);

    let y = 140;
    doc.fillColor('#0f172a').font(bold).fontSize(14).text('Список инцидентов', 42, y);
    y += 26;

    for (const incident of incidents) {
      if (y > 720) {
        doc.addPage();
        y = 42;
      }
      doc.roundedRect(42, y, 510, 74, 8).fill('#f8fafc').strokeColor('#e2e8f0').stroke();
      doc.fillColor('#0f172a').font(bold).fontSize(11).text(incident.title, 56, y + 12, { width: 360, ellipsis: true });
      doc.fillColor('#64748b').font(regular).fontSize(9).text(`${incident.service?.name || 'Сервис'} | ${this.statusRu(incident.severity)} | ${this.statusRu(incident.status)}`, 56, y + 31, { width: 360 });
      doc.fillColor('#334155').font(regular).fontSize(8).text(`Начало: ${this.formatDate(incident.startedAt)}`, 56, y + 48, { width: 210 });
      if (incident.rootCause) doc.fillColor('#334155').font(regular).fontSize(8).text(`Причина: ${incident.rootCause}`, 260, y + 48, { width: 270, ellipsis: true });
      doc.fillColor(this.severityColor(incident.severity)).font(bold).fontSize(9).text(this.statusRu(incident.severity), 438, y + 16, { width: 90, align: 'right' });
      y += 88;
    }
    doc.font(regular).fontSize(8).fillColor('#64748b').text('Отчет сформирован системой «Цифровой Наблюдатель».', 42, 780, { width: 510, align: 'center' });

    doc.end();

    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private formatDate(value: Date) {
    return value ? new Date(value).toLocaleString('ru-RU') : '-';
  }

  private statusRu(value: string) {
    const map: Record<string, string> = {
      LOW: 'Низкая',
      MEDIUM: 'Средняя',
      HIGH: 'Высокая',
      CRITICAL: 'Критичная',
      NEW: 'Новый',
      IN_PROGRESS: 'В работе',
      RESOLVED: 'Решен',
    };
    return map[value] || value;
  }

  private severityColor(value: string) {
    if (value === 'CRITICAL' || value === 'HIGH') return '#ef4444';
    if (value === 'MEDIUM') return '#f59e0b';
    return '#10b981';
  }
}
