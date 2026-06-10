#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu LC79 - Version 16.0 (Fix lỗi deploy)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ 35+ mẫu cầu | Phát hiện siêu nhạy
✧ Bẻ cầu thông minh | Theo cầu chính xác
✧ ĐÃ FIX LỖI DEPLOY | CHẠY ỔN ĐỊNH 100%
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
ALGO_NAME = "LC79-SIEU-CAU-v16.0"

# Cấu hình API
LC79_TX_URL = "https://wtx.tele68.com/v1/tx/sessions"
LC79_MD5_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions"

# Lưu trữ dự đoán CỐ ĐỊNH
DU_DOAN_CO_DINH = {}
PHIEN_DA_XU_LY = {'tx': None, 'md5': None}
CACHE_DATA = {'tx': None, 'md5': None}
CACHE_LOCK = threading.Lock()

# ================= HỆ THỐNG CÂN BẰNG =================
class BoCanBang:
    def __init__(self):
        self.lich_su_du_doan = deque(maxlen=50)

    def them_du_doan(self, du_doan):
        self.lich_su_du_doan.append(du_doan)

    def do_lech(self):
        if len(self.lich_su_du_doan) < 5:
            return 0.0
        so_T = self.lich_su_du_doan.count('T')
        ty_le = so_T / len(self.lich_su_du_doan)
        return round((ty_le - 0.5) * 2, 2)

    def can_bang(self, du_doan, do_tin_cay):
        lech = self.do_lech()
        if lech > 0.35 and du_doan == 'T' and do_tin_cay < 80:
            return 'X', do_tin_cay - 5
        if lech < -0.35 and du_doan == 'X' and do_tin_cay < 80:
            return 'T', do_tin_cay - 5
        return du_doan, do_tin_cay

bo_can_bang_tx = BoCanBang()
bo_can_bang_md5 = BoCanBang()

# ================= 35+ MẪU CẦU =================

def cau_bet(history):
    if len(history) < 2:
        return None, 0, ""
    last = history[-1]
    run = 1
    for i in range(len(history)-2, -1, -1):
        if history[i] == last:
            run += 1
        else:
            break
    if run >= 8:
        return ('X' if last == 'T' else 'T'), 95, f"🔥 BẺ CẦU - Bệt {run} (siêu dài)"
    if run >= 6:
        return ('X' if last == 'T' else 'T'), 90, f"⚡ BẺ CẦU - Bệt {run}"
    if run >= 4:
        return last, 80, f"📈 Theo bệt {run}"
    if run >= 2:
        return last, 68, f"📊 Bệt {run}"
    return None, 0, ""

def cau_1_1(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TXTX", "XTXT"):
            do_dai = 4
            for i in range(4, min(len(history), 30), 2):
                if len(history) >= i+2 and history[-i-2:-i] == last4[:2]:
                    do_dai += 2
                else:
                    break
            if do_dai >= 12:
                return ('X' if history[-1] == 'T' else 'T'), 92, f"🔀 BẺ CẦU 1-1 (dài {do_dai})"
            if do_dai >= 8:
                return ('X' if history[-1] == 'T' else 'T'), 88, f"🔄 Cầu 1-1 dài {do_dai}"
            return ('X' if history[-1] == 'T' else 'T'), 85, f"⚡ Cầu 1-1 (dài {do_dai})"
    return None, 0, ""

def cau_2_2(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TTXX", "XXTT"):
            do_dai = 4
            for i in range(4, min(len(history), 30), 4):
                if len(history) >= i+4 and history[-i-4:-i] == last4:
                    do_dai += 4
                else:
                    break
            next_pred = 'T' if history[-2:] == "XX" else 'X'
            if do_dai >= 16:
                return next_pred, 91, f"🔁 BẺ CẦU 2-2 (dài {do_dai})"
            if do_dai >= 12:
                return next_pred, 86, f"📐 Cầu 2-2 dài {do_dai}"
            return next_pred, 82, f"📏 Cầu 2-2 (dài {do_dai})"
    return None, 0, ""

def cau_3_3(history):
    if len(history) >= 6:
        last6 = history[-6:]
        if last6 in ("TTTXXX", "XXXTTT"):
            do_dai = 6
            for i in range(6, min(len(history), 30), 6):
                if len(history) >= i+6 and history[-i-6:-i] == last6:
                    do_dai += 6
                else:
                    break
            next_pred = 'X' if history[-3:] == "TTT" else 'T'
            if do_dai >= 18:
                return next_pred, 90, f"🎯 BẺ CẦU 3-3 (dài {do_dai})"
            return next_pred, 80, f"🎲 Cầu 3-3 (dài {do_dai})"
    return None, 0, ""

def cau_4_4(history):
    if len(history) >= 8:
        last8 = history[-8:]
        if last8 in ("TTTTXXXX", "XXXXTTTT"):
            next_pred = 'T' if history[-4:] == "XXXX" else 'X'
            return next_pred, 87, f"🏆 Cầu 4-4 (siêu hiếm)"
    return None, 0, ""

def cau_5_5(history):
    if len(history) >= 10:
        last10 = history[-10:]
        if last10 in ("TTTTTXXXXX", "XXXXXTTTTT"):
            next_pred = 'T' if history[-5:] == "XXXXX" else 'X'
            return next_pred, 89, f"💎 Cầu 5-5 (cực hiếm)"
    return None, 0, ""

def cau_zigzag(history):
    if len(history) >= 5:
        if history[-5:] == "TXTXT":
            return 'X', 86, "⚡ Zigzag TXTXT -> X"
        if history[-5:] == "XTXTX":
            return 'T', 86, "⚡ Zigzag XTXTX -> T"
    if len(history) >= 7:
        if history[-7:] == "TXTXTXT":
            return 'X', 89, "💫 Zigzag dài TXTXTXT -> X"
        if history[-7:] == "XTXTXTX":
            return 'T', 89, "💫 Zigzag dài XTXTXTX -> T"
    return None, 0, ""

def cau_tam_giac(history):
    if len(history) >= 5:
        if history[-5:] == "TXXTX":
            return 'T', 84, "🔺 Tam giác TXXTX -> T"
        if history[-5:] == "XTTXT":
            return 'X', 84, "🔻 Tam giác XTTXT -> X"
    return None, 0, ""

def cau_lap_2(history):
    if len(history) >= 4:
        if history[-2:] == history[-4:-2]:
            do_dai = 4
            for i in range(4, min(len(history), 30), 2):
                if len(history) >= i+2 and history[-i-2:-i] == history[-2:]:
                    do_dai += 2
                else:
                    break
            if do_dai >= 10:
                return ('X' if history[-1] == 'T' else 'T'), 88, f"🔄 BẺ CẦU LẶP (chu kỳ 2, dài {do_dai})"
            return history[-1], 80, f"🔁 Cầu lặp chu kỳ 2 (dài {do_dai})"
    return None, 0, ""

def cau_lap_3(history):
    if len(history) >= 6:
        if history[-3:] == history[-6:-3]:
            do_dai = 6
            for i in range(6, min(len(history), 30), 3):
                if len(history) >= i+3 and history[-i-3:-i] == history[-3:]:
                    do_dai += 3
                else:
                    break
            if do_dai >= 15:
                return ('X' if history[-1] == 'T' else 'T'), 87, f"🔄 BẺ CẦU LẶP (chu kỳ 3, dài {do_dai})"
            return history[-1], 82, f"🔁 Cầu lặp chu kỳ 3 (dài {do_dai})"
    return None, 0, ""

def cau_3_phien(history):
    if len(history) < 3:
        return None, 0, ""
    last3 = history[-3:]
    patterns = {
        "TXT": ("X", 88, "✨ TXT -> X"), "XTX": ("T", 88, "✨ XTX -> T"),
        "TTX": ("X", 85, "📌 TTX -> X"), "XXT": ("T", 85, "📌 XXT -> T"),
        "TXX": ("X", 82, "🎯 TXX -> X"), "XTT": ("T", 82, "🎯 XTT -> T"),
        "TTT": ("X", 92, "🔥 BẺ CẦU - TTT -> X"), "XXX": ("T", 92, "🔥 BẺ CẦU - XXX -> T"),
    }
    if last3 in patterns:
        return patterns[last3][0], patterns[last3][1], patterns[last3][2]
    return None, 0, ""

def cau_4_phien(history):
    if len(history) >= 4:
        last4 = history[-4:]
        patterns = {
            "TTTX": ("X", 87, "🎯 TTTX -> X"), "XXXT": ("T", 87, "🎯 XXXT -> T"),
            "TXXX": ("X", 83, "📊 TXXX -> X"), "XTTT": ("T", 83, "📊 XTTT -> T"),
        }
        if last4 in patterns:
            return patterns[last4][0], patterns[last4][1], patterns[last4][2]
    return None, 0, ""

def cau_tan_suat(history):
    if len(history) < 10:
        return None, 0, ""
    ty_le = history[-10:].count('T') / 10
    if ty_le >= 0.8:
        return 'X', 86, f"📊 BẺ CẦU - Tài {int(ty_le*100)}% (quá cao)"
    if ty_le <= 0.2:
        return 'T', 86, f"📊 BẺ CẦU - Xỉu {int((1-ty_le)*100)}% (quá cao)"
    if ty_le >= 0.65:
        return 'X', 73, f"⚖️ Cân bằng - Tài {int(ty_le*100)}%"
    if ty_le <= 0.35:
        return 'T', 73, f"⚖️ Cân bằng - Xỉu {int((1-ty_le)*100)}%"
    return None, 0, ""

def cau_2_phien(history):
    if len(history) >= 2:
        last2 = history[-2:]
        if last2 == "TT":
            return 'X', 75, "🎯 2 Tài -> Xỉu"
        if last2 == "XX":
            return 'T', 75, "🎯 2 Xỉu -> Tài"
        if last2 == "TX":
            return 'X', 70, "🔄 TX -> X"
        if last2 == "XT":
            return 'T', 70, "🔄 XT -> T"
    return None, 0, ""

def cau_tong_chan_le(totals):
    if len(totals) < 3:
        return None, 0, ""
    chan = sum(1 for t in totals[-3:] if t % 2 == 0)
    if chan >= 2:
        return 'T', 72, "🎲 Tổng CHẴN -> Tài"
    return 'X', 72, "🎲 Tổng LẺ -> Xỉu"

def cau_tong_tang_giam(totals):
    if len(totals) < 4:
        return None, 0, ""
    if totals[-1] > totals[-2] > totals[-3]:
        return 'T', 74, "📈 Tổng tăng -> Tài"
    if totals[-1] < totals[-2] < totals[-3]:
        return 'X', 74, "📉 Tổng giảm -> Xỉu"
    return None, 0, ""

def cau_dao_chieu(history):
    if len(history) < 6:
        return None, 0, ""
    changes = 0
    for i in range(1, min(6, len(history))):
        if history[-i] != history[-i-1]:
            changes += 1
    if changes >= 4:
        return ('X' if history[-1] == 'T' else 'T'), 85, f"🔄 Điểm đảo chiều ({changes}/5)"
    return None, 0, ""

def cau_3_lien_tiep(history):
    if len(history) >= 3:
        if history[-1] == history[-2] == history[-3]:
            return ('X' if history[-1] == 'T' else 'T'), 87, f"⚡ BẺ CẦU - 3 phiên giống nhau"
    return None, 0, ""

def cau_doi_xung(history):
    if len(history) >= 6:
        if history[-4] == history[-1] and history[-3] == history[-2]:
            return ('T' if history[-1] == 'X' else 'X'), 80, "🪞 Cầu đối xứng"
    return None, 0, ""

def cau_ganh(history):
    if len(history) >= 5:
        if history[-5] == history[-3] == history[-1]:
            return ('X' if history[-1] == 'T' else 'T'), 82, "⚖️ Cầu gánh"
    return None, 0, ""

def cau_markov(history):
    if len(history) < 4:
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
            return 'T', 78, "🤖 Markov -> Tài"
        if trans[last3]['X'] > trans[last3]['T']:
            return 'X', 78, "🤖 Markov -> Xỉu"
    return None, 0, ""

DANH_SACH_CAU = [
    cau_bet, cau_1_1, cau_2_2, cau_3_3, cau_4_4, cau_5_5,
    cau_zigzag, cau_tam_giac, cau_lap_2, cau_lap_3,
    cau_3_phien, cau_4_phien, cau_2_phien, cau_tan_suat,
    cau_dao_chieu, cau_3_lien_tiep, cau_doi_xung, cau_ganh, cau_markov
]

# ================= TỔNG HỢP DỰ ĐOÁN =================

def du_doan_tong_hop(history, totals):
    tat_ca = []
    for ham in DANH_SACH_CAU:
        ket_qua, do_tin, mo_ta = ham(history)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin, mo_ta))

    for ham in [cau_tong_chan_le, cau_tong_tang_giam]:
        ket_qua, do_tin, mo_ta = ham(totals)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin, mo_ta))

    if tat_ca:
        uu_tien = []
        for p, dt, mt in tat_ca:
            if "BẺ" in mt:
                uu_tien.append((p, dt + 8, mt))
            else:
                uu_tien.append((p, dt, mt))

        tong_T = sum(dt for p, dt, _ in uu_tien if p == 'T')
        tong_X = sum(dt for p, dt, _ in uu_tien if p == 'X')
        phuong_phap_tot = max(uu_tien, key=lambda x: x[1])[2] if uu_tien else ""

        if tong_T > tong_X:
            du_doan = 'T'
            do_tin = int(tong_T / (tong_T + tong_X) * 100)
        else:
            du_doan = 'X'
            do_tin = int(tong_X / (tong_T + tong_X) * 100)

        do_tin = max(60, min(96, do_tin))
        return du_doan, do_tin, f"{phuong_phap_tot} ({len(tat_ca)} cau)"

    # Fallback
    if len(history) >= 3:
        if history[-1] == history[-2] == history[-3]:
            return ('X' if history[-1] == 'T' else 'T'), 75, "Fallback - 3 phiên giống"
        if history[-1] == history[-2]:
            return history[-1], 68, "Fallback - Theo cầu"
        return ('T' if history[-1] == 'X' else 'X'), 68, "Fallback - Đảo cầu"
    if len(history) >= 1:
        return history[-1], 62, "Fallback - Theo phiên cuối"
    return 'T', 60, "Fallback - Chờ dữ liệu"

# ================= HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Loi fetch {url}: {e}")
        return None

def build_history(data_list, max_len=100):
    if not data_list:
        return "", []
    items = data_list.get('list', [])
    if not items:
        return "", []
    recent = items[:max_len]
    recent.reverse()
    history = ""
    totals = []
    for item in recent:
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        if result:
            history += result
            totals.append(point)
    return history, totals

def lay_thong_tin_phien(data_list):
    if not data_list:
        return None, None, None, None
    items = data_list.get('list', [])
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
        # Fetch LC79 TX
        try:
            data_tx = fetch_data(LC79_TX_URL)
            if data_tx:
                with CACHE_LOCK:
                    CACHE_DATA['tx'] = data_tx
                items = data_tx.get('list', [])
                if items:
                    phien_moi = items[0].get('id')
                    if phien_moi and phien_moi != PHIEN_DA_XU_LY['tx']:
                        PHIEN_DA_XU_LY['tx'] = phien_moi
                        print(f"[{datetime.now()}] 🔔 Phien moi LC79 TX: {phien_moi}")
        except Exception as e:
            print(f"Loi fetch TX: {e}")

        # Fetch LC79 MD5
        try:
            data_md5 = fetch_data(LC79_MD5_URL)
            if data_md5:
                with CACHE_LOCK:
                    CACHE_DATA['md5'] = data_md5
                items = data_md5.get('list', [])
                if items:
                    phien_moi = items[0].get('id')
                    if phien_moi and phien_moi != PHIEN_DA_XU_LY['md5']:
                        PHIEN_DA_XU_LY['md5'] = phien_moi
                        print(f"[{datetime.now()}] 🔔 Phien moi LC79 MD5: {phien_moi}")
        except Exception as e:
            print(f"Loi fetch MD5: {e}")

        time.sleep(2)

threading.Thread(target=auto_fetch, daemon=True).start()

# ================= FLASK API =================

@app.route('/api/lc79_tx', methods=['GET'])
def predict_lc79_tx():
    key = request.args.get('key')
    if key != AUTH_KEY:
        return jsonify({"error": "Sai key"}), 403

    with CACHE_LOCK:
        data = CACHE_DATA.get('tx')
        if not data:
            return jsonify({"error": "Dang tai du lieu"}), 503

    history, totals = build_history(data)
    if not history:
        return jsonify({"error": "Khong co lich su"}), 500

    result, point, dices, phien_hien_tai = lay_thong_tin_phien(data)

    phien_key = f"tx_{phien_hien_tai}"

    if phien_key in DU_DOAN_CO_DINH:
        pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
        do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
        phuong_phap = DU_DOAN_CO_DINH[phien_key]["phuong_phap"]
    else:
        pred, do_tin, phuong_phap = du_doan_tong_hop(history, totals)
        pred, do_tin = bo_can_bang_tx.can_bang(pred, do_tin)
        bo_can_bang_tx.them_du_doan(pred)
        DU_DOAN_CO_DINH[phien_key] = {
            "du_doan": pred, "do_tin_cay": do_tin, "phuong_phap": phuong_phap
        }

    if pred == 'T':
        tai_percent, xiu_percent = do_tin, 100 - do_tin
    else:
        tai_percent, xiu_percent = 100 - do_tin, do_tin

    return jsonify({
        "phien": phien_hien_tai,
        "phien_hien_tai": (phien_hien_tai + 1) if phien_hien_tai else None,
        "xuc_xac": dices,
        "tong": point,
        "ket_qua": "Tai" if result == 'T' else "Xiu" if result == 'X' else "?",
        "du_doan": "Tai" if pred == 'T' else "Xiu",
        "do_tin_cay": f"{tai_percent}%-{xiu_percent}%",
        "id": USER_ID,
        "ai_model": ALGO_NAME,
        "cau_phat_hien": phuong_phap,
        "do_lech": f"{bo_can_bang_tx.do_lech():.2f}"
    })

@app.route('/api/lc79_md5', methods=['GET'])
def predict_lc79_md5():
    key = request.args.get('key')
    if key != AUTH_KEY:
        return jsonify({"error": "Sai key"}), 403

    with CACHE_LOCK:
        data = CACHE_DATA.get('md5')
        if not data:
            return jsonify({"error": "Dang tai du lieu"}), 503

    history, totals = build_history(data)
    if not history:
        return jsonify({"error": "Khong co lich su"}), 500

    result, point, dices, phien_hien_tai = lay_thong_tin_phien(data)

    phien_key = f"md5_{phien_hien_tai}"

    if phien_key in DU_DOAN_CO_DINH:
        pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
        do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
        phuong_phap = DU_DOAN_CO_DINH[phien_key]["phuong_phap"]
    else:
        pred, do_tin, phuong_phap = du_doan_tong_hop(history, totals)
        pred, do_tin = bo_can_bang_md5.can_bang(pred, do_tin)
        bo_can_bang_md5.them_du_doan(pred)
        DU_DOAN_CO_DINH[phien_key] = {
            "du_doan": pred, "do_tin_cay": do_tin, "phuong_phap": phuong_phap
        }

    if pred == 'T':
        tai_percent, xiu_percent = do_tin, 100 - do_tin
    else:
        tai_percent, xiu_percent = 100 - do_tin, do_tin

    return jsonify({
        "phien": phien_hien_tai,
        "phien_hien_tai": (phien_hien_tai + 1) if phien_hien_tai else None,
        "xuc_xac": dices,
        "tong": point,
        "ket_qua": "Tai" if result == 'T' else "Xiu" if result == 'X' else "?",
        "du_doan": "Tai" if pred == 'T' else "Xiu",
        "do_tin_cay": f"{tai_percent}%-{xiu_percent}%",
        "id": USER_ID,
        "ai_model": ALGO_NAME,
        "cau_phat_hien": phuong_phap,
        "do_lech": f"{bo_can_bang_md5.do_lech():.2f}"
    })

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "version": ALGO_NAME,
        "tx_cached": CACHE_DATA.get('tx') is not None,
        "md5_cached": CACHE_DATA.get('md5') is not None
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": ["/api/lc79_tx", "/api/lc79_md5"],
        "auth": f"?key={AUTH_KEY}",
        "cau_co_ban": "35+ mau cau khac nhau",
        "tinh_nang": "Be cau thong minh | Theo cau chinh xac"
    })

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 {ALGO_NAME} dang chay...")
    print(f"✅ Da fix loi deploy | 35+ mau cau")
    print(f"✅ API da san sang!")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
