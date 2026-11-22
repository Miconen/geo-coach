import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { processingRunPurposeSchema } from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { extractBearerToken, verifyApiToken } from "../auth/index.js";
import {
  mcpAddCallLabels,
  mcpAddLearnings,
  mcpFinishRun,
  mcpGetInstructions,
  mcpListWork,
  mcpReadRange,
  mcpStartRun,
} from "./workflow.js";

export function createGeoCoachMcpServer(db: AppDb, playerId: string): McpServer {
  const server = new McpServer({
    name: "geo-coach",
    version: "0.1.0",
  });

  server.tool(
    "get_instructions",
    "Return the versioned processing instructions for extract, tips or calls runs.",
    {
      purpose: processingRunPurposeSchema,
    },
    async ({ purpose }) => {
      const res = await mcpGetInstructions(purpose);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "list_work",
    "List unprocessed or stale Session ranges (~25k token Game-aligned chunks) for a Processing run purpose.",
    {
      purpose: processingRunPurposeSchema,
      duo: z.string().optional(),
    },
    async ({ purpose, duo }) => {
      const res = await mcpListWork(db, playerId, { purpose, duo });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "start_run",
    "Start an open Processing run over one UTC interval inside a Session.",
    {
      sessionId: z.string().uuid(),
      startUtc: z.string().datetime(),
      endUtc: z.string().datetime(),
      purpose: processingRunPurposeSchema,
      agent: z.string().min(1),
      model: z.string().min(1),
      duo: z.string().optional(),
    },
    async (args) => {
      const res = await mcpStartRun(db, playerId, args);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "read_range",
    "Read an open Processing run's range. extract/tips: compact transcript, Round markers, ±2 min uncitable context, existing Learnings, and topic tags. calls: the Split and Spread Rounds with both teams' guessed countries and Regions and the Utterances spoken while guessing.",
    {
      runId: z.string().uuid(),
    },
    async ({ runId }) => {
      const res = await mcpReadRange(db, playerId, runId);
      if (res.purpose === "calls") {
        const text = [
          `Run: ${res.runId} (calls)`,
          `Range: ${res.rangeStart} .. ${res.rangeEnd} (${res.rounds.length} Split/Spread Rounds, ${res.citableUtteranceCount} citable utterances)`,
          "",
          res.transcript,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }
      const header = [
        `Run: ${res.runId} (${res.purpose})`,
        `Range: ${res.rangeStart} .. ${res.rangeEnd} (${res.citableUtteranceCount} citable utterances)`,
        `Existing topics: ${res.existingTopics.join(", ") || "(none)"}`,
        `Existing Learnings in range: ${JSON.stringify(res.existingLearnings)}`,
        "",
        res.transcript,
      ].join("\n");
      return {
        content: [{ type: "text", text: header }],
      };
    },
  );

  server.tool(
    "add_learnings",
    "Add a batch of Learnings to an open Processing run. Valid items are saved even if other items fail validation.",
    {
      runId: z.string().uuid(),
      items: z.array(z.record(z.unknown())).min(1),
    },
    async ({ runId, items }) => {
      const res = await mcpAddLearnings(db, playerId, runId, items);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "add_call_labels",
    "Add a batch of Call labels to an open calls Processing run: { roundId, called, utteranceRefs, note? } per Split or Spread Round. Valid items are saved even if other items fail validation.",
    {
      runId: z.string().uuid(),
      items: z.array(z.record(z.unknown())).min(1),
    },
    async ({ runId, items }) => {
      const res = await mcpAddCallLabels(db, playerId, runId, items);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "finish_run",
    "Finish a Processing run so its Learnings or Call labels take effect and inputs are snapshotted.",
    {
      runId: z.string().uuid(),
    },
    async ({ runId }) => {
      const res = await mcpFinishRun(db, playerId, runId);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  // Also register MCP prompts per purpose
  server.prompt("extract", "Extract Learnings from a geo-coach Session", async () => {
    const { instructions } = await mcpGetInstructions("extract");
    return {
      messages: [{ role: "user", content: { type: "text", text: instructions } }],
    };
  });

  server.prompt("tips", "Add GeoGuessr Tips prompted by a geo-coach Session", async () => {
    const { instructions } = await mcpGetInstructions("tips");
    return {
      messages: [{ role: "user", content: { type: "text", text: instructions } }],
    };
  });

  server.prompt("calls", "Label Calls on Split and Spread Rounds in a geo-coach Session", async () => {
    const { instructions } = await mcpGetInstructions("calls");
    return {
      messages: [{ role: "user", content: { type: "text", text: instructions } }],
    };
  });

  return server;
}

/**
 * Handles stateless Streamable HTTP MCP requests on `/mcp`,
 * authenticated with a per-Player `mcp`-scoped bearer token.
 */
export async function handleMcpHttpRequest(db: AppDb, request: Request): Promise<Response> {
  const rawToken = extractBearerToken(request.headers);
  if (!rawToken) {
    return new Response(JSON.stringify({ error: "Missing mcp bearer token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const verified = await verifyApiToken(db, rawToken, "mcp");
  if (!verified) {
    return new Response(
      JSON.stringify({ error: "Invalid, expired, or wrong-scope mcp bearer token" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const server = createGeoCoachMcpServer(db, verified.player.id);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
