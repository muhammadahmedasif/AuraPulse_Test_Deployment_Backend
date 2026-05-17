import mongoose from "mongoose";
import dotenv from "dotenv";
import { ChatSession } from "../src/models/ChatSession";

dotenv.config();

async function check() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai-therapist";
  console.log("Connecting to:", mongoUri);
  await mongoose.connect(mongoUri);
  console.log("Connected!");

  const sessions = await ChatSession.find({}).select("sessionId title status userId");
  console.log("All Sessions in DB:");
  console.log(sessions);

  await mongoose.disconnect();
}

check().catch(console.error);
