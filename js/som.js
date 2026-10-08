/* ==========================================================================
   Duelo da Zoeira · js/som.js
   Efeitos sonoros sintetizados com Web Audio (nenhum arquivo de áudio).
   ========================================================================== */

import { guardar } from "./util.js?v=202610080135";

let contexto = null;
let ligado = guardar.ler("zoeira-som", true);

function ctx() {
  if (!contexto) {
    const Classe = window.AudioContext || window.webkitAudioContext;
    if (!Classe) return null;
    contexto = new Classe();
  }
  if (contexto.state === "suspended") contexto.resume();
  return contexto;
}

// Um "bip" com envelope simples
function tom({ freq = 440, fim = freq, dur = 0.15, tipo = "sine", vol = 0.15, atraso = 0 }) {
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + atraso;
  const osc = c.createOscillator();
  const ganho = c.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, fim), t0 + dur);
  ganho.gain.setValueAtTime(0.0001, t0);
  ganho.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(ganho).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Ruído curto (impactos e explosões)
function ruido({ dur = 0.25, vol = 0.25, atraso = 0, grave = false }) {
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + atraso;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const dados = buffer.getChannelData(0);
  for (let i = 0; i < dados.length; i++) dados[i] = (Math.random() * 2 - 1) * (1 - i / dados.length) ** 2;
  const fonte = c.createBufferSource();
  fonte.buffer = buffer;
  const filtro = c.createBiquadFilter();
  filtro.type = "lowpass";
  filtro.frequency.value = grave ? 500 : 2500;
  const ganho = c.createGain();
  ganho.gain.value = vol;
  fonte.connect(filtro).connect(ganho).connect(c.destination);
  fonte.start(t0);
}

const EFEITOS = {
  clique: () => tom({ freq: 660, dur: 0.05, tipo: "triangle", vol: 0.06 }),
  carta: () => tom({ freq: 300, fim: 900, dur: 0.08, tipo: "triangle", vol: 0.08 }),
  invocacao: () => {
    tom({ freq: 220, fim: 880, dur: 0.35, tipo: "sawtooth", vol: 0.07 });
    tom({ freq: 440, fim: 1320, dur: 0.35, tipo: "sine", vol: 0.08, atraso: 0.05 });
  },
  magia: () => [523, 659, 784, 1046].forEach((f, i) => tom({ freq: f, dur: 0.22, tipo: "sine", vol: 0.08, atraso: i * 0.06 })),
  armadilha: () => {
    tom({ freq: 880, fim: 110, dur: 0.6, tipo: "square", vol: 0.06 });
    ruido({ dur: 0.5, vol: 0.2, atraso: 0.1 });
  },
  ataque: () => {
    tom({ freq: 900, fim: 120, dur: 0.22, tipo: "sawtooth", vol: 0.07 });
    ruido({ dur: 0.18, vol: 0.12, atraso: 0.12 });
  },
  destruida: () => ruido({ dur: 0.45, vol: 0.25, grave: true }),
  dano: () => tom({ freq: 160, fim: 60, dur: 0.35, tipo: "square", vol: 0.1 }),
  turno: () => [392, 523].forEach((f, i) => tom({ freq: f, dur: 0.18, tipo: "triangle", vol: 0.09, atraso: i * 0.12 })),
  vitoria: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tom({ freq: f, dur: 0.25, tipo: "triangle", vol: 0.1, atraso: i * 0.13 })),
  derrota: () => [392, 349, 311, 262].forEach((f, i) => tom({ freq: f, dur: 0.35, tipo: "sawtooth", vol: 0.06, atraso: i * 0.22 })),
  mensagem: () => tom({ freq: 1200, fim: 1500, dur: 0.07, tipo: "sine", vol: 0.05 }),
  desafio: () => [660, 880, 660, 880].forEach((f, i) => tom({ freq: f, dur: 0.12, tipo: "square", vol: 0.05, atraso: i * 0.14 })),
  lendaria: () => {
    tom({ freq: 90, fim: 260, dur: 0.5, tipo: "sawtooth", vol: 0.05 });
    ruido({ dur: 0.6, vol: 0.18, atraso: 0.4, grave: true });
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tom({ freq: f, dur: 0.3, tipo: "triangle", vol: 0.08, atraso: 0.42 + i * 0.07 }));
    [1046, 1318, 1568].forEach((f) => tom({ freq: f, dur: 1.1, tipo: "sine", vol: 0.045, atraso: 0.9 }));
  },
  // deus entrando: ronco grave, trovão e um acorde de metais
  divino: () => {
    tom({ freq: 45, fim: 110, dur: 0.7, tipo: "sawtooth", vol: 0.07 });
    ruido({ dur: 0.9, vol: 0.3, atraso: 0.28, grave: true });
    [196, 247, 294, 392].forEach((f) => tom({ freq: f, dur: 1.3, tipo: "sawtooth", vol: 0.035, atraso: 0.32 }));
    [784, 988, 1175].forEach((f, i) => tom({ freq: f, dur: 0.9, tipo: "triangle", vol: 0.05, atraso: 0.5 + i * 0.09 }));
  },
  vapo: () => {
    tom({ freq: 1400, fim: 40, dur: 0.9, tipo: "sawtooth", vol: 0.08 });
    ruido({ dur: 0.9, vol: 0.3, atraso: 0.05, grave: true });
  },
};

export function tocar(nome) {
  if (!ligado || !EFEITOS[nome]) return;
  try {
    EFEITOS[nome]();
  } catch { /* áudio indisponível */ }
}

export function somLigado() {
  return ligado;
}

export function alternarSom() {
  ligado = !ligado;
  guardar.gravar("zoeira-som", ligado);
  if (ligado) tocar("clique");
  return ligado;
}
