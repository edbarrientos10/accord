# Security reporting

Do not publish private workspace records, secrets or exploit evidence in public
issues. For the public developer preview, use GitHub's private vulnerability reporting:
https://github.com/edbarrientos10/accord/security/advisories/new.
If the reporting form is unavailable, do not open a public issue with exploit
details. Private reporting must be enabled and verified before announcing a release.
Reports are handled on a best-effort basis; there is no response SLA.

Supabase service credentials and server access are privileged. Application
approval controls cover only Accord's controlled interfaces. They cannot
prevent external actions by a runtime that has separate credentials.

This repository includes automated boundary checks but has not received an
independent security audit. See the hosted release gates before relying on
deployment-specific authentication, isolation or recovery claims.
