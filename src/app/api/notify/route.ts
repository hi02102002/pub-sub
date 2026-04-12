import { NextResponse } from "next/server";

import { MAX_MESSAGE_LENGTH, MAX_USERNAME_LENGTH } from "@/lib/chat";
import { realtime } from "@/lib/realtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      channel?: string;
      user?: string;
      text?: string;
      data?: { text?: string };
    };

    const channel = (body.channel || "general").trim().toLowerCase() || "general";
    const user = (body.user || "guest").trim().slice(0, MAX_USERNAME_LENGTH);
    const text = (body.data?.text || body.text || "").trim().slice(0, MAX_MESSAGE_LENGTH);

    if (!text) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }

    const message = await realtime.channel(channel).emit("chat.message", {
      user,
      text,
    });

    return NextResponse.json({ ok: true, data: message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to emit event.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
