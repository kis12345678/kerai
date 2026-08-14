using Kerai.Contracts;
using Kerai.Runtime;

namespace Kerai.Storage;

public sealed class SqliteSettingsStore : IKeraiSettings
{
    private readonly SqliteDatabase database;
    private readonly object gate = new();
    private readonly string fallbackRoot;
    private KeraiSettings settings = null!;

    public SqliteSettingsStore(SqliteDatabase database, string? defaultWorkspaceRoot = null)
    {
        this.database = database;
        fallbackRoot = Path.GetFullPath(defaultWorkspaceRoot ?? Environment.CurrentDirectory);
        Load();
    }

    public KeraiSettings Current
    {
        get
        {
            lock (gate) return settings;
        }
    }

    private void Load()
    {
        var model = GetValue("DefaultModel");
        var root = GetValue("WorkspaceRoot");
        settings = new KeraiSettings(
            string.IsNullOrWhiteSpace(model) ? "gpt-oss-agent:latest" : model,
            string.IsNullOrWhiteSpace(root) ? fallbackRoot : root);
    }

    public void SetDefaultModel(string model)
    {
        if (string.IsNullOrWhiteSpace(model)) throw new ArgumentException("Model is required.");
        lock (gate)
        {
            settings = settings with { DefaultModel = model.Trim() };
            SetValue("DefaultModel", settings.DefaultModel);
        }
    }

    public void SetWorkspaceRoot(string root)
    {
        if (string.IsNullOrWhiteSpace(root)) throw new ArgumentException("Workspace root is required.");
        var full = Path.GetFullPath(root);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException(full);
        lock (gate)
        {
            settings = settings with { WorkspaceRoot = full };
            SetValue("WorkspaceRoot", settings.WorkspaceRoot);
        }
    }

    private string? GetValue(string key)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Value FROM settings WHERE Key = @key";
        command.Parameters.AddWithValue("@key", key);
        return command.ExecuteScalar() as string;
    }

    private void SetValue(string key, string value)
    {
        using var connection = database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO settings (Key, Value) VALUES (@key, @value) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value";
        command.Parameters.AddWithValue("@key", key);
        command.Parameters.AddWithValue("@value", value);
        command.ExecuteNonQuery();
    }
}
