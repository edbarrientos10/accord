# Accord help

Accord is a private workspace for one person coordinating projects, tasks, relationships,
and work with agents. Start with a task, make the next step clear, and use Today for
work that needs your attention.

## For people

- [User guide](user-guide.md): first task, daily decisions, projects, People, routines, agents, logs, and settings.
- [Troubleshooting](troubleshooting.md): sign-in, missing tasks, blocked completion, rejected commands, and recovery.
- [People reference](people.md): relationship reminders, commitments, imports, and date rules.
- [Logs reference](logs.md): what is recorded, how to investigate failures, and performance limits.

## For agents

- [Agent guide](agent-guide.md): connection, scopes, execution protocol, retries, and worked examples.
- [Command reference](commands.md): every command, permitted caller, and version target.
- [API and MCP reference](api.md): endpoints, request envelopes, file evidence, and errors.
- [OpenAPI document](openapi.json): generated request schemas for REST commands and auxiliary endpoints.
- [Fictional request examples](examples.json): schema-validated inputs to adapt after querying current state.
- [Agent manifest](agent-manifest.json): machine-readable discovery, permissions, and command metadata.

Use `/llms.txt` for discovery and `/llms-full.txt` for a consolidated text guide on a deployed installation.
Documentation describes capabilities; it never grants an agent permission to use them.

## For workspace administrators

- [Installation](install.md): environment variables, owner setup, Supabase, and Vercel.
- [Backup and restoration](recovery.md): selected exports, full backups, and recovery boundaries.
- [Projects and decisions migration](redesign.md): legacy compatibility and task lifecycle.
- [Architecture](architecture.md): shared command service and security model.
- [Validation](validation.md): what local tests prove and what requires hosted checks.

## What Accord does

Accord records coordination, decisions, bounded authority, execution reports, and evidence.
An agent uses its own runtime to do external work. Assigning a task does not start that
runtime, recording a commitment does not send a message, and a successful execution
report does not independently verify the result.

The current product has one human owner, agents, verifier integrations, and contacts
without logins. It does not provide collaborator accounts, automatic external contact
sync, external notifications, or an agent scheduler.

## About these docs

These guides describe the implementation in this repository. The guides shipped with
your deployment should match its app version. Examples use fictional records and
placeholder credentials. The Help site contains no workspace data and works without
sign-in. Operational logs and private API endpoints still require authorization.
