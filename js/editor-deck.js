/* ==========================================================================
   Duelo da Zoeira · js/editor-deck.js
   Tela "Meu deck": clique na coleção para colocar uma cópia, clique no
   deck para tirar. Regras: de 40 a 60 cartas e até 3 cópias de cada.
   Até 3 decks salvos: escolha qual editar e qual vai para os duelos.
   ========================================================================== */

import { montarDeck, DECK_MIN, DECK_MAX, EXTRA_MAX, ehFusao, limiteDaCarta, excessoDeLimite, precoNaLoja } from "./motor.js?v=202610070042";
import { criarCarta } from "./cartas-ui.js?v=202610070042";
import { salvarDeck, paraMapa, paraLista, totalDoMapa, ehDeckPadrao, meusDecks, usarDeck, renomearDeck } from "./deck.js?v=202610070042";
import { abrirDetalhes } from "./catalogo.js?v=202610070042";
import * as conta from "./conta.js?v=202610070042";
import { el, aviso } from "./util.js?v=202610070042";
import { tocar } from "./som.js?v=202610070042";

const ORDEM_CATEGORIA = { monstro: 0, magia: 1, armadilha: 2 };

let cartas = [];
let salvo = {};     // como o deck que está sendo editado está salvo ({} = vazio)
let rascunho = {};  // deck sendo editado
let slot = null;    // qual dos 3 decks está sendo editado
let vazio = false;  // o deck ainda não foi salvo (começa igual ao padrão)

const $ = (sel) => document.querySelector(sel);

export function iniciarEditorDeck(lista) {
  // Monstros de Fusão (Deck Adicional) por último
  const ordem = (c) => (ehFusao(c) ? 3 : ORDEM_CATEGORIA[c.categoria]);
  cartas = [...lista].sort((a, b) =>
    ordem(a) - ordem(b) ||
    (a.nivel ?? 0) - (b.nivel ?? 0) ||
    a.codigo.localeCompare(b.codigo));

  $("#deck-salvar").addEventListener("click", salvar);
  $("#deck-usar").addEventListener("click", () => {
    try {
      usarDeck(slot);
      aviso(`${meusDecks().decks[slot].nome} agora é o deck dos seus duelos! ⚔️`, "ok");
      tocar("magia");
      desenhar();
    } catch (erro) {
      aviso(erro.message, "erro");
    }
  });
  $("#deck-renomear").addEventListener("click", () => {
    const atual = meusDecks().decks[slot].nome;
    const nome = prompt("Nome do deck (até 24 letras):", atual);
    if (nome === null) return;
    try {
      renomearDeck(slot, nome);
      desenhar();
    } catch (erro) {
      aviso(erro.message, "erro");
    }
  });
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
    if (!temAlteracoes()) carregar(slot); // continua no deck que está sendo editado
    else desenhar(); // comprou na loja: a carta destranca
  });
  carregar();
}

// Abre um dos decks no editor (sem número: o que está em uso). Deck vazio começa com o padrão.
function carregar(qual = null) {
  const { decks, ativo } = meusDecks();
  slot = qual ?? ativo;
  vazio = !decks[slot].cartas;
  salvo = vazio ? paraMapa(montarDeck()) : { ...decks[slot].cartas };
  rascunho = { ...salvo };
  desenhar();
}

function trocarDeck(qual) {
  if (qual === slot) return;
  if (temAlteracoes() && !confirm("Você tem alterações não salvas neste deck. Trocar de deck mesmo assim? (elas se perdem)")) return;
  carregar(qual);
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

// Carta da Loja que o jogador ainda não comprou
const trancada = (id) => Boolean(precoNaLoja(id)) && !conta.cartasCompradas().has(id);

function motivoParaNaoColocar(id) {
  if (trancada(id)) return `Carta da Loja: compre por ${precoNaLoja(id)} Careca Coins (botão 🛒 Loja).`;
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
    salvarDeck(paraLista(rascunho), slot);
    salvo = { ...rascunho };
    vazio = false;
    desenhar();
    const { decks, ativo } = meusDecks();
    const onde = conta.usuarioAtual() ? "na sua conta" : "neste navegador";
    aviso(ativo === slot ? `${decks[slot].nome} salvo ${onde}! 💾` : `${decks[slot].nome} salvo ${onde}! 💾 Para duelar com ele, clique em "Usar nos duelos".`, "ok", 7000);
    tocar("magia");
  } catch (erro) {
    aviso(erro.message, "erro");
  }
}


/* ---------- Desenho ---------- */

function desenharDecks() {
  const { decks, ativo } = meusDecks();
  const area = $("#deck-slots");
  area.replaceChildren();
  decks.forEach((d, i) => {
    const b = el("button", "deck-slot");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(i === slot));
    b.dataset.ativo = String(i === ativo);
    const info = d.cartas ? `${Object.entries(d.cartas).reduce((t, [id, n]) => t + (ehFusaoId(id) ? 0 : n), 0)} cartas` : "vazio";
    b.append(el("strong", "deck-slot__nome", d.nome), el("span", "deck-slot__info", i === ativo ? `⚔️ em uso · ${info}` : info));
    b.addEventListener("click", () => trocarDeck(i));
    area.append(b);
  });
  const emUso = slot === ativo;
  $("#deck-usar").hidden = emUso;
  $("#deck-usar").disabled = vazio || temAlteracoes();
  $("#deck-usar").title = !decks[slot].cartas ? "Salve este deck antes de usar" : temAlteracoes() ? "Salve as alterações antes de usar" : "";
  $("#titulo-meu-deck").textContent = `${decks[slot].nome}${emUso ? " (em uso nos duelos)" : ""}`;
}

function desenhar() {
  desenharDecks();
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
  else if (vazio) status.textContent = "● Deck novo: começa igual ao padrão. Mude o que quiser e salve";
  else if (slot !== meusDecks().ativo) status.textContent = "✔ Deck salvo (para duelar com ele, clique em Usar nos duelos)";
  else if (ehDeckPadrao(paraLista(salvo))) status.textContent = "✔ Usando o deck padrão";
  else status.textContent = "✔ Deck salvo: é esse que você usa nos duelos";

  $("#deck-salvar").disabled = (!alterado && !vazio) || n < DECK_MIN;
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
    if (trancada(c.id)) {
      colecao.append(itemEditor(c, {
        qtd: `🔒 ${precoNaLoja(c.id)}`,
        ativo: false,
        rotulo: `${c.nome}: carta da Loja (${precoNaLoja(c.id)} Careca Coins). Abrir a loja`,
        dica: "🛒 comprar",
        aoClicar: () => document.dispatchEvent(new CustomEvent("abrir-loja", { detail: c.id })),
      }));
      continue;
    }
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
