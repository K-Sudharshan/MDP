/**
 * ============================================================================
 * REFERENCE FIRMWARE — NOT VERIFIED AGAINST PHYSICAL HARDWARE
 * ============================================================================
 * 
 * Hardware Milestone: Basic RC Movement with Safety Watchdog Reference
 * 
 * WARNING TO INTEGRATION TEAM:
 * 1. PIN MAPPINGS BELOW (GPIO 18, 19, 22, 23, 25) ARE PLACEHOLDERS ONLY.
 *    They have NOT been verified against the physical firefighting robot.
 * 2. Hardware team must supply actual ESP32 pinouts and motor driver model.
 * 3. Driver Enable Pins:
 *    - If using L298N: ENA and ENB jumpers must be fitted (or connected to PWM pins).
 *    - If using TB6612: STBY (standby) pin must be pulled HIGH for motors to engage.
 * 4. Safety Watchdog Guarantee:
 *    - Automatically cuts power to motors if heartbeat ceases for > 500ms.
 *    - Protects against runaway robot if browser tab closes, phone sleeps, or Wi-Fi drops.
 *    - Limitation: loop() is single-threaded; do NOT introduce long blocking delay()
 *      calls that would delay loop() execution.
 * 5. Water pump is strictly kept DISABLED (LOW) for basic movement testing.
 */

#include <WiFi.h>
#include <WebServer.h>

// ==========================================
// 1. WI-FI CONFIGURATION (PLACEHOLDER)
// ==========================================
#define USE_ACCESS_POINT true // Set true to create AP; false to connect to router

// SoftAP settings (Default reference)
const char* AP_SSID = "ESP32-FireRobot";
const char* AP_PASS = "12345678"; // Min 8 chars, or NULL for open network

// Station (router) settings (if USE_ACCESS_POINT is false)
const char* STA_SSID = "Your_WiFi_Name";
const char* STA_PASS = "Your_WiFi_Password";

// ==========================================
// 2. HARDWARE PIN DEFINITIONS (UNVERIFIED PLACEHOLDERS)
// Modify according to hardware team's confirmed wiring!
// ==========================================
#define PIN_MOTOR_LEFT_FWD   18  // Left Motor Forward (IN1 - PLACEHOLDER)
#define PIN_MOTOR_LEFT_REV   19  // Left Motor Reverse (IN2 - PLACEHOLDER)
#define PIN_MOTOR_RIGHT_FWD  22  // Right Motor Forward (IN3 - PLACEHOLDER)
#define PIN_MOTOR_RIGHT_REV  23  // Right Motor Reverse (IN4 - PLACEHOLDER)

// Safety: Firefighting pump pin (kept DISABLED for basic movement milestone)
#define PIN_FIRE_PUMP        25  // Pump Relay/MOSFET (PLACEHOLDER)

// ==========================================
// 3. WATCHDOG SAFETY SETTINGS
// ==========================================
#define WATCHDOG_TIMEOUT_MS  500 // Stop motors if no command received within 500ms
unsigned long lastCommandMillis = 0;
bool isMoving = false;

WebServer server(80);

// ==========================================
// 4. MOTOR CONTROL FUNCTIONS
// ==========================================
void stopMotors() {
  digitalWrite(PIN_MOTOR_LEFT_FWD, LOW);
  digitalWrite(PIN_MOTOR_LEFT_REV, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_FWD, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_REV, LOW);
  isMoving = false;
}

void moveForward() {
  digitalWrite(PIN_MOTOR_LEFT_FWD, HIGH);
  digitalWrite(PIN_MOTOR_LEFT_REV, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_FWD, HIGH);
  digitalWrite(PIN_MOTOR_RIGHT_REV, LOW);
  isMoving = true;
  lastCommandMillis = millis();
}

void moveBackward() {
  digitalWrite(PIN_MOTOR_LEFT_FWD, LOW);
  digitalWrite(PIN_MOTOR_LEFT_REV, HIGH);
  digitalWrite(PIN_MOTOR_RIGHT_FWD, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_REV, HIGH);
  isMoving = true;
  lastCommandMillis = millis();
}

void turnLeft() {
  digitalWrite(PIN_MOTOR_LEFT_FWD, LOW);
  digitalWrite(PIN_MOTOR_LEFT_REV, HIGH);
  digitalWrite(PIN_MOTOR_RIGHT_FWD, HIGH);
  digitalWrite(PIN_MOTOR_RIGHT_REV, LOW);
  isMoving = true;
  lastCommandMillis = millis();
}

void turnRight() {
  digitalWrite(PIN_MOTOR_LEFT_FWD, HIGH);
  digitalWrite(PIN_MOTOR_LEFT_REV, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_FWD, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_REV, HIGH);
  isMoving = true;
  lastCommandMillis = millis();
}

// ==========================================
// 5. HTTP SERVER HANDLERS & CORS
// ==========================================
void setCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

void handleOptions() {
  setCorsHeaders();
  server.send(204);
}

void handleStatus() {
  setCorsHeaders();
  String json = "{\"status\":\"ok\",\"robot\":\"esp32_firefighting\",\"moving\":" + String(isMoving ? "true" : "false") + "}";
  server.send(200, "application/json", json);
}

void handleMove() {
  setCorsHeaders();
  String dir = "";

  if (server.hasArg("dir")) {
    dir = server.arg("dir");
  } else if (server.hasArg("plain")) {
    // Basic JSON payload fallback
    String body = server.arg("plain");
    if (body.indexOf("forward") >= 0) dir = "forward";
    else if (body.indexOf("backward") >= 0) dir = "backward";
    else if (body.indexOf("left") >= 0) dir = "left";
    else if (body.indexOf("right") >= 0) dir = "right";
  }

  dir.toLowerCase();

  if (dir == "forward") {
    moveForward();
    server.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"forward\"}");
  } else if (dir == "backward") {
    moveBackward();
    server.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"backward\"}");
  } else if (dir == "left") {
    turnLeft();
    server.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"left\"}");
  } else if (dir == "right") {
    turnRight();
    server.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"right\"}");
  } else {
    stopMotors();
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"invalid_direction\"}");
  }
}

void handleStop() {
  setCorsHeaders();
  stopMotors();
  server.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"stop\"}");
}

// ==========================================
// 6. SETUP & MAIN LOOP
// ==========================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n--- ESP32 Firefighting Robot RC Firmware Starting ---");

  // Motor pin setup
  pinMode(PIN_MOTOR_LEFT_FWD, OUTPUT);
  pinMode(PIN_MOTOR_LEFT_REV, OUTPUT);
  pinMode(PIN_MOTOR_RIGHT_FWD, OUTPUT);
  pinMode(PIN_MOTOR_RIGHT_REV, OUTPUT);
  stopMotors();

  // Safety: Ensure water pump pin is strictly disabled
  pinMode(PIN_FIRE_PUMP, OUTPUT);
  digitalWrite(PIN_FIRE_PUMP, LOW);

  // Setup Wi-Fi
  if (USE_ACCESS_POINT) {
    Serial.println("Configuring SoftAP...");
    WiFi.softAP(AP_SSID, AP_PASS);
    IPAddress ip = WiFi.softAPIP();
    Serial.print("Access Point Ready. Connect to SSID: ");
    Serial.println(AP_SSID);
    Serial.print("ESP32 IP Address: ");
    Serial.println(ip);
  } else {
    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(STA_SSID);
    WiFi.begin(STA_SSID, STA_PASS);
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }
    Serial.println("\nConnected to Wi-Fi!");
    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  }

  // Configure HTTP Routes
  server.on("/status", HTTP_OPTIONS, handleOptions);
  server.on("/status", HTTP_GET, handleStatus);

  server.on("/move", HTTP_OPTIONS, handleOptions);
  server.on("/move", HTTP_GET, handleMove);
  server.on("/move", HTTP_POST, handleMove);

  server.on("/stop", HTTP_OPTIONS, handleOptions);
  server.on("/stop", HTTP_GET, handleStop);
  server.on("/stop", HTTP_POST, handleStop);

  server.begin();
  Serial.println("HTTP Server started on port 80. Waiting for RC commands...");
}

void loop() {
  server.handleClient();

  // HARDWARE SAFETY WATCHDOG:
  // If the robot is currently moving and no command has arrived for > WATCHDOG_TIMEOUT_MS,
  // automatically stop the motors.
  if (isMoving && (millis() - lastCommandMillis > WATCHDOG_TIMEOUT_MS)) {
    stopMotors();
    Serial.println("[WATCHDOG] Movement command timeout! Motors stopped for safety.");
  }
}
