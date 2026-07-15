Replace stored API-key plaintext normalization with deterministic lowercase
SHA-256 hexadecimal fingerprints while preserving the existing
`normalizeApiKey` export and its callers. Include migration, rollback,
security, and release evidence; do not execute an outward deployment.
