#! /usr/bin/env dotnet
#:property Nullable=enable
#:property PublishAOT=false
#:package ArcaneLibs@1.0.1-preview.2026*

using System.Diagnostics;
using ArcaneLibs;
using System.Text.Json;

#region Sync package versions for CDN worker

{
    Console.WriteLine("==> Ensuring CDN worker dependencies are in sync...");
    var origContent = await File.ReadAllTextAsync("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q16-HDRI.x86_64.csproj");
    var depToReplace = "Magick.NET-Q16-HDRI-OpenMP-x64";
    (string Project, string Dependency)[] replaceTargets = [
        // ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q16-HDRI.x86_64.csproj", "Magick.NET-Q16-HDRI-OpenMP-x64"), // source
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q16.x86_64.csproj", "Magick.NET-Q16-OpenMP-x64"),
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q8.x86_64.csproj", "Magick.NET-Q8-OpenMP-x64"),
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q16-HDRI.aarch64.csproj", "Magick.NET-Q16-HDRI-OpenMP-arm64"),
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q16.aarch64.csproj", "Magick.NET-Q16-OpenMP-arm64"),
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q8.aarch64.csproj", "Magick.NET-Q8-OpenMP-arm64"),
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q16-HDRI.AnyCPU.csproj", "Magick.NET-Q16-HDRI-AnyCPU"),
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q16.AnyCPU.csproj", "Magick.NET-Q16-AnyCPU"),
        ("Spacebar.Cdn.Worker/Spacebar.Cdn.Worker.Q8.AnyCPU.csproj", "Magick.NET-Q8-AnyCPU"),
    ];

    foreach (var target in replaceTargets) {
        Console.WriteLine($"  ==> {target.Project} -> {target.Dependency}");
        await File.WriteAllTextAsync(target.Project, origContent.Replace(depToReplace, target.Dependency));
    }
}

#endregion

Console.WriteLine("==> Getting outputs...");
var outNames = JsonSerializer
    .Deserialize<string[]>(Util.GetCommandOutputSync("nix", $"eval --json .#packages.x86_64-linux --apply builtins.attrNames", silent: true, stderr: false))!
    .Where(o => args.Length == 0 || args.Select(x => x.Replace('.', '-')).Any(o.Contains)).ToArray();

Console.WriteLine($"==> Updating dependencies for {outNames.Length} projects...");

#region Dependency resolution

var sortSw = Stopwatch.StartNew();
Console.WriteLine($"==> Sorting projects by dependencies...");
Console.WriteLine($"  ==> Getting project references...");
(string Name, string[] References)[] byName = await Task.WhenAll(outNames
    .Select(async x => {
        await Task.Delay(Random.Shared.Next(outNames.Length));
        var refJson = Util.GetCommandOutputSync("nix", $"eval --json .#packages.x86_64-linux.{x}.passthru.__sbDmProjectRefs.names", silent: true, stderr: false);
        var references = string.IsNullOrEmpty(refJson) ? [] : JsonSerializer.Deserialize<string[]>(refJson)!.Select(x => x.Replace('.', '-')).ToArray();
        if (references.Length > 0)
            Console.WriteLine($"    ==> Got {references.Length} project references for {x}");
        // Console.WriteLine($"    ==> Got {references.Length} project references for {x}: {string.Join(", ", references)}");
        return (x, references);
    }).ToList());

Console.WriteLine($"  ==> Mapping to tree nodes...");
// create nodes first
var deps = byName.Select(x => new ProjectDependencyNode() {
    Name = x.Name,
    References = []
}).ToArray();

// actually fill in references
foreach (var d in deps) {
    d.References = deps.Where(x => byName.First(bn => bn.Name == d.Name).References.Contains(x.Name)).ToArray();
    Console.WriteLine($"    ==> {d.Name} => {string.Join(", ", d.References.Select(x => x.GetShortName()))}");
}

Console.WriteLine($"  ==> Sorting...");

deps = deps.OrderBy(x => x.GetDepth()).ThenBy(x => x.GetWeight()).ThenBy(x => x.Name).ToArray();
foreach (var d in deps) {
    // just a nice thing when debugging
    d.References = d.References.OrderBy(x => x.GetDepth()).ThenBy(x => x.GetWeight()).ThenBy(x => x.Name).ToArray();
    Console.WriteLine($"    ==> {d.GetNameWithWeights()} => {string.Join(", ", d.References.Select(x => $"{x.GetNameWithWeights(true)}"))}");
}

Console.WriteLine($"  ==> Sorted dependency tree with {deps.Length} projects in {sortSw.Elapsed}");

#endregion

var maxNameLength = deps.Max(x => x.Name.Length);

foreach (var depthGroup in deps.GroupBy(x => x.GetDepth())) {
    var tasks = depthGroup.Index().Select(indexedOutpEnt => Task.Run(async () => {
        var (idx, outpEnt) = indexedOutpEnt;
        var outp = outpEnt.Name;
        var prefix = ConsoleUtils.ColoredString(
            $"{outpEnt.GetDepth():00}.{idx:00}({outpEnt.GetWeight():000}) {outpEnt.Name.PadRight(maxNameLength)}>",
            (byte)((outp.GetHashCode() >> 16) & 0xff),
            (byte)((outp.GetHashCode() >> 8) & 0xff),
            (byte)(outp.GetHashCode() & 0xff)
        );
        Console.WriteLine(prefix + ConsoleUtils.ColoredString($"  ==> Updating {outp}...", 0x80, 0x80, 0xff));

        var rootDir = outpEnt.GetRelativeRootDir();
        var depsFile = outpEnt.GetDepsFile();
        if (depsFile is null) {
            Console.WriteLine(prefix + ConsoleUtils.ColoredString($"      ==> No __nugetDeps attribute, skipping!", 0xff, 0x80, 0x80));
            return;
        }

        Console.WriteLine(
            prefix
            + ConsoleUtils.ColoredString($"    ==> Got project root directory: ", 0x80, 0xff, 0xff)
            + ConsoleUtils.ColoredString($"{rootDir}", 0x80, 0xff, 0xff)
            + " - "
            + ConsoleUtils.ColoredString($"{depsFile.Value.StorePath.Replace(depsFile.Value.Name, "")}", 0x80, 0x80, 0xff)
            + ConsoleUtils.ColoredString($"{depsFile.Value.Name}", 0x80, 0xff, 0x80)
            + (File.Exists(depsFile.Value.LocalPath)
                ? ConsoleUtils.ColoredString($" (exists)", 0x80, 0xff, 0x80)
                : ConsoleUtils.ColoredString($" (does not exist)", 0xf, 0x80, 0x80))
        );

        if (!File.Exists(depsFile.Value.LocalPath)) {
            Console.WriteLine(prefix + ConsoleUtils.ColoredString($"      ==> No NuGet deps file, skipping!", 0xff, 0x80, 0x80));
            return;
        }

        Console.WriteLine(prefix + ConsoleUtils.ColoredString($"      ==> Building fetch-deps script...", 0x80, 0xff, 0x80));
        var fname = outpEnt.GetDepsUpdateScript();

        Console.WriteLine(prefix + ConsoleUtils.ColoredString($"      ==> Running fetch-deps script, writing into {depsFile.Value.LocalPath}...", 0x80, 0xff, 0x80));
        RunCommandSync(fname, depsFile.Value.LocalPath);

        var resolvedDeps = JsonSerializer.Deserialize<object[]>(await File.ReadAllTextAsync(depsFile.Value.LocalPath));
        Console.WriteLine(prefix + ConsoleUtils.ColoredString($"      ==> Locked {resolvedDeps.Length} dependencies!",
            (byte)(resolvedDeps.Length == 0 ? 0xff : 0x80),
            (byte)(resolvedDeps.Length == 0 ? 0x80 : 0xff),
            0x80
        ));
        RunCommandSync("nix", $"run nixpkgs#git -- add {depsFile.Value.LocalPath}");
    })).ToList();

    await Task.WhenAll(tasks);
}

static void RunCommandSync(string command, string args = "", bool silent = false) {
    // Console.WriteLine($"Executing command (silent: {silent}): {command} {args}");
    Util.RunCommandSync(command, args, silent);
}

public class ProjectDependencyNode : IComparable {
    public required string Name;
    public required ProjectDependencyNode[] References;

    public int GetDepth() {
        if (References.Length == 0) return 0;
        return References.Max(x => x.GetDepth()) + 1;
    }

    public int GetWeight() {
        if (References.Length == 0) return 1;
        return References.Sum(x => x.GetWeight()) + 1;
    }

    public string GetNameWithWeights(bool compact = false) =>
        compact
            ? $"{GetShortName()}:{GetDepth()}w{GetWeight()}"
            : $"{Name} @ {GetDepth()} | {GetWeight()}";

    public string GetShortName() => Name.Replace("Spacebar-", "Sb-")
        .Replace("-Models-", "-Mdl-")
        .Replace("-Interop-", "-Intp-")
        .Replace("-Replication-", "-Rpl-")
        .Replace("-Authentication-", "-Auth-");

    public string GetRelativeRootDir() => JsonSerializer
        .Deserialize<string>(Util.GetCommandOutputSync("nix", $"eval --json .#packages.x86_64-linux.{Name}.srcRoot", silent: true, stderr: false))!
        .Split("/extra/admin-api/", 2)[1];

    public string GetDepsUpdateScript() => Util.GetCommandOutputSync("nix", $"build .#{Name}.passthru.fetch-deps --no-link --print-out-paths", stderr: false);

    public (string Name, string StorePath, string LocalPath)? GetDepsFile() {
        var storePath = JsonSerializer.Deserialize<string>(Util.GetCommandOutputSync("nix", $"eval --json .#packages.x86_64-linux.{Name}.passthru.__nugetDeps", silent: true,
            stderr: false));
        return storePath == null
            ? null
            : (
                new FileInfo(storePath).Name,
                storePath,
                Path.Combine(GetRelativeRootDir(), new FileInfo(storePath).Name)
            );
    }

    public int CompareTo(object? obj) => References.Any(x => x.Name == Name) ? 1 : 0;
}