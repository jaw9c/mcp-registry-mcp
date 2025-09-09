import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "MCP Registry Client",
		version: "1.0.0",
	});

	async init() {
		// Tool to fetch and list MCP servers from the official registry
		this.server.tool(
			"ListMCPServers",
			{
				query: z.string().optional().describe("Optional search query to filter servers, usally a substring of the server name"),
				limit: z.number().optional().describe("Maximum number of servers to return"),
				search: z.string().optional().describe("Search servers by name (substring match). Example: 'filesystem'"),
				updated_since: z.string().optional().describe("Filter servers updated since timestamp (RFC3339 datetime). Example: '2025-08-07T13:15:04.280Z'"),
				version: z.string().optional().describe("Filter by version ('latest' for latest version, or an exact version like '1.2.3'). Example: 'latest'"),
			},
			async (params) => {
				try {
					// Build query parameters
					const queryParams = new URLSearchParams();
					if (params.query) {
						queryParams.set("q", params.query);
					}
					if (params.limit) {
						queryParams.set("limit", params.limit.toString());
					}
					if (params.search) {
						queryParams.set("search", params.search);
					}
					if (params.updated_since) {
						queryParams.set("updated_since", params.updated_since);
					}
					if (params.version) {
						queryParams.set("version", params.version);
					}
					
					const url = `https://registry.modelcontextprotocol.io/v0/servers${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
					console.log(url);
					
					const response = await fetch(url, {
						headers: {
							'Accept': 'application/json',
							'User-Agent': 'MCP-Registry-Client/1.0.0'
						}
					});
					
					if (!response.ok) {
						const errorText = await response.text();
						throw new Error(`Failed to fetch servers: ${response.status} ${response.statusText}. Response: ${errorText}`);
					}
					
					const responseText = await response.text();
					
					// Check if response is empty
					if (!responseText || responseText.trim() === '') {
						throw new Error('Empty response from registry API');
					}
					
					let data: any;
					try {
						data = JSON.parse(responseText);
					} catch (parseError) {
						throw new Error(`Invalid JSON response from registry: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}. Response text: ${responseText.substring(0, 200)}...`);
					}
					
					// Format for LLM consumption
					const appliedFilters = [];
					if (params.query) appliedFilters.push(`query: "${params.query}"`);
					if (params.search) appliedFilters.push(`search: "${params.search}"`);
					if (params.updated_since) appliedFilters.push(`updated since: ${params.updated_since}`);
					if (params.version) appliedFilters.push(`version: ${params.version}`);
					if (params.limit) appliedFilters.push(`limit: ${params.limit}`);
					
					const formattedOutput = {
						summary: appliedFilters.length > 0 
							? `Found ${data.servers?.length || 0} MCP servers with filters: ${appliedFilters.join(', ')}`
							: `Found ${data.servers?.length || 0} MCP servers from the registry`,
						applied_filters: {
							query: params.query || null,
							search: params.search || null,
							updated_since: params.updated_since || null,
							version: params.version || null,
							limit: params.limit || null
						},
						total_count: data.servers?.length || 0,
						servers: data.servers || [],
						pagination: data.pagination || null
					};
					
					return {
						content: [{ 
							type: "text", 
							text: JSON.stringify(formattedOutput, null, 2)
						}],
					};
				} catch (error) {
					return {
						content: [{ 
							type: "text", 
							text: `Error fetching MCP servers from registry: ${error instanceof Error ? error.message : 'Unknown error'}`
						}],
					};
				}
			}
		);

		// Tool to get detailed information about a specific MCP server
		this.server.tool(
			"GetMCPServer",
			{
				server_id: z.string().describe("The UUID or name of the server to retrieve. If using the output of the ListMCPServers tool, its located uder the path _meta.io.modelcontextprotocol.registry/official.id"),
			},
			async (params) => {
				try {
					const url = `https://registry.modelcontextprotocol.io/v0/servers/${encodeURIComponent(params.server_id)}`;
					console.log(url);
					
					const response = await fetch(url, {
						headers: {
							'Accept': 'application/json',
							'User-Agent': 'MCP-Registry-Client/1.0.0'
						}
					});
					
					if (!response.ok) {
						const errorText = await response.text();
						if (response.status === 404) {
							throw new Error(`Server with ID "${params.server_id}" not found in the registry`);
						}
						throw new Error(`Failed to fetch server details: ${response.status} ${response.statusText}. Response: ${errorText}`);
					}
					
					const responseText = await response.text();
					
					// Check if response is empty
					if (!responseText || responseText.trim() === '') {
						throw new Error('Empty response from registry API for server details');
					}
					
					let serverData: any;
					try {
						serverData = JSON.parse(responseText);
					} catch (parseError) {
						throw new Error(`Invalid JSON response from registry: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}. Response text: ${responseText.substring(0, 200)}...`);
					}
					
					// Format for LLM consumption
					const formattedOutput = {
						summary: `Details for MCP server: ${serverData.name || params.server_id}`,
						server: serverData
					};
					
					return {
						content: [{ 
							type: "text", 
							text: JSON.stringify(formattedOutput, null, 2)
						}],
					};
				} catch (error) {
					return {
						content: [{ 
							type: "text", 
							text: `Error fetching server details: ${error instanceof Error ? error.message : 'Unknown error'}`
						}],
					};
				}
			}
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return MyMCP.serve("/").fetch(request, env, ctx);
		}

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
