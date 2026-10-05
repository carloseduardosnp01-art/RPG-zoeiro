/* ==========================================================================
   Duelo da Zoeira · js/admin.js
   ADMs do jogo. Sem servidor, quem prova que é ADM é uma assinatura digital
   (ECDSA P-256): cada ADM tem uma chave secreta (só no aparelho dele) e o site
   de todo mundo tem a chave pública abaixo para conferir. Mensagens, presença
   e presentes de ADM vão assinados; sem assinatura válida, não vale.
   ========================================================================== */

import { guardar } from "./util.js?v=202610050107";

// Chaves públicas dos ADMs (as secretas ficam só com eles). Para trocar uma chave,
// gere um par novo e troque aqui: a antiga deixa de valer na hora.
const ADMINS = {
  menonice: { nick: "MenonICE", x: "8NKLNKDqxPWLxJtIieWw5KaHP2D111qsQ6QHyFS646c", y: "Xk-QHY4MEymPYXIGxIrw0R-M53ct7jhysGGVApURFmY" },
  menonfire: { nick: "MenonFIRE", x: "orHSRdGa52glic7QyTrd928EnwLEWm8KGWlLubsPZo4", y: "7bvNAaYlWwORWigpTNQpICQmPGZfS8NAoVP6zzzWcv0" },
};

const ALGORITMO = { name: "ECDSA", namedCurve: "P-256" };
const ASSINATURA = { name: "ECDSA", hash: "SHA-256" };
const CHAVE_LOCAL = "zoeira-adm";
const PREFIXO_CODIGO = "ZOEIRA-ADM:";

export const ehAdmin = (chave) => Object.prototype.hasOwnProperty.call(ADMINS, chave || "");
export const nomeDoAdmin = (chave) => (ehAdmin(chave) ? ADMINS[chave].nick : chave);

let privada = null; // chave secreta carregada neste aparelho
let dono = null;    // conta dona dessa chave
const publicas = {};
const verificados = new Set(); // ADMs com assinatura conferida nesta sessão

export const souAdm = (chave) => Boolean(privada) && dono === chave;
export const admVerificado = (chave) => verificados.has(chave);

const paraBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deBase64 = (txt) => Uint8Array.from(atob(txt), (c) => c.charCodeAt(0));
const bytes = (texto) => new TextEncoder().encode(texto);

function chavePublica(chave) {
  const p = ADMINS[chave];
  if (!p) return null;
  return (publicas[chave] ||= crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: p.x, y: p.y, ext: true }, ALGORITMO, false, ["verify"]));
}

async function importarCodigo(codigo) {
  const limpo = String(codigo || "").replace(/\s+/g, "").replace(PREFIXO_CODIGO, "");
  return crypto.subtle.importKey("pkcs8", deBase64(limpo), ALGORITMO, false, ["sign"]);
}

async function conferir(chave, texto, assinatura) {
  try {
    const pub = await chavePublica(chave);
    if (!pub || !assinatura) return false;
    return await crypto.subtle.verify(ASSINATURA, pub, deBase64(assinatura), bytes(texto));
  } catch {
    return false;
  }
}

// Ativa a chave de ADM neste aparelho (só depois de conferir que ela é mesmo dessa conta)
export async function ativarAdm(chave, codigo) {
  if (!ehAdmin(chave)) throw new Error("Esta conta não é de ADM.");
  if (!crypto.subtle) throw new Error("Este navegador não permite (é preciso HTTPS).");
  let chaveSecreta;
  try {
    chaveSecreta = await importarCodigo(codigo);
  } catch {
    throw new Error("Código inválido. Cole a linha inteira que começa com ZOEIRA-ADM:");
  }
  const teste = `teste|${chave}|${Date.now()}`;
  const sig = paraBase64(await crypto.subtle.sign(ASSINATURA, chaveSecreta, bytes(teste)));
  if (!(await conferir(chave, teste, sig))) throw new Error("Esse código não é a chave de ADM desta conta.");
  privada = chaveSecreta;
  dono = chave;
  verificados.add(chave);
  guardar.gravar(CHAVE_LOCAL, { chave, codigo: String(codigo).trim() });
}

// Ao entrar na conta: carrega a chave guardada neste aparelho (se houver)
export async function carregarAdm(chave) {
  privada = null;
  dono = null;
  const salvo = guardar.ler(CHAVE_LOCAL, null);
  if (!salvo || salvo.chave !== chave || !ehAdmin(chave)) return false;
  try {
    await ativarAdm(chave, salvo.codigo);
    return true;
  } catch {
    return false;
  }
}

export function desativarAdm() {
  privada = null;
  dono = null;
  guardar.apagar(CHAVE_LOCAL);
}

async function assinarTexto(texto) {
  return paraBase64(await crypto.subtle.sign(ASSINATURA, privada, bytes(texto)));
}


/* ---------- O que é assinado ---------- */

const textoMsg = (m) => `msg|${m.id}|${m.tipo}|${m.de?.chave}|${m.texto}|${m.t}`;
const textoPresenca = (p) => `presenca|${p.sid}|${p.chave}|${p.t}`;
const textoPresente = (p) => `presente|${p.id}|${p.para}|${p.coins}|${p.motivo}|${p.de}|${p.t}`;

// Assina (se eu for ADM neste aparelho) e devolve o objeto com "assinatura"
export async function assinarMsg(m) {
  return souAdm(m.de?.chave) ? { ...m, assinatura: await assinarTexto(textoMsg(m)) } : m;
}

export async function assinarPresenca(p) {
  return souAdm(p.chave) ? { ...p, assinatura: await assinarTexto(textoPresenca(p)) } : p;
}

export async function assinarPresente(p) {
  if (!souAdm(p.de)) throw new Error("Só ADM pode dar presentes.");
  return { ...p, assinatura: await assinarTexto(textoPresente(p)) };
}

async function marcar(chave, ok) {
  if (ok) verificados.add(chave);
  return ok;
}

export async function verificarMsg(m) {
  return ehAdmin(m?.de?.chave) && marcar(m.de.chave, await conferir(m.de.chave, textoMsg(m), m.assinatura));
}

export async function verificarPresenca(p) {
  return ehAdmin(p?.chave) && marcar(p.chave, await conferir(p.chave, textoPresenca(p), p.assinatura));
}

export async function verificarPresente(p) {
  return Boolean(p) && ehAdmin(p.de) && Number.isInteger(p.coins) && p.coins > 0 && p.coins <= 100000 && conferir(p.de, textoPresente(p), p.assinatura);
}


/* ---------- Troféus, relíquias e torneio ---------- */

// Prêmio: { id, item ("ouro", "prata", "bronze", "careca-do-milenio"), torneio, para, de, deNick, t, assinatura }
const textoPremio = (p) => `premio|${p.id}|${p.item}|${p.torneio}|${p.para}|${p.de}|${p.t}`;
// Torneio: o estado inteiro, assinado pelo ADM que organiza
const textoTorneio = (t) => {
  const { assinatura, ...resto } = t;
  return `torneio|${JSON.stringify(resto)}`;
};

export async function assinarPremio(p) {
  if (!souAdm(p.de)) throw new Error("Só ADM pode dar troféus e relíquias.");
  return { ...p, assinatura: await assinarTexto(textoPremio(p)) };
}

// As telas conferem os mesmos prêmios muitas vezes: guarda a resposta por assinatura
const premiosConferidos = new Map();
export function verificarPremio(p) {
  if (!p || !ehAdmin(p.de) || typeof p.item !== "string" || !p.assinatura) return Promise.resolve(false);
  const chave = `${p.id}|${p.assinatura}`;
  if (!premiosConferidos.has(chave)) premiosConferidos.set(chave, conferir(p.de, textoPremio(p), p.assinatura));
  return premiosConferidos.get(chave);
}

export async function assinarTorneio(t) {
  if (!souAdm(t.organizador)) throw new Error("Só o ADM que criou o torneio pode mexer nele.");
  return { ...t, assinatura: await assinarTexto(textoTorneio(t)) };
}

export async function verificarTorneio(t) {
  return Boolean(t) && ehAdmin(t.organizador) && conferir(t.organizador, textoTorneio(t), t.assinatura);
}
