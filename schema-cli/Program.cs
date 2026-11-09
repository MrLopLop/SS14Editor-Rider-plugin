using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Content.Editor.Editor;

namespace Content.Editor;

/// <summary>
/// One-shot CLI that reads the compiled DLLs of a built SS14 fork and writes a
/// single <c>metadata.json</c> describing every prototype, component and
/// <c>[DataDefinition]</c> with their fields, defaults, enum values, XML docs
/// and inheritance flags.
///
/// All of the extraction is the vendored <see cref="MetadataExtractor"/> from
/// the predecessor editor (TheShuEd/SS14Editor@7dcf674). This entry point only
///   * resolves the fork's input DLLs and rejects unreadable ones,
///   * adds the two contract roots <c>schemaVersion</c> and
///     <c>sourceFingerprint</c> in front of the predecessor's
///     <c>MetadataRoot</c> shape, and
///   * skips the whole scan as a fast no-op when a sidecar fingerprint file
///     next to the output already matches the current input.
/// </summary>
public static class Program
{
    /// <summary>Bumped whenever the emitted document's shape changes.</summary>
    public const int SchemaVersion = 2;

    /// <summary>
    /// Sub-directories of <c>&lt;forkRoot&gt;/bin</c> the schema is built from —
    /// the upstream <c>OutputPath</c> convention. Named once so the resolver and
    /// the diagnostics can't drift apart.
    /// </summary>
    private static readonly string[] ContentBinDirs = { "Content.Server", "Content.Client" };

    public static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine(
                "usage: dotnet SS14Editor.SchemaCli.dll <forkRoot> <outputDir>\n" +
                "  <forkRoot>   built fork root holding bin/Content.Server and/or bin/Content.Client\n" +
                "  <outputDir>  directory to write metadata.json + metadata.fingerprint into");
            return 2;
        }

        var forkRoot = Path.GetFullPath(args[0]);
        var outputDir = Path.GetFullPath(args[1]);

        var binDirs = ContentBinDirs
            .Select(name => Path.Combine(forkRoot, "bin", name))
            .Where(Directory.Exists)
            .ToArray();
        var inputDlls = binDirs
            .SelectMany(dir => Directory.GetFiles(dir, "*.dll", SearchOption.TopDirectoryOnly))
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (inputDlls.Length == 0)
        {
            Console.Error.WriteLine(
                "error: no DLLs found under " +
                string.Join(" or ", ContentBinDirs.Select(n => $"'{Path.Combine(forkRoot, "bin", n)}'")) +
                " — build the fork first (dotnet build).");
            return 1;
        }

        // "нечитаемая сборка" acceptance path: the fork's own managed assemblies
        // (Content.*.dll) must parse as PE + metadata. Native side-by-side deps
        // (SDL2, openal, …) are not checked — the extractor skips them anyway.
        var unreadable = ManagedAssembliesThatFailToOpen(inputDlls);
        if (unreadable.Count > 0)
        {
            Console.Error.WriteLine("error: unreadable assembly:");
            foreach (var line in unreadable)
                Console.Error.WriteLine($"  {line}");
            return 1;
        }

        var fingerprint = ComputeSourceFingerprint(inputDlls);
        Directory.CreateDirectory(outputDir);
        var outputPath = Path.Combine(outputDir, "metadata.json");
        var fingerprintPath = Path.Combine(outputDir, "metadata.fingerprint");

        if (File.Exists(outputPath) && File.Exists(fingerprintPath) &&
            File.ReadAllText(fingerprintPath).Trim() == fingerprint)
        {
            Console.WriteLine($"metadata.json is up to date (fingerprint {fingerprint[..12]}…) — nothing to do.");
            return 0;
        }

        JsonObject extracted;
        var scratch = Directory.CreateTempSubdirectory("ss14-schema-cli-");
        try
        {
            // The vendored extractor derives bin/Content.{Server,Client} from
            // the root it is given and writes its own metadata.json there.
            MetadataExtractor.Extract(forkRoot, scratch.FullName);
            var producedPath = Path.Combine(scratch.FullName, "metadata.json");
            if (!File.Exists(producedPath))
            {
                Console.Error.WriteLine(
                    "error: extraction produced no metadata — the fork's DLLs could not be read.");
                return 1;
            }

            extracted = JsonNode.Parse(File.ReadAllText(producedPath))!.AsObject();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"error: schema extraction failed: {ex.Message}");
            return 1;
        }
        finally
        {
            try { scratch.Delete(recursive: true); } catch { /* best effort */ }
        }

        if (IsEmpty(extracted, "prototypes") && IsEmpty(extracted, "components") &&
            IsEmpty(extracted, "dataDefinitions"))
        {
            Console.Error.WriteLine(
                "error: extraction produced an empty schema — an input assembly is unreadable " +
                "or the fork is not built.");
            return 1;
        }

        // Contract = the two new roots, then MetadataRoot's own members verbatim.
        var schema = new JsonObject
        {
            ["schemaVersion"] = SchemaVersion,
            ["sourceFingerprint"] = fingerprint,
        };
        foreach (var property in extracted.ToArray())
        {
            extracted.Remove(property.Key);
            schema[property.Key] = property.Value;
        }

        File.WriteAllText(
            outputPath,
            schema.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        File.WriteAllText(fingerprintPath, fingerprint);

        Console.WriteLine(
            $"wrote {outputPath} from {inputDlls.Length} DLLs (fingerprint {fingerprint[..12]}…).");
        return 0;
    }

    private static bool IsEmpty(JsonObject root, string key) =>
        root[key] is not JsonObject obj || obj.Count == 0;

    /// <summary>
    /// Opens every <c>Content.*.dll</c> as a PE image and reads its metadata
    /// table. Returns a <c>"path (reason)"</c> line for each that a truncated
    /// or non-managed file would produce; an empty list means all are readable.
    /// </summary>
    private static List<string> ManagedAssembliesThatFailToOpen(string[] dllPaths)
    {
        var bad = new List<string>();
        foreach (var path in dllPaths)
        {
            if (!Path.GetFileName(path).StartsWith("Content.", StringComparison.Ordinal))
                continue;
            try
            {
                using var stream = File.OpenRead(path);
                using var pe = new PEReader(stream);
                if (!pe.HasMetadata)
                {
                    bad.Add($"{path} (not a managed assembly)");
                    continue;
                }
                _ = pe.GetMetadataReader();
            }
            catch (Exception ex)
            {
                bad.Add($"{path} ({ex.Message})");
            }
        }
        return bad;
    }

    /// <summary>
    /// SHA256 over <c>name|size|mtime</c> of every input DLL plus this CLI's
    /// own version and <see cref="SchemaVersion"/>. Uses file metadata rather than content hashes: MSBuild
    /// rewrites an output DLL on every rebuild, so size or last-write-time is
    /// enough to detect a change and is orders of magnitude cheaper for a
    /// fork with ~1000 DLLs. File name (not full path) keeps the value stable
    /// across checkouts.
    /// </summary>
    private static string ComputeSourceFingerprint(string[] dllPaths)
    {
        var sb = new StringBuilder();
        foreach (var path in dllPaths)
        {
            var info = new FileInfo(path);
            sb.Append(info.Name).Append('|')
              .Append(info.Length).Append('|')
              .Append(info.LastWriteTimeUtc.Ticks).Append('\n');
        }

        var version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0";
        sb.Append("cliVersion|").Append(version);
        // The document shape too: a CLI whose output changed shape without a
        // version bump must not be served a stale cache.
        sb.Append("\nschemaVersion|").Append(SchemaVersion);

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
