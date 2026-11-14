/* sw_cfgfile.js — aba 9 "SW & CFGFILE" do Baseline Huawei.
   · Software : gera DLD / ACT / SPL SOFTWARE por perfil e aplica no site.
   · CFGFILE  : envia um XML ao servidor de arquivos (pelo helper) e manda a BBU executar DLD CFGFILE.
   · Status e logs: acompanhamento, histórico da sessão e ajustes de espera.
   Usa a conexão do painel "Executar no MAE" (mae_bridge.js) e o helper v3.2+ (rotas /job/* e /file-server/*).
   Os comandos demorados rodam em segundo plano no helper: a página só consulta o andamento, então
   dá para trocar de aba à vontade.
   SENHAS: ficam só nos campos de senha (memória da página). Nunca vão para localStorage, logs ou tela;
   tudo que é exibido/copiado/exportado sai como PWD="********". */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var pane = $("pane-sw");
  if (!pane) return;
  if (!window.MAE) { pane.innerHTML = '<p class="muted" style="padding:20px">Painel do MAE (mae_bridge.js) não carregado.</p>'; return; }

  var HELPER = "http://127.0.0.1:8765", MINV = 3.2, LS_KEY = "swCfgV1";
  var MASK = 'PWD="********"';
  var mask = function (s) { return String(s || "").replace(/PWD\s*=\s*"[^"]*"/gi, MASK); };

  // ---------- perfis de software (do arquivo de especificação) ----------
  var SW_ROOT = "/ftproot/ROSA/Software/";
  var PROF = {
    r19_220: { name: "RAN19 · SPC220", kind: "dld", sv: "BTS3900_5900 V100R018C10SPC220", swt: "SOFTWARE", atl: "eNodeB" },
    r19_260: { name: "RAN19 · SPC260", kind: "dld", sv: "BTS3900_5900 V100R019C10SPC260", swt: "SOFTWARE", atl: "eNodeB" },
    r20_270: { name: "RAN20 · SPC270", kind: "dld", sv: "BTS3900_5900 V100R020C10SPC270", swt: "SOFTWARE", atl: "NodeB&eNodeB" },
    spl:     { name: "Supply software", kind: "spl", sv: "BTS3900_5900 V100R020C10SPC270", swt: "SOFTWARE", atl: "" },
    bls:     { name: "BLS software", kind: "dld", sv: "BTS3900_5900 BLS V100R020C10SPC270", swt: "EXTSW", atl: "" },
    custom:  { name: "Personalizado", kind: "dld", sv: "", swt: "SOFTWARE", atl: "" }
  };

  // ---------- estilo ----------
  var st = document.createElement("style");
  st.textContent = [
    "#pane-sw .sw-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border:1px solid var(--border);background:var(--surface);border-radius:var(--radius);padding:12px 16px;margin-bottom:14px}",
    "#pane-sw .sw-top b.t{font-size:15px}",
    "#pane-sw input[type=text],#pane-sw input[type=password],#pane-sw input[type=number],#pane-sw select{font-family:var(--font);font-size:13.5px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);width:100%}",
    "#pane-sw input.mono,#pane-sw #swNe{font-family:Consolas,'Courier New',monospace}",
    "#pane-sw #swNe{width:260px}",
    "#pane-sw .sw-chip{font-size:12.5px;font-weight:600;border-radius:12px;padding:3px 10px;white-space:nowrap}",
    "#pane-sw .c-ok{background:#e3f6ea;color:#16613a}#pane-sw .c-er{background:#fdecec;color:#c7000b}#pane-sw .c-wt{background:#fff3dc;color:#8a5a00}#pane-sw .c-run{background:#e6eeff;color:#2452c4}#pane-sw .c-no{background:#eceef2;color:#667085}",
    "#pane-sw .sw-sub{display:flex;gap:6px;margin-bottom:14px;border-bottom:2px solid var(--border)}",
    "#pane-sw .sw-sub button{font:600 14px var(--font);background:none;border:0;border-bottom:3px solid transparent;margin-bottom:-2px;padding:9px 16px;cursor:pointer;color:var(--text-muted)}",
    "#pane-sw .sw-sub button[aria-selected=true]{color:var(--accent);border-bottom-color:var(--accent)}",
    "#pane-sw .sw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:16px;align-items:start}",
    "#pane-sw .step{margin:0}",
    "#pane-sw .sw-f{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px 12px;margin-top:10px}",
    "#pane-sw .sw-f label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--text-muted);font-weight:600}",
    "#pane-sw .sw-f label.w2{grid-column:span 2}#pane-sw .sw-f label.wf{grid-column:1/-1}",
    "#pane-sw label.chk{display:flex;gap:7px;align-items:center;font-size:13.5px;color:var(--text);margin-top:10px;font-weight:400}",
    "#pane-sw label.chk input{width:auto}",
    "#pane-sw .sw-cmd{margin:10px 0 0;background:var(--mono-bg);border:1px solid var(--mono-border);color:var(--mono-text);font:12.5px/1.5 Consolas,'Courier New',monospace;border-radius:6px;padding:10px 12px;white-space:pre-wrap;word-break:break-all;min-height:40px;max-height:260px;overflow:auto}",
    "#pane-sw .sw-cmd.resp{color:#c9d1d9;max-height:320px}",
    "#pane-sw .sw-warn{background:var(--warning-bg);color:var(--warning);border-radius:6px;padding:8px 12px;margin-top:10px;font-size:13px}",
    "#pane-sw .sw-note{color:var(--text-muted);font-size:12.5px;margin:6px 0 0}",
    "#pane-sw .sw-res{display:grid;grid-template-columns:150px 1fr;gap:8px 12px;margin-top:12px;align-items:start;font-size:13px}",
    "#pane-sw .sw-res>span{color:var(--text-muted);font-weight:600;padding-top:3px}",
    "#pane-sw .sw-res .sw-cmd{margin:0}",
    "#pane-sw button.danger{font-family:'Segoe UI',Arial,sans-serif;font-weight:600;font-size:13.5px;border-radius:6px;padding:9px 16px;cursor:pointer;border:1px solid #c7000b;background:#fff;color:#c7000b}",
    "#pane-sw button.danger:hover:not(:disabled){background:#c7000b;color:#fff}",
    "#pane-sw button:disabled{opacity:.5;cursor:not-allowed}",
    "#pane-sw table.sw-t{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:10px}",
    "#pane-sw table.sw-t th{text-align:left;color:var(--text-muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--surface-alt);white-space:nowrap}",
    "#pane-sw table.sw-t td{padding:6px 8px;border-bottom:1px solid #eef0f4;vertical-align:top}",
    "#pane-sw table.sw-t td.m,#pane-sw table.sw-t td div.m{font-family:Consolas,'Courier New',monospace;word-break:break-all}",
    "#pane-sw table.sw-t td.sum{min-width:340px;word-break:break-word}",
    "#pane-sw .sw-scroll{max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:6px;margin-top:10px}",
    "#pane-sw .sw-scroll table.sw-t{margin:0}",
    "#pane-sw .sw-job{border:1px solid var(--border);border-left:5px solid #2452c4;background:var(--surface);border-radius:var(--radius);padding:12px 16px;margin-bottom:12px}",
    "#pane-sw .sw-job.done{border-left-color:#16613a}#pane-sw .sw-job.failed{border-left-color:#c7000b}#pane-sw .sw-job.canceled{border-left-color:#98a2b3}",
    "#pane-sw .sw-job h3{margin:0;font-size:15px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
    "#pane-sw .sw-job h3 .sp{flex:1}",
    "#pane-sw .sw-bar{height:18px;background:#eceef2;border-radius:9px;overflow:hidden;margin:10px 0 6px;position:relative}",
    "#pane-sw .sw-bar i{display:block;height:100%;width:0;background:#2452c4;transition:width .4s}",
    "#pane-sw .sw-job.done .sw-bar i{background:#16613a}#pane-sw .sw-job.failed .sw-bar i{background:#c7000b}#pane-sw .sw-job.canceled .sw-bar i{background:#98a2b3}",
    "#pane-sw .sw-bar b{position:absolute;inset:0;text-align:center;font:600 12px/18px Consolas,monospace;color:#1d2433}",
    "#pane-sw .sw-steps{display:flex;flex-direction:column;gap:4px;font-size:13px;margin-top:6px}",
    "#pane-sw .sw-steps div{display:flex;gap:8px;align-items:baseline}",
    "#pane-sw .sw-steps code{font-family:Consolas,'Courier New',monospace;font-size:12px;color:var(--text-muted);word-break:break-all}",
    "#pane-sw details summary{cursor:pointer;color:var(--text-muted);font-size:12.5px;margin-top:8px}",
    "#swOv{position:fixed;inset:0;background:rgba(15,20,30,.55);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',Arial,sans-serif;font-size:13.5px;color:#1d2433}",
    "#swOv .box{background:#fff;border-radius:12px;width:min(760px,94vw);max-height:90vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:20px 22px}",
    "#swOv h3{margin:0 0 10px;font-size:18px}",
    "#swOv dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;margin:10px 0}#swOv dt{color:#667085;font-weight:600}#swOv dd{margin:0;font-family:Consolas,'Courier New',monospace;word-break:break-all}",
    "#swOv pre{background:#111827;color:#a7f3d0;font:12.5px/1.5 Consolas,monospace;border-radius:6px;padding:10px 12px;white-space:pre-wrap;word-break:break-all;margin:10px 0}",
    "#swOv .dg{background:#fdecec;color:#9d0009;border-radius:6px;padding:10px 12px;margin:10px 0;font-weight:600}",
    "#swOv input{font:14px Consolas,'Courier New',monospace;padding:9px 10px;border:2px solid #c7000b;border-radius:6px;width:100%}",
    "#swOv .bt{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}",
    "#swOv button{font-family:'Segoe UI',Arial,sans-serif;font-weight:600;font-size:13.5px;border-radius:6px;padding:9px 18px;cursor:pointer;border:1px solid #dfe3eb;background:#fff;color:#1d2433}",
    "#swOv button.ok{background:#16613a;border-color:#16613a;color:#fff}#swOv button.ok.dan{background:#c7000b;border-color:#c7000b}",
    "#swOv button:disabled{opacity:.45;cursor:not-allowed}"
  ].join("\n");
  document.head.appendChild(st);

  // ---------- HTML ----------
  function fld(label, id, attrs, cls) { return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + label + '<input id="' + id + '" ' + (attrs || 'type="text"') + ' spellcheck="false" autocomplete="off"></label>'; }
  function pwd(label, id) { return '<label>' + label + '<input id="' + id + '" type="password" autocomplete="new-password" placeholder="digite nesta sessão"></label>'; }

  pane.innerHTML =
    '<div class="sw-top">' +
      '<b class="t">Site (NE / BBU)</b>' +
      '<input type="text" id="swNe" list="swNeList" placeholder="ex.: SR-LCDP01" spellcheck="false" autocomplete="off"><datalist id="swNeList"></datalist>' +
      '<button class="ghost" type="button" id="swNeUse">Usar site carregado</button>' +
      '<span class="sw-chip c-no" id="swConn">verificando…</span>' +
      '<button class="ghost" type="button" data-goto="in" id="swGoIn" hidden>Conectar na aba Entrada</button>' +
    '</div>' +
    '<div class="sw-warn" id="swOld" hidden>⚠ O helper deste PC é antigo e não tem as funções desta aba. <a id="swInst" download="Instalar_Helper_MML.bat" href="tools/Instalar_Helper_MML.bat"><b>Baixar o instalador atualizado</b></a>, abrir o arquivo e aguardar o “PRONTO”.</div>' +
    '<div id="swJobs"></div>' +
    '<nav class="sw-sub" role="tablist">' +
      '<button type="button" role="tab" id="swT-cfg" aria-selected="true">CFGFILE</button>' +
      '<button type="button" role="tab" id="swT-sw" aria-selected="false">Software</button>' +
      '<button type="button" role="tab" id="swT-log" aria-selected="false">Status e logs <span class="sw-chip c-no" id="swLogN">0</span></button>' +
    '</nav>' +

    // ===== CFGFILE =====
    '<div id="swP-cfg"><div class="sw-grid">' +
      '<section class="step"><div class="step-head"><span class="step-num">1</span><h2>Enviar o XML ao servidor de arquivos</h2></div>' +
        '<p class="instr">O arquivo sai deste PC, passa pelo helper e é gravado na pasta do servidor.</p>' +
        '<div class="row" style="margin-top:0"><input type="file" id="cfFile" accept=".xml,text/xml,application/xml"><span id="cfFileInfo" class="muted"></span></div>' +
        '<div class="sw-f">' +
          fld("Servidor (upload)", "cfHost", 'type="text" class="mono"') +
          '<label>Protocolo<select id="cfProto"><option>FTP</option><option>SFTP</option></select></label>' +
          fld("Porta", "cfPort", 'type="number" min="1" max="65535"') +
          fld("Usuário", "cfUser") + pwd("Senha", "cfPwd") +
          fld("Diretório remoto", "cfDir", 'type="text" class="mono"', "w2") +
          fld("Nome remoto do arquivo", "cfName", 'type="text" class="mono"', "w2") +
        '</div>' +
        '<div class="row">' +
          '<button class="ghost" type="button" id="cfTest">Testar conexão</button>' +
          '<button class="ghost" type="button" id="cfList">Listar diretório</button>' +
          '<button class="primary" type="button" id="cfSend">Enviar XML</button>' +
        '</div>' +
        '<div id="cfOut"></div>' +
      '</section>' +
      '<section class="step"><div class="step-head"><span class="step-num">2</span><h2>Mandar a BBU carregar (DLD CFGFILE)</h2></div>' +
        '<p class="instr">Liberado depois que o upload for confirmado. Estes são os dados que <b>o site</b> usa para buscar o arquivo.</p>' +
        '<div class="sw-f">' +
          fld("IP no comando (visto pelo site)", "ccIp", 'type="text" class="mono"') +
          fld("USR no comando", "ccUser") +
          pwd("PWD no comando", "ccPwd") +
          fld("DIR no comando", "ccDir", 'type="text" class="mono"', "w2") +
          '<label>ENCRYPTMODE<input id="ccEnc" type="text" list="ccEncL" spellcheck="false" autocomplete="off"><datalist id="ccEncL"><option>UNENCRYPTED</option><option>ENCRYPTED</option></datalist></label>' +
          '<label>FOCDLD<select id="ccFoc"><option>TRUE</option><option>FALSE</option></select></label>' +
        '</div>' +
        '<label class="chk"><input type="checkbox" id="ccSame" checked> PWD do comando é a mesma senha do upload</label>' +
        '<label class="chk"><input type="checkbox" id="ccAct"> Executar <b>ACT CFGFILE: MOD=IMMEDIATELY;</b> logo depois do download (o site reinicia)</label>' +
        '<div class="row">' +
          '<button class="ghost" type="button" id="ccGen" disabled>Gerar comando</button>' +
          '<button class="primary" type="button" id="ccRun" disabled>Executar na BBU</button>' +
          '<button class="ghost" type="button" id="ccCopy" disabled>Copiar comando</button>' +
          '<button class="danger" type="button" id="ccActNow">ACT CFGFILE agora</button>' +
          '<button class="ghost" type="button" id="ccClear">Limpar resultado</button>' +
        '</div>' +
        '<div class="sw-res">' +
          '<span>Upload</span><div id="rsUp"><span class="sw-chip c-no">não iniciado</span></div>' +
          '<span>Caminho remoto</span><div id="rsPath" class="mono">—</div>' +
          '<span>Comando</span><div class="sw-cmd" id="rsCmd">—</div>' +
          '<span>Execução</span><div id="rsRun"><span class="sw-chip c-no">não iniciado</span></div>' +
          '<span>RETCODE</span><div id="rsRet" class="mono">—</div>' +
          '<span>Resposta MML</span><div class="sw-cmd resp" id="rsResp">—</div>' +
        '</div>' +
      '</section>' +
    '</div></div>' +

    // ===== Software =====
    '<div id="swP-sw" hidden><div class="sw-grid">' +
      '<section class="step"><div class="step-head"><span class="step-num">1</span><h2>Escolher a versão</h2></div>' +
        '<p class="instr">Os pacotes já estão no servidor; aqui só é gerado o comando para o site buscar.</p>' +
        '<div class="sw-f">' +
          '<label class="w2">Perfil<select id="swProf">' + Object.keys(PROF).map(function (k) { return '<option value="' + k + '">' + esc(PROF[k].name) + '</option>'; }).join("") + '</select></label>' +
          fld("Servidor (IP)", "swIp", 'type="text" class="mono"') +
          fld("Usuário (USR) *", "swUser") + pwd("Senha (PWD) *", "swPwd") +
          fld("Diretório (DIR)", "swDir", 'type="text" class="mono"', "wf") +
          fld("Versão (SV)", "swSv", 'type="text" class="mono"', "w2") +
          fld("SWT", "swSwt", 'type="text" class="mono"') + fld("ATL (vazio = não envia)", "swAtl", 'type="text" class="mono"') +
        '</div>' +
        '<label class="chk" id="swAutoL"><input type="checkbox" id="swAuto"> Executar <b>ACT SOFTWARE</b> automaticamente ao fim do download (o site reinicia)</label>' +
        '<p class="sw-note" id="swProfNote"></p>' +
      '</section>' +
      '<section class="step"><div class="step-head"><span class="step-num">2</span><h2>Comando e aplicação</h2></div>' +
        '<p class="instr">A senha aparece mascarada aqui e nos logs; a real só vai no envio ao site.</p>' +
        '<div class="sw-cmd" id="swPrev"></div>' +
        '<div class="row">' +
          '<button class="primary" type="button" id="swApply">▶ Aplicar no site</button>' +
          '<button class="danger" type="button" id="swActNow">ACT SOFTWARE agora</button>' +
          '<button class="ghost" type="button" id="swCopy">Copiar comando</button>' +
          '<button class="ghost" type="button" id="swStatus">Verificar status agora</button>' +
        '</div>' +
        '<p class="sw-note">O andamento (percentual) aparece no topo desta aba e no número da aba 9. Você pode trocar de aba enquanto o site baixa.</p>' +
        '<div class="sw-cmd resp" id="swStOut" hidden></div>' +
      '</section>' +
    '</div></div>' +

    // ===== Status e logs =====
    '<div id="swP-log" hidden><div class="sw-grid">' +
      '<section class="step" style="grid-column:1/-1"><div class="step-head"><h2>Histórico desta sessão</h2></div>' +
        '<div class="row" style="margin-top:6px"><button class="ghost" type="button" id="lgExport">Exportar log (.txt)</button><button class="ghost" type="button" id="lgClear">Limpar lista</button>' +
        '<span class="sw-chip c-ok">concluído</span><span class="sw-chip c-er">falhou</span><span class="sw-chip c-wt">aguardando</span><span class="sw-chip c-run">em execução</span><span class="sw-chip c-no">não iniciado / cancelado</span></div>' +
        '<div style="overflow:auto"><table class="sw-t"><thead><tr><th>Horário</th><th>NE</th><th>Operação</th><th>Servidor</th><th>Arquivo / versão</th><th>Estado</th><th>Resumo e comando</th></tr></thead><tbody id="lgRows"><tr><td colspan="7" class="muted">Nada executado ainda.</td></tr></tbody></table></div>' +
      '</section>' +
      '<section class="step"><div class="step-head"><h2>Ajustes de acompanhamento</h2></div>' +
        '<p class="instr">O texto final do download ainda não foi validado em campo: por isso tudo aqui é ajustável.</p>' +
        '<div class="sw-f">' +
          fld("Comando de status", "stCmd", 'type="text" class="mono"', "w2") +
          fld("Expressão do percentual", "stPct", 'type="text" class="mono"') +
          fld("Silêncio para dar por terminado (s)", "stQuiet", 'type="number" min="1" max="600"') +
          fld("Tempo máximo do download (min)", "stMax", 'type="number" min="1" max="360"') +
          fld("Expressão de FIM (opcional)", "stDone", 'type="text" class="mono" placeholder="vazio = não usa"') +
          fld("Expressão de FALHA (opcional)", "stFail", 'type="text" class="mono" placeholder="vazio = não usa"') +
          fld("Antes do ACT automático, esperar até (opcional)", "stUntil", 'type="text" class="mono" placeholder="DSP SOFTSTATUS:; | texto esperado"', "wf") +
        '</div>' +
        '<p class="sw-note">O download termina quando o site para de mandar relatórios “To be continued” <b>e</b> fica em silêncio pelo tempo acima. Qualquer RETCODE diferente de 0 encerra como falha.</p>' +
      '</section>' +
    '</div></div>';

  // ---------- valores iniciais (só dados NÃO sigilosos são lembrados) ----------
  var DEF = { cfHost: "10.220.30.9", cfProto: "FTP", cfPort: "21", cfUser: "ftpuser", cfDir: "/ftproot/ronaldinho",
    ccIp: "10.220.4.134", ccUser: "ftpuser", ccDir: "/ftproot/ronaldinho", ccEnc: "UNENCRYPTED", ccFoc: "TRUE",
    swIp: "10.220.4.134", swUser: "neftpuser",
    stCmd: "DSP SOFTSTATUS:;", stPct: "(\\d{1,3})\\s*%", stQuiet: "20", stMax: "120", stDone: "", stFail: "", stUntil: "" };
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) {}
  Object.keys(DEF).forEach(function (k) {
    $(k).value = saved[k] != null ? saved[k] : DEF[k];
    $(k).addEventListener("change", save);
  });
  function save() {
    var o = {}; Object.keys(DEF).forEach(function (k) { o[k] = $(k).value; });   // nenhum campo de senha entra aqui
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) {}
  }

  // ---------- utilidades ----------
  function now() { return new Date().toLocaleTimeString(); }
  function chip(cls, txt) { return '<span class="sw-chip ' + cls + '">' + esc(txt) + '</span>'; }
  var ST = { queued: ["c-wt", "aguardando"], running: ["c-run", "executando"], done: ["c-ok", "concluído"], failed: ["c-er", "falhou"],
    canceled: ["c-no", "cancelado"], sending: ["c-run", "enviando"], sent: ["c-ok", "enviado"], pending: ["c-no", "não iniciado"], skipped: ["c-no", "não executado"] };
  function stChip(s) { var x = ST[s] || ["c-no", s]; return chip(x[0], x[1]); }
  function call(path, body) {
    var opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(HELPER + path, opt).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: { error: "resposta inválida do helper" } }; });
    }, function () { throw new Error("helper offline — abra a aba Entrada e inicie o helper"); });
  }
  function errMsg(r) { return (r.j && (r.j.message || r.j.error)) || ("erro HTTP " + r.status); }
  function copy(txt, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = "Copiado!"; setTimeout(function () { btn.textContent = o; }, 1400); };
    function fb() { var ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fb); else fb();
  }
  function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " bytes"; }
  function fmtSecs(s) { s = Math.max(0, Math.round(s)); return (s >= 60 ? Math.floor(s / 60) + " min " : "") + (s % 60) + " s"; }
  // valores que entram entre aspas no comando MML: sem aspas, quebra de linha ou ; (não deixa "emendar" outro comando)
  function clean(v, name) {
    v = String(v || "").trim();
    if (/["\r\n;]/.test(v)) throw new Error("O campo " + name + " não pode ter aspas, ponto e vírgula ou quebra de linha.");
    return v;
  }
  function need(v, name) { if (!v) throw new Error("Preencha: " + name + "."); return v; }

  // ---------- janela de confirmação (sem alert/confirm do navegador) ----------
  function ask(o) {
    return new Promise(function (res) {
      var ov = document.createElement("div"); ov.id = "swOv";
      ov.innerHTML = '<div class="box" role="dialog" aria-modal="true"><h3>' + esc(o.title) + '</h3>' + (o.html || "") +
        (o.typed ? '<p>Para liberar, digite exatamente: <b class="mono">' + esc(o.typed) + '</b></p><input id="swOvIn" autocomplete="off" spellcheck="false">' : '') +
        '<div class="bt">' + (o.onlyOk ? '' : '<button type="button" id="swOvNo">Cancelar</button>') +
        '<button type="button" class="ok' + (o.danger ? ' dan' : '') + '" id="swOvOk"' + (o.typed ? ' disabled' : '') + '>' + esc(o.ok || "Confirmar") + '</button></div></div>';
      document.body.appendChild(ov);
      var end = function (v) { ov.remove(); document.removeEventListener("keydown", key); res(v); };
      var key = function (e) { if (e.key === "Escape") end(false); };
      document.addEventListener("keydown", key);
      $("swOvOk").onclick = function () { end(true); };
      if ($("swOvNo")) $("swOvNo").onclick = function () { end(false); };
      if (o.typed) {
        $("swOvIn").addEventListener("input", function () { $("swOvOk").disabled = this.value.trim().toUpperCase() !== o.typed.toUpperCase(); });
        $("swOvIn").addEventListener("keydown", function (e) { if (e.key === "Enter" && !$("swOvOk").disabled) end(true); });
        $("swOvIn").focus();
      } else $("swOvOk").focus();
    });
  }
  function tell(title, msg) { return ask({ title: title, html: '<p>' + esc(msg).replace(/\n/g, "<br>") + '</p>', onlyOk: true, ok: "OK" }); }

  // ---------- site / conexão ----------
  function ne() { return $("swNe").value.trim(); }
  function loadedSite() { return (($("neLbl") && $("neLbl").textContent) || "").trim(); }
  function fillNe() {
    $("swNeList").innerHTML = (window.MAE.neList() || []).map(function (n) { return '<option value="' + esc(n.name) + '">' + esc(n.type + " · " + n.ip) + '</option>'; }).join("");
  }
  $("swNe").addEventListener("focus", fillNe);
  $("swNe").addEventListener("input", function () { refreshPrev(); });
  $("swNeUse").addEventListener("click", function () {
    var s = loadedSite(); if (!s) { tell("Nenhum site carregado", "Carregue um site na aba Entrada ou digite o nome do NE aqui."); return; }
    $("swNe").value = s; refreshPrev();
  });
  function conn() {
    var s = window.MAE.state(), c = $("swConn");
    c.className = "sw-chip " + (!s.online ? "c-er" : s.logged ? "c-ok" : "c-wt");
    c.textContent = !s.online ? "helper offline" : s.logged ? "MAE conectado" + (s.user ? " · " + s.user : "") : "helper OK · MAE não conectado";
    $("swGoIn").hidden = s.online && s.logged;
    $("swOld").hidden = !(s.online && s.version != null && s.version < MINV);
    return s;
  }
  function ready() {
    var s = conn();
    if (!s.online) throw new Error("O helper está offline. Abra a aba Entrada e inicie o helper.");
    if (s.version != null && s.version < MINV) throw new Error("O helper deste PC é antigo (v" + s.version + "). Atualize pelo aviso no topo desta aba.");
    return s;
  }
  function readyMml() {
    var s = ready();
    if (!s.logged) throw new Error("Conecte no painel “Executar no MAE” da aba Entrada (usuário e senha do MAE).");
    var n = need(clean(ne(), "Site"), "o site (NE / BBU) no topo da aba");
    var list = window.MAE.neList() || [];
    var hit = list.filter(function (x) { return x.name.toUpperCase() === n.toUpperCase(); })[0];
    if (hit) { n = hit.name; $("swNe").value = n; }
    return { ne: n, known: !!hit || !list.length };
  }
  function guard(fn) {
    return function () {
      var b = this, p;
      try { p = fn.call(b); } catch (e) { tell("Não foi possível continuar", e.message); return; }
      if (p && p.then) { b.disabled = true; p.catch(function (e) { tell("Não foi possível continuar", e.message); }).then(function () { b.disabled = false; gate(); }); }
    };
  }

  // ---------- subabas ----------
  ["cfg", "sw", "log"].forEach(function (k) {
    $("swT-" + k).addEventListener("click", function () {
      ["cfg", "sw", "log"].forEach(function (x) { $("swT-" + x).setAttribute("aria-selected", x === k ? "true" : "false"); $("swP-" + x).hidden = x !== k; });
    });
  });

  // =====================================================================
  //  LOG
  // =====================================================================
  var logs = [];
  function addLog(e) {
    e.ts = e.ts || now(); e.n = logs.length; logs.push(e); drawLogs(); return e;
  }
  function drawLogs() {
    $("swLogN").textContent = logs.length;
    var open = {};
    Array.prototype.forEach.call($("lgRows").querySelectorAll("details[open]"), function (d) { open[d.getAttribute("data-n")] = 1; });
    $("lgRows").innerHTML = logs.length ? logs.slice().reverse().map(function (e) {
      return '<tr><td>' + esc(e.ts) + '</td><td class="m">' + esc(e.ne || "—") + '</td><td>' + esc(e.op) + '</td><td class="m">' + esc(e.server || "—") + '</td><td class="m">' + esc(e.item || "—") + '</td><td>' + stChip(e.state) + '</td>' +
        '<td class="sum">' + esc(e.summary || "") + (e.cmd ? '<div class="m muted" style="margin-top:3px">' + esc(mask(e.cmd)) + '</div>' : '') +
        (e.resp ? '<details data-n="' + e.n + '"' + (open[e.n] ? " open" : "") + '><summary>Resposta completa</summary><div class="sw-cmd resp">' + esc(mask(e.resp)) + '</div></details>' : '') + '</td></tr>';
    }).join("") : '<tr><td colspan="7" class="muted">Nada executado ainda.</td></tr>';
  }
  $("lgClear").addEventListener("click", function () { logs = logs.filter(function (e) { return e.state === "running" || e.state === "queued"; }); logs.forEach(function (e, i) { e.n = i; }); drawLogs(); });
  $("lgExport").addEventListener("click", function () {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    var t = "SW & CFGFILE — log da sessão — " + d.toLocaleString() + "\r\n(senhas mascaradas)\r\n";
    logs.forEach(function (e) {
      t += "\r\n==== " + e.ts + " | " + (e.ne || "-") + " | " + e.op + " | " + (ST[e.state] || ["", e.state])[1].toUpperCase() + "\r\nServidor: " + (e.server || "-") + "\r\nArquivo/versão: " + (e.item || "-") +
        "\r\nResumo: " + (e.summary || "") + (e.cmd ? "\r\nComando: " + mask(e.cmd).replace(/\n/g, "\r\n         ") : "") + (e.resp ? "\r\n--- resposta ---\r\n" + mask(e.resp).replace(/\r?\n/g, "\r\n") : "") + "\r\n";
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" }));
    a.download = "SW_CFGFILE_" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
  });

  // =====================================================================
  //  TAREFAS (comandos demorados no helper)
  // =====================================================================
  var jobs = {};          // id -> { v: visão do helper, log: entrada do log, kind }
  function settings() {
    return { pctRe: $("stPct").value.trim() || DEF.stPct, doneRe: $("stDone").value.trim(), failRe: $("stFail").value.trim(),
      quiet: parseInt($("stQuiet").value, 10) || 20, maxsec: (parseInt($("stMax").value, 10) || 120) * 60 };
  }
  async function startJob(neName, title, steps, meta, kind) {
    var s = settings();
    steps.forEach(function (x) { if (x.long) { x.quiet = s.quiet; x.maxsec = x.maxsec || s.maxsec; } });
    var r = await call("/job/start", { ne: neName, title: title, steps: steps, meta: meta, pctRe: s.pctRe, doneRe: s.doneRe, failRe: s.failRe });
    if (r.status !== 200) throw new Error(errMsg(r));
    track(r.j, kind);
    return r.j;
  }
  function track(v, kind) {
    if (jobs[v.id]) { jobs[v.id].v = v; return jobs[v.id]; }
    var m = v.meta || {};
    var e = addLog({ ne: v.ne, op: v.title, server: m.server, item: m.item, state: v.state, summary: "",
      cmd: v.steps.map(function (x) { return x.cmd; }).join("\n"), ts: new Date(v.created * 1000).toLocaleTimeString() });
    jobs[v.id] = { v: v, log: e, kind: kind || m.kind || "" };
    upd(jobs[v.id]); drawJobs(); return jobs[v.id];
  }
  function jobPct(v) {
    if (v.state === "done") return 100;
    var cur = v.steps[Math.max(0, v.cur)] || {}, n = v.steps.length;
    var base = Math.max(0, v.cur) / n;
    return Math.round((base + ((cur.pct || 0) / 100) / n) * 100);
  }
  function upd(J) {
    var v = J.v, e = J.log;
    e.state = v.state;
    e.summary = (v.note ? v.note + " " : "") + v.steps.map(function (x, i) {
      return (i + 1) + ") " + (x.label || x.cmd.split(":")[0]) + ": " + (ST[x.state] || ["", x.state])[1] + (x.state === "running" && x.pct != null ? " " + x.pct + "%" : "") + (x.msg ? " — " + x.msg : "");
    }).join(" · ");
    e.resp = v.steps.filter(function (x) { return x.resp; }).map(function (x) { return "### " + x.cmd + "\n" + x.resp; }).join("\n\n");
    if (J.kind === "cfg" && J === cfgJob) drawCfgRun();
  }
  function drawJobs() {
    var ids = Object.keys(jobs).filter(function (id) { return !jobs[id].hide; }).sort(function (a, b) { return jobs[b].v.created - jobs[a].v.created; });
    var open = {};
    Array.prototype.forEach.call($("swJobs").querySelectorAll("details[open]"), function (d) { open[d.getAttribute("data-id")] = 1; });
    $("swJobs").innerHTML = ids.map(function (id) {
      var v = jobs[id].v, act = v.state === "running" || v.state === "queued", pct = jobPct(v);
      var cur = v.steps[Math.max(0, v.cur)] || {};
      var el = (v.ended || v.now) - v.created;
      return '<div class="sw-job ' + v.state + '" data-id="' + esc(id) + '"><h3>' + esc(v.title) + ' <span class="mono">' + esc(v.ne) + '</span> ' + stChip(v.state) +
        '<span class="muted" style="font-weight:400;font-size:12.5px">' + fmtSecs(el) + '</span><span class="sp"></span>' +
        (act ? '<button class="ghost" type="button" data-stop="' + esc(id) + '">Parar de aguardar</button>' : '<button class="ghost" type="button" data-hide="' + esc(id) + '">Fechar</button>') + '</h3>' +
        '<div class="sw-bar"><i style="width:' + pct + '%"></i><b>' + (act && cur.pct == null && v.steps.length === 1 ? "aguardando percentual…" : pct + "%") + '</b></div>' +
        (v.note ? '<div class="sw-warn" style="margin:6px 0">' + esc(v.note) + '</div>' : '') +
        '<div class="sw-steps">' + v.steps.map(function (x) {
          return '<div>' + stChip(x.state) + (x.state === "running" && x.pct != null ? '<b>' + x.pct + '%</b>' : '') + '<code>' + esc(x.cmd) + '</code>' + (x.msg ? '<span class="' + (x.ok ? "muted" : "") + '" style="' + (x.ok === false ? "color:#c7000b;font-weight:600" : "") + '">' + esc(x.msg) + '</span>' : '') + '</div>';
        }).join("") + '</div>' +
        '<details data-id="' + esc(id) + '"' + (open[id] ? " open" : "") + '><summary>Resposta do site (final)</summary><div class="sw-cmd resp">' + esc(v.steps.map(function (x) { return x.resp; }).filter(Boolean).join("\n\n").slice(-6000) || "—") + '</div></details></div>';
    }).join("");
    var run = ids.map(function (id) { return jobs[id].v; }).filter(function (v) { return v.state === "running" || v.state === "queued"; });
    var b = $("bdg-sw");
    if (b) b.textContent = run.length ? (run.length === 1 ? jobPct(run[0]) + "%" : run.length + " em curso") : "";
  }
  $("swJobs").addEventListener("click", function (ev) {
    var s = ev.target.getAttribute("data-stop"), h = ev.target.getAttribute("data-hide");
    if (h) { jobs[h].hide = true; drawJobs(); }
    if (s) ask({ title: "Parar de aguardar?", html: '<p>O helper deixa de aguardar e <b>não executa os próximos passos</b> (ex.: ACT).</p><div class="dg">O que o site já começou (download em andamento) <u>não</u> é cancelado por aqui.</div>', ok: "Parar de aguardar", danger: true })
      .then(function (y) { if (y) call("/job/stop", { id: s }).catch(function () {}); });
  });
  var polling = false;
  async function poll() {
    if (polling) return; polling = true;
    try {
      var ids = Object.keys(jobs).filter(function (id) { var s = jobs[id].v.state; return s === "running" || s === "queued"; });
      for (var i = 0; i < ids.length; i++) {
        var J = jobs[ids[i]], r;
        try { r = await call("/job/status?id=" + encodeURIComponent(ids[i])); } catch (e) { continue; }   // helper caiu: tenta de novo depois
        if (r.status === 404) { J.v.state = "failed"; J.v.note = "O helper foi reiniciado e perdeu o acompanhamento. Confira no site com “Verificar status agora”."; }
        else if (r.status === 200) {
          J.v = r.j;
          if (r.j.state !== "running" && r.j.state !== "queued") {
            try { var f = await call("/job/status?full=1&id=" + encodeURIComponent(ids[i])); if (f.status === 200) J.v = f.j; } catch (e) {}
          }
        }
        upd(J);
      }
      if (ids.length) { drawJobs(); drawLogs(); }
    } finally { polling = false; }
  }
  setInterval(poll, 1500);
  // reencontra tarefas que já estavam rodando no helper (página recarregada no meio do download)
  var reattached = false;
  function reattach() {
    if (reattached) return;
    var s = window.MAE.state(); if (!s.online || (s.version != null && s.version < MINV)) return;
    reattached = true;
    call("/job/list").then(function (r) {
      if (r.status !== 200 || !Array.isArray(r.j)) return;
      r.j.forEach(function (v) {      // em andamento, ou terminadas nos últimos 15 min (para ver como acabou)
        var act = v.state === "running" || v.state === "queued";
        if (act || (v.ended && v.now - v.ended < 900)) { var J = track(v); if (!act) J.hide = true; }   // terminadas: só no histórico
      });
      drawJobs(); drawLogs();
    }).catch(function () { reattached = false; });
  }

  // =====================================================================
  //  SOFTWARE
  // =====================================================================
  function swVals(real) {
    var p = PROF[$("swProf").value];
    var o = { kind: p.kind, ip: clean($("swIp").value, "Servidor"), usr: clean($("swUser").value, "Usuário"), dir: clean($("swDir").value, "Diretório"),
      sv: clean($("swSv").value, "Versão"), swt: clean($("swSwt").value, "SWT"), atl: clean($("swAtl").value, "ATL") };
    o.pwd = real ? clean($("swPwd").value, "Senha") : "********";
    return o;
  }
  function swCmds(o) {
    var atl = o.atl ? ",ATL=" + o.atl : "";
    if (o.kind === "spl")
      return { main: 'SPL SOFTWARE:OT=SOFTWARE,MODE=IPV4,IP="' + o.ip + '",USR="' + o.usr + '",PWD="' + o.pwd + '",DIR="' + o.dir + '",SDL=YES;', act: "" };
    return { main: 'DLD SOFTWARE:MODE=IPV4,IP="' + o.ip + '",USR="' + o.usr + '",PWD="' + o.pwd + '",DIR="' + o.dir + '",SWT=' + o.swt + ',SV="' + o.sv + '"' + atl + ';',
      act: 'ACT SOFTWARE:OT=NE,SWT=' + o.swt + ',SV="' + o.sv + '"' + atl + ';' };
  }
  function swCheck(o, forAct) {
    need(o.swt, "SWT"); need(o.sv, "Versão (SV)");
    if (!forAct) { need(o.ip, "Servidor"); need(o.usr, "Usuário (USR) — obrigatório"); need(o.dir, "Diretório"); need($("swPwd").value, "Senha (PWD)"); }
  }
  function applyProf() {
    var k = $("swProf").value, p = PROF[k];
    if (k !== "custom") { $("swDir").value = SW_ROOT + p.sv; $("swSv").value = p.sv; $("swSwt").value = p.swt; $("swAtl").value = p.atl; }
    var spl = p.kind === "spl";
    $("swAuto").disabled = spl; if (spl) $("swAuto").checked = false;
    $("swAutoL").style.opacity = spl ? ".5" : "";
    $("swActNow").hidden = spl;
    $("swProfNote").textContent = spl ? "Supply: só o comando SPL SOFTWARE (sem ativação)."
      : (k === "r19_220" || k === "r19_260") ? "Para RAN19 a especificação só traz o DLD. O ACT mostrado segue o mesmo padrão do RAN20 — confira antes de ativar."
      : k === "custom" ? "Personalizado: preencha diretório, versão, SWT e ATL." : "";
    refreshPrev();
  }
  function refreshPrev() {
    var t;
    try {
      var c = swCmds(swVals(false));
      t = c.main + (c.act ? "\n" + ($("swAuto").checked ? "" : "// só se você mandar ativar:\n") + c.act : "");
    } catch (e) { t = "⚠ " + e.message; }
    $("swPrev").textContent = t;
    $("swApply").textContent = "▶ Aplicar " + (PROF[$("swProf").value].kind === "spl" ? "SPL" : "DLD" + ($("swAuto").checked ? " + ACT" : "")) + (ne() ? " em " + ne() : " no site");
  }
  ["swProf"].forEach(function (i) { $(i).addEventListener("change", applyProf); });
  ["swIp", "swUser", "swDir", "swSv", "swSwt", "swAtl", "swAuto"].forEach(function (i) { $(i).addEventListener("input", refreshPrev); $(i).addEventListener("change", refreshPrev); });

  function actWarn(neName, o, cmd, extra) {
    return '<dl><dt>Site (NE)</dt><dd>' + esc(neName) + '</dd><dt>Versão a ativar</dt><dd>' + esc(o.sv) + '</dd><dt>SWT</dt><dd>' + esc(o.swt) + '</dd><dt>ATL</dt><dd>' + esc(o.atl || "(não enviado)") + '</dd></dl>' +
      '<pre>' + esc(mask(cmd)) + '</pre>' +
      '<div class="dg">⚠ ACT SOFTWARE pode REINICIAR o site: haverá indisponibilidade de serviço até ele voltar.' + (extra || "") + '</div>';
  }
  $("swApply").addEventListener("click", guard(async function () {
    var R = readyMml(), o = swVals(true); swCheck(o);
    var c = swCmds(o), auto = $("swAuto").checked && !!c.act, verb = o.kind === "spl" ? "SPL SOFTWARE" : "DLD SOFTWARE";
    var html = (R.known ? "" : '<div class="dg">' + esc(R.ne) + ' não está na lista de NEs do MAE.</div>') +
      '<dl><dt>Site (NE)</dt><dd>' + esc(R.ne) + '</dd><dt>Versão</dt><dd>' + esc(o.sv) + '</dd><dt>Servidor</dt><dd>' + esc(o.ip) + '</dd></dl><pre>' + esc(mask(c.main)) + '</pre>' +
      '<p>O download demora; o percentual aparece no topo da aba 9 e você pode usar as outras abas.</p>';
    if (!await ask({ title: "Aplicar " + verb + " em " + R.ne + "?", html: html, ok: "Aplicar " + verb })) return;
    var steps = [{ cmd: c.main, label: verb, long: true }];
    if (auto) {
      var extra = " O ACT será enviado sozinho assim que o download terminar com sucesso.";
      if (!await ask({ title: "2ª confirmação — ACT automático em " + R.ne, html: actWarn(R.ne, o, c.act, extra), typed: "ATIVAR " + R.ne, ok: "Confirmar download + ACT", danger: true })) return;
      var u = $("stUntil").value.trim();
      if (u) { if (u.indexOf("|") < 0) throw new Error("O campo “esperar até” precisa do formato: COMANDO; | texto esperado"); steps.push({ cmd: "#UNTIL " + u, label: "Conferir fim do download", maxsec: 1800 }); }
      steps.push({ cmd: c.act, label: "ACT SOFTWARE", long: true, maxsec: 1800 });
    }
    await startJob(R.ne, (o.kind === "spl" ? "Supply software" : "Download de software") + (auto ? " + ativação" : ""), steps, { kind: "sw", server: o.ip, item: o.sv }, "sw");
  }));
  $("swActNow").addEventListener("click", guard(async function () {
    var R = readyMml(), o = swVals(false); swCheck(o, true);
    var c = swCmds(o);
    if (!await ask({ title: "ACT SOFTWARE em " + R.ne, html: actWarn(R.ne, o, c.act), typed: "ATIVAR " + R.ne, ok: "Ativar agora", danger: true })) return;
    await startJob(R.ne, "Ativação de software", [{ cmd: c.act, label: "ACT SOFTWARE", long: true, maxsec: 1800 }], { kind: "sw", item: o.sv }, "sw");
  }));
  $("swCopy").addEventListener("click", function () { copy($("swPrev").textContent.replace(/^\/\/.*\n/m, ""), this); });
  $("swStatus").addEventListener("click", guard(async function () {
    var R = readyMml(), cmd = $("stCmd").value.trim();
    if (!/^[A-Z]+\s+[A-Z0-9_]+\s*:.*;$/i.test(cmd)) throw new Error("Comando de status inválido (ajuste em Status e logs).");
    if (/^(ADD|MOD|RMV|SET|ACT|DLD|RST|BLK|UBL|STR|STP|SPL|DEA|DEL)\s/i.test(cmd)) throw new Error("O comando de status precisa ser só de consulta (LST / DSP).");
    if (window.MAE.state().busy) throw new Error("O painel do MAE está executando algo. Tente de novo em instantes.");
    var out = $("swStOut"); out.hidden = false; out.textContent = "Consultando " + R.ne + " (" + cmd + ")…";
    var e = addLog({ ne: R.ne, op: "Verificar status", item: cmd, state: "running", cmd: cmd });
    window.MAE.setBusy(true);
    try {
      var r = await call("/run", { ne: R.ne, cmds: [cmd] });
      if (r.status !== 200 || !Array.isArray(r.j)) throw new Error(errMsg(r));
      var x = r.j[r.j.length - 1];
      out.textContent = mask(r.j.map(function (y) { return y.resp; }).join("\n")).trim();
      e.state = x && x.ok ? "done" : "failed"; e.resp = out.textContent; e.summary = x && x.ok ? "RETCODE = 0" : "sem sucesso";
    } catch (er) { e.state = "failed"; e.summary = er.message; out.textContent = "✖ " + er.message; }
    finally { await call("/unreg", {}).catch(function () {}); window.MAE.setBusy(false); drawLogs(); }
  }));

  // =====================================================================
  //  CFGFILE
  // =====================================================================
  var up = null;        // { remotePath, fileName, bytes, existing } — só existe com upload CONFIRMADO
  var cfgCmd = "";      // comando gerado (com a senha real; nunca exibido)
  var cfgJob = null;
  function fsBody() {
    var proto = $("cfProto").value;
    return { host: need($("cfHost").value.trim(), "Servidor (upload)"), protocol: proto, port: parseInt($("cfPort").value, 10) || (proto === "FTP" ? 21 : 22),
      user: need($("cfUser").value.trim(), "Usuário do servidor de arquivos"), pwd: need($("cfPwd").value, "Senha do servidor de arquivos"), dir: need($("cfDir").value.trim(), "Diretório remoto") };
  }
  function nameOk(n) {
    if (!n) throw new Error("Informe o nome remoto do arquivo.");
    if (/[\/\\\x00-\x1f\x7f]/.test(n) || n.indexOf("..") >= 0) throw new Error("Nome remoto inválido: não use / \\ .. nem caracteres de controle.");
    if (!/\.xml$/i.test(n)) throw new Error("O nome remoto precisa terminar em .xml");
    return n;
  }
  function gate() {
    $("ccGen").disabled = !up; $("ccRun").disabled = !up; $("ccCopy").disabled = !cfgCmd;
    $("rsPath").textContent = up ? up.remotePath : "—";
  }
  function invalidate(why) {
    if (!up) return;
    up = null; cfgCmd = ""; $("rsCmd").textContent = "—";
    $("rsUp").innerHTML = chip("c-wt", "aguardando novo envio") + " " + esc(why);
    gate();
  }
  $("cfProto").addEventListener("change", function () { $("cfPort").value = this.value === "FTP" ? 21 : 22; save(); });
  $("cfFile").addEventListener("change", function () {
    var f = this.files[0];
    $("cfFileInfo").textContent = f ? fmtBytes(f.size) : "";
    if (f) $("cfName").value = f.name;
    invalidate("(arquivo trocado)");
  });
  $("cfName").addEventListener("input", function () { invalidate("(nome remoto alterado)"); });
  ["cfHost", "cfDir"].forEach(function (i) { $(i).addEventListener("input", function () { invalidate("(servidor ou diretório alterado)"); }); });
  var lastDir = $("cfDir").value;      // o DIR do comando acompanha o diretório do upload enquanto forem iguais
  $("cfDir").addEventListener("change", function () { if ($("ccDir").value === lastDir || !$("ccDir").value) { $("ccDir").value = this.value; save(); } lastDir = this.value; });

  $("cfTest").addEventListener("click", guard(async function () {
    ready(); var b = fsBody(); b.probe = true;
    $("cfOut").innerHTML = '<p class="sw-note">Testando ' + esc(b.host) + '…</p>';
    var e = addLog({ op: "Testar conexão", server: b.host, item: b.dir, state: "running" });
    var r = await call("/file-server/test", b);
    if (r.status !== 200) { e.state = "failed"; e.summary = errMsg(r); drawLogs(); $("cfOut").innerHTML = '<div class="sw-warn">✖ ' + esc(errMsg(r)) + '</div>'; return; }
    var j = r.j;
    e.state = j.ok ? "done" : "failed"; e.summary = j.results.map(function (x) { return x.protocol + ":" + x.port + " " + (x.login ? "OK" : x.tcp ? "login recusado" : "sem resposta"); }).join(" · "); drawLogs();
    var h = '<table class="sw-t"><thead><tr><th>Protocolo</th><th>Porta</th><th>Porta aberta</th><th>Login</th><th>Diretório</th><th>Detalhe</th></tr></thead><tbody>' +
      j.results.map(function (x) {
        return '<tr><td>' + x.protocol + '</td><td>' + x.port + '</td><td>' + (x.tcp ? chip("c-ok", "sim") : chip("c-er", "não")) + '</td><td>' + (x.login ? chip("c-ok", "OK") : chip(x.tcp ? "c-er" : "c-no", x.tcp ? "recusado" : "—")) + '</td><td>' +
          (x.dirOk == null ? chip("c-no", "—") : x.dirOk ? chip("c-ok", "OK") : chip("c-er", "não abriu")) + '</td><td>' + esc(x.message) + '</td></tr>';
      }).join("") + '</tbody></table>';
    if (j.best && (j.best.protocol !== b.protocol || j.best.port !== b.port)) {
      $("cfProto").value = j.best.protocol; $("cfPort").value = j.best.port; save();
      h += '<div class="sw-warn">Quem respondeu foi <b>' + j.best.protocol + ' na porta ' + j.best.port + '</b>: já deixei essa opção selecionada.</div>';
    }
    $("cfOut").innerHTML = h;
  }));

  $("cfList").addEventListener("click", guard(async function () {
    ready(); var b = fsBody();
    $("cfOut").innerHTML = '<p class="sw-note">Listando ' + esc(b.dir) + '…</p>';
    var e = addLog({ op: "Listar diretório", server: b.host, item: b.dir, state: "running" });
    var r = await call("/file-server/list", b);
    if (r.status !== 200) { e.state = "failed"; e.summary = errMsg(r); drawLogs(); $("cfOut").innerHTML = '<div class="sw-warn">✖ ' + esc(errMsg(r)) + '</div>'; return; }
    e.state = "done"; e.summary = r.j.total + " item(ns)"; drawLogs();
    $("cfOut").innerHTML = '<p class="sw-note"><b>' + esc(r.j.dir) + '</b> em ' + esc(r.j.host) + ' — ' + r.j.total + ' item(ns). Um XML que já está lá pode ser usado sem novo envio.</p>' +
      '<div class="sw-scroll"><table class="sw-t"><thead><tr><th>Nome</th><th>Tamanho</th><th>Data</th><th></th></tr></thead><tbody>' +
      (r.j.items.length ? r.j.items.map(function (x) {
        var isX = x.type === "file" && /\.xml$/i.test(x.name);
        return '<tr><td class="m">' + (x.type === "dir" ? "📁 " : "") + esc(x.name) + '</td><td>' + (x.type === "dir" ? "" : fmtBytes(x.size)) + '</td><td>' + esc(x.mtime || "") + '</td><td>' +
          (isX ? '<button class="ghost" type="button" style="padding:3px 10px" data-use="' + esc(x.name) + '" data-size="' + x.size + '">Usar este</button>' : '') + '</td></tr>';
      }).join("") : '<tr><td colspan="4" class="muted">pasta vazia</td></tr>') + '</tbody></table></div>';
    $("cfOut").setAttribute("data-dir", r.j.dir);
  }));
  $("cfOut").addEventListener("click", function (ev) {
    var n = ev.target.getAttribute("data-use"); if (!n) return;
    var d = $("cfOut").getAttribute("data-dir") || $("cfDir").value;
    $("cfName").value = n;
    up = { remotePath: d.replace(/\/+$/, "") + "/" + n, fileName: n, bytes: parseInt(ev.target.getAttribute("data-size"), 10) || 0, existing: true };
    cfgCmd = ""; $("rsCmd").textContent = "—";
    $("rsUp").innerHTML = chip("c-ok", "já está no servidor") + " " + esc(n) + " (" + fmtBytes(up.bytes) + ") — conferido na listagem";
    gate();
  });

  function readB64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); res(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { rej(new Error("não consegui ler o arquivo")); };
      fr.readAsDataURL(file);
    });
  }
  $("cfSend").addEventListener("click", guard(async function () {
    ready();
    var f = $("cfFile").files[0];
    if (!f) throw new Error("Escolha o arquivo XML.");
    if (!/\.xml$/i.test(f.name)) throw new Error("Somente arquivos .xml são aceitos.");
    if (!f.size) throw new Error("O arquivo está vazio.");
    var b = fsBody(); b.name = nameOk($("cfName").value.trim());
    up = null; cfgCmd = ""; gate(); $("rsCmd").textContent = "—";
    var e = addLog({ op: "Enviar XML", server: b.protocol + " " + b.host + ":" + b.port, item: b.name + " (" + fmtBytes(f.size) + ")", state: "sending" });
    $("rsUp").innerHTML = chip("c-run", "enviando") + " " + esc(b.name) + " (" + fmtBytes(f.size) + ")…";
    var fail = function (m) { e.state = "failed"; e.summary = m; drawLogs(); $("rsUp").innerHTML = chip("c-er", "falhou") + " " + esc(m); };
    b.data = await readB64(f);
    var r;
    for (;;) {
      try { r = await call("/file-server/upload", b); } catch (er) { fail(er.message); return; }
      if (r.status === 409 && r.j.code === "exists" && !b.overwrite) {
        if (!await ask({ title: "O arquivo já existe no servidor", html: '<p><b class="mono">' + esc(b.name) + '</b> já está em ' + esc(b.dir) + ' (' + fmtBytes(r.j.existingBytes || 0) + ').</p><p>Sobrescrever com o arquivo novo (' + fmtBytes(f.size) + ')?</p>', ok: "Sobrescrever", danger: true })) { e.state = "canceled"; e.summary = "já existia; não sobrescrito"; drawLogs(); $("rsUp").innerHTML = chip("c-no", "cancelado") + " o arquivo já existia e não foi sobrescrito"; return; }
        b.overwrite = true; continue;
      }
      if (r.status === 409 && r.j.code === "rename_failed" && !b.direct) {
        if (!await ask({ title: "O servidor não deixou renomear", html: '<p>O envio seguro grava <span class="mono">' + esc(b.name) + '.part</span> e renomeia no fim, mas o servidor recusou:</p><pre>' + esc(r.j.message) + '</pre><p>Enviar direto com o nome final? (se a conexão cair no meio, fica um arquivo incompleto no servidor)</p>', ok: "Enviar direto" })) { fail("servidor não permite renomear; envio direto não autorizado"); return; }
        b.direct = true; b.overwrite = true; continue;
      }
      break;
    }
    if (r.status !== 200 || !r.j.ok) { fail(errMsg(r)); return; }
    var j = r.j;
    up = { remotePath: j.remotePath, fileName: j.fileName, bytes: j.bytes };
    e.state = "sent"; e.summary = j.message + (j.overwritten ? " · sobrescreveu o anterior" : ""); drawLogs();
    $("rsUp").innerHTML = chip("c-ok", "enviado") + " " + fmtBytes(j.bytes) + " por " + j.protocol + " em " + esc(j.host) + ":" + j.port + " — " + esc(j.message) + (j.overwritten ? " · sobrescreveu o anterior" : "") +
      (j.sizeChecked ? " · tamanho conferido" : "");
    gate();
  }));

  function cfgBuild(real) {
    if (!up) throw new Error("Envie o XML (ou escolha um já existente em “Listar diretório”) antes de gerar o comando.");
    var pw = real ? ($("ccSame").checked ? $("cfPwd").value : $("ccPwd").value) : "********";
    if (real) need(pw, $("ccSame").checked ? "Senha do servidor de arquivos (usada no comando)" : "PWD no comando");
    return 'DLD CFGFILE: MODE=IPV4, IP="' + need(clean($("ccIp").value, "IP no comando"), "IP no comando") + '", USR="' + need(clean($("ccUser").value, "USR no comando"), "USR no comando") +
      '", PWD="' + clean(pw, "PWD") + '", DIR="' + need(clean($("ccDir").value, "DIR no comando"), "DIR no comando") + '", FN="' + clean(up.fileName, "nome do arquivo") +
      '", ENCRYPTMODE=' + need(clean($("ccEnc").value, "ENCRYPTMODE"), "ENCRYPTMODE") + ', FOCDLD=' + $("ccFoc").value + ';';
  }
  var ACT_CFG = "ACT CFGFILE: MOD=IMMEDIATELY;";
  $("ccSame").addEventListener("change", function () { $("ccPwd").disabled = this.checked; });
  $("ccPwd").disabled = true;
  function showCfgCmd() {
    cfgCmd = cfgBuild(true);
    $("rsCmd").textContent = mask(cfgCmd) + ($("ccAct").checked ? "\n" + ACT_CFG : "");
    gate();
  }
  $("ccGen").addEventListener("click", guard(function () { showCfgCmd(); }));
  $("ccAct").addEventListener("change", function () { if (cfgCmd) $("rsCmd").textContent = mask(cfgCmd) + (this.checked ? "\n" + ACT_CFG : ""); });
  $("ccCopy").addEventListener("click", function () { copy($("rsCmd").textContent, this); });
  function cfgWarn(neName, extra) {
    return '<dl><dt>Site (NE)</dt><dd>' + esc(neName) + '</dd>' + (up ? '<dt>Arquivo</dt><dd>' + esc(up.fileName) + '</dd>' : '') + '</dl><pre>' + esc(ACT_CFG) + '</pre>' +
      '<div class="dg">⚠ ACT CFGFILE com MOD=IMMEDIATELY faz o site REINICIAR já com a configuração nova: haverá indisponibilidade.' + (extra || "") + '</div>';
  }
  $("ccRun").addEventListener("click", guard(async function () {
    var R = readyMml(); showCfgCmd();
    var act = $("ccAct").checked;
    var html = (R.known ? "" : '<div class="dg">' + esc(R.ne) + ' não está na lista de NEs do MAE.</div>') +
      '<dl><dt>Site (NE)</dt><dd>' + esc(R.ne) + '</dd><dt>Arquivo</dt><dd>' + esc(up.remotePath) + '</dd></dl><pre>' + esc(mask(cfgCmd)) + '</pre>';
    if (!await ask({ title: "Executar DLD CFGFILE em " + R.ne + "?", html: html, ok: "Executar na BBU" })) return;
    var steps = [{ cmd: cfgCmd, label: "DLD CFGFILE", long: true, maxsec: 1800 }];
    if (act) {
      if (!await ask({ title: "2ª confirmação — ACT CFGFILE em " + R.ne, html: cfgWarn(R.ne, " O ACT será enviado sozinho assim que o download terminar com sucesso."), typed: "ATIVAR " + R.ne, ok: "Confirmar DLD + ACT", danger: true })) return;
      steps.push({ cmd: ACT_CFG, label: "ACT CFGFILE", long: true, maxsec: 1800 });
    }
    var v = await startJob(R.ne, "Carregar CFGFILE" + (act ? " + ativação" : ""), steps, { kind: "cfg", server: $("ccIp").value.trim(), item: up.fileName }, "cfg");
    cfgJob = jobs[v.id]; drawCfgRun();
  }));
  $("ccActNow").addEventListener("click", guard(async function () {
    var R = readyMml();
    if (!await ask({ title: "ACT CFGFILE em " + R.ne, html: cfgWarn(R.ne), typed: "ATIVAR " + R.ne, ok: "Ativar agora", danger: true })) return;
    var v = await startJob(R.ne, "Ativar CFGFILE", [{ cmd: ACT_CFG, label: "ACT CFGFILE", long: true, maxsec: 1800 }], { kind: "cfg", item: up ? up.fileName : "" }, "cfg");
    cfgJob = jobs[v.id]; drawCfgRun();
  }));
  function drawCfgRun() {
    if (!cfgJob) { $("rsRun").innerHTML = chip("c-no", "não iniciado"); $("rsRet").textContent = "—"; $("rsResp").textContent = "—"; return; }
    var v = cfgJob.v, cur = v.steps[Math.max(0, v.cur)] || {};
    $("rsRun").innerHTML = stChip(v.state) + " " + esc(v.ne) + (v.state === "running" ? " · " + esc(cur.label || "") + (cur.pct != null ? " " + cur.pct + "%" : "") : "") + (v.note ? " · " + esc(v.note) : "");
    $("rsRet").textContent = v.steps.filter(function (x) { return x.msg; }).map(function (x) { return (x.label || "comando") + ": " + x.msg; }).join("\n") || "—";
    $("rsRet").style.whiteSpace = "pre-line";
    $("rsResp").textContent = v.steps.map(function (x) { return x.resp; }).filter(Boolean).join("\n\n") || "—";
  }
  $("ccClear").addEventListener("click", function () {
    if (cfgJob && (cfgJob.v.state === "running" || cfgJob.v.state === "queued")) { tell("Execução em andamento", "Aguarde terminar (ou use “Parar de aguardar” no topo) antes de limpar."); return; }
    up = null; cfgCmd = ""; cfgJob = null; $("cfOut").innerHTML = ""; $("rsCmd").textContent = "—";
    $("rsUp").innerHTML = chip("c-no", "não iniciado"); drawCfgRun(); gate();
  });

  // ---------- início ----------
  applyProf(); gate(); conn();
  if (!ne() && loadedSite()) $("swNe").value = loadedSite();
  var tab = $("tab-sw");
  if (tab) tab.addEventListener("click", function () { conn(); fillNe(); reattach(); if (!ne() && loadedSite()) { $("swNe").value = loadedSite(); refreshPrev(); } });
  setInterval(function () { conn(); reattach(); }, 3000);
  window.SW_TAB = { jobs: function () { return jobs; }, logs: function () { return logs; } };
})();
