/**
 * Webhook Routes
 * 
 * AiSensy webhook endpoint for call events
 */

const express = require('express');
const router = express.Router();

const session = require('../state/session');
const { handleIncomingCall, cleanupConnections } = require('../handlers/call.handler');

/**
 * AiSensy Webhook - handles all call events
 */
router.post("/aisensy-webhook", async (req, res) => {
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

        session.setCurrentCallId(callId);
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
                    session.setWhatsappOfferSdp(call.session.sdp);
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

module.exports = router;
