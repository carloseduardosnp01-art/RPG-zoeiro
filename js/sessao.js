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

import { novoDuelo, aplicar, quemAge, carta, ErroJogada } from "./motor.js";
import { jogadaDoBot } from "./bot.js";
import { PREFIXO, publicar, assinar } from "./rede.js";
import { esperar, gerarId } from "./util.js";

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

export function criarSessaoBot(perfil) {
  const eu = {
    chave: perfil?.chave || "voce",
    nick: perfil?.nick || "Você",
    tag: perfil?.tag || "",
    avatar: perfil?.avatar || "careca-feijao",
    nivel: perfil?.nivel || 1,
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
      intervalos.push(setInterval(() => mandarSinal("ping"), 5000));
      intervalos.push(setInterval(verificarOponente, 1000));
    },

    agir(acao) {
      const r = aplicar(sessao.estado, eu, acao);
      sessao.estado = r.estado;
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
