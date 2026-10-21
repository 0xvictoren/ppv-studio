// Self-hosted hourly settlement. On Vercel, vercel.json's cron does this instead.
// Runs at the top of every hour by calling our own protected cron route.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") return;
  const secret = process.env.CRON_SECRET;
  if (!secret || !process.env.SETTLER_PRIVATE_KEY) {
    console.warn("[ppw] Hourly settlement is off: set CRON_SECRET and SETTLER_PRIVATE_KEY.");
    return;
  }
  const port = process.env.PORT ?? "3000";
  const run = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/settle`, { headers: { authorization: `Bearer ${secret}` } });
      console.log(`[ppw] hourly settlement: ${res.status} ${await res.text()}`);
    } catch (e) {
      console.error("[ppw] hourly settlement failed:", e);
    }
  };
  const msToNextHour = 3_600_000 - (Date.now() % 3_600_000);
  setTimeout(() => {
    void run();
    setInterval(run, 3_600_000);
  }, msToNextHour);
  console.log(`[ppw] Hourly settlement scheduled; first run in ${Math.round(msToNextHour / 60000)} min.`);
}
