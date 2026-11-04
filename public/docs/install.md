# Installation

## Local Supabase

Install Node.js 22, npm, Supabase CLI **2.58.5** (the version verified by the
disposable installation check), and a Docker-compatible runtime. Newer CLI
versions have not been verified for this preview.

1. Run `npm ci` and `supabase start` from the checkout. The included config
   disables public signup globally and sets local Auth, API, database, and Studio ports.
   The email provider remains enabled so the bootstrapped owner can sign in;
   `auth.email.enable_signup=true` does not override `auth.enable_signup=false`.
2. Copy `.env.example` to `.env.local`. Configure the local URL, anonymous key,
   service-role key, and `ACCORD_ORIGIN=http://localhost:3000` privately. Use
   `supabase status` locally to obtain credentials; do not paste its output in
   issues, chat, or public logs. Set `ACCORD_DEMO=false`.
3. Apply migrations with `supabase db reset` **only to the disposable local
   database**. It replaces local data. Migrations create private evidence storage
   and deny direct client writes.
4. Configure `ACCORD_OWNER_EMAIL`, `ACCORD_OWNER_PASSWORD` (12+ characters), and
   `ACCORD_OWNER_NAME` privately, then run `npm run bootstrap`. Remove the
   bootstrap password from the environment afterward.
5. Run `npm run dev`, sign in, and create an outcome. Add an agent identity in
   Agents, assign it to the outcome, and issue a token restricted to the
   required capabilities and that outcome.

Installation scripts load `.env.local`, falling back to `.env`, without printing
its contents. Next.js loads `.env.local` independently. Shell environment
variables take precedence. Only `NEXT_PUBLIC_` values are included in browser
bundles; the service-role key must never use that prefix.

## Managed Supabase and Vercel

Use new dedicated pilot projects, or explicitly select empty existing projects.
Keep preview/test and production Supabase projects separate.

1. Select the Supabase project and Vercel team/project. Configure
   `SUPABASE_PROJECT_REF`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` in your private
   environment. `npm run readiness` reports presence only, never values.
2. Link the exact Supabase project with `supabase link --project-ref PROJECT_REF`.
   Inspect pending migrations with `supabase db push --dry-run`; apply them with
   `supabase db push` to the selected pilot project.
3. In Supabase Auth, disable new-user signup, configure the exact site URL and
   `/reset-password` redirect, and configure reliable SMTP. Verify signup denial
   and password recovery against the hosted instance. Local config does not
   change managed Auth settings automatically.
4. Set the URL, anonymous key, server-only service-role key, and exact production
   `ACCORD_ORIGIN` in Vercel. Bootstrap the configured owner using this project's
   private environment. Set Node.js 22, framework Next.js, build `npm run build`,
   install `npm ci`, and root directory to the repository root.
5. Configure a separate preview Supabase project and origin, or enable the
   fictional preview with `ACCORD_DEMO=true` and provide no live service key.
   Do not expose the private pilot database to unreviewed preview builds.
6. Stage the pilot deployment, validate authentication, RLS, Storage, commands,
   and MCP, then promote the validated production build. Protect the private
   repository and deployment. MCP clients must also be allowed through any
   Vercel deployment protection; an Accord token does not bypass it.

No scheduler needs enabling. Recurring operations report executions from their
existing scheduler through Accord's API/MCP. Choose the function region near the
Supabase database before release.

The private evidence upload endpoint accepts files up to **3 MiB**. This fits
Vercel's [4.5 MB request limit](https://vercel.com/docs/functions/limitations).
Larger evidence can be linked in its existing private source system. Scoped
exports stream their response; complete backups should run through the CLI.

## Generic agent integration

Configure a Streamable HTTP MCP client with URL `https://YOUR_HOST/mcp` and an
`Authorization: Bearer` header containing its private Accord agent token.
Do not use the Supabase service-role key as an agent credential.

The [example client](/docs/example-agent.ts) reads `ACCORD_MCP_URL` and
`ACCORD_AGENT_TOKEN` from the environment. Run `npm run agent:example -- query`.
Assign and scope access explicitly; agents do not inherit the human session or
approval authority. OAuth onboarding is outside v1.

## Upgrading the workspace redesign

Apply `202610260001_projects_decisions.sql` before starting this application
version. Read [the upgrade and recovery procedure](redesign.md#upgrade-and-recovery)
for populated installations. Back up first and validate a staging copy; this
repository does not automatically migrate or deploy a hosted project.

For the People module, apply `202610260002_people.sql` after the projects migration.
See [People migration and recovery](people.md#migration-and-recovery) for the ordered
backup, staging verification, and credential steps. Existing tokens gain no scopes.

For paginated activity and failed-attempt logs, apply
`202610260003_activity_logs.sql` after People and before starting this build.
It backfills existing audit summaries and adds the compact current-state read.
See [activity log migration](logs.md#migration-and-recovery). Hosted migration
and deployment remain separate from the local implementation.

For workspace-wide agent tokens, apply
`202610270001_workspace_agent_access.sql` after the activity-log migration.
Tokens still default to assigned access; workspace access must be selected explicitly.
New installations must apply all migrations in filename order.

## Runtime environment on Vercel

Set these for the intended Production deployment. Configure Preview separately.

| Variable                        | Value                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://YOUR_PROJECT_REF.supabase.co`                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | That project's public anonymous API key                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`     | That project's server-only service-role key; store privately, never with a public prefix |
| `ACCORD_ORIGIN`                 | Exact app origin, such as `https://accord.example.com`, with no path or trailing slash   |
| `ACCORD_DEMO`                   | `false` for a real workspace                                                             |

Rebuild and redeploy after changing environment configuration. Public values are used
by the browser build. Use the same Supabase project for all three Supabase variables.
CLI credentials such as `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`,
and project/team IDs are not required by the deployed application's runtime. No AI
provider key is required. Do not put the owner password in Vercel.

## Owner installation

Migrations create the schema, not an owner login or workspace. New installations use
`npm run bootstrap` with private `ACCORD_OWNER_EMAIL`, `ACCORD_OWNER_PASSWORD` (at least
12 characters), and optional `ACCORD_OWNER_NAME`. The script creates a confirmed Auth
user, then installs a workspace and human identity atomically; it refuses an already
installed workspace. Remove the bootstrap password afterward.

### If the owner already exists in Supabase Auth

The current bootstrap script creates a new Auth user; it does not adopt an existing
one. Do not rerun it expecting an existing account to be linked automatically. An
administrator can install an existing, verified owner through the service-only
`accord_bootstrap` function. First verify the selected project, existing account ID,
and that no workspace exists. Do not automatically select a user by unverified email
or replace an existing owner. This is a privileged one-time installation operation,
not an agent capability.

Using Supabase SQL Editor with administrative access, substitute the explicitly verified
Auth UUID in this guarded transaction. It preserves the account and password:

```sql
begin;
do $$
declare
  owner_id uuid := 'REPLACE_WITH_VERIFIED_AUTH_USER_UUID';
begin
  if exists (select 1 from public.workspaces) then
    raise exception 'Workspace already installed; do not replace its owner';
  end if;
  if not exists (
    select 1 from auth.users
    where id = owner_id and email_confirmed_at is not null
      and not coalesce(is_anonymous, false)
  ) then
    raise exception 'Expected a confirmed, non-anonymous owner account';
  end if;
  perform public.accord_bootstrap(
    gen_random_uuid(), gen_random_uuid(), owner_id, 'Workspace owner'
  );
end $$;
commit;
```

The function itself serializes installation and refuses a second workspace. Verify
that `workspaces.owner_auth_user_id` and the human identity's `body.authUserId` refer
to that account, then sign in through the app. Never give the administrative credential
to a worker agent. If authentication still fails, use [troubleshooting](troubleshooting.md).

## Documentation publishing

The repository keeps canonical Markdown in `docs/`. `npm run docs:generate` regenerates
command metadata, OpenAPI, the static Help site, and public agent documents from an
explicit allowlist. `npm run docs:check` detects drift without writing files. The normal
production build regenerates these artifacts through `prebuild`.

After deploying this build, Help is available at `/help/index.html`, with Markdown at
`/docs/`, discovery at `/llms.txt`, and a consolidated guide at `/llms-full.txt`. These
are public product documentation, contain no workspace data, and work before sign-in.
They do not authenticate callers or expand any API permissions.
