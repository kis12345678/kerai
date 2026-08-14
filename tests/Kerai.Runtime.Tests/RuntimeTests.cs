using Kerai.Contracts;
using Kerai.Runtime;
using Xunit;

namespace Kerai.Runtime.Tests;

public sealed class RuntimeTests
{
    [Fact]
    public void Mission_transitions_follow_runtime_policy()
    {
        var store = new InMemoryMissionStore();
        var mission = store.Create(new CreateMissionRequest("Inspect the project"));
        store.Transition(mission.Id, MissionStatus.Running);
        store.Transition(mission.Id, MissionStatus.Verifying);
        var completed = store.Transition(mission.Id, MissionStatus.Completed);
        Assert.Equal(MissionStatus.Completed, completed.Status);
    }

    [Fact]
    public void Terminal_mission_cannot_be_reopened()
    {
        var store = new InMemoryMissionStore();
        var mission = store.Create(new CreateMissionRequest("Inspect the project"));
        store.Transition(mission.Id, MissionStatus.Running);
        store.Transition(mission.Id, MissionStatus.Completed);
        Assert.Throws<InvalidOperationException>(() => store.Transition(mission.Id, MissionStatus.Running));
    }

    [Fact]
    public void Workspace_policy_rejects_escape_paths()
    {
        var policy = new WorkspacePolicy(Environment.CurrentDirectory);
        Assert.Throws<UnauthorizedAccessException>(() => policy.ValidateChildPath(Environment.CurrentDirectory, "..\\outside.txt"));
    }

    [Fact]
    public void Workspace_policy_allows_the_root_itself()
    {
        var policy = new WorkspacePolicy(Environment.CurrentDirectory);
        var root = policy.ValidateChildPath(Environment.CurrentDirectory, ".");
        Assert.Equal(Path.GetFullPath(Environment.CurrentDirectory), root);
    }

    [Fact]
    public void Workspace_policy_allows_nested_children()
    {
        var policy = new WorkspacePolicy(Environment.CurrentDirectory);
        var child = policy.ValidateChildPath(Environment.CurrentDirectory, "src\\Kerai.Server");
        Assert.StartsWith(Path.GetFullPath(Environment.CurrentDirectory) + Path.DirectorySeparatorChar, child);
    }

    [Fact]
    public void Tool_registry_requires_approval_for_writes()
    {
        var registry = new ToolRegistry();
        var write = registry.Get("filesystem.write");
        Assert.True(write.RequiresApproval);
        Assert.Equal(PermissionLevel.Modify, write.Risk);
    }
}
