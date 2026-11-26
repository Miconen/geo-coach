declare global {
  namespace App {
    interface Locals {
      player: {
        id: string;
        discordId: string;
        displayName: string;
        geoguessrUserId: string | null;
        geoguessrName: string | null;
        /** The stored Player colour choice (#74); resolve it with resolvePlayerColors. */
        color: string | null;
      } | null;
      sessionId: string | null;
      /** The session store could not be read; cookie routes answer 503 (assertAuthAvailable). */
      authUnavailable: boolean;
    }
    /** Shallow-routing state (ADR 0007): view state lives here, the URL is the cold-load fallback. */
    interface PageState {
      /** The shallow URL's query (url-state.ts, #73): page.url keeps the loaded URL after pushState/replaceState. */
      query?: string;
      focus?: string;
      filter?: string;
      /** The debrief view's Game, Round, country and drawer (#79). */
      debrief?: Record<"game" | "round" | "country" | "drawer", string | null>;
    }
  }
}

export {};
