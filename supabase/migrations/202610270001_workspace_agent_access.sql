-- Existing credentials remain restricted to their explicit record assignments.
alter table public.agent_credentials add column access_mode text not null default 'assigned'
  check (access_mode in ('assigned','workspace'));
alter table public.agent_credentials add constraint workspace_credentials_no_assignments
  check (access_mode <> 'workspace' or cardinality(assignments)=0);
drop function public.accord_credential_create(uuid,uuid,uuid,uuid,text,text[],uuid[],timestamptz,text,text);
create function public.accord_credential_create(p_id uuid,p_workspace uuid,p_actor uuid,p_identity uuid,p_hash text,p_scopes text[],p_assignments uuid[],p_expires timestamptz,p_key text,p_request_hash text,p_access_mode text default 'assigned')
returns jsonb language plpgsql security definer set search_path=public as $$
declare event_id uuid:=gen_random_uuid(); prior idempotency_records%rowtype; result jsonb;
begin
  perform 1 from workspaces where id=p_workspace for update;
  if not exists(select 1 from identities where id=p_actor and workspace_id=p_workspace and kind='human') then raise exception 'human_required'; end if;
  select * into prior from idempotency_records where workspace_id=p_workspace and actor_id=p_actor and key=p_key;
  if found then
    if prior.request_hash<>p_request_hash then raise exception 'idempotency_mismatch'; end if;
    return prior.result||'{"created":false}'::jsonb;
  end if;
  if p_access_mode not in ('assigned','workspace') or p_access_mode is null then raise exception 'invalid_access_mode'; end if;
  if not exists(select 1 from identities where id=p_identity and workspace_id=p_workspace and kind in ('agent','integration')) then raise exception 'invalid_identity'; end if;
  if p_access_mode='workspace' and (cardinality(p_assignments)<>0 or not exists(select 1 from identities where id=p_identity and workspace_id=p_workspace and kind='agent')) then raise exception 'invalid_workspace_access'; end if;
  insert into agent_credentials(id,workspace_id,identity_id,token_hash,scopes,assignments,expires_at,access_mode) values(p_id,p_workspace,p_identity,p_hash,p_scopes,p_assignments,p_expires,p_access_mode);
  insert into audit_events(id,workspace_id,actor_id,entity_id,occurred_at,command,body) values(event_id,p_workspace,p_actor,p_identity,now(),'credential.create',jsonb_build_object('id',event_id,'actorId',p_actor,'entityId',p_identity,'at',now(),'command','credential.create','reason','Owner issued a scoped credential','changes',jsonb_build_object('credentialId',p_id,'scopes',p_scopes,'assignments',p_assignments,'accessMode',p_access_mode,'expiresAt',p_expires)));
  update workspaces set revision=revision+1 where id=p_workspace;
  result:=jsonb_build_object('id',p_id,'expiresAt',p_expires,'created',true);
  insert into idempotency_records(workspace_id,actor_id,key,request_hash,result) values(p_workspace,p_actor,p_key,p_request_hash,result);
  return result;
end $$;
revoke all on function public.accord_credential_create(uuid,uuid,uuid,uuid,text,text[],uuid[],timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.accord_credential_create(uuid,uuid,uuid,uuid,text,text[],uuid[],timestamptz,text,text,text) to service_role;
