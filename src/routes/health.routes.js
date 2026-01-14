/**
 * Health Routes
 */

const express = require('express');
const router = express.Router();

// Health check route
router.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "AiSensy WhatsApp Calling Server with ElevenLabs AI is running",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        aiProvider: "ElevenLabs Conversational AI"
    });
});

module.exports = router;
