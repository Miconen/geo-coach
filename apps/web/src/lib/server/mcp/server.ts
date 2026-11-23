import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  claimStatusSchema,
  instructionPurposeSchema,
  isoCountryCodeSchema,
  processingRunPurposeSchema,
  sourceKindSchema,
} from "@geo-coach/shared";
import type { AppDb } from "../db/index.js";
import { extractBearerToken, verifyApiToken } from "../auth/index.js";
import {
  mcpAddCallLabels,
  mcpAddClaims,
  mcpAddLearnings,
  mcpAddSource,
  mcpAddSourceImage,
  mcpDeleteClaims,
  mcpEditClaims,
  mcpFinishRun,
  mcpGetInstructions,
  mcpListSources,
  mcpListWork,
  mcpReadRange,
  mcpSearchClaims,
  mcpStartRun,
} from "./workflow.js";
import {
  JOB_TOKEN_PREFIX,
  verifyProcessingJobToken,
  type ProcessingJobScope,
} from "./processing-jobs.js";
import { DomainError } from "../services/index.js";

/** All a site-started job may use. New tools stay unavailable to jobs unless added here. */
const JOB_TOOLS = new Set([
  "get_instructions",
  "read_range",
  "search_claims",
  "add_claims",
  "add_learnings",
  "finish_run",
]);

function trackRegisteredTools(server: McpServer): Map<string, RegisteredTool> {
  const registered = new Map<string, RegisteredTool>();
  const register = server.tool.bind(server) as unknown as (
    name: string,
    ...rest: unknown[]
  ) => RegisteredTool;
  server.tool = ((name: string, ...rest: unknown[]) => {
    const tool = register(name, ...rest);
    registered.set(name, tool);
    return tool;
  }) as typeof server.tool;
  return registered;
}

function assertJobRun(job: ProcessingJobScope | null, runId: string | undefined) {
  if (job && runId !== job.runId) {
    throw new DomainError("FORBIDDEN", "This job can only use its own Processing run", 403);
  }
}

/** With a job scope, only the tools for that one run are exposed. */
export function createGeoCoachMcpServer(
  db: AppDb,
  playerId: string,
  job: ProcessingJobScope | null = null,
): McpServer {
  const server = new McpServer({
    name: "geo-coach",
    version: "0.1.0",
  });
  const registeredTools = trackRegisteredTools(server);

  server.tool(
    "get_instructions",
    "Return the versioned instructions for extract, tips or calls Processing runs, or for ingesting a Source into the knowledge bank (ingest).",
    {
      purpose: instructionPurposeSchema,
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
    "Read an open Processing run's range. extract/tips: compact transcript, Round markers, ±2 min uncitable context, existing Learnings, topic tags, and the Duo's Claims (with derived status) for every country in the range's Rounds. calls: the Split and Spread Rounds with both teams' guessed countries and Regions and the Utterances spoken while guessing.",
    {
      runId: z.string().uuid(),
    },
    async ({ runId }) => {
      assertJobRun(job, runId);
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
        `Claims for this range's countries (${res.claimCountries.join(", ") || "none"}):`,
        ...(job
          ? [`${res.claims.length} exist. Find the ones you need with search_claims.`]
          : res.claims.length > 0
          ? res.claims.map(
              (c) =>
                `- [claimId=${c.id}] ${c.status.toUpperCase()} (${c.evidence}) ${c.countries.join("/") || "-"}: ${c.text}${c.topics.length > 0 ? ` #${c.topics.join(" #")}` : ""}`,
            )
          : ["(none yet)"]),
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
    "Add a batch of Learnings to an open Processing run. A clue or distinguisher may pass claimId to link the Claim it rests on. Valid items are saved even if other items fail validation.",
    {
      runId: z.string().uuid(),
      items: z.array(z.record(z.unknown())).min(1),
    },
    async ({ runId, items }) => {
      assertJobRun(job, runId);
      const res = await mcpAddLearnings(db, playerId, runId, items);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "search_claims",
    "Search the Duo's knowledge bank Claims by text, countries, topics and derived status (speculated, verified, disproved, disputed). Always search before creating a Claim.",
    {
      query: z.string().max(200).optional(),
      countries: z.array(isoCountryCodeSchema).optional(),
      topics: z.array(z.string()).optional(),
      status: claimStatusSchema.optional(),
      duo: z.string().optional(),
    },
    async (args) => {
      const res = await mcpSearchClaims(db, playerId, job ? { ...args, duo: job.duoId } : args);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, job ? undefined : 2) }],
      };
    },
  );

  server.tool(
    "add_claims",
    "Create Claims ({ text, countries, regions?, topics?, evidence? }) and/or add Evidence to existing ones ({ claimId, evidence }). Evidence: { kind: \"round\", roundId } (inside the run's range; Rounds only count for) or { kind: \"documentation\", sourceVersionId, section, direction, images? }. Pass runId inside a Processing run, or duo when ingesting a Source. Valid items are saved even if other items fail validation.",
    {
      runId: z.string().uuid().optional(),
      duo: z.string().optional(),
      items: z.array(z.record(z.unknown())).min(1),
    },
    async (args) => {
      assertJobRun(job, args.runId);
      const res = await mcpAddClaims(db, playerId, args);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "edit_claims",
    "Change existing Claims: items of { claimId, text?, countries?, regions?, topics?, force? }. Evidence is never touched. Rewording a Claim a Player or a Round has confirmed needs force: true. Valid items are saved even if other items fail validation.",
    {
      duo: z.string().optional(),
      items: z.array(z.record(z.unknown())).min(1),
    },
    async (args) => {
      const res = await mcpEditClaims(db, playerId, args);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "delete_claims",
    "Delete Claims by id, with their Evidence and image links. A Claim a Player or a Round has confirmed is kept unless force: true. Returns what was deleted and what was kept and why.",
    {
      claimIds: z.array(z.string().uuid()).min(1).max(200),
      force: z.boolean().optional(),
      duo: z.string().optional(),
    },
    async (args) => {
      const res = await mcpDeleteClaims(db, playerId, args);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "list_sources",
    "List the Duo's knowledge bank Sources with their versions. Check it before add_source: pass an existing Source's id as sourceId to add a new version instead of a duplicate. query matches title or URL.",
    {
      query: z.string().max(200).optional(),
      duo: z.string().optional(),
    },
    async (args) => {
      const res = await mcpListSources(db, playerId, args);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "add_source",
    "Store a reference document (Plonkit page, PDF, guide) a Player gave you, converted to markdown, as a knowledge bank Source. Pass sourceId to add a new version of an existing Source. Returns the section anchors to cite, the image names to upload, and Claims to re-check. The server never fetches URLs.",
    {
      title: z.string().trim().min(1).max(300),
      url: z.string().url().max(2000).optional(),
      kind: sourceKindSchema,
      sourceId: z.string().uuid().optional(),
      markdown: z.string().min(1),
      duo: z.string().optional(),
    },
    async (args) => {
      const res = await mcpAddSource(db, playerId, args);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  server.tool(
    "add_source_image",
    "Upload one image of a Source version (PNG, JPEG, GIF or WebP, base64, size-capped), named as the markdown references it. Uploading the same name again replaces it.",
    {
      sourceVersionId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      mimeType: z.string().min(1).max(100),
      base64: z.string().min(1),
    },
    async (args) => {
      const res = await mcpAddSourceImage(db, playerId, args);
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
      assertJobRun(job, runId);
      const res = await mcpFinishRun(db, playerId, runId);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );

  if (job) {
    for (const [name, tool] of registeredTools) {
      if (!JOB_TOOLS.has(name)) tool.remove();
    }
    // Jobs have no file tools, so a result Claude Code moves to a file would be lost.
    registeredTools.get("read_range")?.update({
      _meta: { "anthropic/maxResultSizeChars": 200_000 },
    });
    return server;
  }

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

  server.prompt("ingest", "Ingest a reference document into the geo-coach knowledge bank", async () => {
    const { instructions } = await mcpGetInstructions("ingest");
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

  const job = rawToken.startsWith(JOB_TOKEN_PREFIX)
    ? await verifyProcessingJobToken(db, rawToken)
    : null;
  const verified = job ? null : await verifyApiToken(db, rawToken, "mcp");
  const playerId = job?.playerId ?? verified?.player.id;
  if (!playerId) {
    return new Response(
      JSON.stringify({ error: "Invalid, expired, or wrong-scope mcp bearer token" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const server = createGeoCoachMcpServer(db, playerId, job);
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
