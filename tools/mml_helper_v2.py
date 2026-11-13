# mml_helper_v2.py - Ponte Baseline (navegador) <-> MAE (MML NBI, porta 31114)
#
# Uso:  python mml_helper_v2.py                 (MAE padrao 10.220.30.9:31114)
#       python mml_helper_v2.py --mae IP:PORTA  (outro MAE / teste)
#
# Login e senha sao informados pela pagina do Baseline e ficam SO na memoria
# deste processo (nunca em disco).
import argparse, json, os, re, socket, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAE_IP, MAE_PORT = os.environ.get("MAE_IP", "10.220.30.9"), int(os.environ.get("MAE_PORT", "31114"))
EOL = b"\r\n"
LOCAL_PORT = 8765
END = "---    END"

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

    def _read(self, maxsec=180, idle=1.5):
        buf, t0, last = "", time.time(), time.time()
        while time.time() - t0 < maxsec:
            try:
                d = self.sock.recv(65536)
                if not d: raise ConnectionError("MAE fechou a conexao")
                buf += d.decode(errors="ignore"); last = time.time()
            except socket.timeout:
                pass
            i = buf.rfind(END)
            if i >= 0 and time.time() - last > idle:
                # olha so o ultimo relatorio (entre o END anterior e o ultimo END):
                # se ele termina com "To be continued...", ainda vem mais parte.
                prev = buf.rfind(END, 0, i)
                seg = buf[prev + len(END) if prev >= 0 else 0:i]
                if "To be continued" not in seg:
                    return buf
        return buf + f"\n[TIMEOUT {maxsec}s]"

    def _send(self, cmd, maxsec=180):
        self.sock.sendall(cmd.encode() + EOL)
        return self._read(maxsec)

    def login(self, user, pwd):
        self.close()
        self.sock = socket.create_connection((MAE_IP, MAE_PORT), 15)
        self.sock.settimeout(0.5)
        r = self._send(f'LGI:OP="{user}",PWD="{pwd}";', 30)
        if "RETCODE = 0" not in r:
            self.close(); raise RuntimeError("Login falhou: " + r.strip()[-300:])
        self.user, self.pwd = user, pwd

    def close(self):
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
            self.login(self.user, self.pwd)      # reconecta uma vez
            return self._send(cmd, maxsec)

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
            if ne:
                r = self.send(f'REG NE:NAME="{ne}";', 60)
                ok = "RETCODE = 0" in r
                out.append({"cmd": f"REG NE {ne}", "ok": ok, "resp": r})
                if not ok: return out
            try:
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
            finally:
                if ne: self.send(f'UNREG NE:NAME="{ne}";', 60)
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
            self._json({"status": "ok", "logged": bool(mml.user), "user": mml.user, "mae": f"{MAE_IP}:{MAE_PORT}"})
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
            if self.path.startswith("/logout"):
                with mml.lock: mml.close(); mml.user = mml.pwd = None; mml.ne_cache = []
                return self._json({"ok": True})
            if self.path.startswith("/ne"):
                return self._json(mml.list_ne())
            if self.path.startswith("/run"):
                res = mml.run(body.get("ne", ""), body.get("cmds", []), body.get("stopOnError", False))
                return self._json(res)
            self._json({"error": "rota desconhecida"}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def log_message(self, *a): pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Helper MML v2 (Baseline <-> MAE)")
    ap.add_argument("--mae", help="IP:PORTA do MAE (padrao %s:%d)" % (MAE_IP, MAE_PORT))
    ap.add_argument("--port", type=int, default=LOCAL_PORT, help="porta local (padrao %d)" % LOCAL_PORT)
    a = ap.parse_args()
    if a.mae:
        h, _, p = a.mae.partition(":"); MAE_IP = h; MAE_PORT = int(p or MAE_PORT)
    print(f"Helper MML v2 em http://127.0.0.1:{a.port}  ->  MAE {MAE_IP}:{MAE_PORT}")
    print("Faca o login pela pagina do Baseline. Ctrl+C para sair.")
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
