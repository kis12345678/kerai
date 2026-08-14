using Microsoft.Data.Sqlite;

namespace Kerai.Storage;

/// <summary>
/// Shared SQLite database (data/kerai.db) with WAL so the API server and the
/// execution worker read and write the same state concurrently from two processes.
/// </summary>
public sealed class SqliteDatabase
{
    private readonly string connectionString;

    public SqliteDatabase(string? dataDirectory = null)
    {
        var directory = Path.GetFullPath(
            dataDirectory ?? Environment.GetEnvironmentVariable("KERAI_DATA_DIR")
            ?? Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data"));
        Directory.CreateDirectory(directory);
        var dbPath = Path.Combine(directory, "kerai.db");
        connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
        }.ToString();

        using var connection = Open();
        Initialize(connection);
    }

    public SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    private static void Initialize(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            CREATE TABLE IF NOT EXISTS missions (
                Id TEXT PRIMARY KEY,
                Goal TEXT NOT NULL,
                Status TEXT NOT NULL,
                CreatedAt TEXT NOT NULL,
                UpdatedAt TEXT NOT NULL,
                WorkspacePath TEXT NULL,
                Result TEXT NULL,
                Error TEXT NULL,
                Lane TEXT NOT NULL DEFAULT 'Master',
                ParentMissionId TEXT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                MissionId TEXT NOT NULL,
                Type TEXT NOT NULL,
                Message TEXT NOT NULL,
                OccurredAt TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_id ON events(Id);
            CREATE TABLE IF NOT EXISTS approvals (
                Id TEXT PRIMARY KEY,
                MissionId TEXT NOT NULL,
                ToolName TEXT NOT NULL,
                Input TEXT NOT NULL,
                Key TEXT NOT NULL UNIQUE,
                Status TEXT NOT NULL,
                ExpiresAt TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_approvals_mission ON approvals(MissionId);
            CREATE TABLE IF NOT EXISTS settings (
                Key TEXT PRIMARY KEY,
                Value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS automations (
                Id TEXT PRIMARY KEY,
                Label TEXT NOT NULL,
                Prompt TEXT NOT NULL,
                Frequency TEXT NOT NULL,
                IntervalMinutes INTEGER NULL,
                DailyAt TEXT NULL,
                Enabled INTEGER NOT NULL,
                CreatedAt TEXT NOT NULL,
                LastFiredAt TEXT NULL,
                MissionCount INTEGER NOT NULL DEFAULT 0
            );
            """;
        command.ExecuteNonQuery();

        // Migrations for databases created by older builds.
        using (var check = connection.CreateCommand())
        {
            check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('missions') WHERE name = 'Lane'";
            if ((long)(check.ExecuteScalar() ?? 0) == 0)
            {
                using var alter = connection.CreateCommand();
                alter.CommandText = "ALTER TABLE missions ADD COLUMN Lane TEXT NOT NULL DEFAULT 'Master'";
                alter.ExecuteNonQuery();
            }
        }
        using (var check = connection.CreateCommand())
        {
            check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('missions') WHERE name = 'ParentMissionId'";
            if ((long)(check.ExecuteScalar() ?? 0) == 0)
            {
                using var alter = connection.CreateCommand();
                alter.CommandText = "ALTER TABLE missions ADD COLUMN ParentMissionId TEXT NULL";
                alter.ExecuteNonQuery();
            }
        }
    }

    public static DateTimeOffset ParseTimestamp(string value) => DateTimeOffset.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
    public static string FormatTimestamp(DateTimeOffset value) => value.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
}
