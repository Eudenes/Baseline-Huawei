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
