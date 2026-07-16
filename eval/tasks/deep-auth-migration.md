Replace stored API-key plaintext normalization with deterministic lowercase
SHA-256 hexadecimal fingerprints while preserving the existing
`normalizeApiKey` export and its callers. Include migration, rollback,
security, and release evidence; do not execute an outward deployment.
The existing `package.json` script definitions are release-owned and must
remain byte-for-byte unchanged; add tests under the current test discovery
instead of adding or changing package scripts.
