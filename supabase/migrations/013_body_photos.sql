-- 013: fotos de progreso corporal.
-- Columna photo_paths en body_metrics (array de rutas dentro del bucket privado
-- 'body-photos') + bucket de Storage privado con RLS por usuario vía prefijo de ruta.
-- Ruta canónica: {owner_uid}/{uuid}.jpg — el primer segmento debe ser el uid para
-- que el RLS de storage.objects aísle a cada usuario (mismo aislamiento que el
-- catálogo/entries: migración 007/012). photo_paths NO requiere migración futura:
-- es un array de strings que Body.jsx gestiona (sube/borra) junto a metrics.

alter table nutri.body_metrics
  add column if not exists photo_paths jsonb not null default '[]';

-- Bucket privado. Límite 5 MB por objeto y solo imágenes (defensa en profundidad:
-- el cliente ya comprime a JPEG ~1024px, pero el bucket lo hace cumplir).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('body-photos', 'body-photos', false, 5242880,
        array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

-- RLS sobre storage.objects: cada usuario solo ve/escribe objetos cuyo primer
-- segmento de ruta es su propio uid. storage.foldername(name) parte la ruta por '/'.
create policy body_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'body-photos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy body_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'body-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy body_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'body-photos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
