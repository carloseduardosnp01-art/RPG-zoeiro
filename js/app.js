/* ==========================================================================
   Duelo da Zoeira · js/app.js
   Ponto de entrada: carrega as cartas, liga os módulos e troca as telas
   pelo endereço (#inicio, #catalogo, #deck, #regras, #salao, #arena).
   ========================================================================== */

import { registrarCartas, versaoDasCartas } from "./motor.js?v=202610031145";
import { iniciarCatalogo } from "./catalogo.js?v=202610031145";
import { iniciarEditorDeck } from "./editor-deck.js?v=202610031145";
import { deckAtual } from "./deck.js?v=202610031145";
import { iniciarSalao, ativarSalao } from "./salao.js?v=202610031145";
import { abrirArena, arenaAtiva, sessaoAtual } from "./arena.js?v=202610031145";
import { criarSessaoBot } from "./sessao.js?v=202610031145";
import * as conta from "./conta.js?v=202610031145";
import { alternarSom, somLigado } from "./som.js?v=202610031145";
import { aviso } from "./util.js?v=202610031145";
import { iniciarNoticias } from "./noticias.js?v=202610031145";

// Número da versão (atualizado por ferramentas/nova-versao.py a cada envio)
const VERSAO = "202610031145";

const TELAS = ["inicio", "noticias", "catalogo", "deck", "regras", "salao", "arena"];

// Versão publicada agora (versao.json nunca vem do cache)
async function versaoPublicada() {
  try {
    const resposta = await fetch(`versao.json?t=${Date.now()}`, { cache: "no-store" });
    return (await resposta.json()).versao || null;
  } catch {
    return null; // sem internet ou rodando sem o arquivo: segue com o que tem
  }
}

// Se esta página é de uma versão antiga (o navegador guardou em cache), recarrega a nova.
// Usa um endereço com ?v=... para o navegador não reaproveitar a página guardada.
async function garantirVersaoAtual() {
  const publicada = await versaoPublicada();
  if (!publicada || publicada === VERSAO) return true;
  const url = new URL(location.href);
  if (url.searchParams.get("v") === publicada) return true; // já tentou: segue para não ficar em loop
  url.searchParams.set("v", publicada);
  location.replace(url.toString());
  return false;
}

async function iniciar() {
  if (!(await garantirVersaoAtual())) return;
  document.querySelectorAll("[data-emblema]").forEach((e) => (e.innerHTML = '<img src="img/emblema.webp" alt="" width="256" height="256">'));

  let cartas;
  try {
    const resposta = await fetch(`data/cartas.json?v=${VERSAO}`, { cache: "no-cache" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    cartas = await resposta.json();
  } catch (erro) {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<div class="container-xl mt-4"><div class="estado">Não foi possível carregar as cartas (${erro.message}).
       Abra o site por um servidor (GitHub Pages ou <code>python -m http.server</code>), não direto pelo arquivo.</div></div>`);
    return;
  }

  registrarCartas(cartas);
  iniciarCatalogo(cartas);
  iniciarSalao({ cartas });
  iniciarEditorDeck(cartas);
  iniciarNoticias(VERSAO);
  ligarBotoes();
  addEventListener("hashchange", mostrarTela);
  document.addEventListener("arena-mudou", atualizarFaixa);
  mostrarTela();
  setInterval(verificarVersaoNova, 60 * 1000);
}

// Se o GitHub Pages já tem cartas novas e esta página ainda está com as antigas, avisa
let avisouVersao = false;
async function verificarVersaoNova() {
  if (avisouVersao) return;
  const publicada = await versaoPublicada();
  if (!publicada || publicada === VERSAO) return;
  // fora de um duelo, atualiza sozinho; no meio de um duelo, só avisa
  const sessao = sessaoAtual();
  if (!(arenaAtiva() && sessao && sessao.estado.vencedor === null)) {
    garantirVersaoAtual();
    return;
  }
  avisouVersao = true;
  aviso("Saiu uma versão nova do jogo! Ela entra sozinha quando o duelo acabar (ou aperte F5).", "info", 30000);
}

function mostrarTela() {
  const pedido = location.hash.slice(1);
  const tela = TELAS.includes(pedido) ? pedido : "inicio";
  document.querySelectorAll(".tela").forEach((t) => (t.hidden = t.dataset.tela !== tela));
  document.querySelectorAll("[data-link]").forEach((a) => {
    const ativo = a.dataset.link === tela;
    a.classList.toggle("ativo", ativo);
    if (ativo) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  // fecha o menu do celular
  const menu = document.querySelector("#menu-principal");
  if (menu.classList.contains("show") && window.bootstrap) bootstrap.Collapse.getOrCreateInstance(menu).hide();

  if (tela === "salao") ativarSalao();
  document.body.dataset.tela = tela;
  window.scrollTo({ top: 0, behavior: "instant" });
  atualizarFaixa();
}

function atualizarFaixa() {
  const naArena = location.hash === "#arena";
  const sessao = sessaoAtual();
  const emAndamento = arenaAtiva() && sessao && sessao.estado.vencedor === null;
  document.querySelector("#faixa-duelo").hidden = !(emAndamento && !naArena);
  // Durante o duelo o menu do site some no PC, para a arena ocupar a tela toda
  document.body.classList.toggle("em-duelo", naArena && arenaAtiva());
}

function iniciarTreino() {
  const sessao = sessaoAtual();
  if (sessao && sessao.tipo === "online" && sessao.estado.vencedor === null) {
    aviso("Você está num duelo online! Termine ele antes de treinar.", "erro");
    location.hash = "#arena";
    return;
  }
  const u = conta.usuarioAtual();
  const perfil = u ? { ...conta.cartaoPublico(u), reliquia: conta.reliquiaEquipada(u) } : null;
  const treino = () => {
    abrirArena(criarSessaoBot(perfil, deckAtual()), {
      aoTerminar: (estado, eu) => xpDoTreino(estado, eu),
      aoSair: () => (location.hash = "#inicio"),
      revanche: treino,
    });
    location.hash = "#arena";
  };
  treino();
}

// Treino dá 30% do XP online. Desistir antes do 3º turno não dá XP (para ninguém farmar desistindo).
function xpDoTreino(estado, eu) {
  if (!conta.usuarioAtual()) return null;
  const venceu = estado.vencedor === eu;
  if (!venceu && estado.motivo === "desistencia" && estado.turno < 3) return null;
  const bot = estado.jogadores[1 - eu];
  return conta.registrarResultado({ dueloId: estado.id, venceu, contraBot: true, oponente: bot, motivo: estado.motivo });
}

function ligarBotoes() {
  // Botões "Treinar contra o Bot" (alguns são criados depois, por isso a delegação)
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-treino]")) iniciarTreino();
  });

  const botaoSom = document.querySelector("#botao-som");
  const desenharSom = () => {
    const ligado = somLigado();
    botaoSom.textContent = ligado ? "🔊" : "🔇";
    botaoSom.title = ligado ? "Som ligado (clique para desligar)" : "Som desligado (clique para ligar)";
    botaoSom.setAttribute("aria-label", botaoSom.title);
    botaoSom.setAttribute("aria-pressed", String(ligado));
  };
  botaoSom.addEventListener("click", () => {
    alternarSom();
    desenharSom();
  });
  desenharSom();

  // Atalho: ?treino abre direto um duelo contra o bot
  if (new URLSearchParams(location.search).has("treino")) setTimeout(iniciarTreino, 300);
}

iniciar();
