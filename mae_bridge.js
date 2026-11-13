/* mae_bridge.js — painel "Executar no MAE" da aba Entrada do Baseline Huawei.
   Incluído no index.html com <script src="mae_bridge.js"></script> (antes de </body>).
   Precisa do tools/mml_helper_v2.py rodando no PC (http://127.0.0.1:8765).
   Liga-se direto aos elementos da aba Entrada:
     Rodada 1: comandos #uniCmds · respostas #uniIn · processar #uniGo
     Rodada 2: comandos #cmdsRound2 · respostas #in2 · processar #btn2
   A senha vai só para o helper (memória do processo); aqui só o usuário fica no localStorage. */
(function () {
  "use strict";
  var CFG = {
    helper: "http://127.0.0.1:8765",
    batch: 8,                                  // comandos por chamada /run (permite "Parar" e mostra progresso)
    neTypes: /BTS3900|BTS5900|DBS|NODEB|GNODEB/i,
    poll: 10000,
    minVersion: 2.1,                           // helper mais antigo = lento (espera 1,5 s por comando)
    installer: "tools/Instalar_Helper_MML.bat"
  };
  var WRITE_RE = /^\s*(ADD|MOD|RMV|SET|ACT|DLD|RST|BLK|UBL|STR|STP)\s/i;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var autoNe = false, neList = [], abort = false, busy = false, online = false, logged = false, logLines = [], transcript = [];

  if (!$("pane-in") || !$("uniCmds") || !$("uniIn") || !$("uniGo")) { console.warn("[MAE] aba Entrada não encontrada"); return; }

  // ---------- estilo (usa as variáveis de cor do Baseline) ----------
  var st = document.createElement("style");
  st.textContent =
    "#maeBox{margin-bottom:20px}" +
    "#maeBox .mae-st{font-size:13px;font-weight:400;color:var(--text-muted)}" +
    "#maeDot{width:10px;height:10px;border-radius:50%;background:#98a2b3;display:inline-block;align-self:center}" +
    "#maeDot.on{background:var(--success)}#maeDot.off{background:var(--accent)}" +
    "#maeBox input[type=text],#maeBox input[type=password]{font-family:var(--font);font-size:13.5px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)}" +
    "#maeBox button.ghost:disabled{opacity:.5;cursor:not-allowed;border-color:var(--border);color:var(--text)}" +
    "#maeBox input:disabled{background:var(--surface-alt);opacity:.7}" +
    "#maeBox label.chk{font-size:13px;color:var(--text-muted);display:flex;gap:5px;align-items:center}" +
    "#maeSite{min-width:300px;font-family:Consolas,'Courier New',monospace!important}" +
    "#maeLog{margin:10px 0 0;background:var(--mono-bg);border:1px solid var(--mono-border);color:#c9d1d9;font:12.5px/1.45 Consolas,'Courier New',monospace;border-radius:6px;padding:8px 12px;max-height:220px;overflow:auto;white-space:pre-wrap;display:none}" +
    "#maeLog .ok{color:#3fb950}#maeLog .er{color:#f85149}#maeLog .in{color:#79c0ff}" +
    "#maeInfo{font-size:13px;color:var(--text-muted)}" +
    "#maeBox .mae-note{font-size:13px;color:var(--text-muted);margin:8px 0 0}" +
    "#maeOld{color:var(--warning)!important;background:var(--warning-bg);padding:6px 10px;border-radius:6px}#maeOld a{color:inherit;font-weight:600;cursor:pointer}" +
    "#maeBox a.mae-btn{display:inline-block;font-family:'Segoe UI',Arial,sans-serif;font-weight:600;font-size:13.5px;border-radius:6px;padding:9px 16px;border:1px solid var(--border);color:var(--text);text-decoration:none;cursor:pointer}" +
    "#maeBox a.mae-btn:hover{border-color:var(--accent);color:var(--accent)}";
  document.head.appendChild(st);

  // ---------- painel ----------
  var box = document.createElement("section");
  box.className = "step"; box.id = "maeBox";
  box.innerHTML =
    '<div class="step-head"><span id="maeDot"></span><h2>Executar no MAE</h2><span class="mae-st" id="maeSt">verificando helper…</span></div>' +
    '<p class="instr">Roda a <strong>Rodada 1</strong> e a <strong>Rodada 2</strong> direto no site escolhido, um comando por vez, e já cola e processa as respostas abaixo.</p>' +
    '<div class="row">' +
      '<input type="text" id="maeUser" placeholder="Usuário MAE" autocomplete="username" style="width:150px">' +
      '<input type="password" id="maePwd" placeholder="Senha" autocomplete="current-password" style="width:170px">' +
      '<button class="primary" type="button" id="maeLogin">Conectar</button>' +
      '<button class="ghost" type="button" id="maeLogout">Sair</button>' +
    '</div>' +
    '<div class="row">' +
      '<input type="text" id="maeSite" list="maeNeList" placeholder="Buscar site (ex.: SR-TJMO01)" autocomplete="off" spellcheck="false" disabled>' +
      '<datalist id="maeNeList"></datalist>' +
      '<label class="chk"><input type="checkbox" id="maeAllTypes"> todos os tipos de NE</label>' +
      '<button class="ghost" type="button" id="maeReload" disabled>Atualizar lista</button>' +
      '<span id="maeInfo"></span>' +
    '</div>' +
    '<div class="row">' +
      '<button class="primary" type="button" id="maeGo" disabled>▶ Confirmar: Rodada 1 + Rodada 2</button>' +
      '<button class="ghost" type="button" id="maeOnly1" disabled>Só Rodada 1</button>' +
      '<button class="ghost" type="button" id="maeStop" disabled>Parar</button>' +
      '<button class="ghost" type="button" id="maeExport" disabled>Exportar log (.txt)</button>' +
    '</div>' +
    '<div id="maeHelp" hidden><div class="row">' +
      '<button class="primary" type="button" id="maeStart">Iniciar helper</button>' +
      '<a class="ghost mae-btn" id="maeInstall" download="Instalar_Helper_MML.bat">Instalar neste PC (1ª vez)</a>' +
    '</div><p class="mae-note">Helper offline. <b>Primeira vez neste computador?</b> Clique em <b>Instalar neste PC</b>, abra o arquivo baixado e aguarde o “PRONTO”: depois disso ele liga sozinho com o Windows. ' +
    'Se já instalou, clique em <b>Iniciar helper</b> (o navegador pergunta se pode abrir — marque “sempre permitir”). O resto do Baseline funciona normalmente sem ele.</p></div>' +
    '<p class="mae-note" id="maeOld" hidden>⚠ O helper deste PC é de uma versão antiga e mais lenta. Clique em <a id="maeInstall2" download="Instalar_Helper_MML.bat">Atualizar helper</a> e abra o arquivo baixado.</p>' +
    '<div id="maeLog" aria-live="polite"></div>';
  var pane = $("pane-in");
  pane.insertBefore(box, pane.firstChild);

  // ---------- utilidades ----------
  function now() { return new Date().toLocaleTimeString(); }
  function log(msg, cls) {
    var el = $("maeLog"); el.style.display = "block";
    var d = document.createElement("div"); if (cls) d.className = cls;
    d.textContent = "[" + now() + "] " + msg;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
    logLines.push("[" + now() + "] " + msg);
    $("maeExport").disabled = false;
  }
  function cmdsFrom(id) {
    var el = $(id); if (!el) return [];
    return (el.textContent || "").split(/\r?\n/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s.indexOf("//") !== 0; });
  }
  // O MAE pela NBI ecoa "%%CMD;%%"; o cliente MML ecoa "%%/*n*/CMD;%%" — formato que a Rodada 2 do
  // Baseline exige para separar as respostas. Acrescenta o "/*n*/" quando faltar (não altera o resto).
  var serial = 0;
  function withSerial(resp) {
    return String(resp || "").replace(/%%(?!\/\*\d+\*\/)([^%\r\n]+)%%/g, function (_, c) { return "%%/*" + (++serial) + "*/" + c + "%%"; });
  }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function api(path, body) {
    var opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(CFG.helper + path, opt).then(function (r) { return r.json(); }, function () {
      online = false; refresh();
      throw new Error("helper offline (" + CFG.helper + ")");
    }).then(function (j) {
      if (j && j.error) throw new Error(j.error);
      return j;
    });
  }

  var helperVersion = null;
  function refresh(userTxt) {
    $("maeOld").hidden = !online || helperVersion === null || helperVersion >= CFG.minVersion;
    var dot = $("maeDot");
    dot.className = online ? (logged ? "on" : "") : "off";
    $("maeSt").textContent = !online ? "helper offline" : logged ? "conectado como " + (userTxt || $("maeUser").value || "") : "helper OK · não conectado";
    $("maeHelp").hidden = online;
    $("maeLogin").disabled = !online || busy;
    $("maeLogout").disabled = !online || !logged || busy;
    ["maeSite", "maeReload", "maeGo", "maeOnly1"].forEach(function (i) { $(i).disabled = !online || !logged || busy; });
    $("maeAllTypes").disabled = busy;
    $("maeStop").disabled = !busy;
  }

  function fillList() {
    var all = $("maeAllTypes").checked;
    var l = neList.filter(function (n) { return all || CFG.neTypes.test(n.type); });
    $("maeNeList").innerHTML = l.map(function (n) {
      return '<option value="' + esc(n.name) + '">' + esc(n.type + " · " + n.ip) + "</option>";
    }).join("");
    $("maeInfo").textContent = "";
    showSite();
  }
  function showSite() {
    var v = $("maeSite").value.trim().toUpperCase();
    var n = neList.filter(function (x) { return x.name.toUpperCase() === v; })[0];
    if (n) $("maeInfo").textContent = n.name + " · " + n.type + " · " + n.ip;
    else if (neList.length) fillInfoCount();
  }
  function fillInfoCount() {
    var all = $("maeAllTypes").checked;
    var c = neList.filter(function (n) { return all || CFG.neTypes.test(n.type); }).length;
    $("maeInfo").textContent = c + " sites na lista" + (all ? "" : " (BTS3900/BTS5900)");
  }

  function loadNe(force) {
    log("Carregando lista de NEs (LST NE)…", "in");
    return api("/ne", force ? {} : undefined).then(function (l) {
      neList = Array.isArray(l) ? l : [];
      fillList(); log(neList.length + " NEs carregados.", "ok");
    });
  }

  // ---------- execução ----------
  function confirmWrites(cmds, label) {
    var w = cmds.filter(function (c) { return WRITE_RE.test(c); });
    if (!w.length) return true;
    return confirm(label + " contém " + w.length + " comando(s) de ALTERAÇÃO no site:\n\n" +
      w.slice(0, 12).join("\n") + (w.length > 12 ? "\n… e mais " + (w.length - 12) : "") + "\n\nExecutar mesmo assim?");
  }

  async function runRound(ne, cmds, label) {
    if (!cmds.length) throw new Error("Nenhum comando na " + label + ".");
    if (!confirmWrites(cmds, label)) throw new Error("Cancelado pelo usuário.");
    log(label + ": " + cmds.length + " comandos em " + ne + "…", "in");
    var resp = [], okN = 0, erN = 0, tr = Date.now();
    for (var i = 0; i < cmds.length; i += CFG.batch) {
      if (abort) throw new Error("Interrompido pelo usuário (" + label + ", " + i + " de " + cmds.length + " comandos).");
      var r = await api("/run", { ne: ne, cmds: cmds.slice(i, i + CFG.batch), stopOnError: false });
      if (!Array.isArray(r)) throw new Error("Resposta inesperada do helper.");
      if (r[0] && /^REG NE/.test(r[0].cmd) && !r[0].ok) {
        throw new Error("REG NE falhou para " + ne + " — resposta do MAE:\n" + String(r[0].resp || "").trim().slice(-600));
      }
      r.forEach(function (x) {
        if (/^REG NE/.test(x.cmd)) return;
        transcript.push(x); resp.push(withSerial(x.resp));
        if (x.ok) okN++; else erN++;
        log((x.ok ? "✔ " : "✖ ") + x.cmd, x.ok ? "ok" : "er");
      });
    }
    log(label + ": " + okN + " ok" + (erN ? ", " + erN + " com erro" : "") + " em " + Math.round((Date.now() - tr) / 1000) + " s.", erN ? "er" : "ok");
    return resp.join("\n");
  }

  async function go(both) {
    var ne = $("maeSite").value.trim();
    if (!ne) { alert("Escolha um site."); $("maeSite").focus(); return; }
    var hit = neList.filter(function (n) { return n.name.toUpperCase() === ne.toUpperCase(); })[0];
    if (hit) { ne = hit.name; $("maeSite").value = ne; }
    else if (neList.length && !confirm(ne + " não está na lista de NEs do MAE. Continuar mesmo assim?")) return;
    var c1 = cmdsFrom("uniCmds");
    abort = false; busy = true; transcript = []; refresh();
    var t0 = Date.now();
    try {
      // ---- Rodada 1 ----
      var txt1 = await runRound(ne, c1, "Rodada 1");
      $("uniIn").value = txt1;
      $("uniIn").dispatchEvent(new Event("input", { bubbles: true }));
      $("uniGo").click();
      log("Rodada 1 colada e processada.", "ok");
      if (!both) { log("Concluído (só Rodada 1) em " + Math.round((Date.now() - t0) / 1000) + " s.", "ok"); return; }

      // ---- Rodada 2 ----
      await sleep(50);
      if ($("in2").disabled) {
        var m = ($("msg1") && $("msg1").textContent) || "";
        throw new Error("A Rodada 1 não gerou a Rodada 2" + (m ? ": " + m : "."));
      }
      var c2 = cmdsFrom("cmdsRound2");
      if (!c2.length) { log("Rodada 2 sem comandos — fim.", "in"); return; }
      if (abort) throw new Error("Interrompido pelo usuário antes da Rodada 2.");
      var txt2 = await runRound(ne, c2, "Rodada 2");
      $("in2").value = txt2;
      $("in2").dispatchEvent(new Event("input", { bubbles: true }));
      $("btn2").click();
      log("Rodada 2 colada e processada. " + ne + " concluído em " + Math.round((Date.now() - t0) / 1000) + " s ✅", "ok");
    } catch (e) {
      log(e.message, "er");
    } finally {
      await api("/unreg", {}).catch(function () {});
      busy = false; refresh();
    }
  }

  function exportLog() {
    var ne = $("maeSite").value.trim() || "MAE";
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    var txt = "Executar no MAE — " + ne + " — " + d.toLocaleString() + "\r\n\r\n" + logLines.join("\r\n");
    if (transcript.length) {
      txt += "\r\n\r\n==================== RESPOSTAS ====================\r\n";
      transcript.forEach(function (x) { txt += "\r\n### " + (x.ok ? "OK " : "ERRO ") + x.cmd + "\r\n" + String(x.resp || "").replace(/\r?\n/g, "\r\n") + "\r\n"; });
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
    a.download = "MAE_" + ne.replace(/[^\w.-]+/g, "_") + "_" + stamp + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------- eventos ----------
  try { $("maeUser").value = localStorage.getItem("maeUser") || ""; } catch (e) {}
  $("maeLogin").addEventListener("click", function () {
    var u = $("maeUser").value.trim(), pw = $("maePwd").value;
    if (!u || !pw) { alert("Informe usuário e senha do MAE."); return; }
    busy = true; refresh(); log("Conectando como " + u + "…", "in");
    api("/login", { user: u, pwd: pw }).then(function (r) {
      try { localStorage.setItem("maeUser", u); } catch (e) {}
      logged = true; autoNe = true; busy = false; refresh(r.user || u); log("Login OK.", "ok");
      return loadNe(false);
    }).catch(function (e) {
      logged = false; log("Login: " + e.message, "er");
    }).then(function () { $("maePwd").value = ""; busy = false; refresh(); });
  });
  $("maePwd").addEventListener("keydown", function (e) { if (e.key === "Enter") $("maeLogin").click(); });
  $("maeLogout").addEventListener("click", function () {
    api("/logout", {}).catch(function () {}).then(function () {
      logged = false; autoNe = false; neList = []; fillList(); $("maeInfo").textContent = ""; refresh(); log("Desconectado.", "in");
    });
  });
  $("maeReload").addEventListener("click", function () { loadNe(true).catch(function (e) { log(e.message, "er"); }); });
  $("maeAllTypes").addEventListener("change", fillList);
  $("maeSite").addEventListener("input", showSite);
  $("maeGo").addEventListener("click", function () { go(true); });
  $("maeOnly1").addEventListener("click", function () { go(false); });
  $("maeStop").addEventListener("click", function () { abort = true; log("Parando após o bloco atual…", "er"); });
  $("maeExport").addEventListener("click", exportLog);
  $("maeInstall").href = $("maeInstall2").href = CFG.installer;
  $("maeStart").addEventListener("click", function () {
    log("Iniciando o helper…", "in");
    location.href = "mmlhelper://start";
    var n = 0, t = setInterval(function () {        // procura o helper a cada 1 s por 20 s
      if (online || ++n > 20) { clearInterval(t); if (!online) log("Helper não respondeu. Se é a 1ª vez neste PC, use \"Instalar neste PC\".", "er"); return; }
      check(false);
    }, 1000);
  });

  // ---------- status do helper (verifica a cada 10 s, sem atrapalhar o resto da página) ----------
  function check(first) {
    if (busy) return;
    fetch(CFG.helper + "/").then(function (r) { return r.json(); }).then(function (s) {
      var was = online;
      online = true; logged = !!s.logged; helperVersion = parseFloat(s.version || "2.0") || 2.0;
      refresh(s.user);
      if (!was && !first) log("Helper conectado (MAE " + s.mae + ").", "ok");
      if (first) log("Helper OK (MAE " + s.mae + ").", "ok");
      if (!logged) autoNe = false;
      if (logged && !autoNe && !neList.length && !busy) autoNe = true, loadNe(false).catch(function (e) { log(e.message, "er"); });
    }, function () {
      if (online || first) { online = false; logged = false; refresh(); }
    });
  }
  // ---------- usado por mae_exec.js (botões "Executar no site" das outras abas) ----------
  window.MAE = {
    api: api,
    state: function () { return { online: online, logged: logged, busy: busy, user: $("maeUser").value }; },
    neList: function () { return neList; },
    setBusy: function (v) { busy = !!v; refresh(); },
    log: log
  };

  refresh();
  check(true);
  setInterval(function () { check(false); }, CFG.poll);
})();
