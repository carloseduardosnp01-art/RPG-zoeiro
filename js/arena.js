/* ==========================================================================
   Duelo da Zoeira · js/arena.js
   Tela do duelo. Desenha o estado recebido da sessão, toca as animações
   dos eventos (na ordem em que aconteceram) e transforma cliques em ações.

     1. Abrir e fechar a arena
     2. Fila de atualizações
     3. Desenho: placar, campo, fases, mão
     4. Painel lateral: prévia, registro, chat
     5. Interação: menu da carta e escolhas
     6. Animações dos eventos
     7. Relógio, avisos e resultado
   ========================================================================== */

import {
  carta, quemAge, opcoesDaCarta, atkAtual, localizar, oponente, ZONAS, PL_INICIAL, ErroJogada,
} from "./motor.js?v=202610010050";
import { criarCarta as criarCartaBase, criarVerso, linhaTipo, nomeCategoria } from "./cartas-ui.js?v=202610010050";
import { el, esperar, aviso } from "./util.js?v=202610010050";
import { tocar } from "./som.js?v=202610010050";
import { abrirDetalhes } from "./catalogo.js?v=202610010050";

const raiz = document.querySelector("#arena");

// Na arena as artes carregam na hora (com "lazy" elas atrasavam em abas em segundo plano)
const criarCarta = (c, opcoes = {}) => criarCartaBase(c, { lazy: false, ...opcoes });
const vazia = document.querySelector("#arena-vazia");

const FASES_UI = [
  ["compra", "DRAW", "Compra"],
  ["espera", "STBY", "Espera"],
  ["principal1", "MP1", "Fase Principal 1"],
  ["batalha", "BP", "Fase de Batalha"],
  ["principal2", "MP2", "Fase Principal 2"],
  ["final", "END", "Fase Final (passar o turno)"],
];

const FRASES = {
  vapo: "VAPO!",
  "forca-careca": "FORÇA CARECA!",
  "armadilha-big": "CAIU NA ARMADILHA DO BIG!",
  luz: "A LUZ CARECA TE CEGOU!",
  soco: "SOCO DO BIG!",
  bust: "+700 DE AUTOESTIMA!",
  invocador: "O INVOCADOR CHAMOU!",
  "tributo-destruir-monstro": "RAIO DO PT!",
  "tributo-destruir-magias": "REMOVIDO DO GRUPO!",
  "flip-destruir": "SURPRESAAA!",
  penetra: "CHEGOU DE PENETRA!",
  saideira: "MAIS UMA, GARÇOM!",
  "flip-comprar": "COMPRA UMA!",
  "flip-descartar": "DESCARTA ESSA!",
  karecoh: "NEM ENCOSTA!",
  wellington: "QUEBRA-MAGIA!",
  "flip-buscar-magia": "TADALAFILA NA MÃO!",
  "mestre-laminas": "LÂMINAS E PUNHOS!",
  "manoel-gelo": "O GELO NÃO ACABA!",
  "gelo-careca": "CONGELOU GERAL!",
  "pote-gelo": "POTE DO GELO!",
  lamento: "VOLTOU DO ALÉM!",
  "sai-daqui": "SAI DAQUI, OBESO!",
  "adm-ditador": "BANIDO PELO ADM!",
  david: "FORÇA DO VENTO!",
  davi: "VOLTA PRA MÃO!",
  "davi-cemiterio": "O ANIMAL VOLTOU!",
  thales: "CHAMA OS IRMÃOS!",
  george: "PROTEGE A MANADA!",
  john: "VEM, MANO!",
  "midas-animal": "TROCA DE TURNO NA BOCA!",
  "big-animal": "O BIG CHEGOU!",
  "miqueas-animal": "PATO MAROMBEIRO!",
  emanoel: "VOLTEI COM REFORÇO!",
  egoismo: "EGOÍSMO PURO!",
  zoologico: "BEM-VINDO AO ZOOLÓGICO!",
  gole: "O ÚLTIMO GOLE!",
};

const PROVOCACOES = ["😂 Chora não!", "🧑‍🦲 Careca demais!", "💨 Vapo!", "🤡 Tá com medo?", "🔥 Joga logo!", "👋 GG"];

let sessao = null;
let opcoesArena = {};
let fila = Promise.resolve();
let pendentesNaFila = 0;
let prazo = 0;
let seqDoPrazo = -1;
let pediuTempo = -1;
let relogio = null;
let escolhaAberta = null;   // { fechar() } da escolha pendente aberta
let maoAnterior = [];
let refs = {};


/* ---------- 1. Abrir e fechar a arena ---------- */

export const arenaAtiva = () => Boolean(sessao);
export const sessaoAtual = () => sessao;

// index.html?debug expõe a sessão no console (para testes)
if (new URLSearchParams(location.search).has("debug")) window.zoeiraDebug = { sessao: () => sessao };

// opcoes: { aoTerminar(estado, eu) -> { xp } , aoSair(), revanche() }
export function abrirArena(novaSessao, opcoes = {}) {
  if (sessao) fecharArena();
  sessao = novaSessao;
  opcoesArena = opcoes;
  fila = Promise.resolve();
  pendentesNaFila = 0;
  seqDoPrazo = -1;
  pediuTempo = -1;
  maoAnterior = [];

  montarEsqueleto();
  vazia.hidden = true;
  raiz.hidden = false;

  sessao.aguardarVisual = () => fila;
  sessao.aoAtualizar((estado, eventos) => enfileirar(estado, eventos));
  sessao.aoChat(receberChat);
  sessao.aoStatus(mostrarStatusConexao);

  enfileirar(sessao.estado, sessao.eventosIniciais || []);
  sessao.iniciar();
  clearInterval(relogio);
  relogio = setInterval(atualizarRelogio, 250);
  document.dispatchEvent(new CustomEvent("arena-mudou"));
}

function atualizarBotaoTelaCheia() {
  const botao = raiz.querySelector("#botao-tela-cheia");
  if (botao) botao.textContent = document.fullscreenElement ? "🗗 Sair da tela cheia" : "⛶ Tela cheia";
}
document.addEventListener("fullscreenchange", atualizarBotaoTelaCheia);

export function fecharArena() {
  if (!sessao) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  sessao.encerrar();
  sessao = null;
  clearInterval(relogio);
  fecharMenu();
  if (escolhaAberta) escolhaAberta.fechar();
  document.querySelectorAll(".resultado, .corte, .banner-turno").forEach((x) => x.remove());
  raiz.replaceChildren();
  raiz.hidden = true;
  vazia.hidden = false;
  document.dispatchEvent(new CustomEvent("arena-mudou"));
}

function montarEsqueleto() {
  raiz.innerHTML = `
    <div class="arena__corpo">
      <div class="coluna-jogadores">
        <div class="placar" id="placar"></div>
        <div class="ferramentas-arena">
          <button type="button" class="btn btn-sm btn-outline-light" id="botao-tela-cheia">⛶ Tela cheia</button>
          <a class="btn btn-sm btn-outline-light" href="#inicio" title="O duelo continua: a faixa verde traz você de volta">🏠 Ir ao site</a>
        </div>
      </div>
      <div class="tabuleiro">
        <div class="aviso-arena" id="aviso-arena" hidden></div>
        <div class="campo-e-fases">
          <div class="campo" id="campo" aria-label="Campo de duelo"></div>
          <div class="fases" id="fases" role="group" aria-label="Fases do turno"></div>
        </div>
        <div class="mao" id="mao" aria-label="Sua mão"></div>
      </div>
      <aside class="lateral" aria-label="Informações do duelo">
        <section class="caixa-lateral">
          <h3 class="caixa-lateral__titulo">Carta</h3>
          <div class="previa" id="previa"><p class="previa__dica">Passe o mouse (ou toque) numa carta para ver os detalhes.</p></div>
        </section>
        <section class="caixa-lateral caixa-lateral--cresce">
          <h3 class="caixa-lateral__titulo">Registro do duelo</h3>
          <ol class="log" id="log" aria-live="polite"></ol>
        </section>
        <section class="caixa-lateral caixa-lateral--cresce chat-duelo">
          <h3 class="caixa-lateral__titulo">Chat do duelo</h3>
          <div class="chat-duelo__mensagens" id="chat-duelo"></div>
          <div class="provocacoes" id="provocacoes"></div>
          <form class="chat-duelo__form" id="form-chat-duelo">
            <label class="visually-hidden" for="campo-chat-duelo">Mensagem para o oponente</label>
            <input class="form-control form-control-sm" id="campo-chat-duelo" maxlength="200" autocomplete="off" placeholder="Zoar o oponente...">
            <button class="btn btn-sm btn-marrom" type="submit">Enviar</button>
          </form>
        </section>
        <div class="acoes-duelo">
          <button type="button" class="btn btn-sm btn-outline-danger" id="botao-desistir">🏳️ Desistir</button>
          <button type="button" class="btn btn-sm btn-outline-light" id="botao-sair-arena">🚪 Sair da arena</button>
        </div>
      </aside>
    </div>`;

  refs = {
    placar: raiz.querySelector("#placar"),
    aviso: raiz.querySelector("#aviso-arena"),
    campo: raiz.querySelector("#campo"),
    fases: raiz.querySelector("#fases"),
    mao: raiz.querySelector("#mao"),
    previa: raiz.querySelector("#previa"),
    log: raiz.querySelector("#log"),
    chat: raiz.querySelector("#chat-duelo"),
  };

  const provocacoes = raiz.querySelector("#provocacoes");
  for (const texto of PROVOCACOES) {
    const b = el("button", "", texto);
    b.type = "button";
    b.addEventListener("click", () => sessao?.enviarChat(texto));
    provocacoes.append(b);
  }

  raiz.querySelector("#form-chat-duelo").addEventListener("submit", (e) => {
    e.preventDefault();
    const campo = raiz.querySelector("#campo-chat-duelo");
    const texto = campo.value.trim();
    if (texto && sessao) sessao.enviarChat(texto);
    campo.value = "";
  });

  raiz.querySelector("#botao-desistir").addEventListener("click", () => {
    if (!sessao || sessao.estado.vencedor !== null) return;
    if (confirm("Desistir do duelo? Vai contar como derrota.")) agir({ tipo: "desistir" });
  });

  raiz.querySelector("#botao-sair-arena").addEventListener("click", sairDaArena);

  const telaCheia = raiz.querySelector("#botao-tela-cheia");
  if (!document.documentElement.requestFullscreen) telaCheia.hidden = true;
  telaCheia.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => aviso("O navegador não deixou abrir em tela cheia.", "erro"));
  });
  atualizarBotaoTelaCheia();
}

function sairDaArena() {
  if (!sessao) return;
  if (sessao.estado.vencedor === null) {
    if (!confirm("O duelo ainda não acabou. Sair agora conta como desistência. Sair mesmo?")) return;
    agir({ tipo: "desistir" });
  }
  const aoSair = opcoesArena.aoSair;
  fecharArena();
  if (aoSair) aoSair();
}


/* ---------- 2. Fila de atualizações ---------- */

function enfileirar(estado, eventos) {
  pendentesNaFila++;
  raiz.dataset.ocupado = "true";
  fila = fila
    .then(async () => {
      if (!sessao) return;
      fecharMenu();
      await tocarEventos(eventos, estado);
      if (!sessao) return;
      desenhar(estado);
    })
    .catch((erro) => console.error("Erro na arena:", erro))
    .finally(() => {
      pendentesNaFila--;
      if (pendentesNaFila === 0) {
        raiz.dataset.ocupado = "false";
        if (sessao) depoisDeDesenhar();
      }
    });
}

// Depois que tudo foi desenhado: abre a escolha pendente ou o resultado
function depoisDeDesenhar() {
  const estado = sessao.estado;
  if (estado.seq !== seqDoPrazo) {
    seqDoPrazo = estado.seq;
    prazo = Date.now() + estado.tempoAcao * 1000;
  }
  if (escolhaAberta && (!estado.pendente || quemAge(estado) !== sessao.eu)) {
    escolhaAberta.fechar();
    escolhaAberta = null;
  }
  if (estado.vencedor !== null) {
    mostrarResultado(estado);
    return;
  }
  if (estado.pendente && quemAge(estado) === sessao.eu && !escolhaAberta) abrirEscolhaPendente(estado);
}

function agir(acao) {
  if (!sessao) return false;
  try {
    sessao.agir(acao);
    return true;
  } catch (erro) {
    if (erro instanceof ErroJogada) {
      aviso(erro.message, "erro");
      return false;
    }
    throw erro;
  }
}

const ocupado = () => raiz.dataset.ocupado === "true";


/* ---------- 3. Desenho ---------- */

function desenhar(estado) {
  desenharPlacar(estado);
  desenharCampo(estado);
  desenharFases(estado);
  desenharMao(estado);
  desenharLog(estado);
}

const nomeJogador = (estado, j) => (j === sessao.eu ? "Você" : estado.jogadores[j].nick);
// "Seu deck" / "Deck de Fulano"
const deQuem = (estado, j, coisa, genero = "o") => (j === sessao.eu ? `${genero === "a" ? "Sua" : "Seu"} ${coisa.toLowerCase()}` : `${coisa} de ${estado.jogadores[j].nick}`);
const imagemAvatar = (id) => `img/cartas/${id || "careca-feijao"}.webp`;

function desenharPlacar(estado) {
  const eu = sessao.eu;
  const op = oponente(eu);
  refs.placar.replaceChildren(infoJogador(estado, eu, "eu"), criarRelogio(estado), infoJogador(estado, op, "op"));
}

function infoJogador(estado, j, lado) {
  const p = estado.jogadores[j];
  const info = el("div", `jogador-info jogador-info--${lado}`);
  info.dataset.j = j;
  info.dataset.vez = String(quemAge(estado) === j);

  const nivel = el("div", "jogador-info__nivel", "Level");
  nivel.append(el("strong", "", String(p.nivel)));

  const cartas = el("div", "jogador-info__cartas", "Cartas");
  cartas.append(el("strong", "", String(p.mao.length)), el("span", "", `Deck ${p.deck.length}`));
  cartas.title = `${p.mao.length} na mão, ${p.deck.length} no deck, ${p.cemiterio.length} no cemitério`;

  const meio = el("div", "jogador-info__meio");
  const nome = el("div", "jogador-info__nome");
  if (p.tag) nome.append(el("span", "tag-cla", `[${p.tag}] `));
  nome.append(p.nick);
  if (p.semDanoBatalha === estado.turno) {
    const asa = el("span", "protecao", " 🪽");
    asa.title = "Karecoh Alado: não sofre dano de batalha neste turno";
    nome.append(asa);
  }
  const barra = el("div", "barra-pl");
  barra.style.setProperty("--pct", `${Math.max(0, (p.pl / PL_INICIAL) * 100)}%`);
  barra.dataset.perigo = String(p.pl <= 2000);
  barra.append(el("span", "barra-pl__cheio"), el("span", "barra-pl__valor", `${p.pl} LP`));
  barra.setAttribute("role", "img");
  barra.setAttribute("aria-label", `${p.nick}: ${p.pl} pontos de vida`);
  meio.append(nome, barra);

  const avatar = el("img", "jogador-info__avatar");
  avatar.src = imagemAvatar(p.avatar);
  avatar.alt = "";
  info.append(nivel, cartas, meio, avatar);
  return info;
}

function criarRelogio(estado) {
  const r = el("div", "relogio");
  r.id = "relogio";
  r.append(el("span", "relogio__tempo", "--"), el("span", "relogio__turno", `Turno ${estado.turno}`));
  const vez = quemAge(estado);
  const texto = vez === null ? "Fim de duelo" : vez === sessao.eu ? "Sua vez" : `Vez de ${estado.jogadores[vez].nick}`;
  r.append(el("span", "relogio__vez", texto));
  return r;
}

function desenharCampo(estado) {
  const eu = sessao.eu;
  const op = oponente(eu);
  const invertido = [4, 3, 2, 1, 0];
  const campo = refs.campo;
  campo.replaceChildren();

  // Linha 1: deck do oponente, magias do oponente, zona extra
  campo.append(zonaPilha(estado, op, "deck"));
  invertido.forEach((s) => campo.append(zonaCarta(estado, op, "magias", s)));
  campo.append(zonaDecorativa(op));
  // Linha 2: cemitério do oponente, monstros do oponente
  campo.append(zonaPilha(estado, op, "cemiterio"));
  invertido.forEach((s) => campo.append(zonaCarta(estado, op, "monstros", s)));
  campo.append(zonaDecorativa(op));
  // Divisa
  campo.append(el("div", "campo__divisa"));
  // Linha 3: meus monstros e meu cemitério
  campo.append(zonaDecorativa(eu));
  for (let s = 0; s < ZONAS; s++) campo.append(zonaCarta(estado, eu, "monstros", s));
  campo.append(zonaPilha(estado, eu, "cemiterio"));
  // Linha 4: minhas magias e meu deck
  campo.append(zonaDecorativa(eu));
  for (let s = 0; s < ZONAS; s++) campo.append(zonaCarta(estado, eu, "magias", s));
  campo.append(zonaPilha(estado, eu, "deck"));
}

function criarZona(j, zona, slot = null) {
  const z = el("div", "zona");
  z.dataset.zona = zona;
  z.dataset.j = j;
  if (slot !== null) z.dataset.slot = slot;
  if (j !== sessao.eu) z.classList.add("zona--op");
  return z;
}

const ROTULOS = { monstros: "Zona de Monstro", magias: "Magia & Armadilha", deck: "Deck", cemiterio: "Cemitério", extra: "Zona Careca" };

function vaziaCom(z, zona) {
  z.classList.add("zona--vazia");
  z.append(el("span", "zona__rotulo", ROTULOS[zona]));
  return z;
}

function zonaDecorativa(j) {
  return vaziaCom(criarZona(j, "extra"), "extra");
}

function zonaPilha(estado, j, zona) {
  const p = estado.jogadores[j];
  const z = criarZona(j, zona);
  const lista = p[zona];
  if (!lista.length) return vaziaCom(z, zona);

  const b = el("button", "pilha-campo");
  b.type = "button";
  if (zona === "deck") {
    b.append(criarVerso());
    b.setAttribute("aria-label", `${deQuem(estado, j, "Deck")}: ${lista.length} cartas`);
    b.addEventListener("click", () => aviso(`${deQuem(estado, j, "Deck")}: ${lista.length} cartas.`));
  } else {
    const topo = lista[lista.length - 1];
    b.append(criarCarta(carta(estado, topo)));
    b.setAttribute("aria-label", `${deQuem(estado, j, "Cemitério")}: ${lista.length} cartas. Ver cartas`);
    b.addEventListener("click", () => verCemiterio(estado, j));
    ligarPrevia(b, topo);
  }
  b.append(el("span", "pilha-campo__qtd", String(lista.length)));
  z.append(b);
  return z;
}

function zonaCarta(estado, j, zona, slot) {
  const z = criarZona(j, zona, slot);
  const obj = estado.jogadores[j][zona][slot];
  if (!obj) return vaziaCom(z, zona);

  const c = carta(estado, obj.iid);
  const meu = j === sessao.eu;
  const b = el("button", "no-campo");
  b.type = "button";
  b.dataset.iid = obj.iid;
  if (zona === "monstros") b.dataset.pos = obj.pos;

  if (obj.face) {
    const contador = c.efeito === "luz" ? obj.turnosRestantes : null;
    const atk = zona === "monstros" ? atkAtual(estado, obj.iid) : undefined;
    b.append(criarCarta(c, { atk, contador }));
  } else if (meu) {
    b.dataset.minhaBaixada = "true";
    b.append(criarCarta(c), el("span", "selo-baixada", "BAIXADA"));
  } else {
    b.append(criarVerso());
  }

  // ATK/DEF legíveis por cima da carta
  if (zona === "monstros" && (obj.face || meu)) {
    const atk = atkAtual(estado, obj.iid);
    const selo = el("span", "selo-stats-campo");
    const sAtk = el("span", atk > c.atk ? "mais" : "", String(atk));
    const sDef = el("span", obj.pos === "def" ? "ativo-def" : "", String(c.def));
    selo.append(sAtk, " / ", sDef);
    z.append(selo);
  }
  if (zona === "monstros" && obj.marcadores) {
    const mc = el("span", "selo-marcador", `✦${obj.marcadores}`);
    mc.title = "Marcador de Magia";
    z.append(mc);
  }
  if (zona === "monstros" && obj.ataqueDuplo === estado.turno && !obj.atacouDuas && estado.vez === j) {
    const dup = el("span", "selo-marcador selo-marcador--duplo", "⚔×2");
    dup.title = "Pode atacar duas vezes neste turno";
    z.append(dup);
  }
  if (zona === "monstros" && equipamentos(estado, obj.iid)) {
    const eq = el("span", "selo-equip", "✚");
    eq.title = "Equipado";
    z.append(eq);
  }

  const visivel = obj.face || meu;
  b.setAttribute("aria-label", visivel ? `${c.nome}${zona === "monstros" ? ` (${obj.pos === "atk" ? "Ataque" : "Defesa"})` : ""}` : "Carta virada para baixo");
  if (visivel) ligarPrevia(b, obj.iid);
  if (meu && opcoesDaCarta(estado, sessao.eu, obj.iid).length) b.dataset.acao = "true";
  b.addEventListener("click", () => clicarCarta(obj.iid, b, visivel));
  z.append(b);
  return z;
}

function equipamentos(estado, iid) {
  return estado.jogadores.some((p) => p.magias.some((m) => m && m.face && m.equipadoEm === iid));
}

function desenharFases(estado) {
  const f = refs.fases;
  f.replaceChildren(el("span", "fases__titulo", "Fases:"));
  const minhaVez = quemAge(estado) === sessao.eu && !estado.pendente && estado.vez === sessao.eu;
  const permitido = {
    principal1: estado.turno > 1 ? ["batalha", "final"] : ["final"],
    batalha: ["principal2", "final"],
    principal2: ["final"],
  }[estado.fase] || [];

  FASES_UI.forEach(([id, sigla, nome], i) => {
    if (i > 0) f.append(el("span", "fase-seta", "▶"));
    const pode = minhaVez && permitido.includes(id);
    const item = el(pode ? "button" : "span", "fase", sigla);
    item.title = nome;
    if (estado.fase === id) item.dataset.atual = "true";
    if (pode) {
      item.type = "button";
      item.setAttribute("aria-label", `Ir para ${nome}`);
      item.addEventListener("click", () => {
        if (ocupado()) return;
        tocar("clique");
        agir({ tipo: "fase", para: id });
      });
    }
    f.append(item);
  });
}

function desenharMao(estado) {
  const p = estado.jogadores[sessao.eu];
  refs.mao.replaceChildren();
  for (const iid of p.mao) {
    const c = carta(estado, iid);
    const b = el("button", "mao__carta");
    b.type = "button";
    b.dataset.iid = iid;
    b.setAttribute("aria-label", `${c.nome} (na mão)`);
    if (!maoAnterior.includes(iid)) b.classList.add("mao__carta--nova");
    if (opcoesDaCarta(estado, sessao.eu, iid).length) b.dataset.acao = "true";
    b.append(criarCarta(c));
    ligarPrevia(b, iid);
    b.addEventListener("click", () => clicarCarta(iid, b, true));
    refs.mao.append(b);
  }
  maoAnterior = [...p.mao];
}


/* ---------- 4. Painel lateral ---------- */

function ligarPrevia(elemento, iid) {
  const mostrar = () => mostrarPrevia(iid);
  elemento.addEventListener("mouseenter", mostrar);
  elemento.addEventListener("focus", mostrar);
}

function mostrarPrevia(iid) {
  if (!sessao) return;
  const estado = sessao.estado;
  const c = carta(estado, iid);
  const loc = localizar(estado, iid);
  const cartaEl = el("div", "previa__carta");
  const atk = loc && loc.zona === "monstros" ? atkAtual(estado, iid) : undefined;
  cartaEl.append(criarCarta(c, { atk }));
  const texto = el("div", "previa__texto");
  texto.append(el("h4", "", c.nome));
  texto.append(el("div", "", c.categoria === "monstro" ? `${linhaTipo(c)} · Nível ${c.nivel}` : nomeCategoria(c)));
  if (c.categoria === "monstro") texto.append(el("div", "previa__stats", `ATK ${atk ?? c.atk} / DEF ${c.def}`));
  texto.append(el("p", "mb-0 mt-1", c.texto));
  refs.previa.replaceChildren(cartaEl, texto);
}

function desenharLog(estado) {
  refs.log.replaceChildren();
  for (const ev of estado.historico) {
    const linha = descreverEvento(estado, ev);
    if (!linha) continue;
    const li = el("li", linha.classe || "", linha.texto);
    refs.log.append(li);
  }
  refs.log.scrollTop = refs.log.scrollHeight;
}

function descreverEvento(estado, ev) {
  const eu = sessao.eu;
  const quem = (j) => nomeJogador(estado, j);
  const nome = (iid) => carta(estado, iid).nome;
  const minha = ev.j === eu ? " log--eu" : "";
  switch (ev.t) {
    case "inicio": return { texto: `🎲 ${quem(ev.j)} começa o duelo!`, classe: "log--turno" };
    case "turno": return { texto: `— Turno ${ev.turno}: ${quem(ev.j)} —`, classe: "log--turno" };
    case "compra": return ev.inicial ? null : { texto: ev.j === eu ? `Você comprou ${nome(ev.iid)}.` : `${quem(ev.j)} comprou 1 carta.`, classe: minha };
    case "invocacao": {
      const modos = { normal: "invocou", tributo: "invocou por Invocação-Tributo", flip: "virou (Invocação-Flip)", especial: "invocou por Invocação-Especial" };
      return { texto: `${quem(ev.j)} ${modos[ev.modo]} ${nome(ev.iid)}.`, classe: minha };
    }
    case "tributo": return { texto: `${nome(ev.iid)} foi oferecido como tributo.`, classe: minha };
    case "baixada":
      if (ev.zona === "monstros") return { texto: `${quem(ev.j)} baixou um monstro${ev.j === eu ? ` (${nome(ev.iid)})` : ""}.`, classe: minha };
      return { texto: `${quem(ev.j)} baixou uma carta${ev.j === eu ? ` (${nome(ev.iid)})` : ""}.`, classe: minha };
    case "ativacao": return { texto: `✨ ${quem(ev.j)} ativou ${nome(ev.iid)}!`, classe: minha };
    case "armadilha": return { texto: ev.j === eu ? `🪤 Armadilha! Sua ${nome(ev.iid)} ativou sozinha!` : `🪤 Armadilha! ${nome(ev.iid)} de ${quem(ev.j)} ativou sozinha!`, classe: "log--armadilha" };
    case "efeito": return { texto: `⚡ Efeito de ${nome(ev.iid)}!`, classe: minha };
    case "equipada": return { texto: `${nome(ev.iid)} foi equipado em ${nome(ev.alvo)}.`, classe: minha };
    case "ataque": return { texto: `⚔️ ${nome(ev.iid)} atacou ${ev.alvo ? (localizar(estado, ev.alvo)?.obj?.face === false ? "um monstro virado" : nome(ev.alvo)) : "diretamente"}!`, classe: minha };
    case "virada": return { texto: `${nome(ev.iid)} foi virado para cima.` };
    case "destruida": return { texto: `💥 ${nome(ev.iid)} foi destruído${ev.causa === "batalha" ? " em batalha" : ""}.`, classe: "log--destruida" };
    case "dano": return { texto: `${quem(ev.j)} perdeu ${ev.valor} LP (${ev.pl}).`, classe: "log--dano" };
    case "marcador": return { texto: `✦ ${nome(ev.iid)} recebeu 1 Marcador de Magia (+300 ATK).`, classe: minha };
    case "busca": return { texto: `${quem(ev.j)} ${ev.j === eu ? "adicionou" : "adicionou"} ${nome(ev.iid)} do deck à mão.`, classe: minha };
    case "aoDeck": return { texto: `${quem(ev.j)} devolveu ${ev.j === eu ? nome(ev.iid) : "uma carta"} ao deck.`, classe: minha };
    case "ataqueDuplo": return { texto: `⚔️ ${nome(ev.iid)} pode atacar duas vezes neste turno!`, classe: minha };
    case "custo": return { texto: `${quem(ev.j)} pagou ${ev.valor} PV (${ev.pl}).`, classe: "log--dano" };
    case "aoCemiterio": return { texto: `🪦 ${nome(ev.iid)} foi do deck de ${quem(ev.j)} para o Cemitério.`, classe: minha };
    case "banida": return { texto: `🚫 ${nome(ev.iid)} foi banido do jogo.`, classe: "log--armadilha" };
    case "paraMao": return { texto: `↩️ ${nome(ev.iid)} voltou para a mão de ${quem(ev.j)}.`, classe: "log--armadilha" };
    case "ajusteDeck": return { texto: `⚠️ ${ev.j === eu ? "Seu deck tinha" : `O deck de ${quem(ev.j)} tinha`} ${ev.trocadas} carta${ev.trocadas > 1 ? "s" : ""} acima do limite: ${ev.trocadas > 1 ? "viraram" : "virou"} Careca Feijão.`, classe: "log--turno" };
    case "protegido": return { texto: `🪽 ${ev.j === eu ? "Você não sofreu" : `${quem(ev.j)} não sofreu`} ${ev.valor} de dano de batalha (Karecoh Alado).`, classe: "log--armadilha" };
    case "posicao": return { texto: `${nome(ev.iid)} mudou para ${ev.pos === "atk" ? "Ataque" : "Defesa"}.`, classe: minha };
    case "descarte": return { texto: `${quem(ev.j)} descartou ${nome(ev.iid)}.`, classe: minha };
    case "expirou": return { texto: `${nome(ev.iid)} apagou a luz: acabaram os turnos.` };
    case "tempo": return { texto: ev.j === eu ? "⏰ Seu tempo acabou." : `⏰ O tempo de ${quem(ev.j)} acabou.` };
    case "desistencia": return { texto: `🏳️ ${quem(ev.j)} desistiu.` };
    case "fim": return { texto: `🏆 ${quem(ev.vencedor)} venceu o duelo!`, classe: "log--fim" };
    default: return null;
  }
}

function receberChat(msg) {
  if (!sessao) return;
  const p = el("p", msg.j === sessao.eu ? "minha" : "");
  p.append(el("strong", "", `${msg.nick}: `), msg.texto);
  refs.chat.append(p);
  refs.chat.scrollTop = refs.chat.scrollHeight;
  if (msg.j !== sessao.eu) tocar("mensagem");
  // Balão sobre o jogador
  const info = refs.placar.querySelector(`.jogador-info[data-j="${msg.j}"]`);
  if (info) {
    info.querySelector(".balao")?.remove();
    info.append(el("div", "balao", msg.texto));
  }
}


/* ---------- 5. Interação ---------- */

let menuAtual = null;

function fecharMenu() {
  if (menuAtual) {
    menuAtual.remove();
    menuAtual = null;
  }
}

document.addEventListener("click", (e) => {
  if (menuAtual && !menuAtual.contains(e.target) && !e.target.closest(".no-campo, .mao__carta")) fecharMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharMenu();
});

function clicarCarta(iid, elemento, visivel) {
  if (!sessao) return;
  if (visivel) mostrarPrevia(iid);
  fecharMenu();
  const estado = sessao.estado;
  const opcoes = ocupado() ? [] : opcoesDaCarta(estado, sessao.eu, iid);
  if (!visivel && !opcoes.length) return;

  const menu = el("div", "menu-carta");
  menu.setAttribute("role", "menu");
  menu.append(el("div", "menu-carta__titulo", visivel ? carta(estado, iid).nome : "Carta virada"));
  opcoes.forEach((op, i) => {
    const b = el("button", "", op.rotulo);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (i === 0) b.dataset.principal = "true";
    b.addEventListener("click", () => executarOpcao(op));
    menu.append(b);
  });
  if (!opcoes.length) {
    const minhaVez = quemAge(estado) === sessao.eu;
    menu.append(el("div", "menu-carta__vazio", minhaVez ? "Nenhuma ação com esta carta agora." : "Aguarde a sua vez."));
  }
  if (visivel) {
    const det = el("button", "", "🔍 Ver detalhes");
    det.type = "button";
    det.setAttribute("role", "menuitem");
    det.addEventListener("click", () => {
      fecharMenu();
      abrirDetalhes(carta(estado, iid).id);
    });
    menu.append(det);
  }

  // Posiciona o menu perto da carta, dentro da arena
  raiz.append(menu);
  const r = elemento.getBoundingClientRect();
  const base = raiz.getBoundingClientRect();
  const largura = menu.offsetWidth;
  let x = r.left - base.left + r.width / 2 - largura / 2;
  x = Math.max(4, Math.min(x, base.width - largura - 4));
  let y = r.top - base.top - menu.offsetHeight - 6;
  if (y < 0) y = r.bottom - base.top + 6;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menuAtual = menu;
  menu.querySelector("button")?.focus({ preventScroll: true });
}

async function executarOpcao(op) {
  fecharMenu();
  if (!sessao || ocupado()) return;
  const estado = sessao.estado;
  const eu = sessao.eu;
  const acao = { ...op.acao };

  if (op.tributos) {
    const meus = estado.jogadores[eu].monstros.filter(Boolean).map((m) => m.iid);
    const r = await escolherCartas({
      titulo: `Escolha ${op.tributos} tributo${op.tributos > 1 ? "s" : ""}`,
      sub: "Os monstros escolhidos vão para o Cemitério.",
      candidatos: meus, min: op.tributos, max: op.tributos,
    });
    if (!r) return;
    acao.tributos = r.map((iid) => localizar(estado, iid).slot);
  }
  if (op.alvos) {
    const r = await escolherCartas({ titulo: op.alvos.titulo, candidatos: op.alvos.candidatos, min: op.alvos.min, max: op.alvos.max });
    if (!r) return;
    acao.alvos = r;
  }
  if (op.ataque) {
    if (op.ataque.direto) {
      acao.alvo = null;
    } else {
      const op2 = estado.jogadores[oponente(eu)];
      const r = await escolherCartas({
        titulo: "Escolha o alvo do ataque",
        sub: "Cuidado com as armadilhas viradas do oponente...",
        candidatos: op.ataque.alvos.map((s) => op2.monstros[s].iid), min: 1, max: 1,
      });
      if (!r) return;
      acao.alvo = localizar(estado, r[0]).slot;
    }
  }
  if (sessao && sessao.estado === estado) {
    tocar("clique");
    agir(acao);
  }
}

// Janela para escolher cartas. Devolve a lista de iids escolhidos (ou null se cancelar).
function escolherCartas({ titulo, sub = "", candidatos, min, max, podeCancelar = true, somenteVer = false }) {
  return new Promise((resolve) => {
    const estado = sessao.estado;
    const eu = sessao.eu;
    const escolhidos = new Set();
    const fundo = el("div", "escolha");
    fundo.setAttribute("role", "dialog");
    fundo.setAttribute("aria-modal", "true");
    fundo.setAttribute("aria-label", titulo);
    const caixa = el("div", "escolha__caixa");
    caixa.append(el("h3", "escolha__titulo", titulo));
    const textoSub = sub || (min === max ? `Escolha ${min}.` : `Escolha de ${min} a ${max}.`);
    caixa.append(el("p", "escolha__sub", textoSub));

    const grade = el("div", "escolha__cartas");
    const confirmar = el("button", "btn btn-ouro", "Confirmar");
    confirmar.type = "button";
    const atualizar = () => {
      confirmar.disabled = escolhidos.size < min || escolhidos.size > max;
    };

    for (const iid of candidatos) {
      const loc = localizar(estado, iid);
      const visivel = loc.j === eu || !loc.obj || loc.obj.face || loc.zona === "mao";
      const c = carta(estado, iid);
      const b = el("button", "escolha__opcao");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-label", visivel ? c.nome : "Carta virada do oponente");
      b.append(visivel ? criarCarta(c, { atk: loc.zona === "monstros" ? atkAtual(estado, iid) : undefined }) : criarVerso());
      const lado = loc.zona === "mao" ? (loc.j === eu ? "Na sua mão" : "Mão do oponente") : loc.zona === "deck" ? "No seu deck" : loc.j === eu ? "Seu campo" : "Campo do oponente";
      b.append(el("span", "escolha__lado", lado));
      b.addEventListener("click", () => {
        if (escolhidos.has(iid)) escolhidos.delete(iid);
        else {
          if (max === 1) escolhidos.clear();
          if (escolhidos.size >= max) return;
          escolhidos.add(iid);
        }
        grade.querySelectorAll(".escolha__opcao").forEach((x, i) => x.setAttribute("aria-pressed", String(escolhidos.has(candidatos[i]))));
        atualizar();
        tocar("clique");
        if (min === 1 && max === 1 && escolhidos.size === 1) terminar([...escolhidos]);
      });
      grade.append(b);
    }
    caixa.append(grade);

    const botoes = el("div", "escolha__botoes");
    if (podeCancelar) {
      const cancelar = el("button", "btn btn-outline-light", somenteVer ? "Fechar" : "Cancelar");
      cancelar.type = "button";
      cancelar.addEventListener("click", () => terminar(null));
      botoes.append(cancelar);
    }
    if (min === 0 && !somenteVer) {
      const nenhum = el("button", "btn btn-outline-secondary", "Não escolher nada");
      nenhum.type = "button";
      nenhum.addEventListener("click", () => terminar([]));
      botoes.append(nenhum);
    }
    confirmar.addEventListener("click", () => terminar([...escolhidos]));
    if (!somenteVer) botoes.append(confirmar);
    caixa.append(botoes);
    fundo.append(caixa);
    document.body.append(fundo);
    atualizar();
    grade.querySelector("button")?.focus();

    const teclas = (e) => {
      if (e.key === "Escape" && podeCancelar) terminar(null);
    };
    document.addEventListener("keydown", teclas);

    function terminar(valor) {
      document.removeEventListener("keydown", teclas);
      fundo.remove();
      resolve(valor);
    }
    escolhaAtual = { fechar: () => terminar(null) };
  });
}
let escolhaAtual = null;

// Escolha exigida pelo jogo (alvo de efeito ou descarte): não dá para cancelar
async function abrirEscolhaPendente(estado) {
  const pend = estado.pendente;
  const seq = estado.seq;
  const promessa = escolherCartas({
    titulo: pend.titulo,
    sub: pend.tipo === "descarte" ? "Você tem mais de 6 cartas na mão." : "",
    candidatos: pend.candidatos, min: pend.min, max: pend.max, podeCancelar: false,
  });
  escolhaAberta = escolhaAtual;
  const alvos = await promessa;
  escolhaAberta = null;
  if (alvos && sessao && sessao.estado.seq === seq && !agir({ tipo: "escolher", alvos })) {
    // combinação inválida (ex.: Davi Animal): mostra o aviso e abre a escolha de novo
    if (sessao.estado.pendente && quemAge(sessao.estado) === sessao.eu) abrirEscolhaPendente(sessao.estado);
  }
}

function verCemiterio(estado, j) {
  const lista = [...estado.jogadores[j].cemiterio].reverse();
  escolherCartas({
    titulo: `${deQuem(estado, j, "Cemitério")} (${lista.length})`,
    sub: lista.length ? "A carta do topo é a primeira." : "Nenhuma carta no cemitério.",
    candidatos: lista, min: 0, max: 0, somenteVer: true,
  });
}


/* ---------- 6. Animações dos eventos ---------- */

async function tocarEventos(eventos, estadoNovo) {
  for (const ev of eventos) {
    if (!sessao) return;
    switch (ev.t) {
      case "inicio":
        await bannerTurno("O DUELO VAI COMEÇAR!", true);
        break;
      case "turno":
        tocar("turno");
        await bannerTurno(ev.j === sessao.eu ? "SEU TURNO" : `TURNO DE ${estadoNovo.jogadores[ev.j].nick.toUpperCase()}`, ev.j === sessao.eu);
        break;
      case "invocacao": {
        const c = carta(estadoNovo, ev.iid);
        tocar("invocacao");
        const frase = ev.modo === "tributo" ? "INVOCAÇÃO-TRIBUTO!" : ev.modo === "especial" ? (FRASES[c.efeito] || "INVOCAÇÃO-ESPECIAL!") : ev.modo === "flip" ? "INVOCAÇÃO-FLIP!" : "INVOCAÇÃO!";
        await corte(estadoNovo, ev.iid, ev.j, frase, "invocacao", ev.j === sessao.eu ? 650 : 950);
        break;
      }
      case "ativacao": {
        const c = carta(estadoNovo, ev.iid);
        tocar(c.efeito === "vapo" ? "vapo" : "magia");
        if (c.efeito === "luz") efeitoLuz();
        await corte(estadoNovo, ev.iid, ev.j, FRASES[c.efeito] || "MAGIA!", "magia", c.efeito === "vapo" ? 1300 : 1050);
        if (c.efeito === "vapo") tremerTela();
        break;
      }
      case "armadilha": {
        const c = carta(estadoNovo, ev.iid);
        tocar("armadilha");
        if (c.efeito === "forca-careca") flashBranco();
        await corte(estadoNovo, ev.iid, ev.j, FRASES[c.efeito] || "ARMADILHA!", "armadilha", 1500);
        tremerTela();
        break;
      }
      case "efeito": {
        const c = carta(estadoNovo, ev.iid);
        if (!ev.alvos) await corte(estadoNovo, ev.iid, ev.j, FRASES[c.efeito] || "EFEITO!", "magia", 1000);
        else if (FRASES[c.efeito]) await corte(estadoNovo, ev.iid, ev.j, FRASES[c.efeito], "invocacao", 800);
        break;
      }
      case "ataque":
        await animarAtaque(ev);
        break;
      case "tributo": {
        const alvo = raiz.querySelector(`.campo [data-iid="${ev.iid}"]`);
        if (alvo) {
          alvo.classList.add("explodindo");
          await esperar(300);
        }
        break;
      }
      case "virada": {
        const alvo = raiz.querySelector(`[data-iid="${ev.iid}"]`);
        if (alvo) {
          alvo.replaceChildren(criarCarta(carta(estadoNovo, ev.iid)));
          await esperar(350);
        }
        break;
      }
      case "destruida": {
        const alvo = raiz.querySelector(`.campo [data-iid="${ev.iid}"]`);
        tocar("destruida");
        if (alvo) {
          alvo.classList.add("explodindo");
          await esperar(320);
        }
        break;
      }
      case "custo":
        tocar("dano");
        mostrarDano(ev.j, ev.valor, ev.pl);
        await esperar(450);
        break;
      case "banida": {
        const alvo = raiz.querySelector(`.campo [data-iid="${ev.iid}"]`);
        tocar("destruida");
        if (alvo) {
          alvo.style.transition = "transform .45s ease, opacity .45s ease, filter .45s ease";
          alvo.style.filter = "grayscale(1) brightness(2)";
          alvo.style.transform = "scale(.2) rotate(25deg)";
          alvo.style.opacity = "0";
          await esperar(480);
        }
        break;
      }
      case "paraMao": {
        const alvo = raiz.querySelector(`.campo [data-iid="${ev.iid}"]`);
        if (alvo) {
          alvo.style.transition = "transform .35s ease, opacity .35s ease";
          alvo.style.transform = `translateY(${ev.j === sessao.eu ? 60 : -60}px) scale(.6)`;
          alvo.style.opacity = "0";
          await esperar(380);
        }
        break;
      }
      case "protegido":
        tocar("magia");
        mostrarDano(ev.j, 0, null, "🪽 0");
        await esperar(500);
        break;
      case "dano":
        tocar("dano");
        mostrarDano(ev.j, ev.valor, ev.pl);
        await esperar(550);
        break;
      case "compra":
        if (!ev.inicial && ev.j === sessao.eu) tocar("carta");
        break;
      case "fim":
        tocar(ev.vencedor === sessao.eu ? "vitoria" : "derrota");
        break;
    }
  }
}

function corte(estado, iid, j, frase, tipo, duracao) {
  const c = carta(estado, iid);
  const fundo = el("div", "corte");
  fundo.dataset.tipo = tipo;
  fundo.style.setProperty("--dur", `${duracao}ms`);
  const conteudo = el("div", "corte__conteudo");
  const cartaEl = el("div", "corte__carta");
  cartaEl.append(criarCarta(c, { lazy: false }));
  conteudo.append(el("div", "corte__quem", j === sessao.eu ? "Você" : sessao.estado.jogadores[j].nick), cartaEl, el("div", "corte__frase", frase));
  fundo.append(conteudo);
  document.body.append(fundo);
  return esperar(duracao).then(() => fundo.remove());
}

function bannerTurno(texto, meu) {
  const b = el("div", "banner-turno", texto);
  b.dataset.meu = String(meu);
  document.body.append(b);
  return esperar(1000).then(() => setTimeout(() => b.remove(), 300));
}

function flashBranco() {
  const f = el("div", "flash-branco");
  document.body.append(f);
  setTimeout(() => f.remove(), 800);
}

function efeitoLuz() {
  const r = el("div", "raios-luz");
  document.body.append(r);
  setTimeout(() => r.remove(), 1700);
}

function tremerTela() {
  raiz.classList.remove("tremer");
  void raiz.offsetWidth;
  raiz.classList.add("tremer");
  setTimeout(() => raiz.classList.remove("tremer"), 600);
}

async function animarAtaque(ev) {
  tocar("ataque");
  const atacante = raiz.querySelector(`.campo [data-iid="${ev.iid}"]`);
  let alvo = ev.alvo ? raiz.querySelector(`.campo [data-iid="${ev.alvo}"]`) : null;
  if (!alvo) alvo = refs.placar.querySelector(`.jogador-info[data-j="${oponente(ev.j)}"] .jogador-info__avatar`);
  if (!atacante || !alvo) {
    await esperar(300);
    return;
  }
  const a = atacante.getBoundingClientRect();
  const b = alvo.getBoundingClientRect();
  const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) * 0.85;
  const dy = (b.top + b.height / 2 - (a.top + a.height / 2)) * 0.85;
  atacante.classList.add("atacando");
  atacante.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
  await esperar(300);
  atacante.style.transform = "";
  await esperar(260);
  atacante.classList.remove("atacando");
}

// pl = null: não mexe na barra (ex.: dano evitado pelo Karecoh Alado)
function mostrarDano(j, valor, pl, texto = `-${valor}`) {
  const info = refs.placar.querySelector(`.jogador-info[data-j="${j}"]`);
  if (!info) return;
  const barra = info.querySelector(".barra-pl");
  if (pl !== null) {
    barra.style.setProperty("--pct", `${Math.max(0, (pl / PL_INICIAL) * 100)}%`);
    barra.dataset.perigo = String(pl <= 2000);
    barra.querySelector(".barra-pl__valor").textContent = `${pl} LP`;
  }
  const numero = el("div", "numero-dano" + (pl === null ? " numero-dano--protegido" : ""), texto);
  const r = barra.getBoundingClientRect();
  const base = raiz.getBoundingClientRect();
  numero.style.left = `${r.left - base.left + r.width / 2 - 30}px`;
  numero.style.top = `${r.bottom - base.top + 4}px`;
  raiz.append(numero);
  setTimeout(() => numero.remove(), 1200);
  tremerTela();
}


/* ---------- 7. Relógio, avisos e resultado ---------- */

function atualizarRelogio() {
  if (!sessao) return;
  const r = raiz.querySelector("#relogio .relogio__tempo");
  const estado = sessao.estado;
  if (!r) return;
  if (estado.vencedor !== null) {
    r.textContent = "--";
    return;
  }
  const restante = Math.max(0, Math.ceil((prazo - Date.now()) / 1000));
  r.textContent = `${restante}s`;
  r.parentElement.dataset.alerta = String(restante <= 10);
  // Só quem está na vez manda o "tempo esgotado" (uma vez por estado)
  if (restante === 0 && !ocupado() && quemAge(estado) === sessao.eu && pediuTempo !== estado.seq && seqDoPrazo === estado.seq) {
    pediuTempo = estado.seq;
    if (escolhaAberta) {
      escolhaAberta.fechar();
      escolhaAberta = null;
    }
    agir({ tipo: "tempo" });
  }
}

function mostrarStatusConexao(info) {
  if (!sessao) return;
  const caixa = refs.aviso;
  if (!info) {
    caixa.hidden = true;
    return;
  }
  const op = sessao.estado.jogadores[oponente(sessao.eu)].nick;
  caixa.hidden = false;
  caixa.replaceChildren(`⚠️ ${op} está sem sinal há ${info.semSinal}s. `);
  if (info.podeWO) {
    const b = el("button", "btn btn-sm btn-ouro ms-2", "Reivindicar vitória (W.O.)");
    b.type = "button";
    b.addEventListener("click", () => sessao.pedirWO && sessao.pedirWO());
    caixa.append(b);
  } else {
    caixa.append("Se não voltar, você poderá pedir W.O.");
  }
}

const FRASES_FIM = {
  pl: ["Zerou os LP do adversário. Careca demais!", "Seus LP foram de Vapo..."],
  deck: ["O oponente ficou sem cartas no deck.", "Seu deck acabou. Nem o Invocador salvou."],
  desistencia: ["O oponente arregou e desistiu.", "Você desistiu. Acontece nas melhores carecas."],
  wo: ["O oponente sumiu. Vitória por W.O.!", "Você foi dado como ausente (W.O.)."],
};

let resultadoMostrado = null;

function mostrarResultado(estado) {
  if (document.querySelector(".resultado") || resultadoMostrado === estado.id) return;
  resultadoMostrado = estado.id;
  const venceu = estado.vencedor === sessao.eu;
  const extra = opcoesArena.aoTerminar ? opcoesArena.aoTerminar(estado, sessao.eu) : null;

  const fundo = el("div", "resultado");
  fundo.dataset.venceu = String(venceu);
  fundo.setAttribute("role", "dialog");
  fundo.setAttribute("aria-modal", "true");
  fundo.setAttribute("aria-labelledby", "titulo-resultado");
  const caixa = el("div", "resultado__caixa");
  const arte = el("img", "resultado__arte");
  arte.src = venceu ? "img/vitoria.webp" : "img/derrota.webp";
  arte.alt = "";
  arte.width = 700;
  arte.height = 717;
  const titulo = el("h2", "visually-hidden", venceu ? "Vitória!" : "Derrota");
  titulo.id = "titulo-resultado";
  const [frVitoria, frDerrota] = FRASES_FIM[estado.motivo] || ["Vitória!", "Derrota."];
  caixa.append(arte, titulo, el("p", "resultado__frase", venceu ? frVitoria : frDerrota));
  if (extra && extra.xp) caixa.append(el("p", "resultado__xp", `+${extra.xp} XP`));

  const botoes = el("div", "d-flex flex-wrap gap-2 justify-content-center mt-3");
  if (opcoesArena.revanche) {
    const rev = el("button", "btn btn-ouro", "🔁 Revanche");
    rev.type = "button";
    rev.addEventListener("click", () => {
      fundo.remove();
      opcoesArena.revanche();
    });
    botoes.append(rev);
  }
  const ver = el("button", "btn btn-outline-light", "👀 Ver o campo");
  ver.type = "button";
  ver.addEventListener("click", () => fundo.remove());
  const sair = el("button", "btn btn-outline-light", "🚪 Sair da arena");
  sair.type = "button";
  sair.addEventListener("click", () => {
    fundo.remove();
    sairDaArena();
  });
  botoes.append(ver, sair);
  caixa.append(botoes);
  fundo.append(caixa);
  document.body.append(fundo);
  (botoes.querySelector("button") || sair).focus();
}
