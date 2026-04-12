import { randomUUID } from "node:crypto";

import z from "zod/v4";

import { createSubscriber, getPublisher } from "@/lib/redis";

type RealtimeSchemaLeaf = z.ZodTypeAny;
export type RealtimeSchemaNode = {
  [key: string]: RealtimeSchemaLeaf | RealtimeSchemaNode;
};

type JoinPath<TLeft extends string, TRight extends string> = `${TLeft}.${TRight}`;

type SchemaKeys<TSchema extends RealtimeSchemaNode> = keyof TSchema & string;

type EventNameForKey<
  TSchema extends RealtimeSchemaNode,
  TKey extends SchemaKeys<TSchema>,
> = TSchema[TKey] extends RealtimeSchemaLeaf
  ? TKey
  : TSchema[TKey] extends RealtimeSchemaNode
    ? JoinPath<TKey, EventName<TSchema[TKey]>>
    : never;

// Walk every schema key and flatten nested nodes into dot-separated event names.
export type EventName<TSchema extends RealtimeSchemaNode> = {
  [TKey in SchemaKeys<TSchema>]: EventNameForKey<TSchema, TKey>;
}[SchemaKeys<TSchema>];

type PathHead<TPath extends string> = TPath extends `${infer THead}.${string}`
  ? THead
  : TPath;

type PathTail<TPath extends string> = TPath extends `${string}.${infer TTail}`
  ? TTail
  : never;

// Resolve the schema node/leaf at a dot-separated path such as "chat.message".
type EventSchemaAtPath<TSchema, TPath extends string> = PathTail<TPath> extends never
  ? TPath extends keyof TSchema
    ? TSchema[TPath]
    : never
  : PathHead<TPath> extends keyof TSchema
    ? EventSchemaAtPath<TSchema[PathHead<TPath>], PathTail<TPath>>
    : never;

export type EventData<
  TSchema extends RealtimeSchemaNode,
  TEvent extends EventName<TSchema>,
> = EventSchemaAtPath<TSchema, TEvent> extends RealtimeSchemaLeaf
  ? z.infer<EventSchemaAtPath<TSchema, TEvent>>
  : never;

export type HistoryMessage<
  TSchema extends RealtimeSchemaNode,
  TEvent extends EventName<TSchema> = EventName<TSchema>,
> = {
  id: string;
  event: TEvent;
  channel: string;
  data: EventData<TSchema, TEvent>;
  createdAt: string;
};

export type RealtimeEnvelope<
  TSchema extends RealtimeSchemaNode,
  TEvent extends EventName<TSchema> = EventName<TSchema>,
> = HistoryMessage<TSchema, TEvent>;

export type InferRealtimeEvents<TRealtime> = TRealtime extends Realtime<infer TSchema>
  ? TSchema
  : never;

type EmitOptions = {
  channel?: string;
};

export type HistoryOptions = {
  limit?: number;
  start?: number;
  end?: number;
};

type RealtimeOptions<TSchema extends RealtimeSchemaNode> = {
  schema: TSchema;
  redis?: unknown;
  history?: {
    maxLength?: number;
    expireAfterSecs?: number;
  };
};

type SubscribeOptions<
  TSchema extends RealtimeSchemaNode,
  TEvent extends EventName<TSchema> = EventName<TSchema>,
> = {
  events?: TEvent[];
  history?: boolean | HistoryOptions;
  onData: (message: HistoryMessage<TSchema, TEvent>) => void;
  onError?: (error: Error) => void;
};

function normalizeChannel(channel?: string): string {
  return (channel || "default").trim().toLowerCase() || "default";
}

function isRealtimeSchemaLeaf(value: unknown): value is RealtimeSchemaLeaf {
  return value !== null && typeof value === "object" && "safeParse" in value;
}

function getEventSchema<TSchema extends RealtimeSchemaNode>(
  schema: TSchema,
  event: string,
): RealtimeSchemaLeaf {
  let current: RealtimeSchemaLeaf | RealtimeSchemaNode | undefined = schema;

  for (const segment of event.split(".")) {
    if (!current || typeof current !== "object" || isRealtimeSchemaLeaf(current)) {
      throw new Error(`Unknown realtime event "${event}".`);
    }

    current = current[segment];
  }

  if (!isRealtimeSchemaLeaf(current)) {
    throw new Error(`Unknown realtime event "${event}".`);
  }

  return current;
}

export class RealtimeChannel<TSchema extends RealtimeSchemaNode> {
  private readonly teardowns = new Set<() => Promise<void>>();

  constructor(
    private readonly realtime: Realtime<TSchema>,
    private readonly name: string,
  ) {}

  emit<TEvent extends EventName<TSchema>>(
    event: TEvent,
    data: EventData<TSchema, TEvent>,
  ): Promise<HistoryMessage<TSchema, TEvent>> {
    return this.realtime.emit(event, data, { channel: this.name });
  }

  history<TEvent extends EventName<TSchema> = EventName<TSchema>>(
    options?: HistoryOptions,
  ): Promise<Array<HistoryMessage<TSchema, TEvent>>> {
    return this.realtime.history<TEvent>(this.name, options);
  }

  async subscribe<TEvent extends EventName<TSchema>>(
    input: SubscribeOptions<TSchema, TEvent>,
  ): Promise<() => void> {
    const subscriber = createSubscriber();
    const redisChannel = this.realtime.channelKey(this.name);
    const eventSet = input.events ? new Set<string>(input.events) : null;

    const teardown = async () => {
      this.teardowns.delete(teardown);
      subscriber.off("message", onMessage);
      subscriber.off("error", onError);
      try {
        await subscriber.unsubscribe(redisChannel);
      } finally {
        await subscriber.quit();
      }
    };

    const onMessage = (incomingChannel: string, message: string) => {
      if (incomingChannel !== redisChannel) return;

      try {
        const payload = JSON.parse(message) as HistoryMessage<TSchema, TEvent>;
        if (eventSet && !eventSet.has(payload.event)) {
          return;
        }
        input.onData(payload);
      } catch (error) {
        const resolved = error instanceof Error ? error : new Error("Invalid realtime payload.");
        input.onError?.(resolved);
      }
    };

    const onError = (error: Error) => {
      input.onError?.(error);
    };

    if (input.history) {
      const historyOptions = input.history === true ? undefined : input.history;
      const history = await this.history<TEvent>(historyOptions);
      for (const message of history) {
        if (eventSet && !eventSet.has(message.event)) {
          continue;
        }
        input.onData(message);
      }
    }

    subscriber.on("message", onMessage);
    subscriber.on("error", onError);
    await subscriber.subscribe(redisChannel);

    this.teardowns.add(teardown);

    return () => {
      void teardown();
    };
  }

  async unsubscribe() {
    await Promise.all(Array.from(this.teardowns, (teardown) => teardown()));
  }
}

export class Realtime<TSchema extends RealtimeSchemaNode> {
  private readonly schema: TSchema;
  private readonly historyMaxLength?: number;
  private readonly historyExpireAfterSecs?: number;
  private readonly redisChannelPrefix = "rt:channel:";
  private readonly redisHistoryPrefix = "rt:history:";

  constructor(options: RealtimeOptions<TSchema>) {
    this.schema = options.schema;
    this.historyMaxLength = options.history?.maxLength;
    this.historyExpireAfterSecs = options.history?.expireAfterSecs;
  }

  channel(channel: string) {
    return new RealtimeChannel(this, normalizeChannel(channel));
  }

  channelKey(channel: string): string {
    return `${this.redisChannelPrefix}${normalizeChannel(channel)}`;
  }

  private historyKey(channel: string): string {
    return `${this.redisHistoryPrefix}${normalizeChannel(channel)}`;
  }

  async emit<TEvent extends EventName<TSchema>>(
    event: TEvent,
    data: EventData<TSchema, TEvent>,
    options?: EmitOptions,
  ): Promise<HistoryMessage<TSchema, TEvent>> {
    const schema = getEventSchema(this.schema, event);
    const channel = normalizeChannel(options?.channel);
    const parsed = schema.parse(data) as EventData<TSchema, TEvent>;
    const envelope: HistoryMessage<TSchema, TEvent> = {
      id: randomUUID(),
      event,
      channel,
      data: parsed,
      createdAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(envelope);
    const publisher = getPublisher();
    const pipeline = publisher
      .multi()
      .lpush(this.historyKey(channel), serialized)
      .publish(this.channelKey(channel), serialized);

    if (typeof this.historyMaxLength === "number") {
      pipeline.ltrim(this.historyKey(channel), 0, Math.max(this.historyMaxLength - 1, 0));
    }

    if (typeof this.historyExpireAfterSecs === "number") {
      pipeline.expire(this.historyKey(channel), this.historyExpireAfterSecs);
    }

    await pipeline.exec();

    return envelope;
  }

  async history<TEvent extends EventName<TSchema> = EventName<TSchema>>(
    channel = "default",
    options?: HistoryOptions,
  ): Promise<Array<HistoryMessage<TSchema, TEvent>>> {
    const limit = Math.min(Math.max(options?.limit ?? 1000, 1), 1000);
    const start = options?.start;
    const end = options?.end;
    const publisher = getPublisher();
    const rawMessages = await publisher.lrange(this.historyKey(channel), 0, limit - 1);

    return rawMessages
      .map((item) => {
        try {
          return JSON.parse(item) as HistoryMessage<TSchema, TEvent>;
        } catch {
          return null;
        }
      })
      .filter((item): item is HistoryMessage<TSchema, TEvent> => {
        if (!item) return false;

        const createdAt = Date.parse(item.createdAt);
        if (Number.isNaN(createdAt)) return false;
        if (typeof start === "number" && createdAt < start) return false;
        if (typeof end === "number" && createdAt > end) return false;

        return true;
      })
      .reverse();
  }
}

const schema = {
  chat: {
    message: z.object({
      user: z.string(),
      text: z.string(),
    }),
  },
} satisfies RealtimeSchemaNode;

export const realtime = new Realtime({
  schema,
  history: {
    maxLength: 100,
  },
});

export type RealtimeEvents = InferRealtimeEvents<typeof realtime>;
export type AppRealtimeEvents = RealtimeEvents;
