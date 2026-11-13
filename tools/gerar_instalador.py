# Gera tools/Instalar_Helper_MML.bat a partir de instalador_modelo.txt + mml_helper_v2.py.
# Rode sempre que alterar o helper:  python tools/gerar_instalador.py
import os
d = os.path.dirname(os.path.abspath(__file__))
modelo = open(os.path.join(d, "instalador_modelo.txt"), encoding="utf-8").read()
helper = open(os.path.join(d, "mml_helper_v2.py"), encoding="utf-8").read().rstrip("\n")
assert "\n'@" not in helper, "o helper nao pode ter linha comecando com '@"
out = modelo.replace("__HELPER__", helper)
with open(os.path.join(d, "Instalar_Helper_MML.bat"), "w", encoding="utf-8", newline="\r\n") as f:
    f.write(out)
print("ok:", len(out), "bytes")
