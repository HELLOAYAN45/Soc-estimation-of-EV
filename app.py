import sys
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from sklearn.ensemble import RandomForestRegressor

app = Flask(__name__)
CORS(app)

# Global variables (Empty at start)
model_soc = None
model_time = None

@app.route('/upload', methods=['POST'])
def upload_and_train():
    """Receives CSV from website, trains AI, and gets ready."""
    global model_soc, model_time

    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    try:
        # 1. Read the uploaded CSV directly
        print("Received CSV. Training AI Model...")
        df = pd.read_csv(file)

        # 2. Process Data (Same logic as before)
        max_time = df['Time (s)'].max()
        df['Time_Remaining'] = (max_time - df['Time (s)']) / 60.0
        
        # Calibrate SoC (11.34V -> 100%, 9.0V -> 0%)
        df['SoC'] = ((df['Voltage (V)'] - 9.0) / (11.34 - 9.0)) * 100
        df['SoC'] = df['SoC'].clip(0, 100)

        # Create Synthetic Low Load Data
        df_low = df.copy()
        df_low['Current (A)'] = 0.2
        df_low['Voltage (V)'] = df['Voltage (V)'] + 0.2
        df_low['Time_Remaining'] = df['Time_Remaining'] * 3.0
        
        df_final = pd.concat([df, df_low])

        # 3. Train Models
        X = df_final[['Voltage (V)', 'Current (A)']]
        y_soc = df_final['SoC']
        y_time = df_final['Time_Remaining']

        model_soc = RandomForestRegressor(n_estimators=100).fit(X, y_soc)
        model_time = RandomForestRegressor(n_estimators=100).fit(X, y_time)

        print("Training Complete!")
        return jsonify({"status": "AI Trained Successfully!", "rows": len(df)})

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/predict', methods=['POST'])
def predict():
    if model_soc is None:
        return jsonify({"error": "Please upload a CSV file first!"}), 400
    
    try:
        data = request.json
        voltage = float(data.get('voltage'))
        current = float(data.get('current', 0.6))
        
        features = pd.DataFrame([[voltage, current]], columns=['Voltage (V)', 'Current (A)'])
        pred_soc = model_soc.predict(features)[0]
        pred_time = model_time.predict(features)[0]
        
        return jsonify({
            "soc": round(pred_soc, 1),
            "time_remaining_min": round(pred_time, 1)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = 5000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    print(f"Server waiting for CSV upload on port {port}...")
    app.run(debug=True, port=port)