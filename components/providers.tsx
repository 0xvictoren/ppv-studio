"use client";

import { darkTheme, lightTheme, RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import { MockAccountProvider, WalletAccountProvider } from "@/lib/client/account";
import { wagmiConfig } from "@/lib/client/wagmi";
import { isMock } from "@/lib/env";

// RainbowKit themed to the cream palette so the wallet modal matches the app.
function walletTheme(dark: boolean): Theme {
  const base = dark ? darkTheme({ borderRadius: "medium" }) : lightTheme({ borderRadius: "medium" });
  return {
    ...base,
    colors: {
      ...base.colors,
      accentColor: "#EDE1C8",
      accentColorForeground: "#1C1A17",
      modalBackground: dark ? "#191714" : "#FFFFFF",
      modalBorder: dark ? "#302D28" : "#E8E1D5",
    },
    fonts: { body: "var(--font-text), -apple-system, BlinkMacSystemFont, sans-serif" },
    shadows: { ...base.shadows, dialog: "0 24px 64px rgba(0,0,0,0.12)" },
  };
}

function Wallets({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  if (isMock) return <MockAccountProvider>{children}</MockAccountProvider>;
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={walletTheme(resolvedTheme === "dark")} modalSize="compact">
        <WalletAccountProvider>{children}</WalletAccountProvider>
      </RainbowKitProvider>
    </WagmiProvider>
  );
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-center"
      toastOptions={{
        style: {
          background: "hsl(var(--surface))",
          color: "hsl(var(--foreground))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 14,
          fontFamily: "var(--font-text)",
        },
      }}
    />
  );
}

/** Offline app shell for the Downloads library (production only). */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
}

export function Providers({ children }: { children: ReactNode }) {
  useServiceWorker();
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }));
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem themes={["light", "dark"]}>
      <QueryClientProvider client={queryClient}>
        <Wallets>
          {children}
          <ThemedToaster />
        </Wallets>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
