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

// "Versão" das cartas: muda sempre que uma carta entra, sai ou muda de efeito/nível/ATK/DEF.
// Os dois jogadores precisam da mesma versão para duelar.
export function versaoDasCartas(lista = Object.values(CARTAS)) {
  let h = 2166136261;
  for (const c of [...lista].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const ch of `${c.id}|${c.efeito}|${c.nivel}|${c.atk}|${c.def}|${c.limite ?? ""};`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  }
  return (h >>> 0).toString(36);
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

// Quantas cópias a carta pode ter no deck (cartas fortes são limitadas a 1 ou 2; 0 = banida)
export const limiteDaCarta = (id) => Math.min(MAX_COPIAS, CARTAS[id]?.limite ?? MAX_COPIAS);

// Cópias acima do limite: [{ id, nome, sobra }]
export function excessoDeLimite(lista) {
  const contagem = {};
  for (const id of lista) contagem[id] = (contagem[id] || 0) + 1;
  return Object.entries(contagem)
    .filter(([id, n]) => CARTAS[id] && n > limiteDaCarta(id))
    .map(([id, n]) => ({ id, nome: CARTAS[id].nome, sobra: n - limiteDaCarta(id) }));
}

// Na hora do duelo, as cópias acima do limite (ou banidas) viram Careca Feijão
// (mesmo que passe de 3 Feijões no deck)
export function ajustarAoLimite(lista) {
  const usadas = {};
  let trocadas = 0;
  const ajustada = lista.map((id) => {
    usadas[id] = (usadas[id] || 0) + 1;
    if (usadas[id] > limiteDaCarta(id)) {
      trocadas++;
      return "careca-feijao";
    }
    return id;
  });
  return { lista: ajustada, trocadas };
}

// Explica por que um deck (lista de ids) não vale, ou devolve null se estiver ok.
// comLimite = false: não olha os limites de cópias (no duelo as sobras viram Careca Feijão)
export function problemaDoDeck(lista, { comLimite = true } = {}) {
  if (!Array.isArray(lista)) return "Deck inválido.";
  if (lista.length < DECK_MIN) return `O deck precisa ter pelo menos ${DECK_MIN} cartas.`;
  if (lista.length > DECK_MAX) return `O deck pode ter no máximo ${DECK_MAX} cartas.`;
  const contagem = {};
  for (const id of lista) {
    if (!CARTAS[id]) return "O deck tem uma carta que não existe.";
    contagem[id] = (contagem[id] || 0) + 1;
    if (contagem[id] > MAX_COPIAS) return `No máximo ${MAX_COPIAS} cópias de "${CARTAS[id].nome}".`;
    if (comLimite && contagem[id] > limiteDaCarta(id)) return `No máximo ${limiteDaCarta(id)} cópia${limiteDaCarta(id) > 1 ? "s" : ""} de "${CARTAS[id].nome}".`;
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

  const ajustes = [];
  jogadores.forEach((info, j) => {
    const prefixo = j === 0 ? "a" : "b";
    const { lista: deckBase, trocadas } = ajustarAoLimite(info.deck && !problemaDoDeck(info.deck, { comLimite: false }) ? info.deck : montarDeck());
    if (trocadas) ajustes.push({ t: "ajusteDeck", j, trocadas });
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
      campo: null,
      invocouNormal: false,
    });
  });

  const eventos = [...ajustes];
  estado.vez = sorteio() < 0.5 ? 0 : 1;
  eventos.push({ t: "inicio", j: estado.vez });
  for (const j of [0, 1]) comprar(estado, j, MAO_INICIAL, eventos, true);
  iniciarTurno(estado, eventos);
  registrarHistorico(estado, eventos);
  return { estado, eventos };
}


/* ---------- 2b. Tag da Zoeira 2vs2 ---------- */

// Mesmas regras do Tag Duel: cada lado é um TIME (campo, cemitério e PV compartilhados) e cada
// membro tem o próprio deck e a própria mão. Ordem dos turnos: P1 (time 0), P2 (time 1), P3 (time 0),
// P4 (time 1). O "controlador inimigo atual" é sempre o membro do outro time que jogou por último.
//
// Para o motor, cada time é um "jogador" comum: o membro da vez fica em deck/mao e o outro
// fica guardado em "reserva". Assim nenhuma regra do 1vs1 precisou mudar.
export const ehTag = (estado) => estado.modo === "tag";

// Membro (0 ou 1) que está jogando pelo time j
export const membroAtivo = (estado, j) => estado.jogadores[j].ativo || 0;

// jogadores: [P1, P2, P3, P4] (P1 e P3 = time 0; P2 e P4 = time 1)
export function novoDueloTag({ id, jogadores, semente = Date.now() }) {
  const sorteio = criarSorteio(semente);
  const estado = {
    versao: 1, id, modo: "tag", seq: 0, turno: 1, vez: 0, fase: "compra", tempoAcao: TEMPO_ACAO,
    jogadores: [], cartas: {}, pendente: null, vencedor: null, motivo: null, historico: [],
  };
  const times = [[jogadores[0], jogadores[2]], [jogadores[1], jogadores[3]]];
  const prefixos = [["a", "c"], ["b", "d"]];
  const ajustes = [];

  times.forEach((membros, j) => {
    const decks = membros.map((info, k) => {
      const { lista, trocadas } = ajustarAoLimite(info.deck && !problemaDoDeck(info.deck, { comLimite: false }) ? info.deck : montarDeck());
      if (trocadas) ajustes.push({ t: "ajusteDeck", j, trocadas, nick: info.nick });
      return embaralhar(lista.map((idCarta, n) => {
        const iid = prefixos[j][k] + n;
        estado.cartas[iid] = idCarta;
        return iid;
      }), sorteio);
    });
    const cartoes = membros.map((info) => ({ chave: info.chave, nick: info.nick, tag: info.tag || "", avatar: info.avatar || "", nivel: info.nivel || 1 }));
    // mão inicial do membro que espera
    const maoReserva = decks[1].splice(-MAO_INICIAL).reverse();
    estado.jogadores.push({
      ...cartoes[0],
      chave: `time-${j}`,
      bot: false,
      pl: PL_INICIAL,
      deck: decks[0],
      mao: [],
      cemiterio: [],
      monstros: Array(ZONAS).fill(null),
      magias: Array(ZONAS).fill(null),
      campo: null,
      invocouNormal: false,
      membros: cartoes,
      ativo: 0,
      reserva: { deck: decks[1], mao: maoReserva },
      turnosJogados: 0,
    });
  });

  const eventos = [...ajustes];
  estado.vez = 0; // P1 começa
  estado.jogadores[0].turnosJogados = 1;
  eventos.push({ t: "inicio", j: 0 });
  for (const j of [0, 1]) comprar(estado, j, MAO_INICIAL, eventos, true);
  iniciarTurno(estado, eventos);
  registrarHistorico(estado, eventos);
  return { estado, eventos };
}

// Começo do turno de um time: a partir do 2º turno dele, entra o outro membro
function proximoMembro(estado, j, ev) {
  const p = estado.jogadores[j];
  if (p.turnosJogados > 0) {
    [p.deck, p.reserva.deck] = [p.reserva.deck, p.deck];
    [p.mao, p.reserva.mao] = [p.reserva.mao, p.mao];
    p.ativo = 1 - p.ativo;
    Object.assign(p, { nick: p.membros[p.ativo].nick, tag: p.membros[p.ativo].tag, avatar: p.membros[p.ativo].avatar, nivel: p.membros[p.ativo].nivel });
    ev.push({ t: "troca", j, nick: p.nick });
  }
  p.turnosJogados++;
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
    if (p.campo && p.campo.iid === iid) return { j, zona: "campo", slot: 0, obj: p.campo };
    for (const zona of ["mao", "cemiterio", "deck"]) {
      const slot = p[zona].indexOf(iid);
      if (slot >= 0) return { j, zona, slot, obj: null };
    }
  }
  return null;
}

function noCampo(estado, iid) {
  const loc = localizar(estado, iid);
  return Boolean(loc && (loc.zona === "monstros" || loc.zona === "magias" || loc.zona === "campo"));
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
  const loc = localizar(estado, iid);
  if (loc && loc.zona === "monstros" && loc.obj.marcadores) atk += 300 * loc.obj.marcadores;
  if (c.tipo === "Besta Alada" && loc && loc.zona === "monstros") atk += 200 * zoologicosAtivos(estado);
  if (c.efeito === "wellington-animal" && loc && loc.zona === "monstros") {
    const ventos = estado.jogadores[loc.j].monstros.filter((m) => m && m.face && carta(estado, m.iid).atributo === "VENTO").length;
    atk += 500 * ventos;
  }
  if (c.atributo === "VENTO" && loc && loc.zona === "monstros") {
    const davids = estado.jogadores.flatMap((p) => p.monstros).filter((m) => m && m.face && carta(estado, m.iid).efeito === "david").length;
    atk += 300 * davids;
  }
  for (const p of estado.jogadores) {
    for (const m of p.magias) {
      if (m && m.face && m.equipadoEm === iid && carta(estado, m.iid).efeito === "gole") atk *= 2;
    }
  }
  return atk;
}

// "Animal": cartas cujo nome é tratado como "Animal" (David, Davi, Thales, George, Miro...)
export const ehAnimal = (c) => Boolean(c && c.categoria === "monstro" && c.nome.includes("Animal"));
const ehVentoBestaAlada = (c) => c.categoria === "monstro" && c.atributo === "VENTO" && c.tipo === "Besta Alada";

// Efeitos "uma vez por turno" de cada jogador
const usou = (estado, j, chave) => (estado.jogadores[j].usos || {})[chave] === estado.turno;
function marcarUso(estado, j, chave) {
  (estado.jogadores[j].usos ||= {})[chave] = estado.turno;
}

// Cartas "gelo": atributo GELO ou "Gelo" no nome (Pote do Gelo)
const ehMonstroGelo = (c) => c.categoria === "monstro" && c.atributo === "GELO";
const ehCartaGelo = (c) => c.atributo === "GELO" || c.nome.toLowerCase().includes("gelo");

export function defAtual(estado, iid) {
  const c = carta(estado, iid);
  const loc = localizar(estado, iid);
  let def = c.def;
  if (c.tipo === "Besta Alada" && loc && loc.zona === "monstros") def += 200 * zoologicosAtivos(estado);
  return def;
}

// Quantos "Zoológico Animal" com a face para cima existem no campo (dos dois lados)
function zoologicosAtivos(estado) {
  return estado.jogadores.flatMap((p) => [...p.magias, p.campo]).filter((m) => m && m.face && carta(estado, m.iid).efeito === "zoologico").length;
}

// Zoológico Animal: um "Animal" foi Invocado (Normal ou Especial) -> quem invocou pode destruir 1 Magia/Armadilha
function gatilhoZoologico(estado, j, iid) {
  if (!ehAnimal(carta(estado, iid)) || localizar(estado, iid)?.zona !== "monstros") return;
  for (let k = 0; k < zoologicosAtivos(estado); k++) {
    (estado.gatilhos ||= []).push({ tipo: "zoologico", j, iid, turno: estado.turno });
  }
}

// Irmãos Animal que já entraram direito (pela Egoísmo Puro) podem voltar por outros efeitos
const liberado = (estado, iid) => (estado.liberadas || []).includes(iid);

// Monstros no campo (iids), de um jogador ou dos dois
export function monstrosEmCampo(estado, j = null) {
  const lados = j === null ? [0, 1] : [j];
  return lados.flatMap((q) => estado.jogadores[q].monstros.filter(Boolean).map((m) => m.iid));
}

// Magias/Armadilhas no campo (iids)
export function magiasEmCampo(estado, j = null) {
  const lados = j === null ? [0, 1] : [j];
  return lados.flatMap((q) => [...estado.jogadores[q].magias, estado.jogadores[q].campo].filter(Boolean).map((m) => m.iid));
}

// "Carecas da Luz Reveladora" ativa no lado do jogador j?
export function luzAtiva(estado, j) {
  return estado.jogadores[j].magias.some((m) => m && m.face && carta(estado, m.iid).efeito === "luz");
}

const zonaLivre = (lista) => lista.findIndex((m) => !m);

// Dono da carta (quem trouxe ela no deck): "a"/"c" = lado 0, "b"/"d" = lado 1.
// O controle de um monstro pode mudar (Controle Carecal), mas Cemitério, mão e banidas são sempre do dono.
export const donoDe = (iid) => ("ac".includes(iid[0]) ? 0 : 1);

// Jinreca com a face para cima no campo (de qualquer lado): nenhuma Armadilha pode ser ativada
export const jinrecaEmCampo = (estado) =>
  estado.jogadores.some((p) => p.monstros.some((m) => m && m.face && carta(estado, m.iid).efeito === "jinreca"));


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
  const erro = executarAcao(estado, j, acao, ev);
  if (!erro) processarGatilhos(estado, ev);
  return erro;
}

function executarAcao(estado, j, acao, ev) {
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
    case "invocarEspecial": {
      const ef = carta(estado, acao.iid)?.efeito;
      if (ef === "gelo-careca") return invocarGeloCareca(estado, j, acao, ev);
      if (ef === "george") return invocarGeorge(estado, j, acao, ev);
      if (ef === "big-animal") return invocarBig(estado, j, acao, ev);
      return invocarPenetra(estado, j, acao, ev);
    }
    case "efeitoMonstro": return efeitoMonstro(estado, j, acao, ev);
    case "efeitoMao": return efeitoMao(estado, j, acao, ev);
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
  if (c.somenteEspecial) return `"${c.nome}" não pode ser Invocado por Invocação-Normal nem Baixado.`;
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
  aposEspecial(estado, j, iid, ev);
  return null;
}

// Manoel do Gelo Careca: descarta 2 outros monstros GELO da mão e entra por Invocação-Especial
export function requisitosGeloCareca(estado, j, iid) {
  const p = estado.jogadores[j];
  if (!ehFasePrincipal(estado) || !p.mao.includes(iid) || zonaLivre(p.monstros) < 0) return null;
  const candidatos = p.mao.filter((x) => x !== iid && ehMonstroGelo(carta(estado, x)));
  if (candidatos.length < 2) return null;
  return { candidatos, min: 2, max: 2, titulo: `${carta(estado, iid).nome}: descarte 2 monstros GELO` };
}

function invocarGeloCareca(estado, j, { iid, alvos = [] }, ev) {
  const req = requisitosGeloCareca(estado, j, iid);
  if (!req) return "Precisa de 2 outros monstros GELO na mão e uma zona de monstro livre.";
  if (new Set(alvos).size !== 2 || alvos.length !== 2 || alvos.some((a) => !req.candidatos.includes(a))) return "Escolha 2 monstros GELO para descartar.";
  const p = estado.jogadores[j];
  for (const a of alvos) descartar(estado, j, a, ev);
  p.mao.splice(p.mao.indexOf(iid), 1);
  const slot = zonaLivre(p.monstros);
  p.monstros[slot] = { iid, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
  ev.push({ t: "invocacao", j, iid, modo: "especial", slot });
  aposEspecial(estado, j, iid, ev);
  return null;
}

function aposEspecial(estado, j, iid, ev) {
  verificarArmadilhas(estado, "invocacao", { j, iid, modo: "especial" }, ev);
  if (estado.vencedor !== null) return;
  if (carta(estado, iid).efeito === "thales") gatilhoThales(estado, j, iid);
  if (carta(estado, iid).efeito === "big-animal") marcarBigMP2(estado, j, iid);
  gatilhoZoologico(estado, j, iid);
}

// Big Animal: ao ser Invocado, na Fase Principal 2 deste turno pode recuperar do Cemitério
// 1 Magia/Armadilha que mencione "Irmãos Animal"
function marcarBigMP2(estado, j, iid) {
  if (usou(estado, j, "big-busca")) return;
  marcarUso(estado, j, "big-busca");
  estado.jogadores[j].bigMP2 = { turno: estado.turno, iid };
}

// Big Animal: Invocação-Especial da mão se você controla um "Animal" de Nível 5 ou mais
export function podeInvocarBig(estado, j, iid) {
  const p = estado.jogadores[j];
  return (
    ehFasePrincipal(estado) &&
    p.mao.includes(iid) &&
    carta(estado, iid).efeito === "big-animal" &&
    !usou(estado, j, "big-especial") &&
    zonaLivre(p.monstros) >= 0 &&
    p.monstros.some((m) => m && m.face && ehAnimal(carta(estado, m.iid)) && carta(estado, m.iid).nivel >= 5)
  );
}

function invocarBig(estado, j, { iid }, ev) {
  if (!podeInvocarBig(estado, j, iid)) return "O Big só entra se você controlar um \"Animal\" de Nível 5 ou mais (1 vez por turno).";
  marcarUso(estado, j, "big-especial");
  const p = estado.jogadores[j];
  p.mao.splice(p.mao.indexOf(iid), 1);
  const slot = zonaLivre(p.monstros);
  p.monstros[slot] = { iid, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
  ev.push({ t: "invocacao", j, iid, modo: "especial", slot });
  aposEspecial(estado, j, iid, ev);
  return null;
}

// Coloca um monstro da mão em campo por Invocação-Normal extra (efeito do Midas Animal)
function invocacaoNormalExtra(estado, j, iid, ev) {
  const p = estado.jogadores[j];
  const slot = zonaLivre(p.monstros);
  if (slot < 0 || !p.mao.includes(iid)) return;
  p.mao.splice(p.mao.indexOf(iid), 1);
  p.monstros[slot] = { iid, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
  ev.push({ t: "invocacao", j, iid, modo: "normal", slot });
  aposInvocar(estado, j, iid, "normal", ev);
}

// Monstro do deck por Invocação-Especial em Defesa com a face para cima (efeito do John Animal)
function especialDoDeck(estado, j, iid, ev) {
  const p = estado.jogadores[j];
  const slot = zonaLivre(p.monstros);
  const i = p.deck.indexOf(iid);
  if (slot < 0 || i < 0) return;
  p.deck.splice(i, 1);
  p.monstros[slot] = { iid, pos: "def", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
  ev.push({ t: "invocacao", j, iid, modo: "especial", slot });
  embaralhar(p.deck, sorteioDoEstado(estado));
  aposEspecial(estado, j, iid, ev);
}

// Monstros "Animal" do deck que o John pode chamar
const alvosDoJohn = (estado, j) => {
  const vistos = new Set();
  return estado.jogadores[j].deck.filter((x) => {
    const c = carta(estado, x);
    if (!ehAnimal(c) || c.id === "john-animal" || c.somenteEspecial || vistos.has(c.id)) return false;
    vistos.add(c.id);
    return true;
  });
};

// "Zoológico Animal" no deck (busca do Miqueas Animal)
const ehAnimalZoologico = (c) => c.id === "zoologico-animal";

// George Animal: Invocação-Especial da mão em defesa se você controla um monstro de VENTO de Nível 6 ou menos
export function podeInvocarGeorge(estado, j, iid) {
  const p = estado.jogadores[j];
  return (
    ehFasePrincipal(estado) &&
    p.mao.includes(iid) &&
    carta(estado, iid).efeito === "george" &&
    !usou(estado, j, "george-especial") &&
    zonaLivre(p.monstros) >= 0 &&
    p.monstros.some((m) => m && m.face && carta(estado, m.iid).atributo === "VENTO" && carta(estado, m.iid).nivel <= 6)
  );
}

function invocarGeorge(estado, j, { iid }, ev) {
  if (!podeInvocarGeorge(estado, j, iid)) return "O George só entra se você controlar um monstro de VENTO de Nível 6 ou menos (1 vez por turno).";
  marcarUso(estado, j, "george-especial");
  const p = estado.jogadores[j];
  p.mao.splice(p.mao.indexOf(iid), 1);
  const slot = zonaLivre(p.monstros);
  p.monstros[slot] = { iid, pos: "def", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
  ev.push({ t: "invocacao", j, iid, modo: "especial", slot });
  aposEspecial(estado, j, iid, ev);
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

  if ((modo === "normal" || modo === "tributo") && c.efeito === "davi" && !usou(estado, j, "davi-devolver")) {
    const loc = localizar(estado, iid);
    const meus = estado.jogadores[j].monstros.filter((m) => m && m.face && m.iid !== iid && carta(estado, m.iid).tipo === "Besta Alada").map((m) => m.iid);
    const deles = estado.jogadores[oponente(j)].monstros.filter((m) => m && m.face).map((m) => m.iid);
    if (loc && loc.zona === "monstros" && meus.length && deles.length) {
      estado.pendente = {
        tipo: "alvo", efeito: "davi", jogador: j, origem: iid, candidatos: [...meus, ...deles], min: 0, max: 2,
        titulo: `${c.nome}: escolha 1 Besta Alada sua e 1 monstro do oponente para voltarem para a mão (ou nenhum)`,
      };
    }
  }
  if ((modo === "normal" || modo === "tributo") && c.efeito === "thales") gatilhoThales(estado, j, iid);
  if ((modo === "normal" || modo === "tributo") && c.efeito === "big-animal") marcarBigMP2(estado, j, iid);
  if ((modo === "normal" || modo === "tributo") && localizar(estado, iid)?.zona === "monstros") gatilhoZoologico(estado, j, iid);

  if ((modo === "normal" || modo === "tributo") && c.efeito === "wellington") {
    const loc = localizar(estado, iid);
    if (loc && loc.zona === "monstros") {
      loc.obj.marcadores = 1;
      ev.push({ t: "marcador", j, iid });
    }
  }
  if (["normal", "tributo", "flip"].includes(modo) && c.efeito === "mestre-laminas") {
    const candidatos = magiasEmCampo(estado);
    if (candidatos.length) {
      estado.pendente = {
        tipo: "alvo", efeito: c.efeito, jogador: j, origem: iid, candidatos, min: 0, max: 1,
        titulo: `${c.nome}: você pode destruir 1 Magia/Armadilha`,
      };
    }
    return;
  }

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
    case "flip-buscar-magia": {
      const magias = estado.jogadores[dono].deck.filter((x) => carta(estado, x).categoria === "magia");
      if (!magias.length) break;
      if (manual) {
        const vistos = new Set();
        const candidatos = magias.filter((x) => !vistos.has(estado.cartas[x]) && vistos.add(estado.cartas[x]));
        estado.pendente = {
          tipo: "alvo", efeito: c.efeito, jogador: dono, origem: iid, candidatos, min: 1, max: 1,
          titulo: `${c.nome} (VIRE): escolha 1 Magia do seu deck para a sua mão`,
        };
        break;
      }
      ev.push({ t: "efeito", j: dono, iid });
      buscar(estado, dono, magias[Math.floor(sorteioDoEstado(estado)() * magias.length)], ev);
      break;
    }
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

// Carta do deck para a mão (e o deck é embaralhado de novo)
function buscar(estado, j, iid, ev) {
  const p = estado.jogadores[j];
  const i = p.deck.indexOf(iid);
  if (i < 0) return;
  p.deck.splice(i, 1);
  p.mao.push(iid);
  ev.push({ t: "busca", j, iid });
  embaralhar(p.deck, sorteioDoEstado(estado));
}

function descartar(estado, j, iid, ev) {
  const p = estado.jogadores[j];
  const i = p.mao.indexOf(iid);
  if (i < 0) return;
  p.mao.splice(i, 1);
  p.cemiterio.push(iid);
  ev.push({ t: "descarte", j, iid });
  chegouAoCemiterio(estado, j, iid, ev);
}

// George Animal saiu do campo para o Cemitério: manda 1 VENTO Besta Alada sorteado do deck para o Cemitério
function georgeNoCemiterio(estado, j, iid, ev) {
  if (usou(estado, j, "george-cemiterio")) return;
  const p = estado.jogadores[j];
  const opcoes = p.deck.filter((x) => ehVentoBestaAlada(carta(estado, x)));
  if (!opcoes.length) return;
  marcarUso(estado, j, "george-cemiterio");
  const escolhido = opcoes[Math.floor(sorteioDoEstado(estado)() * opcoes.length)];
  p.deck.splice(p.deck.indexOf(escolhido), 1);
  p.cemiterio.push(escolhido);
  ev.push({ t: "efeito", j, iid });
  ev.push({ t: "aoCemiterio", j, iid: escolhido });
  chegouAoCemiterio(estado, j, escolhido, ev);
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
    case "lamento": {
      const candidatos = p.cemiterio.filter((x) => carta(estado, x).categoria === "monstro" && (!carta(estado, x).somenteEspecial || liberado(estado, x)));
      if (!candidatos.length || zonaLivre(p.monstros) < 0 || p.pl <= 800) return null;
      return { alvos: { candidatos, min: 1, max: 1, titulo: "Lamento Prematuro (paga 800 PV): escolha o monstro do seu Cemitério que volta" } };
    }
    case "gole": {
      const candidatos = [0, 1].flatMap((q) => estado.jogadores[q].monstros.filter((m) => m && m.face).map((m) => m.iid));
      return candidatos.length
        ? { alvos: { candidatos, min: 1, max: 1, titulo: "O Último Gole: o monstro escolhido dobra o ATK e é destruído no fim do turno" } }
        : null;
    }
    case "egoismo": {
      const temAnimal = estado.jogadores.some((q) => q.monstros.some((m) => m && m.face && ehAnimal(carta(estado, m.iid))));
      if (!temAnimal || zonaLivre(p.monstros) < 0) return null;
      const vistos = new Set();
      const candidatos = [...p.mao, ...p.deck].filter((x) => {
        const m = carta(estado, x);
        if (!ehAnimal(m)) return false;
        const chave = (p.mao.includes(x) ? "mao:" : "deck:") + m.id;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
      return candidatos.length
        ? { alvos: { candidatos, min: 1, max: 1, titulo: "Egoísmo Puro: escolha o \"Animal\" (ou Irmãos Animal) da mão ou do deck que entra" } }
        : null;
    }
    case "zoologico":
      return { alvos: null };
    case "controle": {
      const candidatos = estado.jogadores[oponente(j)].monstros.filter((m) => m && m.face).map((m) => m.iid);
      if (!candidatos.length || zonaLivre(p.monstros) < 0 || p.pl <= 800) return null;
      return { alvos: { candidatos, min: 1, max: 1, titulo: "Controle Carecal (paga 800 PV): escolha o monstro do oponente que vem para o seu lado até a Fase Final" } };
    }
    case "menino": {
      if (monstrosEmCampo(estado, j).length || zonaLivre(p.monstros) < 0) return null;
      const vistos = new Set();
      const candidatos = p.deck.filter((x) => {
        const m = carta(estado, x);
        if (m.categoria !== "monstro" || m.subtipo !== "normal" || m.nivel > 4 || vistos.has(m.id)) return false;
        vistos.add(m.id);
        return true;
      });
      return candidatos.length
        ? { alvos: { candidatos, min: 1, max: 1, titulo: "Menino Mentiroso: escolha o Monstro Normal de Nível 4 ou menos do deck que entra" } }
        : null;
    }
    case "upstart":
      return p.deck.length ? { alvos: null } : null;
    case "mil-facas": {
      const temMestre = p.monstros.some((m) => m && m.face && ["grande-mestre", "grande-mestre-do-caos"].includes(estado.cartas[m.iid]));
      return temMestre && monstrosEmCampo(estado, oponente(j)).length ? { alvos: null } : null;
    }
    case "pote-gelo": {
      const candidatos = p.mao.filter((x) => x !== iid && ehCartaGelo(carta(estado, x)));
      return candidatos.length >= 2
        ? { alvos: { candidatos, min: 2, max: 2, titulo: "Pote do Gelo: escolha 2 cartas \"gelo\" da mão para voltar ao deck" } }
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
  const doCampo = loc && loc.j === j && (loc.zona === "magias" || loc.zona === "campo") && !loc.obj.face;
  if (!daMao && !doCampo) return "Essa carta não pode ser ativada agora.";
  if (doCampo && c.subtipo === "rapida" && loc.obj.turnoBaixada >= estado.turno) {
    return "Magia Rápida baixada só pode ser ativada a partir do próximo turno.";
  }
  if (daMao && c.subtipo !== "campo" && zonaLivre(p.magias) < 0) return "Não há zona de Magia/Armadilha livre.";

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
  if (daMao && c.subtipo === "campo") {
    p.mao.splice(p.mao.indexOf(iid), 1);
    trocarCampo(estado, j, ev);
    obj = { iid, face: true, turnoBaixada: estado.turno };
    p.campo = obj;
  } else if (daMao) {
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
      aposEspecial(estado, j, alvo, ev);
      break;
    }
    case "lamento": {
      const alvo = alvos[0];
      p.pl = Math.max(0, p.pl - 800);
      ev.push({ t: "custo", j, valor: 800, pl: p.pl });
      p.cemiterio.splice(p.cemiterio.indexOf(alvo), 1);
      const slot = zonaLivre(p.monstros);
      p.monstros[slot] = { iid: alvo, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
      ev.push({ t: "invocacao", j, iid: alvo, modo: "especial", slot });
      obj.equipadoEm = alvo;
      ev.push({ t: "equipada", j, iid, alvo });
      aposEspecial(estado, j, alvo, ev);
      break;
    }
    case "gole":
      obj.equipadoEm = alvos[0];
      ev.push({ t: "equipada", j, iid, alvo: alvos[0] });
      break;
    case "egoismo": {
      const alvo = alvos[0];
      const doDeck = p.deck.includes(alvo);
      (doDeck ? p.deck : p.mao).splice((doDeck ? p.deck : p.mao).indexOf(alvo), 1);
      if (doDeck) embaralhar(p.deck, sorteioDoEstado(estado));
      const slot = zonaLivre(p.monstros);
      p.monstros[slot] = { iid: alvo, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
      if (carta(estado, alvo).somenteEspecial) (estado.liberadas ||= []).push(alvo);
      ev.push({ t: "invocacao", j, iid: alvo, modo: "especial", slot });
      mandarProCemiterio(estado, iid, ev);
      aposEspecial(estado, j, alvo, ev);
      break;
    }
    case "zoologico":
      break; // fica na Zona de Campo; os efeitos são contínuos
    case "controle":
      p.pl = Math.max(0, p.pl - 800);
      ev.push({ t: "custo", j, valor: 800, pl: p.pl });
      tomarControle(estado, j, alvos[0], ev);
      mandarProCemiterio(estado, iid, ev);
      break;
    case "menino": {
      const alvo = alvos[0];
      p.deck.splice(p.deck.indexOf(alvo), 1);
      embaralhar(p.deck, sorteioDoEstado(estado));
      const slot = zonaLivre(p.monstros);
      p.monstros[slot] = { iid: alvo, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
      ev.push({ t: "invocacao", j, iid: alvo, modo: "especial", slot });
      mandarProCemiterio(estado, iid, ev);
      aposEspecial(estado, j, alvo, ev);
      break;
    }
    case "upstart": {
      comprar(estado, j, 1, ev);
      const o = estado.jogadores[oponente(j)];
      o.pl += 1000;
      ev.push({ t: "ganhoPV", j: oponente(j), valor: 1000, pl: o.pl });
      mandarProCemiterio(estado, iid, ev);
      break;
    }
    case "mil-facas":
      for (const alvo of monstrosEmCampo(estado, oponente(j))) destruir(estado, alvo, ev, "efeito");
      mandarProCemiterio(estado, iid, ev);
      break;
    case "pote-gelo":
      for (const alvo of alvos) {
        p.mao.splice(p.mao.indexOf(alvo), 1);
        p.deck.push(alvo);
        ev.push({ t: "aoDeck", j, iid: alvo });
      }
      embaralhar(p.deck, sorteioDoEstado(estado));
      comprar(estado, j, Math.min(3, p.deck.length), ev);
      mandarProCemiterio(estado, iid, ev);
      break;
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

// Controle Carecal: o monstro do oponente vem para o lado de j até a Fase Final
function tomarControle(estado, j, iid, ev) {
  const loc = localizar(estado, iid);
  const p = estado.jogadores[j];
  const slot = zonaLivre(p.monstros);
  if (!loc || loc.zona !== "monstros" || loc.j === j || slot < 0) return;
  estado.jogadores[loc.j].monstros[loc.slot] = null;
  loc.obj.emprestado = { de: loc.j, turno: estado.turno };
  p.monstros[slot] = loc.obj;
  ev.push({ t: "controle", j, iid, slot });
}

// Fase Final: o monstro emprestado volta para quem o controlava (sem zona livre, vai para o Cemitério do dono)
function devolverControle(estado, q, s, ev) {
  const m = estado.jogadores[q].monstros[s];
  const volta = m.emprestado.de;
  delete m.emprestado;
  const slot = zonaLivre(estado.jogadores[volta].monstros);
  if (slot < 0) {
    ev.push({ t: "controleVolta", j: volta, iid: m.iid, semZona: true });
    removerDoCampo(estado, m.iid, ev, "regra");
    return;
  }
  estado.jogadores[q].monstros[s] = null;
  estado.jogadores[volta].monstros[slot] = m;
  ev.push({ t: "controleVolta", j: volta, iid: m.iid, slot });
}

// Cada jogador tem 1 Zona de Campo: um campo novo manda o antigo para o Cemitério
function trocarCampo(estado, j, ev) {
  const atual = estado.jogadores[j].campo;
  if (atual) {
    removerDoCampo(estado, atual.iid, ev, "substituida");
    ev.push({ t: "resolvida", iid: atual.iid });
  }
}

function baixarMagia(estado, j, { iid }, ev) {
  const p = estado.jogadores[j];
  if (!ehFasePrincipal(estado)) return "Só dá para baixar cartas nas Fases Principais.";
  if (!p.mao.includes(iid)) return "Essa carta não está na sua mão.";
  const c = carta(estado, iid);
  if (c.categoria === "monstro") return "Monstros são baixados pela opção Baixar do monstro.";
  if (c.subtipo === "campo") {
    p.mao.splice(p.mao.indexOf(iid), 1);
    trocarCampo(estado, j, ev);
    p.campo = { iid, face: false, turnoBaixada: estado.turno };
    ev.push({ t: "baixada", j, iid, zona: "campo", slot: 0 });
    return null;
  }
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
  if (jinrecaEmCampo(estado)) return false;
  const defensor = oponente(dados.j);
  const p = estado.jogadores[defensor];
  for (let s = 0; s < ZONAS; s++) {
    const m = p.magias[s];
    if (!m || m.face || m.turnoBaixada >= estado.turno) continue; // só a partir do turno seguinte
    const c = carta(estado, m.iid);
    if (c.categoria !== "armadilha") continue;

    if (gatilho === "invocacao" && c.efeito === "adm-ditador") {
      const loc = localizar(estado, dados.iid);
      if (!loc || loc.zona !== "monstros") continue;
      if (atkAtual(estado, dados.iid) < 1500) continue;
      m.face = true;
      ev.push({ t: "armadilha", j: defensor, iid: m.iid, alvo: dados.iid });
      banir(estado, dados.iid, ev);
      mandarProCemiterio(estado, m.iid, ev);
      return true;
    }

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

    if (gatilho === "ataque" && c.efeito === "sai-daqui") {
      if (!noCampo(estado, dados.iid)) continue;
      m.face = true;
      ev.push({ t: "armadilha", j: defensor, iid: m.iid, alvo: dados.iid });
      devolverParaMao(estado, dados.iid, ev);
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


/* ---------- Gatilhos em fila (Animal) ---------- */

// Efeitos "você pode..." que disparam no meio de outra coisa entram numa fila e só
// resolvem quando não há outra escolha aberta (assim um não atropela o outro).
function gatilhoThales(estado, j, iid) {
  if (usou(estado, j, "thales")) return;
  marcarUso(estado, j, "thales");
  (estado.gatilhos ||= []).push({ tipo: "thales", j, iid, turno: estado.turno });
}

function chegouAoCemiterio(estado, j, iid, ev) {
  const c = carta(estado, iid);
  if (c.efeito === "davi" && !usou(estado, j, "davi-cemiterio")) {
    marcarUso(estado, j, "davi-cemiterio");
    (estado.gatilhos ||= []).push({ tipo: "davi-cemiterio", j, iid, turno: estado.turno });
  }
}

const cartasIrmaos = (estado, j) => estado.jogadores[j].deck.filter((x) => carta(estado, x).mencionaIrmaos);

function processarGatilhos(estado, ev) {
  let limite = 10;
  while (estado.vencedor === null && !estado.pendente && (estado.gatilhos || []).length && limite-- > 0) {
    const g = estado.gatilhos.shift();
    if (g.turno !== estado.turno) continue; // o turno acabou: perdeu a chance
    const c = carta(estado, g.iid);
    const dono = g.j;
    const meuTurno = estado.vez === dono;
    let candidatos = [];
    let max = 1;
    let titulo = "";
    if (g.tipo === "davi-cemiterio") {
      candidatos = estado.jogadores[dono].deck.filter((x) => {
        const m = carta(estado, x);
        return m.categoria === "monstro" && m.tipo === "Besta Alada" && m.nivel === 4 && m.atk <= 1500;
      });
      titulo = `${c.nome} (no Cemitério): você pode adicionar 1 Besta Alada de Nível 4 com até 1500 de ATK do deck à mão`;
    } else if (g.tipo === "zoologico") {
      const alvos = magiasEmCampo(estado);
      if (!alvos.length) continue;
      if (!meuTurno) {
        // fora do próprio turno: destrói uma do oponente, se houver
        const deles = alvos.filter((x) => localizar(estado, x).j !== dono);
        if (deles.length) {
          ev.push({ t: "efeito", j: dono, iid: g.iid });
          destruir(estado, deles[Math.floor(sorteioDoEstado(estado)() * deles.length)], ev, "efeito");
        }
        continue;
      }
      estado.pendente = {
        tipo: "alvo", efeito: "zoologico", jogador: dono, origem: g.iid, candidatos: alvos, min: 0, max: 1,
        titulo: "Zoológico Animal: você pode destruir 1 Magia/Armadilha do campo",
      };
      continue;
    } else if (g.tipo === "big") {
      candidatos = estado.jogadores[dono].cemiterio.filter((x) => carta(estado, x).mencionaIrmaos);
      titulo = `${c.nome}: você pode recuperar do Cemitério 1 Magia/Armadilha que mencione "Irmãos Animal"`;
    } else if (g.tipo === "thales") {
      candidatos = cartasIrmaos(estado, dono);
      const temGrande = estado.jogadores[dono].monstros.some((m) => m && m.face && ehAnimal(carta(estado, m.iid)) && carta(estado, m.iid).nivel >= 5);
      max = temGrande ? 2 : 1;
      titulo = `${c.nome}: você pode adicionar ${max === 2 ? "até 2 cartas (com nomes diferentes)" : "1 carta"} que mencionam "Irmãos Animal" do deck à mão`;
    }
    // uma opção por nome
    const vistos = new Set();
    candidatos = candidatos.filter((x) => !vistos.has(estado.cartas[x]) && vistos.add(estado.cartas[x]));
    if (!candidatos.length) continue;
    if (meuTurno) {
      estado.pendente = { tipo: "alvo", efeito: g.tipo, jogador: dono, origem: g.iid, candidatos, min: 0, max: Math.min(max, candidatos.length), titulo };
    } else {
      // no turno do oponente é automático e sorteado
      const sorteio = sorteioDoEstado(estado);
      ev.push({ t: "efeito", j: dono, iid: g.iid });
      buscar(estado, dono, candidatos[Math.floor(sorteio() * candidatos.length)], ev);
    }
  }
}


/* ---------- Efeitos que o jogador ativa (botão "Efeito" no monstro) ---------- */

// Devolve { rotulo, alvos } se o monstro tem um efeito que dá para usar agora
export function efeitoAtivavel(estado, j, iid) {
  const loc = localizar(estado, iid);
  if (!loc || loc.j !== j || loc.zona !== "monstros" || !loc.obj.face || estado.vez !== j) return null;
  const m = loc.obj;
  const c = carta(estado, iid);
  const p = estado.jogadores[j];
  const antesDoAtaque = estado.fase === "principal1" || estado.fase === "batalha";
  switch (c.efeito) {
    case "wellington": {
      const candidatos = magiasEmCampo(estado);
      if (!ehFasePrincipal(estado) || !m.marcadores || !candidatos.length) return null;
      return {
        rotulo: "Efeito: gastar o Marcador e destruir 1 Magia/Armadilha",
        alvos: { candidatos, min: 1, max: 1, titulo: `${c.nome}: escolha 1 Magia/Armadilha para destruir` },
      };
    }
    case "mestre-laminas":
      if (!antesDoAtaque || m.efeitoUsado === estado.turno || !p.mao.length || m.pos !== "atk" || m.atacouDuas) return null;
      return {
        rotulo: "Efeito: descartar 1 carta e atacar 2 vezes",
        alvos: { candidatos: [...p.mao], min: 1, max: 1, titulo: `${c.nome}: descarte 1 carta para atacar duas vezes neste turno` },
      };
    case "john": {
      if (!ehFasePrincipal(estado) || usou(estado, j, "john") || zonaLivre(p.monstros) < 0) return null;
      const descartes = p.mao.filter((x) => ehAnimal(carta(estado, x)) || carta(estado, x).nome.includes("Animal"));
      if (!descartes.length || !alvosDoJohn(estado, j).length) return null;
      return {
        rotulo: "Efeito: descartar 1 \"Animal\" e chamar 1 \"Animal\" do deck em Defesa",
        alvos: { candidatos: descartes, min: 1, max: 1, titulo: `${c.nome}: descarte 1 carta "Animal" da mão` },
      };
    }
    case "midas-animal": {
      if (!ehFasePrincipal(estado) || usou(estado, j, "midas")) return null;
      const candidatos = p.monstros.filter((x) => x && x.face && carta(estado, x.iid).atributo === "VENTO").map((x) => x.iid);
      if (!candidatos.length) return null;
      return {
        rotulo: "Efeito: devolver 1 VENTO para a mão e Invocar outro",
        alvos: { candidatos, min: 1, max: 1, titulo: `${c.nome}: escolha 1 monstro de VENTO seu para voltar para a mão` },
      };
    }
    case "mestre-caos": {
      // Invocado por Invocação-Normal/Especial neste turno (Invocação-Flip não conta: o monstro entrou antes)
      if (estado.fase !== "principal2" || m.turnoEntrou !== estado.turno || usou(estado, j, "mestre-caos")) return null;
      const vistos = new Set();
      const candidatos = p.cemiterio.filter((x) => carta(estado, x).categoria === "magia" && !vistos.has(estado.cartas[x]) && vistos.add(estado.cartas[x]));
      if (!candidatos.length) return null;
      return {
        rotulo: "Efeito: adicionar 1 Magia do Cemitério à mão",
        alvos: { candidatos, min: 1, max: 1, titulo: `${c.nome}: escolha 1 Magia do seu Cemitério para a sua mão` },
      };
    }
    case "gelo-careca": {
      if (!antesDoAtaque || m.ataqueDuplo === estado.turno || m.pos !== "atk") return null;
      const candidatos = p.monstros.filter((x) => x && x.iid !== iid && x.face && x.pos === "atk" && ehMonstroGelo(carta(estado, x.iid))).map((x) => x.iid);
      if (!candidatos.length) return null;
      return {
        rotulo: "Efeito: tributar 1 monstro GELO e atacar 2 vezes",
        alvos: { candidatos, min: 1, max: 1, titulo: `${c.nome}: escolha o monstro GELO em ataque para tributar` },
      };
    }
    default:
      return null;
  }
}

function efeitoMonstro(estado, j, { iid, alvos = [] }, ev) {
  const efeito = efeitoAtivavel(estado, j, iid);
  if (!efeito) return "Esse efeito não pode ser usado agora.";
  if (alvos.length !== 1 || !efeito.alvos.candidatos.includes(alvos[0])) return "Escolha a carta do efeito.";
  const m = localizar(estado, iid).obj;
  const c = carta(estado, iid);
  ev.push({ t: "efeito", j, iid, alvos });
  switch (c.efeito) {
    case "wellington":
      m.marcadores = 0;
      destruir(estado, alvos[0], ev, "efeito");
      break;
    case "mestre-laminas":
      descartar(estado, j, alvos[0], ev);
      m.efeitoUsado = estado.turno;
      m.ataqueDuplo = estado.turno;
      ev.push({ t: "ataqueDuplo", j, iid });
      break;
    case "john": {
      marcarUso(estado, j, "john");
      descartar(estado, j, alvos[0], ev);
      const candidatos = alvosDoJohn(estado, j);
      if (candidatos.length) {
        estado.pendente = {
          tipo: "alvo", efeito: "john-invocar", jogador: j, origem: iid, candidatos, min: 1, max: 1,
          titulo: `${c.nome}: escolha o monstro "Animal" do deck que entra em Defesa`,
        };
      }
      break;
    }
    case "midas-animal": {
      marcarUso(estado, j, "midas");
      devolverParaMao(estado, alvos[0], ev);
      const candidatos = estado.jogadores[j].mao.filter((x) => {
        const mc = carta(estado, x);
        return mc.categoria === "monstro" && mc.atributo === "VENTO" && mc.nivel <= 4 && !mc.somenteEspecial;
      });
      if (candidatos.length && zonaLivre(estado.jogadores[j].monstros) >= 0) {
        estado.pendente = {
          tipo: "alvo", efeito: "midas-invocar", jogador: j, origem: iid, candidatos, min: 0, max: 1,
          titulo: `${c.nome}: você pode Invocar por Invocação-Normal 1 monstro de VENTO (Nível 4 ou menos) da mão`,
        };
      }
      break;
    }
    case "mestre-caos": {
      marcarUso(estado, j, "mestre-caos");
      recuperarDoCemiterio(estado, j, alvos[0], ev);
      break;
    }
    case "gelo-careca":
      ev.push({ t: "tributo", j, iid: alvos[0] });
      removerDoCampo(estado, alvos[0], ev, "tributo");
      m.ataqueDuplo = estado.turno;
      ev.push({ t: "ataqueDuplo", j, iid });
      break;
  }
  return null;
}


// Miqueas Animal: descarta da mão e busca 1 "Zoológico Animal" do deck
export function podeUsarMiqueas(estado, j, iid) {
  const p = estado.jogadores[j];
  return ehFasePrincipal(estado) && estado.vez === j && p.mao.includes(iid) && carta(estado, iid).efeito === "miqueas-animal" &&
    p.deck.some((x) => ehAnimalZoologico(carta(estado, x)));
}

function efeitoMao(estado, j, { iid }, ev) {
  if (!podeUsarMiqueas(estado, j, iid)) return "Não há \"Zoológico Animal\" no seu deck para buscar.";
  ev.push({ t: "efeito", j, iid });
  descartar(estado, j, iid, ev);
  const alvo = estado.jogadores[j].deck.find((x) => ehAnimalZoologico(carta(estado, x)));
  buscar(estado, j, alvo, ev);
  return null;
}


/* ---------- 8. Batalha ---------- */

// Zonas do oponente que podem ser alvo de ataque (George Animal protege os "Animal" de Nível 6 ou menos)
export function alvosDeAtaque(estado, j) {
  const georgeEmCampo = estado.jogadores.some((p) => p.monstros.some((m) => m && m.face && carta(estado, m.iid).efeito === "george"));
  return estado.jogadores[oponente(j)].monstros
    .map((m, s) => {
      if (!m) return null;
      const c = carta(estado, m.iid);
      if (georgeEmCampo && m.face && ehAnimal(c) && c.nivel <= 6) return null;
      const outroVento = estado.jogadores[oponente(j)].monstros.some((x) => x && x !== m && x.face && carta(estado, x.iid).atributo === "VENTO");
      if (m.face && c.efeito === "wellington-animal" && outroVento) return null;
      return s;
    })
    .filter((s) => s !== null);
}

// Monstros do jogador que ainda podem atacar neste turno
export function podeAtacar(estado, j, slot) {
  const m = estado.jogadores[j].monstros[slot];
  return (
    estado.vez === j &&
    estado.fase === "batalha" &&
    estado.turno > 1 &&
    !luzAtiva(estado, oponente(j)) &&
    Boolean(m && m.face && m.pos === "atk" && podeAtacarDeNovo(estado, m))
  );
}

// Ainda tem ataque sobrando: nenhum ainda, ou o segundo (Mestre das Lâminas / Manoel Careca)
const podeAtacarDeNovo = (estado, m) => !m.atacou || (m.ataqueDuplo === estado.turno && !m.atacouDuas);

function atacar(estado, j, { slot, alvo = null }, ev) {
  if (estado.fase !== "batalha") return "Ataques só na Fase de Batalha.";
  if (estado.turno === 1) return "Ninguém ataca no primeiro turno do duelo.";
  const p = estado.jogadores[j];
  const o = estado.jogadores[oponente(j)];
  const m = p.monstros[slot];
  if (!m) return "Não há monstro nessa zona.";
  if (!m.face || m.pos !== "atk") return "Só monstros em Posição de Ataque podem atacar.";
  if (!podeAtacarDeNovo(estado, m)) return "Esse monstro já atacou neste turno.";
  if (luzAtiva(estado, oponente(j))) return "As Carecas da Luz Reveladora estão te cegando: não dá para atacar!";

  const alvosValidos = alvosDeAtaque(estado, j);
  if (alvo === null || alvo === undefined) {
    if (alvosValidos.length) return "Só dá para atacar direto se o oponente não tiver monstros que possam ser atacados.";
  } else if (!o.monstros[alvo]) {
    return "Não há monstro nessa zona do oponente.";
  } else if (!alvosValidos.includes(alvo)) {
    return "O George Animal protege esse monstro: ele não pode ser alvo de ataques.";
  }

  if (m.atacou) m.atacouDuas = true;
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

  // Grande Mestre do Caos: o monstro do oponente que ele destruiu em batalha é banido (atacando ou defendendo)
  const caiu = (x) => estado.jogadores[donoDe(x)].cemiterio.includes(x);
  for (const [mestre, outro] of [[atacante, defensor], [defensor, atacante]]) {
    if (carta(estado, mestre).efeito === "mestre-caos" && caiu(outro)) {
      ev.push({ t: "efeito", j: localizar(estado, mestre)?.j ?? donoDe(mestre), iid: mestre });
      banirDoCemiterio(estado, outro, ev);
    }
  }

  // Irmãollow atacado virado para baixo: depois do cálculo de dano, quem atacou sofre 1000
  if (virou && estado.vencedor === null && carta(estado, defensor).efeito === "irmaollow") {
    ev.push({ t: "efeito", j: oponente(j), iid: defensor });
    dano(estado, j, 1000, ev);
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
  if (!loc || (loc.zona !== "monstros" && loc.zona !== "magias" && loc.zona !== "campo")) return;
  if (causa === "batalha" && loc.zona === "monstros" && carta(estado, iid).efeito === "irmaollow") {
    ev.push({ t: "indestrutivel", j: loc.j, iid });
    return;
  }
  ev.push({ t: "destruida", iid, j: loc.j, causa });
  const equipado = loc.zona === "magias" ? loc.obj.equipadoEm : null;
  removerDoCampo(estado, iid, ev, causa);
  if (equipado && carta(estado, iid).efeito === "lamento") destruir(estado, equipado, ev, "efeito");
  // Karecoh Alado: destruído no campo -> o dono não sofre dano de batalha pelo resto do turno
  if (loc.zona === "monstros" && carta(estado, iid).efeito === "karecoh") {
    estado.jogadores[loc.j].semDanoBatalha = estado.turno;
    ev.push({ t: "efeito", j: loc.j, iid });
  }
  if (loc.zona === "monstros" && carta(estado, iid).efeito === "manoel-gelo") chamarOutroManoel(estado, loc.j, iid, ev);
  if (loc.zona === "monstros" && causa === "batalha" && carta(estado, iid).efeito === "emanoel") {
    const opcoes = estado.jogadores[loc.j].deck.filter((x) => carta(estado, x).nome.includes("Animal"));
    if (opcoes.length) {
      ev.push({ t: "efeito", j: loc.j, iid });
      buscar(estado, loc.j, opcoes[Math.floor(sorteioDoEstado(estado)() * opcoes.length)], ev);
    }
  }
}

// Manoel do Gelo (1 vez por turno): Invocação-Especial de outro "Manoel do Gelo" sorteado do deck
function chamarOutroManoel(estado, j, iid, ev) {
  const p = estado.jogadores[j];
  if (p.manoelUsado === estado.turno) return;
  const opcoes = p.deck.filter((x) => {
    const c = carta(estado, x);
    return c.categoria === "monstro" && c.nome.includes("Manoel do Gelo") && c.id !== "manoel-do-gelo";
  });
  const slot = zonaLivre(p.monstros);
  if (!opcoes.length || slot < 0) return;
  p.manoelUsado = estado.turno;
  const escolhido = opcoes[Math.floor(sorteioDoEstado(estado)() * opcoes.length)];
  p.deck.splice(p.deck.indexOf(escolhido), 1);
  p.monstros[slot] = { iid: escolhido, pos: "atk", face: true, turnoEntrou: estado.turno, mudouPos: estado.turno, atacou: false };
  ev.push({ t: "efeito", j, iid });
  ev.push({ t: "invocacao", j, iid: escolhido, modo: "especial", slot });
  embaralhar(p.deck, sorteioDoEstado(estado));
  aposEspecial(estado, j, escolhido, ev);
}

// Tira a carta do campo e manda para o dono: Cemitério, mão (causa "mao") ou banidas (causa "banida").
// O "Grande Mestre do Caos" com a face para cima é banido em vez de ir para qualquer outro lugar.
// Equipamentos presos a um monstro que sai vão para o Cemitério. Devolve para onde a carta foi.
function removerDoCampo(estado, iid, ev, causa) {
  const loc = localizar(estado, iid);
  if (!loc) return null;
  const p = estado.jogadores[loc.j];
  if (loc.zona === "campo") p.campo = null;
  else p[loc.zona][loc.slot] = null;
  const dono = donoDe(iid);
  const q = estado.jogadores[dono];
  const caos = causa !== "banida" && loc.zona === "monstros" && loc.obj.face && carta(estado, iid).efeito === "mestre-caos";
  let destino;
  if (causa === "banida" || caos) {
    (q.banidas ||= []).push(iid);
    destino = "banida";
    if (caos) ev.push({ t: "banida", j: dono, iid });
  } else if (causa === "mao") {
    maoDoDono(estado, iid).push(iid);
    destino = "mao";
  } else {
    q.cemiterio.push(iid);
    destino = "cemiterio";
    if (loc.zona === "monstros") {
      chegouAoCemiterio(estado, dono, iid, ev);
      if (carta(estado, iid).efeito === "george") georgeNoCemiterio(estado, dono, iid, ev);
    }
  }
  if (loc.zona === "monstros") {
    for (let k = 0; k < 2; k++) {
      estado.jogadores[k].magias.forEach((m) => {
        if (m && m.equipadoEm === iid) {
          ev.push({ t: "destruida", iid: m.iid, j: k, causa: "equipamento" });
          removerDoCampo(estado, m.iid, ev, "equipamento");
        }
      });
    }
  }
  return destino;
}

// Banir: a carta sai do jogo de vez (não vai para o Cemitério e nada a traz de volta)
function banir(estado, iid, ev) {
  const loc = localizar(estado, iid);
  if (!loc || (loc.zona !== "monstros" && loc.zona !== "magias" && loc.zona !== "campo")) return;
  removerDoCampo(estado, iid, ev, "banida");
  ev.push({ t: "banida", j: donoDe(iid), iid });
}

// Carta que já está no Cemitério é banida (Grande Mestre do Caos)
function banirDoCemiterio(estado, iid, ev) {
  const q = estado.jogadores[donoDe(iid)];
  const i = q.cemiterio.indexOf(iid);
  if (i < 0) return;
  q.cemiterio.splice(i, 1);
  (q.banidas ||= []).push(iid);
  ev.push({ t: "banida", j: donoDe(iid), iid });
}

// Mão do dono da carta. No Tag 2vs2 a carta volta para a mão do membro que é dono dela
// (as cartas do 2º membro de cada time têm o prefixo "c" ou "d"), mesmo que seja o parceiro.
function maoDoDono(estado, iid) {
  const p = estado.jogadores[donoDe(iid)];
  if (!ehTag(estado)) return p.mao;
  const membro = iid[0] === "c" || iid[0] === "d" ? 1 : 0;
  return membro === (p.ativo || 0) ? p.mao : p.reserva.mao;
}

// Monstro do campo volta para a mão do dono (equipamentos presos a ele vão para o Cemitério)
function devolverParaMao(estado, iid, ev) {
  const loc = localizar(estado, iid);
  if (!loc || loc.zona !== "monstros") return;
  if (removerDoCampo(estado, iid, ev, "mao") === "mao") ev.push({ t: "paraMao", j: donoDe(iid), iid });
}

// Carta do Cemitério de j volta para a mão do dono (Big Animal, Grande Mestre do Caos)
function recuperarDoCemiterio(estado, j, iid, ev) {
  const p = estado.jogadores[j];
  const i = p.cemiterio.indexOf(iid);
  if (i < 0) return;
  p.cemiterio.splice(i, 1);
  maoDoDono(estado, iid).push(iid);
  ev.push({ t: "recuperada", j, iid });
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
  const big = estado.jogadores[j].bigMP2;
  if (para === "principal2" && big && big.turno === estado.turno) {
    (estado.gatilhos ||= []).push({ tipo: "big", j, iid: big.iid, turno: estado.turno });
  }
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
  // O Último Gole: no fim do turno, o monstro equipado é destruído
  for (const q of estado.jogadores) {
    for (const m of [...q.magias]) {
      if (m && m.face && m.equipadoEm && carta(estado, m.iid).efeito === "gole") {
        ev.push({ t: "efeito", j: estado.jogadores.indexOf(q), iid: m.iid });
        destruir(estado, m.equipadoEm, ev, "efeito");
      }
    }
  }
  if (estado.vencedor !== null) return;
  // Controle Carecal: os monstros emprestados voltam para quem os controlava
  estado.jogadores.forEach((q, k) => {
    q.monstros.forEach((m, s) => {
      if (m && m.emprestado) devolverControle(estado, k, s, ev);
    });
  });
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
  if (ehTag(estado)) proximoMembro(estado, estado.vez, ev);
  const p = estado.jogadores[estado.vez];
  p.invocouNormal = false;
  for (const q of estado.jogadores) {
    q.monstros.forEach((m) => {
      if (m) {
        m.atacou = false;
        m.atacouDuas = false;
      }
    });
  }
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
    processarGatilhos(estado, ev);
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
  if (pend.efeito === "davi" && alvos.length) {
    const lados = alvos.map((a) => localizar(estado, a).j);
    if (alvos.length !== 2 || !lados.includes(j) || !lados.includes(oponente(j))) {
      return "Escolha 1 Besta Alada sua e 1 monstro do oponente (ou nenhum).";
    }
  }
  if (pend.efeito === "thales" && alvos.length === 2 && estado.cartas[alvos[0]] === estado.cartas[alvos[1]]) {
    return "As duas cartas precisam ter nomes diferentes.";
  }
  estado.pendente = null;

  if (pend.tipo === "descarte") {
    const p = estado.jogadores[j];
    for (const iid of alvos) descartar(estado, j, iid, ev);
    passarTurno(estado, ev);
    return null;
  }

  if (!alvos.length) return null; // escolheu não fazer nada
  ev.push({ t: "efeito", j, iid: pend.origem, alvos });
  if (pend.efeito === "flip-descartar") {
    for (const alvo of alvos) descartar(estado, oponente(j), alvo, ev);
    return null;
  }
  if (pend.efeito === "flip-buscar-magia" || pend.efeito === "davi-cemiterio" || pend.efeito === "thales") {
    for (const alvo of alvos) buscar(estado, j, alvo, ev);
    if (pend.efeito === "flip-buscar-magia") return null;
    return null;
  }
  if (pend.efeito === "john-invocar") {
    especialDoDeck(estado, j, alvos[0], ev);
    return null;
  }
  if (pend.efeito === "midas-invocar") {
    invocacaoNormalExtra(estado, j, alvos[0], ev);
    return null;
  }
  if (pend.efeito === "zoologico") {
    destruir(estado, alvos[0], ev, "efeito");
    return null;
  }
  if (pend.efeito === "big") {
    recuperarDoCemiterio(estado, j, alvos[0], ev);
    return null;
  }
  if (pend.efeito === "davi") {
    marcarUso(estado, j, "davi-devolver");
    for (const alvo of alvos) devolverParaMao(estado, alvo, ev);
    return null;
  }
  for (const alvo of alvos) destruir(estado, alvo, ev, "efeito");
  return null;
}

// Escolha feita pelo jogo quando o tempo acaba
export function escolhaAutomatica(estado, pend) {
  const j = pend.jogador;
  if (pend.tipo === "descarte") return pend.candidatos.slice(0, pend.min);
  if (pend.efeito === "flip-descartar" || pend.efeito === "flip-buscar-magia") return pend.candidatos.slice(0, 1);
  if (pend.efeito === "davi-cemiterio" || pend.efeito === "thales" || pend.efeito === "big" || pend.efeito === "john-invocar") return pend.candidatos.slice(0, 1);
  if (pend.efeito === "zoologico") return pend.candidatos.filter((x) => localizar(estado, x).j !== pend.jogador).slice(0, 1);
  if (pend.efeito === "midas-invocar") return [];
  if (pend.efeito === "davi") return [];
  const doOponente = pend.candidatos.filter((x) => localizar(estado, x).j !== j);
  if (pend.efeito === "tributo-destruir-magias" || pend.efeito === "mestre-laminas") return doOponente.slice(0, pend.max);
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
      if (!p.invocouNormal && !c.somenteEspecial) {
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
      if (podeInvocarBig(estado, j, iid)) {
        opcoes.push({ id: "especial", rotulo: "Invocação-Especial (tem \"Animal\" de Nível 5+)", acao: { tipo: "invocarEspecial", iid } });
      }
      if (podeUsarMiqueas(estado, j, iid)) {
        opcoes.push({ id: "efeito", rotulo: "Efeito: descartar para buscar \"Zoológico Animal\"", acao: { tipo: "efeitoMao", iid } });
      }
      if (podeInvocarGeorge(estado, j, iid)) {
        opcoes.push({ id: "especial", rotulo: "Invocação-Especial em Defesa (tem monstro de VENTO)", acao: { tipo: "invocarEspecial", iid } });
      }
      const gelo = c.efeito === "gelo-careca" && requisitosGeloCareca(estado, j, iid);
      if (gelo) {
        opcoes.push({ id: "especial", rotulo: "Invocação-Especial (descartar 2 GELO)", acao: { tipo: "invocarEspecial", iid }, alvos: gelo });
      }
    } else {
      const livre = c.subtipo === "campo" || zonaLivre(p.magias) >= 0;
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
      const alvos = alvosDeAtaque(estado, j);
      opcoes.push({ id: "atacar", rotulo: "Atacar", acao: { tipo: "atacar", slot: loc.slot }, ataque: { alvos, direto: alvos.length === 0 } });
    }
    const efeito = efeitoAtivavel(estado, j, iid);
    if (efeito) opcoes.push({ id: "efeito", rotulo: efeito.rotulo, acao: { tipo: "efeitoMonstro", iid }, alvos: efeito.alvos });
    if (principal && !m.face && m.turnoEntrou < estado.turno && m.mudouPos !== estado.turno) {
      opcoes.push({ id: "virar", rotulo: "Virar (Invocação-Flip)", acao: { tipo: "virar", slot: loc.slot } });
    }
    if (principal && m.face && m.turnoEntrou < estado.turno && m.mudouPos !== estado.turno && !m.atacou) {
      const rotulo = m.pos === "atk" ? "Mudar para Defesa" : "Mudar para Ataque";
      opcoes.push({ id: "posicao", rotulo, acao: { tipo: "mudarPosicao", slot: loc.slot } });
    }
  }

  if ((loc.zona === "magias" || loc.zona === "campo") && principal && !loc.obj.face && c.categoria === "magia") {
    const podeRapida = c.subtipo !== "rapida" || loc.obj.turnoBaixada < estado.turno;
    const req = requisitosMagia(estado, j, iid);
    if (podeRapida && req) opcoes.push({ id: "ativar", rotulo: "Ativar", acao: { tipo: "ativar", iid }, alvos: req.alvos });
  }

  return opcoes;
}
