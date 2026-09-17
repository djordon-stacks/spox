"use client";

import Link from "next/link";

export type ClaimsNavPage = "register" | "activity" | "about";

const PAGES: { id: ClaimsNavPage; href: string; label: string }[] = [
  { id: "register", href: "/", label: "Register" },
  { id: "activity", href: "/activity/", label: "Activity" },
  { id: "about", href: "/about/", label: "About" },
];

export function ClaimsPageMenu({ active }: { active: ClaimsNavPage }) {
  return (
    <details className="claims-menu">
      <summary className="claims-menu-summary">
        Menu
        <span className="claims-menu-chevron" aria-hidden="true" />
      </summary>
      <div className="claims-menu-panel">
        {PAGES.map((page) => (
          <Link
            key={page.id}
            href={page.href}
            className={
              page.id === active
                ? "claims-menu-item claims-menu-item-current"
                : "claims-menu-item"
            }
            aria-current={page.id === active ? "page" : undefined}
          >
            {page.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
