import { z } from "zod";
import { defineApiTool } from "../src/index";

export const analyzeData = defineApiTool({
  name: "company_analyze_data",
  description: "Send a dataset ID and a question to the company analysis API.",
  input: z.object({
    datasetId: z.string().min(1).max(100).describe("An existing dataset ID"),
    question: z
      .string()
      .min(1)
      .max(2000)
      .describe("What to analyze in the dataset"),
  }),
  output: z.object({ summary: z.string(), datasetId: z.string() }),
  scopes: ["analysis:read"],
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  request: (input, context) => ({
    method: "POST",
    path: "analysis",
    body: { ...input, requestedBy: context.principal.subject },
  }),
});
