/**
 * ElevenLabs Conversational AI Configuration
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

// WebSocket URL builder
const getWebSocketUrl = () => {
    return `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`;
};

module.exports = {
    ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID,
    getWebSocketUrl
};
