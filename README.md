# SS14 Prototype Editor

Autocomplete, hover docs and go-to-definition for Space Station 14 YAML
prototypes, built from any SS14 fork's code.

## Features

- **Component names.** Completion after `- type:` lists every component your
  fork defines, including the ones only your fork has.
- **Fields.** Completion of field names inside a component, a nested data
  definition or the prototype itself (`entity`, `reagent` and every other
  prototype type). Fields already written in the block are not offered again.
- **Values.** Completion of `true`/`false`, enum and flag values, prototype
  types after the top-level `type:`, and the classes allowed after a `!type:`
  tag.
- **Prototype ids.** Completion of ids in `parent:` and in any field that
  references a prototype, filtered to the right kind: entities where an entity
  is expected, reagents where a reagent is expected. Engine prototypes from
  `RobustToolbox` are included.
- **Resource paths.** Completion of files and folders under `Resources/` in
  fields that take a resource path. New files show up right away.
- **Hover.** Hover over a component name, a field, a `!type:` tag or a
  prototype's `type:` to see its description from the C# docs, its type and
  its default value.
- **Go to definition.** Ctrl+Click or F12 on a prototype id jumps to the
  prototype's declaration; on a component name, a `!type:` tag or a
  prototype's `type:` it jumps to the C# class; on a field name it jumps to the
  C# field or property, in the base class when the field is inherited.
- **Localization.** A LocId key in a prototype shows as its translation, the
  way Android Studio folds string resources; put the caret on it to see and
  edit the key. Hover lists the text in every locale, and Ctrl+Click jumps to
  the `.ftl` declaration, or lists one per locale.
- **Stays current.** After you rebuild the fork, new components and fields
  appear without restarting VS Code. Saving a prototype file makes its ids
  available everywhere at once.

The extension never rewrites your files and never writes anything into the
fork folder.

## Getting started

1. Build your SS14 fork once (`dotnet build`), as you would to run it.
2. Open the fork's root folder in VS Code (the one with `RobustToolbox`,
   `Content.Server` and `Resources`).
3. Open any prototype file under `Resources/Prototypes/` and start typing.

There is nothing to configure. To fold LocId keys into another locale, set
`ss14editor.localization.displayLocale` (for example to `ru-RU`); a key it
lacks shows in `en-US`. The first start on a fork takes a little while;
later starts are fast.

If suggestions don't appear, open **View → Output** and pick **SS14 Editor**
in the dropdown: it says what the extension is waiting for, for example that
the fork needs a rebuild. Two commands in the Command Palette (Ctrl+Shift+P)
start things over:

- **SS14: Rebuild schema** re-reads components and fields from the built fork.
- **SS14: Rebuild prototype index** re-reads all prototype files.
- **SS14: Toggle LocId folding** shows LocId keys as written, or as their
  translation again.
