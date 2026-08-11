import { tool } from "ai";
import { z } from "zod";
import si from "systeminformation";
import { getGpuStatus } from "./gpu-status";

export function createSystemTools() {
  const getSystemStatus = tool({
    description:
      "Get real-time status of the local PC this server is running on: battery percentage and " +
      "charging state, CPU load, memory usage, GPU utilization/VRAM/temperature, and uptime. Use " +
      "this for questions like 'what's my battery percentage', 'how much RAM am I using', or " +
      "'how hot is my GPU' — it reads live OS/driver data, not an approximation.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const [battery, currentLoad, mem, time, gpu] = await Promise.all([
          si.battery(),
          si.currentLoad(),
          si.mem(),
          Promise.resolve(si.time()),
          getGpuStatus(),
        ]);
        return {
          battery: battery.hasBattery
            ? {
                percent: battery.percent,
                isCharging: battery.isCharging,
              }
            : { hasBattery: false },
          cpuLoadPercent: Math.round(currentLoad.currentLoad),
          memory: {
            usedGb: Math.round(((mem.total - mem.available) / 1024 ** 3) * 10) / 10,
            totalGb: Math.round((mem.total / 1024 ** 3) * 10) / 10,
            usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100),
          },
          gpu,
          uptimeSec: time.uptime,
        };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return { getSystemStatus };
}
