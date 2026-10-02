/* ==========================================================================
   Duelo da Zoeira · js/conta.js
   Contas dos duelistas: cadastro, login, sessão e estatísticas.

   Sem servidor próprio, a conta fica em duas mensagens retidas no broker:
     contas/<chave>  -> { chave, sal, hash }  (a senha nunca sai do navegador:
                        vai só o hash PBKDF2 com sal)
     perfis/<chave>  -> dados públicos: nick, clã, avatar, vitórias, derrotas, XP
   Uma cópia fica no navegador; se o broker "esquecer", o login republica.
   ========================================================================== */

import { PREFIXO, publicar, lerRetido } from "./rede.js?v=202610020032";
import { chaveDoNick, guardar, nivelDoXp } from "./util.js?v=202610020032";

const CHAVE_SESSAO = "zoeira-sessao";
const CHAVE_CONTAS = "zoeira-contas";
const CHAVE_RESULTADOS = "zoeira-resultados";

const topicoConta = (chave) => `${PREFIXO}/contas/${chave}`;
export const topicoPerfil = (chave) => `${PREFIXO}/perfis/${chave}`;

let usuario = null; // perfil do usuário logado
const ouvintes = new Set();

export function aoMudarUsuario(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  ouvintes.forEach((fn) => fn(usuario));
}

export const usuarioAtual = () => usuario;


/* ---------- Senha ---------- */

async function hashSenha(senha, sal) {
  if (!crypto.subtle) throw new Error("Este navegador não permite login aqui (é preciso HTTPS).");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(sal), iterations: 150000, hash: "SHA-256" },
    base,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

function novoSal() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}


/* ---------- Cadastro e login ---------- */

export function validarNick(nick) {
  const limpo = nick.trim();
  if (limpo.length < 3 || limpo.length > 16) return "O nick precisa ter de 3 a 16 caracteres.";
  if (!/^[\p{L}0-9_ ]+$/u.test(limpo)) return "Use só letras, números, espaço e _ no nick.";
  if (chaveDoNick(limpo).length < 3) return "O nick precisa ter pelo menos 3 letras ou números.";
  return null;
}

export async function criarConta({ nick, senha, tag, avatar, lembrar = true }) {
  const erro = validarNick(nick);
  if (erro) throw new Error(erro);
  if (senha.length < 4) throw new Error("A senha precisa ter pelo menos 4 caracteres.");
  const chave = chaveDoNick(nick);

  const existente = await lerRetido(topicoConta(chave));
  if (existente || contasLocais()[chave]) throw new Error("Esse nick já tem dono. Escolha outro.");

  const sal = novoSal();
  const conta = { chave, sal, hash: await hashSenha(senha, sal) };
  const perfil = {
    chave,
    nick: nick.trim(),
    tag: (tag || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4),
    avatar: avatar || "careca-feijao",
    vitorias: 0,
    derrotas: 0,
    xp: 0,
    criadoEm: Date.now(),
    atualizado: Date.now(),
  };
  publicar(topicoConta(chave), conta, { reter: true });
  publicar(topicoPerfil(chave), perfil, { reter: true });
  salvarContaLocal(conta, perfil);
  iniciarSessao(perfil, lembrar);
  return perfil;
}

export async function entrar({ nick, senha, lembrar = true }) {
  const chave = chaveDoNick(nick);
  if (!chave) throw new Error("Digite o seu nick.");
  const local = contasLocais()[chave];
  let conta = await lerRetido(topicoConta(chave));
  if (!conta && local) {
    conta = local.conta;
    publicar(topicoConta(chave), conta, { reter: true }); // o broker perdeu: republica
  }
  if (!conta) throw new Error("Conta não encontrada. Confira o nick ou crie uma conta.");
  if ((await hashSenha(senha, conta.sal)) !== conta.hash) throw new Error("Senha incorreta.");

  // Junta o perfil do broker com o do navegador (o deck mais recente e as estatísticas maiores)
  const remoto = await lerRetido(topicoPerfil(chave));
  let perfil = mesclarPerfis(local?.perfil, remoto);
  if (!perfil) perfil = { chave, nick: nick.trim(), tag: "", avatar: "careca-feijao", vitorias: 0, derrotas: 0, xp: 0, atualizado: Date.now() };
  if (JSON.stringify(perfil) !== JSON.stringify(remoto)) publicar(topicoPerfil(chave), perfil, { reter: true });

  salvarContaLocal(conta, perfil);
  iniciarSessao(perfil, lembrar);
  return perfil;
}

export function sair() {
  usuario = null;
  guardar.apagar(CHAVE_SESSAO);
  guardar.apagar(CHAVE_SESSAO, true);
  avisar();
}

// Volta a sessão salva (sem pedir a senha de novo)
export function restaurarSessao() {
  const salvo = guardar.ler(CHAVE_SESSAO, null, true) || guardar.ler(CHAVE_SESSAO);
  if (!salvo) return null;
  const local = contasLocais()[salvo.chave];
  usuario = mesclarPerfis(local?.perfil, salvo);
  avisar();
  return usuario;
}

function iniciarSessao(perfil, lembrar) {
  usuario = perfil;
  // A aba sempre guarda a sessão; "continuar conectado" também guarda no navegador
  guardar.gravar(CHAVE_SESSAO, perfil, true);
  if (lembrar) guardar.gravar(CHAVE_SESSAO, perfil);
  else guardar.apagar(CHAVE_SESSAO);
  avisar();
}


/* ---------- Mesclar cópias do perfil ---------- */

// Cada aba/aparelho tem uma cópia do perfil. Para uma cópia velha não apagar o que foi
// salvo em outro lugar: o deck vale o mais recente (deckAtualizado) e as estatísticas
// nunca diminuem.
export function mesclarPerfis(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const maisNovo = (b.atualizado || 0) > (a.atualizado || 0) ? b : a;
  const outro = maisNovo === a ? b : a;
  const perfil = { ...outro, ...maisNovo };
  const deckDe = (b.deckAtualizado || 0) > (a.deckAtualizado || 0) || (!a.deck && b.deck) ? b : a;
  perfil.deck = deckDe.deck;
  perfil.deckAtualizado = deckDe.deckAtualizado;
  perfil.vitorias = Math.max(a.vitorias || 0, b.vitorias || 0);
  perfil.derrotas = Math.max(a.derrotas || 0, b.derrotas || 0);
  perfil.xp = Math.max(a.xp || 0, b.xp || 0);
  perfil.atualizado = Math.max(a.atualizado || 0, b.atualizado || 0);
  perfil.historico = juntarHistoricos(a.historico, b.historico);
  return perfil;
}

export const HISTORICO_MAX = 10;

// Últimos duelos das duas cópias, sem repetir, do mais novo para o mais antigo
function juntarHistoricos(a = [], b = []) {
  const porId = new Map();
  for (const d of [...(a || []), ...(b || [])]) if (d && d.id) porId.set(d.id, d);
  return [...porId.values()].sort((x, y) => y.t - x.t).slice(0, HISTORICO_MAX);
}

// O salão recebe o perfil do broker (outra aba ou aparelho pode ter mudado): junta com o daqui
export function sincronizarComRemoto(remoto) {
  if (!usuario || !remoto || remoto.chave !== usuario.chave) return;
  const junto = mesclarPerfis(usuario, remoto);
  if (JSON.stringify(junto) === JSON.stringify(usuario)) return;
  usuario = junto;
  guardarLocalmente();
  // se o daqui tinha algo mais novo, devolve para o broker
  if (JSON.stringify(junto) !== JSON.stringify(remoto)) publicar(topicoPerfil(usuario.chave), usuario, { reter: true });
  avisar();
}

function guardarLocalmente() {
  const local = contasLocais()[usuario.chave];
  if (local) salvarContaLocal(local.conta, usuario);
  guardar.gravar(CHAVE_SESSAO, usuario, true);
  if (guardar.ler(CHAVE_SESSAO)) guardar.gravar(CHAVE_SESSAO, usuario);
}


/* ---------- Estatísticas ---------- */

export const XP_VITORIA = 100;
export const XP_DERROTA = 40;
export const FATOR_BOT = 0.3; // contra o bot: 30% do XP de uma partida online

// Soma o resultado de um duelo (uma vez por duelo). Devolve o XP ganho.
// contraBot: vale só 30% do XP e não conta vitória/derrota (o ranking de vitórias é só online)
// oponente: { nick, tag } para o histórico de duelos; motivo: "pl", "deck", "desistencia", "wo"
export function registrarResultado({ dueloId, venceu, contraBot = false, oponente = null, motivo = null, tipo = null }) {
  if (!usuario) return 0;
  const feitos = guardar.ler(CHAVE_RESULTADOS, []);
  if (feitos.includes(dueloId)) return 0;
  guardar.gravar(CHAVE_RESULTADOS, [...feitos.slice(-50), dueloId]);

  const base = venceu ? XP_VITORIA : XP_DERROTA;
  const ganho = contraBot ? Math.round(base * FATOR_BOT) : base;
  usuario = {
    ...usuario,
    vitorias: usuario.vitorias + (!contraBot && venceu ? 1 : 0),
    derrotas: usuario.derrotas + (!contraBot && !venceu ? 1 : 0),
    xp: usuario.xp + ganho,
    atualizado: Date.now(),
  };
  const duelo = {
    id: dueloId,
    t: Date.now(),
    venceu,
    tipo: contraBot ? "bot" : tipo || "online",
    contra: oponente ? { nick: oponente.nick, tag: oponente.tag || "", chave: oponente.chave || null } : null,
    motivo,
    xp: ganho,
  };
  usuario.historico = juntarHistoricos([duelo], usuario.historico);
  publicar(topicoPerfil(usuario.chave), usuario, { reter: true });
  guardarLocalmente();
  avisar();
  return ganho;
}

export function atualizarPerfil(mudancas) {
  if (!usuario) return;
  usuario = { ...usuario, ...mudancas, atualizado: Date.now() };
  publicar(topicoPerfil(usuario.chave), usuario, { reter: true });
  guardarLocalmente();
  avisar();
}

// Informação pública usada no chat, na presença e no duelo
export function cartaoPublico(p = usuario) {
  return { chave: p.chave, nick: p.nick, tag: p.tag || "", avatar: p.avatar, nivel: nivelDoXp(p.xp) };
}


/* ---------- Cópia local ---------- */

function contasLocais() {
  return guardar.ler(CHAVE_CONTAS, {});
}

function salvarContaLocal(conta, perfil) {
  const todas = contasLocais();
  todas[conta.chave] = { conta, perfil };
  guardar.gravar(CHAVE_CONTAS, todas);
}
