/* ==========================================================================
   Duelo da Zoeira · js/loja.js
   Loja da Zoeira, com duas abas:
   - Cartas: cartas especiais compradas com Careca Coins (liberam a carta para o deck);
   - Cosméticos: moldura do avatar, skin do campo e costas das cartas (50 cada).
   A compra fica no perfil (vai para o banco do jogo).
   Qualquer botão com [data-abrir-loja] (ou o evento "abrir-loja") abre a loja;
   data-abrir-loja="id-da-carta" mostra aquela carta em destaque e
   data-abrir-loja="cosmeticos" (ou o id de um cosmético) abre na aba Cosméticos.
   ========================================================================== */

import * as conta from "./conta.js?v=202610041602";
import { criarCarta, criarVerso } from "./cartas-ui.js?v=202610041602";
import { abrirDetalhes } from "./catalogo.js?v=202610041602";
import { COSMETICOS, TIPOS, PRECO_COSMETICO, ehCosmetico, comMoldura, visualDe } from "./cosmeticos.js?v=202610041602";
import { el, aviso } from "./util.js?v=202610041602";
import { tocar } from "./som.js?v=202610041602";

let cartas = [];
let modal = null;
let destaque = null;
let aba = "cartas";

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
  // comprou, equipou, entrou ou saiu da conta com a loja aberta: atualiza
  conta.aoMudarUsuario(() => {
    if ($("#modal-loja")?.classList.contains("show")) desenhar();
  });
}

export function abrirLoja(id = null) {
  aba = id === "cosmeticos" || ehCosmetico(id) ? "cosmeticos" : "cartas";
  destaque = id === "cosmeticos" ? null : id;
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
  corpo.replaceChildren();

  const topo = el("div", "loja__topo");
  const s = el("p", "loja__saldo");
  if (u) {
    s.append("Seu saldo: ", moeda(), el("strong", "", String(saldo)), " Careca Coins");
  } else {
    const link = el("a", "", "entre na sua conta");
    link.href = "#salao";
    link.addEventListener("click", () => modal?.hide());
    s.append("Para comprar, ", link, " no Salão Online.");
  }
  topo.append(s, abas());
  topo.append(el("p", "loja__dica", aba === "cartas"
    ? "Cada carta é comprada uma vez e fica na sua coleção para sempre (limitada a 1 por deck). Ganhe Careca Coins vencendo duelos: +5 contra jogadores e +1 contra o Bot."
    : `Cada cosmético custa ${PRECO_COSMETICO} Careca Coins e fica seu para sempre. Só muda o visual: o oponente vê a sua moldura, o seu campo e as costas das suas cartas nos duelos.`));
  corpo.append(topo, aba === "cartas" ? gradeDeCartas(u, saldo) : gradeDeCosmeticos(u, saldo));
  if (destaque) setTimeout(() => corpo.querySelector(".loja__item--destaque")?.scrollIntoView({ block: "nearest" }), 300);
}

function abas() {
  const lista = el("div", "loja__abas");
  lista.setAttribute("role", "tablist");
  for (const [id, rotulo] of [["cartas", "🃏 Cartas"], ["cosmeticos", "🎨 Cosméticos"]]) {
    const b = el("button", "loja__aba", rotulo);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(aba === id));
    b.addEventListener("click", () => {
      aba = id;
      destaque = null;
      desenhar();
    });
    lista.append(b);
  }
  return lista;
}

/* ---------- Cartas ---------- */

function gradeDeCartas(u, saldo) {
  const minhas = u ? conta.cartasCompradas(u) : new Set();
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
  return grade;
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

/* ---------- Cosméticos ---------- */

// Prévia de um cosmético: a moldura no seu avatar, o campo inteiro ou uma carta virada
export function previaCosmetico(id, avatar = "careca-feijao") {
  const c = COSMETICOS[id];
  const caixa = el("div", `loja__previa loja__previa--${c.tipo}`);
  if (c.tipo === "moldura") {
    const img = el("img", "loja__previa-avatar");
    img.src = `img/cartas/${avatar}.webp`;
    img.alt = "";
    caixa.append(comMoldura(img, id));
  } else if (c.tipo === "campo") {
    const img = el("img");
    img.src = c.previa;
    img.alt = `Prévia do campo ${c.nome}`;
    img.loading = "lazy";
    caixa.append(img);
  } else {
    caixa.append(criarVerso("", id));
  }
  return caixa;
}

function gradeDeCosmeticos(u, saldo) {
  const meus = u ? conta.cosmeticosDe(u) : new Set();
  const usando = visualDe(u);
  const lista = el("div", "loja__cosmeticos");
  for (const [tipo, info] of Object.entries(TIPOS)) {
    const ids = Object.keys(COSMETICOS).filter((id) => COSMETICOS[id].tipo === tipo);
    if (!ids.length) continue;
    lista.append(el("h3", "loja__secao", `${info.icone} ${info.nome}`));
    const grade = el("div", `loja__grade loja__grade--${tipo}`);
    for (const id of ids) {
      const c = COSMETICOS[id];
      const tem = meus.has(id);
      const emUso = usando[tipo] === id;
      const item = el("article", "loja__item loja__item--cosmetico" + (tem ? " loja__item--minha" : "") + (destaque === id ? " loja__item--destaque" : ""));
      const dados = el("div", "loja__info");
      const preco = el("span", "loja__preco");
      preco.append(moeda(), ` ${PRECO_COSMETICO}`);
      dados.append(el("strong", "loja__nome", c.nome), el("span", "loja__descricao", c.descricao));
      if (tem) {
        const usar = el("button", emUso ? "btn btn-sm btn-outline-light" : "btn btn-sm btn-ouro", emUso ? "✔ Em uso (tirar)" : "Usar");
        usar.type = "button";
        usar.addEventListener("click", () => equipar(tipo, emUso ? null : id));
        dados.append(el("span", "loja__tenho", "✔ É seu"), usar);
      } else {
        const comprar = el("button", "btn btn-sm btn-ouro", "🛒 Comprar");
        comprar.type = "button";
        comprar.disabled = !u || saldo < PRECO_COSMETICO;
        comprar.addEventListener("click", () => comprarCosmetico(id));
        dados.append(preco, comprar);
        if (u && saldo < PRECO_COSMETICO) dados.append(el("span", "loja__falta", `Faltam ${PRECO_COSMETICO - saldo}`));
      }
      item.append(previaCosmetico(id, u?.avatar), dados);
      grade.append(item);
    }
    lista.append(grade);
  }
  return lista;
}

function comprarCosmetico(id) {
  const c = COSMETICOS[id];
  if (!confirm(`Comprar "${c.nome}" (${TIPOS[c.tipo].nome}) por ${PRECO_COSMETICO} Careca Coins?`)) return;
  try {
    conta.comprarCosmetico(id);
    conta.equiparCosmetico(c.tipo, id); // já sai usando
    aviso(`🎨 ${c.nome} é seu e já está em uso!`, "ok", 7000);
    tocar("vitoria");
    desenhar();
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}

function equipar(tipo, id) {
  try {
    conta.equiparCosmetico(tipo, id);
    tocar("magia");
    desenhar();
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}
