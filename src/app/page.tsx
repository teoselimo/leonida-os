"use client";

import { AppShell } from "@/components/AppShell";
import { StoreProvider } from "@/lib/store";
import { LiveRadarProvider } from "@/lib/live";

export default function Page() {
  return (
    <LiveRadarProvider>
      <StoreProvider>
        <AppShell />
      </StoreProvider>
    </LiveRadarProvider>
  );
}
