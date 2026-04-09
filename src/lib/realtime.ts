import { randomUUID } from "node:crypto";

import { getPublisher } from "@/lib/redis";

export type EventMap = Record<string, unknown>;

export type RealtimeEnvelope<TEvents extends EventMap, TEvent extends keyof TEvents = keyof TEvents> = {
  id: string;
  channel: string;
  event: TEvent;
  data: TEvents[TEvent];
  createdAt: string;
};

type EmitOptions = {
  channel?: string;
};

export class Realtime<TEvents extends EventMap> {
  private readonly redisChannelPrefix = "rt:channel:";
  private readonly redisHistoryPrefix = "rt:history:";
  private readonly historySize = 100;

  private toChannelKey(channel: string): string {
    return `${this.redisChannelPrefix}${channel}`;
  }

  private toHistoryKey(channel: string): string {
    return `${this.redisHistoryPrefix}${channel}`;
  }

  async emit<TEvent extends keyof TEvents & string>(
    event: TEvent,
    data: TEvents[TEvent],
    options?: EmitOptions,
  ): Promise<RealtimeEnvelope<TEvents, TEvent>> {
    const channel = (options?.channel || "general").trim().toLowerCase();
    const envelope: RealtimeEnvelope<TEvents, TEvent> = {
      id: randomUUID(),
      channel,
      event,
      data,
      createdAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(envelope);
    const redis = getPublisher();

    await redis
      .multi()
      .lpush(this.toHistoryKey(channel), serialized)
      .ltrim(this.toHistoryKey(channel), 0, this.historySize - 1)
      .publish(this.toChannelKey(channel), serialized)
      .exec();

    return envelope;
  }

  async history(channel = "general", limit = 50): Promise<Array<RealtimeEnvelope<TEvents>>> {
    const redis = getPublisher();
    const raw = await redis.lrange(this.toHistoryKey(channel.trim().toLowerCase()), 0, limit - 1);

    return raw
      .map((item) => {
        try {
          return JSON.parse(item) as RealtimeEnvelope<TEvents>;
        } catch {
          return null;
        }
      })
      .filter((item): item is RealtimeEnvelope<TEvents> => Boolean(item))
      .reverse();
  }

  channelKey(channel: string): string {
    return this.toChannelKey(channel.trim().toLowerCase());
  }
}

export type AppRealtimeEvents = {
  "chat.message": {
    user: string;
    text: string;
  };
};

export const realtime = new Realtime<AppRealtimeEvents>();
