/**
 * Centralized Hardware & Network Configuration
 * 
 * =========================================================================
 * INTEGRATION NOTICE:
 * Values below are UNVERIFIED PROVISIONAL DEFAULTS (WORKING ASSUMPTIONS).
 * They must be confirmed or updated once the hardware team delivers the robot.
 * Modify them directly in this file or configure them in the web UI Settings drawer.
 * =========================================================================
 */

const DEFAULT_CONFIG = {
  // ASSUMPTION: 192.168.4.1 is the provisional default for ESP32 in SoftAP mode.
  // In Station (router) mode, update to the IP assigned by the Wi-Fi router.
  robotIp: '192.168.4.1',

  // ASSUMPTION: HTTP is the baseline protocol supported by ESP32 WebServer.
  // Supports 'http' or 'ws' (WebSocket).
  protocol: 'http',

  // ASSUMPTION: Standard web server ports on ESP32.
  httpPort: 80,
  wsPort: 81,

  // ASSUMPTION: REST route endpoints on the ESP32.
  // Match these to server.on(...) in the Arduino firmware sketch.
  endpoints: {
    status: '/status',  // Health-check / ping route (GET)
    move: '/move',      // Movement command route (GET/POST)
    stop: '/stop'       // Emergency stop route (GET/POST)
  },

  // ASSUMPTION: 'query' sends GET /move?dir=forward
  // 'json' sends POST /move with body {"dir":"forward"}
  httpMode: 'query',

  // ASSUMPTION: Command strings expected by firmware.
  // If the hardware team expects uppercase ('FORWARD') or single chars ('F','B','L','R','S'),
  // edit these 5 values here without modifying any UI code.
  commands: {
    FORWARD: 'forward',
    BACKWARD: 'backward',
    LEFT: 'left',
    RIGHT: 'right',
    STOP: 'stop'
  },

  // PROVISIONAL: Pulse interval in milliseconds to keep sending movement commands
  // while a direction button is held down. Feeds the ESP32 hardware watchdog.
  heartbeatIntervalMs: 200,

  // PROVISIONAL: Network request timeout before aborting and marking request failed.
  commandTimeoutMs: 600,

  // PROVISIONAL: Idle health-check interval to detect disconnection when robot is idle.
  healthCheckIntervalMs: 3000,

  // HARDWARE REQUIREMENT: Required ESP32 firmware watchdog cutoff duration.
  // Motors must autonomously cut power if no command arrives within this duration.
  firmwareWatchdogMs: 500
};

const STORAGE_KEY = 'esp32_rc_config';

/**
 * Validates and sanitizes configuration overrides.
 * Prevents invalid URLs, out-of-range ports, and malformed hostnames.
 */
function validateConfig(overrides) {
  if (!overrides || typeof overrides !== 'object') {
    return { valid: false, error: 'Configuration must be an object', sanitized: {} };
  }

  const sanitized = Object.assign({}, overrides);

  // Validate and sanitize robotIp
  if ('robotIp' in sanitized) {
    if (typeof sanitized.robotIp !== 'string') {
      return { valid: false, error: 'Robot IP/Hostname must be a string', sanitized: {} };
    }
    let ip = sanitized.robotIp.trim();
    // Strip leading protocol scheme if accidentally included by user
    ip = ip.replace(/^(https?:\/\/|wss?:\/\/)/i, '');
    // Strip trailing slash or path
    ip = ip.replace(/\/.*$/, '').trim();

    // Extract port if specified in IP/hostname (e.g. 192.168.4.1:8080)
    const portMatch = ip.match(/:(\d+)$/);
    if (portMatch) {
      const extractedPort = Number(portMatch[1]);
      if (!Number.isInteger(extractedPort) || extractedPort < 1 || extractedPort > 65535) {
        return { valid: false, error: `Invalid port in Robot IP/Hostname: ${portMatch[1]}`, sanitized: {} };
      }
      if (!('httpPort' in overrides)) {
        sanitized.httpPort = extractedPort;
      }
      ip = ip.slice(0, portMatch.index);
    }

    if (!ip) {
      return { valid: false, error: 'Robot IP/Hostname cannot be empty', sanitized: {} };
    }
    // Disallow whitespace, slashes, or invalid URI characters
    if (/[^a-zA-Z0-9.\-_]/.test(ip)) {
      return { valid: false, error: `Invalid characters in Robot IP/Hostname: "${ip}"`, sanitized: {} };
    }
    sanitized.robotIp = ip;
  }

  // Validate protocol
  if ('protocol' in sanitized) {
    if (sanitized.protocol !== 'http' && sanitized.protocol !== 'ws') {
      return { valid: false, error: 'Protocol must be either "http" or "ws"', sanitized: {} };
    }
  }

  // Validate httpPort
  if ('httpPort' in sanitized) {
    const port = Number(sanitized.httpPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { valid: false, error: `HTTP Port must be an integer between 1 and 65535 (got ${sanitized.httpPort})`, sanitized: {} };
    }
    sanitized.httpPort = port;
  }

  // Validate wsPort
  if ('wsPort' in sanitized) {
    const port = Number(sanitized.wsPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { valid: false, error: `WS Port must be an integer between 1 and 65535 (got ${sanitized.wsPort})`, sanitized: {} };
    }
    sanitized.wsPort = port;
  }

  return { valid: true, error: null, sanitized };
}

function loadConfig() {
  const cfg = Object.assign({}, DEFAULT_CONFIG);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const validation = validateConfig(parsed);
        if (validation.valid) {
          Object.assign(cfg, validation.sanitized);
        }
      }
    } catch (e) {
      console.warn('Failed to read config from localStorage:', e);
    }
  }
  return cfg;
}

function saveConfig(overrides) {
  const validation = validateConfig(overrides);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const current = loadConfig();
      const merged = Object.assign(current, validation.sanitized);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    } catch (e) {
      console.error('Failed to save config to localStorage:', e);
    }
  }
  return Object.assign({}, DEFAULT_CONFIG, validation.sanitized);
}

// Support both Browser globals and Node.js require() for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_CONFIG, loadConfig, saveConfig, validateConfig };
}
