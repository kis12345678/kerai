import { execFile } from "node:child_process";
import { promisify } from "node:util";
import si from "systeminformation";

const execFileAsync = promisify(execFile);

export type GpuStatus = {
  model: string;
  vendor: string;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  utilizationPercent: number | null;
  temperatureC: number | null;
  powerDrawW: number | null;
  powerLimitW: number | null;
};

// nvidia-smi gives live utilization % that systeminformation's WMI-based reader can't get on
// Windows; try it first (fixed, hardcoded args — never user input) and fall back to
// systeminformation's cross-vendor controller data if it's missing or this isn't an NVIDIA box.
async function readNvidiaSmi(): Promise<GpuStatus | null> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit",
      "--format=csv,noheader,nounits",
    ]);
    const line = stdout.trim().split("\n")[0];
    if (!line) return null;
    const [name, util, memUsed, memTotal, temp, power, powerLimit] = line.split(",").map((s) => s.trim());
    return {
      model: name,
      vendor: "NVIDIA",
      vramUsedMb: Number(memUsed),
      vramTotalMb: Number(memTotal),
      utilizationPercent: Number(util),
      temperatureC: Number(temp),
      powerDrawW: Math.round(Number(power)),
      powerLimitW: Math.round(Number(powerLimit)),
    };
  } catch {
    return null;
  }
}

async function readViaSystemInformation(): Promise<GpuStatus | null> {
  const { controllers } = await si.graphics();
  // Prefer a controller that reports real VRAM over virtual/passthrough display adapters.
  const gpu = controllers.find((c) => c.vram && c.vram > 0) ?? controllers[0];
  if (!gpu) return null;
  return {
    model: gpu.model,
    vendor: gpu.vendor,
    vramUsedMb: gpu.memoryUsed ?? null,
    vramTotalMb: gpu.memoryTotal ?? (gpu.vram || null),
    utilizationPercent: gpu.utilizationGpu ?? null,
    temperatureC: gpu.temperatureGpu ?? null,
    powerDrawW: gpu.powerDraw ?? null,
    powerLimitW: gpu.powerLimit ?? null,
  };
}

export async function getGpuStatus(): Promise<GpuStatus | null> {
  return (await readNvidiaSmi()) ?? (await readViaSystemInformation());
}
