# ESP32 Firefighting Robot — Minimal Web RC Controller

A minimal, reliable, zero-dependency web interface designed to control the physical movement of an ESP32-based firefighting robot over Wi-Fi.

---

## 1. Project Overview

- **Milestone Scope:** Basic RC Movement only (`FORWARD`, `BACKWARD`, `LEFT`, `RIGHT`, `STOP`).
- **Communication Path:** Browser ──(Wi-Fi / HTTP or WS)──> ESP32 ────> Motor Driver ────> DC Motors.
- **Safety Guarantee:** Press-and-hold controls with release-to-stop, window blur/pagehide safety nets, in-flight abort on emergency STOP, and a required **ESP32 hardware watchdog timer**.

---

## 2. Directory Structure

```text
MDP/
├── index.html                     # Industrial UI: Drive pad, Emergency STOP, Live Logs, Simulation Banner
├── style.css                      # Industrial dark theme styling, brass accents, screws, touch guards
├── config.js                      # Centralized ESP32 IP/port config, validation & sanitization
├── esp32-client.js                # Isolated transport: HTTP/WS, honest state, timeout tracking, STOP priority
├── controller.js                  # Pointer events, safety stops (blur, visibilitychange, pagehide), keyboard controls
├── server.js                      # Zero-dependency local runner with offline simulation (--mock)
├── test.js                        # Self-check test suite (Node.js assert, 9 comprehensive tests)
├── package.json                   # Zero external dependencies; scripts for start, sim, and test
├── HARDWARE_INTEGRATION.md        # Dedicated integration checklist and guide for the hardware team
├── Firefighting Robot Controller.html # Visual design reference from Claude
└── firmware/
    └── esp32_rc_firmware.ino      # REFERENCE FIRMWARE — NOT VERIFIED AGAINST PHYSICAL HARDWARE
```

---

## 3. How to Run

### Prerequisites
- Node.js (v18+) or any web server.
- **No external npm packages are needed.**

### Commands

1. **Run Self-Check Tests:**
   ```bash
   npm test
   # or
   node test.js
   ```

2. **Start Dev Server (Direct Wi-Fi to physical robot):**
   ```bash
   npm start
   # or
   node server.js
   ```
   Open `http://localhost:3000` on your laptop or phone connected to the robot's Wi-Fi network.

3. **Start in Offline Simulation Mode (Test UI without hardware):**
   ```bash
   node server.js --mock
   ```
   Displays an unmistakable `⚠️ SIMULATION — NO HARDWARE CONNECTED` banner in the UI and records virtual motor actions in the log console without sending commands to physical hardware.

---

## 4. Hardware Integration Pending

> **STATUS: Frontend and transport layer implemented; hardware integration pending receipt of hardware specifications and firmware from the hardware team.**

### Required Information from Hardware Team

Before connecting to the physical robot, the hardware team must supply the following 10 items:

1. **Exact ESP32 Board / Model:** (e.g., ESP32-WROOM-32, ESP32-CAM, ESP32-S3, NodeMCU-32S).
2. **Motor Driver Model:** (e.g., L298N Dual H-Bridge, TB6612FNG, DRV8833).
3. **GPIO-to-Driver Pin Mapping:** Exact digital and PWM pins connected to motor inputs (e.g., Left FWD/REV, Right FWD/REV) and enable/standby pins (ENA, ENB, STBY).
4. **Existing ESP32 Firmware Source:** The actual `.ino` or ESP-IDF source code written by the hardware team.
5. **Wi-Fi Mode:** Whether the ESP32 creates its own Access Point (SoftAP) or connects as a Station (STA) to a field Wi-Fi router.
6. **ESP32 IP Address & Network Details:** Confirmed IP address (default AP is usually `192.168.4.1`), Wi-Fi SSID, and passphrase.
7. **Supported Movement Commands & Exact Format:** Whether the firmware expects query parameters (`GET /move?dir=forward`), JSON body (`POST /move {"dir":"forward"}`), or single-character codes (`F`, `B`, `L`, `R`, `S`).
8. **Available HTTP Routes or Other Protocol:** Exact endpoint paths (`/status`, `/move`, `/stop`) or WebSocket port.
9. **Expected Response Format & Connection Health Mechanism:** The status response format and whether the firmware provides CORS headers (`Access-Control-Allow-Origin: *`).
10. **Firmware Motor-Stop Behavior & Watchdog Timeout:** Confirm whether the firmware autonomously stops motors if heartbeat packets cease for > 500ms.

---

## 5. Distinction of Facts, Assumptions, and Unverified Details

| Category | Details |
|---|---|
| **Verified Facts** | • Web controller runs with zero external dependencies.<br>• Configuration changes are strictly validated and sanitized (strips `http://`, validates ports 1-65535).<br>• Request timeouts trigger honest `ERROR` states and are not swallowed.<br>• Emergency STOP aborts in-flight movement commands and receives transport priority.<br>• Pointer release, window blur, tab visibility change, and `pagehide` trigger STOP.<br>• 8 automated test suites pass with zero regressions. |
| **Working Assumptions** | • ESP32 operates as a Wi-Fi Access Point at `192.168.4.1` on port 80.<br>• Firmware accepts query parameters `GET /move?dir=...` and `GET /stop`.<br>• Heartbeat pulse interval of 200ms satisfies firmware watchdog. |
| **Unverified Details** | • Physical ESP32 board model and motor driver chip.<br>• Actual GPIO wiring and enable pin configuration.<br>• Real firmware response schema and CORS header support.<br>• Real physical motor response and traction. |

---

## 6. Reference Firmware Audit & Limitations

The reference sketch in `firmware/esp32_rc_firmware.ino` is provided to establish the communication contract, but **is NOT verified against physical hardware**:

- **Pin Assignments are Placeholders:** GPIO 18, 19, 22, 23, 25 are arbitrary and must be changed to match physical wiring.
- **Driver Enable Pins:** If using an L298N driver, ENA and ENB jumpers must be fitted or driven HIGH; if using TB6612, the STBY pin must be pulled HIGH or motors will not spin.
- **Safety Watchdog:** The firmware loop includes an autonomous 500ms watchdog (`millis() - lastCommandMillis > 500`). Because `loop()` is single-threaded, long blocking delays must never be added to the firmware loop.
- **Pump Guard:** The firefighting water pump relay pin is strictly disabled (LOW) for movement testing.

---

## 7. Testing Procedure Once Hardware is Available

1. Confirm motor driver wiring and update GPIO pin constants in the firmware.
2. Flash firmware to the ESP32 via Arduino IDE or ESP-IDF.
3. Power the ESP32 and place the robot on a test stand with **wheels lifted off the ground**.
4. Connect the laptop or phone to the robot's Wi-Fi network (`ESP32-FireRobot`).
5. Open `http://localhost:3000` (or host frontend files on ESP32 LittleFS).
6. Verify the connection indicator transitions to green **CONNECTED** (latency measured).
7. Test single directional pulses:
   - Press and hold **FORWARD** -> verify forward wheel rotation. Release -> verify wheels stop immediately.
   - Press and hold **BACKWARD** -> verify reverse wheel rotation. Release -> verify wheels stop immediately.
   - Press and hold **LEFT** -> verify left turn rotation. Release -> verify wheels stop immediately.
   - Press and hold **RIGHT** -> verify right turn rotation. Release -> verify wheels stop immediately.
8. Test safety stops:
   - Hold **FORWARD** and press the red **EMERGENCY STOP** button -> motors must stop instantly.
   - Hold **FORWARD** and switch browser tabs or lock screen -> motors must stop instantly.
   - Disconnect Wi-Fi while holding a direction -> ESP32 watchdog must stop motors within 500ms.
