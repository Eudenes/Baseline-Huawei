# mml_helper_v2.py - Ponte Baseline (navegador) <-> MAE (MML NBI, porta 31114)
#
# Uso:  python mml_helper_v2.py                 (MAE padrao 10.220.30.9:31114)
#       python mml_helper_v2.py --mae IP:PORTA  (outro MAE / teste)
#
# Login e senha sao informados pela pagina do Baseline e ficam SO na memoria
# deste processo (nunca em disco).
import argparse, gzip, io, json, os, re, socket, stat, sys, threading, time
from urllib.parse import urlparse, parse_qs
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAE_IP, MAE_PORT = os.environ.get("MAE_IP", "10.220.30.9"), int(os.environ.get("MAE_PORT", "31114"))
EOL = b"\r\n"
LOCAL_PORT = 8765
END = "---    END"
VERSION = "2.2"
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
            if self.path.startswith("/sftp/"):
                return self._sftp_get()
            self._json({"status": "ok", "version": VERSION, "logged": bool(mml.user), "user": mml.user, "mae": f"{MAE_IP}:{MAE_PORT}",
                        "sftp": {"logged": bool(sftp.sftp), "user": sftp.user}})
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
            body = json.loads(self.rfile.read(n) or b"{}")
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
        except Exception as e:
            logf("erro %s: %s" % (self.path, e))
            self._json({"error": str(e)}, 500)

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
