import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";

import { SiteHeader } from "@/components/site/site-header";

import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const themeInitScript = `
(function () {
  try {
    var storageKey = "rearview-theme";
    var stored = localStorage.getItem(storageKey);
    var choice = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var resolved = choice === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : choice;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;

    var cachedHeaderH = Number(localStorage.getItem("rearview-header-h"));
    if (Number.isFinite(cachedHeaderH) && cachedHeaderH >= 32 && cachedHeaderH <= 240) {
      document.documentElement.style.setProperty("--header-h", cachedHeaderH + "px");
    }

    var cachedFilterH = Number(localStorage.getItem("rearview-filter-h"));
    if (Number.isFinite(cachedFilterH) && cachedFilterH >= 40 && cachedFilterH <= 320) {
      document.documentElement.style.setProperty("--filter-bar-h", cachedFilterH + "px");
    }
  } catch (error) {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

export const metadata: Metadata = {
  title: {
    default: "Rearview Mirror",
    template: "%s | Rearview Mirror",
  },
  description:
    "A curated timeline of AI model milestones since the ChatGPT 3.5 launch.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${sans.variable} ${mono.variable}`}>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
