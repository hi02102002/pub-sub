import { createSubscriber } from "@/lib/redis";
import type { EventMap, Realtime } from "@/lib/realtime";

function encodeSse(payload: string, event?: string): Uint8Array {
  const encoder = new TextEncoder();
  const eventLine = event ? `event: ${event}\n` : "";
  return encoder.encode(`${eventLine}data: ${payload}\n\n`);
}

type HandleInput<TEvents extends EventMap> = {
  realtime: Realtime<TEvents>;
};

export function handle<TEvents extends EventMap>({ realtime }: HandleInput<TEvents>) {
  return async function GET(request: Request) {
    const search = new URL(request.url).searchParams;
    const channel = (search.get("channel") || "general").trim().toLowerCase();
    const events = (search.get("events") || "")
      .split(",")
      .map((event) => event.trim())
      .filter(Boolean);

    const subscriber = createSubscriber();
    const redisChannel = realtime.channelKey(channel);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const onMessage = (incomingChannel: string, message: string) => {
          if (incomingChannel !== redisChannel) return;

          try {
            const payload = JSON.parse(message) as { event?: string };
            if (events.length > 0 && payload.event && !events.includes(payload.event)) {
              return;
            }
            controller.enqueue(encodeSse(message, payload.event || "message"));
          } catch {
            controller.enqueue(encodeSse(message, "message"));
          }
        };

        const onError = (error: Error) => {
          controller.enqueue(encodeSse(JSON.stringify({ error: error.message }), "error"));
        };

        subscriber.on("message", onMessage);
        subscriber.on("error", onError);
        await subscriber.subscribe(redisChannel);
        controller.enqueue(encodeSse(JSON.stringify({ channel, events }), "ready"));

        request.signal.addEventListener("abort", async () => {
          subscriber.off("message", onMessage);
          subscriber.off("error", onError);
          await subscriber.unsubscribe(redisChannel);
          await subscriber.quit();
          controller.close();
        });
      },
      async cancel() {
        await subscriber.unsubscribe(redisChannel);
        await subscriber.quit();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  };
}
