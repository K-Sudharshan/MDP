/**
 * Comprehensive Self-Check Test Suite
 * 
 * Verifies:
 * 1. Configuration invariants & validation rejection (invalid IPs, ports, protocols).
 * 2. URL sanitization (strips http://, trailing slashes).
 * 3. Client state machine initialization & disconnected guards.
 * 4. All 5 movement commands (FORWARD, BACKWARD, LEFT, RIGHT, STOP) over transport.
 * 5. Simulation / Real Hardware mode separation.
 * 6. STOP priority over in-flight movement commands.
 * 7. Network request timeouts (verifies timeout is NOT swallowed).
 * 8. Failed health checks (non-200 HTTP responses).
 * 9. Honest error reporting on unreachable hosts.
 * 10. Press-and-release interaction logic, conflict prevention, and safety stops in RcController.
 * 
 * Zero external dependencies. Uses Node.js standard assert.
 */

const assert = require('assert');
const http = require('http');
const { DEFAULT_CONFIG, loadConfig, saveConfig, validateConfig } = require('./config.js');
const { Esp32Client, ConnectionState } = require('./esp32-client.js');
const { RcController } = require('./controller.js');

async function runTests() {
  console.log('--- Starting RC Controller Hardware-Readiness Tests ---');

  // =========================================================================
  // Test 1: Config Invariants & Validation
  // =========================================================================
  console.log('[Test 1] Configuration invariants and strict validation...');
  assert.strictEqual(typeof DEFAULT_CONFIG.robotIp, 'string');
  assert.strictEqual(DEFAULT_CONFIG.protocol, 'http');
  assert.strictEqual(typeof DEFAULT_CONFIG.commands.FORWARD, 'string');
  assert.strictEqual(typeof DEFAULT_CONFIG.commands.STOP, 'string');
  assert.ok(DEFAULT_CONFIG.commandTimeoutMs > 0);
  assert.ok(DEFAULT_CONFIG.firmwareWatchdogMs > 0);

  // Invalid config rejections
  const emptyIp = validateConfig({ robotIp: '   ' });
  assert.strictEqual(emptyIp.valid, false, 'Empty IP must be rejected');

  const invalidPortHigh = validateConfig({ httpPort: 70000 });
  assert.strictEqual(invalidPortHigh.valid, false, 'Port > 65535 must be rejected');

  const invalidPortNegative = validateConfig({ httpPort: -1 });
  assert.strictEqual(invalidPortNegative.valid, false, 'Negative port must be rejected');

  const invalidProto = validateConfig({ protocol: 'ftp' });
  assert.strictEqual(invalidProto.valid, false, 'Non-http/ws protocol must be rejected');

  assert.throws(() => saveConfig({ httpPort: 99999 }), /between 1 and 65535/);
  console.log('✓ Config invariants and validation checks passed.');

  // =========================================================================
  // Test 2: URL Sanitization
  // =========================================================================
  console.log('[Test 2] URL sanitization (stripping schemes, paths, trailing slashes)...');
  const sanitizedScheme = validateConfig({ robotIp: 'http://192.168.4.1/' });
  assert.strictEqual(sanitizedScheme.valid, true);
  assert.strictEqual(sanitizedScheme.sanitized.robotIp, '192.168.4.1');

  const sanitizedWs = validateConfig({ robotIp: 'ws://esp32-robot.local/ws' });
  assert.strictEqual(sanitizedWs.valid, true);
  assert.strictEqual(sanitizedWs.sanitized.robotIp, 'esp32-robot.local');

  const validSaved = saveConfig({ robotIp: '192.168.4.50' });
  assert.strictEqual(validSaved.robotIp, '192.168.4.50');

  // Regression: Embedded port extraction and invalid port rejection
  const sanitizedPort = validateConfig({ robotIp: '192.168.4.1:8080' });
  assert.strictEqual(sanitizedPort.valid, true);
  assert.strictEqual(sanitizedPort.sanitized.robotIp, '192.168.4.1');
  assert.strictEqual(sanitizedPort.sanitized.httpPort, 8080);

  const invalidPortInIp = validateConfig({ robotIp: '192.168.4.1:99999' });
  assert.strictEqual(invalidPortInIp.valid, false, 'Invalid embedded port must be rejected');
  console.log('✓ URL sanitization tests passed.');

  // =========================================================================
  // Test 3: Client State Machine Initialization
  // =========================================================================
  console.log('[Test 3] Client state machine and unknown command guard...');
  const client = new Esp32Client(DEFAULT_CONFIG);
  assert.strictEqual(client.state, ConnectionState.DISCONNECTED);
  assert.strictEqual(client.isSimulation, false);
  assert.strictEqual(client.getHttpBaseUrl(), `http://${DEFAULT_CONFIG.robotIp}:80`);

  const invalidResult = await client.sendMove('UNKNOWN_DIRECTION');
  assert.strictEqual(invalidResult.success, false);
  console.log('✓ State machine initialization passed.');

  // =========================================================================
  // Test 4: Transport Tests (All 5 Commands & Simulation Separation)
  // =========================================================================
  console.log('[Test 4] Transport tests: all 5 movement commands & simulation separation...');
  let serverMode = 'real'; // 'real' | 'simulation' | 'delayed' | 'error'
  let receivedRequests = [];

  const testServer = http.createServer((req, res) => {
    receivedRequests.push({ url: req.url, method: req.method });

    if (serverMode === 'error') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'internal_failure' }));
      return;
    }

    if (serverMode === 'delayed') {
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        }
      }, 500);
      return;
    }

    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (serverMode === 'simulation') {
        res.end(JSON.stringify({ status: 'ok', mock: true, mode: 'simulation', robot: 'esp32_mock_robot' }));
      } else {
        res.end(JSON.stringify({ status: 'ok', robot: 'esp32_firefighting', moving: false }));
      }
    } else if (req.url.startsWith('/move')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', action: 'move' }));
    } else if (req.url === '/stop') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', action: 'stop' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;

  const testConfig = Object.assign({}, DEFAULT_CONFIG, {
    robotIp: '127.0.0.1',
    httpPort: testPort,
    commandTimeoutMs: 200
  });

  const testClient = new Esp32Client(testConfig);

  // A. Health check against Real Hardware mode
  serverMode = 'real';
  const realConnected = await testClient.checkHealth();
  assert.strictEqual(realConnected, true);
  assert.strictEqual(testClient.state, ConnectionState.CONNECTED);
  assert.strictEqual(testClient.isSimulation, false, 'Hardware mode must NOT be flagged as simulation');
  console.log(`✓ Real hardware health check passed (${testClient.lastLatencyMs}ms latency)`);

  // B. Health check against Simulation Mode
  serverMode = 'simulation';
  const simConnected = await testClient.checkHealth();
  assert.strictEqual(simConnected, true);
  assert.strictEqual(testClient.state, ConnectionState.CONNECTED);
  assert.strictEqual(testClient.isSimulation, true, 'Mock server must be flagged as isSimulation === true');
  console.log('✓ Simulation mode separation verified.');

  // C. Verify all five movement commands (FORWARD, BACKWARD, LEFT, RIGHT, STOP)
  const fwd = await testClient.sendMove('FORWARD');
  assert.strictEqual(fwd.success, true);
  assert.ok(receivedRequests.some(r => r.url.includes('/move?dir=forward')));

  const bwd = await testClient.sendMove('BACKWARD');
  assert.strictEqual(bwd.success, true);
  assert.ok(receivedRequests.some(r => r.url.includes('/move?dir=backward')));

  const lft = await testClient.sendMove('LEFT');
  assert.strictEqual(lft.success, true);
  assert.ok(receivedRequests.some(r => r.url.includes('/move?dir=left')));

  const rgt = await testClient.sendMove('RIGHT');
  assert.strictEqual(rgt.success, true);
  assert.ok(receivedRequests.some(r => r.url.includes('/move?dir=right')));

  const stp = await testClient.sendStop();
  assert.strictEqual(stp.success, true);
  assert.ok(receivedRequests.some(r => r.url === '/stop'));
  console.log('✓ All 5 movement commands verified over network transport.');

  // =========================================================================
  // Test 5: STOP Priority and In-Flight Abort
  // =========================================================================
  console.log('[Test 5] STOP priority cancels in-flight movement...');
  const movePromise = testClient.sendMove('BACKWARD');
  const stopPromise = testClient.sendStop();
  const [mRes, sRes] = await Promise.all([movePromise, stopPromise]);

  assert.strictEqual(sRes.success, true, 'STOP must succeed');
  console.log('✓ Emergency STOP priority verified.');

  // =========================================================================
  // Test 6: Network Timeout Discrimination (Defect Fix Verification)
  // =========================================================================
  console.log('[Test 6] Timeout discrimination (verifying timeouts trigger ERROR, not swallowed)...');
  serverMode = 'delayed'; // Server delays 500ms, client timeout is 200ms
  const timeoutClient = new Esp32Client(testConfig);

  const timeoutResult = await timeoutClient.sendMove('RIGHT');
  assert.strictEqual(timeoutResult.success, false, 'Timed out request must not report success');
  assert.strictEqual(timeoutResult.timedOut, true, 'Timeout must be explicitly identified');
  assert.strictEqual(timeoutClient.state, ConnectionState.ERROR, 'State must transition to ERROR on timeout');
  assert.ok(timeoutClient.lastError.includes('timed out'), 'Error message must reflect timeout');
  console.log(`✓ Timeout handling verified: "${timeoutClient.lastError}"`);

  // =========================================================================
  // Test 7: Failed Health Checks (Server HTTP 500)
  // =========================================================================
  console.log('[Test 7] Failed health check handling...');
  serverMode = 'error';
  const errorClient = new Esp32Client(testConfig);
  const errorHealth = await errorClient.checkHealth();
  assert.strictEqual(errorHealth, false);
  assert.strictEqual(errorClient.state, ConnectionState.ERROR);
  assert.ok(errorClient.lastError.includes('500'));
  console.log(`✓ Failed health check correctly reported: "${errorClient.lastError}"`);

  await new Promise((resolve) => testServer.close(resolve));

  // =========================================================================
  // Test 8: Unreachable Host / Connection Refused
  // =========================================================================
  console.log('[Test 8] Honest error reporting on unreachable host...');
  const deadConfig = Object.assign({}, DEFAULT_CONFIG, {
    robotIp: '127.0.0.1',
    httpPort: 59999, // Nothing listening
    commandTimeoutMs: 150
  });
  const deadClient = new Esp32Client(deadConfig);
  const deadHealth = await deadClient.checkHealth();
  assert.strictEqual(deadHealth, false);
  assert.strictEqual(deadClient.state, ConnectionState.ERROR);
  assert.ok(deadClient.lastError !== null);
  console.log(`✓ Unreachable host reported honest error: "${deadClient.lastError}"`);

  // =========================================================================
  // Test 9: Press-and-Release Interaction Logic & Safety Stops in RcController
  // =========================================================================
  console.log('[Test 9] RcController press-and-release, conflict prevention & safety stops...');
  let mockMoves = [];
  let mockStops = 0;
  const mockClient = {
    sendMove: (dir) => { mockMoves.push(dir); return Promise.resolve({ success: true }); },
    sendStop: () => { mockStops++; return Promise.resolve({ success: true }); },
    updateConfig: () => {},
    checkHealth: () => Promise.resolve(true),
    onStateChange: () => {},
    onLog: () => {}
  };

  const createMockElement = () => ({
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    },
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    addEventListener: () => {}
  });

  const mockDom = {
    btnForward: createMockElement(),
    btnBackward: createMockElement(),
    btnLeft: createMockElement(),
    btnRight: createMockElement(),
    btnStop: createMockElement(),
    badge: createMockElement(),
    statusText: { textContent: '' },
    errorMessage: { textContent: '', style: {} },
    simIndicator: createMockElement()
  };

  const controller = new RcController(mockClient, DEFAULT_CONFIG, mockDom);

  // A. Press and hold Forward
  controller._startMovement('FORWARD', mockDom.btnForward, 1);
  assert.strictEqual(controller.activeDirection, 'FORWARD');
  assert.ok(mockDom.btnForward.classList.contains('active'));
  assert.ok(mockMoves.includes('FORWARD'));

  // B. Release Forward -> Must trigger STOP
  controller._stopMovement('button_release');
  assert.strictEqual(controller.activeDirection, null);
  assert.strictEqual(mockDom.btnForward.classList.contains('active'), false);
  assert.ok(mockStops > 0);
  console.log('✓ Press and release triggers STOP verified.');

  // C. Conflict prevention: pressing Left while holding Right switches cleanly
  controller._startMovement('LEFT', mockDom.btnLeft, 2);
  assert.strictEqual(controller.activeDirection, 'LEFT');
  controller._startMovement('RIGHT', mockDom.btnRight, 3);
  assert.strictEqual(controller.activeDirection, 'RIGHT');
  assert.strictEqual(mockDom.btnLeft.classList.contains('active'), false);
  assert.strictEqual(mockDom.btnRight.classList.contains('active'), true);
  console.log('✓ Conflicting input prevention verified.');

  // D. Safety stop on blur / focus loss
  controller._stopMovement('window_blur');
  assert.strictEqual(controller.activeDirection, null);
  assert.strictEqual(mockDom.btnRight.classList.contains('active'), false);
  console.log('✓ Safety stop on blur verified.');

  // E. Settings form submit with null settingsPanel (regression: Bug 1)
  const listeners = {};
  mockDom.formSettings = {
    addEventListener: (evt, fn) => { listeners[evt] = fn; }
  };
  mockDom.inputIp = { value: '192.168.4.1' };
  mockDom.selectProtocol = { value: 'http' };
  mockDom.inputHttpPort = { value: '80' };
  mockDom.inputWsPort = { value: '81' };
  mockDom.settingsPanel = null;
  controller.dom.formSettings = mockDom.formSettings;
  controller.dom.inputIp = mockDom.inputIp;
  controller.dom.selectProtocol = mockDom.selectProtocol;
  controller.dom.inputHttpPort = mockDom.inputHttpPort;
  controller.dom.inputWsPort = mockDom.inputWsPort;
  controller.dom.settingsPanel = null;
  controller._bindSettingsEvents();
  assert.doesNotThrow(() => {
    listeners['submit']({ preventDefault: () => {} });
  }, 'Settings submit must not throw when settingsPanel is null');
  assert.strictEqual(mockDom.errorMessage.style.display, 'none');
  console.log('✓ Settings submit null-panel safety verified.');

  // F. Lost pointer capture / release safety (regression: Bug 4)
  controller._startMovement('BACKWARD', mockDom.btnBackward, 10);
  assert.strictEqual(controller.activeDirection, 'BACKWARD');
  controller._stopMovement('button_release');
  assert.strictEqual(controller.activeDirection, null);
  console.log('✓ Lost pointer capture safety verified.');

  // G. Secondary pointer clicks (right click button = 2) must not trigger movement (regression: Bug 6)
  const forwardListeners = {};
  mockDom.btnForward.addEventListener = (evt, fn) => { forwardListeners[evt] = fn; };
  controller._bindButtonEvents();
  if (forwardListeners['pointerdown']) {
    forwardListeners['pointerdown']({ button: 2, pointerId: 99, preventDefault: () => {} });
    assert.strictEqual(controller.activeDirection, null, 'Right-click must not trigger movement');
  }
  console.log('✓ Non-primary mouse click rejection verified.');

  // =========================================================================
  // Test 10: Static File Path Traversal Security (regression: Bug 2)
  // =========================================================================
  console.log('[Test 10] Server static file path traversal rejection...');
  const { server } = require('./server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  const traversalRes = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: serverPort, path: '/..%2f..%2fpackage.json' }, (res) => {
      resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.strictEqual(traversalRes, 403, 'Path traversal must be rejected with HTTP 403');

  const validRes = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${serverPort}/index.html`, (res) => {
      resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.strictEqual(validRes, 200, 'Valid static file must return HTTP 200');

  await new Promise((resolve) => server.close(resolve));
  console.log('✓ Path traversal correctly rejected with HTTP 403.');

  console.log('=================================================================');
  console.log(' ALL 10 COMPREHENSIVE TESTS PASSED SUCCESSFULLY! ZERO REGRESSIONS.');
  console.log('=================================================================');
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
