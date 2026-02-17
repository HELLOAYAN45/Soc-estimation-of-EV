import serial
import csv
import time
import os
import pandas as pd

# --- CONFIGURATION ---
SERIAL_PORT = 'COM3'   # <--- DOUBLE CHECK THIS! (Look in Device Manager)
BAUD_RATE = 9600       # Must match Arduino
FILENAME = 'battery_drain_test.csv'
TEMP_FILENAME = 'raw_data_temp.csv'

def record_data():
    print(f"--- BATTERY MONITORING SYSTEM ---")
    print(f"✅ Sensors: Voltage (0-25V), Current (ACS712-30A), Temp (DHT22)")
    print(f"📂 Saving live data to: {TEMP_FILENAME}")
    print("👉 Press Ctrl+C when battery is empty (9.0V) to STOP.\n")

    while True:
        try:
            # 1. CONNECT
            print(f"🔌 Connecting to {SERIAL_PORT}...")
            ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=3)
            print("✅ Connected! Waiting for data stream...")
            
            # Open file in APPEND mode ('a') - Safe from crashes
            with open(TEMP_FILENAME, 'a', newline='') as f:
                writer = csv.writer(f)
                
                # Write header if new file
                if os.stat(TEMP_FILENAME).st_size == 0:
                    writer.writerow(['Time (s)', 'Voltage (V)', 'Current (A)', 'Temp (C)'])

                ser.reset_input_buffer()

                # 2. LOGGING LOOP
                while True:
                    if ser.in_waiting > 0:
                        try:
                            # Read line
                            line = ser.readline().decode('utf-8', errors='ignore').strip()
                            
                            # Filter garbage
                            if not line or "DATA_START" in line: continue
                            
                            parts = line.split(',')
                            if len(parts) >= 4: # Must have Time, Volts, Amps, Temp
                                # Save to disk
                                writer.writerow(parts)
                                f.flush() 
                                
                                # Show nicely formatted output
                                t, v, c, temp = parts[:4]
                                print(f"⏱️ {t}s  |  🔋 {v} V  |  ⚡ {c} A  |  🌡️ {temp} °C")
                                
                        except Exception as e:
                            print(f"⚠️ Glitch: {e}")
                            continue
                    
                    time.sleep(0.01)

        except serial.SerialException:
            print(f"❌ Connection Lost! Retrying in 2 seconds...")
            time.sleep(2)
            
        except KeyboardInterrupt:
            print("\n🛑 STOPPING TEST...")
            if 'ser' in locals() and ser.is_open: ser.close()
            calculate_soc() # Final Step
            break

def calculate_soc():
    print("\n🧠 Calculating Battery Health & SoC...")
    if not os.path.exists(TEMP_FILENAME):
        print("❌ No data found.")
        return

    try:
        # Load data
        df = pd.read_csv(TEMP_FILENAME, on_bad_lines='skip')
        
        if len(df) < 10:
            print("⚠️ Not enough data points.")
            return

        # Sort
        df = df.sort_values(by='Time (s)')
        
        # Calculate Duration
        min_time = df['Time (s)'].min()
        max_time = df['Time (s)'].max()
        duration = max_time - min_time
        
        print(f"⏱️ Total Test Duration: {duration/60:.1f} minutes")

        if duration <= 0:
            print("⚠️ Duration is zero.")
            return

        # Calculate SoC (Linear: Start=100%, End=0%)
        df['SoC'] = 100 - ((df['Time (s)'] - min_time) / duration * 100)
        df['SoC'] = df['SoC'].round(1).clip(0, 100)

        # Save Final File
        df.to_csv(FILENAME, index=False)
        print(f"✅ SUCCESS! Saved '{FILENAME}' with {len(df)} rows.")
        print("Preview:")
        print(df.tail())

    except Exception as e:
        print(f"❌ Error during calculation: {e}")

if __name__ == "__main__":
    record_data()