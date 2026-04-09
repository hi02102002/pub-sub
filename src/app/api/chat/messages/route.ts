import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  MESSAGE_HISTORY_LIMIT,
  type ChatMessage,
  normalizeRoom,
  parsePayload,
  toHistoryKey,
  toRedisChannel,
} from "@/lib/chat";
import { getPublisher } from "@/lib/redis";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const room = normalizeRoom(new URL(request.url).searchParams.get("room"));
    const historyKey = toHistoryKey(room);
    const redis = getPublisher();

    const rawMessages = await redis.lrange(historyKey, 0, MESSAGE_HISTORY_LIMIT - 1);
    const messages = rawMessages
      .map((item) => {
        try {
          return JSON.parse(item) as ChatMessage;
        } catch {
          return null;
        }
      })
      .filter((value): value is ChatMessage => Boolean(value))
      .reverse();

    return NextResponse.json({ room, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = parsePayload(body);
    const redis = getPublisher();

    const message: ChatMessage = {
      id: randomUUID(),
      room: payload.room,
      user: payload.user,
      text: payload.text,
      createdAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(message);
    const historyKey = toHistoryKey(payload.room);
    const channel = toRedisChannel(payload.room);

    await redis.multi().lpush(historyKey, serialized).ltrim(historyKey, 0, MESSAGE_HISTORY_LIMIT - 1).publish(channel, serialized).exec();

    return NextResponse.json({ ok: true, message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to publish message.";
    const status = message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
