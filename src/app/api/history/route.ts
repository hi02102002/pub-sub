import { NextResponse } from "next/server";

import { realtime } from "@/lib/realtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const channel = (
      new URL(request.url).searchParams.get("channel") || "general"
    )
      .trim()
      .toLowerCase();

    const messages = await realtime.channel(channel).history({ limit: 50 });
    return NextResponse.json({ channel, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
