import mongoose from "mongoose";
import dotenv from "dotenv";
import { ChatSession } from "../src/models/ChatSession";

dotenv.config();

async function run() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai-therapist";
  await mongoose.connect(mongoUri);

  const userId = new mongoose.Types.ObjectId("69f9844f8a475c0f76932a5d");
  const sessions = await ChatSession.find({ 
    userId,
    status: { $ne: "archived" },
    "messages.0": { $exists: true }
  }).select("sessionId title status");

  console.log("Sessions found with filter status $ne archived:");
  console.log(sessions);

  await mongoose.disconnect();
}

run().catch(console.error);
