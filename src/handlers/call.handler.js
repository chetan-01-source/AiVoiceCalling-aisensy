/**
 * Call Handler
 * 
 * Orchestrates incoming call handling and cleanup
 */

const session = require('../state/session');
const playback = require('../audio/playback');
const { setupWhatsAppWebRTC } = require('../services/webrtc.service');
const { connectToElevenLabs } = require('../services/elevenlabs.service');
const { preAcceptCall, acceptCall } = require('../services/aisensy.service');
const { setupAudioBridge } = require('../audio/bridge');

/**
 * Handle incoming WhatsApp call - fully automated with ElevenLabs
 */
async function handleIncomingCall(callId, callerName, callerNumber) {
    try {
        console.log("🤖 Starting automated call handling with ElevenLabs...");

        // Step 1: Setup WhatsApp WebRTC connection
        console.log("🌉 Setting up WhatsApp WebRTC connection...");
        await setupWhatsAppWebRTC();

        // Step 2: Connect to ElevenLabs Conversational AI
        console.log("🔌 Connecting to ElevenLabs Conversational AI...");
        await connectToElevenLabs(callerName, callerNumber);

        // Step 3: Setup audio bridge
        console.log("🌉 Setting up audio bridge...");
        setupAudioBridge();

        // Step 4: Pre-accept and accept the call
        const whatsappPc = session.getWhatsappPc();
        console.log("📤 Sending pre-accept to AiSensy...");
        const preAcceptSuccess = await preAcceptCall(callId, whatsappPc.localDescription.sdp);

        if (!preAcceptSuccess) {
            throw new Error("Pre-accept failed");
        }

        console.log("✅ Pre-accept successful, waiting 1s before accept...");

        setTimeout(async () => {
            console.log("📤 Sending accept to AiSensy...");
            const acceptSuccess = await acceptCall(callId, whatsappPc.localDescription.sdp);

            if (acceptSuccess) {
                console.log("✅ Call accepted! ElevenLabs AI agent is now active.");
                console.log("🎉 Automated call setup complete!");
            } else {
                console.error("❌ Accept failed!");
            }
        }, 1000);

    } catch (error) {
        console.error("❌ Error in handleIncomingCall:", error);
        cleanupConnections();
        throw error;
    }
}

/**
 * Cleanup all connections
 */
function cleanupConnections() {
    console.log("🧹 Cleaning up connections...");

    // Stop audio sink
    const audioSink = session.getAudioSink();
    if (audioSink) {
        audioSink.stop();
        session.setAudioSink(null);
    }

    // Stop audio source track
    const audioSenderTrack = session.getAudioSenderTrack();
    if (audioSenderTrack) {
        audioSenderTrack.stop();
        session.setAudioSenderTrack(null);
    }
    session.setAudioSource(null);

    // Close WhatsApp peer connection
    const whatsappPc = session.getWhatsappPc();
    if (whatsappPc) {
        whatsappPc.close();
        session.setWhatsappPc(null);
    }

    // Close ElevenLabs WebSocket
    const elevenLabsWs = session.getElevenLabsWs();
    if (elevenLabsWs) {
        elevenLabsWs.close();
        session.setElevenLabsWs(null);
    }

    // Reset session state
    session.setWhatsappStream(null);
    session.setWhatsappOfferSdp(null);
    session.setCurrentCallId(null);
    session.setConversationId(null);

    // Reset playback state
    playback.resetPlayback();

    console.log("✅ All connections cleaned up");
}

module.exports = {
    handleIncomingCall,
    cleanupConnections
};
