# Render Deployment Guide

## Quick Deploy to Render

### Option 1: Using render.yaml (Recommended)

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Add Render configuration"
   git push origin main
   ```

2. **Connect to Render**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml` and configure everything

3. **Set Environment Variables** (in Render Dashboard)
   - `AISENSY_PROJECT_ID` - Your AiSensy project ID
   - `AISENSY_API_KEY` - Your AiSensy API key

### Option 2: Manual Setup

1. **Create New Web Service**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure Settings**
   - **Name**: `aisensy-whatsapp-calling`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or your preferred plan)

3. **Add Environment Variables**
   Navigate to "Environment" tab and add:
   - `NODE_ENV` = `production`
   - `AISENSY_PROJECT_ID` = `your_project_id`
   - `AISENSY_API_KEY` = `your_api_key`

4. **Health Check**
   - Path: `/health`
   - This ensures Render knows your service is running

## After Deployment

### Get Your Service URL
After deployment, Render will provide you with a URL like:
```
https://aisensy-whatsapp-calling.onrender.com
```

### Configure AiSensy Webhook
1. Go to your AiSensy dashboard
2. Set webhook URL to:
   ```
   https://your-service-name.onrender.com/aisensy-webhook
   ```

### Test Your Deployment
1. **Test Health Endpoint**:
   ```bash
   curl https://your-service-name.onrender.com/health
   ```
   
   Should return:
   ```json
   {
     "status": "OK",
     "message": "AiSensy WhatsApp Calling Server is running",
     "timestamp": "...",
     "uptime": ...,
     "environment": "production"
   }
   ```

2. **Access Web Interface**:
   ```
   https://your-service-name.onrender.com
   ```

## Important Notes

### Free Tier Limitations
- ⚠️ **Render Free tier spins down after 15 minutes of inactivity**
- First request after spin-down takes ~30 seconds to wake up
- Consider upgrading to paid plan for production use

### WebSocket/Socket.IO Support
- ✅ Render fully supports WebSocket connections
- ✅ Socket.IO will work without additional configuration

### Environment Variables Required
Make sure to set these in Render dashboard:
- `AISENSY_PROJECT_ID` ✅ Required
- `AISENSY_API_KEY` ✅ Required
- `PORT` - Auto-set by Render (default: 10000)
- `NODE_ENV` - Set to `production`

## Troubleshooting

### Build Fails
- Check logs in Render dashboard
- Verify `package.json` has correct dependencies
- Ensure Node.js version compatibility

### Service Won't Start
- Check start logs in Render dashboard
- Verify environment variables are set
- Test `/health` endpoint

### Webhook Not Receiving Data
- Verify webhook URL in AiSensy dashboard
- Check Render logs for incoming requests
- Ensure service is not sleeping (ping health endpoint)

## Monitoring

View logs in real-time:
1. Go to Render Dashboard
2. Select your service
3. Click "Logs" tab

## Need Help?
- [Render Documentation](https://render.com/docs)
- [AiSensy Support](https://aisensy.com/support)
