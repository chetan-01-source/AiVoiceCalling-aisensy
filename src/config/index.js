/**
 * Configuration Index
 * 
 * Aggregates and exports all configuration modules
 */

const aisensyConfig = require('./aisensy.config');
const elevenlabsConfig = require('./elevenlabs.config');
const audioConfig = require('./audio.config');

// STUN server for NAT traversal
const ICE_SERVERS = [{ urls: "stun:stun.relay.metered.ca:80" }];

module.exports = {
    // AiSensy
    ...aisensyConfig,

    // ElevenLabs
    ...elevenlabsConfig,

    // Audio
    ...audioConfig,

    // WebRTC
    ICE_SERVERS
};
