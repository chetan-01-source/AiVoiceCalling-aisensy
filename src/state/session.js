/**
 * Call Session State Management
 * 
 * Manages state variables for the current call session
 */

// State variables per call session
let whatsappPc = null;
let whatsappStream = null;
let whatsappOfferSdp = null;
let currentCallId = null;
let elevenLabsWs = null;
let conversationId = null;
let audioSink = null;       // RTCAudioSink for extracting audio from WhatsApp
let audioSource = null;     // RTCAudioSource for sending audio to WhatsApp
let audioSendCount = 0;
let audioSendEnabled = true; // Re-enabled after fixing ping response
let audioSenderTrack = null; // Track for sending audio back to WhatsApp

// Getters
const getWhatsappPc = () => whatsappPc;
const getWhatsappStream = () => whatsappStream;
const getWhatsappOfferSdp = () => whatsappOfferSdp;
const getCurrentCallId = () => currentCallId;
const getElevenLabsWs = () => elevenLabsWs;
const getConversationId = () => conversationId;
const getAudioSink = () => audioSink;
const getAudioSource = () => audioSource;
const getAudioSendCount = () => audioSendCount;
const getAudioSendEnabled = () => audioSendEnabled;
const getAudioSenderTrack = () => audioSenderTrack;

// Setters
const setWhatsappPc = (value) => { whatsappPc = value; };
const setWhatsappStream = (value) => { whatsappStream = value; };
const setWhatsappOfferSdp = (value) => { whatsappOfferSdp = value; };
const setCurrentCallId = (value) => { currentCallId = value; };
const setElevenLabsWs = (value) => { elevenLabsWs = value; };
const setConversationId = (value) => { conversationId = value; };
const setAudioSink = (value) => { audioSink = value; };
const setAudioSource = (value) => { audioSource = value; };
const setAudioSendCount = (value) => { audioSendCount = value; };
const incrementAudioSendCount = () => { audioSendCount++; };
const setAudioSendEnabled = (value) => { audioSendEnabled = value; };
const setAudioSenderTrack = (value) => { audioSenderTrack = value; };

// Reset all state
const resetState = () => {
    whatsappPc = null;
    whatsappStream = null;
    whatsappOfferSdp = null;
    currentCallId = null;
    elevenLabsWs = null;
    conversationId = null;
    audioSink = null;
    audioSource = null;
    audioSendCount = 0;
    audioSendEnabled = true;
    audioSenderTrack = null;
};

module.exports = {
    // Getters
    getWhatsappPc,
    getWhatsappStream,
    getWhatsappOfferSdp,
    getCurrentCallId,
    getElevenLabsWs,
    getConversationId,
    getAudioSink,
    getAudioSource,
    getAudioSendCount,
    getAudioSendEnabled,
    getAudioSenderTrack,

    // Setters
    setWhatsappPc,
    setWhatsappStream,
    setWhatsappOfferSdp,
    setCurrentCallId,
    setElevenLabsWs,
    setConversationId,
    setAudioSink,
    setAudioSource,
    setAudioSendCount,
    incrementAudioSendCount,
    setAudioSendEnabled,
    setAudioSenderTrack,

    // Reset
    resetState
};
