import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prospect Engine",
  description: "Find businesses with weak websites, build redesign demos, send outreach.",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/", label: "Campaigns" },
  { href: "/leads", label: "Leads" },
  { href: "/demos", label: "Demo review" },
  { href: "/outreach", label: "Outreach" },
  { href: "/jobs", label: "Jobs" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-8 px-6">
            <Link href="/" className="font-semibold tracking-tight">
              Prospect Engine
            </Link>
            <nav className="flex gap-1 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-black/70 hover:bg-black/5 hover:text-black">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
