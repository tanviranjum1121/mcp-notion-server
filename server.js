const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
// Make.com-এর ওয়েবহুক লিংকটি পরে Render-এ বসানো যাবে
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// সার্ভার ঠিকমতো চলছে কি না, তা চেক করার জন্য
app.get('/', (req, res) => {
    res.send('MCP Notion Server is completely online and running!');
});

// Gemini Spark থেকে ডেটা রিসিভ করে Make.com-এ পাঠানোর এন্ডপয়েন্ট
app.post('/spark-to-notion', async (req, res) => {
    try {
        const data = req.body;
        
        if (!MAKE_WEBHOOK_URL) {
             return res.status(500).json({ error: "Make.com Webhook URL is missing!" });
        }

        // Make.com-এ ডেটা ফরোয়ার্ড করা
        const response = await axios.post(MAKE_WEBHOOK_URL, data);
        
        res.status(200).json({
            success: true,
            message: "Data successfully routed to Make.com",
            makeResponse: response.data
        });
    } catch (error) {
        console.error("Error routing data:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to send data to Make.com",
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
