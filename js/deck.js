/* ==========================================================================
   Duelo da Zoeira · js/deck.js
   O deck de cada jogador. Fica guardado no navegador e, com conta, também
   no perfil (assim vale em qualquer aparelho). Sem deck salvo, vale o
   Deck Careca Supremo (padrão).

   Formato guardado: { "id-da-carta": cópias, ... }
   Até 3 decks salvos (MAX_DECKS): cada um com nome e cartas; o que está "em
   uso" é copiado para o campo "deck" do perfil, que é o que vale nos duelos.
   ========================================================================== */

import { montarDeck, problemaDoDeck, precoNaLoja, cartaPorId, ehFusao } from "./motor.js?v=202610071340";
import * as conta from "./conta.js?v=202610071340";
import { guardar } from "./util.js?v=202610071340";

const CHAVE = "zoeira-deck";
const CHAVE_DECKS = "zoeira-decks";
export const MAX_DECKS = 3;
const NOME_MAX = 24;

export function paraMapa(lista) {
  const mapa = {};
  for (const id of lista) mapa[id] = (mapa[id] || 0) + 1;
  return mapa;
}

export function paraLista(mapa) {
  return Object.entries(mapa || {}).flatMap(([id, n]) => Array(Math.max(0, n | 0)).fill(id));
}

export const totalDoMapa = (mapa) => Object.values(mapa || {}).reduce((t, n) => t + n, 0);

// Cartas da Loja só valem para quem comprou: a que não foi comprada vira Careca Feijão
// (como as cópias acima do limite), e a de Fusão sai do Deck Adicional
function soAsMinhas(lista) {
  const minhas = conta.cartasCompradas();
  return lista
    .map((id) => (!precoNaLoja(id) || minhas.has(id) ? id : ehFusao(cartaPorId(id)) ? null : "careca-feijao"))
    .filter(Boolean);
}

// Deck que o jogador usa nos duelos (sempre válido)
export function deckAtual() {
  const doPerfil = soAsMinhas(paraLista(conta.usuarioAtual()?.deck));
  if (doPerfil.length && !problemaDoDeck(doPerfil, { comLimite: false })) return doPerfil;
  const local = soAsMinhas(paraLista(guardar.ler(CHAVE)));
  if (local.length && !problemaDoDeck(local, { comLimite: false })) return local;
  return montarDeck();
}

export function ehDeckPadrao(lista) {
  const a = paraMapa(lista);
  const b = paraMapa(montarDeck());
  return Object.keys({ ...a, ...b }).every((id) => (a[id] || 0) === (b[id] || 0));
}

const nomePadrao = (i) => `Deck ${i + 1}`;
const mapaValido = (m) => (m && typeof m === "object" && totalDoMapa(m) > 0 ? m : null);

// Os 3 decks salvos: { decks: [{ nome, cartas (mapa ou null = vazio) }], ativo }.
// Quem só tinha 1 deck (antes desta versão) vê ele no Deck 1, em uso.
export function meusDecks() {
  const u = conta.usuarioAtual();
  const fonte = u || guardar.ler(CHAVE_DECKS, {}) || {};
  const lista = Array.isArray(fonte.decks) ? fonte.decks : [];
  const decks = Array.from({ length: MAX_DECKS }, (_, i) => {
    const d = lista[i] && typeof lista[i] === "object" ? lista[i] : {};
    const nome = typeof d.nome === "string" && d.nome.trim() ? d.nome.trim().slice(0, NOME_MAX) : nomePadrao(i);
    return { nome, cartas: mapaValido(d.cartas) };
  });
  const ativo = Number.isInteger(fonte.deckSlot) && fonte.deckSlot >= 0 && fonte.deckSlot < MAX_DECKS ? fonte.deckSlot : 0;
  if (!decks.some((d) => d.cartas)) {
    // ainda não tem os 3 decks: o deck de antes vira o Deck 1
    const antigo = mapaValido(u ? u.deck : null) || mapaValido(guardar.ler(CHAVE));
    if (antigo) decks[0].cartas = antigo;
    return { decks, ativo: 0 };
  }
  return { decks, ativo };
}

function gravarDecks(decks, ativo) {
  const emUso = decks[ativo].cartas;
  const dados = { decks: decks.map((d) => ({ nome: d.nome, cartas: d.cartas })), deckSlot: ativo };
  guardar.gravar(CHAVE_DECKS, dados);
  if (emUso) guardar.gravar(CHAVE, emUso);
  if (conta.usuarioAtual()) conta.atualizarPerfil({ ...dados, ...(emUso ? { deck: emUso } : {}), deckAtualizado: Date.now() });
  document.dispatchEvent(new CustomEvent("deck-mudou"));
}

// Salva um dos decks (lança erro com a explicação se o deck não valer)
export function salvarDeck(lista, slot = meusDecks().ativo) {
  const problema = problemaDoDeck(lista);
  if (problema) throw new Error(problema);
  const { decks, ativo } = meusDecks();
  decks[slot].cartas = paraMapa(lista);
  gravarDecks(decks, ativo);
}

// Escolhe qual deck salvo vai para os duelos
export function usarDeck(slot) {
  const { decks } = meusDecks();
  if (!decks[slot]?.cartas) throw new Error("Esse deck ainda está vazio: monte e salve antes de usar.");
  gravarDecks(decks, slot);
}

export function renomearDeck(slot, nome) {
  const limpo = String(nome || "").replace(/\s+/g, " ").trim().slice(0, NOME_MAX);
  if (!limpo) throw new Error("Escolha um nome para o deck.");
  const { decks, ativo } = meusDecks();
  decks[slot].nome = limpo;
  gravarDecks(decks, ativo);
}
