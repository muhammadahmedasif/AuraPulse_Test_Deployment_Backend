import dotenv from "dotenv";
// Load environment variables FIRST before any other imports
dotenv.config();

import "./types";
import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";
import authRouter     from "./routes/auth";
import chatRouter     from "./routes/chat";
import moodRouter     from "./routes/mood";
import activityRouter from "./routes/activity";
import userRouter     from "./routes/user";
import emergencyRouter from "./routes/emergency";
import twilioRouter   from "./routes/twilio";
import adminRouter    from "./routes/admin";
import { connectDB }  from "./utils/db";

// Create Express app
const app: any = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  // User UI (local dev)
  "http://localhost:3000",
  // Admin panel (local dev — Next.js picks the next available port if 3000 is taken)
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  // Deployed frontends (add your Vercel URLs here)
  "https://aura-pulse-test-deployment-backend.vercel.app",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Handle preflight OPTIONS requests for all routes
app.options("*", cors(corsOptions));

// Middleware
app.use(helmet()); // Security headers
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (Twilio)
app.use(morgan("dev")); // HTTP request logger

// Routes
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", message: "Server is running" });
});

// API Routes
app.use("/api/auth",      authRouter);
app.use("/api/chat",      chatRouter);
app.use("/api/mood",      moodRouter);
app.use("/api/activity",  activityRouter);
app.use("/api/user",      userRouter);
app.use("/api/emergency", emergencyRouter);
app.use("/api/twilio",    twilioRouter);
app.use("/api/admin",     adminRouter);

// Backward compatibility
app.use("/auth", authRouter);
app.use("/chat", chatRouter);
app.use("/mood", moodRouter);
app.use("/activity", activityRouter);
app.use("/user", userRouter);

// Error handling middleware
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    await connectDB();
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
