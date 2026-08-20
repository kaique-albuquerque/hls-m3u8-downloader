# Generic Parallel File Downloader Spec

## Objective

Build a generic HTTP/HTTPS file downloader for `npm run download:file` that:

- works for arbitrary files, not only media
- chooses a safe and efficient strategy automatically
- separates `concurrency` from `blockCount`
- supports partial files, retries, merge validation, and fallback
- exposes enough runtime diagnostics to explain failures

This spec targets the CLI first. Electron integration comes after the terminal flow is stable.

## Current State

Today the CLI can:

- prompt for URL, concurrency, destination, and file name
- attempt an initial probe
- fall back to sequential mode when metadata is missing
- download in temporary part files and merge them

Current gaps:

- no generic capability negotiation layer
- no planner module to compute `concurrency`, `blockCount`, and `minBlockSize`
- no per-part retry policy before aborting the whole job
- poor root-cause reporting when the first part fails
- no clear server profile classification
- no robust resume metadata for part-file mode

## Design Goals

1. Generic
   Must not depend on SourceForge, mirror-specific rules, or provider-specific hacks.

2. Safe fallback
   Failure to prove `Range` support must disable only multipart mode, not the entire download.

3. Predictable planning
   `concurrency`, `blockCount`, and `minBlockSize` must be derived explicitly, not implicitly mixed together.

4. Explainability
   The user must see why the planner picked a strategy and why a failure happened.

5. Reusable core
   The planner and capability resolver should be usable by the future Electron UI.

## Non-goals

- provider-specific logic
- bittorrent or metalink support
- browser automation for authenticated downloads
- Electron UI work in this phase

## Target Architecture

### 1. Probe Engine

Responsibility:

- collect best-effort metadata before download starts
- try multiple probe methods instead of one rigid path

Probe cascade:

1. `HEAD`
2. `GET` with `Range: bytes=0-0`
3. `GET` normal, capture headers only

Output shape:

```js
{
  finalUrl,
  contentLength,
  contentType,
  contentDisposition,
  acceptsRanges,
  etag,
  lastModified,
  probeMethod,
  metadataConfidence, // high | medium | low
}
```

### 2. Capability Resolver

Responsibility:

- classify the remote server based on probe results and runtime behavior

Profiles:

- `FULL_RANGE`
- `PARTIAL_METADATA`
- `NO_RANGE`
- `UNSTABLE_RANGE`
- `HOSTILE`

Rules:

- `FULL_RANGE`: known size + `206` + valid `Content-Range`
- `PARTIAL_METADATA`: downloadable but metadata incomplete
- `NO_RANGE`: `200` only or no `Range` support
- `UNSTABLE_RANGE`: `Range` initially works but later becomes inconsistent
- `HOSTILE`: repeated resets, 403s, anti-bot symptoms, or invalid headers

### 3. Download Planner

Responsibility:

- choose mode and internal parameters

Planner input:

```js
{
  totalBytes,
  capability,
  userConcurrency,
  userBlockCount,
  preset, // auto | conservative | aggressive | custom
}
```

Planner output:

```js
{
  mode,            // sequential | multipart
  concurrency,
  blockCount,
  minBlockSize,
  resume,
  rationale: [],
}
```

Core rules:

- `mode = sequential` if total size is unknown or capability is `NO_RANGE`
- `concurrency` controls simultaneous workers only
- `blockCount` controls total part files
- `minBlockSize` prevents pathological over-splitting

Recommended defaults:

- `minBlockSize = 8 MiB`
- `blockCount ≈ concurrency * 8`
- clamp `blockCount` by file size
- never generate more blocks than the file can sustain with `minBlockSize`

Presets:

- `auto`: balanced defaults
- `conservative`: lower concurrency, larger blocks
- `aggressive`: higher concurrency, more blocks
- `custom`: user overrides

### 4. Multipart Download Engine

Responsibility:

- download blocks into independent `.part` files
- validate each part before merge
- keep worker count separate from block count

Behavior:

- N workers
- M queued blocks
- workers fetch the next block when they finish
- no shared writes to the final file during transfer

### 5. Retry Policy

Responsibility:

- avoid aborting the whole job after a single transient part failure

Policy:

- each part gets `maxAttempts`
- retryable errors:
  - timeout
  - `ECONNRESET`
  - `EPIPE`
  - HTTP 429
  - HTTP 5xx
- non-retryable errors:
  - repeated invalid `Content-Range`
  - persistent 403 on same part
  - corrupted or mismatched part size after final retry

Suggested defaults:

- `maxAttempts = 3`
- exponential backoff per part
- jitter to avoid synchronized retries

Abort rules:

- abort entire job only when a part exceeds retry budget or capability degrades to `HOSTILE`

### 6. Merge Engine

Responsibility:

- validate all parts exist and have the expected size
- concatenate in exact order
- delete temp parts only after successful merge

Validation rules:

- every part file exists
- every part file matches expected byte length
- total merged bytes match expected total

### 7. Resume for Part Files

Responsibility:

- reuse fully completed `.part` files on rerun

State model:

- sidecar metadata referencing:
  - final URL
  - total size
  - validators (`etag`, `lastModified`)
  - part manifest

Rules:

- if validators changed, discard all part files
- if a part file size mismatches expected block size, discard that part only
- if metadata is unavailable, resume is allowed only in low-confidence mode with explicit warning

### 8. Observability

Responsibility:

- surface decisions and root-cause failures

Startup logs:

- capability profile
- selected mode
- concurrency
- block count
- minimum block size
- estimated part size

Failure logs:

- first failing part index
- request range
- HTTP status or socket error
- retry count
- final abort reason

Progress logs:

- completed parts / total parts
- active workers
- total bytes
- current speed

## CLI UX Changes

### Prompt flow

Current:

- URL
- connection choice
- destination
- file name

Target:

1. URL
2. mode preset
   - Auto
   - Conservative
   - Aggressive
   - Custom
3. concurrency choice
4. block count choice or auto
5. destination
6. file name

### Recommended prompt defaults

- preset default: `Auto`
- concurrency default: `8`
- block count default: `Auto`

### CLI messages

Example:

```text
[plan] Capability: FULL_RANGE
[plan] Mode: multipart
[plan] Concurrency: 16
[plan] Block count: 128
[plan] Min block size: 8 MiB
[plan] Estimated block size: 96 MiB
```

## Implementation Plan

### Phase 1: Planner and capability model

- add `src/cli/file-planner.js`
- add `src/transports/file-probe.js`
- add server capability classification
- use planner output in `download:file`

### Phase 2: Multipart engine hardening

- preserve separate `.part` files
- add per-part retries
- capture root-cause error from the first failed part
- only abort globally after retry exhaustion

### Phase 3: Merge and resume validation

- add manifest/sidecar for part-file mode
- validate existing parts on rerun
- validate merged size before success

### Phase 4: UX and diagnostics

- add preset prompt
- add optional manual block count prompt
- improve logs and summaries

### Phase 5: Electron reuse

- expose planner and probe modules cleanly
- integrate into Electron settings and job model only after CLI is stable

## Testing Strategy

### Unit

- planner decisions for multiple file sizes
- capability classification from synthetic probe results
- block count clamping with `minBlockSize`
- retry policy transitions

### Integration

- local HTTP server with:
  - working `Range`
  - broken `Range`
  - missing `Content-Length`
  - 429 / 5xx failures
  - invalid `Content-Range`

### Manual

- generic file URL with known `Range` support
- large file where parallel mode should outperform sequential
- unstable host where multipart should downgrade gracefully

## Success Criteria

- multipart mode never reports success with zero-byte output
- one failed part does not immediately cancel the whole job unless non-retryable
- planner output is visible and understandable
- generic file URLs work without provider-specific logic
- `npm run download:file` remains testable throughout the rollout
