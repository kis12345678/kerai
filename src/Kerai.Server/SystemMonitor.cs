using System.Diagnostics;
using System.Runtime.InteropServices;
using Kerai.Contracts;

namespace Kerai.Server;

public interface ISystemMonitor
{
    SystemStatusDto GetStatus();
}

/// <summary>
/// Real machine telemetry from actual OS sources. No hard-coded values.
/// Deployment target is local Windows; non-Windows returns an explicit unsupported state.
/// CPU is sampled over a short interval; GPU comes from nvidia-smi when present.
/// </summary>
public sealed class WindowsSystemMonitor : ISystemMonitor
{
    public SystemStatusDto GetStatus()
    {
        if (!OperatingSystem.IsWindows())
        {
            return new SystemStatusDto(0, 0, 0, 0, Array.Empty<StorageMetric>(), null, RuntimeInformation.OSDescription, DateTimeOffset.UtcNow, "System telemetry is only implemented for Windows.");
        }

        try
        {
            var cpu = SampleCpuPercent();
            var ram = GetRam(out var totalBytes, out var usedBytes);
            var storage = GetStorage();
            var gpu = TryGetGpu();
            return new SystemStatusDto(cpu, ram, totalBytes, usedBytes, storage, gpu, RuntimeInformation.OSDescription, DateTimeOffset.UtcNow, null);
        }
        catch (Exception ex)
        {
            return new SystemStatusDto(0, 0, 0, 0, Array.Empty<StorageMetric>(), null, RuntimeInformation.OSDescription, DateTimeOffset.UtcNow, $"Telemetry error: {ex.Message}");
        }
    }

    private static double SampleCpuPercent()
    {
        if (!GetSystemTimes(out var idle1, out var kernel1, out var user1)) return 0;
        Thread.Sleep(300);
        if (!GetSystemTimes(out var idle2, out var kernel2, out var user2)) return 0;

        var idle = FileTime(idle2) - FileTime(idle1);
        var kernel = FileTime(kernel2) - FileTime(kernel1);
        var user = FileTime(user2) - FileTime(user1);
        var total = kernel + user;
        var busy = total - idle;
        return total == 0 ? 0 : Math.Round(busy * 100.0 / total, 1);
    }

    private static double GetRam(out long totalBytes, out long usedBytes)
    {
        var buffer = new MemoryStatusEx { DwLength = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (!GlobalMemoryStatusEx(ref buffer))
        {
            totalBytes = 0;
            usedBytes = 0;
            return 0;
        }
        totalBytes = (long)buffer.UllTotalPhys;
        usedBytes = (long)(buffer.UllTotalPhys - buffer.UllAvailPhys);
        return buffer.DwMemoryLoad;
    }

    private static IReadOnlyList<StorageMetric> GetStorage()
    {
        var list = new List<StorageMetric>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            if (drive.DriveType != DriveType.Fixed || !drive.IsReady) continue;
            var total = drive.TotalSize;
            var used = total - drive.TotalFreeSpace;
            var percent = total == 0 ? 0 : Math.Round(used * 100.0 / total, 1);
            list.Add(new StorageMetric(drive.Name.TrimEnd('\\'), total, used, percent));
        }
        return list;
    }

    private static GpuMetric? TryGetGpu()
    {
        try
        {
            var startInfo = new ProcessStartInfo("nvidia-smi")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                Arguments = "--query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits",
            };
            using var process = Process.Start(startInfo);
            if (process is null) return null;
            if (!process.WaitForExit(2000))
            {
                process.Kill(true);
                return null;
            }
            var output = process.StandardOutput.ReadToEnd().Trim();
            if (string.IsNullOrEmpty(output)) return null;

            var parts = output.Split(',').Select(p => p.Trim()).ToArray();
            if (parts.Length < 4) return null;

            double? utilization = double.TryParse(parts[1], out var util) ? util : null;
            double? usedMiB = double.TryParse(parts[2], out var used) ? used : null;
            double? totalMiB = double.TryParse(parts[3], out var total) && total > 0 ? total : null;
            double? vramPercent = usedMiB.HasValue && totalMiB.HasValue && totalMiB.Value > 0
                ? Math.Round(usedMiB.Value * 100.0 / totalMiB.Value, 1)
                : null;
            return new GpuMetric(parts[0], utilization, vramPercent);
        }
        catch
        {
            return null;
        }
    }

    private static ulong FileTime(FILETIME ft) => ((ulong)ft.DwHighDateTime << 32) | ft.DwLowDateTime;

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint DwLowDateTime;
        public uint DwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint DwLength;
        public uint DwMemoryLoad;
        public ulong UllTotalPhys;
        public ulong UllAvailPhys;
        public ulong UllTotalPageFile;
        public ulong UllAvailPageFile;
        public ulong UllTotalVirtual;
        public ulong UllAvailVirtual;
        public ulong UllAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(out FILETIME lpIdleTime, out FILETIME lpKernelTime, out FILETIME lpUserTime);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx lpBuffer);
}
