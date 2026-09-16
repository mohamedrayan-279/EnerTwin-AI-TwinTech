const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());
function analyzeEnergy(power, temperature) {
  let status;
  let recommendation;

  if (power > 2.75) {
    status = "HIGH";
    recommendation = "Reduce unnecessary machine load and check high-power equipment.";
  } else if (power > 2.55) {
    status = "MODERATE";
    recommendation = "Energy usage is slightly elevated. Monitor the equipment.";
  } else {
    status = "NORMAL";
    recommendation = "Energy consumption is within the normal range.";
  }

  return {
    status: status,
    recommendation: recommendation
  };
}
app.get("/", (req, res) => {
  res.json({
    message: "EnerTwin AI Backend is running",
    status: "OK"
  });
});
app.get("/api/sensor-data", (req, res) => {
  const temperature = 42 + Math.random() * 2;
  const power = 2.4 + Math.random() * 0.5;
  const voltage = 230;
  const current = power * 1000 / voltage;
const aiAnalysis = analyzeEnergy(power, temperature);
  res.json({
    temperature: Number(temperature.toFixed(1)),
    power: Number(power.toFixed(2)),
    voltage: voltage,
    current: Number(current.toFixed(2)),
    energyToday: 18.7,
    aiStatus: aiAnalysis.status,
    aiRecommendation: aiAnalysis.recommendation
  });
});
const PORT = 5000;

app.listen(PORT, () => {
  console.log(`EnerTwin AI Backend running on http://localhost:${PORT}`);
});