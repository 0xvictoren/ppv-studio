import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import "./globals.css";

// SF Pro: Text for UI and body copy, Display for large type (Apple uses Display at 20pt+).
const sfText = localFont({
  variable: "--font-text",
  display: "swap",
  src: [
    { path: "./fonts/sf/SF-Pro-Text-Regular.otf", weight: "400" },
    { path: "./fonts/sf/SF-Pro-Text-Medium.otf", weight: "500" },
    { path: "./fonts/sf/SF-Pro-Text-Semibold.otf", weight: "600" },
  ],
});
const sfDisplay = localFont({
  variable: "--font-display",
  display: "swap",
  src: [
    { path: "./fonts/sf/SF-Pro-Display-Regular.otf", weight: "400" },
    { path: "./fonts/sf/SF-Pro-Display-Medium.otf", weight: "500" },
    { path: "./fonts/sf/SF-Pro-Display-Semibold.otf", weight: "600" },
    { path: "./fonts/sf/SF-Pro-Display-Bold.otf", weight: "700" },
  ],
});

export const metadata: Metadata = {
  title: { default: "PayPerWatch: pay only for what you watch", template: "%s · PayPerWatch" },
  description: "Movies, tutorials and exclusive videos you pay for by the second in USDC on Arc. Unused funds stay yours.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#110f0d" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sfText.variable} ${sfDisplay.variable} min-h-screen font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
