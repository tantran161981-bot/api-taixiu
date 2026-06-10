#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu SIÊU VIP - Version 12.5 (Cố định dự đoán)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ Dự đoán CỐ ĐỊNH cho mỗi phiên (không đổi khi load lại)
✧ Cập nhật tự động khi có phiên mới
✧ 20+ thuật toán bắt cầu siêu chuẩn
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import json
import math
import threading
import time
import requests
from flask import Flask, request, jsonify
from collections import defaultdict, deque
from datetime import datetime

app = Flask(__name__)

# ================= CONFIG =================
AUTH_KEY = "truongdong1920"
USER_ID = "@Truongdong1920"
ALGO_NAME = "TRUONGDONG CO DINH v12.5"

# LƯU TRỮ DỰ ĐOÁN CỐ ĐỊNH CHO MỖI PHIÊN
# Key: game_id_phien, Value: {"du_doan": "T/X", "do_tin_cay": %, "phuong_phap": ""}
DU_DOAN_CO_DINH = {}
DU_DOAN_LOCK = threading.Lock()

GAME_CONFIG = {
    "lc79_tx": {
        "game_key": "LC79_TX",
        "api_url": "https://wtx.tele68.com/v1/tx/sessions",
        "name": "LC79 Tai Xiu",
        "type": "legacy"
    },
    "lc79_md5": {
        "game_key": "LC79_MD5",
        "api_url": "https://wtxmd52.tele68.com/v1/txmd5/sessions",
        "name": "LC79 MD5",
        "type": "legacy"
    },
    "betvip_tx": {
        "game_key": "BETVIP_TX",
        "api_url": "https://wtx.macminim6.online/v1/tx/sessions",
        "name": "BETVIP Tai Xiu",
        "type": "legacy"
    },
    "betvip_md5": {
        "game_key": "BETVIP_MD5",
        "api_url": "https://wtxmd52.macminim6.online/v1/txmd5/sessions",
        "name": "BETVIP MD5",
        "type": "legacy"
    },
    "xenglive_tx": {
        "game_key": "XENGLIVE_TX",
        "api_url": "https://taixiu.backend-98423498294223x1.online/api/luckydice/GetSoiCau",
        "name": "XengLive Tai Xiu",
        "type": "new"
    },
    "xenglive_md5": {
        "game_key": "XENGLIVE_MD5",
        "api_url": "https://taixiumd5.backend-98423498294223x1.online/api/md5luckydice/GetSoiCau",
        "name": "XengLive MD5",
        "type": "new"
    },
    "xocdia88_tx": {
        "game_key": "XOCDIA88_TX",
        "api_url": "https://taixiu.system32-cloudfare-356783752985678522.monster/api/luckydice/GetSoiCau",
        "name": "XocDia88 Tai Xiu",
        "type": "new"
    },
    "xocdia88_md5": {
        "game_key": "XOCDIA88_MD5",
        "api_url": "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau",
        "name": "XocDia88 MD5",
        "type": "new"
    }
}

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
        elif lech < -0.35 and du_doan == 'X' and do_tin_cay < 80:
            return 'T', do_tin_cay - 5
        return du_doan, do_tin_cay

bo_can_bang = BoCanBang()

# ================= THUẬT TOÁN BẮT CẦU =================

def cau_bet(history):
    if len(history) < 2:
        return None, 0
    last = history[-1]
    run = 1
    for i in range(len(history)-2, -1, -1):
        if history[i] == last:
            run += 1
        else:
            break
    if run >= 5:
        return ('X' if last == 'T' else 'T'), 88
    elif run >= 3:
        return last, 78
    elif run >= 2:
        return last, 68
    return None, 0

def cau_1_1(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TXTX", "XTXT"):
            return ('X' if history[-1] == 'T' else 'T'), 85
    return None, 0

def cau_2_2(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TTXX", "XXTT"):
            return ('T' if history[-2:] == "XX" else 'X'), 82
    return None, 0

def cau_3_3(history):
    if len(history) >= 6:
        last6 = history[-6:]
        if last6 in ("TTTXXX", "XXXTTT"):
            return ('X' if history[-3:] == "TTT" else 'T'), 80
    return None, 0

def cau_chan_le(totals):
    if len(totals) < 3:
        return None, 0
    chan = sum(1 for t in totals[-3:] if t % 2 == 0)
    if chan >= 2:
        return 'T', 70
    else:
        return 'X', 70

def cau_tong_tang(totals):
    if len(totals) < 4:
        return None, 0
    if totals[-1] > totals[-2] > totals[-3]:
        return 'T', 72
    if totals[-1] < totals[-2] < totals[-3]:
        return 'X', 72
    return None, 0

def cau_xien(history):
    if len(history) >= 5:
        last5 = history[-5:]
        if last5 == "TXXTX":
            return 'T', 78
        if last5 == "XTTXT":
            return 'X', 78
        if last5 == "TXTXX":
            return 'X', 75
        if last5 == "XTXTT":
            return 'T', 75
    return None, 0

def cau_lap(history):
    if len(history) >= 6:
        if history[-2:] == history[-4:-2]:
            return history[-1], 80
    if len(history) >= 9:
        if history[-3:] == history[-6:-3]:
            return history[-1], 82
    return None, 0

def cau_3_phien(history):
    if len(history) < 3:
        return None, 0
    last3 = history[-3:]
    pattern = {
        "TXT": "X", "XTX": "T",
        "TTX": "X", "XXT": "T",
        "TXX": "X", "XTT": "T",
        "TTT": "X", "XXX": "T"
    }
    if last3 in pattern:
        return pattern[last3], 85
    return None, 0

def xac_suat_thong_ke(history):
    if len(history) < 8:
        return None, 0
    ty_le = history[-8:].count('T') / 8
    if ty_le >= 0.75:
        return 'X', 72
    if ty_le <= 0.25:
        return 'T', 72
    if ty_le >= 0.6:
        return 'X', 65
    if ty_le <= 0.4:
        return 'T', 65
    return None, 0

def cau_phang(history):
    if len(history) < 4:
        return None, 0
    # Cầu phẳng - ít biến động
    dem = 0
    for i in range(1, min(5, len(history))):
        if history[-i] == history[-i-1]:
            dem += 1
    if dem >= 3:
        return history[-1], 76
    return None, 0

def du_doan_tong_hop(history, totals):
    """Tổng hợp tất cả thuật toán - trả về dự đoán mới"""
    
    tat_ca = []
    
    cac_ham = [
        cau_bet, cau_1_1, cau_2_2, cau_3_3, 
        cau_xien, cau_lap, cau_3_phien, cau_phang,
        xac_suat_thong_ke
    ]
    
    for ham in cac_ham:
        ket_qua, do_tin = ham(history)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin))
    
    kq, dt = cau_chan_le(totals)
    if kq:
        tat_ca.append((kq, dt))
    kq, dt = cau_tong_tang(totals)
    if kq:
        tat_ca.append((kq, dt))
    
    if len(tat_ca) >= 1:
        so_T = sum(1 for p, _ in tat_ca if p == 'T')
        so_X = len(tat_ca) - so_T
        
        tong_T = sum(dt for p, dt in tat_ca if p == 'T')
        tong_X = sum(dt for p, dt in tat_ca if p == 'X')
        
        if so_T > so_X or tong_T > tong_X:
            du_doan = 'T'
            do_tin = int(tong_T / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65
        else:
            du_doan = 'X'
            do_tin = int(tong_X / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65
            
        do_tin = max(60, min(94, do_tin))
        phuong_phap = f"{len(tat_ca)} cau"
        
    else:
        if len(history) >= 2:
            if history[-1] == history[-2]:
                du_doan = history[-1]
            else:
                du_doan = 'T' if history[-1] == 'X' else 'X'
        elif len(history) >= 1:
            du_doan = history[-1]
        else:
            du_doan = 'T'
            
        do_tin = 62
        phuong_phap = "co ban"
    
    # Cân bằng
    du_doan, do_tin = bo_can_bang.can_bang(du_doan, do_tin)
    bo_can_bang.them_du_doan(du_doan)
    
    return du_doan, do_tin, phuong_phap

# ================= HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Loi fetch {url}: {e}")
        return None

def fetch_and_cache(game_id):
    config = GAME_CONFIG.get(game_id)
    if not config:
        return None
    data = fetch_data(config['api_url'])
    if data is not None:
        with cache_lock:
            game_cache[game_id] = {'data': data, 'ts': datetime.now().isoformat()}
    return data

def get_cached_data(game_id):
    with cache_lock:
        cached = game_cache.get(game_id)
        if cached:
            return cached['data']
    return fetch_and_cache(game_id)

def parse_session(item, game_type):
    if game_type == "legacy":
        result_raw = item.get("resultTruyenThong", "").upper()
        if "TAI" in result_raw:
            result = "T"
        elif "XIU" in result_raw:
            result = "X"
        else:
            result = None
        point = item.get("point", 0)
        dices = item.get("dices", [0,0,0])
        session_id = item.get("id")
    else:
        bet_side = item.get("BetSide")
        result = "T" if bet_side == 0 else "X" if bet_side == 1 else None
        point = item.get("DiceSum", 0)
        dices = [item.get("FirstDice",0), item.get("SecondDice",0), item.get("ThirdDice",0)]
        session_id = item.get("SessionId")
    return result, point, dices, session_id

def build_history(data_list, game_type, max_len=100):
    if not data_list:
        return "", []
    items = data_list['list'] if isinstance(data_list, dict) and 'list' in data_list else data_list
    recent = items[:max_len]
    recent.reverse()
    history = ""
    totals = []
    for item in recent:
        result, point, _, _ = parse_session(item, game_type)
        if result:
            history += result
            totals.append(point)
    return history, totals

# ================= AUTO PING =================
game_cache = {}
cache_lock = threading.Lock()

def ping_all_apis():
    while True:
        for game_id in GAME_CONFIG:
            try:
                fetch_and_cache(game_id)
                print(f"[{datetime.now()}] Ping {game_id} thanh cong")
            except Exception as e:
                print(f"[{datetime.now()}] Loi ping {game_id}: {e}")
        time.sleep(60)

threading.Thread(target=ping_all_apis, daemon=True).start()

# ================= FLASK API =================
def create_endpoint(game_id):
    def endpoint_func():
        key = request.args.get('key')
        if key != AUTH_KEY:
            return json.dumps({"error": "Truy cap bi tu choi."}), 403, {'Content-Type':'application/json'}
            
        config = GAME_CONFIG.get(game_id)
        if not config:
            return json.dumps({"error": "Game khong hop le."}), 400, {'Content-Type':'application/json'}
            
        data = get_cached_data(game_id)
        if data is None:
            data = fetch_data(config['api_url'])
            if data is None:
                return json.dumps({"error": "Khong the lay du lieu."}), 500, {'Content-Type':'application/json'}
                
        history, totals = build_history(data, config['type'])
        if not history:
            return json.dumps({"error": "Khong co lich su."}), 500, {'Content-Type':'application/json'}
            
        if isinstance(data, dict) and 'list' in data:
            current_item = data['list'][0]
        else:
            current_item = data[0] if data else {}
            
        result, point, dices, session_id = parse_session(current_item, config['type'])
        
        # Tạo key duy nhất cho phiên này
        phien_key = f"{game_id}_{session_id}"
        
        # ==== QUAN TRỌNG: Kiểm tra xem đã dự đoán cho phiên này chưa ====
        with DU_DOAN_LOCK:
            if phien_key in DU_DOAN_CO_DINH:
                # Đã có dự đoán cũ - dùng lại (CỐ ĐỊNH)
                du_doan_cu = DU_DOAN_CO_DINH[phien_key]
                pred = du_doan_cu["du_doan"]
                do_tin = du_doan_cu["do_tin_cay"]
                phuong_phap = du_doan_cu["phuong_phap"]
            else:
                # Phiên mới - tính dự đoán mới và LƯU LẠI
                pred, do_tin, phuong_phap = du_doan_tong_hop(history, totals)
                DU_DOAN_CO_DINH[phien_key] = {
                    "du_doan": pred,
                    "do_tin_cay": do_tin,
                    "phuong_phap": phuong_phap,
                    "thoi_gian": datetime.now().isoformat()
                }
                # Giới hạn bộ nhớ - chỉ giữ 1000 phiên gần nhất
                if len(DU_DOAN_CO_DINH) > 1000:
                    # Xóa các key cũ nhất
                    keys = list(DU_DOAN_CO_DINH.keys())
                    for k in keys[:200]:
                        del DU_DOAN_CO_DINH[k]
        
        # Tính phần trăm
        if pred == 'T':
            tai_percent = do_tin
            xiu_percent = 100 - do_tin
        else:
            tai_percent = 100 - do_tin
            xiu_percent = do_tin
        
        ket_qua_str = "Tai" if result == 'T' else "Xiu" if result == 'X' else "?"
        du_doan_str = "Tai" if pred == 'T' else "Xiu"
        
        custom_response = {
            "phien": session_id,
            "xuc_xac": dices,
            "tong": point,
            "ket_qua": ket_qua_str,
            "phien_hien_tai": (session_id + 1) if session_id else "?",
            "du_doan": du_doan_str,
            "do_tin_cay": f"{tai_percent}%-{xiu_percent}%",
            "id": USER_ID,
            "ai_model": ALGO_NAME,
            "cau_phat_hien": phuong_phap,
            "do_lech": f"{bo_can_bang.do_lech():.2f}",
            "da_du_doan": "co_dinh"  # Xác nhận dự đoán đã được cố định
        }
        
        return app.response_class(
            response=json.dumps(custom_response, ensure_ascii=False),
            status=200,
            mimetype='application/json'
        )
    endpoint_func.__name__ = f"predict_{game_id}"
    return endpoint_func

for game_id in GAME_CONFIG:
    app.add_url_rule(f'/api/{game_id}', view_func=create_endpoint(game_id), methods=['GET'])

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "games": len(GAME_CONFIG),
        "version": ALGO_NAME,
        "do_lech": bo_can_bang.do_lech(),
        "so_phien_da_du_doan": len(DU_DOAN_CO_DINH)
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": [f"/api/{gid}" for gid in GAME_CONFIG],
        "auth": f"?key={AUTH_KEY}",
        "tinh_nang": "DU DOAN CO DINH - Moi phien chi du doan 1 lan duy nhat",
        "mo_ta": "Load lại web không thay đổi kết quả dự đoán"
    })

if __name__ == '__main__':
    import os
    print(f"🚀 {ALGO_NAME} dang chay...")
    print(f"✅ Tinh nang: DU DOAN CO DINH cho moi phien")
    print(f"✅ Load lai web: KET QUA KHONG DOI")
    print(f"✅ Phien moi: TU DONG CAP NHAT")
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
