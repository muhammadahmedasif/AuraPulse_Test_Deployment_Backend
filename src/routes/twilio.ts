/**
 * Twilio Webhook Routes
 * ─────────────────────
 * These routes are called directly by Twilio — NO auth middleware.
 * Twilio signs its requests (X-Twilio-Signature header) — validation
 * can be added in production but is omitted here for FYP simplicity.
 */

import express from "express";
import {
  handleVoiceWebhook,
  handleVoiceRespond,
  handleCallStatus,
} from "../services/twilio/twilio-voice.controller";

const router = express.Router();

// Called by Twilio when the outbound call connects
router.post("/voice",         handleVoiceWebhook);

// Called by Twilio when the contact finishes speaking (Gather result)
router.post("/voice/respond", handleVoiceRespond);

// Called by Twilio on call status changes (ringing, completed, failed, etc.)
router.post("/voice/status",  handleCallStatus);

export default router;
