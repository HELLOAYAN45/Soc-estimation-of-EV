import os
import uuid
import pandas as pd
import numpy as np
import joblib
import xgboost as xgb
import tensorflow as tf
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import GRU, Dense

# --- SERVE STATIC FILES FROM CURRENT FOLDER ---
app = Flask(__name__, static_folder='.')
CORS(app)

os.makedirs('uploads', exist_ok=True)
os.makedirs('models', exist_ok=True)

# --- 1. SERVE THE HTML FILE ---
@app.route('/')
def index():
    return send_from_directory('.', 'analysis.html')

@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

# --- 2. UPLOAD ---
@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    try:
        user_id = str(uuid.uuid4())
        file_path = os.path.join('uploads', f"{user_id}.csv")
        file.save(file_path)
        df = pd.read_csv(file_path)
        return jsonify({"status": "success", "user_id": user_id, "headers": df.columns.tolist()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- 3. TRAIN (With Graph Data) ---
@app.route('/train', methods=['POST'])
def train_model():
    data = request.json
    user_id = data.get('user_id')
    mapping = data.get('mapping') 
    model_type = data.get('model_type', 'fast')

    csv_path = os.path.join('uploads', f"{user_id}.csv")
    if not os.path.exists(csv_path):
        return jsonify({"error": "File missing"}), 404

    try:
        df = pd.read_csv(csv_path)
        
        # Map Columns
        train_df = pd.DataFrame()
        train_df['V'] = df[mapping['voltage']]
        train_df['I'] = df[mapping['current']]
        train_df['T'] = df[mapping['temp']]
        train_df['SoC'] = df[mapping['soc']]
        train_df['Time'] = df[mapping['time']]
        
        # Clean Data
        train_df = train_df[train_df['V'] > 0]
        
        # Create Duration Map
        max_time = train_df['Time'].max()
        train_df['Remaining_Time'] = max_time - train_df['Time']
        duration_map = train_df[['SoC', 'Remaining_Time']].sort_values('SoC').reset_index(drop=True)
        joblib.dump(duration_map, f"models/{user_id}_duration.pkl")

        # Train AI Model
        X = train_df[['V', 'I', 'T']].values
        y = train_df['SoC'].values
        model_path = f"models/{user_id}_{model_type}"
        
        if model_type == 'fast':
            model = xgb.XGBRegressor(objective='reg:squarederror', n_estimators=100)
            model.fit(X, y)
            model.save_model(f"{model_path}.json")
            
        elif model_type == 'pro':
            scaler_X = MinMaxScaler()
            scaler_y = MinMaxScaler()
            X_scaled = scaler_X.fit_transform(X)
            y_scaled = scaler_y.fit_transform(y.reshape(-1, 1))
            joblib.dump(scaler_X, f"{model_path}_scalerX.pkl")
            joblib.dump(scaler_y, f"{model_path}_scalerY.pkl")

            time_steps = 10
            Xs, ys = [], []
            for i in range(len(X) - time_steps):
                Xs.append(X_scaled[i:(i + time_steps)])
                ys.append(y_scaled[i + time_steps])

            if(len(Xs) > 0):
                model = Sequential()
                model.add(GRU(50, activation='relu', input_shape=(time_steps, 3)))
                model.add(Dense(1))
                model.compile(optimizer='adam', loss='mse')
                model.fit(np.array(Xs), np.array(ys), epochs=10, batch_size=32, verbose=0)
                model.save(f"{model_path}.h5")

        # Highlights
        highlights = {}
        for target in [100, 50, 25, 5]:
            closest_idx = (duration_map['SoC'] - target).abs().idxmin()
            rem_seconds = duration_map.iloc[closest_idx]['Remaining_Time']
            highlights[f"{target}%"] = f"{round(rem_seconds/60, 1)} min"

        # Graph Data (Optimize: send 1 point every ~500 rows for speed)
        step = max(1, len(train_df) // 500)
        graph_data = {
            "time": train_df['Time'].iloc[::step].tolist(),
            "soc": train_df['SoC'].iloc[::step].tolist()
        }

        return jsonify({
            "status": "success", 
            "highlights": highlights,
            "max_voltage": float(train_df['V'].max()),
            "graph_data": graph_data
        })

    except Exception as e:
        print(f"Train Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- 4. PREDICT (With Fix for Pro Model + Direct SoC) ---
# --- 4. PREDICT ---
@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        user_id = data.get('user_id')
        model_type = data.get('model_type', 'fast')
        
        # Inputs
        direct_soc = data.get('soc') 
        v = float(data.get('voltage', 0))
        i = float(data.get('current', 0.5))
        t = float(data.get('temp', 25.0))

        model_path = f"models/{user_id}_{model_type}"
        predicted_soc = 0.0
        engine_used = ""

        # A. DIRECT SOC MODE
        if direct_soc is not None and str(direct_soc).strip() != "":
            predicted_soc = float(direct_soc)
            engine_used = "Direct Input"

        # B. AI PREDICTION MODE
        else:
            if model_type == 'fast':
                if not os.path.exists(f"{model_path}.json"):
                     return jsonify({"error": "Fast model not trained yet"}), 400
                model = xgb.XGBRegressor()
                model.load_model(f"{model_path}.json")
                pred = model.predict(np.array([[v, i, t]]))
                predicted_soc = float(pred[0])
                
            elif model_type == 'pro':
                if not os.path.exists(f"{model_path}.h5"):
                     return jsonify({"error": "Pro model not trained yet. Click Train!"}), 400
                
                try:
                    # Load Pro Resources
                    model = tf.keras.models.load_model(f"{model_path}.h5", compile=False)
                    scaler_X = joblib.load(f"{model_path}_scalerX.pkl")
                    scaler_y = joblib.load(f"{model_path}_scalerY.pkl")
                    
                    # Prepare Input
                    input_scaled = scaler_X.transform(np.array([[v, i, t]]))
                    # Reshape: (1, 3) -> (1, 10, 3)
                    input_seq = np.repeat(input_scaled, 10, axis=0).reshape(1, 10, 3)
                    
                    # Predict
                    pred_scaled = model.predict(input_seq, verbose=0)
                    pred_raw = scaler_y.inverse_transform(pred_scaled)
                    
                    predicted_soc = float(pred_raw[0][0])
                except Exception as pro_error:
                    print(f"PRO MODEL ERROR: {pro_error}")
                    return jsonify({"error": f"Pro Model Failed: {str(pro_error)}"}), 500
                
            engine_used = f"{model_type.upper()} AI Model"

        # C. CALCULATE DURATION
        duration_map = joblib.load(f"models/{user_id}_duration.pkl")
        
        # Handle case where predicted SoC is outside 0-100 range
        predicted_soc = max(0, min(100, predicted_soc))
        
        closest_idx = (duration_map['SoC'] - predicted_soc).abs().idxmin()
        time_remaining = float(duration_map.iloc[closest_idx]['Remaining_Time'])

        return jsonify({
            "soc": round(predicted_soc, 2),
            "time_remaining_min": round(time_remaining / 60, 2),
            "engine": engine_used
        })

    except Exception as e:
        print(f"❌ General Prediction Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # use_reloader=False prevents restart loop on upload
    app.run(port=5000, debug=True, host='0.0.0.0', use_reloader=False)