# Sentinel's Security Journal

## 2026-08-17 - Unsanitized Output Path in IPC Log Export Vulnerable to Arbitrary File Write
**Vulnerability:** The `app:export-logs` Electron IPC channel accepted an arbitrary user-supplied `path` string without path traversal checking or root directory restriction.
**Learning:** IPC handlers in Electron that accept file output paths must validate that paths are safe absolute paths constrained to permitted application directory roots.
**Prevention:** Use `isSafeAbsolutePath` and `isPathWithin` against allowed directory roots for all IPC handlers that write files.
