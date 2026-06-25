import { CrisisContext } from "../crisis/crisis-types";

export interface ActiveWhatsAppSession {
  userId: string;
  sessionId: string;
  contactName: string;
  contactWhatsApp: string;
  crisisContext: CrisisContext;
  conversationHistory: { role: "system" | "user" | "assistant"; content: string }[];
  startedAt: Date;
}

// In-memory store for active WhatsApp sessions.
// Keyed by the contact's WhatsApp number (e.g. "+923001234567")
const sessions = new Map<string, ActiveWhatsAppSession>();

export const twilioWhatsAppSessionManager = {
  set(contactWhatsApp: string, session: ActiveWhatsAppSession): void {
    sessions.set(contactWhatsApp, session);
    // Auto-cleanup after 24h
    setTimeout(() => {
      sessions.delete(contactWhatsApp);
    }, 24 * 60 * 60 * 1000);
  },

  get(contactWhatsApp: string): ActiveWhatsAppSession | undefined {
    return sessions.get(contactWhatsApp);
  },

  updateHistory(contactWhatsApp: string, message: { role: "system" | "user" | "assistant"; content: string }): void {
    const session = sessions.get(contactWhatsApp);
    if (session) {
      session.conversationHistory.push(message);
    }
  },

  delete(contactWhatsApp: string): void {
    sessions.delete(contactWhatsApp);
  },
};
