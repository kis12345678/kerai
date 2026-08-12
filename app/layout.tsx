import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kerai AI",
  description: "A local AI workspace — chat, build apps, and run an agent on your own hardware. No cloud, no keys.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kerai AI",
  },
};

export const viewport: Viewport = {
  themeColor: "#05080f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      {/* Satoshi via Fontshare — a plain <link> so the CDN stylesheet actually ships (a remote
          CSS @import gets dropped by Next's CSS pipeline). Falls back to Geist/system fonts. */}
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap"
        />
      </head>
      {/* suppressHydrationWarning: browser extensions inject attributes into <body> (e.g.
          __processed_<uuid>__) between HTML delivery and hydration, which React reports as a
          mismatch it "won't patch up". Nothing in this app renders those. The flag only covers
          this element's own attributes and text — one level deep, not the tree — so real
          hydration bugs inside {children} still surface normally. */}
      <body className="h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
