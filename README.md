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

