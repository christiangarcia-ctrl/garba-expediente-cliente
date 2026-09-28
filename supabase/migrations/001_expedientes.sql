-- GarBa Expediente Cliente
-- Backend privado: metadatos del expediente + bucket privado de documentos.

create extension if not exists pgcrypto;

create table if not exists public.expedientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'recibido',
  full_name text not null,
  profession text not null,
  email text not null,
  phone text not null,
  address_source text not null,
  street text not null,
  neighborhood text not null,
  postal_code text not null,
  city text not null,
  state text not null,
  beneficiaries jsonb not null default '[]'::jsonb,
  ine_front_path text,
  ine_back_path text,
  address_proof_path text,
  pdf_path text,
  consent boolean not null default false,
  user_agent text
);

alter table public.expedientes enable row level security;

-- No se crean políticas públicas. El formulario nunca escribe directamente a la tabla.
-- Sólo la Edge Function, usando service_role, puede insertar/leer estos registros.

insert into storage.buckets (id, name, public, file_size_limit)
values ('expedientes-clientes', 'expedientes-clientes', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760;
