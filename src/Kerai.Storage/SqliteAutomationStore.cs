using Kerai.Contracts;
using Kerai.Runtime;
using Microsoft.Data.Sqlite;

namespace Kerai.Storage;

public sealed class SqliteAutomationStore(SqliteDatabase database) : IAutomationStore
{
    public IReadOnlyCollection<AutomationDto> List()
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Label, Prompt, Frequency, IntervalMinutes, DailyAt, Enabled, CreatedAt, LastFiredAt, MissionCount FROM automations ORDER BY CreatedAt DESC";
        using var reader = command.ExecuteReader();
        var list = new List<AutomationDto>();
        while (reader.Read()) list.Add(Map(reader));
        return list;
    }

    public AutomationDto Create(CreateAutomationRequest request)
    {
        AutomationRules.Validate(request.Label, request.Prompt, request.Frequency, request.IntervalMinutes, request.DailyAt);
        var now = DateTimeOffset.UtcNow;
        var automation = new AutomationDto(
            Guid.NewGuid(), request.Label.Trim(), request.Prompt.Trim(), request.Frequency,
            request.IntervalMinutes, request.DailyAt, true, now, null, 0);

        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO automations (Id, Label, Prompt, Frequency, IntervalMinutes, DailyAt, Enabled, CreatedAt, LastFiredAt, MissionCount) " +
            "VALUES (@id, @label, @prompt, @frequency, @interval, @daily, 1, @created, NULL, 0)";
        command.Parameters.AddWithValue("@id", automation.Id.ToString());
        command.Parameters.AddWithValue("@label", automation.Label);
        command.Parameters.AddWithValue("@prompt", automation.Prompt);
        command.Parameters.AddWithValue("@frequency", automation.Frequency.ToString());
        command.Parameters.AddWithValue("@interval", (object?)automation.IntervalMinutes ?? DBNull.Value);
        command.Parameters.AddWithValue("@daily", (object?)automation.DailyAt ?? DBNull.Value);
        command.Parameters.AddWithValue("@created", SqliteDatabase.FormatTimestamp(now));
        command.ExecuteNonQuery();
        return automation;
    }

    public AutomationDto Update(Guid id, UpdateAutomationRequest request)
    {
        var current = Get(id) ?? throw new KeyNotFoundException($"Automation {id} was not found.");
        var label = request.Label ?? current.Label;
        var prompt = request.Prompt ?? current.Prompt;
        var frequency = request.Frequency ?? current.Frequency;
        var interval = request.IntervalMinutes ?? current.IntervalMinutes;
        var dailyAt = request.DailyAt ?? current.DailyAt;
        var enabled = request.Enabled ?? current.Enabled;
        AutomationRules.Validate(label, prompt, frequency, interval, dailyAt);

        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE automations SET Label = @label, Prompt = @prompt, Frequency = @frequency, IntervalMinutes = @interval, DailyAt = @daily, Enabled = @enabled WHERE Id = @id";
        command.Parameters.AddWithValue("@label", label.Trim());
        command.Parameters.AddWithValue("@prompt", prompt.Trim());
        command.Parameters.AddWithValue("@frequency", frequency.ToString());
        command.Parameters.AddWithValue("@interval", (object?)interval ?? DBNull.Value);
        command.Parameters.AddWithValue("@daily", (object?)dailyAt ?? DBNull.Value);
        command.Parameters.AddWithValue("@enabled", enabled ? 1 : 0);
        command.Parameters.AddWithValue("@id", id.ToString());
        command.ExecuteNonQuery();
        return Get(id)!;
    }

    public void Delete(Guid id)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM automations WHERE Id = @id";
        command.Parameters.AddWithValue("@id", id.ToString());
        if (command.ExecuteNonQuery() == 0) throw new KeyNotFoundException($"Automation {id} was not found.");
    }

    public AutomationDto MarkFired(Guid id, DateTimeOffset firedAt)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE automations SET LastFiredAt = @fired, MissionCount = MissionCount + 1 WHERE Id = @id";
        command.Parameters.AddWithValue("@fired", SqliteDatabase.FormatTimestamp(firedAt));
        command.Parameters.AddWithValue("@id", id.ToString());
        if (command.ExecuteNonQuery() == 0) throw new KeyNotFoundException($"Automation {id} was not found.");
        return Get(id)!;
    }

    private AutomationDto? Get(Guid id)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Label, Prompt, Frequency, IntervalMinutes, DailyAt, Enabled, CreatedAt, LastFiredAt, MissionCount FROM automations WHERE Id = @id";
        command.Parameters.AddWithValue("@id", id.ToString());
        using var reader = command.ExecuteReader();
        return reader.Read() ? Map(reader) : null;
    }

    private static AutomationDto Map(SqliteDataReader reader) => new(
        Guid.Parse(reader.GetString(0)),
        reader.GetString(1),
        reader.GetString(2),
        Enum.Parse<AutomationFrequency>(reader.GetString(3)),
        reader.IsDBNull(4) ? null : reader.GetInt32(4),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        reader.GetInt32(6) == 1,
        SqliteDatabase.ParseTimestamp(reader.GetString(7)),
        reader.IsDBNull(8) ? null : SqliteDatabase.ParseTimestamp(reader.GetString(8)),
        reader.GetInt32(9));
}
