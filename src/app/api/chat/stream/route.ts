import { normalizeRoom, toRedisChannel } from "@/lib/chat";
import { createSubscriber } from "@/lib/redis";

export const runtime = "nodejs";

function encodeSse(payload: string, event?: string): Uint8Array {
  const encoder = new TextEncoder();
  const eventLine = event ? `event: ${event}\n` : "";
  return encoder.encode(`${eventLine}data: ${payload}\n\n`);
}

export async function GET(request: Request) {
  const room = normalizeRoom(new URL(request.url).searchParams.get("room"));
  const channel = toRedisChannel(room);
  const subscriber = createSubscriber();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const onMessage = (incomingChannel: string, message: string) => {
        if (incomingChannel !== channel) return;
        controller.enqueue(encodeSse(message, "message"));
      };

      const onError = (err: Error) => {
        controller.enqueue(
          encodeSse(JSON.stringify({ error: err.message }), "error"),
        );
      };

      subscriber.on("message", onMessage);
      subscriber.on("error", onError);

      await subscriber.subscribe(channel);
      controller.enqueue(encodeSse(JSON.stringify({ room }), "ready"));

      request.signal.addEventListener("abort", async () => {
        subscriber.off("message", onMessage);
        subscriber.off("error", onError);
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
        controller.close();
      });
    },
    async cancel() {
      await subscriber.unsubscribe(channel);
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
}
