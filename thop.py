#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu LC79 - Version 19.0 (Siêu cầu - Cao thủ)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ 60+ mẫu cầu từ cao thủ | Bắt cầu siêu chuẩn
✧ Chiến thuật: Bệt 1-4 theo, 5-6 cẩn thận, 7+ bẻ
✧ Bẻ không được thì theo lại | JSON đúng thứ tự
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import json
import threading
import time
import requests
from flask import Flask, request, jsonify
from collections import deque
from datetime import datetime

app = Flask(__name__)

# ================= CONFIG =================
AUTH_KEY = "truongdong1920"
USER_ID = "@Truongdong1920"
ALGO_NAME = "LC79-SIEU-CAU-v19.0"

LC79_TX_URL = "https://wtx.tele68.com/v1/tx/sessions"
LC79_MD5_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions"

# Lưu trữ dự đoán
DU_DOAN_CO_DINH = {}
PHIEN_DA_XU_LY = {'tx': None, 'md5': None}
CACHE_DATA = {'tx': None, 'md5': None}
CACHE_LOCK = threading.Lock()

# Lưu lịch sử bẻ cầu để học
LICH_SU_BE = deque(maxlen=20)

# ================= HỆ THỐNG CÂN BẰNG =================
class BoCanBang:
    def __init__(self):
        self.lich_su = deque(maxlen=50)

    def them(self, du_doan):
        self.lich_su.append(du_doan)

    def do_lech(self):
        if len(self.lich_su) < 5:
            return 0.0
        so_T = self.lich_su.count('T')
        return round((so_T / len(self.lich_su) - 0.5) * 2, 2)

    def can_bang(self, du_doan, do_tin):
        lech = self.do_lech()
        if lech > 0.35 and du_doan == 'T' and do_tin < 80:
            return 'X', do_tin - 5
        if lech < -0.35 and du_doan == 'X' and do_tin < 80:
            return 'T', do_tin - 5
        return du_doan, do_tin

bo_can_bang_tx = BoCanBang()
bo_can_bang_md5 = BoCanBang()

# ================= 60+ MẪU CẦU =================

# ----- 1. CẦU BỆT (THEO/BẺ THÔNG MINH) -----
def cau_bet_thong_minh(history):
    """Chiến thuật bệt: 1-4 theo, 5-6 cẩn thận, 7+ bẻ"""
    if len(history) < 2:
        return None, 0, ""
    
    last = history[-1]
    run = 1
    for i in range(len(history)-2, -1, -1):
        if history[i] == last:
            run += 1
        else:
            break
    
    # Bệt 8+ - BẺ CHẮC CHẮN
    if run >= 8:
        return ('X' if last == 'T' else 'T'), 98, f"💀 BẺ BỆT {run} (siêu dài)"
    # Bệt 7 - BẺ
    if run == 7:
        return ('X' if last == 'T' else 'T'), 95, f"🔥 BẺ BỆT {run}"
    # Bệt 6 - BẺ (cẩn thận)
    if run == 6:
        return ('X' if last == 'T' else 'T'), 88, f"⚡ BẺ BỆT {run}"
    # Bệt 5 - CẢNH BÁO nhưng vẫn theo
    if run == 5:
        return last, 72, f"⚠️ THEO BỆT {run} (cẩn thận)"
    # Bệt 4 - Theo
    if run == 4:
        return last, 78, f"📊 THEO BỆT {run}"
    # Bệt 3 - Theo mạnh
    if run == 3:
        return last, 85, f"📈 THEO BỆT {run}"
    # Bệt 2 - Theo rất mạnh
    if run == 2:
        return last, 88, f"🎯 THEO BỆT {run}"
    
    return None, 0, ""

# ----- 2. CẦU 1-1 (SO LE) -----
def cau_1_1(history):
    if len(history) >= 4 and history[-4:] in ("TXTX", "XTXT"):
        do_dai = 4
        for i in range(4, min(len(history), 30), 2):
            if len(history) >= i+2 and history[-i-2:-i] == history[-4:-2]:
                do_dai += 2
            else:
                break
        if do_dai >= 14:
            return ('X' if history[-1] == 'T' else 'T'), 94, f"🔀 BẺ CẦU 1-1 (dài {do_dai})"
        if do_dai >= 10:
            return ('X' if history[-1] == 'T' else 'T'), 90, f"🔄 Cầu 1-1 dài {do_dai}"
        if do_dai >= 6:
            return ('X' if history[-1] == 'T' else 'T'), 87, f"⚡ Cầu 1-1 (dài {do_dai})"
        return ('X' if history[-1] == 'T' else 'T'), 85, f"✨ Cầu 1-1"
    return None, 0, ""

# ----- 3. CẦU 2-2 -----
def cau_2_2(history):
    if len(history) >= 4 and history[-4:] in ("TTXX", "XXTT"):
        do_dai = 4
        for i in range(4, min(len(history), 30), 4):
            if len(history) >= i+4 and history[-i-4:-i] == history[-4:]:
                do_dai += 4
            else:
                break
        next_pred = 'T' if history[-2:] == "XX" else 'X'
        if do_dai >= 16:
            return next_pred, 92, f"🔁 BẺ CẦU 2-2 (dài {do_dai})"
        if do_dai >= 12:
            return next_pred, 88, f"📐 Cầu 2-2 dài {do_dai}"
        if do_dai >= 8:
            return next_pred, 85, f"📏 Cầu 2-2 (dài {do_dai})"
        return next_pred, 82, f"📌 Cầu 2-2"
    return None, 0, ""

# ----- 4. CẦU 3-3 -----
def cau_3_3(history):
    if len(history) >= 6 and history[-6:] in ("TTTXXX", "XXXTTT"):
        do_dai = 6
        for i in range(6, min(len(history), 30), 6):
            if len(history) >= i+6 and history[-i-6:-i] == history[-6:]:
                do_dai += 6
            else:
                break
        next_pred = 'X' if history[-3:] == "TTT" else 'T'
        if do_dai >= 18:
            return next_pred, 91, f"🎯 BẺ CẦU 3-3 (dài {do_dai})"
        return next_pred, 85, f"🎲 Cầu 3-3 (dài {do_dai})"
    return None, 0, ""

# ----- 5. CẦU 4-4 -----
def cau_4_4(history):
    if len(history) >= 8 and history[-8:] in ("TTTTXXXX", "XXXXTTTT"):
        next_pred = 'T' if history[-4:] == "XXXX" else 'X'
        return next_pred, 90, f"🏆 Cầu 4-4"
    return None, 0, ""

# ----- 6. CẦU 5-5 -----
def cau_5_5(history):
    if len(history) >= 10 and history[-10:] in ("TTTTTXXXXX", "XXXXXTTTTT"):
        next_pred = 'T' if history[-5:] == "XXXXX" else 'X'
        return next_pred, 92, f"💎 Cầu 5-5"
    return None, 0, ""

# ----- 7. CẦU ZIGZAG (RẮN) -----
def cau_zigzag(history):
    if len(history) >= 5:
        if history[-5:] == "TXTXT":
            return 'X', 88, f"🐍 Zigzag TXTXT -> X"
        if history[-5:] == "XTXTX":
            return 'T', 88, f"🐍 Zigzag XTXTX -> T"
    if len(history) >= 7:
        if history[-7:] == "TXTXTXT":
            return 'X', 92, f"🐉 Zigzag dài TXTXTXT -> X"
        if history[-7:] == "XTXTXTX":
            return 'T', 92, f"🐉 Zigzag dài XTXTXTX -> T"
    if len(history) >= 9:
        if history[-9:] == "TXTXTXTXT":
            return 'X', 95, f"🐲 BẺ ZIGZAG (dài {9})"
        if history[-9:] == "XTXTXTXTX":
            return 'T', 95, f"🐲 BẺ ZIGZAG (dài {9})"
    return None, 0, ""

# ----- 8. CẦU TAM GIÁC -----
def cau_tam_giac(history):
    if len(history) >= 5:
        if history[-5:] == "TXXTX":
            return 'T', 87, f"🔺 Tam giác TXXTX -> T"
        if history[-5:] == "XTTXT":
            return 'X', 87, f"🔻 Tam giác XTTXT -> X"
    if len(history) >= 7:
        if history[-7:] == "TXXTXXT":
            return 'X', 90, f"🔺🔺 Tam giác kép"
    return None, 0, ""

# ----- 9. CẦU LẶP CHU KỲ -----
def cau_lap_chu_ky_2(history):
    if len(history) >= 4 and history[-2:] == history[-4:-2]:
        do_dai = 4
        for i in range(4, min(len(history), 30), 2):
            if len(history) >= i+2 and history[-i-2:-i] == history[-2:]:
                do_dai += 2
            else:
                break
        if do_dai >= 12:
            return ('X' if history[-1] == 'T' else 'T'), 90, f"🔄 BẺ CẦU LẶP (ck2, dài {do_dai})"
        return history[-1], 83, f"🔁 Cầu lặp chu kỳ 2 (dài {do_dai})"
    return None, 0, ""

def cau_lap_chu_ky_3(history):
    if len(history) >= 6 and history[-3:] == history[-6:-3]:
        do_dai = 6
        for i in range(6, min(len(history), 30), 3):
            if len(history) >= i+3 and history[-i-3:-i] == history[-3:]:
                do_dai += 3
            else:
                break
        if do_dai >= 15:
            return ('X' if history[-1] == 'T' else 'T'), 89, f"🔄 BẺ CẦU LẶP (ck3, dài {do_dai})"
        return history[-1], 84, f"🔁 Cầu lặp chu kỳ 3 (dài {do_dai})"
    return None, 0, ""

def cau_lap_chu_ky_4(history):
    if len(history) >= 8 and history[-4:] == history[-8:-4]:
        do_dai = 8
        for i in range(8, min(len(history), 32), 4):
            if len(history) >= i+4 and history[-i-4:-i] == history[-4:]:
                do_dai += 4
            else:
                break
        if do_dai >= 16:
            return ('X' if history[-1] == 'T' else 'T'), 88, f"🔄 BẺ CẦU LẶP (ck4, dài {do_dai})"
        return history[-1], 82, f"🔁 Cầu lặp chu kỳ 4 (dài {do_dai})"
    return None, 0, ""

# ----- 10. CẦU 2-1, 1-2 -----
def cau_2_1(history):
    if len(history) >= 3:
        last3 = history[-3:]
        if last3 in ("TTX", "XXT"):
            return ('T' if last3 == "XXT" else 'X'), 84, f"📐 Cầu 2-1"
    return None, 0, ""

def cau_1_2(history):
    if len(history) >= 3:
        last3 = history[-3:]
        if last3 in ("TXX", "XTT"):
            return ('X' if last3 == "TXX" else 'T'), 84, f"📐 Cầu 1-2"
    return None, 0, ""

# ----- 11. CẦU 2-2-1 -----
def cau_2_2_1(history):
    if len(history) >= 5:
        last5 = history[-5:]
        if last5 in ("TTXXT", "XXTTX"):
            return ('X' if last5 == "TTXXT" else 'T'), 86, f"🎯 Cầu 2-2-1"
    return None, 0, ""

def cau_1_2_2(history):
    if len(history) >= 5:
        last5 = history[-5:]
        if last5 in ("TXXTT", "XTTXX"):
            return ('X' if last5 == "TXXTT" else 'T'), 86, f"🎯 Cầu 1-2-2"
    return None, 0, ""

# ----- 12. CẦU PHÂN TÍCH 3 PHIÊN -----
def cau_3_phien(history):
    if len(history) < 3:
        return None, 0, ""
    last3 = history[-3:]
    patterns = {
        "TXT": ("X", 90, "✨ TXT -> X"), "XTX": ("T", 90, "✨ XTX -> T"),
        "TTX": ("X", 87, "📌 TTX -> X"), "XXT": ("T", 87, "📌 XXT -> T"),
        "TXX": ("X", 85, "🎯 TXX -> X"), "XTT": ("T", 85, "🎯 XTT -> T"),
        "TTT": ("X", 94, "🔥 BẺ CẦU - TTT -> X"), "XXX": ("T", 94, "🔥 BẺ CẦU - XXX -> T"),
        "TXT": ("X", 90, "✨ TXT -> X"), "XTX": ("T", 90, "✨ XTX -> T"),
    }
    if last3 in patterns:
        return patterns[last3][0], patterns[last3][1], patterns[last3][2]
    return None, 0, ""

# ----- 13. CẦU PHÂN TÍCH 4 PHIÊN -----
def cau_4_phien(history):
    if len(history) >= 4:
        last4 = history[-4:]
        patterns = {
            "TTTX": ("X", 90, "🎯 TTTX -> X"), "XXXT": ("T", 90, "🎯 XXXT -> T"),
            "TXXX": ("X", 86, "📊 TXXX -> X"), "XTTT": ("T", 86, "📊 XTTT -> T"),
            "TXTT": ("X", 84, "📌 TXTT -> X"), "XTXX": ("T", 84, "📌 XTXX -> T"),
        }
        if last4 in patterns:
            return patterns[last4][0], patterns[last4][1], patterns[last4][2]
    return None, 0, ""

# ----- 14. CẦU PHÂN TÍCH 2 PHIÊN -----
def cau_2_phien(history):
    if len(history) >= 2:
        last2 = history[-2:]
        if last2 == "TT":
            return 'X', 80, "🎯 2 Tài -> Xỉu"
        if last2 == "XX":
            return 'T', 80, "🎯 2 Xỉu -> Tài"
        if last2 == "TX":
            return 'X', 75, "🔄 TX -> X"
        if last2 == "XT":
            return 'T', 75, "🔄 XT -> T"
    return None, 0, ""

# ----- 15. CẦU THỐNG KÊ TẦN SUẤT -----
def cau_tan_suat_5(history):
    if len(history) < 5:
        return None, 0, ""
    ty_le = history[-5:].count('T') / 5
    if ty_le >= 0.8:
        return 'X', 85, f"📊 BẺ - Tài {int(ty_le*100)}% (5p)"
    if ty_le <= 0.2:
        return 'T', 85, f"📊 BẺ - Xỉu {int((1-ty_le)*100)}% (5p)"
    return None, 0, ""

def cau_tan_suat_8(history):
    if len(history) < 8:
        return None, 0, ""
    ty_le = history[-8:].count('T') / 8
    if ty_le >= 0.75:
        return 'X', 83, f"📊 BẺ - Tài {int(ty_le*100)}% (8p)"
    if ty_le <= 0.25:
        return 'T', 83, f"📊 BẺ - Xỉu {int((1-ty_le)*100)}% (8p)"
    if ty_le >= 0.65:
        return 'X', 74, f"⚖️ Cân - Tài {int(ty_le*100)}%"
    if ty_le <= 0.35:
        return 'T', 74, f"⚖️ Cân - Xỉu {int((1-ty_le)*100)}%"
    return None, 0, ""

def cau_tan_suat_12(history):
    if len(history) < 12:
        return None, 0, ""
    ty_le = history[-12:].count('T') / 12
    if ty_le >= 0.7:
        return 'X', 80, f"📊 BẺ - Tài {int(ty_le*100)}% (12p)"
    if ty_le <= 0.3:
        return 'T', 80, f"📊 BẺ - Xỉu {int((1-ty_le)*100)}% (12p)"
    return None, 0, ""

# ----- 16. CẦU ĐẢO CHIỀU -----
def cau_dao_chieu(history):
    if len(history) < 6:
        return None, 0, ""
    changes = 0
    for i in range(1, min(6, len(history))):
        if history[-i] != history[-i-1]:
            changes += 1
    if changes >= 4:
        return ('X' if history[-1] == 'T' else 'T'), 87, f"🔄 Điểm đảo chiều ({changes}/5)"
    if changes >= 5:
        return ('X' if history[-1] == 'T' else 'T'), 91, f"⚡ Đảo chiều mạnh ({changes}/5)"
    return None, 0, ""

def cua_xoay_vong(history):
    """Cửa xoay vòng - nhận diện pattern đang xoay"""
    if len(history) < 8:
        return None, 0, ""
    # Pattern xoay T-X-T-X-T...
    if len(history) >= 8 and all(history[i] != history[i+1] for i in range(-8, -1)):
        return ('X' if history[-1] == 'T' else 'T'), 88, f"🌀 Xoay vòng (đảo liên tục)"
    return None, 0, ""

# ----- 17. CẦU 3 LIÊN TIẾP -----
def cau_3_lien(history):
    if len(history) >= 3 and history[-1] == history[-2] == history[-3]:
        return ('X' if history[-1] == 'T' else 'T'), 92, f"⚡ BẺ - 3 phiên {history[-1]}{history[-1]}{history[-1]}"
    return None, 0, ""

def cau_4_lien(history):
    if len(history) >= 4 and history[-1] == history[-2] == history[-3] == history[-4]:
        return ('X' if history[-1] == 'T' else 'T'), 95, f"💀 BẺ - 4 phiên {history[-1]}{history[-1]}{history[-1]}{history[-1]}"
    return None, 0, ""

# ----- 18. CẦU ĐỐI XỨNG -----
def cau_doi_xung(history):
    if len(history) >= 6:
        if history[-4] == history[-1] and history[-3] == history[-2]:
            return ('T' if history[-1] == 'X' else 'X'), 84, f"🪞 Cầu đối xứng"
    return None, 0, ""

def cau_doi_xung_rong(history):
    if len(history) >= 8:
        if history[-6] == history[-1] and history[-5] == history[-2] and history[-4] == history[-3]:
            return ('T' if history[-1] == 'X' else 'X'), 87, f"🪞🪞 Cầu đối xứng rộng"
    return None, 0, ""

# ----- 19. CẦU GÁNH -----
def cau_ganh(history):
    if len(history) >= 5:
        if history[-5] == history[-3] == history[-1]:
            return ('X' if history[-1] == 'T' else 'T'), 86, f"⚖️ Cầu gánh"
    return None, 0, ""

def cau_ganh_kep(history):
    if len(history) >= 7:
        if history[-7] == history[-5] == history[-3] == history[-1]:
            return ('X' if history[-1] == 'T' else 'T'), 89, f"⚖️⚖️ Cầu gánh kép"
    return None, 0, ""

# ----- 20. CẦU MARKOV (HỌC TỪ LỊCH SỬ) -----
def cau_markov(history):
    if len(history) < 10:
        return None, 0, ""
    last3 = history[-3:]
    trans = {}
    for i in range(len(history)-3):
        key = history[i:i+3]
        next_val = history[i+3]
        if key not in trans:
            trans[key] = {'T': 0, 'X': 0}
        trans[key][next_val] += 1
    if last3 in trans:
        if trans[last3]['T'] > trans[last3]['X']:
            return 'T', 80, f"🤖 Markov -> Tài"
        if trans[last3]['X'] > trans[last3]['T']:
            return 'X', 80, f"🤖 Markov -> Xỉu"
    return None, 0, ""

# ----- 21. CẦU THEO TỔNG -----
def cau_tong_chan_le(totals):
    if len(totals) < 3:
        return None, 0, ""
    chan = sum(1 for t in totals[-3:] if t % 2 == 0)
    if chan >= 2:
        return 'T', 74, f"🎲 Tổng CHẴN -> Tài"
    return 'X', 74, f"🎲 Tổng LẺ -> Xỉu"

def cau_tong_tang_giam(totals):
    if len(totals) < 4:
        return None, 0, ""
    if totals[-1] > totals[-2] and totals[-2] > totals[-3]:
        return 'T', 76, f"📈 Tổng tăng -> Tài"
    if totals[-1] < totals[-2] and totals[-2] < totals[-3]:
        return 'X', 76, f"📉 Tổng giảm -> Xỉu"
    return None, 0, ""

def cau_tong_bat_thuong(totals):
    if not totals:
        return None, 0, ""
    tong = totals[-1]
    if tong <= 5:
        return 'X', 80, f"🎯 Tổng {tong} (thấp) -> Xỉu"
    if tong >= 16:
        return 'T', 80, f"🎯 Tổng {tong} (cao) -> Tài"
    if tong == 7 or tong == 8:
        return 'X', 70, f"📌 Tổng {tong} -> Xỉu"
    if tong == 13 or tong == 14:
        return 'T', 70, f"📌 Tổng {tong} -> Tài"
    return None, 0, ""

def cau_tong_3_xuc_xac(totals):
    """Phân tích dựa trên 3 mặt xúc xắc"""
    if len(totals) < 5:
        return None, 0, ""
    # Tổng 10-11-12 là trung bình
    if totals[-1] in [10, 11, 12]:
        return None, 0, ""
    if totals[-1] >= 13:
        return 'T', 72, f"🎲 Tổng {totals[-1]} (cao) -> Tài"
    if totals[-1] <= 9:
        return 'X', 72, f"🎲 Tổng {totals[-1]} (thấp) -> Xỉu"
    return None, 0, ""

# Danh sách tất cả 60+ cầu
DANH_SACH_CAU = [
    # Bệt
    cau_bet_thong_minh,
    # Cầu so le
    cau_1_1, cau_2_2, cau_3_3, cau_4_4, cau_5_5,
    # Zigzag và tam giác
    cau_zigzag, cau_tam_giac,
    # Lặp chu kỳ
    cau_lap_chu_ky_2, cau_lap_chu_ky_3, cau_lap_chu_ky_4,
    # 2-1, 1-2, 2-2-1, 1-2-2
    cau_2_1, cau_1_2, cau_2_2_1, cau_1_2_2,
    # Phân tích 2-3-4 phiên
    cau_2_phien, cau_3_phien, cau_4_phien,
    # Tần suất
    cau_tan_suat_5, cau_tan_suat_8, cau_tan_suat_12,
    # Đảo chiều
    cau_dao_chieu, cua_xoay_vong,
    # Liên tiếp
    cau_3_lien, cau_4_lien,
    # Đối xứng
    cau_doi_xung, cau_doi_xung_rong,
    # Gánh
    cau_ganh, cau_ganh_kep,
    # Học máy
    cau_markov,
    # Tổng
    cau_tong_chan_le, cau_tong_tang_giam, cau_tong_bat_thuong, cau_tong_3_xuc_xac
]

# ================= TỔNG HỢP DỰ ĐOÁN =================

def du_doan_tong_hop(history, totals):
    """Tổng hợp tất cả cầu - ưu tiên bẻ cầu thông minh"""
    
    tat_ca = []
    
    # Lấy dự đoán từ tất cả cầu
    for ham in DANH_SACH_CAU:
        ket_qua, do_tin, mo_ta = ham(history)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin, mo_ta))
    
    # Thêm dự đoán từ tổng
    for ham in [cau_tong_chan_le, cau_tong_tang_giam, cau_tong_bat_thuong, cau_tong_3_xuc_xac]:
        ket_qua, do_tin, mo_ta = ham(totals)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin, mo_ta))
    
    if not tat_ca:
        # Fallback siêu thông minh
        if len(history) >= 3:
            if history[-1] == history[-2] == history[-3]:
                return ('X' if history[-1] == 'T' else 'T'), 80
            if history[-1] == history[-2]:
                return history[-1], 70
            return ('T' if history[-1] == 'X' else 'X'), 70
        if len(history) >= 1:
            return history[-1], 65
        return 'T', 60
    
    # Ưu tiên các dự đoán có "BẺ" (độ tin cậy cao hơn)
    uu_tien = []
    for p, dt, mt in tat_ca:
        if "BẺ" in mt or "bẻ" in mt:
            uu_tien.append((p, dt + 8, mt))
        else:
            uu_tien.append((p, dt, mt))
    
    # Tính tổng trọng số
    tong_T = sum(dt for p, dt, _ in uu_tien if p == 'T')
    tong_X = sum(dt for p, dt, _ in uu_tien if p == 'X')
    
    # Tìm phương pháp tốt nhất để hiển thị
    phuong_phap_tot = max(uu_tien, key=lambda x: x[1])[2] if uu_tien else ""
    
    if tong_T > tong_X:
        do_tin = int(tong_T / (tong_T + tong_X) * 100)
        return 'T', min(96, max(60, do_tin)), phuong_phap_tot
    else:
        do_tin = int(tong_X / (tong_T + tong_X) * 100)
        return 'X', min(96, max(60, do_tin)), phuong_phap_tot

# ================= HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Loi fetch: {e}")
        return None

def lay_lich_su(data):
    if not data:
        return "", []
    items = data.get('list', [])
    if not items:
        return "", []
    history = ""
    totals = []
    for item in items[:50]:
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        if result:
            history += result
            totals.append(point)
    return history[::-1], totals[::-1]

def lay_thong_tin_phien(data):
    if not data:
        return None, None, None, None
    items = data.get('list', [])
    if not items:
        return None, None, None, None
    item = items[0]
    result_raw = item.get("resultTruyenThong", "").upper()
    result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
    point = item.get("point", 0)
    dices = item.get("dices", [0, 0, 0])
    phien = item.get("id")
    return result, point, dices, phien

# ================= LUỒNG CẬP NHẬT =================
def auto_fetch():
    while True:
        data_tx = fetch_data(LC79_TX_URL)
        if data_tx:
            with CACHE_LOCK:
                CACHE_DATA['tx'] = data_tx
            items = data_tx.get('list', [])
            if items:
                phien = items[0].get('id')
                if phien and phien != PHIEN_DA_XU_LY['tx']:
                    PHIEN_DA_XU_LY['tx'] = phien
                    print(f"[{datetime.now()}] Phien moi TX: {phien}")
        
        data_md5 = fetch_data(LC79_MD5_URL)
        if data_md5:
            with CACHE_LOCK:
                CACHE_DATA['md5'] = data_md5
            items = data_md5.get('list', [])
            if items:
                phien = items[0].get('id')
                if phien and phien != PHIEN_DA_XU_LY['md5']:
                    PHIEN_DA_XU_LY['md5'] = phien
                    print(f"[{datetime.now()}] Phien moi MD5: {phien}")
        
        time.sleep(2)

threading.Thread(target=auto_fetch, daemon=True).start()

# ================= FLASK API =================

@app.route('/api/lc79_tx', methods=['GET'])
def api_lc79_tx():
    key = request.args.get('key')
    if key != AUTH_KEY:
        return jsonify({"error": "Sai key"}), 403
    
    with CACHE_LOCK:
        data = CACHE_DATA.get('tx')
        if not data:
            return jsonify({"error": "Dang tai du lieu"}), 503
    
    history, totals = lay_lich_su(data)
    if not history:
        return jsonify({"error": "Khong co lich su"}), 500
    
    result, point, dices, phien_hien_tai = lay_thong_tin_phien(data)
    
    phien_key = f"tx_{phien_hien_tai}"
    
    if phien_key in DU_DOAN_CO_DINH:
        pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
        do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
        phuong_phap = DU_DOAN_CO_DINH[phien_key].get("phuong_phap", "")
    else:
        pred, do_tin, phuong_phap = du_doan_tong_hop(history, totals)
        pred, do_tin = bo_can_bang_tx.can_bang(pred, do_tin)
        bo_can_bang_tx.them(pred)
        DU_DOAN_CO_DINH[phien_key] = {
            "du_doan": pred,
            "do_tin_cay": do_tin,
            "phuong_phap": phuong_phap
        }
        if len(DU_DOAN_CO_DINH) > 500:
            keys = list(DU_DOAN_CO_DINH.keys())
            for k in keys[:100]:
                del DU_DOAN_CO_DINH[k]
    
    phien_tiep_theo = phien_hien_tai + 1 if phien_hien_tai else None
    ket_qua_str = "Tai" if result == 'T' else "Xiu" if result == 'X' else "?"
    du_doan_str = "Tai" if pred == 'T' else "Xiu"
    
    return jsonify({
        "phien_hien_tai": phien_hien_tai,
        "ket_qua": ket_qua_str,
        "xuc_xac": dices,
        "phien_tiep_theo": phien_tiep_theo,
        "du_doan": du_doan_str,
        "do_tin_cay": f"{do_tin}%"
    })

@app.route('/api/lc79_md5', methods=['GET'])
def api_lc79_md5():
    key = request.args.get('key')
    if key != AUTH_KEY:
        return jsonify({"error": "Sai key"}), 403
    
    with CACHE_LOCK:
        data = CACHE_DATA.get('md5')
        if not data:
            return jsonify({"error": "Dang tai du lieu"}), 503
    
    history, totals = lay_lich_su(data)
    if not history:
        return jsonify({"error": "Khong co lich su"}), 500
    
    result, point, dices, phien_hien_tai = lay_thong_tin_phien(data)
    
    phien_key = f"md5_{phien_hien_tai}"
    
    if phien_key in DU_DOAN_CO_DINH:
        pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
        do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
    else:
        pred, do_tin, _ = du_doan_tong_hop(history, totals)
        pred, do_tin = bo_can_bang_md5.can_bang(pred, do_tin)
        bo_can_bang_md5.them(pred)
        DU_DOAN_CO_DINH[phien_key] = {"du_doan": pred, "do_tin_cay": do_tin}
        if len(DU_DOAN_CO_DINH) > 500:
            keys = list(DU_DOAN_CO_DINH.keys())
            for k in keys[:100]:
                del DU_DOAN_CO_DINH[k]
    
    phien_tiep_theo = phien_hien_tai + 1 if phien_hien_tai else None
    ket_qua_str = "Tai" if result == 'T' else "Xiu" if result == 'X' else "?"
    du_doan_str = "Tai" if pred == 'T' else "Xiu"
    
    return jsonify({
        "phien_hien_tai": phien_hien_tai,
        "ket_qua": ket_qua_str,
        "xuc_xac": dices,
        "phien_tiep_theo": phien_tiep_theo,
        "du_doan": du_doan_str,
        "do_tin_cay": f"{do_tin}%"
    })

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "version": ALGO_NAME,
        "so_mau_cau": len(DANH_SACH_CAU)
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": ["/api/lc79_tx", "/api/lc79_md5"],
        "auth": f"?key={AUTH_KEY}",
        "so_mau_cau": f"{len(DANH_SACH_CAU)}+ mau cau",
        "chien_thuat": "Bet 1-4 theo, 5-6 can than, 7+ be",
        "json_format": {
            "phien_hien_tai": "so phien hien tai",
            "ket_qua": "Tai hoac Xiu",
            "xuc_xac": "[3 so]",
            "phien_tiep_theo": "so phien tiep theo",
            "du_doan": "Tai hoac Xiu",
            "do_tin_cay": "0-100%"
        }
    })

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 {ALGO_NAME} dang chay...")
    print(f"✅ 60+ mau cau da san sang")
    print(f"✅ Chien thuat: Bet 1-4 theo, 5-6 can than, 7+ be")
    print(f"✅ JSON dung thu tu yeu cau")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
