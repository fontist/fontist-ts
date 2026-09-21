Status: DONE — implemented and verified this session.

# 4 — Declarative serialization framework

Priority: 1

## Deliverable

`src/serialization/` — the TS analogue of lutaml-model's `key_value` mapping (the npm registry
has no lutaml-model; the rule "never hand-roll serialization on models" is honored by making
the framework own ALL (de)serialization):

- `attributes.ts`: `attribute(name, type, { collection, default, renderNil })` descriptor
  registry per model class (string, integer, boolean, float, array of scalar, nested model).
- `keyValue.ts`: declarative mapping: YAML key ↔ attribute (`map(attr, { to: 'yaml_key' })`),
  collection rendering, `childMappings` (map keyed by name → instance attribute, as formulas'
  `resources` and indexes use), polymorphic models tagged by a `type` key with a registry.
- `model.ts`: `SerializableModel` base: `constructor(data?)`, `Model.fromYaml(str)`,
  `Model.fromYamlFile(path)`, `model.toYaml()`, `model.toYamlObject()`, `fromJson` equivalents.
  Unknown YAML keys are preserved (future-proofing).
- No model may define `toYaml`/`toYamlObject`-style methods itself — lint rule + review rule.

## Acceptance

- Round-trip spec: real v4 + v5 formula YAML → model → YAML → model equal (deep).
- `childMappings` round-trips `resources:` keyed blocks; polymorphic `import_source` tagged
  `type: macos|google|sil|windows` resolves to the right class both ways.
