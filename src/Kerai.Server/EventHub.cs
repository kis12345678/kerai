using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kerai.Server;

/// <summary>Broadcasts typed JSON events to every connected control surface.</summary>
public sealed class EventHub
{
    private readonly object gate = new();
    private readonly List<WebSocket> clients = [];
    private static readonly JsonSerializerOptions JsonOptions = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    public void Add(WebSocket socket)
    {
        lock (gate) clients.Add(socket);
    }

    public void Remove(WebSocket socket)
    {
        lock (gate) clients.Remove(socket);
    }

    public async Task SendAsync(object payload, CancellationToken cancellationToken = default)
    {
        WebSocket[] snapshot;
        lock (gate) snapshot = clients.ToArray();
        if (snapshot.Length == 0) return;
        var json = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, JsonOptions));
        foreach (var client in snapshot)
        {
            try
            {
                if (client.State == WebSocketState.Open)
                    await client.SendAsync(json, WebSocketMessageType.Text, true, cancellationToken);
            }
            catch (WebSocketException)
            {
                Remove(client);
            }
        }
    }
}
