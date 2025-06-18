import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ✅ Proxy endpoint to Pump.fun API
app.get("/tokens", async (req, res) => {
  try {
    const response = await fetch("https://pump.fun/api/tokens");
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Pump.fun API error:", err);
    res.status(500).json({ error: "Failed to fetch tokens." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Poseidon Pump Proxy running at http://localhost:${PORT}`);
});
