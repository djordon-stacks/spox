"use client";

import Link from "next/link";
import { ClaimsShell } from "@/components/claims/claims-shell";
import { DeveloperPanel } from "@/components/claims/developer-panel";
import { RegisterForm } from "@/components/claims/register-form";

export default function ClaimsPage() {
  return (
    <ClaimsShell
      active="register"
      lede={
        <>
          Register your stake. When rewards are ready, spox calls the contracts
          so you don&apos;t have to.{" "}
          <Link href="/about/" className="claims-lede-link">
            Why this exists
          </Link>
          .
        </>
      }
    >
      <RegisterForm />
      <DeveloperPanel />
    </ClaimsShell>
  );
}
