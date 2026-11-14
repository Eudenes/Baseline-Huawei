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

## KPIs MAE (aba RAN Sharing) — fase 1: descoberta no SFTP

Painel **KPIs MAE · Explorar SFTP** no topo da aba RAN Sharing (recolhido por padrão). Precisa do
helper **v2.2+** com `paramiko` (o instalador já instala; para atualizar, rode o instalador de novo).

- Login SFTP (10.220.30.9:22, somente leitura; pode reaproveitar a senha do MML — fica só no helper).
- **Escanear pastas**: árvore de `/opt/oss/server/var/fileint` com nº de arquivos e data mais recente.
- **Peek**: abre 1 arquivo (`.xml.gz`, `.xml`, `.csv`), mostra as 80 primeiras linhas e um resumo
  (measInfo, granularidade, measTypes nomes/IDs, tipos de `measObjLdn`, NEs conhecidos).
- **Procurar RAN automaticamente**: abre o arquivo mais recente de cada pasta com dados e diz se há RAN.
- **Baixar relatório (.txt)** para enviar e seguir para a fase 2 (coleta e conversão para o formato do Query Result).

Rotas do helper: `POST /sftp/login {user,pwd,useMml}`, `POST /sftp/logout`, `GET /sftp/ls?path=`,
`GET /sftp/scan?root=&depth=`, `GET /sftp/peek?path=`, `GET /sftp/probe?root=&depth=`.

## SW & CFGFILE (aba 9)

Precisa do helper **v3.2+** (rode o instalador de novo; a aba avisa quando o helper do PC é antigo) e
da conexão feita no painel **Executar no MAE** da aba Entrada.

- **CFGFILE** — envia um XML ao servidor de arquivos (FTP ou SFTP, pelo helper), confere o tamanho e só
  então libera o `DLD CFGFILE` no site escolhido. Upload e execução têm resultados separados.
  O servidor do **upload** (padrão `10.220.30.9`) e o IP que vai **no comando** (padrão `10.220.4.134`,
  visto só pelos sites) são campos diferentes.
- **Software** — perfis RAN19 SPC220, RAN19 SPC260, RAN20 SPC270, Supply, BLS e Personalizado. Gera
  `DLD SOFTWARE` / `SPL SOFTWARE` e, se pedido, `ACT SOFTWARE`.
- **Status e logs** — histórico da sessão (exportável) e ajustes de espera.

Os comandos demorados rodam **em segundo plano no helper**, em uma sessão MML própria: o percentual
aparece no topo da aba e no botão da aba 9, e as outras abas continuam livres (até recarregar a página).

Segurança:
- Nenhuma senha fica no código, no repositório, no `localStorage` ou em log. É digitada na sessão e
  aparece sempre como `PWD="********"`; a real só vai no envio ao site.
- `ACT SOFTWARE` e `ACT CFGFILE` reiniciam o site: exigem digitar `ATIVAR <NE>`. O ACT automático ao fim
  do download vem desmarcado e pede uma 2ª confirmação.
- O fim do download é detectado por: último relatório sem `To be continued` **e** silêncio de N segundos
  (padrão 20). O texto final real ainda não foi validado em campo; expressões de fim/falha e o comando de
  status são configuráveis em **Status e logs**.

Rotas novas do helper:

| Rota | Função |
|---|---|
| `POST /job/start {ne, title, steps:[{cmd,label,long,maxsec,quiet}], pctRe, doneRe, failRe}` | inicia a tarefa (aceita `#WAIT` / `#UNTIL`) |
| `GET /job/status?id=&full=1` · `GET /job/list` · `POST /job/stop {id}` | andamento (com percentual) e parada |
| `POST /file-server/test {host,protocol,port,user,pwd,dir,probe}` | testa conexão/login; `probe` tenta também FTP 21 e SFTP 22 |
| `POST /file-server/list {…,dir}` | lista o diretório |
| `POST /file-server/upload {…,dir,name,data(base64),overwrite,direct}` | envia como `.part`, confere o tamanho e renomeia |
| `POST /pm/fetch` · `GET /pm/progress` · `POST /pm/abort` | coleta PM (vindas do `mml_helper_v3.py`) |

### Roteiro do primeiro teste (na máquina com VPN)

1. Rode `tools/Instalar_Helper_MML.bat` e aguarde o **PRONTO**.
2. Abra o Baseline → aba **Entrada** → **Conectar** (usuário e senha do MAE).
3. Aba **9 SW & CFGFILE** → digite o site de teste no topo.
4. **CFGFILE**: digite a senha → **Testar conexão** (mostra qual protocolo/porta respondeu) → **Listar diretório**.
5. Escolha um XML pequeno → **Enviar XML** → confira o **Caminho remoto**.
6. **Gerar comando** → confira → **Executar na BBU** (deixe o ACT desmarcado) → confira o **RETCODE**.
7. **Software**: escolha cada perfil e confira o comando. Aplique um download **sem** ACT automático e
   observe como o site encerra o download; só depois use o ACT.

