"""仮の画像素材（SVG）を生成する。

python tools/gen_images.py で assets/images/ に出力する。
"""

import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "images")
FONT = 'font-family="Yu Gothic, Meiryo, sans-serif"'


def write(name, body, w, h):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" {FONT}>\n{body}\n</svg>\n'
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(svg)


def label(text, x, y, size=28, fill="#ffffff", opacity=0.5):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" fill-opacity="{opacity}" text-anchor="middle">{text}</text>'


# ---- 背景 ---------------------------------------------------------------
def backgrounds():
    write(
        "bg_title.svg",
        f"""
<defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#28323f"/><stop offset="1" stop-color="#07090c"/></radialGradient></defs>
<rect width="1920" height="1080" fill="url(#g)"/>
<g stroke="#3a4a5c" stroke-width="2" fill="none" opacity="0.6">
<path d="M0 760 L520 760 L560 700 L600 820 L640 620 L680 900 L720 760 L1920 760"/>
</g>
{label("仮：タイトル背景", 1780, 1050, 24)}""",
        1920,
        1080,
    )

    write(
        "bg_clinic.svg",
        f"""
<rect width="1920" height="1080" fill="#1b1f24"/>
<rect x="0" y="760" width="1920" height="320" fill="#121417"/>
<rect x="240" y="120" width="420" height="300" fill="#2b3139" stroke="#3c444f" stroke-width="6"/>
<rect x="1180" y="560" width="620" height="120" rx="10" fill="#39414b"/>
<rect x="1220" y="680" width="30" height="120" fill="#2a3037"/><rect x="1730" y="680" width="30" height="120" fill="#2a3037"/>
<circle cx="960" cy="60" r="36" fill="#d9d2a8" opacity="0.35"/>
{label("仮：闇診療所", 1780, 1050, 24)}""",
        1920,
        1080,
    )

    # 手術エリア用の患者背景（1400x700）。呼吸で上下にわずかに膨らむ3枚。
    for i, s in enumerate([1.0, 1.006, 1.012]):
        write(
            f"patient_skin_{i}.svg",
            f"""
<rect width="1400" height="700" fill="#3a2a26"/>
<g transform="translate(700 350) scale(1 {s}) translate(-700 -350)">
<path d="M170 700 C150 470 180 250 330 150 C470 60 930 60 1070 150 C1220 250 1250 470 1230 700 Z" fill="#d7a585"/>
<path d="M700 110 L700 700" stroke="#c3906f" stroke-width="6" opacity="0.6"/>
<path d="M430 250 C520 300 600 300 660 280 M970 250 C880 300 800 300 740 280" stroke="#c3906f" stroke-width="5" fill="none" opacity="0.6"/>
</g>
{label("仮：患者（皮膚） フレーム" + str(i), 1250, 680, 22)}""",
            1400,
            700,
        )

    for i, s in enumerate([1.0, 1.01, 1.02]):
        write(
            f"patient_internal_{i}.svg",
            f"""
<rect width="1400" height="700" fill="#0b2a4a"/>
<g stroke="#2d6aa8" stroke-width="3" fill="none" opacity="0.5">
{''.join(f'<line x1="{x}" y1="0" x2="{x}" y2="700"/>' for x in range(0, 1400, 70))}
{''.join(f'<line x1="0" y1="{y}" x2="1400" y2="{y}"/>' for y in range(0, 700, 70))}
</g>
<g transform="translate(700 350) scale({s}) translate(-700 -350)" fill="#1d5d99" stroke="#5fa3e0" stroke-width="5">
<path d="M300 180 C420 90 620 120 640 260 C660 420 460 560 320 500 C200 440 190 260 300 180 Z"/>
<path d="M780 200 C900 110 1120 140 1130 300 C1140 460 960 560 830 500 C720 450 690 280 780 200 Z"/>
</g>
{label("仮：体内（記号表現） フレーム" + str(i), 1250, 680, 22)}""",
            1400,
            700,
        )


# ---- キャラクター（立ち絵の仮）--------------------------------------------
def characters():
    chars = {
        "protagonist": ("#6b7c93", "主人公"),
        "assistant": ("#b98aa6", "助手"),
        "broker": ("#a38b5a", "仲介屋"),
        "patient": ("#7f9a7a", "患者"),
    }
    for key, (col, name) in chars.items():
        write(
            f"char_{key}.svg",
            f"""
<ellipse cx="300" cy="230" rx="120" ry="140" fill="{col}"/>
<path d="M60 900 C60 560 160 420 300 420 C440 420 540 560 540 900 Z" fill="{col}"/>
<rect x="150" y="620" width="300" height="70" rx="12" fill="#000" fill-opacity="0.35"/>
{label("仮：" + name, 300, 668, 40, "#ffffff", 0.9)}""",
            600,
            900,
        )


# ---- 医療機器アイコン -----------------------------------------------------
def icons():
    icons = {
        "gel": """<g transform="rotate(45 60 60)">
    <rect x="41" y="14" width="38" height="16" rx="2" fill="#dfe8f1"/>
    <rect x="45" y="30" width="30" height="13" fill="#dfe8f1"/>
    <rect x="27" y="41" width="66" height="67" rx="7" fill="#dfe8f1"/>
    <path d="M32 62 Q42 59 53 62 T88 62 V98 Q88 103 83 103 H37 Q32 103 32 98 Z" fill="#7fc4ff"/>
    <rect x="27" y="41" width="66" height="67" rx="7" fill="none" stroke="#b8c7d6" stroke-width="2"/>
    <path d="M45 19 V25 M52 19 V25 M59 19 V25 M66 19 V25 M73 19 V25" stroke="#b8c7d6" stroke-width="2"/>
    <path d="M37 49 V57 M83 49 V57" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
    </g>""",
        "drain": """<g transform="translate(60 60) rotate(-45) scale(1 0.68) translate(-60 -60)" stroke-linejoin="round" stroke-linecap="round">
    <path d="M7 60 H46" fill="none" stroke="#dfe8f1" stroke-width="7"/>
    <path d="M8 60 H45" fill="none" stroke="#7fc4ff" stroke-width="3"/>
    <path d="M44 54 Q44 50 48 50 H71 Q76 50 76 55 V65 Q76 70 71 70 H48 Q44 70 44 66 Z" fill="#dfe8f1"/>
    <path d="M73 54 H83 V66 H73 Z" fill="#dfe8f1"/>
    <path d="M81 47 L114 54 V66 L81 73 Z" fill="#dfe8f1"/>
    <path d="M92 51 L92 69 M103 53 L103 67" fill="none" stroke="#b8c7d6" stroke-width="1"/>
    <circle cx="59" cy="60" r="4.5" fill="#7fc4ff"/>
    </g>""",
        "tweezers": """<g fill="#dfe8f1">
    <path d="M14 101 L22 96 L85 31 L94 21 L97 22 L95 27 L90 35 L25 108 Z"/>
    <path d="M17 107 L25 105 L93 51 L105 43 L109 44 L107 49 L98 57 L28 114 Z"/>
    <path d="M29 98 L77 49 M33 107 L88 60" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    </g>""",
        "scalpel": '<path d="M20 100 L65 55 L70 50 L97.2 22.8 Q99 21 98 23.3 L84 55 L76 56 L32 107 Z" fill="#f2f5f9"/>',
        "suture": '<path d="M28 88 C28 40 92 40 92 70" stroke="#e7e2c8" stroke-width="8" fill="none" stroke-linecap="butt"/><path d="M28 96 L24 88 H32 Z" fill="#e7e2c8"/><path d="M92 70 C92 90 60 100 40 96" stroke="#7fc4ff" stroke-width="3" fill="none" stroke-linecap="round"/>',
        "syringe": '<rect x="44" y="30" width="32" height="60" rx="4" fill="#dfe8f1"/><rect x="48" y="52" width="24" height="34" fill="#7fc4ff"/><path d="M60 90 L60 112 M52 22 L68 22 M60 22 L60 30" stroke="#dfe8f1" stroke-width="6" stroke-linecap="round"/>',
    }
    for key, body in icons.items():
        write(f"icon_{key}.svg", body, 120, 120)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    backgrounds()
    characters()
    icons()
    print("images:", sorted(os.listdir(OUT)))
