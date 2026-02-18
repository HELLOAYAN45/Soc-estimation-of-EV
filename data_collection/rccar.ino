/*
 * FINAL CALIBRATED LOGGER
 * Hardware:
 * - Voltage Sensor (0-25V) on A1
 * - ACS712 30A Current Sensor on A0
 * - DHT22 Temp Sensor on D2
 */

#include "DHT.h"

// --- PINS ---
#define CURRENT_PIN A0
#define VOLTAGE_PIN A1
#define DHTPIN 2
#define DHTTYPE DHT22

// --- VOLTAGE CALIBRATION (0-25V Module) ---
// Calibrated from your 11.2V vs 12.7V issue
float voltage_ref = 4.41; 
float divider_ratio = 5.0; 

// --- CURRENT CALIBRATION (ACS712 30A) ---
// Sensitivity for 30A module is 0.066 V/A
float sensitivity = 0.066; 

// Calibrated Zero Point (Midpoint of 0-1023)
// Ideally 512. If it reads 0.2A when unplugged, change to 511 or 510.
int zero_point = 512; 

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(9600);
  dht.begin();
  delay(1000);
  Serial.println("DATA_START"); 
}

void loop() {
  // 1. Read Voltage (Average 20 samples)
  float rawV = 0;
  for(int i=0; i<20; i++) { rawV += analogRead(VOLTAGE_PIN); delay(1); }
  rawV /= 20.0;
  float voltage = (rawV / 1023.0) * voltage_ref * divider_ratio;

  // 2. Read Current (Average 50 samples for stability)
  float rawI = 0;
  for(int i=0; i<50; i++) { rawI += analogRead(CURRENT_PIN); delay(1); }
  rawI /= 50.0;
  
  // Calculate Voltage at Pin A0 (0-5V)
  float voltage_at_pin = (rawI / 1023.0) * 5.0;
  
  // Calculate Amps: (PinVoltage - 2.5V) / Sensitivity
  float current = (voltage_at_pin - 2.5) / sensitivity;

  // --- NOISE FILTER (Dead Zone) ---
  // The 30A sensor is noisy. If current is very small (< 0.15A), ignore it.
  if (abs(current) < 0.15) {
    current = 0.00;
  }

  // 3. Read Temp
  float temp = dht.readTemperature();
  if (isnan(temp)) temp = 25.0; 

  // 4. Output
  Serial.print(millis() / 1000.0);
  Serial.print(",");
  Serial.print(voltage, 2);
  Serial.print(",");
  Serial.print(current, 2);
  Serial.print(",");
  Serial.println(temp, 1);

  delay(1000);
}