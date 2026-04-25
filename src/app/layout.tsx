import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlightDeck",
  description: "Track VS Code Copilot premium request consumption and session quality",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent flash of unstyled content on dark mode preference */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('flightdeck-theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning className="bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
