import { NotificationChannel, NotificationType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const webhookUrl = 'http://localhost:4100/webhook/incidents64';

const rules = [
  { type: NotificationType.SERVICE_DOWN, name: 'Webhook: сервис упал' },
  { type: NotificationType.SERVICE_RECOVERED, name: 'Webhook: сервис восстановился' },
  { type: NotificationType.DEPENDENCY_PROBLEM, name: 'Webhook: проблема зависимости' },
  { type: NotificationType.THRESHOLD_EXCEEDED, name: 'Webhook: превышен порог' },
  { type: NotificationType.REPORT, name: 'Webhook: сводка каждые 6 часов', config: { intervalHours: 6 } },
];

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
  });

  if (!admin) {
    throw new Error('Admin user was not found. Create or confirm an admin account first.');
  }

  for (const rule of rules) {
    const config = { ...(rule.config || {}), recipient: webhookUrl };
    const existing = await prisma.notificationRule.findFirst({
      where: { userId: admin.id, type: rule.type, channel: NotificationChannel.WEBHOOK, name: rule.name },
      select: { id: true },
    });

    const saved = existing
      ? await prisma.notificationRule.update({
          where: { id: existing.id },
          data: {
            enabled: true,
            dedupeWindowSec: rule.type === NotificationType.REPORT ? 60 : 5,
            config,
          },
        })
      : await prisma.notificationRule.create({
          data: {
            userId: admin.id,
            name: rule.name,
            type: rule.type,
            channel: NotificationChannel.WEBHOOK,
            enabled: true,
            dedupeWindowSec: rule.type === NotificationType.REPORT ? 60 : 5,
            config,
          },
        });

    console.log(`${existing ? 'updated' : 'created'} ${saved.name} -> ${webhookUrl}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
