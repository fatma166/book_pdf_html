import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;

const url =
  "https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=" +
  API_KEY;

async function run() {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: "اكتب جملة ترحيب قصيرة" }],
        },
      ],
    }),
  });

  const data = await res.json();

  if (!data.candidates || data.candidates.length === 0) {
    console.error("❌ Gemini returned no candidates");
    console.error(JSON.stringify(data, null, 2));
    return;
  }

  console.log("✅ Gemini Response:");
  console.log(data.candidates[0].content.parts[0].text);
}

run();
