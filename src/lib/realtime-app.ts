"use client";

import { createRealtime } from "@/lib/realtime-client";
import type { RealtimeEvents } from "@/lib/realtime";

export const { useRealtime } = createRealtime<RealtimeEvents>();
