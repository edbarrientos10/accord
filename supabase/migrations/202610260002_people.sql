-- Additive People migration. No task identifiers or existing authority changes.
alter table public.workspaces add column timezone text not null default 'America/Monterrey';
create table public.relationship_groups (
 workspace_id uuid not null references public.workspaces(id), id uuid not null,
 version integer not null check(version>0), body jsonb not null, primary key(workspace_id,id)
);
create table public.people (
 workspace_id uuid not null references public.workspaces(id), id uuid not null,
 group_id uuid not null, version integer not null check(version>0), body jsonb not null,
 primary key(workspace_id,id), foreign key(workspace_id,id) references public.identities(workspace_id,id),
 foreign key(workspace_id,group_id) references public.relationship_groups(workspace_id,id)
);
create table public.interactions (
 workspace_id uuid not null references public.workspaces(id), id uuid not null,
 person_id uuid not null, version integer not null check(version>0), body jsonb not null,
 primary key(workspace_id,id), foreign key(workspace_id,person_id) references public.people(workspace_id,id)
);
create table public.important_dates (like public.interactions including all);
alter table public.important_dates add foreign key(workspace_id,person_id) references public.people(workspace_id,id);
alter table public.important_dates add foreign key(workspace_id) references public.workspaces(id);
create table public.commitments (
 workspace_id uuid not null references public.workspaces(id), id uuid not null, person_id uuid not null,
 workstream_id uuid, project_id uuid, coordinator_id uuid not null,
 version integer not null check(version>0), body jsonb not null, primary key(workspace_id,id),
 foreign key(workspace_id,person_id) references public.people(workspace_id,id),
 foreign key(workspace_id,workstream_id) references public.workstreams(workspace_id,id),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id),
 foreign key(workspace_id,coordinator_id) references public.identities(workspace_id,id)
);
create table public.people_responses (
 workspace_id uuid not null references public.workspaces(id), id uuid not null,
 actor_id uuid not null, version integer not null check(version>0), body jsonb not null,
 primary key(workspace_id,id), foreign key(workspace_id,actor_id) references public.identities(workspace_id,id),
 unique(workspace_id,id,actor_id)
);
create unique index people_response_occurrence on public.people_responses(workspace_id,(body->>'occurrenceKey'));
create function public.accord_seed_relationship_groups() returns trigger language plpgsql security definer set search_path=public as $$
declare n int; labels text[]:=array['Family','Friends','Professional','Other']; days int[]:=array[30,60,90,null]; ident uuid;
begin
 for n in 1..4 loop
  ident:=('10000000-0000-4000-8000-00000000000'||n)::uuid;
  insert into relationship_groups(workspace_id,id,version,body) values(new.id,ident,1,jsonb_build_object('id',ident,'version',1,'name',labels[n],'cadenceDays',days[n],'createdAt',now(),'updatedAt',now()));
 end loop;
 return new;
end $$;
revoke all on function public.accord_seed_relationship_groups() from public,anon,authenticated;
create trigger seed_relationship_groups after insert on public.workspaces for each row execute function public.accord_seed_relationship_groups();
insert into public.relationship_groups(workspace_id,id,version,body)
select w.id,('10000000-0000-4000-8000-00000000000'||n)::uuid,1,jsonb_build_object('id',('10000000-0000-4000-8000-00000000000'||n)::uuid,'version',1,'name',(array['Family','Friends','Professional','Other'])[n],'cadenceDays',(array[30,60,90,null])[n],'createdAt',now(),'updatedAt',now()) from public.workspaces w cross join generate_series(1,4) n;
insert into public.people(workspace_id,id,group_id,version,body)
select workspace_id,id,'10000000-0000-4000-8000-000000000004',1,jsonb_build_object('id',id,'version',1,'name',body->>'name','groupId','10000000-0000-4000-8000-000000000004','organization','','role','','notes','','emails','[]'::jsonb,'phones','[]'::jsonb,'links','[]'::jsonb,'tags','[]'::jsonb,'externalIds','[]'::jsonb,'cadenceMode','inherit','cadenceDays',null,'status','active','createdAt',now(),'updatedAt',now()) from public.identities where kind='third_party';
do $$ declare t text; begin
 foreach t in array array['relationship_groups','people','interactions','important_dates','commitments','people_responses'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy owner_read on public.%I for select to authenticated using(workspace_id in (select id from public.workspaces where owner_auth_user_id=auth.uid()))',t);
 end loop;
end $$;
create or replace function public.accord_snapshot(p_workspace uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'workspaceId',w.id,'revision',w.revision,
    'timezone',w.timezone,
    'relationshipGroups',coalesce((select jsonb_agg(body order by id) from relationship_groups where workspace_id=w.id),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(body order by id) from people where workspace_id=w.id),'[]'::jsonb),
    'interactions',coalesce((select jsonb_agg(body order by id) from interactions where workspace_id=w.id),'[]'::jsonb),
    'importantDates',coalesce((select jsonb_agg(body order by id) from important_dates where workspace_id=w.id),'[]'::jsonb),
    'commitments',coalesce((select jsonb_agg(body order by id) from commitments where workspace_id=w.id),'[]'::jsonb),
    'peopleResponses',coalesce((select jsonb_agg(body order by id) from people_responses where workspace_id=w.id),'[]'::jsonb),
    'projects',coalesce((select jsonb_agg(body order by id) from projects where workspace_id=w.id),'[]'::jsonb),
    'decisions',coalesce((select jsonb_agg(body order by id) from decisions where workspace_id=w.id),'[]'::jsonb),
    'reminders',coalesce((select jsonb_agg(body order by id) from reminders where workspace_id=w.id),'[]'::jsonb),
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

create or replace function public.accord_commit(p_workspace uuid,p_revision bigint,p_actor uuid,p_key text,p_hash text,p_state jsonb,p_result jsonb,p_credential uuid default null)
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
  for r in select value from jsonb_array_elements(coalesce(p_state->'projects','[]'::jsonb)) loop
    insert into projects(id,workspace_id,version,body) values((r->>'id')::uuid,p_workspace,(r->>'version')::int,r)
    on conflict(id) do update set version=excluded.version,body=excluded.body where projects.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'workstreams') loop
    insert into workstreams(id,workspace_id,owner_id,version,status,review_at,body,project_id) values((r->>'id')::uuid,p_workspace,(r->>'ownerId')::uuid,(r->>'version')::int,r->>'status',(r->>'reviewAt')::timestamptz,r,(r->>'projectId')::uuid)
    on conflict(id) do update set owner_id=excluded.owner_id,version=excluded.version,status=excluded.status,review_at=excluded.review_at,body=excluded.body,project_id=excluded.project_id where workstreams.workspace_id=p_workspace;
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
  for r in select value from jsonb_array_elements(coalesce(p_state->'decisions','[]'::jsonb)) loop
    insert into decisions(id,workspace_id,workstream_id,actor_id,body) values((r->>'id')::uuid,p_workspace,(r->>'workstreamId')::uuid,(r->>'actorId')::uuid,r) on conflict(id) do nothing;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_state->'reminders','[]'::jsonb)) loop
    insert into reminders(id,workspace_id,actor_id,version,body) values((r->>'id')::uuid,p_workspace,(r->>'actorId')::uuid,(r->>'version')::int,r)
    on conflict(id) do update set version=excluded.version,body=excluded.body where reminders.workspace_id=p_workspace;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_state->'relationshipGroups','[]'::jsonb)) loop
    insert into relationship_groups(id,workspace_id,version,body) values((r->>'id')::uuid,p_workspace,(r->>'version')::int,r)
    on conflict(workspace_id,id) do update set version=excluded.version,body=excluded.body;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_state->'people','[]'::jsonb)) loop
    insert into people(id,workspace_id,version,body,group_id) values((r->>'id')::uuid,p_workspace,(r->>'version')::int,r, (r->>'groupId')::uuid)
    on conflict(workspace_id,id) do update set version=excluded.version,body=excluded.body,group_id=excluded.group_id;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_state->'interactions','[]'::jsonb)) loop
    insert into interactions(id,workspace_id,version,body,person_id) values((r->>'id')::uuid,p_workspace,(r->>'version')::int,r, (r->>'personId')::uuid)
    on conflict(workspace_id,id) do update set version=excluded.version,body=excluded.body,person_id=excluded.person_id;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_state->'importantDates','[]'::jsonb)) loop
    insert into important_dates(id,workspace_id,version,body,person_id) values((r->>'id')::uuid,p_workspace,(r->>'version')::int,r, (r->>'personId')::uuid)
    on conflict(workspace_id,id) do update set version=excluded.version,body=excluded.body,person_id=excluded.person_id;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_state->'commitments','[]'::jsonb)) loop
    insert into commitments(id,workspace_id,version,body,person_id,workstream_id,project_id,coordinator_id) values((r->>'id')::uuid,p_workspace,(r->>'version')::int,r, (r->>'personId')::uuid, (r->>'workstreamId')::uuid, (r->>'projectId')::uuid, (r->>'coordinatorId')::uuid)
    on conflict(workspace_id,id) do update set version=excluded.version,body=excluded.body,person_id=excluded.person_id,workstream_id=excluded.workstream_id,project_id=excluded.project_id,coordinator_id=excluded.coordinator_id;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_state->'peopleResponses','[]'::jsonb)) loop
    insert into people_responses(id,workspace_id,version,body,actor_id) values((r->>'id')::uuid,p_workspace,(r->>'version')::int,r, (r->>'actorId')::uuid)
    on conflict(workspace_id,id) do update set version=excluded.version,body=excluded.body,actor_id=excluded.actor_id;
  end loop;
  for r in select value from jsonb_array_elements(p_state->'audit') loop
    insert into audit_events(id,workspace_id,actor_id,entity_id,occurred_at,command,body) values((r->>'id')::uuid,p_workspace,(r->>'actorId')::uuid,(r->>'entityId')::uuid,(r->>'at')::timestamptz,r->>'command',r) on conflict(id) do nothing;
  end loop;
  update workspaces set timezone=coalesce(p_state->>'timezone',timezone),revision=p_revision+1 where id=p_workspace;
  insert into idempotency_records(workspace_id,actor_id,key,request_hash,result) values(p_workspace,p_actor,p_key,p_hash,p_result);
  return jsonb_build_object('result',p_result,'replayed',false);
end $$;
revoke all on function public.accord_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.accord_commit(uuid,bigint,uuid,text,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.accord_snapshot(uuid) to service_role;
grant execute on function public.accord_commit(uuid,bigint,uuid,text,text,jsonb,jsonb,uuid) to service_role;

