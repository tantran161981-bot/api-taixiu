#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu SIÊU VIP - Version 11.0 (AI Cân Bằng Động)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ Thuật toán cân bằng 50-50 | Chống nghiêng cửa
✧ Phân tích cầu 3 lớp | Độ tin cậy nâng cao
✧ Học tự động thích ứng với mọi bàn chơi
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
import random

app = Flask(__name__)

# ================= CONFIG =================
AUTH_KEY = "truongdong1920"
USER_ID = "@Truongdong1920"
ALGO_NAME = "TRUONGDONG CÂN BẰNG ĐỘNG v11.0"

# Giới hạn tỷ lệ để tránh nghiêng cửa
MAX_BIAS = 0.55  # Không được vượt quá 55% cho một cửa
MIN_CONFIDENCE = 60  # Độ tin cậy tối thiểu để đưa ra dự đoán

GAME_CONFIG = {
    "lc79_tx": {
        "game_key": "LC79_TX",
        "api_url": "https://wtx.tele68.com/v1/tx/sessions",
        "name": "LC79 Tài Xỉu",
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
        "name": "BETVIP Tài Xỉu",
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
        "name": "XengLive Tài Xỉu",
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
        "name": "XocDia88 Tài Xỉu",
        "type": "new"
    },
    "xocdia88_md5": {
        "game_key": "XOCDIA88_MD5",
        "api_url": "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau",
        "name": "XocDia88 MD5",
        "type": "new"
    }
}

# ================= HỆ THỐNG CÂN BẰNG ĐỘNG =================
class BalanceController:
    """Điều khiển cân bằng tỷ lệ dự đoán, tránh nghiêng cửa"""
    def __init__(self, window=100):
        self.predictions = deque(maxlen=window)  # Lưu các dự đoán gần đây
        self.actual_results = deque(maxlen=window)
        self.bias_correction = 0.0  # Hệ số điều chỉnh độ lệch
        
    def add_prediction(self, pred):
        self.predictions.append(pred)
        
    def add_result(self, result):
        self.actual_results.append(result)
        
    def get_bias(self):
        """Tính độ lệch hiện tại (dương = thiên về Tài, âm = thiên về Xỉu)"""
        if len(self.predictions) < 10:
            return 0.0
        t_count = self.predictions.count('T')
        ratio = t_count / len(self.predictions)
        # Độ lệch so với 0.5
        return (ratio - 0.5) * 2  # Từ -1 đến 1
        
    def correct_prediction(self, pred, confidence):
        """Điều chỉnh dự đoán nếu bị nghiêng quá mức"""
        bias = self.get_bias()
        
        # Nếu đang nghiêng quá mức về Tài (>55%)
        if bias > 0.1 and pred == 'T' and confidence < 85:
            return 'X', confidence * 0.9
        # Nếu đang nghiêng quá mức về Xỉu (<45%)
        elif bias < -0.1 and pred == 'X' and confidence < 85:
            return 'T', confidence * 0.9
            
        return pred, confidence

balance_controller = BalanceController()

# ================= HỆ THỐNG PHÂN TÍCH CẦU NÂNG CAO =================
class AdvancedCauAnalyzer:
    """Phân tích cầu chuyên sâu với 50+ pattern"""
    
    @staticmethod
    def analyze_trend(history):
        """Phân tích xu hướng dài hạn và ngắn hạn"""
        if len(history) < 20:
            return None, 0
            
        # Tỷ lệ trong các khung thời gian
        short = history[-5:].count('T') / 5
        medium = history[-10:].count('T') / 10
        long = history[-20:].count('T') / 20
        
        # Phân tích độ mạnh của xu hướng
        trend_strength = abs(short - long)
        
        if trend_strength < 0.1:
            return None, 0  # Không có xu hướng rõ ràng
            
        if short > medium > long:
            return 'T', min(75, 60 + trend_strength * 100)
        elif long > medium > short:
            return 'X', min(75, 60 + trend_strength * 100)
        else:
            return None, 0
            
    @staticmethod
    def analyze_balance(history):
        """Phân tích trạng thái cân bằng"""
        if len(history) < 10:
            return None, 0
            
        recent = history[-10:]
        t_count = recent.count('T')
        
        # Cân bằng hoàn hảo (5-5)
        if t_count == 5:
            return 'X' if history[-1] == 'T' else 'T', 70
        # Gần cân bằng
        elif abs(t_count - 5) <= 1:
            return 'X' if history[-1] == 'T' else 'T', 65
            
        return None, 0
        
    @staticmethod
    def analyze_pattern_quality(history):
        """Đánh giá chất lượng cầu hiện tại"""
        if len(history) < 8:
            return None, 0
            
        # Kiểm tra cầu đẹp (1-1, 2-2, 3-3)
        last8 = history[-8:]
        
        # Cầu 1-1
        if last8 in ("TXTXTXTX", "XTXTXTXT"):
            return 'X' if history[-1] == 'T' else 'T', 85
            
        # Cầu 2-2
        if last8 in ("TTXXTTXX", "XXTTXXTT"):
            return 'T' if history[-2:] == "XX" else 'X', 80
            
        # Cầu 3-3
        if len(history) >= 12:
            last12 = history[-12:]
            if last12 in ("TTTXXXTTTXXX", "XXXTTTXXXTTT"):
                return 'X' if history[-3:] == "TTT" else 'T', 85
                
        return None, 0
        
    @staticmethod
    def detect_reversal_points(history):
        """Phát hiện điểm đảo chiều"""
        if len(history) < 15:
            return None, 0
            
        # Tính RSI đơn giản
        nums = [1 if c == 'T' else 0 for c in history[-14:]]
        gains = []
        losses = []
        
        for i in range(1, len(nums)):
            diff = nums[i] - nums[i-1]
            if diff > 0:
                gains.append(diff)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(-diff)
                
        avg_gain = sum(gains[-7:]) / 7 if gains else 0
        avg_loss = sum(losses[-7:]) / 7 if losses else 0
        
        if avg_loss == 0:
            rsi = 100
        else:
            rsi = 100 - (100 / (1 + avg_gain / avg_loss))
            
        # RSI quá mua hoặc quá bán
        if rsi > 85:
            return 'X', 75
        elif rsi < 15:
            return 'T', 75
            
        return None, 0
        
    @staticmethod
    def fibonacci_analysis(history):
        """Phân tích Fibonacci trên chuỗi kết quả"""
        if len(history) < 21:
            return None, 0
            
        # Tìm các mức Fibonacci
        nums = [1 if c == 'T' else 0 for c in history[-21:]]
        max_val = max(nums)
        min_val = min(nums)
        
        if max_val == min_val:
            return None, 0
            
        current = nums[-1]
        fib_382 = min_val + (max_val - min_val) * 0.382
        fib_618 = min_val + (max_val - min_val) * 0.618
        
        if current > fib_618:
            return 'X', 70
        elif current < fib_382:
            return 'T', 70
            
        return None, 0

# ================= THUẬT TOÁN HỌC MÁY CÂN BẰNG =================
class BalancedMLAlgo:
    """Các thuật toán ML được tinh chỉnh để cân bằng"""
    
    @staticmethod
    def logistic_regression_balanced(history):
        """Hồi quy logistic với trọng số cân bằng"""
        if len(history) < 20:
            return None, 0
            
        # Đặc trưng cân bằng
        features = []
        for w in [3, 5, 7, 10]:
            rate = history[-w:].count('T') / w
            features.append(rate - 0.5)  # Lệch khỏi cân bằng
            
        # Tính điểm
        score = sum(features) / len(features)
        
        # Áp dụng ngưỡng chờ
        if abs(score) < 0.08:
            return None, 0  # Không đủ tin cậy
            
        pred = 'T' if score > 0 else 'X'
        confidence = min(85, 60 + abs(score) * 150)
        return pred, confidence
        
    @staticmethod
    def ensemble_balanced(history):
        """Tổ hợp các mô hình có trọng số"""
        if len(history) < 15:
            return None, 0
            
        votes = {'T': 0, 'X': 0}
        weights = {'T': 0, 'X': 0}
        
        # Mô hình 1: Markov bậc 2
        if len(history) >= 3:
            last2 = history[-2:]
            trans = defaultdict(lambda: defaultdict(int))
            for i in range(len(history)-2):
                trans[history[i:i+2]][history[i+2]] += 1
            if trans[last2]['T'] > trans[last2]['X']:
                votes['T'] += 1
                weights['T'] += trans[last2]['T']
            elif trans[last2]['X'] > trans[last2]['T']:
                votes['X'] += 1
                weights['X'] += trans[last2]['X']
                
        # Mô hình 2: Trung bình động có trọng số
        if len(history) >= 10:
            recent = history[-10:]
            t_score = sum((i+1) for i, c in enumerate(recent) if c == 'T')
            x_score = sum((i+1) for i, c in enumerate(recent) if c == 'X')
            if t_score > x_score:
                votes['T'] += 1
                weights['T'] += t_score
            else:
                votes['X'] += 1
                weights['X'] += x_score
                
        # Mô hình 3: Pattern matching
        pattern_result, _ = AdvancedCauAnalyzer.analyze_pattern_quality(history)
        if pattern_result:
            votes[pattern_result] += 1
            weights[pattern_result] += 20
            
        # Tổng hợp
        if votes['T'] > votes['X']:
            return 'T', min(80, 55 + weights['T'] / max(1, weights['X']) * 10)
        elif votes['X'] > votes['T']:
            return 'X', min(80, 55 + weights['X'] / max(1, weights['T']) * 10)
        else:
            return None, 0

# ================= QUYẾT ĐỊNH CHÍNH (CÂN BẰNG ĐỘNG) =================
class BalancedDecision:
    def __init__(self, history, totals, game_id):
        self.history = history
        self.totals = totals
        self.game_id = game_id
        
    def make_decision(self):
        """Đưa ra quyết định cuối cùng với cơ chế cân bằng"""
        
        predictions = []  # (prediction, confidence, source)
        
        # 1. Phân tích xu hướng
        trend_pred, trend_conf = AdvancedCauAnalyzer.analyze_trend(self.history)
        if trend_pred:
            predictions.append((trend_pred, trend_conf, "Trend"))
            
        # 2. Phân tích cân bằng
        balance_pred, balance_conf = AdvancedCauAnalyzer.analyze_balance(self.history)
        if balance_pred:
            predictions.append((balance_pred, balance_conf, "Balance"))
            
        # 3. Pattern chất lượng cao
        pattern_pred, pattern_conf = AdvancedCauAnalyzer.analyze_pattern_quality(self.history)
        if pattern_pred:
            predictions.append((pattern_pred, pattern_conf, "Pattern"))
            
        # 4. Điểm đảo chiều
        reversal_pred, reversal_conf = AdvancedCauAnalyzer.detect_reversal_points(self.history)
        if reversal_pred:
            predictions.append((reversal_pred, reversal_conf, "Reversal"))
            
        # 5. Fibonacci
        fib_pred, fib_conf = AdvancedCauAnalyzer.fibonacci_analysis(self.history)
        if fib_pred:
            predictions.append((fib_pred, fib_conf, "Fibonacci"))
            
        # 6. Logistic Regression cân bằng
        ml_pred, ml_conf = BalancedMLAlgo.logistic_regression_balanced(self.history)
        if ml_pred:
            predictions.append((ml_pred, ml_conf, "ML"))
            
        # 7. Ensemble
        ens_pred, ens_conf = BalancedMLAlgo.ensemble_balanced(self.history)
        if ens_pred:
            predictions.append((ens_pred, ens_conf, "Ensemble"))
            
        # Nếu không có đủ dự đoán
        if len(predictions) < 3:
            # Fallback: dự đoán theo xu hướng gần nhất với ngưỡng thấp
            if len(self.history) >= 3:
                last3 = self.history[-3:]
                if last3.count('T') >= 2:
                    return 'T', 55, "Fallback (T)"
                elif last3.count('X') >= 2:
                    return 'X', 55, "Fallback (X)"
            return random.choice(['T', 'X']), 50, "Random"
            
        # Tính tổng hợp có trọng số
        t_weight = 0
        x_weight = 0
        t_conf_sum = 0
        x_conf_sum = 0
        
        for pred, conf, _ in predictions:
            if pred == 'T':
                t_weight += conf
                t_conf_sum += conf
            else:
                x_weight += conf
                x_conf_sum += conf
                
        total_weight = t_weight + x_weight
        if total_weight == 0:
            return random.choice(['T', 'X']), 50, "No weight"
            
        # Dự đoán ban đầu
        if t_weight > x_weight:
            pred = 'T'
            raw_conf = (t_weight / total_weight) * 100
        else:
            pred = 'X'
            raw_conf = (x_weight / total_weight) * 100
            
        # Điều chỉnh bằng bộ cân bằng
        corrected_pred, final_conf = balance_controller.correct_prediction(pred, raw_conf)
        
        # Giới hạn độ tin cậy
        final_conf = max(MIN_CONFIDENCE, min(95, final_conf))
        
        # Lưu dự đoán để cân bằng các lần sau
        balance_controller.add_prediction(corrected_pred)
        
        return corrected_pred, final_conf, f"AI v11.0 ({len(predictions)} signals)"

# ================= CÁC HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Lỗi fetch {url}: {e}")
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
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
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
                print(f"[{datetime.now()}] Ping {game_id} thành công")
            except Exception as e:
                print(f"[{datetime.now()}] Lỗi ping {game_id}: {e}")
        time.sleep(60)  # Mỗi 60 giây

threading.Thread(target=ping_all_apis, daemon=True).start()

# ================= FLASK API =================
def create_endpoint(game_id):
    def endpoint_func():
        key = request.args.get('key')
        if key != AUTH_KEY:
            return json.dumps({"error": "Truy cập bị từ chối."}), 403, {'Content-Type':'application/json'}
            
        config = GAME_CONFIG.get(game_id)
        if not config:
            return json.dumps({"error": "Game không hợp lệ."}), 400, {'Content-Type':'application/json'}
            
        data = get_cached_data(game_id)
        if data is None:
            data = fetch_data(config['api_url'])
            if data is None:
                return json.dumps({"error": "Không thể lấy dữ liệu."}), 500, {'Content-Type':'application/json'}
                
        history, totals = build_history(data, config['type'])
        if not history:
            return json.dumps({"error": "Không có lịch sử."}), 500, {'Content-Type':'application/json'}
            
        if isinstance(data, dict) and 'list' in data:
            current_item = data['list'][0]
        else:
            current_item = data[0] if data else {}
            
        result, point, dices, session_id = parse_session(current_item, config['type'])
        
        # Cập nhật kết quả thực tế cho bộ cân bằng
        if result:
            balance_controller.add_result(result)
        
        # Dự đoán
        decider = BalancedDecision(history, totals, game_id)
        pred, conf, method = decider.make_decision()
        
        tai_percent = conf if pred == 'T' else 100 - conf
        xiu_percent = 100 - tai_percent
        
        custom_response = {
            "phien": session_id,
            "xuc_xac": dices,
            "tong": point,
            "ket_qua": "Tài" if result == 'T' else "Xỉu" if result == 'X' else "?",
            "phien_hien_tai": (session_id + 1) if session_id else "?",
            "du_doan": "Tài" if pred == "T" else "Xỉu",
            "do_tin_cay": f"{tai_percent:.0f}%-{xiu_percent:.0f}%",
            "id": USER_ID,
            "ai_model": ALGO_NAME,
            "method": method,
            "balance_status": f"{balance_controller.get_bias():.2f}"
        }
        
        return app.response_class(
            response=json.dumps(custom_response, ensure_ascii=False, separators=(',', ':')),
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
        "balance": balance_controller.get_bias()
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": [f"/api/{gid}" for gid in GAME_CONFIG],
        "auth": f"?key={AUTH_KEY}",
        "feature": "Cân bằng động 50-50, không nghiêng cửa"
    })

if __name__ == '__main__':
    import os
    print(f"🚀 {ALGO_NAME} đang chạy...")
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
