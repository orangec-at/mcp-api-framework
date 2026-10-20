---
name: company-analysis
description: Analyze a company dataset by sending its ID and a question to the company API.
---

# Company analysis

Use the connected company MCP server's live tool schema.

1. Obtain the existing dataset ID and the user's analysis question. Ask for missing inputs; never invent a dataset ID.
2. Call `company_analyze_data` with `datasetId` and `question`.
3. Summarize the returned `summary` and identify the dataset used.
4. On tool failure, report the error without claiming analysis succeeded. Do not automatically retry a write operation.

Send only the requested dataset reference and question. The server determines the caller's identity and permissions. Never request or include API credentials in tool arguments.

Installing this skill does not register the MCP server. Configure its `/mcp` URL and authentication separately in the host client.
