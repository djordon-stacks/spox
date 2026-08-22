"use client";

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
          <a
            href="https://docs.stacks.co/pox-5/development/rewards"
            target="_blank"
            rel="noopener noreferrer"
            className="claims-lede-link"
          >
            How pox-5 rewards work
          </a>
          .
        </>
      }
    >
      <RegisterForm />
      <DeveloperPanel />
    </ClaimsShell>
  );
}
