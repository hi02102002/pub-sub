"use client";

import { FormEvent, useMemo, useState } from "react";

import { useRealtime } from "@/lib/realtime-app";
import type { RealtimeEnvelope, RealtimeEvents } from "@/lib/realtime";
import { DEFAULT_CHAT_ROOM } from "@/lib/chat";

function toTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatClient() {
  const [room, setRoom] = useState(DEFAULT_CHAT_ROOM);
  const [user, setUser] = useState("guest");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Array<RealtimeEnvelope<RealtimeEvents, "chat.message">>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  const roomParam = useMemo(() => room.trim().toLowerCase() || DEFAULT_CHAT_ROOM, [room]);

  const { status } = useRealtime({
    channels: [roomParam],
    events: ["chat.message"],
    history: { limit: 50 },
    onData({ id, data, event, channel, createdAt }) {
      setError(null);
      setMessages((current) =>
        [
          ...current,
          {
            id: id || `${event}-${Date.now()}`,
            channel,
            event,
            data,
            createdAt: createdAt || new Date().toISOString(),
          },
        ].slice(-50),
      );
    },
    onError() {
      setError("Realtime connection issue.");
    },
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedText = text.trim();
    const trimmedUser = user.trim();

    if (!trimmedText) return;

    const response = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: roomParam,
        user: trimmedUser || "guest",
        data: {
          text: trimmedText,
        },
      }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error || "Failed to send message.");
      return;
    }

    setText("");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Redis Pub/Sub Realtime Chat</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Status: {status} {error ? `- ${error}` : ""}
        </p>
      </header>

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Room
          <input
            value={room}
            onChange={(event) => {
              setRoom(event.target.value);
              setMessages([]);
              setError(null);
            }}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-400"
            placeholder="general"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Username
          <input
            value={user}
            onChange={(event) => setUser(event.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-400"
            placeholder="guest"
          />
        </label>
      </section>

      <section className="mb-4 flex-1 overflow-y-auto rounded-md border border-zinc-300 p-3">
        <ul className="space-y-2">
          {messages.map((message) => (
            <li key={message.id} className="rounded bg-zinc-100 p-2 dark:bg-zinc-900">
              <div className="text-xs text-zinc-600 dark:text-zinc-300">
                {message.channel} - {toTime(message.createdAt)}
              </div>
              <div className="font-medium">{message.data.user}</div>
              <p>{message.data.text}</p>
            </li>
          ))}
          {messages.length === 0 ? (
            <li className="text-sm text-zinc-500">No messages yet. Start chatting.</li>
          ) : null}
        </ul>
      </section>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-400"
          placeholder="Write a message..."
        />
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black"
          disabled={!text.trim()}
        >
          Send
        </button>
      </form>
    </main>
  );
}
