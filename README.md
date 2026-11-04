# Accord

**A self-hosted workspace for you and your AI agents.** Accord coordinates projects, tasks, next actions, authority,
and evidence across a person and their agents. It provides a responsive web
workspace, a REST command API, and a runtime-independent MCP endpoint.

This is a developer preview, maintained on a best-effort basis. Local checks do not establish hosted
readiness or real-world usefulness. See [validation status](docs/validation.md).

![Accord fictional task workspace](output/playwright/tasks-desktop.png)

## Learn to use Accord

- [Help index](docs/index.md): choose a guide for your role.
- [User guide](docs/user-guide.md): daily work, decisions, People, agents, and logs.
- [Agent guide](docs/agent-guide.md): connect through REST/MCP and act within permissions.
- [Command reference](docs/commands.md), [OpenAPI](docs/openapi.json), and [agent manifest](docs/agent-manifest.json).
- [Troubleshooting](docs/troubleshooting.md): sign-in, access, completion, and retries.

The app links to public Help at `/help/index.html`, available before sign-in. Agents
can discover docs at `/llms.txt` and read the consolidated `/llms-full.txt`.
Regenerate with `npm run docs:generate`; verify freshness with `npm run docs:check`.
The production build regenerates documentation without loading workspace secrets.

## Run a fictional preview

Requires Node.js 22 and npm.

```sh
npm ci
ACCORD_DEMO=true npm run dev
```

Open <http://localhost:3000>. The preview is read-only, contains fictional
examples, and cannot authenticate against or mutate a real workspace.

## Install your workspace

Use [the installation guide](docs/install.md) for local Supabase or managed
Supabase with Vercel. Create the owner through the bootstrap command; public
signup must be disabled. Core features require no external memory system,
agent runtime, issue tracker, or proprietary coordination service.

## Workspace redesign

Today brings decisions and blockers into a focused queue. Use
[Dismiss](docs/user-guide.md#dismiss-work-you-no-longer-need) to close work you no
longer need, or Snooze to revisit it later. Tasks support lists,
boards, priorities, due dates, and project grouping. New tasks default to simple
completion; verified tasks preserve explicit acceptance requirements. Agents
read assignments and decision feedback through the existing API/MCP contract.

See [redesign and migration guide](docs/redesign.md) before upgrading an existing
installation. Old workstream IDs and API commands remain supported.

## What is implemented

- Outcomes, closure criteria, next-action owners, handoffs, blockers, external
  references, review dates, and attributable history.
- Immutable action revisions, one-time approvals, recurring permissions,
  atomic usage limits, uncertain executions, and reconciliation.
- Private evidence, human acceptance, explicitly scoped integration
  verification, criterion-based agent closure, cancellation, and reopening.
- Distinct human/agent/integration identities, scoped expiring tokens,
  revocation, owner authentication, password recovery, and optional TOTP.
- Recurring-operation visibility and incident deduplication.
- Scoped exports, complete backups, and restoration into an empty installation.

Accord records external execution; agents perform it in their own runtime.
Authorization here cannot prevent actions through other channels or reverse
effects in an external system. A declared cost is not verified spending.

## Verify

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

PostgreSQL tests execute the actual migrations in PGlite. Browser tests use
fictional data and the shared domain service; they do not prove Supabase Auth
or Storage deployment. MCP tests use actual HTTP transport and a generic client.

See [domain and architecture](docs/architecture.md), [API/MCP](docs/api.md),
[recovery](docs/recovery.md), and [contributing](CONTRIBUTING.md).

Original Accord code and documentation are licensed under [MIT](LICENSE).
The Accord name and bundled logos have a separate [brand policy](TRADEMARKS.md).
Dependencies and fonts retain their [third-party licenses](THIRD_PARTY_NOTICES.md).
Never publish workspace data or secrets.

One installation supports one owner and one workspace. Contributions are welcome;
there is no support SLA or promised release schedule.

People adds personal/work contacts, interaction history, both-direction commitments,
important dates and stay-in-touch reminders. See [People](docs/people.md) for usage,
explicit agent permissions, CSV/vCard import and migration instructions.

Inspect recorded agent changes and execution reports in **Logs**, with actor,
action and date filters, before/after details and automatic refresh. See
[agent activity logs](docs/logs.md) for coverage and interpretation.
