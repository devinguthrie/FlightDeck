import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlightDeck",
  description: "Track VS Code Copilot premium request consumption and session quality",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
