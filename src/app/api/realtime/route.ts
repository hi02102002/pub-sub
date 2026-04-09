import { handle } from "@/lib/realtime-handler";
import { realtime } from "@/lib/realtime";

export const runtime = "nodejs";
export const GET = handle({ realtime });
