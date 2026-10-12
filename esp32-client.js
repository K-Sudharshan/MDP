/**
 * ESP32 Hardware Communication Layer
 * 
 * Manages HTTP / WebSocket transport, connection state tracking,
 * request timeouts via AbortController, and emergency STOP priority.
 */

const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR'
};

class Esp32Client {
  constructor(config) {
    this.config = Object.assign({}, config);
    this.state = ConnectionState.DISCONNECTED;
    this.lastError = null;
    this.lastLatencyMs = null;
    this.isSimulation = false;
    this.ws = null;
    this.activeAbortController = null;
    this.healthCheckTimer = null;
    this.stateListeners = [];
    this.errorListeners = [];
    this.logListeners = [];
    this._isSending = false;
  }

  updateConfig(newConfig) {
    const protocolChanged = this.config.protocol !== newConfig.protocol ||
                            this.config.robotIp !== newConfig.robotIp ||
                            this.config.httpPort !== newConfig.httpPort ||
                            this.config.wsPort !== newConfig.wsPort;
    this.config = Object.assign({}, newConfig);
    if (protocolChanged) {
      this.disconnect();
    }
  }

  onStateChange(fn) {
    this.stateListeners.push(fn);
  }

  onError(fn) {
    this.errorListeners.push(fn);
  }

  onLog(fn) {
    this.logListeners.push(fn);
  }

  _setState(newState, error = null) {
    const changed = this.state !== newState;
    this.state = newState;
    this.lastError = error;
    if (changed || error) {
      for (const fn of this.stateListeners) {
        try { fn(this.state, error, this.isSimulation); } catch (e) { console.error(e); }
      }
    }
    if (error) {
      for (const fn of this.errorListeners) {
        try { fn(error); } catch (e) { console.error(e); }
      }
    }
  }

  _log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    for (const fn of this.logListeners) {
      try { fn({ timestamp, message, type }); } catch (e) { console.error(e); }
    }
  }

  getHttpBaseUrl() {
    return `http://${this.config.robotIp}:${this.config.httpPort}`;
  }

  getWsUrl() {
    return `ws://${this.config.robotIp}:${this.config.wsPort}`;
  }

  /**
   * Genuine health check / connection verification.
   * Only transitions to CONNECTED if the ESP32 actively responds.
   */
  async checkHealth() {
    if (this.config.protocol === 'ws') {
      return this._connectWs();
    }

    this._setState(ConnectionState.CONNECTING);
    this._log(`Pinging ESP32 at ${this.getHttpBaseUrl()}${this.config.endpoints.status}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.commandTimeoutMs);
    const start = Date.now();

    try {
      const response = await fetch(`${this.getHttpBaseUrl()}${this.config.endpoints.status}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json, text/plain, */*' }
      });

      let isSim = false;
      if (response.ok) {
        try {
          const data = await response.json();
          if (data && (data.mock === true || data.mode === 'simulation' || data.robot === 'esp32_mock_robot')) {
            isSim = true;
          }
        } catch (_) {
          // Non-JSON ok response
        }
      }
      clearTimeout(timeoutId);
      this.lastLatencyMs = Date.now() - start;

      if (response.ok) {
        this.isSimulation = isSim;
        this._setState(ConnectionState.CONNECTED);
        if (this.isSimulation) {
          this._log(`Connected to OFFLINE SIMULATION server (${this.lastLatencyMs}ms). NO PHYSICAL HARDWARE CONNECTED.`, 'warn');
        } else {
          this._log(`Connected to ESP32 (${this.lastLatencyMs}ms latency)`, 'success');
        }
        return true;
      } else {
        const msg = `ESP32 returned HTTP ${response.status} (${response.statusText})`;
        this.isSimulation = false;
        this._setState(ConnectionState.ERROR, msg);
        this._log(msg, 'error');
        return false;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      this.isSimulation = false;
      let errMsg = 'Network request failed';
      if (err.name === 'AbortError') {
        errMsg = `Connection timed out after ${this.config.commandTimeoutMs}ms`;
      } else if (err.message) {
        errMsg = err.message;
      }
      this._setState(ConnectionState.ERROR, errMsg);
      this._log(`Failed to reach ESP32: ${errMsg}`, 'error');
      return false;
    }
  }

  _connectWs() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return Promise.resolve(true);
    }

    this._setState(ConnectionState.CONNECTING);
    const url = this.getWsUrl();
    this._log(`Connecting WebSocket to ${url}...`);

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        this._setState(ConnectionState.ERROR, `WebSocket init failed: ${err.message}`);
        resolve(false);
        return;
      }

      this.ws.onopen = () => {
        this.isSimulation = false;
        this._setState(ConnectionState.CONNECTED);
        this._log(`WebSocket connected to ${url}`, 'success');
        resolve(true);
      };

      this.ws.onclose = (event) => {
        this.isSimulation = false;
        this._setState(ConnectionState.DISCONNECTED, `WebSocket closed (code: ${event.code})`);
        this._log(`WebSocket connection closed`, 'warn');
      };

      this.ws.onerror = () => {
        this.isSimulation = false;
        const msg = `WebSocket error connecting to ${url}`;
        this._setState(ConnectionState.ERROR, msg);
        this._log(msg, 'error');
        resolve(false);
      };

      this.ws.onmessage = (event) => {
        this._log(`ESP32: ${event.data}`, 'incoming');
      };
    });
  }

  disconnect() {
    this.stopHealthCheck();
    this.isSimulation = false;
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this._setState(ConnectionState.DISCONNECTED);
    this._log('Disconnected from ESP32');
  }

  startHealthCheck() {
    this.stopHealthCheck();
    this.checkHealth();
    this.healthCheckTimer = setInterval(() => {
      // Don't poll status while currently actively sending movement commands
      if (!this._isSending && this.config.protocol === 'http') {
        this.checkHealth();
      }
    }, this.config.healthCheckIntervalMs);
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Sends movement command.
   * Drops stale pending movement requests if busy; STOP has priority.
   */
  async sendMove(directionKey) {
    const commandValue = this.config.commands[directionKey];
    if (!commandValue) {
      const err = `Unknown direction command: ${directionKey}`;
      this._log(err, 'error');
      return { success: false, error: err };
    }

    if (this.config.protocol === 'ws') {
      return this._sendWs({ cmd: 'move', dir: commandValue });
    }

    return this._sendHttpMove(commandValue);
  }

  /**
   * Emergency STOP command.
   * Cancels any in-flight move requests and dispatches immediately.
   */
  async sendStop() {
    const stopCommand = this.config.commands.STOP || 'stop';

    // Abort in-flight movement HTTP request immediately
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    if (this.config.protocol === 'ws') {
      return this._sendWs({ cmd: 'stop' });
    }

    return this._sendHttpStop(stopCommand);
  }

  async _sendHttpMove(commandValue) {
    // If a previous move is still pending, abort it so we never build a stale backlog
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    const controller = new AbortController();
    this.activeAbortController = controller;
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.config.commandTimeoutMs);

    this._isSending = true;
    const url = this.config.httpMode === 'query'
      ? `${this.getHttpBaseUrl()}${this.config.endpoints.move}?dir=${encodeURIComponent(commandValue)}`
      : `${this.getHttpBaseUrl()}${this.config.endpoints.move}`;

    const options = {
      method: this.config.httpMode === 'query' ? 'GET' : 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      }
    };

    if (this.config.httpMode === 'json') {
      options.body = JSON.stringify({ dir: commandValue });
    }

    try {
      const response = await fetch(url, options);
      try { await response.text(); } catch (_) {}
      clearTimeout(timeoutId);
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
      this._isSending = false;

      if (response.ok) {
        if (this.state !== ConnectionState.CONNECTED) {
          this._setState(ConnectionState.CONNECTED);
        }
        if (this.isSimulation) {
          this._log(`[SIMULATION] Virtual MOVE: ${commandValue} (mock only, no physical motors moved)`);
        } else {
          this._log(`Sent MOVE: ${commandValue} (HTTP ${response.status})`);
        }
        return { success: true };
      } else {
        const msg = `MOVE failed with HTTP ${response.status}`;
        this._setState(ConnectionState.ERROR, msg);
        this._log(msg, 'error');
        return { success: false, error: msg };
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
      this._isSending = false;

      if (err.name === 'AbortError') {
        if (didTimeout) {
          const msg = `MOVE request timed out after ${this.config.commandTimeoutMs}ms`;
          this._setState(ConnectionState.ERROR, msg);
          this._log(msg, 'error');
          return { success: false, error: msg, timedOut: true };
        }
        // User released control or switched directions; intentional abort
        return { success: false, aborted: true };
      }

      const msg = `Network error sending MOVE: ${err.message || 'Connection unreachable'}`;
      this._setState(ConnectionState.ERROR, msg);
      this._log(msg, 'error');
      return { success: false, error: msg };
    }
  }

  async _sendHttpStop(stopCommand) {
    const controller = new AbortController();
    this.activeAbortController = controller;
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.config.commandTimeoutMs);

    this._isSending = true;
    const url = this.config.httpMode === 'query'
      ? `${this.getHttpBaseUrl()}${this.config.endpoints.stop}`
      : `${this.getHttpBaseUrl()}${this.config.endpoints.stop}`;

    const options = {
      method: this.config.httpMode === 'query' ? 'GET' : 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      }
    };

    if (this.config.httpMode === 'json') {
      options.body = JSON.stringify({ cmd: stopCommand });
    }

    try {
      const response = await fetch(url, options);
      try { await response.text(); } catch (_) {}
      clearTimeout(timeoutId);
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
      this._isSending = false;

      if (response.ok) {
        if (this.state !== ConnectionState.CONNECTED) {
          this._setState(ConnectionState.CONNECTED);
        }
        if (this.isSimulation) {
          this._log(`[SIMULATION] Virtual STOP (mock only, no physical motors moved)`, 'warn');
        } else {
          this._log(`Sent STOP (HTTP ${response.status})`, 'warn');
        }
        return { success: true };
      } else {
        const msg = `STOP failed with HTTP ${response.status}`;
        this._setState(ConnectionState.ERROR, msg);
        this._log(msg, 'error');
        return { success: false, error: msg };
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
      this._isSending = false;

      if (err.name === 'AbortError') {
        if (didTimeout) {
          const msg = `STOP request timed out after ${this.config.commandTimeoutMs}ms`;
          this._setState(ConnectionState.ERROR, msg);
          this._log(msg, 'error');
          return { success: false, error: msg, timedOut: true };
        }
        return { success: false, aborted: true };
      }

      const msg = `Network error sending STOP: ${err.message || 'Connection unreachable'}`;
      this._setState(ConnectionState.ERROR, msg);
      this._log(msg, 'error');
      return { success: false, error: msg };
    }
  }

  _sendWs(payload) {
    if (!this.ws || this.ws.readyState !== 1) {
      const msg = 'Cannot send: WebSocket is not connected';
      this._setState(ConnectionState.DISCONNECTED, msg);
      this._log(msg, 'error');
      return { success: false, error: msg };
    }

    try {
      const data = JSON.stringify(payload);
      this.ws.send(data);
      this._log(`Sent WS: ${data}`);
      return { success: true };
    } catch (err) {
      const msg = `Failed to send WebSocket message: ${err.message}`;
      this._setState(ConnectionState.ERROR, msg);
      this._log(msg, 'error');
      return { success: false, error: msg };
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Esp32Client, ConnectionState };
}
