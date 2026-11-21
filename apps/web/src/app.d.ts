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
  }
}

export {};
