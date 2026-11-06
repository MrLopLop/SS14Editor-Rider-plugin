# Changelog

## 1.0.1

- Go to definition from field names to the C# field or property, including
  inherited fields, and from a prototype's `type:` to its C# class.
- Hover over a prototype's `type:` shows its C# class.
- Go to definition finds `struct` and `record` types too.
- The schema format changed (version 2): it is rebuilt automatically on the
  first start.
- LocId fields show their translation instead of the key, the way Android
  Studio folds string resources; put the caret on one to see the key. The
  locale is set by `ss14editor.localization.displayLocale` (default `en-US`);
  **SS14: Toggle LocId folding** turns it off and on.
- Go to definition on a LocId jumps to its `.ftl` declaration, or lists one
  per locale; hover shows the text in every locale.

## 1.0.0

First release.

- Completion of component names, fields of components, data definitions and
  prototypes, enum and flag values, prototype types and `!type:` classes.
- Completion of prototype ids in `parent:` and prototype references, filtered
  by prototype kind, including engine prototypes.
- Completion of resource paths under `Resources/`.
- Hover with C# docs, type and default value for components, fields and
  `!type:` tags.
- Go to definition from prototype ids to their YAML declaration, and from
  component names and `!type:` tags to their C# class.
- Schema rebuilt automatically after the fork is rebuilt; prototype index
  updated on save.
- Status and error reasons in the **SS14 Editor** Output channel.
- Commands: **SS14: Rebuild schema**, **SS14: Rebuild prototype index**.
