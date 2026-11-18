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

  // ================================================================ ETAPA 0 — TX VIVO (configuração e teste de transmissão)
  // Planilha "HUAWEI - Teste de TX RANSHARING": aba 1 = MME/SGW VIVO por grupo de sites/cidades; aba 2 = roteiro
  // (VLANMAP → DEVIP serviço + loopback S1/X2 → SCTPHOST S1/X2 → USERPLANEHOST → IPRT para o core → PING).
  var TX_READ = ["LST DEVIP:;", "LST VLANMAP:;", "LST IPRT:;", "LST SCTPHOST:;", "LST USERPLANEHOST:;", "LST OMCH:;",
    "LST SCTPHOST2EPGRP:;", "LST UPHOST2EPGRP:;", "LST SCTPPEER:;", "LST S1:;", "LST X2:;"];
  var LS_TXGW = "rs4g.txgw.v1", LS_TXR = "rs4g.txread.", LS_TXP = "rs4g.txp.", LS_TXPING = "rs4g.txping.";
  var TX_GW_DEF = { file: "padrão: HUAWEI - Teste de TX RANSHARING (nov/2026)", at: 0, g: [{"gw":[["MME_1","10.69.210.140"],["MME_2","10.69.7.140"],["SGW_1","177.160.2.0"],["SGW_2","152.255.1.64"],["SGW_3","152.255.3.128"],["SGW_4","152.255.4.0"]],"s":[["SR-HBHBJ0","AL","TNE","Agua Branca"],["SR-CTNOJ2","AL","TNE","Coite Do Noia"],["SR-NLNLJ0","AL","TNE","Novo Lino"],["SR-QGQGJ1","AL","TNE","Quebrangulo"]]},{"gw":[["MME_1","10.69.7.140"],["MME_2","10.69.210.140"],["SGW_1","152.255.3.128"],["SGW_2","152.255.1.64"],["SGW_3","152.255.4.0"]],"s":[["BA5201","BA","TNE","Valente"],["18NLCIIT01","BA","TNE","Coaraci"]]},{"gw":[["MME_1","10.69.210.140"],["MME_2","10.69.7.140"],["SGW_1","152.255.1.64"],["SGW_2","152.255.3.128"],["SGW_3","152.255.3.128"],["SGW_4","152.255.4.0"]],"s":[["SR-WTWTJ0","CE","TNE","Aratuba"],["SR-WTWTJ1","CE","TNE","Aratuba"],["SR-IXIXJ1","CE","TNE","Iraucuba"],["SR-RRRRJ2","PI","TNE","Piracuruca"]]},{"gw":[["MME_1","10.62.88.12"],["MME_2","10.149.2.140"],["SGW_1","177.160.1.224"],["SGW_2","152.255.4.0"],["SGW_3","152.255.3.192"]],"s":[["NLCNOG01","GO","TCO","Campinorte"],["4G-ABIG01","GO","TCO","Abadiania"],["4G-ABIG02","GO","TCO","Abadiania"],["4G-CNOG02","GO","TCO","Campinorte"],["NLCZKG01","GO","TCO","Cezarina"],["4G-CZKG03","GO","TCO","Cezarina"],["4G-PNNG01","GO","TCO","Pontalina"],["SR-OI6542","TO","TCO","Miranorte"],["SN-MRRTJ2","TO","TCO","Miranorte"],["SR-OI6582","TO","TCO","Miranorte"],["SR-OI6541","TO","TCO","Miranorte"],["SN-MRRTJ3","TO","TCO","Miranorte"]]},{"gw":[["MME_1","10.149.2.140"],["MME_2","10.62.88.12"],["SGW_1","177.160.1.240"],["SGW_2","152.255.4.0"],["SGW_3","152.255.3.192"]],"s":[["4G-AVBH60","MG","TLE","Alvinopolis"],["4G-AVBH65","MG","TLE","Alvinopolis"],["NLKJCN01","MG","TLE","Caputira"],["4G-CSVG72","MG","TLE","Cassia"],["NLKZCN01","MG","TLE","Cruzeiro Da Fortaleza"],["NLFLOR01","MG","TLE","Florestal"],["NLMMUR28","MG","TLE","Monte Alegre De Minas"],["NLMMCT01","MG","TLE","Monte Alegre De Minas"],["18NLSPMC26","MG","TLE","Sao Joao Da Ponte"],["4G-SPMC27","MG","TLE","Sao Joao Da Ponte"],["4G-ZSCT01","MG","TLE","Alfredo Vasconcelos"],["4G-APJF83","MG","TLE","Alfredo Vasconcelos"],["4G-GRVG74","MG","TLE","Guaranesia"],["4G-XRCT01","MG","TLE","Sao Joao Do Paraiso"]]},{"gw":[["MME_1","10.63.12.204"],["MME_2","10.58.85.12"],["SGW_1","152.255.4.0"],["SGW_2","152.255.12.192"],["SGW_3","152.255.4.0"]],"s":[]},{"gw":[["MME_1","10.141.5.140"],["MME_2","10.89.225.140"],["SGW_1","177.160.3.96"],["SGW_2","177.79.244.64"],["SGW_3","152.255.1.128"]],"s":[["18NLAACE51","PR","TSL","Altonia"],["SR-AACE02","PR","TSL","Altonia"],["18NLAVMO01","PR","TSL","Alvorada Do Sul"],["SR-CFLL51","PR","TSL","Cafelandia"],["SR-CFLL02","PR","TSL","Cafelandia"],["SR-KFMO01","PR","TSL","California"],["SR-CQMO51","PR","TSL","Cidade Gaucha"],["SR-KLRB01","PR","TSL","Colorado"],["SR-CBJA51","PR","TSL","Corbelia"],["SR-CUEC03","PR","TSL","Cruzeiro Do Oeste"],["SR-CUEC06","PR","TSL","Cruzeiro Do Oeste"],["SR-EBMR01","PR","TSL","Engenheiro Beltrao"],["NLEPNO01","PR","TSL","Esperanca Nova"],["18NLICCE51","PR","TSL","Icaraima"],["NLIAJA01","PR","TSL","Inaja"],["SR-IPPA51","PR","TSL","Ipora"],["18NLIPPA02","PR","TSL","Ipora"],["NLIASL01","PR","TSL","Itauna Do Sul"],["SR-JGCE01","PR","TSL","Jaguapita"],["SR-JECE51","PR","TSL","Jesuitas"],["SR-LOAG51","PR","TSL","Loanda"],["SR-LOAG02","PR","TSL","Loanda"],["18NLMMAC01","PR","TSL","Mambore"],["SR-MWMO01","PR","TSL","Marilandia Do Sul"],["18NLMIRD01","PR","TSL","Mirador"],["SR-NELC01","PR","TSL","Nova Esperanca"],["SR-NELS01","PR","TSL","Nova Esperanca"],["SR-NELT16","PR","TSL","Nova Esperanca"],["18NLNOLA01","PR","TSL","Nova Laranjeiras"],["NLNOCE10","PR","TSL","Nova Olimpia"],["NLPWCE01","PR","TSL","Pien"],["SR-PSCE01","PR","TSL","Pirai Do Sul"],["18NLPCCE01","PR","TSL","Porecatu"],["SR-RECE10","PR","TSL","Reboucas"],["SR-RNCR01","PR","TSL","Rondon"],["SR-ISCE01","PR","TSL","Santa Isabel Do Ivai"],["SR-SPCT01","PR","TSL","Sertanopolis"],["18NLSKCE02","PR","TSL","Siqueira Campos"],["SR-TWCE01","PR","TSL","Terra Boa"],["SR-TWCE02","PR","TSL","Terra Boa"],["SR-TWRU01","PR","TSL","Terra Boa"],["18NLTRAG51","PR","TSL","Terra Roxa"],["SR-TJLL02","PR","TSL","Tijucas Do Sul"],["18NLURCO01","PR","TSL","Urai"],["SR-AACE03","PR","TSL","Altonia"],["SR-AYCE01","PR","TSL","Assai"],["SR-AYCE02","PR","TSL","Assai"],["NLATLA01","PR","TSL","Atalaia"],["SR-BNCE01","PR","TSL","Balsa Nova"],["SR-BNLL01","PR","TSL","Balsa Nova"],["SR-CFLL03","PR","TSL","Cafelandia"],["SR-KFCE01","PR","TSL","California"],["SR-KYCE01","PR","TSL","Candoi"],["SR-CJCE51","PR","TSL","Chopinzinho"],["SR-CQMO03","PR","TSL","Cidade Gaucha"],["SR-KLRB79","PR","TSL","Colorado"],["SR-CUEC51","PR","TSL","Cruzeiro Do Oeste"],["SR-DINO02","PR","TSL","Diamante Do Norte"],["18NLFORM01","PR","TSL","Formosa Do Oeste"],["SR-GKCE01","PR","TSL","Guaraquecaba"],["SR-IPPA52","PR","TSL","Ipora"],["SR-JGCE32","PR","TSL","Jaguapita"],["SR-JECE33","PR","TSL","Jesuitas"],["SR-JNCE01","PR","TSL","Juranda"],["SR-JNLL01","PR","TSL","Juranda"],["SR-MMAC72","PR","TSL","Mambore"],["SR-NAGO51","PR","TSL","Nova Aurora"],["SR-PWTR01","PR","TSL","Pien"],["SR-PSCE02","PR","TSL","Pirai Do Sul"],["SR-QTCE01","PR","TSL","Quitandinha"],["SR-STAM01","PR","TSL","Santa Monica"],["SR-STTO51","PR","TSL","Santa Terezinha De Itaipu"],["SR-STTO02","PR","TSL","Santa Terezinha De Itaipu"],["SR-SRTJ02","PR","TSL","Sertaneja"],["SR-SRTJ03","PR","TSL","Sertaneja"],["SR-SKCE01","PR","TSL","Siqueira Campos"],["SR-TSCT01","PR","TSL","Teixeira Soares"],["SR-TJMO01","PR","TSL","Tijucas Do Sul"],["SR-URKI01","PR","TSL","Urai"],["SR-CXMO02","PR","TSL","Centenario do Sul"],["SR-KGMO03","PR","TSL","Cantagalo"]]},{"gw":[["MME_1","10.69.210.140"],["MME_2","10.69.7.140"],["SGW_1","152.255.1.64"],["SGW_2","152.255.3.128"],["SGW_3","152.255.4.0"]],"s":[["SR-JDJDJ1","RN","TNE","Jardim De Piranhas"],["SR-RICHJ0","RN","TNE","Riachuelo"],["SR-JDJDJ0","RN","TNE","Jardim De Piranhas"],["SR-MKMKJ1","RN","TNE","Macau"],["SR-MKMKJ2","RN","TNE","Macau"]]},{"gw":[["MME_1","10.62.88.12"],["MME_2","10.149.2.140"],["SGW_1","152.255.3.0"],["SGW_2","152.255.4.0"],["SGW_3","152.255.1.128"]],"s":[]},{"gw":[["MME_1","10.89.225.140"],["MME_2","10.141.5.140"],["SGW_1","152.255.1.0"],["SGW_2","177.79.244.64"],["SGW_3","152.255.1.128"]],"s":[["SR-CPTE02","RS","TSL","Campestre Da Serra"],["SR-CPTO01","RS","TSL","Campestre Da Serra"],["SR-CMVR01","RS","TSL","Campo Novo"],["SR-MTXR01","RS","TSL","Mata"],["NLSTWR01","RS","TSL","Sertao"],["SR-STWO01","RS","TSL","Sertao"],["SR-VINV01","RS","TSL","Vila Nova Do Sul"],["SR-VINO01","RS","TSL","Vila Nova Do Sul"]]},{"gw":[["MME_1","10.141.5.140"],["MME_2","10.89.225.140"],["SGW_1","152.255.2.224"],["SGW_2","152.255.1.128"]],"s":[["SR-PHPO01","SC","TSL","Pinheiro Preto"],["SR-RQCE01","SC","TSL","Rancho Queimado"],["18NLKUMO01","SC","TSL","Cunha Pora"],["SR-KULS01","SC","TSL","Cunha Pora"],["SR-JMCE01","SC","TSL","Jacinto Machado"],["SR-PARO10","SC","TSL","Ponte Alta"],["SR-VGCE01","SC","TSL","Vargem Bonita"]]},{"gw":[["MME_1","10.105.39.12"],["MME_2","10.105.53.12"],["SGW_1","177.160.1.208"],["SGW_2","177.79.240.65"],["SGW_3","200.142.134.54"],["SGW_4","152.255.1.128"],["SGW_5","177.79.244.64"]],"s":[["18NLOURD01","SP","TSP","Canitar"],["18NLXGCT01","SP","TSP","Gabriel Monteiro"],["18NLGFCT01","SP","TSP","Guapiacu"],["18NLGFRD01","SP","TSP","Guapiacu"],["18NLJJCD01","SP","TSP","Jaci"],["18NLNKCT01","SP","TSP","Mendonca"],["4G-AZCT01","SP","TSP","Monte Azul Paulista"],["18NLNUCT01","SP","TSP","Nuporanga"],["NLEZCT02","SP","TSP","Pereiras"],["18NLPYRD03","SP","TSP","Porangaba"],["18NLPYCT01","SP","TSP","Porangaba"],["18NLZRCT01","SP","TSP","Rubineia"],["18NLZUCT01","SP","TSP","Serra Azul"],["18NLTHCT01","SP","TSP","Tambau"],["4G-BHNB01","SP","TSP","Barrinha"],["18NLLKCT01","SP","TSP","Bilac"],["18NLBECT01","SP","TSP","Bofete"],["4G-MPRD01","SP","TSP","Monte Aprazivel"],["4G-NUCT12","SP","TSP","Nuporanga"],["4G-PKRD01","SP","TSP","Palmares Paulista"],["18NLVNCT01","SP","TSP","Presidente Alves"],["4G-ZUCT02","SP","TSP","Serra Azul"],["4G-THCT02","SP","TSP","Tambau"],["4G-TXCT01","SP","TSP","Teodoro Sampaio"],["4G-TXCT02","SP","TSP","Teodoro Sampaio"],["4G-LUSCT01","SP","TSP","Urupes"]]},{"gw":[["MME_1","10.105.6.12"],["MME_2","10.105.227.12"],["SGW_1","177.160.1.208"],["SGW_2","177.79.240.65"],["SGW_3","200.142.134.54"],["SGW_4","152.255.1.128"],["SGW_5","177.79.244.64"]],"s":[["4G-RQCT01","SP","TSP","Pariquera-Acu"]]}] };
  var TX_LABELS = ["LTE SERVICE_TIM", "LTE S1/X2_TIM", "OMCH", "GSM", "UMTS", "5G SA_NSA_INFRA IP", "5G SA_NSA CP/UP", "LTE SERVICE_INFRA_VIVO", "LTE S1/X2_VIVO"];
  var TXGW = lsGet(LS_TXGW, null) || TX_GW_DEF;
  var ENG = null;                                    // ENG-SI carregada: { file, at, sheets: [{ name, rows }] } (IndexedDB "engsi")
  S.txRead = ""; S.txReadAt = ""; S.txDirty = false; S.txAuto = "";

  // ---------- IP ----------
  function ip2n(s) { var p = String(s).split("."); return (((+p[0]) << 24) >>> 0) + ((+p[1]) << 16) + ((+p[2]) << 8) + (+p[3]); }
  function n2ip(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."); }
  function maskBits(m) {
    m = String(m == null ? "" : m).trim();
    if (/^\/?\d{1,2}$/.test(m)) { var b0 = +m.replace("/", ""); return b0 <= 32 ? b0 : -1; }
    if (!ipOk(m)) return -1;
    var n = ip2n(m), b = 0; while (b < 32 && ((n >>> (31 - b)) & 1)) b++;
    return ((b ? (0xFFFFFFFF << (32 - b)) >>> 0 : 0) === n) ? b : -1;
  }
  function bits2mask(b) { return n2ip(b ? (0xFFFFFFFF << (32 - b)) >>> 0 : 0); }
  function netOf(ip, b) { return b ? (ip2n(ip) & ((0xFFFFFFFF << (32 - b)) >>> 0)) >>> 0 : 0; }
  function overlap(a, ab, b, bb) { var m = Math.min(ab, bb); return m >= 0 && netOf(a, m) === netOf(b, m); }
  function inNet(ip, net, b) { return ipOk(ip) && ipOk(net) && b >= 0 && netOf(ip, b) === netOf(net, b); }
  function ipsIn(row) { var o = []; Object.keys(row || {}).forEach(function (k) { var v = sv(row[k]); if (ipOk(v) && o.indexOf(v) < 0) o.push(v); }); return o; }
  function ptCode(t) { return /ethernet\s*port/i.test(t) ? "ETH" : /loopback/i.test(t) ? "LOOPINT" : /trunk/i.test(t) ? "ETHTRK" : ""; }
  function sbtCode(t) { return /base\s*board/i.test(t) ? "BASE_BOARD" : ""; }
  function loc(d) { return (d && ((d.cn && d.cn !== "0") || (d.srn && d.srn !== "0"))) ? "CN=" + d.cn + ",SRN=" + d.srn + "," : ""; }

  // ---------- PING (respostas do MAE) — também usado pelo mae_exec.js ----------
  function pingParse(resp) {
    var t = normText(resp), m, r = { known: false, ok: false, sent: null, recv: null, loss: null, avg: null, msg: "" };
    var rc = /RETCODE\s*=\s*(\d+)\s*([^\n]*)/.exec(t);
    if ((m = /(\d+)\s*packet\(?s?\)?\s*transmitted/i.exec(t)) || (m = /sent\s*(?:packets?)?\s*(?:number)?\s*[=:]\s*(\d+)/i.exec(t))) r.sent = +m[1];
    if ((m = /(\d+)\s*packet\(?s?\)?\s*received/i.exec(t)) || (m = /received\s*(?:packets?)?\s*(?:number)?\s*[=:]\s*(\d+)/i.exec(t))) r.recv = +m[1];
    if ((m = /percent\s*(\d+(?:\.\d+)?)\s*%?\s*packets?\s*los[st]/i.exec(t)) || (m = /(\d+(?:\.\d+)?)\s*%\s*(?:packet\s*)?loss/i.exec(t)) || (m = /loss[^\d\n]{0,25}?(\d+(?:\.\d+)?)\s*%/i.exec(t)) || (m = /los[st]\s*(?:ratio|rate)[^\d\n]*?(\d+(?:\.\d+)?)/i.exec(t))) r.loss = +m[1];
    if ((m = /min\/avg\/max\s*=\s*[\d.]+\/([\d.]+)\//i.exec(t)) || (m = /average[^\d\n]{0,20}([\d.]+)/i.exec(t))) r.avg = +m[1];
    if (r.sent == null || r.recv == null) {                       // tabela "Sent  Received  Loss"
      parseBody(t).forEach(function (row) {
        var s = g(row, "Sent Packet", "Sent"), v = g(row, "Received Packet", "Received"), l = g(row, "Loss", "Lost");
        if (r.sent == null && /^\d+$/.test(s)) r.sent = +s;
        if (r.recv == null && /^\d+$/.test(v)) r.recv = +v;
        if (r.loss == null && /^\d+(\.\d+)?%?$/.test(l)) r.loss = parseFloat(l);
      });
    }
    var L = t.split("\n");
    var replies = L.filter(function (l) { return /reply from|bytes\s*=\s*\d+.*(time|ttl)/i.test(l); }).length;
    var tos = L.filter(function (l) { return /request time ?out|timed out|unreachable/i.test(l); }).length;
    if (r.recv == null && r.sent != null && r.loss != null) r.recv = Math.round(r.sent * (100 - r.loss) / 100);
    if (r.recv == null && (replies || tos)) { r.recv = replies; if (r.sent == null) r.sent = replies + tos; }
    if (r.loss == null && r.sent) r.loss = Math.round((r.sent - r.recv) * 1000 / r.sent) / 10;
    // fim do teste: estatística ou "N reports in total" (o MAE manda um relatório por resposta)
    r.done = /ping statistics|packet\(?s?\)?\s*transmitted|reports? in total|sent\s*packets?\s*[=:]/i.test(t);
    r.known = r.recv != null && r.done;
    if (rc && rc[1] !== "0") { r.known = true; r.ok = false; r.msg = "NOK · " + rc[1] + " " + rc[2].trim(); return r; }
    if (/\[TIMEOUT/.test(t)) { r.known = r.known || false; }
    if (!r.known) { r.msg = "resultado do PING não reconhecido — veja a resposta no log"; return r; }
    r.ok = r.recv > 0;
    r.msg = (r.ok ? "OK" : "NOK") + " · " + r.recv + "/" + (r.sent != null ? r.sent : "?") + " recebidos" + (r.loss != null ? " · perda " + r.loss + "%" : "") + (r.avg != null ? " · média " + r.avg + " ms" : "");
    return r;
  }
  function pingBlocks(text) {                                     // PINGs colados na leitura TX
    var t = normText(text), re = /%%(?:\/\*\d+\*\/)?\s*(PING\s*:[^%\n]*?;?)\s*%%/gi, m, idx = [], out = {};
    while ((m = re.exec(t))) idx.push({ at: m.index, end: re.lastIndex, cmd: m[1] });
    idx.forEach(function (b, i) {
      var dst = (/DSTIP\s*=\s*"?([\d.]+)/i.exec(b.cmd) || [])[1]; if (!dst) return;
      var nx = t.slice(b.end).search(/%%(?:\/\*\d+\*\/)?\s*[A-Z]{2,4}[\s:]/i);
      var body = i + 1 < idx.length ? t.slice(b.end, idx[i + 1].at) : nx >= 0 ? t.slice(b.end, b.end + nx) : t.slice(b.end);
      var r = pingParse(body); if (r.known) out[dst] = { ok: r.ok, msg: r.msg, at: "colado" };
    });
    return out;
  }

  // ---------- base de gateways (MME/SGW VIVO por grupo de sites) ----------
  function gwLabel(i) {
    var G = TXGW.g[i]; if (!G) return "";
    var ufs = most((G.s || []).map(function (s) { return s[1]; })), cities = [];
    (G.s || []).forEach(function (s) { if (s[3] && cities.indexOf(s[3]) < 0) cities.push(s[3]); });
    var u = []; (G.s || []).forEach(function (s) { if (s[1] && u.indexOf(s[1]) < 0) u.push(s[1]); });
    return "G" + (i + 1) + " · " + (u.join("/") || "sem sites") + (cities.length ? " · " + cities.slice(0, 3).join(", ") + (cities.length > 3 ? " +" + (cities.length - 3) : "") : "") +
      " · MME " + G.gw.filter(function (x) { return /^MME/i.test(x[0]); }).map(function (x) { return x[1]; }).join(" / ");
  }
  function gwFind(site, city, uf) {
    var k = core(site), i, j;
    if (k) for (i = 0; i < TXGW.g.length; i++) for (j = 0; j < (TXGW.g[i].s || []).length; j++) if (core(TXGW.g[i].s[j][0]) === k) return { i: i, why: "site " + TXGW.g[i].s[j][0] + " está na planilha", uf: TXGW.g[i].s[j][1], city: TXGW.g[i].s[j][3] };
    var c = nk(city), u = String(uf || "").toUpperCase();
    if (c) for (i = 0; i < TXGW.g.length; i++) if ((TXGW.g[i].s || []).some(function (s) { return nk(s[3]) === c && (!u || s[1] === u); })) return { i: i, why: "município " + city + (u ? "/" + u : "") };
    if (u) {
      var hit = []; TXGW.g.forEach(function (G, x) { var n = (G.s || []).filter(function (s) { return s[1] === u; }).length; if (n) hit.push({ i: x, n: n }); });
      if (hit.length === 1) return { i: hit[0].i, why: "UF " + u };
      if (hit.length > 1) { hit.sort(function (a, b) { return b.n - a.n; }); return { i: hit[0].i, why: "UF " + u + " (tem " + hit.length + " grupos — CONFIRA)", amb: true }; }
    }
    return null;
  }
  function parseGwBook(ab, fname) {
    if (!window.XLSX) throw new Error("A biblioteca de planilhas (XLSX) não carregou.");
    var wb = XLSX.read(new Uint8Array(ab), { type: "array" }), sh = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: null }), G = [], cur = null, I = null;
    rows.forEach(function (r) {
      r = r || [];
      var gw = []; r.forEach(function (c) { var m = /^\s*((?:MME|SGW)[_ ]?\d*)[\s ]*\(\s*([\d.]+)\s*\)/i.exec(sv(c)); if (m && ipOk(m[2])) gw.push([m[1].toUpperCase().replace(" ", "_"), m[2]]); });
      if (gw.length) {
        cur = { gw: gw, s: [] }; G.push(cur);
        var h = r.map(nk); I = { site: h.indexOf("elementoid"), uf: h.indexOf("uf"), reg: h.indexOf("regional"), city: h.indexOf("municipio") };
        return;
      }
      if (!cur || !I || I.site < 0) return;
      var st = sv(r[I.site]); if (!st || st === "-") return;
      cur.s.push([st.toUpperCase(), I.uf >= 0 ? sv(r[I.uf]).toUpperCase() : "", I.reg >= 0 ? sv(r[I.reg]) : "", I.city >= 0 ? sv(r[I.city]) : ""]);
    });
    if (!G.length) throw new Error("Nenhum cabeçalho com MME_1 (ip) / SGW_1 (ip) encontrado na 1ª aba.");
    return { file: fname, at: Date.now(), g: G };
  }

  // ---------- ENG-SI (IPs VIVO) ----------
  function t0(v) { return v == null ? "" : String(v).trim(); }
  function colL(c) { var s = ""; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
  function nt(h) { return t0(h).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " "); }
  // h = cabeçalho da coluna; ctx = cabeçalho de grupo acima (ex.: "Service (S1/X2)", "INFRA") — ENG-SI tem 2 níveis
  function fieldOf(h, ctx) {
    var t = nt(h), c = nt(ctx);
    if (!t || t.length > 60 || /^[\d.\/\s]+$/.test(t)) return null;
    var all = (t + " " + c).trim();
    var op = /vivo/.test(t) ? "VIVO" : /(^|[^a-z])tim([^a-z]|$)/.test(t) ? "TIM" : /vivo/.test(c) ? "VIVO" : /(^|[^a-z])tim([^a-z]|$)/.test(c) ? "TIM" : "";
    if (/^infra (tim|vivo)$/.test(t)) return { f: "vlan", op: op };                 // "Infra Tim"/"Infra Vivo" = VLAN (PROJETO LÓGICO AUTOMÁTICO)
    if (/(^|[^a-z])(rede|network)([^a-z]|$)/.test(t) && !/mascara|mask/.test(t)) return null;   // endereço de rede: não serve
    function cls(x) {
      return /vlan/.test(x) ? "vlan" : /gateway|(^|[^a-z])d?gw([^a-z]|$)|(^|[^a-z])gat\.?([^a-z]|$)|next ?hop|proximo salto/.test(x) ? "gw" :
        /mascara|(^|[^a-z])mask|netmask|prefixo/.test(x) ? "mask" : /s1 ?[\/&-]? ?x2|loopback|sinalizacao/.test(x) ? "s1x2" :
        /(^|[^a-z])oam([^a-z]|$)|omch|gerencia/.test(x) ? "oam" : /infra|ip (do )?site|interface|servico|ip lte|ip eth/.test(x) ? "infra" : "";
    }
    var f = cls(t);
    if (!f || (f === "infra" && /servi/.test(t) && /s1|x2/.test(c))) f = cls(all) || f;
    if (f === "mask" && /s1|x2|servi/.test(all) && !/infra/.test(t)) f = "smask";      // máscara do serviço (loopback é /32)
    return f ? { f: f, op: op } : null;
  }
  // IP que o Excel salvou sem pontos (ex.: 10109160198 → 10.109.160.198)
  function dotless(s) {
    var out = [];
    for (var a = 1; a <= 3; a++) for (var b = 1; b <= 3; b++) for (var c = 1; c <= 3; c++) {
      var d = s.length - a - b - c; if (d < 1 || d > 3) continue;
      var p = [s.slice(0, a), s.slice(a, a + b), s.slice(a + b, a + b + c), s.slice(a + b + c)];
      if (p.every(function (x) { return +x <= 255 && !(x.length > 1 && x[0] === "0"); })) out.push(p.join("."));
    }
    return out;
  }
  function engVal(f, raw, hint) {
    var s = t0(raw).replace(/\s+/g, ""), m;
    if (f === "vlan") { m = /^(\d{1,4})(\.0+)?$/.exec(s); return m && +m[1] >= 1 && +m[1] <= 4094 ? { v: m[1] } : null; }
    if (f === "mask" || f === "smask") { if (ipOk(s) && maskBits(s) >= 8) return { v: s }; m = /^\/?(\d{1,2})$/.exec(s); return m && +m[1] >= 8 && +m[1] <= 32 ? { v: bits2mask(+m[1]) } : null; }
    m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(s);
    if (m && ipOk(m[1])) return { v: m[1], mb: m[2] ? +m[2] : null };
    if (/^\d{7,12}$/.test(s)) {
      var c = dotless(s); if (!c.length) return null;
      var best = c.map(function (ip) { var q = ip.split("."), sc = 0; (hint || []).forEach(function (h) { var r = h.split("."); if (r[0] === q[0]) sc += 2; if (r[0] === q[0] && r[1] === q[1]) sc += 3; }); if (/^(10|172|192|100)\./.test(ip)) sc += 1; return { ip: ip, sc: sc }; })
        .sort(function (x, y) { return y.sc - x.sc; });
      if (best.length > 1 && best[0].sc === best[1].sc) return { v: best[0].ip, fix: s, amb: best.map(function (x) { return x.ip; }) };
      return { v: best[0].ip, fix: s };
    }
    return null;
  }
  function ffRow(row) { var o = [], last = ""; (row || []).forEach(function (v, i) { if (t0(v)) last = t0(v); o[i] = last; }); return o; }
  function engCands(sheets, site) {
    var out = [], notes = [], seen = {}, key = core(site), siteSeen = false;
    function push(f, op, raw, sh, r, c, lab, hint) {
      var x = engVal(f, raw, hint); if (!x) return false;
      var k = f + "|" + x.v + "|" + op + "|" + sh; if (seen[k]) return true; seen[k] = 1;
      out.push({ f: f, op: op, v: x.v, where: sh + "!" + colL(c) + (r + 1), rk: sh + "#" + r, lab: t0(lab).replace(/\s+/g, " "), fix: x.fix || "", amb: x.amb || null });
      if (x.mb && f !== "mask") push(f === "s1x2" ? "smask" : "mask", op, "/" + x.mb, sh, r, c, lab + " (/" + x.mb + ")");
      return true;
    }
    (sheets || []).forEach(function (sh) {
      var rows = sh.rows || [], hr = -1, best = 0, i;
      for (i = 0; i < rows.length; i++) (rows[i] || []).forEach(function (c) { if (key && core(t0(c)) === key) siteSeen = true; });
      for (i = 0; i < Math.min(rows.length, 40); i++) { var n = (rows[i] || []).filter(function (c) { return fieldOf(c, ""); }).length; if (n >= 3 && n > best) { best = n; hr = i; } }
      if (hr >= 0) {                                            // layout em tabela (uma linha por site / operadora)
        var H = rows[hr], up1 = ffRow(rows[hr - 1]), up2 = ffRow(rows[hr - 2]), siteC = -1, opC = -1;
        var ctx = function (c) { return [up2[c], up1[c]].filter(Boolean).join(" "); };
        var W = Math.max(H.length, (rows[hr - 1] || []).length);
        for (var cc = 0; cc < W; cc++) [H[cc], (rows[hr - 1] || [])[cc], (rows[hr - 2] || [])[cc]].forEach(function (h) {
          var t = nk(h); if (siteC < 0 && /^(siteid|site|elementoid|elemento|enodebname|nename|ne|sigla|estacao|sitea|siteaid)$/.test(t)) siteC = cc; if (opC < 0 && /^operador/.test(t)) opC = cc;
        });
        var data = [];
        for (var r = hr + 1; r < rows.length; r++) if ((rows[r] || []).some(function (x) { return t0(x); })) data.push(r);
        var sel = data;
        if (siteC >= 0) { var mm = data.filter(function (r) { return key && core(t0(rows[r][siteC])) === key; }); sel = mm; if (!mm.length && data.length) notes.push(sh.name + ": " + site + " não aparece na coluna de site."); }
        else if (data.length > 6) { sel = []; notes.push(sh.name + ": tabela com " + data.length + " linhas e sem coluna de site — ignorada."); }
        sel.forEach(function (r) {
          var row = rows[r] || [], rop = opC >= 0 ? (/vivo/i.test(row[opC]) ? "VIVO" : /tim/i.test(row[opC]) ? "TIM" : "") : "";
          var hint = row.map(t0).filter(ipOk);
          for (var c = 0; c < W; c++) { var fo = fieldOf(H[c], ctx(c)); if (fo) push(fo.f, fo.op || rop, row[c], sh.name, r, c, (ctx(c) ? ctx(c) + " › " : "") + t0(H[c]), hint); }
        });
      }
      for (i = 0; i < Math.min(rows.length, 400); i++) {         // layout rótulo → valor (ao lado ou abaixo)
        if (hr >= 0 && i >= hr - 2) continue;                    // abaixo do cabeçalho da tabela são valores, não rótulos
        var row2 = rows[i] || [];
        for (var c = 0; c < row2.length; c++) {
          if (typeof row2[c] !== "string") continue;
          var fo = fieldOf(row2[c], ""); if (!fo) continue;
          var done = false;
          for (var k2 = c + 1; k2 <= c + 3 && k2 < row2.length; k2++) if (t0(row2[k2])) { done = push(fo.f, fo.op, row2[k2], sh.name, i, k2, row2[c]); break; }
          if (!done && hr < 0 && rows[i + 1]) push(fo.f, fo.op, rows[i + 1][c], sh.name, i + 1, c, row2[c]);
        }
      }
    });
    return { c: out, notes: notes, siteSeen: siteSeen };
  }
  function textRows(txt) {
    return String(txt || "").replace(/\r/g, "").split("\n").map(function (l) {
      return /\t/.test(l) ? l.split("\t") : l.split(/\s{2,}|\s*[:=]\s+|\s*;\s*/);
    });
  }
  // linhas a partir de A1 (para o endereço bater com o Excel) e valor cru (IP salvo como número não vira 1,01E+10)
  function engRows(ws) {
    if (!ws || !ws["!ref"]) return [];
    var rg = XLSX.utils.decode_range(ws["!ref"]); rg.s = { r: 0, c: 0 };
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range: rg }).slice(0, 6000)
      .map(function (r) { return (r || []).map(function (v) { return typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : v; }); });
  }
  function parseEngBook(ab, fname) {
    if (!window.XLSX) throw new Error("A biblioteca de planilhas (XLSX) não carregou.");
    var wb = XLSX.read(new Uint8Array(ab), { type: "array" });
    return { file: fname, at: Date.now(), sheets: wb.SheetNames.map(function (n) { return { name: n, rows: engRows(wb.Sheets[n]) }; }) };
  }

  // ---------- parâmetros por site (salvos no navegador) ----------
  function txP() { var k = core(S.site) || "_"; return S.U["tx_" + k] || (S.U["tx_" + k] = lsGet(LS_TXP + k, {})); }
  function txSave() { if (S.site) lsSet(LS_TXP + core(S.site), txP()); }
  function txPings() { return lsGet(LS_TXPING + core(S.site), {}); }

  // ---------- modelo TX ----------
  function txModel(Rrs, info) {
    var T = { block: [], warn: [], site: S.site }, p = txP(), R = readAll(S.txRead);
    Object.keys(Rrs || {}).forEach(function (k) { if (!R[k] || (!R[k].rows.length && Rrs[k].rows.length)) R[k] = Rrs[k]; });
    T.R = R; T.hasRead = !!(R["LST DEVIP"] && R["LST DEVIP"].rows.length);
    // site hoje
    T.dev = rowsOf(R, "LST DEVIP").map(function (r) {
      return { cn: g(r, "Cabinet No.") || "0", srn: g(r, "Subrack No.") || "0", sn: g(r, "Slot No."), sbt: g(r, "Subboard Type"), pt: g(r, "Port Type"), pn: g(r, "Port No."),
        vrf: g(r, "VRF Index") || "0", ip: g(r, "IP Address"), mask: g(r, "Mask"), label: g(r, "User Label") };
    }).filter(function (d) { return ipOk(d.ip); });
    var devBy = {}; T.dev.forEach(function (d) { devBy[d.ip] = d; });
    T.vm = rowsOf(R, "LST VLANMAP").map(function (r) { return { nh: g(r, "Next Hop IP", "Next Hop"), vlan: g(r, "VLAN ID"), mask: g(r, "Mask") }; }).filter(function (x) { return ipOk(x.nh); });
    T.rts = rowsOf(R, "LST IPRT").map(function (r) { return { idx: g(r, "Route Index"), dst: g(r, "Destination IP"), mask: g(r, "Destination Mask"), nh: g(r, "Next Hop IP", "Next Hop"), desc: g(r, "Description") }; }).filter(function (x) { return x.idx !== ""; });
    T.hosts = rowsOf(R, "LST SCTPHOST").map(function (r) {
      var port = ""; Object.keys(r).forEach(function (k) { if (!port && /port/i.test(k) && /^\d{3,5}$/.test(sv(r[k]))) port = sv(r[k]); });
      return { id: g(r, "SCTP Host ID"), ips: ipsIn(r), port: port, label: g(r, "User Label") };
    }).filter(function (h) { return h.id !== ""; });
    T.ups = rowsOf(R, "LST USERPLANEHOST").map(function (r) { return { id: g(r, "User Plane Host ID", "UP Host ID"), ips: ipsIn(r), label: g(r, "User Label") }; }).filter(function (h) { return h.id !== ""; });
    var omch = []; rowsOf(R, "LST OMCH").forEach(function (r) { var v = g(r, "Local IP"); if (ipOk(v)) omch.push(v); });

    // core VIVO (MME/SGW)
    var gi = (p.grp != null && p.grp !== "" && TXGW.g[+p.grp]) ? { i: +p.grp, why: "escolhido à mão" } : gwFind(S.site, info.city, info.uf);
    T.gi = gi; T.gw = gi ? TXGW.g[gi.i].gw.slice() : [];
    if (!gi) T.block.push("Grupo de MME/SGW não identificado para " + (S.site || "o site") + " — escolha o grupo em (a).");
    else if (gi.amb) T.warn.push("A UF " + info.uf + " tem mais de um grupo de MME/SGW na planilha — confira o grupo em (a).");
    T.mme = T.gw.filter(function (x) { return /^MME/i.test(x[0]); }).map(function (x) { return x[1]; });

    // placa / porta (sempre do LST DEVIP)
    var eth = T.dev.filter(function (d) { return ptCode(d.pt) === "ETH"; });
    var ref = eth.filter(function (d) { return /lte|4g|enb/i.test(d.label) && !/vivo/i.test(d.label); })[0] ||
      eth.filter(function (d) { return d.label && !/gsm|2g|5g|nr|umts|3g|vivo|omch/i.test(d.label); })[0] || eth.filter(function (d) { return !/vivo/i.test(d.label); })[0] || eth[0];
    T.ref = ref || null;
    var d = { sn: ref ? ref.sn : "", pn: ref ? ref.pn : "", lpn: "1", cn: ref ? ref.cn : "0", srn: ref ? ref.srn : "0", rt0: "21" };
    if (T.hasRead && !ref) T.block.push("Nenhuma porta Ethernet no LST DEVIP — não consigo saber a placa (SN) e a ETHport.");

    // ENG-SI
    var E = { c: [], notes: [], siteSeen: false };
    if (ENG) E = engCands(ENG.sheets, S.site);
    if (p.engTxt) { var E2 = engCands([{ name: "colado", rows: textRows(p.engTxt) }], S.site); E.c = E2.c.concat(E.c); E.notes = E.notes.concat(E2.notes); }
    T.eng = E;
    var vlanUsed = {}; T.vm.forEach(function (x) { vlanUsed[x.vlan] = x; });
    var nhUsed = {}; T.vm.forEach(function (x) { nhUsed[x.nh] = x; });
    function onSite(f, v) {
      if (f === "vlan") return !!vlanUsed[v];
      if (f === "gw") return !!nhUsed[v] || T.dev.some(function (x) { var b = maskBits(x.mask); return b > 0 && b < 32 && inNet(v, x.ip, b); });
      if (f === "mask") return false;
      return !!devBy[v];
    }
    var pk = {};
    function pick(f, rk) {
      var c = E.c.filter(function (x) { return x.f === f && x.op !== "TIM"; });
      var tiers = [c.filter(function (x) { return x.op === "VIVO" && !onSite(f, x.v); }), c.filter(function (x) { return x.op === "" && !onSite(f, x.v); }), c.filter(function (x) { return x.op === "VIVO"; })];
      for (var i = 0; i < tiers.length; i++) if (tiers[i].length) { var s = tiers[i].filter(function (x) { return rk && x.rk === rk; })[0]; return s || tiers[i][0]; }
      return null;
    }
    pk.infra = pick("infra"); var rk = pk.infra ? pk.infra.rk : "";
    ["vlan", "mask", "gw", "s1x2"].forEach(function (f) { pk[f] = pick(f, rk); });
    T.pk = pk; T.src = {}; T.v = {};
    ["vlan", "infra", "mask", "gw", "s1x2"].forEach(function (f) {
      var u = p[f] != null ? String(p[f]).trim() : "";
      if (u) { T.v[f] = u; T.src[f] = "editado"; }
      else if (pk[f]) {
        T.v[f] = pk[f].v; T.src[f] = "ENG-SI " + pk[f].where + (pk[f].op ? " · " + pk[f].op : "") + (pk[f].lab ? " · “" + pk[f].lab + "”" : "") + (pk[f].fix ? " · estava sem pontos (" + pk[f].fix + ")" : "");
        if (pk[f].amb) T.warn.push("Na ENG-SI o " + f + " veio sem pontos (" + pk[f].fix + ") e dá para ler de mais de um jeito: " + pk[f].amb.join(" / ") + " — usei " + pk[f].v + ", confira.");
      }
      else T.v[f] = "";
    });
    if (!T.v.mask) { T.v.mask = "255.255.255.248"; T.src.mask = "padrão do roteiro (/29)"; }
    if (T.src.vlan !== "editado" && T.v.vlan) {
      var vt = E.c.filter(function (x) { return x.f === "vlan" && x.op === "TIM" && x.v === T.v.vlan; })[0];
      if (vt && !E.c.some(function (x) { return x.f === "vlan" && x.op === "VIVO"; })) T.warn.push("A VLAN " + T.v.vlan + " também aparece como “" + vt.lab + "” (" + vt.where + ") e a ENG-SI não tem VLAN VIVO preenchida — confira se é a VLAN a usar para a VIVO.");
    }
    var mb = maskBits(T.v.mask);
    if (!T.v.gw && ipOk(T.v.infra) && mb > 0 && mb < 31) { T.v.gw = n2ip(netOf(T.v.infra, mb) + 1); T.src.gw = "calculado: 1º IP da sub-rede — CONFIRME"; T.gwCalc = true; if (T.v.gw === T.v.infra) T.v.gw = ""; }
    E.c.filter(function (x) { return x.op === "TIM"; }).forEach(function (x) { if (!devBy[x.v] && (x.f === "infra" || x.f === "s1x2")) T.warn.push("A ENG-SI traz " + x.lab + " = " + x.v + " (TIM) que não está no LST DEVIP — confira se a TIM já está configurada."); });

    // parâmetros (calculados × editados)
    var hU = {}; T.hosts.forEach(function (h) { hU[h.id] = h; });
    var hasIp = function (h) { return h.ips.indexOf(T.v.s1x2) >= 0; };
    var exS1 = T.hosts.filter(function (h) { return hasIp(h) && (h.port === "36412" || (!h.port && !/x2/i.test(h.label))); })[0];
    var exX2 = T.hosts.filter(function (h) { return hasIp(h) && (h.port === "36422" || (!h.port && /x2/i.test(h.label))) && h !== exS1; })[0];
    var used = {}; Object.keys(hU).forEach(function (k) { used[k] = 1; });
    d.hS1 = exS1 ? exS1.id : String(nextFree(30, used)); used[d.hS1] = 1;
    d.hX2 = exX2 ? exX2.id : String(nextFree(31, used));
    var exUp = T.ups.filter(function (h) { return h.ips.indexOf(T.v.s1x2) >= 0; })[0], uU = {}; T.ups.forEach(function (h) { uU[h.id] = 1; });
    d.up = exUp ? exUp.id : String(nextFree(30, uU));
    T.def = d; T.p = {};
    Object.keys(d).forEach(function (k) { T.p[k] = (p[k] != null && String(p[k]).trim() !== "") ? String(p[k]).trim() : d[k]; });
    var P = T.p, V = T.v;
    T.exS1 = exS1 && exS1.id === P.hS1; T.exX2 = exX2 && exX2.id === P.hX2; T.exUp = exUp && exUp.id === P.up;
    if (!T.exS1 && hU[P.hS1]) T.block.push("SCTPHOST " + P.hS1 + " já existe no site (" + (hU[P.hS1].label || hU[P.hS1].ips.join(",")) + ") — use outro ID.");
    if (!T.exX2 && hU[P.hX2]) T.block.push("SCTPHOST " + P.hX2 + " já existe no site (" + (hU[P.hX2].label || hU[P.hX2].ips.join(",")) + ") — use outro ID.");
    if (P.hS1 === P.hX2) T.block.push("SCTPHOST do S1 e do X2 com o mesmo ID (" + P.hS1 + ").");
    if (!T.exUp && uU[P.up]) T.block.push("USERPLANEHOST " + P.up + " já existe no site — use outro ID.");

    // conferências (o script não pode dar erro)
    if (!T.hasRead) T.block.push("Falta a leitura TX do site (LST DEVIP e cia.) — use “Ler TX do MAE” ou cole as respostas em (c).");
    if (!/^\d+$/.test(V.vlan) || +V.vlan < 1 || +V.vlan > 4094) T.block.push("VLAN VIVO " + (V.vlan ? "inválida (" + V.vlan + ")" : "não informada") + ".");
    ["infra", "gw", "s1x2"].forEach(function (f) { if (!ipOk(V[f])) T.block.push({ infra: "IP INFRA VIVO", gw: "Gateway VIVO", s1x2: "IP S1/X2 VIVO" }[f] + (V[f] ? " inválido (" + V[f] + ")" : " não informado") + "."); });
    if (mb < 8 || mb > 30) T.block.push("Máscara do IP INFRA inválida (" + V.mask + ").");
    if (!P.sn || !P.pn) T.block.push("Placa (SN) / ETHport não identificadas — preencha nos parâmetros.");
    T.skip = {};
    if (ipOk(V.infra) && mb >= 8) {
      var ex = devBy[V.infra];
      if (ex) { if (ptCode(ex.pt) === "ETH") T.skip.infra = "já existe no site (SN " + ex.sn + " ETH " + ex.pn + (ex.label ? " · " + ex.label : "") + ")"; else T.block.push("IP INFRA " + V.infra + " já está no site numa porta " + ex.pt + "."); }
      else T.dev.forEach(function (x) { var b = maskBits(x.mask); if ((x.vrf || "0") === "0" && b >= 0 && overlap(x.ip, b, V.infra, mb)) T.block.push("A sub-rede " + n2ip(netOf(V.infra, mb)) + "/" + mb + " (IP INFRA VIVO) sobrepõe " + x.ip + "/" + b + " (" + (x.label || x.pt) + ") que já está no site."); });
      if (mb < 31 && (ip2n(V.infra) === netOf(V.infra, mb) || ip2n(V.infra) === netOf(V.infra, mb) + Math.pow(2, 32 - mb) - 1)) T.block.push("IP INFRA " + V.infra + " é o endereço de rede/broadcast da sub-rede /" + mb + ".");
      if (ipOk(V.gw)) {
        if (V.gw === V.infra) T.block.push("Gateway igual ao IP INFRA.");
        else if (!inNet(V.gw, V.infra, mb)) T.block.push("Gateway " + V.gw + " fora da sub-rede do IP INFRA (" + n2ip(netOf(V.infra, mb)) + "/" + mb + ").");
      }
    }
    if (ipOk(V.s1x2)) {
      var ex2 = devBy[V.s1x2];
      if (ex2) { if (ptCode(ex2.pt) === "LOOPINT") T.skip.s1x2 = "já existe no site (loopback " + ex2.pn + (ex2.label ? " · " + ex2.label : "") + ")"; else T.block.push("IP S1/X2 " + V.s1x2 + " já está numa porta " + ex2.pt + "."); }
      else T.dev.forEach(function (x) { var b = maskBits(x.mask); if (b >= 0 && b < 32 && inNet(V.s1x2, x.ip, b)) T.block.push("IP S1/X2 " + V.s1x2 + " cai dentro da sub-rede de " + x.ip + "/" + b + " (" + (x.label || x.pt) + ")."); });
      if (V.s1x2 === V.infra) T.block.push("IP S1/X2 igual ao IP INFRA.");
      else if (ipOk(V.infra) && mb >= 8 && inNet(V.s1x2, V.infra, mb)) T.block.push("IP S1/X2 " + V.s1x2 + " dentro da sub-rede do IP INFRA.");
    }
    var lp = T.dev.filter(function (x) { return ptCode(x.pt) === "LOOPINT" && x.pn === P.lpn; });
    if (lp.length && !T.skip.s1x2) T.warn.push("O loopback " + P.lpn + " já tem " + lp.map(function (x) { return x.ip + (x.label ? " (" + x.label + ")" : ""); }).join(", ") + " — o IP S1/X2 VIVO entra como IP adicional nele.");
    var vmx = T.vm.filter(function (x) { return x.nh === V.gw; })[0];
    if (vmx) { if (vmx.vlan === V.vlan) T.skip.vlan = "VLANMAP para " + V.gw + " já existe (VLAN " + vmx.vlan + ")"; else T.block.push("Já existe VLANMAP para " + V.gw + " com a VLAN " + vmx.vlan + " (ENG-SI: " + V.vlan + ")."); }
    var tw = T.vm.filter(function (x) { return x.vlan === V.vlan && x.nh !== V.gw; })[0];
    if (tw) T.warn.push("A VLAN " + V.vlan + " já é usada no site para o next hop " + tw.nh + " — confira se é mesmo a VLAN da VIVO.");
    if (V.vrfWarn) T.warn.push(V.vrfWarn);

    // rotas para o core VIVO (/16, como a planilha) — sem duplicar destino
    var rU = {}; T.rts.forEach(function (r) { rU[r.idx] = 1; });
    T.routes = []; var seenR = {};
    T.gw.forEach(function (x) {
      var dst = x[1].split(".").slice(0, 2).join(".") + ".0.0";
      if (seenR[dst]) { seenR[dst].names.push(x[0]); return; }
      var o = { dst: dst, mask: "255.255.0.0", names: [x[0]], desc: x[0] + "_VIVO" };
      var same = T.rts.filter(function (r) { return r.dst === dst && maskBits(r.mask) === 16; });
      if (same.some(function (r) { return r.nh === V.gw; })) o.skip = "já existe (RTIDX " + same.filter(function (r) { return r.nh === V.gw; })[0].idx + ")";
      else if (same.length) o.conflict = same[0];
      else {
        var wide = T.rts.filter(function (r) { var b = maskBits(r.mask); return b > 0 && b < 16 && inNet(dst, r.dst, b) && r.nh !== V.gw; })[0];   // rota default (0.0.0.0/0) é normal
        if (wide) o.wide = wide;
      }
      seenR[dst] = o; T.routes.push(o);
    });
    var n0 = parseInt(P.rt0, 10) || 21;
    T.routes.forEach(function (o) { if (o.skip || o.conflict) return; o.idx = nextFree(n0, rU); rU[o.idx] = 1; n0 = o.idx + 1; });
    T.routes.forEach(function (o) {
      if (o.conflict) T.warn.push("Rota para " + o.dst + "/16 (" + o.names.join(", ") + ") já existe via " + o.conflict.nh + " (RTIDX " + o.conflict.idx + (o.conflict.desc ? " · " + o.conflict.desc : "") + ") — NÃO gerei a rota VIVO; confira se essa rota é da TIM.");
      if (o.wide) T.warn.push("Já existe rota mais ampla " + o.wide.dst + "/" + maskBits(o.wide.mask) + " via " + o.wide.nh + " — a nova " + o.dst + "/16 via o gateway VIVO passa a ter preferência para esse destino.");
    });

    // USERLABEL vazio no DEVIP — sugestão (só entra no script se confirmar)
    var h2e = {}; rowsOf(R, "LST SCTPHOST2EPGRP").forEach(function (r) { var e = g(r, "EPGroup ID"); if (e !== "") (h2e[e] = h2e[e] || []).push(g(r, "SCTP Host ID")); });
    var lteH = {}; rowsOf(R, "LST S1").concat(rowsOf(R, "LST X2")).forEach(function (r) { (h2e[g(r, "Control Plane EPGroup ID", "CP EPGroup ID")] || []).forEach(function (h) { lteH[h] = 1; }); });
    var lteIps = {}, otherIps = {};
    T.hosts.forEach(function (h) { h.ips.forEach(function (ip) { if (lteH[h.id] || /lte|4g|s1|x2/i.test(h.label)) lteIps[ip] = h.id; else otherIps[ip] = h.id; }); });
    if (!Object.keys(lteH).length && !T.hosts.some(function (h) { return /lte|4g|s1|x2/i.test(h.label); })) { Object.keys(otherIps).forEach(function (ip) { lteIps[ip] = otherIps[ip]; }); otherIps = {}; }
    T.ups.forEach(function (h) { h.ips.forEach(function (ip) { if (!lteIps[ip] && !otherIps[ip]) lteIps[ip] = "UP " + h.id; }); });
    var peers = []; rowsOf(R, "LST SCTPPEER").forEach(function (r) { ipsIn(r).forEach(function (ip) { peers.push(ip); }); });
    function viaRoutes(x) {
      var b = maskBits(x.mask); if (b <= 0 || b >= 32) return "";
      var rs = T.rts.filter(function (r) { return inNet(r.nh, x.ip, b); }); if (!rs.length) return "";
      var txt = rs.map(function (r) { return r.desc; }).join(" ");
      if (peers.some(function (pi) { return rs.some(function (r) { var rb = maskBits(r.mask); return rb >= 0 && inNet(pi, r.dst, rb); }); })) return "LTE";
      return /gsm|2g|bsc|abis/i.test(txt) ? "GSM" : /5g|(^|[^a-z])nr|amf|upf|gnb|(^|[^a-z])ng/i.test(txt) ? "5G" : /umts|3g|rnc|iub/i.test(txt) ? "UMTS" : /mme|sgw|s1|lte|4g|enb/i.test(txt) ? "LTE" : "";
    }
    var labeledLteEth = T.dev.some(function (x) { return ptCode(x.pt) === "ETH" && /lte/i.test(x.label) && !/vivo/i.test(x.label); });
    T.lab = T.dev.filter(function (x) { return !x.label; }).map(function (x) {
      var s = "", why = "", pt = ptCode(x.pt);
      if (x.ip === V.infra) { s = "LTE SERVICE_INFRA_VIVO"; why = "IP INFRA da ENG-SI VIVO"; }
      else if (x.ip === V.s1x2) { s = "LTE S1/X2_VIVO"; why = "IP S1/X2 da ENG-SI VIVO"; }
      else if (omch.indexOf(x.ip) >= 0) { s = "OMCH"; why = "é o Local IP do LST OMCH"; }
      else if (pt === "LOOPINT" && lteIps[x.ip]) { s = "LTE S1/X2_TIM"; why = "usado no SCTPHOST/UPHOST " + lteIps[x.ip] + " do S1/X2"; }
      else if (pt === "LOOPINT" && otherIps[x.ip]) { s = "5G SA_NSA CP/UP"; why = "SCTPHOST " + otherIps[x.ip] + " fora do S1/X2 do LTE (provável 5G)"; }
      else if (pt === "ETH") {
        var vr = viaRoutes(x);
        if (vr === "LTE") { s = "LTE SERVICE_TIM"; why = "next hop das rotas do LTE/MME está nesta sub-rede"; }
        else if (vr === "GSM") { s = "GSM"; why = "rotas desta sub-rede descritas como GSM"; }
        else if (vr === "5G") { s = "5G SA_NSA_INFRA IP"; why = "rotas desta sub-rede descritas como 5G"; }
        else if (vr === "UMTS") { s = "UMTS"; why = "rotas desta sub-rede descritas como 3G"; }
        else if (!labeledLteEth && maskBits(x.mask) === 29) { s = "LTE SERVICE_TIM"; why = "palpite: máscara /29 como o serviço LTE — CONFIRA"; }
        else why = "não identificado — escolha o texto";
      } else why = "não identificado — escolha o texto";
      var u = (p.lab || {})[x.ip] || {};
      return { d: x, sug: s, why: why, txt: u.t != null ? u.t : s, on: !!u.on, ok: !!(sbtCode(x.sbt) && ptCode(x.pt)) };
    });

    // PINGs (um por IP) + gateway
    T.pings = []; var pS = {};
    T.gw.forEach(function (x) { if (pS[x[1]]) { pS[x[1]].nm += " / " + x[0]; return; } pS[x[1]] = { nm: x[0], ip: x[1] }; T.pings.push(pS[x[1]]); });
    if (ipOk(V.gw)) T.pings.push({ nm: "Gateway VIVO", ip: V.gw });
    var res = txPings(), pasted = pingBlocks(S.txRead);
    Object.keys(pasted).forEach(function (ip) { if (!res[ip]) res[ip] = pasted[ip]; });
    T.res = res;
    T.ok = !T.block.length;
    return T;
  }

  function txScript(T) {
    var L = [], P = T.p, V = T.v, add = function () { for (var i = 0; i < arguments.length; i++) L.push(arguments[i]); };
    var hr = "// " + new Array(86).join("=");
    var dv = { cn: P.cn, srn: P.srn };
    add(hr, "// TX VIVO · " + T.site + " · gerado em " + now() + " · TELEBIT RAN", "// Core VIVO: " + (T.gi ? gwLabel(T.gi.i) + " (" + T.gi.why + ")" : "—"),
      "// Placa SN=" + P.sn + " · ETHport " + P.pn + (T.ref ? " (do LST DEVIP: " + T.ref.ip + (T.ref.label ? " · " + T.ref.label : "") + ")" : ""), hr, "");
    var labs = T.lab.filter(function (x) { return x.on && x.txt && x.ok; });
    if (labs.length) {
      add("// USER LABEL dos IPs sem identificação (confirmado na tela — o Executar pede confirmação de novo)");
      labs.forEach(function (x) { var d = x.d; add("MOD DEVIP:" + loc(d) + "SN=" + d.sn + ",SBT=" + sbtCode(d.sbt) + ",PT=" + ptCode(d.pt) + ",PN=" + d.pn + ',IP="' + d.ip + '",USERLABEL="' + x.txt + '";'); });
      add("");
    }
    if (!T.ok) {
      add("// ⚠ CONFIGURAÇÃO DE TX NÃO GERADA — resolva antes:"); T.block.forEach(function (x) { add("//   - " + x); });
      return L.join("\n");
    }
    add("// 1) VLAN do gateway VIVO", "LST VLANMAP:;");
    if (T.skip.vlan) add("// " + T.skip.vlan);
    else add('ADD VLANMAP:NEXTHOPIP="' + V.gw + '",MASK="255.255.255.255",VLANMODE=SINGLEVLAN,VLANID=' + V.vlan + ",SETPRIO=DISABLE;");
    add("", "// 2) IP de serviço (INFRA) e loopback S1/X2 da VIVO", "LST DEVIP:;");
    if (T.skip.infra) add("// IP INFRA " + V.infra + ": " + T.skip.infra);
    else add("ADD DEVIP:" + loc(dv) + "SN=" + P.sn + ",SBT=BASE_BOARD,PT=ETH,PN=" + P.pn + ',IP="' + V.infra + '",MASK="' + V.mask + '",USERLABEL="LTE SERVICE_INFRA_VIVO";');
    if (T.skip.s1x2) add("// IP S1/X2 " + V.s1x2 + ": " + T.skip.s1x2);
    else add("ADD DEVIP:" + loc(dv) + "SN=" + P.sn + ",SBT=BASE_BOARD,PT=LOOPINT,PN=" + P.lpn + ',IP="' + V.s1x2 + '",MASK="255.255.255.255",USERLABEL="LTE S1/X2_VIVO";');
    add("", "// 3) SCTPHOST S1 e X2 da VIVO", "LST SCTPHOST:;");
    var sh = function (id, port, lb) { return "ADD SCTPHOST:SCTPHOSTID=" + id + ',IPVERSION=IPv4,SIGIP1V4="' + V.s1x2 + '",SIGIP1SECSWITCH=DISABLE,SIGIP2SECSWITCH=DISABLE,PN=' + port + ',SIMPLEMODESWITCH=SIMPLE_MODE_OFF,SCTPTEMPLATEID=0,DTLSPOLICYID=NULL,USERLABEL="' + lb + '";'; };
    add(T.exS1 ? "// SCTPHOST " + P.hS1 + " (S1, " + V.s1x2 + ") já existe" : sh(P.hS1, 36412, "S1_VIVO"));
    add(T.exX2 ? "// SCTPHOST " + P.hX2 + " (X2, " + V.s1x2 + ") já existe" : sh(P.hX2, 36422, "X2_VIVO"));
    add("", "// 4) USERPLANEHOST da VIVO", "LST USERPLANEHOST:;");
    add(T.exUp ? "// USERPLANEHOST " + P.up + " (" + V.s1x2 + ") já existe" : "ADD USERPLANEHOST:UPHOSTID=" + P.up + ',IPVERSION=IPv4,LOCIPV4="' + V.s1x2 + '",IPSECSWITCH=DISABLE,USERLABEL="S1X2_VIVO";');
    add("", "// 5) Rotas para o core VIVO via " + V.gw + " (RTIDX ocupados são pulados)", "LST IPRT:;");
    T.routes.forEach(function (o) {
      if (o.skip) { add("// " + o.dst + "/16 (" + o.names.join(", ") + "): " + o.skip); return; }
      if (o.conflict) { add("// ⚠ " + o.dst + "/16 (" + o.names.join(", ") + "): já existe via " + o.conflict.nh + " (RTIDX " + o.conflict.idx + ") — não gerada"); return; }
      add("ADD IPRT:RTIDX=" + o.idx + "," + loc(dv) + "SN=" + P.sn + ',SBT=BASE_BOARD,DSTIP="' + o.dst + '",DSTMASK="255.255.0.0",RTTYPE=NEXTHOP,NEXTHOP="' + V.gw + '",MTUSWITCH=OFF,DESCRI="' + o.desc + '",FORCEEXECUTE=YES;' + (o.names.length > 1 ? "   // cobre " + o.names.join(", ") : ""));
    });
    add("", "// 6) Testes de PING a partir do S1/X2 VIVO — um por vez (o próximo só sai quando o anterior termina)");
    T.pings.forEach(function (x) { add("// " + x.nm, "PING:" + loc(dv) + "SN=" + P.sn + ',SRCIP="' + V.s1x2 + '",DSTIP="' + x.ip + '",CONTPING=DISABLE,APPTIF=NO;'); });
    add("", "// Depois: “Ler TX do MAE” de novo para conferir · seguir para o RAN Sharing (seções 1 a 7)");
    return L.join("\n");
  }

  // ---------------------------------------------------------------- modelo (tudo que o script precisa)
  function siteRead() {
    var R = {}, sameLoaded = core(loadedSite()) === core(S.site) && !!core(S.site);
    if (sameLoaded) { var u = $("uniIn"); R = readAll(u ? u.value : ""); }
    var X = readAll(S.readText);
    Object.keys(X).forEach(function (k) { if (X[k].rows.length || !R[k]) R[k] = X[k]; });
    var Y = readAll(S.txRead);                                      // leitura TX (etapa 0) completa o que faltar
    Object.keys(Y).forEach(function (k) { if (!R[k] || (!R[k].rows.length && Y[k].rows.length)) R[k] = Y[k]; });
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

    M.tx = txModel(R, { uf: M.uf, city: M.city });

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
    var mm = mmeStore()[M.uf || "_"] || {}, tx = M.tx;
    d.mme1 = mm.ip1 || MME_DEF.ip1; d.mme2 = mm.ip2 || MME_DEF.ip2; M.mmeDefault = !(mm.ip1 || mm.ip2); M.mmeFrom = M.mmeDefault ? "" : "salvos para a UF " + (M.uf || "?");
    if (tx.mme.length >= 2) { d.mme1 = tx.mme[0]; d.mme2 = tx.mme[1]; M.mmeDefault = false; M.mmeFrom = "etapa 0 · " + gwLabel(tx.gi.i); }
    // SCTPHOST/UPHOST da VIVO criados na etapa 0 (TX) — senão, os mesmos da TIM (roteiro original)
    M.hostFromTx = !!(tx.ok || (tx.exS1 && tx.exUp));
    if (M.hostFromTx) { d.sctpS1 = tx.p.hS1; d.sctpX2 = tx.p.hX2; d.upS1 = tx.p.up; d.upX2 = tx.p.up; }
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
    "#pane-rs4g .r4-listinfo{font-size:12.5px;margin-top:4px}",
    "#pane-rs4g #r4TxCard{border-left:4px solid #4f63d8}",
    "#pane-rs4g .r4-tx3{display:grid;grid-template-columns:repeat(3,minmax(260px,1fr));gap:12px;margin-top:6px}",
    "@media (max-width:1180px){#pane-rs4g .r4-tx3{grid-template-columns:1fr}}",
    "#pane-rs4g .r4-box{border:1px solid #e4e7ee;border-radius:10px;padding:10px 12px;background:#fbfcfe}",
    "#pane-rs4g .r4-box h3{margin:0 0 6px;font-size:14px}",
    "#pane-rs4g .r4-box select{width:100%}",
    "#pane-rs4g #r4TxRead{height:110px}#pane-rs4g #r4TxEngTxt{height:90px}",
    "#pane-rs4g .r4-gwl{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}",
    "#pane-rs4g .r4-gwl span{font:12px Consolas,monospace;background:#eef0ff;color:#2c3a9e;border-radius:6px;padding:3px 7px}",
    "#pane-rs4g .r4-gwl span b{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;margin-right:4px;color:#475467}",
    "#pane-rs4g .r4-txv{display:grid;grid-template-columns:1fr;gap:6px}",
    "#pane-rs4g .r4-txv label{display:grid;grid-template-columns:118px 1fr;gap:2px 8px;align-items:center;font-size:12px;color:#475467;font-weight:600}",
    "#pane-rs4g .r4-txv input{font:13px Consolas,monospace;padding:5px 7px;border:1px solid #e3c88a;background:#fffbea;border-radius:6px;min-width:0}",
    "#pane-rs4g .r4-txv input.chg{border-color:#4f63d8;background:#eef0ff}#pane-rs4g .r4-txv small{grid-column:2;font-weight:400;color:#98a2b3;font-size:11px}",
    "#pane-rs4g .r4-txv small.calc{color:#8a5a00}",
    "#pane-rs4g table.r4t tr.vivo td{background:#f1f3ff}#pane-rs4g table.r4t input.lab{width:190px;border-color:#e3c88a}",
    "#pane-rs4g .big{font-size:15px;font-weight:700}"
  ].join("\n");
  document.head.appendChild(css);

  pane.innerHTML =
    '<section class="card r4-hero"><div><h2>RS_4G — migrar o 4G para RAN Sharing TIM × VIVO</h2>' +
    '<p class="muted">Junta a <b>planilha MOU</b> (dados futuros), a <b>Entrada</b> (células, setores e RRUs) e a <b>leitura RS</b> do site e gera o script na ordem do roteiro: ' +
    'TX VIVO (etapa 0: VLAN, IPs, rotas e PING), RAN Sharing (operadoras, TAC, MME VIVO, S1/X2, eNodeB ID, CELLOP) e ampliações (frequência/banda, nomes, novas células). Tudo que vem calculado pode ser ajustado nos campos amarelos.</p></div>' +
    '<div class="r4-chips" id="r4Chips"></div></section>' +
    '<section class="card" id="r4TxCard"><h2><span class="n">0</span>TX VIVO — configurar e testar (antes do RAN Sharing)</h2>' +
    '<p class="muted" style="margin:0 0 4px">Cria a VLAN, o IP de serviço e o S1/X2 da VIVO, os hosts SCTP/UP, as rotas para o core VIVO e testa com PING, um por vez. ' +
    'Placa e ETHport vêm do <b>LST DEVIP</b>; IDs e RTIDX ocupados são pulados; o que já existe no site vira comentário. O RAN Sharing (seções 1 a 7) usa os MMEs e os hosts criados aqui.</p>' +
    '<div class="r4-tx3">' +
    '<div class="r4-box"><h3>a) Core VIVO — MME e SGW</h3><div id="r4TxGwSt" class="muted" style="font-size:12px"></div>' +
    '<select id="r4TxGrp"></select><div id="r4TxGw"></div>' +
    '<div class="row" style="font-size:12px"><span class="muted">Planilha nova:</span><input type="file" id="r4TxGwFile" accept=".xlsx,.xlsm,.xls,.xlsb"><button class="ghost" type="button" id="r4TxGwDef" title="voltar à planilha embutida">padrão</button></div></div>' +
    '<div class="r4-box"><h3>b) ENG-SI — IPs da VIVO</h3>' +
    '<div class="row"><input type="file" id="r4TxEngFile" accept=".xlsx,.xlsm,.xls,.xlsb,.csv"></div><div id="r4TxEngSt" class="muted" style="font-size:12px"></div>' +
    '<details style="margin:4px 0"><summary class="muted" style="cursor:pointer;font-size:12.5px">ou colar as linhas da ENG-SI (com o cabeçalho)</summary><textarea id="r4TxEngTxt" placeholder="Cole aqui (do Excel: cabeçalho + linha do site)"></textarea>' +
    '<div class="row"><button class="ghost" type="button" id="r4TxEngGo">Usar colado</button><button class="ghost" type="button" id="r4TxEngClr">Limpar colado</button></div></details>' +
    '<div id="r4TxVals"></div></div>' +
    '<div class="r4-box"><h3>c) Leitura TX do site</h3><div class="cmd-block"><pre id="r4TxCmds"></pre><button class="copy-btn" type="button" id="r4TxCmdsCopy">Copiar</button></div>' +
    '<textarea id="r4TxRead" placeholder="Cole aqui as respostas (ou use Ler TX do MAE)"></textarea>' +
    '<div class="row"><button class="primary" type="button" id="r4TxReadMae">▶ Ler TX do MAE</button><button class="ghost" type="button" id="r4TxReadGo">Processar colado</button>' +
    '<button class="ghost" type="button" id="r4TxReadClr">Limpar</button></div><div id="r4TxReadSt" class="muted" style="font-size:12.5px"></div></div>' +
    '</div>' +
    '<div id="r4TxDev" style="margin-top:12px"></div><div id="r4TxPar" style="margin-top:10px"></div><div id="r4TxMsg"></div>' +
    '<h3 style="font-size:14px;margin:12px 0 6px">Script TX VIVO</h3>' +
    '<textarea id="r4TxOut" class="r4-out" spellcheck="false" style="height:340px"></textarea>' +
    '<div class="row"><button class="primary" type="button" id="r4TxCopy">Copiar script TX</button><button class="ghost" type="button" id="r4TxDl">Baixar .txt</button>' +
    '<button class="ghost" type="button" id="r4TxRegen">↺ Regerar</button><span id="r4TxOutSt" class="muted" style="font-size:12.5px"></span></div>' +
    '<p class="muted" style="font-size:12.5px;margin:6px 0 0">No <b>Executar no site</b>: para no 1º comando de configuração que falhar; cada <code>PING</code> roda sozinho e só depois sai o próximo (OK/NOK aparece abaixo); o <code>MOD DEVIP</code> de USERLABEL pede confirmação antes.</p>' +
    '<div id="r4TxPing" style="margin-top:10px"></div></section>' +
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
  $("r4TxCmds").textContent = TX_READ.join("\n");
  $("r4TxCmdsCopy").addEventListener("click", function () { copyText(TX_READ.join("\n"), this); });
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
    var txr = M.tx.pings.map(function (x) { return M.tx.res[x.ip]; }).filter(Boolean);
    ch.push(!M.tx.hasRead ? chip("wa", "TX: sem leitura") : !M.tx.ok ? chip("er", "TX: pendências") : txr.length < M.tx.pings.length ? chip("in", "TX: script pronto") :
      chip(txr.every(function (r) { return r.ok; }) ? "ok" : "er", "PING " + txr.filter(function (r) { return r.ok; }).length + "/" + M.tx.pings.length + " OK"));
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
    renderTx(); renderChk(); renderCells(); renderPar(); renderBlk();
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


  // ---------------------------------------------------------------- etapa 0 — TX VIVO (tela)
  var TX_V = [["vlan", "VLAN VIVO"], ["infra", "IP INFRA (serviço)"], ["mask", "Máscara INFRA"], ["gw", "Gateway VIVO"], ["s1x2", "IP S1/X2 (loopback)"]];
  var TX_PAR = [["sn", "Placa UMPT (SN)"], ["pn", "ETHport (PN)"], ["lpn", "Loopback (PN)"], ["hS1", "SCTPHOST S1 VIVO"], ["hX2", "SCTPHOST X2 VIVO"], ["up", "USERPLANEHOST VIVO"], ["rt0", "1º RTIDX das rotas"]];
  function renderTx() {
    var T = M.tx, p = txP();
    // a) gateways
    $("r4TxGwSt").innerHTML = esc(TXGW.file) + " · " + TXGW.g.length + " grupos" + (T.gi ? " · " + chip(T.gi.amb ? "wa" : "ok", T.gi.why) : " · " + chip("er", "grupo não identificado"));
    var sel = T.gi ? T.gi.i : -1;
    $("r4TxGrp").innerHTML = '<option value="">' + (T.gi && p.grp == null ? "(automático) " : "") + "— escolher grupo —</option>" +
      TXGW.g.map(function (G, i) { return '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">" + esc(gwLabel(i)) + "</option>"; }).join("");
    $("r4TxGw").innerHTML = T.gw.length ? '<div class="r4-gwl">' + T.gw.map(function (x) { return "<span><b>" + esc(x[0]) + "</b>" + esc(x[1]) + "</span>"; }).join("") + "</div>" : "";
    // b) ENG-SI
    var E = T.eng;
    $("r4TxEngSt").innerHTML = (ENG ? chip(E.siteSeen ? "ok" : "wa", E.siteSeen ? "site no arquivo" : "site não aparece no arquivo") + " " + esc(ENG.file) : chip("wa", "ENG-SI não carregada")) +
      (p.engTxt ? " " + chip("in", "colado") : "") + " · " + E.c.length + " valor(es) achados" + (E.notes.length ? '<div style="margin-top:3px">' + E.notes.map(esc).join("<br>") + "</div>" : "");
    var dl = "";
    $("r4TxVals").innerHTML = '<div class="r4-txv">' + TX_V.map(function (x) {
      var k = x[0], c = E.c.filter(function (y) { return y.f === k; });
      dl += '<datalist id="r4TxDl_' + k + '">' + c.map(function (y) { return '<option value="' + esc(y.v) + '">' + esc((y.op || "?") + " · " + y.where + (y.lab ? " · " + y.lab : "")) + "</option>"; }).join("") + "</datalist>";
      var src = T.src[k] || (c.length ? "" : "não achado na ENG-SI — digite");
      return "<label>" + esc(x[1]) + '<input data-txv="' + k + '" list="r4TxDl_' + k + '" value="' + esc(T.v[k]) + '"' + (T.src[k] === "editado" ? ' class="chg"' : "") + ' placeholder="' + (k === "vlan" ? "ex.: 3349" : "0.0.0.0") + '">' +
        '<small class="' + (/calculado|não achado/.test(src) ? "calc" : "") + '">' + esc(src) + (c.length > 1 ? " · " + c.length + " opções na lista" : "") + "</small></label>";
    }).join("") + "</div>" + dl;
    // c) leitura
    var Rt = readAll(S.txRead);
    $("r4TxReadSt").innerHTML = (S.txReadAt ? "leitura de " + esc(S.txReadAt) + "<br>" : "") + TX_READ.map(function (c) { var k = ckey(c), e = Rt[k] || T.R[k]; return chip(e ? (e.rows.length ? "ok" : "wa") : "er", k.replace(/^LST /, "") + (e ? " " + e.rows.length : " —")); }).join(" ");
    // DEVIP do site
    var V = T.v;
    if (!T.dev.length) $("r4TxDev").innerHTML = "";
    else {
      var opts = '<datalist id="r4TxLabDl">' + TX_LABELS.map(function (l) { return '<option value="' + esc(l) + '">'; }).join("") + "</datalist>";
      $("r4TxDev").innerHTML = '<h3 style="font-size:14px;margin:0 0 6px">IPs do site hoje (LST DEVIP)' + (T.lab.length ? " · " + chip("wa", T.lab.length + " sem USER LABEL") : "") + "</h3>" +
        '<div class="tw"><table class="r4t"><thead><tr><th>SN</th><th>Porta</th><th>IP / máscara</th><th>USER LABEL</th><th>Sugestão (confirme para entrar no script)</th></tr></thead><tbody>' +
        T.dev.map(function (d) {
          var lb = T.lab.filter(function (x) { return x.d === d; })[0], ref = T.ref === d;
          var sug = !lb ? "" : !lb.ok ? '<span class="muted">placa/porta sem código MML conhecido — ajuste à mão</span>' :
            '<input class="lab" list="r4TxLabDl" data-lab="' + esc(d.ip) + '" value="' + esc(lb.txt) + '" placeholder="escolha o texto"> <label style="font-size:12px;font-weight:600"><input type="checkbox" data-labon="' + esc(d.ip) + '"' + (lb.on ? " checked" : "") + (lb.txt ? "" : " disabled") + "> confirmo</label>" +
            '<div class="muted" style="font-size:11px">' + esc(lb.why) + "</div>";
          return '<tr class="' + (/vivo/i.test(d.label) || d.ip === V.infra || d.ip === V.s1x2 ? "vivo" : "") + '"><td class="mono">' + esc(d.sn) + '</td><td>' + esc(d.pt + " " + d.pn) + (ref ? " " + chip("in", "ref. ETH") : "") + '</td><td class="mono">' + esc(d.ip + " / " + d.mask) + "</td><td>" + (d.label ? esc(d.label) : chip("wa", "vazio")) + "</td><td>" + sug + "</td></tr>";
        }).join("") + "</tbody></table></div>" + opts;
    }
    // parâmetros
    $("r4TxPar").innerHTML = '<div class="r4-par">' + TX_PAR.map(function (x) {
      var k = x[0], chg = p[k] != null && String(p[k]).trim() !== "" && String(p[k]).trim() !== T.def[k];
      return "<label>" + esc(x[1]) + '<input data-txp="' + k + '" value="' + esc(T.p[k]) + '"' + (chg ? ' class="chg" title="editado (calculado: ' + esc(T.def[k]) + ')"' : "") + "></label>";
    }).join("") + "</div>";
    // pendências
    $("r4TxMsg").innerHTML = (T.block.length ? '<div class="r4-msg er"><b>Antes de gerar a configuração:</b><ul>' + T.block.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : T.hasRead ? '<div class="r4-msg ok">Conferências OK — o script não repete nada que já existe no site.</div>' : "") +
      (T.warn.length ? '<div class="r4-msg wa"><b>Atenção</b><ul>' + T.warn.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "");
    // PINGs
    $("r4TxPing").innerHTML = T.pings.length ? '<h3 style="font-size:14px;margin:0 0 6px">Testes de PING (origem ' + esc(V.s1x2 || "S1/X2 VIVO") + ")</h3>" +
      '<div class="tw"><table class="r4t"><thead><tr><th>Destino</th><th>IP</th><th>Resultado</th><th>Detalhe</th><th>Quando</th></tr></thead><tbody>' +
      T.pings.map(function (x) { var r = T.res[x.ip]; return "<tr><td><b>" + esc(x.nm) + '</b></td><td class="mono">' + esc(x.ip) + "</td><td>" + (r ? chip(r.ok ? "ok" : "er", r.ok ? "OK" : "NOK") : chip("", "não testado")) + '</td><td style="font-size:12px">' + esc(r ? r.msg : "") + '</td><td style="font-size:12px">' + esc(r ? r.at : "") + "</td></tr>"; }).join("") +
      "</tbody></table></div>" + (Object.keys(T.res).length ? '<div class="row"><button class="ghost" type="button" id="r4TxPingClr">Limpar resultados de PING</button></div>' : "") : "";
    if ($("r4TxPingClr")) $("r4TxPingClr").addEventListener("click", function () { lsSet(LS_TXPING + core(S.site), {}); render(); });
    // script
    var txt = S.site ? txScript(T) : "// Informe o site na seção 2 (ou carregue na Entrada).";
    S.txAuto = txt;
    if (!S.txDirty) $("r4TxOut").value = txt;
    $("r4TxOutSt").textContent = S.txDirty ? "script editado à mão — Regerar para atualizar" : "";
  }
  // eventos da etapa 0 (delegados: o conteúdo é redesenhado a cada render)
  $("r4TxCard").addEventListener("change", function (e) {
    var el = e.target, p = txP(), k;
    if ((k = el.getAttribute("data-txv"))) { p[k] = el.value.trim(); if (!p[k]) delete p[k]; }
    else if ((k = el.getAttribute("data-txp"))) { p[k] = el.value.trim(); if (!p[k]) delete p[k]; }
    else if ((k = el.getAttribute("data-lab"))) { p.lab = p.lab || {}; var o = p.lab[k] || (p.lab[k] = {}); o.t = el.value.trim(); if (!o.t) o.on = false; }
    else if ((k = el.getAttribute("data-labon"))) { p.lab = p.lab || {}; var o2 = p.lab[k] || (p.lab[k] = {}); o2.on = el.checked; if (o2.t == null) { var lb = M.tx.lab.filter(function (x) { return x.d.ip === k; })[0]; o2.t = lb ? lb.txt : ""; } }
    else if (el.id === "r4TxGrp") { if (el.value === "") delete p.grp; else p.grp = el.value; }
    else return;
    txSave(); S.txDirty = false; render();
  });
  $("r4TxOut").addEventListener("input", function () { S.txDirty = this.value !== S.txAuto; $("r4TxOutSt").textContent = S.txDirty ? "script editado à mão — Regerar para atualizar" : ""; });
  $("r4TxRegen").addEventListener("click", function () { S.txDirty = false; render(); });
  $("r4TxCopy").addEventListener("click", function () { copyText($("r4TxOut").value, this); });
  $("r4TxDl").addEventListener("click", function () {
    var a = document.createElement("a"), b = new Blob([$("r4TxOut").value.replace(/\n/g, "\r\n")], { type: "text/plain" });
    a.href = URL.createObjectURL(b); a.download = "TX_VIVO_" + (S.site || "site") + ".txt"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  });
  function saveTxRead() { if (S.site) lsSet(LS_TXR + core(S.site), { t: S.txRead, at: S.txReadAt }); }
  function loadTxRead() { var st = lsGet(LS_TXR + core(S.site), null); S.txRead = st ? st.t : ""; S.txReadAt = st ? st.at : ""; $("r4TxRead").value = S.txRead; S.txDirty = false; }
  $("r4TxReadGo").addEventListener("click", function () { S.txRead = $("r4TxRead").value; S.txReadAt = now(); saveTxRead(); S.txDirty = false; render(); });
  $("r4TxReadClr").addEventListener("click", function () { $("r4TxRead").value = ""; S.txRead = ""; S.txReadAt = ""; saveTxRead(); render(); });
  $("r4TxEngGo").addEventListener("click", function () { var p = txP(); p.engTxt = $("r4TxEngTxt").value; txSave(); render(); });
  $("r4TxEngClr").addEventListener("click", function () { var p = txP(); delete p.engTxt; $("r4TxEngTxt").value = ""; txSave(); render(); });
  function readFile(inp, fn, stEl) {
    var f = inp.files[0]; if (!f) return;
    $(stEl).innerHTML = chip("in", "lendo…") + " " + esc(f.name);
    f.arrayBuffer().then(function (ab) { return fn(ab, f.name); }).catch(function (e) { $(stEl).innerHTML = chip("er", "erro") + " " + esc(e.message); }).then(function () { inp.value = ""; });
  }
  $("r4TxEngFile").addEventListener("change", function () {
    readFile(this, function (ab, n) { ENG = parseEngBook(ab, n); idbSet("engsi", ENG).catch(function () {}); render(); }, "r4TxEngSt");
  });
  $("r4TxGwFile").addEventListener("change", function () {
    readFile(this, function (ab, n) { TXGW = parseGwBook(ab, n); lsSet(LS_TXGW, TXGW); render(); }, "r4TxGwSt");
  });
  $("r4TxGwDef").addEventListener("click", function () { TXGW = TX_GW_DEF; try { localStorage.removeItem(LS_TXGW); } catch (e) {} render(); });
  $("r4TxReadMae").addEventListener("click", async function () {
    var btn = this, st = $("r4TxReadSt"), ne = S.site || loadedSite();
    if (!ne) { st.textContent = "Informe o site."; return; }
    if (!window.MAE) { st.textContent = "Painel do MAE não carregado."; return; }
    var s = window.MAE.state();
    if (!s.online || !s.logged) { st.textContent = "Conecte no MAE (aba Entrada → Executar no MAE)."; return; }
    if (s.busy) { st.textContent = "O painel do MAE está ocupado — tente em instantes."; return; }
    btn.disabled = true; window.MAE.setBusy(true);
    st.textContent = "lendo " + ne + " (" + TX_READ.length + " comandos)…";
    try {
      var r = await call("/run", { ne: ne, cmds: TX_READ });
      if (r.status !== 200 || !Array.isArray(r.j)) throw new Error((r.j && (r.j.message || r.j.error)) || ("erro HTTP " + r.status));
      if (r.j[0] && /^REG NE/i.test(r.j[0].cmd || "") && !r.j[0].ok) throw new Error("REG NE falhou para " + ne);
      var txt = r.j.filter(function (y) { return !/^(REG|UNREG) NE/i.test(y.cmd || ""); }).map(function (y) { return "%%/*0*/" + (y.cmd || "") + "%%\n" + (y.resp || ""); }).join("\n");
      if (core(ne) !== core(S.site)) setSite(ne, true);
      $("r4TxRead").value = txt; S.txRead = txt; S.txReadAt = now(); saveTxRead(); S.txDirty = false;
      render();
    } catch (e) { st.textContent = "✖ " + e.message; }
    finally { await call("/unreg", {}).catch(function () {}); window.MAE.setBusy(false); btn.disabled = false; }
  });
  // resultado de cada PING executado pelo "Executar no site" (mae_exec.js)
  window.addEventListener("mae:ping", function (e) {
    var x = e.detail || {}; if (!x.ne || !x.ip) return;
    var k = LS_TXPING + core(x.ne), o = lsGet(k, {});
    o[x.ip] = { ok: !!x.ok, msg: x.msg || "", at: now() }; lsSet(k, o);
    if (core(x.ne) === core(S.site)) render();
  });

  var PAR = [["mme1", "IP MME 1 VIVO (SIGIP1V4)"], ["mme2", "IP MME 2 VIVO (SIGIP1V4)"], ["peer1", "SCTPPEER ID MME 1"], ["peer2", "SCTPPEER ID MME 2"],
    ["epgS1", "EPGROUP S1_VIVO"], ["epgX2", "EPGROUP x2_VIVO"], ["sctpS1", "SCTPHOST do S1 VIVO"], ["sctpX2", "SCTPHOST do X2"],
    ["upS1", "UPHOST do S1"], ["upX2", "UPHOST do X2"], ["s1Id", "S1 ID VIVO"], ["x2Id", "X2 ID VIVO"], ["aid", "APP do eNodeB (RST APP AID)"], ["wait", "1ª espera após RST APP (s)"]];
  function renderPar() {
    var u = U();
    $("r4Par").innerHTML = (M.mmeDefault ? '<div class="r4-msg wa">IPs do MME VIVO: usando o exemplo do roteiro (10.69.210.140 / 10.69.7.140). Escolha o grupo na etapa 0 (a) ou troque aqui — ficam salvos para a UF ' + esc(M.uf || "?") + ".</div>" :
        M.mmeFrom ? '<div class="r4-msg ok" style="font-size:12.5px">MME VIVO: ' + esc(M.mmeFrom) + "</div>" : "") +
      '<div class="r4-par">' + PAR.map(function (x) {
        var k = x[0], chg = u.p[k] != null && String(u.p[k]).trim() !== "" && String(u.p[k]).trim() !== M.def[k];
        return "<label>" + esc(x[1]) + '<input data-par="' + k + '" value="' + esc(M.p[k]) + '"' + (chg ? ' class="chg" title="valor editado (calculado: ' + esc(M.def[k]) + ')"' : "") + "></label>";
      }).join("") + "</div>" +
      '<p class="muted" style="font-size:12px;margin:6px 0 0">' + (M.hostFromTx ? "SCTPHOST/UPHOST: os da VIVO da etapa 0 (S1 " + esc(M.tx.p.hS1) + " · X2 " + esc(M.tx.p.hX2) + " · UP " + esc(M.tx.p.up) + ")." :
        "SCTPHOST/UPHOST: sem TX VIVO na etapa 0 — usando os mesmos do S1/X2 da TIM (LST SCTPHOST2EPGRP / UPHOST2EPGRP).") + " IDs novos só pulam se já estiverem em uso no site.</p>";
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
      loadTxRead();
    }
    $("r4TxEngTxt").value = txP().engTxt || "";
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
    pingParse: pingParse,
    _t: { parseMou: parseMou, readAll: readAll, model: function () { return model(); }, script: function () { return script(model()); }, state: S,
      tx: function () { return model().tx; }, txScript: function () { return txScript(model().tx); }, engCands: engCands, textRows: textRows, parseEngBook: parseEngBook, gwFind: gwFind, parseGwBook: parseGwBook,
      setEng: function (e) { ENG = e; render(); } }
  };

  mouStatus(); drawList(); render();
  idbGet("engsi").then(function (e) { if (e && e.sheets) { ENG = e; render(); } }).catch(function () {});
  idbGet("mou").then(function (m) {
    if (m && m.rows) { MOU = m; indexMou(); buildSites(); drawList(); mouStatus(); render(); window.dispatchEvent(new Event("rs4g:mou")); }
  }).catch(function () {});
  if (loadedSite()) onLoaded();
})();
