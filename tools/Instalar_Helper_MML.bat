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

# qualquer helper MML rodando (v2 instalado, v3 aberto na mao etc.) - todos usam a porta 8765
function Get-HelperProcs {
  Get-CimInstance Win32_Process -Filter "Name like 'python%' or Name like 'py%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*mml_helper*' }
}
function Stop-Helper {
  Get-HelperProcs | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
}

# Confere se o caminho e um Python 3.8+ que funciona. O atalho falso da Microsoft Store (python.exe
# em WindowsApps sem o Python instalado) falha neste teste sozinho; o Python real da Store passa.
function Test-Py($p) {
  if (-not $p) { return $null }
  $p = ([string]$p).Trim().Trim('"')
  if ($p -like '*pythonw.exe') { $p = Join-Path (Split-Path $p) 'python.exe' }
  if ($p -notlike '*\WindowsApps\*' -and -not (Test-Path $p -PathType Leaf)) { return $null }
  try {
    $v = @(& $p -c "import sys;print('%d.%d' % sys.version_info[:2]);print(sys.executable)" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $v.Count -ge 2 -and [version]([string]$v[0]).Trim() -ge [version]'3.8') { return ([string]$v[1]).Trim() }
  } catch {}
  return $null
}

function Find-Python {
  $c = New-Object System.Collections.Generic.List[string]
  # 1) o Python que ja roda o helper agora (ex.: mml_helper_v3.py aberto na mao)
  Get-HelperProcs | ForEach-Object { if ($_.ExecutablePath) { $c.Add($_.ExecutablePath) } }
  # 2) o Python da instalacao anterior (atalho de inicializacao e link mmlhelper://)
  if (Test-Path $lnk) { try { $c.Add((New-Object -ComObject WScript.Shell).CreateShortcut($lnk).TargetPath) } catch {} }
  try { $cmd = (Get-ItemProperty -Path "$reg\shell\open\command" -ErrorAction Stop).'(default)'; if ($cmd -match '^"([^"]+)"') { $c.Add($matches[1]) } } catch {}
  # 3) comandos no PATH
  foreach ($n in @('py', 'python', 'python3')) {
    try {
      # sem "Select-Object -First 1": ele interrompe o Python e o codigo de saida vira erro
      $o = @(& $n -c "import sys;print(sys.executable)" 2>$null)
      if ($LASTEXITCODE -eq 0 -and $o.Count -and $o[0]) { $c.Add([string]$o[0]) }
    } catch {}
  }
  # 4) registro do Windows (instalador oficial)
  foreach ($root in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore', 'HKLM:\Software\WOW6432Node\Python\PythonCore')) {
    Get-ChildItem $root -ErrorAction SilentlyContinue | Sort-Object PSChildName -Descending | ForEach-Object {
      try {
        $ip = Get-ItemProperty -Path (Join-Path $_.PSPath 'InstallPath') -ErrorAction Stop
        if ($ip.ExecutablePath) { $c.Add($ip.ExecutablePath) }
        if ($ip.'(default)') { $c.Add((Join-Path $ip.'(default)' 'python.exe')) }
      } catch {}
    }
  }
  # 5) pastas comuns (python.org, Anaconda, Miniconda)
  $pats = @("$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe", "$env:ProgramFiles\Python3*\python.exe",
            "${env:ProgramFiles(x86)}\Python3*\python.exe", "$env:SystemDrive\Python3*\python.exe",
            "$env:USERPROFILE\anaconda3\python.exe", "$env:USERPROFILE\miniconda3\python.exe",
            "$env:ProgramData\anaconda3\python.exe", "$env:ProgramData\miniconda3\python.exe")
  Get-ChildItem -Path $pats -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object { $c.Add($_.FullName) }
  foreach ($p in $c) { $ok = Test-Py $p; if ($ok) { return $ok } }
  return $null
}

# Instala o Python: winget (so a origem "winget": a origem msstore costuma ser bloqueada na rede da
# empresa) e, se falhar, baixa o instalador oficial do python.org e instala so para este usuario.
function Install-Python {
  $oldEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Tentando pelo winget...'
    winget install -e --id Python.Python.3.12 --source winget --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host
  }
  $ErrorActionPreference = $oldEap
  if (Find-Python) { return }
  Write-Host 'Tentando baixar do python.org...'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $exe = Join-Path $env:TEMP 'python-3.12.7-amd64.exe'
    Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile $exe -UseBasicParsing
    Start-Process -FilePath $exe -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0' -Wait
    Remove-Item $exe -Force -ErrorAction SilentlyContinue
  } catch { Write-Host ('Download falhou: ' + $_.Exception.Message) -ForegroundColor Yellow }
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
  Write-Host 'Python nao encontrado neste PC. Instalando (pode levar 1-2 min)...' -ForegroundColor Yellow
  Install-Python
  $py = Find-Python
}
if (-not $py) {
  Write-Host ''
  Write-Host 'Nao consegui instalar o Python automaticamente.' -ForegroundColor Red
  Write-Host 'Instale em https://www.python.org/downloads/ (marque "Add python.exe to PATH")'
  Write-Host 'e rode este instalador de novo.'
  Write-Host 'Se este PC ja roda o helper, deixe o helper aberto e rode o instalador de novo: ele usa o mesmo Python.'
  return
}
$pyw = Join-Path (Split-Path $py) 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }
Write-Host "Python: $py"

# 1b) paramiko (SFTP, usado pelo painel KPIs MAE). Se falhar, o resto do helper funciona.
$oldEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& $py -m pip install --user --disable-pip-version-check -q paramiko *> $null
& $py -c "import paramiko" *> $null
$okParamiko = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $oldEap
if ($okParamiko) { Write-Host 'paramiko (SFTP): OK' } else { Write-Host 'Aviso: nao consegui instalar o paramiko (SFTP). O MML funciona; o painel KPIs MAE nao.' -ForegroundColor Yellow }

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
#
# v3.2 = v2.2 (painel Executar no MAE, /unreg, SFTP explorar) + rotas PM do mml_helper_v3
#        (/pm/fetch, /pm/progress, /pm/abort) + aba 9 "SW & CFGFILE":
#        /job/*          comandos demorados (DLD/ACT/SPL) em segundo plano, com percentual
#        /file-server/*  teste, listagem e upload de XML no servidor de arquivos (FTP ou SFTP)
# v3.3 = /secret/set e /secret/clear: senha padrao guardada neste PC (DPAPI no Windows)
import argparse, base64, datetime as dt, gzip, io, json, os, re, socket, stat, sys, threading, time
from urllib.parse import urlparse, parse_qs
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAE_IP, MAE_PORT = os.environ.get("MAE_IP", "10.220.30.9"), int(os.environ.get("MAE_PORT", "31114"))
EOL = b"\r\n"
LOCAL_PORT = 8765
END = "---    END"
VERSION = "3.3"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(HERE, "helper.log")
PM_ROOT = "/opt/oss/server/var/fileint/pmneexport"
PM_CACHE = os.path.join(HERE, "pmcache")
MAP_FILE = os.path.join(HERE, "counter_map.json")   # {"1526726657": "L.E-RAB.SuccEst.PLMN", ...}
PWD_RE = re.compile(r'(PWD\s*=\s*")[^"]*(")', re.I)


def mask(s):
    """Esconde a senha de comandos e respostas MML antes de qualquer saida (tela, log, JSON)."""
    return PWD_RE.sub(r"\1********\2", s or "")


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

    def _read(self, maxsec=180, idle=0.08, on_data=None, stop=None, done=None):
        """on_data(buf): chamado a cada bloco recebido (acompanhamento).
        stop(): devolve True para desistir de esperar.
        done(buf): devolve True para encerrar antes (ex.: relatorio final reconhecido)."""
        buf, t0, last = "", time.time(), time.time()
        while time.time() - t0 < maxsec:
            try:
                d = self.sock.recv(65536)
                if not d: raise ConnectionError("MAE fechou a conexao")
                buf += d.decode(errors="ignore"); last = time.time()
                if on_data: on_data(buf)
            except socket.timeout:
                pass
            if stop and stop(): return buf + "\n[INTERROMPIDO]"
            if done and END in buf and time.time() - last >= 0.5 and done(buf): return buf
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

    def _send(self, cmd, maxsec=180, **kw):
        # sobra do comando anterior vai junto (o Baseline separa pelo eco %%CMD%%)
        pre = self._drain()
        self.sock.sendall(cmd.encode() + EOL)
        return pre + self._read(maxsec, **kw)

    def send_long(self, cmd, maxsec=3600, quiet=20, on_data=None, stop=None, done=None):
        """Comando demorado (DLD/ACT/SPL): o site manda varios relatorios de progresso.
        Termina quando o ultimo relatorio nao traz "To be continued" E passam `quiet` segundos
        sem chegar nada novo (ou quando done()/stop() mandam parar)."""
        if not self.sock:
            if not self.user: raise RuntimeError("Nao logado")
            self.login(self.user, self.pwd)
        return self._send(cmd, maxsec, idle=max(1.0, float(quiet)), on_data=on_data, stop=stop, done=done)

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


# ======================= SFTP (somente leitura) =======================
SFTP_PORT = 22
RAN_RE = re.compile(r"eNodeB|NodeB|gNodeB|Local Cell ID|LocalCellId|CellID|Cell ID|Label=|CnOperator|Cn Operator|PLMN|"
                    r"BTS3900|BTS5900|BSC69|RNC|UCell|EUtranCell|NRCell|ULoCell", re.I)
DATA_EXT = (".xml.gz", ".xml", ".csv", ".csv.gz", ".gz", ".zip")


class SFTP:
    def __init__(self):
        self.ssh = None; self.sftp = None; self.user = None; self.lock = threading.Lock()

    def login(self, user, pwd):
        try:
            import paramiko
        except ImportError:
            raise RuntimeError("paramiko nao instalado: rode o instalador do helper de novo ou 'python -m pip install paramiko'")
        self.close()
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect(MAE_IP, SFTP_PORT, user, pwd, timeout=20, banner_timeout=20, auth_timeout=20,
                  look_for_keys=False, allow_agent=False)
        self.ssh, self.sftp, self.user = c, c.open_sftp(), user     # so SFTP: nenhum exec_command

    def close(self):
        for o in (self.sftp, self.ssh):
            try:
                if o: o.close()
            except Exception: pass
        self.ssh = self.sftp = self.user = None

    def need(self):
        if not self.sftp: raise RuntimeError("SFTP nao conectado")
        return self.sftp

    def ls(self, path):
        out = []
        for a in self.need().listdir_attr(path):
            d = stat.S_ISDIR(a.st_mode or 0)
            out.append({"name": a.filename, "type": "dir" if d else "file", "size": a.st_size, "mtime": a.st_mtime})
        out.sort(key=lambda x: (x["type"] != "dir", x["name"]))
        return out

    def scan(self, root, depth=4, max_dirs=3000, max_sec=90):
        """Arvore so de diretorios, com no. de arquivos e data mais recente por pasta."""
        sf, t0, n = self.need(), time.time(), [0]

        def walk(path, lvl):
            node = {"path": path, "name": path.rstrip("/").split("/")[-1] or "/", "files": 0, "newest": 0,
                    "exts": {}, "dirs": [], "error": None, "truncated": False}
            n[0] += 1
            try:
                items = sf.listdir_attr(path)
            except Exception as e:
                node["error"] = str(e) or e.__class__.__name__
                return node
            subs = []
            for a in items:
                if stat.S_ISDIR(a.st_mode or 0):
                    subs.append(a.filename)
                else:
                    node["files"] += 1
                    node["newest"] = max(node["newest"], a.st_mtime or 0)
                    ext = next((x for x in DATA_EXT if a.filename.lower().endswith(x)), "outros")
                    node["exts"][ext] = node["exts"].get(ext, 0) + 1
            subs.sort()
            if lvl >= depth:
                node["subdirs"] = len(subs)
                return node
            for i, sname in enumerate(subs):
                if n[0] >= max_dirs or time.time() - t0 > max_sec:
                    node["truncated"] = True; node["subdirs"] = len(subs); break
                node["dirs"].append(walk(path.rstrip("/") + "/" + sname, lvl + 1))
            return node
        tree = walk(root, 0)
        return {"tree": tree, "dirs": n[0], "seconds": round(time.time() - t0, 1),
                "truncated": n[0] >= max_dirs or time.time() - t0 > max_sec}

    def _open_text(self, path, max_bytes):
        """Abre o arquivo remoto (descompacta .gz em streaming). Devolve objeto binario legivel."""
        f = self.need().open(path, "rb")
        f.prefetch()
        if path.lower().endswith(".gz"):
            return gzip.GzipFile(fileobj=f), f
        return f, f

    def peek(self, path, max_mb=300, known_ne=()):
        st_ = self.need().stat(path)
        src, raw = self._open_text(path, max_mb)
        try:
            head = src.read(256 * 1024)
            lines = head.decode("utf-8", "replace").splitlines()[:80]
            res = {"path": path, "size": st_.st_size, "mtime": st_.st_mtime, "head": lines}
            if path.lower().endswith((".csv", ".csv.gz")):
                rest = head + src.read(max_mb * 1024 * 1024)
                txt = rest.decode("utf-8", "replace")
                ln = txt.splitlines()
                res.update({"kind": "csv", "lines": len(ln), "ranHits": len([l for l in ln if RAN_RE.search(l)]),
                            "neHits": sorted(set(known_ne) & set(re.split(r"[\s,;:=/\"']+", txt)))[:20]})
                res["isRAN"] = bool(res["ranHits"] or res["neHits"])
                return res
            res.update(summarize_xml(io.BytesIO(head), src, max_mb, known_ne))
            return res
        finally:
            try: raw.close()
            except Exception: pass

    def probe(self, root, depth=4, per_dir=1, max_dirs=60, known_ne=()):
        """Para cada pasta com arquivos de dados, abre o mais recente e diz se tem RAN."""
        sc = self.scan(root, depth)
        found = []

        def visit(nd):
            if nd.get("files") and any(k != "outros" for k in nd.get("exts", {})):
                found.append(nd)
            for c in nd.get("dirs", []): visit(c)
        visit(sc["tree"])
        out = []
        for nd in found[:max_dirs]:
            try:
                fl = [x for x in self.ls(nd["path"]) if x["type"] == "file" and x["name"].lower().endswith(DATA_EXT)]
                fl.sort(key=lambda x: x["mtime"] or 0, reverse=True)
                for f in fl[:per_dir]:
                    pk = self.peek(nd["path"].rstrip("/") + "/" + f["name"], max_mb=40, known_ne=known_ne)
                    pk.pop("head", None)
                    out.append({"dir": nd["path"], "file": f["name"], "summary": pk})
            except Exception as e:
                out.append({"dir": nd["path"], "error": str(e)})
        return {"scan": {"dirs": sc["dirs"], "seconds": sc["seconds"], "truncated": sc["truncated"]},
                "dataDirs": len(found), "probed": out}


def _ln(tag): return tag.rsplit("}", 1)[-1]


def ldn_shape(ldn):
    """Agrupa measObjLdn por 'forma': troca valores por *, ex. 'X/eNodeB Function Name=*, Local Cell ID=*'."""
    s = re.sub(r"=([^,/]*)", "=*", ldn)
    s = re.sub(r"^[^/:]+(?=[/:])", "<NE>", s)
    return s[:200]


def summarize_xml(head_io, rest_io, max_mb, known_ne):
    """Le o XML 3GPP (TS 32.435) em streaming e resume."""
    class Chain(io.RawIOBase):
        def __init__(self, a, b): self.a, self.b, self.n = a, b, 0
        def readable(self): return True
        def readinto(self, buf):
            if self.n > max_mb * 1024 * 1024: return 0
            d = self.a.read(len(buf)) or self.b.read(len(buf))
            buf[:len(d)] = d; self.n += len(d); return len(d)
    stream = io.BufferedReader(Chain(head_io, rest_io), 1 << 16)
    r = {"kind": "xml", "root": None, "beginTime": None, "measInfo": 0, "granularity": {}, "measTypes": "?",
         "measTypesSample": [], "ldnShapes": {}, "ldnSample": [], "measValues": 0, "neHits": [], "ranHits": 0, "parseError": None}
    ne_set, ne_hits = set(known_ne), set()
    try:
        for ev, el in ET.iterparse(stream, events=("start", "end")):
            t = _ln(el.tag)
            if ev == "start":
                if r["root"] is None: r["root"] = t + (" {" + el.tag[1:].split("}")[0] + "}" if el.tag.startswith("{") else "")
                if t == "measCollec" and el.get("beginTime"): r["beginTime"] = r["beginTime"] or el.get("beginTime")
                continue
            if t == "measInfo":
                r["measInfo"] += 1; el.clear()
            elif t == "granPeriod":
                k = el.get("duration") or "?"; r["granularity"][k] = r["granularity"].get(k, 0) + 1
            elif t == "measTypes" and r["measTypes"] == "?":
                toks = (el.text or "").split()
                r["measTypes"] = "IDs numericos" if toks and all(x.isdigit() for x in toks) else "nomes"
                r["measTypesSample"] = toks[:8]
            elif t == "measType" and r["measTypes"] == "?":
                r["measTypes"] = "nomes (measType)"; r["measTypesSample"].append(el.text)
            elif t == "measValue":
                ldn = el.get("measObjLdn") or ""
                r["measValues"] += 1
                sh = ldn_shape(ldn); r["ldnShapes"][sh] = r["ldnShapes"].get(sh, 0) + 1
                if len(r["ldnSample"]) < 5 and ldn not in r["ldnSample"]: r["ldnSample"].append(ldn)
                if RAN_RE.search(ldn): r["ranHits"] += 1
                if ne_set and len(ne_hits) < 20:
                    for tok in re.split(r"[/,:=\s]+", ldn):
                        if tok in ne_set: ne_hits.add(tok)
                el.clear()
    except ET.ParseError as e:
        r["parseError"] = str(e)
    except EOFError as e:
        r["parseError"] = "arquivo truncado: " + str(e)
    r["neHits"] = sorted(ne_hits)
    r["ldnShapes"] = dict(sorted(r["ldnShapes"].items(), key=lambda kv: -kv[1])[:15])
    r["isRAN"] = bool(r["ranHits"] or r["neHits"])
    return r


sftp = SFTP()


# ======================= PM (KPIs) - vindo do mml_helper_v3 =======================
PROG = {"total": 0, "done": 0, "file": "", "log": [], "abort": False}


def _iso_local(s):
    return dt.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")


def _dur(s):
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    return (int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)) if m else 0


def pm_get(sf, path):
    """Baixa (com cache em pmcache/) e devolve o conteudo do arquivo PM, ja descompactado."""
    os.makedirs(PM_CACHE, exist_ok=True)
    local = os.path.join(PM_CACHE, path.strip("/").replace("/", "__"))
    if not os.path.exists(local):
        sf.need().get(path, local + ".part"); os.replace(local + ".part", local)
    with open(local, "rb") as f: data = f.read()
    return gzip.decompress(data) if path.endswith(".gz") else data


def iter_records(data):
    """Gera (inicio, periodo_s, ldn, {contador: valor}) de um measCollecFile 3GPP 32.435 (bytes)."""
    cmap = {}
    if os.path.exists(MAP_FILE):
        try:
            with open(MAP_FILE, encoding="utf-8") as f: cmap = json.load(f)
        except Exception: pass
    types, end, per = [], None, 0
    for ev, el in ET.iterparse(io.BytesIO(data), events=("start", "end")):
        t = _ln(el.tag)
        if ev == "start" and t == "measInfo": types, end, per = [], None, 0
        if ev != "end": continue
        if t == "granPeriod":
            end = el.get("endTime"); per = _dur(el.get("duration"))
        elif t == "measTypes":
            types = (el.text or "").split()
        elif t == "measType":
            types.append((el.text or "").strip())
        elif t == "measValue":
            ldn, vals = el.get("measObjLdn", ""), []
            for c in el:
                ct = _ln(c.tag)
                if ct == "measResults": vals = (c.text or "").split()
                elif ct == "r": vals.append((c.text or "").strip())
            rec = {cmap.get(k, k): v for k, v in zip(types, vals)}
            if end:
                yield (_iso_local(end) - dt.timedelta(seconds=per), per, ldn, rec)
            el.clear()
        elif t == "measInfo":
            el.clear()


def split_ldn(ldn):
    ne, _, rest = ldn.partition("/")
    otype, _, attrs = rest.partition(":")
    return ne, (otype or "Object"), attrs


def build_csv(rows, title):
    """rows: lista (inicio, periodo_s, ldn, rec). Saida no formato do Query Result do MAE."""
    agg, counters, otypes = {}, [], []
    for st_, per, ldn, rec in rows:
        h = st_.replace(minute=0, second=0)          # agrega para 60 min (soma)
        ne, ot, attrs = split_ldn(ldn)
        cell, op = attrs, ""
        m = re.search(r",?\s*(CN Operator ID=.*)$", attrs)
        if m: cell, op = attrs[:m.start()].strip(", "), m.group(1)
        d = agg.setdefault((h, ne, ot, cell, op), {})
        for k, v in rec.items():
            if k not in counters: counters.append(k)
            try: d[k] = d.get(k, 0.0) + float(v)
            except ValueError: pass
        if ot not in otypes: otypes.append(ot)
    has_op = any(k[4] for k in agg)
    hdr = ["Start Time", "Period (min)", "NE Name", "Cell" if has_op else (otypes[0] if len(otypes) == 1 else "Object")]
    if has_op: hdr.append("CnOperator")
    hdr += counters
    q = lambda x: '"' + str(x).replace('"', '""') + '"'
    fmt = lambda v: ("%d" % v) if float(v).is_integer() else ("%.3f" % v)
    out = [q(title), q("Gerado pelo helper MML a partir de pmneexport"), q(""), q(""), ",".join(map(q, hdr))]
    for (h, ne, ot, cell, op), d in sorted(agg.items()):
        line = [h.strftime("%Y-%m-%d %H:%M:%S"), "60", ne, cell if has_op or len(otypes) == 1 else f"{ot}:{cell}"]
        if has_op: line.append(op)
        line += [fmt(d[c]) if c in d else "" for c in counters]
        out.append(",".join(map(q, line)))
    return "\n".join(out), len(agg)


def pm_fetch(sf, sites, d_from, d_to, sub, prog):
    d0 = dt.datetime.strptime(d_from, "%Y-%m-%d"); d1 = dt.datetime.strptime(d_to, "%Y-%m-%d")
    pats = [s.strip().upper() for s in sites if s.strip()]
    files, d = [], d0
    while d <= d1:
        base = f"{PM_ROOT}/neexport_{d:%Y%m%d}"
        try:
            dirs = [sub] if sub else [x["name"] for x in sf.ls(base) if x["type"] == "dir"]
            for dd in dirs:
                for f in sf.ls(f"{base}/{dd}"):
                    if f["type"] == "file" and re.search(r"\.xml(\.gz)?$", f["name"]): files.append(f"{base}/{dd}/{f['name']}")
        except Exception as e:
            prog["log"].append(f"{base}: {e}")
        d += dt.timedelta(days=1)
    prog["total"] = len(files); rows = []
    for i, p in enumerate(files):
        if prog.get("abort"): break
        prog["done"] = i; prog["file"] = p.rsplit("/", 1)[-1]
        try:
            for r in iter_records(pm_get(sf, p)):
                if not pats or any(s in r[2].upper() for s in pats): rows.append(r)
        except Exception as e:
            prog["log"].append(f"{p}: {e}")
    prog["done"] = len(files)
    return rows


# ======================= Senha padrao guardada neste PC =======================
# A pagina nunca recebe esta senha de volta: ela manda o marcador SAVED_TOKEN no lugar
# da senha e o helper troca pelo valor real so na hora de falar com o site / servidor.
# No Windows o arquivo e cifrado com DPAPI (so o mesmo usuario do Windows consegue abrir).
SAVED_TOKEN = "__SENHA_SALVA__"
SECRET_FILE = os.path.join(HERE, "senha_padrao.dat")
SAVED = {"pwd": None, "warn": ""}


def _dpapi(data, protect):
    import ctypes
    from ctypes import wintypes as w

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", w.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]
    buf = ctypes.create_string_buffer(data, len(data))
    src, dst = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), BLOB()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    if not fn(ctypes.byref(src), None, None, None, None, 0, ctypes.byref(dst)):
        raise OSError("DPAPI recusou (%d)" % ctypes.GetLastError())
    try:
        return ctypes.string_at(dst.pbData, dst.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(dst.pbData, ctypes.c_void_p))


def secret_load():
    try:
        with open(SECRET_FILE, "rb") as f: raw = f.read()
    except OSError:
        return
    try:
        head, _, body = raw.partition(b":")
        if head == b"dpapi": SAVED["pwd"] = _dpapi(base64.b64decode(body), False).decode("utf-8")
        elif head == b"b64": SAVED["pwd"] = base64.b64decode(body).decode("utf-8")
    except Exception as e:
        SAVED["warn"] = "nao consegui abrir a senha salva (%s): salve de novo" % e.__class__.__name__


def secret_save(pwd):
    pwd = str(pwd or "")
    if not pwd or SAVED_TOKEN in pwd or any(ord(c) < 32 for c in pwd) or '"' in pwd:
        raise ApiError(400, "bad_pwd", "senha invalida (vazia, com aspas ou caracteres de controle)")
    SAVED["pwd"], SAVED["warn"] = pwd, ""
    try:
        data = b"dpapi:" + base64.b64encode(_dpapi(pwd.encode("utf-8"), True)) if os.name == "nt" else b"b64:" + base64.b64encode(pwd.encode("utf-8"))
        fd = os.open(SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f: f.write(data)
        return {"ok": True, "persisted": True, "message": "senha salva neste PC"}
    except Exception as e:
        SAVED["warn"] = "senha guardada so ate fechar o helper (%s)" % e.__class__.__name__
        return {"ok": True, "persisted": False, "message": SAVED["warn"]}


def secret_clear():
    SAVED["pwd"], SAVED["warn"] = None, ""
    try: os.remove(SECRET_FILE)
    except OSError: pass
    return {"ok": True}


def use_saved(text):
    """Troca o marcador pela senha salva (so no momento do envio)."""
    if SAVED_TOKEN not in (text or ""): return text
    if not SAVED["pwd"]: raise ApiError(409, "no_saved_pwd", "nao ha senha salva neste PC: salve no topo da aba SW & CFGFILE")
    return text.replace(SAVED_TOKEN, SAVED["pwd"])


secret_load()


# ======================= Erros com codigo HTTP (sem stack trace na pagina) =======================
class ApiError(Exception):
    def __init__(self, http, code, message, **extra):
        Exception.__init__(self, message)
        self.http, self.payload = http, dict(ok=False, code=code, message=message, error=message, **extra)


# ======================= Tarefas demoradas (aba 9: DLD / ACT / SPL) =======================
# A pagina dispara /job/start e vai consultando /job/status: nada fica preso no navegador,
# entao da para trocar de aba (ou ate recarregar a pagina) enquanto o site baixa o software.
RET_RE = re.compile(r"RETCODE\s*=\s*(\d+)\s*([^\r\n]*)")
PCT_RE = r"(\d{1,3})\s*%"
JOBS, JOBS_LOCK, JOB_SEQ = {}, threading.Lock(), [0]
MAX_RUNNING = 6


def _rx(pattern, what):
    if not pattern: return None
    try: return re.compile(pattern, re.I)
    except re.error as e: raise ApiError(400, "bad_regex", f"expressao invalida em {what}: {e}")


def judge(resp):
    """(ok, mensagem) de uma resposta MML: sucesso = existe RETCODE e todos sao 0."""
    codes = RET_RE.findall(resp or "")
    if "[INTERROMPIDO]" in resp: return False, "interrompido"
    bad = [c for c in codes if c[0] != "0"]
    if bad: return False, f"RETCODE = {bad[-1][0]} {bad[-1][1].strip()}"
    if "[TIMEOUT" in resp: return False, "tempo esgotado esperando o fim do comando"
    if not codes: return False, "sem RETCODE na resposta"
    return True, f"RETCODE = 0 {codes[-1][1].strip()}"


class Job:
    def __init__(self, body):
        if not mml.user: raise ApiError(409, "not_logged", "Conecte no painel Executar no MAE (aba Entrada) primeiro")
        self.ne = str(body.get("ne") or "").strip()
        if not self.ne: raise ApiError(400, "no_ne", "informe o NE/BBU")
        steps = body.get("steps") or []
        if not steps: raise ApiError(400, "no_steps", "nenhum comando para executar")
        self.title = str(body.get("title") or "Tarefa")[:120]
        self.meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
        self.pct_re = _rx(body.get("pctRe") or PCT_RE, "percentual")
        self.done_re = _rx(body.get("doneRe"), "fim do comando")
        self.fail_re = _rx(body.get("failRe"), "falha")
        self.steps = []
        for s in steps:
            cmd = str(s.get("cmd") or "").strip()
            if not cmd: continue
            self.steps.append({"label": str(s.get("label") or "")[:80], "cmd": cmd, "long": bool(s.get("long")),
                               "maxsec": max(10, min(int(s.get("maxsec") or 180), 6 * 3600)),
                               "quiet": max(1, min(int(s.get("quiet") or 20), 600)),
                               "state": "pending", "pct": None, "ok": None, "msg": "", "resp": "", "t0": 0, "t1": 0})
        if not self.steps: raise ApiError(400, "no_steps", "nenhum comando para executar")
        for s in self.steps: use_saved(s["cmd"])            # sem senha salva: recusa ja na partida
        self.state, self.note, self.abort, self.cur = "queued", "", False, -1
        self.created, self.ended = time.time(), 0
        self.user, self.pwd = mml.user, mml.pwd
        with JOBS_LOCK:
            if sum(1 for j in JOBS.values() if j.state in ("queued", "running")) >= MAX_RUNNING:
                raise ApiError(429, "busy", f"ja existem {MAX_RUNNING} tarefas em andamento")
            if any(j.ne == self.ne and j.state in ("queued", "running") for j in JOBS.values()):
                raise ApiError(409, "ne_busy", f"ja existe uma tarefa em andamento em {self.ne}")
            JOB_SEQ[0] += 1
            self.id = "%s-%d" % (time.strftime("%H%M%S"), JOB_SEQ[0])
            JOBS[self.id] = self
            for old in sorted(JOBS, key=lambda k: JOBS[k].created)[:-40]:
                if JOBS[old].state not in ("queued", "running"): JOBS.pop(old, None)
        threading.Thread(target=self.run, daemon=True).start()

    def view(self, full=False):
        steps = []
        for s in self.steps:
            r = mask(s["resp"])
            steps.append({"label": s["label"], "cmd": mask(s["cmd"]), "long": s["long"], "state": s["state"], "pct": s["pct"],
                          "ok": s["ok"], "msg": s["msg"], "resp": r if full else r[-6000:], "respLen": len(r),
                          "t0": s["t0"], "t1": s["t1"]})
        return {"id": self.id, "ne": self.ne, "title": self.title, "meta": self.meta, "state": self.state, "note": self.note,
                "cur": self.cur, "created": self.created, "ended": self.ended, "now": time.time(), "steps": steps}

    def _pct(self, s, buf):
        hits = self.pct_re.findall(buf[-4000:]) if self.pct_re else []
        if hits:
            try:
                v = int(hits[-1] if isinstance(hits[-1], str) else hits[-1][0])
                if 0 <= v <= 100: s["pct"] = v
            except (ValueError, IndexError): pass

    def _one(self, m, s):
        line = use_saved(s["cmd"])
        if line.upper().startswith("#WAIT"):
            n = int(line.split()[1])
            for _ in range(n):
                if self.abort: return "[INTERROMPIDO]"
                time.sleep(1)
            return f"aguardou {n}s\nRETCODE = 0  ok"
        if line.upper().startswith("#UNTIL"):
            cmd, alvo = [x.strip() for x in line[6:].split("|", 1)]
            rx, r = re.compile(alvo), ""
            for _ in range(max(1, s["maxsec"] // 20)):
                r = m.send(cmd); s["resp"] = r; self._pct(s, r)
                if rx.search(r): return r
                for _ in range(20):
                    if self.abort: return r + "\n[INTERROMPIDO]"
                    time.sleep(1)
            return r + f"\n[TIMEOUT {s['maxsec']}s] a resposta nao casou com: {alvo}"
        if not s["long"]:
            return m.send(line, s["maxsec"])

        def on_data(buf):
            s["resp"] = buf; self._pct(s, buf)

        def done(buf):
            i = buf.rfind(END); prev = buf.rfind(END, 0, i)
            seg = buf[prev + len(END) if prev >= 0 else 0:i]
            if any(c != "0" for c, _ in RET_RE.findall(seg)): return True        # o site ja recusou: nao ha o que esperar
            return bool(self.done_re and self.done_re.search(seg)) or bool(self.fail_re and self.fail_re.search(seg))
        return m.send_long(line, s["maxsec"], s["quiet"], on_data, lambda: self.abort, done)

    def run(self):
        m, own = mml, False
        try:
            try:                                   # sessao MML propria: o painel da aba Entrada continua livre
                m2 = MML(); m2.login(self.user, self.pwd); m, own = m2, True
            except Exception as e:
                self.note = "Sem sessao MML dedicada (%s): usando a sessao principal; outros comandos esperam esta tarefa terminar." % str(e)[:120]
            with m.lock:
                self.state = "running"
                g = m.reg(self.ne)
                if g and not g["ok"]:
                    self.state = "failed"; self.note = "REG NE falhou: " + judge(g["resp"])[1]
                    for s in self.steps: s["state"] = "skipped"
                    return
                failed = False
                for i, s in enumerate(self.steps):
                    if self.abort or failed:
                        s["state"] = "skipped"; continue
                    self.cur = i; s["state"] = "running"; s["t0"] = time.time()
                    try:
                        r = self._one(m, s)
                    except Exception as e:
                        r = (s["resp"] or "") + "\n[ERRO] " + str(e)
                        s["resp"], s["ok"], s["msg"] = r, False, str(e)
                    else:
                        s["resp"] = r; self._pct(s, r)
                        s["ok"], s["msg"] = judge(r)
                        if s["ok"] and self.fail_re and self.fail_re.search(r):
                            s["ok"], s["msg"] = False, "a resposta casou com a expressao de falha"
                    s["t1"] = time.time()
                    s["state"] = "done" if s["ok"] else ("canceled" if self.abort else "failed")
                    if not s["ok"]: failed = True
                m.unreg()
                self.state = "canceled" if self.abort else ("failed" if failed else "done")
        except Exception as e:
            self.state = "failed"; self.note = (self.note + " " if self.note else "") + "Erro: " + str(e)
            logf("job %s erro: %s" % (self.id, e))
        finally:
            self.ended = time.time(); self.pwd = None
            for s in self.steps:
                if s["state"] in ("pending", "running"): s["state"] = "skipped" if s["state"] == "pending" else "failed"
            if own: m.close()
            logf("job %s (%s em %s): %s" % (self.id, self.title, self.ne, self.state))


def job_get(jid):
    j = JOBS.get(jid)
    if not j: raise ApiError(404, "no_job", "tarefa nao encontrada (o helper foi reiniciado?)")
    return j


# ======================= Servidor de arquivos (aba 9: upload do XML) =======================
# Sessao propria, separada do MML e do SFTP do MAE: usuario/senha chegam a cada pedido e
# nao sao guardados aqui.
MAX_UPLOAD = 300 * 1024 * 1024
BAD_NAME = re.compile(r'[/\\\x00-\x1f\x7f]')


def fs_name(name):
    name = str(name or "").strip()
    if not name or BAD_NAME.search(name) or ".." in name:
        raise ApiError(400, "bad_name", "nome de arquivo invalido (sem / \\ .. ou caracteres de controle)")
    if not name.lower().endswith(".xml"): raise ApiError(400, "bad_ext", "somente arquivos .xml")
    return name


def fs_join(d, name):
    d = str(d or "/").strip() or "/"
    if any(ord(c) < 32 for c in d): raise ApiError(400, "bad_dir", "diretorio invalido")
    return d.rstrip("/") + "/" + name


class FtpCli:
    proto = "FTP"

    def __init__(self, host, port, user, pwd):
        import ftplib
        self.lib = ftplib
        self.f = ftplib.FTP()
        self.f.connect(host, port, timeout=20)
        self.f.login(user, pwd)
        self.f.set_pasv(True)

    def ls(self, d):
        out = []
        try:
            for name, fa in self.f.mlsd(d):
                if name in (".", ".."): continue
                out.append({"name": name, "type": "dir" if fa.get("type") in ("dir", "cdir", "pdir") else "file",
                            "size": int(fa.get("size") or 0), "mtime": fa.get("modify", "")})
        except self.lib.error_perm:
            lines = []
            self.f.cwd(d); self.f.retrlines("LIST", lines.append)
            for ln in lines:
                p = ln.split(None, 8)
                if len(p) < 9 or p[8] in (".", ".."): continue
                out.append({"name": p[8], "type": "dir" if ln.startswith("d") else "file",
                            "size": int(p[4]) if p[4].isdigit() else 0, "mtime": " ".join(p[5:8])})
        return out

    def size(self, path):
        try:
            self.f.voidcmd("TYPE I")
            return self.f.size(path)
        except self.lib.error_perm:
            d, _, n = path.rpartition("/")
            try:
                for x in self.ls(d or "/"):
                    if x["name"] == n and x["type"] == "file": return x["size"]
            except self.lib.all_errors: pass
            return None

    def put(self, data, path): self.f.storbinary("STOR " + path, io.BytesIO(data))
    def rename(self, a, b): self.f.rename(a, b)
    def remove(self, path): self.f.delete(path)

    def close(self):
        try: self.f.quit()
        except Exception:
            try: self.f.close()
            except Exception: pass


class SftpCli:
    proto = "SFTP"

    def __init__(self, host, port, user, pwd):
        try:
            import paramiko
        except ImportError:
            raise ApiError(500, "no_paramiko", "paramiko nao instalado: rode o instalador do helper de novo")
        self.c = paramiko.SSHClient()
        self.c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.c.connect(host, port, user, pwd, timeout=20, banner_timeout=20, auth_timeout=20, look_for_keys=False, allow_agent=False)
        self.s = self.c.open_sftp()

    def ls(self, d):
        return [{"name": a.filename, "type": "dir" if stat.S_ISDIR(a.st_mode or 0) else "file", "size": a.st_size or 0,
                 "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(a.st_mtime or 0))} for a in self.s.listdir_attr(d)]

    def size(self, path):
        try: return self.s.stat(path).st_size
        except IOError: return None

    def put(self, data, path): self.s.putfo(io.BytesIO(data), path)

    def rename(self, a, b):
        try: self.s.posix_rename(a, b)
        except Exception: self.s.rename(a, b)

    def remove(self, path): self.s.remove(path)

    def close(self):
        for o in (self.s, self.c):
            try: o.close()
            except Exception: pass


def fs_error(e):
    """Traduz a excecao da conexao em ApiError com HTTP adequado e texto curto."""
    if isinstance(e, ApiError): return e
    name, txt = e.__class__.__name__, (str(e) or e.__class__.__name__)[:300]
    if name in ("AuthenticationException", "BadAuthenticationType") or re.match(r"^(530|331|332)\b", txt):
        return ApiError(401, "auth", "usuario ou senha recusados pelo servidor de arquivos (" + txt + ")")
    if isinstance(e, (socket.timeout, TimeoutError)) or "timed out" in txt:
        return ApiError(504, "timeout", "o servidor nao respondeu (porta fechada, firewall ou VPN desligada)")
    if isinstance(e, ConnectionRefusedError):
        return ApiError(502, "refused", "conexao recusada: nao ha servico nesta porta")
    if isinstance(e, (FileNotFoundError,)) or re.match(r"^550\b", txt) or "No such file" in txt:
        return ApiError(404, "not_found", "diretorio ou arquivo nao encontrado / sem permissao (" + txt + ")")
    if isinstance(e, PermissionError) or re.match(r"^(553|532)\b", txt):
        return ApiError(403, "denied", "sem permissao no servidor de arquivos (" + txt + ")")
    if isinstance(e, OSError):
        return ApiError(502, "network", "falha de rede: " + txt)
    return ApiError(500, "error", txt)


def fs_params(b):
    host = str(b.get("host") or "").strip()
    proto = str(b.get("protocol") or "FTP").upper()
    if not re.match(r"^[A-Za-z0-9.\-:]+$", host): raise ApiError(400, "bad_host", "informe o servidor (IP ou nome)")
    if proto not in ("FTP", "SFTP"): raise ApiError(400, "bad_protocol", "protocolo deve ser FTP ou SFTP")
    port = int(b.get("port") or (21 if proto == "FTP" else 22))
    if not 0 < port < 65536: raise ApiError(400, "bad_port", "porta invalida")
    user, pwd = str(b.get("user") or ""), use_saved(str(b.get("pwd") or ""))
    if not user or not pwd: raise ApiError(400, "no_cred", "informe usuario e senha do servidor de arquivos")
    return host, proto, port, user, pwd


def fs_open(host, proto, port, user, pwd):
    try:
        return (FtpCli if proto == "FTP" else SftpCli)(host, port, user, pwd)
    except Exception as e:
        raise fs_error(e)


def fs_test(b):
    host, proto, port, user, pwd = fs_params(b)
    cands = [(proto, port)]
    if b.get("probe"):
        for c in (("FTP", 21), ("SFTP", 22)):
            if c not in cands: cands.append(c)
    d, results = str(b.get("dir") or "").strip(), []
    for pr, po in cands:
        r = {"protocol": pr, "port": po, "tcp": False, "login": False, "dirOk": None, "message": ""}
        try:
            socket.create_connection((host, po), 6).close(); r["tcp"] = True
        except Exception as e:
            r["message"] = fs_error(e).payload["message"]; results.append(r); continue
        try:
            c = fs_open(host, pr, po, user, pwd)
        except ApiError as e:
            r["message"] = e.payload["message"]; results.append(r); continue
        r["login"] = True; r["message"] = "conexao e login OK"
        if d:
            try:
                r["dirOk"] = True; r["entries"] = len(c.ls(d)); r["message"] += f" - {d}: {r['entries']} item(ns)"
            except Exception as e:
                r["dirOk"] = False; r["message"] += " - diretorio: " + fs_error(e).payload["message"]
        c.close(); results.append(r)
    good = next((r for r in results if r["login"] and r["dirOk"] is not False), None) or next((r for r in results if r["login"]), None)
    return {"ok": bool(good), "host": host, "results": results, "best": good and {"protocol": good["protocol"], "port": good["port"]},
            "message": good["message"] if good else "nenhuma combinacao de protocolo/porta aceitou a conexao"}


def fs_list(b):
    host, proto, port, user, pwd = fs_params(b)
    d = str(b.get("dir") or "/").strip() or "/"
    c = fs_open(host, proto, port, user, pwd)
    try:
        items = c.ls(d)
    except Exception as e:
        raise fs_error(e)
    finally:
        c.close()
    items.sort(key=lambda x: (x["type"] != "dir", x["name"]))
    return {"ok": True, "protocol": proto, "host": host, "port": port, "dir": d, "items": items[:2000], "total": len(items)}


def fs_upload(b):
    host, proto, port, user, pwd = fs_params(b)
    name = fs_name(b.get("name"))
    try:
        data = base64.b64decode(b.get("data") or "", validate=True)
    except Exception:
        raise ApiError(400, "bad_data", "conteudo do arquivo invalido")
    if not data: raise ApiError(400, "empty", "o arquivo esta vazio")
    target = fs_join(b.get("dir"), name)
    part = target + ".part"
    c = fs_open(host, proto, port, user, pwd)
    try:
        old = c.size(target)
        if old is not None and not b.get("overwrite"):
            raise ApiError(409, "exists", f"{name} ja existe no servidor ({old} bytes)", existingBytes=old, remotePath=target)
        if b.get("direct"):
            c.put(data, target); how = "envio direto (sem .part)"
        else:
            c.put(data, part)
            got = c.size(part)
            if got is not None and got != len(data):
                try: c.remove(part)
                except Exception: pass
                raise ApiError(500, "size_mismatch", f"tamanho no servidor ({got}) diferente do enviado ({len(data)})")
            try:
                if old is not None:
                    try: c.remove(target)
                    except Exception: pass
                c.rename(part, target)
            except Exception as e:
                try: c.remove(part)
                except Exception: pass
                raise ApiError(409, "rename_failed", "o servidor nao permitiu renomear o .part (" + fs_error(e).payload["message"] + ")",
                               remotePath=target)
            how = "enviado como .part e renomeado"
        got = c.size(target)
        if got is not None and got != len(data):
            raise ApiError(500, "size_mismatch", f"tamanho no servidor ({got}) diferente do enviado ({len(data)})", remotePath=target)
        return {"ok": True, "protocol": proto, "host": host, "port": port, "remotePath": target, "fileName": name, "bytes": len(data),
                "overwritten": old is not None, "sizeChecked": got is not None,
                "message": how + ("" if got is not None else " (o servidor nao informou o tamanho para conferir)")}
    except ApiError:
        raise
    except Exception as e:
        raise fs_error(e)
    finally:
        c.close()


class Handler(BaseHTTPRequestHandler):
    def _hdr(self, code=200, ctype="application/json"):
        origin = self.headers.get("Origin", "")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
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
            if self.path.startswith("/sftp/"):
                return self._sftp_get()
            u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path == "/job/status":
                return self._json(job_get(q.get("id", "")).view(q.get("full") == "1"))
            if u.path == "/job/list":
                return self._json([j.view() for j in sorted(JOBS.values(), key=lambda j: j.created)])
            if u.path == "/pm/progress":
                return self._json(PROG)
            self._json({"status": "ok", "version": VERSION, "logged": bool(mml.user), "user": mml.user, "mae": f"{MAE_IP}:{MAE_PORT}",
                        "sftp": {"logged": bool(sftp.sftp), "user": sftp.user}, "pmRoot": PM_ROOT,
                        "jobs": sum(1 for j in JOBS.values() if j.state in ("queued", "running")),
                        "savedPwd": bool(SAVED["pwd"]), "savedPwdWarn": SAVED["warn"]})
        except ApiError as e:
            self._json(e.payload, e.http)
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def _sftp_get(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        known = [n["name"] for n in mml.ne_cache]
        with sftp.lock:
            if u.path == "/sftp/ls":
                return self._json(sftp.ls(q.get("path", "/")))
            if u.path == "/sftp/scan":
                return self._json(sftp.scan(q.get("root", "/opt/oss/server/var/fileint"), int(q.get("depth", 4))))
            if u.path == "/sftp/peek":
                return self._json(sftp.peek(q["path"], known_ne=known))
            if u.path == "/sftp/probe":
                return self._json(sftp.probe(q.get("root", "/opt/oss/server/var/fileint"), int(q.get("depth", 4)), known_ne=known))
        self._json({"error": "rota desconhecida"}, 404)

    def do_POST(self):
        if self._blocked(): return
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > MAX_UPLOAD * 4 // 3 + 65536: raise ApiError(413, "too_big", "arquivo grande demais para o helper")
            body = json.loads(self.rfile.read(n) or b"{}")
            p = urlparse(self.path).path
            if p == "/job/start":
                return self._json(Job(body).view())
            if p == "/job/stop":
                j = job_get(body.get("id", "")); j.abort = True
                return self._json({"ok": True, "id": j.id})
            if p == "/secret/set": return self._json(secret_save(body.get("pwd")))
            if p == "/secret/clear": return self._json(secret_clear())
            if p == "/file-server/test": return self._json(fs_test(body))
            if p == "/file-server/list": return self._json(fs_list(body))
            if p == "/file-server/upload":
                r = fs_upload(body)
                logf("upload %s -> %s:%s %s (%d bytes)" % (r["protocol"], r["host"], r["port"], r["remotePath"], r["bytes"]))
                return self._json(r)
            if p == "/pm/abort":
                PROG["abort"] = True
                return self._json({"ok": True})
            if p == "/pm/fetch":
                PROG.update(total=0, done=0, file="", log=[], abort=False)
                with sftp.lock:
                    rows = pm_fetch(sftp, body.get("sites", []), body["from"], body["to"], body.get("sub", ""), PROG)
                csv, _ = build_csv(rows, body.get("title", "PM_MAE"))
                self._hdr(200, "text/csv; charset=utf-8")
                return self.wfile.write(csv.encode("utf-8"))
            if self.path.startswith("/login"):
                with mml.lock: mml.login(body["user"], body["pwd"])
                return self._json({"ok": True, "user": mml.user})
            if self.path.startswith("/sftp/login"):
                user, pwd = body.get("user"), body.get("pwd")
                if body.get("useMml"):
                    if not mml.user: raise RuntimeError("MML nao conectado: informe usuario e senha do SFTP")
                    user, pwd = user or mml.user, mml.pwd
                if not user or not pwd: raise RuntimeError("informe usuario e senha do SFTP")
                with sftp.lock: sftp.login(user, pwd)
                return self._json({"ok": True, "user": sftp.user})
            if self.path.startswith("/sftp/logout"):
                with sftp.lock: sftp.close()
                return self._json({"ok": True})
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
        except ApiError as e:
            logf("erro %s: %s" % (self.path, e.payload.get("code")))
            self._json(e.payload, e.http)
        except Exception as e:
            logf("erro %s: %s" % (self.path, mask(str(e))))
            self._json({"error": mask(str(e))}, 500)

    def log_message(self, *a): pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Helper MML v2 (Baseline <-> MAE)")
    ap.add_argument("--mae", help="IP:PORTA do MAE (padrao %s:%d)" % (MAE_IP, MAE_PORT))
    ap.add_argument("--port", type=int, default=LOCAL_PORT, help="porta local (padrao %d)" % LOCAL_PORT)
    ap.add_argument("--sftp-port", type=int, default=SFTP_PORT, help="porta SFTP do MAE (padrao 22)")
    ap.add_argument("url", nargs="?", help=argparse.SUPPRESS)   # "mmlhelper://start" quando aberto pela pagina
    a = ap.parse_args()
    SFTP_PORT = a.sftp_port
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
