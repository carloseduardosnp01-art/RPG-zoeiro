/* ==========================================================================
   Duelo da Zoeira · js/aviso.js
   Aviso do jogo: feito por fãs, sem fins comerciais, e quem joga está ciente
   de que nick, nome e imagem podem entrar na zoeira. Abre pelo rodapé e pelos
   links [data-abrir-aviso]. Quem tem conta e ainda não confirmou (contas de
   antes do aviso) vê a janela uma vez e confirma; a confirmação fica no perfil.
   ========================================================================== */

import * as conta from "./conta.js?v=202610040150";
import { aviso } from "./util.js?v=202610040150";

let modal = null;
let pediuNestaVisita = false;

const $ = (sel) => document.querySelector(sel);
const data = (t) => new Date(t).toLocaleDateString("pt-BR");

export function iniciarAviso() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-abrir-aviso]");
    if (!link) return;
    e.preventDefault();
    abrirAviso();
  });
  $("#aviso-ciente").addEventListener("click", () => {
    conta.marcarCiente();
    modal?.hide();
    aviso("Valeu! Agora é só zoeira. 🧑‍🦲", "ok");
  });
  // espera um pouco: o perfil do banco (que pode já ter a confirmação) chega logo depois de entrar
  conta.aoMudarUsuario(() => setTimeout(pedirCiencia, 4000));
  addEventListener("hashchange", () => setTimeout(pedirCiencia, 800));
  setTimeout(pedirCiencia, 4000); // sessão que já voltou sozinha ao abrir o site
}

export function abrirAviso() {
  const u = conta.usuarioAtual();
  const ciente = u && conta.estaCiente(u);
  const situacao = $("#aviso-situacao");
  situacao.hidden = !u;
  situacao.classList.toggle("aviso-situacao--pendente", Boolean(u && !ciente));
  if (ciente) situacao.textContent = `✔ ${u.nick}, você confirmou que está ciente deste aviso${u.ciente.t ? ` em ${data(u.ciente.t)}` : ""}.`;
  else if (u) situacao.textContent = `${u.nick}, confirme abaixo que leu e está ciente para continuar na zoeira.`;
  $("#aviso-ciente").hidden = !u || ciente;
  modal ||= new bootstrap.Modal("#modal-aviso");
  modal.show();
}

// Conta sem a confirmação: mostra o aviso uma vez por visita, sem atrapalhar duelo nem outra janela
function pedirCiencia() {
  const u = conta.usuarioAtual();
  if (!u || conta.estaCiente(u) || pediuNestaVisita) return;
  if (document.body.classList.contains("em-duelo") || document.querySelector(".modal.show")) return;
  pediuNestaVisita = true;
  abrirAviso();
}
