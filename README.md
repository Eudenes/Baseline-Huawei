# Baseline-Huawei

Ferramenta publicada em https://eudenes.github.io/Baseline-Huawei/

## Executar no MAE (aba Entrada)

O painel **Executar no MAE**, no topo da aba **Entrada & histórico**, roda os comandos da
Rodada 1 e da Rodada 2 direto no site, **um comando por vez** (cada um só sai depois que a
resposta do anterior terminou), cola as respostas nas caixas e clica em processar sozinho.

O navegador não consegue abrir conexão Telnet/TCP, por isso existe um **helper local** em
Python que faz a ponte:

```
Baseline (GitHub Pages) --HTTP--> helper no PC (127.0.0.1:8765) --TCP 31114--> MAE (10.220.30.9)
```

### Instalar o helper (uma vez em cada computador)

1. Abra o Baseline → aba **Entrada**. Com o helper offline aparece **Instalar neste PC (1ª vez)**.
2. Clique, abra o arquivo baixado `Instalar_Helper_MML.bat` e aguarde o **PRONTO** (se o
   navegador ou o Windows avisar sobre o arquivo, escolha *Manter* / *Executar assim mesmo*).
   - Ele instala o Python sozinho (winget) se o PC não tiver.
   - Copia o helper para `%LOCALAPPDATA%\MML_Helper` e o coloca para **iniciar sozinho com o
     Windows, sem janela**.
   - Cria o link `mmlhelper://` usado pelo botão **Iniciar helper** da página (caso ele seja fechado).
3. Pronto: nos próximos acessos o painel já abre com *helper OK*.

Para atualizar, rode o instalador de novo (a página avisa quando o helper do PC está antigo).
Para remover: `Instalar_Helper_MML.bat remover`.

> `Instalar_Helper_MML.bat` é gerado a partir de `tools/instalador_modelo.txt` +
> `tools/mml_helper_v2.py`. Depois de mexer no helper rode `python tools/gerar_instalador.py`.
> `Iniciar_Helper_MML.bat` continua disponível para rodar o helper manualmente (com janela).

### Usar

1. Conecte a VPN da operadora (o MAE só responde dentro da rede).
2. Abra o Baseline → aba **Entrada**. O painel mostra *helper OK*.
   - Se o Chrome/Edge perguntar se o site pode acessar a **rede local**, clique em **Permitir**.
3. Informe usuário e senha do MAE → **Conectar**. A lista de sites (LST NE) é carregada.
4. Busque o site (ex.: `SR-TJMO01`) → **Confirmar: Rodada 1 + Rodada 2**.

Outros botões: **Só Rodada 1**, **Parar** (para depois do bloco de comandos atual) e
**Exportar log (.txt)** (log + respostas completas).

Segurança:
- A senha vai só para o helper e fica **apenas na memória** dele (nunca em disco, nem no
  navegador). Só o usuário é lembrado no navegador.
- O helper só aceita pedidos desta página (eudenes.github.io), de `localhost` ou do
  `index.html` aberto do disco.
- Se houver comandos de alteração (`ADD/MOD/RMV/SET/ACT/DLD/RST/BLK/UBL/STR/STP`), o painel
  pede confirmação antes de rodar. Se o `REG NE` falhar, a execução para com a mensagem do MAE.

Com o helper fechado o painel mostra *helper offline* e o resto do Baseline funciona normalmente.

### Pseudo-comandos do helper

O MML Huawei não tem comando de espera; o helper entende duas linhas especiais:

- `#WAIT 30` — espera 30 segundos.
- `#UNTIL DSP SOFTSTATUS:; | 100%` — repete o comando a cada 20 s até a resposta casar com a
  expressão (no máximo 30 min).

Linhas começando com `//` são ignoradas.

### Opções do helper

```
python mml_helper_v2.py --mae 10.220.30.9:31114   # outro MAE
python mml_helper_v2.py --port 8765               # outra porta local
```

## KPIs MAE (aba Relatórios de RanSharing) — fase 1: descoberta no SFTP

Painel **KPIs MAE · Explorar SFTP** no topo da aba Relatórios de RanSharing (recolhido por padrão). Precisa do
helper **v2.2+** com `paramiko` (o instalador já instala; para atualizar, rode o instalador de novo).

- Login SFTP (10.220.30.9:22, somente leitura; pode reaproveitar a senha do MML — fica só no helper).
- **Escanear pastas**: árvore de `/opt/oss/server/var/fileint` com nº de arquivos e data mais recente.
- **Peek**: abre 1 arquivo (`.xml.gz`, `.xml`, `.csv`), mostra as 80 primeiras linhas e um resumo
  (measInfo, granularidade, measTypes nomes/IDs, tipos de `measObjLdn`, NEs conhecidos).
- **Procurar RAN automaticamente**: abre o arquivo mais recente de cada pasta com dados e diz se há RAN.
- **Baixar relatório (.txt)** para enviar e seguir para a fase 2 (coleta e conversão para o formato do Query Result).

Rotas do helper: `POST /sftp/login {user,pwd,useMml}`, `POST /sftp/logout`, `GET /sftp/ls?path=`,
`GET /sftp/scan?root=&depth=`, `GET /sftp/peek?path=`, `GET /sftp/probe?root=&depth=`.

## BKP, CFGFILE e SW (aba 2)

Precisa do helper **v3.4+** (rode o instalador de novo; a aba avisa quando o helper do PC é antigo) e
da conexão feita no painel **Executar no MAE** da aba Entrada. Sub-abas: **Software · CFGFILE · BKP · Status e logs**.

- **Software** — ao carregar o site (na Entrada ou aqui) roda `LST SOFTWARE:;` e mostra o que está na
  **Main Area** (Application Type + versão) e o BLS (Software Type). Perfis RAN19 SPC220, RAN19 SPC260,
  RAN20 SPC270, Supply, BLS e Personalizado; avisa se a versão escolhida já está ativa. Gera
  `DLD SOFTWARE` / `SPL SOFTWARE` e, se pedido, `ACT SOFTWARE`.
- **CFGFILE** — envia um XML ao servidor de arquivos (FTP ou SFTP, pelo helper), confere o tamanho e só
  então libera o `DLD CFGFILE`. O servidor do **upload** (padrão `10.220.30.9`, SFTP 22) e o IP que vai
  **no comando** (padrão `10.220.4.134`, visto só pelos sites) são campos diferentes.
- **3G puro (WCDMA)** — antes de todo ULD/DLD (BKP XML, DLD CFGFILE, DLD/SPL SOFTWARE e o backup da aba 12)
  a aba roda `LST NODE:;` no site. Product Type com **WCDMA** e sem LTE = 3G puro: só o comando do site muda,
  com `IP="10.220.30.134"` e `USR="ftpuser"` (mesma senha e DIR). O lado do PC (conferir a pasta, renomear o
  arquivo, upload do XML) continua no servidor de sempre (`10.220.30.9`). Os dois valores ficam na barra
  **📡 3G puro (WCDMA)** no topo da aba.
- **BKP** — `LST NODE:;` escolhe a lista de logs pelo *Product Type* (tem WCDMA → WCDMA; tem LTE → LTE;
  senão → SRAN; dá para forçar), roda a lista e salva `<SITE>_LOGS_<data>.txt`; depois
  `BKP CFGFILE:ENCRYPTMODE=UNENCRYPTED;` → `LST CFGFILE:;` → `SET FTPSCLT` → `ULD CFGFILE` para
  `/ftproot/ronaldinho/BKP/`, espera o `CFGDATA.XML` chegar e renomeia para `<SITE>_CFGDATA.XML`
  (se já existir, entra a data/hora). TXT e XML vão para `<pasta 2026 do OneDrive>\<SITE>\`.
  - A pasta 2026 é do OneDrive da empresa: uma vez em cada PC, abra o link da pasta no navegador →
    **Adicionar atalho a Meus arquivos**; ela aparece no Explorador e o botão **Procurar** acha.
    Sem pasta configurada, os arquivos são baixados pelo navegador no fim.
- **Status e logs** — histórico da sessão (exportável) e ajustes de espera.

Regras de execução:
- Todo comando em que o site usa FTP/SFTP (`DLD SOFTWARE`, `SPL SOFTWARE`, `DLD CFGFILE`, `ULD CFGFILE`)
  vai precedido de `SET FTPSCLT:ENCRYMODE=Plaintext;`.
- `DLD SOFTWARE`, `ACT SOFTWARE` e `BKP CFGFILE` só contam como concluídos quando o site reporta
  **`Status = Success`** (o `Progress = 100%` sozinho fica como 99% "aguardando Status = Success");
  `Status = Fail` encerra como falha. Os demais: se o site mandar relatórios de progresso, também esperam
  o Success; se não mandar, terminam após o silêncio configurado.
- O percentual é lido só da linha `Progress = N%`.

Os comandos demorados rodam **em segundo plano no helper**, em uma sessão MML própria: o percentual
aparece no topo da aba e no botão **BKP, CFGFILE e SW**, e as outras abas continuam livres.

Segurança:
- **Senha padrão salva neste PC**: digite uma vez na barra 🔒 do topo da aba e clique em
  **Salvar neste PC**. Ela fica no helper do computador (`senha_padrao.dat`, cifrado pelo Windows/DPAPI:
  só o mesmo usuário do Windows abre) e vale para o upload, o backup e todos os comandos (`PWD`).
  A página nunca recebe a senha de volta: manda um marcador e o helper troca pela senha real só na hora
  do envio. Um campo de senha preenchido na tela tem prioridade sobre a salva.
- Nenhuma senha fica no código, no repositório, no `localStorage`, em log ou no TXT; sempre aparece como
  `PWD="********"`.
- `ACT SOFTWARE` e `ACT CFGFILE` reiniciam o site: exigem digitar `ATIVAR <NE>`. O ACT automático ao fim
  do download vem desmarcado e pede uma 2ª confirmação.

Rotas novas do helper:

| Rota | Função |
|---|---|
| `POST /job/start {ne, title, steps:[{cmd,label,long,need,maxsec,quiet,…}], pctRe, doneRe, failRe}` | inicia a tarefa; `need: "success"` exige `Status = Success`, `"auto"` só se houver relatório de progresso; passos especiais `#WAIT` `#UNTIL` `#NODEINFO` `#COLLECT` `#FSPREP` `#FSFETCH` `#SAVE` |
| `GET /job/file?id=&name=` | baixa um arquivo gerado pela tarefa (TXT dos logs / XML do backup) |
| `POST /local/check {path}` · `POST /local/find {name}` | confere a pasta local (OneDrive) / procura a pasta 2026 dentro do OneDrive do PC |
| `GET /job/status?id=&full=1` · `GET /job/list` · `POST /job/stop {id}` | andamento (com percentual) e parada |
| `POST /file-server/test {host,protocol,port,user,pwd,dir,probe}` | testa conexão/login; `probe` tenta também FTP 21 e SFTP 22 |
| `POST /file-server/list {…,dir}` | lista o diretório |
| `POST /file-server/upload {…,dir,name,data(base64),overwrite,direct}` | envia como `.part`, confere o tamanho e renomeia |
| `POST /secret/set {pwd}` · `POST /secret/clear` | salva / apaga a senha padrão neste PC (nunca é devolvida) |
| `POST /pm/fetch` · `GET /pm/progress` · `POST /pm/abort` | coleta PM (vindas do `mml_helper_v3.py`) |

### Roteiro do primeiro teste (na máquina com VPN)

1. Rode `tools/Instalar_Helper_MML.bat` e aguarde o **PRONTO**.
2. Abra o Baseline → aba **Entrada** → **Conectar** (usuário e senha do MAE).
3. Aba **2 BKP, CFGFILE e SW** → digite o site de teste no topo → na barra 🔒 digite a senha padrão → **Salvar neste PC** (só na 1ª vez em cada PC).
4. **CFGFILE**: **Testar conexão** (mostra qual protocolo/porta respondeu) → **Listar diretório**.
5. Arraste um XML pequeno para a área tracejada → **Enviar XML** → confira o **Caminho remoto**.
6. **Gerar comando** → confira → **Executar na BBU** (deixe o ACT desmarcado) → confira o **RETCODE**.
7. **Software**: confira a tabela do LST SOFTWARE, escolha cada perfil e confira o comando. Aplique um
   download **sem** ACT automático e veja que ele só fica 100% no `Status = Success`; só depois use o ACT.
8. **BKP**: **Procurar a pasta 2026 no OneDrive** → **Testar pasta** → **Fazer backup** → confira
   `<SITE>_LOGS_….txt` e `<SITE>_CFGDATA.XML` na subpasta do site e o arquivo renomeado no servidor.


## 3G/4G puro → SRAN (aba 12)

A aba tem duas opções: **3G puro + LTE → SRAN** (FullScript do MAE) e **4G puro → SRAN** (conversão do backup).

### 3G puro + LTE → SRAN

Para colocar o LTE na mesma BBU de um site 3G puro, já que o MAE não converte mais 3G em SRAN. Junta:

- o **backup do site 3G** — feito pela própria aba (botão *Fazer backup pelo MAE*, que usa a sub-aba BKP da aba 2:
  `BKP CFGFILE` + `ULD CFGFILE`) ou solto como arquivo (`…BKPFileOf_swmengine…tar.gz`, `NodeBCfg.xml`, `CFGDATA.XML`);
- o **eRPD** (células LTE) e a **ENG-SI** (IPs do LTE, aba PROJETO LÓGICO AUTOMÁTICO) — os mesmos parsers da aba 11 (New Site);
- um **site SRAN modelo** 3G+4G (padrão embutido: FullScript do SR-MFRP01; dá para usar outro).

Sai o `NaoDeletar_FullScript_RuleCheckSuccessed_….zip` (FullExport com CRC + `ScriptNeModel` + `manifest.xml`/`scriptcfg.xml`)
para importar no MAE, e o XML sozinho se preferir.

O resultado segue o padrão dos sites já integrados e funcionando (comparado com o XML do site no ar em 7 sites:
~99% dos atributos do NODE e 100% do NODEBFUNCTION iguais ao do site integrado).

- **Hardware 3G na numeração do modelo**: RRU, cadeia (RCN = SRN), setor e SECTOREQM do 3G ficam com os números do
  modelo (60, 61, 62…), TX/RX e nomes do modelo; cada cadeia chega na mesma placa/porta do backup (HSN/HPN);
  o BASEBANDEQM do UMTS é o do modelo com as placas 3G do site. As células 3G apontam para os novos SECTOREQM/BASEBANDEQM.
  Se a quantidade de RRUs do site for diferente da do modelo (ou houver RRU em cascata), fica a numeração do backup (com aviso).
- **Placas**: as do backup + a placa LTE do modelo. Se o slot dela estiver ocupado, vai para o slot livre (ordem 4, 3, 5, 0, 2, 1).
  Cadeia 3G ligada num slot sem BBP no backup (placa de outra BBU) ganha uma BBP no molde da placa LTE do modelo (com aviso).
- **Transmissão 3G**: IPs do site (Iub, OMCH, gateway, VLAN, rotas) nos objetos do modelo — IPPATH (6 caminhos e DSCP do
  modelo), SCTPLNK do Iub (temporizadores do modelo), OMCH (PEERMASK do modelo), DEVIP com os rótulos do modelo.
  Rotas do 3G renumeradas em sequência depois das do LTE, com a descrição do modelo. Rota padrão fica a do LTE; destinos
  do 3G que dependiam da rota padrão do 3G ganham rota /32 pelo gateway do 3G.
- **Relógio**: o do modelo (GNSS/TASM do SRAN). Opção para manter o do site (TASM, IPCLKLNK, GPS).
- **Não entram do backup**: RET/RETSUBUNIT/RETDEVICEDATA (refeitos em campo com a varredura de RET), E1T1/E1T1BEAR, LR,
  DL/ULFLOWCTRLPARA, FTPCLTPORT, NODEBMULTICELLGRP. ETHPORT/PHYPORT/CABINET/ALMPORT/LOCATION ficam os do modelo.
- **NODEBFUNCTION**: parâmetros do NodeB do modelo; células 3G = a célula do modelo como base + tudo da célula do site
  (identidade, UARFCN, PSC, potência, LAC/SAC/RAC…), exceto alguns parâmetros de algoritmo que ficam os do modelo
  (RADIUS, ICMODE/TURBOIC, HSPAUSERNUMEXT, CQIADJALGOFNONCON, HSDPAFULLBUFTHROUTHD…). Opção para manter tudo do backup.
- **Do modelo**: placa/RRUs/setores do LTE, eNodeBFunction, S1/X2 e o que é próprio do SRAN.
- **Do eRPD/ENG-SI**: nomes e IDs, células (PCI, RSI, EARFCN, banda, BW), TAC, NB-IoT, IPs/VLAN/loopback do LTE.
  A gerência (OMCH) continua a do 3G. Célula do modelo fora do eRPD sai.
- Classes e parâmetros aceitos: modelo de NE do MAE (BTS3900 V100R020C10SPC270) que vem no próprio FullScript.

### 4G puro → SRAN

Converte o backup de configuração da BBU no formato **4G puro** (eNodeB só LTE: `ENBCFG.XML`, producttype 3,
`3900LTEDATA`) para o formato **SRAN** (producttype 118, `3900BTSDATA`) — o arquivo que o MAE gerava antes
de a Huawei descontinuar a função. Com o SRAN carregado (`DLD CFGFILE`) o site passa a trabalhar no modelo SRAN (multimodo).

- **Fazer backup pelo MAE**: digite um ou vários NEs (separados por vírgula) e a aba faz `BKP CFGFILE` + `ULD CFGFILE`
  pela sub-aba BKP da aba 2 (mesmo servidor e senha); cada backup entra direto na lista de conversão.
  Site 3G puro é recusado antes do backup (use a opção 3G puro + LTE).
- Arraste um ou vários backups: o pacote `…BKPFileOf_swmengine…tar.gz`, o `ENBCFG.XML.gz`, o `ENBCFG.XML`
  ou um `.zip` com eles. Tudo roda no navegador (nada sai do PC).
- Saída: `<NENAME>.xml` por site (ou um `.zip` com todos), com o `CRC` (SHA-256) no fim como o MAE grava.
- **Enviar p/ CFGFILE** abre a aba 2 → CFGFILE com o XML já escolhido para o upload e o `DLD CFGFILE`.
- Se um SRAN feito pelo MAE do mesmo site for solto junto, a aba compara os dois (MOs, parâmetros e valores).

O que a conversão faz (regras tiradas de 8 sites — RAN18 SPC220, RAN19 SPC260, RAN20 SPC270 — em que a saída
bate 100% com o SRAN do MAE):

- cabeçalho `producttype` 3 → 118, `3900LTEDATA` → `3900BTSDATA`, bloco `NODE` vira `NODENAME=<site>`,
  `inventoryData` vazio e `CRC` no fim;
- MO vazio, parâmetro vazio, comentários e `objId` saem; datas `AAAA-MM-DD`; IPv6 por extenso;
- saem as classes `LicenseControlStrategy` e `eUCommCellSectorEqm`, os parâmetros só de leitura/versão e os
  que dependem de outro (ex.: `ALMPORT.AID` só com `SW=ON`, `TASM.SYNMODE` só com sincronismo de frequência);
- `NODE`: `PRODUCTTYPE=118`, `WM=0`, `WMEXTENSION=0`; `APPLICATION.AN` = `eNodeB`;
- entram as `ETHPORT` 2 e 3 da UMPT (`PORTID = SN×10+PN`) com seus `RSCGRP`, o `RSCGRP` do túnel quando há
  rota por túnel, `CPSWITCH`, `UDPPING`, `SINGLEIPSWITCH` (até RAN19) e a tabela `UDT` padrão do SRAN;
- classes e parâmetros na ordem do SRAN do MAE da mesma versão.

O núcleo (`SRANCONV` em `js/sran_conv.js`) não usa DOM e roda também no node:
`node -e "const C=require('./js/sran_conv.js'); const r=C.convert(require('fs').readFileSync('ENBCFG.XML','latin1')); require('fs').writeFileSync(r.fileName, Buffer.from(C.finish(r.body).bytes))"`
