/* ==========================================================================
   Duelo da Zoeira · js/roleta.js
   Roleta Diária: 1 giro grátis por dia (volta à meia-noite, horário de Brasília).
   Não dá para comprar giros nem mudar as chances, e os prêmios só valem dentro do
   jogo. Quem sorteia é o servidor (supabase/banco.sql, girar_roleta); aqui a roda
   só gira até a fatia que o servidor mandou. Botões [data-abrir-roleta] abrem.
   Depois do giro, o evento "roleta-girou" avisa o salão (que conta no chat).
   ========================================================================== */

import * as conta from "./conta.js?v=202610070301";
import { criarCarta } from "./cartas-ui.js?v=202610070301";
import { PREMIOS } from "./premios.js?v=202610070301";
import { COSMETICOS, TIPOS } from "./cosmeticos.js?v=202610070301";
import { previaCosmetico } from "./loja.js?v=202610070301";
import { el, aviso } from "./util.js?v=202610070301";
import { tocar } from "./som.js?v=202610070301";

// As faixas (as mesmas chances do banco.sql)
const FAIXAS = {
  carta: { icone: "🃏", rotulo: "", nome: "Carta da Loja (uma que você ainda não tem)", chance: 3, cor: "#7b3fc4" },
  reliquia: { icone: "🔺", rotulo: "", nome: "Relíquia Careca do Milênio", chance: 2, cor: "#b8322a" },
  cosmetico: { icone: "🎨", rotulo: "", nome: "Cosmético (moldura, campo ou costas que você não tem)", chance: 5, cor: "#1f9a82" },
  coins30: { icone: "🪙", rotulo: "30", nome: "30 Careca Coins", chance: 10, cor: "#d9a521" },
  coins10: { icone: "🪙", rotulo: "10", nome: "10 Careca Coins", chance: 50, cor: "#80601a" },
  nada: { icone: "💨", rotulo: "", nome: "Nada (fica pra amanhã)", chance: 30, cor: "#3b3430" },
};
// A roda: o tamanho de cada fatia é a chance dela (somam 100%)
const FATIAS = [
  ["coins10", 10], ["nada", 10], ["coins10", 10], ["coins30", 5], ["coins10", 10], ["cosmetico", 5], ["nada", 10],
  ["coins10", 10], ["carta", 3], ["coins30", 5], ["coins10", 10], ["nada", 10], ["reliquia", 2],
];
const ANGULOS = (() => {
  let a = 0;
  return FATIAS.map(([faixa, chance]) => {
    const fatia = { faixa, de: a, ate: a + chance * 3.6 };
    a = fatia.ate;
    return fatia;
  });
})();

let cartas = [];
let modal = null;
let rotacao = 0;
let girando = false;
const $ = (sel) => document.querySelector(sel);

export function iniciarRoleta(lista) {
  cartas = lista;
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-abrir-roleta]")) return;
    e.preventDefault();
    abrirRoleta();
  });
}

export function abrirRoleta() {
  for (const outra of document.querySelectorAll(".modal.show")) {
    if (outra.id !== "modal-roleta") bootstrap.Modal.getInstance(outra)?.hide();
  }
  desenhar();
  modal ||= new bootstrap.Modal("#modal-roleta");
  modal.show();
  conferirHoje();
}

/* ---------- Tela ---------- */

function desenhar() {
  const corpo = $("#roleta-corpo");
  corpo.replaceChildren();
  const caixaRoda = el("div", "roleta__roda-caixa");
  caixaRoda.append(el("div", "roleta__ponteiro"), roda());
  const lado = el("div", "roleta__lado");
  const status = el("p", "roleta__status");
  status.id = "roleta-status";
  status.setAttribute("aria-live", "polite");
  const botao = el("button", "btn btn-ouro btn-lg roleta__girar", "🎡 Girar grátis");
  botao.type = "button";
  botao.id = "roleta-girar";
  botao.disabled = true;
  botao.addEventListener("click", girar);
  const resultado = el("div", "roleta__resultado");
  resultado.id = "roleta-resultado";
  lado.append(status, botao, resultado, tabelaDeChances(), regras());
  corpo.append(caixaRoda, lado);
}

function roda() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "-150 -150 300 300");
  svg.setAttribute("class", "roleta__roda");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Roleta com as fatias do tamanho das chances de cada prêmio");
  const g = document.createElementNS(ns, "g");
  g.id = "roleta-giro";
  g.setAttribute("transform", `rotate(${rotacao.toFixed(2)})`);
  const ponto = (graus, raio) => [raio * Math.sin((graus * Math.PI) / 180), -raio * Math.cos((graus * Math.PI) / 180)];
  for (const f of ANGULOS) {
    const info = FAIXAS[f.faixa];
    const [x0, y0] = ponto(f.de, 140);
    const [x1, y1] = ponto(f.ate, 140);
    const fatia = document.createElementNS(ns, "path");
    fatia.setAttribute("d", `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A140 140 0 ${f.ate - f.de > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`);
    fatia.setAttribute("fill", info.cor);
    fatia.setAttribute("class", `roleta__fatia roleta__fatia--${f.faixa}`);
    g.append(fatia);
    const meio = (f.de + f.ate) / 2;
    const texto = document.createElementNS(ns, "text");
    texto.setAttribute("transform", `rotate(${meio.toFixed(2)}) translate(0 -104)`);
    texto.setAttribute("class", "roleta__texto");
    texto.textContent = info.icone;
    g.append(texto);
    if (info.rotulo) {
      const valor = document.createElementNS(ns, "text");
      valor.setAttribute("transform", `rotate(${meio.toFixed(2)}) translate(0 -76)`);
      valor.setAttribute("class", "roleta__valor");
      valor.textContent = info.rotulo;
      g.append(valor);
    }
  }
  const aro = document.createElementNS(ns, "circle");
  aro.setAttribute("r", "141");
  aro.setAttribute("class", "roleta__aro");
  const centro = document.createElementNS(ns, "circle");
  centro.setAttribute("r", "26");
  centro.setAttribute("class", "roleta__centro");
  const careca = document.createElementNS(ns, "text");
  careca.setAttribute("class", "roleta__careca");
  careca.setAttribute("y", "9");
  careca.textContent = "🧑‍🦲";
  svg.append(g, aro, centro, careca);
  return svg;
}

function tabelaDeChances() {
  const caixa = el("details", "roleta__chances");
  caixa.open = true;
  caixa.append(el("summary", "", "Chances de cada prêmio"));
  const tabela = el("table", "table table-sm roleta__tabela");
  const corpo = el("tbody");
  for (const [id, info] of Object.entries(FAIXAS)) {
    const tr = el("tr");
    const cor = el("span", "roleta__cor");
    cor.style.background = info.cor;
    const nome = el("td");
    nome.append(cor, `${info.icone} ${info.nome}`);
    tr.append(nome, el("td", "text-end", `${info.chance}%`));
    tr.dataset.faixa = id;
    corpo.append(tr);
  }
  tabela.append(corpo);
  caixa.append(tabela, el("p", "roleta__nota", "Repetido vira Careca Coins: carta (já tem todas as da Loja) 100; relíquia 50; cosmético (já tem todos) 50."));
  return caixa;
}

function regras() {
  return el("p", "roleta__regras",
    "1 giro grátis por dia, que volta à meia-noite (horário de Brasília). Não dá para comprar giros nem aumentar as chances. " +
    "Os prêmios só valem dentro do jogo: não têm valor em dinheiro e não podem ser vendidos nem trocados fora dele.");
}

function mostrarStatus(texto, podeGirar = false) {
  const status = $("#roleta-status");
  const botao = $("#roleta-girar");
  if (status) status.textContent = texto;
  if (botao) {
    botao.disabled = !podeGirar;
    botao.hidden = !podeGirar && /amanhã/.test(texto);
  }
}

/* ---------- Giro ---------- */

async function conferirHoje() {
  if (!conta.usuarioAtual()) return mostrarStatus("Entre na sua conta no Salão Online para girar.");
  if (!conta.contaNoBanco()) return mostrarStatus("A Roleta precisa do servidor do jogo. Tente de novo daqui a pouco.");
  mostrarStatus("Conferindo o seu giro de hoje...");
  try {
    const r = await conta.roletaDeHoje();
    if (r?.erro) return mostrarStatus("Entre de novo na sua conta para girar.");
    if (r?.giro) {
      pararNa(r.giro.faixa, false);
      mostrarResultado(r.giro, false);
      return mostrarStatus("Você já girou hoje. O próximo giro grátis volta amanhã, à meia-noite (horário de Brasília).");
    }
    mostrarStatus("Seu giro grátis de hoje está liberado!", true);
  } catch {
    mostrarStatus("A Roleta ainda não está ligada no servidor do jogo. Tente mais tarde.");
  }
}

async function girar() {
  if (girando) return;
  girando = true;
  mostrarStatus("Girando...");
  $("#roleta-resultado")?.replaceChildren();
  try {
    const r = await conta.girarRoleta();
    if (r?.giro) {
      await pararNa(r.giro.faixa, true);
      mostrarResultado(r.giro, true);
      mostrarStatus("Volte amanhã para o próximo giro grátis (meia-noite, horário de Brasília).");
      if (r.ok) document.dispatchEvent(new CustomEvent("roleta-girou", { detail: { giro: r.giro, nomeCarta: nomeDaCarta(r.giro.carta), nomeCosmetico: COSMETICOS[r.giro.cosmetico]?.nome } }));
    } else {
      mostrarStatus(r?.erro === "sessao" ? "Sua sessão acabou: entre de novo." : "Não deu para girar agora. Tente de novo.", r?.erro !== "sessao");
    }
  } catch {
    mostrarStatus("Sem conexão com o servidor do jogo. Tente de novo.", true);
  } finally {
    girando = false;
  }
}

// Gira a roda até um ponto qualquer de uma fatia da faixa sorteada
function pararNa(faixa, animar) {
  const opcoes = ANGULOS.filter((f) => f.faixa === faixa);
  const f = opcoes[Math.floor(Math.random() * opcoes.length)];
  if (!f) return Promise.resolve();
  const alvo = f.de + (f.ate - f.de) * (0.2 + Math.random() * 0.6);
  // o ponteiro fica no topo: girar a roda R graus coloca o ângulo -R embaixo dele
  const final = rotacao + (animar ? 360 * 6 : 0) + ((((-alvo - rotacao) % 360) + 360) % 360);
  const g = $("#roleta-giro");
  if (!animar || !g || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    rotacao = final;
    if (g) g.setAttribute("transform", `rotate(${rotacao.toFixed(2)})`);
    return Promise.resolve();
  }
  const inicio = rotacao;
  const duracao = 5200;
  const t0 = performance.now();
  let fatiaAnterior = -1;
  return new Promise((pronto) => {
    const passo = (agora) => {
      const t = Math.min(1, (agora - t0) / duracao);
      const suave = 1 - Math.pow(1 - t, 4);
      rotacao = inicio + (final - inicio) * suave;
      g.setAttribute("transform", `rotate(${rotacao.toFixed(2)})`);
      // um "tique" a cada fatia que passa pelo ponteiro
      const sob = (((-rotacao) % 360) + 360) % 360;
      const i = ANGULOS.findIndex((x) => sob >= x.de && sob < x.ate);
      if (i !== fatiaAnterior) {
        fatiaAnterior = i;
        tocar("clique");
      }
      if (t < 1) requestAnimationFrame(passo);
      else pronto();
    };
    requestAnimationFrame(passo);
  });
}

const nomeDaCarta = (id) => cartas.find((c) => c.id === id)?.nome || "";

function mostrarResultado(giro, agora) {
  const caixa = $("#roleta-resultado");
  if (!caixa) return;
  caixa.replaceChildren();
  const raro = giro.premio === "carta" || giro.premio === "reliquia" || giro.premio === "cosmetico";
  caixa.className = "roleta__resultado" + (raro ? " roleta__resultado--raro" : "");
  if (giro.premio === "carta") {
    const c = cartas.find((x) => x.id === giro.carta);
    caixa.append(el("p", "roleta__premio", "🎉 CARTA LENDÁRIA!"), el("p", "roleta__premio-nome", c?.nome || giro.carta));
    if (c) {
      const mini = el("div", "roleta__carta");
      mini.append(criarCarta(c, { lazy: false }));
      caixa.append(mini);
    }
    caixa.append(el("p", "roleta__dica", "Ela já está na sua coleção: coloque no deck pela página Deck (limitada a 1)."));
    if (agora) tocar("lendaria");
  } else if (giro.premio === "reliquia") {
    const info = PREMIOS["careca-do-milenio"];
    const img = el("img", "roleta__reliquia");
    img.src = info.imagem;
    img.alt = info.nome;
    caixa.append(el("p", "roleta__premio", "🔺 RELÍQUIA DO MILÊNIO!"), img, el("p", "roleta__premio-nome", info.nome),
      el("p", "roleta__dica", "Equipe no seu perfil para levar a Compra do Destino para os duelos."));
    if (agora) tocar("lendaria");
  } else if (giro.premio === "cosmetico" && COSMETICOS[giro.cosmetico]) {
    const c = COSMETICOS[giro.cosmetico];
    caixa.append(el("p", "roleta__premio", "🎨 COSMÉTICO!"), el("p", "roleta__premio-nome", `${c.nome} (${TIPOS[c.tipo].nome})`),
      previaCosmetico(giro.cosmetico, conta.usuarioAtual()?.avatar),
      el("p", "roleta__dica", "É seu! Para usar: Loja → aba Cosméticos → Usar."));
    if (agora) tocar("lendaria");
  } else if (giro.premio === "coins") {
    const repetida = giro.faixa === "carta" ? "Saiu Carta da Loja, mas você já tem todas: "
      : giro.faixa === "reliquia" ? "Saiu a Relíquia, mas você já tem a sua: "
      : giro.faixa === "cosmetico" ? "Saiu Cosmético, mas você já tem todos: " : "";
    caixa.append(el("p", "roleta__premio", `🪙 +${giro.valor} Careca Coins!`));
    if (repetida) caixa.append(el("p", "roleta__dica", `${repetida}+${giro.valor} Careca Coins.`));
    if (agora) tocar("vitoria");
  } else {
    caixa.append(el("p", "roleta__premio roleta__premio--nada", "💨 Nada dessa vez."), el("p", "roleta__dica", "Amanhã tem outro giro grátis."));
    if (agora) tocar("carta");
  }
  if (agora && giro.premio !== "nada") aviso(`🎡 Roleta: ${textoDoPremio(giro)}`, "ok", 7000);
}

export function textoDoPremio(giro, nomeCarta = nomeDaCarta(giro.carta)) {
  if (giro.premio === "carta") return `a carta lendária ${nomeCarta || giro.carta}`;
  if (giro.premio === "reliquia") return "a relíquia Careca do Milênio";
  if (giro.premio === "cosmetico") return `o cosmético ${COSMETICOS[giro.cosmetico]?.nome || giro.cosmetico}`;
  if (giro.premio === "coins") return `${giro.valor} Careca Coins`;
  return "nada";
}
