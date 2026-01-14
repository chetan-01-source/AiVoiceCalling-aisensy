/**
 * Server Entry Point
 * 
 * AiSensy + ElevenLabs AI Call Server
 */

require('dotenv').config();

const http = require('http');
const app = require('./app');
const { cleanupConnections } = require('./handlers/call.handler');
const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } = require('./config');

// Create HTTP server
const server = http.createServer(app);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM received, cleaning up...');
    cleanupConnections();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT received, cleaning up...');
    cleanupConnections();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start the server
const PORT = process.env.PORT || 19000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`========================================`);
    console.log(`🚀 AiSensy + ElevenLabs AI Call Server`);
    console.log(`========================================`);
    console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
    console.log(`📥 Webhook endpoint: /aisensy-webhook`);
    console.log(`🤖 AI Agent: ElevenLabs Conversational AI`);
    console.log(`🔊 Audio: Opus 48kHz (native support)`);
    console.log(`📞 Mode: Fully Automated Server-Side`);
    console.log(`========================================`);
    console.log(`⚙️  Agent ID: ${ELEVENLABS_AGENT_ID ? '✅ Configured' : '❌ Missing'}`);
    console.log(`🔑 API Key: ${ELEVENLABS_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log(`========================================`);
});

module.exports = server;
