// Next.js boot hook (backend-owned): start the agent autopilot heartbeat when the Node server starts,
// so cases advance with zero clicks even before any page or API is hit.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureAutopilot } = await import("./server/agent/autopilot");
  ensureAutopilot();
}
