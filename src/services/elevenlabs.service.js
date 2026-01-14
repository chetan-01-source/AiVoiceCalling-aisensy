/**
 * ElevenLabs Conversational AI Service
 * 
 * WebSocket connection and communication with ElevenLabs
 */

const WebSocket = require('ws');
const { getWebSocketUrl } = require('../config');
const session = require('../state/session');
const { handleElevenLabsMessage, handleElevenLabsAudio } = require('../handlers/elevenlabs.handler');
const playback = require('../audio/playback');

/**
 * Connect to ElevenLabs Conversational AI via WebSocket
 * 
 * Audio Format:
 * - INPUT (User → AI): We resample 48kHz → 16kHz before sending
 * - OUTPUT (AI → User): ElevenLabs sends 48kHz PCM - DIRECT to WhatsApp, no conversion!
 */
async function connectToElevenLabs(callerName, callerNumber) {
    return new Promise((resolve, reject) => {
        try {
            // ElevenLabs Conversational AI WebSocket URL
            const wsUrl = getWebSocketUrl();
            console.log(`🔌 Connecting to ElevenLabs WebSocket...`);

            const elevenLabsWs = new WebSocket(wsUrl);
            session.setElevenLabsWs(elevenLabsWs);

            elevenLabsWs.on("open", () => {
                console.log("✅ ElevenLabs WebSocket connected");

                // Simple initialization - ElevenLabs rejects most config overrides
                // The audio format is determined by the agent's dashboard settings
                const initMessage = {
                    type: "conversation_initiation_client_data",
                    custom_llm_extra_body: {
                        caller_name: callerName,
                        caller_number: callerNumber
                    }
                };

                elevenLabsWs.send(JSON.stringify(initMessage));
                console.log("📤 Sent simple init (no config overrides)");

                resolve();
            });

            elevenLabsWs.on("message", (data) => {
                // Handle messages from ElevenLabs
                // Note: ElevenLabs may send JSON as Buffer, not just string

                let messageData;
                if (Buffer.isBuffer(data)) {
                    messageData = data;
                } else {
                    messageData = Buffer.from(data);
                }

                // Check if it's JSON (starts with '{')
                const firstByte = messageData[0];
                const isJson = firstByte === 0x7b; // '{'

                if (isJson) {
                    // Parse as JSON
                    try {
                        const message = JSON.parse(messageData.toString());
                        handleElevenLabsMessage(message);
                    } catch (e) {
                        console.log("📩 Failed to parse JSON:", messageData.toString().substring(0, 100));
                    }
                } else {
                    // Binary audio data
                    const firstBytes = messageData.slice(0, 4).toString('hex');

                    if (playback.getElevenLabsAudioCount() < 5) {
                        console.log(`🔊 ACTUAL Audio: ${messageData.length} bytes, first bytes: ${firstBytes}`);
                    }

                    handleElevenLabsAudio(messageData);
                }
            });

            elevenLabsWs.on("error", (error) => {
                console.error("❌ ElevenLabs WebSocket error:", error);
                reject(error);
            });

            elevenLabsWs.on("close", (code, reason) => {
                console.log(`📴 ElevenLabs WebSocket closed. Code: ${code}, Reason: ${reason}`);
            });

        } catch (error) {
            console.error("❌ Error connecting to ElevenLabs:", error);
            reject(error);
        }
    });
}

module.exports = {
    connectToElevenLabs
};
