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
    { id: "output",   after: "copy",       name: "Baseline · saída gerada", retry: true }
  ];
  var BATCH = 5;
  var MML_RE = /^[A-Z][A-Z0-9]*\s+[A-Z0-9_]+\s*:.*;$/i;
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
  var ov = null, items = [], abort = false, running = false, field = null, ne = "";
  function openScreen(f, cmds, skipped) {
    field = f; ne = siteName(); abort = false;
    items = cmds.map(function (c, i) { return { idx: i, line: c.line, cmd: c.cmd, st: "pd", msg: "", msg1: "", resp: "" }; });
    if (ov) ov.remove();
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
          '<div id="mxStats"></div></div>' +
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
          '<label><input type="checkbox" id="mxOnlyFail"> só falhas</label>' +
          '<span class="sp"></span>' +
          '<button id="mxCopyFail" disabled>Copiar falhas</button>' +
          '<button id="mxReorder" disabled hidden>Copiar script com ordem sugerida</button>' +
          '<button id="mxExport" disabled>Exportar log (.txt)</button>' +
          '<button id="mxClose">Fechar</button>' +
        '</div></div>';
    document.body.appendChild(ov);
    stats();
    $("mxGo").onclick = run;
    $("mxStop").onclick = function () { abort = true; $("mxStop").disabled = true; $("mxStop").textContent = "Parando…"; };
    $("mxClose").onclick = function () { if (running && !confirm("A execução está em andamento. Parar e fechar?")) return; abort = true; ov.remove(); ov = null; };
    $("mxOnlyFail").onchange = function () { $("mxBody").classList.toggle("onlyfail", this.checked); };
    $("mxCopyFail").onclick = function () { copy(items.filter(function (it) { return it.st === "er"; }).map(function (it) { return it.cmd; }).join("\n"), this); };
    $("mxExport").onclick = exportLog;
  }

  function setRow(it) {
    var tr = $("mxr" + it.idx); if (!tr) return;
    var lab = { pd: "• aguardando", run: "⏳ executando", ok: "✔ ok", er: "✖ falhou", rt: "↻ ok na 2ª", er2: "✖ falhou 2×" }[it.st];
    tr.className = it.st === "er2" ? "er" : it.st;
    tr.children[1].innerHTML = '<span class="' + ({ ok: "mx-ok", er: "mx-er", er2: "mx-er", rt: "mx-rt" }[it.st] || "") + '">' + lab + "</span>";
    tr.children[3].textContent = it.st === "rt" ? "1ª: " + it.msg1 : it.msg;
  }
  function stats(phase, done, total) {
    var c = { ok: 0, er: 0, rt: 0, er2: 0, pd: 0 };
    items.forEach(function (it) { c[it.st === "run" ? "pd" : it.st]++; });
    var pct = total ? Math.round(done * 100 / total) : 0;
    $("mxFill").style.width = pct + "%"; $("mxFill").className = phase === 2 ? "p2" : "";
    $("mxPct").textContent = (phase === 2 ? "2ª tentativa · " : "") + pct + "%" + (total ? " (" + done + "/" + total + ")" : "");
    $("mxStats").innerHTML = '<span class="mx-ok">✔ <b class="mx-ok">' + c.ok + '</b> ok</span>' +
      (field && field.retry ? '<span class="mx-rt">↻ <b class="mx-rt">' + c.rt + '</b> ok na 2ª</span>' : '') +
      '<span class="mx-er">✖ <b class="mx-er">' + (c.er + c.er2) + '</b> falha(s)</span><span>• <b>' + c.pd + '</b> pendente(s)</span>';
  }

  async function runList(list, phase) {
    for (var i = 0; i < list.length; i += BATCH) {
      if (abort) return false;
      var part = list.slice(i, i + BATCH);
      part.forEach(function (it) { it.st = "run"; setRow(it); });
      var tr = $("mxr" + part[0].idx); if (tr && !$("mxOnlyFail").checked) tr.scrollIntoView({ block: "nearest" });
      var r;
      try {
        r = await window.MAE.api("/run", { ne: ne, cmds: part.map(function (it) { return it.cmd; }), stopOnError: false });
      } catch (e) {
        part.forEach(function (it) { it.st = "pd"; setRow(it); });
        throw e;
      }
      if (r[0] && /^REG NE/.test(r[0].cmd)) {
        if (!r[0].ok) { part.forEach(function (it) { it.st = "pd"; setRow(it); }); throw new Error("REG NE falhou para " + ne + ": " + retMsg(r[0].resp)); }
        r = r.slice(1);
      }
      part.forEach(function (it, k) {
        var x = r[k] || { ok: false, resp: "sem resposta do helper" };
        it.resp += (it.resp ? "\n----- 2ª tentativa -----\n" : "") + (x.resp || "");
        if (phase === 1) { it.st = x.ok ? "ok" : "er"; it.msg = x.ok ? "" : retMsg(x.resp); }
        else { if (x.ok) { it.msg1 = it.msg; it.msg = ""; it.st = "rt"; } else { it.st = "er2"; it.msg = retMsg(x.resp); } }
        setRow(it);
      });
      stats(phase, Math.min(i + BATCH, list.length), list.length);
    }
    return true;
  }

  async function run() {
    var s = window.MAE.state();
    if (!s.online || !s.logged) { alert("Conecte no painel \"Executar no MAE\" (aba Entrada) primeiro."); return; }
    for (var w = 0; w < 40 && window.MAE.state().busy; w++) await new Promise(function (r) { setTimeout(r, 250); });
    if (window.MAE.state().busy) { alert("O painel do MAE já está executando algo. Aguarde terminar."); return; }
    running = true; window.MAE.setBusy(true);
    $("mxGo").disabled = true; $("mxGo").textContent = "Executando…"; $("mxStop").disabled = false; $("mxClose").textContent = "Fechar";
    var t0 = Date.now(), err = null;
    window.MAE.log(field.name + ": executando " + items.length + " comandos em " + ne + "…", "in");
    try {
      var ok = await runList(items, 1);
      var fails = items.filter(function (it) { return it.st === "er"; });
      if (ok && field.retry && fails.length) {
        $("mxSite").insertAdjacentHTML("beforeend", ' · <b class="mx-rt">repetindo ' + fails.length + ' falha(s)…</b>');
        await runList(fails, 2);
      }
    } catch (e) { err = e; }
    await window.MAE.api("/unreg", {}).catch(function () {});
    running = false; window.MAE.setBusy(false);
    var c = count(), secs = Math.round((Date.now() - t0) / 1000);
    $("mxStop").disabled = true; $("mxStop").textContent = "Parar";
    $("mxGo").textContent = "▶ Executar de novo"; $("mxGo").disabled = false;
    $("mxCopyFail").disabled = !(c.er + c.er2); $("mxExport").disabled = false;
    var head = err ? "✖ " + err.message : abort ? "Interrompido pelo usuário." : "Concluído em " + secs + " s.";
    $("mxSite").insertAdjacentHTML("beforeend", '<div style="margin-top:4px" class="' + (err || abort ? "mx-er" : "mx-ok") + '"><b>' + esc(head) + "</b></div>");
    window.MAE.log(field.name + " em " + ne + ": " + c.ok + " ok" + (c.rt ? ", " + c.rt + " ok na 2ª" : "") + ((c.er + c.er2) ? ", " + (c.er + c.er2) + " falha(s)" : "") + " · " + head, (c.er + c.er2) || err ? "er" : "ok");
    if (field.retry && !err && !abort) analyse();
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
    if (running) { if (ov) ov.style.display = ""; return; }
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
