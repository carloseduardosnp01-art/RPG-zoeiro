/* ==========================================================================
   Duelo da Zoeira · js/motor.js
   Motor de regras do duelo. Não mexe na tela: recebe o estado e uma ação,
   e devolve o novo estado e a lista de eventos (usados nas animações e no log).

   O estado é um objeto JSON simples, então pode ser enviado pela rede.
   O único sorteio acontece em novoDuelo() (embaralhar e decidir quem começa),
   com semente: o resto é determinístico.

     1. Constantes e cartas
     2. Criação do duelo
     3. Consultas (onde está a carta, ATK atual, quem age...)
     4. Aplicar uma ação
     5. Invocações
     6. Magias
     7. Armadilhas automáticas
     8. Batalha
     9. Turnos, fases e fim do duelo
    10. Escolhas pendentes (alvos de efeitos e descarte)
    11. Opções de cada carta (usadas pela tela e pelo bot)
   ========================================================================== */


/* ---------- 1. Constantes e cartas ---------- */

export const PL_INICIAL = 8000;
export const MAO_INICIAL = 5;
export const DECK_MIN = 40;
export const DECK_MAX = 60;
export const MAX_COPIAS = 3;
export const LIMITE_MAO = 6;
export const ZONAS = 5;
export const TEMPO_ACAO = 60; // segundos para cada ação
export const FASES = ["compra", "espera", "principal1", "batalha", "principal2", "final"];

let CARTAS = {};

export function registrarCartas(lista) {
  CARTAS = {};
  for (const c of lista) CARTAS[c.id] = c;
}

export function cartaPorId(id) {
  return CARTAS[id];
}

// Deck padrão (Deck Careca Supremo): cada carta repetida pelo número de cópias
export function montarDeck() {
  const deck = [];
  for (const c of Object.values(CARTAS)) {
    for (let i = 0; i < c.copias; i++) deck.push(c.id);
  }
  return deck;
}

// Explica por que um deck (lista de ids) não vale, ou devolve null se estiver ok
export function problemaDoDeck(lista) {
  if (!Array.isArray(lista)) return "Deck inválido.";
  if (lista.length < DECK_MIN) return `O deck precisa ter pelo menos ${DECK_MIN} cartas.`;
  if (lista.length > DECK_MAX) return `O deck pode ter no máximo ${DECK_MAX} cartas.`;
  const contagem = {};
  for (const id of lista) {
    if (!CARTAS[id]) return "O deck tem uma carta que não existe.";
    contagem[id] = (contagem[id] || 0) + 1;
    if (contagem[id] > MAX_COPIAS) return `No máximo ${MAX_COPIAS} cópias de "${CARTAS[id].nome}".`;
  }
  return null;
}

export class ErroJogada extends Error {}


/* ---------- 2. Criação do duelo ---------- */

// Gerador de números aleatórios com semente (mulberry32)
function criarSorteio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralhar(lista, sorteio) {
  for (let i = lista.length - 1; i > 0; i--) {
    const k = Math.floor(sorteio() * (i + 1));
    [lista[i], lista[k]] = [lista[k], lista[i]];
  }
  return lista;
}

// jogadores: [{ chave, nick, tag, avatar, nivel, deck? }, {...}]
// deck: lista de ids das cartas; se faltar ou não valer, usa o deck padrão
export function novoDuelo({ id, jogadores, semente = Date.now() }) {
  const sorteio = criarSorteio(semente);
  const estado = {
    versao: 1,
    id,
    seq: 0,
    turno: 1,
    vez: 0,
    fase: "compra",
    tempoAcao: TEMPO_ACAO,
    jogadores: [],
    cartas: {},       // id da instância ("a12", "b3"...) -> id da carta
    pendente: null,   // escolha que precisa ser feita antes de continuar
    vencedor: null,
    motivo: null,
    historico: [],    // últimos eventos, para o log
  };

  jogadores.forEach((info, j) => {
    const prefixo = j === 0 ? "a" : "b";
    const deckBase = info.deck && !problemaDoDeck(info.deck) ? info.deck : montarDeck();
    const deck = deckBase.map((idCarta, k) => {
      const iid = prefixo + k;
      estado.cartas[iid] = idCarta;
      return iid;
    });
    estado.jogadores.push({
      chave: info.chave,
      nick: info.nick,
      tag: info.tag || "",
      avatar: info.avatar || "",
      nivel: info.nivel || 1,
      bot: Boolean(info.bot),
      pl: PL_INICIAL,
      deck: embaralhar(deck, sorteio),
      mao: [],
      cemiterio: [],
      monstros: Array(ZONAS).fill(null),
      magias: Array(ZONAS).fill(null),
      invocouNormal: false,
    });
  });

  const eventos = [];
  estado.vez = sorteio() < 0.5 ? 0 : 1;
  eventos.push({ t: "inicio", j: estado.vez });
  for (const j of [0, 1]) comprar(estado, j, MAO_INICIAL, eventos, true);
  iniciarTurno(estado, eventos);
  registrarHistorico(estado, eventos);
  return { estado, eventos };
}


/* ---------- 3. Consultas ---------- */

export function carta(estado, iid) {
  return CARTAS[estado.cartas[iid]];
}

export const oponente = (j) => 1 - j;
export const ehFasePrincipal = (estado) => estado.fase === "principal1" || estado.fase === "principal2";

// Quem precisa agir agora (null se o duelo acabou)
export function quemAge(estado) {
  if (estado.vencedor !== null) return null;
  return estado.pendente ? estado.pendente.jogador : estado.vez;
}

export function tributosNecessarios(nivel) {
  if (nivel >= 7) return 2;
  if (nivel >= 5) return 1;
  return 0;
}

// Onde está uma carta: { j, zona, slot, obj }
export function localizar(estado, iid) {
  for (let j = 0; j < 2; j++) {
    const p = estado.jogadores[j];
    for (const zona of ["monstros", "magias"]) {
      const slot = p[zona].findIndex((m) => m && m.iid === iid);
      if (slot >= 0) return { j, zona, slot, obj: p[zona][slot] };
    }
    for (const zona of ["mao", "cemiterio", "deck"]) {
      const slot = p[zona].indexOf(iid);
      if (slot >= 0) return { j, zona, slot, obj: null };
    }
  }
  return null;
}

function noCampo(estado, iid) {
  const loc = localizar(estado, iid);
  return Boolean(loc && (loc.zona === "monstros" || loc.zona === "magias"));
}

export function atkAtual(estado, iid) {
  const c = carta(estado, iid);
  if (!c || c.categoria !== "monstro") return 0;
  let atk = c.atk;
  if (c.efeito === "feiticeira") {
    const mestres = estado.jogadores
      .flatMap((p) => p.cemiterio)
      .filter((x) => estado.cartas[x] === "grande-mestre").length;
    atk += 300 * mestres;
  }
  for (const p of estado.jogadores) {
    for (const m of p.magias) {
      if (m && m.face && m.equipadoEm === iid) atk += carta(estado, m.iid).bonusAtk || 0;
    }
  }
  return atk;
}

export function defAtual(estado, iid) {
  return carta(estado, iid).def;
}

// Monstros no campo (iids), de um jogador ou dos dois
export function monstrosEmCampo(estado, j = null) {
  const lados = j === null ? [0, 1] : [j];
  return lados.flatMap((q) => estado.jogadores[q].monstros.filter(Boolean).map((m) => m.iid));
}

// Magias/Armadilhas no campo (iids)
export function magiasEmCampo(estado, j = null) {
  const lados = j === null ? [0, 1] : [j];
  return lados.flatMap((q) => estado.jogadores[q].magias.filter(Boolean).map((m) => m.iid));
}

// "Carecas da Luz Reveladora" ativa no lado do jogador j?
export function luzAtiva(estado, j) {
  return estado.jogadores[j].magias.some((m) => m && m.face && carta(estado, m.iid).efeito === "luz");
}

const zonaLivre = (lista) => lista.findIndex((m) => !m);


/* ---------- 4. Aplicar uma ação ---------- */

// Devolve { estado, eventos } ou lança ErroJogada com a explicação.
export function aplicar(estadoAnterior, j, acao) {
  const estado = structuredClone(estadoAnterior);
  const eventos = [];
  const erro = executar(estado, j, acao, eventos);
  if (erro) throw new ErroJogada(erro);
  estado.seq++;
  registrarHistorico(estado, eventos);
  return { estado, eventos };
}

// Diz se a ação é válida sem aplicar (null = ok, texto = motivo)
export function validar(estado, j, acao) {
  try {
    aplicar(estado, j, acao);
    return null;
  } catch (e) {
    if (e instanceof ErroJogada) return e.message;
    throw e;
  }
}

function registrarHistorico(estado, eventos) {
  for (const e of eventos) estado.historico.push({ ...e, turno: estado.turno });
  if (estado.historico.length > 80) estado.historico.splice(0, estado.historico.length - 80);
}

function executar(estado, j, acao, ev) {
  if (estado.vencedor !== null) return "O duelo já terminou.";
  if (acao.tipo === "desistir") {
    ev.push({ t: "desistencia", j });
    encerrar(estado, oponente(j), "desistencia", ev);
    return null;
  }
  if (acao.tipo === "wo") {
    // O oponente sumiu (sem sinal): quem está esperando reivindica a vitória
    if (quemAge(estado) === j) return "É a sua vez: não dá para pedir W.O. agora.";
    encerrar(estado, j, "wo", ev);
    return null;
  }
  if (quemAge(estado) !== j) return "Não é a sua vez.";
  if (acao.tipo === "tempo") return tempoEsgotado(estado, j, ev);
  if (estado.pendente && acao.tipo !== "escolher") return "Termine a escolha pendente primeiro.";

  switch (acao.tipo) {
    case "invocar": return invocar(estado, j, acao, ev);
    case "invocarEspecial": return invocarPenetra(estado, j, acao, ev);
    case "virar": return invocarFlip(estado, j, acao, ev);
    case "mudarPosicao": return mudarPosicao(estado, j, acao, ev);
    case "ativar": return ativarMagia(estado, j, acao, ev);
    case "baixarMagia": return baixarMagia(estado, j, acao, ev);
    case "atacar": return atacar(estado, j, acao, ev);
    case "fase": return mudarFase(estado, j, acao, ev);
    case "escolher": return resolverEscolha(estado, j, acao.alvos || [], ev);
    default: return "Ação desconhecida.";
  }
}


/* ---------- 5. Invocações ---------- */

function invocar(estado, j, { iid, modo = "atk", tributos = [] }, ev) {
  const p = estado.jogadores[j];
  if (!ehFasePrincipal(estado)) return "Só dá para invocar nas Fases Principais.";
  if (!p.mao.includes(iid)) return "Essa carta não está na sua mão.";
  const c = carta(estado, iid);
  if (c.categoria !== "monstro") return "Essa carta não é um monstro.";
  if (p.invocouNormal) return "Você já fez sua Invocação-Normal neste turno.";

  const n = tributosNecessarios(c.nivel);
  const slots = [...new Set(tributos)];
  if (slots.length !== n || tributos.length !== n) {
    return n === 0 ? "Esse monstro não precisa de tributo." : `Esse monstro precisa de ${n} tributo${n > 1 ? "s" : ""}.`;
  }
  if (slots.some((s) => !p.monstros[s])) return "Tributo inválido.";
  if (n === 0 && zonaLivre(p.monstros) < 0) return "Não há zona de monstro livre.";

  // Oferece os tributos
  for (const s of slots) {
    const iidTributo = p.monstros[s].iid;
    ev.push({ t: "tributo", j, iid: iidTributo });
    removerDoCampo(estado, iidTributo, ev, "tributo");
  }

  p.mao.splice(p.mao.indexOf(iid), 1);
  const slot = zonaLivre(p.monstros);
  const baixado = modo === "baixar";
  p.monstros[slot] = {
    iid,
    pos: baixado ? "def" : "atk",
    face: !baixado,
    turnoEntrou: estado.turno,
    mudouPos: estado.turno,
    atacou: false,
  };
  p.invocouNormal = true;

  if (baixado) {
    ev.push({ t: "baixada", j, iid, zona: "monstros", slot });
    return null;
  }
  const tipoInvocacao = n > 0 ? "tributo" : "normal";
  ev.push({ t: "invocacao", j, iid, modo: tipoInvocacao, slot });
  aposInvocar(estado, j, iid, tipoInvocacao, ev);
  return null;
}

// Carecalla: Invocação-Especial da mão se só o oponente tiver monstros
export function podeInvocarPenetra(estado, j, iid) {
  const p = estado.jogadores[j];
  return (
    ehFasePrincipal(estado) &&
    p.mao.includes(iid) &&
    carta(estado, iid).efeito === "penetra" &&
    monstrosEmCampo(estado, j).length === 0 &&
    monstrosEmCampo(estado, oponente(j)).length > 0
  );
}

function invocarPenetra(estado, j, { iid, pos = "atk" }, ev) {
  if (!podeInvocarPenetra(estado, j, iid)) {
    return "Só dá para entrar de penetra se o seu campo estiver vazio e o oponente tiver monstro.";
  }
  const p = estado.jogadores[j];
  p.mao.splice(p.mao.indexOf(iid), 1);
  const slot = zonaLivre(p.monstros);
  p.monstros[slot] = { iid, pos: pos === "def" ? "def" : "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
  ev.push({ t: "invocacao", j, iid, modo: "especial", slot });
  return null;
}

function invocarFlip(estado, j, { slot }, ev) {
  const p = estado.jogadores[j];
  const m = p.monstros[slot];
  if (!ehFasePrincipal(estado)) return "Só dá para virar monstros nas Fases Principais.";
  if (!m || m.face) return "Escolha um monstro seu virado para baixo.";
  if (m.turnoEntrou >= estado.turno) return "Monstro baixado neste turno só pode ser virado no próximo.";
  if (m.mudouPos === estado.turno) return "Esse monstro já mudou de posição neste turno.";
  m.face = true;
  m.pos = "atk";
  m.mudouPos = estado.turno;
  ev.push({ t: "invocacao", j, iid: m.iid, modo: "flip", slot });
  aposInvocar(estado, j, m.iid, "flip", ev);
  return null;
}

function mudarPosicao(estado, j, { slot }, ev) {
  const m = estado.jogadores[j].monstros[slot];
  if (!ehFasePrincipal(estado)) return "Só dá para mudar a posição nas Fases Principais.";
  if (!m) return "Não há monstro nessa zona.";
  if (!m.face) return "Para desvirar, use a Invocação-Flip (Virar).";
  if (m.turnoEntrou >= estado.turno) return "Um monstro não muda de posição no turno em que entrou em campo.";
  if (m.mudouPos === estado.turno) return "Esse monstro já mudou de posição neste turno.";
  if (m.atacou) return "Esse monstro atacou neste turno.";
  m.pos = m.pos === "atk" ? "def" : "atk";
  m.mudouPos = estado.turno;
  ev.push({ t: "posicao", j, iid: m.iid, pos: m.pos });
  return null;
}

// Depois que um monstro é Invocado: primeiro as armadilhas do oponente, depois o efeito do monstro.
// (O efeito de Invocação resolve mesmo se a armadilha destruir o monstro, como numa corrente.)
function aposInvocar(estado, j, iid, modo, ev) {
  verificarArmadilhas(estado, "invocacao", { j, iid, modo }, ev);
  if (estado.vencedor !== null) return;
  const c = carta(estado, iid);

  if (modo === "tributo" && c.efeito === "tributo-destruir-monstro") {
    pedirAlvoMonstro(estado, j, iid, `${c.nome}: escolha 1 monstro para destruir`);
  } else if (modo === "tributo" && c.efeito === "tributo-destruir-magias") {
    const candidatos = magiasEmCampo(estado);
    if (candidatos.length) {
      estado.pendente = {
        tipo: "alvo", efeito: c.efeito, jogador: j, origem: iid, candidatos, min: 0, max: 2,
        titulo: `${c.nome}: escolha até 2 Magias/Armadilhas para destruir`,
      };
    }
  } else if (modo === "flip") {
    efeitoVire(estado, j, iid, true, ev);
  }
}

// "Destrua 1 monstro" (Careca do PT, Careca Cast Surpresa): só pergunta se o oponente tiver
// monstro, e nunca obriga a destruir um monstro seu (dá para não escolher nada).
function pedirAlvoMonstro(estado, j, origem, titulo) {
  if (!monstrosEmCampo(estado, oponente(j)).length) return;
  estado.pendente = {
    tipo: "alvo", efeito: carta(estado, origem).efeito, jogador: j, origem,
    candidatos: monstrosEmCampo(estado), min: 0, max: 1, titulo,
  };
}

// Efeitos VIRE. manual = o dono virou (Invocação-Flip) e escolhe;
// senão a carta foi virada por um ataque no turno do oponente e tudo é automático.
function efeitoVire(estado, dono, iid, manual, ev) {
  const c = carta(estado, iid);
  const o = oponente(dono);
  switch (c.efeito) {
    case "flip-destruir": {
      if (manual) {
        pedirAlvoMonstro(estado, dono, iid, `${c.nome} (VIRE): escolha 1 monstro para destruir`);
        break;
      }
      const alvo = maisForte(estado, monstrosEmCampo(estado, o));
      if (alvo) {
        ev.push({ t: "efeito", j: dono, iid });
        destruir(estado, alvo, ev, "efeito");
      }
      break;
    }
    case "flip-comprar":
      ev.push({ t: "efeito", j: dono, iid });
      if (estado.jogadores[dono].deck.length) comprar(estado, dono, 1, ev);
      break;
    case "flip-descartar": {
      const mao = estado.jogadores[o].mao;
      if (!mao.length) break;
      if (manual) {
        estado.pendente = {
          tipo: "alvo", efeito: c.efeito, jogador: dono, origem: iid, candidatos: [...mao], min: 1, max: 1,
          titulo: `${c.nome} (VIRE): escolha 1 carta da mão do oponente para descartar`,
        };
        break;
      }
      ev.push({ t: "efeito", j: dono, iid });
      descartar(estado, o, mao[Math.floor(sorteioDoEstado(estado)() * mao.length)], ev);
      break;
    }
  }
}

// Sorteio que dá o mesmo resultado nos dois navegadores (depende só do estado)
function sorteioDoEstado(estado) {
  let h = 2166136261;
  for (const ch of `${estado.id}:${estado.seq}:${estado.turno}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return criarSorteio(h);
}

function descartar(estado, j, iid, ev) {
  const p = estado.jogadores[j];
  const i = p.mao.indexOf(iid);
  if (i < 0) return;
  p.mao.splice(i, 1);
  p.cemiterio.push(iid);
  ev.push({ t: "descarte", j, iid });
}


/* ---------- 6. Magias ---------- */

// O que a magia precisa para ser ativada: { alvos: null | {candidatos, min, max, titulo} } ou null se não dá
export function requisitosMagia(estado, j, iid) {
  const c = carta(estado, iid);
  const p = estado.jogadores[j];
  switch (c.efeito) {
    case "vapo":
      return monstrosEmCampo(estado).length ? { alvos: null } : null;
    case "luz":
      return { alvos: null };
    case "soco": {
      const candidatos = magiasEmCampo(estado).filter((x) => x !== iid);
      return candidatos.length
        ? { alvos: { candidatos, min: 1, max: 1, titulo: "Soco do Big: escolha 1 Magia/Armadilha para destruir" } }
        : null;
    }
    case "bust": {
      const candidatos = [0, 1].flatMap((q) =>
        estado.jogadores[q].monstros.filter((m) => m && m.face).map((m) => m.iid));
      return candidatos.length
        ? { alvos: { candidatos, min: 1, max: 1, titulo: "Bust do Big: escolha o monstro que vai ganhar 700 de ATK" } }
        : null;
    }
    case "invocador": {
      const candidatos = p.mao.filter((x) => {
        const m = carta(estado, x);
        return m.categoria === "monstro" && m.subtipo === "normal" && m.nivel >= 5;
      });
      return candidatos.length && zonaLivre(p.monstros) >= 0
        ? { alvos: { candidatos, min: 1, max: 1, titulo: "Invocador: escolha o Monstro Normal que vai entrar" } }
        : null;
    }
    default:
      return null;
  }
}

function ativarMagia(estado, j, { iid, alvos = [] }, ev) {
  const p = estado.jogadores[j];
  if (estado.vez !== j || !ehFasePrincipal(estado)) return "Magias são ativadas nas suas Fases Principais.";
  const c = carta(estado, iid);
  if (!c || c.categoria !== "magia") return "Armadilhas ativam sozinhas: é só baixar no campo.";
  const loc = localizar(estado, iid);
  const daMao = loc && loc.j === j && loc.zona === "mao";
  const doCampo = loc && loc.j === j && loc.zona === "magias" && !loc.obj.face;
  if (!daMao && !doCampo) return "Essa carta não pode ser ativada agora.";
  if (doCampo && c.subtipo === "rapida" && loc.obj.turnoBaixada >= estado.turno) {
    return "Magia Rápida baixada só pode ser ativada a partir do próximo turno.";
  }
  if (daMao && zonaLivre(p.magias) < 0) return "Não há zona de Magia/Armadilha livre.";

  const req = requisitosMagia(estado, j, iid);
  if (!req) return "Não há alvos válidos para essa magia agora.";
  if (req.alvos) {
    const unicos = [...new Set(alvos)];
    if (unicos.length !== alvos.length || alvos.length < req.alvos.min || alvos.length > req.alvos.max) {
      return "Escolha os alvos da magia.";
    }
    if (alvos.some((a) => !req.alvos.candidatos.includes(a))) return "Alvo inválido.";
  }

  // Coloca a carta com a face para cima no campo
  let obj;
  if (daMao) {
    p.mao.splice(p.mao.indexOf(iid), 1);
    const slot = zonaLivre(p.magias);
    obj = { iid, face: true, turnoBaixada: estado.turno };
    p.magias[slot] = obj;
  } else {
    obj = loc.obj;
    obj.face = true;
  }
  ev.push({ t: "ativacao", j, iid });

  switch (c.efeito) {
    case "vapo":
      for (const alvo of monstrosEmCampo(estado)) destruir(estado, alvo, ev, "efeito");
      mandarProCemiterio(estado, iid, ev);
      break;
    case "soco":
      destruir(estado, alvos[0], ev, "efeito");
      mandarProCemiterio(estado, iid, ev);
      break;
    case "bust":
      obj.equipadoEm = alvos[0];
      ev.push({ t: "equipada", j, iid, alvo: alvos[0] });
      break;
    case "invocador": {
      const alvo = alvos[0];
      p.mao.splice(p.mao.indexOf(alvo), 1);
      const slot = zonaLivre(p.monstros);
      p.monstros[slot] = { iid: alvo, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
      ev.push({ t: "invocacao", j, iid: alvo, modo: "especial", slot });
      mandarProCemiterio(estado, iid, ev);
      break;
    }
    case "luz":
      // Revela os monstros virados do oponente (sem ativar os efeitos VIRE deles)
      estado.jogadores[oponente(j)].monstros.forEach((m) => {
        if (m && !m.face) {
          m.face = true;
          ev.push({ t: "virada", j: oponente(j), iid: m.iid, semEfeito: true });
        }
      });
      obj.turnosRestantes = 3;
      break;
  }
  return null;
}

function baixarMagia(estado, j, { iid }, ev) {
  const p = estado.jogadores[j];
  if (!ehFasePrincipal(estado)) return "Só dá para baixar cartas nas Fases Principais.";
  if (!p.mao.includes(iid)) return "Essa carta não está na sua mão.";
  const c = carta(estado, iid);
  if (c.categoria === "monstro") return "Monstros são baixados pela opção Baixar do monstro.";
  const slot = zonaLivre(p.magias);
  if (slot < 0) return "Não há zona de Magia/Armadilha livre.";
  p.mao.splice(p.mao.indexOf(iid), 1);
  p.magias[slot] = { iid, face: false, turnoBaixada: estado.turno };
  ev.push({ t: "baixada", j, iid, zona: "magias", slot });
  return null;
}


/* ---------- 7. Armadilhas automáticas ---------- */

// Procura uma armadilha virada do defensor que responda ao gatilho. Ativa no máximo uma por gatilho.
function verificarArmadilhas(estado, gatilho, dados, ev) {
  const defensor = oponente(dados.j);
  const p = estado.jogadores[defensor];
  for (let s = 0; s < ZONAS; s++) {
    const m = p.magias[s];
    if (!m || m.face || m.turnoBaixada >= estado.turno) continue; // só a partir do turno seguinte
    const c = carta(estado, m.iid);
    if (c.categoria !== "armadilha") continue;

    if (gatilho === "invocacao" && c.efeito === "armadilha-big") {
      if (!["normal", "tributo", "flip"].includes(dados.modo)) continue;
      const loc = localizar(estado, dados.iid);
      if (!loc || loc.zona !== "monstros") continue;
      if (atkAtual(estado, dados.iid) < 1000) continue;
      m.face = true;
      ev.push({ t: "armadilha", j: defensor, iid: m.iid, alvo: dados.iid });
      destruir(estado, dados.iid, ev, "efeito");
      mandarProCemiterio(estado, m.iid, ev);
      return true;
    }

    if (gatilho === "ataque" && c.efeito === "forca-careca") {
      const atacantes = estado.jogadores[dados.j].monstros.filter((x) => x && x.face && x.pos === "atk").map((x) => x.iid);
      if (!atacantes.length) continue;
      m.face = true;
      ev.push({ t: "armadilha", j: defensor, iid: m.iid, alvo: dados.iid });
      for (const alvo of atacantes) destruir(estado, alvo, ev, "efeito");
      mandarProCemiterio(estado, m.iid, ev);
      return true;
    }
  }
  return false;
}


/* ---------- 8. Batalha ---------- */

// Monstros do jogador que ainda podem atacar neste turno
export function podeAtacar(estado, j, slot) {
  const m = estado.jogadores[j].monstros[slot];
  return (
    estado.vez === j &&
    estado.fase === "batalha" &&
    estado.turno > 1 &&
    !luzAtiva(estado, oponente(j)) &&
    Boolean(m && m.face && m.pos === "atk" && !m.atacou)
  );
}

function atacar(estado, j, { slot, alvo = null }, ev) {
  if (estado.fase !== "batalha") return "Ataques só na Fase de Batalha.";
  if (estado.turno === 1) return "Ninguém ataca no primeiro turno do duelo.";
  const p = estado.jogadores[j];
  const o = estado.jogadores[oponente(j)];
  const m = p.monstros[slot];
  if (!m) return "Não há monstro nessa zona.";
  if (!m.face || m.pos !== "atk") return "Só monstros em Posição de Ataque podem atacar.";
  if (m.atacou) return "Esse monstro já atacou neste turno.";
  if (luzAtiva(estado, oponente(j))) return "As Carecas da Luz Reveladora estão te cegando: não dá para atacar!";

  const temMonstros = o.monstros.some(Boolean);
  if (alvo === null || alvo === undefined) {
    if (temMonstros) return "Só dá para atacar direto se o oponente não tiver monstros.";
  } else if (!o.monstros[alvo]) {
    return "Não há monstro nessa zona do oponente.";
  }

  m.atacou = true;
  const atacante = m.iid;
  const defensor = alvo === null || alvo === undefined ? null : o.monstros[alvo].iid;
  ev.push({ t: "ataque", j, iid: atacante, alvo: defensor });

  verificarArmadilhas(estado, "ataque", { j, iid: atacante }, ev);
  if (estado.vencedor !== null || !noCampo(estado, atacante)) return null;
  if (defensor && !noCampo(estado, defensor)) return null; // o alvo sumiu: o ataque para

  const atk = atkAtual(estado, atacante);
  if (!defensor) {
    danoBatalha(estado, oponente(j), atk, ev);
    return null;
  }

  const d = localizar(estado, defensor).obj;
  let virou = false;
  if (!d.face) {
    d.face = true;
    virou = true;
    ev.push({ t: "virada", j: oponente(j), iid: defensor });
  }

  if (d.pos === "atk") {
    const atkD = atkAtual(estado, defensor);
    if (atk > atkD) {
      destruir(estado, defensor, ev, "batalha");
      danoBatalha(estado, oponente(j), atk - atkD, ev);
    } else if (atk < atkD) {
      destruir(estado, atacante, ev, "batalha");
      danoBatalha(estado, j, atkD - atk, ev);
    } else if (atk > 0) {
      destruir(estado, atacante, ev, "batalha");
      destruir(estado, defensor, ev, "batalha");
    }
  } else {
    const defD = defAtual(estado, defensor);
    if (atk > defD) destruir(estado, defensor, ev, "batalha");
    else if (atk < defD) danoBatalha(estado, j, defD - atk, ev);
  }

  // Miro Animal (saideira): destruiu um monstro do oponente em batalha e continua em campo
  if (estado.vencedor === null && !noCampo(estado, defensor) && noCampo(estado, atacante) && carta(estado, atacante).efeito === "saideira") {
    ev.push({ t: "efeito", j, iid: atacante });
    dano(estado, oponente(j), 500, ev);
  }

  // Monstro FLIP virado pelo ataque: o efeito ativa sozinho (escolhas automáticas)
  if (virou && estado.vencedor === null) efeitoVire(estado, oponente(j), defensor, false, ev);
  return null;
}

function maisForte(estado, iids) {
  let melhor = null;
  for (const x of iids) {
    if (!melhor || atkAtual(estado, x) > atkAtual(estado, melhor)) melhor = x;
  }
  return melhor;
}

// Dano de batalha: o Karecoh Alado destruído neste turno protege o dono
function danoBatalha(estado, j, valor, ev) {
  if (valor > 0 && estado.jogadores[j].semDanoBatalha === estado.turno) {
    ev.push({ t: "protegido", j, valor });
    return;
  }
  dano(estado, j, valor, ev);
}

function dano(estado, j, valor, ev) {
  if (valor <= 0) return;
  const p = estado.jogadores[j];
  p.pl = Math.max(0, p.pl - valor);
  ev.push({ t: "dano", j, valor, pl: p.pl });
  if (p.pl === 0) encerrar(estado, oponente(j), "pl", ev);
}


/* ---------- Destruição e cemitério ---------- */

function destruir(estado, iid, ev, causa) {
  const loc = localizar(estado, iid);
  if (!loc || (loc.zona !== "monstros" && loc.zona !== "magias")) return;
  ev.push({ t: "destruida", iid, j: loc.j, causa });
  removerDoCampo(estado, iid, ev, causa);
  // Karecoh Alado: destruído no campo -> o dono não sofre dano de batalha pelo resto do turno
  if (loc.zona === "monstros" && carta(estado, iid).efeito === "karecoh") {
    estado.jogadores[loc.j].semDanoBatalha = estado.turno;
    ev.push({ t: "efeito", j: loc.j, iid });
  }
}

// Tira a carta do campo e manda para o Cemitério do dono (equipamentos presos a ela vão junto)
function removerDoCampo(estado, iid, ev, causa) {
  const loc = localizar(estado, iid);
  if (!loc) return;
  const p = estado.jogadores[loc.j];
  p[loc.zona][loc.slot] = null;
  p.cemiterio.push(iid);
  if (loc.zona === "monstros") {
    for (let q = 0; q < 2; q++) {
      estado.jogadores[q].magias.forEach((m) => {
        if (m && m.equipadoEm === iid) {
          ev.push({ t: "destruida", iid: m.iid, j: q, causa: "equipamento" });
          removerDoCampo(estado, m.iid, ev, causa);
        }
      });
    }
  }
}

// Magia/Armadilha que terminou de resolver
function mandarProCemiterio(estado, iid, ev) {
  if (!noCampo(estado, iid)) return;
  removerDoCampo(estado, iid, ev, "resolvida");
  ev.push({ t: "resolvida", iid });
}


/* ---------- 9. Turnos, fases e fim do duelo ---------- */

function comprar(estado, j, quantidade, ev, inicial = false) {
  const p = estado.jogadores[j];
  for (let i = 0; i < quantidade; i++) {
    if (!p.deck.length) {
      encerrar(estado, oponente(j), "deck", ev);
      return false;
    }
    const iid = p.deck.pop();
    p.mao.push(iid);
    ev.push({ t: "compra", j, iid, inicial });
  }
  return true;
}

function iniciarTurno(estado, ev) {
  const j = estado.vez;
  ev.push({ t: "turno", j, turno: estado.turno });
  estado.fase = "compra";
  // Todo turno começa com uma compra, inclusive o primeiro do duelo
  if (!comprar(estado, j, 1, ev)) return;
  estado.fase = "principal1";
  ev.push({ t: "fase", j, fase: "principal1" });
}

function mudarFase(estado, j, { para }, ev) {
  const atual = estado.fase;
  const permitido = {
    principal1: ["batalha", "final"],
    batalha: ["principal2", "final"],
    principal2: ["final"],
  };
  if (!(permitido[atual] || []).includes(para)) return "Não dá para ir para essa fase agora.";
  if (para === "batalha" && estado.turno === 1) return "Ninguém ataca no primeiro turno do duelo.";
  if (para === "final") {
    encerrarTurno(estado, ev);
    return null;
  }
  estado.fase = para;
  ev.push({ t: "fase", j, fase: para });
  return null;
}

function encerrarTurno(estado, ev) {
  const j = estado.vez;
  const p = estado.jogadores[j];
  estado.fase = "final";
  ev.push({ t: "fase", j, fase: "final" });
  if (p.mao.length > LIMITE_MAO) {
    const quantidade = p.mao.length - LIMITE_MAO;
    estado.pendente = {
      tipo: "descarte", jogador: j, candidatos: [...p.mao], min: quantidade, max: quantidade,
      titulo: `Mão cheia: descarte ${quantidade} carta${quantidade > 1 ? "s" : ""}`,
    };
    return;
  }
  passarTurno(estado, ev);
}

function passarTurno(estado, ev) {
  const terminou = estado.vez;
  // Carecas da Luz Reveladora do outro jogador: conta um turno do oponente
  const donoLuz = oponente(terminou);
  estado.jogadores[donoLuz].magias.forEach((m) => {
    if (m && m.face && carta(estado, m.iid).efeito === "luz") {
      m.turnosRestantes--;
      if (m.turnosRestantes <= 0) {
        ev.push({ t: "expirou", j: donoLuz, iid: m.iid });
        removerDoCampo(estado, m.iid, ev, "tempo");
      }
    }
  });

  estado.vez = oponente(terminou);
  estado.turno++;
  const p = estado.jogadores[estado.vez];
  p.invocouNormal = false;
  for (const q of estado.jogadores) q.monstros.forEach((m) => m && (m.atacou = false));
  iniciarTurno(estado, ev);
}

function encerrar(estado, vencedor, motivo, ev) {
  if (estado.vencedor !== null) return;
  estado.vencedor = vencedor;
  estado.motivo = motivo;
  estado.pendente = null;
  ev.push({ t: "fim", vencedor, motivo });
}

// Tempo da ação acabou: resolve o que estiver pendente sozinho e passa o turno
function tempoEsgotado(estado, j, ev) {
  ev.push({ t: "tempo", j });
  let limite = 6;
  while (estado.vencedor === null && quemAge(estado) === j && limite-- > 0) {
    if (estado.pendente) resolverEscolha(estado, j, escolhaAutomatica(estado, estado.pendente), ev);
    else encerrarTurno(estado, ev);
  }
  return null;
}


/* ---------- 10. Escolhas pendentes ---------- */

function resolverEscolha(estado, j, alvos, ev) {
  const pend = estado.pendente;
  if (!pend) return "Não há nada para escolher.";
  const unicos = [...new Set(alvos)];
  if (unicos.length !== alvos.length || alvos.length < pend.min || alvos.length > pend.max) {
    return pend.min === pend.max ? `Escolha ${pend.min} carta${pend.min > 1 ? "s" : ""}.` : `Escolha de ${pend.min} a ${pend.max} cartas.`;
  }
  if (alvos.some((a) => !pend.candidatos.includes(a))) return "Escolha inválida.";
  estado.pendente = null;

  if (pend.tipo === "descarte") {
    const p = estado.jogadores[j];
    for (const iid of alvos) {
      p.mao.splice(p.mao.indexOf(iid), 1);
      p.cemiterio.push(iid);
      ev.push({ t: "descarte", j, iid });
    }
    passarTurno(estado, ev);
    return null;
  }

  if (!alvos.length) return null; // escolheu não fazer nada
  ev.push({ t: "efeito", j, iid: pend.origem, alvos });
  if (pend.efeito === "flip-descartar") {
    for (const alvo of alvos) descartar(estado, oponente(j), alvo, ev);
    return null;
  }
  for (const alvo of alvos) destruir(estado, alvo, ev, "efeito");
  return null;
}

// Escolha feita pelo jogo quando o tempo acaba
export function escolhaAutomatica(estado, pend) {
  const j = pend.jogador;
  if (pend.tipo === "descarte") return pend.candidatos.slice(0, pend.min);
  if (pend.efeito === "flip-descartar") return pend.candidatos.slice(0, 1);
  const doOponente = pend.candidatos.filter((x) => localizar(estado, x).j !== j);
  if (pend.efeito === "tributo-destruir-magias") return doOponente.slice(0, pend.max);
  const alvo = maisForte(estado, doOponente) || pend.candidatos[0];
  return pend.min > 0 || doOponente.length ? [alvo] : [];
}


/* ---------- 11. Opções de cada carta ---------- */

// Lista as ações possíveis para uma carta do jogador j (usada nos menus da tela e pelo bot).
// Cada opção: { id, rotulo, acao, tributos?, alvos?, ataque? }
export function opcoesDaCarta(estado, j, iid) {
  const opcoes = [];
  if (quemAge(estado) !== j || estado.pendente || estado.vez !== j) return opcoes;
  const loc = localizar(estado, iid);
  if (!loc || loc.j !== j) return opcoes;
  const c = carta(estado, iid);
  const p = estado.jogadores[j];
  const principal = ehFasePrincipal(estado);

  if (loc.zona === "mao" && principal) {
    if (c.categoria === "monstro") {
      if (!p.invocouNormal) {
        const n = tributosNecessarios(c.nivel);
        const qtd = monstrosEmCampo(estado, j).length;
        if (qtd >= n && (n > 0 || qtd < ZONAS)) {
          const sufixo = n ? ` (${n} tributo${n > 1 ? "s" : ""})` : "";
          opcoes.push({ id: "invocar", rotulo: "Invocar" + sufixo, acao: { tipo: "invocar", iid, modo: "atk" }, tributos: n });
          opcoes.push({ id: "baixar", rotulo: "Baixar em defesa" + sufixo, acao: { tipo: "invocar", iid, modo: "baixar" }, tributos: n });
        }
      }
      if (podeInvocarPenetra(estado, j, iid)) {
        opcoes.push({ id: "especial", rotulo: "Invocação-Especial (penetra)", acao: { tipo: "invocarEspecial", iid } });
      }
    } else {
      const livre = zonaLivre(p.magias) >= 0;
      if (c.categoria === "magia" && livre) {
        const req = requisitosMagia(estado, j, iid);
        if (req) opcoes.push({ id: "ativar", rotulo: "Ativar", acao: { tipo: "ativar", iid }, alvos: req.alvos });
      }
      if (livre) {
        const rotulo = c.categoria === "armadilha" ? "Baixar (ativa sozinha)" : "Baixar virada";
        opcoes.push({ id: "baixar", rotulo, acao: { tipo: "baixarMagia", iid } });
      }
    }
  }

  if (loc.zona === "monstros") {
    const m = loc.obj;
    if (podeAtacar(estado, j, loc.slot)) {
      const o = estado.jogadores[oponente(j)];
      const alvos = o.monstros.map((x, s) => (x ? s : null)).filter((s) => s !== null);
      opcoes.push({ id: "atacar", rotulo: "Atacar", acao: { tipo: "atacar", slot: loc.slot }, ataque: { alvos, direto: alvos.length === 0 } });
    }
    if (principal && !m.face && m.turnoEntrou < estado.turno && m.mudouPos !== estado.turno) {
      opcoes.push({ id: "virar", rotulo: "Virar (Invocação-Flip)", acao: { tipo: "virar", slot: loc.slot } });
    }
    if (principal && m.face && m.turnoEntrou < estado.turno && m.mudouPos !== estado.turno && !m.atacou) {
      const rotulo = m.pos === "atk" ? "Mudar para Defesa" : "Mudar para Ataque";
      opcoes.push({ id: "posicao", rotulo, acao: { tipo: "mudarPosicao", slot: loc.slot } });
    }
  }

  if (loc.zona === "magias" && principal && !loc.obj.face && c.categoria === "magia") {
    const podeRapida = c.subtipo !== "rapida" || loc.obj.turnoBaixada < estado.turno;
    const req = requisitosMagia(estado, j, iid);
    if (podeRapida && req) opcoes.push({ id: "ativar", rotulo: "Ativar", acao: { tipo: "ativar", iid }, alvos: req.alvos });
  }

  return opcoes;
}
