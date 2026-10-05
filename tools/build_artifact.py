"""アーティファクト公開用の1枚の HTML (dist/index.html) を組み立てる。

アーティファクトでは自分の JS/CSS ファイルを読み込めないので、src/ の CSS と JS を
HTML の中に埋め込む。JS は ES モジュールを依存順に連結し、ローカル同士の import と export を外す。
外部の読み込み (Google Fonts の link と、Three.js の importmap) はそのまま残す。

使い方:
    python tools/build_artifact.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
# 依存される側から順に並べる
MODULES = [
    "sfx.js", "effects.js", "entrance.js", "arenas.js", "tiles.js", "arena.js", "parts.js", "rivals.js", "models.js",
    "weapons.js", "robot.js", "items.js", "ai.js", "input.js", "save.js", "garage.js", "cup.js", "hud.js", "main.js",
]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def main():
    html = read("index.html")
    title = re.search(r"<title>.*?</title>", html, re.S).group(0)
    links = re.findall(r'<link[^>]+href="https://[^"]+"[^>]*>', html)
    importmap = re.search(r'<script type="importmap">.*?</script>', html, re.S).group(0)
    body = re.search(r"<body>(.*?)<script type=\"module\"", html, re.S).group(1).strip()
    css = read("src/style.css")

    imports = []
    code = []
    for name in MODULES:
        for line in read(f"src/{name}").splitlines():
            if line.startswith("import "):
                if "'./" not in line and line not in imports:
                    imports.append(line)
                continue
            code.append(re.sub(r"^export ", "", line))
        code.append("")
    # 連結するとモジュールごとのスコープが無くなるので、トップレベルの名前の重複を検出する
    seen = {}
    for line in code:
        m = re.match(r"(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", line)
        if m:
            name = m.group(1)
            if name in seen:
                raise SystemExit(f"トップレベルの名前 {name} が複数のファイルで使われています。どちらかの名前を変えてください")
            seen[name] = True
    js = "\n".join(imports + [""] + code)
    if "</script" in js:
        raise SystemExit("JS の中に </script が含まれていて埋め込めません")

    DIST.mkdir(exist_ok=True)
    out = "\n".join([
        '<meta charset="utf-8">',  # 文字コードを返さないサーバー (python -m http.server など) でも日本語が化けないように
        title,
        *links,
        f"<style>\n{css}</style>",
        importmap,
        body,
        f'<script type="module">\n{js}</script>',
        "",
    ])
    (DIST / "index.html").write_text(out, encoding="utf-8")
    print(f"dist/index.html を作成しました ({len(out.encode('utf-8')) // 1024} KB)")


if __name__ == "__main__":
    main()
