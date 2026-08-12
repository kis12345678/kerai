import { tool } from "ai";
import { z } from "zod";
import { getSystemSnapshot } from "./system-snapshot";

export function createSystemTools() {
  const getSystemStatus = tool({
    description:
      "Get real-time status of the local PC this server is running on: battery percentage and " +
      "charging state, CPU load, memory usage, GPU utilization/VRAM/temperature, storage usage, " +
      "whether Ollama is reachable (and which models it has loaded), and uptime. Use this for " +
      "questions like 'what's my battery percentage', 'how much RAM am I using', 'how hot is my " +
      "GPU', or 'is Ollama up' — it reads live OS/driver data, not an approximation.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        return await getSystemSnapshot();
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { getSystemStatus };
}
