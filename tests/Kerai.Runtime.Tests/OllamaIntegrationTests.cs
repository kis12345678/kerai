using Kerai.Contracts;
using Kerai.Runtime;
using Xunit;

namespace Kerai.Runtime.Tests;

public sealed class OllamaIntegrationTests
{
    [Fact]
    public async Task Generation_returns_tool_calls_or_content()
    {
        var client = new OllamaClient(new HttpClient { Timeout = TimeSpan.FromMinutes(3) });
        var tools = new ToolRegistry().List().ToArray();
        var messages = new List<ChatMessage>
        {
            new("system", "You are KERAI, a local AI agent. Use tools to inspect the workspace, then answer concisely."),
            new("user", "Inspect my workspace and tell me what project I am working on."),
        };

        var result = await client.GenerateAsync("gpt-oss-agent:latest", messages, tools);

        Assert.True(result.ToolCalls.Count > 0 || !string.IsNullOrWhiteSpace(result.Content));
    }
}
