-- Current records are relational; extensible domain payloads are validated by the
-- shared command service. Only service_role can invoke transactional writes.
create table public.workspaces (
  id uuid primary key,
  name text not null,
  owner_auth_user_id uuid not null unique references auth.users(id),
  revision bigint not null default 0,
  created_at timestamptz not null default now()
);
create table public.identities (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  kind text not null check (kind in ('human','agent','integration','third_party')),
  body jsonb not null,
  unique(workspace_id,id)
);
create unique index one_human_per_workspace on public.identities(workspace_id) where kind='human';
create table public.workstreams (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  owner_id uuid not null,
  version integer not null check(version>0),
  status text not null check(status in ('open','blocked','ready_for_review','completed','cancelled','dismissed')),
  review_at timestamptz not null,
  body jsonb not null,
  foreign key(workspace_id,owner_id) references public.identities(workspace_id,id),
  unique(workspace_id,id)
);
create table public.operations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  owner_id uuid not null,
  version integer not null check(version>0),
  body jsonb not null,
  foreign key(workspace_id,owner_id) references public.identities(workspace_id,id),
  unique(workspace_id,id)
);
create table public.actions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  workstream_id uuid not null,
  version integer not null check(version>0),
  revision integer not null check(revision>0),
  body jsonb not null,
  foreign key(workspace_id,workstream_id) references public.workstreams(workspace_id,id),
  unique(workspace_id,id)
);
create table public.grants (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  workstream_id uuid,
  operation_id uuid,
  action_id uuid,
  grantee_id uuid not null,
  version integer not null check(version>0),
  body jsonb not null,
  check(num_nonnulls(workstream_id,operation_id)=1),
  foreign key(workspace_id,workstream_id) references public.workstreams(workspace_id,id),
  foreign key(workspace_id,operation_id) references public.operations(workspace_id,id),
  foreign key(workspace_id,action_id) references public.actions(workspace_id,id),
  foreign key(workspace_id,grantee_id) references public.identities(workspace_id,id),
  unique(workspace_id,id)
);
create table public.executions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  workstream_id uuid,
  operation_id uuid,
  action_id uuid,
  grant_id uuid not null,
  actor_id uuid not null,
  version integer not null check(version>0),
  body jsonb not null,
  check(num_nonnulls(workstream_id,operation_id)=1),
  foreign key(workspace_id,workstream_id) references public.workstreams(workspace_id,id),
  foreign key(workspace_id,operation_id) references public.operations(workspace_id,id),
  foreign key(workspace_id,action_id) references public.actions(workspace_id,id),
  foreign key(workspace_id,grant_id) references public.grants(workspace_id,id),
  foreign key(workspace_id,actor_id) references public.identities(workspace_id,id),
  unique(workspace_id,id)
);
create table public.evidence (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  workstream_id uuid,
  operation_id uuid,
  execution_id uuid,
  version integer not null check(version>0),
  body jsonb not null,
  check(num_nonnulls(workstream_id,operation_id)=1),
  foreign key(workspace_id,workstream_id) references public.workstreams(workspace_id,id),
  foreign key(workspace_id,operation_id) references public.operations(workspace_id,id),
  foreign key(workspace_id,execution_id) references public.executions(workspace_id,id),
  unique(workspace_id,id)
);
create table public.audit_events (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid not null,
  entity_id uuid not null,
  occurred_at timestamptz not null,
  command text not null,
  body jsonb not null,
  foreign key(workspace_id,actor_id) references public.identities(workspace_id,id)
);
create index audit_workspace_time on public.audit_events(workspace_id,occurred_at);
create table public.agent_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  identity_id uuid not null,
  token_hash text not null unique,
  scopes text[] not null,
  assignments uuid[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,identity_id) references public.identities(workspace_id,id)
);
create table public.idempotency_records (
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid not null,
  key text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,actor_id,key)
);
-- Owners may read their own data. Neither owners nor agents can directly mutate.
do $$ declare t text; begin
  foreach t in array array['workspaces','identities','workstreams','operations','actions','grants','executions','evidence','audit_events','agent_credentials','idempotency_records'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t not in ('agent_credentials','idempotency_records') then
      execute format('grant select on public.%I to authenticated',t);
      if t='workspaces' then
        execute 'create policy owner_read on public.workspaces for select to authenticated using(owner_auth_user_id=auth.uid())';
      else
        execute format('create policy owner_read on public.%I for select to authenticated using(workspace_id in (select id from public.workspaces where owner_auth_user_id=auth.uid()))',t);
      end if;
    end if;
  end loop;
end $$;

create function public.reject_audit_mutation() returns trigger language plpgsql as $$ begin
  raise exception 'Audit events are append-only';
end $$;
create trigger audit_append_only before update or delete on public.audit_events for each row execute function public.reject_audit_mutation();

create function public.accord_snapshot(p_workspace uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'workspaceId',w.id,'revision',w.revision,
    'identities',coalesce((select jsonb_agg(body order by id) from identities where workspace_id=w.id),'[]'::jsonb),
    'workstreams',coalesce((select jsonb_agg(body order by id) from workstreams where workspace_id=w.id),'[]'::jsonb),
    'operations',coalesce((select jsonb_agg(body order by id) from operations where workspace_id=w.id),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(body order by id) from actions where workspace_id=w.id),'[]'::jsonb),
    'grants',coalesce((select jsonb_agg(body order by id) from grants where workspace_id=w.id),'[]'::jsonb),
    'executions',coalesce((select jsonb_agg(body order by id) from executions where workspace_id=w.id),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(body order by id) from evidence where workspace_id=w.id),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(body order by occurred_at,id) from audit_events where workspace_id=w.id),'[]'::jsonb)
  ) from workspaces w where w.id=p_workspace;
$$;

create function public.accord_commit(p_workspace uuid,p_revision bigint,p_actor uuid,p_key text,p_hash text,p_state jsonb,p_result jsonb,p_credential uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_revision bigint; prior idempotency_records%rowtype; r jsonb; table_name text; end_actor uuid;
begin
  select revision into current_revision from workspaces where id=p_workspace for update;
  if not found then raise exception 'workspace_not_found'; end if;
  if exists(select 1 from identities where id=p_actor and workspace_id=p_workspace and kind in ('agent','integration')) then
    if not exists(select 1 from agent_credentials where id=p_credential and workspace_id=p_workspace and identity_id=p_actor and revoked_at is null and expires_at>now()) then raise exception 'credential_revoked'; end if;
  end if;
  select * into prior from idempotency_records where workspace_id=p_workspace and actor_id=p_actor and key=p_key;
  if found then
    if prior.request_hash<>p_hash then raise exception 'idempotency_mismatch'; end if;
    return jsonb_build_object('replayed',true,'result',prior.result);
  end if;
  if current_revision<>p_revision then return jsonb_build_object('conflict',true,'revision',current_revision); end if;
  if (p_state->>'workspaceId')::uuid<>p_workspace or (p_state->>'revision')::bigint<>p_revision+1 then raise exception 'invalid_snapshot'; end if;
  if not exists(select 1 from identities where workspace_id=p_workspace and id=p_actor) then raise exception 'invalid_actor'; end if;
  for r in select value from jsonb_array_elements(p_state->'identities') loop
    insert into identities(id,workspace_id,kind,body) values((r->>'id')::uuid,p_workspace,r->>'kind',r)
    on conflict(id) do update set body=excluded.body where identities.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'workstreams') loop
    insert into workstreams(id,workspace_id,owner_id,version,status,review_at,body) values((r->>'id')::uuid,p_workspace,(r->>'ownerId')::uuid,(r->>'version')::int,r->>'status',(r->>'reviewAt')::timestamptz,r)
    on conflict(id) do update set owner_id=excluded.owner_id,version=excluded.version,status=excluded.status,review_at=excluded.review_at,body=excluded.body where workstreams.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'operations') loop
    insert into operations(id,workspace_id,owner_id,version,body) values((r->>'id')::uuid,p_workspace,(r->>'ownerId')::uuid,(r->>'version')::int,r)
    on conflict(id) do update set version=excluded.version,body=excluded.body where operations.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'actions') loop
    insert into actions(id,workspace_id,workstream_id,version,revision,body) values((r->>'id')::uuid,p_workspace,(r->>'workstreamId')::uuid,(r->>'version')::int,(r->>'revision')::int,r)
    on conflict(id) do update set version=excluded.version,body=excluded.body where actions.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'grants') loop
    insert into grants(id,workspace_id,workstream_id,operation_id,action_id,grantee_id,version,body) values((r->>'id')::uuid,p_workspace,(r->>'workstreamId')::uuid,(r->>'operationId')::uuid,(r->>'actionId')::uuid,(r->>'granteeId')::uuid,(r->>'version')::int,r)
    on conflict(id) do update set version=excluded.version,body=excluded.body where grants.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'executions') loop
    insert into executions(id,workspace_id,workstream_id,operation_id,action_id,grant_id,actor_id,version,body) values((r->>'id')::uuid,p_workspace,(r->>'workstreamId')::uuid,(r->>'operationId')::uuid,(r->>'actionId')::uuid,(r->>'grantId')::uuid,(r->>'actorId')::uuid,(r->>'version')::int,r)
    on conflict(id) do update set version=excluded.version,body=excluded.body where executions.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'evidence') loop
    insert into evidence(id,workspace_id,workstream_id,operation_id,execution_id,version,body) values((r->>'id')::uuid,p_workspace,(r->>'workstreamId')::uuid,(r->>'operationId')::uuid,(r->>'executionId')::uuid,(r->>'version')::int,r)
    on conflict(id) do update set version=excluded.version,body=excluded.body where evidence.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'audit') loop
    insert into audit_events(id,workspace_id,actor_id,entity_id,occurred_at,command,body) values((r->>'id')::uuid,p_workspace,(r->>'actorId')::uuid,(r->>'entityId')::uuid,(r->>'at')::timestamptz,r->>'command',r) on conflict(id) do nothing;
  end loop;
  update workspaces set revision=p_revision+1 where id=p_workspace;
  insert into idempotency_records(workspace_id,actor_id,key,request_hash,result) values(p_workspace,p_actor,p_key,p_hash,p_result);
  return jsonb_build_object('result',p_result,'replayed',false);
end $$;
revoke all on function public.accord_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.accord_commit(uuid,bigint,uuid,text,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.accord_snapshot(uuid) to service_role;
grant execute on function public.accord_commit(uuid,bigint,uuid,text,text,jsonb,jsonb,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit) values('evidence','evidence',false,3145728) on conflict(id) do nothing;
-- No client Storage policies: all access is authorized by Accord before using
-- the server-only service credential. Private bucket denies anonymous URLs.
