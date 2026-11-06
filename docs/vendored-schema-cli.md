# Vendored code: schema-extraction CLI

The C# under [`schema-cli/vendor/`](../schema-cli/vendor/) and the xUnit tests
under [`schema-cli/tests/`](../schema-cli/tests/) are a **vendor copy** taken
from the predecessor editor:

- **Source:** [`TheShuEd/SS14Editor`](https://github.com/TheShuEd/SS14Editor)
- **Commit:** [`7dcf674b4e5d09b0c5a5bd5fbe309b373e6dce50`](https://github.com/TheShuEd/SS14Editor/commit/7dcf674b4e5d09b0c5a5bd5fbe309b373e6dce50)
- **License:** MIT (same as this repo)

Per-file provenance headers are deliberately **not** added; this note is the
single record of origin.

## What was copied

| This repo | Predecessor path | Change |
|---|---|---|
| `schema-cli/vendor/MetadataExtractor.cs`  | `src/Metadata/MetadataExtractor.cs`  | verbatim |
| `schema-cli/vendor/FieldExtractor.cs`     | `src/Metadata/FieldExtractor.cs`     | verbatim + `DeclaringTypeName` (see below) |
| `schema-cli/vendor/CtorDefaultsScanner.cs`| `src/Metadata/CtorDefaultsScanner.cs`| verbatim |
| `schema-cli/vendor/XmlDocReader.cs`       | `src/Metadata/XmlDocReader.cs`       | verbatim |
| `schema-cli/vendor/MetadataModels.cs`     | `src/Metadata/MetadataModels.cs`     | verbatim + `FieldMetadata.DeclaringType` (see below) — the `MetadataRoot` contract |
| `schema-cli/vendor/Logger.cs`             | `src/Core/Logger.cs`                 | verbatim — the only support dependency of the extractors |
| `schema-cli/tests/*.cs`, `schema-cli/tests/Fixtures/*.cs` | `tests/ss14-editor.Tests/{MetadataExtractor,FieldExtractor,CtorDefaultsScanner,XmlDocReader}Tests.cs`, `TempDir.cs`, `Fixtures/{FixtureTypes,RuntimeHandleStubs}.cs` | verbatim (except `DeclaringTypeTests.cs`, which is this repo's own) |

The vendored `.cs` files are unmodified byte-for-byte, except for the change
listed under "Local changes" below (it touches `FieldExtractor.cs` and
`MetadataModels.cs`). Only the project files
(`.csproj`), the `InternalsVisibleTo` shim and the entry point
(`schema-cli/Program.cs`) are new. The spec envisaged a ~30-line entry point;
the actual ~110 lines are that core plus the spec-required `sourceFingerprint`
helper, the unreadable-assembly checks and the argument/error handling.

## Local changes

- **`FieldMetadata.DeclaringType`** (schema version 2) — the full name of the
  class whose source declares the field: a base class for an inherited field,
  the open generic definition (`NS.Base`1`) for a member of a closed generic
  base, `NS.Outer+Inner` for a nested class. Go-to-definition on a field key
  uses it to find the member in C# source. Filled by
  `FieldExtractor.DeclaringTypeName`; tested in
  `schema-cli/tests/DeclaringTypeTests.cs`.

## What was NOT copied

Explicitly left behind (out of scope for this repo, see issue #22 / spec #20):

- the file-watcher service,
- the HTTP server and `/api/*` models (`ApiModels.cs`, `RedactorContext.cs`,
  `PathSecurity.cs`, `EditorServer`, …),
- all `Services/`,
- the YAML prototype index (rewritten from scratch in TypeScript by later
  tickets),
- the Electron shell and the `WebUI/`.

Their tests (`ApiRouterTests`, `ProtoIndexServiceTests`,
`YamlPrototypeScannerTests`, `FileTreeServiceTests`, `SourceLocatorTests`,
`PathSecurityTests`, …) were not brought over.

## Contract addition

The predecessor's `MetadataRoot` is used as-is, apart from the one field added
under "Local changes" (`FieldMetadata.DeclaringType`). `Program.cs` wraps the
extractor's output with two extra root fields before writing it:

- `schemaVersion` (int) — bumped when the emitted document's shape changes,
- `sourceFingerprint` (string) — SHA-256 over `path|size|mtime` of every input
  DLL plus the CLI's own version and `schemaVersion`.
