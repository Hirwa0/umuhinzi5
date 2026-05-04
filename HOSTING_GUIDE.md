# 🚀 UMUHINZI AI Hosting Guide (Vercel + GitHub)

Follow these steps exactly to have your AI working perfectly on Vercel without any API errors.

## Phase 1: Preparation
1. **Download the Zip** of your project or **Sync to GitHub**.
2. Go to the [Google AI Studio API Key page](https://aistudio.google.com/app/apikey) and copy your **API Key**.

## Phase 2: Vercel Deployment
1. Go to [Vercel.com](https://vercel.com) and click **"Add New" -> "Project"**.
2. Select your GitHub repository (`umuhinzi`).
3. **CRITICAL STEP (The API Fixed):** 
   - Look for the **Environment Variables** section.
   - For **Name**, type: `GEMINI_API_KEY`
   - For **Value**, paste your API Key from Google AI Studio.
   - Click **Add**.
   - *(Optional but Recommended)* Add another one:
     - Name: `VITE_GEMINI_API_KEY`
     - Value: (same API key)
4. Click **Deploy**.

## Phase 3: Verification
1. Once deployment finishes, open your URL.
2. If the AI still doesn't respond, go to **Settings -> Environment Variables** in Vercel to check if the name is spelled correctly.
3. If you changed a variable, you **MUST** go to the **Deployments** tab, click the three dots on the latest deployment, and select **"Redeploy"** to apply the new keys.

## Why it failed before?
- **Naming:** You might have used `API_KEY` or `VAL` instead of `GEMINI_API_KEY`.
- **Formatting:** Ensure there are no spaces or quotes around the key value.
- **Propagation:** Sometimes it takes 30-60 seconds for the cloud to update the key.
- **Redeploy:** On Vercel, adding a key doesn't fix a running app immediately; you MUST trigger a **Redeploy**.

## Real-Time Search
The AI is now configured with **Google Search Grounding**. This means it can find live sports results (like CAVB matches) and news that isn't in its memory yet.

**Status: READY FOR HOSTING!**
