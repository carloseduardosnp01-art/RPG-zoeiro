/* ==========================================================================
   Duelo da Zoeira · js/deck.js
   O deck de cada jogador. Fica guardado no navegador e, com conta, também
   no perfil (assim vale em qualquer aparelho). Sem deck salvo, vale o
   Deck Careca Supremo (padrão).

   Formato guardado: { "id-da-carta": cópias, ... }
   ========================================================================== */

import { montarDeck, problemaDoDeck } from "./motor.js";
import * as conta from "./conta.js";
import { guardar } from "./util.js";

const CHAVE = "zoeira-deck";

export function paraMapa(lista) {
  const mapa = {};
  for (const id of lista) mapa[id] = (mapa[id] || 0) + 1;
  return mapa;
}

export function paraLista(mapa) {
  return Object.entries(mapa || {}).flatMap(([id, n]) => Array(Math.max(0, n | 0)).fill(id));
}

export const totalDoMapa = (mapa) => Object.values(mapa || {}).reduce((t, n) => t + n, 0);

// Deck que o jogador usa nos duelos (sempre válido)
export function deckAtual() {
  const doPerfil = paraLista(conta.usuarioAtual()?.deck);
  if (doPerfil.length && !problemaDoDeck(doPerfil, { comLimite: false })) return doPerfil;
  const local = paraLista(guardar.ler(CHAVE));
  if (local.length && !problemaDoDeck(local, { comLimite: false })) return local;
  return montarDeck();
}

export function ehDeckPadrao(lista) {
  const a = paraMapa(lista);
  const b = paraMapa(montarDeck());
  return Object.keys({ ...a, ...b }).every((id) => (a[id] || 0) === (b[id] || 0));
}

// Salva (lança erro com a explicação se o deck não valer)
export function salvarDeck(lista) {
  const problema = problemaDoDeck(lista);
  if (problema) throw new Error(problema);
  const mapa = paraMapa(lista);
  guardar.gravar(CHAVE, mapa);
  if (conta.usuarioAtual()) conta.atualizarPerfil({ deck: mapa, deckAtualizado: Date.now() });
  document.dispatchEvent(new CustomEvent("deck-mudou"));
}
