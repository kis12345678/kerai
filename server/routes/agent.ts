import { RequestHandler } from "express";
import { agent } from "../lib/agent.js";

/**
 * GET /api/agent/system — get system information
 */
export const handleAgentSystem: RequestHandler = (_req, res) => {
  const info = agent.getSystemInfo();
  res.status(200).json(info);
};

/**
 * GET /api/agent/cpu — get live CPU usage
 */
export const handleAgentCpu: RequestHandler = (_req, res) => {
  const usage = agent.getCpuUsage();
  res.status(200).json(usage);
};

/**
 * GET /api/agent/disks — get disk usage
 */
export const handleAgentDisks: RequestHandler = async (_req, res) => {
  const disks = await agent.getDiskUsage();
  res.status(200).json({ disks, total: disks.length });
};

/**
 * GET /api/agent/network — get network info
 */
export const handleAgentNetwork: RequestHandler = (_req, res) => {
  const info = agent.getNetworkInfo();
  res.status(200).json(info);
};

/**
 * GET /api/agent/processes — list processes
 */
export const handleAgentProcesses: RequestHandler = async (req, res) => {
  const top = req.query.top ? parseInt(req.query.top as string, 10) : 30;
  const sortBy = (req.query.sort as "cpu" | "memory") || "cpu";
  const filter = req.query.filter as string | undefined;

  const processes = await agent.listProcesses({ top, sortBy, filter });
  res.status(200).json({ processes, total: processes.length });
};

/**
 * POST /api/agent/processes/kill — kill a process
 */
export const handleAgentKillProcess: RequestHandler = async (req, res) => {
  const { pid, force } = req.body as { pid?: number; force?: boolean };

  if (!pid) {
    res.status(400).json({ error: "pid is required" });
    return;
  }

  const result = await agent.killProcess(pid, force !== false);
  res.status(result.success ? 200 : 500).json(result);
};

/**
 * GET /api/agent/windows — list visible windows
 */
export const handleAgentWindows: RequestHandler = (_req, res) => {
  const windows = agent.listWindows();
  res.status(200).json({ windows, total: windows.length });
};

/**
 * POST /api/agent/windows/focus — focus a window
 */
export const handleAgentFocusWindow: RequestHandler = (req, res) => {
  const { pid } = req.body as { pid?: number };

  if (!pid) {
    res.status(400).json({ error: "pid is required" });
    return;
  }

  const result = agent.focusWindow(pid);
  res.status(result.success ? 200 : 500).json(result);
};

/**
 * POST /api/agent/app/open — open an application
 */
export const handleAgentOpenApp: RequestHandler = async (req, res) => {
  const { name, args } = req.body as { name?: string; args?: string };

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const result = await agent.openApplication(name, args);
  res.status(result.success ? 200 : 500).json(result);
};

/**
 * POST /api/agent/powershell — execute a PowerShell command (allowlist only)
 */
export const handleAgentPowerShell: RequestHandler = async (req, res) => {
  const { command } = req.body as { command?: string };

  if (!command) {
    res.status(400).json({ error: "command is required" });
    return;
  }

  const result = await agent.executePowerShell(command);
  res.status(result.exitCode === 0 ? 200 : 500).json(result);
};

/**
 * GET /api/agent/files/read — safely read a file
 */
export const handleAgentReadFile: RequestHandler = (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }

  const result = agent.readFile(filePath);
  if ("error" in result) {
    res.status(404).json(result);
    return;
  }

  res.status(200).json(result);
};

/**
 * GET /api/agent/files/list — list directory contents
 */
export const handleAgentListDir: RequestHandler = (req, res) => {
  const dirPath = (req.query.path as string) || process.cwd();

  const result = agent.listDirectory(dirPath);
  if ("error" in result) {
    res.status(404).json(result);
    return;
  }

  res.status(200).json(result);
};
