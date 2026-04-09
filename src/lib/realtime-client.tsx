"use client";

import { createContext, ReactNode, useContext, useEffect } from "react";

type RealtimeConfig = {
  endpoint: string;
};

type OnDataPayload<TEvent extends string, TData> = {
  event: TEvent;
  data: TData;
  channel: string;
  createdAt?: string;
};

const RealtimeContext = createContext<RealtimeConfig>({
  endpoint: "/api/realtime",
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  return (
    <RealtimeContext.Provider value={{ endpoint: "/api/realtime" }}>
      {children}
    </RealtimeContext.Provider>
  );
}

type BaseEventMap = Record<string, unknown>;

export function createRealtime<TEvents extends BaseEventMap>() {
  function useRealtime<TEvent extends keyof TEvents & string>(input: {
    channel?: string;
    events: TEvent[];
    onData: (payload: OnDataPayload<TEvent, TEvents[TEvent]>) => void;
    onError?: (error: Event) => void;
  }) {
    const { endpoint } = useContext(RealtimeContext);
    const channel = (input.channel || "general").trim().toLowerCase();
    const eventsParam = input.events.join(",");
    const { onData, onError } = input;

    useEffect(() => {
      const url = `${endpoint}?channel=${encodeURIComponent(channel)}&events=${encodeURIComponent(eventsParam)}`;
      const source = new EventSource(url);

      for (const eventName of input.events) {
        source.addEventListener(eventName, (event) => {
          const payload = JSON.parse((event as MessageEvent).data) as {
            event: TEvent;
            data: TEvents[TEvent];
            channel: string;
            createdAt?: string;
          };

          onData({
            event: payload.event,
            data: payload.data,
            channel: payload.channel,
            createdAt: payload.createdAt,
          });
        });
      }

      source.addEventListener("error", (event) => {
        onError?.(event);
      });

      return () => source.close();
    }, [channel, endpoint, eventsParam, input.events, onData, onError]);
  }

  return { useRealtime };
}
