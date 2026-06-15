import { Injectable } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { PrismaService } from '../prisma/prisma.service';

type DiagnosticStatus = 'OK' | 'WARNING' | 'MISSING';

@Injectable()
export class DiagnosticsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const database = await this.checkDb();
    const lastCheck = await this.prisma.healthCheck.findFirst({
      orderBy: { checkedAt: 'desc' },
      select: { checkedAt: true, kind: true, success: true, service: { select: { name: true } } },
    });

    return {
      generatedAt: new Date(),
      database,
      email: this.emailStatus(),
      telegram: this.telegramStatus(),
      webPush: this.webPushStatus(),
      storage: this.storageStatus(),
      redis: await this.redisStatus(),
      app: this.appStatus(),
      worker: this.workerStatus(lastCheck),
    };
  }

  private item(status: DiagnosticStatus, message: string, details: Record<string, any> = {}) {
    return { status, message, ...details };
  }

  private async checkDb() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.item('OK', 'Database connection is healthy');
    } catch (error: any) {
      return this.item('MISSING', error.message || 'Database connection failed');
    }
  }

  private emailStatus() {
    const apiKey = Boolean(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || null;
    const domain = this.domainFromFrom(from || undefined);

    if (!apiKey) {
      return this.item('MISSING', 'RESEND_API_KEY is not configured', { from, domain });
    }

    if (!from) {
      return this.item('WARNING', 'RESEND_FROM is not configured', { from, domain });
    }

    if (domain !== 'incidents64.fun') {
      return this.item('WARNING', 'Sender domain differs from verified incidents64.fun', { from, domain });
    }

    return this.item('OK', 'Resend sender is configured', { from, domain });
  }

  private telegramStatus() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return this.item('MISSING', 'TELEGRAM_BOT_TOKEN is not configured');
    }

    return this.item('OK', 'Telegram bot token is present');
  }

  private storageStatus() {
    const endpoint = process.env.S3_ENDPOINT || null;
    const bucket = process.env.S3_BUCKET || null;
    const accessKey = this.validEnv(process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY);
    const secretKey = this.validEnv(process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY);

    if (this.validEnv(endpoint) && this.validEnv(bucket) && accessKey && secretKey) {
      return this.item('OK', 'Object storage is configured', { endpoint, bucket, accessKey, secretKey });
    }

    return this.item('MISSING', 'Object storage is incomplete; avatar upload requires Yandex Object Storage', {
      endpoint,
      bucket,
      accessKey,
      secretKey,
    });
  }

  private webPushStatus() {
    const publicKey = Boolean(process.env.VAPID_PUBLIC_KEY);
    const privateKey = Boolean(process.env.VAPID_PRIVATE_KEY);
    const subject = process.env.VAPID_SUBJECT || null;

    if (publicKey && privateKey) {
      return this.item('OK', 'Web Push VAPID keys are configured', { publicKey, privateKey, subject });
    }

    return this.item('MISSING', 'Web Push VAPID keys are not configured', { publicKey, privateKey, subject });
  }

  private async redisStatus() {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || null;
    const upstashToken = Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
    const required = process.env.NOTIFICATIONS_REQUIRE_REDIS === 'true';

    if (!upstashUrl || !upstashToken) {
      return this.item('MISSING', 'Upstash Redis REST credentials are not configured', {
        upstashUrl: Boolean(upstashUrl),
        upstashToken,
        required,
      });
    }

    try {
      const redis = new Redis({ url: upstashUrl, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
      const pong = await redis.ping();
      return this.item('OK', 'Upstash Redis responded to PING', {
        upstashUrl: true,
        upstashToken,
        required,
        ping: pong,
      });
    } catch (error: any) {
      return this.item(required ? 'MISSING' : 'WARNING', error.message || 'Upstash Redis PING failed', {
        upstashUrl: true,
        upstashToken,
        required,
      });
    }
  }

  private appStatus() {
    const frontendUrl = process.env.FRONTEND_URL || null;
    const port = process.env.PORT || '4000';

    if (!frontendUrl) {
      return this.item('WARNING', 'FRONTEND_URL is not configured', { port, frontendUrl });
    }

    return this.item('OK', 'Application environment is configured', { port, frontendUrl });
  }

  private workerStatus(lastCheck: any) {
    if (!lastCheck) {
      return this.item('WARNING', 'Worker has not written health checks yet', { lastCheck: null });
    }

    const ageSec = Math.floor((Date.now() - new Date(lastCheck.checkedAt).getTime()) / 1000);
    if (ageSec > 300) {
      return this.item('WARNING', 'Worker last check is stale', { lastCheck, ageSec });
    }

    return this.item('OK', 'Worker is writing health checks', { lastCheck, ageSec });
  }

  private domainFromFrom(value?: string) {
    const match = value?.match(/@([^>\s]+)/);
    return match?.[1] || null;
  }

  private validEnv(value?: string | null) {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return !['xxx', '...', 'change_me', 'replace_me', 'your_value'].includes(normalized);
  }
}
