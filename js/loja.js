/* ==========================================================================
   Duelo da Zoeira · js/loja.js
   Loja da Zoeira: cartas especiais compradas com Careca Coins. A compra fica
   no perfil (vai para o banco do jogo) e libera a carta para o deck.
   Qualquer botão com [data-abrir-loja] (ou o evento "abrir-loja") abre a loja;
   data-abrir-loja="id-da-carta" já mostra aquela carta em destaque.
   ========================================================================== */

import * as conta from "./conta.js?v=202610040148";
import { criarCarta } from "./cartas-ui.js?v=202610040148";
import { abrirDetalhes } from "./catalogo.js?v=202610040148";
import { el, aviso } from "./util.js?v=202610040148";
import { tocar } from "./som.js?v=202610040148";

let cartas = [];
let modal = null;
let destaque = null;

const $ = (sel) => document.querySelector(sel);
const moeda = () => {
  const img = el("img", "coin");
  img.src = "img/careca-coin.webp";
  img.alt = "";
  img.width = 18;
  img.height = 18;
  return img;
};

export function iniciarLoja(lista) {
  cartas = lista.filter((c) => c.loja).sort((a, b) => a.loja - b.loja || a.codigo.localeCompare(b.codigo));
  document.addEventListener("click", (e) => {
    const botao = e.target.closest("[data-abrir-loja]");
    if (!botao) return;
    e.preventDefault();
    abrirLoja(botao.dataset.abrirLoja || null);
  });
  document.addEventListener("abrir-loja", (e) => abrirLoja(e.detail || null));
  // comprou, entrou ou saiu da conta com a loja aberta: atualiza
  conta.aoMudarUsuario(() => {
    if ($("#modal-loja")?.classList.contains("show")) desenhar();
  });
}

export function abrirLoja(id = null) {
  destaque = id;
  desenhar();
  // não empilha janelas: fecha a que estiver aberta (detalhes da carta, perfil...)
  for (const outra of document.querySelectorAll(".modal.show")) {
    if (outra.id !== "modal-loja") bootstrap.Modal.getInstance(outra)?.hide();
  }
  modal ||= new bootstrap.Modal("#modal-loja");
  modal.show();
}

function desenhar() {
  const corpo = $("#loja-corpo");
  if (!corpo) return;
  const u = conta.usuarioAtual();
  const saldo = u ? conta.saldoCoins(u) : 0;
  const minhas = u ? conta.cartasCompradas(u) : new Set();
  corpo.replaceChildren();

  const topo = el("div", "loja__topo");
  if (u) {
    const s = el("p", "loja__saldo");
    s.append("Seu saldo: ", moeda(), el("strong", "", String(saldo)), " Careca Coins");
    topo.append(s);
  } else {
    const s = el("p", "loja__saldo");
    const link = el("a", "", "entre na sua conta");
    link.href = "#salao";
    link.addEventListener("click", () => modal?.hide());
    s.append("Para comprar, ", link, " no Salão Online.");
    topo.append(s);
  }
  topo.append(el("p", "loja__dica", "Cada carta é comprada uma vez e fica na sua coleção para sempre (limitada a 1 por deck). Ganhe Careca Coins vencendo duelos: +5 contra jogadores e +1 contra o Bot."));
  corpo.append(topo);

  const grade = el("div", "loja__grade");
  for (const c of cartas) {
    const tem = minhas.has(c.id);
    const item = el("article", "loja__item" + (tem ? " loja__item--minha" : "") + (destaque === c.id ? " loja__item--destaque" : ""));
    const arte = el("button", "loja__carta");
    arte.type = "button";
    arte.title = "Ver detalhes";
    arte.setAttribute("aria-label", `Ver detalhes de ${c.nome}`);
    arte.append(criarCarta(c, { lazy: false }));
    arte.addEventListener("click", () => {
      modal?.hide();
      abrirDetalhes(c.id, cartas);
    });

    const info = el("div", "loja__info");
    const preco = el("span", "loja__preco");
    preco.append(moeda(), ` ${c.loja}`);
    info.append(el("strong", "loja__nome", c.nome), preco);
    if (tem) {
      info.append(el("span", "loja__tenho", "✔ Na sua coleção"));
    } else {
      const comprar = el("button", "btn btn-sm btn-ouro", "🛒 Comprar");
      comprar.type = "button";
      comprar.disabled = !u || saldo < c.loja;
      comprar.addEventListener("click", () => comprarCarta(c));
      info.append(comprar);
      if (u && saldo < c.loja) info.append(el("span", "loja__falta", `Faltam ${c.loja - saldo}`));
    }
    item.append(arte, info);
    grade.append(item);
  }
  corpo.append(grade);
  if (destaque) setTimeout(() => corpo.querySelector(".loja__item--destaque")?.scrollIntoView({ block: "nearest" }), 300);
}

function comprarCarta(c) {
  if (!confirm(`Comprar "${c.nome}" por ${c.loja} Careca Coins?`)) return;
  try {
    conta.comprarCarta(c.id);
    aviso(`🛒 ${c.nome} é sua! Coloque no deck na página Deck (limitada a 1).`, "ok", 8000);
    tocar("vitoria");
    desenhar();
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}
