/* ==========================================================================
   Duelo da Zoeira · js/rede.js
   Conexão em tempo real. O site é estático (GitHub Pages), então usa um
   broker MQTT público por WebSocket: publicar/assinar tópicos, com mensagens
   "retidas" (o broker guarda a última mensagem de cada tópico).

   Modo local (index.html?rede=local): troca o broker por BroadcastChannel +
   localStorage. Serve para testar o online com duas abas do mesmo navegador,
   sem internet.
   ========================================================================== */

export const PREFIXO = "rpgdazoeira/v1";

// Todos os jogadores precisam usar o mesmo broker: o segundo só entra se o primeiro falhar.
const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
];

const modoLocal = new URLSearchParams(location.search).get("rede") === "local";

let cliente = null;          // cliente MQTT ou o substituto local
let conexao = null;          // Promise da conexão em andamento
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
export const modoRede = () => (modoLocal ? "local" : "mqtt");


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

// vontade: { topico, dados } publicado (retido) pelo broker se a conexão cair
export function conectar({ sid, vontade = null }) {
  if (conexao) return conexao;
  mudarStatus("conectando");
  conexao = modoLocal ? conectarLocal(vontade) : conectarMqtt(sid, vontade, 0);
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

// Pede ao broker o último valor guardado (retido) de um tópico.
// O MQTT.js ignora um "subscribe" repetido de um tópico que já está assinado, então aqui
// sai e entra de novo: ao assinar, o broker sempre reenvia o valor retido. Os ouvintes do
// jogo aguentam receber o mesmo valor de novo (o duelo, por exemplo, confere o número "seq").
export function pedirRetido(filtro) {
  if (!cliente) return;
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
