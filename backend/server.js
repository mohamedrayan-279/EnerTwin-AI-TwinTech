const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const app = express();
app.use(cors());
app.use(express.json());

/* ============================================================
   CONFIGURATION
   ============================================================ */

const SERIAL_PORT = process.env.ESP32_PORT || "COM7";
const BAUD_RATE = parseInt(process.env.SERIAL_BAUD || "115200", 10);

// Dataset path — resolves relative to this file
const DATASET_PATH = path.resolve(__dirname, "../dataset/sensor_data.csv");

/* ============================================================
   LOAD CSV DATASET (fallback / demo mode)
   Each row: Voltage, Current, Power (W), Energy (kWh), Temperature, Humidity
   ============================================================ */

let datasetRows = [];
let datasetIndex = 0;

function loadDataset() {
  try {
    const raw = fs.readFileSync(DATASET_PATH, "utf8");
    const lines = raw.trim().split("\n");
    // Skip header row
    const dataLines = lines.slice(1);
    datasetRows = dataLines
      .map((line) => {
        const parts = line.trim().split(",");
        if (parts.length < 6) return null;
        const [voltage, current, power, energy, temperature, humidity] = parts.map(Number);
        if ([voltage, current, power, energy, temperature, humidity].some(isNaN)) return null;
        return { voltage, current, power, energy, temperature, humidity };
      })
      .filter(Boolean);

    console.log(`[Dataset] Loaded ${datasetRows.length} rows from sensor_data.csv`);
  } catch (err) {
    console.warn(`[Dataset] Could not load CSV: ${err.message}. Demo mode will use static defaults.`);
    datasetRows = [];
  }
}

loadDataset();

/* ============================================================
   LIVE DATA STATE
   ============================================================ */

let latestData = {
  machineId: "Motor-01",
  temperature: null,
  humidity: null,
  voltage: null,
  current: null,
  power: null,       // stored in Watts from hardware / CSV
  energy: null,
  frequency: null,
  powerFactor: null,
  relay: null,
  lastUpdated: null
};

let isHardwareConnected = false;

// Rolling history buffer (last 60 readings)
const MAX_HISTORY = 60;
let sensorHistory = [];

function pushHistory(snapshot) {
  sensorHistory.push(snapshot);
  if (sensorHistory.length > MAX_HISTORY) {
    sensorHistory.shift();
  }
}

/* ============================================================
   DATASET CYCLING — provides live-feeling demo data
   Called every 3 s when hardware is not connected
   ============================================================ */

function getNextDatasetRow() {
  if (!datasetRows.length) return null;
  const row = datasetRows[datasetIndex % datasetRows.length];
  datasetIndex++;
  return row;
}

function applyDatasetRow(row) {
  if (!row) return;

  // Derive frequency & power factor (not in CSV — simulate realistic values)
  const freqJitter = (Math.random() * 0.4 - 0.2); // ±0.2 Hz around 50 Hz
  const pfJitter = (Math.random() * 0.02 - 0.01);  // ±0.01 around 0.92

  latestData.voltage      = parseFloat(row.voltage.toFixed(2));
  latestData.current      = parseFloat(row.current.toFixed(2));
  latestData.power        = parseFloat(row.power.toFixed(2));   // in Watts
  latestData.energy       = parseFloat(row.energy.toFixed(2));
  latestData.temperature  = parseFloat(row.temperature.toFixed(2));
  latestData.humidity     = parseFloat(row.humidity.toFixed(2));
  latestData.frequency    = parseFloat((50 + freqJitter).toFixed(2));
  latestData.powerFactor  = parseFloat((0.92 + pfJitter).toFixed(3));
  latestData.lastUpdated  = new Date().toISOString();

  // Record snapshot into history (power in kW for frontend)
  pushHistory({
    time: new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }),
    voltage:     latestData.voltage,
    current:     latestData.current,
    power:       parseFloat((latestData.power / 1000).toFixed(3)),
    energy:      latestData.energy,
    temperature: latestData.temperature,
    humidity:    latestData.humidity,
    frequency:   latestData.frequency,
    powerFactor: latestData.powerFactor
  });
}

// Start dataset cycling interval (every 3 seconds)
let datasetTimer = null;

function startDatasetCycling() {
  if (datasetTimer) return;
  // Immediately serve first row
  applyDatasetRow(getNextDatasetRow());
  datasetTimer = setInterval(() => {
    if (!isHardwareConnected) {
      applyDatasetRow(getNextDatasetRow());
    }
  }, 3000);
  console.log("[Dataset] Demo cycling started (hardware not connected).");
}

/* ============================================================
   SERIAL PARSING
   ============================================================ */

function parseSerialLine(line) {
  const cleanLine = line.trim();
  if (!cleanLine) return;

  console.log(`[ESP32 Serial]: ${cleanLine}`);

  // Try JSON format: {"voltage":230, "current":1.5, "temp":32, ...}
  if (cleanLine.startsWith("{") && cleanLine.endsWith("}")) {
    try {
      const data = JSON.parse(cleanLine);
      if (data.voltage     !== undefined) latestData.voltage     = parseFloat(data.voltage);
      if (data.current     !== undefined) latestData.current     = parseFloat(data.current);
      if (data.power       !== undefined) latestData.power       = parseFloat(data.power);
      if (data.energy      !== undefined) latestData.energy      = parseFloat(data.energy);
      if (data.temperature !== undefined || data.temp  !== undefined)
        latestData.temperature = parseFloat(data.temperature ?? data.temp);
      if (data.humidity    !== undefined || data.humid !== undefined)
        latestData.humidity    = parseFloat(data.humidity ?? data.humid);
      if (data.frequency   !== undefined || data.freq  !== undefined)
        latestData.frequency   = parseFloat(data.frequency ?? data.freq);
      if (data.powerFactor !== undefined || data.pf    !== undefined)
        latestData.powerFactor = parseFloat(data.powerFactor ?? data.pf);
      if (data.relay       !== undefined) latestData.relay = Boolean(data.relay);
      latestData.lastUpdated = new Date().toISOString();

      // Derive power if only V & I are present
      if (latestData.voltage != null && latestData.current != null && latestData.power == null) {
        const pf = latestData.powerFactor || 0.92;
        latestData.power = parseFloat((latestData.voltage * latestData.current * pf).toFixed(2));
      }

      pushHistory({
        time: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        }),
        voltage:     latestData.voltage,
        current:     latestData.current,
        power:       latestData.power != null ? parseFloat((latestData.power / 1000).toFixed(3)) : null,
        energy:      latestData.energy,
        temperature: latestData.temperature,
        humidity:    latestData.humidity,
        frequency:   latestData.frequency,
        powerFactor: latestData.powerFactor
      });
      return;
    } catch (e) {
      // Fallback to key-value line regex below
    }
  }

  // Key-Value parsing
  if (/voltage|^v\b/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i) || cleanLine.match(/([0-9.]+)\s*V/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.voltage = parseFloat(match[1]);
  }

  if (/current|^i\b|^a\b/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i) || cleanLine.match(/([0-9.]+)\s*A/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.current = parseFloat(match[1]);
  }

  if (/power\s*factor|pf/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.powerFactor = parseFloat(match[1]);
  } else if (/power|^p\b|^w\b/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i) || cleanLine.match(/([0-9.]+)\s*W/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.power = parseFloat(match[1]);
  }

  if (/energy|^e\b/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i) || cleanLine.match(/([0-9.]+)\s*kWh/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.energy = parseFloat(match[1]);
  }

  if (/frequency|freq|^f\b/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i) || cleanLine.match(/([0-9.]+)\s*Hz/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.frequency = parseFloat(match[1]);
  }

  if (/temp|temperature|^t\b/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i) || cleanLine.match(/([0-9.]+)\s*°?C/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.temperature = parseFloat(match[1]);
  }

  if (/humid|humidity|^h\b/i.test(cleanLine)) {
    const match = cleanLine.match(/[:=]\s*([0-9.]+)/i) || cleanLine.match(/([0-9.]+)\s*%/i);
    if (match && !isNaN(parseFloat(match[1]))) latestData.humidity = parseFloat(match[1]);
  }

  if (/relay/i.test(cleanLine)) {
    if (/ON|HIGH|1|TRUE/i.test(cleanLine))  latestData.relay = true;
    else if (/OFF|LOW|0|FALSE/i.test(cleanLine)) latestData.relay = false;
  }

  // Derive power if not reported
  if (latestData.voltage != null && latestData.current != null && latestData.power == null) {
    const pf = latestData.powerFactor || 0.92;
    latestData.power = parseFloat((latestData.voltage * latestData.current * pf).toFixed(2));
  }

  latestData.lastUpdated = new Date().toISOString();
}

/* ============================================================
   SERIAL PORT INIT
   ============================================================ */

let port = null;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isHardwareConnected) {
      console.log(`[Serial] Retrying connection to ${SERIAL_PORT}...`);
      initSerialPort();
    }
  }, 5000);
}

function initPowerShellSerialPort(targetPort) {
  const { spawn, execSync } = require("child_process");
  console.log(`[Serial] Opening ${targetPort} via PowerShell fallback...`);

  try {
    execSync('powershell -NoProfile -Command "Stop-Process -Name serial-monitor -Force -ErrorAction SilentlyContinue"', { stdio: "ignore" });
  } catch (e) {}

  const psScript = `
$portName = "${targetPort}"
$baudRate = ${BAUD_RATE}
$port = New-Object System.IO.Ports.SerialPort $portName, $baudRate, "None", 8, "One"
$port.DtrEnable = $true
$port.RtsEnable = $true
$port.ReadTimeout = 5000
try {
    $port.Open()
    Write-Output "CONNECTED_OK"
    while ($true) {
        try {
            $line = $port.ReadLine()
            if ($line) { Write-Output "SERIAL:$line" }
        } catch [System.TimeoutException] { }
    }
} catch {
    Write-Output "ERROR: $_"
} finally {
    if ($null -ne $port -and $port.IsOpen) { $port.Close() }
}
`;

  const ps = spawn("powershell", ["-NoProfile", "-Command", psScript]);

  ps.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.includes("CONNECTED_OK")) {
        isHardwareConnected = true;
        if (datasetTimer) { clearInterval(datasetTimer); datasetTimer = null; }
        console.log(`[Serial] Connected to ESP32 on ${targetPort} at ${BAUD_RATE} baud (PowerShell).`);
      } else if (line.startsWith("SERIAL:")) {
        isHardwareConnected = true;
        parseSerialLine(line.substring(7));
      } else if (line.startsWith("ERROR:")) {
        isHardwareConnected = false;
        console.error(`[Serial Error] ${line}`);
      }
    }
  });

  ps.on("close", () => {
    isHardwareConnected = false;
    console.warn(`[Serial] PowerShell stream closed for ${targetPort}. Will retry...`);
    startDatasetCycling();
    scheduleReconnect();
  });
}

function initSerialPort() {
  try {
    const { SerialPort } = require("serialport");
    const { ReadlineParser } = require("@serialport/parser-readline");

    console.log(`\n==================================================`);
    console.log(`Attempting to open Serial Port ${SERIAL_PORT} at ${BAUD_RATE} baud...`);
    console.log(`==================================================\n`);

    if (port && port.isOpen) port.close();

    port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE, autoOpen: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.open((err) => {
      if (err) {
        console.warn(`[Serial] serialport open error: ${err.message}. Trying PowerShell fallback...`);
        initPowerShellSerialPort(SERIAL_PORT);
        return;
      }
      isHardwareConnected = true;
      if (datasetTimer) { clearInterval(datasetTimer); datasetTimer = null; }
      console.log(`[Serial] Connected to ESP32 on ${SERIAL_PORT} at ${BAUD_RATE} baud.`);
    });

    parser.on("data", (line) => {
      isHardwareConnected = true;
      parseSerialLine(line);
    });

    port.on("error", (err) => {
      isHardwareConnected = false;
      console.error(`[Serial Error] ${err.message}`);
    });

    port.on("close", () => {
      isHardwareConnected = false;
      console.warn(`[Serial] Port ${SERIAL_PORT} disconnected.`);
      startDatasetCycling();
      scheduleReconnect();
    });
  } catch (err) {
    console.log(`[Serial] Using PowerShell fallback for ${SERIAL_PORT}.`);
    initPowerShellSerialPort(SERIAL_PORT);
  }
}

/* ============================================================
   AI ENERGY ANALYSIS
   Power from hardware / CSV is in WATTS.
   Dataset typical range: ~670 – 1250 W
   ============================================================ */

function analyzeEnergy(powerWatts, temperature) {
  const powerKw = powerWatts != null ? powerWatts / 1000 : null;

  let status;
  let recommendation;

  if (powerKw != null && powerKw > 1.2) {
    status = "HIGH";
    recommendation = "Power draw is elevated. Reduce machine load or inspect for overloading.";
  } else if (powerKw != null && powerKw > 1.0) {
    status = "MODERATE";
    recommendation = "Energy usage is slightly above normal. Monitor operating conditions.";
  } else {
    status = "NORMAL";
    recommendation = "Energy consumption is within the expected operating range.";
  }

  return { status, recommendation };
}

/* ============================================================
   ROUTES
   ============================================================ */

app.get("/", (req, res) => {
  res.json({
    message: "EnerTwin AI Backend is running",
    status: "OK",
    hardware: isHardwareConnected ? "Connected" : "Disconnected (demo mode)",
    datasetRows: datasetRows.length,
    datasetIndex
  });
});

/* GET /api/sensor-data
   Returns current sensor snapshot.
   Power is sent in WATTS so the frontend's existing conversion
   (power > 20 → divide by 1000 → kW) works correctly.
*/
app.get("/api/sensor-data", (req, res) => {
  const aiAnalysis = analyzeEnergy(latestData.power, latestData.temperature);

  res.json({
    machineId:       latestData.machineId,
    temperature:     latestData.temperature,
    humidity:        latestData.humidity,
    voltage:         latestData.voltage,
    current:         latestData.current,
    power:           latestData.power,           // in Watts — frontend converts
    energy:          latestData.energy,           // in kWh
    frequency:       latestData.frequency,
    powerFactor:     latestData.powerFactor,
    relay:           latestData.relay,
    aiStatus:        aiAnalysis.status,
    aiRecommendation: aiAnalysis.recommendation,
    hardwareConnected: isHardwareConnected,
    lastUpdated:     latestData.lastUpdated || new Date().toISOString()
  });
});

/* GET /api/history
   Returns the rolling history buffer for chart rendering.
   Power values are already in kW in the history buffer.
*/
app.get("/api/history", (req, res) => {
  res.json({ history: sensorHistory });
});

/* POST /api/relay
   Toggle machine relay.
*/
app.post("/api/relay", (req, res) => {
  const { status } = req.body;
  if (status !== undefined) {
    latestData.relay = Boolean(status);
    latestData.lastUpdated = new Date().toISOString();
    console.log(`[Control] Relay set to: ${latestData.relay ? "ON" : "OFF"}`);

    if (port && port.isOpen) {
      port.write(`RELAY:${latestData.relay ? "ON" : "OFF"}\n`, (err) => {
        if (err) console.error(`[Serial Error] Failed to write to serial: ${err.message}`);
      });
    }
    return res.json({ success: true, relay: latestData.relay });
  }
  res.status(400).json({ error: "Invalid status value provided" });
});

/* GET /api/status
   Quick health check for frontend connection indicator.
*/
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    hardwareConnected: isHardwareConnected,
    demoMode: !isHardwareConnected,
    uptime: process.uptime()
  });
});

/* ============================================================
   START SERVER
   ============================================================ */

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`EnerTwin AI Backend  →  http://localhost:${PORT}`);
  console.log(`Dataset path         →  ${DATASET_PATH}`);
  console.log(`========================================\n`);

  // Start demo cycling immediately, then attempt hardware
  startDatasetCycling();
  initSerialPort();
});