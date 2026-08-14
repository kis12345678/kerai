using Kerai.Contracts;
using Kerai.Runtime;
using Microsoft.Data.Sqlite;

namespace Kerai.Storage;

public sealed class SqliteEventBus(SqliteDatabase database) : IAgentEventBus
{
    private readonly object gate = new();
    private readonly List<Action<MissionEvent>> handlers = [];

    public void Publish(MissionEvent evt)
    {
        long sequence;
        using (var connection = database.Open())
        {
            using var command = connection.CreateCommand();
            command.CommandText = "INSERT INTO events (MissionId, Type, Message, OccurredAt) VALUES (@mission, @type, @message, @occurred)";
            command.Parameters.AddWithValue("@mission", evt.MissionId.ToString());
            command.Parameters.AddWithValue("@type", evt.Type);
            command.Parameters.AddWithValue("@message", evt.Message);
            command.Parameters.AddWithValue("@occurred", SqliteDatabase.FormatTimestamp(evt.OccurredAt));
            command.ExecuteNonQuery();
            using var idCommand = connection.CreateCommand();
            idCommand.CommandText = "SELECT last_insert_rowid()";
            sequence = (long)(idCommand.ExecuteScalar() ?? 0);
        }

        var sequenced = evt with { Sequence = sequence };
        lock (gate)
        {
            foreach (var handler in handlers.ToArray()) handler(sequenced);
        }
    }

    public IReadOnlyList<MissionEvent> Recent(int count)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, MissionId, Type, Message, OccurredAt FROM events ORDER BY Id DESC LIMIT @count";
        command.Parameters.AddWithValue("@count", count);
        using var reader = command.ExecuteReader();
        var list = new List<MissionEvent>();
        while (reader.Read()) list.Add(Map(reader));
        return list;
    }

    public IReadOnlyList<MissionEvent> Since(long lastId)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, MissionId, Type, Message, OccurredAt FROM events WHERE Id > @last ORDER BY Id";
        command.Parameters.AddWithValue("@last", lastId);
        using var reader = command.ExecuteReader();
        var list = new List<MissionEvent>();
        while (reader.Read()) list.Add(Map(reader));
        return list;
    }

    public void Subscribe(Action<MissionEvent> handler)
    {
        lock (gate) handlers.Add(handler);
    }

    /// <summary>Deletes the entire event trail. Returns the number of rows removed.</summary>
    public int ClearAll()
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM events";
        return command.ExecuteNonQuery();
    }

    private static MissionEvent Map(SqliteDataReader reader) => new(
        Guid.Parse(reader.GetString(1)),
        reader.GetString(2),
        reader.GetString(3),
        SqliteDatabase.ParseTimestamp(reader.GetString(4)),
        reader.GetInt64(0));
}
