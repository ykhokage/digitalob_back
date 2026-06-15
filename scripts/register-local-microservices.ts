import { Environment, PrismaClient, ServiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

const localServices = [
  {
    key: 'gateway',
    name: 'API Gateway',
    description: 'Local gateway microservice. Depends on identity, billing, analytics and product platform services.',
    url: 'http://localhost:4100',
    type: 'API Gateway',
    environment: 'PROD',
    responseThresholdMs: 900,
    tags: ['local', 'gateway', 'real-http'],
    groupName: 'Incidents64 Local Platform',
    ownerTeam: 'Platform Team',
    dependencies: ['identity', 'billing', 'analytics', 'notifications', 'orders', 'search', 'cache', 'fraud', 'payment-provider', 'recommendation', 'cdn-edge'],
  },
  {
    key: 'identity',
    name: 'Identity Service',
    description: 'Local identity microservice for users, sessions and profile data.',
    url: 'http://localhost:4101',
    type: 'REST API',
    environment: 'PROD',
    responseThresholdMs: 700,
    tags: ['local', 'identity', 'real-http'],
    groupName: 'Incidents64 Local Platform',
    ownerTeam: 'Identity Team',
    dependencies: [],
  },
  {
    key: 'billing',
    name: 'Billing Service',
    description: 'Local billing microservice for plans, payments and invoices.',
    url: 'http://localhost:4102',
    type: 'REST API',
    environment: 'PROD',
    responseThresholdMs: 700,
    tags: ['local', 'billing', 'real-http'],
    groupName: 'Incidents64 Local Platform',
    ownerTeam: 'Billing Team',
    dependencies: [],
  },
  {
    key: 'analytics',
    name: 'Analytics Service',
    description: 'Local analytics microservice for events, reports and aggregates.',
    url: 'http://localhost:4103',
    type: 'REST API',
    environment: 'PROD',
    responseThresholdMs: 800,
    tags: ['local', 'analytics', 'real-http'],
    groupName: 'Incidents64 Local Platform',
    ownerTeam: 'Analytics Team',
    dependencies: [],
  },
  {
    key: 'notifications',
    name: 'Notification Service',
    description: 'Local notification service for email, Telegram and webhook delivery.',
    url: 'http://localhost:4104',
    type: 'Messaging Service',
    environment: 'PROD',
    responseThresholdMs: 900,
    tags: ['local', 'notifications', 'telegram', 'email'],
    groupName: 'Incidents64 Local Platform',
    ownerTeam: 'SRE Team',
    dependencies: ['identity', 'cache'],
  },
  {
    key: 'orders',
    name: 'Orders Service',
    description: 'Local order service with higher traffic and dependencies on billing and inventory.',
    url: 'http://localhost:4105',
    type: 'REST API',
    environment: 'PROD',
    responseThresholdMs: 1000,
    tags: ['local', 'orders', 'business'],
    groupName: 'Commerce Platform',
    ownerTeam: 'Commerce Team',
    dependencies: ['billing', 'inventory'],
  },
  {
    key: 'inventory',
    name: 'Inventory Service',
    description: 'Local inventory service with moderate disk usage and warehouse stock data.',
    url: 'http://localhost:4106',
    type: 'REST API',
    environment: 'PROD',
    responseThresholdMs: 800,
    tags: ['local', 'inventory', 'warehouse'],
    groupName: 'Commerce Platform',
    ownerTeam: 'Warehouse Team',
    dependencies: [],
  },
  {
    key: 'search',
    name: 'Search Service',
    description: 'Local search service with high RPM, CPU and RAM usage profile.',
    url: 'http://localhost:4107',
    type: 'Search Engine',
    environment: 'PROD',
    responseThresholdMs: 1200,
    tags: ['local', 'search', 'index'],
    groupName: 'Experience Platform',
    ownerTeam: 'Search Team',
    dependencies: [],
  },
  {
    key: 'media',
    name: 'Media Service',
    description: 'Local media service with high disk usage for avatars and exported files.',
    url: 'http://localhost:4108',
    type: 'Object Storage API',
    environment: 'PROD',
    responseThresholdMs: 1100,
    tags: ['local', 'media', 'files'],
    groupName: 'Experience Platform',
    ownerTeam: 'Storage Team',
    dependencies: [],
  },
  {
    key: 'reporting',
    name: 'Reporting Service',
    description: 'Local reporting service for scheduled PDF, Excel and SLA reports.',
    url: 'http://localhost:4109',
    type: 'Worker API',
    environment: 'PROD',
    responseThresholdMs: 1300,
    tags: ['local', 'reports', 'sla'],
    groupName: 'Incidents64 Local Platform',
    ownerTeam: 'Analytics Team',
    dependencies: ['analytics', 'media'],
  },
  {
    key: 'cache',
    name: 'Cache Service',
    description: 'Local cache service with very high RPM and high memory usage.',
    url: 'http://localhost:4110',
    type: 'Cache',
    environment: 'PROD',
    responseThresholdMs: 500,
    tags: ['local', 'cache', 'redis'],
    groupName: 'Shared Infrastructure',
    ownerTeam: 'Platform Team',
    dependencies: [],
  },
  {
    key: 'shipping',
    name: 'Shipping Service',
    description: 'Local shipping service with business dependencies on orders and inventory.',
    url: 'http://localhost:4111',
    type: 'REST API',
    environment: 'PROD',
    responseThresholdMs: 1200,
    tags: ['local', 'shipping', 'business'],
    groupName: 'Commerce Platform',
    ownerTeam: 'Logistics Team',
    dependencies: ['orders', 'inventory'],
  },
  {
    key: 'fraud',
    name: 'Fraud Service',
    description: 'Local fraud scoring service with real HTTP risk-check endpoints.',
    url: 'http://localhost:4112',
    type: 'Risk Engine',
    environment: 'PROD',
    responseThresholdMs: 1000,
    tags: ['local', 'fraud', 'risk', 'ml'],
    groupName: 'Commerce Platform',
    ownerTeam: 'Risk Team',
    dependencies: ['identity', 'orders', 'ml-scoring'],
  },
  {
    key: 'payment-provider',
    name: 'Payment Provider Adapter',
    description: 'Local acquiring adapter for payment authorization and capture flows.',
    url: 'http://localhost:4113',
    type: 'External Adapter',
    environment: 'PROD',
    responseThresholdMs: 1500,
    tags: ['local', 'payments', 'adapter'],
    groupName: 'Commerce Platform',
    ownerTeam: 'Billing Team',
    dependencies: ['billing', 'fraud', 'message-broker'],
  },
  {
    key: 'warehouse-sync',
    name: 'Warehouse Sync Service',
    description: 'Local stock synchronization service with reservation and sync endpoints.',
    url: 'http://localhost:4114',
    type: 'Worker API',
    environment: 'PROD',
    responseThresholdMs: 1600,
    tags: ['local', 'warehouse', 'sync', 'inventory'],
    groupName: 'Commerce Platform',
    ownerTeam: 'Warehouse Team',
    dependencies: ['inventory', 'message-broker'],
  },
  {
    key: 'recommendation',
    name: 'Recommendation Service',
    description: 'Local recommendation service using analytics, search and ML scoring signals.',
    url: 'http://localhost:4115',
    type: 'Recommendation API',
    environment: 'PROD',
    responseThresholdMs: 1100,
    tags: ['local', 'recommendations', 'ml', 'high-rpm'],
    groupName: 'Experience Platform',
    ownerTeam: 'Personalization Team',
    dependencies: ['analytics', 'search', 'ml-scoring', 'cache'],
  },
  {
    key: 'compliance',
    name: 'Audit Compliance Service',
    description: 'Local compliance service for audit checks and sensitive-action policy review.',
    url: 'http://localhost:4116',
    type: 'Compliance API',
    environment: 'PROD',
    responseThresholdMs: 1000,
    tags: ['local', 'audit', 'compliance', 'security'],
    groupName: 'Governance Platform',
    ownerTeam: 'Security Team',
    dependencies: ['identity', 'billing', 'orders'],
  },
  {
    key: 'ml-scoring',
    name: 'ML Scoring Service',
    description: 'Local ML scoring service for risk and personalization models.',
    url: 'http://localhost:4117',
    type: 'ML Model API',
    environment: 'PROD',
    responseThresholdMs: 1300,
    tags: ['local', 'ml', 'scoring', 'cpu'],
    groupName: 'Data Platform',
    ownerTeam: 'Data Science Team',
    dependencies: ['analytics', 'cache'],
  },
  {
    key: 'message-broker',
    name: 'Message Broker Service',
    description: 'Local event broker with topics and message publishing endpoints.',
    url: 'http://localhost:4118',
    type: 'Message Broker',
    environment: 'PROD',
    responseThresholdMs: 700,
    tags: ['local', 'broker', 'events', 'queue'],
    groupName: 'Shared Infrastructure',
    ownerTeam: 'Platform Team',
    dependencies: ['cache'],
  },
  {
    key: 'cdn-edge',
    name: 'CDN Edge Service',
    description: 'Local CDN edge service with cache hit/miss and purge operations.',
    url: 'http://localhost:4119',
    type: 'CDN Edge',
    environment: 'PROD',
    responseThresholdMs: 700,
    tags: ['local', 'cdn', 'edge', 'cache'],
    groupName: 'Experience Platform',
    ownerTeam: 'Storage Team',
    dependencies: ['media', 'cache'],
  },
] as const;

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  const ids = new Map<string, string>();

  for (const service of localServices) {
    const existing = await prisma.microservice.findFirst({
      where: { OR: [{ name: service.name }, { url: service.url }] },
      select: { id: true },
    });

    const data = {
      name: service.name,
      description: service.description,
      url: service.url,
      type: service.type,
      environment: service.environment as Environment,
      checkIntervalSec: 60,
      timeoutMs: 3000,
      expectedStatusCodes: [200] as number[],
      responseThresholdMs: service.responseThresholdMs,
      errorRateThreshold: 10,
      cpuThreshold: 85,
      ramThreshold: 85,
      diskThreshold: 90,
      tags: [...service.tags] as string[],
      groupName: service.groupName,
      ownerTeam: service.ownerTeam,
      monitoringEnabled: true,
      status: ServiceStatus.UNKNOWN,
      userId: admin?.id || null,
    };

    const saved = existing
      ? await prisma.microservice.update({ where: { id: existing.id }, data })
      : await prisma.microservice.create({ data });

    ids.set(service.key, saved.id);
    console.log(`${existing ? 'updated' : 'created'} ${service.name}: ${saved.url}`);
  }

  for (const service of localServices) {
    const sourceId = ids.get(service.key);
    if (!sourceId) continue;

    await prisma.serviceDependency.deleteMany({ where: { sourceId } });

    for (const targetKey of service.dependencies) {
      const targetId = ids.get(targetKey);
      if (!targetId) continue;
      await prisma.serviceDependency.create({
        data: { sourceId, targetId },
      });
      console.log(`linked ${service.key} -> ${targetKey}`);
    }
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
