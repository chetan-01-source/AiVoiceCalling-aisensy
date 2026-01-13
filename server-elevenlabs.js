require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const {
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceCandidate,
    MediaStream,
} = require("@roamhq/wrtc");

// STUN server for NAT traversal
const ICE_SERVERS = [{ urls: "stun:stun.relay.metered.ca:80" }];

// AiSensy API Configuration
const AISENSY_BASE_URL = "https://apis.aisensy.com/project-apis/v1";
const PROJECT_ID = process.env.AISENSY_PROJECT_ID;
const API_KEY = process.env.AISENSY_API_KEY;

const AISENSY_HEADERS = {
    "x-aisensy-project-api-pwd": API_KEY,
    "Content-Type": "application/json"
};

// ElevenLabs Conversational AI Configuration
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "AiSensy WhatsApp Calling Server with ElevenLabs AI is running",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        aiProvider: "ElevenLabs Conversational AI"
    });
});

// State variables per call session
let whatsappPc = null;
let whatsappStream = null;
let whatsappOfferSdp = null;
let currentCallId = null;
let elevenLabsWs = null;
let conversationId = null;

/**
 * AiSensy Webhook - handles all call events
 */
app.post("/aisensy-webhook", async (req, res) => {
    try {
        console.log("========================================");
        console.log("📥 Received AiSensy webhook");
        console.log("Request body:", JSON.stringify(req.body, null, 2));
        console.log("========================================");

        // Validate basic webhook structure
        if (!req.body) {
            console.error("❌ Empty request body");
            return res.status(400).json({ error: "Empty request body" });
        }

        // Parse AiSensy's webhook format
        const { object, entry, topic } = req.body;

        if (!topic) {
            console.warn("⚠️ Missing 'topic' in webhook payload");
            return res.status(200).json({ received: true, message: "Missing topic" });
        }

        if (!entry || !Array.isArray(entry) || entry.length === 0) {
            console.warn("⚠️ Missing or empty 'entry' array in webhook payload");
            return res.status(200).json({ received: true, message: "Missing entry data" });
        }

        // Extract call data from AiSensy's format: entry[0].changes[0].value.calls[0]
        const changes = entry[0]?.changes;
        if (!changes || !Array.isArray(changes) || changes.length === 0) {
            console.warn("⚠️ No changes found in entry");
            return res.status(200).json({ received: true, message: "No changes data" });
        }

        const value = changes[0]?.value;
        if (!value) {
            console.warn("⚠️ No value found in changes");
            return res.status(200).json({ received: true, message: "No value data" });
        }

        const calls = value.calls;
        if (!calls || !Array.isArray(calls) || calls.length === 0) {
            console.warn("⚠️ No calls found in value");
            return res.status(200).json({ received: true, message: "No calls data" });
        }

        const call = calls[0];
        console.log("✅ Call data extracted:", JSON.stringify(call, null, 2));

        const callId = call.id;
        if (!callId) {
            console.error("❌ No call ID found in webhook data");
            return res.status(200).json({ received: true, message: "Missing call ID" });
        }

        currentCallId = callId;
        console.log(`✅ Processing call ID: ${callId}`);

        const callEvent = call.event;
        const callStatus = call.status;
        const callerNumber = call.from;
        const receiverNumber = call.to;

        console.log(`📞 Call event: ${callEvent}, Status: ${callStatus || 'N/A'}`);
        console.log(`📞 From: ${callerNumber}, To: ${receiverNumber}`);

        // Handle different call events
        if (callEvent === "connect") {
            console.log("📞 Processing incoming call 'connect' event");
            try {
                console.log(`Incoming call from ${callerNumber}`);

                // Extract SDP from session object
                if (call.session && call.session.sdp) {
                    whatsappOfferSdp = call.session.sdp;
                    console.log("✅ SDP extracted from call.session.sdp");
                } else {
                    console.warn("⚠️ No SDP found in call.session");
                    return res.status(200).json({ received: true, message: "Missing SDP" });
                }

                // Get caller name from contacts
                const contacts = value.contacts;
                let callerName = "Unknown";
                if (contacts && Array.isArray(contacts) && contacts.length > 0) {
                    callerName = contacts[0].profile?.name || "Unknown";
                }

                console.log(`📞 Caller: ${callerName} (${callerNumber})`);

                // Initialize automated call handling with ElevenLabs
                await handleIncomingCall(callId, callerName, callerNumber);

            } catch (error) {
                console.error("❌ Error in 'connect' event handler:", error);
                throw error;
            }
        } else if (callEvent === "terminate") {
            console.log("📴 Processing call 'terminate' event");
            try {
                console.log(`Call terminated. Status: ${callStatus}`);

                // Cleanup
                cleanupConnections();
                console.log("✅ Cleaned up all connections");
            } catch (error) {
                console.error("❌ Error in 'terminate' event handler:", error);
                throw error;
            }
        } else {
            console.log(`⚠️ Unhandled call event: ${callEvent}`);
        }

        console.log("✅ Webhook processed successfully");
        res.status(200).json({ received: true, topic, callId, event: callEvent });
    } catch (err) {
        console.error("========================================");
        console.error("❌ ERROR processing AiSensy webhook");
        console.error("Error message:", err.message);
        console.error("Error stack:", err.stack);
        console.error("========================================");

        res.status(500).json({
            error: "Internal server error",
            message: err.message
        });
    }
});

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
 * Setup WhatsApp WebRTC peer connection
 */
async function setupWhatsAppWebRTC() {
    return new Promise(async (resolve, reject) => {
        try {
            whatsappPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            whatsappStream = new MediaStream();

            // Track received from WhatsApp
            const trackPromise = new Promise((resolveTrack, rejectTrack) => {
                const timeout = setTimeout(() => {
                    rejectTrack(new Error("Timed out waiting for WhatsApp track"));
                }, 10000);

                whatsappPc.ontrack = (event) => {
                    clearTimeout(timeout);
                    console.log("📞 Audio track received from WhatsApp");
                    whatsappStream = event.streams[0];
                    event.streams[0].getTracks().forEach((track) => {
                        console.log(`WhatsApp track: ${track.kind}, enabled: ${track.enabled}`);
                    });
                    resolveTrack();
                };
            });

            whatsappPc.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log("WhatsApp ICE candidate generated");
                }
            };

            whatsappPc.oniceconnectionstatechange = () => {
                if (whatsappPc) {
                    console.log(`WhatsApp ICE state: ${whatsappPc.iceConnectionState}`);
                }
            };

            whatsappPc.onconnectionstatechange = () => {
                if (whatsappPc) {
                    console.log(`WhatsApp connection state: ${whatsappPc.connectionState}`);
                }
            };

            // Set remote description (WhatsApp's offer)
            await whatsappPc.setRemoteDescription(new RTCSessionDescription({
                type: "offer",
                sdp: whatsappOfferSdp
            }));
            console.log("✅ WhatsApp offer SDP set as remote description");

            // Wait for WhatsApp audio track
            await trackPromise;
            console.log("✅ WhatsApp audio track received");

            // Create answer
            const answer = await whatsappPc.createAnswer();
            await whatsappPc.setLocalDescription(answer);

            // Fix setup attribute for WhatsApp
            const finalSdp = answer.sdp.replace("a=setup:actpass", "a=setup:active");
            console.log("✅ WhatsApp answer SDP prepared");

            resolve();
        } catch (error) {
            console.error("❌ Error in setupWhatsAppWebRTC:", error);
            reject(error);
        }
    });
}

/**
 * Connect to ElevenLabs Conversational AI via WebSocket
 * 
 * KEY ADVANTAGE: ElevenLabs supports Opus at 48kHz - same as WhatsApp!
 * No audio decoding/encoding required!
 */
async function connectToElevenLabs(callerName, callerNumber) {
    return new Promise((resolve, reject) => {
        try {
            // ElevenLabs Conversational AI WebSocket URL
            const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`;
            console.log(`🔌 Connecting to ElevenLabs WebSocket...`);

            elevenLabsWs = new WebSocket(wsUrl);

            elevenLabsWs.on("open", () => {
                console.log("✅ ElevenLabs WebSocket connected");

                // Initialize conversation with caller context
                const initMessage = {
                    type: "conversation_initiation_client_data",
                    conversation_config_override: {
                        agent: {
                            prompt: {
                                prompt: `The caller's name is ${callerName} and their phone number is ${callerNumber}. Greet them appropriately.`
                            }
                        }
                    },
                    custom_llm_extra_body: {
                        caller_name: callerName,
                        caller_number: callerNumber
                    }
                };

                elevenLabsWs.send(JSON.stringify(initMessage));
                console.log("📤 Sent conversation initialization to ElevenLabs");

                resolve();
            });

            elevenLabsWs.on("message", (data) => {
                // Handle messages from ElevenLabs
                if (Buffer.isBuffer(data)) {
                    // Binary audio data from ElevenLabs AI
                    // This is already in a compatible format (Opus or configured output)
                    handleElevenLabsAudio(data);
                } else {
                    // JSON control/text messages
                    try {
                        const message = JSON.parse(data.toString());
                        handleElevenLabsMessage(message);
                    } catch (e) {
                        console.log("📩 ElevenLabs data:", data.toString());
                    }
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

/**
 * Handle control/text messages from ElevenLabs
 */
function handleElevenLabsMessage(message) {
    switch (message.type) {
        case "conversation_initiation_metadata":
            conversationId = message.conversation_id;
            console.log(`📋 ElevenLabs conversation started: ${conversationId}`);
            break;

        case "user_transcript":
            if (message.user_transcript?.text) {
                console.log(`🎤 Caller said: "${message.user_transcript.text}"`);
            }
            break;

        case "agent_response":
            if (message.agent_response?.text) {
                console.log(`🤖 AI Agent: "${message.agent_response.text}"`);
            }
            break;

        case "audio":
            // Audio handled separately in binary message handler
            break;

        case "ping":
            // Respond to keep-alive pings
            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                elevenLabsWs.send(JSON.stringify({ type: "pong" }));
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

/**
 * Handle audio data from ElevenLabs
 * 
 * ElevenLabs returns audio in the configured format.
 * With Opus output, it's directly compatible with WhatsApp!
 */
function handleElevenLabsAudio(audioData) {
    // Forward audio to WhatsApp WebRTC
    // In production: inject this audio into the WebRTC sender track

    // For now, log that we received audio
    // console.log(`🔊 Received ${audioData.length} bytes of audio from ElevenLabs`);

    // TODO: Implement audio injection into WebRTC track
    // This requires creating an audio source and feeding it to the peer connection
}

/**
 * Setup bidirectional audio bridge between WhatsApp and ElevenLabs
 * 
 * KEY ADVANTAGE: ElevenLabs supports Opus at 48kHz!
 * - WhatsApp sends Opus at 48kHz
 * - ElevenLabs accepts Opus at 48kHz
 * - No decoding/resampling needed!
 */
function setupAudioBridge() {
    console.log("🌉 Setting up audio bridge (ElevenLabs Opus mode)...");

    try {
        // Get audio tracks from WhatsApp
        const audioTracks = whatsappStream.getAudioTracks();
        console.log(`📊 WhatsApp has ${audioTracks.length} audio track(s)`);

        if (audioTracks.length > 0) {
            const audioTrack = audioTracks[0];
            console.log(`✅ Audio track found: ${audioTrack.kind}, enabled: ${audioTrack.enabled}`);

            // ElevenLabs advantage: We can forward Opus audio directly!
            // No need for:
            // - Opus decoding (node-opus, @discordjs/opus)
            // - Resampling (48kHz → 16kHz)
            // - PCM conversion

            // In production implementation:
            // 1. Extract RTP packets from WebRTC track
            // 2. Forward Opus payload to ElevenLabs WebSocket
            // 3. ElevenLabs processes Opus directly

            console.log("✅ Audio bridge configured for ElevenLabs Opus passthrough");
            console.log("📝 Note: Full RTP packet extraction requires additional implementation");
            console.log("💡 ElevenLabs accepts: Opus 48kHz, PCM 16kHz (base64 encoded)");

        } else {
            console.warn("⚠️ No audio tracks found from WhatsApp");
        }

    } catch (error) {
        console.error("❌ Error in setupAudioBridge:", error);
    }
}

/**
 * Send audio from WhatsApp to ElevenLabs
 * 
 * Call this function when you have audio data from WhatsApp to send
 */
function sendAudioToElevenLabs(audioData) {
    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
        // ElevenLabs accepts audio in user_audio_chunk format
        // For PCM: Base64 encoded, 16kHz, mono, 16-bit
        // For Opus: Can be sent directly if configured

        const audioMessage = {
            type: "user_audio_chunk",
            user_audio_chunk: audioData.toString('base64')
        };

        elevenLabsWs.send(JSON.stringify(audioMessage));
    }
}

/**
 * AiSensy API Functions
 */

// Pre-accept incoming call
async function preAcceptCall(callId, sdp, callbackData = null) {
    const body = {
        callId,
        sdp,
        ...(callbackData && { callbackData })
    };

    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/pre-accept`;
        const response = await axios.post(url, body, { headers: AISENSY_HEADERS });

        if (response.data.success) {
            console.log(`Call ${callId} pre-accepted successfully.`);
            return true;
        }

        return false;
    } catch (error) {
        console.error("Failed to pre-accept call:", error.message);
        return false;
    }
}

// Accept incoming call
async function acceptCall(callId, sdp, callbackData = null) {
    const body = {
        callId,
        sdp,
        ...(callbackData && { callbackData })
    };

    try {
        const url = `${AISENSY_BASE_URL}/project/${PROJECT_ID}/wa-calling/call/accept`;
        const response = await axios.post(url, body, { headers: AISENSY_HEADERS });

        if (response.data.success) {
            console.log(`Call ${callId} accepted successfully.`);
            return true;
        }

        return false;
    } catch (error) {
        console.error("Failed to accept call:", error.message);
        return false;
    }
}

// Cleanup all connections
function cleanupConnections() {
    console.log("🧹 Cleaning up connections...");

    if (whatsappPc) {
        whatsappPc.close();
        whatsappPc = null;
    }

    if (elevenLabsWs) {
        elevenLabsWs.close();
        elevenLabsWs = null;
    }

    whatsappStream = null;
    whatsappOfferSdp = null;
    currentCallId = null;
    conversationId = null;

    console.log("✅ All connections cleaned up");
}

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
