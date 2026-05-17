import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function check() {
  try {
    console.log("Querying local API...");
    const mongoose = require("mongoose");
    const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai-therapist";
    await mongoose.connect(mongoUri);
    const { User } = require("../src/models/User");
    const user = await User.findOne({});
    if (!user) {
      console.log("No user found in DB!");
      await mongoose.disconnect();
      return;
    }
    console.log("Testing with User:", user.email, "ID:", user._id);

    // Let's generate a JWT token for this user
    const jwt = require("jsonwebtoken");
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || "your-secret-key");
    await mongoose.disconnect();

    // Call local server
    const res = await axios.get("http://localhost:3001/chat/sessions", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    console.log("Sessions returned by local API GET /chat/sessions:");
    console.log(res.data);
  } catch (error: any) {
    console.error("API Call failed:", error.message);
    if (error.response) {
      console.error(error.response.data);
    }
  }
}

check().catch(console.error);
