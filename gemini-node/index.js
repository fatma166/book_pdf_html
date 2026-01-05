import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function run() {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.0-pro", // ✅ الموديل الصحيح
  });

  const result = await model.generateContent("اكتبلي جملة ترحيب قصيرة");
  console.log(result.response.text());
}

run();
