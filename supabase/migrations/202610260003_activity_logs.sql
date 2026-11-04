-- Keep append-only history out of current-state reads and command writes.
create or replace function public.accord_current_snapshot(p_workspace uuid) returns jsonb
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
    'audit','[]'::jsonb
  ) from workspaces w where w.id=p_workspace;
$$;

revoke all on function public.accord_current_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.accord_current_snapshot(uuid) to service_role;

create table public.activity_log (
 id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_id uuid not null,
 actor_kind text not null check(actor_kind in ('human','agent','integration','third_party')),
 occurred_at timestamptz not null,
 command text not null check(length(command)<=100),
 kind text not null check(kind in ('change','attempt')),
 outcome text not null,
 entity_id uuid,
 context_ids uuid[] not null default '{}',
 summary jsonb not null check(octet_length(summary::text)<=16000),
 detail jsonb check(detail is null or octet_length(detail::text)<=8192),
 search_document tsvector generated always as (to_tsvector('simple',coalesce(summary->>'title','') || ' ' || coalesce(summary->>'reason','') || ' ' || coalesce(summary->>'actorName','') || ' ' || command || ' ' || coalesce(entity_id::text,''))) stored,
 foreign key(workspace_id,actor_id) references public.identities(workspace_id,id)
);
create index activity_page on public.activity_log(workspace_id,occurred_at desc,id desc);
create index activity_agents_page on public.activity_log(workspace_id,occurred_at desc,id desc) where actor_kind in ('agent','integration');
create index activity_actor_page on public.activity_log(workspace_id,actor_id,occurred_at desc,id desc);
create index activity_kind_page on public.activity_log(workspace_id,actor_kind,occurred_at desc,id desc);
create index activity_outcome_page on public.activity_log(workspace_id,outcome,occurred_at desc,id desc);
create index activity_command_page on public.activity_log(workspace_id,command,occurred_at desc,id desc);
create index activity_context on public.activity_log using gin(context_ids);
create index activity_search on public.activity_log using gin(search_document);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from public,anon,authenticated;
grant select on public.activity_log to authenticated;
grant select,insert on public.activity_log to service_role;
create policy owner_read on public.activity_log for select to authenticated using(workspace_id in(select id from public.workspaces where owner_auth_user_id=auth.uid()));
create trigger activity_append_only before update or delete on public.activity_log for each row execute function public.reject_audit_mutation();

create function public.accord_index_audit(p_workspace uuid,p_body jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare a jsonb; actor jsonb; label text; result text; contexts uuid[]; eid uuid; parent uuid; summary jsonb;
begin
 eid:=(p_body->>'entityId')::uuid;
 select body into actor from identities where workspace_id=p_workspace and id=(p_body->>'actorId')::uuid;
 a:=coalesce(p_body->'changes'->'after',p_body->'changes'->'before','{}'::jsonb);
 contexts:=array[eid];
 for parent in select value::uuid from jsonb_array_elements_text(jsonb_build_array(a->>'workstreamId',a->>'operationId',a->>'personId',a->>'projectId',a->>'subjectId')) where value ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' loop
   contexts:=array_append(contexts,parent);
 end loop;
 label:=coalesce(a->>'title',a->>'name',
   (select body->>'title' from workstreams where workspace_id=p_workspace and id=any(contexts) limit 1),
   (select body->>'title' from operations where workspace_id=p_workspace and id=any(contexts) limit 1),
   (select body->>'name' from people where workspace_id=p_workspace and id=any(contexts) limit 1),
   case when eid=p_workspace then 'Workspace settings' else 'Workspace record' end);
 result:=case when a->>'state' in ('running','succeeded','partial','failed','uncertain') and exists(select 1 from executions where workspace_id=p_workspace and id=eid) then a->>'state' else 'recorded' end;
 summary:=jsonb_build_object('id',p_body->>'id','actorId',p_body->>'actorId','actorName',left(coalesce(actor->>'name','Unknown actor'),200),'actorKind',actor->>'kind','at',p_body->>'at','command',p_body->>'command','entityId',eid,'title',left(label,240),'reason',left(coalesce(p_body->>'reason',''),1000),'outcome',result,'kind','change','contextIds',contexts);
 insert into activity_log(id,workspace_id,actor_id,actor_kind,occurred_at,command,kind,outcome,entity_id,context_ids,summary)
 values((p_body->>'id')::uuid,p_workspace,(p_body->>'actorId')::uuid,actor->>'kind',(p_body->>'at')::timestamptz,p_body->>'command','change',result,eid,contexts,summary) on conflict(id) do nothing;
end $$;
create function public.accord_audit_activity_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin perform accord_index_audit(new.workspace_id,new.body); return new; end $$;
create trigger index_audit_activity after insert on public.audit_events for each row execute function public.accord_audit_activity_trigger();
-- One-time backfill; no historical events are changed or removed.
select public.accord_index_audit(workspace_id,body) from public.audit_events;
revoke all on function public.accord_index_audit(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.accord_audit_activity_trigger() from public,anon,authenticated;

create function public.accord_record_attempt(p_workspace uuid,p_actor uuid,p_event jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare actor jsonb; eid uuid; summary jsonb;
begin
 select body into actor from identities where workspace_id=p_workspace and id=p_actor;
 if actor is null then raise exception 'invalid_actor'; end if;
 if p_event->>'outcome' not in ('rejected','error') or p_event->>'transport' not in ('rest','mcp') then raise exception 'invalid_attempt'; end if;
 eid:=(p_event->>'entityId')::uuid;
 summary:=jsonb_build_object('id',p_event->>'id','actorId',p_actor,'actorName',left(actor->>'name',200),'actorKind',actor->>'kind','at',p_event->>'at','command',p_event->>'command','entityId',eid,'title','Command attempt','reason',p_event->>'message','outcome',p_event->>'outcome','kind','attempt','contextIds',case when eid is null then '{}'::uuid[] else array[eid] end);
 insert into activity_log(id,workspace_id,actor_id,actor_kind,occurred_at,command,kind,outcome,entity_id,context_ids,summary,detail)
 values((p_event->>'id')::uuid,p_workspace,p_actor,actor->>'kind',(p_event->>'at')::timestamptz,p_event->>'command','attempt',p_event->>'outcome',eid,case when eid is null then '{}'::uuid[] else array[eid] end,summary,p_event) on conflict(id) do nothing;
end $$;
revoke all on function public.accord_record_attempt(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.accord_record_attempt(uuid,uuid,jsonb) to service_role;

-- Only summaries are paged. Full before/after values are fetched individually.
create function public.accord_activity_page(p_workspace uuid,p_actor text default 'agents',p_command text default '',p_outcome text default '',p_query text default '',p_from date default null,p_to date default null,p_entity uuid default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit int default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare conditions text:='workspace_id=$1'; result jsonb; tz text;
begin
 if p_limit<1 or p_limit>100 or length(p_query)>200 then raise exception 'invalid_page'; end if;
 select timezone into tz from workspaces where id=p_workspace;
 if p_actor='agents' then conditions:=conditions||' and actor_kind in (''agent'',''integration'')';
 elsif p_actor<>'all' then conditions:=conditions||' and actor_id=$2::uuid'; end if;
 if p_command<>'' then conditions:=conditions||' and command=$3'; end if;
 if p_outcome<>'' then conditions:=conditions||' and outcome=$4'; end if;
 if p_query<>'' then conditions:=conditions||' and search_document @@ plainto_tsquery(''simple'',$5)'; end if;
 if p_from is not null then conditions:=conditions||' and occurred_at >= ($6::timestamp at time zone $12)'; end if;
 if p_to is not null then conditions:=conditions||' and occurred_at < (($7+1)::timestamp at time zone $12)'; end if;
 if p_entity is not null then conditions:=conditions||' and context_ids @> array[$8]'; end if;
 if p_before_at is not null and p_before_id is not null then conditions:=conditions||' and (occurred_at,id)<($9,$10)'; end if;
 execute 'select coalesce(jsonb_agg(summary order by occurred_at desc,id desc),''[]''::jsonb) from (select summary,occurred_at,id from activity_log where '||conditions||' order by occurred_at desc,id desc limit $11+1) page'
 into result using p_workspace,p_actor,p_command,p_outcome,p_query,p_from,p_to,p_entity,p_before_at,p_before_id,p_limit,tz;
 return result;
end $$;
revoke all on function public.accord_activity_page(uuid,text,text,text,text,date,date,uuid,timestamptz,uuid,int) from public,anon,authenticated;
grant execute on function public.accord_activity_page(uuid,text,text,text,text,date,date,uuid,timestamptz,uuid,int) to service_role;
