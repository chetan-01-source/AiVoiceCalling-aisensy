/**
 * ElevenLabs Message and Audio Handlers
 */

const WebSocket = require('ws');
const session = require('../state/session');
const playback = require('../audio/playback');

/**
 * Handle control/text messages from ElevenLabs
 */
function handleElevenLabsMessage(message) {
    const elevenLabsWs = session.getElevenLabsWs();

    console.log("📩 ElevenLabs message:", message);
    switch (message.type) {
        case "conversation_initiation_metadata":
            // Correct path: message.conversation_initiation_metadata_event.conversation_id
            const convId = message.conversation_initiation_metadata_event?.conversation_id || message.conversation_id;
            session.setConversationId(convId);
            console.log(`📋 ElevenLabs conversation started: ${convId}`);
            console.log(`   Output format: ${message.conversation_initiation_metadata_event?.agent_output_audio_format}`);
            console.log(`   Input format: ${message.conversation_initiation_metadata_event?.user_input_audio_format}`);
            break;

        case "user_transcript":
            // Check both possible paths
            const userText = message.user_transcript_event?.user_transcript || message.user_transcript?.text;
            if (userText) {
                console.log(`🎤 Caller said: "${userText}"`);
            }
            break;

        case "agent_response":
            // Check both possible paths
            const agentText = message.agent_response_event?.agent_response || message.agent_response?.text;
            if (agentText) {
                console.log(`🤖 AI Agent: "${agentText}"`);
            }
            break;

        case "audio":
            // Audio is sent as base64 in JSON messages
            if (message.audio) {
                const audioData = Buffer.from(message.audio, 'base64');
                if (playback.getElevenLabsAudioCount() < 5) {
                    console.log(`🔊 Audio in JSON: ${audioData.length} bytes (decoded from base64)`);
                }
                handleElevenLabsAudio(audioData);
            } else if (message.audio_event?.audio_base_64) {
                const audioData = Buffer.from(message.audio_event.audio_base_64, 'base64');
                if (playback.getElevenLabsAudioCount() < 5) {
                    console.log(`🔊 Audio event: ${audioData.length} bytes (decoded from base64)`);
                }
                handleElevenLabsAudio(audioData);
            }
            break;

        case "ping":
            // Respond to keep-alive pings with matching event_id
            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                const pingEventId = message.ping_event?.event_id;
                const pongMessage = {
                    type: "pong",
                    event_id: pingEventId
                };
                elevenLabsWs.send(JSON.stringify(pongMessage));
                console.log(`🏓 Sent pong for event_id: ${pingEventId}`);
            }
            break;

        case "interruption":
            console.log("🔇 User interrupted the agent");
            break;

        case "agent_response_correction":
            console.log("🔄 Agent response corrected");
            break;

        default:
            console.log(`📩 ElevenLabs message type: ${message.type}`);
    }
}

// Note: μ-law decoder removed - ElevenLabs sends PCM 48kHz directly

/**
 * Handle audio data from ElevenLabs
 * 
 * ElevenLabs Conversational AI outputs 48kHz PCM - same as WhatsApp!
 * Binary data is raw 16-bit PCM samples at 48kHz
 * NO CONVERSION NEEDED - direct passthrough to WhatsApp
 */
function handleElevenLabsAudio(audioData) {
    try {
        const audioSource = session.getAudioSource();

        if (!audioSource) {
            console.log("⚠️ No audioSource - skipping ElevenLabs audio");
            return;
        }

        playback.incrementElevenLabsAudioCount();
        const elevenLabsAudioCount = playback.getElevenLabsAudioCount();

        // Get buffer data
        let pcmData;
        if (Buffer.isBuffer(audioData)) {
            pcmData = audioData;
        } else {
            pcmData = Buffer.from(audioData, 'base64');
        }

        // Log audio info periodically
        if (elevenLabsAudioCount % 20 === 1) {
            console.log(`🔊 ElevenLabs audio #${elevenLabsAudioCount}: ${pcmData.length} bytes (PCM 48kHz - direct!)`);
        }

        // Ensure even byte length for 16-bit samples
        if (pcmData.length % 2 !== 0) {
            pcmData = pcmData.slice(0, pcmData.length - 1);
        }

        if (pcmData.length < 2) {
            return;
        }

        // Copy to aligned buffer and convert to Int16Array
        const alignedBuffer = Buffer.alloc(pcmData.length);
        pcmData.copy(alignedBuffer);

        // ElevenLabs sends PCM 48kHz - same as WhatsApp! No upsampling needed!
        const samples48k = new Int16Array(alignedBuffer.buffer, alignedBuffer.byteOffset, alignedBuffer.length / 2);

        // Add to playback buffer (global buffer for paced playback)
        playback.addToPlaybackBuffer(samples48k);

        // Start the playback timer if not already running
        playback.startAudioPlayback();

    } catch (error) {
        console.error("❌ Error handling ElevenLabs audio:", error.message);
    }
}

module.exports = {
    handleElevenLabsMessage,
    handleElevenLabsAudio
};
