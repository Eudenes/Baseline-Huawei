/* ret_ald.js — caixa "RET (antenas AISG)" na aba Conexão física.
   Bloco 1 · Situação atual (lida na Rodada 1 da Entrada ou em "↻ Ler RET e portas agora"):
       portas RET (LST/DSP RETPORT) e RET cadastrados (LST/DSP RET, DSP RETSUBUNIT, LST/DSP RETDEVICEDATA):
       nome, serial, online, tilt, limites de tilt, bandas da antena, Sector ID.
   Bloco 2 · Configurar, na ordem de campo:
       a) habilitar a porta RET da RRU (MOD RETPORT, limiares) → espera e varre sozinho
       b) varrer (SCN ALD: tarefa no helper, espera o "Status = Success") — só pelo botão
       c) cadastrar os novos (ADD RET → espera conectar → Sector ID)
       d) ajustar os já cadastrados: DEVICENAME (MOD RET), Sector ID (MOD RETDEVICEDATA), tilt (MOD RETSUBUNIT)
       um script único, executado pelo "▶ Executar no site" do mae_exec.js (campo retCmds; porta = retPortCmds).
   Respostas MML em tabela (horizontal) ou "Chave = valor" (vertical, quando há 1 resultado): as duas são lidas.
   Exporta window.RETALD (check: usado pelo executor; setText: chamado pela Entrada; READ: comandos de leitura). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var pane = $("pane-ph");
  if (!pane) return;

  var LS = "retald.v1.", LS_G = "retald.v1";
  var MINV = 3.4;                                          // tarefas (/job) no helper
  var READ = ["LST RET:;", "DSP RET:;", "DSP RETSUBUNIT:;", "LST RETDEVICEDATA:;", "DSP RETDEVICEDATA:;", "LST RETPORT:;", "DSP RETPORT:;"];
  var DEF = { scen: "DAISY_CHAIN", oper: "TIM", nameTpl: "{BANDA}_SEC{SEC2}_{PORTA} ", secTpl: "S{SEC}-{PORTA}-{BANDA}-{OP}",
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
  function isInt(v) { return /^-?\d+$/.test(String(v == null ? "" : v)); }
  function deg(v) { return isInt(v) ? (v / 10).toFixed(1) + "°" : ""; }
  function portKey(cn, srn, sn) { return [cn, srn, sn].join("-"); }

  // ---------------------------------------------------------------- leitura das respostas MML
  // Tabela (cabeçalho com colunas separadas por 2+ espaços): devolve as linhas da ÚLTIMA tabela com todas as `keys`.
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
  // Vertical ("Chave  =  valor"): um registro novo a cada `first` (ou chave repetida)
  function parseKV(text, first) {
    var recs = [], cur = null;
    String(text || "").replace(/\r/g, "").split("\n").forEach(function (l) {
      var m = /^\s*([A-Za-z][A-Za-z0-9 ._()\/'-]*?)\s+=\s+(.*)$/.exec(l); if (!m) return;
      var k = m[1].trim();
      if (/^(RETCODE|Report Type|Status|Progress|Session ID)$/i.test(k)) return;
      if (!cur || k === first || cur[k] !== undefined) { cur = {}; recs.push(cur); }
      cur[k] = m[2].trim();
    });
    return recs.filter(function (r) { return r[first] !== undefined; });
  }
  function records(text, keys) { var t = parseTable(text, keys); return t && t.length ? t : parseKV(text, keys[0]); }
  function g(o, re) { for (var k in o) if (re.test(k) && nv(o[k])) return nv(o[k]); return ""; }

  function parseScan(text) {
    return records(text, ["Control Port Cabinet No.", "Serial No."]).map(function (r) {
      return { cn: g(r, /Cabinet No/i), srn: g(r, /Subrack No/i), sn: g(r, /Slot No/i), port: g(r, /^Control Port No/i),
        res: g(r, /^Result/i).toUpperCase(), type: g(r, /Device Type/i).toUpperCase(), vendor: g(r, /Vendor Code/i), serial: g(r, /^Serial No/i),
        proto: g(r, /Protocol/i), cfg: g(r, /Configure Status/i).toUpperCase(), nsub: parseInt(g(r, /Subunits/i), 10) || 1, cause: g(r, /Failure Cause/i) };
    });
  }
  function devNo(rows) { return rows.filter(function (r) { return /^\d+$/.test(r.no); }); }
  function parseLstRet(text) {
    return devNo(records(text, ["Device No.", "Device Name"]).map(function (r) {
      return { no: g(r, /^Device No/i), name: g(r, /^Device Name/i), serial: g(r, /^(Actual Device )?Serial No/i), vendor: g(r, /Vendor Code/i),
        cn: g(r, /Cabinet No/i), srn: g(r, /Subrack No/i), sn: g(r, /Slot No/i), type: g(r, /RET Type/i) };
    }));
  }
  function parseDspRet(text) {
    return devNo(records(text, ["Device No.", "Actual Device Serial No."]).map(function (r) {
      return { no: g(r, /^Device No/i), name: g(r, /^Device Name/i), serial: g(r, /Actual Device Serial/i), vendor: g(r, /Actual Vendor/i),
        cn: g(r, /Cabinet No/i), srn: g(r, /Subrack No/i), sn: g(r, /Slot No/i), fail: g(r, /Query Failure/i), err: g(r, /^Meaning/i) || g(r, /Response Error Code/i) };
    }));
  }
  function parseDspSub(text) {
    return devNo(records(text, ["Device No.", "Subunit No.", "Online Status"]).map(function (r) {
      return { no: g(r, /^Device No/i), name: g(r, /^Device Name/i), sub: g(r, /^Subunit No/i) || "1", online: g(r, /Online Status/i).toUpperCase(),
        tilt: g(r, /Actual Tilt/i), sector: g(r, /Actual Sector ID/i), fail: g(r, /Query Failure/i), err: g(r, /^Meaning/i) || g(r, /Response Error Code/i) };
    }));
  }
  function parseDevData(text) {
    return devNo(records(text, ["Device No.", "Subunit No.", "AISG Sector ID"]).map(function (r) {
      var bands = [1, 2, 3, 4].map(function (i) { return g(r, new RegExp("^Band" + i + "$", "i")); }).filter(function (b) { return b && !/UNUSED/i.test(b); });
      return { no: g(r, /^Device No/i), name: g(r, /^Device Name/i), sub: g(r, /^Subunit No/i) || "1", model: g(r, /Antenna Model/i), ant: g(r, /Antenna Serial/i),
        max: g(r, /^Max Tilt/i), min: g(r, /^Min Tilt/i), bands: bands, bsid: g(r, /Base Station ID/i), sector: g(r, /AISG Sector ID/i), fail: g(r, /Query Failure/i) };
    }));
  }
  // LST/DSP RETPORT — guarda todas as colunas, juntando por CN-SRN-SN
  function parsePort(text) {
    return records(text, ["Cabinet No.", "Slot No."]).map(function (r) {
      var cn = g(r, /^(Control Port )?Cabinet No/i), srn = g(r, /^(Control Port )?Subrack No/i), sn = g(r, /^(Control Port )?Slot No/i), o = {};
      Object.keys(r).forEach(function (k) { if (!/Cabinet No|Subrack No|Slot No/i.test(k)) o[k] = nv(r[k]); });
      return { k: portKey(cn, srn, sn), cn: cn, srn: srn, sn: sn, f: o };
    }).filter(function (p) { return /^\d+$/.test(p.srn); });
  }
  function pf(p, re) { return p ? g(p.f, re) : ""; }
  function onOff(v) { return /^ON$/i.test(v) ? true : /^OFF$/i.test(v) ? false : null; }
  function powerOn(p) { return onOff(pf(p, /Actual Power Switch/i) || pf(p, /Power Switch/i)); }
  // bloco de resposta de um comando ("%%/*n*/LST RET:;%%" até o próximo eco "%%…%%")
  function block(t, cmd) {
    var p = cmd.replace(/:;?$/, "").split(/\s+/), re = new RegExp("%%(?:/\\*\\d+\\*/)?\\s*" + p[0] + "\\s+" + p[1] + "\\s*:[^%]*%%", "i");
    var m = re.exec(t); if (!m) return null;
    var rest = t.slice(m.index + m[0].length), e = rest.search(/%%(?:\/\*\d+\*\/)?\s*[A-Z]{2,}\s+[A-Z0-9_]+\s*:[^%\r\n]*%%/i);
    return e < 0 ? rest : rest.slice(0, e);
  }

  // ---------------------------------------------------------------- estado (por site, guardado neste navegador)
  var G = Object.assign({}, DEF, lsGet(LS_G, {}));
  if (G.nameTpl === "{BANDA}_SEC{SEC2}_{PORTA}") G.nameTpl = DEF.nameTpl;
  var S = null;
  var KEEP = ["scan", "scanTs", "cur", "sec", "band", "ov", "bsid", "start", "portSel", "edN", "edS", "edT"];
  function blank(site) { return { site: site, scan: null, scanTs: "", cur: {}, sec: {}, band: {}, ov: {}, bsid: "", start: "", portSel: {}, edN: {}, edS: {}, edT: {} }; }
  function load(site) {
    var o = lsGet(LS + site, {}) || {};
    if (!o.cur) {                                       // formato anterior
      o.cur = {};
      if (o.existing) o.cur.lst = { rows: o.existing };
      if (o.status) { o.cur.ret = { rows: o.status.ret || [], ts: o.status.ts }; o.cur.sub = { rows: o.status.sub || [], ts: o.status.ts }; }
    }
    S = blank(site); KEEP.forEach(function (k) { if (o[k] != null) S[k] = o[k]; }); S.site = site;
  }
  function save() { if (!S || !S.site) return; var o = {}; KEEP.forEach(function (k) { o[k] = S[k]; }); lsSet(LS + S.site, o); lsSet(LS_G, G); }

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
  function siteRrus() { var M = siteModel(), R = (M && M.rrus) || {}; return Object.keys(R).map(function (k) { return R[k]; }); }
  function rruMap() { var rr = {}; siteRrus().forEach(function (u) { rr[portKey(u.cab, u.srn, u.slot)] = u; }); return rr; }

  // respostas de leitura → S.cur (só substitui o que veio no texto)
  function apply(t, src) {
    t = String(t || "").replace(/<br\s*\/?>/gi, "\n").replace(/\r/g, "");
    var C = S.cur, ts = now(), n = 0, b;
    var put = function (k, cmd, fn) { b = block(t, cmd); if (b == null || !/RETCODE\s*=\s*0\b/.test(b)) return; C[k] = { rows: fn(b), ts: ts, src: src }; n++; };
    put("lst", "LST RET:;", parseLstRet);
    put("ret", "DSP RET:;", parseDspRet);
    put("sub", "DSP RETSUBUNIT:;", parseDspSub);
    put("ldev", "LST RETDEVICEDATA:;", parseDevData);
    put("dev", "DSP RETDEVICEDATA:;", parseDevData);
    var lp = block(t, "LST RETPORT:;"), dp = block(t, "DSP RETPORT:;");
    if (lp != null || dp != null) {
      var m = {}, list = [];
      parsePort(lp || "").concat(parsePort(dp || "")).forEach(function (p) {
        var q = m[p.k]; if (!q) { q = m[p.k] = { k: p.k, cn: p.cn, srn: p.srn, sn: p.sn, f: {} }; list.push(q); }
        Object.keys(p.f).forEach(function (k) { if (p.f[k] || q.f[k] == null) q.f[k] = p.f[k]; });
      });
      C.ports = { ts: ts, src: src, list: list.sort(function (a, b) { return (+a.cn - +b.cn) || (+a.srn - +b.srn) || (+a.sn - +b.sn); }) }; n++;
    }
    return n;
  }
  function rowsOf(k) { return (S.cur[k] && S.cur[k].rows) || []; }
  function lastTs() { var t = ""; ["ports", "lst", "ret", "sub", "dev"].forEach(function (k) { if (S.cur[k] && S.cur[k].ts && !t) t = S.cur[k].ts + (S.cur[k].src ? " (" + S.cur[k].src + ")" : ""); }); return t; }

  // RET cadastrados: uma linha por RET × subunidade, juntando tudo o que foi lido
  function devRows() {
    var by = {}, out = [];
    function dv(no) { return by[no] || (by[no] = { no: no, name: "", serial: "", port: "", fail: "", subs: {} }); }
    function su(d, s) { return d.subs[s] || (d.subs[s] = { sub: s }); }
    rowsOf("lst").forEach(function (r) { var d = dv(r.no); d.name = d.name || r.name; d.serial = d.serial || r.serial; if (r.srn) d.port = d.port || portKey(r.cn, r.srn, r.sn); });
    rowsOf("ret").forEach(function (r) { var d = dv(r.no); d.name = r.name || d.name; d.serial = r.serial || d.serial; if (r.srn) d.port = portKey(r.cn, r.srn, r.sn); d.fail = r.fail; });
    rowsOf("sub").forEach(function (r) { var d = dv(r.no); d.name = d.name || r.name; var u = su(d, r.sub); u.online = r.online; u.tilt = r.tilt; u.asec = r.sector; u.fail = r.fail || r.err; });
    rowsOf("dev").forEach(function (r) { var d = dv(r.no); d.name = d.name || r.name; var u = su(d, r.sub); u.min = r.min; u.max = r.max; u.model = r.model; u.ant = r.ant; u.bands = r.bands; u.dsec = r.sector; if (r.fail) u.fail = u.fail || r.fail; });
    rowsOf("ldev").forEach(function (r) { var d = dv(r.no); var u = su(d, r.sub); u.lsec = r.sector; });
    Object.keys(by).sort(function (a, b) { return +a - +b; }).forEach(function (no) {
      var d = by[no], ks = Object.keys(d.subs).sort(function (a, b) { return +a - +b; });
      if (!ks.length) ks = ["1"];
      ks.forEach(function (s) {
        var u = d.subs[s] || { sub: s };
        // Sector ID configurado (LST RETDEVICEDATA); senão o que a antena devolve (de fábrica costuma ser "R1", "Y2"…)
        out.push({ no: no, sub: s, name: d.name, serial: d.serial, port: d.port, dfail: d.fail, online: u.online || "", tilt: u.tilt || "", min: u.min || "", max: u.max || "",
          model: u.model || "", ant: u.ant || "", bands: u.bands || [], sec: u.lsec || u.dsec || u.asec || "", fail: u.fail || "", first: s === ks[0] });
      });
    });
    return out;
  }
  function ready(r) { return !r.dfail && r.online === "AVAILABLE" && !r.fail && isInt(r.tilt); }

  // ---------------------------------------------------------------- executor (mae_exec.js): RET prontos?
  // exp = [{no, serial}] (vazio = todos da resposta); tilts = [{no, sub, tilt}] pedidos num MOD RETSUBUNIT
  function check(cmd, resp, exp, tilts) {
    exp = exp || []; tilts = tilts || [];
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
        var bad = rs.filter(function (r) { return r.online !== "AVAILABLE" || r.fail || !isInt(r.tilt); })[0];
        if (bad) { wait.push(e.no + " (" + (bad.fail || bad.online || "tilt não lido") + ")"); return; }
        tilts.filter(function (t) { return String(t.no) === String(e.no); }).forEach(function (t) {
          var r = rs.filter(function (x) { return String(x.sub) === String(t.sub || 1); })[0];
          if (r && +r.tilt !== +t.tilt) wait.push(e.no + " (tilt " + deg(r.tilt) + " → " + deg(t.tilt) + ")");
        });
      } else {
        var r = rs[0];
        if (!r.serial || r.fail) wait.push(e.no + " (" + (r.fail || "sem serial") + ")");
        else if (e.serial && r.serial.toUpperCase() !== String(e.serial).toUpperCase()) warn.push(e.no + ": serial lido " + r.serial + " ≠ " + e.serial);
      }
    });
    var ok = want.length - wait.length, what = sub ? "subunidades disponíveis" + (tilts.length ? " no tilt pedido" : " com tilt lido") : "RET conectados";
    return { done: !wait.length, warn: warn.join(" · "),
      msg: ok + "/" + want.length + " " + what + (wait.length ? " · aguardando " + wait.slice(0, 6).join(", ") + (wait.length > 6 ? "…" : "") : "") + (warn.length ? " · ⚠ " + warn.join(" · ") : "") };
  }

  // ---------------------------------------------------------------- novos RET (da varredura)
  function splitSerial(s) {     // "06CB26410005XA-R1" → antena "CB26410005XA", porta "R1"
    s = String(s || "").trim();
    var m = /^\d{2}([A-Z0-9]{6,})-([A-Z0-9]{1,4})$/i.exec(s) || /^(.+)-([A-Z0-9]{1,4})$/i.exec(s);
    return m ? { ant: m[1].toUpperCase(), port: m[2].toUpperCase() } : { ant: s.toUpperCase(), port: "" };
  }
  function isRet(r) { return r.res === "SUCCESS" && /RET/.test(r.type) && r.serial; }
  function raw(t, tk) { return String(t || "").replace(/\{(\w+)\}/g, function (_, k) { return tk[k.toUpperCase()] != null ? tk[k.toUpperCase()] : ""; }); }
  function tpl(t, tk, sep) {
    var s = raw(t, tk), q = sep === "-" ? "\\-" : "_";
    return s.replace(new RegExp(q + "{2,}", "g"), sep).replace(new RegExp("^" + q + "+|" + q + "+$", "g"), "").trim();
  }
  function knownSerials() {
    var k = {};
    rowsOf("lst").concat(rowsOf("ret")).forEach(function (r) { if (r.serial) k[r.serial.toUpperCase()] = r.no; });
    return k;
  }
  function model() {
    if (!S || !S.scan) return null;
    var known = knownSerials(), used = {};
    devRows().forEach(function (r) { used[r.no] = 1; });
    var all = S.scan.filter(isRet), ants = [], pord = [];
    all.forEach(function (r) { var sp = splitSerial(r.serial); if (ants.indexOf(sp.ant) < 0) ants.push(sp.ant); if (pord.indexOf(sp.port) < 0) pord.push(sp.port); });
    var secOf = function (a) { return parseInt(S.sec[a], 10) || ants.indexOf(a) + 1; };
    var rets = all.filter(function (r) { return !known[r.serial.toUpperCase()] && r.cfg !== "CONFIGURED"; });
    var skipped = all.length - rets.length;
    rets = rets.map(function (r, i) { return { r: r, i: i, sp: splitSerial(r.serial) }; }).sort(function (a, b) {
      return (secOf(a.sp.ant) - secOf(b.sp.ant)) || (ants.indexOf(a.sp.ant) - ants.indexOf(b.sp.ant)) || (pord.indexOf(a.sp.port) - pord.indexOf(b.sp.port)) || (a.i - b.i);
    }).map(function (x) { return x.r; });
    var maxNo = Object.keys(used).reduce(function (m, n) { return Math.max(m, +n || 0); }, 0);
    var next = parseInt(S.start, 10) || maxNo + 1, rows = [];
    rets.forEach(function (r) {
      var sp = splitSerial(r.serial), o = S.ov[r.serial] || {}, secN = secOf(sp.ant), band = S.band[sp.port] || "";
      var row = { r: r, serial: r.serial, ant: sp.ant, port: sp.port, secN: secN, band: band, nsub: r.nsub || 1 };
      row.on = o.on != null ? !!o.on : true;
      if (o.no) row.no = String(o.no); else { while (used[next]) next++; row.no = String(next); used[next] = 1; next++; }
      var tk = { BANDA: band, SEC: String(secN), SEC2: pad2(secN), PORTA: sp.port, OP: G.oper || "", SITE: S.site };
      row.autoName = raw(G.nameTpl, tk);
      row.name = o.name != null ? o.name : row.autoName;
      row.autoSec = [];
      for (var u = 1; u <= row.nsub; u++) row.autoSec.push(band && row.nsub === 1 ? tpl(G.secTpl, tk, "-") : "");
      row.sec = row.autoSec.map(function (a, i) { return o.sec && o.sec[i] != null ? o.sec[i] : a; });
      row.scen = o.scen || G.scen;
      rows.push(row);
    });
    return { rows: rows, ants: ants, ports: pord.filter(Boolean), skipped: skipped };
  }

  // ---------------------------------------------------------------- ajustes nos já cadastrados
  function edits() {
    var D = devRows(), names = [], secs = [], tilts = [];
    D.forEach(function (r) {
      var k = r.no + "|" + r.sub;
      if (r.first && S.edN[r.no] != null && S.edN[r.no] !== r.name) names.push({ no: r.no, name: S.edN[r.no], r: r });
      if (S.edS[k] != null && S.edS[k] !== r.sec) secs.push({ no: r.no, sub: r.sub, sec: S.edS[k], r: r });
      if (S.edT[k] != null && String(S.edT[k]) !== String(r.tilt)) tilts.push({ no: r.no, sub: r.sub, tilt: S.edT[k], r: r });
    });
    return { names: names, secs: secs, tilts: tilts, D: D };
  }

  function problems(M, E) {
    var out = [], nos = {}, names = {};
    E.D.forEach(function (r) {
      if (!r.first) return;
      nos[r.no] = "já existe (" + (r.name || r.serial) + ")";
      var n = String(S.edN[r.no] != null ? S.edN[r.no] : r.name).trim().toUpperCase(); if (n) names[n] = r.no;
    });
    function nameOk(n, who, self) {
      if (!n.trim()) out.push(who + ": nome vazio");
      if (n.length > MAXLEN) out.push(who + ": nome com mais de " + MAXLEN + " caracteres");
      if (badChars(n)) out.push(who + ": nome com aspas, apóstrofo, \\ ou ponto e vírgula");
      var k = n.trim().toUpperCase(); if (k && names[k] && names[k] !== self) out.push("Nome repetido: " + n.trim()); if (k) names[k] = self;
    }
    function secOk(s, who) {
      if (s.length > MAXLEN) out.push(who + ": Sector ID com mais de " + MAXLEN + " caracteres");
      if (badChars(s)) out.push(who + ": Sector ID com aspas, apóstrofo, \\ ou ponto e vírgula");
    }
    (M ? M.rows : []).forEach(function (r) {
      if (!r.on) return;
      if (!/^\d+$/.test(r.no)) out.push(r.serial + ": nº do RET inválido");
      else if (nos[r.no]) out.push("Nº " + r.no + " repetido: " + nos[r.no] + " e " + r.serial);
      else nos[r.no] = r.serial;
      nameOk(r.name, r.serial, "n" + r.serial);
      r.sec.forEach(function (s) { secOk(s, r.serial); });
    });
    E.names.forEach(function (x) { nameOk(x.name, "RET " + x.no, x.no); });
    E.secs.forEach(function (x) { secOk(x.sec, "RET " + x.no); });
    E.tilts.forEach(function (x) {
      if (!isInt(x.tilt)) { out.push("RET " + x.no + ": tilt inválido"); return; }
      if (isInt(x.r.min) && +x.tilt < +x.r.min) out.push("RET " + x.no + ": tilt " + deg(x.tilt) + " abaixo do mínimo " + deg(x.r.min));
      if (isInt(x.r.max) && +x.tilt > +x.r.max) out.push("RET " + x.no + ": tilt " + deg(x.tilt) + " acima do máximo " + deg(x.r.max));
    });
    var b = S.bsid || S.site;
    if (b.length > MAXLEN || badChars(b)) out.push("BSID inválido (máx. " + MAXLEN + " caracteres, sem aspas)");
    return out;
  }

  // ---------------------------------------------------------------- scripts
  function retScript(M, E) {
    var add = M ? M.rows.filter(function (r) { return r.on; }) : [], newSec = [];
    add.forEach(function (r) { r.sec.forEach(function (s, i) { if (s) newSec.push({ no: r.no, sub: i + 1, sec: s }); }); });
    var secs = newSec.concat(E.secs);
    if (!add.length && !E.names.length && !secs.length && !E.tilts.length) return "";
    var bsid = S.bsid || S.site, L = [], n = 0;
    L.push("// RET — " + S.site + " · " + [add.length + " ADD RET", E.names.length + " nome", secs.length + " Sector ID", E.tilts.length + " tilt"].join(" · ") + " · gerado em " + now());
    if (add.length) {
      L.push("// " + (++n) + ") Cadastrar os RET novos da varredura (SCN ALD de " + (S.scanTs || "—") + ")");
      add.forEach(function (r) {
        L.push('ADD RET:DEVICENO=' + r.no + ',DEVICENAME="' + r.name + '",CTRLCN=' + r.r.cn + ',CTRLSRN=' + r.r.srn + ',CTRLSN=' + r.r.sn +
          ',RETTYPE=' + (r.r.type || "SINGLE_RET") + ',SCENARIO=' + r.scen + ',VENDORCODE="' + r.r.vendor + '",SERIALNO="' + r.serial + '";');
      });
      L.push("// " + (++n) + ") Esperar os RET conectarem e lerem o tilt (no ▶ Executar o DSP repete sozinho a cada 8 s até todos ficarem prontos)");
      L.push("DSP RET:;");
      L.push("DSP RETSUBUNIT:;");
    }
    if (E.names.length) {
      L.push("// " + (++n) + ") Nome (DEVICENAME)");
      E.names.forEach(function (x) { L.push('MOD RET:DEVICENO=' + x.no + ',DEVICENAME="' + x.name + '";'); });
    }
    if (secs.length) {
      L.push("// " + (++n) + ") Sector ID (BSID = " + bsid + ")");
      secs.forEach(function (x) { L.push('MOD RETDEVICEDATA:DEVICENO=' + x.no + ',SUBUNITNO=' + x.sub + ',BSID="' + bsid + '",SECTORID="' + x.sec + '";'); });
    }
    if (E.tilts.length) {
      L.push("// " + (++n) + ") Tilt (em 0,1°) — o DSP RETSUBUNIT da conferência espera a antena chegar no valor pedido");
      E.tilts.forEach(function (x) { L.push('MOD RETSUBUNIT:DEVICENO=' + x.no + ',SUBUNITNO=' + x.sub + ',TILT=' + x.tilt + ';'); });
    }
    L.push("// " + (++n) + ") Conferência");
    L.push("DSP RET:;");
    L.push("DSP RETSUBUNIT:;");
    L.push("DSP RETDEVICEDATA:;");
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
    (S.cur.ports && S.cur.ports.list || []).forEach(function (q) { add(q.cn, q.srn, q.sn); });
    (S.scan || []).forEach(function (r) { var p = add(r.cn, r.srn, r.sn); if (isRet(r)) p.rets++; else if (r.res === "FAILURE") p.fail = r.cause || "falha"; });
    return out.sort(function (a, b) { return (+a.cn - +b.cn) || (+a.srn - +b.srn) || (+a.sn - +b.sn); });
  }
  function portInfo() { var m = {}; (S.cur.ports && S.cur.ports.list || []).forEach(function (p) { m[p.k] = p; }); return m; }
  function portSelected(p, inf) { if (S.portSel[p.k] != null) return S.portSel[p.k] !== false; return powerOn((inf || portInfo())[p.k]) !== true; }
  function portScript(P) {
    var inf = portInfo(), sel = P.filter(function (p) { return portSelected(p, inf); });
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
    "#retSec .sp{flex:1}",
    "#retSec h4{margin:12px 0 4px;font-size:13.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    "#retSec h4 .l{font:600 11.5px var(--mono);color:var(--accent);border:1px solid var(--border);border-radius:5px;padding:0 6px}",
    "#retSec .ret-part{border-top:1px dashed var(--border);margin-top:14px;padding-top:2px}#retSec .ret-part.first{border-top:0;margin-top:0}",
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
    "#retSec td.m{font-family:var(--mono)}#retSec td.r{text-align:right}",
    "#retSec tr.off td{opacity:.5}#retSec tr.bad td{background:#fdecec}",
    "#retSec td input[type=text]{width:100%;min-width:130px}#retSec input.ov{background:#fff8e1!important;border-color:#e8c46a!important}",
    "#retSec .chip{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11.5px;font-weight:600;background:#eceef2;color:var(--text-muted)}",
    "#retSec .chip.ok{background:var(--success-bg);color:var(--success)}#retSec .chip.er{background:#fdecec;color:#c7000b}#retSec .chip.wt{background:var(--warning-bg);color:var(--warning)}",
    "#retSec .ret-msg{margin-top:8px;border-radius:6px;padding:8px 10px;font-size:12.5px}",
    "#retSec .ret-msg.warn{background:var(--warning-bg);color:var(--warning)}#retSec .ret-msg.er{background:#fdecec;color:#7a0007}#retSec .ret-msg.ok{background:var(--success-bg);color:var(--success)}",
    "#retSec pre.ret-pre{margin:8px 0 0;background:var(--mono-bg);border:1px solid var(--mono-border);color:var(--mono-text);font:12.5px/1.4 var(--mono);border-radius:6px;padding:10px 12px;max-height:300px;overflow:auto;white-space:pre}",
    "#retSec pre.ret-pre:empty{display:none}",
    "#retSec details.ret-paste summary{cursor:pointer;color:var(--text-muted);font-size:12.5px;margin-top:8px}",
    "#retSec details.ret-det summary{cursor:pointer;color:var(--text-muted);font-size:12px}#retSec details.ret-det pre{margin:4px 0 0;font:11.5px/1.35 var(--mono);white-space:pre-wrap;color:var(--text-muted)}",
    "#retSec details.ret-paste textarea{min-height:110px;margin-top:6px}",
    "#retSec .ret-cfg{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px 14px;margin-top:6px}",
    "#retSec .ret-cfg label{display:flex;flex-direction:column;gap:3px;color:var(--text-muted);font-size:12px}",
    "#retSec .ret-grp{display:flex;gap:6px 14px;flex-wrap:wrap;margin-top:6px;align-items:center}",
    "#retSec .ret-grp span.l{color:var(--text-muted);font-size:12px;min-width:120px}",
    "#retSec .ret-grp label{display:flex;gap:5px;align-items:center;font:12.5px var(--mono)}",
    "#retSec .ret-grp input[type=text]{width:90px}#retSec .ret-grp input[type=number]{width:58px}",
    "#retSec input.tilt{width:72px}#retSec .lim{color:var(--text-muted);font-size:11.5px}"
  ].join("\n");
  document.head.appendChild(st);

  var sec = document.createElement("section");
  sec.className = "phys"; sec.id = "retSec";
  sec.innerHTML =
    '<h2>RET — antenas AISG <span class="ret-site" id="retSite">—</span></h2>' +
    '<p class="instr"><b>1</b> mostra como está o site (portas RET e RET cadastrados: online, tilt, Sector ID) — vem da Rodada 1 da Entrada ou do botão <b>↻ Ler</b>. ' +
    '<b>2</b> configura na ordem de campo: habilitar a porta RET da RRU → varrer (<span class="mono">SCN ALD</span>) → cadastrar os novos → ajustar nome, Sector ID e tilt. ' +
    'Os scripts rodam pelo <b>▶ Executar no site</b> (conexão do painel <i>Executar no MAE</i> da aba Entrada).</p>' +

    '<div class="ret-step" id="retStep1"><h3><span class="n">1</span>Situação atual <span id="retTs" class="muted" style="font-weight:400;font-size:12.5px"></span><span class="sp"></span>' +
      '<button class="ghost" type="button" id="retRead" title="' + esc(READ.join(" ")) + '">↻ Ler RET e portas agora</button></h3>' +
      '<div id="retReadMsg"></div>' +
      '<h4>Portas RET</h4><div id="retPortView"></div>' +
      '<h4>RET cadastrados</h4><div id="retDevView"></div></div>' +

    '<div class="ret-step" id="retStep2"><h3><span class="n">2</span>Configurar</h3>' +
      '<div class="ret-part first"><h4><span class="l">a</span>Habilitar a porta RET da RRU (alimentação e limiares)</h4>' +
        '<div class="ret-row"><label><input type="checkbox" id="retThr"> Limiares de corrente personalizados (<span class="mono">THRESHOLDTYPE=UER_SELF_DEFINE</span>)</label>' +
          '<label>UOTHD <input type="number" id="retUo"></label><label>UCTHD <input type="number" id="retUc"></label><label>OOTHD <input type="number" id="retOo"></label><label>OCTHD <input type="number" id="retOc"></label></div>' +
        '<div class="ret-row"><label><input type="checkbox" id="retAuto"> Ao terminar, esperar <input type="number" id="retWait" min="0" max="300" style="width:58px"> s (o RET liga) e varrer</label></div>' +
        '<div id="retPorts"></div>' +
        '<pre class="ret-pre" id="retPortCmds"></pre>' +
        '<div class="ret-row"><button class="ghost" type="button" id="retPortCopy">Copiar script</button></div><div id="retPortMsg"></div></div>' +

      '<div class="ret-part"><h4><span class="l">b</span>Varredura dos RET <span class="sp"></span><span id="retScanTs" class="muted" style="font-weight:400;font-size:12.5px"></span></h4>' +
        '<div class="ret-row"><button class="primary" type="button" id="retScan">▶ Varrer RET no site (SCN ALD)</button><button class="ghost" type="button" id="retScanStop" hidden>Parar de aguardar</button>' +
          '<div class="ret-bar" id="retBar" hidden><i></i><b>0%</b></div></div>' +
        '<div id="retScanMsg"></div>' +
        '<details class="ret-paste"><summary>Sem helper? Cole aqui a resposta do SCN ALD (e, se tiver, a do LST RET)</summary>' +
          '<textarea id="retPaste" spellcheck="false" placeholder="+++    SITE    data&#10;O&amp;M    #...&#10;%%SCN ALD:;%%&#10;..."></textarea>' +
          '<div class="ret-row"><button class="ghost" type="button" id="retPasteGo">Ler resposta colada</button></div></details>' +
        '<div id="retScanTbl"></div></div>' +

      '<div class="ret-part"><h4><span class="l">c</span>Cadastrar os RET novos</h4><div id="retCad"></div></div>' +

      '<div class="ret-part"><h4><span class="l">d</span>Ajustar os RET cadastrados — nome, Sector ID e tilt <span class="sp"></span><button class="ghost" type="button" id="retEdReset">↺ Desfazer ajustes</button></h4><div id="retEd"></div></div>' +

      '<div class="ret-part"><h4>Script</h4>' +
        '<pre class="ret-pre" id="retCmds"></pre>' +
        '<div class="ret-row"><button class="ghost" type="button" id="retCopy">Copiar script</button></div>' +
        '<div id="retWarn"></div></div></div>';
  pane.appendChild(sec);

  // ---------------------------------------------------------------- render
  function msg(id, cls, html) { $(id).innerHTML = html ? '<div class="ret-msg ' + cls + '">' + html + '</div>' : ""; }
  function chipPw(pw, txtOn) { return pw === null ? "" : '<span class="chip ' + (pw ? "ok" : "er") + '">' + (pw ? (txtOn || "ON") : "OFF") + '</span>'; }
  function chipOnline(v) { return v ? '<span class="chip ' + (v === "AVAILABLE" ? "ok" : "er") + '">' + esc(v) + '</span>' : ""; }
  function render() {
    var site = loadedSite();
    if (!S || S.site !== site) load(site);
    $("retSite").textContent = site || "nenhum site carregado";
    $("retTs").textContent = lastTs() ? "· lido em " + lastTs() : "";
    $("retScanTs").textContent = S.scanTs ? "última varredura: " + S.scanTs : "";
    renderPortView(); renderDevView(); renderPorts(); renderScan(); renderCad(); renderEd(); renderScript();
  }
  function renderPortView() {
    var P = S.cur.ports;
    if (!P || !P.list.length) {
      $("retPortView").innerHTML = '<p class="muted" style="margin:2px 0 6px">' + (P ? "O site não devolveu porta RET." : "Sem leitura: rode a Rodada 1 na aba Entrada (já inclui LST/DSP RETPORT) ou clique em ↻ Ler RET e portas agora.") + '</p>';
      return;
    }
    var rr = rruMap(), rets = {};
    devRows().forEach(function (r) { if (r.first && r.port) rets[r.port] = (rets[r.port] || 0) + 1; });
    var on = P.list.filter(function (p) { return powerOn(p) === true; }).length;
    var th = function (p, w) { return pf(p, new RegExp("^Actual " + w, "i")) || pf(p, new RegExp("^" + w, "i")); };
    $("retPortView").innerHTML = '<div class="ret-msg ' + (on ? "ok" : "warn") + '" style="margin-top:2px">' + on + " de " + P.list.length + " porta(s) RET com alimentação ligada" +
      (on < P.list.length ? " · porta desligada não acha RET na varredura — habilite no passo 2a" : "") + '</div>' +
      '<div class="ret-tw" style="max-height:280px"><table><thead><tr><th>Porta (CN-SRN-SN)</th><th>RRU</th><th>Alimentação (config.)</th><th>Alimentação (real)</th><th>Corrente (mA)</th><th>Tipo de limiar</th><th>Subcorrente ocorre / cessa (mA)</th><th>Sobrecorrente ocorre / cessa (mA)</th><th>RET</th><th></th></tr></thead><tbody>' +
      P.list.map(function (p) {
        var u = rr[p.k] || {}, f = p.f;
        var cOn = onOff(pf(p, /^ALD Power Switch$/i) || pf(p, /^(?!.*Actual).*Power Switch/i)), aOn = onOff(pf(p, /Actual Power Switch/i));
        return '<tr class="' + (powerOn(p) === false ? "bad" : "") + '"><td class="m">' + esc(p.k) + '</td><td>' + esc(u.name || "") + '</td>' +
          '<td>' + chipPw(cOn) + '</td><td>' + chipPw(aOn, "ON · ativa") + '</td><td class="m r">' + esc(pf(p, /Current Value/i)) + '</td><td>' + esc(pf(p, /Threshold Type/i)) + '</td>' +
          '<td class="m">' + esc([th(p, "Undercurrent Alarm Occur"), th(p, "Undercurrent Alarm Clear")].filter(Boolean).join(" / ")) + '</td>' +
          '<td class="m">' + esc([th(p, "Overcurrent Alarm Occur"), th(p, "Overcurrent Alarm Clear")].filter(Boolean).join(" / ")) + '</td>' +
          '<td>' + (rets[p.k] ? '<span class="chip ok">' + rets[p.k] + '</span>' : "") + '</td>' +
          '<td><details class="ret-det"><summary>tudo</summary><pre>' + esc(Object.keys(f).map(function (k) { return k + " = " + (f[k] || "NULL"); }).join("\n")) + '</pre></details></td></tr>';
      }).join("") + '</tbody></table></div>';
  }
  function renderDevView() {
    var D = devRows();
    if (!D.length) {
      $("retDevView").innerHTML = '<p class="muted" style="margin:2px 0 6px">' + (S.cur.lst || S.cur.ret ? "Nenhum RET cadastrado no site." : "Sem leitura: rode a Rodada 1 na aba Entrada ou clique em ↻ Ler RET e portas agora.") + '</p>';
      return;
    }
    var nOk = D.filter(ready).length;
    $("retDevView").innerHTML = '<div class="ret-msg ' + (nOk === D.length ? "ok" : "warn") + '" style="margin-top:2px">' + nOk + "/" + D.length + " RET online com tilt lido" +
      (nOk < D.length ? " · RET recém-cadastrado leva alguns segundos (SYSTEM_BUSY / ALD_DISCONNECTED): clique em ↻ Ler de novo." : "") + '</div>' +
      '<div class="ret-tw"><table><thead><tr><th>Nº</th><th>DEVICENAME</th><th>Subunid.</th><th>Porta</th><th>Serial</th><th>Online</th><th>Tilt</th><th>Faixa de tilt</th><th>Sector ID</th><th>Antena</th><th>Bandas da antena</th><th>Falha</th></tr></thead><tbody>' +
      D.map(function (r) {
        return '<tr class="' + (ready(r) ? "" : "bad") + '"><td class="m">' + esc(r.no) + '</td><td class="m">' + esc(r.name) + '</td><td>' + esc(r.sub) + '</td><td class="m">' + esc(r.port) + '</td><td class="m">' + esc(r.serial) + '</td>' +
          '<td>' + chipOnline(r.online) + '</td><td class="m r"><b>' + esc(deg(r.tilt)) + '</b></td><td class="m">' + (isInt(r.min) && isInt(r.max) ? esc(deg(r.min) + " a " + deg(r.max)) : "") + '</td>' +
          '<td class="m">' + esc(r.sec) + '</td><td class="m">' + esc([r.model, r.ant].filter(Boolean).join(" · ")) + '</td><td>' + esc(r.bands.join(" · ")) + '</td><td>' + esc([r.dfail, r.fail].filter(Boolean).join(" · ")) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }
  function renderPorts() {
    $("retThr").checked = !!G.thr; $("retAuto").checked = !!G.autoscan;
    $("retUo").value = G.uo; $("retUc").value = G.uc; $("retOo").value = G.oo; $("retOc").value = G.oc; $("retWait").value = G.wait;
    ["retUo", "retUc", "retOo", "retOc"].forEach(function (i) { $(i).disabled = !G.thr; });
    var P = portList(), inf = portInfo();
    if (!P.length) { $("retPorts").innerHTML = '<p class="muted">Carregue o site na aba Entrada (LST RRU / LST RETPORT) para listar as portas.</p>'; $("retPortCmds").textContent = ""; return; }
    $("retPorts").innerHTML = '<p class="muted" style="font-size:12px;margin:6px 0 0">Vêm marcadas as portas com a alimentação desligada.</p><div class="ret-tw" style="max-height:260px"><table><thead><tr><th></th><th>Porta (CN-SRN-SN)</th><th>RRU</th><th>Tipo</th><th>Alimentação</th><th>Última varredura</th></tr></thead><tbody>' +
      P.map(function (p) {
        var on = portSelected(p, inf);
        return '<tr class="' + (on ? "" : "off") + '"><td><input type="checkbox" data-port="' + esc(p.k) + '"' + (on ? " checked" : "") + '></td><td class="m">' + esc(p.k) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.type) + '</td>' +
          '<td>' + chipPw(powerOn(inf[p.k])) + '</td>' +
          '<td>' + (!S.scan ? "" : p.fail ? '<span class="chip er">' + esc(p.fail) + '</span>' : p.rets ? '<span class="chip ok">' + p.rets + ' RET</span>' : '<span class="chip wt">nenhum RET</span>') + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    $("retPortCmds").textContent = portScript(P);
  }
  function renderScan() {
    if (!S.scan) { $("retScanTbl").innerHTML = ""; return; }
    var rows = S.scan, nRet = rows.filter(isRet).length, fails = rows.filter(function (r) { return r.res !== "SUCCESS"; });
    var other = rows.filter(function (r) { return r.res === "SUCCESS" && !isRet(r); }), rr = rruMap(), known = knownSerials();
    var note = nRet + " RET encontrado(s)" + (other.length ? " · " + other.length + " outro(s) ALD (não são RET, ficam de fora)" : "");
    if (fails.length) note += '<br>⚠ ' + fails.map(function (r) { return "<b>" + esc(portKey(r.cn, r.srn, r.sn)) + "</b>: " + esc(r.cause || "falha"); }).join(" · ") +
      ' — confira a RRU / o cabo AISG; se a RRU estiver normal, habilite a porta RET (2a).';
    else if (!nRet) note += '<br>⚠ Nenhum RET respondeu. Habilite a porta RET (2a) — ele varre de novo no fim.';
    $("retScanTbl").innerHTML = '<div class="ret-msg ' + (fails.length || !nRet ? "warn" : "ok") + '">' + note + '</div>' +
      '<div class="ret-tw" style="max-height:300px"><table><thead><tr><th>Porta (CN-SRN-SN)</th><th>RRU</th><th>Resultado</th><th>Tipo</th><th>Fabricante</th><th>Serial</th><th>Protocolo</th><th>Situação</th><th>Subunid.</th><th>Causa da falha</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var u = rr[portKey(r.cn, r.srn, r.sn)] || {}, k = r.serial && known[r.serial.toUpperCase()], cf = k || r.cfg === "CONFIGURED";
        return '<tr class="' + (r.res !== "SUCCESS" ? "bad" : "") + '"><td class="m">' + esc(portKey(r.cn, r.srn, r.sn)) + (r.port ? " · " + esc(r.port) : "") + '</td><td>' + esc(u.name || "") + '</td>' +
          '<td><span class="chip ' + (r.res === "SUCCESS" ? "ok" : "er") + '">' + esc(r.res || "?") + '</span></td><td>' + esc(r.type) + '</td><td>' + esc(r.vendor) + '</td><td class="m">' + esc(r.serial) + '</td><td>' + esc(r.proto) + '</td>' +
          '<td>' + (isRet(r) ? '<span class="chip ' + (cf ? "ok" : "wt") + '">' + (cf ? "já cadastrado" + (k ? " · nº " + esc(k) : "") : "a cadastrar") + '</span>' : "") + '</td><td>' + esc(r.res === "SUCCESS" ? r.nsub : "") + '</td><td>' + esc(r.cause) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }
  function renderCad() {
    var M = model();
    if (!M || !M.rows.length) {
      $("retCad").innerHTML = '<p class="muted" style="margin:2px 0">' + (!S.scan ? "Faça a varredura (2b) para listar os RET novos." : "Nenhum RET novo na varredura" + (M && M.skipped ? " (" + M.skipped + " já cadastrado(s): ajuste no 2d)." : ".")) + '</p>';
      return;
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
      '</div><p class="muted" style="font-size:12px;margin:4px 0 0">Campos: <span class="mono">{BANDA} {SEC} {SEC2} {PORTA} {OP} {SITE}</span>. No nome o campo vazio fica vazio e o espaço no fim é mantido (sem banda: <span class="mono">"_SEC01_R1 "</span>). Sector ID só sai quando a porta tem banda (ou digitado na linha).' +
      (M.skipped ? " " + M.skipped + " RET da varredura já está(ão) cadastrado(s): ajuste no 2d." : "") + '</p>';
    h += '<div class="ret-grp"><span class="l">Antena → setor</span>' + M.ants.map(function (a, i) {
      return '<label title="Antena ' + esc(a) + '">' + esc(a) + ' → SEC <input type="number" min="1" max="99" data-sec="' + esc(a) + '" value="' + esc(S.sec[a] || i + 1) + '"></label>';
    }).join("") + '</div>';
    h += '<div class="ret-grp"><span class="l">Porta da antena → banda</span>' + M.ports.map(function (p) {
      return '<label>' + esc(p) + ' <input type="text" list="retBands" data-band="' + esc(p) + '" value="' + esc(S.band[p] || "") + '" placeholder="sem banda"></label>';
    }).join("") + (bands.length ? '<span class="muted" style="font-size:12px">bandas do site: ' + esc(bands.join(", ")) + '</span>' : '') + '</div>';
    h += '<div class="ret-tw"><table><thead><tr><th><input type="checkbox" id="retAll" title="Marcar/desmarcar todos"></th><th>Nº</th><th>Porta</th><th>Serial</th><th>Antena</th><th>SEC</th><th>Porta ant.</th><th>Tipo</th><th>DEVICENAME</th><th>Sector ID</th></tr></thead><tbody>' +
      M.rows.map(function (r, i) {
        var nm = '<input type="text" data-name="' + i + '" value="' + esc(r.name) + '" class="' + (r.name !== r.autoName ? "ov" : "") + '" title="' + esc(r.name !== r.autoName ? "editado (automático: " + r.autoName + ")" : "automático") + '">';
        var sc = r.sec.map(function (s, u) { return '<input type="text" data-secid="' + i + ":" + u + '" value="' + esc(s) + '" class="' + (s !== r.autoSec[u] ? "ov" : "") + '" placeholder="' + (r.nsub > 1 ? "subunidade " + (u + 1) : "sem Sector ID") + '">'; }).join("");
        return '<tr class="' + (r.on ? "" : "off") + '"><td><input type="checkbox" data-on="' + i + '"' + (r.on ? " checked" : "") + '></td>' +
          '<td><input type="number" min="0" data-no="' + i + '" value="' + esc(r.no) + '" style="width:58px"></td>' +
          '<td class="m">' + esc(portKey(r.r.cn, r.r.srn, r.r.sn)) + '</td><td class="m">' + esc(r.serial) + '</td><td class="m">' + esc(r.ant) + '</td><td>' + r.secN + '</td><td class="m">' + esc(r.port) + '</td>' +
          '<td>' + esc(r.r.type) + (r.nsub > 1 ? " ×" + r.nsub : "") + '</td><td>' + nm + '</td><td>' + sc + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<div class="ret-row"><button class="ghost" type="button" id="retResetOv">↺ Nomes e Sector ID automáticos</button><span class="muted" style="font-size:12px">Amarelo = editado à mão.</span></div>';
    $("retCad").innerHTML = h;
    $("retScen").value = G.scen;
    var on = M.rows.filter(function (r) { return r.on; }).length;
    $("retAll").checked = on === M.rows.length; $("retAll").indeterminate = on > 0 && on < M.rows.length;
  }
  function renderEd() {
    var D = devRows();
    if (!D.length) { $("retEd").innerHTML = '<p class="muted" style="margin:2px 0">Sem RET cadastrado lido (bloco 1).</p>'; return; }
    $("retEd").innerHTML = '<p class="muted" style="font-size:12px;margin:2px 0 0">Mude o que precisar: cada alteração entra no script (amarelo). Tilt em graus, passo de 0,1°, dentro da faixa do DSP RETDEVICEDATA.</p>' +
      '<div class="ret-tw"><table><thead><tr><th>Nº</th><th>Subunid.</th><th>Porta</th><th>Bandas da antena</th><th>Online</th><th>DEVICENAME</th><th>Sector ID</th><th>Tilt atual</th><th>Tilt novo (°)</th><th>Faixa</th></tr></thead><tbody>' +
      D.map(function (r) {
        var k = r.no + "|" + r.sub, n = S.edN[r.no] != null ? S.edN[r.no] : r.name, s = S.edS[k] != null ? S.edS[k] : r.sec, t = S.edT[k];
        var lim = isInt(r.min) && isInt(r.max);
        return '<tr class="' + (ready(r) ? "" : "bad") + '"><td class="m">' + esc(r.no) + '</td><td>' + esc(r.sub) + '</td><td class="m">' + esc(r.port) + '</td><td>' + esc(r.bands.join(" · ")) + '</td>' +
          '<td>' + chipOnline(r.online) + '</td>' +
          '<td>' + (r.first ? '<input type="text" data-en="' + esc(r.no) + '" value="' + esc(n) + '" class="' + (n !== r.name ? "ov" : "") + '" title="atual: ' + esc(r.name) + '">' : "") + '</td>' +
          '<td><input type="text" data-es="' + esc(k) + '" value="' + esc(s) + '" class="' + (s !== r.sec ? "ov" : "") + '" title="atual: ' + esc(r.sec || "vazio") + '"></td>' +
          '<td class="m r"><b>' + esc(deg(r.tilt)) + '</b></td>' +
          '<td><input type="number" class="tilt' + (t != null ? " ov" : "") + '" data-et="' + esc(k) + '" step="0.1"' + (lim ? ' min="' + (r.min / 10) + '" max="' + (r.max / 10) + '"' : "") + ' value="' + esc(t != null ? (t / 10).toFixed(1) : "") + '" placeholder="' + esc(isInt(r.tilt) ? (r.tilt / 10).toFixed(1) : "") + '"></td>' +
          '<td class="lim">' + (lim ? esc(deg(r.min) + " a " + deg(r.max)) : "") + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }
  function renderScript() {
    var M = model(), E = edits(), pr = problems(M, E), txt = pr.length ? "// corrija antes de executar:\n// · " + pr.join("\n// · ") : retScript(M, E);
    $("retCmds").textContent = txt;
    if (pr.length) msg("retWarn", "er", "✖ " + pr.map(esc).join("<br>✖ "));
    else $("retWarn").innerHTML = txt ? "" : '<p class="muted" style="margin:6px 0 0">Nada para aplicar: cadastre RET novos (2c) ou altere nome, Sector ID ou tilt (2d).</p>';
    var b = $("mx-retCmds"); if (b) b.disabled = !!pr.length || !txt;
  }

  // ---------------------------------------------------------------- eventos da tela
  function ovOf(serial) { return S.ov[serial] || (S.ov[serial] = {}); }
  function devOf(k) { return devRows().filter(function (x) { return x.no + "|" + x.sub === k; })[0] || {}; }
  sec.addEventListener("change", function (e) {
    var t = e.target, M = model(), r, a, ed = false;
    if (!S) return;
    if ((a = t.getAttribute("data-on")) != null) { r = M.rows[+a]; ovOf(r.serial).on = t.checked; }
    else if (t.id === "retAll") M.rows.forEach(function (r) { ovOf(r.serial).on = t.checked; });
    else if ((a = t.getAttribute("data-no")) != null) { r = M.rows[+a]; if (t.value) ovOf(r.serial).no = t.value; else delete ovOf(r.serial).no; }
    else if ((a = t.getAttribute("data-name")) != null) { r = M.rows[+a]; if (t.value === r.autoName) delete ovOf(r.serial).name; else ovOf(r.serial).name = t.value; }
    else if ((a = t.getAttribute("data-secid")) != null) {
      var p = a.split(":"); r = M.rows[+p[0]]; var o = ovOf(r.serial); o.sec = o.sec || [];
      o.sec[+p[1]] = t.value.trim() === r.autoSec[+p[1]] ? null : t.value.trim();
    }
    else if ((a = t.getAttribute("data-sec")) != null) S.sec[a] = t.value;
    else if ((a = t.getAttribute("data-band")) != null) S.band[a] = t.value.trim().toUpperCase();
    else if ((a = t.getAttribute("data-en")) != null) { ed = true; if (t.value === (devRows().filter(function (x) { return x.no === a; })[0] || {}).name) delete S.edN[a]; else S.edN[a] = t.value; }
    else if ((a = t.getAttribute("data-es")) != null) { ed = true; if (t.value.trim() === devOf(a).sec) delete S.edS[a]; else S.edS[a] = t.value.trim(); }
    else if ((a = t.getAttribute("data-et")) != null) {
      ed = true;
      var v = String(t.value).replace(",", ".").trim(), n10 = Math.round(+v * 10);
      if (v === "" || isNaN(+v) || String(n10) === String(devOf(a).tilt)) delete S.edT[a]; else S.edT[a] = n10;
    }
    else if ((a = t.getAttribute("data-port")) != null) { S.portSel[a] = t.checked; save(); renderPorts(); return; }
    else if (t.id === "retNameTpl") G.nameTpl = t.value.trim() ? t.value : DEF.nameTpl;
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
    save();
    if (ed) renderEd(); else renderCad();
    renderScript();
  });
  sec.addEventListener("click", function (e) {
    if (e.target.id === "retResetOv") { Object.keys(S.ov).forEach(function (k) { delete S.ov[k].name; delete S.ov[k].sec; }); save(); renderCad(); renderScript(); }
    if (e.target.id === "retEdReset") { S.edN = {}; S.edS = {}; S.edT = {}; save(); renderEd(); renderScript(); }
  });
  $("retCopy").onclick = function () { copyText($("retCmds").textContent, this); };
  $("retPortCopy").onclick = function () { copyText($("retPortCmds").textContent, this); };
  $("retPasteGo").onclick = function () {
    render();
    if (!S.site) { msg("retScanMsg", "er", "Carregue o site na aba Entrada antes."); return; }
    var t = $("retPaste").value, rows = parseScan(t);
    if (!rows.length) { msg("retScanMsg", "er", "Não achei a tabela de resultado do SCN ALD (procure o bloco <i>Status = Success</i> com a tabela <i>Result</i>)."); return; }
    apply(t, "colado");
    S.scan = rows; S.scanTs = now(); save(); render();
    msg("retScanMsg", "ok", "Resposta colada lida: " + rows.length + " linha(s).");
  };

  // ---------------------------------------------------------------- leitura (Rodada 1 / botão / fim de execução)
  function setText(t, ne) {
    var site = String(ne || loadedSite()).split("·")[0].trim(); if (!site) return;
    if (!S || S.site !== site) load(site);
    if (apply(t, "Rodada 1")) save();
    render();
  }
  function canRun(what) {
    var s = window.MAE && window.MAE.state();
    if (!s || !s.online || !s.logged) { alert("Para " + what + ", conecte primeiro no painel \"Executar no MAE\" da aba Entrada (usuário e senha do MAE)."); return false; }
    if (!S.site) { alert("Nenhum site carregado. Carregue o site na aba Entrada (Rodada 1)."); return false; }
    return true;
  }
  function asText(cmds, resps) { return cmds.map(function (c, i) { return "%%" + c + "%%\n" + String(resps[i] || "").replace(/%%[^%\r\n]*%%/g, ""); }).join("\n"); }
  async function readNow(btn) {
    render();
    if (!canRun("ler os RET")) return;
    if (window.MAE.state().busy) { alert("O MAE está ocupado com outra execução. Aguarde terminar."); return; }
    var old = btn.textContent; btn.disabled = true; btn.textContent = "Lendo…";
    window.MAE.setBusy(true, "a leitura de RET (Conexão física)");
    try {
      var r = await window.MAE.api("/run", { ne: S.site, cmds: READ });
      if (r[0] && /^REG NE/.test(r[0].cmd)) { if (!r[0].ok) throw new Error("REG NE falhou para " + S.site); r = r.slice(1); }
      apply(asText(READ, r.map(function (x) { return x.resp; })), "leitura avulsa");
      save(); render(); msg("retReadMsg");
    } catch (e) { msg("retReadMsg", "er", "✖ " + esc(e.message)); }
    finally { await window.MAE.api("/unreg", {}).catch(function () {}); window.MAE.setBusy(false); btn.disabled = false; btn.textContent = old; }
  }
  $("retRead").onclick = function () { readNow(this); };

  // ---------------------------------------------------------------- varredura pelo helper (tarefa)
  var scanJob = null;
  function bar(pct, txt) { var b = $("retBar"); b.hidden = false; b.querySelector("i").style.width = (pct || 0) + "%"; b.querySelector("b").textContent = txt; }
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
        steps: [{ cmd: "SCN ALD:;", label: "SCN ALD", long: true, need: "success", maxsec: 900, quiet: 20 }, { cmd: "LST RET:;", label: "LST RET" }, { cmd: "DSP RET:;", label: "DSP RET" }] });
      scanJob = v.id;
      for (;;) {
        await sleep(1500);
        v = await window.MAE.api("/job/status?id=" + encodeURIComponent(scanJob));
        var s0 = v.steps[0] || {}, secs = Math.round((Date.now() - t0) / 1000);
        if (v.state !== "running" && v.state !== "queued") break;
        if (v.cur >= 1) bar(100, "lendo LST RET / DSP RET…");
        else bar(s0.pct || 0, (s0.pct != null ? s0.pct + "%" : "aguardando o site começar a varredura…") + (s0.pct === 99 ? " · aguardando Status = Success" : "") + " · " + secs + " s");
      }
      v = await window.MAE.api("/job/status?full=1&id=" + encodeURIComponent(scanJob));
      var a = v.steps[0] || {}, b = v.steps[1] || {}, c = v.steps[2] || {}, rows = parseScan(a.resp || "");
      if (!rows.length) throw new Error(a.msg || v.note || "o SCN ALD não devolveu a tabela de resultado");
      if (b.ok || c.ok) apply(asText(["LST RET:;", "DSP RET:;"], [b.ok ? b.resp : "", c.ok ? c.resp : ""]), "varredura");
      S.scan = rows; S.scanTs = now(); save(); render();
      var n = rows.filter(isRet).length;
      bar(100, "concluído · " + n + " RET · " + Math.round((Date.now() - t0) / 1000) + " s");
      msg("retScanMsg", a.ok ? "ok" : "warn", (a.ok ? "✔ Varredura concluída (Status = Success)." : "⚠ " + esc(a.msg || "a varredura não terminou com Success") + " — mostrando o que o site devolveu.") +
        (b.ok ? "" : " · LST RET não lido (" + esc(b.msg || "pulado") + "): confira se algum já está cadastrado antes do ADD."));
      window.MAE.log("RET: SCN ALD em " + site + " → " + n + " RET", a.ok ? "ok" : "er");
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

  // ---------------------------------------------------------------- fim de um ▶ Executar (mae_exec.js)
  window.addEventListener("mae:done", function (ev) {
    var d = ev.detail || {};
    if (!S || !d.ne || String(d.ne).split("·")[0].trim().toUpperCase() !== String(S.site).toUpperCase()) return;
    var its = d.items || [], okIt = function (it) { return it.st === "ok" || it.st === "rt"; };
    var cmds = [], resps = [];
    READ.forEach(function (c) {
      var re = new RegExp("^" + c.replace(":;", "").replace(/\s+/, "\\s+") + "\\s*:", "i");
      var x = its.filter(function (it) { return re.test(it.cmd) && it.resp; }).pop();
      if (x) { cmds.push(c); resps.push(x.resp.split(/\n----- (?:consulta \d+|nova tentativa|2ª tentativa) -----\n/).pop()); }
    });
    if (d.id === "retCmds") {
      its.filter(okIt).forEach(function (it) {
        var no = (/DEVICENO\s*=\s*(\d+)/i.exec(it.cmd) || [])[1], su = (/SUBUNITNO\s*=\s*(\d+)/i.exec(it.cmd) || [])[1] || "1";
        if (/^MOD\s+RET\s*:/i.test(it.cmd)) delete S.edN[no];
        if (/^MOD\s+RETDEVICEDATA\s*:/i.test(it.cmd)) delete S.edS[no + "|" + su];
        if (/^MOD\s+RETSUBUNIT\s*:/i.test(it.cmd)) delete S.edT[no + "|" + su];
        var sn = /^ADD\s+RET\s*:.*SERIALNO\s*=\s*"([^"]*)"/i.exec(it.cmd);
        if (sn && S.scan) S.scan.forEach(function (r) { if (r.serial === sn[1]) r.cfg = "CONFIGURED"; });
      });
      if (cmds.length) apply(asText(cmds, resps), "após executar");
      save(); render();
    }
    if (d.id === "retPortCmds") {
      if (cmds.length) { apply(asText(cmds, resps), "após habilitar"); save(); render(); }
      if (d.ok && G.autoscan) {
        var n = G.wait;
        msg("retPortMsg", "ok", "✔ Porta(s) RET habilitada(s). Varredura em <b id=\"retCd\">" + n + "</b> s…");
        var h = setInterval(function () {
          n--; var el = $("retCd"); if (el) el.textContent = Math.max(0, n);
          if (n <= 0) { clearInterval(h); msg("retPortMsg"); $("retScan").scrollIntoView({ behavior: "smooth", block: "center" }); scan(); }
        }, 1000);
      } else msg("retPortMsg", d.ok ? "ok" : "warn", d.ok ? "✔ Porta(s) RET habilitada(s). Rode a varredura (2b)." : "⚠ A execução não terminou: confira antes de varrer.");
    }
  });

  var tab = $("tab-ph"); if (tab) tab.addEventListener("click", function () { setTimeout(render, 0); });
  if ($("neLbl") && window.MutationObserver) new MutationObserver(function () { setTimeout(render, 150); }).observe($("neLbl"), { childList: true, characterData: true, subtree: true });
  render();

  window.RETALD = { check: check, render: render, setText: setText, READ: READ.slice(),
    _t: { parseScan: parseScan, parseLstRet: parseLstRet, parseDspRet: parseDspRet, parseDspSub: parseDspSub, parseDevData: parseDevData, parsePort: parsePort,
      apply: apply, devRows: devRows, splitSerial: splitSerial, model: model, edits: edits, portList: portList, state: function () { return S; }, G: G } };
})();
