declare global {
  namespace App {
    interface Locals {
      player: {
        id: string;
        discordId: string;
        displayName: string;
        geoguessrUserId: string | null;
        geoguessrName: string | null;
        avatarColor: string;
      } | null;
      sessionId: string | null;
    }
    /** Shallow-routing state (ADR 0007): view state lives here, the URL is the cold-load fallback. */
    interface PageState {
      focus?: string;
      filter?: string;
    }
  }
}

export {};
