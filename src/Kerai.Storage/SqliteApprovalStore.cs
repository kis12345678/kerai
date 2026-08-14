using Kerai.Contracts;
using Kerai.Runtime;
using Microsoft.Data.Sqlite;

namespace Kerai.Storage;

public sealed class SqliteApprovalStore(SqliteDatabase database) : IApprovalStore
{
    private static readonly TimeSpan ApprovalLifetime = TimeSpan.FromMinutes(5);

    public IReadOnlyCollection<ApprovalDto> List(Guid? missionId = null)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = missionId.HasValue
            ? "SELECT Id, MissionId, ToolName, Input, Status, ExpiresAt FROM approvals WHERE MissionId = @mission ORDER BY ExpiresAt DESC"
            : "SELECT Id, MissionId, ToolName, Input, Status, ExpiresAt FROM approvals ORDER BY ExpiresAt DESC";
        if (missionId.HasValue) command.Parameters.AddWithValue("@mission", missionId.Value.ToString());
        using var reader = command.ExecuteReader();
        var list = new List<ApprovalDto>();
        while (reader.Read()) list.Add(Map(reader));
        return list;
    }

    public ApprovalDto? Get(Guid id)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, MissionId, ToolName, Input, Status, ExpiresAt FROM approvals WHERE Id = @id";
        command.Parameters.AddWithValue("@id", id.ToString());
        using var reader = command.ExecuteReader();
        return reader.Read() ? Map(reader) : null;
    }

    public ApprovalDto? FindByKey(string key)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, MissionId, ToolName, Input, Status, ExpiresAt FROM approvals WHERE Key = @key";
        command.Parameters.AddWithValue("@key", key);
        using var reader = command.ExecuteReader();
        return reader.Read() ? Map(reader) : null;
    }

    public ApprovalDto Create(Guid missionId, string toolName, string input, string key)
    {
        var existing = FindByKey(key);
        if (existing is not null) return existing;

        var approval = new ApprovalDto(Guid.NewGuid(), missionId, toolName, input, ApprovalStatus.Pending, DateTimeOffset.UtcNow.Add(ApprovalLifetime));
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO approvals (Id, MissionId, ToolName, Input, Key, Status, ExpiresAt) VALUES (@id, @mission, @tool, @input, @key, @status, @expires)";
        command.Parameters.AddWithValue("@id", approval.Id.ToString());
        command.Parameters.AddWithValue("@mission", missionId.ToString());
        command.Parameters.AddWithValue("@tool", toolName);
        command.Parameters.AddWithValue("@input", input);
        command.Parameters.AddWithValue("@key", key);
        command.Parameters.AddWithValue("@status", approval.Status.ToString());
        command.Parameters.AddWithValue("@expires", SqliteDatabase.FormatTimestamp(approval.ExpiresAt));
        try
        {
            command.ExecuteNonQuery();
            return approval;
        }
        catch (SqliteException) when (existing is null)
        {
            return FindByKey(key) ?? approval;
        }
    }

    public ApprovalDto Approve(Guid id)
    {
        var approval = Get(id) ?? throw new KeyNotFoundException($"Approval {id} was not found.");
        if (approval.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            MarkStatus(id, ApprovalStatus.Expired);
            throw new InvalidOperationException("Approval has expired; request it again.");
        }
        return MarkStatus(id, ApprovalStatus.Granted);
    }

    public ApprovalDto Deny(Guid id)
    {
        _ = Get(id) ?? throw new KeyNotFoundException($"Approval {id} was not found.");
        return MarkStatus(id, ApprovalStatus.Denied);
    }

    private ApprovalDto MarkStatus(Guid id, ApprovalStatus status)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE approvals SET Status = @status WHERE Id = @id";
        command.Parameters.AddWithValue("@status", status.ToString());
        command.Parameters.AddWithValue("@id", id.ToString());
        command.ExecuteNonQuery();
        return Get(id)!;
    }

    /// <summary>Deletes approvals belonging to terminal missions. Returns the number of rows removed.</summary>
    public int ClearForTerminalMissions()
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            DELETE FROM approvals
            WHERE MissionId IN (
                SELECT Id FROM missions WHERE Status IN ('Completed', 'Failed', 'Cancelled')
            )
            """;
        return command.ExecuteNonQuery();
    }

    private static ApprovalDto Map(SqliteDataReader reader) => new(
        Guid.Parse(reader.GetString(0)),
        Guid.Parse(reader.GetString(1)),
        reader.GetString(2),
        reader.GetString(3),
        Enum.Parse<ApprovalStatus>(reader.GetString(4)),
        SqliteDatabase.ParseTimestamp(reader.GetString(5)));
}
