/* ==========================================================================
   Duelo da Zoeira · js/bot.js
   O "Bot Careca": decide a próxima jogada no modo treino.
   Joga limpo: só olha o que um jogador de verdade veria (cartas viradas
   para baixo do oponente e a mão dele ficam escondidas).
   ========================================================================== */

import {
  carta, localizar, atkAtual, defAtual, opcoesDaCarta, oponente, monstrosEmCampo, ehAnimal,
  luzAtiva, podeAtacar, ehFasePrincipal, quemAge, tributosDaCarta, validar, alvosDeAtaque, paresDeFusao,
} from "./motor.js?v=202610031145";

const VALOR_VIRADO = 1200; // palpite para um monstro do oponente virado para baixo

// Próxima ação do bot (ou null se não for a vez dele)
export function jogadaDoBot(estado, j) {
  if (quemAge(estado) !== j) return null;
  if (estado.pendente) return { tipo: "escolher", alvos: escolherAlvos(estado, j, estado.pendente) };

  if (ehFasePrincipal(estado)) {
    for (const acao of jogadasPrincipais(estado, j)) {
      if (acao && !validar(estado, j, acao)) return acao;
    }
    if (estado.fase === "principal1" && estado.turno > 1 && temAtacante(estado, j)) {
      return { tipo: "fase", para: "batalha" };
    }
    return { tipo: "fase", para: "final" };
  }

  if (estado.fase === "batalha") {
    const ataque = escolherAtaque(estado, j);
    if (ataque && !validar(estado, j, ataque)) return ataque;
    return { tipo: "fase", para: "principal2" };
  }
  return { tipo: "fase", para: "final" };
}


/* ---------- Avaliação do campo ---------- */

// Força de um monstro vista pelo jogador j
function forca(estado, j, iid) {
  const loc = localizar(estado, iid);
  if (!loc || loc.zona !== "monstros") return 0;
  if (!loc.obj.face && loc.j !== j) return VALOR_VIRADO;
  const c = carta(estado, iid);
  if (c.efeito && c.efeito.startsWith("flip-") && !loc.obj.face) return 900;
  return loc.obj.pos === "atk" || loc.obj.face ? atkAtual(estado, iid) : c.def;
}

const somaForca = (estado, j, iids) => iids.reduce((t, x) => t + forca(estado, j, x), 0);

function maiorAtkVisivel(estado, j, lado) {
  return estado.jogadores[lado].monstros
    .filter((m) => m && (m.face || lado === j))
    .reduce((maior, m) => Math.max(maior, atkAtual(estado, m.iid)), 0);
}

function temAtacante(estado, j) {
  return estado.jogadores[j].monstros.some((m, s) => m && m.face && m.pos === "atk" && !m.atacou) &&
    !luzAtiva(estado, oponente(j));
}


/* ---------- Fase Principal ---------- */

// Lista de jogadas em ordem de prioridade (a primeira válida é usada)
function* jogadasPrincipais(estado, j) {
  const p = estado.jogadores[j];
  const o = oponente(j);
  const mao = p.mao.map((iid) => ({ iid, c: carta(estado, iid) }));
  const opcoes = (iid) => opcoesDaCarta(estado, j, iid);
  const meus = monstrosEmCampo(estado, j);
  const deles = monstrosEmCampo(estado, o);
  const primeira = estado.fase === "principal1";

  // 1. Carecalla entra de penetra
  for (const { iid } of mao) {
    if (opcoes(iid).some((x) => x.id === "especial")) yield { tipo: "invocarEspecial", iid };
  }

  // 1a. John Animal: descarta o "Animal" mais fraco e chama o mais forte do deck
  for (const m of p.monstros) {
    if (!m || carta(estado, m.iid).efeito !== "john") continue;
    const op = opcoes(m.iid).find((x) => x.id === "efeito");
    if (op) yield { tipo: "efeitoMonstro", iid: m.iid, alvos: [[...op.alvos.candidatos].sort((a, b) => (carta(estado, a).atk || 0) - (carta(estado, b).atk || 0))[0]] };
  }

  // 1a2. Daiki entra banindo o LUZ e o TREVAS mais fracos do Cemitério
  for (const { iid, c } of mao) {
    if (c.efeito !== "daiki") continue;
    const op = opcoes(iid).find((x) => x.id === "especial" && x.alvos);
    if (!op) continue;
    const fraco = (atributo) => op.alvos.candidatos.filter((x) => carta(estado, x).atributo === atributo).sort((a, b) => carta(estado, a).atk - carta(estado, b).atk)[0];
    yield { tipo: "invocarEspecial", iid, alvos: [fraco("LUZ"), fraco("TREVAS")] };
  }

  // 1b. Manoel do Gelo Careca entra descartando 2 GELO
  for (const { iid, c } of mao) {
    if (c.efeito === "daiki") continue;
    const op = opcoes(iid).find((x) => x.id === "especial" && x.alvos);
    if (op) yield { tipo: "invocarEspecial", iid, alvos: op.alvos.candidatos.slice(0, 2) };
  }

  // 1c. Pote do Gelo: devolve as 2 cartas gelo menos úteis e compra 3
  for (const { iid, c } of mao) {
    if (c.efeito !== "pote-gelo") continue;
    const op = opcoes(iid).find((x) => x.id === "ativar");
    if (op) yield { tipo: "ativar", iid, alvos: [...op.alvos.candidatos].sort((a, b) => valorNaMao(estado, j, a) - valorNaMao(estado, j, b)).slice(0, 2) };
  }

  // 1d. Efeitos com botão dos monstros em campo
  for (const m of p.monstros) {
    if (!m) continue;
    const op = opcoes(m.iid).find((x) => x.id === "efeito");
    if (!op) continue;
    const ef = carta(estado, m.iid).efeito;
    if (ef === "wellington") {
      const alvo = melhorMagiaDoOponente(estado, j, op.alvos.candidatos);
      if (alvo) yield { tipo: "efeitoMonstro", iid: m.iid, alvos: [alvo] };
    }
    if (ef === "negao" || (ef === "daiki" && primeira)) {
      const deles2 = op.alvos.candidatos.filter((x) => localizar(estado, x).j !== j);
      const alvo = deles2.sort((a, b) => forca(estado, j, b) - forca(estado, j, a))[0];
      if (alvo && forca(estado, j, alvo) >= (ef === "negao" ? 1500 : 1800)) yield { tipo: "efeitoMonstro", iid: m.iid, alvos: [alvo] };
    }
    if (ef === "obelisco" && deles.length >= 2) {
      const baratos = [...op.alvos.candidatos].sort((a, b) => forca(estado, j, a) - forca(estado, j, b)).slice(0, 2);
      if (somaForca(estado, j, deles) > somaForca(estado, j, baratos) + 1000) yield { tipo: "efeitoMonstro", iid: m.iid, alvos: baratos };
    }
    if (ef === "mestre-caos") {
      yield { tipo: "efeitoMonstro", iid: m.iid, alvos: [[...op.alvos.candidatos].sort((a, b) => valorNaMao(estado, j, b) - valorNaMao(estado, j, a))[0]] };
    }
    if (ef === "mestre-laminas" && primeira && estado.turno > 1 && p.mao.length >= 3) {
      const pior = [...op.alvos.candidatos].sort((a, b) => valorNaMao(estado, j, a) - valorNaMao(estado, j, b))[0];
      yield { tipo: "efeitoMonstro", iid: m.iid, alvos: [pior] };
    }
  }

  // 1e. Zoológico Animal (se ainda não tiver um) e Egoísmo Puro (traz o "Animal" mais forte)
  for (const { iid, c } of mao) {
    if (c.efeito === "zoologico" && !(p.campo && p.campo.face && carta(estado, p.campo.iid).efeito === "zoologico")) {
      if (opcoes(iid).some((x) => x.id === "ativar")) yield { tipo: "ativar", iid };
    }
    if (c.efeito === "egoismo") {
      const op = opcoes(iid).find((x) => x.id === "ativar");
      if (op) yield { tipo: "ativar", iid, alvos: [[...op.alvos.candidatos].sort((a, b) => carta(estado, b).atk - carta(estado, a).atk)[0]] };
    }
  }

  // 1f. Mil Facas (com Grande Mestre em campo), Menino Mentiroso (campo vazio), Upstart Gordo
  for (const { iid, c } of mao) {
    if (c.efeito === "mil-facas" && deles.length && opcoes(iid).some((x) => x.id === "ativar")) yield { tipo: "ativar", iid };
    if (c.efeito === "menino") {
      const op = opcoes(iid).find((x) => x.id === "ativar");
      if (op) yield { tipo: "ativar", iid, alvos: [[...op.alvos.candidatos].sort((a, b) => carta(estado, b).atk - carta(estado, a).atk)[0]] };
    }
    if (c.efeito === "upstart" && p.deck.length > 5 && opcoes(iid).some((x) => x.id === "ativar")) yield { tipo: "ativar", iid };
  }

  // 1f2. 1 Litro pela Manhã com os PV baixos; Berinjela no meu monstro que mais ganha
  for (const { iid, c } of mao) {
    if (c.efeito === "litro" && p.pl <= 6000 && opcoes(iid).some((x) => x.id === "ativar")) yield { tipo: "ativar", iid };
    if (c.efeito === "berinjela") {
      const op = opcoes(iid).find((x) => x.id === "ativar");
      if (!op) continue;
      const meusAlvos = op.alvos.candidatos.filter((x) => localizar(estado, x).j === j);
      const ganho = (x) => {
        const nome = (q) => (ehAnimal(q) ? "Animal" : q.nome);
        const alvo = nome(carta(estado, x));
        return estado.jogadores.flatMap((q) => q.cemiterio).filter((y) => nome(carta(estado, y)) === alvo).length;
      };
      const melhor = meusAlvos.sort((a, b) => ganho(b) - ganho(a))[0];
      if (melhor && ganho(melhor) >= 1) yield { tipo: "ativar", iid, alvos: [melhor] };
    }
  }

  // 1f4. Sugadão quando o oponente tem mais Magias/Armadilhas que eu; Bora Bill traz o mais forte possível
  for (const { iid, c } of mao) {
    if (c.efeito === "sugadao" && opcoes(iid).some((x) => x.id === "ativar")) {
      const contar = (q) => [...estado.jogadores[q].magias, estado.jogadores[q].campo].filter(Boolean).length;
      const minhas = contar(j) - (localizar(estado, iid).zona === "magias" ? 1 : 0);
      if (contar(o) >= 2 && contar(o) > minhas) yield { tipo: "ativar", iid };
    }
    if (c.efeito === "bora-bill") {
      const op = opcoes(iid).find((x) => x.id === "ativar");
      if (op) yield { tipo: "ativar", iid, alvos: [[...op.alvos.candidatos].sort((a, b) => carta(estado, b).atk - carta(estado, a).atk)[0]] };
    }
  }

  // 1f5. Suruba: faz a Fusão mais forte possível
  for (const { iid, c } of mao) {
    if (c.efeito !== "fusao") continue;
    const op = opcoes(iid).find((x) => x.id === "ativar");
    if (op) yield { tipo: "ativar", iid, alvos: [[...op.alvos.candidatos].sort((a, b) => carta(estado, b).atk - carta(estado, a).atk)[0]] };
  }

  // 1f3. Revolução Animal baixada: descarta a pior carta (de preferência um "Animal") e traz os "Animal" do Cemitério
  for (const mg of p.magias) {
    if (!mg || carta(estado, mg.iid).efeito !== "revolucao") continue;
    const op = opcoes(mg.iid).find((x) => x.id === "ativar");
    if (!op) continue;
    const peso = (x) => (ehAnimal(carta(estado, x)) ? -10 : 0) + valorNaMao(estado, j, x);
    yield { tipo: "ativar", iid: mg.iid, alvos: [[...op.alvos.candidatos].sort((a, b) => peso(a) - peso(b))[0]] };
  }

  // 1g. Controle Carecal: pega o monstro mais forte do oponente para atacar com ele
  if (primeira && estado.turno > 1 && p.pl > 2500 && !luzAtiva(estado, o)) {
    for (const { iid, c } of mao) {
      if (c.efeito !== "controle") continue;
      const op = opcoes(iid).find((x) => x.id === "ativar");
      if (!op) continue;
      const forte = [...op.alvos.candidatos].sort((a, b) => atkAtual(estado, b) - atkAtual(estado, a))[0];
      if (atkAtual(estado, forte) >= 1700) yield { tipo: "ativar", iid, alvos: [forte] };
    }
  }

  // 2. Invocador traz o Grande Mestre
  for (const { iid, c } of mao) {
    if (c.efeito !== "invocador") continue;
    const op = opcoes(iid).find((x) => x.id === "ativar");
    if (op) yield { tipo: "ativar", iid, alvos: [op.alvos.candidatos[0]] };
  }

  // 3. Soco do Big nas cartas do oponente (Luz ativa > viradas > equipamentos)
  if (primeira) {
    for (const { iid, c } of mao) {
      if (c.efeito !== "soco") continue;
      const op = opcoes(iid).find((x) => x.id === "ativar");
      const alvo = op && melhorMagiaDoOponente(estado, j, op.alvos.candidatos);
      if (alvo) yield { tipo: "ativar", iid, alvos: [alvo] };
    }
  }

  // 4. Vapo! quando o oponente está bem melhor no campo
  for (const { iid, c } of mao) {
    if (c.efeito !== "vapo" || !deles.length) continue;
    const saldo = somaForca(estado, j, deles) - somaForca(estado, j, meus);
    if (saldo >= 1500 || (!meus.length && deles.length >= 2)) yield { tipo: "ativar", iid };
  }

  // 5. Carecas da Luz quando o oponente tem monstro mais forte ou meus PL estão baixos
  if (!luzAtiva(estado, j)) {
    for (const { iid, c } of mao) {
      if (c.efeito !== "luz" || !deles.length) continue;
      const perigo = maiorAtkVisivel(estado, j, o) > maiorAtkVisivel(estado, j, j) || p.pl <= 3000 || deles.length > meus.length + 1;
      if (perigo) yield { tipo: "ativar", iid };
    }
  }

  // 6. Invocação-Normal: a opção de maior ganho
  if (!p.invocouNormal) {
    const melhor = melhorInvocacao(estado, j, mao);
    if (melhor) yield melhor;
  }

  // 7. Virar os monstros VIRE quando o efeito vale a pena
  if (primeira) {
    const maoDeles = estado.jogadores[o].mao.length;
    for (const [slot, m] of p.monstros.entries()) {
      if (!m || m.face) continue;
      const ef = carta(estado, m.iid).efeito;
      const temMagia = p.deck.some((x) => carta(estado, x).categoria === "magia");
      if ((ef === "flip-destruir" && deles.length) || (ef === "flip-descartar" && maoDeles) || ef === "flip-comprar" || (ef === "flip-buscar-magia" && temMagia) || ef === "flip-parasita") {
        yield { tipo: "virar", slot };
      }
    }
  }

  // 7b. Lamento Prematuro: traz de volta o monstro mais forte do Cemitério (com PV sobrando)
  for (const { iid, c } of mao) {
    if (c.efeito !== "lamento" || p.pl <= 2500) continue;
    const op = opcoes(iid).find((x) => x.id === "ativar");
    if (!op) continue;
    const melhor = [...op.alvos.candidatos].sort((a, b) => carta(estado, b).atk - carta(estado, a).atk)[0];
    if (carta(estado, melhor).atk >= 1800) yield { tipo: "ativar", iid, alvos: [melhor] };
  }

  // 7c. O Último Gole: no meu monstro em ataque quando dá para atacar direto ou vencer uma batalha grande
  if (primeira && estado.turno > 1 && !luzAtiva(estado, o)) {
    for (const { iid, c } of mao) {
      if (c.efeito !== "gole") continue;
      const op = opcoes(iid).find((x) => x.id === "ativar");
      if (!op) continue;
      const meus2 = op.alvos.candidatos.filter((x) => {
        const l = localizar(estado, x);
        return l.j === j && l.obj.pos === "atk" && !l.obj.atacou;
      });
      if (!meus2.length) continue;
      const forte = meus2.sort((a, b) => atkAtual(estado, b) - atkAtual(estado, a))[0];
      if (!deles.length || atkAtual(estado, forte) * 2 >= estado.jogadores[o].pl) yield { tipo: "ativar", iid, alvos: [forte] };
    }
  }

  // 8. Bust do Big no meu monstro mais forte
  for (const { iid, c } of mao) {
    if (c.efeito !== "bust") continue;
    const op = opcoes(iid).find((x) => x.id === "ativar");
    if (!op) continue;
    const meusAlvos = op.alvos.candidatos.filter((x) => localizar(estado, x).j === j);
    if (!meusAlvos.length) continue;
    meusAlvos.sort((a, b) => atkAtual(estado, b) - atkAtual(estado, a));
    yield { tipo: "ativar", iid, alvos: [meusAlvos[0]] };
  }

  // 9. Baixa as armadilhas
  for (const { iid, c } of mao) {
    if (c.categoria === "armadilha") yield { tipo: "baixarMagia", iid };
  }

  // 10. Posições
  const maiorDeles = maiorAtkVisivel(estado, j, o);
  for (const [slot, m] of p.monstros.entries()) {
    if (!m || !m.face) continue;
    const atk = atkAtual(estado, m.iid);
    if (primeira && m.pos === "def" && atk > maiorDeles && atk >= 1000) yield { tipo: "mudarPosicao", slot };
    if (!primeira && m.pos === "atk" && !m.atacou && atk < maiorDeles) yield { tipo: "mudarPosicao", slot };
  }
}

// Avalia todas as Invocações-Normais possíveis e devolve a melhor (ou null)
function melhorInvocacao(estado, j, mao) {
  const p = estado.jogadores[j];
  const o = oponente(j);
  const maiorDeles = maiorAtkVisivel(estado, j, o);
  const deles = monstrosEmCampo(estado, o);
  // meus monstros do mais fraco para o mais forte (tributos saem daqui)
  const meusSlots = p.monstros
    .map((m, s) => (m ? { s, valor: forca(estado, j, m.iid) } : null))
    .filter(Boolean)
    .sort((a, b) => a.valor - b.valor);

  let melhor = null;
  let melhorGanho = 0;
  for (const { iid, c } of mao) {
    if (c.categoria !== "monstro") continue;
    if (c.efeito === "w-laminas" && p.monstros.some((m) => m && carta(estado, m.iid).efeito === "w-laminas")) continue;
    const n = tributosDaCarta(c);
    if (meusSlots.length < n) continue;
    const tributos = meusSlots.slice(0, n);
    const custo = tributos.reduce((t, x) => t + x.valor, 0);

    let valor = c.atk;
    let modo = "atk";
    if (c.efeito === "tributo-destruir-monstro" && deles.length) {
      valor += Math.max(...deles.map((x) => forca(estado, j, x)));
    }
    if (c.efeito === "tributo-destruir-magias") {
      valor += 700 * Math.min(2, estado.jogadores[o].magias.filter(Boolean).length);
    }
    if (c.efeito && c.efeito.startsWith("flip-")) {
      modo = "baixar";
      valor = c.efeito === "flip-destruir" && deles.length ? 1100 : 800;
    } else if (n === 0 && c.atk < maiorDeles) {
      // não vale expor um monstro mais fraco: baixa em defesa
      modo = "baixar";
      valor = 400 + c.def / 4;
    }
    if (c.nivel >= 7 && mao.some((x) => x.c.efeito === "invocador")) valor -= 1500; // melhor esperar o Invocador

    const ganho = valor - custo;
    if (ganho > melhorGanho) {
      melhorGanho = ganho;
      melhor = { tipo: "invocar", iid, modo, tributos: tributos.map((x) => x.s) };
    }
  }
  return melhor;
}

function melhorMagiaDoOponente(estado, j, candidatos) {
  const doOponente = candidatos.filter((x) => localizar(estado, x).j !== j);
  const peso = (x) => {
    const loc = localizar(estado, x);
    const c = carta(estado, x);
    if (loc.obj.face && c.efeito === "luz") return 3;
    if (loc.obj.face && c.efeito === "revolucao" && (loc.obj.revividos || []).length) return 3;
    if (!loc.obj.face) return 2;
    return 1;
  };
  doOponente.sort((a, b) => peso(b) - peso(a));
  return doOponente[0] || null;
}


/* ---------- Batalha ---------- */

function escolherAtaque(estado, j) {
  const p = estado.jogadores[j];
  const o = estado.jogadores[oponente(j)];
  const atacantes = p.monstros
    .map((m, s) => (m && podeAtacar(estado, j, s) ? s : null))
    .filter((s) => s !== null)
    .sort((a, b) => atkAtual(estado, p.monstros[b].iid) - atkAtual(estado, p.monstros[a].iid));

  for (const slot of atacantes) {
    const atk = atkAtual(estado, p.monstros[slot].iid);
    const atacaveis = alvosDeAtaque(estado, j);
    if (!atacaveis.length) return { tipo: "atacar", slot, alvo: null };

    let melhorAlvo = null;
    let melhorValor = -1;
    o.monstros.forEach((m, s) => {
      if (!m || !atacaveis.includes(s)) return;
      let vence = false;
      let valor = 0;
      if (!m.face) {
        vence = atk >= 1800;
        valor = 500;
      } else if (carta(estado, m.iid).efeito === "irmaollow") {
        // não é destruído em batalha: só vale atacar se estiver em Ataque (dano)
        vence = m.pos === "atk" && atk > atkAtual(estado, m.iid);
        valor = 100;
      } else if (m.pos === "atk") {
        const atkD = atkAtual(estado, m.iid);
        vence = atk > atkD;
        valor = atkD + (atk - atkD);
      } else {
        const defD = defAtual(estado, m.iid);
        vence = atk > defD;
        valor = defD;
      }
      if (vence && valor > melhorValor) {
        melhorValor = valor;
        melhorAlvo = s;
      }
    });
    if (melhorAlvo !== null) return { tipo: "atacar", slot, alvo: melhorAlvo };
  }
  return null;
}


/* ---------- Escolhas pendentes ---------- */

const VALOR_NA_MAO = {
  vapo: 9, "forca-careca": 8, "tributo-destruir-monstro": 7, soco: 6, "tributo-destruir-magias": 6,
  "armadilha-big": 6, luz: 6, penetra: 5, saideira: 5, "flip-destruir": 5, feiticeira: 5, bust: 4, invocador: 3,
  "flip-descartar": 5, "flip-comprar": 4, karecoh: 4, egoismo: 6, zoologico: 5,
  "armadura-gelo": 7, obelisco: 6, fusao: 5,
  sugadao: 7, "hoje-nao": 6, "bora-bill": 4, thangan: 5, hacker: 7, "w-laminas": 5,
  berinjela: 4, revolucao: 6, rafaza: 5, negao: 6, "flip-parasita": 5, litro: 3, daiki: 7,
  controle: 7, menino: 4, "mestre-caos": 6, upstart: 3, jinreca: 6, "mil-facas": 6, irmaollow: 5,
  wellington: 5, "mestre-laminas": 6, lamento: 5, gole: 5, "sai-daqui": 6, "adm-ditador": 7, "manoel-gelo": 4, "gelo-careca": 5, "pote-gelo": 4, "flip-buscar-magia": 4,
};

function valorNaMao(estado, j, iid) {
  const c = carta(estado, iid);
  if (c.id === "careca-feijao") return 5;
  if (c.id === "grande-mestre") return estado.jogadores[j].mao.some((x) => carta(estado, x).efeito === "invocador") ? 7 : 3;
  return VALOR_NA_MAO[c.efeito] ?? 4;
}

function escolherAlvos(estado, j, pend) {
  if (pend.tipo === "descarte") {
    const valor = (iid) => {
      const c = carta(estado, iid);
      if (c.id === "careca-feijao") return 5;
      if (c.id === "grande-mestre") return estado.jogadores[j].mao.some((x) => carta(estado, x).efeito === "invocador") ? 7 : 3;
      return VALOR_NA_MAO[c.efeito] ?? 4;
    };
    return [...pend.candidatos].sort((a, b) => valor(a) - valor(b)).slice(0, pend.min);
  }

  const doOponente = pend.candidatos.filter((x) => localizar(estado, x).j !== j);
  // Alquimista: a melhor Magia do deck
  if (pend.efeito === "flip-buscar-magia") {
    return [[...pend.candidatos].sort((a, b) => valorNaMao(estado, j, b) - valorNaMao(estado, j, a))[0]];
  }
  // Midasmon: descarta a melhor carta da mão do oponente
  if (pend.efeito === "flip-descartar") {
    const valor = (iid) => VALOR_NA_MAO[carta(estado, iid).efeito] ?? (carta(estado, iid).atk || 0) / 500;
    return [[...pend.candidatos].sort((a, b) => valor(b) - valor(a))[0]];
  }
  // Davi: devolve a minha Besta Alada mais fraca e o monstro mais forte do oponente
  if (pend.efeito === "davi") {
    const meus = pend.candidatos.filter((x) => localizar(estado, x).j === j).sort((a, b) => atkAtual(estado, a) - atkAtual(estado, b));
    const deles = pend.candidatos.filter((x) => localizar(estado, x).j !== j).sort((a, b) => atkAtual(estado, b) - atkAtual(estado, a));
    return atkAtual(estado, deles[0]) >= 1500 ? [meus[0], deles[0]] : [];
  }
  if (pend.efeito === "midas-invocar") return [];
  // Fusão: os materiais que menos fazem falta
  if (pend.efeito === "fusao") {
    const custo = (x) => (localizar(estado, x).zona === "monstros" ? forca(estado, j, x) : valorNaMao(estado, j, x) * 300);
    const pares = paresDeFusao(estado, j, pend.fusao).sort((a, b) => custo(a[0]) + custo(a[1]) - custo(b[0]) - custo(b[1]));
    return pares[0] || [];
  }
  if (pend.efeito === "revolucao") {
    return [...pend.candidatos].sort((a, b) => (carta(estado, b).atk || 0) - (carta(estado, a).atk || 0)).slice(0, pend.max);
  }
  // Zoológico: destrói a melhor Magia/Armadilha do oponente (nunca a minha)
  if (pend.efeito === "zoologico") {
    const alvo = melhorMagiaDoOponente(estado, j, pend.candidatos);
    return alvo ? [alvo] : [];
  }
  // buscas no deck: a de maior ATK (ou a primeira)
  if (pend.efeito === "davi-cemiterio" || pend.efeito === "thales" || pend.efeito === "big" || pend.efeito === "john-invocar") {
    return [[...pend.candidatos].sort((a, b) => (carta(estado, b).atk || 0) - (carta(estado, a).atk || 0))[0]];
  }
  if (pend.efeito === "tributo-destruir-magias" || pend.efeito === "mestre-laminas") {
    const ordenadas = [...doOponente].sort((a, b) => Number(localizar(estado, a).obj.face) - Number(localizar(estado, b).obj.face));
    return ordenadas.slice(0, pend.max);
  }
  // Destruir monstro: o mais forte do oponente; se só houver os meus, o mais fraco
  if (doOponente.length) {
    return [[...doOponente].sort((a, b) => forca(estado, j, b) - forca(estado, j, a))[0]];
  }
  if (pend.min === 0) return [];
  return [[...pend.candidatos].sort((a, b) => forca(estado, j, a) - forca(estado, j, b))[0]];
}
