import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const app = express();
app.use(cors());
app.use(express.json()); 

const PORT = process.env.PORT || 3000;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// MCP সার্ভার তৈরি
const mcpServer = new McpServer({
  name: "Gemini-Make-Bridge",
  version: "1.0.0"
});

// Spark-এর জন্য ট্যাগিং টুল সেটআপ
mcpServer.tool(
  "send_data_to_notion",
  "Send categorized data to Make.com which forwards to Notion",
  {
    tag: z.string().describe("Category tag: Fin/Econ, Biz Comp, or Shop"),
    title: z.string().describe("The title of the task or note"),
    content: z.string().describe("The main content or summary")
  },
  async ({ tag, title, content }) => {
    if (!MAKE_WEBHOOK_URL) {
      return { content: [{ type: "text", text: "Error: Make.com Webhook URL is missing!" }] };
    }
    try {
      await axios.post(MAKE_WEBHOOK_URL, { tag, title, content });
      return { content: [{ type: "text", text: `Success! Sent [${title}] to Make.com with tag: ${tag}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to send: ${error.message}` }] };
    }
  }
);

let transport;

// এই লিংকেই Gemini কানেক্ট করবে
app.get('/sse', async (req, res) => {
  // জেমিনির কনফিউশন দূর করতে এখানে পুরো লিংক দেওয়া হয়েছে
  const fullMessageUrl = 'https://mcp-notion-server-umpt.onrender.com/messages';
  transport = new SSEServerTransport(fullMessageUrl, res);
  await mcpServer.connect(transport);
});

// ম্যাসেজ রিসিভ করার লিংক
app.post('/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No active MCP connection");
  }
});

app.get('/', (req, res) => {
    res.send("MCP Server is Running! Use the /sse endpoint for Gemini.");
});

app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});
