import os, datetime, uuid, joblib
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from sklearn.preprocessing import MinMaxScaler
import xgboost as xgb
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import GRU, Dense

app = Flask(__name__, static_folder='.')
CORS(app)

os.makedirs('uploads', exist_ok=True)
os.makedirs('models', exist_ok=True)

latest_sensor_data = {"voltage": 0.0, "current": 0.0, "temp": 0.0, "soc": 0.0}
is_recording = False
recording_session = []
v_threshold = 9.0

# --- NAVIGATION ROUTES ---
@app.route('/')
def index(): 
    return send_from_directory('.', 'index.html')

@app.route('/analysis')
def analysis_page(): 
    return send_from_directory('.', 'analysis.html')

# --- THIS IS THE FIX: Serves your CSS, JS, and MP4 files ---
@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

# --- HARDWARE BRIDGE ---
@app.route('/live_data', methods=['POST'])
def receive_data():
    global latest_sensor_data, is_recording, recording_session
    data = request.get_json()
    v, i, t = round(data.get('voltage', 0.0), 2), round(data.get('current', 0.0), 2), round(data.get('temp', 0.0), 1)
    
    # 3S Li-ion Logic: 9.0V to 12.6V
    soc_calc = round(max(0, min(100, ((v - 9.0) / (12.6 - 9.0)) * 100)), 1)
    latest_sensor_data.update({"voltage": v, "current": i, "temp": t, "soc": soc_calc})

    if is_recording:
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        recording_session.append({"time": timestamp, "voltage": v, "current": i, "temp": t, "soc": soc_calc})
        if v <= v_threshold: is_recording = False
    return jsonify({"status": "success", "recording": is_recording}), 200

@app.route('/get_data')
def get_data(): return jsonify(latest_sensor_data)

# --- LIVE PROJECTED CURVE ---
@app.route('/live_curve_data')
def live_curve_data():
    v, i, soc = latest_sensor_data['voltage'], latest_sensor_data['current'], latest_sensor_data['soc']
    draw = i if i > 0.1 else 0.5 
    remaining_ah = 2.0 * (soc / 100.0)
    mins_left = int((remaining_ah / draw) * 60) if draw > 0 else 0
    
    times, socs = [], []
    for step in range(11):
        fraction = step / 10.0
        times.append(int(mins_left * fraction))
        socs.append(round(soc - (soc * fraction), 1))
        
    return jsonify({"times": times, "socs": socs, "mins_left": mins_left})

# --- CSV GENERATION ---
@app.route('/toggle_gen', methods=['POST'])
def toggle_gen():
    global is_recording, recording_session, v_threshold
    req = request.json
    v_threshold = float(req.get('min_v', 9.0))
    is_recording = not is_recording
    if is_recording: recording_session = []
    return jsonify({"is_recording": is_recording})

@app.route('/download_csv')
def download_csv():
    df = pd.DataFrame(recording_session)
    df.to_csv('ev_session.csv', index=False)
    return send_file('ev_session.csv', as_attachment=True)

# --- AI TRAINING & PREDICTION ---
@app.route('/upload', methods=['POST'])
def upload_file():
    file = request.files['file']
    user_id = str(uuid.uuid4())
    path = os.path.join('uploads', f"{user_id}.csv")
    file.save(path)
    df = pd.read_csv(path)
    return jsonify({"user_id": user_id, "headers": df.columns.tolist()})

@app.route('/train', methods=['POST'])
def train():
    try:
        data = request.json
        uid, mapping, m_type = data['user_id'], data['mapping'], data['model_type']
        df = pd.read_csv(os.path.join('uploads', f"{uid}.csv"))
        
        X = df[[mapping['voltage'], mapping['current'], mapping['temp']]].values
        y = df[mapping['soc']].values
        time_data = df[mapping['time']].values
        
        duration_df = pd.DataFrame({"soc": y, "actual_time": time_data})
        joblib.dump(duration_df, f"models/{uid}_duration.pkl")

        if m_type == 'fast':
            model = xgb.XGBRegressor(n_estimators=100)
            model.fit(X, y)
            model.save_model(f"models/{uid}_fast.json")
        else:
            scaler_X, scaler_y = MinMaxScaler(), MinMaxScaler()
            X_s, y_s = scaler_X.fit_transform(X), scaler_y.fit_transform(y.reshape(-1, 1))
            joblib.dump(scaler_X, f"models/{uid}_scalerX.pkl")
            joblib.dump(scaler_y, f"models/{uid}_scalerY.pkl")
            model = Sequential([GRU(32, input_shape=(1, 3)), Dense(1)])
            model.compile(optimizer='adam', loss='mse')
            model.fit(X_s.reshape(-1, 1, 3), y_s, epochs=10, verbose=0)
            model.save(f"models/{uid}_pro.h5")

        step = max(1, len(y) // 50)
        return jsonify({
            "status": "success",
            "graph_data": {"time": list(range(len(y[::step]))), "soc": y[::step].tolist()}
        })
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        uid, m_type = data['user_id'], data.get('model_type', 'fast')
        if data.get('soc'):
            pred_soc = float(data['soc'])
        else:
            v, i, t = float(data['voltage']), float(data['current']), float(data['temp'])
            if m_type == 'fast':
                model = xgb.XGBRegressor(); model.load_model(f"models/{uid}_fast.json")
                pred_soc = model.predict(np.array([[v, i, t]]))[0]
            else:
                model = tf.keras.models.load_model(f"models/{uid}_pro.h5")
                sX, sY = joblib.load(f"models/{uid}_scalerX.pkl"), joblib.load(f"models/{uid}_scalerY.pkl")
                X_val = sX.transform(np.array([[v, i, t]]))
                pred_soc = sY.inverse_transform(model.predict(X_val.reshape(1,1,3)))[0][0]

        duration_map = joblib.load(f"models/{uid}_duration.pkl")
        closest_idx = (duration_map['soc'] - pred_soc).abs().idxmin()
        time_rem = len(duration_map) - closest_idx
        return jsonify({"soc": round(float(pred_soc), 1), "time_remaining_min": round(time_rem/60, 1)})
    except Exception as e: return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000, debug=True, host='0.0.0.0')