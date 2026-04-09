"use client";

import { createRealtime } from "@/lib/realtime-client";
import type { AppRealtimeEvents } from "@/lib/realtime";

export const { useRealtime } = createRealtime<AppRealtimeEvents>();
