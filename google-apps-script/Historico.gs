/**
 * @OnlyCurrentDoc
 *
 * Histórico compartilhado — TELEBIT RAN Ferramenta Huawei
 * Este script fica DENTRO de uma planilha Google (Extensões > Apps Script)
 * e só tem acesso a essa planilha.
 *   Aba "sites":      uma linha por site (id · atualizado · resumo · conteúdo em pedaços)
 *   Aba "excluidos":  sites apagados (para sumirem de todos os computadores)
 * Publicar como: Implantar > Nova implantação > App da Web
 *   Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa
 */
var ABA = 'sites', ABA_DEL = 'excluidos', PEDACO = 45000;

function aba_(nome) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nome) || ss.insertSheet(nome);
}
// cada texto é gravado com "_" na frente para a planilha não transformar em número, data ou fórmula
function txt_(v) { return String(v).slice(1); }
function linhas_(sh) {
  var n = sh.getLastRow();
  return n ? sh.getRange(1, 1, n, 3).getValues() : [];
}
function acha_(sh, id) {
  var v = linhas_(sh);
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === String(id)) return i + 1;
  return 0;
}
function indice_() {
  var sites = linhas_(aba_(ABA)).filter(function (r) { return r[0] !== ''; })
    .map(function (r) { return JSON.parse(txt_(r[2])); });
  var del = {}, d = aba_(ABA_DEL), n = d.getLastRow();
  if (n) d.getRange(1, 1, n, 2).getValues().forEach(function (r) { if (r[0] !== '') del[r[0]] = Number(r[1]); });
  return { sites: sites, deleted: del };
}
function lerSite_(id) {
  var sh = aba_(ABA), r = acha_(sh, id);
  if (!r) return null;
  var w = sh.getLastColumn();
  if (w < 4) return null;
  var partes = sh.getRange(r, 4, 1, w - 3).getValues()[0].filter(function (v) { return v !== ''; }).map(txt_);
  return JSON.parse(partes.join(''));
}
function gravarSite_(s, resumo) {
  var sh = aba_(ABA), r = acha_(sh, s.id) || sh.getLastRow() + 1;
  var t = JSON.stringify(s), partes = [];
  for (var i = 0; i < t.length; i += PEDACO) partes.push('_' + t.substr(i, PEDACO));
  var precisa = 3 + partes.length;
  if (sh.getMaxColumns() < precisa) sh.insertColumnsAfter(sh.getMaxColumns(), precisa - sh.getMaxColumns());
  var w = sh.getLastColumn();
  if (w > 3) sh.getRange(r, 4, 1, w - 3).clearContent();
  sh.getRange(r, 1, 1, 3).setValues([[s.id, s.updated || 0, '_' + JSON.stringify(resumo)]]);
  sh.getRange(r, 4, 1, partes.length).setValues([partes]);
}
function tirarExcluido_(id) {
  var d = aba_(ABA_DEL), r = acha_(d, id);
  if (r) d.deleteRow(r);
}
function saida_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Leitura: ?a=index (lista dos sites) ou ?a=get&id=... (site completo)
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.a === 'get') {
      var site = lerSite_(p.id);
      return saida_(site ? { ok: true, site: site } : { ok: false, erro: 'site não encontrado no histórico compartilhado' });
    }
    return saida_({ ok: true, index: indice_() });
  } catch (err) {
    return saida_({ ok: false, erro: String(err) });
  }
}

// Gravação: { a: "put", site, resumo }  ou  { a: "del", id }
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.a === 'put') {
      var s = d.site, sh = aba_(ABA), r = acha_(sh, s.id);
      var atual = r ? Number(sh.getRange(r, 2).getValue()) : 0;
      if (!r || (s.updated || 0) >= atual) {
        gravarSite_(s, d.resumo);
        tirarExcluido_(s.id);
      }
    } else if (d.a === 'del') {
      var sh2 = aba_(ABA), r2 = acha_(sh2, d.id);
      if (r2) sh2.deleteRow(r2);
      tirarExcluido_(d.id);
      aba_(ABA_DEL).appendRow([d.id, Date.now()]);
    } else {
      throw new Error('ação desconhecida');
    }
    return saida_({ ok: true, index: indice_() });
  } catch (err) {
    return saida_({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}
