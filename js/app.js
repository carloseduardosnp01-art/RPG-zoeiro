/* ==========================================================================
   Duelo da Zoeira · js/app.js
   Ponto de entrada: carrega as cartas, liga os módulos e troca as telas
   pelo endereço (#inicio, #catalogo, #deck, #regras, #salao, #arena).
   ========================================================================== */

import { registrarCartas, versaoDasCartas } from "./motor.js";
import { iniciarCatalogo } from "./catalogo.js";
import { iniciarEditorDeck } from "./editor-deck.js";
import { deckAtual } from "./deck.js";
import { iniciarSalao, ativarSalao } from "./salao.js";
import { abrirArena, arenaAtiva, sessaoAtual } from "./arena.js";
import { criarSessaoBot } from "./sessao.js";
import * as conta from "./conta.js";
import { alternarSom, somLigado } from "./som.js";
import { aviso } from "./util.js";

const TELAS = ["inicio", "catalogo", "deck", "regras", "salao", "arena"];

async function iniciar() {
  document.querySelectorAll("[data-emblema]").forEach((e) => (e.innerHTML = '<img src="img/emblema.webp" alt="" width="256" height="256">'));

  let cartas;
  try {
    const resposta = await fetch("data/cartas.json");
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
  ligarBotoes();
  addEventListener("hashchange", mostrarTela);
  document.addEventListener("arena-mudou", atualizarFaixa);
  mostrarTela();
  setInterval(verificarVersaoNova, 3 * 60 * 1000);
}

// Se o GitHub Pages já tem cartas novas e esta página ainda está com as antigas, avisa
let avisouVersao = false;
async function verificarVersaoNova() {
  if (avisouVersao) return;
  try {
    const resposta = await fetch(`data/cartas.json?v=${Date.now()}`, { cache: "no-store" });
    const novas = await resposta.json();
    if (versaoDasCartas(novas) !== versaoDasCartas()) {
      avisouVersao = true;
      aviso("Saiu uma versão nova do jogo! Recarregue a página (Ctrl+F5 no PC) quando terminar o duelo.", "info", 30000);
    }
  } catch { /* sem internet: tenta de novo depois */ }
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
  const perfil = u ? conta.cartaoPublico(u) : null;
  const treino = () => {
    abrirArena(criarSessaoBot(perfil, deckAtual()), {
      aoSair: () => (location.hash = "#inicio"),
      revanche: treino,
    });
    location.hash = "#arena";
  };
  treino();
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
