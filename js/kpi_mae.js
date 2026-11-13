/* js/kpi_mae.js — "KPIs MAE" · FASE 1: descoberta das pastas de performance no SFTP do MAE.
   Painel no topo da aba RAN Sharing (fora do iframe; não mexe na ferramenta RAN Sharing).
   Usa o helper local (rotas /sftp/*, helper >= 2.2). SFTP somente leitura; senha só no helper. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var pane = $("pane-rs");
  if (!pane || !window.MAE) return;
  var HELPER = "http://127.0.0.1:8765", MINV = 2.2, ROOT = "/opt/oss/server/var/fileint";
  var ADMIN_MSG = "Export NBI de performance para NEs RAN não está habilitado; solicitar ao admin do OSS " +
    "(Performance → NBI/File Interface: incluir NEs BTS3900/BTS5900/BSC6900/6910, 60 min).";
  var report = { scan: null, probe: null, peeks: [] }, logged = false, busy = false;

  var st = document.createElement("style");
  st.textContent = [
    "#kpiBox{margin:10px 16px;border:1px solid #dfe3eb;border-radius:10px;background:#fff;font:13px 'Segoe UI',Arial,sans-serif;color:#1d2433}",
    "#kpiBox>summary{padding:10px 14px;cursor:pointer;font-weight:600;font-size:15px;display:flex;gap:10px;align-items:center}",
    "#kpiBox>summary small{font-weight:400;color:#667085;font-size:13px}",
    "#kpiIn{padding:0 14px 14px}",
    "#kpiIn .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}",
    "#kpiIn input[type=text],#kpiIn input[type=password],#kpiIn select{font:13.5px 'Segoe UI',Arial,sans-serif;padding:7px 9px;border:1px solid #dfe3eb;border-radius:6px}",
    "#kpiIn button{font:600 13px 'Segoe UI',Arial,sans-serif;border-radius:6px;padding:7px 13px;cursor:pointer;border:1px solid #dfe3eb;background:#fff;color:#1d2433}",
    "#kpiIn button.pri{background:#c7000b;border-color:#c7000b;color:#fff}#kpiIn button:disabled{opacity:.5;cursor:not-allowed}",
    "#kpiIn label{color:#667085;display:flex;gap:5px;align-items:center}",
    "#kpiVerdict{border-radius:8px;padding:10px 12px;margin:10px 0;display:none;font-size:13.5px}",
    "#kpiVerdict.ok{display:block;background:#e3f6ea;color:#16613a}#kpiVerdict.bad{display:block;background:#fde7e7;color:#9b1c1c}#kpiVerdict.info{display:block;background:#e8ecff;color:#2b3aa0}",
    "#kpiGrid{display:grid;grid-template-columns:minmax(320px,1fr) minmax(380px,1.3fr);gap:12px}",
    "#kpiTree,#kpiFiles,#kpiPeek{border:1px solid #dfe3eb;border-radius:8px;padding:8px 10px;max-height:460px;overflow:auto}",
    "#kpiTree details{margin-left:14px}#kpiTree summary{cursor:pointer;padding:2px 0}#kpiTree .d{font-family:Consolas,monospace}",
    "#kpiTree .m{color:#667085;font-size:12px;margin-left:6px}#kpiTree .er{color:#c7000b;font-size:12px;margin-left:6px}",
    "#kpiTree a{color:#2b3aa0;cursor:pointer;font-size:12px;margin-left:6px;text-decoration:underline}",
    ".kpi-t{border-collapse:collapse;width:100%;font:12.5px Consolas,monospace}.kpi-t td,.kpi-t th{border-bottom:1px solid #eef0f4;padding:4px 6px;text-align:left;vertical-align:top}",
    ".kpi-t th{color:#667085;font-weight:500;background:#f7f8fb}.kpi-ran{color:#16613a;font-weight:700}.kpi-no{color:#98a2b3}",
    "#kpiPeek pre{background:#111827;color:#a7f3d0;font:12px/1.4 Consolas,monospace;border-radius:6px;padding:8px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all}",
    "#kpiStat{color:#667085}"
  ].join("\n");
  document.head.appendChild(st);

  var box = document.createElement("details");
  box.id = "kpiBox";
  box.innerHTML =
    '<summary>KPIs MAE · Explorar SFTP <small id="kpiStat">descoberta das pastas de performance (fase 1)</small></summary>' +
    '<div id="kpiIn">' +
      '<div class="row">' +
        '<input type="text" id="kpiUser" placeholder="Usuário SFTP" autocomplete="off" style="width:150px">' +
        '<input type="password" id="kpiPwd" placeholder="Senha SFTP" autocomplete="off" style="width:160px">' +
        '<label><input type="checkbox" id="kpiSame" checked> mesma senha do MML</label>' +
        '<button class="pri" id="kpiLogin">Conectar SFTP</button><button id="kpiLogout" disabled>Sair</button>' +
      '</div>' +
      '<div class="row">' +
        '<input type="text" id="kpiRoot" value="' + ROOT + '" style="width:340px;font-family:Consolas,monospace">' +
        '<label>profundidade <select id="kpiDepth"><option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option></select></label>' +
        '<button id="kpiScan" disabled>Escanear pastas</button>' +
        '<button class="pri" id="kpiProbe" disabled>🔎 Procurar RAN automaticamente</button>' +
        '<button id="kpiRep" disabled>Baixar relatório (.txt)</button>' +
      '</div>' +
      '<div id="kpiVerdict"></div>' +
      '<div id="kpiGrid"><div id="kpiTree"><span class="kpi-no">Escaneie para ver a árvore de pastas.</span></div>' +
      '<div><div id="kpiFiles"><span class="kpi-no">Clique em “arquivos” numa pasta.</span></div><div id="kpiPeek" style="margin-top:12px"><span class="kpi-no">Peek: abre 1 arquivo e resume.</span></div></div></div>' +
    '</div>';
  pane.insertBefore(box, pane.firstChild);

  function api(path, body) {
    var o = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(HELPER + path, o).then(function (r) { return r.json(); }, function () { throw new Error("helper offline"); })
      .then(function (j) { if (j && j.error) throw new Error(j.error); return j; });
  }
  function fmtT(sec) { if (!sec) return "—"; var d = new Date(sec * 1000); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function fmtB(n) { return n == null ? "" : n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? (n / 1024).toFixed(0) + " kB" : n + " B"; }
  function verdict(cls, html) { var v = $("kpiVerdict"); v.className = cls; v.innerHTML = html; }
  function setBusy(b, msg) {
    busy = b;
    ["kpiScan", "kpiProbe"].forEach(function (i) { $(i).disabled = b || !logged; });
    $("kpiLogin").disabled = b; $("kpiLogout").disabled = b || !logged;
    if (msg !== undefined) $("kpiStat").textContent = msg;
  }
  function state() {
    var s = window.MAE.state();
    if (!s.online) return "helper offline — inicie/instale na aba Entrada";
    if ((s.version || 0) < MINV) return "helper desatualizado (v" + (s.version || "?") + "): clique em “Atualizar helper” na aba Entrada";
    return null;
  }

  $("kpiSame").onchange = function () { $("kpiPwd").disabled = this.checked; };
  $("kpiPwd").disabled = true;
  $("kpiLogin").onclick = function () {
    var e = state(); if (e) { verdict("bad", esc(e)); return; }
    var same = $("kpiSame").checked;
    setBusy(true, "conectando SFTP…");
    api("/sftp/login", { user: $("kpiUser").value.trim() || undefined, pwd: same ? undefined : $("kpiPwd").value, useMml: same })
      .then(function (r) { logged = true; $("kpiPwd").value = ""; setBusy(false, "SFTP conectado como " + r.user); verdict("info", "Conectado. Use <b>Procurar RAN automaticamente</b> (abre o arquivo mais recente de cada pasta com dados) ou <b>Escanear pastas</b> para navegar."); })
      .catch(function (er) { logged = false; setBusy(false, "não conectado"); verdict("bad", "SFTP: " + esc(er.message)); });
  };
  $("kpiLogout").onclick = function () { api("/sftp/logout", {}).catch(function () {}).then(function () { logged = false; setBusy(false, "desconectado"); }); };

  // ---------- árvore ----------
  function treeHtml(n, lvl) {
    var exts = Object.keys(n.exts || {}).map(function (k) { return k + "×" + n.exts[k]; }).join(" ");
    var meta = (n.files ? n.files + " arq. " + (exts ? "(" + exts + ") " : "") + "· recente " + fmtT(n.newest) : "") +
      (n.subdirs ? " · " + n.subdirs + " subpasta(s) não abertas" : "") + (n.truncated ? " · (cortado)" : "");
    var head = '<span class="d">' + esc(n.name) + "/</span>" + (meta ? '<span class="m">' + esc(meta) + "</span>" : "") +
      (n.error ? '<span class="er">⚠ ' + esc(n.error) + "</span>" : "") +
      (n.files ? '<a data-ls="' + esc(n.path) + '">arquivos</a>' : "");
    if (!n.dirs || !n.dirs.length) return '<div style="margin-left:' + (lvl ? 14 : 0) + 'px;padding:2px 0">' + head + "</div>";
    return "<details" + (lvl < 2 ? " open" : "") + "><summary>" + head + "</summary>" + n.dirs.map(function (c) { return treeHtml(c, lvl + 1); }).join("") + "</details>";
  }
  $("kpiScan").onclick = function () {
    setBusy(true, "escaneando…");
    api("/sftp/scan?root=" + encodeURIComponent($("kpiRoot").value.trim()) + "&depth=" + $("kpiDepth").value)
      .then(function (r) {
        report.scan = r;
        $("kpiTree").innerHTML = '<div class="kpi-no" style="margin-bottom:6px">' + r.dirs + " pastas em " + r.seconds + " s" + (r.truncated ? " (limite atingido — reduza a profundidade ou mude a raiz)" : "") + "</div>" + treeHtml(r.tree, 0);
        setBusy(false, r.dirs + " pastas escaneadas"); $("kpiRep").disabled = false;
      }).catch(function (e) { setBusy(false, "erro"); verdict("bad", "Scan: " + esc(e.message)); });
  };
  $("kpiTree").addEventListener("click", function (e) {
    var a = e.target.closest("[data-ls]"); if (!a) return;
    e.preventDefault(); listFiles(a.getAttribute("data-ls"));
  });
  function listFiles(path) {
    $("kpiFiles").innerHTML = '<span class="kpi-no">carregando ' + esc(path) + "…</span>";
    api("/sftp/ls?path=" + encodeURIComponent(path)).then(function (l) {
      var f = l.filter(function (x) { return x.type === "file"; }).sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
      $("kpiFiles").innerHTML = '<div style="font:12px Consolas,monospace;margin-bottom:6px">' + esc(path) + " · " + f.length + " arquivo(s), mais recentes primeiro</div>" +
        '<table class="kpi-t"><tr><th>Arquivo</th><th>Tamanho</th><th>Data</th><th></th></tr>' +
        f.slice(0, 300).map(function (x) {
          return "<tr><td>" + esc(x.name) + "</td><td>" + fmtB(x.size) + "</td><td>" + fmtT(x.mtime) + '</td><td><button data-peek="' + esc(path.replace(/\/$/, "") + "/" + x.name) + '">Peek</button></td></tr>';
        }).join("") + "</table>" + (f.length > 300 ? '<div class="kpi-no">… mostrando 300 de ' + f.length + "</div>" : "");
    }).catch(function (e) { $("kpiFiles").innerHTML = '<span class="er">' + esc(e.message) + "</span>"; });
  }
  $("kpiFiles").addEventListener("click", function (e) {
    var b = e.target.closest("[data-peek]"); if (!b) return;
    peek(b.getAttribute("data-peek"), b);
  });

  // ---------- peek ----------
  function summaryRows(s) {
    var r = [["Tipo", s.kind], ["Tamanho", fmtB(s.size) + " · " + fmtT(s.mtime)]];
    if (s.kind === "xml") {
      r.push(["Raiz", s.root], ["beginTime", s.beginTime], ["measInfo", s.measInfo], ["measValue", s.measValues],
        ["Granularidade", Object.keys(s.granularity || {}).map(function (k) { return k + " ×" + s.granularity[k]; }).join(", ")],
        ["measTypes", String(s.measTypes).replace("numericos", "numéricos") + (s.measTypesSample && s.measTypesSample.length ? " · ex.: " + s.measTypesSample.slice(0, 6).join(" ") : "")],
        ["Tipos de measObjLdn", Object.keys(s.ldnShapes || {}).map(function (k) { return s.ldnShapes[k] + " × " + k; }).join("\n")],
        ["Amostra measObjLdn", (s.ldnSample || []).join("\n")]);
      if (s.parseError) r.push(["⚠ Leitura", s.parseError]);
    } else if (s.kind === "csv") r.push(["Linhas", s.lines]);
    r.push(["NEs conhecidos achados", (s.neHits || []).join(", ") || "nenhum"], ["Tem RAN?", s.isRAN ? "SIM" : "não"]);
    return '<table class="kpi-t">' + r.map(function (x) {
      return "<tr><th style='width:150px'>" + esc(x[0]) + "</th><td style='white-space:pre-wrap'" + (x[0] === "Tem RAN?" ? " class='" + (s.isRAN ? "kpi-ran" : "kpi-no") + "'" : "") + ">" + esc(x[1]) + "</td></tr>";
    }).join("") + "</table>";
  }
  function peek(path, btn) {
    if (btn) btn.disabled = true;
    $("kpiPeek").innerHTML = '<span class="kpi-no">abrindo ' + esc(path) + "…</span>";
    api("/sftp/peek?path=" + encodeURIComponent(path)).then(function (s) {
      report.peeks.push(s); $("kpiRep").disabled = false;
      $("kpiPeek").innerHTML = '<div style="font:12px Consolas,monospace;margin-bottom:6px">' + esc(path) + "</div>" + summaryRows(s) +
        "<div style='margin:8px 0 4px;color:#667085'>Primeiras " + (s.head || []).length + " linhas:</div><pre>" + esc((s.head || []).join("\n")) + "</pre>";
    }).catch(function (e) { $("kpiPeek").innerHTML = '<span class="er">' + esc(e.message) + "</span>"; })
      .then(function () { if (btn) btn.disabled = false; });
  }

  // ---------- busca automática ----------
  $("kpiProbe").onclick = function () {
    setBusy(true, "procurando RAN (pode levar alguns minutos)…");
    verdict("info", "Varrendo <code>" + esc($("kpiRoot").value) + "</code> e abrindo o arquivo mais recente de cada pasta com dados…");
    api("/sftp/probe?root=" + encodeURIComponent($("kpiRoot").value.trim()) + "&depth=" + $("kpiDepth").value).then(function (r) {
      report.probe = r; $("kpiRep").disabled = false;
      var ran = r.probed.filter(function (x) { return x.summary && x.summary.isRAN; });
      $("kpiFiles").innerHTML = '<div style="margin-bottom:6px">' + r.scan.dirs + " pastas varridas · " + r.dataDirs + " com arquivos de dados · " + r.probed.length + " arquivo(s) abertos</div>" +
        '<table class="kpi-t"><tr><th>Pasta</th><th>Arquivo mais recente</th><th>RAN?</th><th>measObjLdn (tipo principal)</th></tr>' +
        r.probed.map(function (x) {
          var s = x.summary || {}, sh = Object.keys(s.ldnShapes || {})[0] || "";
          return "<tr><td>" + esc(x.dir) + "</td><td>" + (x.file ? '<a href="#" data-peekp="' + esc(x.dir + "/" + x.file) + '">' + esc(x.file) + "</a>" : "") + "</td><td class='" + (s.isRAN ? "kpi-ran" : "kpi-no") + "'>" +
            (x.error ? "⚠ " + esc(x.error) : s.isRAN ? "SIM" + (s.neHits && s.neHits.length ? " (" + esc(s.neHits.slice(0, 3).join(", ")) + ")" : "") : "não") + "</td><td>" + esc(sh) + "</td></tr>";
        }).join("") + "</table>";
      if (ran.length) verdict("ok", "✅ <b>Encontrei dados RAN</b> em " + ran.length + " pasta(s): <code>" + ran.map(function (x) { return esc(x.dir); }).join("</code>, <code>") +
        "</code>. Confira com Peek e me mande o <b>relatório (.txt)</b> para seguir para a Fase 2 (coleta e conversão).");
      else verdict("bad", "❌ Nenhuma pasta com dados RAN em <code>" + esc($("kpiRoot").value) + "</code>" + (r.scan.truncated ? " (varredura cortada — tente outra raiz ou profundidade menor)" : "") + ".<br><b>" + esc(ADMIN_MSG) + "</b>");
      setBusy(false, ran.length ? "RAN encontrado" : "sem RAN nesta raiz");
    }).catch(function (e) { setBusy(false, "erro"); verdict("bad", "Busca: " + esc(e.message)); });
  };
  $("kpiFiles").addEventListener("click", function (e) {
    var a = e.target.closest("[data-peekp]"); if (!a) return;
    e.preventDefault(); peek(a.getAttribute("data-peekp"));
  });

  // ---------- relatório ----------
  $("kpiRep").onclick = function () {
    var L = ["KPIs MAE — descoberta SFTP — " + new Date().toLocaleString("pt-BR"), "Raiz: " + $("kpiRoot").value, ""];
    function tree(n, i) {
      L.push(new Array(i + 1).join("  ") + n.name + "/  " + (n.files ? n.files + " arq " + JSON.stringify(n.exts) + " recente " + fmtT(n.newest) : "") + (n.subdirs ? " +" + n.subdirs + " subpastas" : "") + (n.error ? "  ERRO " + n.error : ""));
      (n.dirs || []).forEach(function (c) { tree(c, i + 1); });
    }
    if (report.scan) { L.push("== ÁRVORE (" + report.scan.dirs + " pastas) =="); tree(report.scan.tree, 0); L.push(""); }
    if (report.probe) {
      L.push("== BUSCA RAN (" + report.probe.dataDirs + " pastas com dados) ==");
      report.probe.probed.forEach(function (x) { var s = x.summary || {}; L.push((s.isRAN ? "[RAN] " : "[---] ") + x.dir + "/" + (x.file || "") + (x.error ? "  ERRO " + x.error : "") + "  ldn: " + Object.keys(s.ldnShapes || {}).slice(0, 3).join(" | ") + "  NEs: " + (s.neHits || []).join(",")); });
      L.push("");
    }
    report.peeks.forEach(function (s) {
      var c = JSON.parse(JSON.stringify(s)); var head = c.head || []; delete c.head;
      L.push("== PEEK " + s.path + " ==", JSON.stringify(c, null, 1), "-- primeiras linhas --", head.join("\n"), "");
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.join("\r\n")], { type: "text/plain;charset=utf-8" }));
    a.download = "KPIs_MAE_descoberta_" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "") + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
  };

  // estado inicial
  setInterval(function () {
    if (busy) return;
    var e = state();
    if (e) { $("kpiStat").textContent = e; logged = false; setBusy(false); return; }
    fetch(HELPER + "/").then(function (r) { return r.json(); }).then(function (s) {
      var was = logged; logged = !!(s.sftp && s.sftp.logged);
      if (!$("kpiUser").value && s.user) $("kpiUser").value = s.user;
      if (was !== logged) setBusy(false, logged ? "SFTP conectado como " + s.sftp.user : "SFTP não conectado");
    }).catch(function () {});
  }, 5000);
})();
