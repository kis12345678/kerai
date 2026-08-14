using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Kerai.Contracts;

namespace Kerai.Runtime;

public interface IOllamaClient
{
    Task<OllamaStatus> GetStatusAsync(CancellationToken cancellationToken = default);
    Task<OllamaChatResult> GenerateAsync(string model, IReadOnlyList<ChatMessage> messages, IReadOnlyList<ToolContract> tools, CancellationToken cancellationToken = default);
}

public sealed class OllamaClient(HttpClient httpClient, string endpoint = "http://127.0.0.1:11434") : IOllamaClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<OllamaStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await httpClient.GetAsync($"{endpoint.TrimEnd('/')}/api/tags", cancellationToken);
            if (!response.IsSuccessStatusCode) return new(false, endpoint, [], $"Ollama returned {(int)response.StatusCode}.");
            var payload = await response.Content.ReadFromJsonAsync<OllamaTags>(cancellationToken);
            return new(true, endpoint, payload?.Models?.Select(x => x.Name).Where(x => x is not null).Cast<string>().ToArray() ?? [], null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new(false, endpoint, [], ex.Message);
        }
    }

    public async Task<OllamaChatResult> GenerateAsync(string model, IReadOnlyList<ChatMessage> messages, IReadOnlyList<ToolContract> tools, CancellationToken cancellationToken = default)
    {
        var payload = new
        {
            model,
            stream = true,
            options = new { num_ctx = 8192 },
            messages = messages.Select(ToOllamaMessage).ToArray(),
            tools = tools.Select(ToOllamaTool),
        };

        using var response = await httpClient.PostAsJsonAsync($"{endpoint.TrimEnd('/')}/api/chat", payload, JsonOptions, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new OllamaException($"Ollama returned {(int)response.StatusCode} for model '{model}': {body.Trim()[..Math.Min(body.Trim().Length, 200)]}");
        }

        return await ReadStreamAsync(response, cancellationToken);
    }

    /// <summary>
    /// Consumes the NDJSON stream: content accumulates; tool calls are merged by
    /// index (Ollama streams argument fragments). Complete-object arguments replace
    /// accumulated fragments so both streaming styles work.
    /// </summary>
    private static async Task<OllamaChatResult> ReadStreamAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream);
        var content = new StringBuilder();
        var toolCalls = new Dictionary<int, (string Id, string Name, StringBuilder Arguments)>();
        string? line;

        while ((line = await reader.ReadLineAsync(cancellationToken)) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out var error))
                throw new OllamaException($"Ollama stream error: {error.GetString()}");

            if (root.TryGetProperty("message", out var message))
            {
                if (message.TryGetProperty("content", out var contentEl) && contentEl.ValueKind == JsonValueKind.String)
                    content.Append(contentEl.GetString());

                if (message.TryGetProperty("tool_calls", out var callList) && callList.ValueKind == JsonValueKind.Array)
                {
                    foreach (var call in callList.EnumerateArray())
                    {
                        var index = call.TryGetProperty("index", out var indexEl) && indexEl.ValueKind == JsonValueKind.Number ? indexEl.GetInt32() : 0;
                        var id = call.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                        var function = call.TryGetProperty("function", out var fnEl) ? fnEl : default;
                        var name = function.ValueKind != JsonValueKind.Undefined && function.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null;

                        if (!toolCalls.TryGetValue(index, out var accumulator))
                        {
                            accumulator = (id ?? $"call_{index}", name ?? string.Empty, new StringBuilder());
                            toolCalls[index] = accumulator;
                        }
                        else
                        {
                            if (name is not null && accumulator.Name.Length == 0) accumulator.Name = name;
                            if (id is not null) accumulator.Id = id;
                        }

                        if (function.ValueKind != JsonValueKind.Undefined && function.TryGetProperty("arguments", out var args))
                        {
                            if (args.ValueKind == JsonValueKind.Object)
                            {
                                accumulator.Arguments.Clear();
                                accumulator.Arguments.Append(args.GetRawText());
                            }
                            else if (args.ValueKind == JsonValueKind.String)
                            {
                                accumulator.Arguments.Append(args.GetString());
                            }
                        }
                    }
                }
            }

            if (root.TryGetProperty("done", out var done) && done.GetBoolean()) break;
        }

        var calls = toolCalls.OrderBy(pair => pair.Key)
            .Select(pair => new ToolCall(pair.Value.Name, NormalizeArguments(pair.Value.Arguments.ToString()), pair.Value.Id))
            .ToList();
        var text = content.ToString();
        return new OllamaChatResult(string.IsNullOrWhiteSpace(text) ? null : text, calls);
    }

    /// <summary>Ollama may deliver arguments as an object, a JSON string, or fragments; normalize to JSON text.</summary>
    private static string NormalizeArguments(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "{}";
        if (raw.Trim().StartsWith('{') || raw.Trim().StartsWith('[')) return raw;
        return raw; // fragment; executor tolerates
    }

    private static Dictionary<string, object?> ToOllamaMessage(ChatMessage message)
    {
        var result = new Dictionary<string, object?>
        {
            ["role"] = message.Role,
            ["content"] = message.Content,
        };
        if (message.ToolCalls is { Count: > 0 })
        {
            result["tool_calls"] = message.ToolCalls.Select(call => (object)new
            {
                id = call.Id,
                function = new { name = call.Name, arguments = ParseArguments(call.Arguments) },
            }).ToArray();
        }
        if (message.ToolCallId is not null) result["tool_call_id"] = message.ToolCallId;
        return result;
    }

    private static object ParseArguments(string arguments)
    {
        try
        {
            using var doc = JsonDocument.Parse(arguments);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return arguments;
        }
    }

    private static object ToOllamaTool(ToolContract tool) => new
    {
        type = "function",
        function = new
        {
            name = tool.Name,
            description = tool.Description,
            parameters = ParseSchema(tool.InputSchema),
        },
    };

    private static object ParseSchema(string inputSchema)
    {
        try
        {
            using var doc = JsonDocument.Parse(inputSchema);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return new { type = "object", properties = new Dictionary<string, object>() };
        }
    }

    private sealed record OllamaTags(OllamaModel[]? Models);
    private sealed record OllamaModel(string? Name);
}

public sealed class OllamaException(string message) : Exception(message);
