/* rs_4g.js — aba "RS_4G" do TELEBIT RAN (Ferramenta Huawei).
   Gera o script para migrar um site 4G Huawei (cedente TIM) para RAN Sharing TIM × VIVO,
   seguindo o roteiro "Rota_ran-sharing_4G", e as ampliações do mesmo roteiro.
   Fontes:
     1) Base MOU VIVO×TIM (.xlsb/.xlsx) — aba "Consolidação Lógicos Cedente" (dados futuros por célula)
        e aba "MNC" (MNC regional por UF). Fica guardada neste navegador (IndexedDB).
     2) Entrada (rodada 1) — células, setores, Sector Equipment, RRUs (window.PL_TOOL.rsModel).
     3) Leitura RS (comandos extras desta aba) — APP, CNOPERATOR, CNOPERATORTA, S1/X2, EPGROUP, SCTP...
   Exporta window.RS4G (usado pela Documentação lógica para o Endereço ID / UF / cidade / MNC). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var pane = $("pane-rs4g");
  if (!pane) return;

  // ---------------------------------------------------------------- constantes
  var READ_CMDS = ["LST APP:;", "LST ENODEBSHARINGMODE:;", "LST ENODEBFUNCTION:;", "LST CNOPERATOR:;", "LST CNOPERATORTA:;",
    "LST CELL:;", "LST CELLOP:;", "LST EPGROUP:;", "LST SCTPHOST:;", "LST USERPLANEHOST:;", "LST SCTPHOST2EPGRP:;",
    "LST UPHOST2EPGRP:;", "LST SCTPPEER:;", "LST SCTPPEER2EPGRP:;", "LST S1:;", "LST X2:;", "LST EUTRANINTERNFREQ:;"];
  var BW = { "1.4": "CELL_BW_N6", "3": "CELL_BW_N15", "5": "CELL_BW_N25", "10": "CELL_BW_N50", "15": "CELL_BW_N75", "20": "CELL_BW_N100" };
  var FREQ_BAND = { "700": "28", "850": "5", "900": "8", "1800": "3", "2100": "1", "2600": "7" };
  var BAND_FREQ = { "28": "700", "5": "850", "8": "900", "3": "1800", "1": "2100", "7": "2600" };
  var ORD = { A: 1, B: 2, C: 3, D: 4, E: 1, F: 2, G: 3, I: 1, J: 2, K: 3, M: 1, N: 2, O: 3, Q: 1, R: 2, S: 3 };
  var RSI_DEF = { moran: [115, 215, 315], other: [522, 368, 344] };   // valores usados no roteiro (editáveis)
  var MME_DEF = { ip1: "10.69.210.140", ip2: "10.69.7.140" };          // exemplo do roteiro — confirmar por regional
  var LS_MME = "rs4g.mme.v1", LS_READ = "rs4g.read.";
  var HELPER = "http://127.0.0.1:8765";

  // ---------------------------------------------------------------- utilitários
  function nk(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function sv(v) {
    if (v == null) return "";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
    return String(v).replace(/ /g, " ").trim();
  }
  function core(n) { return String(n || "").toUpperCase().replace(/\s+/g, "").replace(/^(SR|4G|5G|NR|MR|LTE|LR)-/, ""); }
  function pad2(v) { v = sv(v).replace(/\.0+$/, ""); return /^\d$/.test(v) ? "0" + v : v; }
  function int(v) { var m = /^\s*(\d+)/.exec(sv(v)); return m ? m[1] : ""; }
  function bwMhz(v) {
    var s = sv(v); if (!s || /iot|nb|guard|novo|-/i.test(s) && !/^\d/.test(s)) return "";
    var n = parseFloat(s.replace(",", ".")); if (!isFinite(n) || n <= 0) return "";
    if (n >= 1000) n = n / 1000;                      // 10000 (kHz) → 10
    var k = String(n);
    return BW[k] ? k : "";
  }
  function isIotRow(r) { return /iot/i.test(r.port) || /iot/i.test(r.obs) || /iot/i.test(r.dlF) || /iot/i.test(r.bwF) || sv(r.bwF) === "0.2"; }
  function ordOf(setor, name) {
    var s = String(setor || "").toUpperCase().replace(/[^A-Z]/g, ""), L = s.slice(-1);
    if (!L) { var m = /-([A-Z0-9]+)\s*$/i.exec(name || ""); L = m ? m[1].toUpperCase().replace(/[^A-Z]/g, "").slice(-1) : ""; }
    return ORD[L] || 0;
  }
  function most(arr) { var c = {}, b = "", bn = 0; arr.forEach(function (x) { x = sv(x); if (!x) return; c[x] = (c[x] || 0) + 1; if (c[x] > bn) { bn = c[x]; b = x; } }); return b; }
  function loadedSite() { return (($("neLbl") && $("neLbl").textContent) || "").split("·")[0].trim(); }
  function now() { var d = new Date(); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ipOk(s) { return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every(function (x) { return +x <= 255; }); }
  function copyText(txt, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = "Copiado!"; setTimeout(function () { btn.textContent = o; }, 1400); };
    function fb() { var ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fb); else fb();
  }

  // ---------------------------------------------------------------- IndexedDB (base MOU)
  var DBN = "telebitRS4G", ST = "kv";
  function idb() { return new Promise(function (res, rej) { var r = indexedDB.open(DBN, 1); r.onupgradeneeded = function () { r.result.createObjectStore(ST); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res, rej) { var q = db.transaction(ST).objectStore(ST).get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); }); }
  function idbSet(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(ST, "readwrite"); t.objectStore(ST).put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }); }

  // ---------------------------------------------------------------- leitura da planilha MOU
  var MOU = null, IDX = {};
  var KEYS = { sf: "sitefisico", status: "status", ced: "cedente", tom: "tomadora", uf: "uf", mun: "municipio", cn: "cn",
    ne: "nesingleranmrat", enb: "enodebname", cell: "cellname", setor: "setor", vendor: "vendor", cid: "cellid", port: "portadoras4g",
    bw: "banda4gmhz", enbId: "enodebiddec", cidDec: "celliddec", tac: "tacdec", dl: "earfcndl", pci: "pci", obs: "observacoes",
    p2: "plmnidposicao2tim", p3: "plmnidposicao3vivo", bwF: "bandfut", dlF: "earcnfut", fc: "freqcentral", endId: "endid", freq: "freq" };
  function parseMou(ab, fname) {
    if (!window.XLSX) throw new Error("A biblioteca de planilhas (XLSX) não carregou — confira a internet e recarregue a página.");
    var data = new Uint8Array(ab);
    var names = XLSX.read(data, { type: "array", bookSheets: true }).SheetNames || [];
    var shLog = names.filter(function (n) { return nk(n).indexOf("consolidacaologicos") === 0; })[0];
    var shMnc = names.filter(function (n) { return nk(n) === "mnc"; })[0];
    if (!shLog) throw new Error('Aba "Consolidação Lógicos Cedente" não encontrada no arquivo.');
    var wb = XLSX.read(data, { type: "array", sheets: [shLog].concat(shMnc ? [shMnc] : []) });
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[shLog], { header: 1, raw: true, defval: null, blankrows: false });
    var hi = -1;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var h = (rows[i] || []).map(nk);
      if (h.indexOf("enodebname") >= 0 && h.indexOf("cellname") >= 0) { hi = i; break; }
    }
    if (hi < 0) throw new Error('Cabeçalho (EnodeB Name / Cell Name) não encontrado na aba "' + shLog + '".');
    var head = rows[hi].map(nk), col = {};
    Object.keys(KEYS).forEach(function (k) { col[k] = head.indexOf(KEYS[k]); });
    col.fase = head.findIndex(function (h) { return h.indexOf("fasedoprojeto") === 0; });
    var out = [];
    for (var r = hi + 1; r < rows.length; r++) {
      var a = rows[r] || [], o = {};
      Object.keys(col).forEach(function (k) { o[k] = col[k] >= 0 ? sv(a[col[k]]) : ""; });
      o.ne = o.ne.replace(/\s+/g, ""); o.enb = o.enb.replace(/\s+/g, "");
      if (!o.ne && !o.enb) continue;
      out.push(o);
    }
    var mnc = {};
    if (shMnc) {
      var m = XLSX.utils.sheet_to_json(wb.Sheets[shMnc], { header: 1, raw: true, defval: null, blankrows: false });
      var mh = (m[0] || []).map(nk), cu = mh.indexOf("uf"),
        ct = mh.findIndex(function (h) { return h.indexOf("mnctim") === 0; }),
        cv = mh.findIndex(function (h) { return h.indexOf("mncvivo") === 0; });
      for (var j = 1; j < m.length; j++) {
        var uf = sv((m[j] || [])[cu]).toUpperCase();
        if (/^[A-Z]{2}$/.test(uf)) mnc[uf] = { tim: pad2(m[j][ct]), vivo: pad2(m[j][cv]) };
      }
    }
    return { at: Date.now(), file: fname || "", sheet: shLog, rows: out, mnc: mnc };
  }
  function indexMou() {
    IDX = {};
    if (!MOU) return;
    MOU.rows.forEach(function (r) {
      [r.ne, r.enb].forEach(function (n) { var k = core(n); if (!k || k === "-") return; (IDX[k] = IDX[k] || []); if (IDX[k].indexOf(r) < 0) IDX[k].push(r); });
    });
  }
  function planOf(site) { return (MOU && IDX[core(site)]) || []; }

  // ---------------------------------------------------------------- parser MML (respostas do MAE)
  function normText(t) { return String(t || "").replace(/<br\s*\/?>/gi, "\n").replace(/&amp;/g, "&").replace(/ /g, " ").replace(/\t/g, "    ").replace(/\r/g, ""); }
  function ckey(c) { var m = /^\s*([A-Z]+)\s+([A-Z0-9]+)/i.exec(c || ""); return m ? (m[1] + " " + m[2]).toUpperCase() : ""; }
  function blocks(text) {
    var t = normText(text), idx = [], m, re = /%%(?:\/\*\d+\*\/)?\s*([A-Z]{2,4}\s+[A-Z0-9]+\s*:[^%\n]*?;?)\s*%%/gi;
    while ((m = re.exec(t))) idx.push({ at: m.index, end: re.lastIndex, cmd: m[1] });
    if (!idx.length) {
      var re2 = /^[ ]*((?:LST|DSP)\s+[A-Z0-9]+\s*:[^\n]*;)[ ]*$/gim;
      while ((m = re2.exec(t))) idx.push({ at: m.index, end: re2.lastIndex, cmd: m[1] });
    }
    return idx.map(function (b, i) { return { cmd: b.cmd, key: ckey(b.cmd), body: t.slice(b.end, i + 1 < idx.length ? idx[i + 1].at : t.length) }; });
  }
  var FV_RE = /^\s*([A-Za-z0-9][A-Za-z0-9 .,()_\/+&'-]*?)\s+=\s+(.*)$/;
  function isStop(t) { return /^\(Number of results|^---|^\+\+\+|^To be continued|^%%|^\d+ reports? in total|^RETCODE|^O&M\s/.test(t); }
  function parseBody(body) {
    var L = body.split("\n"), rows = [], i = 0;
    while (i < L.length) {
      var t = L[i].trim();
      if (t && !isStop(t) && i + 1 < L.length && /^-{3,}$/.test(L[i + 1].trim())) {
        var j = i + 2;
        while (j < L.length && !L[j].trim()) j++;
        if (j < L.length && FV_RE.test(L[j])) {                       // registro único: "campo = valor"
          var cur = null, first = null;
          for (; j < L.length; j++) {
            var tt = L[j].trim(); if (!tt) continue; if (isStop(tt)) break;
            var f = FV_RE.exec(L[j]); if (!f) continue;
            var k = f[1].trim();
            if (first === null) first = k;
            if (k === first || !cur) { cur = {}; rows.push(cur); }
            if (cur[k] === undefined) cur[k] = f[2].trim();
          }
        } else if (j < L.length) {                                    // tabela em colunas
          var h = L[j].trim().split(/\s{2,}/);
          for (j++; j < L.length; j++) {
            var tl = L[j].trim(); if (!tl) continue; if (isStop(tl)) break;
            var c = tl.split(/\s{2,}/); if (c.length < h.length - 1) break;
            var o = {}; h.forEach(function (hh, x) { o[hh] = c[x] !== undefined ? c[x] : ""; }); rows.push(o);
          }
        }
        i = j; continue;
      }
      i++;
    }
    if (!rows.length) {                                              // sem título: tenta "campo = valor" solto
      var o2 = {}; L.forEach(function (l) { var f = FV_RE.exec(l); if (f && o2[f[1].trim()] === undefined) o2[f[1].trim()] = f[2].trim(); });
      if (Object.keys(o2).length) rows.push(o2);
    }
    return rows;
  }
  function readAll(text) {
    var res = {};
    blocks(text).forEach(function (b) {
      if (!b.key) return;
      var e = res[b.key] || (res[b.key] = { rows: [], raw: [] });
      e.rows = e.rows.concat(parseBody(b.body)); e.raw.push(b.body);
    });
    return res;
  }
  function g(row) {
    var ks = Object.keys(row), c = Array.prototype.slice.call(arguments, 1), x, k, n;
    for (x = 0; x < c.length; x++) { n = nk(c[x]); for (k = 0; k < ks.length; k++) if (nk(ks[k]) === n) return val(row[ks[k]]); }
    for (x = 0; x < c.length; x++) { n = nk(c[x]); for (k = 0; k < ks.length; k++) if (nk(ks[k]).indexOf(n) >= 0) return val(row[ks[k]]); }
    return "";
  }
  function val(v) { v = sv(v); return /^NULL$/i.test(v) ? "" : v; }
  // linhas numéricas sem título (formato curto colado) — usadas como último recurso
  function numRows(e) {
    var out = []; (e && e.raw || []).forEach(function (b) { b.split("\n").forEach(function (l) { var p = l.trim().split(/\s{2,}|\s+/); if (p.length >= 2 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) out.push(p); }); });
    return out;
  }

  // ---------------------------------------------------------------- estado
  var S = { site: "", plan: [], readText: "", readAt: "", U: {}, dirty: false, auto: "" };
  function U() { var k = core(S.site) || "_"; return S.U[k] || (S.U[k] = { p: {}, nc: {}, skip: {}, blk: { cfm: true, rs: null, freq: true, name: true, newc: true } }); }
  function mmeStore() { return lsGet(LS_MME, {}); }

  // ---------------------------------------------------------------- modelo (tudo que o script precisa)
  function siteRead() {
    var R = {}, sameLoaded = core(loadedSite()) === core(S.site) && !!core(S.site);
    if (sameLoaded) { var u = $("uniIn"); R = readAll(u ? u.value : ""); }
    var X = readAll(S.readText);
    Object.keys(X).forEach(function (k) { if (X[k].rows.length || !R[k]) R[k] = X[k]; });
    return { R: R, sameLoaded: sameLoaded };
  }
  function rowsOf(R, k) { return (R[k] && R[k].rows) || []; }
  function nextFree(pref, used) { var x = +pref; while (used[String(x)]) x++; return x; }

  function model() {
    var u = U(), P = S.plan, rd = siteRead(), R = rd.R, M = { warn: [], block: [], info: [] };
    M.site = S.site; M.sameLoaded = rd.sameLoaded; M.R = R;
    var pm = (rd.sameLoaded && window.PL_TOOL && window.PL_TOOL.rsModel) ? window.PL_TOOL.rsModel() : { cells: [], sectors: {}, secEqs: {}, rrus: {} };
    M.pm = pm;
    // ---------- planilha ----------
    var p0 = P[0] || {};
    M.hasPlan = P.length > 0;
    M.uf = (p0.uf || "").toUpperCase(); M.city = p0.mun || ""; M.ced = most(P.map(function (r) { return r.ced; })); M.tom = most(P.map(function (r) { return r.tom; }));
    M.status = most(P.map(function (r) { return r.status; })); M.endId = most(P.map(function (r) { return r.endId; })) || most(P.map(function (r) { return r.sf; })); M.sf = most(P.map(function (r) { return r.sf; }));
    M.vendor = most(P.map(function (r) { return r.vendor; }));
    var pl = P.filter(function (r) { return !isIotRow(r); }), pi = P.filter(isIotRow);
    M.enbPlan = int(most(P.map(function (r) { return r.enbId; })));
    M.tacPlan = int(most(pl.map(function (r) { return r.tac; })));
    M.iotTacPlan = int(most(pi.map(function (r) { return r.tac; })));
    var mn = (MOU && MOU.mnc && MOU.mnc[M.uf]) || null;
    var pp2 = most(P.map(function (r) { return r.p2; })), pp3 = most(P.map(function (r) { return r.p3; }));
    var c2 = pad2((/-(\d+)$/.exec(pp2) || [])[1] || ""), c3 = pad2((/-(\d+)$/.exec(pp3) || [])[1] || "");
    M.mncTim = mn ? mn.tim : c2; M.mncVivo = mn ? mn.vivo : c3;
    if (mn && c2 && (c2 !== mn.tim || c3 !== mn.vivo)) M.warn.push("MNC da aba MNC (" + M.uf + ": TIM " + mn.tim + " / VIVO " + mn.vivo + ") diferente do PLMN das células (" + pp2 + " / " + pp3 + "). Usei a aba MNC.");
    if (M.hasPlan && M.ced && !/^tim$/i.test(M.ced)) M.warn.push("Na planilha o cedente deste site é " + M.ced + " (tomadora " + M.tom + "). Este roteiro é para site TIM (cedente) recebendo a VIVO.");
    if (M.hasPlan && M.vendor && !/huawei/i.test(M.vendor)) M.warn.push("Vendor na planilha: " + M.vendor + ".");

    // ---------- site: leitura ----------
    M.enbSite = g(rowsOf(R, "LST ENODEBFUNCTION")[0] || {}, "eNodeB ID");
    var sm = rowsOf(R, "LST ENODEBSHARINGMODE")[0]; M.shareMode = sm ? g(sm, "eNodeB Sharing Mode", "Sharing Mode") : "";
    var apps = rowsOf(R, "LST APP"), ap = apps.filter(function (r) { return Object.keys(r).some(function (k) { return /enodeb|lte/i.test(r[k]); }); })[0];
    M.aidSite = ap ? g(ap, "Application ID", "AID") : "";
    M.ops = rowsOf(R, "LST CNOPERATOR").map(function (r) { return { id: g(r, "CN Operator ID"), name: g(r, "CN Operator name"), type: g(r, "CN Operator type"), mnc: g(r, "Mobile network code") }; }).filter(function (o) { return o.id !== ""; });
    var tas = rowsOf(R, "LST CNOPERATORTA").map(function (r) { return { ta: g(r, "Tracking area ID"), op: g(r, "CN Operator ID"), tac: g(r, "Tracking area code"), iot: /true/i.test(g(r, "NB-IoT TA Flag", "NB-IoT TA", "NBIOTTAFLAG")) }; }).filter(function (t) { return t.ta !== ""; });
    if (!tas.length) tas = numRows(R["LST CNOPERATORTA"]).map(function (p) { return { ta: p[0], op: p[1], tac: p[2] || "", iot: /true/i.test(p[3] || "") }; });
    M.tas = tas;
    var opIds = {}; M.ops.forEach(function (o) { opIds[o.id] = o; });
    M.rsDone = !!opIds["3"] || M.ops.some(function (o) { return /vivo/i.test(o.name); }) || tas.some(function (t) { return t.op === "3"; });
    var t0 = tas.filter(function (t) { return t.op === "0" && !t.iot; })[0] || tas.filter(function (t) { return !t.iot; })[0];
    var ti = tas.filter(function (t) { return t.op === "0" && t.iot; })[0] || tas.filter(function (t) { return t.iot; })[0];
    M.ta0 = t0 ? t0.ta : "0"; M.tacSite = t0 ? t0.tac : "";
    M.iotTa = ti ? ti.ta : ""; M.iotTacSite = ti ? ti.tac : "";
    var taUsed = {}; tas.forEach(function (t) { taUsed[t.ta] = 1; });
    var taOf = function (op, iot) { var x = tas.filter(function (t) { return t.op === op && !!t.iot === iot; })[0]; return x ? x.ta : ""; };
    M.taTim = taOf("2", false) || String(nextFree(2, taUsed)); taUsed[M.taTim] = 1;
    M.taVivo = taOf("3", false) || String(nextFree(3, taUsed)); taUsed[M.taVivo] = 1;
    if (M.iotTa) {
      M.iotTim = taOf("2", true) || String(nextFree(+M.iotTa + 10, taUsed)); taUsed[M.iotTim] = 1;
      M.iotVivo = taOf("3", true) || String(nextFree(+M.iotTa + 20, taUsed)); taUsed[M.iotVivo] = 1;
    }
    // TAC (planilha × site): se divergirem, o usuário escolhe
    function pick(plan, site, sel) {
      if (plan && site && plan !== site) return { conflict: true, v: sel === "plan" ? plan : sel === "site" ? site : "" };
      return { conflict: false, v: plan || site };
    }
    var tk = pick(M.tacPlan, M.tacSite, u.tacSel); M.tacConflict = tk.conflict; M.tac = tk.v;
    var ik = pick(M.iotTacPlan, M.iotTacSite, u.iotSel); M.iotConflict = ik.conflict; M.iotTac = ik.v;

    // ---------- células do site ----------
    var cells = (pm.cells || []).filter(function (c) { return c.tech === "LTE" || c.tech === "NB-IoT"; }).map(function (c) {
      var bb = ((c.links || []).filter(function (l) { return l.src === "CELL" && l.bb !== undefined && l.bb !== ""; })[0] || {}).bb || "";
      return { id: String(c.id), name: c.name, nb: c.tech === "NB-IoT", band: String(c.band || ""), dl: int(c.dl), dlbw: c.dlbw, ulbw: c.ulbw, pci: c.pci, txrx: c.txrx, rsi: c.rsi, secs: (c.secs || []).map(String), bb: String(bb) };
    });
    if (!cells.length) {
      cells = rowsOf(R, "LST CELL").map(function (r) {
        return { id: g(r, "Local cell ID"), name: g(r, "Cell Name"), nb: /true/i.test(g(r, "NB-IoT Cell Flag")), band: g(r, "Frequency band"), dl: int(g(r, "Downlink EARFCN")),
          dlbw: g(r, "Downlink bandwidth"), ulbw: g(r, "Uplink bandwidth"), pci: g(r, "Physical cell ID"), txrx: g(r, "Cell transmission and reception mode"), rsi: g(r, "Root sequence index"), secs: [], bb: "" };
      }).filter(function (c) { return c.id !== ""; });
    }
    M.cellsFrom = (pm.cells || []).length ? "Entrada" : (cells.length ? "LST CELL" : "");
    var byId = {}; cells.forEach(function (c) { byId[c.id] = c; });
    var planById = {}, planByName = {};
    P.forEach(function (r) { var id = int(r.cid); if (id && !planById[id]) planById[id] = r; if (r.cell) planByName[r.cell.toUpperCase()] = r; });
    var inf = rowsOf(R, "LST EUTRANINTERNFREQ").map(function (r) { return { id: g(r, "Local cell ID"), dl: int(g(r, "Downlink EARFCN")) }; }).filter(function (x) { return x.id !== ""; });
    if (!inf.length) inf = numRows(R["LST EUTRANINTERNFREQ"]).map(function (p) { return { id: p[0], dl: p[1] }; });
    var cellop = {}; rowsOf(R, "LST CELLOP").forEach(function (r) { var id = g(r, "Local cell ID"), ta = g(r, "Tracking area ID"); if (id !== "") (cellop[id] = cellop[id] || {})[ta] = 1; });
    M.cellopRead = !!R["LST CELLOP"];
    M.cells = cells.map(function (c) {
      var pr = planById[c.id] || planByName[(c.name || "").toUpperCase()] || null, a = { c: c, pr: pr, act: [] };
      if (pr) {
        if (pr.cell && pr.cell !== c.name) { a.newName = pr.cell; a.act.push("name"); }
        if (!c.nb && !isIotRow(pr)) {
          var nd = int(pr.dlF) || int(pr.dl), nb = bwMhz(pr.bwF) || bwMhz(pr.bw), cb = bwMhz(c.dlbw);
          if (nd && nd !== c.dl) { a.newDl = nd; a.act.push("freq"); }
          if (nb && nb !== cb) { a.newBw = nb; a.act.push("bw"); }
          var fb = FREQ_BAND[int(pr.freq) || int(pr.port)] || "";
          if (fb && c.band && fb !== c.band) M.warn.push("Célula " + c.id + " (" + c.name + "): banda no site " + c.band + " × planilha " + pr.freq + " MHz (" + pr.cell + "). Confira o Cell_ID.");
          if (a.newDl) a.rmvInf = inf.filter(function (x) { return x.id === c.id && x.dl === a.newDl; }).map(function (x) { return x.dl; });
        }
        if (pr.pci && int(pr.pci) && c.pci && int(pr.pci) !== int(c.pci)) a.pciDiff = int(pr.pci);
        a.ord = ordOf(pr.setor, pr.cell);
      } else a.ord = ordOf("", c.name);
      a.skip = !!u.skip[c.id];
      a.ops = cellop[c.id] || {};
      return a;
    });

    // ---------- novas células (planilha sem Local Cell no site) ----------
    var secEqs = pm.secEqs || {}, usedSe = {};
    Object.keys(secEqs).forEach(function (k) { usedSe[k] = 1; });
    var umts = (pm.cells || []).filter(function (c) { return c.tech === "UMTS"; });
    var bbAll = most(cells.map(function (c) { return c.bb; })) || "0";
    M.news = [];
    P.forEach(function (r) {
      var id = int(r.cid); if (!id || byId[id] || isIotRow(r)) return;
      if (M.news.some(function (n) { return n.id === id; })) return;
      var fr = int(r.freq) || int(r.port), band = FREQ_BAND[fr] || "";
      var n = { id: id, name: r.cell, fr: fr, band: band, dl: int(r.dlF) || int(r.dl), bw: bwMhz(r.bwF) || bwMhz(r.bw), cellId: int(r.cidDec) || id, pci: int(r.pci),
        moran: /^4R-/i.test(r.cell), ord: ordOf(r.setor, r.cell), src: "man", ants: [], rrus: [], note: "" };
      // 1) mesma banda já existe no LTE, mesmo setor → reaproveita o SECTOREQM (ex.: LTE700 MORAN VIVO)
      var same = M.cells.filter(function (x) { return !x.c.nb && x.c.band === band && x.ord === n.ord && x.c.secs.length; });
      same.sort(function (x, y) { return (/^4C-/i.test(y.c.name) ? 1 : 0) - (/^4C-/i.test(x.c.name) ? 1 : 0); });
      if (same[0]) {
        var sc = same[0].c; n.src = "lte"; n.se = sc.secs[0]; n.bb = sc.bb || bbAll; n.txrx = sc.txrx || "2T2R"; n.from = sc.id + " " + sc.name;
      } else {
        // 2) frequência existente no 3G → novo SECTOREQM no setor do 3G (mesma RRU)
        var um = umts.filter(function (x) { return String(x.band) === band && (x.secs || []).length; });
        um.sort(function (x, y) { return (+x.secs[0]) - (+y.secs[0]); });
        var byName = um.filter(function (x) { return ordOf("", x.name) === n.ord; })[0];
        var uc = byName || um[n.ord - 1];
        if (uc) {
          var se3 = secEqs[uc.secs[0]] || {}, sec = se3.sector != null ? String(se3.sector) : String(uc.secs[0]);
          var ants = (se3.ants || []).filter(function (a) { return a.ch && a.ch !== "BEAM"; });
          if (!ants.length && pm.sectors && pm.sectors[sec]) ants = (pm.sectors[sec].ants || []).filter(function (a) { return a.ch; });
          n.src = "umts"; n.sector = sec; n.from = uc.id + " " + (uc.name || "") + " (setor " + sec + ")";
          n.ants = ants.map(function (a) { var p = String(a.k).split("_"); return { cn: p[0], srn: p[1], sn: p[2], ch: a.ch, rxOnly: /RX/i.test(a.mode || "") && !/TX/i.test(a.mode || "") }; });
          var rxOnly = n.ants.some(function (a) { return a.rxOnly; });
          n.txrx = n.ants.length >= 4 ? "4T4R" : (n.ants.length === 2 && !rxOnly ? "2T2R" : "1T2R");
          var cand = [+sec, +sec + 100, +sec + 110, +sec + 200, +sec + 300], se = cand.filter(function (x) { return !usedSe[String(x)]; })[0];
          if (se == null) se = nextFree(+sec + 400, usedSe);
          n.se = String(se); usedSe[n.se] = 1; n.seNew = true; n.bb = bbAll;
        } else { n.note = "sem LTE/3G da mesma frequência no setor — preencha SECTOREQM e antenas"; n.txrx = "2T2R"; n.bb = bbAll; n.se = ""; n.seNew = true; n.sector = ""; }
      }
      n.rsi = String((n.moran || band === "28" ? RSI_DEF.moran : RSI_DEF.other)[Math.max(0, (n.ord || 1) - 1)] || "");
      // edições do usuário
      var e = u.nc[id] || {};
      ["se", "sector", "bb", "txrx", "rsi", "pci", "dl"].forEach(function (k) { if (e[k] != null && e[k] !== "") n[k] = e[k]; });
      if (e.a1 != null || e.a2 != null) {
        n.ants = [e.a1, e.a2].filter(function (x) { return x && x.trim(); }).map(function (x) { var p = x.split("/").map(function (s) { return s.trim(); }); return { cn: p[0] || "0", srn: p[1] || "", sn: p[2] || "0", ch: (p[3] || "").toUpperCase() }; });
      }
      if (e.seNew != null) n.seNew = !!e.seNew;
      n.skip = !!u.skip["n" + id];
      if (!n.band) M.warn.push("Nova célula " + id + " (" + n.name + "): frequência " + (r.freq || r.port) + " sem banda conhecida.");
      M.news.push(n);
    });
    // nomes das RRUs compartilhadas 3G+4G
    var rr = {};
    M.news.forEach(function (n) {
      if (n.skip || !n.seNew) return;
      n.ants.forEach(function (a) { var k = a.cn + "_" + a.srn + "_" + a.sn; var o = rr[k] || (rr[k] = { cn: a.cn, srn: a.srn, sn: a.sn, fr: n.fr, ords: [] }); if (n.ord && o.ords.indexOf(n.ord) < 0) o.ords.push(n.ord); });
    });
    M.rruMods = Object.keys(rr).map(function (k) { var o = rr[k]; o.ords.sort(); o.rn = "RRU_UL" + o.fr + "_" + (o.ords.length ? o.ords.map(function (x) { return "SEC0" + x; }).join("_") : "SEC"); return o; });
    M.extra = M.cells.filter(function (a) { return !a.pr; });

    // ---------- conectividade VIVO / IDs ----------
    var p = u.p, used = function (k, f) { var o = {}; rowsOf(R, k).forEach(function (r) { var v = g(r, f); if (v !== "") o[v] = 1; }); return o; };
    var epgU = used("LST EPGROUP", "EPGroup ID"), peerU = used("LST SCTPPEER", "SCTP Peer ID"), s1U = used("LST S1", "S1 ID"), x2U = used("LST X2", "X2 ID");
    var h2e = {}; rowsOf(R, "LST SCTPHOST2EPGRP").forEach(function (r) { var e = g(r, "EPGroup ID"); if (e !== "" && h2e[e] == null) h2e[e] = g(r, "SCTP Host ID"); });
    var u2e = {}; rowsOf(R, "LST UPHOST2EPGRP").forEach(function (r) { var e = g(r, "EPGroup ID"); if (e !== "" && u2e[e] == null) u2e[e] = g(r, "User Plane Host ID", "UP Host ID"); });
    var hosts = rowsOf(R, "LST SCTPHOST").map(function (r) { return g(r, "SCTP Host ID"); }).filter(Boolean);
    var uph = rowsOf(R, "LST USERPLANEHOST").map(function (r) { return g(r, "User Plane Host ID", "UP Host ID"); }).filter(Boolean);
    function ifc(k, idf) {
      return rowsOf(R, k).map(function (r) { return { id: g(r, idf), op: g(r, "CN Operator ID"), cp: g(r, "Control Plane EPGroup ID", "CP EPGroup ID", "CPEPGROUPID"), up: g(r, "User Plane EPGroup ID", "UP EPGroup ID", "UPEPGROUPID"), label: g(r, "User Label") }; }).filter(function (x) { return x.id !== ""; });
    }
    M.s1 = ifc("LST S1", "S1 ID"); M.x2 = ifc("LST X2", "X2 ID");
    M.s1Tim = M.s1.filter(function (x) { return x.op === "0" || x.op === ""; });
    M.x2Tim = M.x2.filter(function (x) { return x.op === "0" || x.op === ""; });
    var s1r = M.s1Tim[0] || M.s1[0] || {}, x2r = M.x2Tim[0] || M.x2[0] || {};
    var d = {};
    d.aid = M.aidSite || "4";
    d.epgS1 = String(nextFree(10, epgU)); epgU[d.epgS1] = 1; d.epgX2 = String(nextFree(11, epgU));
    d.sctpS1 = h2e[s1r.cp] || hosts[0] || "30";
    d.sctpX2 = h2e[x2r.cp] || hosts.filter(function (h) { return h !== d.sctpS1; })[0] || d.sctpS1;
    d.upS1 = u2e[s1r.up] || uph[0] || "30";
    d.upX2 = u2e[x2r.up] || d.upS1;
    d.peer1 = String(nextFree(1500, peerU)); peerU[d.peer1] = 1; d.peer2 = String(nextFree(2300, peerU));
    d.s1Id = String(nextFree(3, s1U)); d.x2Id = String(nextFree(3, x2U));
    d.wait = "20";
    var mm = mmeStore()[M.uf || "_"] || {};
    d.mme1 = mm.ip1 || MME_DEF.ip1; d.mme2 = mm.ip2 || MME_DEF.ip2; M.mmeDefault = !(mm.ip1 || mm.ip2);
    M.def = d; M.p = {};
    Object.keys(d).forEach(function (k) { M.p[k] = (p[k] != null && String(p[k]).trim() !== "") ? String(p[k]).trim() : d[k]; });
    if (!R["LST S1"]) M.warn.push("LST S1 não lido — o MOD S1 (TIM) e o SCTPHOST/UPHOST do S1 VIVO foram assumidos. Rode a leitura RS.");

    // ---------- blocos ----------
    var b = u.blk; M.blk = { cfm: b.cfm !== false, rs: b.rs == null ? !M.rsDone : !!b.rs, freq: b.freq !== false, name: b.name !== false, newc: b.newc !== false };
    if (M.blk.rs) {
      if (!M.hasPlan) M.block.push("Site não encontrado na planilha MOU (carregue a planilha e confira o nome).");
      if (!M.mncTim || !M.mncVivo) M.block.push("MNC TIM/VIVO desconhecido para a UF " + (M.uf || "?") + ".");
      if (M.tacConflict && !M.tac) M.block.push("TAC LTE diferente entre planilha (" + M.tacPlan + ") e site (" + M.tacSite + ") — escolha na seção 4.");
      if (!M.tac) M.block.push("TAC LTE desconhecido (sem planilha e sem LST CNOPERATORTA).");
      if (M.iotTa && M.iotConflict && !M.iotTac) M.block.push("TAC NB-IoT diferente entre planilha (" + M.iotTacPlan + ") e site (" + M.iotTacSite + ") — escolha na seção 4.");
      if (!ipOk(M.p.mme1) || !ipOk(M.p.mme2)) M.block.push("IP do MME VIVO inválido (seção 6).");
      if (!rd.sameLoaded) M.warn.push("O site carregado na Entrada é " + (loadedSite() || "nenhum") + ". Carregue " + S.site + " na aba 1 para as células/setores virem completos.");
      if (M.rsDone) M.warn.push("O site já tem operadora VIVO (CNOPERATOR 3) — o RAN Sharing parece já feito.");
    }
    return M;
  }

  // ---------------------------------------------------------------- script
  function bwc(mhz) { return BW[String(mhz)] || ""; }
  function script(M) {
    var L = [], p = M.p, add = function () { for (var i = 0; i < arguments.length; i++) L.push(arguments[i]); };
    var hr = "// " + new Array(86).join("=");
    add(hr, "// RS_4G · " + M.site + " · gerado em " + now() + " · TELEBIT RAN",
      "// Planilha: " + (MOU ? MOU.file + " (" + new Date(MOU.at).toLocaleDateString("pt-BR") + ")" : "não carregada") + (M.endId ? " · End_ID " + M.endId : "") + (M.uf ? " · " + M.uf + " " + M.city : ""), hr, "");
    var wait = function () { add("#WAIT " + (parseInt(p.wait, 10) || 20), "// DSP APP vigiado: só segue com o eNodeB Available — senão espera 20 s e consulta de novo", "DSP APP:;"); };
    var rsOn = M.blk.rs && !M.block.length;
    if (M.blk.rs && M.block.length) {
      add("// ⚠ RAN SHARING NÃO GERADO — resolva antes:"); M.block.forEach(function (x) { add("//   - " + x); }); add("");
    }
    if (rsOn) {
      add("// ######################## INÍCIO DO RAN SHARING 4G ########################");
      if (M.blk.cfm) add("// CFM CB vigiado: se falhar, repete com outro NAME; se falhar de novo, pergunta antes de seguir", 'CFM CB:NAME="Pre_RS",AUTORBKSW=DISABLE;');
      add("", "LST ENODEBSHARINGMODE:;");
      if (/SHARED_FREQ|shared freq/i.test(M.shareMode)) add("// já está SHARED_FREQ no site");
      else add("MOD ENODEBSHARINGMODE:ENODEBSHARINGMODE=SHARED_FREQ;");
      add("// reset do serviço (APP do eNodeB, AID " + p.aid + ") — confira Application State = Available", "RST APP:AID=" + p.aid + ";");
      wait();
      add("", "RMV EUTRANINTRAFREQNCELL:;", "RMV EUTRANINTERFREQNCELL:;", "");
      add("LST CNOPERATOR:;", 'MOD CNOPERATOR:CNOPERATORID=0,CNOPERATORNAME="DUMMY",MNC="99";', "RST APP:AID=" + p.aid + ";");
      wait();
      var sw = "OPERATORFUNSWITCH=CELL_TRAFFIC_TRACE_MSG_SWITCH-1&CMAS_BROADCAST_SWITCH-1&INTRA_RAT_INTER_PLMN_HO_SW-1&UTRAN_INTER_PLMN_HO_SW-1&GERAN_INTER_PLMN_HO_SW-1&NR_INTER_PLMN_HO_SW-1";
      add("", "// MNC regional (" + (M.uf || "?") + "): TIM " + M.mncTim + " · VIVO " + M.mncVivo);
      add('ADD CNOPERATOR:CNOPERATORID=2,CNOPERATORNAME="TIM",CNOPERATORTYPE=CNOPERATOR_SECONDARY,MCC="724",MNC="' + M.mncTim + '",' + sw + ";");
      add('ADD CNOPERATOR:CNOPERATORID=3,CNOPERATORNAME="VIVO",CNOPERATORTYPE=CNOPERATOR_SECONDARY,MCC="724",MNC="' + M.mncVivo + '",' + sw + ";");
      add("", "// TAC — planilha " + (M.tacPlan || "—") + " · site " + (M.tacSite || "—") + " → usando " + M.tac);
      add("LST CNOPERATORTA:;", "MOD CNOPERATORTA:TRACKINGAREAID=" + M.ta0 + ",TAC=" + M.tac + ";");
      add("ADD CNOPERATORTA:TRACKINGAREAID=" + M.taTim + ",CNOPERATORID=2,TAC=" + M.tac + ";");
      add("ADD CNOPERATORTA:TRACKINGAREAID=" + M.taVivo + ",CNOPERATORID=3,TAC=" + M.tac + ";");
      if (M.iotTa && M.iotTac) {
        add("// NB-IoT — planilha " + (M.iotTacPlan || "—") + " · site " + (M.iotTacSite || "—") + " → usando " + M.iotTac);
        add("MOD CNOPERATORTA:TRACKINGAREAID=" + M.iotTa + ",TAC=" + M.iotTac + ";");
        add("ADD CNOPERATORTA:TRACKINGAREAID=" + M.iotTim + ",CNOPERATORID=2,TAC=" + M.iotTac + ",NBIOTTAFLAG=BOOLEAN_TRUE;");
        add("ADD CNOPERATORTA:TRACKINGAREAID=" + M.iotVivo + ",CNOPERATORID=3,TAC=" + M.iotTac + ",NBIOTTAFLAG=BOOLEAN_TRUE;");
      }
      add("", "// Conectividade com o MME VIVO" + (M.mmeDefault ? " (IPs do exemplo do roteiro — CONFIRME para a regional)" : ""));
      add('ADD EPGROUP:EPGROUPID=' + p.epgS1 + ',USERLABEL="S1_VIVO",IPPMSWITCH=DISABLE,APPTYPE=NULL;');
      add('ADD EPGROUP:EPGROUPID=' + p.epgX2 + ',USERLABEL="x2_VIVO",IPPMSWITCH=DISABLE,APPTYPE=NULL;');
      add("ADD SCTPHOST2EPGRP:EPGROUPID=" + p.epgS1 + ",SCTPHOSTID=" + p.sctpS1 + ";", "ADD SCTPHOST2EPGRP:EPGROUPID=" + p.epgX2 + ",SCTPHOSTID=" + p.sctpX2 + ";");
      add("ADD UPHOST2EPGRP:EPGROUPID=" + p.epgS1 + ",UPHOSTID=" + p.upS1 + ";", "ADD UPHOST2EPGRP:EPGROUPID=" + p.epgX2 + ",UPHOSTID=" + p.upX2 + ";");
      var peer = function (id, ip, lb) { return "ADD SCTPPEER:SCTPPEERID=" + id + ',IPVERSION=IPv4,SIGIP1V4="' + ip + '",SIGIP1SECSWITCH=DISABLE,SIGIP2SECSWITCH=DISABLE,PN=36412,SIMPLEMODESWITCH=SIMPLE_MODE_OFF,USERLABEL="' + lb + '";'; };
      add(peer(p.peer1, p.mme1, "MME_1_VIVO"), peer(p.peer2, p.mme2, "MME_2_VIVO"));
      add("ADD SCTPPEER2EPGRP:EPGROUPID=" + p.epgS1 + ",SCTPPEERID=" + p.peer1 + ";", "ADD SCTPPEER2EPGRP:EPGROUPID=" + p.epgS1 + ",SCTPPEERID=" + p.peer2 + ";");
      add("");
      (M.s1Tim.length ? M.s1Tim : [{ id: "0" }]).forEach(function (s) { add("MOD S1:S1ID=" + s.id + ',CNOPERATORID=2,USERLABEL="S1_TIM";'); });
      add("ADD S1:S1ID=" + p.s1Id + ",CNOPERATORID=3,EPGROUPCFGFLAG=CP_UP_CFG,CPEPGROUPID=" + p.epgS1 + ",UPEPGROUPID=" + p.epgS1 + ',USERLABEL="S1_VIVO";');
      (M.x2Tim.length ? M.x2Tim : [{ id: "0" }]).forEach(function (s) { add("MOD X2:X2ID=" + s.id + ',CNOPERATORID=2,USERLABEL="X2_TIM";'); });
      add("ADD X2:X2ID=" + p.x2Id + ",CNOPERATORID=3,EPGROUPCFGFLAG=CP_UP_CFG,CPEPGROUPID=" + p.epgX2 + ",UPEPGROUPID=" + p.epgX2 + ',TARGETENODEBRELEASE=Release_R15,USERLABEL="X2_VIVO";');
      add("#WAIT 30", "DSP X2:;", "DSP X2INTERFACE:;");
      add("// ⚠ O S1 com CN Operator ID 3 tem que aparecer. Se NÃO aparecer, pare aqui e verifique.", "DSP S1:;", "DSP S1INTERFACE:;");
      add("", "// eNodeB ID — planilha " + (M.enbPlan || "—") + " · site " + (M.enbSite || "—"));
      if (M.enbPlan && M.enbPlan !== M.enbSite) add("MOD ENODEBFUNCTION:ENODEBID=" + M.enbPlan + ";");
      else add("// eNodeB ID já está igual à planilha");
      add("RST APP:AID=" + p.aid + ";");
      wait();
      add("", "// CELLOP — novos TAs (TIM " + M.taTim + " / VIVO " + M.taVivo + (M.iotTa ? " · NB-IoT " + M.iotTim + "/" + M.iotVivo : "") + ") em todas as células", "LST CELLOP:;");
      M.cells.forEach(function (a) {
        var c = a.c, tt = c.nb ? (M.iotTa ? [M.iotTim, M.iotVivo] : []) : [M.taTim, M.taVivo];
        if (c.nb && !M.iotTa) { add("// célula NB-IoT " + c.id + ": site sem TA de NB-IoT — CELLOP não gerado"); return; }
        tt.forEach(function (ta) { if (a.ops[ta]) return; add("ADD CELLOP:LOCALCELLID=" + c.id + ",TRACKINGAREAID=" + ta + ",MMECFGNUM=CELL_MME_CFG_NUM_0;"); });
      });
      add("// ######################## FIM DO RAN SHARING 4G ########################", "");
    }

    // ---------------- ampliações ----------------
    var chg = M.cells.filter(function (a) { return !a.skip && ((M.blk.freq && (a.newDl || a.newBw)) || (M.blk.name && a.newName)); });
    var news = M.blk.newc ? M.news.filter(function (n) { return !n.skip; }) : [];
    if (chg.length || news.length) add("// ######################## INÍCIO DAS AMPLIAÇÕES 4G ########################");
    var fq = M.blk.freq ? chg.filter(function (a) { return a.newDl || a.newBw; }) : [];
    if (fq.length) {
      add("", "// Mudar frequência/banda: primeiro tira a vizinhança (freq 'PARA') e depois muda a frequência");
      if (!rsOn) add("RMV EUTRANINTRAFREQNCELL:;", "RMV EUTRANINTERFREQNCELL:;");
      add("LST CELL:;", "LST EUTRANINTERNFREQ:;");
      fq.forEach(function (a) { (a.rmvInf || []).forEach(function (dl) { add("RMV EUTRANINTERNFREQ:LOCALCELLID=" + a.c.id + ",DLEARFCN=" + dl + ";"); }); });
      add("// N25-5M  N50-10M  N75-15M  N100-20M");
      fq.forEach(function (a) {
        var dl = a.newDl || a.c.dl, bw = bwc(a.newBw || bwMhz(a.c.dlbw));
        add("MOD CELL:LOCALCELLID=" + a.c.id + ",DLEARFCN=" + dl + (bw ? ",ULBANDWIDTH=" + bw + ",DLBANDWIDTH=" + bw : "") + ";   // " + a.c.name + ": " + (a.c.dl || "?") + "/" + (bwMhz(a.c.dlbw) || "?") + "M → " + dl + "/" + (a.newBw || bwMhz(a.c.dlbw)) + "M");
      });
    }
    var nm = M.blk.name ? chg.filter(function (a) { return a.newName; }) : [];
    if (nm.length) {
      add("", "// As células mudam de nome, conforme documentação");
      nm.forEach(function (a) { add("MOD CELL:LOCALCELLID=" + a.c.id + ',CELLNAME="' + a.newName + '";   // era ' + a.c.name); });
    }
    if (news.length) {
      var miss = news.filter(function (n) { return !n.band || !n.dl || !bwc(n.bw) || !n.se || !n.pci || !n.rsi || (n.seNew && n.ants.length < 1); });
      if (miss.length) {
        add("", "// ⚠ NOVAS CÉLULAS COM DADOS FALTANDO (não geradas): " + miss.map(function (n) { return n.id + " " + n.name; }).join(", ") + " — complete na seção 5.");
        news = news.filter(function (n) { return miss.indexOf(n) < 0; });
      }
    }
    if (news.length) {
      add("", "// Novas células — " + news.map(function (n) { return n.name; }).join(", "));
      news.forEach(function (n) { add("// " + n.id + " " + n.name + ": " + (n.moran ? "MORAN VIVO" : "MOCN") + " · " + (n.src === "lte" ? "usa o SECTOREQM " + n.se + " da célula " + n.from : n.src === "umts" ? "novo SECTOREQM " + n.se + " no setor do 3G " + n.from : "manual")); });
      news.filter(function (n) { return n.seNew; }).forEach(function (n) {
        var two = n.ants.slice(0, n.txrx === "4T4R" ? 4 : 2), parts = [];
        two.forEach(function (a, i) {
          var k = i + 1, ty = (i === 0 || n.txrx !== "1T2R") ? "RXTX_MODE" : "RX_MODE";
          parts.push("ANT" + k + "CN=" + a.cn + ",ANT" + k + "SRN=" + a.srn + ",ANT" + k + "SN=" + a.sn + ",ANT" + k + "N=" + a.ch + ",ANTTYPE" + k + "=" + ty);
        });
        add("ADD SECTOREQM:SECTOREQMID=" + n.se + ",SECTORID=" + n.sector + ",ANTCFGMODE=ANTENNAPORT,ANTNUM=" + two.length + "," + parts.join(",") + ";");
      });
      news.forEach(function (n) {
        var bw = bwc(n.bw);
        add("ADD CELL:LOCALCELLID=" + n.id + ',CELLNAME="' + n.name + '",NBCELLFLAG=FALSE,FREQBAND=' + n.band + ",ULEARFCNCFGIND=NOT_CFG,DLEARFCN=" + n.dl + ",ULBANDWIDTH=" + bw + ",DLBANDWIDTH=" + bw +
          ",CELLID=" + n.cellId + ",PHYCELLID=" + n.pci + ",FDDTDDIND=CELL_FDD,EUCELLSTANDBYMODE=ACTIVE,ROOTSEQUENCEIDX=" + n.rsi + ",HIGHSPEEDFLAG=LOW_SPEED,CUSTOMIZEDBANDWIDTHCFGIND=NOT_CFG,UEPOWERMAXCFGIND=CFG,UEPOWERMAX=23,MULTIRRUCELLFLAG=BOOLEAN_FALSE,TXRXMODE=" + n.txrx + ";");
      });
      news.forEach(function (n) { add("ADD EUCELLSECTOREQM:LOCALCELLID=" + n.id + ",SECTOREQMID=" + n.se + ",BASEBANDEQMID=" + n.bb + ";"); });
      news.forEach(function (n) {
        var tt = n.moran ? [M.ta0, M.taVivo] : [M.ta0, M.taTim, M.taVivo];
        tt.forEach(function (ta) { add("ADD CELLOP:LOCALCELLID=" + n.id + ",TRACKINGAREAID=" + ta + ",MMECFGNUM=CELL_MME_CFG_NUM_0;"); });
      });
      if (M.rruMods.length) {
        add("// RRU compartilhada 3G + 4G (RAT UL) — confira se a RRU não tem GSM antes do RS=UL");
        M.rruMods.forEach(function (o) { add("MOD RRU:CN=" + o.cn + ",SRN=" + o.srn + ",SN=" + o.sn + ",RS=UL;"); });
        M.rruMods.forEach(function (o) { add("MOD RRU:CN=" + o.cn + ",SRN=" + o.srn + ",SN=" + o.sn + ',RN="' + o.rn + '";'); });
      }
      news.forEach(function (n) { add("UBL CELL:LOCALCELLID=" + n.id + ";"); });
      news.forEach(function (n) { add("ACT CELL:LOCALCELLID=" + n.id + ";"); });
    }
    if (chg.length || news.length) add("// ######################## FIM DAS AMPLIAÇÕES 4G ########################");
    add("", "// Depois: EXECUTAR BASELINE (aba 7) · BALANCEAR POTÊNCIA DA RRU ENTRE PORTADORAS (aba 6)" + (fq.length ? " · redeclarar Inter-Freq/CA (aba 3)" : ""));
    return L.join("\n");
  }

  // ---------------------------------------------------------------- interface
  var css = document.createElement("style");
  css.textContent = [
    "#pane-rs4g .r4-hero{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}",
    "#pane-rs4g .r4-hero h2{margin:0 0 4px;font-size:17px}#pane-rs4g .r4-hero p{margin:0;max-width:860px}",
    "#pane-rs4g .r4-chips{display:flex;gap:6px;flex-wrap:wrap}",
    "#pane-rs4g .chip{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;background:#eef0f4;color:#475467;white-space:nowrap}",
    "#pane-rs4g .chip.ok{background:var(--c-okbg,#e3f6ea);color:var(--c-ok,#16613a)}#pane-rs4g .chip.wa{background:var(--c-warnbg,#fff3dc);color:var(--c-warn,#8a5a00)}",
    "#pane-rs4g .chip.er{background:#fdecec;color:#c7000b}#pane-rs4g .chip.in{background:#e8ecff;color:#4f63d8}",
    "#pane-rs4g .r4-grid{display:grid;grid-template-columns:minmax(300px,1fr) minmax(300px,2fr);gap:12px}",
    "#pane-rs4g .r4-two{display:grid;grid-template-columns:minmax(260px,1fr) minmax(300px,2fr);gap:12px}",
    "@media (max-width:980px){#pane-rs4g .r4-grid,#pane-rs4g .r4-two{grid-template-columns:1fr}}",
    "#pane-rs4g .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}",
    "#pane-rs4g input[type=text],#pane-rs4g input:not([type]),#pane-rs4g select{font:13px 'Segoe UI',Arial,sans-serif;padding:6px 8px;border:1px solid var(--c-border,#dfe3eb);border-radius:6px;background:#fff}",
    "#pane-rs4g textarea{width:100%;box-sizing:border-box;font:12.5px/1.4 Consolas,'Courier New',monospace;border:1px solid var(--c-border,#dfe3eb);border-radius:8px;padding:8px}",
    "#pane-rs4g #r4Read{height:150px}#pane-rs4g .r4-out{height:460px;background:#0f172a;color:#d1fae5;border-color:#0f172a}",
    "#pane-rs4g .cmd-block pre{max-height:190px;overflow:auto}",
    "#pane-rs4g table.r4t{border-collapse:collapse;width:100%;font-size:12.5px}",
    "#pane-rs4g table.r4t th{background:#f7f8fb;color:#667085;font-weight:600;text-align:left;padding:6px 8px;border-bottom:1px solid #dfe3eb;position:sticky;top:0}",
    "#pane-rs4g table.r4t td{padding:5px 8px;border-bottom:1px solid #eef0f4;vertical-align:middle}",
    "#pane-rs4g table.r4t tr.off td{opacity:.45}#pane-rs4g table.r4t td.mono{font-family:Consolas,monospace}",
    "#pane-rs4g table.r4t input{width:78px;padding:4px 6px;font:12px Consolas,monospace;border:1px solid #e3c88a;background:#fffbea;border-radius:4px}",
    "#pane-rs4g table.r4t input.w{width:120px}#pane-rs4g table.r4t select{padding:3px 4px;font-size:12px}",
    "#pane-rs4g .tw{max-height:420px;overflow:auto;border:1px solid #eef0f4;border-radius:8px}",
    "#pane-rs4g .arrow{color:#c7000b;font-weight:700}#pane-rs4g .same{color:#98a2b3}",
    "#pane-rs4g .r4-par{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px 12px}",
    "#pane-rs4g .r4-par label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#667085}",
    "#pane-rs4g .r4-par input{font:13px Consolas,monospace;padding:5px 7px;border:1px solid #e3c88a;background:#fffbea;border-radius:6px}",
    "#pane-rs4g .r4-par input.chg{border-color:#4f63d8;background:#eef0ff}",
    "#pane-rs4g .r4-msg{border-radius:8px;padding:8px 12px;margin:6px 0;font-size:13px}",
    "#pane-rs4g .r4-msg.wa{background:var(--c-warnbg,#fff3dc);color:var(--c-warn,#8a5a00)}#pane-rs4g .r4-msg.er{background:#fdecec;color:#9d0009}#pane-rs4g .r4-msg.ok{background:var(--c-okbg,#e3f6ea);color:var(--c-ok,#16613a)}",
    "#pane-rs4g .r4-msg ul{margin:4px 0 0 18px;padding:0}",
    "#pane-rs4g .r4-blk{display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 8px}#pane-rs4g .r4-blk label{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:600}",
    "#pane-rs4g .kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px 14px;margin:6px 0}",
    "#pane-rs4g .kv div{font-size:12.5px}#pane-rs4g .kv b{display:block;font-size:11px;color:#667085;font-weight:600;text-transform:uppercase;letter-spacing:.02em}",
    "#pane-rs4g .radio{display:flex;gap:10px;flex-wrap:wrap}#pane-rs4g .radio label{display:flex;gap:4px;align-items:center;font-weight:600}",
    "#pane-rs4g .need{outline:2px solid #e3a008;border-radius:6px;padding:2px 6px;background:#fff8e1}",
    "#pane-rs4g .r4-list{width:100%;margin-top:8px;font:13px/1.5 Consolas,'Courier New',monospace;border:1px solid var(--border);border-radius:6px;padding:4px;background:var(--surface);color:var(--text)}",
    "#pane-rs4g .r4-list option{padding:2px 6px;border-radius:4px;cursor:pointer}",
    "#pane-rs4g .r4-listinfo{font-size:12.5px;margin-top:4px}"
  ].join("\n");
  document.head.appendChild(css);

  pane.innerHTML =
    '<section class="card r4-hero"><div><h2>RS_4G — migrar o 4G para RAN Sharing TIM × VIVO</h2>' +
    '<p class="muted">Junta a <b>planilha MOU</b> (dados futuros), a <b>Entrada</b> (células, setores e RRUs) e a <b>leitura RS</b> do site e gera o script na ordem do roteiro: ' +
    'RAN Sharing (operadoras, TAC, MME VIVO, S1/X2, eNodeB ID, CELLOP) e ampliações (frequência/banda, nomes, novas células). Tudo que vem calculado pode ser ajustado nos campos amarelos.</p></div>' +
    '<div class="r4-chips" id="r4Chips"></div></section>' +
    '<div class="r4-grid">' +
    '<section class="card"><h2><span class="n">1</span>Planilha MOU VIVO × TIM</h2>' +
    '<p class="muted" style="margin:0 0 6px">Arquivo <i>MOU_VIVO_TIM_4G - Base de Dados</i> (.xlsb). Fica guardado neste navegador — carregue de novo quando sair versão nova.</p>' +
    '<div class="row"><input type="file" id="r4MouFile" accept=".xlsb,.xlsx,.xlsm"></div><div id="r4MouSt" class="muted" style="font-size:12.5px"></div></section>' +
    '<section class="card"><h2><span class="n">2</span>Site</h2>' +
    '<div class="row"><input id="r4Site" list="r4SiteDl" placeholder="SR-XXXXXX" autocomplete="off" style="width:160px"><datalist id="r4SiteDl"></datalist><button class="ghost" type="button" id="r4Find">Buscar na planilha</button>' +
    '<button class="ghost" type="button" id="r4UseLoaded">Usar o site da Entrada</button><span id="r4SiteSt"></span></div>' +
    '<select id="r4SiteList" class="r4-list" size="8" title="Sites da planilha MOU — clique para escolher"></select><div id="r4ListInfo" class="r4-listinfo muted"></div>' +
    '<div id="r4Plan"></div></section>' +
    '</div>' +
    '<section class="card"><h2><span class="n">3</span>Leitura RS do site</h2>' +
    '<p class="muted" style="margin:0 0 6px">O botão <b>Ler do MAE</b> primeiro carrega o site completo na aba <b>Entrada</b> (Rodada 1 + Rodada 2: células, setores e RRUs) e depois roda os comandos ao lado, que completam o que o RS precisa. Também dá para colar a resposta.</p>' +
    '<div class="r4-two"><div class="cmd-block"><pre id="r4Cmds"></pre><button class="copy-btn" type="button" id="r4CmdsCopy">Copiar</button></div>' +
    '<div><textarea id="r4Read" placeholder="Cole aqui as respostas dos comandos ao lado (ou use Ler do MAE)"></textarea>' +
    '<div class="row"><button class="primary" type="button" id="r4ReadMae">▶ Ler do MAE (Entrada + RS)</button><button class="ghost" type="button" id="r4ReadGo">Processar colado</button>' +
    '<button class="ghost" type="button" id="r4ReadClr">Limpar</button><span id="r4ReadSt" class="muted" style="font-size:12.5px"></span></div></div></div>' +
    '<div id="r4ReadSum"></div></section>' +
    '<section class="card"><h2><span class="n">4</span>Conferência site × planilha</h2><div id="r4Chk"></div></section>' +
    '<section class="card"><h2><span class="n">5</span>Células</h2><div id="r4Cells"></div><div id="r4New"></div></section>' +
    '<section class="card"><h2><span class="n">6</span>Conectividade VIVO e IDs</h2><div id="r4Par"></div></section>' +
    '<section class="card"><h2><span class="n">7</span>Script</h2>' +
    '<div class="r4-blk" id="r4Blk"></div><div id="r4Warn"></div>' +
    '<textarea id="rs4Out" class="r4-out" spellcheck="false"></textarea>' +
    '<div class="row"><button class="primary" type="button" id="rs4Copy">Copiar script</button><button class="ghost" type="button" id="r4Dl">Baixar .txt</button>' +
    '<button class="ghost" type="button" id="r4Regen">↺ Regerar</button><span id="r4OutSt" class="muted" style="font-size:12.5px"></span></div>' +
    '<p class="muted" style="font-size:12.5px;margin:6px 0 0">Comentários (<code>//</code>) não são enviados ao site. <code>#WAIT</code> é a espera do helper depois do <code>RST APP</code>. No <b>Executar no site</b>, o <code>CFM CB</code> e o <code>DSP APP</code> são vigiados (novo NAME / espera o eNodeB ficar Available). Se editar o script à mão, use <b>Regerar</b> para voltar ao calculado.</p></section>';

  $("r4Cmds").textContent = READ_CMDS.join("\n");
  $("r4CmdsCopy").addEventListener("click", function () { copyText(READ_CMDS.join("\n"), this); });

  var M = null;
  function chip(c, t) { return '<span class="chip ' + c + '">' + esc(t) + "</span>"; }
  function arrow(a, b) { return a === b || !b ? '<span class="same">' + esc(a || "—") + "</span>" : esc(a || "—") + ' <span class="arrow">→ ' + esc(b) + "</span>"; }

  // ---------------------------------------------------------------- lista de sites da planilha MOU
  var SITES = [];
  function buildSites() {
    var by = {};
    SITES = [];
    if (!MOU) return;
    MOU.rows.forEach(function (r) {
      var nm = (r.ne && r.ne !== "-") ? r.ne : r.enb, k = core(nm);
      if (!k || k === "-") return;
      var e = by[k];
      if (!e) { e = by[k] = { name: nm.toUpperCase(), uf: (r.uf || "").toUpperCase(), city: r.mun || "", status: r.status || "", ced: r.ced || "", cells: 0 }; SITES.push(e); }
      e.cells++;
    });
    SITES.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    $("r4SiteDl").innerHTML = SITES.map(function (e) { return '<option value="' + esc(e.name) + '">' + esc([e.uf, e.city, e.status].filter(Boolean).join(" · ")) + "</option>"; }).join("");
  }
  function drawList() {
    var box = $("r4SiteList"), info = $("r4ListInfo");
    if (!MOU) { box.innerHTML = ""; box.style.display = "none"; info.textContent = ""; return; }
    box.style.display = "";
    var q = core($("r4Site").value), sel = core(S.site);
    var l = q && q !== sel ? SITES.filter(function (e) { return core(e.name).indexOf(q) >= 0; }) : SITES;
    var MAX = 3000, shown = l.slice(0, MAX);
    box.innerHTML = shown.map(function (e) {
      var lbl = e.name + "   " + [e.uf, e.city, e.ced ? "cedente " + e.ced : "", e.status].filter(Boolean).join(" · ") + "   (" + e.cells + " cél.)";
      return '<option value="' + esc(e.name) + '"' + (core(e.name) === sel ? " selected" : "") + ">" + esc(lbl) + "</option>";
    }).join("");
    info.textContent = SITES.length + " sites na planilha" + (l.length !== SITES.length ? " · " + l.length + " com “" + $("r4Site").value.trim().toUpperCase() + "”" : "") +
      (l.length > MAX ? " · mostrando os " + MAX + " primeiros — digite parte do nome para filtrar" : "") + " · clique num site para abrir";
  }

  function mouStatus() {
    $("r4MouSt").innerHTML = MOU ? chip("ok", "carregada") + " " + esc(MOU.file) + " · " + MOU.rows.length + " linhas · " + Object.keys(MOU.mnc || {}).length + " UFs no MNC · " + new Date(MOU.at).toLocaleString("pt-BR")
      : chip("wa", "não carregada") + " selecione o arquivo da base";
  }

  function render() {
    S.plan = planOf(S.site);
    M = model();
    // chips do topo
    var ch = [];
    ch.push(S.site ? chip("in", S.site) : chip("wa", "sem site"));
    ch.push(MOU ? chip(M.hasPlan ? "ok" : "er", M.hasPlan ? "na planilha · " + S.plan.length + " linhas" : "fora da planilha") : chip("wa", "planilha não carregada"));
    ch.push(chip(M.sameLoaded ? "ok" : "wa", M.sameLoaded ? "Entrada OK" : "Entrada: outro site"));
    ch.push(chip(S.readText ? "ok" : "wa", S.readText ? "leitura RS " + (S.readAt || "") : "sem leitura RS"));
    if (M.rsDone) ch.push(chip("in", "RS já feito"));
    $("r4Chips").innerHTML = ch.join("");
    $("bdg-rs4g") && ($("bdg-rs4g").textContent = M.hasPlan ? "✓" : "");
    // planilha
    if (!S.site) $("r4Plan").innerHTML = '<p class="muted">Informe o site (ex.: SR-CUEC51).</p>';
    else if (!MOU) $("r4Plan").innerHTML = '<p class="muted">Carregue a planilha MOU ao lado.</p>';
    else if (!M.hasPlan) $("r4Plan").innerHTML = '<div class="r4-msg er">' + esc(S.site) + " não encontrado na planilha (procuro pelo NE e pelo EnodeB Name, sem o prefixo SR-/4G-).</div>";
    else {
      var pl = S.plan.filter(function (r) { return !isIotRow(r); }).length;
      $("r4Plan").innerHTML = '<div class="kv">' +
        [["Site físico / End_ID", M.endId], ["UF · Município", (M.uf || "—") + " · " + (M.city || "—")], ["Cedente → Tomadora", (M.ced || "—") + " → " + (M.tom || "—")], ["Status", M.status],
          ["eNodeB ID (planilha)", M.enbPlan], ["TAC LTE / NB-IoT", (M.tacPlan || "—") + " / " + (M.iotTacPlan || "—")], ["MNC TIM / VIVO", (M.mncTim || "—") + " / " + (M.mncVivo || "—")],
          ["Células", pl + " LTE + " + (S.plan.length - pl) + " NB-IoT"]].map(function (x) { return "<div><b>" + esc(x[0]) + "</b>" + esc(x[1] || "—") + "</div>"; }).join("") + "</div>";
    }
    // leitura
    var R = M.R, sum = READ_CMDS.map(function (c) { var k = ckey(c), e = R[k]; return chip(e ? (e.rows.length ? "ok" : "wa") : "er", k.replace(/^LST /, "") + (e ? " " + e.rows.length : " —")); });
    $("r4ReadSum").innerHTML = '<div class="row" style="margin-top:8px">' + sum.join(" ") + "</div>" +
      (M.cellsFrom ? '<p class="muted" style="font-size:12px;margin:2px 0 0">Células lidas de: ' + esc(M.cellsFrom) + " (" + M.cells.length + ")</p>" : "");
    renderChk(); renderCells(); renderPar(); renderBlk();
    out();
  }

  function renderChk() {
    if (!S.site) { $("r4Chk").innerHTML = ""; return; }
    var u = U(), rows = [];
    var st = function (ok, t) { return chip(ok === true ? "ok" : ok === false ? "wa" : "in", t); };
    rows.push(["Cedente / tomadora", "—", (M.ced || "—") + " → " + (M.tom || "—"), /^tim$/i.test(M.ced) ? st(true, "TIM cede") : st(false, "conferir")]);
    rows.push(["Sharing mode", M.shareMode || "—", "SHARED_FREQ", /SHARED_FREQ|shared freq/i.test(M.shareMode) ? st(true, "já está") : st(null, "MOD")]);
    rows.push(["CN Operators", M.ops.map(function (o) { return o.id + ":" + (o.name || "?") + (o.mnc ? "(" + o.mnc + ")" : ""); }).join(" · ") || "—", "0 DUMMY(99) · 2 TIM(" + (M.mncTim || "?") + ") · 3 VIVO(" + (M.mncVivo || "?") + ")", M.rsDone ? st(null, "RS já existe") : st(null, "ADD 2 e 3")]);
    rows.push(["eNodeB ID", M.enbSite || "—", M.enbPlan || "—", !M.enbPlan ? st(false, "sem planilha") : M.enbPlan === M.enbSite ? st(true, "igual") : st(null, "MOD ENODEBFUNCTION")]);
    var tacCell = function (conf, plan, site, sel, key) {
      if (!conf) return st(true, plan && site ? "igual" : (plan || site) ? "ok" : "—");
      return '<span class="radio ' + (sel ? "" : "need") + '"><label><input type="radio" name="r4' + key + '" value="plan"' + (sel === "plan" ? " checked" : "") + "> planilha " + esc(plan) + '</label><label><input type="radio" name="r4' + key + '" value="site"' + (sel === "site" ? " checked" : "") + "> site " + esc(site) + "</label></span>";
    };
    rows.push(["TAC LTE (TA " + M.ta0 + ")", M.tacSite || "—", M.tacPlan || "—", tacCell(M.tacConflict, M.tacPlan, M.tacSite, u.tacSel, "tac")]);
    if (M.iotTa || M.iotTacPlan) rows.push(["TAC NB-IoT" + (M.iotTa ? " (TA " + M.iotTa + ")" : ""), M.iotTacSite || (M.iotTa ? "—" : "sem TA IoT no site"), M.iotTacPlan || "—", M.iotTa ? tacCell(M.iotConflict, M.iotTacPlan, M.iotTacSite, u.iotSel, "iot") : st(false, "sem TA IoT")]);
    rows.push(["S1 TIM", M.s1.map(function (s) { return s.id + " (op " + (s.op || "?") + ")"; }).join(" · ") || "—", "op 2 (TIM) + S1 " + M.p.s1Id + " VIVO", M.s1.length ? st(true, "lido") : st(false, "sem LST S1")]);
    rows.push(["X2 TIM", M.x2.map(function (s) { return s.id + " (op " + (s.op || "?") + ")"; }).join(" · ") || "—", "op 2 (TIM) + X2 " + M.p.x2Id + " VIVO", M.x2.length ? st(true, "lido") : st(false, "sem LST X2")]);
    var h = '<div class="tw"><table class="r4t"><thead><tr><th>Item</th><th>Site hoje</th><th>Planilha / alvo</th><th>Situação</th></tr></thead><tbody>' +
      rows.map(function (r) { return "<tr><td><b>" + esc(r[0]) + '</b></td><td class="mono">' + esc(r[1]) + '</td><td class="mono">' + esc(r[2]) + "</td><td>" + r[3] + "</td></tr>"; }).join("") + "</tbody></table></div>";
    var msgs = M.block.map(function (x) { return '<div class="r4-msg er">' + esc(x) + "</div>"; }).join("") + (M.warn.length ? '<div class="r4-msg wa"><b>Atenção</b><ul>' + M.warn.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "");
    $("r4Chk").innerHTML = h + msgs;
    [["tac", "tacSel"], ["iot", "iotSel"]].forEach(function (x) {
      document.querySelectorAll('input[name="r4' + x[0] + '"]').forEach(function (el) { el.addEventListener("change", function () { U()[x[1]] = this.value; render(); }); });
    });
  }

  function renderCells() {
    if (!M.cells.length) { $("r4Cells").innerHTML = '<p class="muted">Nenhuma célula do site lida — processe a Entrada (rodada 1) deste site ou cole o LST CELL na leitura RS.</p>'; $("r4New").innerHTML = ""; renderNew(); return; }
    var h = '<div class="tw"><table class="r4t"><thead><tr><th></th><th>LCID</th><th>Célula no site</th><th>Nome na planilha</th><th>Banda</th><th>DL EARFCN</th><th>BW (MHz)</th><th>PCI</th><th>RS (CELLOP)</th><th>Ações</th></tr></thead><tbody>';
    M.cells.forEach(function (a) {
      var c = a.c, acts = [];
      if (a.act.indexOf("freq") >= 0) acts.push(chip("in", "freq"));
      if (a.act.indexOf("bw") >= 0) acts.push(chip("in", "banda"));
      if (a.act.indexOf("name") >= 0) acts.push(chip("in", "nome"));
      if (a.pciDiff) acts.push(chip("wa", "PCI planilha " + a.pciDiff));
      if ((a.rmvInf || []).length) acts.push(chip("wa", "RMV INTERNFREQ " + a.rmvInf.join(",")));
      if (!a.pr) acts.push(chip("wa", "fora da planilha"));
      var ta = c.nb ? (M.iotTa ? [M.iotTim, M.iotVivo] : []) : [M.taTim, M.taVivo];
      var opTxt = ta.length ? ta.map(function (t) { return t + (a.ops[t] ? "✓" : ""); }).join(" / ") : "—";
      var has = a.act.length > 0;
      h += "<tr" + (a.skip ? ' class="off"' : "") + "><td>" + (has ? '<input type="checkbox" data-skip="' + esc(c.id) + '"' + (a.skip ? "" : " checked") + ' title="incluir as ações desta célula">' : "") + "</td>" +
        '<td class="mono">' + esc(c.id) + "</td><td>" + esc(c.name) + (c.nb ? " " + chip("", "NB-IoT") : "") + "</td><td>" + (a.pr ? arrow(c.name, a.newName) : '<span class="same">—</span>') + "</td>" +
        '<td class="mono">' + esc(c.band || "—") + '</td><td class="mono">' + (c.nb ? "—" : arrow(c.dl, a.newDl)) + '</td><td class="mono">' + (c.nb ? "—" : arrow(bwMhz(c.dlbw) || c.dlbw, a.newBw)) + "</td>" +
        '<td class="mono">' + esc(c.pci || "—") + '</td><td class="mono">' + esc(opTxt) + "</td><td>" + (acts.join(" ") || '<span class="same">ok</span>') + "</td></tr>";
    });
    h += "</tbody></table></div>";
    $("r4Cells").innerHTML = h;
    $("r4Cells").querySelectorAll("[data-skip]").forEach(function (el) { el.addEventListener("change", function () { U().skip[this.getAttribute("data-skip")] = !this.checked; render(); }); });
    renderNew();
  }

  function renderNew() {
    if (!M.news.length) { $("r4New").innerHTML = M.hasPlan ? '<p class="muted" style="margin:8px 0 0">Nenhuma célula nova na planilha para este site.</p>' : ""; return; }
    var antTxt = function (a) { return a ? [a.cn, a.srn, a.sn, a.ch].join("/") : ""; };
    var h = '<h3 style="font-size:14px;margin:14px 0 6px">Novas células (planilha sem Local Cell no site)</h3>' +
      '<p class="muted" style="font-size:12.5px;margin:0 0 6px">MORAN VIVO (4R-) usa o SECTOREQM do LTE da mesma banda e entra só nos TAs DUMMY + VIVO. MOCN sobre frequência do 3G cria SECTOREQM novo no setor do 3G. Antena = CN/SRN/SN/porta.</p>' +
      '<div class="tw"><table class="r4t"><thead><tr><th></th><th>LCID</th><th>Nome</th><th>Tipo</th><th>Banda / DL / BW</th><th>PCI</th><th>SECTOREQM</th><th>Sector ID</th><th>Antena 1</th><th>Antena 2</th><th>TXRX</th><th>Root seq.</th><th>Baseband</th><th>Origem</th></tr></thead><tbody>';
    M.news.forEach(function (n) {
      var dis = n.seNew ? "" : " disabled";
      h += "<tr" + (n.skip ? ' class="off"' : "") + '><td><input type="checkbox" data-nskip="' + n.id + '"' + (n.skip ? "" : " checked") + '></td><td class="mono">' + esc(n.id) + "</td><td>" + esc(n.name) + "</td>" +
        "<td>" + (n.moran ? chip("in", "MORAN VIVO") : chip("", "MOCN")) + '</td><td class="mono">' + esc((n.band || "?") + " / " + (n.dl || "?") + " / " + (n.bw || "?") + "M") + "</td>" +
        '<td><input data-nc="pci" data-id="' + n.id + '" value="' + esc(n.pci) + '"></td>' +
        '<td><input data-nc="se" data-id="' + n.id + '" value="' + esc(n.se) + '"> <label style="font-size:11px"><input type="checkbox" data-nnew="' + n.id + '"' + (n.seNew ? " checked" : "") + ' style="width:auto"> criar</label></td>' +
        '<td><input data-nc="sector" data-id="' + n.id + '" value="' + esc(n.sector || "") + '"' + dis + "></td>" +
        '<td><input class="w" data-nc="a1" data-id="' + n.id + '" value="' + esc(antTxt(n.ants[0])) + '" placeholder="0/170/0/R0A"' + dis + "></td>" +
        '<td><input class="w" data-nc="a2" data-id="' + n.id + '" value="' + esc(antTxt(n.ants[1])) + '" placeholder="0/170/0/R0C"' + dis + "></td>" +
        '<td><select data-nc="txrx" data-id="' + n.id + '">' + ["1T1R", "1T2R", "2T2R", "2T4R", "4T4R"].map(function (x) { return "<option" + (x === n.txrx ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></td>" +
        '<td><input data-nc="rsi" data-id="' + n.id + '" value="' + esc(n.rsi) + '"></td>' +
        '<td><input data-nc="bb" data-id="' + n.id + '" value="' + esc(n.bb) + '"></td>' +
        '<td style="font-size:12px">' + esc(n.src === "lte" ? "LTE " + n.from : n.src === "umts" ? "3G " + n.from : n.note) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    if (M.rruMods.length) h += '<p class="muted" style="font-size:12.5px;margin:6px 0 0">RRUs que passam a ser 3G+4G: ' + M.rruMods.map(function (o) { return esc(o.cn + "/" + o.srn + "/" + o.sn + " → " + o.rn); }).join(" · ") + "</p>";
    $("r4New").innerHTML = h;
    var el = $("r4New");
    el.querySelectorAll("[data-nskip]").forEach(function (x) { x.addEventListener("change", function () { U().skip["n" + this.getAttribute("data-nskip")] = !this.checked; render(); }); });
    el.querySelectorAll("[data-nnew]").forEach(function (x) { x.addEventListener("change", function () { var id = this.getAttribute("data-nnew"), e = U().nc[id] || (U().nc[id] = {}); e.seNew = this.checked; render(); }); });
    el.querySelectorAll("[data-nc]").forEach(function (x) {
      x.addEventListener("change", function () {
        var id = this.getAttribute("data-id"), k = this.getAttribute("data-nc"), e = U().nc[id] || (U().nc[id] = {});
        if (k === "a1" || k === "a2") { var n = M.news.filter(function (z) { return z.id === id; })[0]; e.a1 = k === "a1" ? this.value : (e.a1 != null ? e.a1 : antTxt(n && n.ants[0])); e.a2 = k === "a2" ? this.value : (e.a2 != null ? e.a2 : antTxt(n && n.ants[1])); }
        else e[k] = this.value.trim();
        render();
      });
    });
  }

  var PAR = [["mme1", "IP MME 1 VIVO (SIGIP1V4)"], ["mme2", "IP MME 2 VIVO (SIGIP1V4)"], ["peer1", "SCTPPEER ID MME 1"], ["peer2", "SCTPPEER ID MME 2"],
    ["epgS1", "EPGROUP S1_VIVO"], ["epgX2", "EPGROUP x2_VIVO"], ["sctpS1", "SCTPHOST do S1 (mesmo da TIM)"], ["sctpX2", "SCTPHOST do X2"],
    ["upS1", "UPHOST do S1"], ["upX2", "UPHOST do X2"], ["s1Id", "S1 ID VIVO"], ["x2Id", "X2 ID VIVO"], ["aid", "APP do eNodeB (RST APP AID)"], ["wait", "1ª espera após RST APP (s)"]];
  function renderPar() {
    var u = U();
    $("r4Par").innerHTML = (M.mmeDefault ? '<div class="r4-msg wa">IPs do MME VIVO: usando o exemplo do roteiro (10.69.210.140 / 10.69.7.140). Troque pelos da regional — ficam salvos para a UF ' + esc(M.uf || "?") + ".</div>" : "") +
      '<div class="r4-par">' + PAR.map(function (x) {
        var k = x[0], chg = u.p[k] != null && String(u.p[k]).trim() !== "" && String(u.p[k]).trim() !== M.def[k];
        return "<label>" + esc(x[1]) + '<input data-par="' + k + '" value="' + esc(M.p[k]) + '"' + (chg ? ' class="chg" title="valor editado (calculado: ' + esc(M.def[k]) + ')"' : "") + "></label>";
      }).join("") + "</div>" +
      '<p class="muted" style="font-size:12px;margin:6px 0 0">SCTPHOST/UPHOST: os mesmos que o S1/X2 da TIM já usa (LST SCTPHOST2EPGRP / UPHOST2EPGRP). IDs novos só pulam se já estiverem em uso no site.</p>';
    $("r4Par").querySelectorAll("[data-par]").forEach(function (el) {
      el.addEventListener("change", function () {
        var k = this.getAttribute("data-par"), v = this.value.trim();
        U().p[k] = v;
        if ((k === "mme1" || k === "mme2") && ipOk(v)) { var st = mmeStore(), key = M.uf || "_", e = st[key] || {}; e[k === "mme1" ? "ip1" : "ip2"] = v; st[key] = e; lsSet(LS_MME, st); }
        render();
      });
    });
  }

  function renderBlk() {
    var b = M.blk;
    var items = [["cfm", "CFM CB (ponto de rollback)"], ["rs", "RAN Sharing" + (M.rsDone ? " (já feito?)" : "")], ["freq", "Frequência / banda"], ["name", "Nomes das células"], ["newc", "Novas células"]];
    $("r4Blk").innerHTML = items.map(function (x) { return '<label><input type="checkbox" data-blk="' + x[0] + '"' + (b[x[0]] ? " checked" : "") + "> " + esc(x[1]) + "</label>"; }).join("");
    $("r4Blk").querySelectorAll("[data-blk]").forEach(function (el) { el.addEventListener("change", function () { U().blk[this.getAttribute("data-blk")] = this.checked; render(); }); });
  }

  function out() {
    var txt = S.site ? script(M) : "// Informe o site na seção 2.";
    S.auto = txt;
    if (!S.dirty) $("rs4Out").value = txt;
    $("r4OutSt").textContent = S.dirty ? "script editado à mão — Regerar para atualizar" : "";
    var n = txt.split("\n").filter(function (l) { l = l.trim(); return l && !/^\/\//.test(l); }).length;
    $("r4Warn").innerHTML = (M && M.blk.rs && M.block.length ? '<div class="r4-msg er"><b>RAN Sharing bloqueado:</b><ul>' + M.block.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
      '<div class="muted" style="font-size:12.5px">' + n + " linha(s) de comando.</div>";
  }
  $("rs4Out").addEventListener("input", function () { S.dirty = this.value !== S.auto; $("r4OutSt").textContent = S.dirty ? "script editado à mão — Regerar para atualizar" : ""; });
  $("r4Regen").addEventListener("click", function () { S.dirty = false; render(); });
  $("rs4Copy").addEventListener("click", function () { copyText($("rs4Out").value, this); });
  $("r4Dl").addEventListener("click", function () {
    var a = document.createElement("a"), b = new Blob([$("rs4Out").value.replace(/\n/g, "\r\n")], { type: "text/plain" });
    a.href = URL.createObjectURL(b); a.download = "RS_4G_" + (S.site || "site") + ".txt"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  });

  // ---------------------------------------------------------------- site / leitura
  function setSite(n, keepRead) {
    n = String(n || "").trim().toUpperCase();
    if (core(n) !== core(S.site)) { S.dirty = false; }
    S.site = n; $("r4Site").value = n;
    if (!keepRead) {
      var st = lsGet(LS_READ + core(n), null);
      S.readText = st ? st.t : ""; S.readAt = st ? st.at : "";
      $("r4Read").value = S.readText;
      $("r4ReadSt").textContent = st ? "leitura salva de " + st.at : "";
    }
    $("r4SiteSt").innerHTML = "";
    drawList();
    render();
  }
  function saveRead() { if (S.site) lsSet(LS_READ + core(S.site), { t: S.readText, at: S.readAt }); }
  $("r4Find").addEventListener("click", function () { setSite($("r4Site").value); });
  $("r4Site").addEventListener("keydown", function (e) { if (e.key === "Enter") setSite(this.value); });
  var lt; $("r4Site").addEventListener("input", function () {
    var v = this.value; clearTimeout(lt);
    if (SITES.some(function (e) { return e.name === v.trim().toUpperCase(); })) { setSite(v); return; }   // escolhido na sugestão
    lt = setTimeout(drawList, 200);
  });
  $("r4SiteList").addEventListener("change", function () { if (this.value) setSite(this.value); });
  $("r4UseLoaded").addEventListener("click", function () { var n = loadedSite(); if (n) setSite(n); else $("r4SiteSt").innerHTML = chip("wa", "nenhum site carregado na Entrada"); });
  $("r4ReadGo").addEventListener("click", function () { S.readText = $("r4Read").value; S.readAt = now(); saveRead(); $("r4ReadSt").textContent = "processado " + S.readAt; render(); });
  $("r4ReadClr").addEventListener("click", function () { $("r4Read").value = ""; S.readText = ""; S.readAt = ""; saveRead(); $("r4ReadSt").textContent = ""; render(); });

  function call(path, body) {
    return fetch(HELPER + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: { error: "resposta inválida do helper" } }; });
    }, function () { throw new Error("helper offline — abra a aba Entrada e inicie o helper"); });
  }
  $("r4ReadMae").addEventListener("click", async function () {
    var btn = this, st = $("r4ReadSt"), ne = S.site || loadedSite();
    if (!ne) { st.textContent = "Informe o site."; return; }
    if (!window.MAE) { st.textContent = "Painel do MAE não carregado."; return; }
    var s = window.MAE.state();
    if (!s.online || !s.logged) { st.textContent = "Conecte no MAE (aba Entrada → Executar no MAE)."; return; }
    if (s.busy) { st.textContent = "O painel do MAE está ocupado — tente em instantes."; return; }
    btn.disabled = true;
    var entMsg = "";
    // 1) carrega o site completo na aba Entrada (Rodada 1 + Rodada 2), como o "Confirmar" do painel do MAE
    if (window.MAE.loadSite) {
      st.textContent = "carregando " + ne + " na aba Entrada (Rodada 1 + Rodada 2)…";
      var le = await window.MAE.loadSite(ne, true).catch(function (e) { return { ok: false, error: e.message }; });
      entMsg = le && le.ok ? "Entrada carregada · " : "⚠ Entrada: " + ((le && le.error) || "falhou") + " · ";
      if (le && le.ne) ne = le.ne;
      for (var w = 0; window.MAE.state().busy && w < 40; w++) await new Promise(function (r) { setTimeout(r, 250); });
    }
    // 2) comandos extras do RS
    st.textContent = entMsg + "lendo " + ne + " (" + READ_CMDS.length + " comandos RS)…";
    window.MAE.setBusy(true);
    try {
      var r = await call("/run", { ne: ne, cmds: READ_CMDS });
      if (r.status !== 200 || !Array.isArray(r.j)) throw new Error((r.j && (r.j.message || r.j.error)) || ("erro HTTP " + r.status));
      if (r.j[0] && /^REG NE/i.test(r.j[0].cmd || "") && !r.j[0].ok) throw new Error("REG NE falhou para " + ne);
      var txt = r.j.filter(function (y) { return !/^(REG|UNREG) NE/i.test(y.cmd || ""); }).map(function (y) { return "%%/*0*/" + (y.cmd || "") + "%%\n" + (y.resp || ""); }).join("\n");
      $("r4Read").value = txt; S.readText = txt; S.readAt = now(); saveRead();
      if (core(ne) !== core(S.site)) S.site = ne.toUpperCase();
      st.textContent = entMsg + "RS lido do MAE " + S.readAt; drawList(); render();
    } catch (e) { st.textContent = entMsg + "✖ " + e.message; }
    finally { await call("/unreg", {}).catch(function () {}); window.MAE.setBusy(false); btn.disabled = false; }
  });

  $("r4MouFile").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    $("r4MouSt").innerHTML = chip("in", "lendo…") + " " + esc(f.name) + " (pode levar alguns segundos)";
    var inp = this;
    f.arrayBuffer().then(function (ab) {
      return new Promise(function (res) { setTimeout(res, 30); }).then(function () { return parseMou(ab, f.name); });
    }).then(function (m) {
      MOU = m; indexMou(); buildSites(); drawList(); mouStatus(); render();
      window.dispatchEvent(new Event("rs4g:mou"));
      return idbSet("mou", m).catch(function () { $("r4MouSt").innerHTML += " " + chip("wa", "não consegui guardar no navegador — carregue de novo na próxima vez"); });
    }).catch(function (e) { $("r4MouSt").innerHTML = chip("er", "erro") + " " + esc(e.message); })
      .then(function () { inp.value = ""; });
  });

  // acompanha o site carregado na Entrada
  var lastLoaded = "";
  function onLoaded() {
    var n = loadedSite(); if (!n || n === lastLoaded) return;
    var follow = !S.site || core(S.site) === core(lastLoaded);
    lastLoaded = n;
    if (follow) setSite(n); else render();
  }
  if ($("neLbl") && window.MutationObserver) new MutationObserver(function () { setTimeout(onLoaded, 120); }).observe($("neLbl"), { childList: true, characterData: true, subtree: true });

  // ---------------------------------------------------------------- API
  window.RS4G = {
    onShow: function () { if (!S.site && loadedSite()) setSite(loadedSite()); else render(); },
    ready: function () { return !!MOU; },
    siteInfo: function (name) {
      var P = planOf(name); if (!P.length) return null;
      var uf = (P[0].uf || "").toUpperCase(), mn = (MOU.mnc || {})[uf] || {};
      return { endId: most(P.map(function (r) { return r.endId; })) || most(P.map(function (r) { return r.sf; })), sf: most(P.map(function (r) { return r.sf; })), uf: uf, city: P[0].mun || "",
        mncTim: mn.tim || "", mncVivo: mn.vivo || "", enb: int(most(P.map(function (r) { return r.enbId; }))), tac: int(most(P.filter(function (r) { return !isIotRow(r); }).map(function (r) { return r.tac; }))) };
    },
    _t: { parseMou: parseMou, readAll: readAll, model: function () { return model(); }, script: function () { return script(model()); }, state: S }
  };

  mouStatus(); drawList(); render();
  idbGet("mou").then(function (m) {
    if (m && m.rows) { MOU = m; indexMou(); buildSites(); drawList(); mouStatus(); render(); window.dispatchEvent(new Event("rs4g:mou")); }
  }).catch(function () {});
  if (loadedSite()) onLoaded();
})();
