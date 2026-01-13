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

// Ultravox API Configuration
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const ULTRAVOX_API_URL = "https://api.ultravox.ai/api/calls";
const ULTRAVOX_SYSTEM_PROMPT = process.env.ULTRAVOX_SYSTEM_PROMPT ||
    "You are a helpful AI assistant answering a WhatsApp voice call. Be friendly, concise, and helpful.";
const ULTRAVOX_VOICE = process.env.ULTRAVOX_VOICE || "mark";

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "AiSensy WhatsApp Calling Server with Ultravox AI is running",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development"
    });
});

// State variables per call session
let whatsappPc = null;
let whatsappStream = null;
let whatsappOfferSdp = null;
let currentCallId = null;
let ultravoxWs = null;
let ultravoxCallId = null;

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

                // Initialize automated call handling
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
 * Handle incoming WhatsApp call - fully automated
 */
async function handleIncomingCall(callId, callerName, callerNumber) {
    try {
        console.log("🤖 Starting automated call handling...");

        // Step 1: Create Ultravox call
        console.log("📞 Creating Ultravox AI call...");
        const ultravoxCall = await createUltravoxCall(callerName, callerNumber);

        if (!ultravoxCall) {
            throw new Error("Failed to create Ultravox call");
        }

        ultravoxCallId = ultravoxCall.callId;
        const joinUrl = ultravoxCall.joinUrl;
        console.log(`✅ Ultravox call created: ${ultravoxCallId}`);
        console.log(`🔗 Join URL: ${joinUrl}`);

        // Step 2: Setup WhatsApp WebRTC connection
        console.log("🌉 Setting up WhatsApp WebRTC connection...");
        await setupWhatsAppWebRTC();

        // Step 3: Join Ultravox via WebSocket
        console.log("🔌 Connecting to Ultravox WebSocket...");
        await joinUltravoxWebSocket(joinUrl);

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
                console.log("✅ Call accepted! AI agent is now active.");
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
 * Create Ultravox call via REST API
 */
async function createUltravoxCall(callerName, callerNumber) {
    try {
        const response = await axios.post(
            ULTRAVOX_API_URL,
            {
                systemPrompt: `${ULTRAVOX_SYSTEM_PROMPT}\n\nYou are speaking with ${callerName} calling from ${callerNumber}.`,
                voice: ULTRAVOX_VOICE,
                medium: {
                    serverWebSocket: {
                        inputSampleRate: 16000,
                        outputSampleRate: 16000
                    }
                },
                temperature: 0.8,
                model: "ultravox-v0.7"
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": ULTRAVOX_API_KEY
                }
            }
        );

        return {
            callId: response.data.callId,
            joinUrl: response.data.joinUrl
        };
    } catch (error) {
        console.error("❌ Failed to create Ultravox call:", error.response?.data || error.message);
        return null;
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
 * Join Ultravox call via WebSocket
 */
async function joinUltravoxWebSocket(joinUrl) {
    return new Promise((resolve, reject) => {
        try {
            console.log(`🔌 Connecting to WebSocket: ${joinUrl}`);

            ultravoxWs = new WebSocket(joinUrl);

            ultravoxWs.on("open", () => {
                console.log("✅ Ultravox WebSocket connected");

                // Start audio bridge after connection established
                setTimeout(() => {
                    bridgeAudio();
                    resolve();
                }, 500);
            });

            ultravoxWs.on("message", (data) => {
                // Ultravox sends audio as binary data
                if (Buffer.isBuffer(data)) {
                    // Audio from Ultravox → Send to WhatsApp
                    // This requires converting the audio format and injecting into WebRTC
                    // For now, we'll log that we received audio
                    // console.log(`🔊 Received ${data.length} bytes of audio from Ultravox`);
                } else {
                    // Control messages from Ultravox
                    try {
                        const message = JSON.parse(data.toString());
                        console.log("📩 Ultravox message:", message);
                    } catch (e) {
                        console.log("📩 Ultravox data:", data.toString());
                    }
                }
            });

            ultravoxWs.on("error", (error) => {
                console.error("❌ Ultravox WebSocket error:", error);
                reject(error);
            });

            ultravoxWs.on("close", () => {
                console.log("📴 Ultravox WebSocket closed");
            });

        } catch (error) {
            console.error("❌ Error joining Ultravox WebSocket:", error);
            reject(error);
        }
    });
}

/**
 * Bridge audio between WhatsApp WebRTC and Ultravox WebSocket
 */
function bridgeAudio() {
    console.log("🌉 Setting up audio bridge...");

    try {
        // Get audio tracks from WhatsApp
        const audioTracks = whatsappStream.getAudioTracks();
        console.log(`📊 WhatsApp has ${audioTracks.length} audio track(s)`);

        if (audioTracks.length > 0) {
            const audioTrack = audioTracks[0];

            // We need to extract raw audio data from the WebRTC track
            // and send it to Ultravox WebSocket

            // Note: This is a simplified version. In production, you would need:
            // 1. Audio resampling (48kHz from WhatsApp → 16kHz for Ultravox)
            // 2. Format conversion (Opus → PCM)
            // 3. Proper audio buffer handling

            console.log("⚠️ Audio bridging requires additional audio processing libraries");
            console.log("📝 Current implementation establishes connections but audio streaming needs enhancement");
            console.log("💡 Consider using libraries like: node-opus, fluent-ffmpeg, or @discordjs/opus");

            console.log("✅ Audio bridge framework established");
        } else {
            console.warn("⚠️ No audio tracks found from WhatsApp");
        }

    } catch (error) {
        console.error("❌ Error in bridgeAudio:", error);
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
    if (whatsappPc) {
        whatsappPc.close();
        whatsappPc = null;
    }

    if (ultravoxWs) {
        ultravoxWs.close();
        ultravoxWs = null;
    }

    whatsappStream = null;
    whatsappOfferSdp = null;
    currentCallId = null;
    ultravoxCallId = null;
}

// Start the server
const PORT = process.env.PORT || 19000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`========================================`);
    console.log(`🚀 AiSensy + Ultravox AI Call Server`);
    console.log(`========================================`);
    console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
    console.log(`📥 Webhook endpoint: /aisensy-webhook`);
    console.log(`🤖 AI Agent: Ultravox (${ULTRAVOX_VOICE})`);
    console.log(`📞 Mode: Fully Automated Server-Side`);
    console.log(`========================================`);
});