import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { Redis } from '@upstash/redis';
import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import { Resend } from 'resend';
import webPush from 'web-push';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private telegramUpdateOffset: number | null = null;
  private telegramPolling = false;
  private redis?: Redis;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  rules(user: any) {
    return this.prisma.notificationRule.findMany({
      where: { userId: user.sub },
      include: {
        notifications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setup(user: any) {
    const currentUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: { email: true, telegramChatId: true, maxUserId: true, webhookUrl: true, webPushSubscriptions: { select: { id: true } } },
    });

    return {
      email: {
        ready: Boolean(process.env.RESEND_API_KEY && currentUser.email),
        profileEmail: currentUser.email,
        resendConfigured: Boolean(process.env.RESEND_API_KEY),
        from: process.env.RESEND_FROM ? this.brandedFrom(process.env.RESEND_FROM) : null,
        domain: this.domainFromFrom(process.env.RESEND_FROM),
        hint: process.env.RESEND_API_KEY ? 'Email готов. Уведомления будут приходить на почту из профиля.' : 'Добавьте RESEND_API_KEY и подтвердите incidents64.fun в Resend.',
      },
      telegram: {
        ready: Boolean(process.env.TELEGRAM_BOT_TOKEN && currentUser.telegramChatId),
        tokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        chatId: currentUser.telegramChatId,
        botUsername: process.env.TELEGRAM_BOT_USERNAME || 'monitoringdiplombot',
        botUrl: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME || 'monitoringdiplombot'}`,
        hint: currentUser.telegramChatId
          ? 'Telegram подключён. Бот сможет присылать аварии и сводки.'
          : 'Нажмите "Подключить Telegram", затем Start в боте. ChatId сохранится автоматически.',
      },
      max: {
        ready: Boolean(process.env.MAX_BOT_TOKEN && currentUser.maxUserId),
        tokenConfigured: Boolean(process.env.MAX_BOT_TOKEN),
        userId: currentUser.maxUserId,
        hint: currentUser.maxUserId
          ? 'Max подключён. Сообщения будут уходить в указанный аккаунт.'
          : 'Добавьте MAX_BOT_TOKEN в .env и укажите ID пользователя Max в профиле.',
      },
      webhook: {
        ready: Boolean(currentUser.webhookUrl),
        profileWebhookUrl: currentUser.webhookUrl,
        localTestUrl: 'http://localhost:4100/webhook/incidents64',
        hint: 'Укажите webhook URL в профиле или переопределите получателя в правиле.',
      },
      webPush: {
        ready: this.webPushConfigured() && currentUser.webPushSubscriptions.length > 0,
        configured: this.webPushConfigured(),
        subscriptions: currentUser.webPushSubscriptions.length,
        publicKey: process.env.VAPID_PUBLIC_KEY || null,
        hint: this.webPushConfigured()
          ? 'Включите push-уведомления в браузере, чтобы получать аварии даже без открытого Telegram.'
          : 'Добавьте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY для Web Push.',
      },
    };
  }

  webPushPublicKey() {
    if (!process.env.VAPID_PUBLIC_KEY) throw new BadRequestException('VAPID_PUBLIC_KEY is not configured');
    return { publicKey: process.env.VAPID_PUBLIC_KEY };
  }

  async subscribeWebPush(user: any, dto: any) {
    if (!this.webPushConfigured()) throw new BadRequestException('Web Push is not configured');
    const endpoint = String(dto?.endpoint || '').trim();
    const p256dh = String(dto?.keys?.p256dh || '').trim();
    const auth = String(dto?.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) throw new BadRequestException('Invalid web push subscription');

    const subscription = await this.prisma.webPushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: user.sub,
        p256dh,
        auth,
        userAgent: dto.userAgent || null,
      },
      create: {
        userId: user.sub,
        endpoint,
        p256dh,
        auth,
        userAgent: dto.userAgent || null,
      },
    });

    await this.audit.record({
      userId: user.sub,
      action: 'notification.web_push.subscribed',
      entityType: 'WebPushSubscription',
      entityId: subscription.id,
    });

    return { ok: true, id: subscription.id };
  }

  async unsubscribeWebPush(user: any, endpoint?: string) {
    const removed = await this.prisma.webPushSubscription.deleteMany({
      where: { userId: user.sub, endpoint: endpoint || undefined },
    });

    await this.audit.record({
      userId: user.sub,
      action: 'notification.web_push.unsubscribed',
      entityType: 'WebPushSubscription',
      metadata: { endpoint: endpoint || null, removed: removed.count },
    });

    return { ok: true, removed: removed.count };
  }

  async createTelegramLink(user: any) {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new BadRequestException('TELEGRAM_BOT_TOKEN is not configured');

    const currentUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: { id: true, email: true },
    });
    const code = randomBytes(12).toString('base64url');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'monitoringdiplombot';

    await this.prisma.emailToken.updateMany({
      where: { type: 'TELEGRAM_LINK', email: currentUser.email, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.emailToken.create({
      data: {
        email: currentUser.email,
        tokenHash: this.hashToken(code),
        type: 'TELEGRAM_LINK',
        expiresAt,
        payload: { userId: currentUser.id },
      },
    });

    await this.audit.record({
      userId: currentUser.id,
      action: 'notification.telegram.link_created',
      entityType: 'User',
      entityId: currentUser.id,
      metadata: { expiresAt },
    });

    return {
      ok: true,
      code,
      expiresAt,
      botUsername,
      botUrl: `https://t.me/${botUsername}?start=${code}`,
      hint: 'Откройте ссылку, нажмите Start в Telegram, затем вернитесь в Цифровой Наблюдатель.',
    };
  }

  createRule(user: any, dto: any) {
    this.assertSupportedChannel(dto.channel);
    return this.prisma.notificationRule.create({
      data: {
        ...dto,
        userId: user.sub,
        config: this.normalizeRuleConfig(dto),
      },
    });
  }

  async updateRule(user: any, id: string, dto: any) {
    if (dto.channel) this.assertSupportedChannel(dto.channel);
    const updated = await this.prisma.notificationRule.updateMany({
      where: { id, userId: user.sub },
      data: {
        ...dto,
        config: 'config' in dto ? this.normalizeRuleConfig(dto) : undefined,
      },
    });

    if (!updated.count) throw new NotFoundException('Notification rule not found');

    return this.prisma.notificationRule.findUniqueOrThrow({ where: { id } });
  }

  async removeRule(user: any, id: string) {
    const removed = await this.prisma.notificationRule.deleteMany({
      where: { id, userId: user.sub },
    });

    if (!removed.count) throw new NotFoundException('Notification rule not found');

    return { ok: true };
  }

  log(user: any, q: any) {
    return this.prisma.notification.findMany({
      where: {
        serviceId: q.serviceId,
        incidentId: q.incidentId,
        channel: q.channel,
        OR: [{ rule: { userId: user.sub } }, { service: { userId: user.sub } }],
      },
      include: { service: true, incident: true, rule: true },
      orderBy: { createdAt: 'desc' },
      take: Number(q.take) || 100,
    });
  }

  async ack(user: any, id: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id, OR: [{ rule: { userId: user.sub } }, { service: { userId: user.sub } }] },
      data: { acknowledgedAt: new Date() },
    });

    if (!updated.count) throw new NotFoundException('Notification not found');

    await this.audit.record({
      userId: user.sub,
      action: 'notification.acknowledged',
      entityType: 'Notification',
      entityId: id,
    });

    return { ok: true };
  }

  async enqueue(dto: any) {
    const service = dto.serviceId
      ? await this.prisma.microservice.findUnique({
          where: { id: dto.serviceId },
          select: { id: true, userId: true },
        })
      : null;

    const rules = await this.prisma.notificationRule.findMany({
      where: {
        enabled: true,
        type: dto.type,
        userId: service?.userId || undefined,
      },
      include: { user: true },
    });

    if (!rules.length) {
      return this.prisma.notification.create({
        data: {
          serviceId: dto.serviceId,
          incidentId: dto.incidentId,
          type: dto.type,
          channel: dto.channel || 'EMAIL',
          payload: { ...dto.payload, noMatchingRule: true },
          dedupeKey: dto.dedupeKey || this.dedupeKey(dto),
          failedAt: new Date(),
          error: 'No enabled notification rule matched this event',
        },
      });
    }

    const created: any[] = [];
    const deliveredTargets = new Set<string>();
    for (const rule of rules) {
      if (this.isQuietNow(rule.quietHoursStart, rule.quietHoursEnd)) continue;

      const recipient = this.recipientFor(rule, rule.user);
      const targetKey = `${rule.channel}:${recipient || 'not-configured'}`;
      if (deliveredTargets.has(targetKey)) continue;

      const dedupeKey = dto.dedupeKey || this.dedupeKey(dto);
      const duplicate = await this.isDuplicate(rule, dedupeKey);

      if (duplicate) continue;

      const notification = await this.prisma.notification.create({
        data: {
          serviceId: dto.serviceId,
          incidentId: dto.incidentId,
          ruleId: rule.id,
          type: dto.type,
          channel: rule.channel,
          recipient,
          payload: dto.payload || {},
          dedupeKey,
        },
        include: { rule: true, service: true, incident: true },
      });

      deliveredTargets.add(targetKey);
      created.push(await this.sendAndPersist(notification));
    }

    return created;
  }

  async test(user: any, channel: string, recipient?: string) {
    const normalized = channel?.toUpperCase();
    this.assertSupportedChannel(normalized);
    const currentUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    const notification = {
      id: 'test',
      type: 'REPORT',
      channel: normalized,
      recipient: recipient || this.recipientFor({ channel: normalized, config: {} }, currentUser),
      payload: { message: 'Тестовое уведомление доставлено. Канал работает.', demoTitle: 'Проверка канала' },
      rule: { userId: currentUser.id },
      service: null,
      incident: null,
      createdAt: new Date(),
    };

    await this.send(notification);
    await this.audit.record({
      userId: user.sub,
      action: 'notification.test_sent',
      entityType: 'Notification',
      metadata: { channel: normalized, recipient: notification.recipient },
    });
    return { ok: true };
  }

  async sendReportNow(user: any, id: string) {
    const rule = await this.prisma.notificationRule.findFirst({
      where: { id, userId: user.sub },
      include: { user: true },
    });

    if (!rule) throw new NotFoundException('Notification rule not found');
    if (rule.type !== 'REPORT') throw new BadRequestException('Only report rules can be sent now');

    const config = this.configFor(rule);
    const intervalHours = Number(config.intervalHours || 24);
    const summary = await this.buildServiceStatusSummary(rule.userId, intervalHours);
    const notification = await this.prisma.notification.create({
      data: {
        ruleId: rule.id,
        type: 'REPORT',
        channel: rule.channel,
        recipient: this.recipientFor(rule, rule.user),
        payload: { ...summary, manual: true },
        dedupeKey: `REPORT_NOW:${rule.userId}:${Date.now()}`,
      },
      include: { rule: true, service: true, incident: true },
    });

    const sent = await this.sendAndPersist(notification);
    await this.prisma.notificationRule.update({
      where: { id: rule.id },
      data: {
        config: {
          ...config,
          intervalHours,
          lastSentAt: sent.sentAt ? new Date().toISOString() : config.lastSentAt,
          lastAttemptAt: new Date().toISOString(),
        },
      },
    });
    await this.audit.record({
      userId: user.sub,
      action: 'notification.report.sent_now',
      entityType: 'NotificationRule',
      entityId: id,
      metadata: { channel: rule.channel, sent: Boolean(sent.sentAt), error: sent.error },
    });

    return sent;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchPending() {
    const pending = await this.prisma.notification.findMany({
      where: { sentAt: null, failedAt: null },
      include: { rule: true, service: true, incident: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const notification of pending) {
      await this.sendAndPersist(notification);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async enqueuePeriodicStatusReports() {
    const rules = await this.prisma.notificationRule.findMany({
      where: { enabled: true, type: 'REPORT' },
      include: { user: true },
    });

    for (const rule of rules) {
      const config = this.configFor(rule);
      const intervalHours = Number(config.intervalHours || 0);
      if (![6, 8, 12, 24].includes(intervalHours)) continue;

      const lastActivityAt =
        typeof config.lastSentAt === 'string'
          ? new Date(config.lastSentAt)
          : typeof config.lastAttemptAt === 'string'
            ? new Date(config.lastAttemptAt)
            : null;
      const due = !lastActivityAt || Date.now() - lastActivityAt.getTime() >= intervalHours * 60 * 60 * 1000;
      if (!due || this.isQuietNow(rule.quietHoursStart, rule.quietHoursEnd)) continue;

      const summary = await this.buildServiceStatusSummary(rule.userId, intervalHours);
      const notification = await this.prisma.notification.create({
        data: {
          ruleId: rule.id,
          type: 'REPORT',
          channel: rule.channel,
          recipient: this.recipientFor(rule, rule.user),
          payload: summary,
          dedupeKey: `REPORT:${rule.userId}:${intervalHours}:${new Date().toISOString().slice(0, 13)}`,
        },
        include: { rule: true, service: true, incident: true },
      });

      const sent = await this.sendAndPersist(notification);
      await this.prisma.notificationRule.update({
        where: { id: rule.id },
        data: {
          config: {
            ...config,
            intervalHours,
            lastSentAt: sent.sentAt ? new Date().toISOString() : config.lastSentAt,
            lastAttemptAt: new Date().toISOString(),
          },
        },
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async enqueueEscalations() {
    const rules = await this.prisma.notificationRule.findMany({
      where: { enabled: true, escalationMinutes: { not: null }, type: { not: 'REPORT' } },
      include: { user: true },
    });

    for (const rule of rules) {
      const minutes = Number(rule.escalationMinutes || 0);
      if (!minutes || this.isQuietNow(rule.quietHoursStart, rule.quietHoursEnd)) continue;

      const since = new Date(Date.now() - minutes * 60 * 1000);
      const incidents = await this.prisma.incident.findMany({
        where: {
          status: { not: 'RESOLVED' },
          service: { userId: rule.userId },
          notifications: { some: { ruleId: rule.id, type: rule.type, sentAt: { not: null } } },
        },
        include: {
          service: true,
          notifications: {
            where: { ruleId: rule.id },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        take: 50,
      });

      for (const incident of incidents) {
        const last = incident.notifications[0];
        const lastAt = last?.createdAt || incident.startedAt;
        if (lastAt > since) continue;

        const dedupeKey = `ESCALATION:${rule.id}:${incident.id}:${Math.floor(Date.now() / (minutes * 60 * 1000))}`;
        if (await this.isDuplicate(rule, dedupeKey)) continue;

        const notification = await this.prisma.notification.create({
          data: {
            serviceId: incident.serviceId,
            incidentId: incident.id,
            ruleId: rule.id,
            type: rule.type,
            channel: rule.channel,
            recipient: this.recipientFor(rule, rule.user),
            payload: {
              service: incident.service.name,
              message: `[WARNING] ${incident.service.name}: инцидент всё ещё открыт\n${incident.title}\nСтатус: ${incident.status}`,
              escalation: true,
              minutes,
            },
            dedupeKey,
          },
          include: { rule: true, service: true, incident: true },
        });

        await this.sendAndPersist(notification);
      }
    }
  }

  @Interval(10000)
  async pollTelegramUpdates() {
    if (!process.env.TELEGRAM_BOT_TOKEN || this.telegramPolling) return;
    this.telegramPolling = true;

    try {
      const response = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`, {
        offset: this.telegramUpdateOffset === null ? undefined : this.telegramUpdateOffset,
        timeout: 0,
        allowed_updates: ['message'],
      });
      const updates = Array.isArray(response.data?.result) ? response.data.result : [];

      for (const update of updates) {
        this.telegramUpdateOffset = Math.max(this.telegramUpdateOffset ?? 0, Number(update.update_id) + 1);
        await this.handleTelegramUpdate(update);
      }
    } catch (error: any) {
      this.logger.warn(`Telegram polling failed: ${error.message || 'unknown error'}`);
    } finally {
      this.telegramPolling = false;
    }
  }

  private async sendAndPersist(notification: any) {
    try {
      await this.send(notification);
      return this.prisma.notification.update({
        where: { id: notification.id },
        data: { sentAt: new Date(), failedAt: null, error: null },
      });
    } catch (error: any) {
      this.logger.warn(`Notification ${notification.id}: ${error.message}`);
      return this.prisma.notification.update({
        where: { id: notification.id },
        data: { failedAt: new Date(), error: error.message || 'Failed to send notification' },
      });
    }
  }

  private async isDuplicate(rule: any, dedupeKey: string) {
    const windowSec = Number(rule.dedupeWindowSec || 900);
    const redis = this.redisClient();

    if (redis) {
      try {
        const key = `incidents64:notification:${rule.id}:${dedupeKey}`;
        const stored = await redis.set(key, '1', { nx: true, ex: windowSec });
        return stored !== 'OK';
      } catch (error: any) {
        if (this.redisRequired()) {
          throw new Error(`Upstash Redis dedupe failed: ${error.message || 'unknown error'}`);
        }
        this.logger.warn(`Redis dedupe fallback: ${error.message || 'unknown error'}`);
      }
    }

    if (this.redisRequired()) {
      throw new Error('Upstash Redis is required for notification dedupe. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
    }

    const dedupeSince = new Date(Date.now() - windowSec * 1000);
    const duplicate = await this.prisma.notification.findFirst({
      where: {
        ruleId: rule.id,
        dedupeKey,
        createdAt: { gte: dedupeSince },
      },
      select: { id: true },
    });

    return Boolean(duplicate);
  }

  private redisClient() {
    if (this.redis) return this.redis;

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;

    this.redis = new Redis({ url, token });
    return this.redis;
  }

  private redisRequired() {
    return process.env.NOTIFICATIONS_REQUIRE_REDIS === 'true';
  }

  private async send(notification: any) {
    if (notification.channel === 'WEB_PUSH') {
      return this.sendWebPush(notification);
    }

    if (!notification.recipient) {
      throw new Error('Notification recipient is not configured');
    }

    const subject = this.subject(notification);
    const text = this.text(notification);

    if (notification.channel === 'EMAIL') {
      return this.sendEmail(notification.recipient, subject, text, this.emailHtml(notification, subject, text));
    }

    if (notification.channel === 'TELEGRAM') {
      return this.sendTelegram(notification.recipient, this.telegramText(notification, subject, text), 'HTML');
    }

    if (notification.channel === 'MAX') {
      return this.sendMax(notification.recipient, this.telegramText(notification, subject, text));
    }

    if (notification.channel === 'WEBHOOK') {
      return this.sendWebhook(notification.recipient, notification);
    }

    throw new Error(`Unsupported notification channel: ${notification.channel}`);
  }

  private async sendWebPush(notification: any) {
    if (!this.webPushConfigured()) throw new Error('Web Push is not configured');
    const userId = notification.rule?.userId;
    if (!userId) throw new Error('Web Push recipient user is not configured');

    webPush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@incidents64.fun', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

    const subscriptions = await this.prisma.webPushSubscription.findMany({ where: { userId } });
    if (!subscriptions.length) throw new Error('Web Push subscription is not configured');

    const payload = JSON.stringify({
      title: this.subject(notification),
      body: this.shortText(notification),
      url: `${this.frontendUrl()}/incidents`,
      notificationId: notification.id,
      type: notification.type,
    });

    let sent = 0;
    for (const subscription of subscriptions) {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
        );
        sent += 1;
      } catch (error: any) {
        if ([404, 410].includes(Number(error.statusCode))) {
          await this.prisma.webPushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
        } else {
          throw error;
        }
      }
    }

    if (!sent) throw new Error('No active Web Push subscriptions');
  }

  private async sendEmail(to: string, subject: string, text: string, html: string) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');

    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: this.brandedFrom(process.env.RESEND_FROM || 'noreply@incidents64.fun'),
      to,
      subject,
      text,
      html,
    });

    if (result.error) throw new Error(result.error.message);
  }

  private async sendTelegram(chatId: string, text: string, parseMode?: 'HTML') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    });
  }

  private async sendMax(userId: string, text: string) {
    const token = process.env.MAX_BOT_TOKEN;
    if (!token) throw new Error('MAX_BOT_TOKEN is not configured');

    await axios.post(
      'https://platform-api.max.ru/messages',
      {
        text,
        format: 'html',
        notify: true,
      },
      {
        headers: { Authorization: token },
        params: { user_id: userId, disable_link_preview: true },
      },
    );
  }

  private async handleTelegramUpdate(update: any) {
    const message = update.message;
    const text = typeof message?.text === 'string' ? message.text.trim() : '';
    const chatId = message?.chat?.id;
    if (!text.startsWith('/start') || !chatId) return;

    const code = text.split(/\s+/)[1];
    if (!code) {
      await this.sendTelegram(String(chatId), 'Цифровой Наблюдатель: откройте подключение из личного кабинета, чтобы привязать Telegram.');
      return;
    }

    const token = await this.prisma.emailToken.findFirst({
      where: {
        type: 'TELEGRAM_LINK',
        tokenHash: this.hashToken(code),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    const payload = token?.payload && typeof token.payload === 'object' && !Array.isArray(token.payload) ? (token.payload as { userId?: string }) : {};
    if (!token || !payload.userId) {
      await this.sendTelegram(String(chatId), 'Цифровой Наблюдатель: ссылка устарела. Создайте новое подключение в разделе уведомлений.');
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: payload.userId },
        data: { telegramChatId: String(chatId) },
      });
      await tx.emailToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      });
    });

    await this.audit.record({
      userId: payload.userId,
      action: 'notification.telegram.linked',
      entityType: 'User',
      entityId: payload.userId,
      metadata: { chatId: String(chatId) },
    });
    await this.sendTelegram(String(chatId), 'Цифровой Наблюдатель: Telegram подключён. Теперь сюда будут приходить уведомления о сервисах.');
  }

  private async sendWebhook(url: string, notification: any) {
    await axios.post(url, {
      id: notification.id,
      type: notification.type,
      service: notification.service,
      incident: notification.incident,
      payload: notification.payload,
      createdAt: notification.createdAt,
    });
  }

  private recipientFor(rule: any, user: any) {
    const config = this.configFor(rule);

    if (typeof config.recipient === 'string' && config.recipient.trim()) return config.recipient.trim();
    if (rule.channel === 'EMAIL') return user.email;
    if (rule.channel === 'TELEGRAM') return user.telegramChatId;
    if (rule.channel === 'MAX') return user.maxUserId;
    if (rule.channel === 'WEBHOOK') return user.webhookUrl;
    if (rule.channel === 'WEB_PUSH') return 'browser subscriptions';

    return null;
  }

  private dedupeKey(dto: any) {
    return `${dto.type}:${dto.serviceId || 'system'}:${dto.incidentId || 'none'}`;
  }

  private subject(notification: any) {
    if (notification.type === 'SERVICE_DOWN') return `${notification.service?.name || 'Service'} недоступен`;
    if (notification.type === 'SERVICE_RECOVERED') return `${notification.service?.name || 'Service'} восстановлен`;
    if (notification.type === 'THRESHOLD_EXCEEDED') return `${notification.service?.name || 'Service'}: превышен порог`;
    if (notification.type === 'DEPENDENCY_PROBLEM') return `${notification.service?.name || 'Service'}: проблема зависимости`;
    if (notification.type === 'REPORT') return 'Цифровой Наблюдатель: сводка по сервисам';

    return `Цифровой Наблюдатель: ${this.eventTitle(notification.type)}`;
  }

  private text(notification: any) {
    const payload = notification.payload || {};
    const service = notification.service?.name || payload.service || 'Service';

    if (typeof payload.message === 'string') {
      return payload.message;
    }

    if (notification.type === 'SERVICE_DOWN') {
      return [
        `[CRITICAL] ${service} недоступен`,
        payload.statusCode ? `HTTP: ${payload.statusCode}` : null,
        payload.error ? `Причина: ${payload.error}` : null,
        `Открыть инциденты: ${this.frontendUrl()}/incidents`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (notification.type === 'SERVICE_RECOVERED') {
      return `[OK] ${service} восстановлен`;
    }

    if (notification.type === 'THRESHOLD_EXCEEDED') {
      return `[WARNING] ${service}: ${this.metricLabel(payload.metric)} выше нормы\nСейчас: ${this.metricValue(payload.metric, payload.value)}\nПорог: ${this.metricValue(payload.metric, payload.threshold)}`;
    }

    if (notification.type === 'DEPENDENCY_PROBLEM') {
      return `[WARNING] ${service}: проблема с зависимым сервисом\nПроверьте связанные сервисы в панели «Цифровой Наблюдатель».`;
    }

    if (notification.type === 'REPORT') {
      if (typeof payload.summaryText === 'string') return payload.summaryText;
      return this.statusReportText(payload);
    }

    return `${notification.type}: ${JSON.stringify(payload)}`;
  }

  private shortText(notification: any) {
    const payload = notification.payload || {};
    if (typeof payload.message === 'string') return payload.message;
    if (notification.type === 'REPORT') return 'Сводка по состоянию микросервисов готова.';
    return `${this.eventTitle(notification.type)}: ${notification.service?.name || payload.service || 'сервис'}`;
  }

  private emailHtml(notification: any, subject: string, text: string) {
    const payload = notification.payload || {};
    const serviceName = notification.service?.name || payload.service || 'Сервис';
    const severity = this.notificationSeverity(notification);
    const color = this.severityColor(severity);
    const rows = this.detailRows(notification);
    const reportServices = notification.type === 'REPORT' && Array.isArray(payload.services) ? payload.services.slice(0, 8) : [];
    const actionUrl = this.actionUrl(notification);

    return `
      <div style="margin:0;padding:0;background:#f3f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:28px 12px">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 22px 60px rgba(15,23,42,.12)">
                <tr>
                  <td style="background:#0f172a;padding:26px 30px">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <div style="display:inline-block;width:42px;height:42px;border-radius:12px;background:#0f766e;vertical-align:middle;margin-right:12px;text-align:center;line-height:42px;color:#ccfbf1;font-weight:700">CN</div>
                          <span style="color:#f8fafc;font-size:20px;font-weight:700;vertical-align:middle">Цифровой Наблюдатель</span>
                          <div style="color:#cbd5e1;font-size:13px;margin-top:8px">Мониторинг микросервисной архитектуры</div>
                        </td>
                        <td align="right" style="color:#cbd5e1;font-size:12px">${this.escapeHtml(new Date().toLocaleString('ru-RU'))}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px">
                    <div style="display:inline-block;border-radius:999px;background:${color}1A;color:${color};font-size:12px;font-weight:700;padding:7px 12px;margin-bottom:14px">${this.escapeHtml(this.eventTitle(notification.type))}</div>
                    <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;color:#0f172a">${this.escapeHtml(subject)}</h1>
                    <p style="margin:0;color:#64748b;font-size:14px;line-height:1.55">${this.escapeHtml(serviceName)}</p>

                    <div style="margin:22px 0;padding:18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;font-size:14px;line-height:1.6">
                      ${this.escapeHtml(text).replace(/\n/g, '<br>')}
                    </div>

                    ${
                      rows.length
                        ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 8px;margin:6px 0 18px">
                            ${rows
                              .map(
                                ([label, value]) => `
                                  <tr>
                                    <td style="width:42%;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-right:0;border-radius:10px 0 0 10px;color:#64748b;font-size:13px">${this.escapeHtml(label)}</td>
                                    <td style="padding:12px 14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:0 10px 10px 0;color:#0f172a;font-size:13px;font-weight:700">${this.escapeHtml(value)}</td>
                                  </tr>`,
                              )
                              .join('')}
                          </table>`
                        : ''
                    }

                    ${
                      reportServices.length
                        ? `<div style="margin-top:20px">
                            <h2 style="font-size:16px;margin:0 0 10px;color:#0f172a">Сервисы в сводке</h2>
                            ${reportServices
                              .map(
                                (service: any) => `
                                  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:8px">
                                    <div style="font-weight:700;color:#0f172a">${this.escapeHtml(service.name || 'Сервис')}</div>
                                    <div style="font-size:12px;color:#64748b;margin-top:4px">Статус: ${this.escapeHtml(this.statusRu(service.status))} · Ответ: ${service.responseTimeMs ?? '-'} мс · Ошибки: ${service.errorRate ?? '-'}%</div>
                                  </div>`,
                              )
                              .join('')}
                          </div>`
                        : ''
                    }

                    <div style="margin-top:24px">
                      <a href="${actionUrl}" style="display:inline-block;background:#14b8a6;color:#06201d;text-decoration:none;padding:13px 18px;border-radius:12px;font-weight:700;font-size:14px">Открыть панель мониторинга</a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 30px;background:#f8fafc;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;line-height:1.5">
                    Это автоматическое уведомление системы «Цифровой Наблюдатель». Если сообщение неактуально, проверьте правила уведомлений и дедупликацию в панели.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>`;
  }

  private telegramText(notification: any, subject: string, text: string) {
    if (notification.type === 'REPORT') {
      const lines = [
        `<b>${this.escapeTelegram(subject)}</b>`,
        '',
        this.escapeTelegram(text),
        '',
        `<a href="${this.actionUrl(notification)}">Открыть панель мониторинга</a>`,
      ];
      return lines.join('\n');
    }

    const rows = this.detailRows(notification);
    const payload = notification.payload || {};
    const service = notification.service?.name || payload.service;
    const lines = [
      `<b>Цифровой Наблюдатель</b>`,
      `<b>${this.escapeTelegram(subject)}</b>`,
      service ? `Сервис: <b>${this.escapeTelegram(service)}</b>` : null,
      '',
      this.escapeTelegram(text),
      '',
      ...rows.map(([label, value]) => `<b>${this.escapeTelegram(label)}:</b> ${this.escapeTelegram(value)}`),
      '',
      `<a href="${this.actionUrl(notification)}">Открыть панель мониторинга</a>`,
    ];
    return lines.filter((line) => line !== null).join('\n');
  }

  private detailRows(notification: any): [string, string][] {
    const payload = notification.payload || {};
    const rows: [string, string][] = [];
    if (notification.service?.status) rows.push(['Статус сервиса', this.statusRu(notification.service.status)]);
    if (notification.incident?.severity) rows.push(['Критичность', this.statusRu(notification.incident.severity)]);
    if (notification.incident?.status) rows.push(['Статус инцидента', this.statusRu(notification.incident.status)]);
    if (payload.metric) rows.push(['Метрика', this.metricLabel(payload.metric)]);
    if (payload.value !== undefined) rows.push(['Текущее значение', this.metricValue(payload.metric, payload.value)]);
    if (payload.threshold !== undefined) rows.push(['Порог', this.metricValue(payload.metric, payload.threshold)]);
    if (payload.intervalHours) rows.push(['Период сводки', `${payload.intervalHours} ч`]);
    if (payload.totals?.total !== undefined) rows.push(['Всего сервисов', String(payload.totals.total)]);
    return rows;
  }

  private actionUrl(notification: any) {
    if (notification.incidentId) return `${this.frontendUrl()}/incidents/${notification.incidentId}`;
    if (notification.serviceId) return `${this.frontendUrl()}/services/${notification.serviceId}`;
    if (notification.type === 'REPORT') return `${this.frontendUrl()}/analytics`;
    return `${this.frontendUrl()}/`;
  }

  private async buildServiceStatusSummary(userId: string, intervalHours: number) {
    const services = await this.prisma.microservice.findMany({
      where: { userId },
      include: {
        metrics: { orderBy: { createdAt: 'desc' }, take: 1 },
        incidents: { where: { status: { not: 'RESOLVED' } }, orderBy: { startedAt: 'desc' }, take: 5 },
      },
      orderBy: { name: 'asc' },
    });

    const totals = services.reduce(
      (acc, service) => {
        acc.total += 1;
        acc[service.status.toLowerCase()] = (acc[service.status.toLowerCase()] || 0) + 1;
        return acc;
      },
      { total: 0 } as Record<string, number>,
    );

    const payload = {
      periodic: true,
      intervalHours,
      generatedAt: new Date().toISOString(),
      totals,
      services: services.map((service) => {
        const metric = service.metrics[0];
        return {
          id: service.id,
          name: service.name,
          url: service.url,
          status: service.status,
          responseTimeMs: metric?.responseTimeMs ?? null,
          availability: metric?.availability ?? null,
          errorRate: metric?.errorRate ?? null,
          openIncidents: service.incidents.length,
        };
      }),
    };

    return { ...payload, summaryText: this.statusReportText(payload) };
  }

  private statusReportText(payload: any) {
    const services = Array.isArray(payload.services) ? payload.services : [];
    const totals = payload.totals || {};
    const interval = payload.intervalHours ? `${payload.intervalHours} ч` : 'выбранный интервал';
    const lines = [
      `Сводка за ${interval}`,
      `Всего: ${totals.total ?? services.length} | OK: ${totals.ok || 0} | Warning: ${totals.warning || 0} | Critical: ${totals.critical || 0}`,
      '',
      ...services.map((service: any) => {
        const response = service.responseTimeMs === null || service.responseTimeMs === undefined ? '-' : `${service.responseTimeMs} мс`;
        const details = [`${this.statusLabel(service.status)} ${service.name}`, response];
        if (Number(service.errorRate) > 0) details.push(`ошибки ${this.formatNumber(service.errorRate)}%`);
        if (Number(service.openIncidents) > 0) details.push(`инциденты: ${service.openIncidents}`);
        return details.join(' - ');
      }),
    ];

    return lines.join('\n');
  }

  private frontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private statusLabel(status: string) {
    if (status === 'OK') return '[OK]';
    if (status === 'WARNING') return '[WARNING]';
    if (status === 'CRITICAL') return '[CRITICAL]';
    if (status === 'DISABLED') return '[DISABLED]';
    return '[UNKNOWN]';
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
    return map[value] || value || '-';
  }

  private eventTitle(type: string) {
    const map: Record<string, string> = {
      SERVICE_DOWN: 'Сервис недоступен',
      SERVICE_RECOVERED: 'Сервис восстановлен',
      THRESHOLD_EXCEEDED: 'Превышен порог',
      SYSTEM_OVERLOAD: 'Перегрузка системы',
      DEPENDENCY_PROBLEM: 'Проблема зависимости',
      SSL_EXPIRING: 'Истекает SSL',
      REPORT: 'Сводка по сервисам',
    };
    return map[type] || type || 'Уведомление';
  }

  private notificationSeverity(notification: any) {
    if (notification.type === 'SERVICE_DOWN') return 'CRITICAL';
    if (notification.type === 'SERVICE_RECOVERED') return 'OK';
    if (notification.type === 'REPORT') return 'INFO';
    return notification.incident?.severity || notification.service?.status || 'WARNING';
  }

  private severityColor(value: string) {
    if (value === 'OK' || value === 'LOW' || value === 'RESOLVED') return '#10b981';
    if (value === 'WARNING' || value === 'MEDIUM' || value === 'INFO') return '#f59e0b';
    if (value === 'CRITICAL' || value === 'HIGH') return '#ef4444';
    return '#14b8a6';
  }

  private metricLabel(metric: string) {
    if (metric === 'responseTimeMs') return 'время ответа';
    if (metric === 'errorRate') return 'ошибки';
    if (metric === 'cpuUsage') return 'CPU';
    if (metric === 'ramUsage') return 'RAM';
    if (metric === 'diskUsage') return 'диск';
    return metric || 'метрика';
  }

  private metricUnit(metric: string) {
    if (metric === 'responseTimeMs') return ' мс';
    if (['errorRate', 'cpuUsage', 'ramUsage', 'diskUsage'].includes(metric)) return '%';
    return '';
  }

  private metricValue(metric: string, value: any) {
    const numeric = Number(value);
    const normalized = Number.isFinite(numeric) ? this.formatNumber(numeric) : value;
    return `${normalized}${this.metricUnit(metric)}`;
  }

  private formatNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  private normalizeRuleConfig(dto: any) {
    const config = dto.config && typeof dto.config === 'object' ? { ...dto.config } : {};
    if (typeof config.recipient === 'string') config.recipient = config.recipient.trim();

    if (dto.type === 'REPORT') {
      const intervalHours = Number(config.intervalHours || 24);
      config.intervalHours = [6, 8, 12, 24].includes(intervalHours) ? intervalHours : 24;
    }

    return config;
  }

  private assertSupportedChannel(channel: string) {
    if (!['EMAIL', 'TELEGRAM', 'MAX', 'WEBHOOK', 'WEB_PUSH'].includes(channel)) throw new BadRequestException('Unsupported notification channel');
  }

  private webPushConfigured() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  private configFor(rule: any) {
    return rule.config && typeof rule.config === 'object' && !Array.isArray(rule.config) ? rule.config : {};
  }

  private escapeHtml(value: string) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
  }

  private escapeTelegram(value: string) {
    return this.escapeHtml(String(value ?? ''));
  }

  private domainFromFrom(value?: string) {
    const match = value?.match(/@([^>\s]+)/);
    return match?.[1] || null;
  }

  private brandedFrom(value: string) {
    const email = value.match(/<([^>]+)>/)?.[1] || value.trim();
    return `Цифровой Наблюдатель <${email}>`;
  }

  private isQuietNow(start?: string | null, end?: string | null) {
    if (!start || !end) return false;

    const startMinutes = this.timeToMinutes(start);
    const endMinutes = this.timeToMinutes(end);
    if (startMinutes === null || endMinutes === null) return false;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (startMinutes < endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }

    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }

  private timeToMinutes(value: string) {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
  }
}
