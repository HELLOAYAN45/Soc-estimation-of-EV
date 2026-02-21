#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <WebServer.h> 

// --- Wi-Fi & Server Settings ---
const char* ssid = "Uchiha 4g";
const char* password = "20042004";
const char* serverName = "http://192.168.29.46:5000/live_data";

// --- Pin Definitions ---
const int voltagePin = 34; 
const int currentPin = 35; 
#define DHTPIN 4   
#define DHTTYPE DHT22  

DHT dht(DHTPIN, DHTTYPE);

// --- L298N Motor Driver Pins ---
const int ENA = 25; // PWM pin for Motor A
const int IN1 = 26; // Direction 1 for Motor A
const int IN2 = 27; // Direction 2 for Motor A
const int ENB = 14; // PWM pin for Motor B
const int IN3 = 12; // Direction 1 for Motor B
const int IN4 = 13; // Direction 2 for Motor B

// --- PWM Settings ---
const int pwmFreq = 5000;
const int pwmResolution = 8; 

// --- Calibration Constants ---
const float currentDividerMultiplier = 3.136; // Based on 4.7k / 2.2k resistors
const float acs712Sensitivity = 0.066;        // 66mV per Amp for 30A module
const float voltageCalibration = 1.13;        // Adjust this if voltage is slightly off
const float currentNullPoint = 1.98;          // The resting voltage of ACS712 after divider 

// --- Web Server on Port 80 ---
WebServer server(80);

// --- Non-blocking Timer Variables ---
unsigned long previousMillis = 0;
const long dataInterval = 1000; // Send data every 1 second

// --- HTML Web Page for Control UI ---
const char htmlPage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial; text-align: center; margin-top: 50px; background-color: #f4f4f9; }
    h2 { color: #333; }
    .btn { padding: 15px 25px; font-size: 24px; margin: 10px; cursor: pointer; border-radius: 8px; border: none; background-color: #3b82f6; color: white; user-select: none;}
    .btn:active { background-color: #1e40af; }
    .btn-stop { background-color: #ef4444; }
    .btn-stop:active { background-color: #991b1b; }
    .slider { width: 80%; max-width: 300px; margin: 20px 0; }
    table { margin: 0 auto; }
  </style>
</head>
<body>
  <h2>ESP32 Car Control</h2>
  <p>Speed: <span id="speedVal">128</span></p>
  <input type="range" min="0" max="255" value="128" class="slider" id="speedSlider" oninput="updateSpeed(this.value)">
  
  <table>
    <tr>
      <td></td>
      <td><button class="btn" onmousedown="sendCommand('F')" onmouseup="sendCommand('S')" ontouchstart="sendCommand('F')" ontouchend="sendCommand('S')">▲</button></td>
      <td></td>
    </tr>
    <tr>
      <td><button class="btn" onmousedown="sendCommand('L')" onmouseup="sendCommand('S')" ontouchstart="sendCommand('L')" ontouchend="sendCommand('S')">◄</button></td>
      <td><button class="btn btn-stop" onmousedown="sendCommand('S')" ontouchstart="sendCommand('S')">STOP</button></td>
      <td><button class="btn" onmousedown="sendCommand('R')" onmouseup="sendCommand('S')" ontouchstart="sendCommand('R')" ontouchend="sendCommand('S')">►</button></td>
    </tr>
    <tr>
      <td></td>
      <td><button class="btn" onmousedown="sendCommand('B')" onmouseup="sendCommand('S')" ontouchstart="sendCommand('B')" ontouchend="sendCommand('S')">▼</button></td>
      <td></td>
    </tr>
  </table>

  <script>
    var currentSpeed = 128;
    function updateSpeed(val) {
      currentSpeed = val;
      document.getElementById('speedVal').innerText = val;
    }
    function sendCommand(direction) {
      fetch(`/control?dir=${direction}&speed=${currentSpeed}`);
    }
  </script>
</body>
</html>
)rawliteral";

// --- Function to handle incoming web commands ---
void handleControl() {
  if (server.hasArg("dir") && server.hasArg("speed")) {
    String dir = server.arg("dir");
    int speed = server.arg("speed").toInt();

    // Set Motor Speeds (Using Pins ENA/ENB directly)
    ledcWrite(ENA, speed);
    ledcWrite(ENB, speed);

    if (dir == "F") { 
      digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
      digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
    } 
    else if (dir == "B") { 
      digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
      digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
    } 
    else if (dir == "L") { 
      digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
      digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
    } 
    else if (dir == "R") { 
      digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
      digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
    } 
    else if (dir == "S") { 
      digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
      digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
    }
    server.send(200, "text/plain", "Command Received");
  } else {
    server.send(400, "text/plain", "Bad Request");
  }
}

void setup() {
  Serial.begin(115200);
  dht.begin();

  // --- L298N Pin Setup ---
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  
  // NEW PWM Setup for ESP32 3.0+ (No Channels used)
  ledcAttach(ENA, pwmFreq, pwmResolution);
  ledcAttach(ENB, pwmFreq, pwmResolution);
  
  // Make sure motors are off at boot
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
  ledcWrite(ENA, 0); ledcWrite(ENB, 0);

  WiFi.begin(ssid, password);
  Serial.println("Connecting to Wi-Fi...");
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to Wi-Fi!");
  Serial.print("Local IP: ");
  Serial.println(WiFi.localIP()); 

  server.on("/", []() {
    server.send(200, "text/html", htmlPage);
  });
  server.on("/control", []() { handleControl(); });
  server.begin();
}

void loop() {
  server.handleClient(); // Listen for control commands

  unsigned long currentMillis = millis();

  // Send telemetry data every 1 second
  if (currentMillis - previousMillis >= dataInterval) {
    previousMillis = currentMillis;

    if(WiFi.status() == WL_CONNECTED) {
      float avgVolts = 0;
      float avgAmps = 0;
      int samples = 10;

      // Take 10 quick samples to smooth out motor noise
      for(int i = 0; i < samples; i++) {
        // Voltage calculation
        int rawV = analogRead(voltagePin);
        avgVolts += ((rawV / 4095.0) * 3.3) * 5.0 * voltageCalibration;
        
        // Current calculation
        int rawC = analogRead(currentPin);
        float cPinV = (rawC / 4095.0) * 3.3;
        avgAmps += ((cPinV * currentDividerMultiplier) - currentNullPoint) / acs712Sensitivity;
        delay(10); 
      }

      float finalVoltage = avgVolts / samples;
      float finalCurrent = avgAmps / samples;
      
      // FIXED DEADBAND: Lowered from 4.0A to 0.2A to let real motor data through!
      // if(finalCurrent < 0.20 && finalCurrent > -0.20) {
      //   finalCurrent = 0.00; 
      // } else {
      finalCurrent = abs(finalCurrent); // Ensure amps always show positive
      // }

      // Read Temperature
      float batteryTemp = dht.readTemperature();
      if (isnan(batteryTemp)) batteryTemp = 25.0; 

      // Send to Python Ground Station
      HTTPClient http;
      http.begin(serverName);
      http.addHeader("Content-Type", "application/json");

      // FIXED FORMATTING: Force exact decimal places as a String payload
      String jsonPayload = "{\"voltage\":" + String(finalVoltage, 2) + 
                           ",\"current\":" + String(finalCurrent, 2) + 
                           ",\"temp\":" + String(batteryTemp, 1) + "}";

      http.POST(jsonPayload);
      http.end();
    }
  }
}