using Kerai.Contracts;
using Kerai.Runtime;
using Microsoft.Data.Sqlite;

namespace Kerai.Storage;

public sealed class SqliteMissionStore(SqliteDatabase database) : IMissionStore
{
    public MissionDto Create(CreateMissionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Goal)) throw new ArgumentException("Goal is required.", nameof(request));
        var now = DateTimeOffset.UtcNow;
        var lane = Kerai.Runtime.AgentLanes.Normalize(request.Lane);
        var mission = new MissionDto(Guid.NewGuid(), request.Goal.Trim(), MissionStatus.Created, now, now, request.WorkspacePath, lane, ParentMissionId: request.ParentMissionId);
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO missions (Id, Goal, Status, CreatedAt, UpdatedAt, WorkspacePath, Result, Error, Lane, ParentMissionId) VALUES (@id, @goal, @status, @created, @updated, @workspace, NULL, NULL, @lane, @parent)";
        command.Parameters.AddWithValue("@id", mission.Id.ToString());
        command.Parameters.AddWithValue("@goal", mission.Goal);
        command.Parameters.AddWithValue("@status", mission.Status.ToString());
        command.Parameters.AddWithValue("@created", SqliteDatabase.FormatTimestamp(mission.CreatedAt));
        command.Parameters.AddWithValue("@updated", SqliteDatabase.FormatTimestamp(mission.UpdatedAt));
        command.Parameters.AddWithValue("@workspace", (object?)mission.WorkspacePath ?? DBNull.Value);
        command.Parameters.AddWithValue("@lane", mission.Lane.ToString());
        command.Parameters.AddWithValue("@parent", (object?)mission.ParentMissionId?.ToString() ?? DBNull.Value);
        command.ExecuteNonQuery();
        return mission;
    }

    public MissionDto? Get(Guid id)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Goal, Status, CreatedAt, UpdatedAt, WorkspacePath, Result, Error, Lane, ParentMissionId FROM missions WHERE Id = @id";
        command.Parameters.AddWithValue("@id", id.ToString());
        using var reader = command.ExecuteReader();
        return reader.Read() ? Map(reader) : null;
    }

    public IReadOnlyCollection<MissionDto> List()
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Goal, Status, CreatedAt, UpdatedAt, WorkspacePath, Result, Error, Lane, ParentMissionId FROM missions ORDER BY UpdatedAt DESC";
        using var reader = command.ExecuteReader();
        var list = new List<MissionDto>();
        while (reader.Read()) list.Add(Map(reader));
        return list;
    }

    public MissionDto Transition(Guid id, MissionStatus next)
    {
        while (true)
        {
            var current = Get(id) ?? throw new KeyNotFoundException($"Mission {id} was not found.");
            if (!MissionTransitions.IsAllowed(current.Status, next))
                throw new InvalidOperationException($"Cannot transition mission from {current.Status} to {next}.");

            var now = DateTimeOffset.UtcNow;
            using var connection = database.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "UPDATE missions SET Status = @next, UpdatedAt = @now WHERE Id = @id AND Status = @current";
            command.Parameters.AddWithValue("@next", next.ToString());
            command.Parameters.AddWithValue("@now", SqliteDatabase.FormatTimestamp(now));
            command.Parameters.AddWithValue("@id", id.ToString());
            command.Parameters.AddWithValue("@current", current.Status.ToString());
            if (command.ExecuteNonQuery() > 0) return current with { Status = next, UpdatedAt = now };

            Thread.Sleep(10); // concurrent writer — re-read and retry
        }
    }

    public MissionDto SetResult(Guid id, string? result, string? error)
    {
        var current = Get(id) ?? throw new KeyNotFoundException($"Mission {id} was not found.");
        if (current.Status is MissionStatus.Completed or MissionStatus.Failed or MissionStatus.Cancelled)
            throw new InvalidOperationException($"Mission {id} is already in a terminal state.");

        var now = DateTimeOffset.UtcNow;
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE missions SET Result = @result, Error = @error, UpdatedAt = @now WHERE Id = @id";
        command.Parameters.AddWithValue("@result", (object?)result ?? DBNull.Value);
        command.Parameters.AddWithValue("@error", (object?)error ?? DBNull.Value);
        command.Parameters.AddWithValue("@now", SqliteDatabase.FormatTimestamp(now));
        command.Parameters.AddWithValue("@id", id.ToString());
        command.ExecuteNonQuery();
        return current with { Result = result, Error = error, UpdatedAt = now };
    }

    /// <summary>Deletes all terminal missions (Completed/Failed/Cancelled); active missions are kept.</summary>
    public int ClearTerminal()
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM missions WHERE Status IN ('Completed', 'Failed', 'Cancelled')";
        return command.ExecuteNonQuery();
    }

    public MissionDto? ClaimNext()
    {
        var now = DateTimeOffset.UtcNow;
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE missions SET Status = 'Running', UpdatedAt = @now
            WHERE Id = (
                SELECT Id FROM missions
                WHERE Status = 'Created'
                   OR (Status = 'WaitingForApproval'
                       AND EXISTS (SELECT 1 FROM approvals a
                                   WHERE a.MissionId = missions.Id
                                     AND a.Status = 'Granted'
                                     AND a.ExpiresAt > @now))
                ORDER BY CASE WHEN Status = 'Created' THEN 0 ELSE 1 END, CreatedAt
                LIMIT 1
            )
            RETURNING Id, Goal, Status, CreatedAt, UpdatedAt, WorkspacePath, Result, Error, Lane, ParentMissionId
            """;
        command.Parameters.AddWithValue("@now", SqliteDatabase.FormatTimestamp(now));
        using var reader = command.ExecuteReader();
        return reader.Read() ? Map(reader) : null;
    }

    private static MissionDto Map(SqliteDataReader reader) => new(
        Guid.Parse(reader.GetString(0)),
        reader.GetString(1),
        Enum.Parse<MissionStatus>(reader.GetString(2)),
        SqliteDatabase.ParseTimestamp(reader.GetString(3)),
        SqliteDatabase.ParseTimestamp(reader.GetString(4)),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        Enum.Parse<MissionLane>(reader.GetString(8)),
        reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetString(7),
        reader.IsDBNull(9) ? null : Guid.Parse(reader.GetString(9)));
}
