import Link from "next/link";

import { ThemeToggle } from "@/components/theme/theme-toggle";

const LINKS = [
  { href: "/", label: "Timeline" },
  { href: "/about", label: "About" },
  { href: "/method", label: "Method" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/">
          <span className="brand-title">Rearview Mirror</span>
          <span className="brand-subtitle">AI model timeline since ChatGPT 3.5</span>
        </Link>

        <div className="site-header-controls">
          <nav aria-label="Primary">
            <ul className="main-nav">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
