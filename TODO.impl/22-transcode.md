Status: DONE — implemented and verified this session.

# 22 — Format transcoding (desktop → web)

Priority: 3 (interface + gates delivered; actual conversion is a follow-up)

## Deliverable

- `src/installer/transcode.ts`: `Transcoder` interface `{ canConvert(from, to): boolean,
  convert(sourcePath, targetFormat, opts): Promise<string> }` + `TranscoderRegistry`.
- `FormatMatcher.canConvert` policy wired to the registry; font installer consults it when
  `formatSpec.format` differs from source format: license gate
  (`TranscodeLicenseNotAcceptedError`) first, then registry lookup; no transcoder
  registered → `UnsupportedTranscodeError` with guidance (desktop→web conversion planned).
- Installation strategy reporting via `FormatMatcher.installationStrategy`.

## Acceptance

- Spec: strategy reporting, license gate, UnsupportedTranscodeError raised with clear
  message; a fake transcoder registered in test converts and installs converted file.

## Future

- Real TTF/OTF → WOFF/WOFF2 converter (woff2 encodes with Brotli) as a registered transcoder
  module.
