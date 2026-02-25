import type { Metadata } from "next";
import { Manrope, Source_Serif_4 } from "next/font/google";

import { SiteHeader } from "@/components/site/site-header";

import "./globals.css";

const sans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const serif = Source_Serif_4({
  variable: "--font-serif",
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
      <body className={`${sans.variable} ${serif.variable}`}>
        <SiteHeader />
        <div className="site-content">{children}</div>
      </body>
    </html>
  );
}
