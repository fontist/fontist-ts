Status: DONE — implemented and verified this session.

# 42 — Port the font validator (`fontist validate`)

Priority: 2

## Deliverable

The install-health subsystem (Ruby `validation.rb` + `validator.rb` +
`validate_cli.rb`, ~590 lines):

- `src/validation/validationModels.ts`: `FontValidationResult` and
  `ValidationReport` as serialization-framework models (path/valid/
  family_name/full_name/error_message/time_taken/file_size/file_mtime;
  report adds generated_at/platform/summary stats and `calculateSummary`).
- `src/validation/validator.ts`: `Validator` with `validateAll` (sequential
  or bounded-parallel), `validateSingle` (FontFile parse with timing),
  report cache build/load against a JSON cache file with size+mtime reuse,
  platform naming, and font path scanning via the existing system scan.
- CLI: `fontist validate report --format text|yaml|json [--output FILE]
  [--parallel] [--verbose]` and `fontist validate cache [--rebuild]
  [--verbose]`, mirroring validate_cli.rb.
- Registry: note that Ruby has no validator spec file (lib-only
  subsystem); TS carries its own spec coverage.

## Acceptance

- `spec/validator.spec.ts`: valid/invalid font validation with error
  messages, timing fields, report summary math, cache build/reuse across
  Validator instances, text/yaml/json output, CLI commands with fake
  fonts.
