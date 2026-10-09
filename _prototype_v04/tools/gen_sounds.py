"""仮のサウンド素材（WAV）を標準ライブラリだけで生成する。

python tools/gen_sounds.py で assets/sound/se, assets/sound/bgm に出力する。
"""
import math
import os
import random
import struct
import wave

RATE = 22050
BASE = os.path.join(os.path.dirname(__file__), "..", "assets", "sound")


def save(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32000)) for s in samples))


def osc(kind, phase):
    p = phase % 1.0
    if kind == "sine":
        return math.sin(2 * math.pi * p)
    if kind == "square":
        return 1.0 if p < 0.5 else -1.0
    if kind == "tri":
        return 4 * abs(p - 0.5) - 1
    if kind == "saw":
        return 2 * p - 1
    return random.uniform(-1, 1)  # noise


def tone(freq, dur, kind="sine", vol=0.5, attack=0.005, release=0.05, slide=0.0):
    n = int(dur * RATE)
    out, phase = [], 0.0
    for i in range(n):
        t = i / RATE
        f = freq + slide * t
        phase += f / RATE
        env = min(1, t / attack) if attack > 0 else 1
        env *= min(1, (dur - t) / release) if release > 0 else 1
        out.append(osc(kind, phase) * vol * env)
    return out


def mix(*tracks):
    n = max(len(t) for t in tracks)
    return [sum(t[i] for t in tracks if i < len(t)) for i in range(n)]


def seq(*parts):
    out = []
    for p in parts:
        out += p
    return out


def silence(dur):
    return [0.0] * int(dur * RATE)


def se():
    d = os.path.join(BASE, "se")
    os.makedirs(d, exist_ok=True)
    sounds = {
        "select": tone(880, 0.08, "square", 0.25),
        "cancel": tone(440, 0.1, "square", 0.25, slide=-1500),
        "text": tone(1200, 0.02, "square", 0.08, release=0.01),
        "success": seq(tone(660, 0.08, "tri", 0.4), tone(990, 0.16, "tri", 0.4)),
        "miss": tone(160, 0.25, "saw", 0.4, slide=-200),
        "invalid": tone(300, 0.12, "tri", 0.3),
        "heal": seq(tone(520, 0.06, "sine", 0.35), tone(780, 0.12, "sine", 0.35)),
        "gel": tone(300, 0.25, "noise", 0.12, attack=0.05, release=0.15),
        "cut": tone(2000, 0.12, "noise", 0.25, release=0.1),
        "stitch": tone(1500, 0.05, "tri", 0.3),
        "grab": tone(600, 0.05, "square", 0.2),
        "inject": tone(400, 0.3, "sine", 0.35, slide=800),
        "drain": tone(200, 0.15, "noise", 0.15, attack=0.03, release=0.1),
        "heartbeat": seq(tone(70, 0.08, "sine", 0.7), silence(0.08), tone(60, 0.1, "sine", 0.6)),
        "alarm": seq(tone(1000, 0.12, "square", 0.25), silence(0.05), tone(1000, 0.12, "square", 0.25)),
        "clear": seq(tone(523, 0.12, "tri", 0.4), tone(659, 0.12, "tri", 0.4), tone(784, 0.12, "tri", 0.4), tone(1046, 0.4, "tri", 0.4)),
        "gameover": seq(tone(392, 0.25, "saw", 0.3), tone(330, 0.25, "saw", 0.3), tone(262, 0.6, "saw", 0.3)),
        # --- 2026-10-09 追加（試作 v03 のコードからはまだ使っていない） ---
        # 心電図（spec/03 1.4）：拍ごとの「ピッ」と、平坦になったときの「ピー」（2秒。継ぎ目なくループできる）
        "ecg_beep": tone(1000, 0.07, "sine", 0.4, attack=0.002, release=0.03),
        "ecg_flatline": tone(1000, 2.0, "sine", 0.35, attack=0, release=0),
        # 病巣の発生と、治療の評価（spec/05 2.6、03 5.1。途中の段階は OK）
        "lesion_appear": seq(tone(330, 0.07, "square", 0.2), tone(247, 0.12, "square", 0.2)),
        "rate_ok": seq(tone(784, 0.06, "tri", 0.35), tone(1046, 0.1, "tri", 0.35)),
        "rate_cool": seq(tone(1046, 0.06, "square", 0.22), tone(1318, 0.06, "square", 0.22), tone(1568, 0.06, "square", 0.22), tone(2093, 0.25, "square", 0.22)),
        "rate_good": seq(tone(784, 0.07, "tri", 0.4), tone(988, 0.07, "tri", 0.4), tone(1175, 0.2, "tri", 0.4)),
        "rate_fine": seq(tone(659, 0.08, "sine", 0.4), tone(784, 0.18, "sine", 0.4)),
        "rate_bad": seq(tone(330, 0.1, "saw", 0.25), tone(262, 0.25, "saw", 0.25, slide=-80)),
        # テーピング（spec/05 4.1）：持ち上げる・貼る
        "tape_lift": tone(3000, 0.15, "noise", 0.18, attack=0.01, release=0.1),
        "tape_stick": mix(tone(500, 0.06, "tri", 0.3), tone(3000, 0.05, "noise", 0.12, release=0.04)),
        # ピンセットで運び先（トレイなど）に置く
        "put": seq(tone(1200, 0.03, "tri", 0.3, release=0.02), tone(900, 0.05, "tri", 0.25)),
        # 薬の限度量の警告（spec/05 3.6）
        "dose_warn": seq(tone(1400, 0.08, "square", 0.2), silence(0.06), tone(1400, 0.08, "square", 0.2), silence(0.06), tone(1400, 0.08, "square", 0.2)),
        # コンティニューポイントの通過、リザルトのランク表示
        "checkpoint": seq(tone(659, 0.08, "tri", 0.35), tone(880, 0.08, "tri", 0.35), tone(1175, 0.2, "tri", 0.35)),
        "rank": seq(tone(392, 0.1, "tri", 0.3), mix(tone(523, 0.6, "tri", 0.25), tone(659, 0.6, "tri", 0.2), tone(784, 0.6, "tri", 0.2))),
    }
    for k, v in sounds.items():
        save(os.path.join(d, k + ".wav"), v)
    return sorted(sounds)


def note(n):  # MIDI -> Hz
    return 440 * 2 ** ((n - 69) / 12)


def bgm_track(chords, bpm, lead_kind, bass_kind, arp=True, vol=0.18):
    beat = 60 / bpm
    out = []
    for ch in chords:
        bar = mix(
            tone(note(ch[0] - 12), beat * 4, bass_kind, vol * 1.2, attack=0.01, release=0.2),
            seq(*[tone(note(ch[i % len(ch)] + 12), beat / 2, lead_kind, vol * 0.6, release=0.08) for i in range(8)]) if arp
            else tone(note(ch[1] + 12), beat * 4, lead_kind, vol * 0.5, attack=0.3, release=0.5),
        )
        out += bar
    return out


def bgm():
    d = os.path.join(BASE, "bgm")
    os.makedirs(d, exist_ok=True)
    tracks = {
        # 暗めのタイトル（Am - F - C - G）
        "title": bgm_track([[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] * 2, 80, "tri", "sine", arp=False),
        # 会話（Dm - Bb - F - C）
        "talk": bgm_track([[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]] * 2, 90, "sine", "sine"),
        # 手術中（緊張感：Em - C - D - B）
        "surgery": bgm_track([[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]] * 2, 132, "square", "tri", vol=0.14),
        # リザルト（C - G - Am - F）
        "result": bgm_track([[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], 100, "tri", "sine"),
        # --- 2026-10-09 追加（試作 v03 のコードからはまだ使っていない） ---
        # ブリーフィング（Am - Dm - E - Am。落ち着いた緊張感。spec/02 3.3）
        "briefing": bgm_track([[57, 60, 64], [50, 53, 57], [52, 56, 59], [57, 60, 64]] * 2, 72, "sine", "tri", arp=False),
        # ゲームオーバーの会話（Cm - Ab - Fm - G。ゆっくり暗く）
        "gameover": bgm_track([[48, 51, 55], [44, 48, 51], [41, 44, 48], [43, 47, 50]], 60, "sine", "sine", arp=False, vol=0.15),
    }
    for k, v in tracks.items():
        save(os.path.join(d, k + ".wav"), v)
    return sorted(tracks)


if __name__ == "__main__":
    random.seed(1)
    print("se:", se())
    print("bgm:", bgm())
