@echo off
rem ==========================================================================
rem  Instalador do Helper MML (Baseline Huawei <-> MAE)
rem  Rode UMA VEZ em cada computador. Depois o helper inicia sozinho com o
rem  Windows, escondido (sem janela). Para remover:  Instalar_Helper_MML.bat remover
rem  ARQUIVO GERADO por tools/gerar_instalador.py - edite o modelo, nao este.
rem ==========================================================================
title Instalador do Helper MML
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $acao='%~1'; $c=[IO.File]::ReadAllText($f); iex $c.Substring($c.IndexOf('#'+'POWERSHELL#')+12)"
echo.
pause
exit /b
#POWERSHELL#
$ErrorActionPreference = 'Stop'
$dir  = Join-Path $env:LOCALAPPDATA 'MML_Helper'
$py_file = Join-Path $dir 'mml_helper_v2.py'
$lnk  = Join-Path ([Environment]::GetFolderPath('Startup')) 'MML Helper.lnk'
$reg  = 'HKCU:\Software\Classes\mmlhelper'

function Stop-Helper {
  Get-CimInstance Win32_Process -Filter "Name like 'python%' or Name like 'py%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*mml_helper_v2.py*' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
}

function Find-Python {
  foreach ($c in @('py', 'python')) {
    try {
      $p = (& $c -c "import sys;print(sys.executable)" 2>$null | Select-Object -First 1)
      if ($LASTEXITCODE -eq 0 -and $p -and (Test-Path $p.Trim())) { return $p.Trim() }
    } catch {}
  }
  $g = Get-ChildItem -Path "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe", "$env:ProgramFiles\Python3*\python.exe" -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
  if ($g) { return $g.FullName }
  return $null
}

Write-Host ''
Write-Host '=== Helper MML - Baseline Huawei ===' -ForegroundColor Cyan

if ($acao -eq 'remover') {
  Stop-Helper
  Remove-Item $lnk -Force -ErrorAction SilentlyContinue
  Remove-Item $reg -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Helper removido deste computador.' -ForegroundColor Green
  return
}

# 1) Python
$py = Find-Python
if (-not $py) {
  Write-Host 'Python nao encontrado. Instalando pelo winget (pode levar 1-2 min)...' -ForegroundColor Yellow
  try {
    winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host
  } catch {}
  $py = Find-Python
}
if (-not $py) {
  Write-Host ''
  Write-Host 'Nao consegui instalar o Python automaticamente.' -ForegroundColor Red
  Write-Host 'Instale em https://www.python.org/downloads/ (marque "Add python.exe to PATH")'
  Write-Host 'e rode este instalador de novo.'
  return
}
$pyw = Join-Path (Split-Path $py) 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }
Write-Host "Python: $py"

# 2) Copia o helper (embutido neste arquivo)
Stop-Helper
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$code = @'
# mml_helper_v2.py - Ponte Baseline (navegador) <-> MAE (MML NBI, porta 31114)
#
# Uso:  python mml_helper_v2.py                 (MAE padrao 10.220.30.9:31114)
#       python mml_helper_v2.py --mae IP:PORTA  (outro MAE / teste)
#
# Login e senha sao informados pela pagina do Baseline e ficam SO na memoria
# deste processo (nunca em disco).
import argparse, json, os, re, socket, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAE_IP, MAE_PORT = os.environ.get("MAE_IP", "10.220.30.9"), int(os.environ.get("MAE_PORT", "31114"))
EOL = b"\r\n"
LOCAL_PORT = 8765
END = "---    END"
VERSION = "2.1"
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "helper.log")


def logf(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:
        pass

# Paginas que podem usar o helper. Qualquer outro site aberto no navegador e
# recusado (evita que uma pagina estranha mande comandos ao MAE).
ALLOWED_ORIGINS = {
    "https://eudenes.github.io",
    "null",                         # index.html aberto direto do disco (file://)
}
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")


def origin_ok(origin):
    return (not origin) or origin in ALLOWED_ORIGINS or bool(LOCAL_ORIGIN.match(origin))


class MML:
    def __init__(self):
        self.sock = None; self.user = None; self.pwd = None
        self.lock = threading.Lock(); self.ne_cache = []
        self.cur_ne = None          # NE registrado no momento (REG NE fica ativo entre os blocos)

    def _read(self, maxsec=180, idle=0.08):
        buf, t0, last = "", time.time(), time.time()
        while time.time() - t0 < maxsec:
            try:
                d = self.sock.recv(65536)
                if not d: raise ConnectionError("MAE fechou a conexao")
                buf += d.decode(errors="ignore"); last = time.time()
            except socket.timeout:
                pass
            i = buf.rfind(END)
            if i >= 0 and time.time() - last >= idle:
                # olha so o ultimo relatorio (entre o END anterior e o ultimo END):
                # se ele termina com "To be continued...", ainda vem mais parte.
                prev = buf.rfind(END, 0, i)
                seg = buf[prev + len(END) if prev >= 0 else 0:i]
                if "To be continued" not in seg:
                    return buf
        return buf + f"\n[TIMEOUT {maxsec}s]"

    def _drain(self):
        """Le o que sobrou no socket (ex.: relatorio extra que chegou atrasado)."""
        buf = ""
        while True:
            try:
                d = self.sock.recv(65536)
            except socket.timeout:
                return buf
            if not d: raise ConnectionError("MAE fechou a conexao")
            buf += d.decode(errors="ignore")

    def _send(self, cmd, maxsec=180):
        # sobra do comando anterior vai junto (o Baseline separa pelo eco %%CMD%%)
        pre = self._drain()
        self.sock.sendall(cmd.encode() + EOL)
        return pre + self._read(maxsec)

    def login(self, user, pwd):
        self.close()
        self.sock = socket.create_connection((MAE_IP, MAE_PORT), 15)
        self.sock.settimeout(0.05)     # leitura rapida: a resposta termina no "---    END"
        self.cur_ne = None
        r = self._send(f'LGI:OP="{user}",PWD="{pwd}";', 30)
        if "RETCODE = 0" not in r:
            self.close(); raise RuntimeError("Login falhou: " + r.strip()[-300:])
        self.user, self.pwd = user, pwd

    def close(self):
        self.cur_ne = None
        try:
            if self.sock and self.user: self.sock.sendall(f'LGO:OP="{self.user}";'.encode() + EOL)
            if self.sock: self.sock.close()
        except Exception: pass
        self.sock = None

    def send(self, cmd, maxsec=180):
        if not self.sock:
            if not self.user: raise RuntimeError("Nao logado")
            self.login(self.user, self.pwd)
        try:
            return self._send(cmd, maxsec)
        except (OSError, ConnectionError):
            ne = self.cur_ne
            self.login(self.user, self.pwd)      # reconecta uma vez
            if ne and not cmd.startswith(("REG NE", "UNREG NE")):
                if "RETCODE = 0" in self._send(f'REG NE:NAME="{ne}";', 60): self.cur_ne = ne
            return self._send(cmd, maxsec)

    def reg(self, ne):
        """Registra o NE so se for diferente do atual. Devolve item de log ou None."""
        if not ne or ne == self.cur_ne: return None
        self.unreg()
        r = self.send(f'REG NE:NAME="{ne}";', 60)
        ok = "RETCODE = 0" in r
        self.cur_ne = ne if ok else None
        return {"cmd": f"REG NE {ne}", "ok": ok, "resp": r}

    def unreg(self):
        if self.cur_ne and self.sock:
            try: self.send(f'UNREG NE:NAME="{self.cur_ne}";', 60)
            except Exception: pass
        self.cur_ne = None

    def list_ne(self):
        with self.lock:
            r = self.send("LST NE:;", 120)
        ne = []
        for ln in r.splitlines():
            m = re.match(r"^\s*(\S+NE)\s+(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s*$", ln)
            if m: ne.append({"type": m.group(1), "name": m.group(2), "ip": m.group(3)})
        self.ne_cache = ne
        return ne

    def run(self, ne, cmds, stop_on_error=False):
        out = []
        with self.lock:
            g = self.reg(ne)
            if g:
                out.append(g)
                if not g["ok"]: return out
            for line in cmds:
                line = line.strip()
                if not line or line.startswith("//"): continue
                if line.upper().startswith("#WAIT"):
                    s = int(line.split()[1]); time.sleep(s)
                    out.append({"cmd": line, "ok": True, "resp": f"aguardou {s}s"}); continue
                if line.upper().startswith("#UNTIL"):
                    cmd, alvo = [x.strip() for x in line[6:].split("|", 1)]
                    r = ""
                    for _ in range(90):
                        r = self.send(cmd)
                        if re.search(alvo, r): break
                        time.sleep(20)
                    ok = bool(re.search(alvo, r))
                    out.append({"cmd": line, "ok": ok, "resp": r})
                    if not ok and stop_on_error: break
                    continue
                r = self.send(line)
                ok = "RETCODE = 0" in r
                out.append({"cmd": line, "ok": ok, "resp": r})
                if not ok and stop_on_error: break
        return out


mml = MML()


class Handler(BaseHTTPRequestHandler):
    def _hdr(self, code=200):
        origin = self.headers.get("Origin", "")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        if origin and origin_ok(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")  # pagina https -> localhost
        self.end_headers()

    def _json(self, obj, code=200):
        self._hdr(code); self.wfile.write(json.dumps(obj).encode())

    def _blocked(self):
        if origin_ok(self.headers.get("Origin", "")): return False
        self._json({"error": "origem nao autorizada: " + self.headers.get("Origin", "")}, 403)
        return True

    def do_OPTIONS(self):
        self._hdr(200 if origin_ok(self.headers.get("Origin", "")) else 403)

    def do_GET(self):
        if self._blocked(): return
        try:
            if self.path.startswith("/ne"):
                return self._json(mml.ne_cache or mml.list_ne())
            self._json({"status": "ok", "version": VERSION, "logged": bool(mml.user), "user": mml.user, "mae": f"{MAE_IP}:{MAE_PORT}"})
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def do_POST(self):
        if self._blocked(): return
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path.startswith("/login"):
                with mml.lock: mml.login(body["user"], body["pwd"])
                return self._json({"ok": True, "user": mml.user})
            if self.path.startswith("/unreg"):
                with mml.lock: mml.unreg()
                return self._json({"ok": True})
            if self.path.startswith("/logout"):
                with mml.lock: mml.unreg(); mml.close(); mml.user = mml.pwd = None; mml.ne_cache = []
                return self._json({"ok": True})
            if self.path.startswith("/ne"):
                return self._json(mml.list_ne())
            if self.path.startswith("/run"):
                res = mml.run(body.get("ne", ""), body.get("cmds", []), body.get("stopOnError", False))
                return self._json(res)
            self._json({"error": "rota desconhecida"}, 404)
        except Exception as e:
            logf("erro %s: %s" % (self.path, e))
            self._json({"error": str(e)}, 500)

    def log_message(self, *a): pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Helper MML v2 (Baseline <-> MAE)")
    ap.add_argument("--mae", help="IP:PORTA do MAE (padrao %s:%d)" % (MAE_IP, MAE_PORT))
    ap.add_argument("--port", type=int, default=LOCAL_PORT, help="porta local (padrao %d)" % LOCAL_PORT)
    ap.add_argument("url", nargs="?", help=argparse.SUPPRESS)   # "mmlhelper://start" quando aberto pela pagina
    a = ap.parse_args()
    if a.mae:
        h, _, p = a.mae.partition(":"); MAE_IP = h; MAE_PORT = int(p or MAE_PORT)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    except OSError:
        # ja existe um helper rodando nesta porta (ex.: aberto pela inicializacao do Windows)
        print(f"Helper ja esta rodando em http://127.0.0.1:{a.port}")
        sys.exit(0)
    logf(f"inicio v{VERSION} porta {a.port} -> MAE {MAE_IP}:{MAE_PORT}")
    print(f"Helper MML v{VERSION} em http://127.0.0.1:{a.port}  ->  MAE {MAE_IP}:{MAE_PORT}")
    print("Faca o login pela pagina do Baseline. Ctrl+C para sair.")
    srv.serve_forever()
'@
[IO.File]::WriteAllText($py_file, $code, (New-Object Text.UTF8Encoding($false)))
Write-Host "Helper copiado para $dir"

# 3) Inicia sozinho com o Windows (atalho na pasta Inicializar, sem janela)
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = $pyw
$s.Arguments = '"' + $py_file + '"'
$s.WorkingDirectory = $dir
$s.WindowStyle = 7
$s.Description = 'Helper MML (Baseline Huawei)'
$s.Save()
Write-Host 'Inicializacao automatica: OK'

# 4) Link mmlhelper:// (botao "Iniciar helper" da pagina, caso ele tenha sido fechado)
foreach ($k in @($reg, "$reg\shell", "$reg\shell\open", "$reg\shell\open\command")) {
  if (-not (Test-Path $k)) { New-Item -Path $k | Out-Null }
}
Set-ItemProperty -Path $reg -Name '(default)' -Value 'URL:Helper MML'
Set-ItemProperty -Path $reg -Name 'URL Protocol' -Value ''
Set-ItemProperty -Path "$reg\shell\open\command" -Name '(default)' -Value ('"' + $pyw + '" "' + $py_file + '" "%1"')
Write-Host 'Botao "Iniciar helper" da pagina: OK'

# 5) Liga agora e testa
Start-Process -FilePath $pyw -ArgumentList ('"' + $py_file + '"') -WorkingDirectory $dir -WindowStyle Hidden
$ok = $false
for ($i = 0; $i -lt 10 -and -not $ok; $i++) {
  Start-Sleep -Milliseconds 700
  try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/' -TimeoutSec 2; $ok = $true } catch {}
}
Write-Host ''
if ($ok) {
  Write-Host ("PRONTO! Helper v" + $r.version + " rodando. Ele vai iniciar sozinho sempre que o Windows ligar.") -ForegroundColor Green
  Write-Host 'Pode fechar esta janela e voltar para o Baseline.'
} else {
  Write-Host 'Instalado, mas o helper nao respondeu. Veja o arquivo:' -ForegroundColor Yellow
  Write-Host (Join-Path $dir 'helper.log')
}
