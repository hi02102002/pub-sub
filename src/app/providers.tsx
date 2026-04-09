"use client";

import { RealtimeProvider } from "@/lib/realtime-client";

export function Providers({ children }: { children: React.ReactNode }) {
  return <RealtimeProvider>{children}</RealtimeProvider>;
}
