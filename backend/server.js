// backend/server.mjs

import path from "path";
import express from "express";
import mysql from "mysql2/promise";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Environment / API keys
const SARVAM_API_KEY = "sk_hfyawqb0_IWv6LThQ184Os3E0a5z38WdW";

const app = express();
const PORT = 8000;

// Multer for uploads
const upload = multer({ dest: "uploads/" });

// MySQL connection
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "9820256@MajorK",
  database: "health_care",
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend/dist")));

// ---------------------- LOGIN ----------------------
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  const users = [
    { email: "alice@gmail.com", password: "123", role: "refugee" },
    { email: "drbob@doc.com", password: "123", role: "doctor" },
    { email: "carl@aid.com", password: "123", role: "coordinator" },
  ];

  const user = users.find((u) => u.email === email && u.password === password);

  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  if (email.includes("gmail.com")) user.role = "refugee";
  else if (email.includes("doc")) user.role = "doctor";
  else if (email.includes("aid")) user.role = "coordinator";

  res.json({ role: user.role });
});

// ---------------------- SYMPTOM DATABASE ----------------------
const symptomDatabase = {
  headache: {
    causes: ["Dehydration", "Stress", "Migraine", "Tension"],
    nextSteps: ["Drink water", "Rest in a quiet room", "Take OTC painkillers if necessary"],
  },
  fever: {
    causes: ["Viral infection", "Bacterial infection"],
    nextSteps: ["Take temperature regularly", "Stay hydrated", "See a doctor if >102°F"],
  },
  cough: {
    causes: ["Common cold", "Flu", "Allergies"],
    nextSteps: ["Drink warm fluids", "Use cough syrup", "Avoid allergens"],
  },
  nausea: {
    causes: ["Food poisoning", "Stomach flu", "Pregnancy"],
    nextSteps: ["Drink clear fluids", "Rest", "Avoid heavy meals"],
  },
  fatigue: {
    causes: ["Lack of sleep", "Stress", "Anemia"],
    nextSteps: ["Get adequate rest", "Eat iron-rich foods", "Exercise lightly"],
  },
};

// Local symptom analysis helper
function analyzeSymptoms(text) {
  if (!text) return [];

  const symptomsDB = [
    {
      keyword: "fever",
      causes: ["Infection", "Flu", "COVID-19"],
      nextSteps: ["Rest", "Drink fluids", "Consult a doctor if persists"],
    },
    {
      keyword: "cough",
      causes: ["Cold", "Bronchitis", "Allergy"],
      nextSteps: ["Steam inhalation", "Honey & warm fluids", "See doctor if severe"],
    },
    {
      keyword: "headache",
      causes: ["Tension", "Migraine", "Dehydration"],
      nextSteps: ["Rest in dark room", "Hydrate", "Pain relief if needed"],
    },
    {
      keyword: "fatigue",
      causes: ["Anemia", "Sleep deprivation", "Infection"],
      nextSteps: ["Rest", "Balanced diet", "Medical checkup if persistent"],
    },
    // Add more symptoms here...
  ];

    const lowerText = text.toLowerCase();
  const analysis = [];
  for (const symptom of symptomsDB) {
    if (lowerText.includes(symptom.keyword)) {
      analysis.push({ symptom: symptom.keyword, causes: symptom.causes, nextSteps: symptom.nextSteps });
    }
  }
  return analysis;
}

// ----------------- REFUGEE REPORT -----------------
app.post("/api/refugee-report", upload.single("voice_input"), async (req, res) => {
  try {
    let { name, text_input, location } = req.body;
    let finalText = text_input || "";
    let latitude = null, longitude = null;

    console.log("📩 Incoming refugee report...");
    console.log("👉 Name:", name);
    console.log("👉 Text input:", text_input);
    console.log("👉 Location (raw):", location);
    console.log("👉 Voice file received:", req.file ? req.file.originalname : "None");

    // Parse location
    if (location && location !== "unknown") {
      [latitude, longitude] = location.split(",").map(Number);
      console.log("📍 Parsed location:", latitude, longitude);
    }

    // 🎤 Voice to text
    if (req.file) {
      console.log("🎙️ Audio file path:", req.file.path);
      const formData = new FormData();
      formData.append("file", fs.createReadStream(req.file.path));
      formData.append("language", "auto");

      console.log("📤 Sending audio to Sarvam for transcription...");
      const sarvamRes = await axios.post(
        "https://api.sarvam.ai/speech-to-text",
        formData,
        { headers: { ...formData.getHeaders(), 
            // Authorization: `Bearer ${SARVAM_API_KEY}` ,
            "api_subscription_key": SARVAM_API_KEY
            
        } }
      );

      console.log("📥 Sarvam raw response:", sarvamRes.data);

      finalText =
        sarvamRes.data?.transcript ||
        sarvamRes.data?.text ||
        sarvamRes.data?.result?.text ||
        "";

      console.log("📝 Transcribed text:", finalText);
      fs.unlinkSync(req.file.path); // cleanup
    }

    finalText = finalText || "No input provided";
    console.log("✅ Final text after fallback:", finalText);

    // 🌍 Translate to English
    console.log("🌍 Translating to English...");
    const translateRes = await axios.post(
      "https://libretranslate.de/translate",
      { q: finalText, source: "auto", target: "en" },
      { headers: { "Content-Type": "application/json" } }
    );

    const englishText = translateRes.data?.translatedText || finalText;
    console.log("📝 Translated text (English):", englishText);

    // 🧠 Local symptom analysis
    const analysis = analyzeSymptoms(englishText);
    console.log("🧠 Symptom analysis:", analysis);

    // Save to DB
    const [result] = await db.query(
      `INSERT INTO refugee_reports (user_id, text_input, translated_input, medical_response, location_lat, location_lng)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [1, finalText, englishText, JSON.stringify(analysis), latitude, longitude]
    );

    console.log("💾 Report saved to DB with ID:", result.insertId);

    res.json({
      user: name,
      original_text: finalText,
      english_text: englishText,
      analysis,
      report_id: result.insertId,
    });
  } catch (err) {
    console.error("❌ Refugee report error:", err.response?.data || err.message || err);
    res.status(500).json({ error: "Failed to process report" });
  }
});


// ----------------- GET ALL MEDICAL REPORTS -----------------
app.get("/api/refugee-reports", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, user_id, text_input, translated_input, medical_response, location_lat, location_lng, created_at FROM refugee_reports ORDER BY created_at DESC");
    // Parse JSON
    const formatted = rows.map(r => ({
  ...r,
  medical_response: typeof r.medical_response === "string"
    ? JSON.parse(r.medical_response)
    : r.medical_response || [],
}));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// ---------------------- SARVAM TRANSCRIBE ----------------------
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("model", "saaramsha");
    formData.append("language", "auto");

    const response = await axios.post("https://api.sarvam.ai/speech-to-text", formData, {
      headers: { ...formData.getHeaders(), 
        // Authorization: `Bearer ${SARVAM_API_KEY}` 
        "api_subscription_key": SARVAM_API_KEY
    },
    });

    fs.unlinkSync(filePath);

    res.json({ transcript: response.data.transcript });
  } catch (err) {
    console.error("Sarvam API error:", err.response?.data || err.message);
    res.status(500).json({ error: "Sarvam transcription failed" });
  }
});

// ---------------------- CAMPAIGNS ----------------------
app.post("/api/campaigns", async (req, res) => {
  try {
    const { title, description, location_name, latitude, longitude, date, participants, tags, status } = req.body;
    const query = `
      INSERT INTO campaigns
      (title, description, location_name, latitude, longitude, date, participants, tags, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.query(query, [
      title,
      description,
      location_name,
      latitude,
      longitude,
      date,
      participants || 0,
      JSON.stringify(tags || []),
      status || "Planning",
    ]);

    res.json({ id: result.insertId, title, description, location_name, latitude, longitude, date, participants, tags, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB insert failed" });
  }
});

app.get("/api/campaigns", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM campaigns");
    const formatted = rows.map((c) => ({ ...c, tags: typeof c.tags === "string" ? JSON.parse(c.tags) : c.tags }));
    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB fetch failed" });
  }
});

app.put("/api/campaigns/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, location_name, latitude, longitude, date, participants, tags, status } = req.body;

  try {
    await db.query(
      `UPDATE campaigns SET title=?, description=?, location_name=?, latitude=?, longitude=?, date=?, participants=?, tags=?, status=? WHERE id=?`,
      [title, description, location_name, latitude, longitude, date, participants, JSON.stringify(tags), status, id]
    );

    res.json({ id: parseInt(id), ...req.body });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

app.delete("/api/campaigns/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM campaigns WHERE id=?", [id]);
    res.json({ message: "Campaign deleted successfully", id: parseInt(id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// ---------------------- STATIC FRONTEND ----------------------
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/dist", "index.html"));
});

// ---------------------- START SERVER ----------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
