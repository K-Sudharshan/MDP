# Hardware Integration Guide for ESP32 Firefighting Robot

This practical guide is written specifically for the **hardware team** to integrate the physical ESP32 and motor driver with this Web RC Controller.

All communication logic is centralized in **two files**:
- [`config.js`](file:///c:/Users/durga/OneDrive/Desktop/MDP/config.js): Address, ports, endpoints, and command mappings.
- [`esp32-client.js`](file:///c:/Users/durga/OneDrive/Desktop/MDP/esp32-client.js): Transport implementation (HTTP fetch and WebSocket).

The UI components in [`index.html`](file:///c:/Users/durga/OneDrive/Desktop/MDP/index.html) and [`controller.js`](file:///c:/Users/durga/OneDrive/Desktop/MDP/controller.js) **do not need any changes**.

---

## 1. Where to Enter the Actual ESP32 Address

You can configure the ESP32 IP address in two ways:

### Option A: In the Web Interface (No code changes)
1. Open the controller in your browser at `http://localhost:3000`.
2. Click the **gear icon (⚙️)** in the top-right corner to open the Settings drawer.
3. Enter your robot's IP address (e.g. `192.168.4.1` for SoftAP mode, or `192.168.1.125` for router Wi-Fi).
4. Click **Save & Apply**. The address is saved to browser `localStorage` and persists across reloads.

### Option B: In Code (Permanent project default)
Open [`config.js`](file:///c:/Users/durga/OneDrive/Desktop/MDP/config.js) and update:
```javascript
const DEFAULT_CONFIG = {
  robotIp: '192.168.4.1', // Change to your confirmed ESP32 IP
  protocol: 'http',       // 'http' or 'ws'
  httpPort: 80,           // Change if using non-standard port
  wsPort: 81              // Change if using WebSocket
};
```

---

## 2. Where to Configure Command Routes and Payloads

Open [`config.js`](file:///c:/Users/durga/OneDrive/Desktop/MDP/config.js#L27-L45) to adjust routes and formats:

### A. Endpoint Routes
```javascript
endpoints: {
  status: '/status',  // Health-check / ping route (GET)
  move: '/move',      // Movement command route (GET or POST)
  stop: '/stop'       // Immediate motor stop route (GET or POST)
}
```

### B. Payload Format (`httpMode`)
- `'query'` (Default, simplest for ESP32 `WebServer`):
  - Sends: `GET /move?dir=forward`
  - Sends: `GET /stop`
- `'json'`:
  - Sends: `POST /move` with body `{"dir":"forward"}`
  - Sends: `POST /stop` with body `{"cmd":"stop"}`

### C. Command String Mapping
If your firmware expects single-character codes or uppercase tokens, update the mappings in [`config.js`](file:///c:/Users/durga/OneDrive/Desktop/MDP/config.js#L40-L46):
```javascript
commands: {
  FORWARD: 'forward',   // e.g. change to 'F' or 'FORWARD'
  BACKWARD: 'backward', // e.g. change to 'B' or 'BACKWARD'
  LEFT: 'left',         // e.g. change to 'L' or 'LEFT'
  RIGHT: 'right',       // e.g. change to 'R' or 'RIGHT'
  STOP: 'stop'          // e.g. change to 'S' or 'STOP'
}
```

---

## 3. What Response the Health Check Expects

When the controller opens, and periodically while idle, it performs a health-check request to `GET /status`.

### Expected HTTP Response:
- **HTTP Status:** `200 OK`
- **Headers Required:**
  ```http
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Accept
  Content-Type: application/json
  ```
- **Body:** Any valid JSON object indicating readiness, for example:
  ```json
  {"status":"ok","robot":"firefighting_rc"}
  ```
- **Simulation Flag Warning:** If the JSON response contains `{"mock":true}` or `{"mode":"simulation"}`, the web UI will trigger `SIMULATION` mode. **Your real ESP32 firmware should NOT include `mock: true`**.

---

## 4. How Each of the Five Movement Commands is Transmitted

The application implements **press-and-hold** controls:

| User Action | Command Transmitted | Frequency |
|---|---|---|
| **Press & hold FORWARD** | `GET /move?dir=forward` | Transmitted immediately on press, then re-sent every **200ms** while held (heartbeat). |
| **Press & hold BACKWARD** | `GET /move?dir=backward` | Transmitted immediately, then every 200ms while held. |
| **Press & hold LEFT** | `GET /move?dir=left` | Transmitted immediately, then every 200ms while held. |
| **Press & hold RIGHT** | `GET /move?dir=right` | Transmitted immediately, then every 200ms while held. |
| **Release button / Blur / Space / Esc** | `GET /stop` | Transmitted **immediately** once. In-flight move requests are aborted. |

*Note: Heartbeat interval (200ms) and request timeout (600ms) can be adjusted in [`config.js`](file:///c:/Users/durga/OneDrive/Desktop/MDP/config.js#L49-L55).*

---

## 5. Firmware Settings Required from the Hardware Team

To work safely with this web controller, the firmware must implement two critical requirements:

### Requirement 1: CORS Headers on All Endpoints
Because modern web browsers enforce the Same-Origin Policy, the ESP32 must send CORS headers on every response (and handle `HTTP OPTIONS` preflight requests).

Example Arduino code:
```cpp
void setCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}
```

### Requirement 2: Hardware Safety Watchdog (500ms Cutoff)
Browser release-to-stop cannot guarantee safety if Wi-Fi disconnects while the robot is moving.

**The firmware MUST independently stop the motors if no command is received for > 500ms:**
```cpp
#define WATCHDOG_TIMEOUT_MS 500
unsigned long lastCommandTime = 0;
bool isMoving = false;

void loop() {
  server.handleClient();

  // Watchdog failsafe:
  if (isMoving && (millis() - lastCommandTime > WATCHDOG_TIMEOUT_MS)) {
    stopMotors();
    Serial.println("[WATCHDOG] Heartbeat lost. Motors stopped.");
  }
}
```

*(See complete working example in [`firmware/esp32_rc_firmware.ino`](file:///c:/Users/durga/OneDrive/Desktop/MDP/firmware/esp32_rc_firmware.ino)).*

---

## 6. How the Hardware Team Can Test the Integration

Follow this safe step-by-step procedure:

1. **Bench Test (Wheels Lifted):** Place the robot on a stand so all drive wheels spin freely in the air.
2. **Flash Firmware:** Flash [`firmware/esp32_rc_firmware.ino`](file:///c:/Users/durga/OneDrive/Desktop/MDP/firmware/esp32_rc_firmware.ino) (or your adapted firmware) to the ESP32.
3. **Connect to Wi-Fi:** On your laptop or phone, join the robot's Wi-Fi network (default: `ESP32-FireRobot`, password: `12345678`).
4. **Launch Controller:** In your terminal, run:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in Chrome, Safari, or Edge.
5. **Verify Connection Status:**
   - The status badge in the top right must change to green: **CONNECTED**.
   - The latency badge will show measured ping (e.g. `18ms`).
6. **Test Movement Controls:**
   - Click and hold **FORWARD**: Left and right wheels should rotate forward.
   - Release the mouse/finger: Wheels must stop immediately.
   - Test **BACKWARD**, **LEFT**, and **RIGHT** similarly.
7. **Test Emergency Stop:**
   - Hold **FORWARD** and press `Space` or tap the red **EMERGENCY STOP** button: Wheels must stop immediately.
8. **Test Safety Watchdog:**
   - Hold **FORWARD** with your finger. While holding, turn off laptop Wi-Fi: Within 500ms, the ESP32 watchdog must cut motor power automatically.

---

## 7. Features That Cannot Be Verified Until Connected to the Robot

The following factors depend entirely on physical hardware and cannot be verified via software simulation:

1. **Motor Polarity & Direction:** Whether GPIO HIGH corresponds to forward rotation or reverse rotation depends on H-bridge wiring.
2. **Motor Driver Enable / Standby Lines:**
   - L298N requires ENA and ENB jumpers fitted or driven via PWM.
   - TB6612 requires the STBY pin tied to 3.3V/5V.
3. **Wi-Fi Signal Range & Packet Latency:** Real-world RF attenuation through walls or hazardous college environments.
4. **Power Supply Stability:** Ensuring motor stall currents do not cause ESP32 brownout resets (motors should be powered from a dedicated battery pack or buck converter).
5. **Failsafe Pump Guard:** The water pump relay must remain powered OFF during movement calibration.
