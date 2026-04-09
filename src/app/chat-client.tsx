"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { DEFAULT_CHAT_ROOM, type ChatMessage } from "@/lib/chat";

type HistoryResponse = {
  room: string;
  messages: ChatMessage[];
  error?: string;
};

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState<string | null>(null);

  const roomParam = useMemo(() => room.trim().toLowerCase() || DEFAULT_CHAT_ROOM, [room]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let closed = false;

    async function loadHistory() {
      const response = await fetch(`/api/chat/messages?room=${encodeURIComponent(roomParam)}`);
      const data = (await response.json()) as HistoryResponse;

      if (!response.ok || data.error) {
        throw new Error(data.error || "Unable to load message history.");
      }

      setMessages(data.messages);
    }

    async function connect() {
      try {
        setError(null);
        setStatus("loading-history");
        await loadHistory();

        if (closed) return;

        setStatus("connecting");
        eventSource = new EventSource(`/api/chat/stream?room=${encodeURIComponent(roomParam)}`);

        eventSource.addEventListener("ready", () => {
          setStatus("connected");
        });

        eventSource.addEventListener("message", (event) => {
          const payload = JSON.parse(event.data) as ChatMessage;
          setMessages((current) => [...current, payload].slice(-50));
        });

        eventSource.addEventListener("error", () => {
          setStatus("reconnecting");
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Connection failed.";
        setError(message);
        setStatus("error");
      }
    }

    connect();

    return () => {
      closed = true;
      eventSource?.close();
    };
  }, [roomParam]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedText = text.trim();
    const trimmedUser = user.trim();

    if (!trimmedText) return;

    const response = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: roomParam,
        user: trimmedUser || "guest",
        text: trimmedText,
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
            onChange={(event) => setRoom(event.target.value)}
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
                {message.room} - {toTime(message.createdAt)}
              </div>
              <div className="font-medium">{message.user}</div>
              <p>{message.text}</p>
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
