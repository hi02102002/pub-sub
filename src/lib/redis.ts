import Redis from "ioredis";

let publisher: Redis | null = null;

function requireRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("Missing REDIS_URL. Set it in your environment.");
  }
  return redisUrl;
}

export function getPublisher(): Redis {
  if (publisher) return publisher;
  publisher = new Redis(requireRedisUrl());
  return publisher;
}

export function createSubscriber(): Redis {
  return new Redis(requireRedisUrl());
}
