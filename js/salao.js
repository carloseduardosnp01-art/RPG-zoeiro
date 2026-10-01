/* ==========================================================================
   Duelo da Zoeira · js/salao.js
   Salão online: login/cadastro, chat global e privado, lista de quem está
   online, desafios (Aceitar/Recusar), perfil e ranking.

   Tópicos usados (todos começam com PREFIXO):
     presenca/<sid>    quem está online (retido; o broker apaga se a aba cair)
     chat/global       mensagens do chat global
     chat/historico    últimas mensagens (retido, para quem acabou de entrar)
     dm/<chave>        mensagens privadas e desafios para um duelista
     perfis/<chave>    perfil público (ranking)
     duelo/<id>/...    o duelo em si (ver sessao.js)
   ========================================================================== */

import { PREFIXO, conectar, publicar, assinar, lerRetido, aoStatus, modoRede } from "./rede.js?v=202610010214";
import * as conta from "./conta.js?v=202610010214";
import { novoDuelo, novoDueloTag, ehTag, versaoDasCartas, problemaDoDeck } from "./motor.js?v=202610010214";
import { deckAtual, ehDeckPadrao } from "./deck.js?v=202610010214";
import { criarSessaoOnline, criarSessaoTag, topicosDuelo } from "./sessao.js?v=202610010214";
import { abrirArena, arenaAtiva, fecharArena } from "./arena.js?v=202610010214";
import { el, gerarId, hora, aviso, guardar, nivelDoXp, progressoNivel } from "./util.js?v=202610010214";
import { tocar } from "./som.js?v=202610010214";

const SID = gerarId(12); // identifica esta aba
const T = {
  presenca: (sid) => `${PREFIXO}/presenca/${sid}`,
  presencas: `${PREFIXO}/presenca/+`,
  chat: `${PREFIXO}/chat/global`,
  historico: `${PREFIXO}/chat/historico`,
  dm: (chave) => `${PREFIXO}/dm/${chave}`,
  perfis: `${PREFIXO}/perfis/+`,
  mesas: `${PREFIXO}/mesas/+`,
  mesa: (id) => `${PREFIXO}/mesas/${id}`,
  pedidos: (id) => `${PREFIXO}/mesas/${id}/pedidos`,
};
const EMOJIS = ["😂", "😎", "😡", "😱", "💀", "🤡", "🏆", "⚔️", "🔥", "👀", "👍", "👎", "👋", "🧑‍🦲", "💨", "🪤", "🍺", "🤝"];
const PRESENCA_VALIDA = 80 * 1000;
const DUELO_ATIVO = "zoeira-duelo-ativo";

const s = {
  cartas: [],
  conectado: false,
  online: new Map(),    // sid -> presença
  perfis: new Map(),    // chave -> perfil
  abas: new Map(),      // id -> { id, titulo, chave, cartao, itens, novas }
  abaAtual: "global",
  desafios: new Map(),  // id -> { id, com, meu, estado }
  vistos: new Set(),    // ids de mensagens já mostradas
  statusDuelo: "livre",
  cancelarUsuario: [],
  batimento: null,
  ultimoEnvio: 0,
};

const $ = (sel) => document.querySelector(sel);


/* ---------- Início ---------- */

export function iniciarSalao({ cartas }) {
  s.cartas = cartas;
  s.abas.set("global", { id: "global", titulo: "Chat Global", itens: [], novas: 0 });

  montarEscolhaAvatar();
  montarEmojis();
  ligarFormularios();

  aoStatus((status) => {
    const rotulo = $("#status-conexao");
    rotulo.dataset.status = status;
    rotulo.textContent = modoRede() === "local" ? `${status} (modo local)` : status;
  });

  conta.aoMudarUsuario(atualizarUsuario);
  document.addEventListener("deck-mudou", desenharPerfil);
  conta.aoMudarUsuario(() => desenharRanking());
  setInterval(() => desenharOnline(), 10000);

  const usuario = conta.restaurarSessao();
  if (!usuario) atualizarUsuario(null);
}

// Chamado quando a tela do salão aparece
export function ativarSalao() {
  if (conta.usuarioAtual()) garantirConexao();
}

async function garantirConexao() {
  if (s.conectado) return true;
  try {
    await conectar({ sid: SID, vontade: { topico: T.presenca(SID), dados: null } });
  } catch (erro) {
    aviso(erro.message, "erro", 7000);
    return false;
  }
  if (s.conectado) return true;
  s.conectado = true;
  assinar(T.presencas, receberPresenca);
  assinar(T.chat, receberChatGlobal);
  assinar(T.perfis, receberPerfil);
  assinar(T.mesas, receberMesa);
  lerRetido(T.historico).then((lista) => {
    if (Array.isArray(lista)) lista.forEach((m) => adicionarMensagemGlobal(m, false));
  });
  addEventListener("pagehide", () => publicar(T.presenca(SID), null, { reter: true }));
  return true;
}


/* ---------- Usuário ---------- */

async function atualizarUsuario(usuario) {
  desenharBotaoConta(usuario);
  $("#painel-login").hidden = Boolean(usuario);
  $("#painel-salao").hidden = !usuario;

  // Mesmo usuário (perfil atualizado: XP, deck...): só redesenha e avisa a presença
  if (usuario && s.chaveAtual === usuario.chave && s.cancelarUsuario.length) {
    desenharPerfil();
    publicarPresenca();
    return;
  }
  s.chaveAtual = usuario ? usuario.chave : null;
  s.cancelarUsuario.forEach((c) => c());
  s.cancelarUsuario = [];
  clearInterval(s.batimento);

  if (!usuario) return;
  desenharPerfil();
  if (!(await garantirConexao()) || !conta.usuarioAtual()) return;

  s.cancelarUsuario.push(assinar(T.dm(usuario.chave), receberDM));
  publicarPresenca();
  s.batimento = setInterval(publicarPresenca, 25000);
  desenharAbas();
  desenharMensagens();
  voltarParaDueloAtivo();
}

function desenharBotaoConta(usuario) {
  const botao = $("#botao-conta");
  botao.replaceChildren();
  if (!usuario) {
    botao.className = "btn btn-sm btn-ouro";
    botao.textContent = "Entrar";
    return;
  }
  botao.className = "chip-usuario";
  const img = el("img");
  img.src = `img/cartas/${usuario.avatar}.webp`;
  img.alt = "";
  botao.append(img, usuario.nick);
  botao.title = "Ir para o salão";
}

function publicarPresenca() {
  const u = conta.usuarioAtual();
  if (!u) return;
  publicar(T.presenca(SID), { sid: SID, ...conta.cartaoPublico(u), status: s.statusDuelo, t: Date.now() }, { reter: true });
}

function mudarStatusDuelo(status) {
  s.statusDuelo = status;
  publicarPresenca();
}

function montarEscolhaAvatar() {
  const area = $("#escolha-avatar");
  s.cartas.forEach((c, i) => {
    const rotulo = el("label");
    rotulo.title = c.nome;
    const input = el("input");
    input.type = "radio";
    input.name = "avatar";
    input.value = c.id;
    input.checked = i === 0;
    input.setAttribute("aria-label", c.nome);
    const img = el("img");
    img.src = c.imagem;
    img.alt = "";
    img.loading = "lazy";
    rotulo.append(input, img);
    area.append(rotulo);
  });
}

function ligarFormularios() {
  $("#form-entrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#entrar-mensagem");
    const botao = e.submitter || e.target.querySelector("button[type=submit]");
    msg.className = "mensagem-form info";
    msg.textContent = "Conectando...";
    botao.disabled = true;
    try {
      if (!(await garantirConexao())) throw new Error("Sem conexão com o servidor do jogo.");
      await conta.entrar({ nick: $("#entrar-nick").value, senha: $("#entrar-senha").value, lembrar: $("#entrar-lembrar").checked });
      msg.textContent = "";
      e.target.reset();
      $("#entrar-lembrar").checked = true;
      tocar("turno");
    } catch (erro) {
      msg.className = "mensagem-form";
      msg.textContent = erro.message;
    } finally {
      botao.disabled = false;
    }
  });

  $("#form-criar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#criar-mensagem");
    const botao = e.submitter || e.target.querySelector("button[type=submit]");
    msg.className = "mensagem-form";
    const senha = $("#criar-senha").value;
    if (senha !== $("#criar-senha2").value) {
      msg.textContent = "As senhas não são iguais.";
      return;
    }
    const erroNick = conta.validarNick($("#criar-nick").value);
    if (erroNick) {
      msg.textContent = erroNick;
      return;
    }
    msg.className = "mensagem-form info";
    msg.textContent = "Criando a conta...";
    botao.disabled = true;
    try {
      if (!(await garantirConexao())) throw new Error("Sem conexão com o servidor do jogo.");
      const avatar = e.target.querySelector("input[name=avatar]:checked")?.value;
      await conta.criarConta({ nick: $("#criar-nick").value, senha, tag: $("#criar-tag").value, avatar });
      msg.textContent = "";
      e.target.reset();
      e.target.querySelector("input[name=avatar]").checked = true;
      aviso("Conta criada! Bem-vindo ao salão, careca. 🧑‍🦲", "ok");
      tocar("vitoria");
    } catch (erro) {
      msg.className = "mensagem-form";
      msg.textContent = erro.message;
    } finally {
      botao.disabled = false;
    }
  });

  $("#form-chat").addEventListener("submit", (e) => {
    e.preventDefault();
    enviarMensagem();
  });
  $("#campo-chat").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensagem();
    }
  });
  $("#botao-desafiar-aba").addEventListener("click", () => {
    const aba = s.abas.get(s.abaAtual);
    if (aba && aba.cartao) desafiar(aba.cartao);
  });
  $("#busca-online").addEventListener("input", desenharOnline);
}

function montarEmojis() {
  const barra = $("#barra-emojis");
  for (const emoji of EMOJIS) {
    const b = el("button", "", emoji);
    b.type = "button";
    b.setAttribute("aria-label", `Inserir ${emoji}`);
    b.addEventListener("click", () => {
      const campo = $("#campo-chat");
      campo.value += emoji;
      campo.focus();
    });
    barra.append(b);
  }
}


/* ---------- Perfil e ranking ---------- */

function desenharPerfil() {
  const u = conta.usuarioAtual();
  const area = $("#perfil");
  area.replaceChildren();
  if (!u) return;
  const topo = el("div", "perfil__topo");
  const img = el("img", "perfil__avatar");
  img.src = `img/cartas/${u.avatar}.webp`;
  img.alt = "";
  const nomes = el("div");
  const nick = el("h3", "perfil__nick");
  if (u.tag) nick.append(el("span", "tag-cla", `[${u.tag}] `));
  nick.append(botaoPerfil(u, u.nick));
  nomes.append(nick, el("div", "perfil__nivel", `Nível ${nivelDoXp(u.xp)} · ${u.xp} XP`));
  topo.append(img, nomes);

  const barra = el("div", "barra-xp");
  const cheio = el("span");
  cheio.style.width = `${progressoNivel(u.xp) * 100}%`;
  barra.append(cheio);
  barra.setAttribute("role", "img");
  barra.setAttribute("aria-label", `${Math.round(progressoNivel(u.xp) * 100)}% até o próximo nível`);

  const total = u.vitorias + u.derrotas;
  const stats = el("div", "perfil__stats");
  for (const [valor, rotulo] of [[u.vitorias, "Vitórias"], [u.derrotas, "Derrotas"], [total ? `${Math.round((u.vitorias / total) * 100)}%` : "–", "Aproveit."]]) {
    const d = el("div");
    d.append(el("strong", "", String(valor)), el("span", "", rotulo));
    stats.append(d);
  }

  const botoes = el("div", "d-grid gap-2");
  const treino = el("button", "btn btn-sm btn-outline-light", "🤖 Treinar contra o Bot");
  treino.type = "button";
  treino.dataset.treino = "";
  const sair = el("button", "btn btn-sm btn-outline-secondary", "Sair da conta");
  sair.type = "button";
  sair.addEventListener("click", () => {
    if (arenaAtiva()) {
      aviso("Termine o duelo antes de sair da conta.", "erro");
      return;
    }
    publicar(T.presenca(SID), null, { reter: true });
    conta.sair();
  });
  botoes.append(treino, sair);

  const lista = deckAtual();
  const deck = el("p", "perfil__deck", `🃏 Seu deck: ${lista.length} cartas (${ehDeckPadrao(lista) ? "padrão" : "personalizado"}) · `);
  const editar = el("a", "", "editar");
  editar.href = "#deck";
  deck.append(editar);

  // Trocar a foto de perfil (as mesmas opções do cadastro: as artes das cartas)
  const trocar = el("button", "btn btn-sm btn-outline-light", "🖼️ Trocar foto de perfil");
  trocar.type = "button";
  trocar.setAttribute("aria-expanded", "false");
  const grade = el("div", "escolha-avatar escolha-avatar--perfil");
  grade.hidden = true;
  grade.setAttribute("role", "group");
  grade.setAttribute("aria-label", "Escolha a foto de perfil");
  for (const c of s.cartas) {
    const b = el("button", "avatar-opcao");
    b.type = "button";
    b.title = c.nome;
    b.setAttribute("aria-label", c.nome);
    b.setAttribute("aria-pressed", String(c.id === u.avatar));
    const im = el("img");
    im.src = c.imagem;
    im.alt = "";
    im.loading = "lazy";
    b.append(im);
    b.addEventListener("click", () => {
      if (c.id === conta.usuarioAtual()?.avatar) return;
      conta.atualizarPerfil({ avatar: c.id }); // redesenha o perfil e avisa a presença
      aviso(`Foto de perfil trocada para ${c.nome}!`, "ok");
      tocar("carta");
    });
    grade.append(b);
  }
  trocar.addEventListener("click", () => {
    grade.hidden = !grade.hidden;
    trocar.setAttribute("aria-expanded", String(!grade.hidden));
  });
  botoes.prepend(trocar);

  area.append(topo, barra, stats, deck, botoes, grade);
}

function receberPerfil(perfil, topico) {
  const chave = topico.split("/").pop();
  if (perfil && chave === conta.usuarioAtual()?.chave) conta.sincronizarComRemoto(perfil);
  if (perfil) s.perfis.set(chave, perfil);
  else s.perfis.delete(chave);
  desenharRanking();
}

let tipoRanking = "xp";

document.addEventListener("click", (e) => {
  const aba = e.target.closest("[data-ranking]");
  if (!aba) return;
  tipoRanking = aba.dataset.ranking;
  document.querySelectorAll("[data-ranking]").forEach((b) => b.setAttribute("aria-selected", String(b === aba)));
  desenharRanking();
});

function desenharRanking() {
  const lista = $("#ranking");
  const u = conta.usuarioAtual();
  // o meu perfil sempre entra com os números mais novos
  const perfis = new Map(s.perfis);
  if (u) perfis.set(u.chave, u);
  const porXp = tipoRanking === "xp";
  const todos = [...perfis.values()]
    .filter((p) => (porXp ? (p.xp || 0) > 0 : (p.vitorias || 0) + (p.derrotas || 0) > 0))
    .sort(porXp
      ? (a, b) => (b.xp || 0) - (a.xp || 0) || (b.vitorias || 0) - (a.vitorias || 0)
      : (a, b) => (b.vitorias || 0) - (a.vitorias || 0) || (b.xp || 0) - (a.xp || 0));
  const top = todos.slice(0, 10);

  lista.replaceChildren();
  if (!top.length) {
    lista.append(el("li", "ranking__vazio", porXp ? "Ninguém fez XP ainda. Jogue uma partida e apareça aqui!" : "Ninguém venceu online ainda. Seja o primeiro careca da lista!"));
  }
  top.forEach((p, i) => {
    const li = el("li");
    if (u && p.chave === u.chave) li.classList.add("ranking__minha");
    const medalha = ["🥇", "🥈", "🥉"][i];
    if (medalha) li.dataset.medalha = medalha;
    const nome = botaoPerfil(p, `${p.tag ? `[${p.tag}] ` : ""}${p.nick}`);
    li.append(nome);
    const valor = porXp ? `Nv ${nivelDoXp(p.xp)} · ${p.xp} XP` : `${p.vitorias}V ${p.derrotas}D`;
    li.append(el("span", "ranking__v", valor));
    lista.append(li);
  });

  // a minha posição, se eu não estiver no top 10
  const eu = $("#ranking-eu");
  const pos = u ? todos.findIndex((p) => p.chave === u.chave) : -1;
  eu.textContent = pos >= 10 ? `Você está em ${pos + 1}º lugar (${porXp ? `${u.xp} XP` : `${u.vitorias}V ${u.derrotas}D`}).` : "";
}


/* ---------- Perfil de um duelista (janela) ---------- */

// Botão com o nome que abre o perfil
function botaoPerfil(cartao, texto, classe = "link-perfil") {
  const b = el("button", classe.includes("link-perfil") ? classe : `${classe} link-perfil`, texto || null);
  b.type = "button";
  b.title = `Ver o perfil de ${cartao.nick}`;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirPerfil(cartao);
  });
  return b;
}

const TEXTO_MOTIVO = { desistencia: " (desistência)", wo: " (W.O.)", deck: " (deck acabou)" };

function abrirPerfil(cartao) {
  const u = conta.usuarioAtual();
  // o perfil completo vem do broker; o meu, da conta (mais novo)
  const p = (u && cartao.chave === u.chave ? u : s.perfis.get(cartao.chave)) || { ...cartao, xp: 0, vitorias: 0, derrotas: 0 };
  const online = duelistasOnline().find((x) => x.chave === p.chave);

  const corpo = $("#perfil-jogador-corpo");
  corpo.replaceChildren();
  $("#perfil-jogador-titulo").textContent = `${p.tag ? `[${p.tag}] ` : ""}${p.nick}`;

  const topo = el("div", "pj__topo");
  const img = el("img", "pj__avatar");
  img.src = `img/cartas/${p.avatar || "careca-feijao"}.webp`;
  img.alt = "";
  const info = el("div", "pj__info");
  info.append(el("div", "pj__nivel", `Nível ${nivelDoXp(p.xp || 0)} · ${p.xp || 0} XP`));
  const barra = el("div", "barra-xp");
  const cheio = el("span");
  cheio.style.width = `${progressoNivel(p.xp || 0) * 100}%`;
  barra.append(cheio);
  info.append(barra);
  const status = online ? (online.status === "duelando" ? "🟠 Duelando agora" : "🟢 Online") : "⚫ Offline";
  info.append(el("div", "pj__status", status));
  topo.append(img, info);

  const total = (p.vitorias || 0) + (p.derrotas || 0);
  const stats = el("div", "perfil__stats");
  for (const [valor, rotulo] of [[p.vitorias || 0, "Vitórias"], [p.derrotas || 0, "Derrotas"], [total ? `${Math.round(((p.vitorias || 0) / total) * 100)}%` : "–", "Aproveit."]]) {
    const d = el("div");
    d.append(el("strong", "", String(valor)), el("span", "", rotulo));
    stats.append(d);
  }

  const historico = el("section", "pj__historico");
  historico.append(el("h3", "pj__subtitulo", "Histórico de duelos"));
  const lista = el("ol", "historico");
  for (const d of p.historico || []) {
    const li = el("li", "historico__item");
    const quando = new Date(d.t);
    li.append(el("span", "historico__data", `${quando.toLocaleDateString("pt-BR")} às ${quando.toLocaleTimeString("pt-BR")} - `));
    li.append(el("span", d.venceu ? "historico__venceu" : "historico__perdeu", d.venceu ? "Venceu" : "Perdeu"));
    li.append(d.tipo === "bot" ? " um treino contra " : d.tipo === "tag" ? " um Tag 2vs2 contra " : " um duelo contra ");
    const contra = d.contra ? `${d.contra.tag ? `[${d.contra.tag}] ` : ""}${d.contra.nick}` : "alguém";
    if (d.tipo !== "bot" && d.contra && d.contra.chave) {
      li.append(botaoPerfil({ chave: d.contra.chave, nick: d.contra.nick, tag: d.contra.tag }, contra, "historico__oponente"));
    } else {
      li.append(el("span", "historico__oponente", contra));
    }
    li.append(el("span", "historico__extra", `${TEXTO_MOTIVO[d.motivo] || ""} · +${d.xp} XP`));
    lista.append(li);
  }
  if (!(p.historico || []).length) lista.append(el("li", "historico__vazio", "Nenhum duelo registrado ainda."));
  historico.append(lista);

  corpo.append(topo, stats, historico);

  const botaoDesafiar = $("#perfil-jogador-desafiar");
  const souEu = u && p.chave === u.chave;
  botaoDesafiar.hidden = souEu || !online || online.status === "duelando";
  botaoDesafiar.onclick = () => {
    bootstrap.Modal.getOrCreateInstance("#modal-perfil").hide();
    desafiar(online);
  };

  bootstrap.Modal.getOrCreateInstance("#modal-perfil").show();
}


/* ---------- Quem está online ---------- */

function receberPresenca(dados, topico) {
  const sid = topico.split("/").pop();
  if (!dados) s.online.delete(sid);
  else s.online.set(sid, dados);
  desenharOnline();
}

// Um item por duelista (se tiver duas abas abertas, vale a mais recente)
function duelistasOnline() {
  const agora = Date.now();
  const porChave = new Map();
  for (const p of s.online.values()) {
    if (agora - p.t > PRESENCA_VALIDA) continue;
    const atual = porChave.get(p.chave);
    if (!atual || p.t > atual.t || p.status === "duelando") porChave.set(p.chave, p);
  }
  return [...porChave.values()].sort((a, b) => a.nick.localeCompare(b.nick, "pt-BR"));
}

function desenharOnline() {
  const u = conta.usuarioAtual();
  const lista = $("#lista-online");
  if (!u) return;
  const todos = duelistasOnline();
  $("#contagem-online").textContent = todos.length;
  $("#contagem-online-2").textContent = todos.length;
  const busca = $("#busca-online").value.trim().toLowerCase();
  lista.replaceChildren();
  for (const p of todos) {
    if (busca && !p.nick.toLowerCase().includes(busca)) continue;
    const li = el("li");
    const b = el("button", "usuario-online");
    b.type = "button";
    b.dataset.eu = String(p.chave === u.chave);
    b.dataset.status = p.status;
    b.setAttribute("aria-label", `${p.nick}, nível ${p.nivel}${p.status === "duelando" ? ", duelando" : ""}. Abrir opções`);
    const avatar = el("span", "avatar");
    const img = el("img");
    img.src = `img/cartas/${p.avatar}.webp`;
    img.alt = "";
    avatar.append(img, el("span", "avatar__nivel", String(p.nivel)));
    b.append(el("span", "usuario-online__bolinha"), avatar);
    if (p.tag) b.append(el("span", "tag-cla", `|${p.tag}|`));
    b.append(p.nick);
    const abrir = (ev) => {
      ev.preventDefault();
      abrirMenuDuelista(p, ev);
    };
    b.addEventListener("contextmenu", abrir);
    b.addEventListener("click", abrir);
    li.append(b);
    lista.append(li);
  }
}

let menuDuelista = null;

function fecharMenuDuelista() {
  menuDuelista?.remove();
  menuDuelista = null;
}

document.addEventListener("click", (e) => {
  if (menuDuelista && !menuDuelista.contains(e.target) && !e.target.closest(".usuario-online")) fecharMenuDuelista();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && fecharMenuDuelista());

function abrirMenuDuelista(p, ev) {
  fecharMenuDuelista();
  const u = conta.usuarioAtual();
  const souEu = p.chave === u.chave;
  const menu = el("div", "menu-contexto");
  menu.setAttribute("role", "menu");
  menu.append(el("div", "menu-contexto__titulo", `${p.tag ? `[${p.tag}] ` : ""}${p.nick} · Nível ${p.nivel}${p.status === "duelando" ? " · duelando" : ""}`));
  const opcao = (texto, fn, desativado = false) => {
    const b = el("button", "", texto);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.disabled = desativado;
    b.addEventListener("click", () => {
      fecharMenuDuelista();
      fn();
    });
    menu.append(b);
  };
  opcao("⚔️ Desafiar para duelo", () => desafiar(p), souEu || p.status === "duelando");
  opcao("💬 Mensagem privada", () => abrirAbaPrivada(p, true), souEu);
  opcao("👤 Ver perfil", () => abrirPerfil(p));
  document.body.append(menu);
  const x = ev.clientX || ev.currentTarget.getBoundingClientRect().left;
  const y = ev.clientY || ev.currentTarget.getBoundingClientRect().bottom;
  menu.style.left = `${Math.max(8, Math.min(x, document.documentElement.clientWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 12))}px`;
  menuDuelista = menu;
  menu.querySelector("button:not(:disabled)")?.focus();
}


/* ---------- Chat: abas e mensagens ---------- */

const idAbaPrivada = (chave) => `pv:${chave}`;

function abrirAbaPrivada(cartao, focar) {
  const id = idAbaPrivada(cartao.chave);
  if (!s.abas.has(id)) s.abas.set(id, { id, titulo: cartao.nick, chave: cartao.chave, cartao, itens: [], novas: 0 });
  else s.abas.get(id).cartao = cartao;
  if (focar) trocarAba(id);
  else desenharAbas();
  return s.abas.get(id);
}

function trocarAba(id) {
  s.abaAtual = id;
  const aba = s.abas.get(id);
  aba.novas = 0;
  desenharAbas();
  desenharMensagens();
  $("#campo-chat").placeholder = id === "global" ? "Mensagem para todos..." : `Mensagem para ${aba.titulo}...`;
  $("#botao-desafiar-aba").hidden = id === "global";
}

function desenharAbas() {
  const area = $("#abas-chat");
  area.replaceChildren();
  for (const aba of s.abas.values()) {
    const b = el("button", "aba-chat", aba.titulo);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(aba.id === s.abaAtual));
    b.addEventListener("click", () => trocarAba(aba.id));
    if (aba.novas) b.append(el("span", "aba-chat__novas", String(aba.novas)));
    const envolve = el("span", "d-inline-flex align-items-center");
    envolve.append(b);
    if (aba.id !== "global") {
      const x = el("button", "aba-chat__fechar", "×");
      x.type = "button";
      x.setAttribute("aria-label", `Fechar conversa com ${aba.titulo}`);
      x.addEventListener("click", () => {
        s.abas.delete(aba.id);
        if (s.abaAtual === aba.id) trocarAba("global");
        else desenharAbas();
      });
      envolve.append(x);
    }
    area.append(envolve);
  }
}

function adicionarItem(idAba, item) {
  const aba = s.abas.get(idAba);
  if (!aba) return;
  aba.itens.push(item);
  if (aba.itens.length > 120) aba.itens.shift();
  if (idAba === s.abaAtual) desenharMensagens();
  else {
    aba.novas++;
    desenharAbas();
  }
}

function desenharMensagens() {
  const area = $("#mensagens");
  const aba = s.abas.get(s.abaAtual) || s.abas.get("global");
  const noFim = area.scrollHeight - area.scrollTop - area.clientHeight < 40;
  area.replaceChildren();
  const u = conta.usuarioAtual();
  for (const item of aba.itens) {
    if (item.tipo === "sistema") {
      area.append(el("div", "msg msg--sistema", item.texto));
    } else if (item.tipo === "desafio") {
      area.append(caixaDesafio(s.desafios.get(item.id)));
    } else if (item.tipo === "mesa" && item.mesa) {
      area.append(caixaMesa(item.mesa));
    } else {
      const d = el("div", "msg" + (u && item.de.chave === u.chave ? " msg--minha" : ""));
      d.append(el("span", "msg__hora", `[${hora(item.t)}]`));
      const autor = botaoPerfil(item.de, "", "msg__autor");
      if (item.de.tag) autor.append(el("span", "tag-cla", `|${item.de.tag}| `));
      autor.append(`${item.de.nick}:`);
      d.append(autor, item.texto);
      area.append(d);
    }
  }
  if (!aba.itens.length) {
    area.append(el("p", "text-body-secondary small", aba.id === "global" ? "Ninguém falou nada ainda. Quebra o gelo aí!" : `Conversa privada com ${aba.titulo}.`));
  }
  if (noFim || aba.itens.length < 20) area.scrollTop = area.scrollHeight;
}

function receberChatGlobal(msg) {
  if (msg) adicionarMensagemGlobal(msg, true);
}

function adicionarMensagemGlobal(msg, nova) {
  if (!msg.id || s.vistos.has(msg.id)) return;
  if (msg.tipo !== "sistema" && (!msg.de || typeof msg.texto !== "string")) return;
  s.vistos.add(msg.id);
  const item = { ...msg, texto: String(msg.texto).slice(0, 300) };
  const aba = s.abas.get("global");
  // o histórico chega depois: mantém a ordem pelo horário
  aba.itens.push(item);
  aba.itens.sort((a, b) => (a.t || 0) - (b.t || 0));
  if (aba.itens.length > 120) aba.itens.shift();
  if (s.abaAtual === "global") desenharMensagens();
  else if (nova) {
    aba.novas++;
    desenharAbas();
  }
  const u = conta.usuarioAtual();
  if (nova && u && msg.de?.chave !== u.chave) tocar("mensagem");
}

function enviarMensagem() {
  const campo = $("#campo-chat");
  const texto = campo.value.trim().slice(0, 300);
  const u = conta.usuarioAtual();
  if (!texto || !u) return;
  if (Date.now() - s.ultimoEnvio < 700) {
    aviso("Calma, careca! Uma mensagem de cada vez.");
    return;
  }
  s.ultimoEnvio = Date.now();
  campo.value = "";

  if (s.abaAtual === "global") {
    enviarGlobal({ id: gerarId(), tipo: "msg", de: conta.cartaoPublico(), texto, t: Date.now() });
  } else {
    const aba = s.abas.get(s.abaAtual);
    const id = gerarId();
    enviarDM(aba.chave, { id, tipo: "msg", texto });
    s.vistos.add(id);
    adicionarItem(aba.id, { id, tipo: "msg", de: conta.cartaoPublico(), texto, t: Date.now() });
  }
}

function enviarGlobal(msg) {
  publicar(T.chat, msg);
  // Atualiza o histórico retido (últimas 40)
  const anteriores = s.abas.get("global").itens.filter((i) => i.tipo === "msg" || i.tipo === "sistema" || i.tipo === "mesa").slice(-39);
  publicar(T.historico, [...anteriores, msg], { reter: true });
}

function enviarDM(chave, dados) {
  publicar(T.dm(chave), { id: gerarId(), ...dados, de: conta.cartaoPublico(), t: Date.now() });
}

function receberDM(dados) {
  const u = conta.usuarioAtual();
  if (!dados || !dados.de || !u || dados.de.chave === u.chave) return;
  if (!dados.id || s.vistos.has(dados.id)) return;
  s.vistos.add(dados.id);

  switch (dados.tipo) {
    case "msg": {
      const aba = abrirAbaPrivada(dados.de, false);
      adicionarItem(aba.id, { id: dados.id, tipo: "msg", de: dados.de, texto: String(dados.texto).slice(0, 300), t: dados.t });
      tocar("mensagem");
      break;
    }
    case "desafio":
      receberDesafio(dados);
      break;
    case "aceite": {
      const d = s.desafios.get(dados.duelo);
      if (!d || !d.meu || d.estado !== "pendente") return;
      mudarDesafio(d, "aceito");
      comecarComoAnfitriao(d, dados.de, dados.deck);
      break;
    }
    case "recusa":
    case "cancela": {
      const d = s.desafios.get(dados.duelo);
      if (!d || d.estado !== "pendente") return;
      mudarDesafio(d, dados.tipo === "cancela" ? "cancelado" : ["ocupado", "versao"].includes(dados.motivo) ? dados.motivo : "recusado");
      break;
    }
  }
}


/* ---------- Desafios ---------- */

function desafiar(cartao) {
  const u = conta.usuarioAtual();
  if (!u || cartao.chave === u.chave) return;
  if (minhaMesa()) {
    aviso("Você está sentado numa mesa de Tag 2vs2. Saia da mesa antes de desafiar alguém.", "erro");
    return;
  }
  if (arenaAtiva()) {
    aviso("Termine (ou saia) do duelo atual antes de desafiar alguém.", "erro");
    return;
  }
  const jaTem = [...s.desafios.values()].some((d) => d.meu && d.com.chave === cartao.chave && d.estado === "pendente");
  if (jaTem) {
    aviso(`Você já desafiou ${cartao.nick}. Espere a resposta.`);
    return;
  }
  const id = gerarId(10);
  const d = { id, com: cartao, meu: true, estado: "pendente" };
  s.desafios.set(id, d);
  const aba = abrirAbaPrivada(cartao, true);
  adicionarItem(aba.id, { tipo: "desafio", id });
  enviarDM(cartao.chave, { tipo: "desafio", duelo: id, versao: versaoDasCartas() });
  d.timer = setTimeout(() => d.estado === "pendente" && mudarDesafio(d, "expirado"), 60000);
  tocar("desafio");
}

function receberDesafio(dados) {
  if (arenaAtiva() || s.statusDuelo !== "livre") {
    enviarDM(dados.de.chave, { tipo: "recusa", duelo: dados.duelo, motivo: "ocupado" });
    return;
  }
  // Versões diferentes do site (um dos dois está com a página antiga): não dá para duelar
  if (dados.versao !== versaoDasCartas()) {
    enviarDM(dados.de.chave, { tipo: "recusa", duelo: dados.duelo, motivo: "versao" });
    aviso(`${dados.de.nick} te desafiou, mas vocês estão com versões diferentes do jogo. Os dois precisam recarregar a página (Ctrl+F5 no PC ou puxar para baixo no celular).`, "erro", 12000);
    return;
  }
  const d = { id: dados.duelo, com: dados.de, meu: false, estado: "pendente" };
  s.desafios.set(d.id, d);
  const aba = abrirAbaPrivada(dados.de, location.hash === "#salao");
  adicionarItem(aba.id, { tipo: "desafio", id: d.id });
  d.timer = setTimeout(() => d.estado === "pendente" && mudarDesafio(d, "expirado"), 60000);
  tocar("desafio");
  aviso(`⚔️ ${dados.de.nick} te desafiou para um duelo! Veja no Salão Online.`, "info", 7000);
}

function mudarDesafio(d, estado) {
  d.estado = estado;
  clearTimeout(d.timer);
  desenharMensagens();
}

function caixaDesafio(d) {
  const caixa = el("div", "caixa-desafio");
  if (!d) return caixa;
  const nome = d.com.nick;
  caixa.append(el("div", "caixa-desafio__titulo", d.meu ? `Você desafiou ${nome} para um duelo!` : `${nome} te desafiou para um duelo!`));
  const textos = {
    aceito: d.meu ? "Desafio aceito! Indo para a arena..." : "Este desafio foi aceito.",
    recusado: d.meu ? `${nome} recusou o desafio.` : "Você recusou este desafio.",
    ocupado: `${nome} está ocupado em outro duelo.`,
    versao: `Vocês estão com versões diferentes do jogo. Os dois precisam recarregar a página (Ctrl+F5 no PC ou puxar para baixo no celular) e desafiar de novo.`,
    expirado: "O desafio expirou.",
    cancelado: d.meu ? "Você cancelou o desafio." : `${nome} cancelou o desafio.`,
    "sem-resposta": "O desafiante não respondeu. Tente desafiar de volta.",
  };

  if (d.estado === "pendente") {
    const botoes = el("div", "d-flex gap-2 justify-content-center");
    if (d.meu) {
      caixa.append(el("div", "caixa-desafio__estado mb-2", "Aguardando resposta..."));
      const cancelar = el("button", "btn btn-sm btn-outline-light", "Cancelar");
      cancelar.type = "button";
      cancelar.addEventListener("click", () => {
        enviarDM(d.com.chave, { tipo: "cancela", duelo: d.id });
        mudarDesafio(d, "cancelado");
      });
      botoes.append(cancelar);
    } else {
      const aceitar = el("button", "btn btn-sm btn-success", "Aceitar");
      aceitar.type = "button";
      aceitar.addEventListener("click", () => aceitarDesafio(d));
      const recusar = el("button", "btn btn-sm btn-danger", "Recusar");
      recusar.type = "button";
      recusar.addEventListener("click", () => {
        enviarDM(d.com.chave, { tipo: "recusa", duelo: d.id });
        mudarDesafio(d, "recusado");
      });
      botoes.append(aceitar, recusar);
    }
    caixa.append(botoes);
  } else {
    caixa.append(el("div", "caixa-desafio__estado", textos[d.estado] || ""));
  }
  return caixa;
}

function aceitarDesafio(d) {
  if (arenaAtiva()) {
    aviso("Saia do duelo atual antes de aceitar outro.", "erro");
    return;
  }
  mudarDesafio(d, "aceito");
  mudarStatusDuelo("aguardando");
  enviarDM(d.com.chave, { tipo: "aceite", duelo: d.id, deck: deckAtual() });

  // O desafiante cria o duelo e publica o estado inicial
  let cancelar = () => {};
  const limite = setTimeout(() => {
    cancelar();
    mudarDesafio(d, "sem-resposta");
    mudarStatusDuelo("livre");
  }, 15000);
  cancelar = assinar(topicosDuelo(d.id).estado, (dados) => {
    if (!dados || !dados.estado) return;
    clearTimeout(limite);
    setTimeout(() => cancelar(), 0);
    entrarNoDuelo(dados.estado, dados.eventos || []);
  });
}

// Quem desafiou cria o duelo: cada um joga com o próprio deck (o motor confere se vale)
function comecarComoAnfitriao(d, oponente, deckOponente) {
  if (!Array.isArray(deckOponente) || problemaDoDeck(deckOponente, { comLimite: false })) {
    aviso(`O deck de ${oponente.nick} não veio certo; ele vai jogar com o deck padrão. Se continuar, recarreguem a página.`, "erro", 9000);
  }
  const { estado, eventos } = novoDuelo({
    id: d.id,
    jogadores: [{ ...conta.cartaoPublico(), deck: deckAtual() }, { ...oponente, deck: Array.isArray(deckOponente) ? deckOponente : undefined }],
    semente: crypto.getRandomValues(new Uint32Array(1))[0],
  });
  publicar(topicosDuelo(d.id).estado, { seq: estado.seq, estado, eventos, autor: SID }, { reter: true });
  entrarNoDuelo(estado, eventos);
}

function entrarNoDuelo(estado, eventos) {
  const u = conta.usuarioAtual();
  if (!u || arenaAtiva()) return;
  if (ehTag(estado)) {
    entrarNoTag(estado, eventos);
    return;
  }
  guardar.gravar(DUELO_ATIVO, estado.id);
  mudarStatusDuelo("duelando");
  const sessao = criarSessaoOnline({ estado, eventos, minha: { chave: u.chave, sid: SID } });
  const eu = sessao.eu;
  const oponente = estado.jogadores[1 - eu];
  abrirArena(sessao, {
    aoTerminar: (final, meuIndice) => terminarDuelo(final, meuIndice),
    aoSair: () => {
      mudarStatusDuelo("livre");
      guardar.apagar(DUELO_ATIVO);
      // o anfitrião limpa o estado retido do broker
      if (eu === 0) publicar(topicosDuelo(estado.id).estado, null, { reter: true });
      location.hash = "#salao";
    },
    revanche: () => {
      mudarStatusDuelo("livre");
      guardar.apagar(DUELO_ATIVO);
      fecharArena();
      location.hash = "#salao";
      desafiar({ chave: oponente.chave, nick: oponente.nick, tag: oponente.tag, avatar: oponente.avatar, nivel: oponente.nivel });
    },
  });
  location.hash = "#arena";
}

function terminarDuelo(estado, eu) {
  if (ehTag(estado)) return terminarTag(estado, eu);
  const venceu = estado.vencedor === eu;
  const xp = conta.registrarResultado({ dueloId: estado.id, venceu, oponente: estado.jogadores[1 - eu], motivo: estado.motivo });
  mudarStatusDuelo("livre");
  guardar.apagar(DUELO_ATIVO);
  desenharPerfil();
  if (venceu && xp) {
    const nome = (p) => `${p.tag ? `[${p.tag}] ` : ""}${p.nick}`;
    const v = nome(estado.jogadores[eu]);
    const d = nome(estado.jogadores[1 - eu]);
    const frases = {
      pl: `🏆 ${v} zerou os LP de ${d} na Arena!`,
      deck: `🏆 ${v} venceu ${d}: o deck de ${d} acabou!`,
      desistencia: `🏆 ${v} fez ${d} desistir na Arena!`,
      wo: `🏆 ${v} venceu ${d} por W.O.!`,
    };
    const texto = frases[estado.motivo] || `🏆 ${v} venceu ${d} na Arena!`;
    enviarGlobal({ id: gerarId(), tipo: "sistema", texto, t: Date.now() });
  }
  return { xp };
}

// Depois de recarregar a página: volta para o duelo que estava em andamento
async function voltarParaDueloAtivo() {
  const id = guardar.ler(DUELO_ATIVO);
  const u = conta.usuarioAtual();
  if (!id || !u || arenaAtiva()) return;
  const dados = await lerRetido(topicosDuelo(id).estado, 2500);
  const participa = (p) => p.chave === u.chave || (p.membros || []).some((m) => m.chave === u.chave);
  const valido = dados && dados.estado && dados.estado.vencedor === null && dados.estado.jogadores.some(participa);
  if (!valido) {
    guardar.apagar(DUELO_ATIVO);
    return;
  }
  aviso("Voltando para o duelo em andamento...", "ok");
  entrarNoDuelo(dados.estado, []);
}


/* ---------- Tag da Zoeira 2vs2: mesas ---------- */

// Quem abre a mesa é o "juiz": os outros só mandam pedidos (sentar/sair) para ele, que
// aplica na ordem em que chegam e publica a mesa atualizada. Assim duas pessoas nunca
// ficam na mesma vaga, mesmo clicando ao mesmo tempo.
//
// Vagas: 0 = Time 1 (P1), 1 = Time 1 (P3), 2 = Time 2 (P2), 3 = Time 2 (P4)
const VAGAS = [
  { time: 0, p: "P1" }, { time: 0, p: "P3" },
  { time: 1, p: "P2" }, { time: 1, p: "P4" },
];
const MESA_EXPIRA = 60 * 1000;      // sem sinal do juiz por 1 minuto: mesa expirada
const MESA_MAX_ABERTA = 10 * 60 * 1000;
const mesas = new Map();             // id -> mesa (como publicada)
const hospedando = new Map();        // id -> { mesa, cancelar, batimento }
const entrandoEmTag = new Set();

// Versão completa do site (cartas + código): os 4 da mesa precisam estar na mesma
const VERSAO_SITE = new URL(document.querySelector('script[type="module"][src*="app.js"]')?.src || location.href).searchParams.get("v") || "";
const versaoMesa = () => `${versaoDasCartas()}/${VERSAO_SITE}`;

const mesaExpirada = (m) => m.estado === "aberta" && Date.now() - (m.atualizado || 0) > MESA_EXPIRA;
const cartaoMesa = () => ({ ...conta.cartaoPublico(), deck: deckAtual() });

// Mesa aberta em que eu estou sentado (se houver)
function minhaMesa() {
  const u = conta.usuarioAtual();
  if (!u) return null;
  for (const m of mesas.values()) {
    if (m.estado === "aberta" && !mesaExpirada(m) && m.assentos.some((a) => a && a.chave === u.chave)) return m;
  }
  return null;
}

function abrirMesaTag() {
  const u = conta.usuarioAtual();
  if (!u) return;
  if (arenaAtiva() || s.statusDuelo === "duelando") {
    aviso("Termine o duelo atual antes de abrir uma mesa.", "erro");
    return;
  }
  const atual = minhaMesa();
  if (atual) {
    aviso("Você já está numa mesa de Tag 2vs2.", "erro");
    return;
  }
  const id = gerarId(10);
  const mesa = {
    id,
    criador: conta.cartaoPublico(),
    versao: versaoMesa(),
    assentos: [cartaoMesa(), null, null, null],
    estado: "aberta",
    criadoEm: Date.now(),
    atualizado: Date.now(),
  };
  const host = { mesa };
  host.cancelar = assinar(T.pedidos(id), (dados) => receberPedido(id, dados));
  host.batimento = setInterval(() => {
    const m = host.mesa;
    if (m.estado !== "aberta") return;
    if (Date.now() - m.criadoEm > MESA_MAX_ABERTA) {
      m.estado = "cancelada";
      aviso("Sua mesa de Tag 2vs2 fechou: ninguém completou as vagas em 10 minutos.");
    }
    publicarMesa(m);
  }, 15000);
  hospedando.set(id, host);
  publicarMesa(mesa);
  mudarStatusDuelo("aguardando");
  enviarGlobal({ id: gerarId(), tipo: "mesa", mesa: id, de: conta.cartaoPublico(), texto: "abriu uma mesa de Tag da Zoeira 2vs2", t: Date.now() });
  if (s.abaAtual !== "global") trocarAba("global");
  tocar("desafio");
}

function publicarMesa(m) {
  m.atualizado = Date.now();
  mesas.set(m.id, m);
  publicar(T.mesa(m.id), m, { reter: true });
  desenharMesas();
}

// Só o juiz (quem abriu) recebe e aplica os pedidos
function receberPedido(id, dados) {
  const host = hospedando.get(id);
  if (!host || !dados || !dados.cartao) return;
  const m = host.mesa;
  if (m.estado !== "aberta") return;
  const chave = dados.cartao.chave;
  if (dados.tipo === "sentar") {
    if (dados.versao !== m.versao) return;                  // versão diferente do jogo
    const vaga = dados.vaga;
    if (!(vaga >= 0 && vaga < 4)) return;
    if (m.assentos[vaga] && m.assentos[vaga].chave !== chave) return; // já ocupada: perdeu a corrida
    m.assentos = m.assentos.map((a) => (a && a.chave === chave ? null : a)); // troca de vaga
    m.assentos[vaga] = { ...dados.cartao, deck: Array.isArray(dados.deck) ? dados.deck : undefined };
  } else if (dados.tipo === "sair") {
    m.assentos = m.assentos.map((a) => (a && a.chave === chave ? null : a));
  } else {
    return;
  }
  if (m.assentos.every(Boolean)) iniciarMesa(m);
  else publicarMesa(m);
}

// As 4 vagas cheias: o juiz cria o duelo e todo mundo entra sozinho
function iniciarMesa(m) {
  const [p1, p3, p2, p4] = m.assentos;
  const { estado, eventos } = novoDueloTag({
    id: m.id,
    jogadores: [p1, p2, p3, p4],
    semente: crypto.getRandomValues(new Uint32Array(1))[0],
  });
  publicar(topicosDuelo(m.id).estado, { seq: estado.seq, estado, eventos, autor: SID }, { reter: true });
  m.estado = "iniciada";
  m.assentos = m.assentos.map(({ deck, ...resto }) => resto); // os decks já estão no duelo
  publicarMesa(m);
  entrarNoDuelo(estado, eventos); // o juiz entra direto
}

function cancelarMesa(id) {
  const host = hospedando.get(id);
  if (!host) return;
  host.mesa.estado = "cancelada";
  publicarMesa(host.mesa);
  encerrarHost(id);
  mudarStatusDuelo("livre");
}

function encerrarHost(id) {
  const host = hospedando.get(id);
  if (!host) return;
  host.cancelar();
  clearInterval(host.batimento);
  hospedando.delete(id);
}

function pedirVaga(m, vaga) {
  const u = conta.usuarioAtual();
  if (!u) return;
  if (arenaAtiva() || s.statusDuelo === "duelando") {
    aviso("Termine o duelo atual antes de entrar numa mesa.", "erro");
    return;
  }
  const outra = minhaMesa();
  if (outra && outra.id !== m.id) {
    aviso("Você já está em outra mesa. Saia dela primeiro.", "erro");
    return;
  }
  const pedido = { tipo: "sentar", vaga, cartao: conta.cartaoPublico(), deck: deckAtual(), versao: versaoMesa() };
  if (hospedando.has(m.id)) receberPedido(m.id, pedido);
  else publicar(T.pedidos(m.id), pedido);
  mudarStatusDuelo("aguardando");
  tocar("clique");
}

function sairDaMesa(m) {
  const pedido = { tipo: "sair", cartao: conta.cartaoPublico() };
  if (hospedando.has(m.id)) receberPedido(m.id, pedido);
  else publicar(T.pedidos(m.id), pedido);
  mudarStatusDuelo("livre");
}

function receberMesa(m, topico) {
  const id = topico.split("/").pop();
  if (!m) {
    mesas.delete(id);
    desenharMesas();
    return;
  }
  if (hospedando.has(id)) return; // o juiz confia na própria cópia
  mesas.set(id, m);
  desenharMesas();
  const u = conta.usuarioAtual();
  if (u && m.estado === "iniciada" && m.assentos.some((a) => a && a.chave === u.chave)) esperarDueloTag(id);
}

// A mesa começou e eu estou nela: lê o estado do duelo e entra
async function esperarDueloTag(id) {
  if (entrandoEmTag.has(id) || arenaAtiva()) return;
  entrandoEmTag.add(id);
  try {
    const dados = await lerRetido(topicosDuelo(id).estado, 4000);
    if (dados && dados.estado && dados.estado.vencedor === null && !arenaAtiva()) entrarNoDuelo(dados.estado, dados.eventos || []);
  } finally {
    entrandoEmTag.delete(id);
  }
}

// Rede de segurança: se o aviso "mesa completa" se perder, entra do mesmo jeito em até 3 s
setInterval(() => {
  const u = conta.usuarioAtual();
  if (!u || arenaAtiva()) return;
  for (const m of mesas.values()) {
    const recente = Date.now() - (m.atualizado || 0) < 2 * 60 * 60 * 1000;
    if (m.estado === "iniciada" && recente && m.assentos.some((a) => a && a.chave === u.chave)) esperarDueloTag(m.id);
  }
}, 3000);

function entrarNoTag(estado, eventos) {
  const u = conta.usuarioAtual();
  if (!u || arenaAtiva()) return;
  guardar.gravar(DUELO_ATIVO, estado.id);
  mudarStatusDuelo("duelando");
  const sessao = criarSessaoTag({ estado, eventos, minha: { chave: u.chave, sid: SID } });
  abrirArena(sessao, {
    aoTerminar: (final, meuIndice) => terminarDuelo(final, meuIndice),
    aoSair: () => {
      mudarStatusDuelo("livre");
      guardar.apagar(DUELO_ATIVO);
      // o juiz limpa a mesa e o duelo do broker
      if (hospedando.has(estado.id) || mesas.get(estado.id)?.criador?.chave === u.chave) {
        encerrarHost(estado.id);
        publicar(T.mesa(estado.id), null, { reter: true });
        publicar(topicosDuelo(estado.id).estado, null, { reter: true });
      }
      location.hash = "#salao";
    },
  });
  location.hash = "#arena";
}

function terminarTag(estado, eu) {
  const u = conta.usuarioAtual();
  const venceu = estado.vencedor === eu;
  const nomes = (p) => p.membros.map((m) => m.nick).join(" & ");
  const xp = conta.registrarResultado({
    dueloId: estado.id, venceu, tipo: "tag", motivo: estado.motivo,
    oponente: { nick: nomes(estado.jogadores[1 - eu]), tag: "", chave: null },
  });
  mudarStatusDuelo("livre");
  guardar.apagar(DUELO_ATIVO);
  desenharPerfil();
  encerrarHost(estado.id);
  // só o primeiro membro do time vencedor anuncia (para não sair repetido)
  if (venceu && xp && estado.jogadores[eu].membros[0].chave === u.chave) {
    const texto = `🏆 ${nomes(estado.jogadores[eu])} venceram ${nomes(estado.jogadores[1 - eu])} no Tag da Zoeira 2vs2!`;
    enviarGlobal({ id: gerarId(), tipo: "sistema", texto, t: Date.now() });
  }
  return { xp };
}

function desenharMesas() {
  if (s.abaAtual === "global") desenharMensagens();
}

// A mesa dentro do chat (estilo Clash Royale)
function caixaMesa(id) {
  const m = mesas.get(id);
  const u = conta.usuarioAtual();
  const caixa = el("div", "mesa-tag");
  if (!m) {
    caixa.append(el("div", "mesa-tag__estado", "Mesa de Tag 2vs2 encerrada."));
    return caixa;
  }
  const expirada = mesaExpirada(m);
  const aberta = m.estado === "aberta" && !expirada;
  const versaoOk = m.versao === versaoMesa();
  const souJuiz = hospedando.has(id);

  caixa.append(el("div", "mesa-tag__titulo", `👥 Entrar para o Tag da Zoeira 2vs2! (mesa de ${m.criador.nick})`));
  const grade = el("div", "mesa-tag__grade");
  for (const time of [0, 1]) {
    const coluna = el("div", `mesa-tag__time mesa-tag__time--${time}`);
    coluna.append(el("div", "mesa-tag__nome-time", `Time ${time + 1}`));
    VAGAS.forEach((v, i) => {
      if (v.time !== time) return;
      const a = m.assentos[i];
      const minha = a && u && a.chave === u.chave;
      const b = el("button", "mesa-tag__vaga" + (a ? " mesa-tag__vaga--ocupada" : "") + (minha ? " mesa-tag__vaga--minha" : ""));
      b.type = "button";
      b.append(el("span", "mesa-tag__p", v.p));
      if (a) {
        const img = el("img");
        img.src = `img/cartas/${a.avatar || "careca-feijao"}.webp`;
        img.alt = "";
        b.append(img, el("span", "mesa-tag__nick", `${a.tag ? `[${a.tag}] ` : ""}${a.nick}${minha ? " (você)" : ""}`));
        b.title = minha ? "Clique para sair da vaga" : a.nick;
        b.disabled = !aberta || !minha;
        b.addEventListener("click", () => sairDaMesa(m));
      } else {
        b.append(el("span", "mesa-tag__nick", aberta ? "Aguardando..." : "—"));
        b.title = "Clique para entrar nesta vaga";
        b.disabled = !aberta || !versaoOk || !u;
        b.addEventListener("click", () => pedirVaga(m, i));
      }
      coluna.append(b);
    });
    grade.append(coluna);
    if (time === 0) {
      const meio = el("div", "mesa-tag__meio");
      meio.innerHTML = '<img src="img/emblema.webp" alt="">';
      grade.append(meio);
    }
  }
  caixa.append(grade);

  const ocupadas = m.assentos.filter(Boolean).length;
  let estadoTxt = `${ocupadas}/4 jogadores. Toque numa vaga livre para entrar. Começa sozinho quando lotar.`;
  if (m.estado === "iniciada") estadoTxt = "Mesa completa: duelo em andamento!";
  else if (m.estado === "cancelada") estadoTxt = "Mesa cancelada.";
  else if (expirada) estadoTxt = "Mesa expirada (quem abriu saiu).";
  else if (!versaoOk) estadoTxt = "Você está com outra versão do jogo: recarregue a página (F5) para entrar.";
  caixa.append(el("div", "mesa-tag__estado", estadoTxt));

  if (souJuiz && aberta) {
    const cancelar = el("button", "btn btn-sm btn-danger mt-2", "Cancelar mesa");
    cancelar.type = "button";
    cancelar.addEventListener("click", () => cancelarMesa(id));
    caixa.append(cancelar);
  }
  return caixa;
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#botao-mesa-tag")) abrirMesaTag();
});
