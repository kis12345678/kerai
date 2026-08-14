using System.Threading.Channels;
using Kerai.Contracts;

namespace Kerai.Server;

/// <summary>
/// Samples machine telemetry in the background (~5s) and serves the cached snapshot
/// so /api/system/status never blocks on the CPU sampling interval.
/// </summary>
public sealed class CachedSystemMonitor(WindowsSystemMonitor inner) : ISystemMonitor, IDisposable, IHostedService
{
    private readonly WindowsSystemMonitor inner = inner;
    private readonly Channel<SystemStatusDto> samples = Channel.CreateBounded<SystemStatusDto>(1);
    private SystemStatusDto cached = new(0, 0, 0, 0, [], null, string.Empty, DateTimeOffset.MinValue, null);
    private CancellationTokenSource? cts;
    private Task? loop;

    public SystemStatusDto GetStatus()
    {
        var snapshot = cached;
        if (snapshot.Timestamp == DateTimeOffset.MinValue)
        {
            // First request before the sampler ran — sample once, synchronously.
            snapshot = inner.GetStatus();
            cached = snapshot;
        }
        return snapshot;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        loop = Task.Run(() => SampleLoopAsync(cts.Token), CancellationToken.None);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        cts?.Cancel();
        if (loop is not null) await Task.WhenAny(loop, Task.Delay(2000, cancellationToken));
    }

    private async Task SampleLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            cached = inner.GetStatus();
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    public void Dispose() => cts?.Dispose();
}
