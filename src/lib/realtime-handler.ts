import type { EventName, HistoryOptions, Realtime, RealtimeSchemaNode } from "@/lib/realtime";

function encodeSse(payload: string, event?: string): Uint8Array {
  const encoder = new TextEncoder();
  const eventLine = event ? `event: ${event}\n` : "";
  return encoder.encode(`${eventLine}data: ${payload}\n\n`);
}

type MiddlewareContext = {
  request: Request;
  channels: string[];
  events: string[];
};

type HandleInput<TSchema extends RealtimeSchemaNode> = {
  realtime: Realtime<TSchema>;
  middleware?: (context: MiddlewareContext) => Response | undefined | Promise<Response | undefined>;
};

function parseList(value: string | null, fallback: string): string[] {
  const items = (value || fallback)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (items.length > 0) {
    return Array.from(new Set(items));
  }

  return fallback ? [fallback] : [];
}

function parseHistoryOptions(search: URLSearchParams): boolean | HistoryOptions {
  const enabled = search.get("history");
  if (!enabled || enabled === "false" || enabled === "0") {
    return false;
  }

  const limit = Number(search.get("history_limit"));
  const start = Number(search.get("history_start"));
  const end = Number(search.get("history_end"));
  const options: HistoryOptions = {};

  if (!Number.isNaN(limit) && limit > 0) options.limit = limit;
  if (!Number.isNaN(start) && start > 0) options.start = start;
  if (!Number.isNaN(end) && end > 0) options.end = end;

  return Object.keys(options).length > 0 ? options : true;
}

export function handle<TSchema extends RealtimeSchemaNode>({
  realtime,
  middleware,
}: HandleInput<TSchema>) {
  return async function GET(request: Request) {
    const search = new URL(request.url).searchParams;
    const channels = parseList(search.get("channels") || search.get("channel"), "default");
    const events = parseList(search.get("events"), "");
    const history = parseHistoryOptions(search);

    if (middleware) {
      const response = await middleware({ request, channels, events });
      if (response) {
        return response;
      }
    }

    const cleanups = new Set<() => void>();
    const close = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.clear();
      if (controller) {
        try {
          controller.close();
        } catch {}
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        request.signal.addEventListener("abort", () => close(controller), { once: true });

        try {
          if (history) {
            const historyOptions = history === true ? undefined : history;

            for (const channel of channels) {
              const messages = await realtime.channel(channel).history(historyOptions);
              for (const message of messages) {
                if (events.length > 0 && !events.includes(message.event)) {
                  continue;
                }
                controller.enqueue(encodeSse(JSON.stringify(message), message.event));
              }
            }
          }

          for (const channel of channels) {
            const unsubscribe = await realtime.channel(channel).subscribe({
              events: events.length > 0 ? (events as Array<EventName<TSchema>>) : undefined,
              onData(message) {
                controller.enqueue(encodeSse(JSON.stringify(message), message.event));
              },
              onError(error) {
                controller.enqueue(
                  encodeSse(
                    JSON.stringify({ error: error.message, channel }),
                    "error",
                  ),
                );
              },
            });

            cleanups.add(unsubscribe);
          }

          controller.enqueue(encodeSse(JSON.stringify({ channels, events }), "ready"));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to open realtime stream.";
          controller.enqueue(encodeSse(JSON.stringify({ error: message }), "error"));
          close(controller);
        }
      },
      cancel() {
        close();
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
