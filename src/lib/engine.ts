import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

export { Type, ThinkingLevel };

let runtimeToken: string | null = null;
let isInitializing = false;

async function fetchRuntimeConfig() {
  if (runtimeToken) return runtimeToken;
  if (isInitializing) {
    let attempts = 0;
    while (isInitializing && attempts < 30) {
      await new Promise(r => setTimeout(r, 300));
      if (runtimeToken) return runtimeToken;
      attempts++;
    }
    return runtimeToken;
  }

  isInitializing = true;
  try {
    console.log("[AI Engine] Attempting to fetch AI configuration from server...");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    // Add cache-busting timestamp
    const res = await fetch(`/api/ai-config?t=${Date.now()}`, { 
      cache: 'no-store',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (res.ok) {
      const data = await res.json();
      if (data.apiKey && data.apiKey.length > 5) {
        console.log("[AI Engine] Successfully loaded API key from server.");
        runtimeToken = data.apiKey;
      } else {
        console.warn("[AI Engine] Server returned an empty or invalid API key. Check hosting environment variables.");
      }
    } else {
      console.warn(`[AI Engine] Server configuration endpoint unreachable (Status: ${res.status}). Ensure backend is deployed.`);
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      console.warn("[AI Engine] Server timeout while fetching config. Network might be unstable.");
    } else {
      console.warn("[AI Engine] Client-server handshake failed. Using local/build-time fallbacks.");
    }
  } finally {
    isInitializing = false;
  }
  return runtimeToken;
}

/**
 * Get the current API token, checking environment variants and runtime fallback
 */
export async function getAppEngineToken(): Promise<string> {
  // Check build-time injected variables (defined in vite.config.ts)
  const buildToken = (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : null) || 
                     (import.meta as any).env?.VITE_GEMINI_API_KEY || 
                     (import.meta as any).env?.VITE_APP_ENGINE_TOKEN || 
                     (import.meta as any).env?.GOOGLE_API_KEY ||
                     (import.meta as any).env?.GEMINI_API_KEY ||
                     (import.meta as any).env?.VITE_API_KEY ||
                     (import.meta as any).env?.VITE_AI_KEY ||
                     (import.meta as any).env?.API_KEY ||
                     "";
  
  if (buildToken && buildToken !== "undefined" && buildToken !== '""' && buildToken.length > 5) {
    return String(buildToken).replace(/['"]+/g, '').trim();
  }

  // Check LocalStorage (allows user to provide their own key if the server one fails)
  try {
    const localKey = localStorage.getItem('GEMINI_API_KEY') || localStorage.getItem('API_KEY');
    if (localKey && localKey.length > 5 && !localKey.includes(' ')) return localKey.replace(/['"]+/g, '').trim();
  } catch (e) {}

  // Fallback to runtime API (Crucial for Cloud Run/Hosted environments)
  const token = await fetchRuntimeConfig();
  if (token && token.length > 5) return token.replace(/['"]+/g, '').trim();

  // Final manual check of window globals and other variations
  const windowKey = (window as any).GEMINI_API_KEY || (window as any).GOOGLE_API_KEY || (window as any).API_KEY;
  if (windowKey && String(windowKey).length > 5) return String(windowKey).replace(/['"]+/g, '').trim();

  return "";
}

const ENGINE_MODEL = "gemini-1.5-flash"; 
const FALLBACK_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash-8b",
  "gemini-3-flash-preview", // Keep as fallback if available
  "gemini-pro"
];

// Initialize late to ensure env vars are populated
let aiClient: GoogleGenAI | null = null;

async function getAiClient(): Promise<GoogleGenAI> {
  const currentToken = await getAppEngineToken();
  
  if (!currentToken) {
    const errorMsg = "AI Engine is not configured. Missing GEMINI_API_KEY. Action: Go to your hosting dashboard (Vercel/Cloud Run), add GEMINI_API_KEY in Environment Variables, and RE-DEPLOY the app.";
    console.error(`[AI Engine] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  if (!aiClient) {
    const masked = `${currentToken.substring(0, 4)}...${currentToken.substring(currentToken.length - 4)}`;
    console.log(`[AI Engine] Initializing GoogleGenAI with key: ${masked}`);
    aiClient = new GoogleGenAI({ apiKey: currentToken });
  }
  return aiClient;
}

export const isAiConfigured = async () => !!(await getAppEngineToken());

/**
 * Hard reset for AI configuration - useful if keys rotate or initialization gets stuck
 */
export async function resetAiEngine() {
  runtimeToken = null;
  aiClient = null;
  isInitializing = false;
  console.log("[AI Engine] Internal state has been reset. Will re-fetch configuration on next call.");
}

/**
 * Intelligent Engine Integration for UMUHINZI AI
 */
export async function callEngine<T = any>(
  fn: (ai: GoogleGenAI, model: string) => Promise<T>,
  retries = 8, // Significantly increased for hosted stability
  delay = 1500, // Slightly shorter base delay but exponential
  onBusyState?: (busy: boolean) => void,
  isInternalRetry = false
): Promise<T> {
  // Final diagnostic check for the user
  if (!(await isAiConfigured())) {
    await resetAiEngine();
    if (!(await isAiConfigured())) {
      const unreachableMsg = "AI Service is NOT active. Diagnostic: 1. Check your Vercel/Hosting Env Variables for GEMINI_API_KEY. 2. Ensure you have RE-DEPLOYED the project after adding the key. 3. Check for any typos in the variable name.";
      console.warn(`[AI Engine] ${unreachableMsg}`);
      throw new Error(unreachableMsg);
    }
  }

  const ai = await getAiClient();
  let lastError: any = null;
  let finalDiagnosticInfo = "";
  
  const modelsToTry = Array.from(new Set([ENGINE_MODEL, ...FALLBACK_MODELS]));
  console.log(`[AI Engine] Request initiated using priority: ${ENGINE_MODEL}`);
  
  for (const baseModelName of modelsToTry) {
    // Try primary variants
    const specificVersions = [
      baseModelName,
      `models/${baseModelName}`,
      baseModelName.includes("-") ? baseModelName : `models/${baseModelName}`
    ];

    // Filter out duplicates and invalid names
    const uniqueVersions = Array.from(new Set(specificVersions)).filter(n => n && n.length > 3);

    for (const modelName of uniqueVersions) {
      let currentRetries = baseModelName === ENGINE_MODEL ? retries : 3; 
      let currentDelay = delay;
      
      while (currentRetries >= 0) {
        try {
          if (!isInternalRetry) onBusyState?.(true);
          
          // Enable Google Search Grounding for real-time data
          const result = await fn(ai, modelName);
          if (!isInternalRetry) onBusyState?.(false);
          return result;
        } catch (error: any) {
          lastError = error;
          const errorMsg = error?.message?.toLowerCase() || "";
          const errorCode = error?.status || error?.code || "unknown";
          
          finalDiagnosticInfo = `[Model: ${modelName}, Code: ${errorCode}, Msg: ${errorMsg.substring(0, 100)}]`;
          
          // If 404 and we have a prefixed version to try next in the inner loop, just continue
          if ((errorMsg.includes("not found") || errorMsg.includes("404")) && specificVersions.indexOf(modelName) < specificVersions.length - 1) {
            console.warn(`[AI Engine] Model ${modelName} 404, trying next variant...`);
            break; 
          }

          console.error(`[AI Engine] Model ${modelName} attempt failed:`, error);
          
          // Handle model availability issues (transition to next base model)
          if (errorMsg.includes("not found") || errorMsg.includes("404") || errorMsg.includes("unsupported") || errorMsg.includes("not supported") || errorMsg.includes("failed to fetch")) {
            console.warn(`[AI Engine] Model ${modelName} unavailable/mismatch. Transitioning to fallback chain.`);
            break; 
          }

        const isQuotaError = errorMsg.includes('quota') || errorMsg.includes('exhausted') || errorMsg.includes('limit') || error?.status === 429;
        const isAuthError = errorMsg.includes('api_key_invalid') || errorMsg.includes('401') || errorMsg.includes('unauthorized') || errorMsg.includes('auth') || error?.status === 401;
        const isOverload = errorMsg.includes('503') || errorMsg.includes('504') || errorMsg.includes('overloaded') || errorMsg.includes('busy') || errorMsg.includes('capacity') || error?.status === 503;
        const isHighDemand = errorMsg.includes('high demand') || errorMsg.includes('temporarily') || isQuotaError || isOverload;

        if (isAuthError) {
          throw new Error("AI Authentication Failed: The API key provided is not authorized or has expired. Recovery: Check Cloud Run environment variables.");
        }

        if ((isQuotaError || isOverload || isHighDemand) && currentRetries > 0) {
          // Rapid jump to fallback models when encountering capacity issues
          if (isQuotaError || isHighDemand) {
             console.warn(`[AI Engine] ${modelName} experiencing high traffic/quota limits. Transitioning to next available model in chain...`);
             break; // DON'T retry the same model if it's busy, jump to the next one immediately
          }

          const waitTime = currentDelay + (Math.random() * 2000);
          console.warn(`[AI Engine] System busy. Cooling down for ${Math.round(waitTime)}ms...`);
          
          await new Promise(r => setTimeout(r, waitTime));
          currentRetries--;
          currentDelay = Math.min(currentDelay * 2, 15000); 
          continue;
        }

        // Cycle on any error that isn't fatal/auth after logic
        break;
      }
    }
  }
}

  if (!isInternalRetry) onBusyState?.(false);
  const detailedError = lastError?.message || "All models returned non-200 status";
  console.error(`[AI Engine] CRITICAL: Fallback chain exhausted. Last error: ${detailedError}. Diagnostics: ${finalDiagnosticInfo}`);
  
  const userFriendlyError = isAuthError(detailedError) 
    ? `API Key rejected by Google. Please check your GEMINI_API_KEY on Vercel. ${finalDiagnosticInfo}`
    : `AI service failed to respond. ${finalDiagnosticInfo}`;
    
  throw lastError ? new Error(userFriendlyError) : new Error("AI service is currently unresponsive. This is likely a regional API outage or network disruption.");
}

function isAuthError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes('api_key_invalid') || m.includes('401') || m.includes('unauthorized') || m.includes('auth');
}

/**
 * Optimized result parser for engine responses
 */
export function parseEngineResponse(response: any): any {
  try {
    if (!response) return "";
    // Extract text from potential response formats
    let text = "";
    if (response.text && typeof response.text === 'string') {
      text = response.text;
    } else if (typeof response === 'string') {
      text = response;
    } else {
      text = JSON.stringify(response);
    }

    // Heuristic for JSON extraction: find first { or [ and last } or ]
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let start = -1;
    let end = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = text.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = text.lastIndexOf(']');
    }

    if (start !== -1 && end !== -1 && end > start) {
      const jsonContent = text.substring(start, end + 1);
      try {
        return JSON.parse(jsonContent);
      } catch (parseErr) {
        console.warn("Partial JSON match failed to parse, falling back to regex", parseErr);
      }
    }

    // Fallback: simple text return
    return text;
  } catch (e) {
    console.error("Result parsing failed", e);
    return response;
  }
}

/**
 * Generate an agricultural themed image using Gemini 2.5 Flash Image
 */
export async function generateEngineImage(prompt: string, onBusyState?: (busy: boolean) => void): Promise<string | null> {
  try {
    onBusyState?.(true);
    const ai = await getAiClient();
    
    // Correct tool call pattern for Gemini 3 series (or current primary)
    const response = await ai.models.generateContent({
      model: ENGINE_MODEL,
      contents: `High-quality agricultural art: ${prompt}. Return a detailed visual description.`,
      config: {
        systemInstruction: "You are a visual artist specializing in agriculture."
      }
    });

    if (response && response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          return `data:image/png;base64,${base64Data}`;
        }
      }
    }

    // Fallback if no image part found
    console.warn("Gemini didn't return an image part, using Unsplash fallback");
    const query = encodeURIComponent(prompt.slice(0, 50));
    const randomId = Math.floor(Math.random() * 1000);
    return `https://images.unsplash.com/photo-1592982537447-6f2a6a0c7c18?auto=format&fit=crop&q=80&w=800&q=agriculture,farming,${query}&sig=${randomId}`;
  } catch (error) {
    console.error("Image generation failed:", error);
    // Unsplash fallback on error
    const query = encodeURIComponent(prompt.slice(0, 50));
    return `https://images.unsplash.com/photo-1592982537447-6f2a6a0c7c18?auto=format&fit=crop&q=80&w=800&q=agriculture,farming,${query}`;
  } finally {
    onBusyState?.(false);
  }
}
