/**
 * AiSensy API Service
 * 
 * Functions for interacting with AiSensy WhatsApp Calling API
 */

const axios = require('axios');
const { AISENSY_BASE_URL, PROJECT_ID, AISENSY_HEADERS } = require('../config');

/**
 * Pre-accept incoming call
 */
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

/**
 * Accept incoming call
 */
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

module.exports = {
    preAcceptCall,
    acceptCall
};
