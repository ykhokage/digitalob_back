import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditEvent = {
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any> | null;
};

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async record(event: AuditEvent) {
    try {
      return await this.prisma.auditLog.create({
        data: {
          userId: event.userId || null,
          action: event.action,
          entityType: event.entityType || null,
          entityId: event.entityId || null,
          ip: event.ip || null,
          userAgent: event.userAgent || null,
          metadata: event.metadata || undefined,
        },
      });
    } catch {
      return null;
    }
  }

  list(q: any, user?: any) {
    const where: any = user?.role === 'ADMIN' ? {} : { userId: user?.sub };
    if (q.action) where.action = q.action;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) {
      where.createdAt = {
        gte: q.from ? new Date(q.from) : undefined,
        lte: q.to ? new Date(q.to) : undefined,
      };
    }

    return this.prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: Number(q.take) || 100,
    });
  }
}
