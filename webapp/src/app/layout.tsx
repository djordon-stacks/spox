import type { Metadata } from "next";
import localFont from "next/font/local";
import { Fraunces, Figtree } from "next/font/google";
import { ClaimsConfigProvider } from "@/components/claims/claims-config-provider";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-VariableFont_wght.ttf",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-claims-display",
  display: "swap",
});

const sans = Figtree({
  subsets: ["latin"],
  variable: "--font-claims-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "spox · Register for reward claims",
  description:
    "Register your Stacks staking position with the reward-claim registry.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} ${display.variable} ${sans.variable}`}
    >
      <body>
        <WalletProvider>
          <ClaimsConfigProvider>
            <div className="claims-theme">{children}</div>
          </ClaimsConfigProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
