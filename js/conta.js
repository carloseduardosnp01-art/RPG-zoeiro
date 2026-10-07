/* ==========================================================================
   Duelo da Zoeira · js/conta.js
   Contas dos duelistas: cadastro, login, sessão e estatísticas.

   A conta e o perfil ficam no banco do jogo (Supabase, js/banco.js): só o dono
   grava o próprio perfil, com a sessão que ganha ao entrar. O banco nunca recebe
   a senha, só um código derivado dela.
   Uma cópia do perfil fica no navegador, e o perfil também vai para o servidor de
   mensagens (perfis/<chave>) para o ranking ao vivo.

   Modo antigo (reserva, se o banco não responder): a conta fica em mensagens
   retidas no broker (contas/<chave> com o hash PBKDF2). Quem entra com uma conta
   antiga é levado para o banco na hora, com a mesma senha.
   ========================================================================== */

import { PREFIXO, publicar, lerRetido } from "./rede.js?v=202610070042";
import { verificarPresente, verificarPremio } from "./admin.js?v=202610070042";
import { ehReliquia, premioRemovido } from "./premios.js?v=202610070042";
import { chaveDoNick, guardar, nivelDoXp } from "./util.js?v=202610070042";
import { bancoLigado, chamar, derivarSenha, ErroBanco } from "./banco.js?v=202610070042";
import { precoNaLoja } from "./motor.js?v=202610070042";
import { COSMETICOS, ehCosmetico, precoCosmetico, visualDe } from "./cosmeticos.js?v=202610070042";

const CHAVE_SESSAO = "zoeira-sessao";
const CHAVE_CONTAS = "zoeira-contas";
const CHAVE_RESULTADOS = "zoeira-resultados";
const CHAVE_BANCO = "zoeira-banco"; // { chave, token, versao }: a sessão no banco

const topicoConta = (chave) => `${PREFIXO}/contas/${chave}`;
export const topicoPerfil = (chave) => `${PREFIXO}/perfis/${chave}`;

let usuario = null; // perfil do usuário logado
let senhaProvisoria = false; // entrou com a senha provisória que um ADM passou
let banco = null; // { chave, token, versao } quando a conta está no banco
const ouvintes = new Set();

export function aoMudarUsuario(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  ouvintes.forEach((fn) => fn(usuario));
}

export const usuarioAtual = () => usuario;
export const temSenhaProvisoria = () => Boolean(usuario) && senhaProvisoria;
export const contaNoBanco = () => Boolean(usuario && banco?.token);

// Recados do banco para o jogador
const MENSAGENS = {
  nick_em_uso: "Esse nick já tem dono. Escolha outro.",
  nick_invalido: "Esse nick não é válido.",
  senha: "Senha incorreta.",
  senha_invalida: "Senha inválida.",
  bloqueado: "Muitas tentativas com a senha errada. Espere 15 minutos e tente de novo.",
  reservada: "Essa conta de ADM ainda não tem senha no servidor novo (defina no painel do Supabase).",
  sessao: "Sua sessão terminou. Entre de novo com seu nick e senha.",
  nao_adm: "Sua conta não tem poder de ADM no servidor.",
  alvo_adm: "A senha de um ADM só pode ser trocada pelo painel do Supabase.",
  nao_existe: "Conta não encontrada.",
  perfil_grande: "O perfil ficou grande demais para salvar.",
};
export const mensagemDoBanco = (r, padrao = "O servidor do jogo recusou.") => MENSAGENS[r?.erro] || padrao;


/* ---------- ID do jogador ---------- */

// 8 letras/números sorteados na criação da conta (ex.: "K7QX-9M2P"). É público e nunca muda.
const LETRAS_ID = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function novoIdJogador() {
  const sorteio = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => LETRAS_ID[b % LETRAS_ID.length]).join("");
  return `${sorteio.slice(0, 4)}-${sorteio.slice(4)}`;
}


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

// Confere a senha (modo antigo). Se não bater, tenta sem os espaços das pontas (sobram ao
// copiar e colar). Devolve a senha que bateu, ou null.
async function senhaQueConfere(senha, conta) {
  if ((await hashSenha(senha, conta.sal)) === conta.hash) return senha;
  const limpa = senha.trim();
  if (limpa !== senha && limpa.length > 0 && (await hashSenha(limpa, conta.sal)) === conta.hash) return limpa;
  return null;
}

// Quanto esperar o servidor ao ler uma conta (a do celular pode demorar)
const ESPERA_CONTA = 5000;

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

// Perfil novo, com tudo zerado
function perfilNovo(chave, nick, extra = {}) {
  return {
    chave, nick: nick.trim(), tag: "", avatar: "careca-feijao", id: novoIdJogador(),
    vitorias: 0, derrotas: 0, xp: 0, criadoEm: Date.now(), atualizado: Date.now(), ...extra,
  };
}

// Aviso do jogo (sem fins comerciais; nome e imagem na zoeira): a versão que o jogador
// confirmou ter lido fica no perfil. Se o texto mudar de verdade, suba a versão e todos
// confirmam de novo.
export const VERSAO_DO_AVISO = 1;
const cienteAgora = () => ({ versao: VERSAO_DO_AVISO, t: Date.now() });
export const estaCiente = (p = usuario) => (Number(p?.ciente?.versao) || 0) >= VERSAO_DO_AVISO;
export function marcarCiente() {
  if (usuario && !estaCiente()) atualizarPerfil({ ciente: cienteAgora() });
}

// O perfil que veio do banco tem conteúdo? (conta recriada por um ADM vem só com chave e nick)
const temConteudo = (p) => Boolean(p && typeof p === "object" && "avatar" in p);

export async function criarConta({ nick, senha, tag, avatar, ciente = false, lembrar = true }) {
  const erro = validarNick(nick);
  if (erro) throw new Error(erro);
  if (senha.length < 4) throw new Error("A senha precisa ter pelo menos 4 caracteres.");
  const chave = chaveDoNick(nick);

  // o nick pode estar só no servidor antigo ou neste aparelho (conta de antes do banco)
  const existente = await lerRetido(topicoConta(chave));
  if (existente || contasLocais()[chave]) throw new Error("Esse nick já tem dono. Escolha outro.");

  const perfil = perfilNovo(chave, nick, {
    tag: (tag || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4),
    avatar: avatar || "careca-feijao",
    ...(ciente ? { ciente: cienteAgora() } : {}),
  });
  if (bancoLigado()) {
    try {
      const r = await chamar("criar_conta", { p_chave: chave, p_nick: perfil.nick, p_senha: await derivarSenha(senha, chave), p_perfil: perfil });
      if (r.erro) throw new Error(mensagemDoBanco(r, "Não foi possível criar a conta."));
      definirBanco({ chave, token: r.token, versao: r.versao }, lembrar);
      salvarContaLocal(chave, null, perfil);
      iniciarSessao(perfil, lembrar);
      publicar(topicoPerfil(chave), perfil, { reter: true }); // ranking ao vivo
      return perfil;
    } catch (e) {
      if (!(e instanceof ErroBanco)) throw e;
      // banco fora do ar: cria do jeito antigo (a conta vem para o banco no próximo login)
    }
  }
  const sal = novoSal();
  const conta = { chave, sal, hash: await hashSenha(senha, sal) };
  publicar(topicoConta(chave), conta, { reter: true });
  publicar(topicoPerfil(chave), perfil, { reter: true });
  salvarContaLocal(chave, conta, perfil);
  iniciarSessao(perfil, lembrar);
  return perfil;
}

export async function entrar({ nick, senha, lembrar = true }) {
  const chave = chaveDoNick(nick);
  if (!chave) throw new Error("Digite o seu nick.");

  let r = null;
  if (bancoLigado()) {
    try {
      r = await chamar("entrar", { p_chave: chave, p_senha: await derivarSenha(senha, chave) });
      // senha colada com espaço nas pontas
      if (r.erro === "senha" && senha.trim() && senha.trim() !== senha) {
        r = await chamar("entrar", { p_chave: chave, p_senha: await derivarSenha(senha.trim(), chave) });
      }
    } catch (e) {
      if (!(e instanceof ErroBanco)) throw e;
      r = null; // banco fora do ar: entra do jeito antigo
    }
  }
  if (r?.token) return await entrarComBanco(chave, nick, r, lembrar);
  if (r?.erro && r.erro !== "nao_existe") throw new Error(mensagemDoBanco(r, "Não foi possível entrar."));

  // Conta de antes do banco (ou banco fora do ar): confere a senha do jeito antigo
  const antiga = await conferirContaAntiga(chave, nick, senha);
  if (r?.erro === "nao_existe") {
    // traz a conta para o banco, com a mesma senha
    try {
      const c = await chamar("criar_conta", {
        p_chave: chave, p_nick: antiga.perfil.nick || nick.trim(), p_senha: await derivarSenha(antiga.senha, chave), p_perfil: antiga.perfil,
      });
      if (c.token) return await entrarComBanco(chave, nick, c, lembrar, antiga.conta);
      throw new Error(c.erro === "nick_em_uso"
        ? "Esse nick já foi registrado no servidor novo por outra pessoa. Fale com um ADM."
        : mensagemDoBanco(c, "Não foi possível entrar."));
    } catch (e) {
      if (!(e instanceof ErroBanco)) throw e;
    }
  }
  // banco fora do ar (ou desligado): sessão do jeito antigo
  senhaProvisoria = Boolean(antiga.conta.provisoria);
  if (antiga.publicar) publicar(topicoPerfil(chave), antiga.perfil, { reter: true });
  salvarContaLocal(chave, antiga.conta, antiga.perfil);
  iniciarSessao(antiga.perfil, lembrar);
  return antiga.perfil;
}

// Login do modo antigo: confere a senha com o hash do broker (ou deste aparelho)
async function conferirContaAntiga(chave, nick, senha) {
  const local = contasLocais()[chave];
  // Espera o servidor com folga: no celular a resposta pode demorar, e a cópia guardada
  // neste aparelho pode estar velha (ex.: um ADM acabou de trocar a senha)
  let conta = await lerRetido(topicoConta(chave), ESPERA_CONTA);
  const doServidor = Boolean(conta);
  if (!conta && local?.conta) conta = local.conta;
  if (!conta) throw new Error("Conta não encontrada. Confira o nick ou crie uma conta.");
  const certa = await senhaQueConfere(senha, conta);
  if (!certa) {
    throw new Error(doServidor ? "Senha incorreta." : "Senha incorreta, ou o servidor demorou para responder. Confira a internet e tente de novo.");
  }
  // o broker perdeu a conta: devolve a cópia daqui (só depois de a senha conferir, e só no
  // modo antigo: com o banco, o hash não vai mais para o servidor público)
  if (!doServidor && !bancoLigado()) publicar(topicoConta(chave), conta, { reter: true });

  // Junta o perfil do broker com o do navegador (o deck mais recente e as estatísticas maiores)
  const remoto = await lerRetido(topicoPerfil(chave));
  let perfil = juntarComRemoto(local?.perfil, await limparRemoto(remoto, Boolean(local?.perfil)));
  if (!perfil) perfil = perfilNovo(chave, nick);
  if (!perfil.id) perfil = { ...perfil, id: novoIdJogador() }; // contas antigas ganham o ID no próximo login
  return { conta, perfil, senha: certa, publicar: JSON.stringify(perfil) !== JSON.stringify(remoto) };
}

// Entrou pelo banco: junta o perfil de lá com a cópia deste aparelho
async function entrarComBanco(chave, nick, r, lembrar, contaAntiga) {
  const local = contasLocais()[chave];
  const doBanco = temConteudo(r.perfil) ? r.perfil : null;
  const nome = r.perfil?.nick || doBanco?.nick || local?.perfil?.nick || nick.trim();
  // Primeira vez no banco (conta de ADM reservada ou recriada pelo ADM): junta também a cópia
  // do servidor antigo, que pode ter vindo de outro aparelho (troféus e presentes só com a
  // assinatura conferida). Só nessa vez: depois, quem vale é o banco.
  let base = local?.perfil || null;
  if (!doBanco) base = juntarComRemoto(base, await limparRemoto(await lerRetido(topicoPerfil(chave)), Boolean(base)));
  const junto = mesclarPerfis(base, doBanco);
  const perfil = { ...perfilNovo(chave, nome), ...(junto || {}), chave, nick: nome };
  senhaProvisoria = Boolean(r.provisoria);
  // a sessão do banco vem antes do resto: o salão confere a sessão assim que o usuário muda
  definirBanco({ chave, token: r.token, versao: r.versao }, lembrar);
  salvarContaLocal(chave, contaAntiga ?? local?.conta ?? null, perfil);
  iniciarSessao(perfil, lembrar);
  if (JSON.stringify(perfil) !== JSON.stringify(r.perfil)) salvarNoBanco();
  publicar(topicoPerfil(chave), perfil, { reter: true }); // ranking ao vivo
  return perfil;
}

export function sair() {
  if (banco?.token) chamar("sair", { p_token: banco.token }).catch(() => {});
  clearTimeout(timerBanco);
  banco = null;
  usuario = null;
  senhaProvisoria = false;
  guardar.apagar(CHAVE_SESSAO);
  guardar.apagar(CHAVE_SESSAO, true);
  guardar.apagar(CHAVE_BANCO);
  guardar.apagar(CHAVE_BANCO, true);
  avisar();
}

// Volta a sessão salva (sem pedir a senha de novo)
export function restaurarSessao() {
  const salvo = guardar.ler(CHAVE_SESSAO, null, true) || guardar.ler(CHAVE_SESSAO);
  if (!salvo) return null;
  const local = contasLocais()[salvo.chave];
  usuario = mesclarPerfis(local?.perfil, salvo);
  if (usuario && !usuario.id) {
    usuario = { ...usuario, id: novoIdJogador() };
    guardarLocalmente();
  }
  const sessaoBanco = guardar.ler(CHAVE_BANCO, null, true) || guardar.ler(CHAVE_BANCO);
  banco = sessaoBanco && usuario && sessaoBanco.chave === usuario.chave ? sessaoBanco : null;
  avisar();
  return usuario;
}

function definirBanco(dados, lembrar) {
  banco = dados;
  guardar.gravar(CHAVE_BANCO, banco, true);
  if (lembrar) guardar.gravar(CHAVE_BANCO, banco);
  else guardar.apagar(CHAVE_BANCO);
}

function guardarBanco() {
  if (!banco) return;
  guardar.gravar(CHAVE_BANCO, banco, true);
  if (guardar.ler(CHAVE_BANCO)) guardar.gravar(CHAVE_BANCO, banco);
}

function iniciarSessao(perfil, lembrar) {
  usuario = perfil;
  // A aba sempre guarda a sessão; "continuar conectado" também guarda no navegador
  guardar.gravar(CHAVE_SESSAO, perfil, true);
  if (lembrar) guardar.gravar(CHAVE_SESSAO, perfil);
  else guardar.apagar(CHAVE_SESSAO);
  avisar();
}


/* ---------- Esqueci a senha / trocar a senha ----------
   A senha nunca fica guardada (só o hash), então ninguém consegue "ver" a senha de
   ninguém. Quem esquece pede para um ADM: ele troca por uma senha provisória e passa
   para o dono em particular; no login o jogo avisa para trocar por uma nova. */

// conhecida: o salão já tem o perfil desse duelista (não precisa perguntar ao servidor se existe)
// Com o banco: se a conta ainda não está lá, ela é criada só com a senha provisória (o
// progresso vem do aparelho do jogador quando ele entrar). Devolve { criada }.
export async function redefinirSenha(chave, novaSenha, conhecida = false, nick = chave) {
  novaSenha = novaSenha.trim();
  if (novaSenha.length < 4) throw new Error("A senha precisa ter pelo menos 4 caracteres.");
  if (contaNoBanco()) {
    if (!conhecida && !(await chamar("perfil_publico", { p_chave: chave }))) {
      throw new Error("Conta não encontrada no servidor. Confira o nick (só o nick, sem a tag do clã).");
    }
    const r = await chamar("redefinir_senha", { p_token: banco.token, p_chave: chave, p_nick: nick, p_nova: await derivarSenha(novaSenha, chave) });
    if (r.erro) throw new Error(mensagemDoBanco(r, "Não foi possível redefinir a senha."));
    return { criada: Boolean(r.criada) };
  }
  const existe = conhecida || (await lerRetido(topicoConta(chave), ESPERA_CONTA)) || (await lerRetido(topicoPerfil(chave), ESPERA_CONTA));
  if (!existe) throw new Error("Conta não encontrada no servidor. Confira o nick (só o nick, sem a tag do clã).");
  const sal = novoSal();
  publicar(topicoConta(chave), { chave, sal, hash: await hashSenha(novaSenha, sal), provisoria: true }, { reter: true });
  return { criada: false };
}

// Com senha provisória (do ADM, ou conta trazida do jogo antigo) a senha atual não é pedida
export async function trocarSenha(senhaAtual, novaSenha) {
  if (!usuario) throw new Error("Entre na sua conta primeiro.");
  novaSenha = novaSenha.trim();
  if (novaSenha.length < 4) throw new Error("A senha nova precisa ter pelo menos 4 caracteres.");
  const chave = usuario.chave;
  if (contaNoBanco()) {
    const nova = await derivarSenha(novaSenha, chave);
    let r = await chamar("trocar_senha", { p_token: banco.token, p_atual: await derivarSenha(senhaAtual, chave), p_nova: nova });
    if (r.erro === "senha" && senhaAtual.trim() && senhaAtual.trim() !== senhaAtual) {
      r = await chamar("trocar_senha", { p_token: banco.token, p_atual: await derivarSenha(senhaAtual.trim(), chave), p_nova: nova });
    }
    if (r.erro === "sessao") expirar(MENSAGENS.sessao);
    if (r.erro) throw new Error(r.erro === "senha" ? "A senha atual não confere." : mensagemDoBanco(r));
    senhaProvisoria = false;
    avisar();
    return;
  }
  const atual = (await lerRetido(topicoConta(chave), ESPERA_CONTA)) || contasLocais()[chave]?.conta;
  if (!atual || !(await senhaQueConfere(senhaAtual, atual))) throw new Error("A senha atual não confere.");
  const sal = novoSal();
  const conta = { chave, sal, hash: await hashSenha(novaSenha, sal) };
  publicar(topicoConta(chave), conta, { reter: true });
  salvarContaLocal(chave, conta, usuario);
  senhaProvisoria = false;
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
  // os 3 decks salvos andam junto com o deck em uso (vale a cópia mais recente)
  if (deckDe.decks || deckDe.deckSlot !== undefined) {
    perfil.decks = deckDe.decks;
    perfil.deckSlot = deckDe.deckSlot;
  } else {
    delete perfil.decks;
    delete perfil.deckSlot;
  }
  // Duelos que só uma das cópias conhece (jogados em aparelhos diferentes, ou gravados ao
  // mesmo tempo): somam, em vez de valer só o maior número
  const soA = duelosSoDe(a, b);
  const soB = duelosSoDe(b, a);
  const juntar = (campo, conta) => Math.max((a[campo] || 0) + conta(soB), (b[campo] || 0) + conta(soA));
  perfil.vitorias = juntar("vitorias", (ds) => ds.filter((d) => d.tipo !== "bot" && d.venceu).length);
  perfil.derrotas = juntar("derrotas", (ds) => ds.filter((d) => d.tipo !== "bot" && !d.venceu).length);
  perfil.xp = juntar("xp", (ds) => ds.reduce((t, d) => t + (Number(d.xp) || 0), 0));
  perfil.coinsGanhas = juntar("coinsGanhas", (ds) => ds.reduce((t, d) => t + (Number(d.coins) || 0), 0));
  perfil.coinsGastas = Math.max(a.coinsGastas || 0, b.coinsGastas || 0);
  perfil.atualizado = Math.max(a.atualizado || 0, b.atualizado || 0);
  perfil.historico = juntarHistoricos(a.historico, b.historico);
  // o ID nunca muda; se dois aparelhos sortearem ao mesmo tempo, os dois escolhem o mesmo
  perfil.id = a.id && b.id ? (a.id < b.id ? a.id : b.id) : a.id || b.id;
  const porId = new Map();
  for (const x of [...presentesDe(a), ...presentesDe(b)]) porId.set(x.id, x);
  perfil.presentes = [...porId.values()].sort((x, y) => (x.t || 0) - (y.t || 0)).slice(-200);
  perfil.presentesContados = [...new Set([...contadosDe(a), ...contadosDe(b)])].slice(-300);
  const premios = new Map();
  for (const x of [...premiosDe(a), ...premiosDe(b)]) premios.set(x.id, x);
  perfil.premios = [...premios.values()].sort((x, y) => (x.t || 0) - (y.t || 0)).slice(-60);
  // compras: a mesma carta comprada nos dois aparelhos conta uma vez só
  const compras = new Map();
  for (const x of [...comprasDe(a), ...comprasDe(b)]) if (!compras.has(chaveDaCompra(x))) compras.set(chaveDaCompra(x), x);
  perfil.compras = [...compras.values()];
  // roleta: o resumo é do servidor; fica a cópia com mais giros
  if (roletaDe(a).giros || roletaDe(b).giros) perfil.roleta = (roletaDe(b).giros > roletaDe(a).giros ? b : a).roleta;
  // Reino dos Carecas: o resumo também é do servidor (moedas e troféus só aumentam)
  const pesoRanked = (p) => rankedDe(p).coins + 100000 * rankedDe(p).trofeus.length;
  if (pesoRanked(a) || pesoRanked(b)) perfil.ranked = (pesoRanked(b) > pesoRanked(a) ? b : a).ranked;
  // aviso: vale a confirmação de versão mais nova, seja de qual aparelho for
  const ciente = [a.ciente, b.ciente].filter((x) => Number(x?.versao) > 0).sort((x, y) => y.versao - x.versao)[0];
  if (ciente) perfil.ciente = ciente;
  return perfil;
}

// Troféus e relíquias: o prêmio inteiro, com a assinatura do ADM
export const premiosDe = (p) => (p?.premios || []).filter((x) => x && typeof x === "object" && x.id && typeof x.item === "string" && x.assinatura && !premioRemovido(x.id));

// Presentes guardados no perfil: o presente inteiro, com a assinatura do ADM
const presentesDe = (p) => (p?.presentes || []).filter((x) => x && typeof x === "object" && x.id && Number.isInteger(x.coins) && x.coins > 0 && x.coins <= 100000);
// Presentes da versão anterior (só o id, e as moedas já estão em coinsGanhas)
const contadosDe = (p) => [...(p?.presentesContados || []), ...(p?.presentes || []).filter((x) => typeof x === "string")];

/* ---------- Proteção contra quem mexe no perfil dos outros ----------
   O servidor de mensagens é público: qualquer um consegue publicar no perfil de outra pessoa.
   Por isso, ao juntar a cópia do servidor com a do próprio dono, nada que DIMINUA o saldo
   é aceito de lá:
     - coinsGastas vale só o do aparelho do dono (o servidor não consegue "gastar" por ele);
     - presentes só entram com a assinatura do ADM conferida (não dá para inventar);
     - a lista de presentes "já contados" vale só a do dono (não dá para bloquear um presente);
     - coinsGanhas vale o maior (do servidor só pode subir) e os presentes nunca saem.
   O dono, quando está online, republica o perfil certo por cima do que foi mexido. */
async function limparRemoto(remoto, temLocal) {
  if (!remoto) return null;
  const validos = [];
  for (const x of presentesDe(remoto)) {
    if (x.para === remoto.chave && (await verificarPresente(x))) validos.push(x);
  }
  const premios = [];
  for (const x of premiosDe(remoto)) {
    if (x.para === remoto.chave && (await verificarPremio(x))) premios.push(x);
  }
  return {
    ...remoto,
    coinsGastas: 0,
    presentes: validos,
    premios,
    // sem cópia local (primeiro login neste aparelho) não há outra fonte para os presentes antigos
    presentesContados: temLocal ? [] : contadosDe(remoto),
    // ninguém "compra" pelos outros no servidor público (gastaria as moedas deles)
    compras: temLocal ? [] : comprasDe(remoto),
    roleta: temLocal ? undefined : remoto.roleta,
    ranked: temLocal ? undefined : remoto.ranked,
  };
}

function juntarComRemoto(local, remotoLimpo) {
  const junto = mesclarPerfis(local, remotoLimpo);
  if (junto && local) {
    junto.coinsGastas = local.coinsGastas || 0;
    junto.presentesContados = contadosDe(local);
  }
  return junto;
}

export const HISTORICO_MAX = 10;

// Duelos do histórico de "a" que "b" não tem, dentro do período que o histórico de "b"
// cobre. Um duelo mais antigo que o histórico de "b" provavelmente já está somado em "b"
// (o histórico guarda só os últimos). Se "b" tem pontos mas nenhum histórico, não dá para
// saber: nada é somado (vale o maior número).
function duelosSoDe(a, b) {
  const deA = (a.historico || []).filter((d) => d && d.id);
  const deB = (b.historico || []).filter((d) => d && d.id);
  if (!deA.length) return [];
  if (!deB.length && ((b.xp || 0) > 0 || (b.vitorias || 0) + (b.derrotas || 0) > 0)) return [];
  const idsB = new Set(deB.map((d) => d.id));
  const inicioB = deB.length ? Math.min(...deB.map((d) => d.t || 0)) : -Infinity;
  return deA.filter((d) => !idsB.has(d.id) && (d.t || 0) > inicioB);
}

// Últimos duelos das duas cópias, sem repetir, do mais novo para o mais antigo
function juntarHistoricos(a = [], b = []) {
  const porId = new Map();
  for (const d of [...(a || []), ...(b || [])]) if (d && d.id) porId.set(d.id, d);
  return [...porId.values()].sort((x, y) => y.t - x.t).slice(0, HISTORICO_MAX);
}

// O salão recebe o perfil do broker (outra aba ou aparelho pode ter mudado): junta com o daqui
export async function sincronizarComRemoto(remoto) {
  if (!usuario || !remoto || remoto.chave !== usuario.chave) return;
  const limpo = await limparRemoto(remoto, true);
  if (!usuario || remoto.chave !== usuario.chave) return; // saiu da conta enquanto conferia
  const junto = juntarComRemoto(usuario, limpo);
  if (JSON.stringify(junto) === JSON.stringify(usuario)) return;
  usuario = junto;
  guardarLocalmente();
  // se o daqui tinha algo mais novo, devolve para o broker
  if (JSON.stringify(junto) !== JSON.stringify(remoto)) publicarPerfil();
  avisar();
}

// O servidor público às vezes "esquece" tudo o que guardava (perfis, contas, chat...).
// Ao entrar no salão, quem está logado confere se o seu perfil e a sua conta ainda estão
// lá; o que sumiu é devolvido a partir da cópia deste aparelho. Espera bastante pela
// resposta para não confundir "servidor lento" com "servidor esqueceu".
export async function restaurarNoServidor() {
  if (!usuario) return;
  const chave = usuario.chave;
  const [perfil, contaRemota] = await Promise.all([
    lerRetido(topicoPerfil(chave), ESPERA_RESTAURAR),
    lerRetido(topicoConta(chave), ESPERA_RESTAURAR),
  ]);
  if (!usuario || usuario.chave !== chave) return; // saiu da conta enquanto conferia
  if (!perfil) publicar(topicoPerfil(chave), usuario, { reter: true });
  const local = contasLocais()[chave]?.conta;
  if (!contaRemota && local) publicar(topicoConta(chave), local, { reter: true });
}

const ESPERA_RESTAURAR = 8000;

// Alguém apagou o meu perfil do servidor: publica de novo
export function republicarPerfil() {
  if (usuario) publicarPerfil();
}

// O perfil mudou: vai para o servidor de mensagens (ranking ao vivo) e para o banco
function publicarPerfil() {
  publicar(topicoPerfil(usuario.chave), usuario, { reter: true });
  salvarNoBanco();
}


/* ---------- Banco: gravar e conferir ---------- */

let timerBanco = null;
let gravando = false;
let gravarDeNovo = false;
const ouvintesSaida = new Set();

// Quando a sessão do banco acaba (senha trocada em outro aparelho, conta apagada...)
export function aoSairSozinho(fn) {
  ouvintesSaida.add(fn);
  return () => ouvintesSaida.delete(fn);
}

function expirar(motivo) {
  sair();
  ouvintesSaida.forEach((fn) => fn(motivo));
}

// Junta as mudanças por um instante e grava uma vez só
function salvarNoBanco(espera = 800) {
  if (!contaNoBanco()) return;
  clearTimeout(timerBanco);
  timerBanco = setTimeout(gravarNoBanco, espera);
}

async function gravarNoBanco() {
  if (!contaNoBanco()) return;
  if (gravando) {
    gravarDeNovo = true;
    return;
  }
  gravando = true;
  const chave = usuario.chave;
  try {
    // "conflito": outro aparelho gravou antes. Junta os dois perfis e tenta de novo.
    for (let tentativa = 0; tentativa < 4 && contaNoBanco() && usuario.chave === chave; tentativa++) {
      const r = await chamar("salvar_perfil", { p_token: banco.token, p_perfil: usuario, p_versao: banco.versao });
      if (!contaNoBanco() || usuario.chave !== chave) break;
      if (r.ok) {
        banco.versao = r.versao;
        guardarBanco();
        break;
      }
      if (r.erro === "conflito") {
        banco.versao = r.versao;
        guardarBanco();
        if (temConteudo(r.perfil)) {
          usuario = mesclarPerfis(usuario, r.perfil);
          guardarLocalmente();
          avisar();
        }
        continue;
      }
      if (r.erro === "sessao") expirar(MENSAGENS.sessao);
      break;
    }
  } catch (e) {
    if (!(e instanceof ErroBanco)) throw e;
    salvarNoBanco(30000); // sem conexão agora: tenta de novo daqui a pouco
  } finally {
    gravando = false;
    if (gravarDeNovo) {
      gravarDeNovo = false;
      salvarNoBanco();
    }
  }
}

// Ao abrir o salão: confere a sessão no banco e junta o perfil de lá com o daqui.
// Quem estava conectado no jogo antigo (sem sessão no banco) é levado para o banco sem
// digitar a senha, e o jogo pede para ele escolher uma.
// Devolve "banco", "migrou" (veio agora para o banco) ou "antigo" (banco desligado/fora do ar).
export async function sincronizarComBanco() {
  if (!usuario || !bancoLigado()) return "antigo";
  const chave = usuario.chave;
  try {
    if (!banco?.token) {
      // a cópia do servidor antigo pode ter algo de outro aparelho: entra junto
      const remoto = await lerRetido(topicoPerfil(chave));
      if (!usuario || usuario.chave !== chave) return "antigo";
      if (remoto) {
        usuario = juntarComRemoto(usuario, await limparRemoto(remoto, true));
        guardarLocalmente();
      }
      const r = await chamar("migrar_sessao", { p_chave: chave, p_nick: usuario.nick, p_perfil: usuario });
      if (!usuario || usuario.chave !== chave) return "antigo";
      if (r.token) {
        definirBanco({ chave, token: r.token, versao: r.versao }, Boolean(guardar.ler(CHAVE_SESSAO)));
        senhaProvisoria = true;
        avisar();
        return "migrou";
      }
      expirar(r.erro === "nick_em_uso"
        ? "Sua conta já está no servidor novo. Entre de novo com seu nick e senha (seu progresso continua salvo neste aparelho)."
        : mensagemDoBanco(r, MENSAGENS.sessao));
      return "antigo";
    }
    const r = await chamar("meu_perfil", { p_token: banco.token });
    if (!usuario || usuario.chave !== chave) return "antigo";
    if (r.erro) {
      expirar(MENSAGENS.sessao);
      return "antigo";
    }
    senhaProvisoria = Boolean(r.provisoria);
    banco.versao = r.versao;
    guardarBanco();
    const junto = mesclarPerfis(usuario, temConteudo(r.perfil) ? r.perfil : null);
    if (JSON.stringify(junto) !== JSON.stringify(usuario)) {
      usuario = junto;
      guardarLocalmente();
      avisar();
    }
    if (JSON.stringify(usuario) !== JSON.stringify(r.perfil)) salvarNoBanco(0);
    return "banco";
  } catch (e) {
    if (!(e instanceof ErroBanco)) throw e;
    return "antigo";
  }
}

// Funções do banco que precisam da sessão (ADM: troféus, presentes, torneios, apagar conta)
export async function chamarComSessao(funcao, parametros = {}) {
  if (!contaNoBanco()) throw new ErroBanco("Sem sessão no banco.");
  const r = await chamar(funcao, { p_token: banco.token, ...parametros });
  if (r?.erro === "sessao") expirar(MENSAGENS.sessao);
  return r;
}

function guardarLocalmente() {
  const local = contasLocais()[usuario.chave];
  if (local) salvarContaLocal(usuario.chave, local.conta, usuario);
  guardar.gravar(CHAVE_SESSAO, usuario, true);
  if (guardar.ler(CHAVE_SESSAO)) guardar.gravar(CHAVE_SESSAO, usuario);
}


/* ---------- Estatísticas ---------- */

export const XP_VITORIA = 100;
export const XP_DERROTA = 40;
export const FATOR_BOT = 0.3; // contra o bot: 30% do XP de uma partida online

// Careca Coins: vitória contra gente de verdade (1vs1 ou Tag 2vs2) vale 5; contra o Bot, 1.
// Saldo = ganhas nos duelos + presentes de ADM + roleta + Reino dos Carecas - gastas. Os totais só aumentam, então juntar
// cópias do perfil (outra aba, outro aparelho) pelo maior valor nunca perde nem duplica moeda.
export const COINS_VITORIA = 5;
export const COINS_VITORIA_BOT = 1;
export const saldoCoins = (p) =>
  Math.max(0, (p?.coinsGanhas || 0) + presentesDe(p).reduce((t, x) => t + x.coins, 0) + roletaDe(p).coins + rankedDe(p).coins - (p?.coinsGastas || 0)
    - comprasDe(p).reduce((t, x) => t + x.preco, 0));

/* ---------- Loja: cartas compradas com Careca Coins ---------- */

// Cada compra fica no perfil ({ carta, preco, t }) e nunca some: a carta é do jogador para sempre
// (cosméticos também: { cosmetico, preco, t })
const comprasDe = (p) => (p?.compras || []).filter((x) => x && typeof x === "object" && (typeof x.carta === "string" || typeof x.cosmetico === "string")
  && Number.isInteger(x.preco) && x.preco > 0);
const chaveDaCompra = (x) => (typeof x.carta === "string" ? x.carta : `cosmetico:${x.cosmetico}`);
export const cartasCompradas = (p = usuario) => new Set([...comprasDe(p).filter((x) => typeof x.carta === "string").map((x) => x.carta), ...roletaDe(p).cartas]);
export const cosmeticosDe = (p = usuario) => new Set([...comprasDe(p).filter((x) => typeof x.cosmetico === "string").map((x) => x.cosmetico), ...roletaDe(p).cosmeticos]
  .filter(ehCosmetico));

export function comprarCarta(id) {
  if (!usuario) throw new Error("Entre na sua conta (Salão Online) para comprar.");
  const preco = precoNaLoja(id);
  if (!preco) throw new Error("Essa carta não está à venda.");
  if (cartasCompradas().has(id)) throw new Error("Você já tem essa carta.");
  const saldo = saldoCoins(usuario);
  if (saldo < preco) throw new Error(`Faltam ${preco - saldo} Careca Coins.`);
  usuario = { ...usuario, compras: [...comprasDe(usuario), { carta: id, preco, t: Date.now() }], atualizado: Date.now() };
  publicarPerfil();
  guardarLocalmente();
  avisar();
}

/* ---------- Cosméticos (moldura, campo, costas das cartas): 50 Careca Coins cada ---------- */

export function comprarCosmetico(id) {
  if (!usuario) throw new Error("Entre na sua conta (Salão Online) para comprar.");
  const preco = precoCosmetico(id);
  if (!preco) throw new Error("Esse cosmético não existe.");
  if (cosmeticosDe().has(id)) throw new Error("Você já tem esse cosmético.");
  const saldo = saldoCoins(usuario);
  if (saldo < preco) throw new Error(`Faltam ${preco - saldo} Careca Coins.`);
  usuario = { ...usuario, compras: [...comprasDe(usuario), { cosmetico: id, preco, t: Date.now() }], atualizado: Date.now() };
  publicarPerfil();
  guardarLocalmente();
  avisar();
}

// Equipa (ou tira, com id null) a moldura, o campo ou as costas das cartas
export function equiparCosmetico(tipo, id) {
  if (!usuario || !["moldura", "campo", "verso"].includes(tipo)) return;
  if (id && (COSMETICOS[id]?.tipo !== tipo || !cosmeticosDe().has(id))) throw new Error("Você ainda não tem esse cosmético.");
  atualizarPerfil({ visual: { ...visualDe(usuario), [tipo]: id || null } });
}

// Soma o resultado de um duelo (uma vez por duelo). Devolve { xp, coins } ganhos.
// contraBot: vale só 30% do XP e não conta vitória/derrota (o ranking de vitórias é só online)
// oponente: { nick, tag } para o histórico de duelos; motivo: "pl", "deck", "desistencia", "wo"
// ranked: duelo do Reino dos Carecas (as Careca Coins dele vêm do servidor, não daqui)
export function registrarResultado({ dueloId, venceu, contraBot = false, oponente = null, motivo = null, tipo = null, ranked = false }) {
  if (!usuario) return { xp: 0, coins: 0 };
  const feitos = guardar.ler(CHAVE_RESULTADOS, []);
  if (feitos.includes(dueloId)) return { xp: 0, coins: 0 };
  guardar.gravar(CHAVE_RESULTADOS, [...feitos.slice(-50), dueloId]);

  const base = venceu ? XP_VITORIA : XP_DERROTA;
  const ganho = contraBot ? Math.round(base * FATOR_BOT) : base;
  const coins = ranked || !venceu ? 0 : contraBot ? COINS_VITORIA_BOT : COINS_VITORIA;
  usuario = {
    ...usuario,
    vitorias: usuario.vitorias + (!contraBot && venceu ? 1 : 0),
    derrotas: usuario.derrotas + (!contraBot && !venceu ? 1 : 0),
    xp: usuario.xp + ganho,
    coinsGanhas: (usuario.coinsGanhas || 0) + coins,
    atualizado: Date.now(),
  };
  const duelo = {
    id: dueloId,
    t: Date.now(),
    venceu,
    tipo: ranked ? "ranked" : contraBot ? "bot" : tipo || "online",
    contra: oponente ? { nick: oponente.nick, tag: oponente.tag || "", chave: oponente.chave || null } : null,
    motivo,
    xp: ganho,
    coins,
  };
  usuario.historico = juntarHistoricos([duelo], usuario.historico);
  publicarPerfil();
  guardarLocalmente();
  avisar();
  return { xp: ganho, coins };
}

// Presente de um ADM (já conferido pela assinatura): guarda o presente inteiro, uma vez só
export function aplicarPresente(p) {
  if (!usuario || p.para !== usuario.chave) return false;
  if (presentesDe(usuario).some((x) => x.id === p.id) || contadosDe(usuario).includes(p.id)) return false;
  usuario = {
    ...usuario,
    presentes: [...presentesDe(usuario), p].slice(-200),
    presentesContados: contadosDe(usuario),
    atualizado: Date.now(),
  };
  publicarPerfil();
  guardarLocalmente();
  avisar();
  return true;
}

// Troféu ou relíquia de um ADM (já conferido pela assinatura): guarda uma vez só
export function aplicarPremio(p) {
  if (!usuario || p.para !== usuario.chave || premioRemovido(p.id) || premiosDe(usuario).some((x) => x.id === p.id)) return false;
  usuario = { ...usuario, premios: [...premiosDe(usuario), p].slice(-60), atualizado: Date.now() };
  publicarPerfil();
  guardarLocalmente();
  avisar();
  return true;
}

/* ---------- Roleta Diária: 1 giro grátis por dia; o sorteio e o prêmio são do servidor ---------- */

// Resumo do que já saiu na roleta. Quem grava é o banco (o que o navegador mandar ali é jogado fora).
export function roletaDe(p) {
  const r = p?.roleta && typeof p.roleta === "object" ? p.roleta : {};
  return {
    giros: Number.isInteger(r.giros) && r.giros > 0 ? r.giros : 0,
    coins: Number.isInteger(r.coins) && r.coins > 0 ? r.coins : 0,
    cartas: Array.isArray(r.cartas) ? r.cartas.filter((x) => typeof x === "string") : [],
    reliquias: Array.isArray(r.reliquias) ? r.reliquias.filter((x) => x && typeof x.id === "string") : [],
    cosmeticos: Array.isArray(r.cosmeticos) ? r.cosmeticos.filter((x) => typeof x === "string") : [],
  };
}

// Relíquias da roleta no formato dos prêmios. Não têm assinatura de ADM: quem confirma é o banco.
export const reliquiasDaRoleta = (p) => roletaDe(p).reliquias.map((x) => ({
  id: x.id, item: "careca-do-milenio", para: p.chave, torneio: "🎡 Roleta Diária", t: x.t, origem: "roleta",
}));
export const todosOsPremios = (p) => [...premiosDe(p), ...reliquiasDaRoleta(p), ...rankedDe(p).trofeus.map((t) => trofeuDoRanked(t, p.chave))];

/* ---------- Reino dos Carecas (ranked): pontos, moedas e troféus são do servidor ---------- */

export function rankedDe(p) {
  const r = p?.ranked && typeof p.ranked === "object" ? p.ranked : {};
  return {
    coins: Number.isInteger(r.coins) && r.coins > 0 ? r.coins : 0,
    trofeus: Array.isArray(r.trofeus) ? r.trofeus.filter((t) => t && Number.isInteger(t.temporada) && [1, 2, 3].includes(t.posicao)) : [],
  };
}
// Troféu do top 3 de uma temporada no formato dos prêmios (quem confirma é o banco, não o ADM)
const TROFEUS_DO_REINO = ["reino-ouro", "reino-prata", "reino-bronze"];
const trofeuDoRanked = (t, chave) => ({
  id: `reino-t${t.temporada}-${chave}`, item: TROFEUS_DO_REINO[t.posicao - 1], para: chave,
  torneio: `👑 Reino dos Carecas · ${t.nome || `Temporada ${t.temporada}`}`, t: t.t || 0, origem: "ranked",
});

// O perfil que o banco devolveu depois de mexer no resumo (roleta, ranked) entra no perfil daqui
function aplicarPerfilDoBanco(chave, r) {
  if (usuario?.chave !== chave || !temConteudo(r.perfil)) return;
  banco.versao = r.versao;
  guardarBanco();
  resumosDoBanco.delete(chave);
  usuario = mesclarPerfis(usuario, r.perfil);
  guardarLocalmente();
  publicar(topicoPerfil(chave), usuario, { reter: true }); // ranking ao vivo
  if (JSON.stringify(usuario) !== JSON.stringify(r.perfil)) salvarNoBanco(0);
  avisar();
}

// Temporada aberta (com a ban list), classificação e pódio da última temporada
export const rankedTabela = () => chamar("ranked_tabela", {});
// Começa/confirma uma partida do modo (oponente null = Bot). Devolve { ok, temporada } ou { erro }.
export const rankedEntrar = (id, oponente) => chamarComSessao("ranked_entrar", { p_id: id, p_oponente: oponente || null });
// Resultado da partida: o banco soma os pontos e as moedas e devolve o perfil atualizado
export async function rankedResultado(id, venceu) {
  const chave = usuario?.chave;
  const r = await chamarComSessao("ranked_resultado", { p_id: id, p_venceu: Boolean(venceu) });
  if (r?.contado) aplicarPerfilDoBanco(chave, r);
  return r;
}
// ADM: encerrar a temporada (prêmios do top 3) e abrir a próxima; trocar a ban list
export const rankedEncerrar = (fimProxima) => chamarComSessao("ranked_encerrar", { p_fim_proxima: fimProxima || null });
export const rankedConfigurar = (banidas, fim) => chamarComSessao("ranked_configurar", { p_banidas: banidas, p_fim: fim || null });

// Resumo da roleta de um jogador direto do banco (guardado por 1 minuto)
const resumosDoBanco = new Map();
function perfilDoBanco(chave, deNovo) {
  if (!bancoLigado() || typeof chave !== "string") return Promise.resolve(null);
  if (deNovo) resumosDoBanco.delete(chave);
  let pedido = resumosDoBanco.get(chave);
  if (!pedido) {
    pedido = chamar("perfil_publico", { p_chave: chave }).catch(() => null);
    resumosDoBanco.set(chave, pedido);
    setTimeout(() => resumosDoBanco.delete(chave), 60000);
  }
  return pedido;
}
export const roletaNoBanco = (chave, { deNovo = false } = {}) => perfilDoBanco(chave, deNovo).then((p) => (p ? roletaDe(p) : null));
const rankedNoBanco = (chave) => perfilDoBanco(chave, false).then((p) => (p ? rankedDe(p) : null));

// Prêmio de verdade? O do ADM pela assinatura; a relíquia da roleta, pelo resumo no banco.
export async function premioValido(x) {
  if (!x || typeof x !== "object") return false;
  if (x.origem === "ranked") {
    const r = await rankedNoBanco(x.para);
    return Boolean(r?.trofeus.some((t) => trofeuDoRanked(t, x.para).id === x.id && TROFEUS_DO_REINO[t.posicao - 1] === x.item));
  }
  if (x.origem !== "roleta") return verificarPremio(x);
  if (x.item !== "careca-do-milenio") return false;
  return Boolean((await roletaNoBanco(x.para))?.reliquias.some((r) => r.id === x.id));
}

// Já girou hoje? { hoje, giro } (giro: null se ainda não)
export const roletaDeHoje = () => chamarComSessao("roleta_hoje");

// Gira (o banco sorteia e já grava o prêmio). Devolve { giro } ou { erro }.
export async function girarRoleta() {
  const chave = usuario?.chave;
  const r = await chamarComSessao("girar_roleta");
  if (r?.ok) aplicarPerfilDoBanco(chave, r);
  return r;
}

// Relíquia equipada (o prêmio assinado), ou null
export function reliquiaEquipada(p = usuario) {
  if (!p || !p.reliquia) return null;
  return todosOsPremios(p).find((x) => x.id === p.reliquia && ehReliquia(x.item)) || null;
}

export function equiparReliquia(id) {
  atualizarPerfil({ reliquia: id || null });
}

export function atualizarPerfil(mudancas) {
  if (!usuario) return;
  usuario = { ...usuario, ...mudancas, atualizado: Date.now() };
  publicarPerfil();
  guardarLocalmente();
  avisar();
}

// Informação pública usada no chat, na presença e no duelo
export function cartaoPublico(p = usuario) {
  const visual = visualDe(p);
  const cartao = { chave: p.chave, nick: p.nick, tag: p.tag || "", avatar: p.avatar, nivel: nivelDoXp(p.xp) };
  if (visual.moldura || visual.campo || visual.verso) cartao.visual = visual;
  return cartao;
}


/* ---------- Cópia local ---------- */

function contasLocais() {
  return guardar.ler(CHAVE_CONTAS, {});
}

function salvarContaLocal(chave, conta, perfil) {
  const todas = contasLocais();
  todas[chave] = { conta, perfil };
  guardar.gravar(CHAVE_CONTAS, todas);
}
