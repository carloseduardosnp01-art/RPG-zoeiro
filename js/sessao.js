/* ==========================================================================
   Duelo da Zoeira · js/sessao.js
   Uma "sessão" liga a arena a um duelo. A arena só conversa com esta
   interface, então funciona igual contra o bot ou contra alguém online:

     sessao.estado            estado atual do duelo
     sessao.eu                meu índice (0 ou 1)
     sessao.agir(acao)        aplica a minha jogada (lança ErroJogada se inválida)
     sessao.aoAtualizar(fn)   fn(estado, eventos) a cada mudança
     sessao.enviarChat(texto) / sessao.aoChat(fn)
     sessao.aoStatus(fn)      avisos de conexão (oponente sem sinal)
     sessao.iniciar() / sessao.encerrar()

   Online, quem faz a jogada aplica no próprio navegador e publica o estado
   inteiro (retido) no tópico do duelo; o outro só substitui o estado dele.
   Como só age quem está na vez (as armadilhas são automáticas), nunca há
   duas jogadas ao mesmo tempo.
   ========================================================================== */

import { novoDuelo, aplicar, quemAge, carta, ErroJogada, membroAtivo } from "./motor.js?v=202610042119";
import { jogadaDoBot } from "./bot.js?v=202610042119";
import { PREFIXO, publicar, assinar, pedirRetido, aoStatus, intervaloDoSinal } from "./rede.js?v=202610042119";
import { esperar, gerarId } from "./util.js?v=202610042119";

export const SEM_SINAL_AVISO = 20;  // segundos sem sinal do oponente para avisar
export const SEM_SINAL_WO = 60;     // segundos sem sinal para poder pedir W.O.

export const topicosDuelo = (id) => ({
  estado: `${PREFIXO}/duelo/${id}/estado`,
  sinal: `${PREFIXO}/duelo/${id}/sinal`,
});

function criarBase() {
  const ouvintes = { atualizar: new Set(), chat: new Set(), status: new Set() };
  return {
    ouvintes,
    emitir(tipo, ...args) {
      ouvintes[tipo].forEach((fn) => fn(...args));
    },
    aoAtualizar(fn) { ouvintes.atualizar.add(fn); },
    aoChat(fn) { ouvintes.chat.add(fn); },
    aoStatus(fn) { ouvintes.status.add(fn); },
    // A arena troca esta função para o bot esperar as animações terminarem
    aguardarVisual: async () => {},
  };
}


/* ---------- Treino contra o Bot Careca ---------- */

const FALAS_BOT = {
  armadilha: ["Caiu! 😂", "Achou que eu ia deixar barato? 🪤", "Careca prevenido vale por dois.", "Surpresaaa! 🧑‍🦲"],
  destruiuSeu: ["Esse aí foi de Vapo 💨", "Próximo!", "Tá fácil, hein? 😎", "Mais um pro cemitério."],
  perdeuMonstro: ["Sorte de principiante...", "Ai, meu careca! 😭", "Isso não vai ficar assim.", "Tava só aquecendo."],
  tomouDano: ["Doeu na careca! 🤕", "Calma, calma...", "Ok, essa pegou."],
  resposta: ["Fala menos e joga mais 😂", "Kkkkkk", "Tô nem aí, sou careca.", "Bora, bora!", "Isso é tudo que você tem?", "🧑‍🦲🧑‍🦲🧑‍🦲"],
  venceu: ["GG! Volta quando tiver cabelo 🧑‍🦲", "Careca supremo, né? 😎"],
  perdeu: ["GG... vou raspar a cabeça de vergonha. Ah, espera.", "Revanche! Agora!"],
};

const sortear = (lista) => lista[Math.floor(Math.random() * lista.length)];

// deck: lista de ids do deck do jogador (o bot sempre usa o deck padrão)
export function criarSessaoBot(perfil, deck) {
  const eu = {
    chave: perfil?.chave || "voce",
    nick: perfil?.nick || "Você",
    tag: perfil?.tag || "",
    avatar: perfil?.avatar || "careca-feijao",
    nivel: perfil?.nivel || 1,
    reliquia: perfil?.reliquia || null,
    visual: perfil?.visual || null,
    deck,
  };
  const bot = { chave: "bot-careca", nick: "Bot Careca", tag: "BOT", avatar: "careca-cast-surpresa", nivel: 99, bot: true };
  const { estado, eventos } = novoDuelo({
    id: "treino-" + gerarId(6),
    jogadores: [eu, bot],
    semente: crypto.getRandomValues(new Uint32Array(1))[0],
  });

  const base = criarBase();
  let ativo = true;
  let pensando = false;
  let ultimaFala = 0;

  const sessao = {
    ...base,
    tipo: "bot",
    eu: 0,
    estado,
    eventosIniciais: eventos,

    iniciar() {
      agendarBot();
    },

    agir(acao) {
      aplicarEEmitir(0, acao);
    },

    enviarChat(texto) {
      base.emitir("chat", { j: 0, nick: eu.nick, texto, t: Date.now() });
      if (Math.random() < 0.6) setTimeout(() => falar(sortear(FALAS_BOT.resposta), true), 1200);
    },

    encerrar() {
      ativo = false;
    },
  };

  function aplicarEEmitir(j, acao) {
    const r = aplicar(sessao.estado, j, acao);
    sessao.estado = r.estado;
    base.emitir("atualizar", r.estado, r.eventos);
    comentar(r.eventos);
    agendarBot();
  }

  function falar(texto, sempre = false) {
    if (!ativo) return;
    if (!sempre && Date.now() - ultimaFala < 5000) return;
    ultimaFala = Date.now();
    base.emitir("chat", { j: 1, nick: bot.nick, texto, t: Date.now() });
  }

  // O bot comenta o que acabou de acontecer (de vez em quando)
  function comentar(eventos) {
    for (const ev of eventos) {
      if (ev.t === "fim") {
        setTimeout(() => falar(sortear(ev.vencedor === 1 ? FALAS_BOT.venceu : FALAS_BOT.perdeu), true), 1500);
        return;
      }
    }
    const chance = Math.random();
    if (eventos.some((e) => e.t === "armadilha" && e.j === 1) && chance < 0.8) return falar(sortear(FALAS_BOT.armadilha));
    if (eventos.some((e) => e.t === "destruida" && e.j === 0 && e.causa === "batalha") && chance < 0.45) return falar(sortear(FALAS_BOT.destruiuSeu));
    if (eventos.some((e) => e.t === "destruida" && e.j === 1 && carta(sessao.estado, e.iid).categoria === "monstro") && chance < 0.4) return falar(sortear(FALAS_BOT.perdeuMonstro));
    if (eventos.some((e) => e.t === "dano" && e.j === 1 && e.valor >= 1500) && chance < 0.6) return falar(sortear(FALAS_BOT.tomouDano));
  }

  async function agendarBot() {
    if (pensando || !ativo) return;
    pensando = true;
    try {
      while (ativo && quemAge(sessao.estado) === 1) {
        await sessao.aguardarVisual();
        await esperar(sessao.estado.fase === "batalha" ? 500 : 700);
        if (!ativo || quemAge(sessao.estado) !== 1) break;
        let acao = jogadaDoBot(sessao.estado, 1);
        try {
          const r = aplicar(sessao.estado, 1, acao);
          sessao.estado = r.estado;
          base.emitir("atualizar", r.estado, r.eventos);
          comentar(r.eventos);
        } catch (erro) {
          if (!(erro instanceof ErroJogada)) throw erro;
          acao = { tipo: "tempo" }; // nunca deve acontecer, mas o bot não pode travar o jogo
          const r = aplicar(sessao.estado, 1, acao);
          sessao.estado = r.estado;
          base.emitir("atualizar", r.estado, r.eventos);
        }
      }
    } finally {
      pensando = false;
    }
  }

  return sessao;
}


/* ---------- Duelo online ---------- */

// estado: estado inicial (ou o último recebido); minha: { chave, sid }
export function criarSessaoOnline({ estado, eventos = [], minha }) {
  const base = criarBase();
  const eu = estado.jogadores.findIndex((p) => p.chave === minha.chave);
  const topicos = topicosDuelo(estado.id);
  let ultimoSinal = Date.now();
  let avisoAtual = null;
  const cancelamentos = [];
  const intervalos = [];
  const ressinc = criarRessincronizacao(topicos.estado, () => quemAge(sessao.estado) === eu, () => sessao.estado);

  const sessao = {
    ...base,
    tipo: "online",
    eu,
    estado,
    eventosIniciais: eventos,

    iniciar() {
      cancelamentos.push(assinar(topicos.estado, receberEstado));
      cancelamentos.push(assinar(topicos.sinal, receberSinal));
      mandarSinal("ping");
      intervalos.push(setInterval(() => mandarSinal("ping"), intervaloDoSinal()));
      intervalos.push(setInterval(verificarOponente, 1000));
      cancelamentos.push(ressinc.iniciar());
    },

    agir(acao) {
      const r = aplicar(sessao.estado, eu, acao);
      sessao.estado = r.estado;
      ressinc.atualizou();
      publicar(topicos.estado, { seq: r.estado.seq, estado: r.estado, eventos: r.eventos, autor: minha.sid }, { reter: true });
      base.emitir("atualizar", r.estado, r.eventos);
    },

    enviarChat(texto) {
      mandarSinal("chat", { texto, nick: sessao.estado.jogadores[eu].nick });
    },

    // Oponente sumiu há tempo demais: reivindica a vitória
    pedirWO() {
      sessao.agir({ tipo: "wo" });
    },

    encerrar() {
      cancelamentos.forEach((c) => c());
      intervalos.forEach(clearInterval);
      mandarSinal("saiu");
    },
  };

  function receberEstado(dados) {
    if (!dados || !dados.estado || dados.seq <= sessao.estado.seq) return;
    sessao.estado = dados.estado;
    ultimoSinal = Date.now();
    ressinc.atualizou();
    base.emitir("atualizar", dados.estado, dados.autor === minha.sid ? [] : dados.eventos || []);
  }

  function receberSinal(dados) {
    if (!dados) return;
    const j = sessao.estado.jogadores.findIndex((p) => p.chave === dados.chave);
    if (j < 0) return;
    if (j !== eu) ultimoSinal = Date.now();
    if (dados.tipo === "chat") base.emitir("chat", { j, nick: dados.nick, texto: String(dados.texto).slice(0, 200), t: dados.t });
    if (dados.tipo === "saiu" && j !== eu) ultimoSinal = Math.min(ultimoSinal, Date.now() - SEM_SINAL_AVISO * 1000);
  }

  function mandarSinal(tipo, extra = {}) {
    publicar(topicos.sinal, { tipo, chave: minha.chave, sid: minha.sid, t: Date.now(), ...extra });
  }

  function verificarOponente() {
    if (sessao.estado.vencedor !== null) {
      if (avisoAtual) base.emitir("status", (avisoAtual = null));
      return;
    }
    const segundos = Math.floor((Date.now() - ultimoSinal) / 1000);
    const novo = segundos >= SEM_SINAL_AVISO ? { semSinal: segundos, podeWO: segundos >= SEM_SINAL_WO && quemAge(sessao.estado) !== eu } : null;
    if (JSON.stringify(novo) !== JSON.stringify(avisoAtual)) {
      avisoAtual = novo;
      base.emitir("status", novo);
    }
  }

  return sessao;
}


/* ---------- Ressincronização (1vs1 e Tag) ---------- */

// O estado do duelo fica guardado (retido) no broker. Se uma mensagem se perder (celular que
// saiu do app, conexão que caiu por uns segundos), quem está esperando pede o estado de novo:
//   - a cada 5 s sem novidades, enquanto não é a vez dele;
//   - quando a página volta a ficar visível;
//   - quando a conexão volta.
// Só estados com "seq" maior são aplicados, então isso nunca desfaz uma jogada.
function criarRessincronizacao(topico, euQueJogo, estadoAtual) {
  let ultima = Date.now();
  const pedir = () => {
    if (estadoAtual().vencedor === null) pedirRetido(topico);
  };
  return {
    atualizou() {
      ultima = Date.now();
    },
    iniciar() {
      const intervalo = setInterval(() => {
        if (!euQueJogo() && Date.now() - ultima > 5000) {
          ultima = Date.now();
          pedir();
        }
      }, 1000);
      const aoVoltar = () => {
        if (!document.hidden) pedir();
      };
      document.addEventListener("visibilitychange", aoVoltar);
      let statusAnterior = null;
      const pararStatus = aoStatus((status) => {
        if (status === "conectado" && statusAnterior && statusAnterior !== "conectado") pedir();
        statusAnterior = status;
      });
      return () => {
        clearInterval(intervalo);
        document.removeEventListener("visibilitychange", aoVoltar);
        pararStatus();
      };
    },
  };
}


/* ---------- Tag da Zoeira 2vs2 (online, 4 jogadores) ---------- */

// Igual à sessão online do 1vs1, mas: só o membro da vez joga pelo time, cada um dos 4
// manda o próprio sinal, e se o membro da vez sumir o parceiro pode passar a vez por ele.
export function criarSessaoTag({ estado, eventos = [], minha }) {
  const base = criarBase();
  const eu = estado.jogadores.findIndex((p) => p.membros.some((m) => m.chave === minha.chave));
  const membro = estado.jogadores[eu].membros.findIndex((m) => m.chave === minha.chave);
  const topicos = topicosDuelo(estado.id);
  const sinais = {}; // chave -> último sinal
  for (const p of estado.jogadores) for (const m of p.membros) sinais[m.chave] = Date.now();
  let avisoAtual = null;
  const cancelamentos = [];
  const intervalos = [];
  const ressinc = criarRessincronizacao(
    topicos.estado,
    () => quemAge(sessao.estado) === eu && membroAtivo(sessao.estado, eu) === membro,
    () => sessao.estado,
  );

  const sessao = {
    ...base,
    tipo: "tag",
    eu,
    membro,
    estado,
    eventosIniciais: eventos,

    iniciar() {
      cancelamentos.push(assinar(topicos.estado, receberEstado));
      cancelamentos.push(assinar(topicos.sinal, receberSinal));
      mandarSinal("ping");
      intervalos.push(setInterval(() => mandarSinal("ping"), intervaloDoSinal()));
      intervalos.push(setInterval(verificarQuemJoga, 1000));
      cancelamentos.push(ressinc.iniciar());
    },

    // Só o membro da vez joga (desistir vale para o time todo, a qualquer momento)
    agir(acao) {
      if (!["desistir", "wo"].includes(acao.tipo) && membroAtivo(sessao.estado, eu) !== membro) {
        throw new ErroJogada("É a vez do seu parceiro jogar.");
      }
      aplicarEPublicar(acao);
    },

    // O parceiro da vez sumiu: passa a vez dele (como se o tempo tivesse acabado)
    passarPeloParceiro() {
      aplicarEPublicar({ tipo: "tempo" });
    },

    enviarChat(texto) {
      mandarSinal("chat", { texto, nick: sessao.estado.jogadores[eu].membros[membro].nick });
    },

    pedirWO() {
      aplicarEPublicar({ tipo: "wo" });
    },

    encerrar() {
      cancelamentos.forEach((c) => c());
      intervalos.forEach(clearInterval);
      mandarSinal("saiu");
    },
  };

  function aplicarEPublicar(acao) {
    const r = aplicar(sessao.estado, eu, acao);
    sessao.estado = r.estado;
    ressinc.atualizou();
    publicar(topicos.estado, { seq: r.estado.seq, estado: r.estado, eventos: r.eventos, autor: minha.sid, autorChave: minha.chave }, { reter: true });
    base.emitir("atualizar", r.estado, r.eventos);
  }

  function receberEstado(dados) {
    if (!dados || !dados.estado || dados.seq <= sessao.estado.seq) return;
    sessao.estado = dados.estado;
    ressinc.atualizou();
    if (dados.autorChave) sinais[dados.autorChave] = Date.now();
    base.emitir("atualizar", dados.estado, dados.autor === minha.sid ? [] : dados.eventos || []);
  }

  function receberSinal(dados) {
    if (!dados || !(dados.chave in sinais)) return;
    const j = sessao.estado.jogadores.findIndex((p) => p.membros.some((m) => m.chave === dados.chave));
    sinais[dados.chave] = dados.tipo === "saiu" ? Date.now() - SEM_SINAL_AVISO * 1000 : Date.now();
    if (dados.tipo === "chat") base.emitir("chat", { j, nick: dados.nick, texto: String(dados.texto).slice(0, 200), t: dados.t, minha: dados.chave === minha.chave });
  }

  function mandarSinal(tipo, extra = {}) {
    publicar(topicos.sinal, { tipo, chave: minha.chave, sid: minha.sid, t: Date.now(), ...extra });
  }

  // Avisa se quem precisa jogar agora está sem sinal
  function verificarQuemJoga() {
    const e = sessao.estado;
    let novo = null;
    const q = quemAge(e);
    if (q !== null) {
      const daVez = e.jogadores[q].membros[membroAtivo(e, q)];
      const segundos = Math.floor((Date.now() - (sinais[daVez.chave] || Date.now())) / 1000);
      if (daVez.chave !== minha.chave && segundos >= SEM_SINAL_AVISO) {
        novo = { semSinal: segundos, nick: daVez.nick, podeWO: q !== eu && segundos >= SEM_SINAL_WO, podePassar: q === eu && segundos >= 30 };
      }
    }
    if (JSON.stringify(novo) !== JSON.stringify(avisoAtual)) {
      avisoAtual = novo;
      base.emitir("status", novo);
    }
  }

  return sessao;
}
