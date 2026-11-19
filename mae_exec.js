/* mae_exec.js — botões "▶ Executar no site" nos campos de script das abas.
   Usa a conexão do painel "Executar no MAE" (aba Entrada / mae_bridge.js).
   · Remove comentários e linhas que não são comando MML antes de executar.
   · Executa serialmente (um comando por vez) no site carregado (#neLbl).
   · Tela de acompanhamento com % e status de cada linha.
   · Baseline: repete no fim as linhas que falharam e sugere ajuste na ordem. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  if (!window.MAE) { console.warn("[MAE] mae_bridge.js não carregado"); return; }

  // campo do script · botão ao lado do qual entra o "Executar" · nome na tela · opções
  var FIELDS = [
    { id: "out",      after: "btnCopyOut", name: "Inter-Freq · 3 Script" },
    { id: "clOut",    after: "clCopy",     name: "Inter-Freq · 5 Clonar / Redeclarar" },
    { id: "ir43Out",  after: "ir43Copy",   name: "Inter-Freq · 6 UTRANNFREQ (BTS)" },
    { id: "modCmds",  after: "copyMod",    name: "Conexão física · comandos" },
    { id: "pwScript", after: "pwCopy",     name: "Potência · script" },
    { id: "pwRb",     after: "pwCopyRb",   name: "Potência · rollback", label: "▶ Executar rollback" },
    { id: "output",   after: "copy",       name: "Baseline · saída gerada", retry: true },
    { id: "rs4Out",   after: "rs4Copy",    name: "RS_4G · script", guard: true, askOnFail: true, site: rs4Site },
    { id: "r4TxOut",  after: "r4TxCopy",   name: "RS_4G · TX VIVO", guard: "tx", askOnFail: true, site: rs4Site },
    { id: "r4TxPingOut", after: "r4TxPingAnchor", name: "RS_4G · só PING VIVO", guard: "tx", askOnFail: true, site: rs4Site, label: "▶ Testar só os PINGs com o core VIVO" }
  ];
  var BATCH = 5;
  var MML_RE = /^(?:[A-Z][A-Z0-9]*\s+[A-Z0-9_]+|PING)\s*:.*;$/i;       // PING não tem objeto ("PING:SN=...;")
  var PSEUDO_RE = /^#(WAIT|UNTIL)\b/i;

  // ---------- estilo ----------
  var st = document.createElement("style");
  st.textContent = [
    "button.mae-run{font-family:'Segoe UI',Arial,sans-serif;font-weight:600;font-size:13px;border-radius:6px;padding:7px 13px;cursor:pointer;border:1px solid #16613a;background:#16613a;color:#fff;margin-left:6px}",
    "button.mae-run:hover{background:#0f4a2b}button.mae-run:disabled{opacity:.5;cursor:not-allowed}",
    "#mxOv{position:fixed;inset:0;background:rgba(15,20,30,.55);z-index:9998;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1d2433}",
    "#mxBox{background:#fff;border-radius:12px;width:min(1180px,96vw);height:min(900px,92vh);display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden}",
    "#mxHead{padding:14px 18px 10px;border-bottom:1px solid #dfe3eb}",
    "#mxHead h3{margin:0;font-size:17px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}",
    "#mxHead h3 small{font-weight:400;color:#667085;font-size:13px}",
    "#mxBar{height:14px;background:#eceef2;border-radius:7px;overflow:hidden;margin:10px 0 6px;position:relative}",
    "#mxFill{height:100%;width:0;background:#16613a;transition:width .25s}#mxFill.p2{background:#4f63d8}",
    "#mxPct{position:absolute;inset:0;text-align:center;font:600 11px/14px Consolas,monospace;color:#1d2433}",
    "#mxStats{display:flex;gap:14px;flex-wrap:wrap;color:#667085}#mxStats b{color:#1d2433}",
    ".mx-ok{color:#16613a!important}.mx-er{color:#c7000b!important}.mx-rt{color:#4f63d8!important}",
    "#mxBody{flex:1;overflow:auto;padding:0 18px 12px}",
    "#mxBody table{border-collapse:collapse;width:100%;font:12.5px/1.35 Consolas,'Courier New',monospace}",
    "#mxBody th{position:sticky;top:0;background:#f7f8fb;color:#667085;font-weight:500;text-align:left;padding:6px 8px;border-bottom:1px solid #dfe3eb;z-index:1}",
    "#mxBody td{padding:4px 8px;border-bottom:1px solid #eef0f4;vertical-align:top}",
    "#mxBody td.n{color:#98a2b3;text-align:right;width:44px}#mxBody td.s{width:118px;white-space:nowrap;font-family:'Segoe UI',Arial,sans-serif}",
    "#mxBody td.c{word-break:break-all}#mxBody td.m{color:#8a5a00;width:34%;font-family:'Segoe UI',Arial,sans-serif}",
    "#mxBody tr.run td{background:#fff8e1}#mxBody tr.er td{background:#fdecec}#mxBody tr.rt td{background:#eef0ff}",
    "#mxBody.onlyfail tr.ok,#mxBody.onlyfail tr.pd{display:none}",
    "#mxFoot{padding:10px 18px;border-top:1px solid #dfe3eb;display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    "#mxFoot button{font-family:'Segoe UI',Arial,sans-serif;font-weight:600;font-size:13px;border-radius:6px;padding:8px 14px;cursor:pointer;border:1px solid #dfe3eb;background:#fff;color:#1d2433}",
    "#mxFoot button.pri{background:#16613a;border-color:#16613a;color:#fff}#mxFoot button.dan{background:#c7000b;border-color:#c7000b;color:#fff}",
    "#mxFoot button:disabled{opacity:.45;cursor:not-allowed}#mxFoot .sp{flex:1}",
    "#mxFoot label{color:#667085;display:flex;gap:5px;align-items:center}",
    ".mx-card{border:1px solid #dfe3eb;border-radius:10px;padding:12px 14px;margin:12px 0}",
    ".mx-card h4{margin:0 0 8px;font-size:14px}.mx-card p{margin:6px 0;color:#475467}",
    ".mx-warn{background:#fff3dc;color:#8a5a00;border-radius:6px;padding:8px 10px;margin:8px 0}",
    "#mxAsk{margin-top:8px;border:2px solid #c7000b;background:#fdecec;border-radius:8px;padding:8px 12px;color:#7a0007}",
    "#mxAsk .bt{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}",
    "#mxAsk button{font-family:'Segoe UI',Arial,sans-serif;font-weight:600;font-size:13px;border-radius:6px;padding:7px 13px;cursor:pointer;border:1px solid #dfe3eb;background:#fff;color:#1d2433}",
    "#mxAsk button.pri{background:#16613a;border-color:#16613a;color:#fff}#mxAsk button.dan{background:#c7000b;border-color:#c7000b;color:#fff}",
    "#mxMini{position:fixed;right:18px;bottom:18px;z-index:9997;max-width:min(520px,90vw);font:600 13px 'Segoe UI',Arial,sans-serif;border:0;border-radius:22px;padding:10px 16px;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.28);background:#1d2433;color:#fff;text-align:left}",
    "#mxMini.ok{background:#16613a}#mxMini.er{background:#c7000b}#mxMini small{display:block;font-weight:400;opacity:.85;font-size:11.5px}",
    ".mx-pre{background:#111827;color:#a7f3d0;font:12.5px/1.4 Consolas,monospace;border-radius:6px;padding:8px 10px;max-height:150px;overflow:auto;white-space:pre}"
  ].join("\n");
  document.head.appendChild(st);

  // ---------- leitura do script ----------
  function readField(id) { var el = $(id); if (!el) return ""; return el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value : el.textContent; }
  function cleanScript(txt) {
    var cmds = [], skipped = [];
    String(txt || "").split(/\r?\n/).forEach(function (raw, n) {
      var l = raw.trim();
      if (!l || /^(\/\/|\/\*|\*|--|;)/.test(l)) return;               // vazio ou comentário
      if (PSEUDO_RE.test(l)) { cmds.push({ line: n + 1, cmd: l }); return; }
      l = l.replace(/;\s*\/\/.*$/, ";").replace(/;\s*\/\*.*\*\/\s*$/, ";").trim(); // comentário no fim da linha
      if (MML_RE.test(l)) cmds.push({ line: n + 1, cmd: l });
      else skipped.push(raw.trim());
    });
    return { cmds: cmds, skipped: skipped };
  }
  // RS_4G: roda no site escolhido na própria aba (não no da Entrada)
  function rs4Site() { try { return (window.RS4G && window.RS4G._t.state.site) || ""; } catch (e) { return ""; } }
  function siteName() { return (($("neLbl") && $("neLbl").textContent) || "").trim(); }
  // nome do NE no cabeçalho "+++    NOME   data" das respostas da Rodada 1 (ignora "NMS SERVER")
  function siteFromR1() {
    var t = ($("uniIn") && $("uniIn").value) || "", re = /^\s*\+\+\+\s+(\S+)/gm, m;
    while ((m = re.exec(t))) if (!/^NMS$/i.test(m[1])) return m[1];
    return "";
  }
  function retMsg(resp) {
    var m = /RETCODE\s*=\s*(\d+)\s+([^\r\n]*)/.exec(resp || "");
    if (m) return m[1] === "0" ? "" : m[1] + " · " + m[2].trim();
    if (/\[TIMEOUT/.test(resp || "")) return "sem resposta (timeout)";
    return (resp || "").trim().split(/\r?\n/).slice(-1)[0] || "sem RETCODE";
  }
  function parseCmd(c) {
    var m = /^([A-Z]+)\s+([A-Z0-9_]+)\s*:(.*);$/i.exec(c) || [];
    var params = (m[3] || "").split(",").map(function (p) { return p.trim().toUpperCase(); }).filter(Boolean);
    return { verb: (m[1] || "").toUpperCase(), obj: (m[2] || "").toUpperCase(), first: params[0] || "", params: params };
  }

  // ---------- tela ----------
  var ov = null, items = [], abort = false, running = false, field = null, ne = "", stopMsg = "", lastAid = "", labelOk = null, stopAt = null, askRes = null, endTxt = "";
  function openScreen(f, cmds, skipped) {
    field = f; ne = (f.site && f.site()) || siteName(); abort = false;
    items = cmds.map(function (c, i) { return { idx: i, line: c.line, cmd: c.cmd, st: "pd", msg: "", msg1: "", resp: "" }; });
    if (ov) ov.remove();
    endTxt = ""; stopAt = null;
    ov = document.createElement("div"); ov.id = "mxOv";
    var writes = cmds.filter(function (c) { return /^(ADD|MOD|RMV|SET|ACT|DLD|RST|BLK|UBL|STR|STP|DEA|DEL)\s/i.test(c.cmd); }).length;
    var known = (window.MAE.neList() || []).some(function (n) { return n.name === ne; });
    ov.innerHTML =
      '<div id="mxBox" role="dialog" aria-modal="true">' +
        '<div id="mxHead"><h3>' + esc(f.label ? f.label.replace("▶ ", "") : "Executar no site") + ' <small>' + esc(f.name) + '</small></h3>' +
          '<div id="mxSite" style="margin-top:6px">Site: <b>' + esc(ne) + '</b> · <b>' + cmds.length + '</b> comandos' +
            (writes ? ' (<b class="mx-er">' + writes + ' de alteração</b>)' : '') +
            (skipped.length ? ' · ' + skipped.length + ' linha(s) que não são comando foram ignoradas' : '') +
            (f.retry ? ' · falhas são repetidas no fim' : '') + '</div>' +
          '<div id="mxBar"><div id="mxFill"></div><div id="mxPct">0%</div></div>' +
          '<div id="mxStats"></div><div id="mxAsk" hidden></div></div>' +
        '<div id="mxBody">' +
          (!known && (window.MAE.neList() || []).length ? '<div class="mx-warn">⚠ ' + esc(ne) + ' não está na lista de NEs do MAE.</div>' : '') +
          (skipped.length ? '<details style="margin:8px 0"><summary class="mx-warn" style="cursor:pointer">Linhas ignoradas (não parecem comando MML): ' + skipped.length + '</summary><div class="mx-pre">' + esc(skipped.slice(0, 200).join("\n")) + '</div></details>' : '') +
          '<div id="mxAna"></div>' +
          '<table><thead><tr><th>#</th><th>Status</th><th>Comando</th><th>Mensagem do MAE</th></tr></thead><tbody id="mxRows">' +
          items.map(function (it) { return '<tr class="pd" id="mxr' + it.idx + '"><td class="n">' + it.line + '</td><td class="s">• aguardando</td><td class="c">' + esc(it.cmd) + '</td><td class="m"></td></tr>'; }).join("") +
          '</tbody></table></div>' +
        '<div id="mxFoot">' +
          '<button class="pri" id="mxGo">▶ Executar agora em ' + esc(ne) + '</button>' +
          '<button class="dan" id="mxStop" disabled>Parar</button>' +
          '<button class="pri" id="mxResume" hidden></button>' +
          '<button id="mxMin" hidden title="Esconde esta janela para navegar nas outras abas; a execução continua. Use o aviso no canto da tela para voltar.">⤓ Minimizar (navegar nas abas)</button>' +
          '<label><input type="checkbox" id="mxOnlyFail"> só falhas</label>' +
          '<span class="sp"></span>' +
          '<button id="mxCopyFail" disabled>Copiar falhas</button>' +
          '<button id="mxReorder" disabled hidden>Copiar script com ordem sugerida</button>' +
          '<button id="mxExport" disabled>Exportar log (.txt)</button>' +
          '<button id="mxClose">Fechar</button>' +
        '</div></div>';
    document.body.appendChild(ov);
    stats();
    $("mxGo").onclick = function () { run(); };
    $("mxStop").onclick = function () { abort = true; $("mxStop").disabled = true; $("mxStop").textContent = "Parando…"; if (askRes) askRes("stop"); };
    $("mxMin").onclick = minimize;
    $("mxClose").onclick = function () {
      if (running && !confirm("A execução está em andamento. Parar e fechar?\n\n(Para só navegar nas outras abas sem parar, use “Minimizar”.)")) return;
      abort = true; if (askRes) askRes("stop"); ov.remove(); ov = null; mini();
    };
    $("mxOnlyFail").onchange = function () { $("mxBody").classList.toggle("onlyfail", this.checked); };
    $("mxCopyFail").onclick = function () { copy(items.filter(function (it) { return it.st === "er"; }).map(function (it) { return it.cmd; }).join("\n"), this); };
    $("mxExport").onclick = exportLog;
  }

  function setRow(it) {
    var tr = $("mxr" + it.idx); if (!tr) return;
    var lab = { pd: "• aguardando", run: "⏳ executando", ok: "✔ ok", er: "✖ falhou", rt: field && field.retry ? "↻ ok na 2ª" : "↻ ok ao repetir", er2: "✖ falhou 2×" }[it.st];
    tr.className = it.st === "er2" ? "er" : it.st;
    tr.children[1].innerHTML = '<span class="' + ({ ok: "mx-ok", er: "mx-er", er2: "mx-er", rt: "mx-rt" }[it.st] || "") + '">' + lab + "</span>";
    tr.children[3].textContent = it.st === "rt" ? "1ª: " + it.msg1 : it.msg;
  }
  function stats(phase, done, total) {
    if (!ov) { mini(); return; }
    var c = { ok: 0, er: 0, rt: 0, er2: 0, pd: 0 };
    items.forEach(function (it) { c[it.st === "run" ? "pd" : it.st]++; });
    var pct = total ? Math.round(done * 100 / total) : 0;
    $("mxFill").style.width = pct + "%"; $("mxFill").className = phase === 2 ? "p2" : "";
    $("mxPct").textContent = (phase === 2 ? "2ª tentativa · " : "") + pct + "%" + (total ? " (" + done + "/" + total + ")" : "");
    $("mxStats").innerHTML = '<span class="mx-ok">✔ <b class="mx-ok">' + c.ok + '</b> ok</span>' +
      (field && (field.retry || c.rt) ? '<span class="mx-rt">↻ <b class="mx-rt">' + c.rt + '</b> ' + (field.retry ? "ok na 2ª" : "ok ao repetir") + '</span>' : '') +
      '<span class="mx-er">✖ <b class="mx-er">' + (c.er + c.er2) + '</b> falha(s)</span><span>• <b>' + c.pd + '</b> pendente(s)</span>';
    mini();
  }

  // ---------- minimizar: a janela some, a execução continua e um aviso no canto leva de volta ----------
  function minimize() { if (!ov) return; ov.style.display = "none"; mini(); }
  function showOv() { if (ov) ov.style.display = ""; mini(); }
  function mini() {
    var m = $("mxMini");
    if (!m) { m = document.createElement("button"); m.type = "button"; m.id = "mxMini"; m.onclick = showOv; document.body.appendChild(m); }
    if (!ov || ov.style.display !== "none") { m.hidden = true; return; }
    var c = count(), done = items.length - c.pd - c.run, pct = items.length ? Math.round(done * 100 / items.length) : 0;
    m.hidden = false;
    m.className = running ? "" : (c.er + c.er2 || /✖/.test(endTxt) ? "er" : "ok");
    m.innerHTML = (running ? "⏳ " + esc(field.name) + " · " + pct + "% (" + done + "/" + items.length + ")" : esc((endTxt || "Execução terminada") + " · " + field.name)) +
      "<small>" + esc(ne) + " · " + c.ok + " ok" + ((c.er + c.er2) ? " · " + (c.er + c.er2) + " falha(s)" : "") + " — clique para abrir</small>";
    m.title = "Abrir a janela da execução";
  }

  // ---------- comandos vigiados (só no script RS_4G: field.guard) ----------
  // CFM CB: não pode falhar → 2ª tentativa com outro NAME → se falhar de novo, pergunta antes de seguir.
  // DSP APP: só segue com o Application State do eNodeB = Available; senão espera 20 s e consulta de novo.
  // TX VIVO (field.guard "tx"): PING roda sozinho e só depois sai o próximo (OK/NOK pela resposta);
  // MOD DEVIP de USERLABEL só roda depois de confirmar.
  function isPing(it) { return /^PING\s*:/i.test(it.cmd); }
  function isLabel(it) { return /^MOD\s+DEVIP\s*:.*USERLABEL\s*=/i.test(it.cmd); }
  function isGuard(it) {
    if (!field || !field.guard) return false;
    if (field.guard === "tx") return isPing(it) || isLabel(it) || /^CFM\s+CB\s*:/i.test(it.cmd);
    return /^(CFM\s+CB|DSP\s+APP)\s*:/i.test(it.cmd);
  }
  function pingParse(resp) {
    if (window.RS4G && window.RS4G.pingParse) return window.RS4G.pingParse(resp);
    var ok = /RETCODE\s*=\s*0\b/.test(resp || "") && /reply from|bytes\s*=/i.test(resp || "");
    return { known: /RETCODE/.test(resp || ""), ok: ok, msg: ok ? "OK" : retMsg(resp) || "NOK" };
  }
  async function guardPing(it) {
    var dst = (/DSTIP\s*=\s*"?([\d.]+)/i.exec(it.cmd) || [])[1] || "";
    var x = await runOne(it.cmd), resp = x.resp || "", r = pingParse(resp);
    // se o resultado chegou depois do RETCODE, o helper entrega a sobra junto com a próxima resposta
    for (var n = 1; !r.known && !/RETCODE\s*=\s*[1-9]/.test(resp) && n <= 4 && !abort; n++) {
      it.msg = "aguardando o fim do PING (" + n + "/4)…"; setRow(it);
      if (!(await sleep(5000))) break;
      var y = await runOne("LST ENODEBFUNCTION:;");
      var extra = String(y.resp || ""), cut = extra.search(/%%(?:\/\*\d+\*\/)?\s*LST\s+ENODEBFUNCTION/i);
      resp += "\n" + (cut > 0 ? extra.slice(0, cut) : "");
      r = pingParse(resp);
    }
    it.resp += resp;
    it.st = r.ok ? "ok" : "er"; it.msg = (r.msg || (r.ok ? "OK" : "NOK")) + (dst ? " · " + dst : ""); setRow(it);
    try { window.dispatchEvent(new CustomEvent("mae:ping", { detail: { ne: ne, ip: dst, ok: r.ok, msg: r.msg, resp: resp } })); } catch (e) {}
    window.MAE.log("PING " + dst + " em " + ne + ": " + (r.msg || (r.ok ? "OK" : "NOK")), r.ok ? "ok" : "er");
    return true;                                                   // PING NOK não para: segue para o próximo teste
  }
  async function guardLabel(it) {
    if (labelOk === null) {
      var l = items.filter(isLabel).map(function (x) { return "  " + x.cmd; });
      labelOk = confirm("Ajustar o USER LABEL de " + l.length + " IP(s) em " + ne + "?\n\n" + l.join("\n") + "\n\nOK = executar · Cancelar = pular só estes MOD DEVIP");
    }
    if (!labelOk) { it.st = "pd"; it.msg = "pulado (USER LABEL não confirmado)"; setRow(it); return true; }
    var x = await runOne(it.cmd);
    it.resp += x.resp || ""; it.st = x.ok ? "ok" : "er"; it.msg = x.ok ? "" : retMsg(x.resp); setRow(it);
    if (!x.ok && field.askOnFail && !(await recover(it))) return false;
    return true;
  }
  function sleep(ms) {
    return new Promise(function (res) {
      var t0 = Date.now(), h = setInterval(function () { if (abort || Date.now() - t0 >= ms) { clearInterval(h); res(!abort); } }, 250);
    });
  }
  async function runOne(cmd) {
    var r = await window.MAE.api("/run", { ne: ne, cmds: [cmd], stopOnError: false });
    if (r[0] && /^REG NE/.test(r[0].cmd)) {
      if (!r[0].ok) throw new Error("REG NE falhou para " + ne + ": " + retMsg(r[0].resp));
      r = r.slice(1);
    }
    return r[0] || { ok: false, resp: "sem resposta do helper" };
  }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return p(d.getDate()) + p(d.getMonth() + 1) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
  async function guardCfm(it) {
    var x = await runOne(it.cmd);
    it.resp += x.resp || "";
    if (x.ok) { it.st = "ok"; setRow(it); return true; }
    var m1 = retMsg(x.resp), m = /NAME\s*=\s*"([^"]*)"/i.exec(it.cmd), base = (m ? m[1] : "Pre_RS").slice(0, 20);
    var cmd2 = m ? it.cmd.replace(/NAME\s*=\s*"[^"]*"/i, 'NAME="' + base + "_" + stamp() + '"') : it.cmd.replace(/:/, ':NAME="' + base + "_" + stamp() + '",');
    it.msg = "1ª falhou (" + m1 + ") · tentando " + (/NAME\s*=\s*"[^"]*"/i.exec(cmd2) || [""])[0]; setRow(it);
    var x2 = await runOne(cmd2);
    it.resp += "\n----- 2ª tentativa: " + cmd2 + " -----\n" + (x2.resp || "");
    var tr = $("mxr" + it.idx); if (tr) tr.children[2].textContent = cmd2;
    if (x2.ok) { it.cmd = cmd2; it.msg1 = m1; it.st = "rt"; setRow(it); window.MAE.log("CFM CB: 1º nome falhou, ok com " + cmd2, "in"); return true; }
    it.st = "er2"; it.msg = retMsg(x2.resp); setRow(it);
    var go = confirm("O CFM CB (ponto de rollback) falhou 2 vezes em " + ne + ".\n\n1ª: " + it.cmd + "\n   → " + m1 + "\n2ª: " + cmd2 + "\n   → " + it.msg +
      "\n\nOK = continuar SEM ponto de rollback\nCancelar = parar a execução aqui");
    if (!go) stopMsg = "Parado: CFM CB falhou 2 vezes (" + it.msg + ").";
    return go;
  }
  function appState(resp, aid) {
    var L = String(resp || "").replace(/\r/g, "").replace(/\t/g, "    ").split("\n"), recs = [], i, j;
    for (i = 0; i < L.length; i++) {
      if (/application\s+state/i.test(L[i]) && !/=/.test(L[i])) {
        var h = L[i].trim().split(/\s{2,}/);
        for (j = i + 1; j < L.length; j++) {
          var t = L[j].trim(); if (!t || /^-+$/.test(t)) continue;
          if (/^\(Number|^---|^\+\+\+|^%%|^RETCODE|^To be continued/.test(t)) break;
          var c = t.split(/\s{2,}/); if (c.length < 2) continue;
          var o = {}; h.forEach(function (k, x) { o[k.toLowerCase()] = c[x] || ""; }); recs.push(o);
        }
        break;
      }
    }
    if (!recs.length) {
      var cur = null;
      L.forEach(function (l) {
        var m = /^\s*([A-Za-z][A-Za-z0-9 ._()\/-]*?)\s+=\s+(.*)$/.exec(l); if (!m) return;
        var k = m[1].trim().toLowerCase(); if (!cur || cur[k] !== undefined) { cur = {}; recs.push(cur); } cur[k] = m[2].trim();
      });
    }
    var g = function (r, re) { for (var k in r) if (re.test(k)) return r[k]; return ""; };
    recs = recs.filter(function (r) { return g(r, /application\s+state/) !== ""; });
    if (!recs.length) return "";
    var pick = recs.filter(function (r) { return aid && g(r, /application\s+id|^aid$/) === String(aid); })[0] ||
      recs.filter(function (r) { return Object.keys(r).some(function (k) { return /enodeb/i.test(r[k]); }); })[0] ||
      (recs.length === 1 ? recs[0] : null);
    return pick ? g(pick, /application\s+state/) : "";
  }
  async function guardApp(it) {
    var aid = (/AID\s*=\s*(\d+)/i.exec(it.cmd) || [])[1] || lastAid;
    for (var n = 1; ; n++) {
      var x = await runOne(it.cmd);
      it.resp += (it.resp ? "\n----- consulta " + n + " -----\n" : "") + (x.resp || "");
      var st = x.ok ? appState(x.resp, aid) : "";
      if (/^available$/i.test(st)) { it.st = "ok"; it.msg = "eNodeB Available" + (n > 1 ? " (" + n + "ª consulta)" : ""); setRow(it); return true; }
      it.st = "run";
      it.msg = (x.ok ? "Application State do eNodeB = " + (st || "não identificado") : retMsg(x.resp)) + " · consulta " + n + " · aguardando 20 s…";
      setRow(it);
      if (n % 15 === 0 && !confirm("O eNodeB" + (aid ? " (AID " + aid + ")" : "") + " ainda não está Available em " + ne + " após " + n + " consultas (~" + Math.round(n * 20 / 60) + " min).\nÚltimo estado: " + (st || "não identificado") + "\n\nOK = continuar esperando\nCancelar = parar a execução")) {
        it.st = "er"; it.msg = "eNodeB não ficou Available (" + (st || "?") + ")"; setRow(it);
        stopMsg = "Parado: eNodeB não ficou Available após " + n + " consultas.";
        return false;
      }
      if (!(await sleep(20000))) { it.st = "pd"; it.msg = ""; setRow(it); return false; }
    }
  }

  // RS_4G: comando com erro → pergunta: executar de novo (e seguir daqui se der certo), pular ou parar
  function ask(it) {
    return new Promise(function (res) {
      showOv();
      var b = $("mxAsk");
      askRes = function (a) { askRes = null; b.hidden = true; b.innerHTML = ""; b.onclick = null; res(a); };
      b.innerHTML = '<b>✖ O comando da linha ' + it.line + ' falhou em ' + esc(ne) + ':</b><div class="mx-pre" style="margin:6px 0;max-height:70px">' + esc(it.cmd) + '</div>→ ' + esc(it.msg || "erro") +
        '<div class="bt"><button class="pri" type="button" data-a="retry">↻ Executar este comando de novo</button><button type="button" data-a="skip">Pular e continuar</button><button class="dan" type="button" data-a="stop">Parar aqui</button></div>' +
        '<div style="font-size:12px;margin-top:6px">Se a nova tentativa der certo, a execução continua a partir daqui. Se parar, dá para continuar depois com <b>Continuar da linha ' + it.line + '</b>.</div>';
      b.onclick = function (e) { var a = e.target.getAttribute && e.target.getAttribute("data-a"); if (a && askRes) askRes(a); };
      b.hidden = false;
      var tr = $("mxr" + it.idx); if (tr) tr.scrollIntoView({ block: "nearest" });
    });
  }
  // devolve true = seguir com os próximos · false = parar. "System Busy" repete sozinho (até 2×, 20 s entre elas)
  async function recover(it) {
    var m0 = it.msg, auto = 0;
    for (;;) {
      var a;
      if (abort) a = "stop";
      else if (/busy/i.test(it.msg || "") && auto < 2) {
        auto++; it.st = "run"; it.msg = "System Busy — esperando 20 s para repetir sozinho (" + auto + "/2)…"; setRow(it);
        a = (await sleep(20000)) ? "retry" : "stop";
      } else a = await ask(it);
      if (a === "stop") { stopAt = it.idx; if (it.st === "run") { it.st = "er"; it.msg = m0; setRow(it); } stopMsg = stopMsg || "Parado após o erro na linha " + it.line + ": " + it.cmd + " → " + (it.msg || "erro") + "."; return false; }
      if (a === "skip") { window.MAE.log("Pulado após erro em " + ne + ": " + it.cmd, "in"); return true; }
      it.st = "run"; it.msg = "executando de novo…"; setRow(it);
      var x;
      try { x = await runOne(it.cmd); } catch (e) { it.st = "er"; it.msg = e.message; setRow(it); continue; }
      it.resp += "\n----- nova tentativa -----\n" + (x.resp || "");
      if (x.ok) { it.msg1 = m0; it.msg = ""; it.st = "rt"; setRow(it); window.MAE.log("OK ao repetir em " + ne + ": " + it.cmd, "ok"); return true; }
      it.st = "er"; it.msg = retMsg(x.resp); setRow(it);
    }
  }
  async function runList(list, phase) {
    var i = 0;
    while (i < list.length) {
      if (abort) return false;
      if (phase === 1 && isGuard(list[i])) {
        var g = list[i]; g.st = "run"; setRow(g);
        var tg = $("mxr" + g.idx); if (tg && !$("mxOnlyFail").checked) tg.scrollIntoView({ block: "nearest" });
        var go = isPing(g) && field.guard === "tx" ? await guardPing(g) : isLabel(g) && field.guard === "tx" ? await guardLabel(g) : /^CFM/i.test(g.cmd) ? await guardCfm(g) : await guardApp(g);
        i++; stats(phase, i, list.length);
        if (!go) { if (g.st !== "ok" && g.st !== "rt" && stopAt == null) stopAt = g.idx; abort = true; return false; }
        continue;
      }
      var part = [];
      var ask = !!(field.askOnFail && phase === 1);
      while (i < list.length && part.length < BATCH && !(phase === 1 && isGuard(list[i]))) part.push(list[i++]);
      part.forEach(function (it) { it.st = "run"; setRow(it); var m = /^RST\s+APP\s*:.*AID\s*=\s*(\d+)/i.exec(it.cmd); if (m) lastAid = m[1]; });
      var tr = $("mxr" + part[0].idx); if (tr && !$("mxOnlyFail").checked) tr.scrollIntoView({ block: "nearest" });
      var r;
      try {
        r = await window.MAE.api("/run", { ne: ne, cmds: part.map(function (it) { return it.cmd; }), stopOnError: ask });
      } catch (e) {
        part.forEach(function (it) { it.st = "pd"; setRow(it); });
        throw e;
      }
      if (r[0] && /^REG NE/.test(r[0].cmd)) {
        if (!r[0].ok) { part.forEach(function (it) { it.st = "pd"; setRow(it); }); throw new Error("REG NE falhou para " + ne + ": " + retMsg(r[0].resp)); }
        r = r.slice(1);
      }
      if (ask && r.length && r.length < part.length) {                         // o helper parou no erro: o resto volta para a fila
        var back = part.length - r.length; part.slice(r.length).forEach(function (it) { it.st = "pd"; setRow(it); });
        part = part.slice(0, r.length); i -= back;
      }
      part.forEach(function (it, k) {
        var x = r[k] || { ok: false, resp: "sem resposta do helper" };
        it.resp += (it.resp ? "\n----- 2ª tentativa -----\n" : "") + (x.resp || "");
        if (phase === 1) { it.st = x.ok ? "ok" : "er"; it.msg = x.ok ? "" : retMsg(x.resp); }
        else { if (x.ok) { it.msg1 = it.msg; it.msg = ""; it.st = "rt"; } else { it.st = "er2"; it.msg = retMsg(x.resp); } }
        setRow(it);
      });
      stats(phase, i, list.length);
      var bad = ask ? part.filter(function (it) { return it.st === "er" && !/^#/.test(it.cmd); })[0] : null;
      if (bad && !(await recover(bad))) { abort = true; return false; }
    }
    return true;
  }

  async function run(from) {
    var resume = typeof from === "number";
    var s = window.MAE.state();
    if (!s.online || !s.logged) { alert("Conecte no painel \"Executar no MAE\" (aba Entrada) primeiro."); return; }
    for (var w = 0; w < 40 && window.MAE.state().busy; w++) await new Promise(function (r) { setTimeout(r, 250); });
    if (window.MAE.state().busy) { alert("O painel do MAE já está executando algo. Aguarde terminar."); return; }
    running = true; window.MAE.setBusy(true, field.name + " em " + ne); stopMsg = ""; labelOk = null; stopAt = null; endTxt = ""; abort = false;
    if (!resume) { lastAid = ""; items.forEach(function (it) { it.st = "pd"; it.msg = ""; it.msg1 = ""; it.resp = ""; setRow(it); }); }
    var list = resume ? items.slice(from) : items;
    if (resume) list.forEach(function (it) { if (it.st !== "ok" && it.st !== "rt") { it.st = "pd"; it.msg = ""; setRow(it); } });
    $("mxGo").disabled = true; $("mxGo").textContent = "Executando…"; $("mxStop").disabled = false; $("mxStop").textContent = "Parar"; $("mxClose").textContent = "Fechar";
    $("mxResume").hidden = true; $("mxMin").hidden = false;
    var t0 = Date.now(), err = null;
    window.MAE.log(field.name + ": " + (resume ? "continuando da linha " + items[from].line + " (" + list.length + " comandos)" : "executando " + items.length + " comandos") + " em " + ne + "…", "in");
    stats();
    try {
      var ok = await runList(list, 1);
      var fails = items.filter(function (it) { return it.st === "er"; });
      if (ok && field.retry && fails.length) {
        $("mxSite").insertAdjacentHTML("beforeend", ' · <b class="mx-rt">repetindo ' + fails.length + ' falha(s)…</b>');
        await runList(fails, 2);
      }
    } catch (e) { err = e; }
    await window.MAE.api("/unreg", {}).catch(function () {});
    running = false; window.MAE.setBusy(false);
    var c = count(), secs = Math.round((Date.now() - t0) / 1000);
    if (!ov) { window.MAE.log(field.name + " em " + ne + ": janela fechada · " + c.ok + " ok" + ((c.er + c.er2) ? ", " + (c.er + c.er2) + " falha(s)" : ""), (c.er + c.er2) || err ? "er" : "in"); mini(); return; }
    $("mxStop").disabled = true; $("mxStop").textContent = "Parar";
    $("mxGo").textContent = "▶ Executar tudo de novo"; $("mxGo").disabled = false; $("mxMin").hidden = true;
    $("mxCopyFail").disabled = !(c.er + c.er2); $("mxExport").disabled = false;
    var head = err ? "✖ " + err.message : stopMsg ? "✖ " + stopMsg : abort ? "Interrompido pelo usuário." : "Concluído em " + secs + " s.";
    if (err || stopMsg || abort) {
      var rf = stopAt;
      if (rf == null) for (var q = 0; q < items.length; q++) if (items[q].st === "pd" || items[q].st === "run") { rf = q; break; }
      if (rf != null) {
        var rb = $("mxResume"); rb.hidden = false; rb.textContent = "▶ Continuar da linha " + items[rf].line;
        rb.title = "Executa de novo o comando da linha " + items[rf].line + " (" + items[rf].cmd + ") e segue com os próximos, sem repetir o que já deu certo";
        rb.onclick = function () { run(rf); };
      }
    }
    endTxt = err || stopMsg ? "✖ Parado" : abort ? "✖ Interrompido" : "✔ Concluído";
    $("mxSite").insertAdjacentHTML("beforeend", '<div style="margin-top:4px" class="' + (err || abort ? "mx-er" : "mx-ok") + '"><b>' + esc(head) + "</b></div>");
    window.MAE.log(field.name + " em " + ne + ": " + c.ok + " ok" + (c.rt ? ", " + c.rt + " ok na 2ª" : "") + ((c.er + c.er2) ? ", " + (c.er + c.er2) + " falha(s)" : "") + " · " + head, (c.er + c.er2) || err ? "er" : "ok");
    if (field.retry && !err && !abort) analyse();
    mini();
  }
  function count() { var c = { ok: 0, er: 0, rt: 0, er2: 0, pd: 0, run: 0 }; items.forEach(function (it) { c[it.st]++; }); return c; }

  // ---------- análise da ordem (Baseline) ----------
  function anchorFor(it) {
    // candidato: comando POSTERIOR que deu certo de primeira; preferência: mesmo objeto > mesma chave (ex.: LOCALCELLID=1)
    var p = parseCmd(it.cmd), best = null, bestScore = 0;
    for (var j = it.idx + 1; j < items.length; j++) {
      var o = items[j]; if (o.st !== "ok") continue;
      var q = parseCmd(o.cmd), sc = 0;
      if (q.obj === p.obj) sc += 3;
      if (p.first && q.first === p.first) sc += 2;
      if (sc && q.verb === "ADD") sc += 1;
      if (sc >= bestScore && sc > 0) { best = o; bestScore = sc; }
    }
    return best;
  }
  function analyse() {
    var rt = items.filter(function (it) { return it.st === "rt"; });
    var er2 = items.filter(function (it) { return it.st === "er2"; });
    var h = '<div class="mx-card"><h4>Status da execução e sugestões de ordem</h4>';
    if (!rt.length && !er2.length) {
      h += '<p class="mx-ok"><b>Tudo certo de primeira — a ordem dos comandos está boa.</b></p></div>';
      $("mxAna").innerHTML = h; return;
    }
    if (rt.length) {
      rt.forEach(function (it) { it.anchor = anchorFor(it); });
      h += '<p><b class="mx-rt">↻ ' + rt.length + ' comando(s) falharam na 1ª vez e funcionaram na 2ª</b> — eles dependem de algo que vem <b>depois</b> no script. Sugestão de nova posição:</p>' +
        '<table><thead><tr><th>#</th><th>Comando</th><th>Erro na 1ª vez</th><th>Mover para depois de</th></tr></thead><tbody>' +
        rt.map(function (it) {
          return '<tr><td class="n">' + it.line + '</td><td class="c">' + esc(it.cmd) + '</td><td class="m">' + esc(it.msg1) + '</td><td class="c">' +
            (it.anchor ? '<b>linha ' + it.anchor.line + '</b> · ' + esc(it.anchor.cmd) : '<b>fim do script</b>') + '</td></tr>';
        }).join("") + '</tbody></table>' +
        '<p>“Mover para depois de” é a provável dependência (mesmo objeto ou mesma célula, executada com sucesso mais adiante). Use <b>Copiar script com ordem sugerida</b> para já levar o script reordenado.</p>';
      $("mxReorder").hidden = false; $("mxReorder").disabled = false;
      $("mxReorder").onclick = function () { copy(reordered(), this); };
    }
    if (er2.length) {
      var byMsg = {};
      er2.forEach(function (it) { var k = it.msg || "?"; (byMsg[k] = byMsg[k] || []).push(it); });
      h += '<p><b class="mx-er">✖ ' + er2.length + ' comando(s) falharam nas 2 tentativas</b> — não é ordem: revise o parâmetro, a licença/funcionalidade do site ou se o objeto existe. Agrupado pela mensagem do MAE:</p>' +
        '<table><thead><tr><th>Qtde</th><th>Mensagem do MAE</th><th>Exemplos (linha · comando)</th></tr></thead><tbody>' +
        Object.keys(byMsg).sort(function (a, b) { return byMsg[b].length - byMsg[a].length; }).map(function (k) {
          var l = byMsg[k];
          return '<tr><td class="n">' + l.length + '</td><td class="m">' + esc(k) + '</td><td class="c">' +
            l.slice(0, 3).map(function (it) { return it.line + " · " + esc(it.cmd); }).join("<br>") + (l.length > 3 ? "<br>… +" + (l.length - 3) : "") + '</td></tr>';
        }).join("") + '</tbody></table>';
    }
    $("mxAna").innerHTML = h + "</div>";
  }
  function reordered() {
    var moved = {}, after = {};
    items.forEach(function (it) {
      if (it.st === "rt") { moved[it.idx] = 1; var a = it.anchor ? it.anchor.idx : items.length - 1; (after[a] = after[a] || []).push(it); }
    });
    var out = [];
    items.forEach(function (it) {
      if (!moved[it.idx]) out.push(it.cmd);
      (after[it.idx] || []).forEach(function (m) { out.push(m.cmd); });
    });
    return out.join("\n");
  }

  // ---------- utilidades ----------
  function copy(txt, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = "Copiado!"; setTimeout(function () { btn.textContent = o; }, 1400); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fb); else fb();
    function fb() { var ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
  }
  function exportLog() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    var lab = { pd: "PENDENTE", run: "PENDENTE", ok: "OK", er: "FALHOU", rt: "OK NA 2a", er2: "FALHOU 2x" };
    var t = field.name + " — " + ne + " — " + d.toLocaleString() + "\r\n\r\n" +
      items.map(function (it) { return ("    " + it.line).slice(-5) + "  " + (lab[it.st] + "          ").slice(0, 10) + "  " + it.cmd + (it.msg ? "   [" + it.msg + "]" : "") + (it.st === "rt" ? "   [1a: " + it.msg1 + "]" : ""); }).join("\r\n");
    if (field.retry && items.some(function (it) { return it.st === "rt"; })) t += "\r\n\r\n===== SCRIPT COM ORDEM SUGERIDA =====\r\n" + reordered().replace(/\n/g, "\r\n");
    t += "\r\n\r\n===== RESPOSTAS =====\r\n" + items.filter(function (it) { return it.resp; }).map(function (it) { return "### " + it.line + " " + it.cmd + "\r\n" + it.resp.replace(/\r?\n/g, "\r\n"); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" }));
    a.download = "EXEC_" + ne.replace(/[^\w.-]+/g, "_") + "_" + field.id + "_" + stamp + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- botões ----------
  function start(f) {
    if (running) { showOv(); return; }
    var s = window.MAE.state();
    if (!s.online || !s.logged) { alert("Para executar no site, conecte primeiro no painel \"Executar no MAE\" da aba Entrada (usuário e senha do MAE)."); return; }
    if (!siteName()) { alert("Nenhum site carregado. Carregue o site na aba Entrada (Rodada 1)."); return; }
    var r1 = siteFromR1();
    if (r1 && r1.toUpperCase() !== siteName().toUpperCase()) {
      alert("Por segurança, não vou executar: o site carregado (" + siteName() + ") é diferente do site das respostas da Rodada 1 (" + r1 + ").\n\nRode de novo a Rodada 1 do site certo na aba Entrada.");
      return;
    }
    var sc = cleanScript(readField(f.id));
    if (!sc.cmds.length) { alert("Não há comandos para executar neste campo (gere o script antes)."); return; }
    openScreen(f, sc.cmds, sc.skipped);
  }
  FIELDS.forEach(function (f) {
    var ref = $(f.after), field = $(f.id);
    if (!ref || !field) { console.warn("[MAE] campo não encontrado:", f.id); return; }
    var b = document.createElement("button");
    b.type = "button"; b.className = "mae-run"; b.id = "mx-" + f.id;
    b.textContent = f.label || "▶ Executar no site";
    b.title = "Executa este script (sem comentários), um comando por vez, no site carregado — pelo painel Executar no MAE";
    b.addEventListener("click", function () { start(f); });
    ref.insertAdjacentElement("afterend", b);
  });
})();
