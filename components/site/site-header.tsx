import Link from "next/link";

import { ThemeToggle } from "@/components/theme/theme-toggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/">
          <span className="brand-title">Rearview Mirror</span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
