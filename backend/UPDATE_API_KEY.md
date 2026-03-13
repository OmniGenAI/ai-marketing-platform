# Update Google Gemini API Key

## Quick Fix

1. Get your API key from: https://aistudio.google.com/apikey

2. Open the file:
   `/Users/mac/Desktop/omnigenai/ai-marketing-platform/backend/.env`

3. Replace line 10:
   ```
   GOOGLE_GEMINI_API_KEY=your-gemini-api-key
   ```

   With your actual key:
   ```
   GOOGLE_GEMINI_API_KEY=AIzaSyC_YOUR_ACTUAL_KEY_HERE
   ```

4. Restart the backend server:
   ```bash
   pkill -f "uvicorn app.main"
   cd /Users/mac/Desktop/omnigenai/ai-marketing-platform/backend
   source venv/bin/activate
   uvicorn app.main:app --reload
   ```

5. Try generating a post again!

---

## Important Notes

- ✅ Google Gemini API has a **FREE tier**
- ✅ No credit card required for free tier
- ✅ 60 requests per minute (plenty for testing)
- ⚠️ Keep your API key private (don't commit to git)

---

## Verify It Works

After updating, test with:
```bash
curl -X POST http://127.0.0.1:8000/api/generate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "facebook",
    "tone": "professional",
    "topic": "new product launch"
  }'
```

Should return generated content instead of API key error.
