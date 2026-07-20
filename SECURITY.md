# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities — or privacy concerns about
published data — through public GitHub issues, discussions, or pull requests.

Email the maintainer instead at `security@kinresolve.com`. Include enough
detail to reproduce the issue (affected route or module, steps, expected
versus actual behavior), but never include real genealogy data: no GEDCOM
exports, DNA match files, credentials, or token-bearing URLs. Use synthetic
examples only.

You will receive an acknowledgement, and a fix or mitigation will be
coordinated privately before any public disclosure.

## Supported versions

Kin Resolve is pre-1.0 with a forward-only release policy: only the latest
release receives security fixes.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Scope notes

- The repository ships synthetic fixtures only; reports about the fictional
  demo data itself are not security issues.
- Self-hosted deployments are configured by their operators; issues caused by
  weakened local configuration (for example, disabling documented fail-closed
  guards) are out of scope unless the default configuration is affected.
