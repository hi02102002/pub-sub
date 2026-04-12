"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  EventData,
  EventName,
  HistoryOptions,
  RealtimeSchemaNode,
} from "@/lib/realtime";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type RealtimeConfig = {
  api: {
    url: string;
    withCredentials: boolean;
  };
  maxReconnectAttempts: number;
};

type RealtimeProviderProps = {
  children: ReactNode;
  api?: Partial<RealtimeConfig["api"]>;
  maxReconnectAttempts?: number;
};

type OnDataPayload<
  TSchema extends RealtimeSchemaNode,
  TEvent extends EventName<TSchema>,
> = {
  id?: string;
  event: TEvent;
  data: EventData<TSchema, TEvent>;
  channel: string;
  createdAt?: string;
};

type UseRealtimeInput<
  TSchema extends RealtimeSchemaNode,
  TEvent extends EventName<TSchema>,
> = {
  enabled?: boolean;
  channels?: string[];
  events: TEvent[];
  history?: boolean | HistoryOptions;
  onData: (payload: OnDataPayload<TSchema, TEvent>) => void;
  onError?: (error: Event) => void;
};

const defaultConfig: RealtimeConfig = {
  api: {
    url: "/api/realtime",
    withCredentials: false,
  },
  maxReconnectAttempts: 3,
};

const RealtimeContext = createContext<RealtimeConfig>(defaultConfig);

function normalizeChannel(channel?: string): string {
  return (channel || "default").trim().toLowerCase() || "default";
}

function appendHistory(search: URLSearchParams, history?: boolean | HistoryOptions) {
  if (!history) return;

  search.set("history", "1");

  if (history === true) return;

  if (typeof history.limit === "number") {
    search.set("history_limit", String(history.limit));
  }

  if (typeof history.start === "number") {
    search.set("history_start", String(history.start));
  }

  if (typeof history.end === "number") {
    search.set("history_end", String(history.end));
  }
}

export function RealtimeProvider({
  children,
  api,
  maxReconnectAttempts,
}: RealtimeProviderProps) {
  return (
    <RealtimeContext.Provider
      value={{
        api: {
          url: api?.url || defaultConfig.api.url,
          withCredentials: api?.withCredentials ?? defaultConfig.api.withCredentials,
        },
        maxReconnectAttempts:
          maxReconnectAttempts ?? defaultConfig.maxReconnectAttempts,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function createRealtime<TSchema extends RealtimeSchemaNode>() {
  function useRealtime<TEvent extends EventName<TSchema>>(
    input: UseRealtimeInput<TSchema, TEvent>,
  ) {
    const { api, maxReconnectAttempts } = useContext(RealtimeContext);
    const [status, setStatus] = useState<ConnectionStatus>(
      input.enabled === false ? "disconnected" : "connecting",
    );
    const onDataRef = useRef(input.onData);
    const onErrorRef = useRef(input.onError);
    const historyReplayRef = useRef(new Set<string>());

    useEffect(() => {
      onDataRef.current = input.onData;
    }, [input.onData]);

    useEffect(() => {
      onErrorRef.current = input.onError;
    }, [input.onError]);

    const enabled = input.enabled ?? true;
    const channels = (input.channels ?? ["default"]).map(normalizeChannel);
    const channelsKey = channels.join(",");
    const eventsKey = input.events.join(",");
    const historyKey =
      typeof input.history === "object"
        ? JSON.stringify(input.history)
        : String(Boolean(input.history));

    useEffect(() => {
      if (!enabled) {
        return;
      }

      const eventNames = eventsKey ? (eventsKey.split(",") as TEvent[]) : [];
      const search = new URLSearchParams();
      const replayKey = `${channelsKey}:${eventsKey}:${historyKey}`;
      const history =
        input.history && !historyReplayRef.current.has(replayKey)
          ? input.history
          : undefined;

      if (history) {
        historyReplayRef.current.add(replayKey);
      }

      search.set("channels", channelsKey);
      search.set("events", eventsKey);
      appendHistory(search, history);

      let attempts = 0;
      let active = true;

      const eventSource = new EventSource(`${api.url}?${search.toString()}`, {
        withCredentials: api.withCredentials,
      });

      const onOpen = () => {
        attempts = 0;
        if (active) {
          setStatus("connected");
        }
      };

      const onMessage = (event: Event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as OnDataPayload<
            TSchema,
            TEvent
          >;
          onDataRef.current(payload);
        } catch {
          setStatus("error");
        }
      };

      const onError = (event: Event) => {
        onErrorRef.current?.(event);

        if (!active) {
          return;
        }

        attempts += 1;
        if (attempts >= maxReconnectAttempts) {
          setStatus("error");
          eventSource.close();
          return;
        }

        setStatus("connecting");
      };

      eventSource.addEventListener("open", onOpen);
      eventSource.addEventListener("ready", onOpen);
      eventSource.addEventListener("error", onError);

      for (const eventName of eventNames) {
        eventSource.addEventListener(eventName, onMessage);
      }

      return () => {
        active = false;
        eventSource.removeEventListener("open", onOpen);
        eventSource.removeEventListener("ready", onOpen);
        eventSource.removeEventListener("error", onError);
        for (const eventName of eventNames) {
          eventSource.removeEventListener(eventName, onMessage);
        }
        eventSource.close();
      };
    }, [
      api.url,
      api.withCredentials,
      channelsKey,
      enabled,
      eventsKey,
      historyKey,
      input.history,
      maxReconnectAttempts,
    ]);

    return { status: enabled ? status : "disconnected" };
  }

  return { useRealtime };
}
