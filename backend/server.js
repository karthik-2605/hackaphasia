const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
const PORT = 8000;

const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const upload = multer({ dest: "uploads/" });

app.use(express.json());

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "9820256@MajorK",
  database: "health_care",
});

app.use(express.static(path.join(__dirname, "../frontend/dist")));

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  // Hardcoded users
  const users = [
    { email: "alice@gmail.com", password: "123", role: "refugee" },
    { email: "drbob@doc.com", password: "123", role: "doctor" },
    { email: "carl@aid.com", password: "123", role: "coordinator" },
  ];

  const user = users.find(
    (u) => u.email === email && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // For demo: determine role by email string
  if (email.includes("gmail.com")) {
    user.role = "refugee";
  } else if (email.includes("doc")) {
    user.role = "doctor";
  } else if (email.includes("aid")) {
    user.role = "coordinator";
  }

  res.json({ role: user.role });
});



app.post("/api/refugee-report", upload.single("voice_input"), async (req, res) => {
  try {
    let { name, text_input, location } = req.body;
    let finalText = text_input;

    // If voice input exists, send to Sarvam STT
    if (req.file) {
      const formData = new FormData();
      formData.append("file", fs.createReadStream(req.file.path));
      formData.append("language", "auto");

      const sarvamRes = await axios.post("https://api.sarvam.ai/speech-to-text", formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: "sk_vdqgqp2s_Xm4zW7Ao7UjMumYZEWOwGOt3",
        },
      });

      finalText = sarvamRes.data.transcript;
      fs.unlinkSync(req.file.path); // cleanup temp file
    }

    // Translate if not English
    const translateRes = await axios.post("https://libretranslate.de/translate", {
      q: finalText,
      source: "auto",
      target: "en",
    }, { headers: { "Content-Type": "application/json" } });

    const englishText = translateRes.data.translatedText;

    // Example: save in DB or just return
    const report = {
      name,
      location,
      original_text: finalText,
      english_text: englishText,
    };

    res.json({ message: "Report received", report });
  } catch (err) {
    console.error("Refugee report error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to process report" });
  }
});




app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const filePath = req.file.path;

    // Prepare form-data for Sarvam
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("model", "saaramsha"); // Example model name, replace with actual
    formData.append("language", "auto");   // Detect language automatically

    const response = await axios.post("https://api.sarvam.ai/speech-to-text", formData, {
      headers: {
        ...formData.getHeaders(),
        "Authorization": "sk_vdqgqp2s_Xm4zW7Ao7UjMumYZEWOwGOt3", // keep your key in .env
      },
    });

    // Delete local temp file after sending
    fs.unlinkSync(filePath);

    res.json({ transcript: response.data.transcript });
  } catch (err) {
    console.error("Sarvam API error:", err.response?.data || err.message);
    res.status(500).json({ error: "Sarvam transcription failed" });
  }
});





// POST /api/campaigns
app.post("/api/campaigns", async (req, res) => {
  try {
    const {
      title,
      description,
      location_name,
      latitude,
      longitude,
      date,
      participants,
      tags,
      status,
    } = req.body;

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

    res.json({
      id: result.insertId,
      title,
      description,
      location_name,
      latitude,
      longitude,
      date,
      participants,
      tags,
      status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB insert failed" });
  }
});


app.get("/api/campaigns", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM campaigns");

    const formatted = rows.map((c) => ({
      ...c,
      tags: typeof c.tags === "string" ? JSON.parse(c.tags) : c.tags,
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB fetch failed" });
  }
});





// PUT (edit) a campaign by id
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

// DELETE a campaign by id
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



app.get(/.*/, (req, res) => {
  res.sendFile(
    path.join(__dirname, "../frontend/dist", "index.html")
  );
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
