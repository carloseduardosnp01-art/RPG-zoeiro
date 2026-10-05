/* ==========================================================================
   Duelo da Zoeira · js/rede.js
   Conexão em tempo real: publicar/assinar tópicos, com mensagens "retidas"
   (a última mensagem de cada tópico fica guardada para quem chegar depois).

   Quem leva as mensagens, em ordem:
   1. Supabase (o mesmo projeto do banco): Realtime para o ao vivo, em canais
      separados (geral, um por duelo, um por jogador) para gastar pouco; a lista
      de online pela Presença do Realtime; e as retidas numa tabela do banco
      (supabase/banco.sql: gravar_retida / ler_retidas).
   2. Se o Supabase não responder: um broker MQTT público (o jeito antigo).
   Modo local (index.html?rede=local): BroadcastChannel + localStorage, para
   testar o online com duas abas sem internet. ?rede=mqtt força o MQTT.
   ========================================================================== */

import { bancoLigado, chamar, configTempoReal } from "./banco.js?v=202610050155";

export const PREFIXO = "rpgdazoeira/v1";

// Reserva: todos precisam usar o mesmo broker, o segundo só entra se o primeiro falhar.
const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
];

const pedidoRede = new URLSearchParams(location.search).get("rede");
const modoLocal = pedidoRede === "local";

let cliente = null;          // cliente MQTT, Supabase ou o substituto local (publish/subscribe/unsubscribe)
let conexao = null;          // Promise da conexão em andamento
let modo = modoLocal ? "local" : "mqtt";
let status = "desconectado";
const ouvintesStatus = new Set();
const assinaturas = [];      // { filtro, fn }
const contagem = new Map();  // filtro -> quantas assinaturas usam


/* ---------- Status ---------- */

function mudarStatus(novo) {
  if (novo === status) return;
  status = novo;
  ouvintesStatus.forEach((fn) => fn(status));
}

export function aoStatus(fn) {
  ouvintesStatus.add(fn);
  fn(status);
  return () => ouvintesStatus.delete(fn);
}

export const statusAtual = () => status;
export const modoRede = () => modo;
// Com o Supabase, quem cai sai da lista de online sozinho (não precisa olhar a hora do aviso)
export const presencaGerenciada = () => modo === "supabase";
// "Estou aqui" do duelo: mais espaçado no Supabase (cada mensagem conta no plano grátis)
export const intervaloDoSinal = () => (modo === "supabase" ? 8000 : 5000);


/* ---------- Tópicos ---------- */

// Filtro MQTT: "+" vale um nível, "#" vale o resto
export function casa(filtro, topico) {
  const f = filtro.split("/");
  const t = topico.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (f[i] !== "+" && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function entregar(topico, texto, retida) {
  let dados = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      return; // mensagem estranha de outra pessoa: ignora
    }
  }
  for (const a of [...assinaturas]) {
    if (casa(a.filtro, topico)) {
      try {
        a.fn(dados, topico, retida);
      } catch (erro) {
        console.error("Erro ao tratar mensagem de", topico, erro);
      }
    }
  }
}


/* ---------- Conexão ---------- */

// vontade: { topico, dados } publicado (retido) se a conexão cair (no Supabase, a Presença faz isso)
export function conectar({ sid, vontade = null }) {
  if (conexao) return conexao;
  mudarStatus("conectando");
  if (modoLocal) conexao = conectarLocal(vontade);
  else if (pedidoRede !== "mqtt" && bancoLigado()) {
    conexao = conectarSupabase(sid).catch((erro) => {
      console.warn("Tempo real do Supabase indisponível, usando o servidor público:", erro.message);
      mudarStatus("conectando");
      return conectarMqtt(sid, vontade, 0);
    });
  } else conexao = conectarMqtt(sid, vontade, 0);
  conexao.catch(() => {
    conexao = null;
    mudarStatus("desconectado");
  });
  return conexao;
}

function conectarMqtt(sid, vontade, indice) {
  return new Promise((resolve, reject) => {
    if (!window.mqtt) {
      reject(new Error("A biblioteca MQTT não carregou. Verifique a internet."));
      return;
    }
    const url = BROKERS[indice];
    const c = window.mqtt.connect(url, {
      clientId: `zoeira_${sid}`,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      will: vontade ? { topic: vontade.topico, payload: vontade.dados ? JSON.stringify(vontade.dados) : "", retain: true, qos: 1 } : undefined,
    });
    let conectouAlgumaVez = false;

    const desistir = setTimeout(() => {
      if (conectouAlgumaVez) return;
      c.end(true);
      if (indice + 1 < BROKERS.length) conectarMqtt(sid, vontade, indice + 1).then(resolve, reject);
      else reject(new Error("Não foi possível conectar ao servidor do jogo."));
    }, 9000);

    c.on("connect", () => {
      mudarStatus("conectado");
      if (!conectouAlgumaVez) {
        conectouAlgumaVez = true;
        clearTimeout(desistir);
        modo = "mqtt";
        cliente = c;
        for (const filtro of contagem.keys()) c.subscribe(filtro, { qos: 1 }); // assinaturas feitas antes de conectar
        resolve("mqtt");
      }
    });
    c.on("reconnect", () => mudarStatus("reconectando"));
    c.on("offline", () => mudarStatus("reconectando"));
    c.on("error", (erro) => console.warn("MQTT:", erro.message));
    c.on("message", (topico, payload, pacote) => entregar(topico, payload.toString(), pacote.retain));
  });
}


/* ---------- Supabase: Realtime + retidas no banco ---------- */

const GERAL = "geral";
const partesDe = (topico) => topico.slice(PREFIXO.length + 1).split("/");
const concreto = (parte) => parte && parte !== "+" && parte !== "#";

// presença vai pela Presença; perfis o banco já tem; contas (senhas do modo antigo) não saem daqui
function tipoDoTopico(topico) {
  return { presenca: "presenca", perfis: "perfil", contas: "conta" }[partesDe(topico)[0]] || "outro";
}

// Canal de cada tópico: cada duelo no seu, o que é de um jogador no dele, o resto no geral
function canalDoTopico(topico) {
  const p = partesDe(topico);
  if (p[0] === "duelo" && concreto(p[1])) return `duelo-${p[1]}`;
  if (["dm", "presentes", "premios"].includes(p[0]) && concreto(p[1])) return `jogador-${p[1]}`;
  return GERAL;
}

function conectarSupabase(sid) {
  return new Promise((resolve, reject) => {
    const cfg = configTempoReal();
    if (!cfg || !window.supabase?.createClient) {
      reject(new Error("A biblioteca do Supabase não carregou."));
      return;
    }
    // a tabela das retidas precisa existir (supabase/banco.sql rodado); senão fica no jeito antigo
    chamar("ler_retidas", { p_filtro: `${PREFIXO}/chat/historico` }, { espera: 8000 }).then((r) => {
      if (!Array.isArray(r)) throw new Error("ler_retidas não respondeu como esperado.");
      const sb = window.supabase.createClient(cfg.url, cfg.chave, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const rt = { sb, sid, prefixo: cfg.prefixo, canais: new Map(), envio: new Map(), presencas: new Map(), minha: null, chaveMinha: null };
      let pronto = false;
      const desistir = setTimeout(() => {
        if (pronto) return;
        sb.removeAllChannels();
        reject(new Error("O Realtime do Supabase não respondeu."));
      }, 9000);
      rt.geral = abrirCanal(rt, GERAL, (st) => {
        if (st === "SUBSCRIBED") {
          mudarStatus("conectado");
          if (rt.minha) rt.geral.track(rt.minha); // voltou depois de cair: marca presença de novo
          if (!pronto) {
            pronto = true;
            clearTimeout(desistir);
            modo = "supabase";
            cliente = clienteSupabase(rt);
            for (const filtro of contagem.keys()) cliente.subscribe(filtro);
            resolve("supabase");
          } else {
            // o que mudou enquanto estava sem conexão
            for (const filtro of contagem.keys()) cliente.buscarRetidas(filtro);
          }
        } else if (pronto) mudarStatus("reconectando");
      }, { presenca: sid });
      rt.canais.set(GERAL, { ch: rt.geral, usos: Infinity });
    }).catch(reject);
  });
}

function abrirCanal(rt, nome, aoStatus = null, { presenca = null } = {}) {
  const avulso = rt.envio.get(nome);
  if (avulso) {
    rt.envio.delete(nome);
    rt.sb.removeChannel(avulso);
  }
  const config = { broadcast: { self: false, ack: false } };
  if (presenca) config.presence = { key: presenca };
  const ch = rt.sb.channel(rt.prefixo + nome, { config });
  ch.on("broadcast", { event: "m" }, ({ payload }) => {
    if (payload && typeof payload.t === "string") entregar(payload.t, typeof payload.d === "string" ? payload.d : "", false);
  });
  if (presenca) ch.on("presence", { event: "sync" }, () => sincronizarPresencas(rt, ch));
  ch.subscribe((st) => aoStatus?.(st));
  return ch;
}

// A Presença do Realtime vira as mensagens "presenca/<sid>" que o salão já entende
function sincronizarPresencas(rt, ch) {
  const vistos = new Set();
  for (const [sid, metas] of Object.entries(ch.presenceState())) {
    const meta = metas[metas.length - 1];
    if (!meta) continue;
    const { presence_ref: _ref, ...dados } = meta;
    vistos.add(sid);
    const texto = JSON.stringify(dados);
    if (rt.presencas.get(sid) === texto) continue;
    rt.presencas.set(sid, texto);
    entregar(`${PREFIXO}/presenca/${sid}`, texto, true);
  }
  for (const sid of [...rt.presencas.keys()]) {
    if (vistos.has(sid)) continue;
    rt.presencas.delete(sid);
    entregar(`${PREFIXO}/presenca/${sid}`, "", false);
  }
}

function marcarPresenca(rt, topico, texto) {
  if (partesDe(topico)[1] !== rt.sid) return; // só a desta aba
  if (!texto) {
    rt.minha = rt.chaveMinha = null;
    rt.geral.untrack();
    return;
  }
  const dados = JSON.parse(texto);
  // o salão manda a presença a cada 25 s; aqui só vai quando muda (nick, status, nível...)
  const { t: _t, assinatura: _a, ...essencial } = dados;
  const chave = JSON.stringify(essencial);
  if (chave === rt.chaveMinha) return;
  rt.chaveMinha = chave;
  rt.minha = dados;
  rt.geral.track(dados);
}

function clienteSupabase(rt) {
  const buscarRetidas = (filtro) => {
    if (tipoDoTopico(filtro) !== "outro") {
      if (tipoDoTopico(filtro) === "presenca") {
        for (const [sid, texto] of rt.presencas) entregar(`${PREFIXO}/presenca/${sid}`, texto, true);
      }
      return Promise.resolve();
    }
    return chamar("ler_retidas", { p_filtro: filtro })
      .then((itens) => {
        if (!(contagem.get(filtro) > 0) || !Array.isArray(itens)) return;
        for (const { topico, texto } of itens) entregar(topico, texto, true);
      })
      .catch((erro) => console.warn("Não deu para ler as mensagens guardadas de", filtro, erro.message));
  };
  return {
    buscarRetidas,
    publish(topico, texto, { retain }) {
      const tipo = tipoDoTopico(topico);
      if (tipo === "conta") return;
      if (tipo === "presenca") {
        marcarPresenca(rt, topico, texto);
        return;
      }
      if (retain && tipo === "outro") {
        chamar("gravar_retida", { p_topico: topico, p_texto: texto || null })
          .catch((erro) => console.warn("Não deu para guardar", topico, erro.message));
      }
      setTimeout(() => entregar(topico, texto, false), 0); // quem publicou também recebe (como no MQTT)
      const nome = canalDoTopico(topico);
      const msg = { t: topico, d: texto };
      const aberto = rt.canais.get(nome);
      if (aberto) {
        aberto.ch.send({ type: "broadcast", event: "m", payload: msg });
        return;
      }
      // canal em que esta aba não está (ex.: a mensagem privada para outra pessoa): vai pela API
      let avulso = rt.envio.get(nome);
      if (!avulso) {
        avulso = rt.sb.channel(rt.prefixo + nome, { config: { broadcast: { self: false, ack: false } } });
        rt.envio.set(nome, avulso);
      }
      avulso.httpSend("m", msg).catch((erro) => console.warn("Não deu para enviar para", nome, erro.message));
    },
    subscribe(filtro) {
      const nome = canalDoTopico(filtro);
      const aberto = rt.canais.get(nome);
      if (aberto) aberto.usos++;
      else rt.canais.set(nome, { ch: abrirCanal(rt, nome), usos: 1 });
      buscarRetidas(filtro);
    },
    unsubscribe(filtro, depois) {
      const nome = canalDoTopico(filtro);
      const aberto = rt.canais.get(nome);
      if (aberto && --aberto.usos <= 0) {
        rt.canais.delete(nome);
        rt.sb.removeChannel(aberto.ch);
      }
      depois?.();
    },
  };
}


/* ---------- Modo local (testes com duas abas) ---------- */

// Substituto local: BroadcastChannel entre abas + localStorage para as mensagens retidas
function conectarLocal(vontade) {
  const CHAVE = "zoeira-local-retidas";
  const canal = new BroadcastChannel("rpgdazoeira-local");
  const lerRetidas = () => JSON.parse(localStorage.getItem(CHAVE) || "{}");

  canal.onmessage = ({ data }) => entregar(data.topico, data.texto, false);
  cliente = {
    publish(topico, texto, { retain }) {
      if (retain) {
        const r = lerRetidas();
        if (texto) r[topico] = texto;
        else delete r[topico];
        localStorage.setItem(CHAVE, JSON.stringify(r));
      }
      canal.postMessage({ topico, texto });
      setTimeout(() => entregar(topico, texto, false), 0); // o MQTT também devolve a mensagem para quem publicou
    },
    subscribe(filtro) {
      const r = lerRetidas();
      setTimeout(() => {
        for (const [topico, texto] of Object.entries(r)) if (casa(filtro, topico)) entregar(topico, texto, true);
      }, 30);
    },
    unsubscribe() {},
  };
  for (const filtro of contagem.keys()) cliente.subscribe(filtro);
  if (vontade) {
    addEventListener("pagehide", () => cliente.publish(vontade.topico, vontade.dados ? JSON.stringify(vontade.dados) : "", { retain: true }));
  }
  mudarStatus("conectado");
  return Promise.resolve("local");
}


/* ---------- Publicar e assinar ---------- */

export function publicar(topico, dados, { reter = false } = {}) {
  if (!cliente) return false;
  const texto = dados === null || dados === undefined ? "" : JSON.stringify(dados);
  cliente.publish(topico, texto, { retain: reter, qos: 1 });
  return true;
}

// Assina um filtro. Devolve a função que cancela a assinatura.
export function assinar(filtro, fn) {
  const registro = { filtro, fn };
  assinaturas.push(registro);
  const jaAssinado = (contagem.get(filtro) || 0) > 0;
  contagem.set(filtro, (contagem.get(filtro) || 0) + 1);
  // Se o tópico já estava assinado, pede o valor retido de novo para este ouvinte também
  if (jaAssinado) pedirRetido(filtro);
  else if (cliente) cliente.subscribe(filtro, { qos: 1 });
  return () => {
    const i = assinaturas.indexOf(registro);
    if (i >= 0) assinaturas.splice(i, 1);
    const resto = (contagem.get(filtro) || 1) - 1;
    contagem.set(filtro, resto);
    if (resto <= 0 && cliente) {
      contagem.delete(filtro);
      cliente.unsubscribe(filtro);
    }
  };
}

// Pede de novo o último valor guardado (retido) de um tópico.
// No MQTT: o MQTT.js ignora um "subscribe" repetido de um tópico que já está assinado, então
// sai e entra de novo (ao assinar, o broker sempre reenvia o valor retido). No Supabase: lê do
// banco. Os ouvintes do jogo aguentam receber o mesmo valor de novo (o duelo confere o "seq").
export function pedirRetido(filtro) {
  if (!cliente) return;
  if (cliente.buscarRetidas) {
    cliente.buscarRetidas(filtro);
    return;
  }
  if (modoLocal || !((contagem.get(filtro) || 0) > 0)) {
    cliente.subscribe(filtro, { qos: 1 });
    return;
  }
  cliente.unsubscribe(filtro, () => {
    if ((contagem.get(filtro) || 0) > 0) cliente.subscribe(filtro, { qos: 1 });
  });
}

// Lê a mensagem retida de um tópico (ou null se não houver nenhuma)
export function lerRetido(topico, espera = 1800) {
  // no Supabase dá para perguntar direto ao banco (e saber na hora quando não tem nada)
  if (modo === "supabase" && cliente) {
    if (tipoDoTopico(topico) !== "outro") return Promise.resolve(null);
    return chamar("ler_retidas", { p_filtro: topico })
      .then((itens) => {
        const achado = Array.isArray(itens) && itens.find((x) => x.topico === topico);
        return achado ? JSON.parse(achado.texto) : null;
      })
      .catch(() => null);
  }
  return new Promise((resolve) => {
    let cancelar = null;
    const fim = setTimeout(() => {
      cancelar();
      resolve(null);
    }, espera);
    cancelar = assinar(topico, (dados, _t, retida) => {
      if (!retida) return;
      clearTimeout(fim);
      setTimeout(() => cancelar(), 0);
      resolve(dados);
    });
  });
}
