# Contributing

Small contributions should name a concrete user behavior, its domain rule,
and evidence that it works. Changes to permissions, approval scope, evidence,
closure or persistence must include adversarial tests through the shared
service and affected interfaces. UI changes should include mobile and keyboard
checks. Use fictional fixtures and never include live auth URLs or private data.

Run `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`,
`npm run schema`, `npm run build`, and `npm run test:e2e`. Browser dependencies
are installed with `npx playwright install chromium`. Check the generated
OpenAPI diff when a schema changes.

For profile/session browser coverage, set
`NEXT_PUBLIC_SUPABASE_URL=https://accord-test.supabase.co` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-public-test-key` for both the build and
browser test commands, as CI does. These tests mock Auth and workspace requests;
no Supabase installation is needed. Without these settings the session tests skip.

Keep migrations additive after the first hosted release. Before a release,
back up and exercise restoration in an isolated installation. Review dependencies
with `npm audit`; do not accept an insecure version merely to preserve a test
tool API. This developer preview is maintained on a best-effort basis, without a support
SLA or promised release schedule. Focused issues and pull requests are welcome.
By submitting original code or documentation, you agree to license that
contribution under MIT. Preserve third-party notices and the separate brand policy.

Never bypass the command service by adding direct browser database writes.
Adapters must identify the external system's responsibility and preserve
uncertainty, actor attribution and explicit authority boundaries.

## Documentation

Canonical guides live in `docs/`; edit these rather than generated `public/` copies.
Update `src/domain/command-info.ts` alongside command validators and authorization
changes. Its descriptions are shared by MCP discovery, OpenAPI, and the generated
command reference/agent manifest. Keep examples fictional and match the runtime rules.

Run `npm run docs:generate` after edits, then `npm run docs:check`. Commit both canonical
sources and generated artifacts. CI checks freshness, links, route/permission coverage,
example validation, and Help accessibility. `prebuild` regenerates public docs for the
matching deployment. The generator uses an explicit publish allowlist and must never
read environment files, backups, workspace data, or private runtime configuration.

The static renderer supports headings, paragraphs, flat lists, tables, fenced code,
inline code, bold, and links. It escapes raw HTML and rejects unsupported link schemes.
Use this subset in published guides; update renderer checks when extending it. Help
must remain available before sign-in with no private API requests or client JavaScript.

## Disposable installation check

The `Disposable installation` workflow starts local Supabase on a GitHub-hosted
Docker runner, uses fictional credentials, exercises owner login and signup denial,
REST/MCP approval, private evidence and token revocation, and restores a backup into
a separate installation. It requires no repository secrets or hosted project.
The smoke script refuses non-loopback Supabase URLs and requires
`ACCORD_DISPOSABLE_SMOKE=true`. Never point it at an existing workspace.
