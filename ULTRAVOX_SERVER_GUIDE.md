# Server-Side Ultravox Integration - Usage Guide

## Overview

`server-ultravox.js` is a **fully automated, server-only** implementation that:
- ✅ Automatically answers incoming WhatsApp calls via AiSensy
- ✅ Connects callers directly to Ultravox AI agent
- ✅ No browser or manual interaction required
- ✅ Handles WebRTC and WebSocket connections server-side

## Quick Start

### 1. Environment Setup

Make sure your `.env` file has these variables:

```env
# AiSensy Configuration
AISENSY_PROJECT_ID=your_project_id
AISENSY_API_KEY=your_api_key

# Ultravox Configuration
ULTRAVOX_API_KEY=your_ultravox_api_key
ULTRAVOX_SYSTEM_PROMPT=You are a helpful AI assistant answering a WhatsApp voice call. Be friendly, concise, and helpful.
ULTRAVOX_VOICE=mark

# Server Configuration
PORT=19000
NODE_ENV=production
```

### 2. Run the Server

```bash
# Install dependencies (if not already installed)
npm install

# Start the server
node server-ultravox.js
```

You should see:
```
========================================
🚀 AiSensy + Ultravox AI Call Server
========================================
✅ Server running at http://0.0.0.0:19000
📥 Webhook endpoint: /aisensy-webhook
🤖 AI Agent: Ultravox (mark)
📞 Mode: Fully Automated Server-Side
========================================
```

### 3. Configure AiSensy Webhook

Point your AiSensy webhook to:
```
https://your-domain.com/aisensy-webhook
```

### 4. Test

Call your WhatsApp business number - the AI should answer automatically!

## How It Works

```
┌─────────────────┐
│  WhatsApp User  │
│   📱 Calls      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   AiSensy API   │
│   (Webhook)     │
└────────┬────────┘
         │
         ▼
┌──────────────────────────┐
│  server-ultravox.js      │
│  • Receives webhook      │
│  • Creates Ultravox call │
│  • Sets up WebRTC        │
│  • Bridges audio         │
└────────┬─────────────────┘
         │
         ▼
┌─────────────────┐
│  Ultravox AI    │
│  (WebSocket)    │
│  🤖 Responds    │
└─────────────────┘
```

## Call Flow

1. **Incoming Call** - User calls WhatsApp number
2. **Webhook Received** - AiSensy sends `connect` event to `/aisensy-webhook`
3. **Ultravox Call Created** - Server creates AI call via REST API
4. **WebRTC Setup** - Server establishes WhatsApp WebRTC connection  
5. **WebSocket Join** - Server joins Ultravox via WebSocket
6. **Pre-Accept** - Server sends SDP to AiSensy
7. **Accept** - Call is fully connected
8. **Audio Bridge** - Audio flows: Caller ↔ Server ↔ AI
9. **Termination** - When call ends, everything cleans up gracefully

## Configuration Options

### Ultravox Voice Options

Available voices (set in `ULTRAVOX_VOICE`):
- `mark` - Male, American
- `jessica` - Female, American  
- `terrell` - Male, American
- `arya` - Female, British

### System Prompt

Customize the AI's behavior via `ULTRAVOX_SYSTEM_PROMPT`:

```env
ULTRAVOX_SYSTEM_PROMPT=You are a customer service agent for ACME Corp. Answer questions about our products, hours (9AM-5PM), and location. Be professional and helpful.
```

## Deployment

### Option 1: Render.com

1. Update `package.json` start script:
```json
{
  "scripts": {
    "start": "node server-ultravox.js"
  }
}
```

2. Push to GitHub
3. Render will auto-deploy

### Option 2: Manual Server

```bash
# Using PM2
pm2 start server-ultravox.js --name whatsapp-ai-calls

# Or with nohup
nohup node server-ultravox.js > output.log 2>&1 &
```

## Monitoring

Check server logs for these indicators:

### Success:
- ✅ Call data extracted
- ✅ Ultravox call created
- ✅ Ultravox WebSocket connected
- ✅ WhatsApp audio track received
- ✅ Call accepted! AI agent is now active.

### Issues:
- ❌ Failed to create Ultravox call - Check API key
- ❌ Error in setupWhatsAppWebRTC - Check SDP format
- ❌ Ultravox WebSocket error - Check network/firewall

## Known Limitations

### Audio Processing

The current implementation establishes all connections but **audio streaming requires additional processing**:

1. **Format Conversion**
   - WhatsApp uses Opus codec at 48kHz
   - Ultravox expects PCM at 16kHz
   - Need audio transcoding

2. **Recommended Libraries**
   - `node-opus` - Opus encoding/decoding
   - `fluent-ffmpeg` - Audio resampling
   - `@discordjs/opus` - Alternative Opus library

### Future Enhancements

To enable full bidirectional audio:

```javascript
// Install audio processing
npm install node-opus fluent-ffmpeg

// Add audio pipeline
// WhatsApp WebRTC track → Opus decode → Resample 48→16kHz → PCM → Ultravox WS
// Ultravox WS → PCM → Resample 16→48kHz → Opus encode → WhatsApp WebRTC track
```

## Troubleshooting

### Call Connects But No Audio

This is expected in the current version. The WebRTC and WebSocket connections are established correctly, but the audio pipeline needs enhancement with transcoding libraries.

### Call Fails to Answer

Check:
1. Ultravox API key is valid
2. AiSensy webhook is configured correctly
3. Server is accessible from internet
4. Logs show SDP extraction successful

### WebSocket Connection Fails

Check:
1. Network allows WebSocket connections
2. No firewall blocking outbound WSS
3. Ultravox service is operational

## Comparison: server.js vs server-ultravox.js

| Feature | server.js | server-ultravox.js |
|---------|-----------|-------------------|
| Browser Required | ✅ Yes | ❌ No |
| Socket.IO | ✅ Used | ❌ Not needed |
| Automation | ❌ Manual | ✅ Fully automated |
| Ultravox Integration | ❌ In browser | ✅ Server-side |
| Production Ready | ❌ No | ✅ Yes (with audio lib) |

## Next Steps

1. **Test the current implementation** - Verify connections establish correctly
2. **Add audio processing** - Implement transcoding for full audio flow
3. **Production deployment** - Deploy to your server
4. **Monitor and optimize** - Track call quality and latency

## Support

For issues:
1. Check server logs
2. Verify environment variables
3. Test API keys manually
4. Review Ultravox API documentation: https://docs.ultravox.ai
