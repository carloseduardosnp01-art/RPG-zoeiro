/* ==========================================================================
   Duelo da Zoeira · js/banco.js
   Banco de dados do jogo (Supabase). Guarda o que não pode sumir: contas,
   perfis, Careca Coins, troféus e o histórico de torneios. O que é ao vivo
   (duelos, chat, quem está online) continua no servidor de mensagens (rede.js).

   O site só chama as funções de supabase/banco.sql; cada uma confere a sessão
   de quem chamou. A chave abaixo é a "publishable": feita para ficar no site.

   Onde o banco liga:
     - no site publicado (SITES abaixo) ou com ?banco=real: o Supabase de verdade;
     - com ?banco=local: um servidor de testes no computador (porta 8012);
     - no resto (localhost, testes): desligado, e o jogo usa só o modo antigo.
   ========================================================================== */

const URL_SUPABASE = "https://focumjmhrwakndesnfoh.supabase.co";
const CHAVE_PUBLICA = "sb_publishable_s5Zkvf6zNKwDdiM6Fcit6g_y3GkcjjW";
const SITES = ["carloseduardosnp01-art.github.io"];
const URL_LOCAL = "http://localhost:8012";

const pedido = new URLSearchParams(globalThis.location?.search || "").get("banco");
const BASE = pedido === "local" ? URL_LOCAL
  : pedido === "real" || SITES.includes(globalThis.location?.hostname) ? URL_SUPABASE
  : null;

export const bancoLigado = () => Boolean(BASE);

// Tempo real (chat, online, duelos): sempre o Realtime do Supabase de verdade (não existe um
// local). Com ?banco=local os canais ganham "teste-" no nome, para não misturar com o jogo.
export const configTempoReal = () => (BASE ? { url: URL_SUPABASE, chave: CHAVE_PUBLICA, prefixo: pedido === "local" ? "zoeira-teste-" : "zoeira-" } : null);

// O banco não respondeu (sem internet, projeto pausado, banco desligado...)
export class ErroBanco extends Error {}

// Chama uma função do banco. Devolve o que ela devolveu (com "erro" quando ela recusa).
export async function chamar(funcao, parametros = {}, { espera = 15000 } = {}) {
  if (!BASE) throw new ErroBanco("Banco desligado.");
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), espera);
  try {
    const resposta = await fetch(`${BASE}/rest/v1/rpc/${funcao}`, {
      method: "POST",
      headers: { apikey: CHAVE_PUBLICA, "Content-Type": "application/json" },
      body: JSON.stringify(parametros),
      signal: controle.signal,
    });
    if (!resposta.ok) throw new ErroBanco(`O servidor do jogo respondeu ${resposta.status}.`);
    return await resposta.json();
  } catch (erro) {
    throw erro instanceof ErroBanco ? erro : new ErroBanco("Não foi possível falar com o servidor do jogo.");
  } finally {
    clearTimeout(tempo);
  }
}

// O banco nunca recebe a senha: vai um código derivado dela (HMAC-SHA256 com o nick)
export async function derivarSenha(senha, chave) {
  const texto = new TextEncoder();
  const chaveHmac = await crypto.subtle.importKey("raw", texto.encode(`duelo-da-zoeira|${chave}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign("HMAC", chaveHmac, texto.encode(senha));
  return Array.from(new Uint8Array(assinatura), (b) => b.toString(16).padStart(2, "0")).join("");
}
