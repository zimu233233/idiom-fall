# -*- coding: utf-8 -*-
"""生成字体子集字符集：
  A（首访）= 常用成语用字 + 全部界面/文案字（扫描 index.html 与 js/*.js，排除 js/data/）+ ASCII
  B（全量）= A + 全量成语用字（45410 条，只取词本身）
产出 build/fontchars/：chars-a.txt / chars-b.txt / range-a.txt / range-b-only.txt / warm-char.txt
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "fontchars"

def guarded_write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    resolved = path.resolve()
    if not str(resolved).startswith(str(ROOT.resolve()) + "\\") and not str(resolved).startswith(str(ROOT.resolve()) + "/"):
        raise SystemExit("path out of root: %s" % resolved)
    path.write_text(text, encoding="utf-8")

# 界面/文案字符（CJK + 全角 + 中西标点；★✕❚ 等符号字体本身多不含，交由系统回退）
UI_RE = re.compile(r"[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF\u2013-\u2026\u00B7\u2E80-\u2EFF\u3001-\u3003]")

def file_chars(p: Path) -> set:
    return set(UI_RE.findall(p.read_text(encoding="utf-8")))

def parse_raw_var(path: Path, var: str) -> str:
    m = re.search(var + r'\s*=\s*"((?:[^"\\]|\\.)*)"', path.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("var not found: " + var)
    return m.group(1).replace(r"\n", "\n").replace(r"\"", '"').replace(r"\\", "\\")

def main():
    idioms_js = ROOT / "js" / "data" / "idioms.js"
    common_js = ROOT / "js" / "data" / "common.js"

    # 全量成语用字（词字段）
    raw_all = parse_raw_var(idioms_js, "window.IDIOM_RAW")
    all_words = [line.split("|")[0] for line in raw_all.split("\n") if "|" in line]
    chars_all_idiom = set("".join(all_words))

    # 常用词（优先 COMMON_RAW 词字段；旧 common.js 数组兜底）
    common_raw_js = ROOT / "js" / "data" / "common-raw.js"
    common_js = ROOT / "js" / "data" / "common.js"
    if common_raw_js.exists():
        common_words = [l.split("|")[0] for l in parse_raw_var(common_raw_js, "window.COMMON_RAW").split("\n") if "|" in l]
    elif common_js.exists():
        m = re.search(r"window\.COMMON_WORDS\s*=\s*\[(.*?)\]", common_js.read_text(encoding="utf-8"), re.S)
        common_words = re.findall(r'"([^"]+)"', m.group(1)) if m else []
    else:
        common_words = []
    chars_common = set("".join(common_words))

    # 界面文案字（扫描游戏源码与页面；数据目录单独处理过，排除以免把全量字并进 A）
    ui_chars = set()
    ui_chars |= file_chars(ROOT / "index.html")
    for p in sorted((ROOT / "js").glob("*.js")):
        ui_chars |= file_chars(p)
    for p in sorted((ROOT / "js" / "data").glob("*.js")):
        ui_chars -= set()
    # 排除扫描时混入的数据文件字（js/data/* 不属于界面文案；上面 glob 只扫了 js/*.js 顶层，无碍）
    # 保险起见：从 idioms.js 里只应取词字进 B，不进 A——此处不再叠加

    ascii_chars = set(chr(c) for c in range(0x20, 0x7F))

    chars_a = chars_common | ui_chars | ascii_chars
    chars_b = chars_a | chars_all_idiom

    OUT.mkdir(parents=True, exist_ok=True)
    guarded_write(OUT / "chars-a.txt", "".join(sorted(chars_a)))
    guarded_write(OUT / "chars-b.txt", "".join(sorted(chars_b)))

    def merged_ranges(chars: set, gap: int = 16) -> str:
        cps = sorted(ord(c) for c in chars)
        parts, s, prev = [], cps[0], cps[0]
        for cp in cps[1:]:
            if cp - prev <= gap:
                prev = cp
                continue
            parts.append((s, prev))
            s = prev = cp
        parts.append((s, prev))
        return ",".join("U+%04X-%04X" % (a, b) if a != b else "U+%04X" % a for a, b in parts)

    # CSS unicode-range：A 全集；B 规则只写 B−A（补集字触发下载）
    guarded_write(OUT / "range-a.txt", merged_ranges(chars_a))
    guarded_write(OUT / "range-b-only.txt", merged_ranges(chars_b - chars_a))

    # 后台预热用字：B−A 中挑一个（字典序首个成语字），并生成给前端读取的常量
    warm_candidates = sorted((chars_b - chars_a))
    warm = warm_candidates[0] if warm_candidates else "龘"
    guarded_write(OUT / "warm-char.txt", warm)
    guarded_write(ROOT / "js" / "data" / "font-warm.js",
                  "// 由 tools/make_fontsets.py 自动生成，勿手改\nwindow.FONT_WARM_CHAR = %s;\n" % json.dumps(warm, ensure_ascii=False))

    # 生成 css/fonts.css：两段式 @font-face（A 全集；B 规则只写 B−A，渲染到生僻字才下载全量）
    range_a = merged_ranges(chars_a)
    range_b = merged_ranges(chars_b - chars_a)
    fonts_css = (
        "/* 由 tools/make_fontsets.py 自动生成，勿手改 */\n"
        "@font-face {\n"
        "  font-family: 'Ma Shan Zheng';\n"
        "  src: url('fonts/msz-a.woff2') format('woff2');\n"
        "  font-weight: 400; font-display: swap;\n"
        "  unicode-range: " + range_a + ";\n"
        "}\n"
        "@font-face {\n"
        "  font-family: 'Ma Shan Zheng';\n"
        "  src: url('fonts/msz-full.woff2') format('woff2');\n"
        "  font-weight: 400; font-display: swap;\n"
        "  unicode-range: " + range_b + ";\n"
        "}\n"
    )
    guarded_write(ROOT / "css" / "fonts.css", fonts_css)

    print("A 字符数:", len(chars_a), " B 字符数:", len(chars_b), " B−A:", len(chars_b - chars_a))
    print("常用词:", len(common_words), " 全量词:", len(all_words), " 预热字:", warm)

if __name__ == "__main__":
    main()
