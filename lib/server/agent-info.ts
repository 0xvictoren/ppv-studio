import "server-only";
import { agentApiEnabled, env, isTestnet } from "../env";

// What an agent needs to use PayPerWatch on its own, served as /llms.txt and GET /api/agent.
// One source so the two never disagree.

export function agentInfo() {
  const base = env.appUrl;
  return {
    name: "PayPerWatch",
    description: "Answers from creators' videos. Ask a question; get the full timestamped transcript of the video that best answers it, paid per call in USDC over x402.",
    available: agentApiEnabled,
    network: isTestnet ? "Arc Testnet" : "Arc mainnet",
    payment: {
      protocol: "x402 (version 2)",
      scheme: "exact, settled by Circle Gateway nanopayments (gas-free, batched)",
      accepts: "a Circle Gateway USDC balance on any chain listed in the 402 response's accepts[]",
      price: "What a person pays to watch the whole matching video (usually a few cents). The 402 response states the exact amount before anything is paid.",
      noMatch: "If nothing covers the question, you get 404 and pay nothing.",
    },
    endpoints: [
      { method: "GET", path: "/api/agent/ask?q={question}", paid: true, description: "The one to use. Finds the best video for the question and returns its full transcript, the matching moments and other relevant videos. POST {\"q\": \"...\"} also works." },
      { method: "GET", path: "/api/agent/search?q={query}&limit=10", paid: false, description: "Free search: matching videos, the transcript moments that matched, and each full transcript's price and URL." },
      { method: "GET", path: "/api/agent/videos/{id}/transcript", paid: true, description: "Buy one specific video's full transcript." },
    ].map((e) => ({ ...e, url: base + e.path })),
    howTo: [
      `Call ${base}/api/agent/ask?q=<the user's question> with any x402 client that can pay through Circle Gateway (for example @circle-fin/x402-batching GatewayClient.pay, or a Circle agent wallet: circle services pay).`,
      "The first call returns 402 Payment Required with the price; the client pays and retries automatically.",
      "Answer from answer.moments and answer.transcript, and cite answer.video.watchUrl so the user can watch the source.",
    ],
    contact: `${base}/terms`,
  };
}

export function agentInfoText() {
  const i = agentInfo();
  const lines = [
    `# ${i.name}`,
    "",
    `> ${i.description}`,
    "",
    i.available ? `Live on ${i.network}.` : `The agent API is switched off on this deployment (${i.network}) right now.`,
    "",
    "## Ask a question (paid, x402)",
    "",
    `- ${i.endpoints[0].url}`,
    `  ${i.endpoints[0].description}`,
    "",
    "## Payment",
    "",
    `- Protocol: ${i.payment.protocol}, ${i.payment.scheme}.`,
    `- Pay with: ${i.payment.accepts}.`,
    `- Price: ${i.payment.price}`,
    `- ${i.payment.noMatch}`,
    "",
    "## Other endpoints",
    "",
    ...i.endpoints.slice(1).map((e) => `- ${e.method} ${e.url}${e.paid ? " (paid)" : " (free)"}: ${e.description}`),
    "",
    "## How to use",
    "",
    ...i.howTo.map((h, n) => `${n + 1}. ${h}`),
    "",
    `Machine-readable: ${env.appUrl}/api/agent`,
    "",
  ];
  return lines.join("\n");
}
