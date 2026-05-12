/**
 * Twilio Session Manager
 * ─────────────────────────
 * In-memory store for active emergency call sessions.
 * Keyed by Twilio CallSid. Auto-clears after 30 minutes.
 */

import { ActiveCallSession } from "../crisis/crisis-types";

class TwilioSessionManager {
  private sessions = new Map<string, ActiveCallSession>();

  set(callSid: string, session: ActiveCallSession): void {
    this.sessions.set(callSid, session);
    // Auto-cleanup: calls shouldn't last more than 30 minutes
    setTimeout(() => this.sessions.delete(callSid), 30 * 60 * 1000);
  }

  get(callSid: string): ActiveCallSession | undefined {
    return this.sessions.get(callSid);
  }

  update(callSid: string, patch: Partial<ActiveCallSession>): void {
    const existing = this.sessions.get(callSid);
    if (existing) {
      this.sessions.set(callSid, { ...existing, ...patch });
    }
  }

  delete(callSid: string): void {
    this.sessions.delete(callSid);
  }

  has(callSid: string): boolean {
    return this.sessions.has(callSid);
  }
}

// Singleton
export const twilioSessionManager = new TwilioSessionManager();
