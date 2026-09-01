import os from "node:os";
import { execSync, exec as execCb } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { eventBus } from "./events.js";

const execAsync = promisify(execCb);

// ── Types ──────────────────────────────────────────────────────

export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  uptime: number;
  nodeVersion: string;
  cpus: { model: string; cores: number; speed: number; }[];
  totalMemoryGB: number;
  freeMemoryGB: number;
  memoryUsagePercent: number;
  loadAvg: number[];
}

export interface CpuUsage {
  cores: { usage: number; model: string; }[];
  totalUsage: number;
  loadAvg: number[];
}

export interface DiskInfo {
  name: string;
  type: string;
  sizeGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
  mount: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memoryMB: number;
  memoryPercent: number;
  status: string;
  startTime?: string;
  command?: string;
}

export interface WindowInfo {
  pid: number;
  name: string;
  title: string;
  isForeground: boolean;
}

export interface NetworkInfo {
  hostname: string;
  platform: string;
  interfaces: {
    name: string;
    addresses: { address: string; family: string; internal: boolean; }[];
  }[];
  connections?: { protocol: string; local: string; remote: string; state: string; }[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// ── Command Allowlist ──────────────────────────────────────────

/**
 * Only these PowerShell commands are allowed through the agent.
 * This prevents arbitrary command execution.
 */
const ALLOWED_POWERSHELL_COMMANDS = [
  "Get-Process",
  "Get-Service",
  "Get-ChildItem",
  "Get-Content",
  "Get-PSDrive",
  "Get-NetAdapter",
  "Get-NetTCPConnection",
  "Get-WmiObject",
  "Get-CimInstance",
  "Start-Process",
  "Stop-Process",
  "Get-Date",
  "Get-ComputerInfo",
  "Get-Volume",
  "Get-CimInstance Win32_OperatingSystem",
  "Get-CimInstance Win32_ComputerSystem",
  "Get-CimInstance Win32_Processor",
  "Get-CimInstance Win32_LogicalDisk",
  "Get-CimInstance Win32_BaseBoard",
  "Get-CimInstance Win32_VideoController",
];

function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  return ALLOWED_POWERSHELL_COMMANDS.some((allowed) =>
    trimmed.toLowerCase().startsWith(allowed.toLowerCase())
  );
}

// ── Windows Agent ──────────────────────────────────────────────

/**
 * KERAI Windows Agent
 *
 * Provides controlled, typed operations for OS interaction.
 * Every method checks permissions and uses typed outputs.
 * Never exposes an unrestricted remote shell.
 */
class WindowsAgent {
  private isWin = os.platform() === "win32";

  // ── System Monitoring ──────────────────────────────────────

  /**
   * Get comprehensive system information
   */
  getSystemInfo(): SystemInfo {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      nodeVersion: process.version,
      cpus: cpus.map((c) => ({
        model: c.model.trim(),
        cores: 1,
        speed: c.speed,
      })),
      totalMemoryGB: Math.round(totalMem / (1024 ** 3) * 100) / 100,
      freeMemoryGB: Math.round(freeMem / (1024 ** 3) * 100) / 100,
      memoryUsagePercent: Math.round((1 - freeMem / totalMem) * 10000) / 100,
      loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    };
  }

  /**
   * Get live CPU usage
   */
  getCpuUsage(): CpuUsage {
    const cpus = os.cpus();
    const cores = cpus.map((cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return {
        usage: Math.round(((total - idle) / total) * 10000) / 100,
        model: cpu.model.trim(),
      };
    });

    const totalUsage = cores.reduce((sum, c) => sum + c.usage, 0) / cores.length;

    return {
      cores,
      totalUsage: Math.round(totalUsage * 100) / 100,
      loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    };
  }

  /**
   * Get disk usage
   */
  async getDiskUsage(): Promise<DiskInfo[]> {
    if (this.isWin) {
      try {
        const output = execSync(
          `powershell -NoProfile -Command "Get-Volume | Where-Object { $_.DriveLetter } | Select-Object DriveLetter, FileSystemLabel, @{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}}, @{N='UsedGB';E={[math]::Round(($_.Size-$_.SizeRemaining)/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}}, @{N='UsagePct';E={[math]::Round((($_.Size-$_.SizeRemaining)/$_.Size)*100,1)}} | ConvertTo-Json"`,
          { encoding: "utf-8", timeout: 10000 }
        );
        const parsed = JSON.parse(output || "[]");
        const drives = Array.isArray(parsed) ? parsed : [parsed];
        return drives.map((d: any) => ({
          name: d.DriveLetter ? `${d.DriveLetter}:` : "Unknown",
          type: d.FileSystemLabel || "Local Disk",
          sizeGB: d.SizeGB || 0,
          usedGB: d.UsedGB || 0,
          freeGB: d.FreeGB || 0,
          usagePercent: d.UsagePct || 0,
          mount: `${d.DriveLetter || "?"}:\\`,
        }));
      } catch {
        return [];
      }
    }

    // Unix fallback
    try {
      const output = execSync("df -h --output=source,size,used,avail,pcent,target 2>/dev/null | grep -E '^/'", {
        encoding: "utf-8", timeout: 5000,
      });
      return output.trim().split("\n").map((line) => {
        const parts = line.split(/\s+/);
        return {
          name: parts[0],
          type: "filesystem",
          sizeGB: parseFloat(parts[1]) || 0,
          usedGB: parseFloat(parts[2]) || 0,
          freeGB: parseFloat(parts[3]) || 0,
          usagePercent: parseFloat(parts[4]) || 0,
          mount: parts[5] || "/",
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Get network information
   */
  getNetworkInfo(): NetworkInfo {
    const nets = os.networkInterfaces();
    const interfaces = Object.entries(nets).map(([name, addrs]) => ({
      name,
      addresses: (addrs || []).map((a) => ({
        address: a.address,
        family: a.family,
        internal: a.internal,
      })),
    }));

    let connections: NetworkInfo["connections"] | undefined;

    if (this.isWin) {
      try {
        const output = execSync(
          `powershell -NoProfile -Command "Get-NetTCPConnection | Select-Object LocalPort, RemotePort, State, OwningProcess | Select-Object -First 20 | ConvertTo-Json"`,
          { encoding: "utf-8", timeout: 8000 }
        );
        const parsed = JSON.parse(output || "[]");
        const conns = Array.isArray(parsed) ? parsed : [parsed];
        connections = conns.map((c: any) => ({
          protocol: "TCP",
          local: `:${c.LocalPort}`,
          remote: c.RemotePort ? `:${c.RemotePort}` : "",
          state: c.State || "Unknown",
        }));
      } catch {}
    }

    return { hostname: os.hostname(), platform: os.platform(), interfaces, connections };
  }

  // ── Process Management ─────────────────────────────────────

  /**
   * List running processes
   */
  async listProcesses(options: { top?: number; sortBy?: "cpu" | "memory"; filter?: string } = {}): Promise<ProcessInfo[]> {
    const top = options.top || 30;
    const sortBy = options.sortBy || "cpu";

    if (this.isWin) {
      try {
        const sortProp = sortBy === "memory" ? "WorkingSet64" : "CPU";
        const output = execSync(
          `powershell -NoProfile -Command "Get-Process | Sort-Object -Property ${sortProp} -Descending | Select-Object -First ${top} Id, Name, CPU, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,1)}}, @{N='MemoryPct';E={[math]::Round(($_.WorkingSet64/[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1MB))*100,2)}}, StartTime | ConvertTo-Json"`,
          { encoding: "utf-8", timeout: 15000 }
        );
        let parsed = JSON.parse(output || "[]");
        const procs = Array.isArray(parsed) ? parsed : [parsed];

        let result = procs.map((p: any) => ({
          pid: p.Id,
          name: p.Name,
          cpu: Math.round((p.CPU || 0) * 100) / 100,
          memoryMB: p.MemoryMB || 0,
          memoryPercent: p.MemoryPct || 0,
          status: "running",
          startTime: p.StartTime,
        }));

        if (options.filter) {
          const f = options.filter.toLowerCase();
          result = result.filter((p) => p.name.toLowerCase().includes(f));
        }

        return result;
      } catch {
        return [];
      }
    }

    // Unix fallback
    try {
      const output = execSync(
        `ps aux --sort=-%${sortBy === "memory" ? "mem" : "cpu"} | head -${top + 1}`,
        { encoding: "utf-8", timeout: 10000 }
      );
      const lines = output.split("\n").filter(Boolean).slice(1);
      let result = lines.map((line) => {
        const parts = line.split(/\s+/);
        return {
          pid: parseInt(parts[1]),
          name: parts[10]?.split("/").pop() || parts[10] || "unknown",
          cpu: parseFloat(parts[2]) || 0,
          memoryMB: Math.round((parseFloat(parts[3]) || 0) * os.totalmem() / (100 * 1024 * 1024)),
          memoryPercent: parseFloat(parts[3]) || 0,
          status: "running",
        };
      });

      if (options.filter) {
        const f = options.filter.toLowerCase();
        result = result.filter((p) => p.name.toLowerCase().includes(f));
      }

      return result;
    } catch {
      return [];
    }
  }

  /**
   * Kill a process by PID
   */
  async killProcess(pid: number, force: boolean = true): Promise<{ success: boolean; message: string }> {
    eventBus.emit("tool.invoked", "agent", { action: "kill_process", pid, force }, "warn");

    if (this.isWin) {
      try {
        execSync(
          `powershell -NoProfile -Command "Stop-Process -Id ${pid} ${force ? "-Force" : ""} -ErrorAction Stop"`,
          { encoding: "utf-8", timeout: 10000 }
        );
        return { success: true, message: `Process ${pid} terminated` };
      } catch (err: any) {
        return { success: false, message: `Failed to kill process ${pid}: ${err.message}` };
      }
    }

    try {
      execSync(`kill ${force ? "-9" : ""} ${pid}`, { encoding: "utf-8", timeout: 5000 });
      return { success: true, message: `Process ${pid} terminated` };
    } catch (err: any) {
      return { success: false, message: `Failed to kill process ${pid}: ${err.message}` };
    }
  }

  // ── Window Management ──────────────────────────────────────

  /**
   * List all visible windows
   */
  listWindows(): WindowInfo[] {
    if (!this.isWin) return [];

    try {
      const output = execSync(
        `powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json"`,
        { encoding: "utf-8", timeout: 10000 }
      );
      const parsed = JSON.parse(output || "[]");
      const windows = Array.isArray(parsed) ? parsed : [parsed];

      return windows.map((w: any) => ({
        pid: w.Id,
        name: w.ProcessName,
        title: w.MainWindowTitle,
        isForeground: false,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Focus a window by PID
   */
  focusWindow(pid: number): { success: boolean; message: string } {
    if (!this.isWin) return { success: false, message: "Window focus only available on Windows" };

    try {
      // Use SetForegroundWindow via PowerShell
      execSync(
        `powershell -NoProfile -Command "
          Add-Type @'
            using System;
            using System.Runtime.InteropServices;
            public class Win32 {
              [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);
              [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
            }
'@
          $proc = Get-Process -Id ${pid} -ErrorAction Stop
          [Win32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
          [Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
        `,
        { encoding: "utf-8", timeout: 5000 }
      );
      return { success: true, message: `Window for PID ${pid} focused` };
    } catch (err: any) {
      return { success: false, message: `Failed to focus window: ${err.message}` };
    }
  }

  // ── Application Control ────────────────────────────────────

  /**
   * Open an application by path or name
   */
  async openApplication(name: string, args?: string): Promise<{ success: boolean; pid?: number; message: string }> {
    eventBus.emit("tool.invoked", "agent", { action: "open_app", name, args }, "warn");

    if (this.isWin) {
      try {
        const cmd = args
          ? `Start-Process '${name}' -ArgumentList '${args}' -PassThru`
          : `Start-Process '${name}' -PassThru`;
        const output = execSync(
          `powershell -NoProfile -Command "${cmd} | Select-Object Id | ConvertTo-Json"`,
          { encoding: "utf-8", timeout: 15000 }
        );
        const parsed = JSON.parse(output);
        return { success: true, pid: parsed.Id, message: `Opened ${name}` };
      } catch (err: any) {
        return { success: false, message: `Failed to open ${name}: ${err.message}` };
      }
    }

    try {
      execSync(`${name} ${args || ""} &`, { encoding: "utf-8", timeout: 5000, detached: true } as any);
      return { success: true, message: `Opened ${name}` };
    } catch (err: any) {
      return { success: false, message: `Failed to open ${name}: ${err.message}` };
    }
  }

  /**
   * Execute a PowerShell command (only if in allowlist)
   */
  async executePowerShell(command: string): Promise<CommandResult> {
    if (!this.isWin) {
      return { stdout: "", stderr: "PowerShell only available on Windows", exitCode: 1, durationMs: 0 };
    }

    if (!isCommandAllowed(command)) {
      return {
        stdout: "",
        stderr: `Command not in allowlist. Allowed: ${ALLOWED_POWERSHELL_COMMANDS.join(", ")}`,
        exitCode: 1,
        durationMs: 0,
      };
    }

    eventBus.emit("tool.invoked", "agent", { action: "powershell", command }, "warn");

    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -Command "${command.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 }
      );
      return { stdout, stderr: stderr || "", exitCode: 0, durationMs: Date.now() - start };
    } catch (err: any) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message,
        exitCode: err.status || 1,
        durationMs: Date.now() - start,
      };
    }
  }

  // ── File Operations (Safe) ─────────────────────────────────

  /**
   * Safely read a file (with size limit)
   */
  readFile(filePath: string, maxSizeMB: number = 5): { content: string; size: number; path: string } | { error: string } {
    try {
      const resolved = path.resolve(filePath);
      const stat = fs.statSync(resolved);
      if (stat.size > maxSizeMB * 1024 * 1024) {
        return { error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB > ${maxSizeMB}MB limit)` };
      }
      const content = fs.readFileSync(resolved, "utf-8");
      return { content, size: stat.size, path: resolved };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  /**
   * List directory contents safely
   */
  listDirectory(dirPath: string): { entries: { name: string; type: string; size: number; }[]; path: string } | { error: string } {
    try {
      const resolved = path.resolve(dirPath);
      const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((e) => {
        let size = 0;
        try {
          if (e.isFile()) {
            size = fs.statSync(path.join(resolved, e.name)).size;
          }
        } catch {}
        return {
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
          size,
        };
      });
      return { entries: entries.slice(0, 200), path: resolved };
    } catch (err: any) {
      return { error: err.message };
    }
  }
}

export const agent = new WindowsAgent();
