using Kerai.Contracts;

namespace Kerai.Runtime;

/// <summary>
/// Read-only snapshot of the configured workspace — what the agent's
/// workspace.inspect tool and the Workspace page show. Never writes.
/// </summary>
public static class WorkspaceInspector
{
    private const int MaxTopEntries = 200;

    private static readonly string[] ManifestNames =
    [
        "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
        "requirements.txt", "composer.json", "pom.xml", "Gemfile"
    ];

    public static WorkspaceSummaryDto Build(string root)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            return Error(root, $"Workspace root does not exist: {root}");

        try
        {
            var entries = Directory.GetFileSystemEntries(root);
            var fileCount = 0;
            var directoryCount = 0;
            var top = new List<WorkspaceEntryDto>();

            foreach (var entry in entries
                         .OrderBy(e => Directory.Exists(e) ? 0 : 1)
                         .ThenBy(e => e, StringComparer.OrdinalIgnoreCase))
            {
                var isDirectory = Directory.Exists(entry);
                if (isDirectory) directoryCount++; else fileCount++;

                long size = 0;
                if (!isDirectory)
                {
                    try { size = new FileInfo(entry).Length; } catch { /* locked/vanished — keep 0 */ }
                }

                top.Add(new WorkspaceEntryDto(Path.GetFileName(entry), isDirectory, size));
                if (top.Count >= MaxTopEntries) break;
            }

            var hasGit = Directory.Exists(Path.Combine(root, ".git"));
            var hasSolution = Directory.EnumerateFiles(root, "*.sln", SearchOption.TopDirectoryOnly).Any();

            var manifests = new List<string>();
            foreach (var name in ManifestNames)
                if (File.Exists(Path.Combine(root, name))) manifests.Add(name);
            foreach (var project in Directory.EnumerateFiles(root, "*.csproj", SearchOption.TopDirectoryOnly).Take(3))
                manifests.Add(Path.GetFileName(project));

            var rootName = Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrEmpty(rootName)) rootName = root;

            return new WorkspaceSummaryDto(rootName, Path.GetFullPath(root), entries.Length, fileCount, directoryCount,
                hasGit, hasSolution, manifests, top);
        }
        catch (Exception ex)
        {
            return Error(root, ex.Message);
        }
    }

    private static WorkspaceSummaryDto Error(string root, string message) =>
        new(Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
            string.IsNullOrWhiteSpace(root) ? root : Path.GetFullPath(root),
            0, 0, 0, false, false, [], [], message);
}
