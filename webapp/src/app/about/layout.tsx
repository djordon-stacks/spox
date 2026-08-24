import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "spox · About",
  description:
    "If you stake STX under pox-5, rewards no longer arrive on their own — spox submits the claim transactions for you.",
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
