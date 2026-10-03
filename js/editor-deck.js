/* ==========================================================================
   Duelo da Zoeira · js/editor-deck.js
   Tela "Meu deck": clique na coleção para colocar uma cópia, clique no
   deck para tirar. Regras: de 40 a 60 cartas e até 3 cópias de cada.
   ========================================================================== */

import { montarDeck, DECK_MIN, DECK_MAX, EXTRA_MAX, ehFusao, limiteDaCarta, excessoDeLimite } from "./motor.js?v=202610032015";
import { criarCarta } from "./cartas-ui.js?v=202610032015";
import { deckAtual, salvarDeck, paraMapa, paraLista, totalDoMapa, ehDeckPadrao } from "./deck.js?v=202610032015";
import { abrirDetalhes } from "./catalogo.js?v=202610032015";
import * as conta from "./conta.js?v=202610032015";
import { el, aviso } from "./util.js?v=202610032015";
import { tocar } from "./som.js?v=202610032015";

const ORDEM_CATEGORIA = { monstro: 0, magia: 1, armadilha: 2 };

let cartas = [];
let salvo = {};     // deck salvo (o que vale nos duelos)
let rascunho = {};  // deck sendo editado

const $ = (sel) => document.querySelector(sel);

export function iniciarEditorDeck(lista) {
  // Monstros de Fusão (Deck Adicional) por último
  const ordem = (c) => (ehFusao(c) ? 3 : ORDEM_CATEGORIA[c.categoria]);
  cartas = [...lista].sort((a, b) =>
    ordem(a) - ordem(b) ||
    (a.nivel ?? 0) - (b.nivel ?? 0) ||
    a.codigo.localeCompare(b.codigo));

  $("#deck-salvar").addEventListener("click", salvar);
  $("#deck-desfazer").addEventListener("click", () => {
    rascunho = { ...salvo };
    desenhar();
  });
  $("#deck-padrao").addEventListener("click", () => {
    rascunho = paraMapa(montarDeck());
    desenhar();
    aviso("Deck padrão carregado. Clique em Salvar para usar ele nos duelos.");
  });

  // Entrou ou saiu da conta: recarrega o deck (se não houver nada por salvar)
  conta.aoMudarUsuario(() => {
    if (!temAlteracoes()) carregar();
  });
  carregar();
}

function carregar() {
  salvo = paraMapa(deckAtual());
  rascunho = { ...salvo };
  desenhar();
}

// Deck principal (40 a 60) e Deck Adicional (até 15 Monstros de Fusão) contam separado
const ehFusaoId = (id) => ehFusao(cartas.find((c) => c.id === id));
const total = () => Object.entries(rascunho).reduce((t, [id, n]) => t + (ehFusaoId(id) ? 0 : n), 0);
const totalExtra = () => totalDoMapa(rascunho) - total();
const copias = (id) => rascunho[id] || 0;

function temAlteracoes() {
  const ids = new Set([...Object.keys(salvo), ...Object.keys(rascunho)]);
  return [...ids].some((id) => (salvo[id] || 0) !== (rascunho[id] || 0));
}

function motivoParaNaoColocar(id) {
  if (ehFusaoId(id) && totalExtra() >= EXTRA_MAX) return `O Deck Adicional já tem ${EXTRA_MAX} Monstros de Fusão, o máximo.`;
  if (!ehFusaoId(id) && total() >= DECK_MAX) return `O deck já tem ${DECK_MAX} cartas, o máximo. Tire uma antes de colocar outra.`;
  const limite = limiteDaCarta(id);
  if (copias(id) >= limite) return limite < 3 ? `Carta limitada: no máximo ${limite} cópia${limite > 1 ? "s" : ""} por deck.` : `Já tem ${limite} cópias dessa carta no deck (o máximo).`;
  return null;
}

function motivoParaNaoTirar() {
  if (totalDoMapa(rascunho) <= 0) return "O deck já está vazio.";
  return null;
}

function colocar(id) {
  const motivo = motivoParaNaoColocar(id);
  if (motivo) {
    aviso(motivo, "erro");
    return;
  }
  rascunho[id] = copias(id) + 1;
  tocar("carta");
  desenhar();
}

function tirar(id) {
  const motivo = motivoParaNaoTirar();
  if (motivo) {
    aviso(motivo, "erro");
    return;
  }
  rascunho[id] = copias(id) - 1;
  if (!rascunho[id]) delete rascunho[id];
  tocar("clique");
  desenhar();
}

function salvar() {
  try {
    salvarDeck(paraLista(rascunho));
    salvo = { ...rascunho };
    desenhar();
    aviso(conta.usuarioAtual() ? "Deck salvo na sua conta! 💾" : "Deck salvo neste navegador! 💾", "ok");
    tocar("magia");
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}


/* ---------- Desenho ---------- */

function desenhar() {
  const n = total();
  $("#deck-total").textContent = n;
  $("#deck-total").dataset.limite = n < DECK_MIN ? "min" : n >= DECK_MAX ? "max" : "";

  const porCategoria = (cat) => cartas.filter((c) => c.categoria === cat && !ehFusao(c)).reduce((t, c) => t + copias(c.id), 0);
  $("#deck-tipos").textContent = `${porCategoria("monstro")} monstros · ${porCategoria("magia")} magias · ${porCategoria("armadilha")} armadilhas · Deck Adicional ${totalExtra()}/${EXTRA_MAX}`;

  const status = $("#deck-status");
  const alterado = temAlteracoes();
  status.dataset.alterado = String(alterado);
  const excesso = excessoDeLimite(paraLista(rascunho));
  if (excesso.length) status.textContent = `⚠ Acima do limite: ${excesso.map((x) => `${x.nome} (tire ${x.sobra})`).join(", ")}. No duelo, as sobras viram Careca Feijão`;
  else if (n < DECK_MIN) status.textContent = `● Faltam ${DECK_MIN - n} carta${DECK_MIN - n > 1 ? "s" : ""} para poder salvar (mínimo ${DECK_MIN})`;
  else if (alterado) status.textContent = "● Alterações não salvas";
  else if (ehDeckPadrao(paraLista(salvo))) status.textContent = "✔ Usando o deck padrão";
  else status.textContent = "✔ Deck salvo: é esse que você usa nos duelos";

  $("#deck-salvar").disabled = !alterado || n < DECK_MIN;
  $("#deck-salvar").title = n < DECK_MIN ? `O deck precisa de pelo menos ${DECK_MIN} cartas para ser salvo` : "";
  $("#deck-desfazer").disabled = !alterado;
  $("#deck-padrao").disabled = ehDeckPadrao(paraLista(rascunho));

  const noDeck = $("#editor-deck");
  noDeck.replaceChildren();
  const podeTirar = !motivoParaNaoTirar();
  for (const c of cartas) {
    if (!copias(c.id)) continue;
    noDeck.append(itemEditor(c, {
      qtd: `${copias(c.id)}x`,
      ativo: podeTirar,
      rotulo: `Tirar uma cópia de ${c.nome} (${copias(c.id)} no deck)`,
      dica: "− tirar",
      aoClicar: () => tirar(c.id),
    }));
  }

  const colecao = $("#editor-colecao");
  colecao.replaceChildren();
  for (const c of cartas) {
    colecao.append(itemEditor(c, {
      qtd: `${copias(c.id)}/${limiteDaCarta(c.id)}`,
      ativo: !motivoParaNaoColocar(c.id),
      rotulo: `Colocar uma cópia de ${c.nome} (${copias(c.id)} de ${limiteDaCarta(c.id)} no deck)`,
      dica: "+ colocar",
      aoClicar: () => colocar(c.id),
    }));
  }
}

function itemEditor(c, { qtd, ativo, rotulo, dica, aoClicar }) {
  const item = el("div", "item-editor");
  item.dataset.ativo = String(ativo);

  const botao = el("button", "item-editor__carta");
  botao.type = "button";
  botao.setAttribute("aria-label", rotulo);
  botao.setAttribute("aria-disabled", String(!ativo));
  botao.append(criarCarta(c, { lazy: false }), el("span", "item-editor__dica", dica));
  botao.addEventListener("click", aoClicar);

  const lupa = el("button", "item-editor__lupa", "🔍");
  lupa.type = "button";
  lupa.title = "Ver detalhes";
  lupa.setAttribute("aria-label", `Ver detalhes de ${c.nome}`);
  lupa.addEventListener("click", () => abrirDetalhes(c.id));

  item.append(botao, el("span", "item-editor__qtd", qtd), lupa);
  return item;
}
