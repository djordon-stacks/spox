"use client";

import { ActivityPanel } from "@/components/claims/activity-panel";
import { ClaimsShell } from "@/components/claims/claims-shell";
import { DeveloperPanel } from "@/components/claims/developer-panel";

export default function ActivityPage() {
  return (
    <ClaimsShell
      active="activity"
      lede={
        <>
          Recent registry events from the Stacks API. Filter by a principal to
          find registrations and claim attempts that mention them.
        </>
      }
    >
      <ActivityPanel />
      <DeveloperPanel />
    </ClaimsShell>
  );
}
