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

import { PREFIXO, conectar, publicar, assinar, lerRetido, aoStatus, modoRede, presencaGerenciada } from "./rede.js?v=202610042111";
import * as conta from "./conta.js?v=202610042111";
import { bancoLigado, chamar } from "./banco.js?v=202610042111";
import * as adm from "./admin.js?v=202610042111";
import { iniciarTorneio, atualizarTorneio, torneioAtual } from "./torneio-ui.js?v=202610042111";
import { PREMIOS, ehReliquia, ehTrofeu } from "./premios.js?v=202610042111";
import { abrirPremio } from "./visor-premio.js?v=202610042111";
import { novoDuelo, novoDueloTag, ehTag, versaoDasCartas, problemaDoDeck } from "./motor.js?v=202610042111";
import { deckAtual, ehDeckPadrao } from "./deck.js?v=202610042111";
import { criarSessaoOnline, criarSessaoTag, topicosDuelo } from "./sessao.js?v=202610042111";
import { abrirArena, arenaAtiva, fecharArena } from "./arena.js?v=202610042111";
import { el, gerarId, hora, aviso, guardar, nivelDoXp, progressoNivel, chaveDoNick } from "./util.js?v=202610042111";
import { tocar } from "./som.js?v=202610042111";
import { comMoldura, visualDe } from "./cosmeticos.js?v=202610042111";

const SID = gerarId(12); // identifica esta aba

export function sairDaConta() {
  if (arenaAtiva()) {
    aviso("Termine o duelo antes de sair da conta.", "erro");
    return false;
  }
  publicar(T.presenca(SID), null, { reter: true });
  conta.sair();
  return true;
}
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
  presentes: (chave) => `${PREFIXO}/presentes/${chave}/+`,
  presente: (chave, id) => `${PREFIXO}/presentes/${chave}/${id}`,
  premios: (chave) => `${PREFIXO}/premios/${chave}/+`,
  premio: (chave, id) => `${PREFIXO}/premios/${chave}/${id}`,
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
  ligarAbasDoSalao();
  // Roleta Diária: o prêmio vai para o chat (carta e relíquia com destaque)
  document.addEventListener("roleta-girou", (e) => anunciarRoleta(e.detail));
  // o meu avatar lá em cima abre o meu perfil (sem conta, leva para o login)
  for (const botao of [$("#botao-conta"), $("#botao-conta-celular")]) {
    botao.addEventListener("click", (e) => {
      const u = conta.usuarioAtual();
      if (!u) return;
      e.preventDefault();
      abrirPerfil(conta.cartaoPublico(u));
    });
  }
  $("#ranking-mais").addEventListener("click", () => {
    s.rankingTodos = !s.rankingTodos;
    desenharRanking();
  });
  conta.aoSairSozinho((motivo) => {
    aviso(motivo, "info", 15000);
    const msg = $("#entrar-mensagem");
    if (msg) {
      msg.className = "mensagem-form info";
      msg.textContent = motivo;
    }
  });
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
  carregarPerfisDoBanco();
  setInterval(carregarPerfisDoBanco, 2 * 60 * 1000);
  assinar(T.mesas, receberMesa);
  iniciarTorneio({ SID, entrarNoDuelo, avisarChat, perfis: () => s.perfis, entregarPremio });
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
    atualizarTorneio();
    return;
  }
  s.chaveAtual = usuario ? usuario.chave : null;
  s.cancelarUsuario.forEach((c) => c());
  s.cancelarUsuario = [];
  clearInterval(s.batimento);

  if (!usuario) {
    atualizarTorneio();
    return;
  }
  await adm.carregarAdm(usuario.chave);
  desenharPerfil();
  if (!(await garantirConexao()) || !conta.usuarioAtual()) return;
  conta.sincronizarComBanco().then((modo) => {
    if (modo === "antigo") conta.restaurarNoServidor();
    if (modo === "migrou") {
      aviso("☁️ Sua conta agora fica guardada no servidor novo do jogo! No seu perfil, em \"🔒 Trocar senha\", escolha uma senha (pode ser a de sempre) para entrar em outros aparelhos.", "ok", 20000);
    }
  });

  s.cancelarUsuario.push(assinar(T.dm(usuario.chave), receberDM));
  s.cancelarUsuario.push(assinar(T.presentes(usuario.chave), receberPresente));
  s.cancelarUsuario.push(assinar(T.premios(usuario.chave), receberPremio));
  atualizarTorneio();
  publicarPresenca();
  s.batimento = setInterval(publicarPresenca, 25000);
  desenharAbas();
  desenharMensagens();
  voltarParaDueloAtivo();
}

function desenharBotaoConta(usuario) {
  const celular = $("#botao-conta-celular");
  celular.hidden = !usuario;
  celular.replaceChildren();
  if (usuario) {
    const foto = el("img");
    foto.src = `img/cartas/${usuario.avatar}.webp`;
    foto.alt = "";
    celular.append(foto);
  }
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
  botao.append(img, el("span", "chip-usuario__nick", usuario.nick));
  botao.title = `${usuario.nick}: ver meu perfil`;
}

async function publicarPresenca() {
  const u = conta.usuarioAtual();
  if (!u) return;
  const dados = await adm.assinarPresenca({ sid: SID, ...conta.cartaoPublico(u), status: s.statusDuelo, t: Date.now() });
  publicar(T.presenca(SID), dados, { reter: true });
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
      if (conta.temSenhaProvisoria()) aviso("🔑 Você entrou com a senha provisória do ADM. Troque agora por uma sua: no seu perfil, em \"🔒 Trocar senha\".", "info", 15000);
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
    if (!$("#criar-ciente").checked) {
      msg.textContent = "Para criar a conta, marque que leu o aviso e está ciente.";
      $("#criar-ciente").focus();
      return;
    }
    msg.className = "mensagem-form info";
    msg.textContent = "Criando a conta...";
    botao.disabled = true;
    try {
      if (!(await garantirConexao())) throw new Error("Sem conexão com o servidor do jogo.");
      const avatar = e.target.querySelector("input[name=avatar]:checked")?.value;
      await conta.criarConta({ nick: $("#criar-nick").value, senha, tag: $("#criar-tag").value, avatar, ciente: true });
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
  const meuNome = botaoPerfil(u, "");
  if (adm.souAdm(u.chave)) meuNome.append(el("span", "nome-adm", u.nick), seloAdm());
  else meuNome.append(u.nick);
  nick.append(meuNome);
  nomes.append(nick, el("div", "perfil__nivel", `Nível ${nivelDoXp(u.xp)} · ${u.xp} XP`), seloCoins(conta.saldoCoins(u)), linhaId(u));
  topo.append(comMoldura(img, visualDe(u).moldura), nomes);

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
    sairDaConta();
  });
  botoes.append(treino, formTrocarSenha(), sair);

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

  area.append(topo, barra, stats, secaoPremios(u, true), deck, botoes, grade);
  if (adm.ehAdmin(u.chave)) area.append(painelAdm(u));
}

// Painel do ADM: ativar a chave neste aparelho e mandar avisos
function painelAdm(u) {
  const painel = el("section", "painel-adm");
  painel.append(el("h4", "painel-adm__titulo", "👑 Painel do ADM"));
  if (!adm.souAdm(u.chave)) {
    painel.append(el("p", "painel-adm__dica", "Esta conta é de ADM. Para usar os poderes neste aparelho, cole aqui a chave de ADM (o código que começa com ZOEIRA-ADM:)."));
    const form = el("form", "painel-adm__form");
    const campo = el("textarea", "form-control form-control-sm");
    campo.rows = 2;
    campo.placeholder = "ZOEIRA-ADM:...";
    campo.setAttribute("aria-label", "Chave de ADM");
    campo.autocomplete = "off";
    campo.spellcheck = false;
    const botao = el("button", "btn btn-sm btn-ouro", "🔑 Ativar ADM neste aparelho");
    botao.type = "submit";
    form.append(campo, botao);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await adm.ativarAdm(u.chave, campo.value);
        aviso("👑 ADM ativado neste aparelho!", "ok");
        tocar("magia");
        desenharPerfil();
        desenharOnline();
        publicarPresenca();
      } catch (erro) {
        aviso(erro.message, "erro");
      }
    });
    painel.append(form);
    return painel;
  }
  painel.append(el("p", "painel-adm__dica", "ADM ativo neste aparelho. Para dar Careca Coins, abra o perfil do jogador (toque no nome dele)."));
  const avisar = el("button", "btn btn-sm btn-ouro", "📢 Mandar aviso no chat");
  avisar.type = "button";
  avisar.addEventListener("click", async () => {
    const texto = (prompt("Aviso para todo mundo no chat:") || "").trim().slice(0, 300);
    if (!texto) return;
    enviarGlobal(await adm.assinarMsg({ id: gerarId(), tipo: "aviso", de: conta.cartaoPublico(), texto, t: Date.now() }));
    aviso("📢 Aviso enviado!", "ok");
  });
  const limpar = el("button", "btn btn-sm btn-outline-light", "🧹 Limpar o chat global");
  limpar.type = "button";
  limpar.addEventListener("click", async () => {
    if (!confirm("Apagar todas as mensagens do chat global para todo mundo?")) return;
    const msg = await adm.assinarMsg({ id: gerarId(), tipo: "limpar", de: conta.cartaoPublico(), texto: "", t: Date.now() });
    publicar(T.chat, msg);
    publicar(T.historico, [msg], { reter: true });
    aviso("🧹 Chat limpo!", "ok");
  });
  const sair = el("button", "btn btn-sm btn-outline-secondary", "Desativar ADM neste aparelho");
  sair.type = "button";
  sair.addEventListener("click", () => {
    if (!confirm("Desativar o ADM neste aparelho? Para ativar de novo vai precisar colar a chave.")) return;
    adm.desativarAdm();
    desenharPerfil();
    desenharOnline();
    publicarPresenca();
  });
  const backup = el("button", "btn btn-sm btn-outline-light", "💾 Baixar backup do jogo");
  backup.type = "button";
  const ultimo = el("p", "painel-adm__dica painel-adm__backup");
  const mostrarUltimo = () => {
    const t = guardar.ler(CHAVE_ULTIMO_BACKUP, null);
    ultimo.textContent = t
      ? `Último backup neste aparelho: ${new Date(t).toLocaleDateString("pt-BR")} às ${hora(t)}. Faça um por semana.`
      : "Nenhum backup feito neste aparelho ainda. Faça um por semana e guarde o arquivo.";
  };
  mostrarUltimo();
  backup.addEventListener("click", () => baixarBackup(backup).then(mostrarUltimo));
  const botoes = el("div", "d-grid gap-2");
  botoes.append(avisar, limpar, backup, ultimo, sair);
  painel.append(botoes, formRedefinirSenha());
  return painel;
}

// ADM: cópia de segurança do que o banco guarda (perfis sem senhas, torneios). O arquivo
// .json fica no aparelho do ADM; se um dia precisar, dá para devolver os dados ao banco.
const CHAVE_ULTIMO_BACKUP = "zoeira-ultimo-backup";

async function baixarBackup(botao) {
  botao.disabled = true;
  try {
    const [jogadores, torneios] = await Promise.all([chamar("perfis_publicos"), chamar("torneios_encerrados")]);
    const agora = new Date();
    const dados = {
      jogo: "Duelo da Zoeira",
      tipo: "backup",
      geradoEm: agora.toISOString(),
      geradoPor: conta.usuarioAtual()?.nick || null,
      jogadores: Array.isArray(jogadores) ? jogadores : [],
      torneios: Array.isArray(torneios) ? torneios : [],
      torneioAtual: torneioAtual() || null,
    };
    const arquivo = new Blob([JSON.stringify(dados, null, 1)], { type: "application/json" });
    const link = el("a");
    link.href = URL.createObjectURL(arquivo);
    link.download = `duelo-da-zoeira-backup-${agora.toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    guardar.gravar(CHAVE_ULTIMO_BACKUP, agora.getTime());
    aviso(`💾 Backup baixado: ${dados.jogadores.length} jogadores e ${dados.torneios.length} torneios.`, "ok", 8000);
  } catch {
    aviso("Não foi possível falar com o banco do jogo agora. Tente de novo em instantes.", "erro");
  } finally {
    botao.disabled = false;
  }
}

// Selo vermelho de ADM ao lado do nome
function seloAdm() {
  const selo = el("span", "selo-adm", "ADM");
  selo.title = "Administrador do Duelo da Zoeira";
  return selo;
}

// "ID #K7QX-9M2P" (toque para copiar)
function linhaId(p) {
  if (!p.id) return el("span");
  const b = el("button", "linha-id", `ID #${p.id}`);
  b.type = "button";
  b.title = "Copiar o ID";
  b.addEventListener("click", () => {
    navigator.clipboard?.writeText(p.id).then(() => aviso(`ID ${p.id} copiado!`, "ok"), () => {});
  });
  return b;
}

/* ---------- Troféus e relíquias ---------- */

// Mostra os troféus e as relíquias do jogador (só os que têm a assinatura do ADM conferida).
// No meu perfil, dá para equipar a relíquia.
function secaoPremios(p, meu) {
  const sec = el("section", "premios");
  const lista = conta.todosOsPremios(p).filter((x) => x.para === p.chave && PREMIOS[x.item]);
  if (!lista.length) return sec;
  Promise.all(lista.map((x) => conta.premioValido(x))).then((oks) => {
    const validos = lista.filter((_, i) => oks[i]);
    if (!validos.length) return;
    const trofeus = validos.filter((x) => ehTrofeu(x.item)).sort((a, b) => PREMIOS[a.item].ordem - PREMIOS[b.item].ordem || b.t - a.t);
    const reliquias = validos.filter((x) => ehReliquia(x.item));
    if (trofeus.length) {
      sec.append(el("h4", "premios__titulo", "🏆 Troféus"));
      const linha = el("div", "premios__trofeus");
      for (const x of trofeus) {
        const d = el("button", "premios__trofeu");
        d.type = "button";
        const img = el("img");
        img.src = PREMIOS[x.item].imagem;
        img.alt = "";
        d.title = "Ver detalhes";
        d.setAttribute("aria-label", `${PREMIOS[x.item].nome} (${PREMIOS[x.item].posicao}) · ${x.torneio}: ver detalhes`);
        d.append(img, el("span", "premios__legenda", x.torneio));
        d.addEventListener("click", () => abrirPremio(x, p, d));
        linha.append(d);
      }
      sec.append(linha);
    }
    const mostrar = meu ? reliquias : reliquias.filter((x) => x.id === p.reliquia);
    if (mostrar.length) {
      sec.append(el("h4", "premios__titulo", meu ? "🔺 Relíquias" : "🔺 Relíquia equipada"));
      for (const x of mostrar) {
        const info = PREMIOS[x.item];
        const d = el("div", "reliquia" + (p.reliquia === x.id ? " reliquia--equipada" : ""));
        const img = el("button", "reliquia__img");
        img.type = "button";
        img.title = "Ver detalhes";
        img.setAttribute("aria-label", `${info.nome}: ver detalhes`);
        const icone = el("img");
        icone.src = info.icone;
        icone.alt = "";
        img.append(icone);
        img.addEventListener("click", () => abrirPremio(x, p, img));
        const txt = el("div", "reliquia__texto");
        txt.append(el("strong", "", info.nome), el("span", "reliquia__de", `Prêmio: ${x.torneio}`), el("p", "", info.texto));
        d.append(img, txt);
        if (meu) {
          const equipada = p.reliquia === x.id;
          const b = el("button", equipada ? "btn btn-sm btn-outline-light" : "btn btn-sm btn-ouro", equipada ? "Equipada ✔ (tirar)" : "Equipar");
          b.type = "button";
          b.addEventListener("click", () => {
            conta.equiparReliquia(equipada ? null : x.id);
            aviso(equipada ? `${info.nome} guardada.` : `${info.nome} equipada! Ela vai com você para os duelos.`, "ok");
            tocar("magia");
          });
          d.append(b);
        }
        sec.append(d);
      }
    }
  });
  return sec;
}

// Meu perfil: trocar a senha (aberto sozinho se entrei com a senha provisória do ADM)
function formTrocarSenha() {
  const caixa = el("div", "trocar-senha");
  const provisoria = conta.temSenhaProvisoria();
  // no banco, com senha provisória (do ADM ou da mudança de servidor), a sessão já prova quem é
  const semAtual = provisoria && conta.contaNoBanco();
  const abrir = el("button", provisoria ? "btn btn-sm btn-ouro" : "btn btn-sm btn-outline-light", provisoria ? "🔒 Escolher minha senha" : "🔒 Trocar senha");
  abrir.type = "button";
  const form = el("form", "trocar-senha__form");
  form.hidden = !provisoria;
  abrir.setAttribute("aria-expanded", String(!form.hidden));
  if (provisoria) {
    form.append(el("p", "trocar-senha__aviso", semAtual
      ? "Escolha a senha da sua conta (pode ser a de sempre). É com ela que você entra em outros aparelhos."
      : "Você entrou com a senha provisória que o ADM passou. Escolha uma senha nova só sua."));
  }
  const campo = (rotulo, auto) => {
    const i = el("input", "form-control form-control-sm");
    i.type = "password";
    i.required = true;
    i.autocomplete = auto;
    i.placeholder = rotulo;
    i.setAttribute("aria-label", rotulo);
    form.append(i);
    return i;
  };
  const atual = semAtual ? null : campo(provisoria ? "Senha provisória (a do ADM)" : "Senha atual", "current-password");
  const nova = campo("Senha nova (mínimo 4)", "new-password");
  const repetir = campo("Repita a senha nova", "new-password");
  nova.minLength = 4;
  const salvar = el("button", "btn btn-sm btn-ouro", "Salvar senha nova");
  salvar.type = "submit";
  const msg = el("p", "mensagem-form");
  msg.setAttribute("role", "status");
  form.append(salvar, msg);
  abrir.addEventListener("click", () => {
    form.hidden = !form.hidden;
    abrir.setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) (atual || nova).focus();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "mensagem-form";
    if (nova.value !== repetir.value) {
      msg.textContent = "As duas senhas novas não são iguais.";
      return;
    }
    salvar.disabled = true;
    try {
      await conta.trocarSenha(atual ? atual.value : "", nova.value);
      aviso("🔒 Senha trocada! Use a nova no próximo login.", "ok");
    } catch (erro) {
      msg.textContent = erro.message;
    } finally {
      salvar.disabled = false;
    }
  });
  caixa.append(abrir, form);
  return caixa;
}

// ADM: quem esqueceu a senha ganha uma provisória (a antiga para de valer na hora)
const LETRAS_SENHA = "abcdefghjkmnpqrstuvwxyz23456789";
const senhaAleatoria = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => LETRAS_SENHA[b % LETRAS_SENHA.length]).join("");

// Acha o duelista pelo que o ADM digitou: ignora a tag do clã ("[CDZ] Nick"),
// maiúsculas e acentos. Devolve o perfil (se o salão conhece) e nicks parecidos.
function acharDuelista(texto) {
  const limpo = texto.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
  const chave = chaveDoNick(limpo);
  const perfil = chave ? s.perfis.get(chave) || null : null;
  const parecidos = chave && !perfil
    ? [...s.perfis.values()].filter((x) => x.chave && (x.chave.includes(chave) || chave.includes(x.chave) || x.chave.slice(0, 3) === chave.slice(0, 3))).slice(0, 5)
    : [];
  return { limpo, chave, perfil, parecidos };
}

// p: o duelista (no perfil dele); sem p (no Painel do ADM), o ADM digita o nick
function formRedefinirSenha(p = null) {
  const form = el("form", p ? "painel-adm painel-adm--presente" : "painel-adm__senha");
  form.append(el("h4", "painel-adm__titulo", p ? `🔑 ${p.nick} esqueceu a senha?` : "🔑 Duelista esqueceu a senha?"));
  form.append(el("p", "painel-adm__dica", "Ninguém consegue ver a senha de ninguém (o jogo só guarda um código dela). Aqui você troca por uma senha provisória e passa para o dono em particular, nunca no chat. No login, o jogo pede para ele trocar."));
  let nick = null;
  if (!p) {
    nick = el("input", "form-control form-control-sm painel-adm__nick");
    nick.required = true;
    nick.maxLength = 30;
    nick.placeholder = "Nick do duelista, sem a tag do clã (ex.: ReiCorRed)";
    nick.setAttribute("aria-label", "Nick do duelista");
    nick.autocomplete = "off";
    nick.setAttribute("autocapitalize", "none");
    nick.setAttribute("autocorrect", "off");
    // sugestões com os nicks que o salão conhece
    const lista = el("datalist");
    lista.id = `nicks-adm-${gerarId(6)}`;
    nick.setAttribute("list", lista.id);
    const achado = el("p", "painel-adm__achado");
    achado.setAttribute("aria-live", "polite");
    const conferir = () => {
      const { limpo, perfil, parecidos } = acharDuelista(nick.value);
      achado.replaceChildren();
      achado.className = "painel-adm__achado";
      if (!limpo) return;
      if (perfil) {
        achado.classList.add("painel-adm__achado--ok");
        achado.append(`✔ Encontrado: ${perfil.tag ? `[${perfil.tag}] ` : ""}${perfil.nick} · Nv ${nivelDoXp(perfil.xp || 0)} · ${perfil.vitorias || 0}V ${perfil.derrotas || 0}D`);
        return;
      }
      achado.classList.add("painel-adm__achado--erro");
      achado.append(parecidos.length ? "Não achei esse nick. Parecidos: " : "Não achei esse nick entre os duelistas do salão. Confira a grafia (sem a tag do clã).");
      for (const x of parecidos) {
        const b = el("button", "painel-adm__parecido", x.nick);
        b.type = "button";
        b.addEventListener("click", () => {
          nick.value = x.nick;
          conferir();
        });
        achado.append(b);
      }
    };
    nick.addEventListener("focus", () => {
      lista.replaceChildren(...[...s.perfis.values()].filter((x) => x.nick).sort((a, b) => a.nick.localeCompare(b.nick)).map((x) => {
        const o = el("option");
        o.value = x.nick;
        return o;
      }));
    });
    nick.addEventListener("input", conferir);
    form.append(nick, lista, achado);
  }
  const linha = el("div", "painel-adm__linha painel-adm__linha--senha");
  const senha = el("input", "form-control form-control-sm");
  senha.required = true;
  senha.minLength = 4;
  senha.maxLength = 40;
  senha.autocomplete = "off";
  senha.spellcheck = false;
  // o celular não pode trocar a primeira letra por maiúscula nem "corrigir" a senha
  senha.setAttribute("autocapitalize", "none");
  senha.setAttribute("autocorrect", "off");
  senha.value = senhaAleatoria();
  senha.setAttribute("aria-label", "Senha provisória");
  const gerar = el("button", "btn btn-sm btn-outline-light", "🎲");
  gerar.type = "button";
  gerar.title = "Sortear outra senha";
  gerar.setAttribute("aria-label", "Sortear outra senha provisória");
  gerar.addEventListener("click", () => (senha.value = senhaAleatoria()));
  const botao = el("button", "btn btn-sm btn-ouro", "Redefinir");
  botao.type = "submit";
  linha.append(senha, gerar, botao);
  const feito = el("p", "painel-adm__feito");
  feito.setAttribute("role", "status");
  feito.hidden = true;
  form.append(linha, feito);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = conta.usuarioAtual();
    if (!u || !adm.souAdm(u.chave)) return;
    senha.value = senha.value.trim();
    const busca = p ? null : acharDuelista(nick.value);
    const alvo = p || busca.perfil || { chave: busca.chave, nick: busca.limpo };
    if (!alvo.chave) return;
    if (alvo.chave === u.chave) {
      aviso("Para a sua própria conta, use \"🔒 Trocar senha\".", "erro");
      return;
    }
    if (!confirm(`Redefinir a senha de ${alvo.nick}?\n\nA senha antiga para de funcionar na hora. Só faça isso se tiver certeza de que é o dono da conta pedindo.`)) return;
    botao.disabled = true;
    botao.textContent = "Procurando…";
    let resultado = null;
    try {
      try {
        resultado = await conta.redefinirSenha(alvo.chave, senha.value, Boolean(p || busca.perfil), alvo.nick);
      } catch (erro) {
        if (!erro.message.startsWith("Conta não encontrada")) throw erro;
        // o servidor público pode ter esquecido a conta: recria só a senha (o progresso
        // do jogador volta do aparelho dele quando ele entrar)
        if (!confirm(`"${alvo.nick}" não está no servidor agora (o servidor público às vezes perde os dados guardados).\n\nRecriar a conta "${alvo.nick}" com essa senha provisória? Quando ele entrar no aparelho de sempre, o progresso guardado lá volta junto.\n\nConfira bem o nick antes de confirmar.`)) return;
        resultado = await conta.redefinirSenha(alvo.chave, senha.value, true, alvo.nick);
      }
      navigator.clipboard?.writeText(senha.value).catch(() => {});
      aviso(`Senha de ${alvo.nick} redefinida (e copiada). Passe a senha provisória para ele em particular.`, "ok", 9000);
      feito.replaceChildren(`✅ A senha de ${alvo.nick} agora é `, el("code", "", senha.value), " (copiada). Passe exatamente assim (maiúscula e minúscula fazem diferença).");
      if (resultado?.criada) feito.append(" A conta foi criada no servidor novo: o progresso dele volta quando ele entrar no aparelho de sempre.");
      feito.hidden = false;
    } catch (erro) {
      aviso(erro.message, "erro");
    } finally {
      botao.disabled = false;
      botao.textContent = "Redefinir";
    }
  });
  return form;
}

// Com o banco, o prêmio/presente fica guardado no perfil do jogador (não depende de ele
// estar online nem de o servidor de mensagens guardar a entrega)
async function guardarNoBanco(funcao, parametros) {
  if (!conta.contaNoBanco()) return;
  try {
    const r = await conta.chamarComSessao(funcao, parametros);
    if (r?.erro === "nao_existe") aviso("Esse jogador ainda não entrou no servidor novo: o prêmio chega quando ele estiver online.", "info", 9000);
    else if (r?.erro) aviso(conta.mensagemDoBanco(r), "erro");
  } catch {
    aviso("O servidor do jogo não respondeu: o prêmio chega pelo jeito antigo quando o jogador estiver online.", "info", 9000);
  }
}

// ADM: apagar uma conta (ex.: alguém registrou o nick de outro jogador na mudança de servidor)
function formApagarConta(p) {
  const form = el("form", "painel-adm painel-adm--presente");
  form.append(el("h4", "painel-adm__titulo", `🗑 Apagar a conta de ${p.nick}`));
  form.append(el("p", "painel-adm__dica", "Só para casos sérios (ex.: alguém pegou o nick de outro jogador). Apaga a conta e o progresso dela no servidor; não dá para desfazer."));
  const botao = el("button", "btn btn-sm btn-outline-danger", "Apagar conta");
  botao.type = "submit";
  form.append(botao);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const digitado = prompt(`Para apagar a conta, digite o nick exatamente: ${p.nick}`);
    if (digitado === null) return;
    if (digitado.trim() !== p.nick) {
      aviso("O nick digitado não confere. Nada foi apagado.", "erro");
      return;
    }
    botao.disabled = true;
    try {
      const r = await conta.chamarComSessao("apagar_conta", { p_chave: p.chave });
      if (r?.erro) throw new Error(conta.mensagemDoBanco(r));
      publicar(conta.topicoPerfil(p.chave), null, { reter: true });
      s.perfis.delete(p.chave);
      desenharRanking();
      aviso(`Conta de ${p.nick} apagada.`, "ok");
      bootstrap.Modal.getOrCreateInstance("#modal-perfil").hide();
    } catch (erro) {
      aviso(erro.message, "erro");
    } finally {
      botao.disabled = false;
    }
  });
  return form;
}

// ADM: entregar troféu ou relíquia (prêmio assinado; o jogo do jogador confere e guarda)
async function entregarPremio(chave, item, torneioNome) {
  const u = conta.usuarioAtual();
  if (!u || !adm.souAdm(u.chave)) return;
  const premio = await adm.assinarPremio({ id: gerarId(12), item, torneio: torneioNome, para: chave, de: u.chave, deNick: u.nick, t: Date.now() });
  publicar(T.premio(chave, premio.id), premio, { reter: true });
  guardarNoBanco("dar_premio", { p_para: chave, p_premio: premio });
  const nick = s.perfis.get(chave)?.nick || chave;
  avisarChat(`${PREMIOS[item].emoji} ${nick} recebeu ${PREMIOS[item].tipo === "reliquia" ? "a relíquia" : "o"} ${PREMIOS[item].nome} (${torneioNome})!`);
  aviso(`${PREMIOS[item].nome} entregue para ${nick}! Chega assim que ele estiver online.`, "ok");
}

function formPremio(p) {
  const form = el("form", "painel-adm painel-adm--presente");
  form.append(el("h4", "painel-adm__titulo", `🏆 Entregar prêmio para ${p.nick}`));
  const linha = el("div", "painel-adm__linha");
  const item = el("select", "form-select form-select-sm");
  item.setAttribute("aria-label", "Prêmio");
  for (const [id, info] of Object.entries(PREMIOS)) {
    const o = el("option", "", `${info.emoji} ${info.nome}`);
    o.value = id;
    item.append(o);
  }
  const nome = el("input", "form-control form-control-sm");
  nome.maxLength = 40;
  nome.required = true;
  nome.placeholder = "Torneio (ex.: Copa Careca #1)";
  nome.setAttribute("aria-label", "Nome do torneio");
  const botao = el("button", "btn btn-sm btn-ouro", "Entregar");
  botao.type = "submit";
  linha.append(item, nome, botao);
  form.append(linha);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) return;
    await entregarPremio(p.chave, item.value, nome.value.trim());
  });
  return form;
}

async function receberPremio(dados) {
  const u = conta.usuarioAtual();
  if (!dados || !u || dados.para !== u.chave || !PREMIOS[dados.item] || !(await adm.verificarPremio(dados))) return;
  if (!conta.aplicarPremio(dados)) return;
  const info = PREMIOS[dados.item];
  aviso(`${info.emoji} Você recebeu ${info.tipo === "reliquia" ? "a relíquia" : "o"} ${info.nome} (${dados.torneio})!${info.tipo === "reliquia" ? " Equipe no seu perfil." : ""}`, "ok", 9000);
  tocar("vitoria");
}

// Aviso de ADM no chat (assinado)
async function avisarChat(texto) {
  const u = conta.usuarioAtual();
  if (!u || !adm.souAdm(u.chave)) return;
  enviarGlobal(await adm.assinarMsg({ id: gerarId(), tipo: "aviso", de: conta.cartaoPublico(), texto, t: Date.now() }));
}

// Presente de ADM chegou: confere a assinatura e soma as moedas (uma vez só)
async function receberPresente(dados) {
  if (!dados || !(await adm.verificarPresente(dados))) return;
  if (!conta.aplicarPresente(dados)) return;
  aviso(`🎁 Você ganhou ${dados.coins} Careca Coins do ADM ${dados.deNick || ""}!${dados.motivo ? ` (${dados.motivo})` : ""}`, "ok", 8000);
  tocar("vitoria");
}

function receberPerfil(perfil, topico) {
  const chave = topico.split("/").pop();
  if (chave === conta.usuarioAtual()?.chave) {
    if (conta.contaNoBanco()) return; // o meu perfil: quem vale é o banco
    if (perfil) conta.sincronizarComRemoto(perfil);
    else conta.republicarPerfil(); // alguém apagou o meu perfil do servidor
  }
  // Com o banco no ar, a mensagem só avisa que o perfil mudou (qualquer um consegue publicar
  // no broker): o perfil de verdade vem do banco
  if (s.perfisDoBanco) {
    atualizarPerfilDoBanco(chave, perfil);
    return;
  }
  if (perfil) s.perfis.set(chave, perfil);
  else s.perfis.delete(chave);
  desenharRanking();
}

// Todos os perfis (ranking) a partir do banco
async function carregarPerfisDoBanco() {
  if (!bancoLigado()) return;
  try {
    const lista = await chamar("perfis_publicos");
    if (!Array.isArray(lista)) return;
    s.perfisDoBanco = true;
    for (const p of lista) if (p?.chave) s.perfis.set(p.chave, p);
    desenharRanking();
  } catch {
    // banco fora do ar: o ranking segue pelo broker
  }
}

const perfisPedidos = new Map();
function atualizarPerfilDoBanco(chave, doBroker) {
  clearTimeout(perfisPedidos.get(chave));
  perfisPedidos.set(chave, setTimeout(async () => {
    perfisPedidos.delete(chave);
    try {
      const p = await chamar("perfil_publico", { p_chave: chave });
      // quem ainda não veio para o banco (jogo antigo aberto) continua aparecendo pelo broker
      if (p?.chave) s.perfis.set(chave, p);
      else if (doBroker && !s.perfis.has(chave)) s.perfis.set(chave, doBroker);
      desenharRanking();
    } catch {
      // banco fora do ar: fica o que já tinha
    }
  }, 1500));
}

let tipoRanking = "xp";

document.addEventListener("click", (e) => {
  const aba = e.target.closest("[data-ranking]");
  if (!aba) return;
  tipoRanking = aba.dataset.ranking;
  document.querySelectorAll("[data-ranking]").forEach((b) => b.setAttribute("aria-selected", String(b === aba)));
  desenharRanking();
});

// No meu perfil: a minha posição no ranking e atalhos para o ranking e o meu painel
function atalhosDoMeuPerfil(u) {
  const caixa = el("div", "pj__meu");
  const todos = rankingOrdenado(true);
  const pos = todos.findIndex((x) => x.chave === u.chave);
  caixa.append(el("p", "pj__posicao", pos >= 0
    ? `🏆 Você está em ${pos + 1}º lugar no ranking de XP (de ${todos.length} duelistas).`
    : "🏆 Jogue uma partida para aparecer no ranking."));
  const botoes = el("div", "pj__atalhos");
  const ranking = el("button", "btn btn-sm btn-ouro", "🏆 Ver o ranking");
  ranking.type = "button";
  ranking.addEventListener("click", () => irParaSalao("ranking"));
  const painel = el("button", "btn btn-sm btn-outline-light", "⚙️ Meu painel (foto, senha, deck)");
  painel.type = "button";
  painel.addEventListener("click", () => irParaSalao("perfil"));
  const loja = el("button", "btn btn-sm btn-loja", "🛒 Loja");
  loja.type = "button";
  loja.dataset.abrirLoja = "";
  const roleta = el("button", "btn btn-sm btn-roleta", "🎡 Roleta Diária");
  roleta.type = "button";
  roleta.dataset.abrirRoleta = "";
  botoes.append(ranking, painel, loja, roleta);
  caixa.append(botoes);
  return caixa;
}

// Todos os duelistas do ranking, em ordem (o meu perfil sempre com os números mais novos)
function rankingOrdenado(porXp) {
  const u = conta.usuarioAtual();
  const perfis = new Map(s.perfis);
  if (u) perfis.set(u.chave, u);
  return [...perfis.values()]
    .filter((p) => (porXp ? (p.xp || 0) > 0 : (p.vitorias || 0) + (p.derrotas || 0) > 0))
    .sort(porXp
      ? (a, b) => (b.xp || 0) - (a.xp || 0) || (b.vitorias || 0) - (a.vitorias || 0)
      : (a, b) => (b.vitorias || 0) - (a.vitorias || 0) || (b.xp || 0) - (a.xp || 0));
}

const RANKING_TOP = 10;

function desenharRanking() {
  const lista = $("#ranking");
  const u = conta.usuarioAtual();
  const porXp = tipoRanking === "xp";
  const todos = rankingOrdenado(porXp);
  const top = s.rankingTodos ? todos : todos.slice(0, RANKING_TOP);

  lista.replaceChildren();
  lista.classList.toggle("ranking__lista--todos", Boolean(s.rankingTodos));
  if (!top.length) {
    lista.append(el("li", "ranking__vazio", porXp ? "Ninguém fez XP ainda. Jogue uma partida e apareça aqui!" : "Ninguém venceu online ainda. Seja o primeiro careca da lista!"));
  }
  top.forEach((p, i) => {
    const li = el("li");
    if (u && p.chave === u.chave) li.classList.add("ranking__minha");
    const medalha = ["🥇", "🥈", "🥉"][i];
    if (medalha) li.dataset.medalha = medalha;
    // nome e pontos na mesma linha: nome comprido vira "…" em vez de empurrar os pontos
    const linha = el("div", "ranking__linha");
    const nome = botaoPerfil(p, "");
    if (p.tag) nome.append(`[${p.tag}] `);
    if (adm.ehAdmin(p.chave)) nome.append(el("span", "nome-adm", p.nick), seloAdm());
    else nome.append(p.nick);
    nome.title = `${p.tag ? `[${p.tag}] ` : ""}${p.nick}: ver perfil`;
    const valor = porXp ? `Nv ${nivelDoXp(p.xp)} · ${p.xp} XP` : `${p.vitorias}V ${p.derrotas}D`;
    linha.append(nome, el("span", "ranking__v", valor));
    li.append(linha);
    lista.append(li);
  });

  const mais = $("#ranking-mais");
  mais.hidden = todos.length <= RANKING_TOP;
  mais.textContent = s.rankingTodos ? `Mostrar só o top ${RANKING_TOP}` : `Ver todos (${todos.length})`;
  mais.setAttribute("aria-expanded", String(Boolean(s.rankingTodos)));

  // a minha posição, se ela não estiver na lista mostrada
  const eu = $("#ranking-eu");
  const pos = u ? todos.findIndex((p) => p.chave === u.chave) : -1;
  eu.textContent = pos >= top.length ? `Você está em ${pos + 1}º lugar (${porXp ? `${u.xp} XP` : `${u.vitorias}V ${u.derrotas}D`}).` : "";
}

/* ---------- Salão no celular: uma parte por vez ---------- */

const telaPequena = () => matchMedia("(max-width: 1199.98px)").matches;

function ligarAbasDoSalao() {
  document.querySelectorAll(".salao-abas [data-painel]").forEach((b) => {
    b.addEventListener("click", () => mostrarPainelSalao(b.dataset.painel));
  });
}

function mostrarPainelSalao(painel) {
  const raiz = $("#painel-salao");
  raiz.dataset.painel = painel;
  document.querySelectorAll(".salao-abas [data-painel]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.painel === painel)));
  if (painel === "chat") {
    s.chatNovasCelular = 0;
    const selo = $("#abas-chat-novas");
    selo.hidden = true;
    const area = $("#mensagens");
    area.scrollTop = area.scrollHeight;
  }
  if (telaPequena()) $(".salao-abas").scrollIntoView({ block: "nearest" });
}

// Chegou mensagem e, no celular, a pessoa está em outra parte do salão: avisa na aba do chat
function avisarChatNoCelular() {
  if ($("#painel-salao").dataset.painel === "chat" || !telaPequena()) return;
  s.chatNovasCelular = (s.chatNovasCelular || 0) + 1;
  const selo = $("#abas-chat-novas");
  selo.textContent = s.chatNovasCelular > 9 ? "9+" : String(s.chatNovasCelular);
  selo.hidden = false;
}

// Do meu perfil (janela) para o ranking ou para o meu painel no salão
function irParaSalao(painel) {
  bootstrap.Modal.getOrCreateInstance("#modal-perfil").hide();
  if (location.hash !== "#salao") location.hash = "#salao";
  setTimeout(() => {
    mostrarPainelSalao(painel);
    if (painel === "ranking" && !s.rankingTodos) {
      s.rankingTodos = true;
      desenharRanking();
    }
    const alvo = painel === "ranking" ? $(".ranking") : $("#perfil");
    alvo?.scrollIntoView({ behavior: "smooth", block: telaPequena() ? "nearest" : "start" });
  }, 250);
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

// Careca Coin: ícone e selo com o saldo
function iconeCoin(classe = "coin") {
  const img = el("img", classe);
  img.src = "img/careca-coin.webp";
  img.alt = "Careca Coin";
  img.width = 18;
  img.height = 18;
  return img;
}

function seloCoins(saldo) {
  const selo = el("div", "selo-coins");
  selo.title = "Careca Coins: +5 por vitória contra jogador (1vs1 ou Tag 2vs2), +1 por vitória contra o Bot";
  selo.append(iconeCoin(), el("strong", "", String(saldo)), el("span", "", saldo === 1 ? " Careca Coin" : " Careca Coins"));
  return selo;
}

// ADM: dar Careca Coins para um jogador (presente assinado; o jogo dele confere e soma)
function formPresente(p) {
  const form = el("form", "painel-adm painel-adm--presente");
  form.append(el("h4", "painel-adm__titulo", `🎁 Dar Careca Coins para ${p.nick}`));
  const linha = el("div", "painel-adm__linha");
  const qtd = el("input", "form-control form-control-sm");
  qtd.type = "number";
  qtd.min = "1";
  qtd.max = "100000";
  qtd.value = "10";
  qtd.setAttribute("aria-label", "Quantidade de Careca Coins");
  const motivo = el("input", "form-control form-control-sm");
  motivo.maxLength = 80;
  motivo.placeholder = "Motivo (ex.: campeão da Copa Careca)";
  motivo.setAttribute("aria-label", "Motivo");
  const botao = el("button", "btn btn-sm btn-ouro", "🎁 Dar");
  botao.type = "submit";
  linha.append(qtd, motivo, botao);
  form.append(linha);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const coins = Math.floor(Number(qtd.value));
    if (!(coins >= 1 && coins <= 100000)) {
      aviso("Escolha de 1 a 100000 Careca Coins.", "erro");
      return;
    }
    const u = conta.usuarioAtual();
    const presente = await adm.assinarPresente({
      id: gerarId(12), para: p.chave, coins, motivo: motivo.value.trim().slice(0, 80), de: u.chave, deNick: u.nick, t: Date.now(),
    });
    publicar(T.presente(p.chave, presente.id), presente, { reter: true });
    guardarNoBanco("dar_presente", { p_para: p.chave, p_presente: presente });
    const texto = `🎁 ${p.nick} ganhou ${coins} Careca Coins${presente.motivo ? `: ${presente.motivo}` : "!"}`;
    enviarGlobal(await adm.assinarMsg({ id: gerarId(), tipo: "aviso", de: conta.cartaoPublico(), texto, t: Date.now() }));
    aviso(`Presente enviado para ${p.nick}! Ele recebe assim que estiver online.`, "ok");
    form.reset();
  });
  return form;
}

function abrirPerfil(cartao) {
  const u = conta.usuarioAtual();
  // o perfil completo vem do broker; o meu, da conta (mais novo)
  const p = (u && cartao.chave === u.chave ? u : s.perfis.get(cartao.chave)) || { ...cartao, xp: 0, vitorias: 0, derrotas: 0 };
  const online = duelistasOnline().find((x) => x.chave === p.chave);

  const corpo = $("#perfil-jogador-corpo");
  corpo.replaceChildren();
  const titulo = $("#perfil-jogador-titulo");
  titulo.textContent = `${p.tag ? `[${p.tag}] ` : ""}`;
  if (adm.ehAdmin(p.chave)) titulo.append(el("span", "nome-adm", p.nick), seloAdm());
  else titulo.append(p.nick);

  const topo = el("div", "pj__topo");
  const img = el("img", "pj__avatar");
  img.src = `img/cartas/${p.avatar || "careca-feijao"}.webp`;
  img.alt = "";
  const info = el("div", "pj__info");
  info.append(el("div", "pj__nivel", `Nível ${nivelDoXp(p.xp || 0)} · ${p.xp || 0} XP`), seloCoins(conta.saldoCoins(p)), linhaId(p));
  const barra = el("div", "barra-xp");
  const cheio = el("span");
  cheio.style.width = `${progressoNivel(p.xp || 0) * 100}%`;
  barra.append(cheio);
  info.append(barra);
  const status = online ? (online.status === "duelando" ? "🟠 Duelando agora" : "🟢 Online") : "⚫ Offline";
  info.append(el("div", "pj__status", status));
  topo.append(comMoldura(img, visualDe(p).moldura), info);

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
    li.append(d.tipo === "bot" ? " um treino contra " : d.tipo === "tag" ? " um Tag 2vs2 contra " : d.tipo === "torneio" ? " uma partida de torneio contra " : " um duelo contra ");
    const contra = d.contra ? `${d.contra.tag ? `[${d.contra.tag}] ` : ""}${d.contra.nick}` : "alguém";
    if (d.tipo !== "bot" && d.contra && d.contra.chave) {
      li.append(botaoPerfil({ chave: d.contra.chave, nick: d.contra.nick, tag: d.contra.tag }, contra, "historico__oponente"));
    } else {
      li.append(el("span", "historico__oponente", contra));
    }
    li.append(el("span", "historico__extra", `${TEXTO_MOTIVO[d.motivo] || ""} · +${d.xp} XP${d.coins ? ` · +${d.coins}` : ""}`));
    if (d.coins) li.append(iconeCoin());
    lista.append(li);
  }
  if (!(p.historico || []).length) lista.append(el("li", "historico__vazio", "Nenhum duelo registrado ainda."));
  historico.append(lista);

  corpo.append(topo, stats);
  if (u && p.chave === u.chave) corpo.append(atalhosDoMeuPerfil(u));
  corpo.append(secaoPremios(p, false), historico);
  if (u && adm.souAdm(u.chave)) corpo.append(formPremio(p), formPresente(p));
  if (u && adm.souAdm(u.chave) && p.chave !== u.chave) corpo.append(formRedefinirSenha(p));
  if (u && adm.souAdm(u.chave) && p.chave !== u.chave && !adm.ehAdmin(p.chave) && conta.contaNoBanco()) corpo.append(formApagarConta(p));

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
  // ADM: só aparece como ADM se a assinatura conferir
  if (dados && adm.ehAdmin(dados.chave)) {
    adm.verificarPresenca(dados).then((ok) => {
      dados.admOk = ok;
      desenharOnline();
    });
  }
}

// Um item por duelista (se tiver duas abas abertas, vale a mais recente)
function duelistasOnline() {
  const agora = Date.now();
  const porChave = new Map();
  for (const p of s.online.values()) {
    if (!presencaGerenciada() && agora - p.t > PRESENCA_VALIDA) continue; // no Supabase, quem cai sai sozinho
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
  $("#abas-online-conta").textContent = todos.length;
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
    const admOk = p.admOk || (p.chave === u.chave && adm.souAdm(u.chave));
    b.append(admOk ? el("span", "nome-adm", p.nick) : p.nick);
    if (admOk) b.append(seloAdm());
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
  avisarChatNoCelular();
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
    } else if (item.tipo === "roleta") {
      area.append(mensagemRoleta(item));
    } else if (item.tipo === "aviso" && item.admOk) {
      // Aviso de ADM (assinatura conferida)
      const d = el("div", "msg msg--aviso");
      const autor = botaoPerfil(item.de, "", "msg__autor");
      autor.append(el("span", "nome-adm", item.de.nick), seloAdm());
      const rodape = el("div", "msg__aviso-de");
      rodape.append("— ", autor, ` · ${hora(item.t)}`);
      d.append(el("div", "msg__aviso-titulo", "📢 AVISO DO ADM"), el("div", "msg__aviso-texto", item.texto), rodape);
      area.append(d);
    } else {
      const ehAdm = adm.ehAdmin(item.de.chave);
      const d = el("div", "msg" + (u && item.de.chave === u.chave ? " msg--minha" : "") + (ehAdm && item.admOk ? " msg--adm" : ""));
      d.append(el("span", "msg__hora", `[${hora(item.t)}]`));
      const autor = botaoPerfil(item.de, "", "msg__autor");
      if (item.de.tag) autor.append(el("span", "tag-cla", `|${item.de.tag}| `));
      if (ehAdm && item.admOk) autor.append(el("span", "nome-adm", item.de.nick), seloAdm(), ":");
      else autor.append(`${item.de.nick}:`);
      if (ehAdm && item.admOk === false) {
        const alerta = el("span", "msg__falso", "⚠ não verificado");
        alerta.title = "Essa mensagem diz ser de um ADM, mas não tem a assinatura dele.";
        autor.append(alerta);
      }
      d.append(autor, " ", item.texto);
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

// ADM limpou o chat: some tudo o que veio antes (só vale com a assinatura do ADM)
async function limparChat(msg) {
  if (!(await adm.verificarMsg(msg)) || msg.t <= (s.limpoEm || 0)) return;
  s.limpoEm = msg.t;
  s.ultimaLimpeza = msg;
  const aba = s.abas.get("global");
  aba.itens = aba.itens.filter((i) => (i.t || 0) > msg.t);
  const linha = { id: `limpo-${msg.id}`, tipo: "sistema", texto: `🧹 O chat foi limpo pelo ADM ${msg.de.nick}.`, t: msg.t };
  if (!s.vistos.has(linha.id)) {
    s.vistos.add(linha.id);
    aba.itens.unshift(linha);
  }
  if (s.abaAtual === "global") desenharMensagens();
}

function adicionarMensagemGlobal(msg, nova) {
  if (!msg.id || s.vistos.has(msg.id)) return;
  if (msg.tipo === "limpar") {
    s.vistos.add(msg.id);
    limparChat(msg);
    return;
  }
  if ((msg.t || 0) < (s.limpoEm || 0)) return; // mensagem de antes da limpeza
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
  if (nova && u && msg.de?.chave !== u.chave) {
    tocar("mensagem");
    avisarChatNoCelular();
  }
  conferirAdm(item);
  conferirRoleta(item);
}

// Prêmio da Roleta Diária no chat. Carta e relíquia só ganham destaque depois que o banco
// confirma (qualquer um consegue mandar uma mensagem dizendo que ganhou)
function mensagemRoleta(item) {
  const destaque = item.raro && item.roletaOk;
  const d = el("div", "msg msg--roleta" + (destaque ? " msg--roleta-rara" : ""));
  if (destaque) d.append(el("div", "msg__roleta-titulo", "🎉 PRÊMIO RARO NA ROLETA 🎉"));
  d.append(el("span", "msg__roleta-texto", item.texto));
  return d;
}

function conferirRoleta(item) {
  if (item.tipo !== "roleta" || !item.raro) return;
  conta.roletaNoBanco(item.de?.chave, { deNovo: true }).then((r) => {
    item.roletaOk = Boolean(r && (item.premio === "carta" ? r.cartas.includes(item.carta)
      : item.premio === "cosmetico" ? r.cosmeticos.includes(item.cosmetico)
      : r.reliquias.some((x) => x.id === item.reliquia)));
    if (item.roletaOk) desenharMensagens();
  });
}

function anunciarRoleta({ giro, nomeCarta, nomeCosmetico } = {}) {
  const u = conta.usuarioAtual();
  if (!u || !giro || giro.premio === "nada") return;
  const raro = giro.premio === "carta" || giro.premio === "reliquia" || giro.premio === "cosmetico";
  const texto = giro.premio === "carta" ? `🃏 ${u.nick} tirou a carta lendária ${nomeCarta || giro.carta} na Roleta Diária!`
    : giro.premio === "reliquia" ? `🔺 ${u.nick} ganhou a relíquia Careca do Milênio na Roleta Diária!`
    : giro.premio === "cosmetico" ? `🎨 ${u.nick} ganhou o cosmético ${nomeCosmetico || giro.cosmetico} na Roleta Diária!`
    : `🎡 ${u.nick} girou a Roleta Diária e ganhou ${giro.valor} Careca Coins.`;
  enviarGlobal({ id: gerarId(), tipo: "roleta", de: conta.cartaoPublico(), texto, raro, premio: giro.premio, carta: giro.carta || null,
    reliquia: giro.reliquia || null, cosmetico: giro.cosmetico || null, t: Date.now() });
}

// Mensagem que diz ser de ADM: confere a assinatura e redesenha
function conferirAdm(item) {
  if (!adm.ehAdmin(item.de?.chave)) return;
  adm.verificarMsg(item).then((ok) => {
    item.admOk = ok;
    desenharMensagens();
  });
}

async function enviarMensagem() {
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
    enviarGlobal(await adm.assinarMsg({ id: gerarId(), tipo: "msg", de: conta.cartaoPublico(), texto, t: Date.now() }));
  } else {
    const aba = s.abas.get(s.abaAtual);
    const msg = await adm.assinarMsg({ id: gerarId(), tipo: "msg", de: conta.cartaoPublico(), texto, t: Date.now() });
    publicar(T.dm(aba.chave), msg);
    s.vistos.add(msg.id);
    const item = { ...msg };
    adicionarItem(aba.id, item);
    conferirAdm(item);
  }
}

function enviarGlobal(msg) {
  publicar(T.chat, msg);
  // Atualiza o histórico retido (últimas 40)
  const anteriores = s.abas.get("global").itens.filter((i) => ["msg", "sistema", "mesa", "aviso", "roleta"].includes(i.tipo)).slice(-39)
    .map(({ admOk, roletaOk, ...resto }) => resto);
  // a marca da última limpeza vai junto: quem carregar o histórico descarta o que é mais antigo
  publicar(T.historico, [...(s.ultimaLimpeza ? [s.ultimaLimpeza] : []), ...anteriores, msg], { reter: true });
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
      const item = { id: dados.id, tipo: "msg", de: dados.de, texto: String(dados.texto).slice(0, 300), t: dados.t, assinatura: dados.assinatura };
      adicionarItem(aba.id, item);
      conferirAdm(item);
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
      comecarComoAnfitriao(d, dados.de, dados.deck, dados.reliquia);
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
  enviarDM(d.com.chave, { tipo: "aceite", duelo: d.id, deck: deckAtual(), reliquia: conta.reliquiaEquipada() });

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
async function comecarComoAnfitriao(d, oponente, deckOponente, reliquia) {
  // a relíquia do oponente só vale com a assinatura do ADM (e tem que ser dele)
  const reliquiaOponente = reliquia && reliquia.para === oponente.chave && ehReliquia(reliquia.item) && (await conta.premioValido(reliquia)) ? reliquia : null;
  if (!Array.isArray(deckOponente) || problemaDoDeck(deckOponente, { comLimite: false })) {
    aviso(`O deck de ${oponente.nick} não veio certo; ele vai jogar com o deck padrão. Se continuar, recarreguem a página.`, "erro", 9000);
  }
  const { estado, eventos } = novoDuelo({
    id: d.id,
    jogadores: [
      { ...conta.cartaoPublico(), deck: deckAtual(), reliquia: conta.reliquiaEquipada() },
      { ...oponente, deck: Array.isArray(deckOponente) ? deckOponente : undefined, reliquia: reliquiaOponente },
    ],
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
      if (eu === 0 && !estado.torneio) publicar(topicosDuelo(estado.id).estado, null, { reter: true });
      location.hash = "#salao";
    },
    revanche: estado.torneio ? undefined : () => {
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
  const { xp, coins } = conta.registrarResultado({ dueloId: estado.id, venceu, oponente: estado.jogadores[1 - eu], motivo: estado.motivo, tipo: estado.torneio ? "torneio" : null });
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
  return { xp, coins };
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
const cartaoMesa = () => ({ ...conta.cartaoPublico(), deck: deckAtual(), reliquia: conta.reliquiaEquipada() });

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
  const { xp, coins } = conta.registrarResultado({
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
  return { xp, coins };
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
