-- ==========================================================================
-- Duelo da Zoeira · banco de dados (Supabase / Postgres)
--
-- Como usar: Supabase → SQL Editor → "New query" → cole este arquivo inteiro → Run.
-- Pode rodar de novo quando o jogo ganhar coisas novas: nada é apagado.
--
-- Segurança
--  * As tabelas ficam no esquema "zoeira", que o site NÃO enxerga.
--  * O site só chama as funções do esquema public (abaixo). Cada uma confere a
--    sessão de quem chamou: ninguém mexe na conta, no perfil ou nas moedas dos outros.
--  * A senha nunca chega aqui: o navegador manda só um código derivado dela
--    (HMAC-SHA256 com o nick), e aqui esse código é guardado com bcrypt.
--  * Erro de senha 10 vezes em 15 minutos bloqueia a conta por 15 minutos.
-- ==========================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists zoeira;


/* ---------- Tabelas ---------- */

-- Conta + perfil. "perfil" é o mesmo objeto que o jogo usa (XP, deck, troféus...).
create table if not exists zoeira.jogadores (
  chave            text primary key check (chave ~ '^[a-z0-9_]{3,16}$'),
  nick             text not null check (char_length(nick) between 3 and 16),
  senha_hash       text,                          -- null = conta reservada (sem senha ainda)
  senha_provisoria boolean not null default false,
  perfil           jsonb not null default '{}'::jsonb,
  versao           integer not null default 0,    -- muda a cada gravação (evita um aparelho apagar o outro)
  xp               integer not null default 0,
  vitorias         integer not null default 0,
  derrotas         integer not null default 0,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- Sessões: o navegador guarda o código; aqui fica só o hash dele
create table if not exists zoeira.sessoes (
  token_hash text primary key,
  chave      text not null references zoeira.jogadores (chave) on delete cascade,
  criada_em  timestamptz not null default now(),
  usada_em   timestamptz not null default now()
);
create index if not exists sessoes_por_chave on zoeira.sessoes (chave, usada_em);

-- Erros de senha (para bloquear quem fica chutando)
create table if not exists zoeira.tentativas (
  chave  text not null,
  quando timestamptz not null default now()
);
create index if not exists tentativas_por_chave on zoeira.tentativas (chave, quando);

-- ADMs do jogo
create table if not exists zoeira.admins (
  chave text primary key
);

-- Torneios encerrados (o estado final, assinado pelo ADM que organizou)
create table if not exists zoeira.torneios (
  id          text primary key check (id ~ '^[a-z0-9]{4,24}$'),
  dados       jsonb not null,
  guardado_em timestamptz not null default now()
);

-- Roleta Diária: um giro grátis por dia (o sorteio é feito aqui, não no navegador)
create table if not exists zoeira.roleta (
  chave  text not null references zoeira.jogadores (chave) on delete cascade,
  dia    date not null,               -- dia do giro no horário de Brasília
  faixa  text not null,               -- onde a roleta parou: carta, reliquia, cosmetico, coins30, coins10, nada
  premio text not null,               -- o que o jogador levou: carta, reliquia, cosmetico, coins, nada
  valor  integer not null default 0,  -- Careca Coins ganhas
  carta  text,                        -- carta da Loja ganha
  quando timestamptz not null default now(),
  primary key (chave, dia)
);
alter table zoeira.roleta add column if not exists cosmetico text;  -- cosmético ganho (moldura, campo, costas)

alter table zoeira.jogadores  enable row level security;
alter table zoeira.sessoes    enable row level security;
alter table zoeira.tentativas enable row level security;
alter table zoeira.admins     enable row level security;
alter table zoeira.torneios   enable row level security;
alter table zoeira.roleta     enable row level security;

-- As contas dos ADMs já nascem reservadas: ninguém consegue "pegar" esses nicks.
-- A senha delas é definida aqui no SQL Editor (veja zoeira.definir_senha no fim).
insert into zoeira.admins (chave) values ('menonice'), ('menonfire') on conflict do nothing;
insert into zoeira.jogadores (chave, nick) values ('menonice', 'MenonICE'), ('menonfire', 'MenonFIRE') on conflict do nothing;


/* ---------- Funções internas (o site não consegue chamar) ---------- */

create or replace function zoeira.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

-- Dono da sessão (ou null). Sessão sem uso por 120 dias expira.
create or replace function zoeira.chave_da_sessao(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_chave text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  update zoeira.sessoes set usada_em = now()
   where token_hash = zoeira.hash_token(p_token)
     and usada_em > now() - interval '120 days'
  returning chave into v_chave;
  return v_chave;
end $$;

create or replace function zoeira.nova_sessao(p_chave text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into zoeira.sessoes (token_hash, chave) values (zoeira.hash_token(v_token), p_chave);
  -- no máximo 10 aparelhos conectados por conta
  delete from zoeira.sessoes s
   where s.chave = p_chave
     and s.token_hash not in (select x.token_hash from zoeira.sessoes x where x.chave = p_chave order by x.usada_em desc limit 10);
  return v_token;
end $$;

create or replace function zoeira.eh_adm(p_chave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from zoeira.admins a where a.chave = p_chave)
$$;

-- Número inteiro de um campo do perfil (0 se não for número)
create or replace function zoeira.numero(p jsonb, p_campo text) returns integer
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p -> p_campo) = 'number'
              then greatest(0, least((p ->> p_campo)::numeric, 1000000000))::integer
              else 0 end
$$;

-- O perfil sempre leva a chave e o nick certos da conta. O campo "roleta" é do servidor:
-- o que o navegador mandar ali é jogado fora (salvar_perfil põe o resumo de verdade).
create or replace function zoeira.perfil_limpo(p jsonb, p_chave text, p_nick text) returns jsonb
language sql immutable set search_path = '' as $$
  select ((case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) - 'roleta')
         || jsonb_build_object('chave', p_chave, 'nick', p_nick)
$$;

create or replace function zoeira.bloqueado(p_chave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) >= 10 from zoeira.tentativas t
   where t.chave = p_chave and t.quando > now() - interval '15 minutes'
$$;

create or replace function zoeira.errou_senha(p_chave text) returns void
language sql security definer set search_path = '' as $$
  insert into zoeira.tentativas (chave) values (p_chave);
  delete from zoeira.tentativas where quando < now() - interval '1 day';
$$;

-- Senha já derivada pelo navegador: 64 letras hexadecimais
create or replace function zoeira.senha_valida(p_senha text) returns boolean
language sql immutable set search_path = '' as $$
  select p_senha is not null and p_senha ~ '^[0-9a-f]{64}$'
$$;

-- Nick só com letras simples: a chave tem que ser o nick em minúsculas sem espaços
create or replace function zoeira.nick_confere(p_chave text, p_nick text) returns boolean
language sql immutable set search_path = '' as $$
  select p_chave ~ '^[a-z0-9_]{3,16}$'
     and char_length(btrim(coalesce(p_nick, ''))) between 3 and 16
     and (btrim(p_nick) !~ '^[A-Za-z0-9_ ]+$'
          or regexp_replace(lower(btrim(p_nick)), '[^a-z0-9_]', '', 'g') = p_chave)
$$;


/* ---------- Funções que o site chama ---------- */

-- Cria a conta (ou traz para cá uma conta antiga, já conferida no aparelho do jogador)
create or replace function public.criar_conta(p_chave text, p_nick text, p_senha text, p_perfil jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_perfil jsonb;
begin
  if not zoeira.nick_confere(p_chave, p_nick) then
    return jsonb_build_object('erro', 'nick_invalido');
  end if;
  if not zoeira.senha_valida(p_senha) then
    return jsonb_build_object('erro', 'senha_invalida');
  end if;
  if octet_length(coalesce(p_perfil, '{}'::jsonb)::text) > 200000 then
    return jsonb_build_object('erro', 'perfil_grande');
  end if;
  if exists (select 1 from zoeira.jogadores where chave = p_chave) then
    return jsonb_build_object('erro', 'nick_em_uso');
  end if;
  v_perfil := zoeira.perfil_limpo(p_perfil, p_chave, btrim(p_nick));
  insert into zoeira.jogadores (chave, nick, senha_hash, perfil, versao, xp, vitorias, derrotas)
  values (p_chave, btrim(p_nick), extensions.crypt(p_senha, extensions.gen_salt('bf', 8)), v_perfil, 1,
          zoeira.numero(v_perfil, 'xp'), zoeira.numero(v_perfil, 'vitorias'), zoeira.numero(v_perfil, 'derrotas'));
  return jsonb_build_object('token', zoeira.nova_sessao(p_chave), 'perfil', v_perfil, 'versao', 1, 'provisoria', false);
exception when unique_violation then
  return jsonb_build_object('erro', 'nick_em_uso');
end $$;

-- Quem já estava conectado no jogo antigo vem para cá sem digitar a senha: a conta nasce
-- com uma senha sorteada e marcada como provisória; o jogo pede para ele escolher uma.
-- Só funciona se o nick ainda não estiver aqui.
create or replace function public.migrar_sessao(p_chave text, p_nick text, p_perfil jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_perfil jsonb;
begin
  if not zoeira.nick_confere(p_chave, p_nick) then
    return jsonb_build_object('erro', 'nick_invalido');
  end if;
  if jsonb_typeof(p_perfil) <> 'object' or not (p_perfil ? 'avatar') then
    return jsonb_build_object('erro', 'perfil_invalido');
  end if;
  if octet_length(p_perfil::text) > 200000 then
    return jsonb_build_object('erro', 'perfil_grande');
  end if;
  if exists (select 1 from zoeira.jogadores where chave = p_chave) then
    return jsonb_build_object('erro', 'nick_em_uso');
  end if;
  v_perfil := zoeira.perfil_limpo(p_perfil, p_chave, btrim(p_nick));
  insert into zoeira.jogadores (chave, nick, senha_hash, senha_provisoria, perfil, versao, xp, vitorias, derrotas)
  values (p_chave, btrim(p_nick),
          extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 8)), true,
          v_perfil, 1, zoeira.numero(v_perfil, 'xp'), zoeira.numero(v_perfil, 'vitorias'), zoeira.numero(v_perfil, 'derrotas'));
  return jsonb_build_object('token', zoeira.nova_sessao(p_chave), 'perfil', v_perfil, 'versao', 1, 'provisoria', true);
exception when unique_violation then
  return jsonb_build_object('erro', 'nick_em_uso');
end $$;

create or replace function public.entrar(p_chave text, p_senha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j zoeira.jogadores;
begin
  if zoeira.bloqueado(p_chave) then
    return jsonb_build_object('erro', 'bloqueado');
  end if;
  select * into j from zoeira.jogadores where chave = p_chave;
  if not found then
    return jsonb_build_object('erro', 'nao_existe');
  end if;
  if j.senha_hash is null then
    return jsonb_build_object('erro', 'reservada');
  end if;
  if not zoeira.senha_valida(p_senha) or extensions.crypt(p_senha, j.senha_hash) <> j.senha_hash then
    perform zoeira.errou_senha(p_chave);
    return jsonb_build_object('erro', 'senha');
  end if;
  delete from zoeira.tentativas where chave = p_chave;
  return jsonb_build_object('token', zoeira.nova_sessao(p_chave), 'perfil', j.perfil, 'versao', j.versao,
                            'provisoria', j.senha_provisoria);
end $$;

create or replace function public.sair(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  delete from zoeira.sessoes where token_hash = zoeira.hash_token(coalesce(p_token, ''));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.meu_perfil(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j zoeira.jogadores;
begin
  select * into j from zoeira.jogadores where chave = zoeira.chave_da_sessao(p_token);
  if not found then
    return jsonb_build_object('erro', 'sessao');
  end if;
  return jsonb_build_object('perfil', j.perfil, 'versao', j.versao, 'provisoria', j.senha_provisoria,
                            'adm', zoeira.eh_adm(j.chave));
end $$;

-- Grava o perfil. p_versao é a versão que o aparelho conhece: se outro aparelho gravou
-- antes, devolve "conflito" com o perfil daqui (o jogo junta os dois e tenta de novo).
create or replace function public.salvar_perfil(p_token text, p_perfil jsonb, p_versao integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_chave text := zoeira.chave_da_sessao(p_token);
  j zoeira.jogadores;
  v_perfil jsonb;
  v_roleta jsonb;
begin
  if v_chave is null then
    return jsonb_build_object('erro', 'sessao');
  end if;
  if octet_length(coalesce(p_perfil, '{}'::jsonb)::text) > 200000 then
    return jsonb_build_object('erro', 'perfil_grande');
  end if;
  select * into j from zoeira.jogadores where chave = v_chave for update;
  if j.versao <> coalesce(p_versao, -1) then
    return jsonb_build_object('erro', 'conflito', 'perfil', j.perfil, 'versao', j.versao);
  end if;
  v_perfil := zoeira.perfil_limpo(p_perfil, j.chave, j.nick);
  v_roleta := zoeira.resumo_roleta(j.chave);
  if v_roleta is not null then
    v_perfil := v_perfil || jsonb_build_object('roleta', v_roleta);
  end if;
  update zoeira.jogadores
     set perfil = v_perfil, versao = j.versao + 1, atualizado_em = now(),
         xp = zoeira.numero(v_perfil, 'xp'), vitorias = zoeira.numero(v_perfil, 'vitorias'),
         derrotas = zoeira.numero(v_perfil, 'derrotas')
   where chave = v_chave;
  return jsonb_build_object('ok', true, 'versao', j.versao + 1);
end $$;

create or replace function public.trocar_senha(p_token text, p_atual text, p_nova text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_chave text := zoeira.chave_da_sessao(p_token);
  j zoeira.jogadores;
begin
  if v_chave is null then
    return jsonb_build_object('erro', 'sessao');
  end if;
  if zoeira.bloqueado(v_chave) then
    return jsonb_build_object('erro', 'bloqueado');
  end if;
  select * into j from zoeira.jogadores where chave = v_chave;
  -- com senha provisória (do ADM, ou conta trazida sem senha) a sessão já prova quem é:
  -- não precisa da senha atual
  if not j.senha_provisoria then
    if j.senha_hash is null or not zoeira.senha_valida(p_atual) or extensions.crypt(p_atual, j.senha_hash) <> j.senha_hash then
      perform zoeira.errou_senha(v_chave);
      return jsonb_build_object('erro', 'senha');
    end if;
  end if;
  if not zoeira.senha_valida(p_nova) then
    return jsonb_build_object('erro', 'senha_invalida');
  end if;
  update zoeira.jogadores
     set senha_hash = extensions.crypt(p_nova, extensions.gen_salt('bf', 8)), senha_provisoria = false
   where chave = v_chave;
  -- os outros aparelhos conectados saem (quem trocou a senha continua aqui)
  delete from zoeira.sessoes where chave = v_chave and token_hash <> zoeira.hash_token(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- Ranking e perfis públicos (os mesmos dados que já eram públicos no jogo)
create or replace function public.perfis_publicos()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s.perfil order by s.xp desc), '[]'::jsonb)
    from (select j.perfil, j.xp from zoeira.jogadores j
           where j.senha_hash is not null and j.perfil ? 'avatar'
           order by j.xp desc limit 1000) s
$$;

create or replace function public.perfil_publico(p_chave text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select j.perfil from zoeira.jogadores j where j.chave = p_chave and j.perfil ? 'avatar'
$$;


/* ---------- Roleta Diária ---------- */

-- 1 giro grátis por dia, que volta à meia-noite (horário de Brasília). Não dá para comprar
-- giro nem mudar as chances. O sorteio e o prêmio são feitos aqui; o perfil recebe só o
-- resumo (campo "roleta"), que o navegador não consegue alterar.
-- Chances (em 10000): carta da Loja 300 (3%), relíquia Careca do Milênio 200 (2%),
-- cosmético 500 (5%), 30 Careca Coins 1000 (10%), 10 Careca Coins 5000 (50%), nada 3000 (30%).
-- Repetido vira Careca Coins: carta (já tem todas as da Loja) 100; relíquia 50; cosmético 50.

create or replace function zoeira.hoje() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Onde a roleta para, para um número de 0 a 9999
create or replace function zoeira.faixa_da_roleta(p_numero integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_numero < 300 then 'carta'
              when p_numero < 500 then 'reliquia'
              when p_numero < 1000 then 'cosmetico'
              when p_numero < 2000 then 'coins30'
              when p_numero < 7000 then 'coins10'
              else 'nada' end
$$;

create or replace function zoeira.id_reliquia_roleta(p_chave text, p_dia date) returns text
language sql immutable set search_path = '' as $$
  select 'roleta-' || p_chave || '-' || to_char(p_dia, 'YYYYMMDD')
$$;

create or replace function zoeira.giro_json(r zoeira.roleta) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('dia', r.dia, 'faixa', r.faixa, 'premio', r.premio, 'valor', r.valor, 'carta', r.carta,
                            'cosmetico', r.cosmetico,
                            'reliquia', case when r.premio = 'reliquia' then zoeira.id_reliquia_roleta(r.chave, r.dia) end,
                            't', (extract(epoch from r.quando) * 1000)::bigint)
$$;

-- Tudo o que o jogador já ganhou na roleta (vai no perfil, campo "roleta"); null se nunca girou
create or replace function zoeira.resumo_roleta(p_chave text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 0 then null else jsonb_build_object(
           'giros', count(*),
           'coins', coalesce(sum(r.valor), 0),
           'cartas', coalesce(jsonb_agg(r.carta order by r.dia) filter (where r.premio = 'carta'), '[]'::jsonb),
           'cosmeticos', coalesce(jsonb_agg(r.cosmetico order by r.dia) filter (where r.premio = 'cosmetico'), '[]'::jsonb),
           'reliquias', coalesce(jsonb_agg(jsonb_build_object('id', zoeira.id_reliquia_roleta(r.chave, r.dia),
                                                              't', (extract(epoch from r.quando) * 1000)::bigint)
                                           order by r.dia) filter (where r.premio = 'reliquia'), '[]'::jsonb)) end
    from zoeira.roleta r where r.chave = p_chave
$$;

-- O giro do dia. p_numero (0 a 9999) é sorteado por public.girar_roleta.
create or replace function zoeira.girar(p_chave text, p_numero integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  -- cartas da Loja que a roleta pode dar (quando a Loja ganhar carta nova, acrescente aqui)
  v_loja text[] := array['chaos-kelvor-prodigio', 'black-luster-daiki', 'mago-dragao-sonho-do-big', 'miro-sulista-calvo'];
  -- cosméticos que a roleta pode dar (os mesmos de js/cosmeticos.js)
  v_cosmeticos text[] := array['moldura-viking', 'moldura-cosmica', 'moldura-dragoes', 'campo-arcano', 'verso-arcano'];
  v_cosmetico text;
  v_hoje date := zoeira.hoje();
  v_faixa text := zoeira.faixa_da_roleta(p_numero);
  j zoeira.jogadores;
  r zoeira.roleta;
  v_premio text;
  v_valor integer := 0;
  v_carta text;
  v_faltam text[];
  v_perfil jsonb;
  v_versao integer;
begin
  select * into j from zoeira.jogadores where chave = p_chave for update;
  if not found then
    return jsonb_build_object('erro', 'nao_existe');
  end if;
  select * into r from zoeira.roleta where chave = p_chave and dia = v_hoje;
  if found then
    return jsonb_build_object('erro', 'ja_girou', 'hoje', v_hoje, 'giro', zoeira.giro_json(r));
  end if;
  if v_faixa = 'carta' then
    -- uma carta da Loja que ele ainda não tem (comprada ou ganha na roleta)
    v_faltam := array(
      select c from unnest(v_loja) c
       where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(j.perfil -> 'compras') = 'array'
                                                                 then j.perfil -> 'compras' else '[]'::jsonb end) x
                          where x ->> 'carta' = c)
         and not exists (select 1 from zoeira.roleta g where g.chave = p_chave and g.carta = c));
    if cardinality(v_faltam) > 0 then
      v_premio := 'carta';
      v_carta := v_faltam[1 + floor(random() * cardinality(v_faltam))::integer];
    else
      v_premio := 'coins';
      v_valor := 100;
    end if;
  elsif v_faixa = 'reliquia' then
    -- quem já tem a Careca do Milênio (de torneio ou da roleta) leva 50 Careca Coins
    if exists (select 1 from zoeira.roleta g where g.chave = p_chave and g.premio = 'reliquia')
       or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(j.perfil -> 'premios') = 'array'
                                                          then j.perfil -> 'premios' else '[]'::jsonb end) x
                   where x ->> 'item' = 'careca-do-milenio' and x ->> 'para' = p_chave) then
      v_premio := 'coins';
      v_valor := 50;
    else
      v_premio := 'reliquia';
    end if;
  elsif v_faixa = 'cosmetico' then
    -- um cosmético que ele ainda não tem (comprado ou ganho na roleta); se já tem todos, 50 coins
    v_faltam := array(
      select c from unnest(v_cosmeticos) c
       where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(j.perfil -> 'compras') = 'array'
                                                                 then j.perfil -> 'compras' else '[]'::jsonb end) x
                          where x ->> 'cosmetico' = c)
         and not exists (select 1 from zoeira.roleta g where g.chave = p_chave and g.cosmetico = c));
    if cardinality(v_faltam) > 0 then
      v_premio := 'cosmetico';
      v_cosmetico := v_faltam[1 + floor(random() * cardinality(v_faltam))::integer];
    else
      v_premio := 'coins';
      v_valor := 50;
    end if;
  elsif v_faixa = 'coins30' then
    v_premio := 'coins';
    v_valor := 30;
  elsif v_faixa = 'coins10' then
    v_premio := 'coins';
    v_valor := 10;
  else
    v_premio := 'nada';
  end if;
  insert into zoeira.roleta (chave, dia, faixa, premio, valor, carta, cosmetico)
  values (p_chave, v_hoje, v_faixa, v_premio, v_valor, v_carta, v_cosmetico)
  returning * into r;
  v_perfil := j.perfil || jsonb_build_object('roleta', zoeira.resumo_roleta(p_chave));
  update zoeira.jogadores set perfil = v_perfil, versao = versao + 1, atualizado_em = now()
   where chave = p_chave
  returning versao into v_versao;
  return jsonb_build_object('ok', true, 'hoje', v_hoje, 'giro', zoeira.giro_json(r), 'perfil', v_perfil, 'versao', v_versao);
end $$;

-- Já girou hoje? (e o que saiu)
create or replace function public.roleta_hoje(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_chave text := zoeira.chave_da_sessao(p_token);
  r zoeira.roleta;
begin
  if v_chave is null then
    return jsonb_build_object('erro', 'sessao');
  end if;
  select * into r from zoeira.roleta where chave = v_chave and dia = zoeira.hoje();
  return jsonb_build_object('hoje', zoeira.hoje(), 'giro', case when found then zoeira.giro_json(r) end);
end $$;

create or replace function public.girar_roleta(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_chave text := zoeira.chave_da_sessao(p_token);
begin
  if v_chave is null then
    return jsonb_build_object('erro', 'sessao');
  end if;
  -- número de 0 a 9999 com bytes aleatórios do pgcrypto
  return zoeira.girar(v_chave, (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 10000)::integer);
exception when unique_violation then
  return jsonb_build_object('erro', 'ja_girou'); -- dois cliques ao mesmo tempo
end $$;


/* ---------- Funções de ADM (conferem que quem chamou é ADM) ---------- */

-- Senha provisória para quem esqueceu. Se a conta não existe aqui ainda (jogador que não
-- entrou depois da mudança), ela é criada só com a senha: o progresso vem do aparelho dele.
create or replace function public.redefinir_senha(p_token text, p_chave text, p_nick text, p_nova text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adm text := zoeira.chave_da_sessao(p_token);
begin
  if v_adm is null then
    return jsonb_build_object('erro', 'sessao');
  end if;
  if not zoeira.eh_adm(v_adm) then
    return jsonb_build_object('erro', 'nao_adm');
  end if;
  if zoeira.eh_adm(p_chave) then
    return jsonb_build_object('erro', 'alvo_adm');
  end if;
  if not zoeira.senha_valida(p_nova) then
    return jsonb_build_object('erro', 'senha_invalida');
  end if;
  update zoeira.jogadores
     set senha_hash = extensions.crypt(p_nova, extensions.gen_salt('bf', 8)), senha_provisoria = true
   where chave = p_chave;
  if found then
    delete from zoeira.sessoes where chave = p_chave;
    delete from zoeira.tentativas where chave = p_chave;
    return jsonb_build_object('ok', true, 'criada', false);
  end if;
  if not zoeira.nick_confere(p_chave, p_nick) then
    return jsonb_build_object('erro', 'nick_invalido');
  end if;
  insert into zoeira.jogadores (chave, nick, senha_hash, senha_provisoria, perfil)
  values (p_chave, btrim(p_nick), extensions.crypt(p_nova, extensions.gen_salt('bf', 8)), true,
          jsonb_build_object('chave', p_chave, 'nick', btrim(p_nick)));
  return jsonb_build_object('ok', true, 'criada', true);
end $$;

-- Apaga uma conta (ex.: alguém registrou o nick de outro jogador). Conta de ADM não.
create or replace function public.apagar_conta(p_token text, p_chave text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adm text := zoeira.chave_da_sessao(p_token);
begin
  if v_adm is null then
    return jsonb_build_object('erro', 'sessao');
  end if;
  if not zoeira.eh_adm(v_adm) then
    return jsonb_build_object('erro', 'nao_adm');
  end if;
  if zoeira.eh_adm(p_chave) then
    return jsonb_build_object('erro', 'alvo_adm');
  end if;
  delete from zoeira.jogadores where chave = p_chave;
  if not found then
    return jsonb_build_object('erro', 'nao_existe');
  end if;
  delete from zoeira.tentativas where chave = p_chave;
  return jsonb_build_object('ok', true);
end $$;

-- Troféu/relíquia ou presente de moedas (o objeto já vem assinado pelo ADM; o jogo de
-- todo mundo confere a assinatura antes de mostrar). Fica guardado no perfil do jogador.
create or replace function zoeira.adicionar_ao_perfil(p_token text, p_para text, p_campo text, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adm text := zoeira.chave_da_sessao(p_token);
  j zoeira.jogadores;
begin
  if v_adm is null then
    return jsonb_build_object('erro', 'sessao');
  end if;
  if not zoeira.eh_adm(v_adm) then
    return jsonb_build_object('erro', 'nao_adm');
  end if;
  if jsonb_typeof(p_item) <> 'object' or jsonb_typeof(p_item -> 'id') <> 'string'
     or p_item ->> 'para' is distinct from p_para or octet_length(p_item::text) > 4000 then
    return jsonb_build_object('erro', 'item_invalido');
  end if;
  select * into j from zoeira.jogadores where chave = p_para for update;
  if not found then
    return jsonb_build_object('erro', 'nao_existe');
  end if;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(j.perfil -> p_campo) = 'array'
                                                     then j.perfil -> p_campo else '[]'::jsonb end) x
              where x ->> 'id' = p_item ->> 'id') then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  update zoeira.jogadores
     set perfil = jsonb_set(perfil, array[p_campo],
                            (case when jsonb_typeof(perfil -> p_campo) = 'array' then perfil -> p_campo else '[]'::jsonb end)
                            || jsonb_build_array(p_item)),
         versao = versao + 1, atualizado_em = now()
   where chave = p_para;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dar_premio(p_token text, p_para text, p_premio jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select zoeira.adicionar_ao_perfil(p_token, p_para, 'premios', p_premio)
$$;

create or replace function public.dar_presente(p_token text, p_para text, p_presente jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select zoeira.adicionar_ao_perfil(p_token, p_para, 'presentes', p_presente)
$$;

-- Histórico de torneios
create or replace function public.guardar_torneio(p_token text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adm text := zoeira.chave_da_sessao(p_token);
begin
  if v_adm is null or not zoeira.eh_adm(v_adm) then
    return jsonb_build_object('erro', 'nao_adm');
  end if;
  if jsonb_typeof(p_dados) <> 'object' or p_dados ->> 'status' <> 'encerrado'
     or coalesce(p_dados ->> 'id', '') !~ '^[a-z0-9]{4,24}$' or octet_length(p_dados::text) > 200000 then
    return jsonb_build_object('erro', 'torneio_invalido');
  end if;
  insert into zoeira.torneios (id, dados) values (p_dados ->> 'id', p_dados)
  on conflict (id) do update set dados = excluded.dados;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.apagar_torneio(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adm text := zoeira.chave_da_sessao(p_token);
begin
  if v_adm is null or not zoeira.eh_adm(v_adm) then
    return jsonb_build_object('erro', 'nao_adm');
  end if;
  delete from zoeira.torneios where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.torneios_encerrados()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(s.dados order by s.guardado_em desc), '[]'::jsonb)
    from (select t.dados, t.guardado_em from zoeira.torneios t order by t.guardado_em desc limit 100) s
$$;


/* ---------- Só pelo SQL Editor (o site não consegue chamar) ---------- */

-- Define a senha de uma conta (para os ADMs, que nascem reservadas). Use assim:
--   select zoeira.definir_senha('menonice', 'a senha que você usa no jogo');
create or replace function zoeira.definir_senha(p_chave text, p_senha text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_derivada text := encode(extensions.hmac(p_senha, 'duelo-da-zoeira|' || p_chave, 'sha256'), 'hex');
begin
  update zoeira.jogadores
     set senha_hash = extensions.crypt(v_derivada, extensions.gen_salt('bf', 8)), senha_provisoria = false
   where chave = p_chave;
  if not found then
    return 'Conta não encontrada: ' || p_chave;
  end if;
  delete from zoeira.sessoes where chave = p_chave;
  delete from zoeira.tentativas where chave = p_chave;
  return 'Senha definida para ' || p_chave;
end $$;


/* ---------- Arrumação (roda toda vez, sem apagar nada) ---------- */

-- O resumo da roleta no perfil de cada um é sempre o que está na tabela
update zoeira.jogadores j
   set perfil = case when exists (select 1 from zoeira.roleta r where r.chave = j.chave)
                     then j.perfil || jsonb_build_object('roleta', zoeira.resumo_roleta(j.chave))
                     else j.perfil - 'roleta' end
 where j.perfil ? 'roleta' or exists (select 1 from zoeira.roleta r where r.chave = j.chave);


/* ---------- Permissões ---------- */

-- O site (anon/authenticated) não enxerga o esquema zoeira nem as funções internas
revoke all on schema zoeira from public;
revoke all on all tables in schema zoeira from public;
revoke all on all functions in schema zoeira from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema zoeira from anon, authenticated';
    execute 'revoke all on all tables in schema zoeira from anon, authenticated';
    execute 'revoke all on all functions in schema zoeira from anon, authenticated';
  end if;
end $$;

-- e só consegue chamar estas
do $$
declare
  f text;
  funcoes text[] := array[
    'public.criar_conta(text, text, text, jsonb)',
    'public.migrar_sessao(text, text, jsonb)',
    'public.entrar(text, text)',
    'public.sair(text)',
    'public.meu_perfil(text)',
    'public.salvar_perfil(text, jsonb, integer)',
    'public.trocar_senha(text, text, text)',
    'public.perfis_publicos()',
    'public.perfil_publico(text)',
    'public.redefinir_senha(text, text, text, text)',
    'public.apagar_conta(text, text)',
    'public.dar_premio(text, text, jsonb)',
    'public.dar_presente(text, text, jsonb)',
    'public.guardar_torneio(text, jsonb)',
    'public.apagar_torneio(text, text)',
    'public.torneios_encerrados()',
    'public.roleta_hoje(text)',
    'public.girar_roleta(text)'
  ];
begin
  foreach f in array funcoes loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon, authenticated', f);
    end if;
  end loop;
end $$;

-- avisa a API do Supabase que tem funções novas
notify pgrst, 'reload schema';
