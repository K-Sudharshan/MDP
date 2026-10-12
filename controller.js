/**
 * RC Controller UI & Input Handler
 * 
 * Implements press-and-hold pointer events, conflict prevention,
 * heartbeat interval dispatch, keyboard accessibility, and safety stops
 * on blur, visibilitychange, and pointer cancellation.
 */

class RcController {
  constructor(client, config, customDom = null) {
    this.client = client;
    this.config = config;
    this.activeDirection = null;
    this.heartbeatTimer = null;
    this.activePointerId = null;
    this.activePointerElement = null;
    this.pressedMovementKeys = new Set();

    // DOM Elements (supports browser DOM or injected test mock)
    this.dom = customDom || (typeof document !== 'undefined' ? {
      badge: document.getElementById('connection-badge'),
      statusText: document.getElementById('connection-text'),
      ipDisplay: document.getElementById('robot-ip-display'),
      latencyDisplay: document.getElementById('latency-display'),
      errorMessage: document.getElementById('error-message'),
      simIndicator: document.getElementById('simulation-indicator'),
      btnForward: document.getElementById('btn-forward'),
      btnBackward: document.getElementById('btn-backward'),
      btnLeft: document.getElementById('btn-left'),
      btnRight: document.getElementById('btn-right'),
      btnStop: document.getElementById('btn-stop'),
      logContainer: document.getElementById('log-console'),
      btnSettingsToggle: document.getElementById('btn-settings-toggle'),
      settingsPanel: document.getElementById('settings-panel'),
      formSettings: document.getElementById('settings-form'),
      inputIp: document.getElementById('setting-ip'),
      selectProtocol: document.getElementById('setting-protocol'),
      inputHttpPort: document.getElementById('setting-http-port'),
      inputWsPort: document.getElementById('setting-ws-port'),
      btnTestConnection: document.getElementById('btn-test-connection'),
      btnClearLogs: document.getElementById('btn-clear-logs'),
      hub: document.getElementById('hub')
    } : {});

    this.directionButtons = {
      FORWARD: this.dom.btnForward,
      BACKWARD: this.dom.btnBackward,
      LEFT: this.dom.btnLeft,
      RIGHT: this.dom.btnRight
    };

    this.keyMap = {
      'KeyW': 'FORWARD',
      'ArrowUp': 'FORWARD',
      'KeyS': 'BACKWARD',
      'ArrowDown': 'BACKWARD',
      'KeyA': 'LEFT',
      'ArrowLeft': 'LEFT',
      'KeyD': 'RIGHT',
      'ArrowRight': 'RIGHT'
    };

    this._bindClientEvents();

    if (typeof window !== 'undefined') {
      this._bindButtonEvents();
      this._bindKeyboardEvents();
      this._bindSafetyEvents();
      this._bindSettingsEvents();
      this._updateConfigUI();
    }
  }

  _bindClientEvents() {
    this.client.onStateChange((state, error, isSimulation) => {
      this._updateConnectionUI(state, error, isSimulation);
    });

    this.client.onLog((entry) => {
      this._appendLog(entry);
    });
  }

  _bindButtonEvents() {
    // Movement buttons (Press and hold)
    for (const [dir, btn] of Object.entries(this.directionButtons)) {
      if (!btn) continue;

      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        this._startMovement(dir, btn, e.pointerId);
      });

      const handleRelease = (e) => {
        if (this.activePointerId === e.pointerId || this.activeDirection === dir) {
          e.preventDefault();
          this._stopMovement('button_release');
        }
      };

      btn.addEventListener('pointerup', handleRelease);
      btn.addEventListener('pointercancel', handleRelease);
      btn.addEventListener('lostpointercapture', handleRelease);
      btn.addEventListener('pointerleave', (e) => {
        // Pointerleave fires if pointer moves out and pointer was not captured
        if (this.activePointerId === null && this.activeDirection === dir) {
          this._stopMovement('pointer_leave');
        }
      });

      // Prevent mobile context menu on long-press
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Emergency STOP Button
    if (this.dom.btnStop) {
      this.dom.btnStop.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._stopMovement('manual_stop_button');
        this.dom.btnStop.classList.add('hit');
        setTimeout(() => {
          if (this.dom.btnStop) this.dom.btnStop.classList.remove('hit');
        }, 200);
      });

      const releaseStop = (e) => {
        e.preventDefault();
      };
      this.dom.btnStop.addEventListener('pointerup', releaseStop);
      this.dom.btnStop.addEventListener('pointercancel', releaseStop);
      this.dom.btnStop.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  _bindKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
      // Ignore if user is typing in settings inputs
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

      // Spacebar or Escape triggers immediate STOP
      if (e.code === 'Space' || e.code === 'Escape') {
        e.preventDefault();
        this.pressedMovementKeys.clear();
        this._stopMovement('keyboard_stop');
        return;
      }

      const dir = this.keyMap[e.code];
      if (dir) {
        e.preventDefault();
        if (e.repeat) return; // Prevent repeated keydown events from triggering conflicting moves
        this.pressedMovementKeys.add(e.code);
        const btn = this.directionButtons[dir];
        this._startMovement(dir, btn, null);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

      const dir = this.keyMap[e.code];
      if (dir) {
        this.pressedMovementKeys.delete(e.code);
        if (this.activeDirection === dir) {
          e.preventDefault();
          this._stopMovement('keyboard_release');
        }
      }
    });
  }

  _bindSafetyEvents() {
    // Window loses focus (user tabs away or switches app)
    window.addEventListener('blur', () => {
      this.pressedMovementKeys.clear();
      if (this.activeDirection) {
        this._stopMovement('window_blur');
      }
    });

    // Tab visibility changes (screen locks or tab hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pressedMovementKeys.clear();
        if (this.activeDirection) {
          this._stopMovement('visibility_hidden');
        }
      }
    });

    // Page navigation / unload / close
    window.addEventListener('pagehide', () => {
      this.pressedMovementKeys.clear();
      if (this.activeDirection) {
        this._stopMovement('pagehide');
      }
    });

    // Global pointer release safety: if pointer is released anywhere in window
    window.addEventListener('pointerup', (e) => {
      if (this.activePointerId !== null && this.activePointerId === e.pointerId) {
        this._stopMovement('global_pointer_up');
      }
    });

    window.addEventListener('pointercancel', (e) => {
      if (this.activePointerId !== null && this.activePointerId === e.pointerId) {
        this._stopMovement('global_pointer_cancel');
      }
    });
  }

  _startMovement(direction, element, pointerId) {
    // Prevent multiple conflicting inputs: stop prior direction first
    if (this.activeDirection && this.activeDirection !== direction) {
      this._stopMovement('direction_switch');
    }

    this.activeDirection = direction;
    this.activePointerId = pointerId;
    this.activePointerElement = element;

    if (element) {
      element.classList.add('active');
      if (pointerId !== null && element.setPointerCapture) {
        try {
          element.setPointerCapture(pointerId);
        } catch (_) {}
      }
    }

    // Update central hub indicator
    if (this.dom.hub) {
      this.dom.hub.textContent = direction.toUpperCase();
      this.dom.hub.classList.add('on');
    }

    // Immediately dispatch the movement command
    this.client.sendMove(direction);

    // Start repeating heartbeat ticker while direction is held
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.activeDirection === direction) {
        this.client.sendMove(direction);
      }
    }, this.config.heartbeatIntervalMs);
  }

  _stopMovement(triggerReason) {
    if (triggerReason !== 'direction_switch') {
      this.pressedMovementKeys.clear();
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    if (this.activePointerElement) {
      this.activePointerElement.classList.remove('active');
      if (this.activePointerId !== null && this.activePointerElement.releasePointerCapture) {
        try {
          this.activePointerElement.releasePointerCapture(this.activePointerId);
        } catch (_) {}
      }
    }

    // Unset active states for all directional buttons
    for (const btn of Object.values(this.directionButtons)) {
      if (btn) btn.classList.remove('active');
    }

    // Reset central hub indicator
    if (this.dom.hub) {
      this.dom.hub.textContent = 'IDLE';
      this.dom.hub.classList.remove('on');
    }

    this.activeDirection = null;
    this.activePointerId = null;
    this.activePointerElement = null;

    // Send the STOP command immediately
    this.client.sendStop();
  }

  _updateConnectionUI(state, error, isSimulation = false) {
    if (this.dom.simIndicator) {
      if (isSimulation) {
        this.dom.simIndicator.classList.remove('hidden');
      } else {
        this.dom.simIndicator.classList.add('hidden');
      }
    }

    if (!this.dom.badge) return;

    const lower = state.toLowerCase();
    this.dom.badge.dataset.state = lower;
    this.dom.badge.className = 'status status-badge state-' + lower;

    if (this.dom.statusText) {
      if (isSimulation && state === 'CONNECTED') {
        this.dom.statusText.textContent = 'CONNECTED (SIM)';
      } else {
        this.dom.statusText.textContent = state;
      }
    }

    if (this.dom.latencyDisplay) {
      if (state === 'CONNECTED' && this.client.lastLatencyMs !== null) {
        this.dom.latencyDisplay.textContent = `${this.client.lastLatencyMs}ms`;
        this.dom.latencyDisplay.style.display = 'inline';
      } else {
        this.dom.latencyDisplay.style.display = 'none';
      }
    }

    if (this.dom.errorMessage) {
      if (error) {
        this.dom.errorMessage.textContent = error;
        this.dom.errorMessage.style.display = 'block';
      } else {
        this.dom.errorMessage.textContent = '';
        this.dom.errorMessage.style.display = 'none';
      }
    }
  }

  _appendLog(entry) {
    if (!this.dom.logContainer) return;

    const row = document.createElement('div');
    const kind = entry.type === 'success' ? 'ok' : entry.type === 'error' ? 'err' : entry.type || 'info';
    row.className = `line ${kind}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 't';
    timeSpan.textContent = entry.timestamp;

    const tagSpan = document.createElement('span');
    tagSpan.className = 'tag';
    tagSpan.textContent = { info: 'INFO', ok: 'OK', warn: 'WARN', err: 'ERR', incoming: 'RX' }[kind] || 'INFO';

    const msgSpan = document.createElement('span');
    msgSpan.className = 'msg';
    msgSpan.textContent = entry.message;

    row.appendChild(timeSpan);
    row.appendChild(tagSpan);
    row.appendChild(msgSpan);

    this.dom.logContainer.appendChild(row);

    // Keep console bounded to last 60 lines
    while (this.dom.logContainer.childNodes.length > 60) {
      this.dom.logContainer.removeChild(this.dom.logContainer.firstChild);
    }

    this.dom.logContainer.scrollTop = this.dom.logContainer.scrollHeight;
  }

  _updateConfigUI() {
    if (this.dom.ipDisplay) {
      this.dom.ipDisplay.textContent = `${this.config.robotIp} (${this.config.protocol.toUpperCase()})`;
    }
    if (this.dom.inputIp) this.dom.inputIp.value = this.config.robotIp;
    if (this.dom.selectProtocol) this.dom.selectProtocol.value = this.config.protocol;
    if (this.dom.inputHttpPort) this.dom.inputHttpPort.value = this.config.httpPort;
    if (this.dom.inputWsPort) this.dom.inputWsPort.value = this.config.wsPort;
  }

  _bindSettingsEvents() {
    if (this.dom.btnSettingsToggle && this.dom.settingsPanel) {
      this.dom.btnSettingsToggle.addEventListener('click', () => {
        this.dom.settingsPanel.classList.toggle('hidden');
      });
    }

    if (this.dom.btnClearLogs && this.dom.logContainer) {
      this.dom.btnClearLogs.addEventListener('click', () => {
        this.dom.logContainer.innerHTML = '';
      });
    }

    if (this.dom.formSettings) {
      this.dom.formSettings.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const overrides = {
            robotIp: this.dom.inputIp.value.trim(),
            protocol: this.dom.selectProtocol.value,
            httpPort: this.dom.inputHttpPort.value.trim(),
            wsPort: this.dom.inputWsPort.value.trim()
          };

          const saveFn = typeof saveConfig === 'function' ? saveConfig : (typeof require !== 'undefined' ? require('./config.js').saveConfig : null);
          const updated = saveFn ? saveFn(overrides) : overrides;
          this.config = updated;
          this.client.updateConfig(updated);
          this._updateConfigUI();
          if (this.dom.errorMessage) {
            this.dom.errorMessage.style.display = 'none';
          }
          this.client.checkHealth();
          if (this.dom.settingsPanel) {
            this.dom.settingsPanel.classList.add('hidden');
          }
        } catch (err) {
          if (this.dom.errorMessage) {
            this.dom.errorMessage.textContent = `Config Error: ${err.message}`;
            this.dom.errorMessage.style.display = 'block';
          }
        }
      });
    }

    if (this.dom.btnTestConnection) {
      this.dom.btnTestConnection.addEventListener('click', () => {
        this.client.checkHealth();
      });
    }
  }
}

// Global initialization
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const config = loadConfig();
    const client = new Esp32Client(config);
    window.rcApp = new RcController(client, config);
    
    // Automatically trigger an initial health check test
    client.checkHealth();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RcController };
}
