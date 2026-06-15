import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  list(q: any, user: any) {
    return this.prisma.metric.findMany({
      where: {
        serviceId: q.serviceId,
        service: { userId: user?.sub },
        createdAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(q.take) || 500,
    });
  }

  async create(dto: any, user: any) {
    await this.assertOwnedService(dto.serviceId, user);
    return this.prisma.metric.create({ data: dto });
  }

  checks(q: any, user: any) {
    return this.prisma.healthCheck.findMany({
      where: {
        serviceId: q.serviceId,
        service: { userId: user?.sub },
        kind: q.kind,
      },
      orderBy: { checkedAt: 'desc' },
      take: Number(q.take) || 100,
    });
  }

  private assertOwnedService(id: string, user?: any) {
    return this.prisma.microservice.findFirstOrThrow({ where: { id, userId: user?.sub }, select: { id: true } });
  }
}
