# ADR 0003: protected asset read boundary

Status: accepted.

Stored media type is provenance, not permission to execute content in the Shadow Life origin. The protected
original endpoint therefore always responds as `application/octet-stream` with attachment disposition. It
preserves the declared type in metadata for export and download naming, but never uses that value as an inline
browser decoder instruction.

Inline preview is a separate endpoint with an explicit passive-media allowlist. HTML, SVG, XML, PDF and any
unknown media type have no inline preview; clients download the protected original or use a future isolated
processor. Raster image, supported audio/video and plain-text previews use their exact allowlisted media type.

Both endpoints authorize every request before reading bytes and return `private, no-store`, `nosniff`,
same-origin resource policy, no-referrer policy and a sandboxed deny-by-default CSP. This lets a later grant
revocation take effect for future requests. It does not claim that bytes already downloaded to a user device
can be remotely revoked.
