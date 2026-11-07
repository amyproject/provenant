import type { Metadata } from "next";
import { AgentConsole } from "@/components/views/agent-console";

export const metadata: Metadata = { title: "Agent operations" };

export default function AgentPage() {
  return <AgentConsole />;
}
