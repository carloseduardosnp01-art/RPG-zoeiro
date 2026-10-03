/* ==========================================================================
   Duelo da Zoeira · js/torneio-ui.js
   Tela do torneio (janela "🏆 Torneio" no salão) e o "juiz".

   Só um ADM cria o torneio. O jogo dele é o juiz: recebe as inscrições,
   sorteia a chave, cria cada jogo quando ele aperta "Iniciar jogo", lê o
   resultado do duelo e avança a chave. Cada mudança vai assinada pelo ADM
   (ninguém consegue inventar resultado). Os jogadores só se inscrevem e
   entram sozinhos no duelo quando o jogo deles começa.

   Tópicos:  torneio/atual                       (retido, assinado pelo ADM)
             torneio/inscricao/<torneio>/<chave> (retido, pedido do jogador)
             torneio/historico/<torneio>         (retido, cópia assinada de cada torneio que terminou)
   ========================================================================== */

import { PREFIXO, publicar, assinar, lerRetido } from "./rede.js?v=202610031119";
import * as conta from "./conta.js?v=202610031119";
import * as adm from "./admin.js?v=202610031119";
import * as T from "./torneio.js?v=202610031119";
import { PREMIOS, ehReliquia } from "./premios.js?v=202610031119";
import { novoDuelo, problemaDoDeck } from "./motor.js?v=202610031119";
import { paraLista } from "./deck.js?v=202610031119";
import { topicosDuelo } from "./sessao.js?v=202610031119";
import { arenaAtiva, sessaoAtual, fecharArena } from "./arena.js?v=202610031119";
import { el, gerarId, aviso, nivelDoXp } from "./util.js?v=202610031119";
import { tocar } from "./som.js?v=202610031119";

const TOPICO = `${PREFIXO}/torneio/atual`;
const topicoInscricao = (id, chave) => `${PREFIXO}/torneio/inscricao/${id}/${chave}`;
const topicoHistorico = (id) => `${PREFIXO}/torneio/historico/${id}`;

let deps = null;          // { SID, entrarNoDuelo, avisarChat, perfis, entregarPremio }
let torneio = null;       // último estado conferido (assinado pelo ADM)
let fila = Promise.resolve(); // mudanças do juiz, uma de cada vez
const entrei = new Set(); // duelos do torneio em que eu já entrei
const entregues = new Set(); // prêmios do pódio já entregues nesta sessão ("torneio|chave|item")
const juiz = { torneio: null, cancelarInscricoes: null, duelos: new Map() };
const historico = new Map(); // torneios que já terminaram (id -> estado final assinado)
const abertos = new Set();   // torneios do histórico com a chave aberta na tela

const $ = (sel) => document.querySelector(sel);
const eu = () => conta.usuarioAtual();
const souOrganizador = () => Boolean(torneio && eu() && torneio.organizador === eu().chave && adm.souAdm(eu().chave));
const ativo = () => torneio && (torneio.status === "inscricoes" || torneio.status === "andamento");

export function iniciarTorneio(dependencias) {
  if (deps) return;
  deps = dependencias;
  assinar(TOPICO, receberTorneio);
  assinar(`${PREFIXO}/torneio/historico/+`, receberHistorico);
  // saiu de um duelo: se o próximo jogo do torneio já começou, entra nele
  document.addEventListener("arena-mudou", () => setTimeout(entrarNoMeuJogo, 300));
  $("#botao-torneio")?.addEventListener("click", () => {
    desenhar();
    bootstrap.Modal.getOrCreateInstance("#modal-torneio").show();
  });
}

// O usuário mudou (entrou, saiu, ativou o ADM): redesenha e liga/desliga o juiz
export function atualizarTorneio() {
  ligarJuiz();
  desenhar();
}

async function receberTorneio(dados) {
  if (!dados) {
    torneio = null;
    ligarJuiz();
    desenhar();
    return;
  }
  if (!(await adm.verificarTorneio(dados))) return; // não foi um ADM que publicou
  if (torneio && dados.id === torneio.id && (dados.seq || 0) <= (torneio.seq || 0)) return;
  const anterior = torneio;
  torneio = dados;
  ligarJuiz();
  desenhar();
  avisarJogador(anterior);
  entrarNoMeuJogo();
}

// Histórico: só entra torneio encerrado e com a assinatura do ADM que organizou
async function receberHistorico(dados, topico) {
  const id = topico.split("/").pop();
  if (!dados) {
    if (historico.delete(id)) desenhar();
    return;
  }
  if (dados.id !== id || dados.status !== "encerrado" || !(await adm.verificarTorneio(dados))) return;
  historico.set(id, dados);
  desenhar();
}

// O torneio já vem assinado pelo ADM, então a cópia no histórico continua valendo
function guardarNoHistorico(t) {
  publicar(topicoHistorico(t.id), t, { reter: true });
}


/* ---------- Jogador ---------- */

// Avisa quando o jogador entra na chave ou tem jogo começando
function avisarJogador(anterior) {
  const u = eu();
  if (!u || !torneio) return;
  const p = T.partidaDe(torneio, u.chave);
  const antes = anterior && anterior.id === torneio.id ? T.partidaDe(anterior, u.chave) : null;
  if (p?.jogando && p.jogando !== antes?.jogando) {
    aviso(`🏆 Seu jogo no torneio ${torneio.nome} começou!`, "ok", 6000);
    tocar("turno");
  }
}

async function entrarNoMeuJogo() {
  const u = eu();
  if (!u || !torneio || torneio.status !== "andamento") return;
  const p = T.partidaDe(torneio, u.chave);
  if (!p?.jogando || entrei.has(p.jogando)) return;
  if (arenaAtiva()) {
    // ainda está na tela do jogo anterior (que já acabou): fecha e vai para o próximo
    const atual = sessaoAtual();
    if (!atual || atual.estado.vencedor === null || !document.querySelector(".resultado")) {
      setTimeout(entrarNoMeuJogo, 2000);
      return;
    }
    fecharArena();
  }
  entrei.add(p.jogando);
  const dados = await lerRetido(topicosDuelo(p.jogando).estado, 5000);
  if (dados?.estado && dados.estado.vencedor === null && dados.estado.torneio?.id === torneio.id) {
    deps.entrarNoDuelo(dados.estado, dados.eventos || []);
  } else {
    entrei.delete(p.jogando);
  }
}

function pedirInscricao(quer) {
  const u = eu();
  if (!u || !torneio) return;
  publicar(topicoInscricao(torneio.id, u.chave), { ...conta.cartaoPublico(u), quer, t: Date.now() }, { reter: true });
  aviso(quer ? "Pedido de inscrição enviado! Seu nome aparece na lista quando o ADM confirmar." : "Você pediu para sair do torneio.", "ok");
}


/* ---------- Juiz (o ADM que organiza) ---------- */

function ligarJuiz() {
  const organizando = souOrganizador() && ativo();
  // inscrições
  if (!organizando || juiz.torneio !== torneio.id || torneio.status !== "inscricoes") {
    juiz.cancelarInscricoes?.();
    juiz.cancelarInscricoes = null;
  }
  if (organizando && torneio.status === "inscricoes" && !juiz.cancelarInscricoes) {
    juiz.cancelarInscricoes = assinar(`${PREFIXO}/torneio/inscricao/${torneio.id}/+`, receberInscricao);
  }
  juiz.torneio = organizando ? torneio.id : null;
  // duelos em andamento: acompanha o resultado
  const emJogo = new Set(organizando ? T.todasPartidas(torneio).map((p) => p.jogando).filter(Boolean) : []);
  for (const [duelo, cancelar] of juiz.duelos) {
    if (!emJogo.has(duelo)) {
      cancelar();
      juiz.duelos.delete(duelo);
    }
  }
  for (const duelo of emJogo) {
    if (!juiz.duelos.has(duelo)) juiz.duelos.set(duelo, assinar(topicosDuelo(duelo).estado, (dados) => resultadoDoDuelo(duelo, dados)));
  }
}

function receberInscricao(pedido) {
  if (!pedido || !pedido.chave || !souOrganizador()) return;
  mudar((t) => (pedido.quer ? T.inscrever(t, pedido) : T.desinscrever(t, pedido.chave)));
}

function resultadoDoDuelo(duelo, dados) {
  const e = dados?.estado;
  if (!e || e.id !== duelo || e.vencedor === null || !e.torneio || !souOrganizador()) return;
  const vencedor = e.jogadores[e.vencedor]?.chave;
  mudar((t) => T.registrarJogo(t, e.torneio.partida, duelo, vencedor, e.motivo), (antes, depois) => {
    const p = T.acharPartida(depois, e.torneio.partida);
    deps.avisarChat(`🏆 ${depois.nome}: ${T.nickNoTorneio(depois, vencedor)} venceu o jogo ${e.torneio.jogo} (${p.a.nick} ${p.va} x ${p.vb} ${p.b.nick})`);
    anunciarFim(antes, depois);
  });
}

function anunciarFim(antes, depois) {
  if (antes.status === "encerrado" || depois.status !== "encerrado") return;
  const n = (c) => (c ? T.nickNoTorneio(depois, c) : "–");
  deps.avisarChat(`🏆 ${depois.nome} terminou! 🥇 ${n(depois.podio.ouro)} · 🥈 ${n(depois.podio.prata)} · 🥉 ${n(depois.podio.bronze)}`);
}

// Muda o torneio (cópia), assina e publica. As mudanças passam numa fila, uma de cada vez.
function mudar(fn, depois) {
  fila = fila.then(async () => {
    if (!torneio || !souOrganizador()) return;
    const antes = torneio;
    const novo = structuredClone(torneio);
    delete novo.assinatura;
    if (fn(novo) === false) return;
    const assinado = await adm.assinarTorneio(novo);
    publicar(TOPICO, assinado, { reter: true });
    if (antes.status !== "encerrado" && assinado.status === "encerrado") guardarNoHistorico(assinado);
    torneio = assinado;
    ligarJuiz();
    desenhar();
    depois?.(antes, assinado);
    entrarNoMeuJogo();
  }).catch((erro) => aviso(erro.message, "erro"));
  return fila;
}

async function criar(nome) {
  const u = eu();
  if (!u || !adm.souAdm(u.chave)) return;
  if (ativo() && !confirm(`Já existe o torneio "${torneio.nome}" em andamento. Criar outro no lugar?`)) return;
  const novo = T.criarTorneio({ id: gerarId(10), nome, organizador: u.chave, organizadorNick: u.nick });
  const assinado = await adm.assinarTorneio(novo);
  publicar(TOPICO, assinado, { reter: true });
  torneio = assinado;
  ligarJuiz();
  desenhar();
  deps.avisarChat(`🏆 Inscrições abertas para o torneio ${nome}! Toque em "🏆 Torneio" no salão para participar. Partidas melhor de 3, com disputa de 3º lugar.`);
}

// Relíquia equipada do jogador (só se a assinatura do ADM conferir)
async function reliquiaDe(perfil) {
  const r = perfil?.reliquia ? conta.premiosDe(perfil).find((x) => x.id === perfil.reliquia && ehReliquia(x.item)) : null;
  return r && r.para === perfil.chave && (await adm.verificarPremio(r)) ? r : null;
}

async function iniciarJogo(p) {
  if (!T.partidaPronta(torneio, p)) return;
  const perfis = deps.perfis();
  const info = async (j) => {
    const perfil = perfis.get(j.chave) || (eu()?.chave === j.chave ? eu() : null);
    const deck = paraLista(perfil?.deck);
    return {
      chave: j.chave, nick: j.nick, tag: j.tag, avatar: j.avatar, nivel: nivelDoXp(perfil?.xp || 0),
      deck: deck.length && !problemaDoDeck(deck, { comLimite: false }) ? deck : undefined,
      reliquia: await reliquiaDe(perfil),
    };
  };
  const dueloId = `torneio-${gerarId(8)}`;
  const jogo = p.jogos.length + 1;
  const { estado, eventos } = novoDuelo({
    id: dueloId,
    jogadores: [await info(p.a), await info(p.b)],
    semente: crypto.getRandomValues(new Uint32Array(1))[0],
  });
  estado.torneio = { id: torneio.id, partida: p.id, jogo, nome: torneio.nome };
  publicar(topicosDuelo(dueloId).estado, { seq: estado.seq, estado, eventos, autor: deps.SID }, { reter: true });
  await mudar((t) => T.iniciarJogo(t, p.id, dueloId));
  deps.avisarChat(`🏆 ${torneio.nome} · ${T.nomeRodada(torneio, p.rodada)}: começou o jogo ${jogo} de ${p.a.nick} x ${p.b.nick}!`);
}


/* ---------- Tela ---------- */

function desenhar() {
  const botao = $("#botao-torneio");
  if (botao) botao.dataset.ativo = String(Boolean(ativo()));
  const corpo = $("#torneio-corpo");
  if (!corpo) return;
  corpo.replaceChildren();
  desenharAtual(corpo);
  corpo.append(secaoHistorico());
}

function desenharAtual(corpo) {
  const u = eu();
  if (!torneio || torneio.status === "cancelado") {
    corpo.append(el("p", "torneio__vazio", torneio?.status === "cancelado" ? `O torneio ${torneio.nome} foi cancelado.` : "Nenhum torneio no momento. Fique de olho no chat!"));
    if (u && adm.souAdm(u.chave)) corpo.append(formCriar());
    return;
  }
  const status = { inscricoes: "📝 Inscrições abertas", andamento: "⚔️ Em andamento", encerrado: "🏁 Encerrado" }[torneio.status];
  const topo = el("div", "torneio__topo");
  topo.append(el("h3", "torneio__nome", `🏆 ${torneio.nome}`), el("span", `torneio__status torneio__status--${torneio.status}`, status));
  corpo.append(topo, el("p", "torneio__sub", `Organizado pelo ADM ${torneio.organizadorNick || torneio.organizador} · partidas melhor de 3 · disputa de 3º lugar`));

  if (torneio.status === "inscricoes") corpo.append(telaInscricoes());
  else corpo.append(telaChave());
  if (torneio.status === "encerrado") corpo.append(telaPodio());
  if (souOrganizador()) corpo.append(botoesOrganizador());
  else if (u && adm.souAdm(u.chave) && torneio.status === "encerrado") corpo.append(formCriar());
}

function formCriar() {
  const form = el("form", "painel-adm torneio__criar");
  form.append(el("h4", "painel-adm__titulo", "👑 Criar torneio"));
  const nome = el("input", "form-control form-control-sm");
  nome.maxLength = 40;
  nome.required = true;
  nome.placeholder = "Nome (ex.: Copa Careca #1)";
  nome.setAttribute("aria-label", "Nome do torneio");
  const botao = el("button", "btn btn-sm btn-ouro", "🏆 Criar e abrir inscrições");
  botao.type = "submit";
  const linha = el("div", "torneio__linha");
  linha.append(nome, botao);
  form.append(linha);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = nome.value.trim();
    if (texto) criar(texto);
  });
  return form;
}

function chipJogador(j, extra) {
  const chip = el("span", "torneio__jogador" + (eu()?.chave === j.chave ? " torneio__jogador--eu" : ""));
  const img = el("img");
  img.src = `img/cartas/${j.avatar || "careca-feijao"}.webp`;
  img.alt = "";
  chip.append(img, `${j.tag ? `[${j.tag}] ` : ""}${j.nick}`);
  if (extra) chip.append(extra);
  return chip;
}

function telaInscricoes() {
  const sec = el("section", "torneio__secao");
  sec.append(el("h4", "torneio__titulo", `Inscritos (${torneio.inscritos.length})`));
  const lista = el("div", "torneio__inscritos");
  for (const j of torneio.inscritos) {
    let remover = null;
    if (souOrganizador()) {
      remover = el("button", "torneio__remover", "×");
      remover.type = "button";
      remover.title = `Tirar ${j.nick} do torneio`;
      remover.addEventListener("click", () => {
        publicar(topicoInscricao(torneio.id, j.chave), null, { reter: true });
        mudar((t) => T.desinscrever(t, j.chave));
      });
    }
    lista.append(chipJogador(j, remover));
  }
  if (!torneio.inscritos.length) lista.append(el("span", "torneio__vazio", "Ninguém inscrito ainda."));
  sec.append(lista);
  const u = eu();
  if (u) {
    const inscrito = torneio.inscritos.some((x) => x.chave === u.chave);
    const b = el("button", inscrito ? "btn btn-sm btn-outline-secondary" : "btn btn-sm btn-ouro", inscrito ? "Sair do torneio" : "✋ Me inscrever");
    b.type = "button";
    b.addEventListener("click", () => pedirInscricao(!inscrito));
    sec.append(b);
  } else {
    sec.append(el("p", "torneio__vazio", "Entre na sua conta no salão para se inscrever."));
  }
  return sec;
}

// ver = true: só mostra (torneio do histórico), sem os botões do organizador
function telaChave(t = torneio, ver = false) {
  const sec = el("section", "torneio__chave");
  const rodadas = [...t.rodadas.map((lista, r) => [r, lista]), ...(t.terceiro ? [["terceiro", [t.terceiro]]] : [])];
  for (const [r, lista] of rodadas) {
    const col = el("div", "torneio__rodada");
    col.append(el("h4", "torneio__titulo", T.nomeRodada(t, r)));
    for (const p of lista) col.append(cartaoPartida(p, t, ver));
    sec.append(col);
  }
  return sec;
}

function cartaoPartida(p, t = torneio, ver = false) {
  const organiza = !ver && souOrganizador();
  const u = eu();
  const minha = u && (p.a?.chave === u.chave || p.b?.chave === u.chave);
  const c = el("div", "torneio__partida" + (minha ? " torneio__partida--minha" : "") + (p.jogando ? " torneio__partida--jogando" : ""));
  const linha = (j, v) => {
    const d = el("div", "torneio__lado" + (p.vencedor && j && p.vencedor === j.chave ? " torneio__lado--venceu" : ""));
    d.append(j ? chipJogador(j) : el("span", "torneio__a-definir", p.bye ? "—" : "a definir"), el("strong", "torneio__placar", j && !p.bye ? String(v) : ""));
    return d;
  };
  c.append(linha(p.a, p.va), linha(p.b, p.vb));
  let estado;
  if (p.bye) estado = p.rodada === "terceiro" ? "Bronze direto" : "Passou direto";
  else if (p.wo && p.vencedor) estado = `W.O.: ${T.nickNoTorneio(t, p.vencedor)}`;
  else if (p.vencedor) estado = `Venceu: ${T.nickNoTorneio(t, p.vencedor)}`;
  else if (p.jogando) estado = `⚔️ Jogo ${p.jogos.length + 1} em andamento`;
  else if (p.a && p.b) estado = organiza ? `Pronta para o jogo ${p.jogos.length + 1}` : `Aguardando o ADM iniciar o jogo ${p.jogos.length + 1}`;
  else estado = "Esperando os adversários";
  c.append(el("div", "torneio__estado", estado));

  if (organiza && t.status === "andamento" && !p.vencedor && p.a && p.b) {
    const acoes = el("div", "torneio__acoes");
    const botao = (texto, classe, fn) => {
      const b = el("button", `btn btn-sm ${classe}`, texto);
      b.type = "button";
      b.addEventListener("click", fn);
      acoes.append(b);
    };
    if (T.partidaPronta(torneio, p)) botao(`▶ Iniciar jogo ${p.jogos.length + 1}`, "btn-ouro", () => iniciarJogo(p));
    if (p.jogando) {
      botao("✖ Anular jogo", "btn-outline-secondary", () => {
        if (confirm("Anular o jogo em andamento? Ele não conta e você pode iniciar de novo.")) mudar((t) => T.anularJogo(t, p.id));
      });
    }
    for (const j of [p.a, p.b]) {
      botao(`W.O. → ${j.nick}`, "btn-outline-light", () => {
        if (confirm(`Dar a partida inteira para ${j.nick} por W.O.?`)) mudar((t) => T.darWO(t, p.id, j.chave), anunciarFim);
      });
    }
    c.append(acoes);
  }
  return c;
}

function telaPodio() {
  const sec = el("section", "torneio__podio");
  sec.append(el("h4", "torneio__titulo", "Pódio"));
  const lugares = el("div", "torneio__lugares");
  for (const item of ["prata", "ouro", "bronze"]) {
    const chave = torneio.podio?.[item];
    if (!chave) continue;
    const d = el("div", `torneio__lugar torneio__lugar--${item}`);
    const img = el("img");
    img.src = PREMIOS[item].imagem;
    img.alt = PREMIOS[item].nome;
    d.append(img, el("strong", "", T.nickNoTorneio(torneio, chave)), el("span", "", PREMIOS[item].posicao));
    if (souOrganizador()) {
      const marca = `${torneio.id}|${chave}|${item}`;
      // já entregue: nesta sessão ou já aparece no perfil de quem recebeu
      const perfil = deps.perfis().get(chave) || (eu()?.chave === chave ? eu() : null);
      const noPerfil = conta.premiosDe(perfil).some((x) => x.item === item && x.torneio === torneio.nome);
      const entregar = el("button", "btn btn-sm btn-ouro", item === "ouro" ? "Entregar ouro + Careca do Milênio" : `Entregar ${PREMIOS[item].nome.toLowerCase()}`);
      entregar.type = "button";
      if (entregues.has(marca) || noPerfil) {
        entregar.disabled = true;
        entregar.textContent = "Entregue ✔";
      }
      entregar.addEventListener("click", async () => {
        if (entregues.has(marca)) return;
        entregues.add(marca);
        entregar.disabled = true;
        entregar.textContent = "Entregue ✔";
        await deps.entregarPremio(chave, item, torneio.nome);
        if (item === "ouro") await deps.entregarPremio(chave, "careca-do-milenio", torneio.nome);
      });
      d.append(entregar);
    }
    lugares.append(d);
  }
  sec.append(lugares);
  return sec;
}

function botoesOrganizador() {
  const painel = el("section", "painel-adm");
  painel.append(el("h4", "painel-adm__titulo", "👑 Você organiza este torneio"));
  if (torneio.status === "andamento" || torneio.status === "inscricoes") {
    painel.append(el("p", "painel-adm__dica", "Deixe esta página aberta durante o torneio: o seu jogo é o juiz (recebe as inscrições e confere os resultados)."));
  }
  const botoes = el("div", "d-flex flex-wrap gap-2");
  if (torneio.status === "inscricoes") {
    const sortear = el("button", "btn btn-sm btn-ouro", "🎲 Fechar inscrições e sortear a chave");
    sortear.type = "button";
    sortear.disabled = torneio.inscritos.length < 2;
    sortear.addEventListener("click", () => {
      if (!confirm(`Fechar as inscrições com ${torneio.inscritos.length} duelistas e sortear a chave?`)) return;
      mudar((t) => T.sortearChave(t, () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32), (antes, depois) => {
        deps.avisarChat(`🏆 ${depois.nome}: chave sorteada com ${depois.inscritos.length} duelistas! Veja em "🏆 Torneio".`);
        anunciarFim(antes, depois);
      });
    });
    botoes.append(sortear);
  }
  if (torneio.status !== "encerrado") {
    const cancelar = el("button", "btn btn-sm btn-outline-danger", "Cancelar torneio");
    cancelar.type = "button";
    cancelar.addEventListener("click", () => {
      if (confirm("Cancelar o torneio? Isso não dá para desfazer.")) mudar((t) => T.cancelarTorneio(t), (_, depois) => deps.avisarChat(`O torneio ${depois.nome} foi cancelado.`));
    });
    botoes.append(cancelar);
  } else {
    botoes.append(formCriar());
  }
  painel.append(botoes);
  return painel;
}


/* ---------- Histórico de torneios ---------- */

function secaoHistorico() {
  const lista = [...historico.values()].sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
  const sec = el("section", "torneio-historico");
  sec.append(el("h4", "torneio-historico__titulo", `📚 Histórico de torneios (${lista.length})`));
  // ADM: um torneio que terminou antes do histórico existir (ou cuja cópia sumiu) pode ser guardado à mão
  const u = eu();
  if (u && adm.souAdm(u.chave) && torneio?.status === "encerrado" && !historico.has(torneio.id)) {
    const guardar = el("button", "btn btn-sm btn-outline-light torneio-historico__guardar", `📚 Guardar "${torneio.nome}" no histórico`);
    guardar.type = "button";
    guardar.addEventListener("click", () => guardarNoHistorico(torneio));
    sec.append(guardar);
  }
  if (!lista.length) sec.append(el("p", "torneio__vazio", "Nenhum torneio terminado ainda. Cada torneio que acabar fica guardado aqui."));
  for (const t of lista) sec.append(itemHistorico(t));
  return sec;
}

function itemHistorico(t) {
  const item = el("article", "torneio-historico__item");
  const topo = el("div", "torneio-historico__topo");
  const quando = new Date(t.atualizado || t.criadoEm).toLocaleDateString("pt-BR");
  topo.append(
    el("strong", "torneio-historico__nome", `🏆 ${t.nome}`),
    el("span", "torneio-historico__info", `${quando} · ${t.inscritos.length} duelistas · ADM ${t.organizadorNick || t.organizador}`),
  );
  item.append(topo);

  const podio = el("div", "torneio-historico__podio");
  for (const lugar of ["ouro", "prata", "bronze"]) {
    const chave = t.podio?.[lugar];
    if (!chave) continue;
    const d = el("span", `torneio-historico__lugar torneio-historico__lugar--${lugar}`);
    const img = el("img");
    img.src = PREMIOS[lugar].imagem;
    img.alt = "";
    d.append(img, el("span", "torneio-historico__posicao", PREMIOS[lugar].posicao), el("strong", "", T.nickNoTorneio(t, chave)));
    podio.append(d);
  }
  item.append(podio);

  const acoes = el("div", "torneio-historico__acoes");
  let chave = abertos.has(t.id) ? telaChave(t, true) : null;
  const ver = el("button", "btn btn-sm btn-outline-light");
  ver.type = "button";
  const rotular = () => {
    ver.textContent = chave ? "Esconder a chave" : "Ver a chave";
    ver.setAttribute("aria-expanded", String(Boolean(chave)));
  };
  rotular();
  // abre e fecha sem redesenhar a janela (a rolagem fica onde está)
  ver.addEventListener("click", () => {
    if (chave) {
      chave.remove();
      chave = null;
      abertos.delete(t.id);
    } else {
      chave = telaChave(t, true);
      item.append(chave);
      abertos.add(t.id);
    }
    rotular();
  });
  acoes.append(ver);
  const u = eu();
  if (u && adm.souAdm(u.chave)) {
    const tirar = el("button", "btn btn-sm btn-outline-danger", "🗑 Tirar do histórico");
    tirar.type = "button";
    tirar.addEventListener("click", () => {
      if (confirm(`Tirar o torneio "${t.nome}" do histórico? Os troféus que já foram entregues continuam nos perfis.`)) {
        publicar(topicoHistorico(t.id), null, { reter: true });
      }
    });
    acoes.append(tirar);
  }
  item.append(acoes);
  if (chave) item.append(chave);
  return item;
}
