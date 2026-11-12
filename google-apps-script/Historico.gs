/**
 * Histórico compartilhado — TELEBIT RAN Ferramenta Huawei
 * Guarda os sites processados numa pasta do Google Drive chamada
 * "Historico Ferramenta Huawei" (criada sozinha no primeiro uso).
 * Publicar como: Implantar > Nova implantação > App da Web
 *   Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa
 */
var PASTA = 'Historico Ferramenta Huawei';

function pasta_() {
  var it = DriveApp.getFoldersByName(PASTA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA);
}
function nomeSite_(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id || ''))) throw new Error('id inválido');
  return 'site_' + id + '.json';
}
function ler_(nome) {
  var it = pasta_().getFilesByName(nome);
  return it.hasNext() ? JSON.parse(it.next().getBlob().getDataAsString('UTF-8')) : null;
}
function gravar_(nome, obj) {
  var f = pasta_(), it = f.getFilesByName(nome), txt = JSON.stringify(obj);
  if (it.hasNext()) it.next().setContent(txt);
  else f.createFile(nome, txt, 'application/json');
}
function indice_() {
  var ix = ler_('index.json') || {};
  ix.sites = ix.sites || [];
  ix.deleted = ix.deleted || {};
  return ix;
}
function saida_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Leitura: ?a=index (lista dos sites) ou ?a=get&id=... (site completo)
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.a === 'get') {
      var site = ler_(nomeSite_(p.id));
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
    var d = JSON.parse(e.postData.contents), ix = indice_();
    if (d.a === 'put') {
      var s = d.site, atual = ix.sites.filter(function (x) { return x.id === s.id; })[0];
      if (!atual || (s.updated || 0) >= (atual.updated || 0)) {
        gravar_(nomeSite_(s.id), s);
        ix.sites = ix.sites.filter(function (x) { return x.id !== s.id; });
        ix.sites.push(d.resumo);
        delete ix.deleted[s.id];
        gravar_('index.json', ix);
      }
    } else if (d.a === 'del') {
      var it = pasta_().getFilesByName(nomeSite_(d.id));
      while (it.hasNext()) it.next().setTrashed(true);
      ix.sites = ix.sites.filter(function (x) { return x.id !== d.id; });
      ix.deleted[d.id] = Date.now();
      gravar_('index.json', ix);
    } else {
      throw new Error('ação desconhecida');
    }
    return saida_({ ok: true, index: ix });
  } catch (err) {
    return saida_({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}
