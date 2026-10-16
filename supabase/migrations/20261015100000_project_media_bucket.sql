-- Project media bucket (spec §12.4): private, WebP only, ~3 MB per object.
-- Objects are written by the media service (backend/) with the caller's own JWT,
-- so these policies are the security boundary. Layout (generated server-side):
--   <project_id>/<yyyy>/<mm>/<uuid>.webp  and  <uuid>_thumb.webp
-- Reads use short-lived signed URLs, which Storage only issues when SELECT passes.
--
-- SELECT/INSERT: anyone who can view the project (Owner PM, project PMs and
-- inspectors). DELETE: only people who can manage it (Owner PM, project PMs).
-- No UPDATE policy: objects are immutable (uploads never upsert).
-- The first path segment is compared as text, so a malformed name can never
-- make the policy raise (a ::uuid cast would).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-media', 'project-media', false, 3145728, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy project_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] in (select p::text from private.visible_project_ids() as p)
  );

create policy project_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}/(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_thumb)?\.webp$'
    and (storage.foldername(name))[1] in (select p::text from private.visible_project_ids() as p)
  );

create policy project_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] in (select p::text from private.manageable_project_ids() as p)
  );
