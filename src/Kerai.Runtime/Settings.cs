using Kerai.Contracts;

namespace Kerai.Runtime;

public interface IKeraiSettings
{
    KeraiSettings Current { get; }
    void SetDefaultModel(string model);
    void SetWorkspaceRoot(string root);
}
