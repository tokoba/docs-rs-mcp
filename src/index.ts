#!/usr/bin/env node

/**
 * @fileoverview MCP server for searching and retrieving Rust crate documentation from docs.rs.
 * This server provides tools to search for crates, retrieve documentation, and explore crate contents.
 * @module docs-rs-mcp
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ErrorCode,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

/**
 * Turndown service instance configured for converting HTML to Markdown.
 * Uses fenced code block style for code snippets.
 */
const turndownService = new TurndownService({
    codeBlockStyle: "fenced",
});

/**
 * Represents a search result for a Rust crate from crates.io.
 * @interface
 */
interface CrateSearchResult {
    /** The name of the crate */
    name: string;
    /** Description of the crate's functionality */
    description: string;
    /** Total number of downloads */
    downloads: number;
    /** Latest version number */
    version: string;
    /** URL to the crate's documentation, if available */
    documentation: string | null;
}

/**
 * MCP server implementation for docs.rs documentation access.
 * Provides tools for searching crates and retrieving documentation content.
 * @class
 */
class DocsRsMcpServer {
    /** The MCP server instance */
    private server: Server;

    /**
     * Creates a new DocsRsMcpServer instance.
     * Initializes the MCP server with tool capabilities and sets up request handlers.
     * @constructor
     */
    constructor() {
        this.server = new Server(
            {
                name: "docs-rs",
                version: "1.0.1",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupToolHandlers();
    }

    /**
     * Sets up the request handlers for MCP tool operations.
     * Registers handlers for listing available tools and executing tool calls.
     * Available tools:
     * - docs_rs_search_crates: Search for crates on crates.io
     * - docs_rs_readme: Get README/overview of a crate
     * - docs_rs_get_item: Get documentation for a specific item (struct, trait, function, etc.)
     * - docs_rs_search_in_crate: Search for items within a crate
     * @private
     */
    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "docs_rs_search_crates",
                        description: "Search for Rust crates by keywords on crates.io.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "Search keywords for finding relevant crates. Keywords should be in English.",
                                },
                                per_page: {
                                    type: "number",
                                    description: "Number of results per page (default: 10, max: 100)",
                                },
                                sort: {
                                    type: "string",
                                    description: "Sort order: 'relevance', 'downloads', 'recent-downloads', 'recent-updates', 'new' (default: relevance)",
                                },
                            },
                            required: ["query"],
                        },
                    },
                    {
                        name: "docs_rs_readme",
                        description: "Get README/overview content of the specified crate",
                        inputSchema: {
                            type: "object",
                            properties: {
                                crate_name: {
                                    type: "string",
                                    description: "Name of the crate to get README for",
                                },
                                version: {
                                    type: "string",
                                    description: "Specific version (optional, defaults to latest)",
                                },
                            },
                            required: ["crate_name"],
                        },
                    },
                    {
                        name: "docs_rs_get_item",
                        description: "Get documentation content of a specific item (module, struct, trait, enum, function, etc.) within a crate",
                        inputSchema: {
                            type: "object",
                            properties: {
                                crate_name: {
                                    type: "string",
                                    description: "Name of the crate",
                                },
                                item_type: {
                                    type: "string",
                                    description: "Type of item: 'module' for modules, 'struct', 'trait', 'enum', 'type', 'fn', etc.",
                                },
                                item_path: {
                                    type: "string",
                                    description: "The full path of the item, including the module name (e.g. wasmtime::component::Component)",
                                },
                                version: {
                                    type: "string",
                                    description: "Specific version (optional, defaults to latest)",
                                },
                            },
                            required: ["crate_name", "item_type", "item_path"],
                        },
                    },
                    {
                        name: "docs_rs_search_in_crate",
                        description: "Search for traits, structs, methods, etc. from the crate's all.html page. To get a module, use docs_rs_get_item instead.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                crate_name: {
                                    type: "string",
                                    description: "Name of the crate to search",
                                },
                                query: {
                                    type: "string",
                                    description: "Search keyword (trait name, struct name, function name, etc.)",
                                },
                                version: {
                                    type: "string",
                                    description: "Specific version (optional, defaults to latest)",
                                },
                                item_type: {
                                    type: "string",
                                    description: "Filter by item type (struct | trait | fn | enum| union | macro | constant)",
                                },
                            },
                            required: ["crate_name", "query"],
                        },
                    },
                ],
            };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case "docs_rs_search_crates":
                        return await this.searchCrates(request.params.arguments);
                    case "docs_rs_readme":
                        return await this.getReadMe(request.params.arguments);
                    case "docs_rs_get_item":
                        return await this.getItem(request.params.arguments);
                    case "docs_rs_search_in_crate":
                        return await this.searchInCrate(request.params.arguments);
                    default:
                        throw new McpError(
                            ErrorCode.MethodNotFound,
                            `Unknown tool: ${request.params.name}`
                        );
                }
            } catch (error) {
                throw new McpError(
                    ErrorCode.InternalError,
                    `Error executing tool ${request.params.name}: ${error}`
                );
            }
        });
    }

    /**
     * Searches for Rust crates on crates.io using the provided query.
     * @private
     * @async
     * @param {Object} args - The search parameters
     * @param {string} args.query - Search keywords for finding relevant crates
     * @param {number} [args.per_page=10] - Number of results per page (max: 100)
     * @param {string} [args.sort="relevance"] - Sort order: 'relevance', 'downloads', 'recent-downloads', 'recent-updates', or 'new'
     * @returns {Promise<Object>} MCP tool response containing formatted search results in Markdown
     * @throws {Error} If the API request fails or returns an error
     */
    private async searchCrates(args: any) {
        const { query, per_page = 10, sort = "relevance" } = args;

        try {
            const response = await axios.get<{ crates: any[] }>("https://crates.io/api/v1/crates", {
                params: {
                    q: query,
                    per_page: Math.min(per_page, 100),
                    sort,
                },
            });

            const crates = response.data.crates.map((crate: any) => ({
                name: crate.name,
                description: crate.description || "No description available",
                downloads: crate.downloads,
                version: crate.newest_version,
                documentation: crate.documentation,
            }));

            return {
                content: [
                    {
                        type: "text",
                        text: `# Crate Search Results for "${query}"\n\n${crates
                            .map(
                                (crate: CrateSearchResult) =>
                                    `## ${crate.name} (${crate.version})\n\n` +
                                    `**Description:** ${crate.description}\n\n` +
                                    `**Downloads:** ${crate.downloads.toLocaleString()}\n\n` +
                                    `**Documentation:** ${crate.documentation || "N/A"}\n\n---\n`
                            )
                            .join("\n")}`,
                    },
                ],
            };
        } catch (error) {
            throw new Error(`Failed to search crates: ${error}`);
        }
    }

    /**
     * Retrieves the README/overview documentation for a specified crate from docs.rs.
     * @private
     * @async
     * @param {Object} args - The retrieval parameters
     * @param {string} args.crate_name - Name of the crate to get README for
     * @param {string} [args.version="latest"] - Specific version (defaults to latest)
     * @returns {Promise<Object>} MCP tool response containing the README content in Markdown format
     * @throws {Error} If the documentation cannot be retrieved or parsed
     */
    private async getReadMe(args: any) {
        const { crate_name, version = "latest" } = args;

        try {
            const url = `https://docs.rs/${crate_name}/${version}/${crate_name}/index.html`;

            const response = await axios.get<string>(url);
            const $ = cheerio.load(response.data);

            const mainContent = $(".rustdoc .docblock").first();

            if (mainContent.length === 0) {
                const alternativeContent = $(".rustdoc-main .item-decl").first();
                if (alternativeContent.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `# ${crate_name} Documentation\n\nNo documentation content found at ${url}`,
                            },
                        ],
                    };
                }
            }

            const htmlContent = mainContent.html() || "";
            const markdownContent = turndownService.turndown(htmlContent);

            return {
                content: [
                    {
                        type: "text",
                        text: `# ${crate_name} Documentation\n\n${markdownContent}`,
                    },
                ],
            };
        } catch (error) {
            throw new Error(`Failed to get README for ${crate_name}: ${error}`);
        }
    }

    /**
     * Retrieves documentation for a specific item within a crate.
     * Supports modules, structs, traits, enums, functions, and other Rust items.
     * @private
     * @async
     * @param {Object} args - The item retrieval parameters
     * @param {string} args.crate_name - Name of the crate
     * @param {string} args.item_type - Type of item: 'module', 'struct', 'trait', 'enum', 'type', 'fn', etc.
     * @param {string} args.item_path - The full path of the item, including module name (e.g., 'wasmtime::component::Component')
     * @param {string} [args.version="latest"] - Specific version (defaults to latest)
     * @returns {Promise<Object>} MCP tool response containing the item's documentation in Markdown format
     * @throws {Error} If the item documentation cannot be retrieved or parsed
     */
    private async getItem(args: any) {
        const { crate_name, item_type, item_path, version = "latest" } = args;

        const item_name = item_path.split("::").pop();

        try {
            let url: string;

            if (item_type === "module") {
                url = `https://docs.rs/${crate_name}/${version}/${item_path.replaceAll("::", "/")}/index.html`;
            } else {
                const pathParts = item_path.split("::");
                const modulePath = pathParts.slice(0, -1).join("/");
                url = `https://docs.rs/${crate_name}/${version}/${modulePath}/${item_type}.${item_name}.html`;
            }

            const response = await axios.get<string>(url);
            const $ = cheerio.load(response.data);

            const mainContentSection = $("#main-content");
            let contentHtml = "";

            if (mainContentSection.length > 0) {
                contentHtml = mainContentSection.html() || "";
            } else {
                const itemDecl = $(".rustdoc .item-decl").first();
                const mainContent = $(".rustdoc .docblock").first();

                if (itemDecl.length > 0) {
                    contentHtml += itemDecl.html() || "";
                }

                if (mainContent.length === 0) {
                    const alternativeContent = $(".rustdoc-main .item-decl").first();
                    if (alternativeContent.length > 0) {
                        contentHtml += alternativeContent.html() || "";
                    }
                } else {
                    contentHtml += mainContent.html() || "";
                }
            }

            if (!contentHtml) {
                const fullItemName = item_path;
                return {
                    content: [
                        {
                            type: "text",
                            text: `# ${fullItemName} (${item_type})\n\nNo documentation content found at ${url}`,
                        },
                    ],
                };
            }

            const markdownContent = turndownService.turndown(contentHtml);

            const fullItemName = item_path;
            return {
                content: [
                    {
                        type: "text",
                        text: `# ${fullItemName} (${item_type})\n\n**Documentation URL:** ${url}\n\n${markdownContent}`,
                    },
                ],
            };
        } catch (error) {
            const fullItemName = item_path;
            throw new Error(`Failed to get item documentation for ${fullItemName}: ${error}`);
        }
    }

    /**
     * Searches for specific items (traits, structs, functions, etc.) within a crate.
     * Parses the crate's all.html page to find matching items.
     * @private
     * @async
     * @param {Object} args - The search parameters
     * @param {string} args.crate_name - Name of the crate to search
     * @param {string} args.query - Search keyword (trait name, struct name, function name, etc.)
     * @param {string} [args.version="latest"] - Specific version (defaults to latest)
     * @param {string} [args.item_type] - Filter by item type: 'struct', 'trait', 'fn', 'enum', 'union', 'macro', 'constant'
     * @returns {Promise<Object>} MCP tool response containing search results with links to item documentation
     * @throws {Error} If the search fails or the all.html page cannot be retrieved
     */
    private async searchInCrate(args: any) {
        const { crate_name, query, version = "latest", item_type } = args;

        try {
            const url = `https://docs.rs/${crate_name}/${version}/${crate_name}/all.html`;
            const response = await axios.get<string>(url);
            const $ = cheerio.load(response.data);

            const items: Array<{
                name: string;
                type: string;
                link: string;
            }> = [];

            $("#main-content a").each((_, element) => {
                const $link = $(element);
                const itemName = $link.text().trim();
                const itemLink = $link.attr("href") || "";

                if (!itemName || !itemLink) return;

                let type = "unknown";
                if (itemLink.includes("struct.")) type = "struct";
                else if (itemLink.includes("trait.")) type = "trait";
                else if (itemLink.includes("fn.")) type = "function";
                else if (itemLink.includes("enum.")) type = "enum";
                else if (itemLink.includes("type.")) type = "type";
                else if (itemLink.includes("const.")) type = "constant";
                else if (itemLink.includes("static.")) type = "static";
                else if (itemLink.includes("macro.")) type = "macro";

                const matchesQuery = !query || query == "" || itemName.toLowerCase().includes(query.toLowerCase());
                const matchesType = !item_type || item_type == "" || type === item_type || itemName.toLowerCase().includes(item_type.toLowerCase());

                if (matchesQuery && matchesType && type !== "unknown") {
                    items.push({
                        name: itemName,
                        type,
                        link: itemLink.startsWith("http") ? itemLink : `https://docs.rs/${crate_name}/${version}/${crate_name}/${itemLink}`,
                    });
                }
            });

            const uniqueItems = items.filter((item, index, self) =>
                index === self.findIndex(i => i.name === item.name && i.type === item.type)
            );

            const searchTerm = query || "all items";
            return {
                content: [
                    {
                        type: "text",
                        text: `# Search Results for "${searchTerm}" in ${crate_name}\n\n` +
                            `Found ${uniqueItems.length} items\n\n` +
                            (uniqueItems.length === 0
                                ? "No matching items found."
                                : uniqueItems
                                    .map(
                                        (item) =>
                                            `## ${item.name} (${item.type})\n\n` +
                                            `**Description:** ${item.type}\n\n` +
                                            `**Link:** [View Documentation](${item.link})\n\n` +
                                            `---\n`
                                    )
                                    .join("\n")
                            ),
                    },
                ],
            };
        } catch (error) {
            throw new Error(`Failed to search items in ${crate_name}: ${error}`);
        }
    }

    /**
     * Starts the MCP server and begins listening for requests.
     * Connects to the standard input/output transport for communication with MCP clients.
     * @async
     * @returns {Promise<void>}
     */
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("docs.rs MCP server running on stdio");
    }
}

/**
 * Server instance initialization and startup.
 * Creates and runs the DocsRsMcpServer instance.
 */
const server = new DocsRsMcpServer();
server.run().catch(console.error);
