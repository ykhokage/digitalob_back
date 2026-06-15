import { Redis } from '@upstash/redis';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

export class RedisThrottlerStorage implements ThrottlerStorage {
  private redis?: Redis;

  private client() {
    if (this.redis) return this.redis;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    this.redis = new Redis({ url, token });
    return this.redis;
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const redis = this.client();
    if (!redis) {
      throw new Error('Redis throttler storage is not configured');
    }

    const safeName = throttlerName || 'default';
    const hitKey = `incidents64:rate:${safeName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    const blockTtl = Number(await (redis as any).pttl(blockKey));

    if (blockTtl > 0) {
      const ttlMs = Math.max(0, Number(await (redis as any).pttl(hitKey)));
      return { totalHits: limit + 1, timeToExpire: ttlMs, isBlocked: true, timeToBlockExpire: blockTtl };
    }

    const totalHits = Number(await redis.incr(hitKey));
    if (totalHits === 1) {
      await (redis as any).pexpire(hitKey, ttl);
    }

    const ttlMs = Math.max(0, Number(await (redis as any).pttl(hitKey)));
    const isBlocked = totalHits > limit;
    let timeToBlockExpire = 0;

    if (isBlocked) {
      await (redis as any).set(blockKey, '1', { px: blockDuration });
      timeToBlockExpire = blockDuration;
    }

    return { totalHits, timeToExpire: ttlMs, isBlocked, timeToBlockExpire };
  }
}
