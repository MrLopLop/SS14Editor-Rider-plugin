# SS14Editor

Плагин VS Code для редактирования YAML-прототипов в форках SS14 на движке RobustToolbox.

## Language

**ResPath**:
Движковый C#-тип пути к файлу под `Resources/`. Поле, напрямую типизированное `ResPath`, — не то же самое, что поле типа `SpriteSpecifier`/`SoundSpecifier`, даже если оно тоже в итоге хранит путь: диспетчеризация по объявленному типу видит только первое.
_Avoid_: "путь к ресурсу" как общий термин без уточнения, обёрнут он в специфаер или нет.

**SpriteSpecifier / SoundSpecifier**:
Полиморфные (union) C#-типы-обёртки над `ResPath`: `SpriteSpecifier` — RSI+состояние либо голая текстура; `SoundSpecifier` — путь к файлу (`SoundPathSpecifier`) либо ссылка на `soundCollection`-прототип (`SoundCollectionSpecifier`). Классифицируются как единый непрозрачный вид — вложенные `ResPath`/`string`-поля внутри них не видны дженерик-диспетчеризации по типу.
_Avoid_: путать с `ResPath` — поле типа `SpriteSpecifier` не значит "поле типа ResPath".

**LocId**:
Движковый C#-тип ключа локализации (`Robust.Shared.Localization.LocId`). Схема отдаёт его как `fieldKind: text`; от обычной строки его отличает только `fullType`. Ключ — id Fluent-сообщения (`key`) или его атрибута (`key.attr`) в `.ftl`-файлах.
_Avoid_: считать LocId-ом `name`/`description` сущности — это обычные строки, которые переводит отдельный скрипт через ключи `ent-<Id>`.

**Locale**:
Папка первого уровня под `Resources/Locale/` (или `RobustToolbox/Resources/Locale/`): `en-US`, `ru-RU`, … Локаль отображения (`ss14editor.localization.displayLocale`) — та, в чей текст сворачивается LocId-ключ; если в ней ключа нет, берётся `en-US`.
