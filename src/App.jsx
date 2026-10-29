import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart
} from "recharts";
import "./App.css";

/* =========================================================
   ENERGY CONFIGURATION
   ========================================================= */

const POWER_FACTOR = 0.92;
const ELECTRICITY_TARIFF = 6.0; // ₹ per kWh
const CO2_FACTOR = 0.708; // kg CO2 per kWh
const BACKEND_URL = "http://localhost:5000";

/* =========================================================
   MACHINE DATA
   ========================================================= */

const machines = [
  {
    id: "Motor-01",
    type: "Industrial Motor",
    icon: "⚙",
  },
  {
    id: "Compressor-02",
    type: "Air Compressor",
    icon: "◈",
  },
  {
    id: "Pump-03",
    type: "Water Pump",
    icon: "◉",
  },
  {
    id: "Fan-04",
    type: "Cooling Fan",
    icon: "◎",
  },
  {
    id: "Motor-05",
    type: "Production Motor",
    icon: "⚙",
  },
];

/* =========================================================
   SIDEBAR MENU
   ========================================================= */

const menuItems = [
  { id: "dashboard", icon: "⌂", label: "Dashboard" },
  { id: "energy", icon: "⌁", label: "Energy Monitoring" },
  { id: "digital-twin", icon: "◈", label: "Digital Twin" },
  { id: "ai", icon: "✦", label: "AI Insights" },
  { id: "analytics", icon: "◔", label: "Analytics" },
  { id: "alerts", icon: "⚠", label: "Alerts" },
  { id: "machines", icon: "⚙", label: "Machines" },
  { id: "control", icon: "▣", label: "Machine Control" },
  { id: "reports", icon: "▤", label: "Reports" },
  { id: "notifications", icon: "♢", label: "Notifications" },
  { id: "settings", icon: "⚙", label: "Settings" },
];

/* =========================================================
   HELPER FUNCTIONS
   ========================================================= */

/*
   Real electrical relationship:

   Power (kW) = Voltage (V) × Current (A) × Power Factor / 1000
*/

function calculatePower(voltage, current) {
  return Number(
    ((voltage * current * POWER_FACTOR) / 1000).toFixed(2)
  );
}

/*
   AI health score based on machine condition.
*/

function calculateHealth({
  temperature,
  current,
  power,
}) {
  if (
    temperature == null ||
    current == null ||
    power == null
  ) {
    return null;
  }

  let score = 100;

  // Thresholds calibrated to dataset: Current 3-7A, Power 0.67-1.25 kW, Temp 24-40°C
  if (temperature > 38) {
    score -= Math.min(25, (temperature - 38) * 3);
  }

  if (current > 6.5) {
    score -= Math.min(25, (current - 6.5) * 10);
  }

  if (power > 1.2) {
    score -= Math.min(25, (power - 1.2) * 25);
  }

  return Math.max(65, Math.min(100, Math.round(score)));
}

/* =========================================================
   ALERT LOGIC
   ========================================================= */

function checkAbnormal(values) {
  if (
    values.temperature == null ||
    values.power == null ||
    values.current == null
  ) {
    return false;
  }

  // Thresholds calibrated to dataset: Power 0.67-1.25 kW, Temp 24-40°C, Current 3-7A
  return (
    values.temperature >= 40 ||
    values.power >= 1.25 ||
    values.current >= 7.0
  );
}

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hardwareConnected, setHardwareConnected] = useState(false);

  /* =======================================================
     HARDWARE-READY LIVE VALUES
     No predefined sensor values are used.
     Values appear only after hardware/backend data arrives.
     ======================================================= */

  const [selectedMachineId, setSelectedMachineId] =
    useState(machines[0].id);

  const createEmptyMachine = (machine) => ({
    ...machine,
    temperature: null,
    voltage: null,
    current: null,
    power: null,
    energy: null,
    cost: null,
    co2: null,
    vibration: null,
    frequency: null,
    powerFactor: null,
    health: null,
    status: "Waiting",
    lastUpdated: null,
  });

  const [machinesState, setMachinesState] =
    useState(() => machines.map(createEmptyMachine));

  const [historyState, setHistoryState] = useState([]);

  const selectedMachine =
    machinesState.find(
      (machine) => machine.id === selectedMachineId
    ) || machinesState[0];

  const [values, setValues] = useState({
    temperature:  null,
    humidity:     null,
    voltage:      null,
    current:      null,
    power:        null,
    energy:       null,
    cost:         null,
    co2:          null,
    frequency:    null,
    powerFactor:  null,
    health:       null,
  });

  const [relay, setRelay] = useState(false);
  const [cooling, setCooling] = useState(false);

  const [runtime, setRuntime] = useState(8);

  /* =========================================================
     LIVE DATE + TIME
     ========================================================= */

  const [currentTime, setCurrentTime] =
    useState(new Date());

  useEffect(() => {
    const clock = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(clock);
  }, []);

  /* =========================================================
     ALERT STATUS
     ========================================================= */

  const alertActive = useMemo(() => {
    return checkAbnormal(values);
  }, [values]);

  /* =========================================================
     HARDWARE DATA BRIDGE
     Accepts either one sensor object or an array of machine objects.
     This keeps the dashboard ready for ESP32 -> backend integration.

     Supported keys include:
     temperature/temp, voltage, current, power, energy,
     vibration, frequency, powerFactor/pf, machineId/id.
     ========================================================= */

  const applyHardwareData = (payload) => {
    const incoming = Array.isArray(payload)
      ? payload
      : payload?.machines || payload?.data || [payload];

    if (!Array.isArray(incoming)) return;

    setMachinesState((previousMachines) =>
      previousMachines.map((machine) => {
        const raw = incoming.find(
          (item) => {
            const incomingId =
              item?.machineId ?? item?.id ?? item?.machine;

            if (incoming.length === 1) {
              return true;
            }

            return String(incomingId) === machine.id;
          }
        ) || (incoming.length === 1 ? incoming[0] : null);

        if (!raw) return machine;

        const temperature = Number(
          raw.temperature ?? raw.temp
        );
        const voltage = Number(raw.voltage);
        const current = Number(raw.current);
        const suppliedPower = Number(
          raw.power ?? raw.powerKw
        );
        const power = Number.isFinite(suppliedPower)
          ? Number(suppliedPower > 20
              ? Number((suppliedPower / 1000).toFixed(3))
              : Number(suppliedPower.toFixed(2)))
          : Number.isFinite(voltage) && Number.isFinite(current)
            ? calculatePower(voltage, current)
            : null;
        const energy = Number(raw.energy ?? raw.energyToday);
        const vibration = Number(raw.vibration);
        const frequency = Number(raw.frequency);
        const powerFactor = Number(
          raw.powerFactor ?? raw.pf
        );

        const safeNumber = (value) =>
          Number.isFinite(value) ? value : null;

        const nextTemperature = safeNumber(temperature);
        const nextVoltage = safeNumber(voltage);
        const nextCurrent = safeNumber(current);
        const nextPower = safeNumber(power);
        const nextEnergy = safeNumber(energy);
        const nextVibration = safeNumber(vibration);
        const nextFrequency = safeNumber(frequency);
        const nextPowerFactor = safeNumber(powerFactor);

        const nextHealth = calculateHealth({
          temperature: nextTemperature,
          current: nextCurrent,
          power: nextPower,
        });

        const status =
          nextHealth == null
            ? "Waiting"
            : checkAbnormal({
                temperature: nextTemperature,
                current: nextCurrent,
                power: nextPower,
              })
              ? "Warning"
              : "Normal";

        const nextCost =
          nextEnergy == null
            ? null
            : Number(
                (nextEnergy * ELECTRICITY_TARIFF).toFixed(2)
              );

        const nextCO2 =
          nextEnergy == null
            ? null
            : Number(
                (nextEnergy * CO2_FACTOR * 0.93).toFixed(2)
              );

        return {
          ...machine,
          temperature: nextTemperature,
          voltage: nextVoltage,
          current: nextCurrent,
          power: nextPower,
          energy: nextEnergy,
          cost: nextCost,
          co2: nextCO2,
          vibration: nextVibration,
          frequency: nextFrequency,
          powerFactor: nextPowerFactor,
          health: nextHealth,
          status,
          lastUpdated: new Date(),
        };
      })
    );

    const rawSingle = Array.isArray(incoming) ? incoming[0] : incoming;
    if (rawSingle) {
      const temp = Number(rawSingle.temperature ?? rawSingle.temp);
      const hum = Number(rawSingle.humidity);
      const volt = Number(rawSingle.voltage);
      const curr = Number(rawSingle.current);
      const pow = Number(rawSingle.power ?? rawSingle.powerKw);

      const validTemp = Number.isFinite(temp) ? temp : null;
      const validHum = Number.isFinite(hum) ? hum : null;
      const validVolt = Number.isFinite(volt) ? volt : 230;
      const validCurr = Number.isFinite(curr) ? curr : null;
      const validPow = Number.isFinite(pow) ? (pow > 20 ? Number((pow / 1000).toFixed(3)) : Number(pow.toFixed(2))) : null;

      if (validTemp != null || validPow != null || validHum != null) {
        const timeStr = new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        });

        setHistoryState((prev) => {
          const newPoint = {
            time: timeStr,
            temp: validTemp,
            humidity: validHum,
            voltage: validVolt,
            current: validCurr,
            power: validPow,
          };
          if (prev.length > 0 && prev[prev.length - 1].time === timeStr) {
            const updated = [...prev];
            updated[updated.length - 1] = newPoint;
            return updated;
          }
          return [...prev, newPoint].slice(-30);
        });
      }
    }
  };

  useEffect(() => {
    const handleHardwareData = (event) => {
      applyHardwareData(event.detail);
    };

    window.addEventListener(
      "enertwin:sensor-data",
      handleHardwareData
    );

    return () =>
      window.removeEventListener(
        "enertwin:sensor-data",
        handleHardwareData
      );
  }, [selectedMachineId]);

  /* =========================================================
     SELECTED MACHINE VALUES
     ========================================================= */

  useEffect(() => {
    if (!selectedMachine) return;

    setValues({
      temperature:  selectedMachine.temperature,
      humidity:     selectedMachine.humidity ?? null,
      voltage:      selectedMachine.voltage,
      current:      selectedMachine.current,
      power:        selectedMachine.power,
      energy:       selectedMachine.energy,
      cost:         selectedMachine.cost,
      co2:          selectedMachine.co2,
      frequency:    selectedMachine.frequency ?? null,
      powerFactor:  selectedMachine.powerFactor ?? null,
      health:       selectedMachine.health,
    });
  }, [selectedMachineId, machinesState]);

  /* =========================================================
     AUTO REFRESH
     ========================================================= */

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    // Seed history from backend on first load
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/history`);
        if (!res.ok) return;
        const { history } = await res.json();
        if (Array.isArray(history) && history.length > 0) {
          setHistoryState(history.slice(-30));
        }
      } catch (_) {}
    };

    fetchHistory();

    const fetchData = async () => {
      try {
        const response = await fetch(
          `${BACKEND_URL}/api/sensor-data`
        );

        if (!response.ok) return;

        const data = await response.json();
        applyHardwareData(data);
        if (data && data.relay !== undefined && data.relay !== null) {
          setRelay(Boolean(data.relay));
        }
        // Track hardware vs demo mode
        if (data.hardwareConnected !== undefined) {
          setHardwareConnected(Boolean(data.hardwareConnected));
        }
      } catch (error) {
        // Keep the dashboard silent while hardware/backend is unavailable.
      }
    };

    fetchData();

    const interval = setInterval(fetchData, 3000);

    return () => clearInterval(interval);
  }, [autoRefresh, selectedMachineId]);


  /* =========================================================
     WHAT-IF SIMULATOR
     ========================================================= */

  const whatIf = useMemo(() => {
    const hoursSaved = 8 - runtime;

    const averageMotorPower =
      selectedMachine?.power;

    const energySaving =
      averageMotorPower == null
        ? null
        : Math.max(
            0,
            hoursSaved * averageMotorPower
          );

    const costSaving =
      energySaving == null
        ? null
        : energySaving * ELECTRICITY_TARIFF;

    const co2Saving =
      energySaving == null
        ? null
        : energySaving * CO2_FACTOR;

    return {
      hoursSaved,
      energySaving:
        energySaving == null
          ? null
          : energySaving.toFixed(1),
      costSaving:
        costSaving == null
          ? null
          : costSaving.toFixed(0),
      co2Saving:
        co2Saving == null
          ? null
          : co2Saving.toFixed(1),
    };
  }, [runtime, machinesState, selectedMachineId]);

  /* =========================================================
     LOGIN
     ========================================================= */

  if (!loggedIn) {
    return (
      <Login
        onLogin={() => setLoggedIn(true)}
      />
    );
  }

  const handleToggleRelay = async (newStatus) => {
    setRelay(newStatus);
    try {
      await fetch(`${BACKEND_URL}/api/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err) {
      console.error("Failed to update relay via API:", err);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        alertActive={alertActive}
        hardwareConnected={hardwareConnected}
      />

      <main className="main-area">
        <TopBar
          page={page}
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          setPage={setPage}
          currentTime={currentTime}
        />

        {page === "dashboard" && (
          <Dashboard
            values={values}
            machines={machinesState}
            setPage={setPage}
            runtime={runtime}
            setRuntime={setRuntime}
            whatIf={whatIf}
            alertActive={alertActive}
            selectedMachineId={selectedMachineId}
            setSelectedMachineId={setSelectedMachineId}
          />
        )}

        {page === "energy" && (
          <EnergyPage values={values} history={historyState} />
        )}

        {page === "digital-twin" && (
          <DigitalTwinPage
            machine={selectedMachine}
          />
        )}

        {page === "ai" && (
          <AIPage
            values={values}
            alertActive={alertActive}
            machine={selectedMachine}
          />
        )}

        {page === "analytics" && (
          <AnalyticsPage values={values} history={historyState} />
        )}

        {page === "alerts" && (
          <AlertsPage
            values={values}
            alertActive={alertActive}
          />
        )}

        {page === "machines" && (
          <MachinesPage
            machines={machinesState}
          />
        )}

        {page === "control" && (
          <ControlPage
            relay={relay}
            setRelay={handleToggleRelay}
            cooling={cooling}
            setCooling={setCooling}
            values={values}
          />
        )}

        {page === "reports" && (
          <ReportsPage />
        )}

        {page === "notifications" && (
          <NotificationsPage
            alertActive={alertActive}
          />
        )}

        {page === "settings" && (
          <SettingsPage
            autoRefresh={autoRefresh}
            setAutoRefresh={setAutoRefresh}
          />
        )}
      </main>
    </div>
  );
}

/* =========================================================
   LOGIN
   ========================================================= */

function Login({ onLogin }) {
  const [user, setUser] = useState("");
  const [password, setPassword] =
    useState("");

  const submit = (event) => {
    event.preventDefault();

    const validUser = "enertwin@gmail.com";
    const validPassword = "12345678";

    if (
      user.trim() === validUser &&
      password === validPassword
    ) {
      onLogin();
      return;
    }

    alert("Incorrect username or password.");
  };

  return (
    <div className="login-page">
      <div className="login-background-shape shape-one"></div>
      <div className="login-background-shape shape-two"></div>

      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">
            ET
          </div>

          <div>
            <h1>
              EnerTwin <span>AI</span>
            </h1>

            <p>
              Industrial Energy Intelligence
            </p>
          </div>
        </div>

        <div className="login-heading">
          <span className="login-kicker">
            SMART ENERGY PLATFORM
          </span>

          <h2>Welcome</h2>

          <p>
            Sign in to access your digital twin
            dashboard.
          </p>
        </div>

        <form onSubmit={submit}>
          <label htmlFor="user-id">
            User ID
          </label>

          <div className="input-box">
            <span>◉</span>

            <input
              id="user-id"
              type="text"
              placeholder="Enter your user ID"
              value={user}
              onChange={(event) =>
                setUser(
                  event.target.value
                )
              }
            />
          </div>

          <label htmlFor="password">
            Password
          </label>

          <div className="input-box">
            <span>◆</span>

            <input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
              }
            />
          </div>

          <button
            className="login-button"
            type="submit"
          >
            Enter Dashboard{" "}
            <span>→</span>
          </button>
        </form>

        <div className="login-footer">
          <span className="online-dot"></span>
          Secure EnerTwin AI Environment
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function Sidebar({
  page,
  setPage,
  alertActive,
  hardwareConnected,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand-logo">
          <div className="brand-symbol">
            ET
          </div>

          <div>
            <h1>
              EnerTwin <span>AI</span>
            </h1>

            <small>
              Industrial Energy Intelligence
            </small>
          </div>
        </div>

        <div className="nav-label">
          CONTROL CENTER
        </div>

        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${
                page === item.id
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setPage(item.id)
              }
            >
              <span className="nav-icon">
                {item.icon}
              </span>

              <span className="nav-text">
                {item.label}
              </span>

              {item.id === "alerts" &&
                alertActive && (
                  <span className="nav-badge">
                    1
                  </span>
                )}
            </button>
          ))}
        </nav>
      </div>

      <div className="sidebar-bottom">
        <div className="system-status">
          <div className="status-title">
            <span className="online-dot"></span>
            System Online
          </div>

          <p>
            {hardwareConnected
              ? "ESP32 hardware connected"
              : "Demo mode — dataset cycling"}
          </p>
        </div>

        <div className="sidebar-version">
          EnerTwin AI <span>v1.0</span>
        </div>
      </div>
    </aside>
  );
}

/* =========================================================
   TOP BAR
   ========================================================= */

function TopBar({
  page,
  autoRefresh,
  setAutoRefresh,
  setPage,
  currentTime,
}) {
  const title =
    menuItems.find(
      (item) => item.id === page
    )?.label || "Dashboard";

  const formattedDate =
    currentTime.toLocaleDateString(
      "en-IN",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }
    );

  const formattedTime =
    currentTime.toLocaleTimeString(
      "en-IN",
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }
    );

  return (
    <header className="topbar">
      <div className="topbar-title">
        <div className="breadcrumb">
          ENERGY INTELLIGENCE PLATFORM
        </div>

        <h2>{title}</h2>

        <p>
          {page === "dashboard"
            ? "Real-time energy intelligence & digital twin"
            : "EnerTwin AI monitoring environment"}
        </p>
      </div>

      <div className="top-actions">
        <div className="date-box top-info-box">
          <div className="top-info-icon">
            ◫
          </div>

          <div className="top-info-content">
            <span>DATE</span>
            <strong>
              {formattedDate}
            </strong>
          </div>
        </div>

        <div className="time-box top-info-box">
          <div className="top-info-icon">
            ◷
          </div>

          <div className="top-info-content">
            <span>LIVE TIME</span>
            <strong>
              {formattedTime}
            </strong>
          </div>
        </div>

        <button
          type="button"
          className="notification-button"
          onClick={() =>
            setPage("notifications")
          }
          title="Notifications"
          aria-label="Open notifications"
        >
          ♢

          <span
            className={`notification-dot ${
              !autoRefresh
                ? "inactive"
                : ""
            }`}
          ></span>
        </button>

        <button
          type="button"
          className={`refresh-toggle ${
            autoRefresh
              ? "enabled"
              : ""
          }`}
          onClick={() =>
            setAutoRefresh(
              !autoRefresh
            )
          }
        >
          <span>↻</span>

          <span className="refresh-label">
            Auto Refresh
          </span>

          <strong>
            {autoRefresh
              ? "ON"
              : "OFF"}
          </strong>
        </button>

        <div className="profile-circle">
          ET
        </div>
      </div>
    </header>
  );
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function Dashboard({
  values,
  machines,
  setPage,
  runtime,
  setRuntime,
  whatIf,
  alertActive,
  selectedMachineId,
  setSelectedMachineId,
}) {
  const motor =
    machines.find((machine) => machine.id === selectedMachineId) || machines[0];

  return (
    <div className="dashboard">
      <section className="machine-selector-panel">
        <div className="machine-selector-copy">
          <span>MONITORED MACHINE</span>
          <strong>Choose a machine to view live operating data</strong>
        </div>

        <div className="machine-selector-control">
          <label htmlFor="dashboard-machine-select">
            Machine
          </label>
          <select
            id="dashboard-machine-select"
            value={selectedMachineId}
            onChange={(event) =>
              setSelectedMachineId(event.target.value)
            }
          >
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.id} — {machine.type}
              </option>
            ))}
          </select>
        </div>

        <div className="machine-live-state">
          <span className={`machine-live-dot ${motor?.status === "Warning" ? "warning" : ""}`}></span>
          <span>
            {motor?.status === "Waiting"
              ? "Waiting for hardware data"
              : motor?.status === "Warning"
                ? "Attention required"
                : "Live sensor data"}
          </span>
        </div>
      </section>

      <section className="hero-row">
        <div className="hero-copy">
          <span className="hero-tag">
            ● {motor?.status === "Waiting" ? "HARDWARE-READY DIGITAL TWIN" : "LIVE DIGITAL TWIN"}
          </span>

          <h1>
            Industrial Energy
            <br />
            <span>
              Intelligence.
            </span>
          </h1>

          <p>
            Monitor machine health, understand
            energy behavior and make smarter
            operational decisions.
          </p>
        </div>

        <div className="hero-twin">
          <div className="twin-glow"></div>

          <div className="machine-visual">
            <div className="motor-body"></div>
            <div className="motor-cylinder"></div>
            <div className="motor-top"></div>
            <div className="motor-base"></div>
            <div className="motor-shaft"></div>
          </div>

          <div className="twin-label">
            <span>{motor?.status === "Waiting" ? "READY" : "LIVE"}</span>
            Digital Twin
            <strong>
              {motor.id}
            </strong>
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard
          icon="℃"
          title="Temperature"
          value={values.temperature}
          unit="°C"
          machine={selectedMachineId}
          tone="red"
        />

        <MetricCard
          icon="ϟ"
          title="Voltage"
          value={values.voltage}
          unit="V"
          machine={selectedMachineId}
          tone="blue"
        />

        <MetricCard
          icon="∿"
          title="Current"
          value={values.current}
          unit="A"
          machine={selectedMachineId}
          tone="purple"
        />

        <MetricCard
          icon="◒"
          title="Power"
          value={values.power}
          unit="kW"
          machine={selectedMachineId}
          tone="orange"
        />

        <MetricCard
          icon="⚡"
          title="Energy Today"
          value={values.energy}
          unit="kWh"
          machine="Awaiting hardware"
          tone="yellow"
        />

        <MetricCard
          icon="₹"
          title="Amount Today"
          value={values.cost}
          unit=""
          machine="Live calculation"
          tone="green"
        />

        <MetricCard
          icon="◉"
          title="CO₂ Saved"
          value={values.co2}
          unit="kg"
          machine="Live calculation"
          tone="mint"
        />

        <div className="health-card">
          <div className="health-head">
            <div className="health-icon">
              ✦
            </div>

            <div>
              <span>AI HEALTH</span>

              <h3>
                {values.health == null ? "—" : values.health}
                <small>/100</small>
              </h3>
            </div>
          </div>

          <div className="health-progress">
            <span
              style={{
                width: `${values.health ?? 0}%`,
              }}
            ></span>
          </div>

          <div className="health-bottom">
            <span>
              Machine Intelligence
            </span>

            <strong>
              {values.health == null
                ? "Awaiting data"
                : alertActive
                  ? "Attention"
                  : "Healthy"}
            </strong>
          </div>
        </div>
      </section>

      <section className="main-grid">
        <div className="panel ai-panel full-width-panel">
          <PanelHeader
            title="Machine Insight"
            subtitle="Condition analysis from live machine data"
            icon="✦"
          />

          {values.health == null ? (
            <div className="hardware-waiting-card">
              <span>◌ HARDWARE DATA PENDING</span>
              <strong>Connect the machine sensors to begin live analysis.</strong>
              <p>
                Temperature, electrical readings and machine health will appear here automatically after the ESP32/backend connection is active.
              </p>
            </div>
          ) : !alertActive ? (
            <>
              <div className="ai-status normal-ai-status">
                <div className="ai-status-icon">
                  ✓
                </div>

                <div>
                  <strong>
                    Machine condition is being monitored
                  </strong>

                  <p>
                    {selectedMachineId} is currently within
                    the available live monitoring view.
                  </p>
                </div>
              </div>

              <div className="ai-alert-mini ai-normal">
                <span>✓</span>

                <div>
                  <strong>
                    No Abnormal Condition Detected
                  </strong>

                  <p>
                    Live sensor values are within the
                    configured operating limits.
                  </p>
                </div>
              </div>

              <div className="ai-recommendation ai-normal-recommendation">
                <span>✓</span>

                <div>
                  <strong>
                    Monitoring Active
                  </strong>

                  <p>
                    Continue monitoring as live hardware
                    data is received.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ai-status">
                <div className="ai-status-icon">
                  ✦
                </div>

                <div>
                  <strong>
                    Energy anomaly detected
                  </strong>

                  <p>
                    {selectedMachineId} is operating above
                    the configured normal range.
                  </p>
                </div>
              </div>

              <div className="ai-alert-mini">
                <span>⚠</span>

                <div>
                  <strong>
                    Abnormal Energy Usage
                  </strong>

                  <p>
                    {selectedMachineId} is showing a power
                    pattern that needs attention.
                  </p>
                </div>
              </div>

              <div className="ai-recommendation">
                <span>✓</span>

                <div>
                  <strong>
                    Recommended Action
                  </strong>

                  <p>
                    Review the machine load and operating
                    conditions.
                  </p>
                </div>
              </div>
            </>
          )}

          <button
            type="button"
            className="outline-button"
            onClick={() =>
              setPage("ai")
            }
          >
            Open AI Insights →
          </button>
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel motor-panel">
          <PanelHeader
            title={`Digital Twin — ${selectedMachineId}`}
            subtitle="Live machine condition"
            icon="◈"
          />

          <div className="motor-details">
            <div className="large-motor">
              <div className="digital-motor">
                <div className="dm-cylinder"></div>
                <div className="dm-body"></div>
                <div className="dm-top"></div>
                <div className="dm-base"></div>
              </div>

              <span className="live-pill">
                ● LIVE
              </span>
            </div>

            <div className="machine-specs">
              <div className="machine-name-row">
                <div>
                  <h3>
                    {selectedMachineId}
                  </h3>

                  <span>
                    {motor?.type}
                  </span>
                </div>

                <b className="normal-pill">
                  ●{" "}
                  {motor?.status === "Waiting"
                    ? "Waiting"
                    : alertActive
                      ? "Attention"
                      : "Healthy"}
                </b>
              </div>

              <Spec
                label="Load"
                value={
                  motor?.power == null
                    ? "—"
                    : `${Math.min(100, Math.round((motor.power / 2.5) * 100))}%`
                }
              />

              <Spec
                label="Temperature"
                value={motor?.temperature == null ? "—" : `${motor.temperature} °C`}
              />

              <Spec
                label="Current"
                value={motor?.current == null ? "—" : `${motor.current} A`}
              />

              <Spec
                label="Power"
                value={motor?.power == null ? "—" : `${motor.power} kW`}
              />

              <Spec
                label="Voltage"
                value={motor?.voltage == null ? "—" : `${motor.voltage} V`}
              />

              <Spec
                label="Vibration"
                value={motor?.vibration == null ? "—" : `${motor.vibration} mm/s`}
              />

              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setPage("machines")
                }
              >
                View all machines →
              </button>
            </div>
          </div>
        </div>

        <div className="panel simulator-panel">
          <PanelHeader
            title="What-If Simulator"
            subtitle="AI-powered scenario planning"
            icon="◇"
          />

          <div className="sim-question">
            What if{" "}
            <strong>
              Motor-01
            </strong>{" "}
            runs fewer hours?
          </div>

          <div className="runtime-row">
            <span>
              Machine Runtime
            </span>

            <strong>
              {runtime}h
            </strong>
          </div>

          <input
            className="runtime-slider"
            type="range"
            min="2"
            max="8"
            value={runtime}
            onChange={(event) =>
              setRuntime(
                Number(
                  event.target.value
                )
              )
            }
          />

          <div className="runtime-labels">
            <span>2h</span>
            <span>8h</span>
          </div>

          <div className="simulation-result">
            <span>
              AI predicts potential savings
            </span>

            <h3>
              {whatIf.energySaving ?? "—"}
              <small>
                {" "}
                kWh/day
              </small>
            </h3>
          </div>

          <div className="saving-grid">
            <div>
              <span>
                Energy
              </span>

              <strong>
                ↓ {whatIf.energySaving ?? "—"} kWh
              </strong>
            </div>

            <div>
              <span>
                Cost
              </span>

              <strong>
                ↓ ₹{whatIf.costSaving ?? "—"}
              </strong>
            </div>

            <div>
              <span>
                CO₂
              </span>

              <strong>
                ↓ {whatIf.co2Saving ?? "—"} kg
              </strong>
            </div>
          </div>

          <button
            type="button"
            className="outline-button"
            onClick={() =>
              setPage("analytics")
            }
          >
            Explore Scenarios →
          </button>
        </div>
      </section>

      <section className="quick-stats">
        <div>
          <span>
            Energy Today
          </span>

          <strong>
            {motor?.energy == null ? "—" : `${motor.energy} kWh`}
          </strong>
        </div>

        <div>
          <span>
            Cost Today
          </span>

          <strong>
            {motor?.cost == null ? "—" : `₹${motor.cost}`}
          </strong>
        </div>

        <div>
          <span>
            Frequency
          </span>

          <strong>
            {motor?.frequency == null ? "—" : `${motor.frequency} Hz`}
          </strong>
        </div>

        <div>
          <span>
            Power Factor
          </span>

          <strong>
            {motor?.powerFactor == null ? "—" : motor.powerFactor}
          </strong>
        </div>
      </section>
    </div>
  );
}

/* =========================================================
   METRIC CARD
   ========================================================= */

function MetricCard({
  icon,
  title,
  value,
  unit,
  machine,
  tone,
}) {
  return (
    <div
      className={`metric-card ${tone}`}
    >
      <div className="metric-top">
        <div className="metric-icon">
          {icon}
        </div>

        <span>
          {title}
        </span>
      </div>

      <div className={`metric-value ${value == null ? "metric-awaiting" : ""}`}>
        {value == null ? "—" : value}
        {value != null && (
          <small>
            {unit}
          </small>
        )}
      </div>

      <div className="metric-machine">
        <span>●</span>
        {machine}
      </div>
    </div>
  );
}

/* =========================================================
   PANEL HEADER
   ========================================================= */

function PanelHeader({
  title,
  subtitle,
  icon,
}) {
  return (
    <div className="panel-header">
      <div className="panel-icon">
        {icon}
      </div>

      <div>
        <h2>
          {title}
        </h2>

        <p>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   SPEC
   ========================================================= */

function Spec({
  label,
  value,
}) {
  return (
    <div className="spec-row">
      <span>
        {label}
      </span>

      <strong>
        {value == null ? "—" : value}
      </strong>
    </div>
  );
}

/* =========================================================
   CUSTOM TOOLTIP
   ========================================================= */

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="custom-chart-tooltip">
        <p className="tooltip-time">{`Time: ${label}`}</p>
        {payload.map((entry, index) => (
          <div key={`item-${index}`} className="tooltip-item" style={{ color: entry.color }}>
            <span className="tooltip-dot" style={{ backgroundColor: entry.color }}></span>
            <span className="tooltip-name">{entry.name}:</span>
            <span className="tooltip-val">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

/* =========================================================
   ENERGY CHART
   ========================================================= */

function EnergyChart({ history, currentValues }) {
  const [metric, setMetric] = useState("power");

  const metricMeta = {
    power: { label: "Active Power", unit: "kW", color: "#1e40af", fill: "#3b82f6", key: "power" },
    temp: { label: "Temperature", unit: "°C", color: "#047857", fill: "#10b981", key: "temp" },
    humidity: { label: "Humidity", unit: "%", color: "#6d28d9", fill: "#8b5cf6", key: "humidity" },
    current: { label: "Current", unit: "A", color: "#b45309", fill: "#f59e0b", key: "current" },
    voltage: { label: "Voltage", unit: "V", color: "#4338ca", fill: "#6366f1", key: "voltage" },
  };

  const activeMeta = metricMeta[metric] || metricMeta.power;

  const chartData = useMemo(() => {
    const baseTemp = currentValues?.temperature ?? 24.4;
    const baseHum = currentValues?.humidity ?? 65.7;
    const basePower = currentValues?.power ?? 1.15;
    const baseVolt = currentValues?.voltage ?? 230;
    const baseCurrent = currentValues?.current ?? (basePower ? Number((basePower * 1000 / baseVolt).toFixed(2)) : 5.0);

    let points = [];
    if (history && history.length >= 1) {
      points = history.map((pt) => {
        return {
          time: pt.time,
          power: pt.power ?? basePower,
          temp: pt.temp ?? baseTemp,
          humidity: pt.humidity ?? baseHum,
          voltage: pt.voltage ?? baseVolt,
          current: pt.current ?? baseCurrent,
        };
      });
    } else {
      const now = new Date();
      for (let i = 14; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 3000);
        const timeStr = t.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        });
        const waveP = Math.sin(i * 0.75) * 0.12;
        const waveT = Math.cos(i * 0.95) * 0.45;
        const waveH = Math.sin(i * 0.85) * 1.1;
        const waveV = Math.cos(i * 1.05) * 2.0;

        points.push({
          time: timeStr,
          power: Number((Math.max(0.1, basePower + waveP)).toFixed(2)),
          temp: Number((baseTemp + waveT).toFixed(1)),
          humidity: Number((baseHum + waveH).toFixed(1)),
          voltage: Math.round(baseVolt + waveV),
          current: Number((baseCurrent + waveP * 4.0).toFixed(2)),
        });
      }
    }
    return points;
  }, [history, currentValues, metric]);

  const stats = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { latest: "—", min: "—", max: "—", avg: "—" };
    }
    const vals = chartData.map((d) => d[activeMeta.key]).filter((v) => v != null && !isNaN(v));
    if (vals.length === 0) return { latest: "—", min: "—", max: "—", avg: "—" };

    const latest = vals[vals.length - 1];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;

    return {
      latest: `${latest} ${activeMeta.unit}`,
      min: `${min.toFixed(1)} ${activeMeta.unit}`,
      max: `${max.toFixed(1)} ${activeMeta.unit}`,
      avg: `${avg.toFixed(1)} ${activeMeta.unit}`,
    };
  }, [chartData, activeMeta]);

  return (
    <div className="industrial-chart-container">
      <div className="ind-chart-topbar">
        <div className="ind-meta-left">
          <div className="ind-status-tag">
            <span className="ind-live-dot"></span>
            LIVE HARDWARE STREAM
          </div>
          <h3 className="ind-title">{activeMeta.label} Telemetry</h3>
        </div>

        <div className="ind-metric-selector">
          {Object.keys(metricMeta).map((key) => (
            <button
              key={key}
              type="button"
              className={`ind-tab ${metric === key ? "active" : ""}`}
              onClick={() => setMetric(key)}
            >
              {metricMeta[key].label}
            </button>
          ))}
        </div>
      </div>

      <div className="ind-stats-bar">
        <div className="ind-stat-item">
          <span className="ind-stat-label">CURRENT</span>
          <span className="ind-stat-value" style={{ color: activeMeta.color }}>
            {stats.latest}
          </span>
        </div>
        <div className="ind-stat-divider"></div>
        <div className="ind-stat-item">
          <span className="ind-stat-label">5-MIN AVERAGE</span>
          <span className="ind-stat-value">{stats.avg}</span>
        </div>
        <div className="ind-stat-divider"></div>
        <div className="ind-stat-item">
          <span className="ind-stat-label">MINIMUM</span>
          <span className="ind-stat-value">{stats.min}</span>
        </div>
        <div className="ind-stat-divider"></div>
        <div className="ind-stat-item">
          <span className="ind-stat-label">PEAK MAXIMUM</span>
          <span className="ind-stat-value">{stats.max}</span>
        </div>
      </div>

      <div className="ind-chart-wrapper">
        <ResponsiveContainer width="100%" height={310}>
          <AreaChart data={chartData} margin={{ top: 15, right: 20, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="indAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={activeMeta.fill} stopOpacity={0.25} />
                <stop offset="95%" stopColor={activeMeta.fill} stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
            <YAxis domain={["dataMin - 0.2", "dataMax + 0.2"]} stroke="#94a3b8" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}`} />
            
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="ind-tooltip">
                      <div className="ind-tooltip-time">{label}</div>
                      <div className="ind-tooltip-row">
                        <span className="ind-tooltip-dot" style={{ background: activeMeta.color }}></span>
                        <span>{activeMeta.label}:</span>
                        <strong>{payload[0].value} {activeMeta.unit}</strong>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />

            <Area
              type="monotone"
              dataKey={activeMeta.key}
              name={activeMeta.label}
              stroke={activeMeta.color}
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#indAreaGradient)"
              dot={false}
              activeDot={{ r: 6, fill: activeMeta.color, stroke: "#ffffff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* =========================================================
   ENERGY PAGE
   ========================================================= */

function EnergyPage({
  values,
  history,
}) {
  return (
    <PageContainer
      title="Energy Monitoring"
      subtitle="Detailed energy consumption intelligence"
    >
      <div className="large-chart-page">
        <EnergyChart history={history} currentValues={values} />
      </div>

      <div className="page-grid-4">
        <DataBox
          title="Current Power"
          value={values.power == null ? "—" : `${values.power} kW`}
        />

        <DataBox
          title="Energy Today"
          value={values.energy == null ? "—" : `${values.energy} kWh`}
        />

        <DataBox
          title="Peak Power"
          value="—"
        />

        <DataBox
          title="Daily Cost"
          value={values.cost == null ? "—" : `₹${values.cost}`}
        />
      </div>
    </PageContainer>
  );
}

/* =========================================================
   DIGITAL TWIN PAGE
   ========================================================= */

function DigitalTwinPage({
  machine,
}) {
  return (
    <PageContainer
      title="Digital Twin"
      subtitle={`Live virtual representation of ${machine?.id || "selected machine"}`}
    >
      <div className="digital-twin-page">
        <div className="huge-machine">
          <div className="digital-motor big">
            <div className="dm-cylinder"></div>
            <div className="dm-body"></div>
            <div className="dm-top"></div>
            <div className="dm-base"></div>
          </div>
        </div>

        <div className="twin-info">
          <span className="hero-tag">
            ● LIVE DIGITAL TWIN
          </span>

          <h2>
            {machine.id}
          </h2>

          <p>
            {machine.type}
          </p>

          <div className="twin-stat-grid">
            <DataBox
              title="Temperature"
              value={machine.temperature == null ? "—" : `${machine.temperature} °C`}
            />

            <DataBox
              title="Power"
              value={machine.power == null ? "—" : `${machine.power} kW`}
            />

            <DataBox
              title="Current"
              value={machine.current == null ? "—" : `${machine.current} A`}
            />

            <DataBox
              title="Voltage"
              value={machine.voltage == null ? "—" : `${machine.voltage} V`}
            />

            <DataBox
              title="Vibration"
              value={machine.vibration == null ? "—" : `${machine.vibration} mm/s`}
            />

            <DataBox
              title="Power Factor"
              value={machine.powerFactor == null ? "—" : machine.powerFactor}
            />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

/* =========================================================
   AI PAGE
   ========================================================= */

function AIPage({
  values,
  alertActive,
  machine,
}) {
  return (
    <PageContainer
      title="AI Insights"
      subtitle="Explainable AI for industrial energy decisions"
    >
      <div className="ai-page-grid">
        <div
          className={`big-ai-card ${
            values.health == null
              ? "ai-pending-state"
              : alertActive
                ? "ai-danger-state"
                : "ai-success-state"
          }`}
        >
          <div className="ai-orb">
            {values.health == null
              ? "◌"
              : alertActive
                ? "!"
                : "✓"}
          </div>

          <span>
            AI HEALTH SCORE
          </span>

          <h1>
            {values.health == null ? "—" : `${values.health}/100`}
          </h1>

          <p>
            {values.health == null
              ? "Awaiting live hardware data."
              : alertActive
                ? "Machine operating condition requires attention."
                : "Machine operating condition is currently healthy."}
          </p>
        </div>

        {values.health == null ? (
          <div className="hardware-waiting-card">
            <span>◌ HARDWARE DATA PENDING</span>
            <strong>AI health will be calculated from live sensor readings.</strong>
            <p>
              No machine values are assumed or pre-filled. Connect the ESP32/backend to activate condition analysis and recommendations.
            </p>
          </div>
        ) : !alertActive ? (
          <>
            <div className="insight-card">
              <span className="success-label">
                ✓ SYSTEM NORMAL
              </span>

              <h2>
                Energy usage is within normal range
              </h2>

              <p>
                AI analysis confirms that
                {machine?.id || "Selected machine"} is operating within its
                configured monitoring range.
              </p>

              <strong>
                No corrective action required.
              </strong>
            </div>

            <div className="insight-card">
              <span className="success-label">
                ✓ AI RECOMMENDATION
              </span>

              <h2>
                Continue optimized operation
              </h2>

              <p>
                Maintain the current operating
                pattern and continue real-time
                monitoring.
              </p>

              <strong>
                System efficiency is stable.
              </strong>
            </div>
          </>
        ) : (
          <>
            <div className="insight-card">
              <span className="warning-label">
                ⚠ DETECTED PATTERN
              </span>

              <h2>
                Higher power consumption detected
              </h2>

              <p>
                AI detected an energy pattern
                higher than the machine's expected
                operating baseline.
              </p>

              <strong>
                Action: Inspect motor load
              </strong>
            </div>

            <div className="insight-card warning">
              <span className="warning-label">
                ⚠ AI RECOMMENDATION
              </span>

              <h2>
                Reduce unnecessary idle operation
              </h2>

              <p>
                Check motor loading and reduce
                unnecessary high-load operation.
              </p>

              <strong>
                Potential energy optimization
                available.
              </strong>
            </div>
          </>
        )}
      </div>
    </PageContainer>
  );
}

/* =========================================================
   ANALYTICS PAGE
   ========================================================= */

function AnalyticsPage({
  values,
  history,
}) {
  return (
    <PageContainer
      title="Analytics"
      subtitle="Operational performance & scenario analysis"
    >
      <div className="analytics-grid">
        <DataBox
          title="Energy Efficiency"
          value={values.health == null ? "—" : "96.4%"}
        />

        <DataBox
          title="Baseline Improvement"
          value={values.health == null ? "—" : "+4.2%"}
        />

        <DataBox
          title="Peak Time"
          value={values.health == null ? "—" : "14:30"}
        />

        <DataBox
          title="AI Confidence"
          value={values.health == null ? "—" : `${values.health}%`}
        />
      </div>

      <div className="panel analytics-panel">
        <PanelHeader
          title="Energy Trend"
          subtitle="Daily consumption behavior"
          icon="◔"
        />

        <EnergyChart history={history} currentValues={values} />
      </div>
    </PageContainer>
  );
}

/* =========================================================
   ALERTS PAGE
   ========================================================= */

function AlertsPage({
  values,
  alertActive,
}) {
  return (
    <PageContainer
      title="Alerts"
      subtitle="Machine safety and energy anomalies"
    >
      <div
        className={`alert-page-card ${
          alertActive
            ? ""
            : "resolved"
        }`}
      >
        <div className="alert-big-icon">
          {alertActive
            ? "!"
            : "✓"}
        </div>

        <div>
          <span
            className={
              alertActive
                ? "warning-label"
                : "success-label"
            }
          >
            {alertActive
              ? "ACTIVE ALERT"
              : "SYSTEM NORMAL"}
          </span>

          <h2>
            {alertActive
              ? "Abnormal Energy Usage Detected"
              : "No Active Energy Alert"}
          </h2>

          <p>
            {values.health == null
              ? "Connect the machine sensors to begin safety and energy monitoring."
              : alertActive
                ? `Selected machine is operating outside its normal energy pattern. Current power: ${values.power ?? "—"} kW.`
                : "Selected machine is operating within its normal energy pattern."}
          </p>

          {alertActive ? (
            <strong>
              Likely cause: Overloading ·
              Action: Inspect motor load
            </strong>
          ) : (
            <strong>
              ✓ All monitored values are
              within safe operating limits.
            </strong>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

/* =========================================================
   MACHINES PAGE
   ========================================================= */

function MachinesPage({
  machines,
}) {
  return (
    <PageContainer
      title="Machines"
      subtitle="Individual machine monitoring"
    >
      <div className="machines-grid">
        {machines.map(
          (machine) => (
            <div
              className="machine-card"
              key={machine.id}
            >
              <div className="machine-card-top">
                <div className="machine-card-icon">
                  {machine.icon}
                </div>

                <span
                  className={`machine-status ${(machine.status || "Waiting").toLowerCase()}`}
                >
                  ●{" "}
                  {machine.status || "Waiting"}
                </span>
              </div>

              <h2>
                {machine.id}
              </h2>

              <p>
                {machine.type}
              </p>

              <div className="machine-values">
                <DataBox
                  title="Power"
                  value={machine.power == null ? "—" : `${machine.power} kW`}
                />

                <DataBox
                  title="Temp"
                  value={machine.temperature == null ? "—" : `${machine.temperature} °C`}
                />

                <DataBox
                  title="Current"
                  value={machine.current == null ? "—" : `${machine.current} A`}
                />

                <DataBox
                  title="Voltage"
                  value={machine.voltage == null ? "—" : `${machine.voltage} V`}
                />

                <DataBox
                  title="Vibration"
                  value={machine.vibration == null ? "—" : `${machine.vibration} mm/s`}
                />
              </div>
            </div>
          )
        )}
      </div>
    </PageContainer>
  );
}

/* =========================================================
   MACHINE CONTROL
   ========================================================= */

function ControlPage({
  relay,
  setRelay,
  cooling,
  setCooling,
  values,
}) {
  return (
    <PageContainer
      title="Machine Control"
      subtitle="Intelligent safety & thermal management"
    >
      <div className="control-panel">
        <ControlRow
          icon="ϟ"
          title="Machine Relay"
          description="Machine connected to power supply"
          value={relay}
          setValue={setRelay}
        />

        <ControlRow
          icon="❄"
          title="Cooling System"
          description="Automatic cooling management"
          value={cooling}
          setValue={setCooling}
        />

        <div className="control-live-values">
          <div>
            <span>
              Temperature
            </span>

            <strong>
              {values.temperature == null ? "—" : `${values.temperature}°C`}
            </strong>
          </div>

          <div>
            <span>
              Current
            </span>

            <strong>
              {values.current == null ? "—" : `${values.current}A`}
            </strong>
          </div>

          <div>
            <span>
              Power
            </span>

            <strong>
              {values.power == null ? "—" : `${values.power}kW`}
            </strong>
          </div>
        </div>

        <button
          type="button"
          className="emergency-button"
          onClick={() => setRelay(false)}
        >
          ⚠ EMERGENCY SHUTDOWN
        </button>
      </div>
    </PageContainer>
  );
}

/* =========================================================
   CONTROL ROW
   ========================================================= */

function ControlRow({
  icon,
  title,
  description,
  value,
  setValue,
}) {
  return (
    <div className="control-row">
      <div className="control-icon">
        {icon}
      </div>

      <div className="control-copy">
        <h3>
          {title}
        </h3>

        <p>
          {description}
        </p>
      </div>

      <div className="on-off">
        <button
          type="button"
          className={
            value
              ? "selected"
              : ""
          }
          onClick={() =>
            setValue(true)
          }
        >
          ON
        </button>

        <button
          type="button"
          className={
            !value
              ? "selected off"
              : ""
          }
          onClick={() =>
            setValue(false)
          }
        >
          OFF
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   REPORTS PAGE
   ========================================================= */

function ReportsPage() {
  return (
    <PageContainer
      title="Reports"
      subtitle="Energy performance summary"
    >
      <div className="report-card">
        <div>
          <span>
            MONTHLY ENERGY REPORT
          </span>

          <h2>
            {new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </h2>

          <p>
            EnerTwin AI analyzed machine energy
            behavior and identified opportunities
            for operational savings.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
        >
          Generate Report ↓
        </button>
      </div>
    </PageContainer>
  );
}

/* =========================================================
   NOTIFICATIONS PAGE
   ========================================================= */

function NotificationsPage({
  alertActive,
}) {
  return (
    <PageContainer
      title="Notifications"
      subtitle="Latest EnerTwin AI system notifications"
    >
      <div className="notification-list">
        <div className="notification-item">
          <div className="notification-icon green">
            ✓
          </div>

          <div>
            <strong>
              Digital Twin is Live
            </strong>

            <p>
              Motor-01 telemetry is being
              monitored successfully.
            </p>
          </div>

          <span>
            Now
          </span>
        </div>

        {alertActive ? (
          <div className="notification-item warning-item">
            <div className="notification-icon red">
              !
            </div>

            <div>
              <strong>
                Abnormal Energy Usage
              </strong>

              <p>
                Motor-01 is operating above
                its normal pattern.
              </p>
            </div>

            <span>
              Now
            </span>
          </div>
        ) : (
          <div className="notification-item">
            <div className="notification-icon green">
              ✓
            </div>

            <div>
              <strong>
                Energy Alert Cleared
              </strong>

              <p>
                Motor-01 has returned to normal
                operating conditions.
              </p>
            </div>

            <span>
              Now
            </span>
          </div>
        )}

        <div className="notification-item">
          <div className="notification-icon blue">
            ✦
          </div>

          <div>
            <strong>
              AI Monitoring Updated
            </strong>

            <p>
              EnerTwin AI is continuously
              analyzing machine behavior.
            </p>
          </div>

          <span>
            Live
          </span>
        </div>
      </div>
    </PageContainer>
  );
}

/* =========================================================
   SETTINGS PAGE
   ========================================================= */

function SettingsPage({
  autoRefresh,
  setAutoRefresh,
}) {
  return (
    <PageContainer
      title="Settings"
      subtitle="Configure EnerTwin AI monitoring preferences"
    >
      <div className="settings-card">
        <div>
          <h3>
            Auto Refresh
          </h3>

          <p>
            Automatically update machine values
            every 3 seconds.
          </p>
        </div>

        <button
          type="button"
          aria-label="Toggle auto refresh"
          className={`settings-switch ${
            autoRefresh
              ? "active"
              : ""
          }`}
          onClick={() =>
            setAutoRefresh(
              !autoRefresh
            )
          }
        >
          <span></span>
        </button>
      </div>

      <div className="settings-card">
        <div>
          <h3>
            Digital Twin Monitoring
          </h3>

          <p>
            Continuous virtual machine condition
            monitoring.
          </p>
        </div>

        <span className="enabled-label">
          ENABLED
        </span>
      </div>
    </PageContainer>
  );
}

/* =========================================================
   COMMON PAGE CONTAINER
   ========================================================= */

function PageContainer({
  title,
  subtitle,
  children,
}) {
  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <span className="page-kicker">
            ENERTWIN AI
          </span>

          <h1>
            {title}
          </h1>

          <p>
            {subtitle}
          </p>
        </div>
      </div>

      {children}
    </div>
  );
}

/* =========================================================
   DATA BOX
   ========================================================= */

function DataBox({
  title,
  value,
}) {
  return (
    <div className="data-box">
      <span>
        {title}
      </span>

      <strong>
        {value == null ? "—" : value}
      </strong>
    </div>
  );
}

/* =========================================================
   EXPORT
   ========================================================= */

export default App;