import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { email: 'admin@incidents64.fun' },
    update: {
      name: 'Admin',
      role: 'ADMIN',
      emailConfirmed: true,
    },
    create: {
      email: 'admin@incidents64.fun',
      name: 'Admin',
      role: 'ADMIN',
      emailConfirmed: true,
      passwordHash: await bcrypt.hash('Admin12345!', 12),
      telegramChatId: '',
      webhookUrl: '',
    },
  });
}

main().finally(() => prisma.$disconnect());
