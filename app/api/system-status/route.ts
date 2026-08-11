import si from "systeminformation";
import { getGpuStatus } from "@/lib/gpu-status";

export async function GET() {
  const [battery, cpu, mem, currentLoad, osInfo, time, gpu] = await Promise.all([
    si.battery(),
    si.cpu(),
    si.mem(),
    si.currentLoad(),
    si.osInfo(),
    Promise.resolve(si.time()),
    getGpuStatus(),
  ]);

  return Response.json({
    battery: {
      hasBattery: battery.hasBattery,
      percent: battery.percent,
      isCharging: battery.isCharging,
      timeRemainingMin: battery.timeRemaining,
    },
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      loadPercent: Math.round(currentLoad.currentLoad),
    },
    memory: {
      totalGb: Math.round((mem.total / 1024 ** 3) * 10) / 10,
      usedGb: Math.round(((mem.total - mem.available) / 1024 ** 3) * 10) / 10,
      usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100),
    },
    os: {
      platform: osInfo.platform,
      distro: osInfo.distro,
      hostname: osInfo.hostname,
    },
    gpu,
    uptimeSec: time.uptime,
  });
}
