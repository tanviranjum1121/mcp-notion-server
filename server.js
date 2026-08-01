import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const app = express();
const PORT = process.env.PORT || 3000;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// CORS: expose/allow the MCP session header (required by Streamable HTTP spec)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'Mcp-Session-Id', 'MCP-Protocol-Version'],
  exposedHeaders: ['Mcp-Session-Id'],
}));

app.use(express.json());

// ---------------------------------------------------------------
// Server factory: build a fresh McpServer with the tool registered
// ---------------------------------------------------------------
function buildServer() {
  const server = new McpServer({
    name: 'gemini-make-bridge',
    version: '1.0.0',
  });

  server.tool(
    'send_data_to_notion',
    'Send categorized data to Make.com which forwards it to Notion',
    {
      tag: z.string().describe('Category tag: Fin/Econ, Biz Comp, or Shop'),
      title: z.string().describe('The title of the task or note'),
      content: z.string().describe('The main content or summary'),
    },
    async ({ tag, title, content }) => {
      if (!MAKE_WEBHOOK_URL) {
        return {
          content: [{ type: 'text', text: 'Error: MAKE_WEBHOOK_URL env variable is not set on the server.' }],
          isError: true,
        };
      }
      try {
        await axios.post(MAKE_WEBHOOK_URL, { tag, title, content }, { timeout: 15000 });
        return {
          content: [{ type: 'text', text: `Success: sent "${title}" to Make.com with tag "${tag}".` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to send to Make.com: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ---------------------------------------------------------------
// PRIMARY: Streamable HTTP transport at /mcp  (use THIS URL in Gemini)
// Stateless mode: new server + transport per request. Survives
// Render free-tier spin-downs because nothing lives in memory.
// ---------------------------------------------------------------
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    // Pass req.body explicitly — express.json() already consumed the stream
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Stateless servers don't support standalone GET streams or DELETE
const methodNotAllowed = (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed in stateless mode' },
    id: null,
  });
};
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

// ---------------------------------------------------------------
// LEGACY FALLBACK: SSE transport (/sse + /messages) for old clients.
// Do NOT give this URL to Gemini Spark.
// ---------------------------------------------------------------
const sseTransports = new Map();

app.get('/sse', async (req, res) => {
  try {
    const server = buildServer();
    // Relative path — client resolves it against the connection origin.
    const transport = new SSEServerTransport('/messages', res);

    sseTransports.set(transport.sessionId, transport);

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseTransports.delete(transport.sessionId);
      server.close();
    });

    await server.connect(transport);
  } catch (err) {
    console.error('SSE error:', err);
    if (!res.headersSent) res.status(500).send('Error starting SSE');
  }
});

app.post('/messages', async (req, res) => {
  const transport = sseTransports.get(req.query.sessionId);
  if (!transport) {
    return res.status(404).send('Session not found');
  }
  try {
    // Third argument passes the parsed body; the raw stream is already consumed
    await transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    console.error('Message error:', err);
    if (!res.headersSent) res.status(500).send('Error handling message');
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('MCP server running. Streamable HTTP endpoint: /mcp');
});

app.listen(PORT, () => {
  console.log(`MCP server listening on ${PORT}`);
});
