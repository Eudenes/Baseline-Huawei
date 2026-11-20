/* ret_ald.js — caixa "RET (antenas AISG)" na aba Conexão física.
   Roteiro de campo, na ordem:
     1) Varredura   — SCN ALD:; (tarefa no helper: espera o "Status = Success" do site, com %) + LST RET:;
     2) Cadastro    — ADD RET de cada RET encontrado (nome e Sector ID montados por antena/porta/banda)
                      → espera os RET conectarem (DSP RET / DSP RETSUBUNIT repetidos pelo executor)
                      → MOD RETDEVICEDATA (BSID = site, Sector ID) → conferência final
     3) Conferência — DSP RET + DSP RETSUBUNIT lado a lado (serial, online, tilt, Sector ID)
     4) Porta RET   — MOD RETPORT (alimentação e limiares de corrente) + LST/DSP RETPORT → varre de novo
   O "▶ Executar no site" de cada script é o do mae_exec.js (campos retCmds e retPortCmds).
   Exporta window.RETALD (check: usado pelo executor para saber quando os RET ficaram prontos). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var pane = $("pane-ph");
  if (!pane) return;

  var LS = "retald.v1.", LS_G = "retald.v1";
  var MINV = 3.4;                                          // tarefas (/job) no helper
  var DEF = { scen: "DAISY_CHAIN", oper: "TIM", nameTpl: "{BANDA}_SEC{SEC2}_{PORTA}", secTpl: "S{SEC}-{PORTA}-{BANDA}-{OP}",
    thr: true, uo: 14, uc: 15, oo: 182, oc: 155, autoscan: true, wait: 20 };
  var MAXLEN = 32;

  // ---------------------------------------------------------------- utilitários
  function nv(v) { v = String(v == null ? "" : v).trim(); return /^NULL$/i.test(v) ? "" : v; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadedSite() { return (($("neLbl") && $("neLbl").textContent) || "").split("·")[0].trim(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function now() { var d = new Date(); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function copyText(txt, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = "Copiado!"; setTimeout(function () { btn.textContent = o; }, 1400); };
    function fb() { var ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fb); else fb();
  }
  function retMsg(resp) {
    var m = /RETCODE\s*=\s*(\d+)\s+([^\r\n]*)/.exec(resp || "");
    return m ? (m[1] === "0" ? "" : m[1] + " · " + m[2].trim()) : "sem RETCODE";
  }
  function badChars(s) { return /["';\\]/.test(s); }

  // ---------------------------------------------------------------- leitura das respostas MML
  // Tabela Huawei (cabeçalho com colunas separadas por 2+ espaços) ou registros "Chave = valor".
  // Devolve as linhas da ÚLTIMA tabela cujo cabeçalho tem todas as `keys`.
  function parseTable(text, keys) {
    var L = String(text || "").replace(/\r/g, "").replace(/\t/g, "    ").split("\n"), out = null;
    for (var i = 0; i < L.length; i++) {
      var h = L[i];
      if (/=/.test(h) || !keys.every(function (k) { return h.indexOf(k) >= 0; })) continue;
      var cols = [], re = /\S+(?: \S+)*/g, m;
      while ((m = re.exec(h))) cols.push({ name: m[0], at: m.index });
      var rows = [];
      for (var j = i + 1; j < L.length; j++) {
        var t = L[j];
        if (!t.trim() || /^\s*-+\s*$/.test(t)) continue;
        if (/^\s*(\(Number of results|---\s|\+\+\+|%%|RETCODE|To be continued|\d+ reports? in total)/.test(t)) break;
        var parts = t.trim().split(/\s{2,}/), o = {};
        if (parts.length === cols.length) cols.forEach(function (c, x) { o[c.name] = parts[x]; });
        else cols.forEach(function (c, x) { o[c.name] = t.slice(c.at, x + 1 < cols.length ? cols[x + 1].at : undefined).trim(); });
        rows.push(o);
      }
      out = rows;
    }
    return out;
  }
  function parseKV(text, first) {
    var recs = [], cur = null;
    String(text || "").replace(/\r/g, "").split("\n").forEach(function (l) {
      var m = /^\s*([A-Za-z][A-Za-z0-9 ._()\/-]*?)\s+=\s+(.*)$/.exec(l); if (!m) return;
      var k = m[1].trim();
      if (/^(RETCODE|Report Type|Status|Progress|Session ID)$/i.test(k)) return;
      if (!cur || k === first || cur[k] !== undefined) { cur = {}; recs.push(cur); }
      cur[k] = m[2].trim();
    });
    return recs.filter(function (r) { return r[first] !== undefined; });
  }
  function records(text, keys) { var t = parseTable(text, keys); return t && t.length ? t : parseKV(text, keys[0]); }
  function g(o, re) { for (var k in o) if (re.test(k)) return nv(o[k]); return ""; }

  function parseScan(text) {
    return records(text, ["Control Port Cabinet No.", "Serial No."]).map(function (r) {
      return { cn: g(r, /Cabinet No/i), srn: g(r, /Subrack No/i), sn: g(r, /Slot No/i), port: g(r, /^Control Port No/i),
        res: g(r, /^Result/i).toUpperCase(), type: g(r, /Device Type/i).toUpperCase(), vendor: g(r, /Vendor Code/i), serial: g(r, /^Serial No/i),
        proto: g(r, /Protocol/i), cfg: g(r, /Configure Status/i).toUpperCase(), nsub: parseInt(g(r, /Subunits/i), 10) || 1, cause: g(r, /Failure Cause/i) };
    });
  }
  function parseLstRet(text) {
    return records(text, ["Device No.", "Device Name"]).map(function (r) {
      return { no: g(r, /^Device No/i), name: g(r, /^Device Name/i), serial: g(r, /^(Actual Device )?Serial No/i), vendor: g(r, /Vendor Code/i) };
    }).filter(function (r) { return /^\d+$/.test(r.no); });
  }
  function parseDspRet(text) {
    return records(text, ["Device No.", "Actual Device Serial No."]).map(function (r) {
      return { no: g(r, /^Device No/i), name: g(r, /^Device Name/i), serial: g(r, /Actual Device Serial/i), vendor: g(r, /Actual Vendor/i),
        cn: g(r, /Cabinet No/i), srn: g(r, /Subrack No/i), sn: g(r, /Slot No/i), fail: g(r, /Query Failure/i), err: g(r, /^Meaning/i) || g(r, /Response Error Code/i) };
    }).filter(function (r) { return /^\d+$/.test(r.no); });
  }
  function parseDspSub(text) {
    return records(text, ["Device No.", "Subunit No.", "Online Status"]).map(function (r) {
      return { no: g(r, /^Device No/i), name: g(r, /^Device Name/i), sub: g(r, /^Subunit No/i), online: g(r, /Online Status/i).toUpperCase(),
        tilt: g(r, /Actual Tilt/i), sector: g(r, /Actual Sector ID/i), fail: g(r, /Query Failure/i), err: g(r, /^Meaning/i) || g(r, /Response Error Code/i) };
    }).filter(function (r) { return /^\d+$/.test(r.no); });
  }

  // Usado pelo executor (mae_exec.js) nos DSP RET / DSP RETSUBUNIT do script:
  // done = todos os RET esperados prontos. exp = [{no, serial}] dos ADD RET do script (vazio = todos da resposta).
  function check(cmd, resp, exp) {
    exp = exp || [];
    if (!/RETCODE\s*=\s*0\b/.test(resp || "")) return { done: false, msg: retMsg(resp) || "sem resposta" };
    var sub = /^DSP\s+RETSUBUNIT/i.test(cmd);
    var rows = sub ? parseDspSub(resp) : parseDspRet(resp);
    var want = exp.length ? exp : rows.map(function (r) { return { no: r.no, serial: "" }; }).filter(function (e, i, a) { return a.map(function (x) { return x.no; }).indexOf(e.no) === i; });
    if (!want.length) return { done: false, msg: "nenhum RET na resposta" };
    var wait = [], warn = [];
    want.forEach(function (e) {
      var rs = rows.filter(function (r) { return r.no === String(e.no); });
      if (!rs.length) { wait.push(e.no + " (não listado)"); return; }
      if (sub) {
        var bad = rs.filter(function (r) { return r.online !== "AVAILABLE" || r.fail || !/^-?\d+$/.test(r.tilt); })[0];
        if (bad) wait.push(e.no + " (" + (bad.fail || bad.online || "tilt não lido") + ")");
      } else {
        var r = rs[0];
        if (!r.serial || r.fail) wait.push(e.no + " (" + (r.fail || "sem serial") + ")");
        else if (e.serial && r.serial.toUpperCase() !== String(e.serial).toUpperCase()) warn.push(e.no + ": serial lido " + r.serial + " ≠ " + e.serial);
      }
    });
    var ok = want.length - wait.length, what = sub ? "subunidades disponíveis com tilt lido" : "RET conectados";
    return { done: !wait.length, warn: warn.join(" · "),
      msg: ok + "/" + want.length + " " + what + (wait.length ? " · aguardando " + wait.slice(0, 6).join(", ") + (wait.length > 6 ? "…" : "") : "") + (warn.length ? " · ⚠ " + warn.join(" · ") : "") };
  }

  // ---------------------------------------------------------------- estado (por site, guardado neste navegador)
  var G = Object.assign({}, DEF, lsGet(LS_G, {}));     // preferências gerais (modelos, limiares…)
  var S = null;                                         // estado do site atual
  function blank(site) { return { site: site, scan: null, scanTs: "", existing: null, sec: {}, band: {}, ov: {}, bsid: "", start: "", portSel: {}, status: null }; }
  function load(site) { S = Object.assign(blank(site), lsGet(LS + site, {})); S.site = site; }
  function save() { if (S && S.site) lsSet(LS + S.site, { scan: S.scan, scanTs: S.scanTs, existing: S.existing, sec: S.sec, band: S.band, ov: S.ov, bsid: S.bsid, start: S.start, portSel: S.portSel, status: S.status }); lsSet(LS_G, G); }

  function siteModel() { try { return (window.PL_TOOL && window.PL_TOOL.rsModel && window.PL_TOOL.rsModel()) || null; } catch (e) { return null; } }
  function siteBands() {
    var M = siteModel(), out = [];
    (M && M.cells || []).forEach(function (c) {
      var f = String(c.freq || "").split("/").pop().replace(/\D.*$/, ""); if (!f) return;
      var t = c.tech === "UMTS" ? "U" + f : c.tech === "NR" ? "N" + f : "L" + f;
      if (out.indexOf(t) < 0) out.push(t);
    });
    return out.sort(function (a, b) { return a.localeCompare(b, "pt", { numeric: true }); });
  }
  function siteRrus() {
    var M = siteModel(), R = (M && M.rrus) || {};
    return Object.keys(R).map(function (k) { return R[k]; });
  }

  // serial "06CB26410005XA-R1" → antena "CB26410005XA", porta "R1" (prefixo de 2 dígitos = nº do array)
  function splitSerial(s) {
    s = String(s || "").trim();
    var m = /^\d{2}([A-Z0-9]{6,})-([A-Z0-9]{1,4})$/i.exec(s) || /^(.+)-([A-Z0-9]{1,4})$/i.exec(s);
    return m ? { ant: m[1].toUpperCase(), port: m[2].toUpperCase() } : { ant: s.toUpperCase(), port: "" };
  }
  function isRet(r) { return r.res === "SUCCESS" && /RET/.test(r.type) && r.serial; }
  function portKey(cn, srn, sn) { return [cn, srn, sn].join("-"); }

  // monta as linhas do cadastro (uma por RET encontrado)
  function model() {
    if (!S || !S.scan) return null;
    var exist = S.existing || [], bySerial = {};
    exist.forEach(function (e) { if (e.serial) bySerial[e.serial.toUpperCase()] = e; });
    var rets = S.scan.filter(isRet), ants = [], pord = [], used = {};
    exist.forEach(function (e) { used[e.no] = 1; });
    rets.forEach(function (r) { var sp = splitSerial(r.serial); if (ants.indexOf(sp.ant) < 0) ants.push(sp.ant); if (pord.indexOf(sp.port) < 0) pord.push(sp.port); });
    // numeração: setor a setor (SEC01, SEC02…) e, dentro da antena, as portas na ordem em que apareceram na varredura
    var secOf = function (a) { return parseInt(S.sec[a], 10) || ants.indexOf(a) + 1; };
    rets = rets.map(function (r, i) { return { r: r, i: i, sp: splitSerial(r.serial) }; }).sort(function (a, b) {
      return (secOf(a.sp.ant) - secOf(b.sp.ant)) || (ants.indexOf(a.sp.ant) - ants.indexOf(b.sp.ant)) || (pord.indexOf(a.sp.port) - pord.indexOf(b.sp.port)) || (a.i - b.i);
    }).map(function (x) { return x.r; });
    var maxNo = exist.reduce(function (m, e) { return Math.max(m, +e.no || 0); }, 0);
    var next = parseInt(S.start, 10) || maxNo + 1, rows = [];
    rets.forEach(function (r) {
      var sp = splitSerial(r.serial), o = S.ov[r.serial] || {}, ex = bySerial[r.serial.toUpperCase()];
      var secN = secOf(sp.ant);
      var band = S.band[sp.port] || "";
      var row = { r: r, serial: r.serial, ant: sp.ant, port: sp.port, secN: secN, band: band, exist: ex || null,
        configured: !!ex || r.cfg === "CONFIGURED", nsub: r.nsub || 1 };
      row.on = o.on != null ? !!o.on : !row.configured;
      if (row.exist) row.no = row.exist.no;
      else if (o.no) row.no = String(o.no);
      else if (row.configured) row.no = "";
      else { while (used[next]) next++; row.no = String(next); used[next] = 1; next++; }
      var tk = { BANDA: band, SEC: String(secN), SEC2: pad2(secN), PORTA: sp.port, OP: G.oper || "", SITE: S.site };
      row.autoName = tpl(G.nameTpl, tk, "_");
      row.name = o.name != null ? o.name : (row.exist && row.exist.name) || row.autoName;
      row.autoSec = [];
      for (var u = 1; u <= row.nsub; u++) row.autoSec.push(band && row.nsub === 1 ? tpl(G.secTpl, tk, "-") : "");
      row.sec = row.autoSec.map(function (a, i) { return o.sec && o.sec[i] != null ? o.sec[i] : a; });
      row.scen = o.scen || G.scen;
      rows.push(row);
    });
    return { rows: rows, ants: ants, ports: pord.filter(Boolean) };
  }
  function tpl(t, tk, sep) {
    var s = String(t || "").replace(/\{(\w+)\}/g, function (_, k) { return tk[k.toUpperCase()] != null ? tk[k.toUpperCase()] : ""; });
    var q = sep === "-" ? "\\-" : "_";
    return s.replace(new RegExp(q + "{2,}", "g"), sep).replace(new RegExp("^" + q + "+|" + q + "+$", "g"), "").trim();
  }

  function problems(M) {
    var out = [], nos = {}, names = {};
    (S.existing || []).forEach(function (e) { nos[e.no] = "já existe (" + (e.name || e.serial) + ")"; });
    M.rows.forEach(function (r) {
      if (!r.on) return;
      if (!r.configured) {
        if (!/^\d+$/.test(r.no)) out.push(r.serial + ": nº do RET inválido");
        else if (nos[r.no]) out.push("Nº " + r.no + " repetido: " + nos[r.no] + " e " + r.serial);
        else nos[r.no] = r.serial;
        if (!r.name) out.push(r.serial + ": nome vazio");
      } else if (!r.no) out.push(r.serial + ": já configurado no site, mas não achei o nº dele no LST RET (varra de novo)");
      if (r.name.length > MAXLEN) out.push(r.serial + ": nome com mais de " + MAXLEN + " caracteres");
      if (badChars(r.name)) out.push(r.serial + ": nome com aspas, apóstrofo, \\ ou ponto e vírgula");
      if (r.name) { var k = r.name.toUpperCase(); if (names[k]) out.push("Nome repetido: " + r.name); names[k] = 1; }
      r.sec.forEach(function (s) {
        if (s.length > MAXLEN) out.push(r.serial + ": Sector ID com mais de " + MAXLEN + " caracteres");
        if (badChars(s)) out.push(r.serial + ": Sector ID com aspas, apóstrofo, \\ ou ponto e vírgula");
      });
    });
    var b = S.bsid || S.site;
    if (b.length > MAXLEN || badChars(b)) out.push("BSID inválido (máx. " + MAXLEN + " caracteres, sem aspas)");
    return out;
  }

  // ---------------------------------------------------------------- scripts
  function retScript(M) {
    if (!M) return "";
    var add = M.rows.filter(function (r) { return r.on && !r.configured; });
    var mod = [];
    M.rows.forEach(function (r) { if (r.on && r.no) r.sec.forEach(function (s, i) { if (s) mod.push({ r: r, sub: i + 1, sec: s }); }); });
    if (!add.length && !mod.length) return "";
    var bsid = S.bsid || S.site, L = [];
    L.push("// RET — " + S.site + " · " + add.length + " ADD RET · " + mod.length + " Sector ID · gerado em " + now());
    if (add.length) {
      L.push("// 1) Cadastrar os RET achados na varredura (SCN ALD de " + (S.scanTs || "—") + ")");
      add.forEach(function (r) {
        L.push('ADD RET:DEVICENO=' + r.no + ',DEVICENAME="' + r.name + '",CTRLCN=' + r.r.cn + ',CTRLSRN=' + r.r.srn + ',CTRLSN=' + r.r.sn +
          ',RETTYPE=' + (r.r.type || "SINGLE_RET") + ',SCENARIO=' + r.scen + ',VENDORCODE="' + r.r.vendor + '",SERIALNO="' + r.serial + '";');
      });
      L.push("// 2) Esperar os RET conectarem e lerem o tilt (no ▶ Executar o DSP repete sozinho a cada 8 s até todos ficarem prontos)");
      L.push("DSP RET:;");
      L.push("DSP RETSUBUNIT:;");
    }
    if (mod.length) {
      L.push("// " + (add.length ? "3" : "1") + ") Sector ID dos RET (BSID = " + bsid + ")");
      mod.forEach(function (m) { L.push('MOD RETDEVICEDATA:DEVICENO=' + m.r.no + ',SUBUNITNO=' + m.sub + ',BSID="' + bsid + '",SECTORID="' + m.sec + '";'); });
    }
    L.push("// " + (add.length ? (mod.length ? "4" : "3") : "2") + ") Conferência final");
    L.push("DSP RET:;");
    L.push("DSP RETSUBUNIT:;");
    return L.join("\n");
  }
  function portList() {
    var map = {}, out = [];
    function add(cn, srn, sn, o) {
      var k = portKey(cn, srn, sn), p = map[k];
      if (!p) { p = map[k] = { k: k, cn: cn, srn: srn, sn: sn, name: "", type: "", rets: 0, fail: "" }; out.push(p); }
      Object.keys(o || {}).forEach(function (x) { if (o[x]) p[x] = o[x]; });
      return p;
    }
    siteRrus().forEach(function (u) { add(String(u.cab), String(u.srn), String(u.slot), { name: u.name || "", type: u.type || "" }); });
    (S && S.scan || []).forEach(function (r) {
      var p = add(r.cn, r.srn, r.sn);
      if (isRet(r)) p.rets++;
      else if (r.res === "FAILURE") p.fail = r.cause || "falha";
    });
    return out.sort(function (a, b) { return (+a.cn - +b.cn) || (+a.srn - +b.srn) || (+a.sn - +b.sn); });
  }
  function portScript(P) {
    var sel = P.filter(function (p) { return S.portSel[p.k] !== false; });
    if (!sel.length) return "";
    var thr = G.thr ? ",THRESHOLDTYPE=UER_SELF_DEFINE,UOTHD=" + G.uo + ",UCTHD=" + G.uc + ",OOTHD=" + G.oo + ",OCTHD=" + G.oc : "";
    var L = ["// Porta RET — " + S.site + " · alimentação" + (G.thr ? " + limiares de corrente personalizados" : "") + " · " + sel.length + " porta(s)"];
    sel.forEach(function (p) { L.push("MOD RETPORT:CN=" + p.cn + ",SRN=" + p.srn + ",SN=" + p.sn + ",PWRSWITCH=ON" + thr + ";"); });
    L.push("// Conferência");
    L.push("LST RETPORT:;");
    L.push("DSP RETPORT:;");
    return L.join("\n");
  }

  // ---------------------------------------------------------------- tela
  var st = document.createElement("style");
  st.textContent = [
    "#retSec h2{margin:0 0 4px;font-size:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
    "#retSec .ret-site{font:600 13px var(--mono);background:var(--surface-alt);border:1px solid var(--border);border-radius:6px;padding:2px 8px}",
    "#retSec .ret-step{border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:12px;background:var(--surface)}",
    "#retSec .ret-step>h3{margin:0 0 6px;font-size:14.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    "#retSec .ret-step>h3 .n{font:600 12px var(--mono);color:var(--accent);border:1px solid var(--border);border-radius:6px;padding:1px 7px}",
    "#retSec .ret-step>h3 .sp{flex:1}",
    "#retSec .ret-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}",
    "#retSec .ret-row label{display:flex;gap:6px;align-items:center;color:var(--text-muted);font-size:12.5px}",
    "#retSec input[type=text],#retSec input[type=number]{font:12.5px var(--mono);border:1px solid var(--border);border-radius:5px;padding:4px 6px;background:#fff;color:var(--text)}",
    "#retSec input[type=number]{width:70px}#retSec .ret-cfg select{font-size:12.5px;padding:4px 6px;border:1px solid var(--border);border-radius:5px}",
    "#retSec .ret-bar{height:14px;background:#eceef2;border-radius:7px;overflow:hidden;position:relative;flex:1;min-width:200px}",
    "#retSec .ret-bar i{display:block;height:100%;width:0;background:var(--success);transition:width .3s}",
    "#retSec .ret-bar b{position:absolute;inset:0;text-align:center;font:600 11px/14px var(--mono);color:var(--text)}",
    "#retSec .ret-tw{overflow:auto;max-height:460px;border:1px solid var(--border);border-radius:6px;margin-top:8px}",
    "#retSec table{border-collapse:collapse;width:100%;font-size:12.5px}",
    "#retSec th{position:sticky;top:0;background:var(--surface-alt);color:var(--text-muted);font-weight:500;text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap;z-index:1}",
    "#retSec td{padding:4px 8px;border-bottom:1px solid #eef0f4;white-space:nowrap;vertical-align:middle}",
    "#retSec td.m{font-family:var(--mono)}",
    "#retSec tr.off td{opacity:.5}#retSec tr.bad td{background:#fdecec}#retSec tr.ok td.s{color:var(--success);font-weight:600}",
    "#retSec td input[type=text]{width:100%;min-width:120px}#retSec td input.ov{background:#fff8e1;border-color:#e8c46a}",
    "#retSec .chip{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11.5px;font-weight:600;background:#eceef2;color:var(--text-muted)}",
    "#retSec .chip.ok{background:var(--success-bg);color:var(--success)}#retSec .chip.er{background:#fdecec;color:#c7000b}#retSec .chip.wt{background:var(--warning-bg);color:var(--warning)}",
    "#retSec .ret-msg{margin-top:8px;border-radius:6px;padding:8px 10px;font-size:12.5px}",
    "#retSec .ret-msg.warn{background:var(--warning-bg);color:var(--warning)}#retSec .ret-msg.er{background:#fdecec;color:#7a0007}#retSec .ret-msg.ok{background:var(--success-bg);color:var(--success)}",
    "#retSec pre.ret-pre{margin:8px 0 0;background:var(--mono-bg);border:1px solid var(--mono-border);color:var(--mono-text);font:12.5px/1.4 var(--mono);border-radius:6px;padding:10px 12px;max-height:280px;overflow:auto;white-space:pre}",
    "#retSec details.ret-paste summary{cursor:pointer;color:var(--text-muted);font-size:12.5px;margin-top:8px}",
    "#retSec details.ret-paste textarea{min-height:110px;margin-top:6px}",
    "#retSec .ret-cfg{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px 14px;margin-top:6px}",
    "#retSec .ret-cfg label{display:flex;flex-direction:column;gap:3px;color:var(--text-muted);font-size:12px}",
    "#retSec .ret-grp{display:flex;gap:6px 14px;flex-wrap:wrap;margin-top:6px;align-items:center}",
    "#retSec .ret-grp span.l{color:var(--text-muted);font-size:12px;min-width:120px}",
    "#retSec .ret-grp label{display:flex;gap:5px;align-items:center;font:12.5px var(--mono)}",
    "#retSec .ret-grp input[type=text]{width:90px}#retSec .ret-grp input[type=number]{width:58px}"
  ].join("\n");
  document.head.appendChild(st);

  var sec = document.createElement("section");
  sec.className = "phys"; sec.id = "retSec";
  sec.innerHTML =
    '<h2>RET — antenas AISG (varredura, cadastro e Sector ID) <span class="ret-site" id="retSite">—</span></h2>' +
    '<p class="instr">Roteiro: <b>1</b> varre o site (<span class="mono">SCN ALD</span>, espera o <i>Status = Success</i>) → <b>2</b> monta o <span class="mono">ADD RET</span> de cada RET achado, espera todos conectarem e grava o Sector ID (<span class="mono">MOD RETDEVICEDATA</span>) → <b>3</b> confere serial, tilt e Sector ID. ' +
    'Se uma porta não achar RET, use o passo <b>4</b> (alimentação da porta RET) — ele varre de novo sozinho no fim. Os scripts rodam pelo <b>▶ Executar no site</b> (conexão do painel <i>Executar no MAE</i> da aba Entrada).</p>' +

    '<div class="ret-step"><h3><span class="n">1</span>Varredura dos RET <span class="sp"></span><span id="retScanTs" class="muted" style="font-weight:400;font-size:12.5px"></span></h3>' +
      '<div class="ret-row"><button class="primary" type="button" id="retScan">▶ Varrer RET no site (SCN ALD)</button><button class="ghost" type="button" id="retScanStop" hidden>Parar de aguardar</button>' +
        '<div class="ret-bar" id="retBar" hidden><i></i><b>0%</b></div></div>' +
      '<div id="retScanMsg"></div>' +
      '<details class="ret-paste"><summary>Sem helper? Cole aqui a resposta do SCN ALD (e, se tiver, a do LST RET)</summary>' +
        '<textarea id="retPaste" spellcheck="false" placeholder="+++    SITE    data&#10;O&amp;M    #...&#10;%%SCN ALD:;%%&#10;..."></textarea>' +
        '<div class="ret-row"><button class="ghost" type="button" id="retPasteGo">Ler resposta colada</button></div></details>' +
      '<div id="retScanTbl"></div></div>' +

    '<div class="ret-step" id="retStep2"><h3><span class="n">2</span>Cadastro e Sector ID</h3><div id="retCad"><p class="muted">Faça a varredura (passo 1) para listar os RET.</p></div>' +
      '<pre class="ret-pre" id="retCmds"></pre>' +
      '<div class="ret-row"><button class="ghost" type="button" id="retCopy">Copiar script</button></div>' +
      '<div id="retWarn"></div></div>' +

    '<div class="ret-step"><h3><span class="n">3</span>Conferência <span class="sp"></span><button class="ghost" type="button" id="retCheck">Conferir agora (DSP RET + DSP RETSUBUNIT)</button></h3><div id="retStatus"><p class="muted">Aparece sozinho depois do ▶ Executar do passo 2 (ou clique em Conferir agora).</p></div></div>' +

    '<div class="ret-step"><h3><span class="n">4</span>Porta RET — alimentação e limiares <span class="muted" style="font-weight:400;font-size:12.5px">(quando a varredura não acha RET numa RRU)</span></h3>' +
      '<div class="ret-row"><label><input type="checkbox" id="retThr"> Limiares de corrente personalizados (<span class="mono">THRESHOLDTYPE=UER_SELF_DEFINE</span>)</label>' +
        '<label>UOTHD <input type="number" id="retUo"></label><label>UCTHD <input type="number" id="retUc"></label><label>OOTHD <input type="number" id="retOo"></label><label>OCTHD <input type="number" id="retOc"></label></div>' +
      '<div class="ret-row"><label><input type="checkbox" id="retAuto"> Ao terminar, esperar <input type="number" id="retWait" min="0" max="300" style="width:58px"> s (o RET liga) e varrer de novo</label></div>' +
      '<div id="retPorts"></div>' +
      '<pre class="ret-pre" id="retPortCmds"></pre>' +
      '<div class="ret-row"><button class="ghost" type="button" id="retPortCopy">Copiar script</button></div><div id="retPortMsg"></div></div>';
  pane.appendChild(sec);

  // ---------------------------------------------------------------- render
  function msg(id, cls, html) { $(id).innerHTML = html ? '<div class="ret-msg ' + cls + '">' + html + '</div>' : ""; }
  function render() {
    var site = loadedSite();
    if (!S || S.site !== site) load(site);
    $("retSite").textContent = site || "nenhum site carregado";
    $("retScanTs").textContent = S.scanTs ? "última varredura: " + S.scanTs : "";
    renderScan(); renderCad(); renderStatus(); renderPorts();
  }
  function renderScan() {
    if (!S.scan) { $("retScanTbl").innerHTML = ""; return; }
    var rows = S.scan, nRet = rows.filter(isRet).length, fails = rows.filter(function (r) { return r.res !== "SUCCESS"; });
    var other = rows.filter(function (r) { return r.res === "SUCCESS" && !isRet(r); });
    var rr = {}; siteRrus().forEach(function (u) { rr[portKey(u.cab, u.srn, u.slot)] = u; });
    var h = '<div class="ret-tw"><table><thead><tr><th>Porta (CN-SRN-SN)</th><th>RRU</th><th>Resultado</th><th>Tipo</th><th>Fabricante</th><th>Serial</th><th>Protocolo</th><th>Situação</th><th>Subunid.</th><th>Causa da falha</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var u = rr[portKey(r.cn, r.srn, r.sn)] || {};
        return '<tr class="' + (r.res !== "SUCCESS" ? "bad" : "") + '"><td class="m">' + esc(portKey(r.cn, r.srn, r.sn)) + (r.port ? " · " + esc(r.port) : "") + '</td><td>' + esc(u.name || "") + '</td>' +
          '<td><span class="chip ' + (r.res === "SUCCESS" ? "ok" : "er") + '">' + esc(r.res || "?") + '</span></td><td>' + esc(r.type) + '</td><td>' + esc(r.vendor) + '</td><td class="m">' + esc(r.serial) + '</td><td>' + esc(r.proto) + '</td>' +
          '<td>' + (r.cfg ? '<span class="chip ' + (r.cfg === "CONFIGURED" ? "ok" : "wt") + '">' + esc(r.cfg === "CONFIGURED" ? "já cadastrado" : r.cfg === "UNCONFIGURED" ? "a cadastrar" : r.cfg) + '</span>' : "") + '</td><td>' + esc(r.res === "SUCCESS" ? r.nsub : "") + '</td><td>' + esc(r.cause) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    var note = nRet + " RET encontrado(s)" + (other.length ? " · " + other.length + " outro(s) ALD (não são RET, ficam de fora)" : "") +
      (S.existing ? " · " + S.existing.length + " já cadastrado(s) no LST RET" : "");
    if (fails.length) note += '<br>⚠ ' + fails.map(function (r) { return "<b>" + esc(portKey(r.cn, r.srn, r.sn)) + "</b>: " + esc(r.cause || "falha"); }).join(" · ") +
      ' — confira a RRU / o cabo AISG; se a RRU estiver normal, ligue a alimentação da porta no <b>passo 4</b>.';
    else if (!nRet) note += '<br>⚠ Nenhum RET respondeu. Ligue a alimentação da porta RET no <b>passo 4</b> (ele varre de novo no fim).';
    $("retScanTbl").innerHTML = '<div class="ret-msg ' + (fails.length || !nRet ? "warn" : "ok") + '">' + note + '</div>' + h;
  }
  function renderCad() {
    var M = model();
    if (!M || !M.rows.length) {
      $("retCad").innerHTML = '<p class="muted">' + (S.scan ? "A varredura não achou RET para cadastrar." : "Faça a varredura (passo 1) para listar os RET.") + '</p>';
      $("retCmds").textContent = ""; msg("retWarn"); return;
    }
    var bands = siteBands();
    var h = '<datalist id="retBands">' + bands.map(function (b) { return '<option value="' + esc(b) + '">'; }).join("") + '</datalist>';
    h += '<div class="ret-cfg">' +
      '<label>Modelo do nome (DEVICENAME)<input type="text" id="retNameTpl" value="' + esc(G.nameTpl) + '"></label>' +
      '<label>Modelo do Sector ID<input type="text" id="retSecTpl" value="' + esc(G.secTpl) + '"></label>' +
      '<label>Operadora no Sector ID ({OP})<input type="text" id="retOper" value="' + esc(G.oper) + '"></label>' +
      '<label>BSID<input type="text" id="retBsid" value="' + esc(S.bsid || S.site) + '"></label>' +
      '<label>Nº inicial do RET (DEVICENO)<input type="number" id="retStart" min="0" value="' + esc(S.start) + '" placeholder="auto"></label>' +
      '<label>Cenário (SCENARIO)<select id="retScen"><option value="DAISY_CHAIN">DAISY_CHAIN (vários RET na mesma porta)</option><option value="REGULAR">REGULAR</option></select></label>' +
      '</div><p class="muted" style="font-size:12px;margin:4px 0 0">Campos: <span class="mono">{BANDA} {SEC} {SEC2} {PORTA} {OP} {SITE}</span>. Campo vazio some junto com o separador (sem banda: <span class="mono">SEC01_R1</span>). Sector ID só sai quando a porta tem banda (ou digitado na linha).</p>';
    h += '<div class="ret-grp"><span class="l">Antena → setor</span>' + M.ants.map(function (a, i) {
      return '<label title="Antena ' + esc(a) + '">' + esc(a) + ' → SEC <input type="number" min="1" max="99" data-sec="' + esc(a) + '" value="' + esc(S.sec[a] || i + 1) + '"></label>';
    }).join("") + '</div>';
    h += '<div class="ret-grp"><span class="l">Porta da antena → banda</span>' + M.ports.map(function (p) {
      return '<label>' + esc(p) + ' <input type="text" list="retBands" data-band="' + esc(p) + '" value="' + esc(S.band[p] || "") + '" placeholder="sem banda"></label>';
    }).join("") + (bands.length ? '<span class="muted" style="font-size:12px">bandas do site: ' + esc(bands.join(", ")) + '</span>' : '') + '</div>';
    h += '<div class="ret-tw"><table><thead><tr><th><input type="checkbox" id="retAll" title="Marcar/desmarcar todos"></th><th>Nº</th><th>Porta</th><th>Serial</th><th>Antena</th><th>SEC</th><th>Porta ant.</th><th>Tipo</th><th>DEVICENAME</th><th>Sector ID</th><th>Situação</th></tr></thead><tbody>' +
      M.rows.map(function (r, i) {
        var nm = '<input type="text" data-name="' + i + '" value="' + esc(r.name) + '" class="' + (r.name !== r.autoName ? "ov" : "") + '"' + (r.configured ? " disabled" : "") + ' title="' + esc(r.name !== r.autoName ? "editado (automático: " + r.autoName + ")" : "automático") + '">';
        var sc = r.sec.map(function (s, u) {
          return '<input type="text" data-secid="' + i + ":" + u + '" value="' + esc(s) + '" class="' + (s !== r.autoSec[u] ? "ov" : "") + '" placeholder="' + (r.nsub > 1 ? "subunidade " + (u + 1) : "sem Sector ID") + '">';
        }).join("");
        return '<tr class="' + (r.on ? "" : "off") + '"><td><input type="checkbox" data-on="' + i + '"' + (r.on ? " checked" : "") + '></td>' +
          '<td>' + (r.configured ? '<span class="mono">' + esc(r.no || "?") + '</span>' : '<input type="number" min="0" data-no="' + i + '" value="' + esc(r.no) + '" style="width:58px">') + '</td>' +
          '<td class="m">' + esc(portKey(r.r.cn, r.r.srn, r.r.sn)) + '</td><td class="m">' + esc(r.serial) + '</td><td class="m">' + esc(r.ant) + '</td><td>' + r.secN + '</td><td class="m">' + esc(r.port) + '</td>' +
          '<td>' + esc(r.r.type) + (r.nsub > 1 ? " ×" + r.nsub : "") + '</td><td>' + nm + '</td><td>' + sc + '</td>' +
          '<td>' + (r.configured ? '<span class="chip ok" title="só o Sector ID entra no script">já cadastrado' + (r.exist && r.exist.name ? " · " + esc(r.exist.name) : "") + '</span>' : '<span class="chip wt">ADD RET</span>') + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<div class="ret-row"><button class="ghost" type="button" id="retResetOv">↺ Nomes e Sector ID automáticos</button><span class="muted" style="font-size:12px">Amarelo = editado à mão. Já cadastrado: desmarcado por padrão; marcado, só entra o Sector ID.</span></div>';
    $("retCad").innerHTML = h;
    $("retScen").value = G.scen;
    var on = M.rows.filter(function (r) { return r.on; }).length;
    $("retAll").checked = on === M.rows.length; $("retAll").indeterminate = on > 0 && on < M.rows.length;
    renderScript(M);
  }
  function renderScript(M) {
    M = M || model();
    if (!M) return;
    var pr = problems(M);
    $("retCmds").textContent = pr.length ? "// corrija antes de executar:\n// · " + pr.join("\n// · ") : retScript(M);
    msg("retWarn", pr.length ? "er" : "", pr.length ? "✖ " + pr.map(esc).join("<br>✖ ") : "");
    var b = $("mx-retCmds"); if (b) b.disabled = !!pr.length || !$("retCmds").textContent;
  }
  function renderStatus() {
    var s = S.status;
    if (!s) { $("retStatus").innerHTML = '<p class="muted">Aparece sozinho depois do ▶ Executar do passo 2 (ou clique em Conferir agora).</p>'; return; }
    var subs = s.sub || [], rets = s.ret || [], nos = [];
    rets.concat(subs).forEach(function (r) { if (nos.indexOf(r.no) < 0) nos.push(r.no); });
    nos.sort(function (a, b) { return +a - +b; });
    var nOk = 0, lines = [];
    nos.forEach(function (no) {
      var R = rets.filter(function (r) { return r.no === no; })[0] || {}, U = subs.filter(function (r) { return r.no === no; });
      (U.length ? U : [{}]).forEach(function (u) {
        var ok = R.serial && !R.fail && u.online === "AVAILABLE" && !u.fail && /^-?\d+$/.test(u.tilt || "");
        if (ok) nOk++;
        lines.push('<tr class="' + (ok ? "ok" : "bad") + '"><td class="m">' + esc(no) + '</td><td>' + esc(R.name || u.name || "") + '</td><td class="m">' + esc(R.serial || "") + '</td><td class="m">' + esc(R.cn != null && R.srn ? portKey(R.cn, R.srn, R.sn) : "") + '</td>' +
          '<td>' + esc(u.sub || "") + '</td><td>' + (u.online ? '<span class="chip ' + (u.online === "AVAILABLE" ? "ok" : "er") + '">' + esc(u.online) + '</span>' : "") + '</td>' +
          '<td class="m">' + (/^-?\d+$/.test(u.tilt || "") ? (u.tilt / 10).toFixed(1) + "°" : "") + '</td><td class="m">' + esc(u.sector || "") + '</td>' +
          '<td>' + esc([R.fail, u.fail, R.err, u.err].filter(Boolean).join(" · ")) + '</td><td class="s">' + (ok ? "✔ pronto" : "⏳ / ✖") + '</td></tr>');
      });
    });
    $("retStatus").innerHTML = '<div class="ret-msg ' + (nOk === lines.length && lines.length ? "ok" : "warn") + '">' + nOk + "/" + lines.length + " subunidade(s) prontas · lido em " + esc(s.ts) +
      (nOk < lines.length ? " · RET recém-cadastrado leva alguns segundos (SYSTEM_BUSY / ALD_DISCONNECTED); confira de novo." : "") + '</div>' +
      '<div class="ret-tw"><table><thead><tr><th>Nº</th><th>Nome</th><th>Serial lido</th><th>Porta</th><th>Subunid.</th><th>Online</th><th>Tilt</th><th>Sector ID lido</th><th>Falha</th><th></th></tr></thead><tbody>' + lines.join("") + '</tbody></table></div>';
  }
  function renderPorts() {
    $("retThr").checked = !!G.thr; $("retAuto").checked = !!G.autoscan;
    $("retUo").value = G.uo; $("retUc").value = G.uc; $("retOo").value = G.oo; $("retOc").value = G.oc; $("retWait").value = G.wait;
    ["retUo", "retUc", "retOo", "retOc"].forEach(function (i) { $(i).disabled = !G.thr; });
    var P = portList();
    if (!P.length) { $("retPorts").innerHTML = '<p class="muted">Carregue o site na aba Entrada (LST RRU) ou faça a varredura para listar as portas.</p>'; $("retPortCmds").textContent = ""; return; }
    $("retPorts").innerHTML = '<div class="ret-tw" style="max-height:260px"><table><thead><tr><th></th><th>Porta (CN-SRN-SN)</th><th>RRU</th><th>Tipo</th><th>Última varredura</th></tr></thead><tbody>' +
      P.map(function (p) {
        var on = S.portSel[p.k] !== false;
        return '<tr class="' + (on ? "" : "off") + '"><td><input type="checkbox" data-port="' + esc(p.k) + '"' + (on ? " checked" : "") + '></td><td class="m">' + esc(p.k) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.type) + '</td>' +
          '<td>' + (!S.scan ? "" : p.fail ? '<span class="chip er">' + esc(p.fail) + '</span>' : p.rets ? '<span class="chip ok">' + p.rets + ' RET</span>' : '<span class="chip wt">nenhum RET</span>') + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    $("retPortCmds").textContent = portScript(P);
  }

  // ---------------------------------------------------------------- eventos da tela
  function ovOf(serial) { return S.ov[serial] || (S.ov[serial] = {}); }
  sec.addEventListener("change", function (e) {
    var t = e.target, M = model(), r, a;
    if (!S) return;
    if ((a = t.getAttribute("data-on")) != null) { r = M.rows[+a]; ovOf(r.serial).on = t.checked; }
    else if (t.id === "retAll") M.rows.forEach(function (r) { ovOf(r.serial).on = t.checked; });
    else if ((a = t.getAttribute("data-no")) != null) { r = M.rows[+a]; if (t.value) ovOf(r.serial).no = t.value; else delete ovOf(r.serial).no; }
    else if ((a = t.getAttribute("data-name")) != null) { r = M.rows[+a]; if (t.value.trim() === r.autoName) delete ovOf(r.serial).name; else ovOf(r.serial).name = t.value.trim(); }
    else if ((a = t.getAttribute("data-secid")) != null) {
      var p = a.split(":"); r = M.rows[+p[0]]; var o = ovOf(r.serial); o.sec = o.sec || [];
      o.sec[+p[1]] = t.value.trim() === r.autoSec[+p[1]] ? null : t.value.trim();
    }
    else if ((a = t.getAttribute("data-sec")) != null) S.sec[a] = t.value;
    else if ((a = t.getAttribute("data-band")) != null) S.band[a] = t.value.trim().toUpperCase();
    else if ((a = t.getAttribute("data-port")) != null) { S.portSel[a] = t.checked; save(); renderPorts(); return; }
    else if (t.id === "retNameTpl") G.nameTpl = t.value.trim() || DEF.nameTpl;
    else if (t.id === "retSecTpl") G.secTpl = t.value.trim() || DEF.secTpl;
    else if (t.id === "retOper") G.oper = t.value.trim();
    else if (t.id === "retBsid") S.bsid = t.value.trim() === S.site ? "" : t.value.trim();
    else if (t.id === "retStart") S.start = t.value;
    else if (t.id === "retScen") G.scen = t.value;
    else if (/^ret(Thr|Auto|Uo|Uc|Oo|Oc|Wait)$/.test(t.id)) {
      G.thr = $("retThr").checked; G.autoscan = $("retAuto").checked;
      ["uo", "uc", "oo", "oc"].forEach(function (k) { var v = parseInt($("ret" + k.charAt(0).toUpperCase() + k.charAt(1)).value, 10); G[k] = isNaN(v) ? DEF[k] : v; });
      var w = parseInt($("retWait").value, 10); G.wait = isNaN(w) ? DEF.wait : Math.max(0, Math.min(300, w));
      save(); renderPorts(); return;
    }
    else return;
    save(); renderCad();
  });
  sec.addEventListener("click", function (e) {
    if (e.target.id === "retResetOv") { Object.keys(S.ov).forEach(function (k) { delete S.ov[k].name; delete S.ov[k].sec; }); save(); renderCad(); }
  });
  $("retCopy").onclick = function () { copyText($("retCmds").textContent, this); };
  $("retPortCopy").onclick = function () { copyText($("retPortCmds").textContent, this); };
  $("retPasteGo").onclick = function () {
    render();
    if (!S.site) { msg("retScanMsg", "er", "Carregue o site na aba Entrada antes."); return; }
    var t = $("retPaste").value, rows = parseScan(t);
    if (!rows.length) { msg("retScanMsg", "er", "Não achei a tabela de resultado do SCN ALD (procure o bloco <i>Status = Success</i> com a tabela <i>Result</i>)."); return; }
    var ex = /LST\s+RET\s*:/i.test(t) ? parseLstRet(t.slice(t.search(/LST\s+RET\s*:/i))) : null;
    setScan(rows, ex);
    msg("retScanMsg", "ok", "Resposta colada lida: " + rows.length + " linha(s).");
  };

  function setScan(rows, existing) {
    S.scan = rows; S.scanTs = now();
    if (existing) S.existing = existing;
    save(); render();
  }

  // ---------------------------------------------------------------- 1) varredura pelo helper (tarefa)
  var scanJob = null;
  function bar(pct, txt) { var b = $("retBar"); b.hidden = false; b.querySelector("i").style.width = (pct || 0) + "%"; b.querySelector("b").textContent = txt; }
  function canRun(what) {
    var s = window.MAE && window.MAE.state();
    if (!s || !s.online || !s.logged) { alert("Para " + what + ", conecte primeiro no painel \"Executar no MAE\" da aba Entrada (usuário e senha do MAE)."); return false; }
    if (!S.site) { alert("Nenhum site carregado. Carregue o site na aba Entrada (Rodada 1)."); return false; }
    return true;
  }
  async function scan() {
    if (scanJob) return;
    render();
    if (!canRun("varrer os RET")) return;
    var s = window.MAE.state();
    if (s.version != null && s.version < MINV) { alert("A varredura precisa do helper v" + MINV + "+ (este PC tem v" + s.version + "). Rode o instalador de novo — ou cole a resposta do SCN ALD no campo abaixo."); return; }
    var site = S.site, t0 = Date.now();
    $("retScan").disabled = true; $("retScanStop").hidden = false;
    msg("retScanMsg"); bar(0, "iniciando SCN ALD em " + site + "…");
    window.MAE.log("RET: SCN ALD em " + site + "…", "in");
    try {
      var v = await window.MAE.api("/job/start", { ne: site, title: "Varredura de RET (SCN ALD)", meta: { kind: "ret" },
        steps: [{ cmd: "SCN ALD:;", label: "SCN ALD", long: true, need: "success", maxsec: 900, quiet: 20 }, { cmd: "LST RET:;", label: "LST RET" }] });
      scanJob = v.id;
      for (;;) {
        await sleep(1500);
        v = await window.MAE.api("/job/status?id=" + encodeURIComponent(scanJob));
        var s0 = v.steps[0] || {}, secs = Math.round((Date.now() - t0) / 1000);
        if (v.state !== "running" && v.state !== "queued") break;
        if (v.cur >= 1) bar(100, "lendo LST RET…");
        else bar(s0.pct || 0, (s0.pct != null ? s0.pct + "%" : "aguardando o site começar a varredura…") + (s0.pct === 99 ? " · aguardando Status = Success" : "") + " · " + secs + " s");
      }
      v = await window.MAE.api("/job/status?full=1&id=" + encodeURIComponent(scanJob));
      var a = v.steps[0] || {}, b = v.steps[1] || {}, rows = parseScan(a.resp || "");
      if (!rows.length) throw new Error(a.msg || v.note || "o SCN ALD não devolveu a tabela de resultado");
      setScan(rows, b.ok ? parseLstRet(b.resp || "") : null);
      var n = rows.filter(isRet).length;
      bar(100, "concluído · " + n + " RET · " + Math.round((Date.now() - t0) / 1000) + " s");
      msg("retScanMsg", a.ok ? "ok" : "warn", (a.ok ? "✔ Varredura concluída (Status = Success)." : "⚠ " + esc(a.msg || "a varredura não terminou com Success") + " — mostrando o que o site devolveu.") +
        (b.ok ? "" : " · LST RET não lido (" + esc(b.msg || "pulado") + "): confira se algum já está cadastrado antes do ADD."));
      window.MAE.log("RET: SCN ALD em " + site + " → " + n + " RET", a.ok ? "ok" : "er");
      if (n) $("retStep2").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      bar(0, "falhou");
      msg("retScanMsg", "er", "✖ " + esc(e.message) + " — dá para colar a resposta do SCN ALD no campo abaixo.");
      window.MAE.log("RET: SCN ALD em " + site + " falhou: " + e.message, "er");
    } finally {
      scanJob = null; $("retScan").disabled = false; $("retScanStop").hidden = true;
    }
  }
  $("retScan").onclick = scan;
  $("retScanStop").onclick = function () { if (scanJob) window.MAE.api("/job/stop", { id: scanJob }).catch(function () {}); };

  // ---------------------------------------------------------------- 3) conferência
  function statusFrom(retResp, subResp) {
    S.status = { ts: now(), ret: parseDspRet(retResp || ""), sub: parseDspSub(subResp || "") };
    save(); renderStatus();
  }
  $("retCheck").onclick = async function () {
    render();
    if (!canRun("conferir os RET")) return;
    if (window.MAE.state().busy) { alert("O MAE está ocupado com outra execução. Aguarde terminar."); return; }
    var btn = this; btn.disabled = true; btn.textContent = "Lendo…";
    window.MAE.setBusy(true, "a conferência de RET (Conexão física)");
    try {
      var r = await window.MAE.api("/run", { ne: S.site, cmds: ["DSP RET:;", "DSP RETSUBUNIT:;"] });
      if (r[0] && /^REG NE/.test(r[0].cmd)) { if (!r[0].ok) throw new Error("REG NE falhou para " + S.site); r = r.slice(1); }
      statusFrom((r[0] || {}).resp, (r[1] || {}).resp);
    } catch (e) { $("retStatus").innerHTML = '<div class="ret-msg er">✖ ' + esc(e.message) + '</div>'; }
    finally { await window.MAE.api("/unreg", {}).catch(function () {}); window.MAE.setBusy(false); btn.disabled = false; btn.textContent = "Conferir agora (DSP RET + DSP RETSUBUNIT)"; }
  };

  // fim de um ▶ Executar (mae_exec.js)
  window.addEventListener("mae:done", function (ev) {
    var d = ev.detail || {};
    if (!S || !d.ne || String(d.ne).split("·")[0].trim().toUpperCase() !== String(S.site).toUpperCase()) return;
    var last = function (re) { var x = (d.items || []).filter(function (it) { return re.test(it.cmd) && it.resp; }).pop(); return x ? x.resp.split(/\n----- consulta \d+ -----\n/).pop() : ""; };
    if (d.id === "retCmds") {
      var a = last(/^DSP\s+RET\s*:/i), b = last(/^DSP\s+RETSUBUNIT\s*:/i);
      if (a || b) statusFrom(a, b);
      if (d.ok && S.scan) { S.scan.forEach(function (r) { if (isRet(r) && (d.items || []).some(function (it) { return (it.st === "ok" || it.st === "rt") && it.cmd.indexOf('SERIALNO="' + r.serial + '"') > 0; })) r.cfg = "CONFIGURED"; }); save(); }
      render();
    }
    if (d.id === "retPortCmds" && d.ok && G.autoscan) {
      var n = G.wait;
      msg("retPortMsg", "ok", "✔ Porta(s) RET configurada(s). Varredura nova em <b id=\"retCd\">" + n + "</b> s…");
      var h = setInterval(function () {
        n--; var el = $("retCd"); if (el) el.textContent = Math.max(0, n);
        if (n <= 0) { clearInterval(h); msg("retPortMsg"); sec.scrollIntoView({ behavior: "smooth", block: "start" }); scan(); }
      }, 1000);
    } else if (d.id === "retPortCmds") msg("retPortMsg", d.ok ? "ok" : "warn", d.ok ? "✔ Porta(s) RET configurada(s). Rode a varredura (passo 1)." : "⚠ A execução não terminou: confira antes de varrer.");
  });

  // atualiza quando a aba abre (o site pode ter mudado na Entrada)
  var tab = $("tab-ph"); if (tab) tab.addEventListener("click", function () { setTimeout(render, 0); });
  if ($("neLbl") && window.MutationObserver) new MutationObserver(function () { setTimeout(render, 150); }).observe($("neLbl"), { childList: true, characterData: true, subtree: true });
  render();

  window.RETALD = { check: check, render: render, _t: { parseScan: parseScan, parseLstRet: parseLstRet, parseDspRet: parseDspRet, parseDspSub: parseDspSub, splitSerial: splitSerial, model: model, retScript: retScript, portScript: portScript, portList: portList, state: function () { return S; }, G: G } };
})();
