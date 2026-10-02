/* ==========================================================================
   Duelo da Zoeira · js/torneio.js
   Regras do torneio (sem tela): inscrições, chave eliminatória sorteada,
   partidas melhor de 3, W.O., disputa de 3º lugar e pódio.

   O estado é um JSON simples. Só o ADM que criou o torneio mexe nele: as funções
   abaixo mudam o objeto recebido (o chamador passa uma cópia), e depois o ADM
   assina e publica. Ninguém mais consegue alterar a chave ou os resultados.
   ========================================================================== */

export const VITORIAS_NA_PARTIDA = 2; // melhor de 3
export const MAX_INSCRITOS = 32;

const jogador = (j) => ({ chave: j.chave, nick: j.nick, tag: j.tag || "", avatar: j.avatar || "careca-feijao" });

function mudou(t) {
  t.seq = (t.seq || 0) + 1;
  t.atualizado = Date.now();
  return true;
}

export function criarTorneio({ id, nome, organizador, organizadorNick }) {
  const agora = Date.now();
  return {
    id, nome, organizador, organizadorNick,
    status: "inscricoes", // inscricoes -> andamento -> encerrado (ou cancelado)
    criadoEm: agora, atualizado: agora, seq: 1,
    inscritos: [], rodadas: [], terceiro: null, podio: null,
  };
}


/* ---------- Inscrições ---------- */

export function inscrever(t, j) {
  if (t.status !== "inscricoes" || t.inscritos.length >= MAX_INSCRITOS || t.inscritos.some((x) => x.chave === j.chave)) return false;
  t.inscritos.push(jogador(j));
  return mudou(t);
}

export function desinscrever(t, chave) {
  if (t.status !== "inscricoes" || !t.inscritos.some((x) => x.chave === chave)) return false;
  t.inscritos = t.inscritos.filter((x) => x.chave !== chave);
  return mudou(t);
}

export function cancelarTorneio(t) {
  if (t.status === "encerrado" || t.status === "cancelado") return false;
  t.status = "cancelado";
  for (const p of todasPartidas(t)) p.jogando = null;
  return mudou(t);
}


/* ---------- Chave ---------- */

const novaPartida = (rodada, indice, a = null, b = null) => ({
  id: rodada === "terceiro" ? "terceiro" : `r${rodada}-${indice}`,
  rodada, a, b, va: 0, vb: 0, jogos: [], jogando: null, vencedor: null, perdedor: null, bye: false, wo: false,
});

function embaralhar(lista, aleatorio) {
  for (let i = lista.length - 1; i > 0; i--) {
    const k = Math.floor(aleatorio() * (i + 1));
    [lista[i], lista[k]] = [lista[k], lista[i]];
  }
  return lista;
}

// Fecha as inscrições e sorteia a chave. Se o número de inscritos não fechar
// (2, 4, 8, 16...), os primeiros sorteados passam direto da 1ª rodada.
export function sortearChave(t, aleatorio = Math.random) {
  if (t.status !== "inscricoes" || t.inscritos.length < 2) return false;
  const jog = embaralhar([...t.inscritos], aleatorio);
  let tamanho = 2;
  while (tamanho < jog.length) tamanho *= 2;
  const primeira = [];
  for (let i = 0; i < tamanho / 2; i++) primeira.push(novaPartida(0, i, jog[i], jog[tamanho / 2 + i] || null));
  t.rodadas = [primeira];
  for (let n = tamanho / 4, r = 1; n >= 1; n /= 2, r++) {
    t.rodadas.push(Array.from({ length: n }, (_, i) => novaPartida(r, i)));
  }
  t.terceiro = t.rodadas.length >= 2 ? novaPartida("terceiro", 0) : null;
  t.status = "andamento";
  for (const p of primeira) if (p.a && !p.b) concluir(p, p.a.chave, { bye: true });
  propagar(t);
  return mudou(t);
}

export const todasPartidas = (t) => [...(t.rodadas || []).flat(), ...(t.terceiro ? [t.terceiro] : [])];
export const acharPartida = (t, id) => todasPartidas(t).find((p) => p.id === id) || null;

const doLado = (p, chave) => (p.a?.chave === chave ? p.a : p.b?.chave === chave ? p.b : null);

function concluir(p, chave, { bye = false, wo = false } = {}) {
  p.vencedor = chave;
  p.perdedor = (p.a?.chave === chave ? p.b : p.a)?.chave || null;
  p.jogando = null;
  p.bye = bye;
  p.wo = wo;
}

// Leva os vencedores para a próxima rodada, monta a disputa de 3º lugar e fecha o pódio
function propagar(t) {
  for (let r = 0; r < t.rodadas.length - 1; r++) {
    t.rodadas[r].forEach((p, i) => {
      if (!p.vencedor) return;
      const prox = t.rodadas[r + 1][Math.floor(i / 2)];
      const lado = i % 2 === 0 ? "a" : "b";
      if (!prox[lado]) prox[lado] = doLado(p, p.vencedor);
    });
  }
  const t3 = t.terceiro;
  if (t3 && !t3.vencedor && !t3.vazio && !t3.a && !t3.b) {
    const semis = t.rodadas[t.rodadas.length - 2];
    if (semis.every((p) => p.vencedor)) {
      const [a, b] = semis.map((p) => (p.perdedor ? doLado(p, p.perdedor) : null));
      if (a && b) {
        t3.a = a;
        t3.b = b;
      } else if (a || b) {
        // uma das semifinais foi "passou direto": o outro perdedor fica com o bronze
        t3.a = a || b;
        concluir(t3, t3.a.chave, { bye: true });
      } else {
        t3.vazio = true;
      }
    }
  }
  const final = t.rodadas[t.rodadas.length - 1][0];
  const terceiroResolvido = !t3 || t3.vencedor || t3.vazio;
  if (t.status === "andamento" && final.vencedor && terceiroResolvido) {
    t.podio = { ouro: final.vencedor, prata: final.perdedor, bronze: t3?.vencedor || null };
    t.status = "encerrado";
  }
}


/* ---------- Partidas (melhor de 3) ---------- */

export const partidaPronta = (t, p) => t.status === "andamento" && Boolean(p.a && p.b) && !p.vencedor && !p.jogando;

// O ADM apertou "Iniciar jogo": o duelo dueloId é o próximo jogo da partida
export function iniciarJogo(t, partidaId, dueloId) {
  const p = acharPartida(t, partidaId);
  if (!p || !partidaPronta(t, p)) return false;
  p.jogando = dueloId;
  return mudou(t);
}

// Resultado de um jogo (lido do duelo que terminou)
export function registrarJogo(t, partidaId, dueloId, vencedor, motivo = null) {
  const p = acharPartida(t, partidaId);
  if (!p || p.vencedor || p.jogando !== dueloId || !doLado(p, vencedor)) return false;
  p.jogos.push({ duelo: dueloId, vencedor, motivo });
  if (p.a.chave === vencedor) p.va++;
  else p.vb++;
  p.jogando = null;
  if (p.va >= VITORIAS_NA_PARTIDA || p.vb >= VITORIAS_NA_PARTIDA) concluir(p, vencedor);
  propagar(t);
  return mudou(t);
}

// O jogo travou ou alguém caiu: o ADM anula e começa de novo
export function anularJogo(t, partidaId) {
  const p = acharPartida(t, partidaId);
  if (!p || !p.jogando) return false;
  p.jogando = null;
  return mudou(t);
}

// W.O. (alguém não apareceu): a partida inteira vai para o outro
export function darWO(t, partidaId, vencedor) {
  const p = acharPartida(t, partidaId);
  if (!p || t.status !== "andamento" || p.vencedor || !p.a || !p.b || !doLado(p, vencedor)) return false;
  concluir(p, vencedor, { wo: true });
  propagar(t);
  return mudou(t);
}


/* ---------- Para as telas ---------- */

export function nomeRodada(t, rodada) {
  if (rodada === "terceiro") return "Disputa de 3º lugar";
  const n = t.rodadas[rodada]?.length || 0;
  if (rodada === t.rodadas.length - 1) return "Final";
  if (n === 2) return "Semifinal";
  if (n === 4) return "Quartas de final";
  if (n === 8) return "Oitavas de final";
  return `${rodada + 1}ª rodada`;
}

// Partida que o jogador ainda vai jogar (ou está jogando)
export const partidaDe = (t, chave) => todasPartidas(t).find((p) => !p.vencedor && (p.a?.chave === chave || p.b?.chave === chave)) || null;

export const nickNoTorneio = (t, chave) => t.inscritos.find((x) => x.chave === chave)?.nick || chave;
