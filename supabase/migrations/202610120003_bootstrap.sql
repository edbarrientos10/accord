create function public.accord_bootstrap(p_workspace uuid,p_identity uuid,p_auth_user uuid,p_name text)
returns void language plpgsql security definer set search_path=public as $$ begin
  perform pg_advisory_xact_lock(1020261012);
  if exists(select 1 from workspaces) then raise exception 'already_installed'; end if;
  insert into workspaces(id,name,owner_auth_user_id) values(p_workspace,'Accord',p_auth_user);
  insert into identities(id,workspace_id,kind,body) values(p_identity,p_workspace,'human',jsonb_build_object('id',p_identity,'name',p_name,'kind','human','authUserId',p_auth_user));
end $$;
revoke all on function public.accord_bootstrap(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.accord_bootstrap(uuid,uuid,uuid,text) to service_role;
