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

### Instalar o helper (uma vez)

1. Instale o Python 3 (python.org) marcando **"Add Python to PATH"**.
2. Copie `tools/mml_helper_v2.py` e `tools/Iniciar_Helper_MML.bat` para `C:\MML`.

### Usar

1. Conecte a VPN da operadora (o MAE só responde dentro da rede).
2. Dê dois cliques em `C:\MML\Iniciar_Helper_MML.bat` e deixe a janela aberta.
3. Abra o Baseline → aba **Entrada**. O painel mostra *helper OK*.
   - Se o Chrome/Edge perguntar se o site pode acessar a **rede local**, clique em **Permitir**.
4. Informe usuário e senha do MAE → **Conectar**. A lista de sites (LST NE) é carregada.
5. Busque o site (ex.: `SR-TJMO01`) → **Confirmar: Rodada 1 + Rodada 2**.

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
