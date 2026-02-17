from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
import tensorflow as tf
import os

app = Flask(__name__)
CORS(app) # Allows website to talk to Python

# --- LOAD MODELS ---
fast_model = joblib.load('fast_model.pkl')
pro_model = tf.keras.models.load_model('pro_model.h5')
scaler_X = joblib.load('scaler_X.pkl')
scaler_y = joblib.load('scaler_y.pkl')

def apply_voltage_correction(v_raw):
    # Your specific correction math
    return (v_raw * 0.8301) + 2.7903

@app.route('/predict', methods=['POST'])
def predict():
    data = request.json
    v_raw = float(data.get('voltage'))
    current = float(data.get('current', 0.6))
    temp = float(data.get('temp', 25.0))
    model_type = data.get('model_type', 'fast')

    # 1. Correct the Voltage
    v_real = apply_voltage_correction(v_raw)

    if model_type == 'fast':
        # Fast Model (Random Forest)
        prediction = fast_model.predict([[v_real, current, temp]])
        soc = prediction[0]
        # For duration, we use a simple linear estimate in Fast Mode
        time_rem_min = (soc / 100) * 45 # Assuming 45 min total
    else:
        # Pro Model (LSTM)
        # Deep learning needs a sequence. We simulate a steady state of 10 points.
        input_data = np.array([[v_real, current, temp]] * 10) 
        scaled_input = scaler_X.transform(input_data)
        scaled_input = scaled_input.reshape(1, 10, 3)
        
        raw_pred = pro_model.predict(scaled_input)
        real_pred = scaler_y.inverse_transform(raw_pred)
        
        soc = real_pred[0][0]
        time_rem_min = real_pred[0][1] / 60

    return jsonify({
        'soc': round(float(soc), 1),
        'time_remaining_min': round(float(time_rem_min), 1),
        'corrected_voltage': round(v_real, 2)
    })

if __name__ == '__main__':
    app.run(port=5000, debug=True)