import { AuditService } from '../src/audit/audit.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkerService } from '../src/worker/worker.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const audit = new AuditService(prisma);
  const notifications = new NotificationsService(prisma, audit);
  const worker = new WorkerService(prisma, notifications);
  const services = await prisma.microservice.findMany({
    where: { tags: { has: 'local' }, monitoringEnabled: true },
    orderBy: { name: 'asc' },
  });

  for (const service of services) {
    await worker.checkService(service);
    const updated = await prisma.microservice.findUnique({
      where: { id: service.id },
      select: { name: true, status: true },
    });
    console.log(`${updated?.name}: ${updated?.status}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
